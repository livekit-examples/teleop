import { monitoringPolicy } from './streams';
import type { Status } from './types';

type Camera = {
  id: string;
  name: string;
  started: number;
  at?: number;
  frames: number[];
  ready: boolean;
  error?: string;
  presentedAt?: number;
  previous?: Status;
  outage?: number;
};
/** Selection follows usable frames, never publication order. Pending tiles are separate. */
export class CameraDeck {
  readonly cameras = new Map<string, Camera>();
  main?: string;
  tiles: string[] = [];
  notice = '';
  readonly incidents: { at: number; input: string; transition: 'stale' | 'recovered'; duration?: number }[] = [];

  add(id: string, name: string, now: number) {
    if (!this.cameras.has(id))
      this.cameras.set(id, { id, name, started: now, ready: false, frames: [] });
  }
  frame(id: string, now: number, count = 1) {
    const camera = this.cameras.get(id);
    if (!camera) return;
    camera.at = now;
    camera.error = undefined;
    for (let i = 0; i < Math.min(1000, count); i++) camera.frames.push(now);
    if (camera.frames.length > 1000) camera.frames.splice(0, camera.frames.length - 1000);
    if (!camera.ready) {
      camera.ready = true;
      if (!this.main) this.main = id;
      else this.tiles.push(id);
    }
  }
  select(id: string) {
    const i = this.tiles.indexOf(id);
    if (i < 0 || !this.main) return;
    [this.main, this.tiles[i]] = [this.tiles[i], this.main];
  }
  remove(id: string) {
    const camera = this.cameras.get(id);
    this.cameras.delete(id);
    this.tiles = this.tiles.filter((key) => key !== id);
    if (this.main === id) {
      this.main = this.tiles.shift();
      this.notice = `${camera?.name ?? 'Main camera'} became unavailable.${this.main ? ` Showing ${this.cameras.get(this.main)?.name}.` : ''}`;
    }
  }
  reset() {
    this.cameras.clear();
    this.main = undefined;
    this.tiles = [];
    this.notice = '';
  }
  pending() {
    return [...this.cameras.values()].filter((camera) => !camera.ready).map((camera) => camera.id);
  }
  status(id: string, now: number, rate: number): Status {
    const c = this.cameras.get(id);
    if (!c) return 'unavailable';
    if (c.error) return 'invalid';
    if (now - c.started < monitoringPolicy.grace(rate)) return c.ready ? 'healthy' : 'starting';
    return c.at === undefined || now - c.at > monitoringPolicy.stale(rate) ? 'stale' : 'healthy';
  }
  observedRate(id: string, now: number, rate: number) {
    const times =
      this.cameras.get(id)?.frames.filter((t) => t >= now - monitoringPolicy.window(rate)) ?? [];
    return times.length < 2 ? 0 : ((times.length - 1) * 1000) / Math.max(1, now - times[0]);
  }
  presented(id: string, now: number) { const camera = this.cameras.get(id); if (camera) camera.presentedAt = now; }
  tick(now: number, rate: number) {
    for (const c of this.cameras.values()) {
      const status = this.status(c.id, now, rate);
      if (status === 'stale' && c.previous !== 'stale') { c.outage = c.at ?? c.started; this.incidents.push({ at: now, input: c.name, transition: 'stale' }); }
      else if (status === 'healthy' && c.outage !== undefined) { this.incidents.push({ at: now, input: c.name, transition: 'recovered', duration: now - c.outage }); c.outage = undefined; }
      c.previous = status;
    }
    if (this.incidents.length > 100) this.incidents.splice(0, this.incidents.length - 100);
  }
}
