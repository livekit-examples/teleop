import { operationPresentations } from './control-profiles';
import { discoveredSimulationAdapters } from '../demo/trajectory-adapter';
import { CameraDeck } from './cameras';
import { discoveredHardwareAdapters } from './hardware-adapters';
import {
  ControlManager,
  controlKey,
  controlChannels,
  fixtureAdapters,
  type ProfileAdapter,
} from './controls';
import { LayoutStore, type LayoutStorage } from './layout';
import { StreamHub } from './streams';
import {
  browserClock,
  compatibleRobot,
  endpointKey,
  errorMessage,
  own,
  type Clock,
  type Layout,
  type Publication,
  type RobotConfig,
  type Transport,
} from './types';
import { isExcluded, parseDiscovery } from './validation';

export type CatalogEntry = Publication & {
  available: boolean;
  excluded: boolean;
};

/** One runtime per connection. React does not own stream readers or command writers. */
export class WorkspaceRuntime {
  readonly streams: StreamHub;
  readonly cameras = new CameraDeck();
  readonly controls: ControlManager;
  selected = '';
  /** Hosted simulation scene id, when this runtime belongs to a managed session. */
  simulationId = '';
  config?: RobotConfig;
  connection: 'disconnected' | 'connected' | 'reconnecting' = 'disconnected';
  discovery: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  error = '';
  xrActive = false;
  /** What each controller is doing, for the VR Controls panel. */
  xrHands: Partial<Record<'left' | 'right', string>> = {};
  /** What each tracked hand is doing, for the hand tracking section of the Controls panel. */
  handStatus: Partial<Record<'left' | 'right', string>> = {};
  /** The canvas that shows the webcam and the tracked hands. Set while hand tracking runs. */
  handCanvas?: HTMLCanvasElement;
  /** Why hand tracking is not running, such as a blocked camera. */
  handError = '';
  layoutStore?: LayoutStore;
  layoutRevision = 0;
  readonly notices: string[] = [];
  private generation = 0;
  private listeners = new Set<() => void>();
  private revision = 0;
  private off: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private media = new Map<string, Publication>();
  private audio = new Map<string, number>();
  private busy = false;
  private awaitingRobot = false;
  private disposed = false;
  private adapterRevision = 0;
  private readonly discoverAdapters: boolean;

