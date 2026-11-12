'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionQuality, Room, RoomEvent, type RemoteParticipant } from 'livekit-client';
import {
  parseRobot,
  ROLE_KEY,
  type ConnectionState,
  type FleetRobot,
  type LiveStatus,
} from './attributes';
import { lookupCity } from './places';

type Seen = {
  identity: string;
  name?: string;
  attributes: Record<string, string>;
  connection: ConnectionState;
  since: number;
  live?: LiveStatus;
};

export type FleetState = {
  mode: 'live' | 'fixture';
  status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  error: string;
  room: string;
  /** This browser's identity in the room: the current operator. */
  identity: string;
  robots: FleetRobot[];
  /** Other participants in the room that aren't robots (operators, observers). */
  others: number;
  retry(): void;
};

const isRobot = (attributes: Record<string, string>) => attributes[ROLE_KEY] === 'robot';

function liveOf(p: RemoteParticipant): LiveStatus {
  const tracks: LiveStatus['tracks'] = [];
  for (const pub of p.trackPublications.values())
    tracks.push({ kind: pub.kind === 'audio' ? 'audio' : 'video', name: pub.trackName });
  for (const track of p.dataTracks.values()) tracks.push({ kind: 'data', name: track.info.name });
  return { quality: (p.connectionQuality as LiveStatus['quality']) ?? 'unknown', tracks };
}

function connectionOf(p: RemoteParticipant): ConnectionState {
  return p.connectionQuality === ConnectionQuality.Lost ? 'stale' : 'connected';
}

function toRobots(seen: Map<string, Seen>): FleetRobot[] {
  return [...seen.values()]
    .map((s) => ({
      ...parseRobot(s.identity, s.name, s.attributes, s.connection, lookupCity),
      since: s.since,
      live: s.live,
    }))
    // Stable order: rows don't jump when a robot's state changes.
    .sort((a, b) => a.name.localeCompare(b.name) || a.identity.localeCompare(b.identity));
}

const ARM_TRACKS: LiveStatus['tracks'] = [
  { kind: 'video', name: 'cam_high' },
  { kind: 'video', name: 'cam_wrist' },
  { kind: 'data', name: '/joint_states' },
  { kind: 'data', name: '/gripper' },
];
const CAR_TRACKS: LiveStatus['tracks'] = [
  { kind: 'video', name: 'front' },
  { kind: 'data', name: '/odom' },
  { kind: 'data', name: '/scan' },
  { kind: 'data', name: '/drive' },
];
const FIXTURE_TRACKS: Record<string, LiveStatus['tracks']> = {
  'trossen-wxai-01': [...ARM_TRACKS, { kind: 'audio', name: 'microphone' }],
  'trossen-workbench-02': [...ARM_TRACKS, { kind: 'video', name: 'cam_left' }],
  'carla-sim-eu': CAR_TRACKS,
  'f1tenth-tokyo': CAR_TRACKS,
  'trossen-wxai-london': ARM_TRACKS.slice(0, 1),
};

