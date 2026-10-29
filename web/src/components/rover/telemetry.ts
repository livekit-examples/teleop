'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteDataTrack } from 'livekit-client';

/**
 * Everything the rover HUD reads off the selected rover: which telemetry topics
 * it publishes, and the decoded ROS2 messages on each one.
 *
 * Every topic is a LiveKit data track carrying JSON frames. Topic names are
 * matched with the leading ROS slash stripped, so a configured `battery_state`
 * resolves an actual `/battery_state` publication.
 */

const strip = (topic: string) => topic.replace(/^\//, '');

/* ------------------------------------------------------ track subscription */

/** Names of the data-track topics the given participant currently publishes. */
export function useRobotTopics(robotIdentity: string): Set<string> {
  const room = useRoomContext();
  const [topics, setTopics] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const rebuild = () => {
      const participant = room.remoteParticipants.get(robotIdentity);
      setTopics(
        new Set(
          Array.from(participant?.dataTracks.values() ?? [])
            .map((t) => t.info.name && strip(t.info.name))
            .filter((name): name is string => !!name),
        ),
      );
    };
    rebuild();
    const events = [
      RoomEvent.DataTrackPublished,
      RoomEvent.DataTrackUnpublished,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
    ];
    for (const e of events) room.on(e, rebuild);
    return () => {
      for (const e of events) room.off(e, rebuild);
    };
  }, [robotIdentity, room]);

  return topics;
}

/** The selected rover's data track for `topic`, or null while it isn't published. */
function useDataTrack(robotIdentity: string, topic: string): RemoteDataTrack | null {
  const room = useRoomContext();
  const [track, setTrack] = useState<RemoteDataTrack | null>(null);
  const wanted = strip(topic);

  useEffect(() => {
    const resolve = () => {
      const participant = room.remoteParticipants.get(robotIdentity);
      setTrack(
        Array.from(participant?.dataTracks.values() ?? []).find(
          (t) => t.info.name && strip(t.info.name) === wanted,
        ) ?? null,
      );
    };
    resolve();
    const events = [
      RoomEvent.DataTrackPublished,
      RoomEvent.DataTrackUnpublished,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
    ];
    for (const e of events) room.on(e, resolve);
    return () => {
      for (const e of events) room.off(e, resolve);
    };
  }, [robotIdentity, room, wanted]);

  return track;
}

type FrameOptions = {
  /** ROS serializes unmeasured floats as bare `NaN`, which is not valid JSON. */
  sanitizeNaN?: boolean;
  /** Called when a frame arrives but can't be decoded. */
  onBadFrame?: () => void;
};

/**
 * Subscribe to a rover topic and hand each decoded JSON frame to `onFrame`.
 * `onFrame` is called through a ref, so an unstable closure is fine and only a
 * track change re-subscribes.
 */
function useJsonFrames<T>(
  robotIdentity: string,
  topic: string,
  onFrame: (value: T) => void,
  { sanitizeNaN = false, onBadFrame }: FrameOptions = {},
) {
  const track = useDataTrack(robotIdentity, topic);
  const handlers = useRef({ onFrame, onBadFrame });
  handlers.current = { onFrame, onBadFrame };

  useEffect(() => {
    if (!track) return;
    const abort = new AbortController();
    const reader = track.subscribe({ signal: abort.signal }).getReader();
    const decoder = new TextDecoder();

    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          try {
            let text = decoder.decode(value.payload).replace(/^﻿/, '').replace(/\0+$/, '').trim();
            if (sanitizeNaN) text = text.replace(/-?(?:NaN|Infinity)/gi, 'null');
            handlers.current.onFrame(JSON.parse(text) as T);
          } catch {
            handlers.current.onBadFrame?.();
          }
        }
      } catch {
        // Subscription aborted — the last decoded value stays on screen.
      }
    })();

    return () => {
      abort.abort();
      reader.releaseLock();
    };
  }, [track, sanitizeNaN]);

  return track;
}