  constructor(
    readonly transport: Transport,
    private storage?: LayoutStorage,
    readonly clock: Clock = browserClock,
    adapters?: Map<string, ProfileAdapter>,
    public viewOnly = false,
  ) {
    this.discoverAdapters = !viewOnly && !adapters && !transport.fixture;
    this.streams = new StreamHub(transport, clock);
    this.controls = new ControlManager(
      transport,
      this.streams,
      viewOnly ? new Map() : (adapters ?? (transport.fixture ? fixtureAdapters() : new Map())),
      clock,
    );
    this.off = transport.onEvent((event) => {
      if (event === 'interrupted' || event === 'disconnected') {
        this.connection = event === 'interrupted' ? 'reconnecting' : 'disconnected';
        this.notices.push(
          event === 'interrupted'
            ? 'Connection interrupted. Motion is disarmed; rediscovery is required.'
            : 'Connection closed.',
        );
        this.invalidate(false);
        this.notify();
        return;
      }
      if (event === 'connected') {
        this.connection = 'connected';
        if (this.selected) void this.select(this.selected, true);
        else {
          const first = this.robots().find(compatibleRobot);
          if (first) void this.select(first.identity);
        }
      } else this.sync();
      this.notify();
    });
  }
  start() {
    if (!this.timer)
      this.timer = setInterval(() => {
        this.streams.tick();
        this.controls.tick();
        if (this.connection === 'connected' && this.config)
          this.cameras.tick(this.clock.now(), this.config.default_video_rate_hz);
        if (this.notices.length > 100) this.notices.splice(0, this.notices.length - 100);
        this.notify();
      }, 100);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private notifyTimer: ReturnType<typeof setTimeout> | undefined;
  notify = () => {
    if (this.disposed) return;
    // In a headset every listener rebuilds a large 3D scene on the same thread that draws it. Updates
    // that arrive many times a second would drop frames, so they are merged to at most 10 per second.
    if (this.xrActive) {
      this.notifyTimer ??= setTimeout(() => {
        this.notifyTimer = undefined;
        this.flush();
      }, 100);
      return;
    }
    this.flush();
  };
  private flush() {
    if (this.disposed) return;
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  robots() {
    return this.transport.participants().filter((p) => p.attributes['lk.portal.role'] === 'robot');
  }
  get layout() {
    return this.layoutStore?.layout;
  }
  get epoch() {
    return this.generation;
  }
  private stopMedia() {
    for (const pub of this.media.values()) this.transport.subscribeMedia(pub, false);
    this.media.clear();
    this.audio.clear();
    this.cameras.reset();
  }
  private invalidate(connected: boolean) {
    this.generation++;
    if (this.discoverAdapters) this.controls.adapters.clear();
    this.config = undefined;
    this.discovery = 'idle';
    this.controls.connected = connected;
    this.controls.configure(undefined, this.selected, false, this.generation);
    this.streams.configure([], false, this.generation, () => false);
    this.stopMedia();
  }

  async select(identity: string, force = false) {
    if (!force && this.selected === identity && this.discovery === 'ready') return;
    const generation = ++this.generation;
    this.awaitingRobot = false;
    this.busy = true;
    this.error = '';
    this.config = undefined;
    this.discovery = 'loading';
    const teardown = this.controls.release(); // Captures/releases the previous interface before rebinding.
    this.streams.configure([], false, generation, () => false);
    this.stopMedia();
    if (identity !== this.selected || !this.layoutStore) {
      this.layoutStore = new LayoutStore(identity, this.storage);
      this.layoutRevision++;
    }
    this.selected = identity;
    this.notify();
    await teardown;
    if (generation !== this.generation || this.disposed) return;
    this.controls.configure(undefined, identity, false, generation);
    if (this.discoverAdapters) this.controls.adapters.clear();
    this.transport.restrictCommands(identity);
    this.busy = false;
    const participant = this.robots().find((p) => p.identity === identity);
    if (this.connection !== 'connected' || !participant) {
      this.discovery = 'failed';
      this.error = 'Selected robot is unavailable.';
      this.awaitingRobot = true;
      this.notify();
      return;
    }
    if (!compatibleRobot(participant)) {
      this.discovery = 'failed';
      this.awaitingRobot = true;
      this.error = `Unsupported Portal version ${participant.attributes['lk.portal.version'] ?? '(missing)'}. Expected 3.`;
      this.notify();
      return;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      let payload: string;
      try {
        payload = await this.transport.rpc(identity, 'get_robot_config', '', 3000);
      } catch (error) {
        if (generation !== this.generation || this.disposed) return;
        if (attempt < 2) {
          await this.clock.delay(500);
          if (generation !== this.generation || this.disposed) return;
          continue;
        }
        this.error = `Discovery failed: ${errorMessage(error)}`;
        this.discovery = 'failed';
        this.notify();
        return;
      }
      if (generation !== this.generation || this.disposed) return;
      try {
        this.config = parseDiscovery(payload);
        if (this.discoverAdapters) {
          const simulated = discoveredSimulationAdapters(payload);
          const hardware = discoveredHardwareAdapters(payload);
          if (simulated.size && hardware.size)
            throw new Error('Declare either simulation_control or hardware_control, not both.');
          for (const [profile, adapter] of [...simulated, ...hardware])
            this.controls.adapters.set(profile, adapter);
        }
      } catch (error) {
        this.discovery = 'failed';
        this.error = `Invalid discovery: ${errorMessage(error)}`;
        this.notify();
        return;
      }
      this.discovery = 'ready';
      this.sync();
      for (const [id, equipment] of Object.entries(this.config.control_interfaces)) {
        if (generation !== this.generation || this.disposed) return;
        const channels = new Set([
          ...controlChannels(equipment),
          ...Object.keys(this.layout?.control_channel_preferences?.[id] ?? {}),
        ]);
        if (this.layout?.control_preferences[id]) channels.add('primary');
        for (const channel of channels) {
          if (generation !== this.generation || this.disposed) return;
          const saved =
            channel === 'primary'
              ? this.layout?.control_preferences[id]
              : this.layout?.control_channel_preferences?.[id]?.[channel];
          const operation =
            saved?.operation ??
            Object.keys(equipment.operations).find(
              (op) => (equipment.operations[op].control_channel ?? 'primary') === channel,
            );
          if (operation)
            await this.controls.select(
              controlKey(id, channel),
              operation,
              saved?.presentation ??
                operationPresentations(own(equipment.operations, operation))[0] ??
                'unsupported',
            );
        }
      }
      this.notify();
      return;
    }
  }

  sync() {
    if (this.disposed || this.busy) return;
    const participant = this.robots().find((p) => p.identity === this.selected);
    if (
      (this.config || this.discovery === 'loading') &&
      this.selected &&
      (!participant || !compatibleRobot(participant))
    ) {
      this.notices.push(
        'Selected robot left or changed protocol compatibility. Motion is disarmed.',
      );
      this.invalidate(this.connection === 'connected');
      this.discovery = 'failed';
      this.awaitingRobot = true;
      this.error = 'Selected robot is unavailable or incompatible.';
      this.notify();
      return;
    }
    if (
      !this.config &&
      this.selected &&
      participant &&
      compatibleRobot(participant) &&
      (this.discovery === 'idle' || this.awaitingRobot) &&
      this.connection === 'connected'
    ) {
      void this.select(this.selected, true);
      return;
    }
    const config = this.config;
    const enabled = !!config && this.discovery === 'ready' && this.connection === 'connected';
    const publications = this.transport.publications().filter((p) => p.robot === this.selected);
    this.streams.configure(
      publications,
      enabled,
      this.generation,
      (source) => !!config && isExcluded(config, source.kind, source.track_name),
      this.selected,
    );
    this.controls.configure(config, this.selected, enabled, this.generation);
    this.controls.observeOwner(participant?.attributes['lk.portal.active_operator'] ?? '');
    const wanted = new Map<string, Publication>();
    if (enabled)
      for (const pub of publications) {
        if (isExcluded(config, pub.kind, pub.name)) continue;
        if (pub.kind === 'video' || (pub.kind === 'audio' && (this.audio.get(pub.name) ?? 0) > 0))
          wanted.set(pub.id, pub);
      }
    for (const [id, pub] of this.media)
      if (!wanted.has(id)) {
        this.transport.subscribeMedia(pub, false);
        this.media.delete(id);
        if (pub.kind === 'video') this.cameras.remove(id);
      }
    for (const [id, pub] of wanted) {
      if (!this.media.has(id)) {
        this.transport.subscribeMedia(pub, true);
        this.media.set(id, pub);
        if (pub.kind === 'video') this.cameras.add(id, pub.name, this.clock.now());
      }
      if (pub.kind === 'video') {
        const camera = this.cameras.cameras.get(id);
        if (camera && pub.error) camera.error = pub.error;
      }
    }
  }
  catalog(): CatalogEntry[] {
    const publications = this.transport.publications().filter((pub) => pub.robot === this.selected);
    const entries = new Map(
      publications.map((pub) => [
        endpointKey(pub.kind, pub.name),
        {
          ...pub,
          available: true,
          excluded: !!this.config && isExcluded(this.config, pub.kind, pub.name),
        },
      ]),
    );
    const expected: { kind: Publication['kind']; name: string }[] = Object.values(
      this.layout?.panels ?? {},
    ).flatMap((p) => [
      { kind: p.source.kind, name: p.source.track_name },
      ...(p.series ?? []).map((s) => ({
        kind: 'data' as const,
        name: s.track_name,
      })),
    ]);
    for (const equipment of Object.values(this.config?.control_interfaces ?? {}))
      for (const op of Object.values(equipment.operations))
        for (const name of op.feedback_tracks) expected.push({ kind: 'data', name });
    for (const { kind, name } of expected) {
      const key = endpointKey(kind, name);
      if (!entries.has(key))
        entries.set(key, {
          id: `missing:${key}`,
          robot: this.selected,
          name,
          kind,
          available: false,
          excluded: !!this.config && isExcluded(this.config, kind, name),
        });
    }
    return [...entries.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
    );
  }
  mediaPublications() {
    return [...this.media.values()].filter((p) => p.kind === 'video');
  }
  listen(name: string) {
    const epoch = this.generation;
    this.audio.set(name, (this.audio.get(name) ?? 0) + 1);
    this.sync();
    this.notify();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (epoch !== this.generation) return;
      this.audio.set(name, Math.max(0, (this.audio.get(name) ?? 0) - 1));
      this.sync();
      this.notify();
    };
  }
  editLayout(layout: Layout, replacePlacement = false) {
    this.layoutStore?.update(layout);
    if (replacePlacement) this.layoutRevision++;
    this.sync();
    this.notify();
  }
  async importLayout(text: string) {
    if (!this.layoutStore) throw new Error('Select a robot before importing.');
    // Validation happens before ending controls or replacing any working state.
    const store = this.layoutStore;
    const generation = this.generation;
    const { parseLayout } = await import('./layout');
    if (generation !== this.generation || store !== this.layoutStore)
      throw new Error('Robot selection changed during import. Try importing again.');
    const next = parseLayout(text, this.selected);
    await this.controls.stopAll();
    if (generation !== this.generation || store !== this.layoutStore)
      throw new Error('Robot selection changed during import. Try importing again.');
    store.update(next);
    this.layoutRevision++;
    for (const [id, pref] of Object.entries(next.control_preferences)) {
      if (generation !== this.generation) return;
      await this.controls.select(id, pref.operation, pref.presentation);
    }
    for (const [id, channels] of Object.entries(next.control_channel_preferences ?? {}))
      for (const [channel, pref] of Object.entries(channels)) {
        if (generation !== this.generation) return;
        await this.controls.select(controlKey(id, channel), pref.operation, pref.presentation);
      }
    this.sync();
    this.notify();
  }
  async resetLayout() {
    await this.controls.stopAll();
    this.layoutStore?.reset();
    this.layoutRevision++;
    this.sync();
    this.notify();
  }
  async dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    this.off();
    await this.controls.release();
    this.controls.dispose();
    this.streams.dispose();
    this.stopMedia();
    await this.transport.disconnect();
    this.listeners.clear();
  }

  async setControlAdapters(adapters?: Map<string, ProfileAdapter>) {
    const revision = ++this.adapterRevision;
    await this.controls.stopAll();
    if (revision !== this.adapterRevision || this.disposed) return;
    this.controls.requested = false;
    this.controls.replaceAdapters(adapters);
    this.viewOnly = !adapters;
    this.notify();
  }
}
