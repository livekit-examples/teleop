import type {
  CommandWriter,
  Operation,
  Participant,
  Publication,
  RobotConfig,
  Transport,
  TransportEvent,
} from './types';

const operation = (
  profile: string,
  track: string,
  type: string,
  presentations: string[],
  feedback: string[] = [],
): Operation => ({
  profile,
  command: { track_name: track, msg_type: type, format: 'json' },
  feedback_tracks: feedback,
  presentations,
});
export const fixtureConfig: RobotConfig = {
  schema_version: 1,
  label: 'Workshop rover + two arms',
  default_video_rate_hz: 20,
  exclude_data_tracks: ['/debug/.*'],
  exclude_video_tracks: ['private-.*'],
  exclude_audio_tracks: ['private-.*'],
  control: { scope: 'robot', ownership: 'portal_active_operator' },
  control_interfaces: {
    base: {
      label: 'Rover base',
      frame_id: 'base_link',
      operations: {
        drive: operation('base.twist.v1', '/cmd_vel', 'geometry_msgs/msg/Twist', [
          'joystick',
          'keyboard',
          'gamepad',
        ]),
        holonomic: operation('base.holonomic_twist.v1', '/holonomic', 'geometry_msgs/msg/Twist', [
          'joystick',
          'keyboard',
          'gamepad',
        ]),
        ackermann: operation(
          'base.ackermann_drive.v1',
          '/steer',
          'ackermann_msgs/msg/AckermannDrive',
          ['joystick', 'keyboard', 'gamepad'],
        ),
      },
    },
    left_arm: {
      label: 'Left arm',
      frame_id: 'left_base',
      joint_names: ['left_1', 'left_2'],
      operations: {
        position: operation(
          'joints.trajectory.v1',
          '/left/trajectory',
          'trajectory_msgs/msg/JointTrajectory',
          ['joint_sliders'],
          ['/joint_states'],
        ),
        velocity: operation('joints.velocity_jog.v1', '/left/jog', 'control_msgs/msg/JointJog', [
          'joint_sliders',
          'gamepad',
        ]),
        pose: operation(
          'arm.cartesian_pose.v1',
          '/left/pose_target',
          'geometry_msgs/msg/PoseStamped',
          ['vr', 'hand_tracking'],
          ['/left/pose'],
        ),
        future: operation('vendor.future.v2', '/left/future', 'vendor/Future', ['vr']),
        gripper_position: {
          ...operation(
            'gripper.position.v1',
            '/left/gripper_trajectory',
            'trajectory_msgs/msg/JointTrajectory',
            ['gripper_controls'],
            ['/joint_states'],
          ),
          control_channel: 'gripper',
          joint_names: ['left_gripper_joint'],
        },
      },
    },
    right_arm: {
      label: 'Right arm',
      frame_id: 'right_base',
      joint_names: ['right_1', 'right_2'],
      operations: {
        gripper_position: {
          ...operation(
            'gripper.position.v1',
            '/right/gripper_trajectory',
            'trajectory_msgs/msg/JointTrajectory',
            ['gripper_controls'],
            ['/joint_states'],
          ),
          control_channel: 'gripper',
          joint_names: ['right_gripper_joint'],
        },
        position: operation(
          'joints.trajectory.v1',
          '/right/trajectory',
          'trajectory_msgs/msg/JointTrajectory',
          ['joint_sliders'],
          ['/joint_states'],
        ),
        pose: operation(
          'arm.cartesian_pose.v1',
          '/right/pose_target',
          'geometry_msgs/msg/PoseStamped',
          ['vr', 'hand_tracking'],
          ['/right/pose'],
        ),
      },
    },
  },
};