/* ------------------------------------------------------------ ROS payloads */

type Vec3 = { x?: number; y?: number; z?: number };
type Quaternion = Vec3 & { w?: number };
type Stamp = { sec?: number; nanosec?: number };

const RAD_TO_DEG = 180 / Math.PI;

/** Yaw of a quaternion (rotation about Z), in degrees. */
function quaternionYawDegrees(q: Quaternion): number {
  const [x, y, z, w] = [q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 1];
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * RAD_TO_DEG;
}

/** `nav_msgs/msg/Odometry` → heading in degrees, right turn positive (the HUD's
 *  convention — ROS yaw is counter-clockwise-positive, so it is negated). */
export function useOdomYaw(robotIdentity: string, topic: string): number | undefined {
  const [yaw, setYaw] = useState<number>();
  useEffect(() => setYaw(undefined), [robotIdentity, topic]);
  useJsonFrames<{ pose?: { pose?: { orientation?: Quaternion } } }>(robotIdentity, topic, (msg) => {
    const orientation = msg.pose?.pose?.orientation;
    if (orientation) setYaw(-quaternionYawDegrees(orientation));
  });
  return yaw;
}

/** Matches `PanTiltController::kTicksPerRevolution` in pan_tilt_demo. */
const SERVO_TICKS_PER_REV = 4096;

/** Encoder ticks → degrees in [-180, 180]. */
function servoTicksToDegrees(ticks: number): number {
  const wrapped = ((ticks % SERVO_TICKS_PER_REV) + SERVO_TICKS_PER_REV) % SERVO_TICKS_PER_REV;
  return (wrapped / SERVO_TICKS_PER_REV) * 360 - 180;
}

type ServoState = { position_ticks?: number; valid?: boolean };

/** The pan/tilt servos' own state topics, in degrees. */
export function usePanTilt(robotIdentity: string, panTopic: string, tiltTopic: string) {
  const [pan, setPan] = useState(0);
  const [tilt, setTilt] = useState(0);
  const read = (set: (deg: number) => void) => (msg: ServoState) => {
    if (msg.valid !== false && msg.position_ticks !== undefined) {
      set(servoTicksToDegrees(msg.position_ticks));
    }
  };
  useJsonFrames<ServoState>(robotIdentity, panTopic, read(setPan));
  useJsonFrames<ServoState>(robotIdentity, tiltTopic, read(setTilt));
  return { pan, tilt };
}

type JointState = { name?: unknown[]; position?: unknown[] };

/**
 * The optional `sensor_msgs/msg/JointState` track. A pan and/or tilt joint
 * whose name contains that word (case-insensitive) is what tells the HUD a
 * camera head is fitted — one axis is enough. Positions are radians on the
 * wire, degrees here. Joints are matched by name only: falling back to index
 * would treat wheel `/joint_states` as a pan/tilt head.
 */
