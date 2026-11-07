import {
  browserClock,
  endpointKey,
  errorMessage,
  type Clock,
  type Publication,
  type Source,
  type Status,
  type Transport,
} from './types';

export const monitoringPolicy = {
  grace: (rate: number) => Math.max(3000, (5 * 1000) / rate),
  stale: (rate: number) => Math.max(1000, (5 * 1000) / rate),
  window: (rate?: number) => Math.max(5000, (10 * 1000) / (rate ?? 10)),
};
export type ConsumerSpec = {
  robot?: string;
  cacheKey?: string;
  source: Source;
  rate?: number;
  select: (value: unknown) => unknown;
  windowSeconds?: number;
};
export type Sample = { t: number; value: unknown };
type Consumer = ConsumerSpec & {
  epoch: number;
  started: number;
  at?: number;
  value?: unknown;
  invalid?: string;
  samples: Sample[];
  previous?: Status;
  outage?: number;
  displayAt?: number;
  displays: number;
};
type Stream = {
  publication: Publication;
  abort: AbortController;
  arrivals: number[];
  decoded: number;
  error?: string;
};
export type StreamView = {
  status: Status;
  reason?: string;
  value?: unknown;
  at?: number;
  samples: Sample[];
  arrivals: number;
  decoded: number;
  observedRate: number;
  consumers: number;
  displays: number;
  displayAt?: number;
};
export type Incident = {
  at: number;
  input: string;
  transition: 'stale' | 'recovered';
  duration?: number;
};

/** One reader/decoder per publication. Selectors and usable-sample ages belong to consumers. */
export class StreamHub {
  private consumers = new Map<string, Consumer>();
  private retained = new Map<string, { value?: unknown; samples: Sample[]; signature: string; epoch: number }>();
  private streams = new Map<string, Stream>();
  private catalog = new Map<string, Publication>();
  private enabled = false;
  private generation = 0;
  private robot?: string;
  private excluded: (source: Source) => boolean = () => false;
  readonly incidents: Incident[] = [];

  constructor(
    private transport: Transport,
    private clock: Clock = browserClock,
  ) {}

  configure(
    publications: Publication[],
    enabled: boolean,
    generation: number,
    excluded: (source: Source) => boolean,
    robot?: string,
  ) {
    if (generation !== this.generation || enabled !== this.enabled) {
      for (const stream of this.streams.values()) stream.abort.abort();
      this.streams.clear();
      this.retained.clear();
      for (const consumer of this.consumers.values()) {
        consumer.started = this.clock.now();
        consumer.at = undefined;
        consumer.invalid = undefined;
        consumer.previous = undefined;
        consumer.outage = undefined;
        consumer.samples = [];
      }
    }
    this.generation = generation;
    this.robot = robot;
    this.enabled = enabled;
    this.excluded = excluded;
    this.catalog = new Map(
      publications.filter((p) => p.kind === 'data').map((p) => [endpointKey(p.kind, p.name), p]),
    );
    this.reconcile();
  }

  acquire(id: string, spec: ConsumerSpec): () => void {
    if (this.consumers.has(id)) throw new Error(`Consumer ${id} is already registered.`);
    if (
      spec.rate !== undefined &&
      (typeof spec.rate !== 'number' || !Number.isFinite(spec.rate) || spec.rate <= 0)
    )
      throw new Error('Expected rate must be positive and finite.');
    const signature = JSON.stringify([spec.robot, spec.source, spec.cacheKey]);
    const saved = this.retained.get(id);
    const cached = saved?.signature === signature && saved.epoch === this.generation ? saved : undefined;
    const consumer: Consumer = {
      ...spec,
      epoch: this.generation,
      started: this.clock.now(),
      samples: cached?.samples ?? [],
      value: cached?.value,
      displays: 0,
    };
    this.consumers.set(id, consumer);
    this.reconcile();
    return () => {
      if (this.consumers.get(id) === consumer) {
        this.retained.set(id, { value: consumer.value, samples: consumer.samples, signature, epoch: consumer.epoch });
        if (this.retained.size > 100) this.retained.delete(this.retained.keys().next().value!);
        this.consumers.delete(id);
        this.reconcile();
      }
    };
  }

  private unsupported(c: Consumer, pub?: Publication) {
    if (!pub) return;
    if (c.source.expected_msg_type && pub.msgType !== c.source.expected_msg_type)
      return `Saved type ${c.source.expected_msg_type} is incompatible with ${pub.msgType ?? 'an untyped publication'}.`;
    if (pub.encoding !== 'json')
      return `Unsupported encoding: ${pub.encoding ?? 'no frame encoding metadata'}. Explicit JSON is required.`;
  }

  private reconcile() {
    const wanted = new Map<string, Publication>();
    if (this.enabled)
      for (const c of this.consumers.values()) {
        if (c.robot && c.robot !== this.robot) continue;
        const key = endpointKey('data', c.source.track_name);
        const pub = this.catalog.get(key);
        if (pub && !this.excluded(c.source) && !this.unsupported(c, pub)) wanted.set(key, pub);
      }
    for (const [key, entry] of this.streams) {
      if (wanted.get(key)?.id !== entry.publication.id) {
        entry.abort.abort();
        this.streams.delete(key);
        for (const c of this.consumers.values())
          if (endpointKey('data', c.source.track_name) === key) {
            c.at = undefined;
            c.invalid = undefined;
          }
      }
    }
    for (const [key, publication] of wanted) {
      if (this.streams.has(key)) continue;
      const stream: Stream = {
        publication,
        abort: new AbortController(),
        arrivals: [],
        decoded: 0,
      };
      this.streams.set(key, stream);
      void this.read(key, stream, this.generation);
    }
  }

