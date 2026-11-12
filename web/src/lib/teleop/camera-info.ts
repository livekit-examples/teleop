import type { CameraInfo, CameraView } from './types';
import { localId, object, positive, string } from './validation-values';

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number.`);
  return value;
}

function integer(value: unknown, label: string, minimum: number): number {
  const result = finite(value, label);
  if (!Number.isSafeInteger(result) || result < minimum)
    throw new Error(`${label} must be an integer of at least ${minimum}.`);
  return result;
}

function vector(value: unknown, label: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new Error(`${label} must contain ${length} numbers.`);
  return value.map((v) => finite(v, label));
}

export function parseCameraInfo(value: unknown): Record<string, CameraInfo> {
  const tracks = new Set<string>();
  return Object.fromEntries(
    Object.entries(object(value, 'camera_info')).map(([id, raw]) => {
      localId(id);
      const label = `camera_info.${id}`;
      const entry = object(raw, label);
      const track_name = string(entry.track_name, `${label}.track_name`);
      if (tracks.has(track_name)) throw new Error(`Repeated camera track: ${track_name}.`);
      tracks.add(track_name);
      const width = integer(entry.width, `${label}.width`, 1);
      const height = integer(entry.height, `${label}.height`, 1);
      const frames = new Set<string>();
      const rawViews = object(entry.views, `${label}.views`);
      const eyes = Object.keys(rawViews).sort().join(',');
      if (eyes !== 'mono' && eyes !== 'left,right')
        throw new Error(`${label}.views must contain mono, or both left and right.`);
      const views = Object.fromEntries(
        Object.entries(rawViews).map(([eye, rawView]) => {
          const path = `${label}.views.${eye}`;
          const view = object(rawView, path);
          const frame_id = string(view.frame_id, `${path}.frame_id`);
          if (frames.has(frame_id)) throw new Error(`Repeated camera frame: ${frame_id}.`);
          frames.add(frame_id);
          const region = object(view.image_region, `${path}.image_region`);
          const image_region = {
            x: integer(region.x, `${path}.image_region.x`, 0),
            y: integer(region.y, `${path}.image_region.y`, 0),
            width: integer(region.width, `${path}.image_region.width`, 1),
            height: integer(region.height, `${path}.image_region.height`, 1),
          };
          if (
            image_region.x + image_region.width > width ||
            image_region.y + image_region.height > height
          )
            throw new Error(`${path}.image_region is outside the video image.`);
          const intrinsics = object(view.intrinsics, `${path}.intrinsics`);
          const distortion_model = string(intrinsics.distortion_model, `${path}.distortion_model`);
          const coefficientCounts: Record<string, number> = {
            none: 0,
            plumb_bob: 5,
            rational_polynomial: 8,
            equidistant: 4,
          };
          if (!Object.hasOwn(coefficientCounts, distortion_model))
            throw new Error(`${path} has an unsupported distortion_model.`);
          const extrinsics = object(view.extrinsics, `${path}.extrinsics`);
          const parent_frame_id = string(extrinsics.parent_frame_id, `${path}.parent_frame_id`);
          if (parent_frame_id === frame_id)
            throw new Error(`${path} cannot use its optical frame as its parent.`);
          const rotation_xyzw = vector(extrinsics.rotation_xyzw, `${path}.rotation_xyzw`, 4);
          if (Math.abs(Math.hypot(...rotation_xyzw) - 1) > 1e-4)
            throw new Error(`${path}.rotation_xyzw must be a unit quaternion.`);
          const result: CameraView = {
            frame_id,
            image_region,
            intrinsics: {
              fx: positive(intrinsics.fx, `${path}.fx`),
              fy: positive(intrinsics.fy, `${path}.fy`),
              cx: finite(intrinsics.cx, `${path}.cx`),
              cy: finite(intrinsics.cy, `${path}.cy`),
              distortion_model: distortion_model as CameraView['intrinsics']['distortion_model'],
              distortion_coefficients: vector(
                intrinsics.distortion_coefficients,
                `${path}.distortion_coefficients`,
                coefficientCounts[distortion_model],
              ),
            },
            extrinsics: {
              parent_frame_id,
              translation: vector(extrinsics.translation, `${path}.translation`, 3),
              rotation_xyzw,
            },
          };
          return [eye, result];
        }),
      ) as CameraInfo['views'];
      if ('left' in views) {
        const a = views.left.image_region,
          b = views.right.image_region;
        if (
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height
        )
          throw new Error(`${label} has overlapping stereo image regions.`);
      }
      return [id, { track_name, width, height, views }];
    }),
  );
}
