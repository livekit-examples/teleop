import type { WorkspaceRuntime } from './runtime';
import type { ControlInput } from './controls';

type Pose = NonNullable<ControlInput['pose']>;
type Q = Pose['orientation'];
const multiply = (a: Q, b: Q): Q => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

/** Fixture-only Cartesian adapter uses grip-relative motion, with fresh references each engagement. */
export async function startXR(
  runtime: WorkspaceRuntime,
  sources: () => HTMLVideoElement[],
  status: (message: string) => void,
): Promise<() => void> {
  if (!navigator.xr) throw new Error('WebXR is unavailable in this browser.');
  const session = await navigator.xr.requestSession('immersive-vr', {
    optionalFeatures: ['local-floor'],
  });
  const allowed = new Set(
    [...runtime.controls.sessions]
      .filter(([, s]) => s.armed && s.presentation === 'vr')
      .map(([id]) => id),
  );
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { xrCompatible: true });
  if (!gl) {
    await session.end();
    throw new Error('XR WebGL is unavailable.');
  }
  const layer = new XRWebGLLayer(session, gl);
  session.updateRenderState({ baseLayer: layer });
  const reference = await session.requestReferenceSpace('local');
  runtime.xrActive = true;
  session.addEventListener('visibilitychange', () => {
    if (session.visibilityState !== 'visible') void runtime.controls.stopAll();
  });
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('XR video shader failed.');
    return s;
  };
  const program = gl.createProgram()!;
  const vertex = shader(
    gl.VERTEX_SHADER,
    'attribute vec2 p; varying vec2 uv; void main(){ gl_Position=vec4(p,0.,1.); uv=vec2((p.x+1.)*.5,1.-(p.y+1.)*.5); }',
  );
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    'precision mediump float; varying vec2 uv; uniform sampler2D video; void main(){ gl_FragColor=texture2D(video,uv); }',
  );
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  const textures = new Map<HTMLVideoElement, WebGLTexture>();
  type Engagement = {
    point: DOMPointReadOnly;
    q: Q;
    robot: Pose;
    last: DOMPointReadOnly;
    lastQ: Q;
    at: number;
  };
  const engaged = new Map<string, Engagement>();
  const pressed = new Map<string, boolean>();
  let ended = false;
  const stop = (id: string) => {
    engaged.delete(id);
    void runtime.controls.stop(id);
  };
  const draw = (video: HTMLVideoElement, x: number, y: number, width: number, height: number) => {
    if (video.readyState < 2) return;
    let texture = textures.get(video);
    if (!texture) {
      texture = gl.createTexture()!;
      textures.set(video, texture);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.viewport(x, y, width, height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const frame: XRFrameRequestCallback = (now, xrFrame) => {
    if (ended) return;
    session.requestAnimationFrame(frame);
    const visible = new Set<string>();
    for (const source of session.inputSources) {
      if (source.handedness !== 'left' && source.handedness !== 'right') continue;
      const id = runtime.layout?.controller_hands?.[source.handedness];
      if (!id || !allowed.has(id)) continue;
      const control = runtime.controls.session(id);
      if (
        control?.presentation !== 'vr' ||
        runtime.controls.operation(id)?.profile !== 'arm.cartesian_pose.v1'
      ) {
        stop(id);
        continue;
      }
      visible.add(id);
      const grip = source.gamepad?.buttons[1]?.pressed ?? false;
      const was = pressed.get(id);
      pressed.set(id, grip);
      // Seed held buttons without treating them as a new engagement.
      if (was === undefined) continue;
      if (!grip) {
        if (engaged.has(id)) stop(id);
        continue;
      }
      const pose = source.gripSpace ? xrFrame.getPose(source.gripSpace, reference) : null;
      if (
        !pose ||
        ![
          pose.transform.position.x,
          pose.transform.position.y,
          pose.transform.position.z,
          pose.transform.orientation.x,
          pose.transform.orientation.y,
          pose.transform.orientation.z,
          pose.transform.orientation.w,
        ].every(Number.isFinite)
      ) {
        stop(id);
        status(`${id}: controller tracking unavailable; release grip.`);
        continue;
      }
      if (!was && !engaged.has(id)) {
        if (!control.armed) {
          void runtime.controls.arm(id);
          pressed.set(id, false);
          continue;
        }
        const feedback = Object.values(runtime.controls.context(id).feedback)[0] as
          | { pose?: Pose }
          | undefined;
        if (!feedback?.pose) {
          stop(id);
          continue;
        }
        engaged.set(id, {
          point: pose.transform.position,
          q: pose.transform.orientation,
          robot: structuredClone(feedback.pose),
          last: pose.transform.position,
          lastQ: pose.transform.orientation,
          at: now,
        });
      }
      const origin = engaged.get(id);
      if (!origin) continue;
      const q = pose.transform.orientation;
      const angle =
        2 *
        Math.acos(
          Math.min(
            1,
            Math.abs(
              q.x * origin.lastQ.x +
                q.y * origin.lastQ.y +
                q.z * origin.lastQ.z +
                q.w * origin.lastQ.w,
            ),
          ),
        );
      if (
        now - origin.at > 160 ||
        angle > 0.5 ||
        Math.hypot(
          pose.transform.position.x - origin.last.x,
          pose.transform.position.y - origin.last.y,
          pose.transform.position.z - origin.last.z,
        ) > 0.08
      ) {
        stop(id);
        status(`${id}: tracking gap/jump; release grip.`);
        continue;
      }
      const point = pose.transform.position;
      const delta = multiply(pose.transform.orientation, {
        x: -origin.q.x,
        y: -origin.q.y,
        z: -origin.q.z,
        w: origin.q.w,
      });
      const target: Pose = {
        position: {
          x: origin.robot.position.x - (point.z - origin.point.z),
          y: origin.robot.position.y - (point.x - origin.point.x),
          z: origin.robot.position.z + (point.y - origin.point.y),
        },
        orientation: multiply(origin.robot.orientation, {
          x: -delta.z,
          y: -delta.x,
          z: delta.y,
          w: delta.w,
        }),
      };
      if (!runtime.controls.send(id, { pose: target })) {
        stop(id);
        continue;
      }
      origin.last = point;
      origin.lastQ = q;
      origin.at = now;
    }
    for (const id of engaged.keys())
      if (!visible.has(id)) {
        stop(id);
        pressed.delete(id);
      }
    const viewer = xrFrame.getViewerPose(reference);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0.02, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const videos = sources();
    for (const view of viewer?.views ?? []) {
      const viewport = layer.getViewport(view);
      if (!viewport || !videos.length) continue;
      const rail = videos.length > 1 ? Math.round(viewport.width * 0.2) : 0;
      draw(videos[0], viewport.x + rail, viewport.y, viewport.width - rail, viewport.height);
      videos
        .slice(1)
        .forEach((video, i) =>
          draw(
            video,
            viewport.x,
            viewport.y +
              viewport.height -
              (i + 1) * Math.min(viewport.height / (videos.length - 1), rail * 0.65),
            rail,
            Math.min(viewport.height / (videos.length - 1), rail * 0.65),
          ),
        );
    }
  };
  const cleanup = () => {
    ended = true;
    runtime.xrActive = false;
    for (const id of allowed) stop(id);
    textures.forEach((texture) => gl.deleteTexture(texture));
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    status('VR session ended. Inputs disarmed.');
    runtime.notify();
  };
  session.addEventListener('end', cleanup, { once: true });
  session.requestAnimationFrame(frame);
  status('VR active. Release grip, then press it to establish a fresh reference.');
  return () => {
    if (!ended) void session.end();
  };
}