export function useFleet(): FleetState {
  const [mode, setMode] = useState<'live' | 'fixture' | undefined>(undefined);
  const [status, setStatus] = useState<FleetState['status']>('connecting');
  const [error, setError] = useState('');
  const [room, setRoom] = useState('');
  const [identity, setIdentity] = useState('');
  const [robots, setRobots] = useState<FleetRobot[]>([]);
  const [others, setOthers] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const seen = useRef(new Map<string, Seen>());

  useEffect(() => {
    setMode(new URLSearchParams(window.location.search).get('fixture') === '1' ? 'fixture' : 'live');
  }, []);

  // Live room.
  useEffect(() => {
    if (mode !== 'live') return;
    let cancelled = false;
    const lkRoom = new Room({ adaptiveStream: false, dynacast: false });
    const map = seen.current;
    const sync = () => {
      if (cancelled) return;
      const present = new Set<string>();
      let nonRobots = 0;
      for (const p of lkRoom.remoteParticipants.values()) {
        if (!isRobot(p.attributes)) {
          nonRobots += 1;
          continue;
        }
        present.add(p.identity);
        const previous = map.get(p.identity);
        const connection = connectionOf(p);
        map.set(p.identity, {
          identity: p.identity,
          name: p.name,
          attributes: { ...p.attributes },
          connection,
          since: previous?.connection === connection ? previous.since : Date.now(),
          live: liveOf(p),
        });
      }
      // Robots seen earlier in this session that left the room are offline.
      for (const [id, s] of map)
        if (!present.has(id) && s.connection !== 'offline')
          map.set(id, { ...s, connection: 'offline', since: Date.now(), live: undefined });
      setOthers(nonRobots);
      setRobots(toRobots(map));
    };
    for (const event of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.ConnectionQualityChanged,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.DataTrackPublished,
      RoomEvent.DataTrackUnpublished,
    ])
      lkRoom.on(event, sync);
    lkRoom.on(RoomEvent.Reconnecting, () => setStatus('reconnecting'));
    lkRoom.on(RoomEvent.Reconnected, () => {
      setStatus('connected');
      sync();
    });
    lkRoom.on(RoomEvent.Disconnected, () => {
      if (cancelled) return;
      setStatus('disconnected');
      // Without a room we can't vouch for anyone.
      for (const [id, s] of map)
        if (s.connection !== 'offline') map.set(id, { ...s, connection: 'offline', since: Date.now(), live: undefined });
      setRobots(toRobots(map));
    });
    (async () => {
      setStatus('connecting');
      setError('');
      try {
        const response = await fetch('/api/credentials', { cache: 'no-store' });
        if (!response.ok)
          throw new Error(
            `Could not get connection credentials (HTTP ${response.status}). Check the server's LiveKit settings.`,
          );
        const credentials = await response.json();
        if (cancelled) return;
        await lkRoom.connect(credentials.server_url, credentials.token, { autoSubscribe: false });
        if (cancelled) return;
        await lkRoom.localParticipant
          .setAttributes({
            'lk.portal.role': 'observer',
            'lk.portal.version': '3',
          })
          .catch(() => {});
        setRoom(lkRoom.name);
        setIdentity(lkRoom.localParticipant.identity);
        setStatus('connected');
        sync();
      } catch (problem) {
        if (cancelled) return;
        setStatus('disconnected');
        setError(problem instanceof Error ? problem.message : String(problem));
      }
    })();
    return () => {
      cancelled = true;
      void lkRoom.disconnect();
    };
  }, [mode, attempt]);

  // Fixture fleet: no server needed. Shows every state, including missing attributes.
  useEffect(() => {
    if (mode !== 'fixture') return;
    const map = seen.current;
    const now = Date.now();
    const add = (identity: string, name: string | undefined, attributes: Record<string, string>, connection: ConnectionState) =>
      map.set(identity, {
        identity,
        name,
        attributes: { [ROLE_KEY]: 'robot', 'lk.portal.version': '3', ...attributes },
        connection,
        since: now - Math.round(Math.random() * 3_600_000),
        live:
          connection === 'offline'
            ? undefined
            : {
                quality: connection === 'stale' ? 'lost' : identity.includes('london') ? 'poor' : 'excellent',
                tracks: FIXTURE_TRACKS[identity] ?? [],
              },
      });
    add('trossen-wxai-01', 'WidowX AI · bench 1', {
      'lk.fleet.city': 'Denver',
      'lk.fleet.country': 'US',
      'lk.fleet.lat': '39.7392',
      'lk.fleet.lng': '-104.9903',
      'lk.fleet.model': 'trossen-arm',
      'lk.fleet.control': 'teleop',
      'lk.portal.active_operator': 'controller-curie',
    }, 'connected');
    add('trossen-workbench-02', 'Stationary AI workbench', {
      'lk.fleet.city': 'San Francisco',
      'lk.fleet.country': 'US',
      'lk.fleet.model': 'trossen-workbench',
      'lk.fleet.control': 'autonomous',
    }, 'connected');
    add('carla-sim-eu', 'CARLA town 10', {
      'lk.fleet.city': 'Munich',
      'lk.fleet.country': 'DE',
      'lk.fleet.lat': '48.137',
      'lk.fleet.lng': '11.575',
      'lk.fleet.model': 'carla-sim',
      'lk.fleet.control': 'standby',
    }, 'connected');
    add('f1tenth-tokyo', 'F1TENTH Spielberg', {
      'lk.fleet.city': 'Tokyo',
      'lk.fleet.country': 'JP',
      'lk.fleet.model': 'f1tenth-sim',
      'lk.fleet.control': 'autonomous',
    }, 'stale');
    add('rover-sydney', 'Yard rover', {
      'lk.fleet.city': 'Sydney',
      'lk.fleet.country': 'AU',
      'lk.fleet.lat': '-33.8688',
      'lk.fleet.lng': '151.2093',
      'lk.fleet.model': 'rover',
    }, 'offline');
    add('trossen-wxai-london', undefined, {
      'lk.fleet.city': 'London',
      'lk.fleet.control': 'driving',
    }, 'connected');
    add('legacy-arm-7', undefined, {}, 'connected');
    setRoom('fixture-fleet');
    setIdentity('controller-fixture');
    setStatus('connected');
    setOthers(2);
    setRobots(toRobots(map));
    // Cycle the Tokyo car between stale and connected so state changes are visible.
    const timer = setInterval(() => {
      const s = map.get('f1tenth-tokyo');
      if (!s) return;
      map.set(s.identity, {
        ...s,
        connection: s.connection === 'stale' ? 'connected' : 'stale',
        since: Date.now(),
        live: s.live && { ...s.live, quality: s.connection === 'stale' ? 'good' : 'lost' },
      });
      setRobots(toRobots(map));
    }, 8000);
    return () => clearInterval(timer);
  }, [mode]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    mode: mode ?? 'live',
    status,
    error,
    room,
    identity,
    robots,
    others,
    retry,
  };
}
