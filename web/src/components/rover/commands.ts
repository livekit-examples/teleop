'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import type { LocalParticipant } from 'livekit-client';
import type { Mode } from '@/lib/types';

/**
 * Everything the HUD sends to the rover: drive/pan-tilt commands on local data
 * tracks, and the two RPCs (`acquire_control`, `ros2_service_call`).
 *
 * The schema names below are a WIRE CONTRACT: the rover's ROS bridge uses them
 * to pick the message type it instantiates. They need a livekit-client build
 * with data-track schema metadata (the `ladvoc/schema-metadata` branch).
 * Published releases ignore the extra publish options, so the types are
 * declared locally and the build still succeeds against them.
 */

type LocalDataTrack = Awaited<ReturnType<LocalParticipant['publishDataTrack']>>;
type DataTrackOptions = Parameters<LocalParticipant['publishDataTrack']>[0];

/** Mirrors `DataTrackSchemaId` / `DataTrackFrameEncoding` from the schema-metadata SDK. */
type SchemaDataTrackOptions = DataTrackOptions & {
  schema: { name: string; encoding: 'jsonSchema' };
  frameEncoding: 'json';
};

/** Max commanded wheel velocity magnitude, rev/s. */
export const MAX_CONTROL_RPS = 2;
/** Matches the standalone pan/tilt teleop controller. */
export const MAX_PAN_TILT_RAD_PER_SEC = 1.4;

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));

/** `/<robot>/cmd_vel` — the drive topic is namespaced under the rover's name. */
export function driveTopicFor(robotName: string, topic: string): string {
  const namespace = robotName.replace(/^\/+|\/+$/g, '');
  const command = topic.replace(/^\/+/, '');
  return namespace ? `/${namespace}/${command}` : `/${command}`;
}

/** geometry_msgs/msg/Twist: throttle → linear.x, steering → angular.z. */
function twistJson(linearX: number, angularZ: number): string {
  return JSON.stringify({
    angular: { x: 0, y: 0, z: clamp(angularZ, MAX_CONTROL_RPS) },
    linear: { x: clamp(linearX, MAX_CONTROL_RPS), y: 0, z: 0 },
  });
}

/** Which camera-head joints the selected rover actually published. */
export type PanTiltAxes = { pan: boolean; tilt: boolean };

/** sensor_msgs/msg/JointState carrying pan/tilt velocities. Names only the
 *  joints the rover advertised, so a pan-only (or tilt-only) head is not sent
 *  a command for a motor it does not have. */
function panTiltJson(panVelocity: number, tiltVelocity: number, axes: PanTiltAxes): string {
  const name: string[] = [];
  const velocity: number[] = [];
  if (axes.pan) {
    name.push('pan_joint');
    velocity.push(clamp(panVelocity, MAX_PAN_TILT_RAD_PER_SEC));
  }
  if (axes.tilt) {
    name.push('tilt_joint');
    velocity.push(clamp(tiltVelocity, MAX_PAN_TILT_RAD_PER_SEC));
  }
  return JSON.stringify({
    header: { stamp: { sec: 0, nanosec: 0 }, frame_id: '' },
    name,
    position: [],
    velocity,
    effort: [],
  });
}

/**
 * Publish a command data track while `enabled`, and return a push function.
 * On teardown a zero frame is flushed first, so releasing the controls always
 * stops the rover rather than leaving the last command standing.
 */
function useCommandTrack(
  enabled: boolean,
  topic: string,
  schemaName: string,
  encode: (a: number, b: number) => string,
) {
  const { localParticipant } = useLocalParticipant();
  const trackRef = useRef<LocalDataTrack | null>(null);
  const encodeRef = useRef(encode);
  encodeRef.current = encode;

  const push = useCallback((a: number, b: number) => {
    const track = trackRef.current;
    if (!track?.isPublished()) return Promise.resolve();
    return track.tryPush({ payload: new TextEncoder().encode(encodeRef.current(a, b)) });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const options: SchemaDataTrackOptions = {
      name: topic,
      schema: { name: schemaName, encoding: 'jsonSchema' },
      frameEncoding: 'json',
    };

    void (async () => {
      try {
        const track = await localParticipant.publishDataTrack(options);
        if (cancelled) return void track.unpublish();
        trackRef.current = track;
      } catch (err) {
        console.warn(`[${topic}] publishDataTrack failed:`, err);
      }
    })();

    return () => {
      cancelled = true;
      const track = trackRef.current;
      if (!track?.isPublished()) {
        trackRef.current = null;
        return;
      }
      // `flush()` is missing from older livekit-client releases.
      const flushable = track as { flush?: () => Promise<void> };
      void push(0, 0)
        .then(() => flushable.flush?.())
        .then(() => track.unpublish())
        .catch((err: unknown) => console.warn(`[${topic}] cleanup failed:`, err))
        .finally(() => {
          trackRef.current = null;
        });
    };
  }, [enabled, localParticipant, topic, schemaName, push]);

  return useCallback(
    (a: number, b: number) => {
      void push(a, b).catch(() => {
        /* dropped or unpublished */
      });
    },
    [push],
  );
}

