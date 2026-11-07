import {
  Room,
  RoomEvent,
  Track,
  TrackPublication,
  type RemoteTrackPublication,
} from 'livekit-client';
import {
  errorMessage,
  type CommandWriter,
  type Operation,
  type Participant,
  type Publication,
  type Transport,
  type TransportEvent,
} from './types';

/** Keep SDK-specific objects out of catalog, stream and control state machines. */
export class LiveKitTransport implements Transport {
  readonly fixture = false;
  // Automatic videos must keep decoding even when docked tabs/tiles are offscreen.
  readonly room = new Room({ adaptiveStream: false, dynacast: false });
  private listeners = new Set<(event: TransportEvent) => void>();
  private errors = new Map<string, string>();
  constructor(readonly role: 'operator' | 'observer' = 'operator') {
    for (const event of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.DataTrackPublished,
      RoomEvent.DataTrackUnpublished,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackSubscriptionPermissionChanged,
    ]) {
      this.room.on(event, () => this.emit('changed'));
    }
    this.room.on(RoomEvent.TrackSubscriptionFailed, (sid, _participant, error) => {
      this.errors.set(sid, `Subscription failed: ${errorMessage(error)}`);
      this.emit('changed');
    });
    this.room.on(RoomEvent.TrackSubscribed, (_track, publication) => {
      this.errors.delete(publication.trackSid);
      this.emit('changed');
    });
    this.room.on(RoomEvent.Reconnected, () => {
      this.errors.clear();
      this.emit('connected');
    });
    this.room.on(RoomEvent.Reconnecting, () => this.emit('interrupted'));
    this.room.on(RoomEvent.SignalReconnecting, () => this.emit('interrupted'));
    this.room.on(RoomEvent.Disconnected, () => this.emit('disconnected'));
  }
  get identity() {
    return this.room.localParticipant.identity;
  }
  async connect(url: string, token: string) {
    await this.room.connect(url, token, { autoSubscribe: false });
    await this.room.localParticipant.setAttributes({
      'lk.portal.role': this.role,
      'lk.portal.version': '3',
    });
    this.emit('connected');
  }
  private emit(event: TransportEvent) {
    for (const listener of this.listeners) listener(event);
  }
  onEvent(listener: (event: TransportEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  participants(): Participant[] {
    return [...this.room.remoteParticipants.values()].map((p) => ({
      identity: p.identity,
      name: p.name,
      attributes: { ...p.attributes },
    }));
  }
  publications(): Publication[] {
    return [...this.room.remoteParticipants.values()].flatMap((p) => [
      ...[...p.dataTracks.values()].map(
        (track): Publication => ({
          id: track.info.sid,
          robot: p.identity,
          kind: 'data',
          name: track.info.name,
          msgType: track.info.schema?.name,
          encoding:
            typeof track.info.frameEncoding === 'string'
              ? track.info.frameEncoding
              : track.info.frameEncoding?.custom,
        }),
      ),
      ...[...p.trackPublications.values()].map(
        (pub): Publication => ({
          id: pub.trackSid,
          robot: p.identity,
          kind: pub.kind === Track.Kind.Audio ? 'audio' : 'video',
          name: pub.trackName,
          encoding: pub.mimeType,
          error:
            this.errors.get(pub.trackSid) ??
            (pub.permissionStatus === TrackPublication.PermissionStatus.NotAllowed
              ? 'Subscription permission denied by publisher.'
              : undefined),
        }),
      ),
    ]);
  }
  private performRpc(robot: string, method: string, payload: string, timeout: number) {
    return this.room.localParticipant.performRpc({
      destinationIdentity: robot,
      method,
      payload,
      responseTimeout: timeout,
    });
  }
  async *read(publication: Publication, signal: AbortSignal) {
    const track = this.room.remoteParticipants
      .get(publication.robot)
      ?.dataTracks.get(publication.name);
    if (!track || track.info.sid !== publication.id) throw new Error('Data publication is no longer available.');
    const reader = track.subscribe({ signal, bufferSize: 32 }).getReader();
    try {
      while (!signal.aborted) {
        const result = await reader.read();
        if (result.done) break;
        yield result.value.payload;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  private media(pub: Publication): RemoteTrackPublication | undefined {
    return this.room.remoteParticipants.get(pub.robot)?.trackPublications.get(pub.id);
  }
  subscribeMedia(pub: Publication, enabled: boolean) {
    const p = this.media(pub);
    if (p && p.isDesired !== enabled) p.setSubscribed(enabled);
  }
  attach(pub: Publication, element: HTMLMediaElement) {
    let detach: (() => void) | undefined;
    let attached: unknown;
    const attach = () => {
      const track = this.media(pub)?.track;
      if (track === attached) return;
      detach?.();
      detach = undefined;
      attached = track;
      if (!track) return;
      track.attach(element);
      detach = () => {
        track.detach(element);
      };
    };
    attach();
    this.room.on(RoomEvent.TrackSubscribed, attach);
    this.room.on(RoomEvent.TrackUnsubscribed, attach);
    return () => {
      this.room.off(RoomEvent.TrackSubscribed, attach);
      this.room.off(RoomEvent.TrackUnsubscribed, attach);
      detach?.();
    };
  }
  restrictCommands(robot: string) {
    this.room.localParticipant.setTrackSubscriptionPermissions(
      false,
      robot ? [{ participantIdentity: robot, allowAll: true }] : [],
    );
  }
  async publish(operation: Operation): Promise<CommandWriter> {
    if (this.role === 'observer') throw new Error('Preview cannot publish commands.');
    const track = await this.room.localParticipant.publishDataTrack({
      name: operation.command.track_name,
      schema: { name: operation.command.msg_type, encoding: 'jsonSchema' },
      frameEncoding: 'json',
    });
    return {
      push: (value) => {
        track.tryPush({ payload: new TextEncoder().encode(JSON.stringify(value)) });
      },
      flush: () => track.flush(),
      close: () => track.unpublish(),
    };
  }
  async rpc(identity: string, method: string, payload: string, timeout: number): Promise<string> {
    if (this.role === 'observer' && method !== 'get_robot_config')
      throw new Error('Preview cannot request control.');
    return this.performRpc(identity, method, payload, timeout);
  }
  async disconnect() {
    await this.room.disconnect();
  }
}
