import type { ControlInterface, Operation, RobotConfig } from './types';
import { parseCameraInfo } from './camera-info';
import { localId, object, positive, string, strings } from './validation-values';

export { fieldPath, localId, object, positive, string, strings } from './validation-values';

/** JSON.parse accepts duplicate keys. Scan the valid token stream before accepting it. */
export function parseJson(text: string): unknown {
  if (text.length > 2_000_000) throw new Error('JSON file is too large (maximum 2 MB).');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON.');
  }
  const tokens =
    text.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ??
    [];
  let i = 0;
  const walk = (depth: number) => {
    if (depth > 64) throw new Error('JSON nesting is too deep.');
    const token = tokens[i++];
    if (token === '{') {
      const keys = new Set<string>();
      while (tokens[i] !== '}') {
        const key = JSON.parse(tokens[i++]) as string;
        if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}.`);
        keys.add(key);
        i++;
        walk(depth + 1);
        if (tokens[i] === ',') i++;
      }
      i++;
    } else if (token === '[') {
      while (tokens[i] !== ']') {
        walk(depth + 1);
        if (tokens[i] === ',') i++;
      }
      i++;
    }
  };
  walk(0);
  return parsed;
}

export function exclusion(pattern: string): RegExp {
  // Deliberately accept the portable Python/JS subset from the contract.
  if (pattern.length > 512 || /\(\?|\\[1-9]|\\[gk]|\(\*/.test(pattern))
    throw new Error(`Non-portable exclusion pattern: ${pattern}`);
  try {
    return new RegExp(`^(?:${pattern})$`);
  } catch {
    throw new Error(`Invalid exclusion pattern: ${pattern}`);
  }
}
const compiled = new WeakMap<RobotConfig, Record<'data' | 'video' | 'audio', RegExp[]>>();
export function isExcluded(
  config: RobotConfig,
  kind: 'data' | 'video' | 'audio',
  name: string,
): boolean {
  let patterns = compiled.get(config);
  if (!patterns) {
    patterns = {
      data: config.exclude_data_tracks.map(exclusion),
      video: config.exclude_video_tracks.map(exclusion),
      audio: config.exclude_audio_tracks.map(exclusion),
    };
    compiled.set(config, patterns);
  }
  return patterns[kind].some((pattern) => {
    const match = pattern.exec(name);
    return match !== null && match[0].length === name.length;
  });
}

export function parseDiscovery(payload: string): RobotConfig {
  const root = object(parseJson(payload), 'Robot config');
  if (root.schema_version !== 1)
    throw new Error('Unsupported discovery schema_version. Expected 1.');
  for (const key of ['topics', 'videos', 'components', 'attachments', 'services', 'rpcs']) {
    if (Object.hasOwn(root, key))
      throw new Error(`Legacy ${key} collection is not supported by this discovery contract.`);
  }
  const control = object(root.control, 'control');
  if (control.scope !== 'robot' || control.ownership !== 'portal_active_operator')
    throw new Error('Expected robot-wide Portal active-operator ownership.');
  const filters = Object.fromEntries(
    (['data', 'video', 'audio'] as const).map((kind) => {
      const key = `exclude_${kind}_tracks`;
      const patterns = strings(root[key] ?? [], key);
      patterns.forEach(exclusion);
      return [key, patterns];
    }),
  ) as Pick<RobotConfig, 'exclude_data_tracks' | 'exclude_video_tracks' | 'exclude_audio_tracks'>;
  const interfaces = Object.fromEntries(
    Object.entries(object(root.control_interfaces, 'control_interfaces')).map(([id, raw]) => {
      localId(id);
      const entry = object(raw, id);
      const operations = Object.fromEntries(
        Object.entries(object(entry.operations, `${id}.operations`)).map(([opId, opRaw]) => {
          localId(opId);
          const op = object(opRaw, opId);
          const command = object(op.command, `${opId}.command`);
          if (command.format !== 'json') throw new Error(`${opId}.command.format must be json.`);
          const feedback = strings(op.feedback_tracks ?? [], `${opId}.feedback_tracks`);
          const presentations = strings(op.presentations, `${opId}.presentations`);
          if (!presentations.length) throw new Error(`${opId} needs at least one presentation.`);
          const operation: Operation = {
            profile: string(op.profile, `${opId}.profile`),
            command: {
              track_name: string(command.track_name, 'command track'),
              msg_type: string(command.msg_type, 'command type'),
              format: 'json',
            },
            feedback_tracks: feedback,
            presentations,
          };
          if (op.control_channel !== undefined)
            operation.control_channel = localId(string(op.control_channel, 'control_channel'));
          if (op.joint_names !== undefined) {
            operation.joint_names = strings(op.joint_names, 'operation joint_names');
            if (!operation.joint_names.length)
              throw new Error('Operation joint_names cannot be empty.');
          }
          if (
            operation.profile === 'gripper.position.v1' &&
            (operation.joint_names?.length !== 1 || !feedback.length)
          )
            throw new Error('Gripper position requires one explicit joint and required feedback.');
          return [opId, operation];
        }),
      );
      const result: ControlInterface = {
        label: string(entry.label, `${id}.label`),
        operations,
      };
      if (entry.frame_id !== undefined) result.frame_id = string(entry.frame_id, 'frame_id');
      if (entry.joint_names !== undefined)
        result.joint_names = strings(entry.joint_names, 'joint_names');
      return [id, result];
    }),
  );
  return {
    schema_version: 1,
    label: string(root.label, 'Robot label'),
    default_video_rate_hz: positive(root.default_video_rate_hz, 'default_video_rate_hz'),
    ...filters,
    control: { scope: 'robot', ownership: 'portal_active_operator' },
    control_interfaces: interfaces,
    ...(root.camera_info === undefined ? {} : { camera_info: parseCameraInfo(root.camera_info) }),
  };
}