/** Drive commands: `pushDrive(linearX, angularZ)` in rev/s. */
export function useDriveTrack(enabled: boolean, topic: string) {
  return useCommandTrack(enabled, topic, 'geometry_msgs/msg/Twist', twistJson);
}

/** Pan/tilt commands: `pushPanTilt(panVelocity, tiltVelocity)` in rad/s. */
export function usePanTiltTrack(enabled: boolean, topic: string, axes: PanTiltAxes) {
  const encode = useCallback(
    (panVelocity: number, tiltVelocity: number) => panTiltJson(panVelocity, tiltVelocity, axes),
    [axes],
  );
  return useCommandTrack(enabled, topic, 'sensor_msgs/msg/JointState', encode);
}

/* ------------------------------------------------------------------- RPCs */

/** How long a rover RPC may take to answer. Set explicitly rather than left to
 *  the SDK's shorter default, so every RPC here waits the same. A minute floor:
 *  these cross a relay to a robot that may be mid-motion, and abandoning the
 *  call tells us nothing about whether it landed. */
const RPC_TIMEOUT_MS = 60_000;

/**
 * The rover-side operator lock. The rover runtime only acts on commands from
 * the participant holding it, so the HUD claims it before publishing anything.
 *
 * Responses are human-readable sentences, per the rover's API docs.
 */
export function useAcquireControl(robotIdentity: string, connected: boolean, enabled: boolean) {
  const { localParticipant } = useLocalParticipant();
  const [mode, setMode] = useState<Mode>('view');
  const [pending, setPending] = useState(false);
  /** Another participant holds the rover-side lock. */
  const [locked, setLocked] = useState(false);

  const request = useCallback(
    async (acquire: boolean): Promise<boolean> => {
      if (!enabled) return true; // local debugging against a rover without the lock
      if (!robotIdentity || !connected) return false;
      setPending(true);
      try {
        const reply = (
          await localParticipant.performRpc({
            destinationIdentity: robotIdentity,
            method: 'acquire_control',
            payload: JSON.stringify({ acquire }),
            responseTimeout: RPC_TIMEOUT_MS,
          })
        ).trim();
        const HELD_BY = 'controller is currently ';
        if (reply.startsWith(HELD_BY)) {
          const mine = reply.slice(HELD_BY.length).trim() === localParticipant.identity;
          setLocked(!mine);
          return mine;
        }
        setLocked(false);
        if (!acquire) return true;
        return reply.startsWith('control acquired by ') || reply.startsWith('already controller: ');
      } catch (err) {
        console.warn('[acquire_control] RPC failed:', err);
        return false;
      } finally {
        setPending(false);
      }
    },
    [connected, enabled, localParticipant, robotIdentity],
  );

  const requestRef = useRef(request);
  requestRef.current = request;

  const requestMode = useCallback(async (next: Mode) => {
    if (next === 'operate') {
      if (await requestRef.current(true)) setMode('operate');
    } else {
      await requestRef.current(false);
      setMode('view');
    }
  }, []);

  // Always hand the seat back when the HUD goes away.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(
    () => () => {
      if (modeRef.current === 'operate') void requestRef.current(false);
    },
    [],
  );

  return { mode, pending, locked, requestMode };
}

/** Raised with `RPC_TIMEOUT_MS` above; the rover waits this long on the ROS
 *  service, so shortening it here would just move the giving-up to our side. */
const SERVICE_TIMEOUT_SEC = 60;
/** One second of slack over the ROS-side service timeout. */
const SERVICE_RPC_TIMEOUT_MS = 61_000;

/**
 * The rover's generic `ros2_service_call` RPC, used for the headlights
 * (`std_srvs/srv/SetBool`) and pan/tilt homing (`std_srvs/srv/Trigger`).
 */
export function useServiceCall(robotIdentity: string, method: string, enabled: boolean) {
  const { localParticipant } = useLocalParticipant();
  const [pending, setPending] = useState(false);

  const call = useCallback(
    async (service: string, msgType: string, payload: unknown) => {
      if (!enabled || !robotIdentity || pending) return;
      setPending(true);
      try {
        await localParticipant.performRpc({
          destinationIdentity: robotIdentity,
          method,
          payload: JSON.stringify({
            service,
            msg_type: msgType,
            payload: JSON.stringify(payload),
            timeout_sec: SERVICE_TIMEOUT_SEC,
          }),
          responseTimeout: SERVICE_RPC_TIMEOUT_MS,
        });
      } catch (err) {
        console.warn(`[${method}] ${service} failed:`, err);
      } finally {
        setPending(false);
      }
    },
    [enabled, localParticipant, method, pending, robotIdentity],
  );

  return { pending, call };
}

export const setHeadlights = (on: boolean) =>
  ['/set_headlights', 'std_srvs/srv/SetBool', { data: on }] as const;

export const homePanTilt = () => ['/pan_tilt_driver/home', 'std_srvs/srv/Trigger', {}] as const;