export function useJointAngles(robotIdentity: string): { pan: number | null; tilt: number | null } {
  const [angles, setAngles] = useState<{ pan: number | null; tilt: number | null }>({
    pan: null,
    tilt: null,
  });
  useEffect(() => setAngles({ pan: null, tilt: null }), [robotIdentity]);

  useJsonFrames<JointState>(robotIdentity, '/joint_states', (msg) => {
    if (!Array.isArray(msg.name) || !Array.isArray(msg.position)) return;
    const at = (match: string) => {
      const i = msg.name!.findIndex(
        (n) => typeof n === 'string' && n.toLowerCase().includes(match),
      );
      if (i < 0) return null;
      const v = msg.position![i];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const pan = at('pan');
    const tilt = at('tilt');
    setAngles({
      pan: pan !== null ? pan * RAD_TO_DEG : null,
      tilt: tilt !== null ? tilt * RAD_TO_DEG : null,
    });
  });

  return angles;
}

export type ImuSample = {
  /** Message timestamp, epoch ms (header stamp when set, else receive time). */
  t: number;
  /** Angular velocity about Z / Y, in °/s (ROS sends rad/s). */
  angVelZ: number;
  angVelY: number;
  /** Linear acceleration along X / Y, in m/s². */
  linAccX: number;
  linAccY: number;
};

type ImuMessage = {
  header?: { stamp?: Stamp };
  angular_velocity?: Vec3;
  linear_acceleration?: Vec3;
};

/** Oldest IMU sample kept in the rolling buffer. */
const IMU_MAX_AGE_MS = 60_000;

/**
 * A rolling buffer of `sensor_msgs/msg/Imu` samples. Kept in a ref, not state,
 * so the plot can poll it on animation frames without a re-render per message.
 */
export function useImuHistory(robotIdentity: string, topic: string) {
  const samples = useRef<ImuSample[]>([]);
  useJsonFrames<ImuMessage>(robotIdentity, topic, (msg) => {
    const angVel = msg.angular_velocity;
    const linAcc = msg.linear_acceleration;
    // Some rovers publish a custom gyro payload on this topic; ignore it.
    if (!angVel && !linAcc) return;
    const stamp = msg.header?.stamp;
    const stampMs =
      stamp?.sec || stamp?.nanosec ? (stamp.sec ?? 0) * 1000 + (stamp.nanosec ?? 0) / 1e6 : null;
    const t = stampMs ?? Date.now();
    samples.current.push({
      t,
      angVelZ: (angVel?.z ?? 0) * RAD_TO_DEG,
      angVelY: (angVel?.y ?? 0) * RAD_TO_DEG,
      linAccX: linAcc?.x ?? 0,
      linAccY: linAcc?.y ?? 0,
    });
    while (samples.current.length > 0 && samples.current[0].t < t - IMU_MAX_AGE_MS) {
      samples.current.shift();
    }
  });
  return samples;
}

/** `sensor_msgs/msg/BatteryState`; unmeasured fields arrive as ROS NaN. */
export type BatteryState = {
  voltage?: number | null;
  temperature?: number | null;
  current?: number | null;
  percentage?: number | null;
  power_supply_status?: number;
  power_supply_health?: number;
  power_supply_technology?: number;
  present?: boolean;
};

export function useBattery(robotIdentity: string, topic: string) {
  const [battery, setBattery] = useState<BatteryState>();
  const [payloadInvalid, setPayloadInvalid] = useState(false);
  useEffect(() => {
    setBattery(undefined);
    setPayloadInvalid(false);
  }, [robotIdentity, topic]);

  useJsonFrames<BatteryState>(
    robotIdentity,
    topic,
    (msg) => {
      setBattery(msg);
      setPayloadInvalid(false);
    },
    { sanitizeNaN: true, onBadFrame: () => setPayloadInvalid(true) },
  );

  return { battery, payloadInvalid };
}

/**
 * The rover's headlight state (`std_msgs/msg/Bool`). Undefined until a valid
 * frame arrives — the HUD only shows the headlight button once it knows the
 * real state. Also accepts the same message over a plain data message, which is
 * how some rover builds publish it.
 */
export function useHeadlightState(robotIdentity: string, topic: string): boolean | undefined {
  const room = useRoomContext();
  const [on, setOn] = useState<boolean>();
  useEffect(() => setOn(undefined), [robotIdentity, topic]);

  const apply = useCallback((msg: { data?: unknown }) => {
    if (typeof msg?.data === 'boolean') setOn(msg.data);
  }, []);
  useJsonFrames<{ data?: unknown }>(robotIdentity, topic, apply);

  useEffect(() => {
    const wanted = strip(topic);
    const onData = (
      payload: Uint8Array,
      participant?: { identity: string },
      _k?: unknown,
      received?: string,
    ) => {
      if (participant?.identity !== robotIdentity || !received || strip(received) !== wanted)
        return;
      try {
        apply(JSON.parse(new TextDecoder().decode(payload)));
      } catch {
        /* malformed frame */
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [apply, robotIdentity, room, topic]);

  return on;
}