/** Fake transport is also a deterministic test seam. startDemo is opt-in. */
export class FixtureTransport implements Transport {
  readonly fixture = true;
  readonly identity = 'fixture-operator';
  robots: Participant[] = [
    {
      identity: 'fixture-rover',
      name: 'Workshop rover',
      attributes: {
        'lk.portal.role': 'robot',
        'lk.portal.version': '3',
        'lk.portal.active_operator': '',
      },
    },
    {
      identity: 'incompatible-station',
      attributes: { 'lk.portal.role': 'robot', 'lk.portal.version': '2' },
    },
  ];
  tracks: Publication[] = [];
  config: unknown = fixtureConfig;
  readonly calls: { robot: string; method: string; payload: string; timeout: number }[] = [];
  readonly commands: { track: string; value: unknown }[] = [];
  readonly reads = new Map<string, number>();
  readonly mediaDemand = new Set<string>();
  restrictedTo = '';
  private listeners = new Set<(event: TransportEvent) => void>();
  private readers = new Map<string, Set<(bytes: Uint8Array) => void>>();
  private timer?: ReturnType<typeof setInterval>;
  private videos = new Map<
    string,
    { stream: MediaStream; timer: ReturnType<typeof setInterval> }
  >();
  constructor() {
    for (const [name, msgType] of [
      ['/imu', 'sensor_msgs/msg/Imu'],
      ['/battery', 'sensor_msgs/msg/BatteryState'],
      ['/enabled', 'std_msgs/msg/Bool'],
      ['/state', 'std_msgs/msg/Int32'],
      ['/joint_states', 'sensor_msgs/msg/JointState'],
      ['/left/pose', 'geometry_msgs/msg/PoseStamped'],
      ['/right/pose', 'geometry_msgs/msg/PoseStamped'],
      ['/debug/cpu', 'std_msgs/msg/Float64'],
    ])
      this.add({ id: name, name, msgType, encoding: 'json', robot: 'fixture-rover', kind: 'data' });
    this.add({
      id: 'unsupported',
      robot: 'fixture-rover',
      kind: 'data',
      name: '/binary',
      encoding: 'cdr',
      msgType: 'vendor/Binary',
    });
    for (const name of ['Front camera', 'Wrist camera', 'private-camera'])
      this.add({
        id: name,
        robot: 'fixture-rover',
        kind: 'video',
        name,
        encoding: 'video/generated',
      });
    this.add({
      id: 'microphone',
      robot: 'fixture-rover',
      kind: 'audio',
      name: 'microphone',
      encoding: 'audio/generated',
    });
  }
  participants() {
    return this.robots;
  }
  publications() {
    return this.tracks;
  }
  onEvent(listener: (event: TransportEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(event: TransportEvent) {
    for (const listener of this.listeners) listener(event);
  }
  add(pub: Publication) {
    this.tracks = [...this.tracks.filter((p) => p.id !== pub.id), pub];
    this.emit('changed');
  }
  remove(id: string) {
    this.tracks = this.tracks.filter((p) => p.id !== id);
    this.emit('changed');
  }
  async rpc(robot: string, method: string, payload: string, timeout: number) {
    this.calls.push({ robot, method, payload, timeout });
    if (method === 'get_robot_config') return JSON.stringify(this.config);
    if (method === 'portal.set_active_operator') {
      const p = this.robots.find((p) => p.identity === robot);
      if (!p) throw new Error('Robot is absent.');
      p.attributes = { ...p.attributes, 'lk.portal.active_operator': payload };
      this.emit('changed');
      return '';
    }
    throw new Error(`Unknown fixture RPC ${method}.`);
  }
  async *read(pub: Publication, signal: AbortSignal): AsyncIterable<Uint8Array> {
    this.reads.set(pub.id, (this.reads.get(pub.id) ?? 0) + 1);
    const queue: Uint8Array[] = [];
    let wake: (() => void) | undefined;
    const receive = (bytes: Uint8Array) => {
      queue.push(bytes);
      wake?.();
    };
    const entries = this.readers.get(pub.id) ?? new Set();
    entries.add(receive);
    this.readers.set(pub.id, entries);
    const abort = () => wake?.();
    signal.addEventListener('abort', abort);
    try {
      while (!signal.aborted) {
        if (!queue.length)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        if (signal.aborted) break;
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      entries.delete(receive);
      signal.removeEventListener('abort', abort);
    }
  }
  push(id: string, value: unknown) {
    this.pushBytes(id, new TextEncoder().encode(JSON.stringify(value)));
  }
  pushBytes(id: string, bytes: Uint8Array) {
    for (const receive of this.readers.get(id) ?? []) receive(bytes);
  }
  subscribeMedia(pub: Publication, enabled: boolean) {
    if (enabled) this.mediaDemand.add(pub.id);
    else this.mediaDemand.delete(pub.id);
  }
  attach(pub: Publication, element: HTMLMediaElement) {
    if (pub.kind === 'audio') return () => {}; // Fixture audio has no live microphone input.
    let entry = this.videos.get(pub.id);
    if (!entry) {
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 540;
      const ctx = canvas.getContext('2d')!;
      const draw = () => {
        const t = performance.now() / 1000;
        ctx.fillStyle = pub.name.includes('Wrist') ? '#051518' : '#131313';
        ctx.fillRect(0, 0, 960, 540);
        ctx.strokeStyle = '#30302f';
        ctx.lineWidth = 1;
        for (let i = 0; i < 20; i++) {
          const y = (i * 45 + t * 35) % 540;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(960, y);
          ctx.stroke();
        }
        ctx.fillStyle = '#1fd5f9';
        ctx.fillRect(420 + Math.sin(t) * 170, 260, 110, 75);
        ctx.fillStyle = '#ffffff';
        ctx.font = '28px monospace';
        ctx.fillText(pub.name, 35, 55);
        ctx.font = '18px monospace';
        ctx.fillText(`FIXTURE · ${t.toFixed(1)}s`, 35, 90);
      };
      draw();
      entry = { stream: canvas.captureStream(20), timer: setInterval(draw, 50) };
      this.videos.set(pub.id, entry);
    }
    element.srcObject = entry.stream;
    return () => {
      element.srcObject = null;
    };
  }
  restrictCommands(robot: string) {
    this.restrictedTo = robot;
  }
  async publish(op: Operation): Promise<CommandWriter> {
    let closed = false;
    return {
      push: (value) => {
        if (closed) throw new Error('Writer closed.');
        this.commands.push({ track: op.command.track_name, value });
      },
      flush: async () => {},
      close: async () => {
        closed = true;
      },
    };
  }
  startDemo() {
    this.emit('connected');
    let t = 0;
    this.timer = setInterval(() => {
      t += 0.1;
      this.push('/imu', {
        angular_velocity: { x: Math.sin(t), y: Math.cos(t / 2), z: Math.sin(t / 2) * 2 },
        linear_acceleration: { x: 0.2, y: 0, z: 9.8 },
      });
      this.push('/battery', { voltage: 24 + Math.sin(t / 8), percentage: 0.82, present: true });
      this.push('/enabled', { data: Math.floor(t / 4) % 2 === 0 });
      this.push('/state', { data: Math.floor(t / 3) % 3 });
      this.push('/joint_states', {
        name: [
          'left_1',
          'left_2',
          'right_1',
          'right_2',
          'left_gripper_joint',
          'right_gripper_joint',
        ],
        position: [
          Math.sin(t) / 2,
          Math.cos(t) / 2,
          Math.sin(t + 1) / 2,
          Math.cos(t + 1) / 2,
          0.02,
          0.02,
        ],
        velocity: [0.1, 0.1, 0.1, 0.1, 0, 0],
      });
      for (const hand of ['left', 'right'])
        this.push(`/${hand}/pose`, {
          header: { frame_id: `${hand}_base` },
          pose: { position: { x: 0.3, y: 0, z: 0.4 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
        });
      if (this.tracks.some((p) => p.id === '/new_sensor'))
        this.push('/new_sensor', { temperature: 23 + Math.sin(t) });
    }, 100);
  }
  async disconnect() {
    clearInterval(this.timer);
    for (const entry of this.videos.values()) {
      clearInterval(entry.timer);
      entry.stream.getTracks().forEach((track) => track.stop());
    }
    this.videos.clear();
    this.emit('disconnected');
  }
}