  private async read(key: string, stream: Stream, generation: number) {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for await (const bytes of this.transport.read(stream.publication, stream.abort.signal)) {
        if (
          stream.abort.signal.aborted ||
          this.generation !== generation ||
          this.streams.get(key) !== stream
        )
          return;
        const now = this.clock.now();
        stream.arrivals.push(now);
        if (stream.arrivals.length > 10_000) stream.arrivals.shift();
        let value: unknown;
        try {
          value = JSON.parse(decoder.decode(bytes));
          stream.decoded++;
          stream.error = undefined;
        } catch (error) {
          stream.error = `Invalid JSON frame: ${errorMessage(error)}`;
          continue;
        }
        for (const c of this.consumers.values()) {
          if (
            endpointKey('data', c.source.track_name) !== key ||
            (c.robot !== undefined && c.robot !== stream.publication.robot) ||
            this.excluded(c.source) ||
            this.unsupported(c, stream.publication)
          )
            continue;
          try {
            const selected = c.select(value);
            c.value = selected;
            c.epoch = this.generation;
            c.at = now;
            c.invalid = undefined;
            c.samples.push({ t: now, value: selected });
            const cutoff = now - (c.windowSeconds ?? 30) * 1000;
            while (c.samples.length > 5000 || (c.samples.length > 1 && c.samples[0].t < cutoff))
              c.samples.shift();
          } catch (error) {
            c.invalid = errorMessage(error);
          }
        }
      }
      if (!stream.abort.signal.aborted && this.streams.get(key) === stream)
        stream.error = 'Data subscription ended. Check the publisher and subscription permissions.';
    } catch (error) {
      if (!stream.abort.signal.aborted && this.streams.get(key) === stream)
        stream.error = `Data subscription failed: ${errorMessage(error)}`;
    }
  }

  view(id: string): StreamView {
    const c = this.consumers.get(id);
    if (!c)
      return {
        status: 'not_requested',
        samples: [],
        arrivals: 0,
        decoded: 0,
        observedRate: 0,
        consumers: 0,
        displays: 0,
      };
    const key = endpointKey('data', c.source.track_name);
    const pub = this.catalog.get(key);
    const stream = this.streams.get(key);
    const now = this.clock.now();
    const window = monitoringPolicy.window(c.rate);
    const times = stream?.arrivals.filter((t) => t > now - window) ?? [];
    const observedRate =
      times.length < 2 ? 0 : ((times.length - 1) * 1000) / Math.max(1, now - times[0]);
    const base = {
      value: c.value,
      at: c.at,
      samples: c.samples,
      arrivals: stream?.arrivals.length ?? 0,
      decoded: stream?.decoded ?? 0,
      observedRate,
      consumers: [...this.consumers.values()].filter(
        (other) => endpointKey('data', other.source.track_name) === key,
      ).length,
      displays: c.displays,
      displayAt: c.displayAt,
    };
    const result = (status: Status, reason?: string): StreamView => ({ ...base, status, reason });
    if (c.robot && c.robot !== this.robot) return { ...result('unavailable', 'Bound to another robot; awaiting its selected session.'), value: undefined, samples: [], at: undefined };
    if (this.excluded(c.source))
      return result('excluded', 'Blocked by the selected robot’s current data exclusions.');
    if (!this.enabled)
      return result('unavailable', 'Waiting for a connected robot with valid discovery.');
    const unsupported = this.unsupported(c, pub);
    if (unsupported) return result('unsupported', unsupported);
    if (stream?.error || c.invalid) return result('invalid', stream?.error ?? c.invalid);
    if (c.rate === undefined)
      return pub
        ? result('unmonitored', 'No expected rate configured; missing samples are not monitored.')
        : result('unavailable', 'This exact publication is absent.');
    if (now - c.started < monitoringPolicy.grace(c.rate))
      return result(c.at === undefined ? 'starting' : 'healthy');
    if (c.at === undefined || now - c.at > monitoringPolicy.stale(c.rate))
      return result(
        'stale',
        pub
          ? 'No usable selected sample before the deadline.'
          : 'The expected publication is absent.',
      );
    return result('healthy');
  }

  tick() {
    if (!this.enabled) return;
    for (const [id, c] of this.consumers) {
      const { status } = this.view(id);
      const now = this.clock.now();
      if (status === 'stale' && c.previous !== 'stale') {
        c.outage = c.at === undefined ? c.started : c.at;
        this.incidents.push({ at: now, input: c.source.track_name, transition: 'stale' });
      } else if (status === 'healthy' && c.outage !== undefined) {
        this.incidents.push({
          at: now,
          input: c.source.track_name,
          transition: 'recovered',
          duration: now - c.outage,
        });
        c.outage = undefined;
      }
      c.previous = status;
    }
    if (this.incidents.length > 100) this.incidents.splice(0, this.incidents.length - 100);
  }
  display(id: string, sampleAt: number) {
    const c = this.consumers.get(id);
    if (c && c.displayAt !== sampleAt) {
      c.displayAt = sampleAt;
      c.displays++;
    }
  }
  dispose() {
    this.configure([], false, this.generation + 1, () => false);
    this.consumers.clear();
    this.retained.clear();
  }
}
