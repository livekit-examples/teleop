'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Bot, User } from 'lucide-react';
import { CONNECTION_COLORS, CONNECTION_LABELS, type FleetRobot } from '@/lib/fleet/attributes';
import { landDots } from '@/lib/fleet/land-dots';

export type OperatorPin = { lat: number; lng: number; label: string; approximate: boolean };

/** lat/lng is the real position; pinLat/pinLng is where the pin and link are drawn. */
type Placed = FleetRobot & { lat: number; lng: number; pinLat: number; pinLng: number };

/** Robots closer than this to the operator are fanned out around them so their links show. */
const NEAR_DEG = 2.5;
const FAN_RADIUS_DEG = 7;

const DEG = Math.PI / 180;

/** lon 0 faces +z (the camera), north is +y. */
function toVector(lat: number, lng: number, r = 1) {
  const phi = lat * DEG;
  const lambda = lng * DEG;
  return new THREE.Vector3(
    r * Math.cos(phi) * Math.sin(lambda),
    r * Math.sin(phi),
    r * Math.cos(phi) * Math.cos(lambda),
  );
}

function arcPoints(from: THREE.Vector3, to: THREE.Vector3, segments = 72) {
  const a = from.clone().normalize();
  const b = to.clone().normalize();
  const angle = a.angleTo(b);
  const lift = 0.05 + 0.3 * (angle / Math.PI);
  const points: THREE.Vector3[] = [];
  const sinA = Math.sin(angle) || 1;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Spherical interpolation, then lift off the surface.
    const p = a
      .clone()
      .multiplyScalar(Math.sin((1 - t) * angle) / sinA)
      .add(b.clone().multiplyScalar(Math.sin(t * angle) / sinA));
    points.push(p.normalize().multiplyScalar(1.004 + lift * Math.sin(Math.PI * t)));
  }
  return points;
}

const ARC_VERTEX = /* glsl */ `
  varying float vT;
  void main() {
    vT = uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ARC_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uPhase;
  uniform float uSpeed;
  uniform float uDashed;
  uniform float uDim;
  varying float vT;
  void main() {
    float ends = smoothstep(0.0, 0.06, vT) * smoothstep(1.0, 0.94, vT);
    float head = fract(uTime * uSpeed + uPhase);
    float d = vT - head;
    // Bright head with a short tail behind it, travelling operator -> robot.
    float pulse = d <= 0.0 ? exp(d * 14.0) : exp(-d * 90.0);
    float alpha = (0.32 + 0.68 * pulse * step(uDashed, 0.5)) * ends;
    if (uDashed > 0.5) {
      if (fract(vT * 34.0) > 0.45) discard;
      alpha = 0.55 * ends;
    }
    gl_FragColor = vec4(uColor * (1.0 + 0.6 * pulse * step(uDashed, 0.5)), alpha * uDim);
  }
`;

const DOT_VERTEX = /* glsl */ `
  uniform float uSize;
  varying float vFacing;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(world.xyz);
    vec3 toCam = normalize(cameraPosition - world.xyz);
    vFacing = dot(n, toCam);
    vec4 mv = viewMatrix * world;
    gl_PointSize = uSize * (3.6 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const DOT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vFacing;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    float a = smoothstep(0.0, 0.45, vFacing);
    gl_FragColor = vec4(uColor, a);
  }
`;

const SPHERE_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 3.0);
    vec3 base = vec3(0.035);
    vec3 edge = vec3(0.09);
    gl_FragColor = vec4(mix(base, edge, rim), 1.0);
  }
`;
const SPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

type Scene = {
  arcs: THREE.Group;
  view: { rotX: number; rotY: number; targetX?: number; targetY?: number; zoom: number };
  lastInteraction: number;
};

export function FleetGlobe({
  robots,
  operator,
  selected,
  onSelect,
}: {
  robots: FleetRobot[];
  operator?: OperatorPin;
  selected?: string;
  onSelect(identity: string | undefined): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const markers = useRef(
    new Map<string, { el: HTMLElement; pos: THREE.Vector3; top: boolean }>(),
  );

  const placed = useMemo(() => {
    const list = robots.flatMap((r): Placed[] => {
      if (!r.coordinates.ok) return [];
      const { lat, lng } = r.coordinates.value;
      return [{ ...r, lat, lng, pinLat: lat, pinLng: lng }];
    });
    // A robot in the operator's own city would sit under the operator pin with a link of
    // zero length. Spread those robots on a ring around the operator and link to the ring.
    if (operator) {
      const home = toVector(operator.lat, operator.lng);
      const near = list.filter((r) => toVector(r.lat, r.lng).angleTo(home) < NEAR_DEG * DEG);
      near.forEach((r, i) => {
        const bearing = (-50 + (i * 360) / near.length) * DEG;
        const cosLat = Math.max(Math.cos(operator.lat * DEG), 0.2);
        r.pinLat = THREE.MathUtils.clamp(operator.lat + FAN_RADIUS_DEG * Math.cos(bearing), -89, 89);
        r.pinLng = operator.lng + (FAN_RADIUS_DEG * Math.sin(bearing)) / cosLat;
      });
    }
    return list;
  }, [robots, operator]);
  // Rebuild arcs only when something the arcs draw actually changes.
  const arcKey = JSON.stringify([
    operator && [operator.lat, operator.lng],
    placed.map((r) => [r.identity, r.pinLat, r.pinLng, r.connection]),
    selected,
  ]);

  // Scene setup, render loop and pointer controls.
  useEffect(() => {
    const container = canvasHost.current;
    const root = host.current;
    if (!container || !root) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      container.textContent = 'WebGL is unavailable in this browser.';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, 4.4);
    const globe = new THREE.Group();
    globe.rotation.order = 'XYZ';
    scene.add(globe);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.ShaderMaterial({ vertexShader: SPHERE_VERTEX, fragmentShader: SPHERE_FRAGMENT }),
    );
    globe.add(sphere);

    const raw = landDots();
    const positions = new Float32Array((raw.length / 2) * 3);
    for (let i = 0, j = 0; i < raw.length; i += 2, j += 3) {
      const v = toVector(raw[i], raw[i + 1], 1.003);
      positions[j] = v.x;
      positions[j + 1] = v.y;
      positions[j + 2] = v.z;
    }
    const dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dotMaterial = new THREE.ShaderMaterial({
      vertexShader: DOT_VERTEX,
      fragmentShader: DOT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color('#6b6b6b') },
        uSize: { value: 4.2 * renderer.getPixelRatio() },
      },
    });
    globe.add(new THREE.Points(dotGeometry, dotMaterial));

    const arcs = new THREE.Group();
    globe.add(arcs);

    const state: Scene = {
      arcs,
      view: { rotX: 0.5, rotY: 1.7, zoom: 4.4 },
      lastInteraction: 0,
    };
    sceneRef.current = state;

    let minZoom = 2.4;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = `${width}px`;
      renderer.domElement.style.height = `${height}px`;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Keep the whole globe (plus arc headroom) in frame on narrow screens.
      const halfV = (camera.fov * DEG) / 2;
      const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
      minZoom = 1.17 / Math.sin(Math.min(halfV, halfH));
      state.view.zoom = Math.max(state.view.zoom, minZoom);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    // Pointer drag to spin, wheel to zoom.
    let drag: { x: number; y: number; id: number } | undefined;
    let velocity = { x: 0, y: 0 };
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
      state.view.targetX = state.view.targetY = undefined;
      state.lastInteraction = performance.now();
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const k = (0.0042 * state.view.zoom) / 4.4;
      velocity = { x: (e.clientX - drag.x) * k, y: (e.clientY - drag.y) * k };
      state.view.rotY += velocity.x;
      state.view.rotX = THREE.MathUtils.clamp(state.view.rotX + velocity.y, -1.3, 1.3);
      drag = { ...drag, x: e.clientX, y: e.clientY };
      state.lastInteraction = performance.now();
    };
    const up = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) {
        drag = undefined;
        el.style.cursor = 'grab';
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      state.view.zoom = THREE.MathUtils.clamp(state.view.zoom * (1 + e.deltaY * 0.001), minZoom * 0.7, 9);
      state.lastInteraction = performance.now();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = new THREE.Clock();
    const world = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const v = state.view;
      if (v.targetX !== undefined && v.targetY !== undefined) {
        let dy = v.targetY - v.rotY;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        v.rotY += dy * Math.min(1, dt * 4);
        v.rotX += (v.targetX - v.rotX) * Math.min(1, dt * 4);
        if (Math.abs(dy) < 0.002 && Math.abs(v.targetX - v.rotX) < 0.002)
          v.targetX = v.targetY = undefined;
      } else if (!drag) {
        // Inertia, then a slow idle spin once the user has let go for a while.
        velocity.x *= 0.92;
        velocity.y *= 0.92;
        v.rotY += velocity.x;
        v.rotX = THREE.MathUtils.clamp(v.rotX + velocity.y, -1.3, 1.3);
        if (!reduceMotion && performance.now() - state.lastInteraction > 6000) v.rotY += dt * 0.05;
      }
      camera.position.z += (v.zoom - camera.position.z) * Math.min(1, dt * 8);
      globe.rotation.set(v.rotX, v.rotY, 0);
      globe.updateMatrixWorld();
      for (const child of arcs.children) {
        const material = (child as THREE.Mesh).material as THREE.ShaderMaterial;
        material.uniforms.uTime.value = reduceMotion ? 0 : t;
      }
      renderer.render(scene, camera);

      // Project HTML markers.
      const { width, height } = container.getBoundingClientRect();
      for (const { el: marker, pos, top } of markers.current.values()) {
        world.copy(pos).applyMatrix4(globe.matrixWorld);
        toCam.copy(camera.position).sub(world);
        const facing = world.clone().normalize().dot(toCam.normalize());
        const ndc = world.project(camera);
        const x = ((ndc.x + 1) / 2) * width;
        const y = ((1 - ndc.y) / 2) * height;
        const opacity = THREE.MathUtils.smoothstep(facing, 0.02, 0.25);
        marker.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        marker.style.opacity = String(opacity);
        marker.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none';
        marker.style.zIndex = String(Math.round(facing * 100) + (top ? 400 : 100));
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | undefined;
        material?.dispose();
      });
      renderer.dispose();
      el.remove();
      sceneRef.current = null;
    };
  }, []);

  // Arcs from the operator to each placed robot, colored by connection state.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    for (const child of [...s.arcs.children]) {
      s.arcs.remove(child);
      (child as THREE.Mesh).geometry.dispose();
      ((child as THREE.Mesh).material as THREE.Material).dispose();
    }
    if (!operator) return;
    const focused = placed.some((r) => r.identity === selected) ? selected : undefined;
    const from = toVector(operator.lat, operator.lng);
    placed.forEach((robot, i) => {
      const to = toVector(robot.pinLat, robot.pinLng);
      if (from.angleTo(to) < 0.004) return;
      const curve = new THREE.CatmullRomCurve3(arcPoints(from, to));
      const dim = focused && focused !== robot.identity ? 0.35 : 1;
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 96, selected === robot.identity ? 0.007 : 0.0048, 6, false),
        new THREE.ShaderMaterial({
          vertexShader: ARC_VERTEX,
          fragmentShader: ARC_FRAGMENT,
          transparent: true,
          depthWrite: false,
          uniforms: {
            uColor: { value: new THREE.Color(CONNECTION_COLORS[robot.connection]) },
            uTime: { value: 0 },
            uPhase: { value: (i * 0.37) % 1 },
            uSpeed: { value: robot.connection === 'stale' ? 0.12 : 0.32 },
            uDashed: { value: robot.connection === 'offline' ? 1 : 0 },
            uDim: { value: dim },
          },
        }),
      );
      s.arcs.add(mesh);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arcKey]);

  // Face the operator when they first appear; face a robot when it's selected.
  const focusedOperator = useRef(false);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const target = selected ? placed.find((r) => r.identity === selected) : undefined;
    let spot: { lat: number; lng: number } | undefined = target;
    // A robot next to the operator is already in view: don't swing the globe around.
    if (target && operator && toVector(target.lat, target.lng).angleTo(toVector(operator.lat, operator.lng)) < 0.15)
      return;
    if (target && operator) {
      // Center between operator and robot so the selected link reads as an arc.
      const mid = toVector(operator.lat, operator.lng).add(toVector(target.lat, target.lng));
      if (mid.length() > 0.3) {
        mid.normalize();
        spot = { lat: Math.asin(mid.y) / DEG, lng: Math.atan2(mid.x, mid.z) / DEG };
      }
    }
    // Wait for the robots too, so the first view frames the whole fleet.
    if (!spot && operator && !focusedOperator.current && placed.length > 0) {
      // First view: center between the operator and the fleet so the links read as arcs.
      focusedOperator.current = true;
      const sum = toVector(operator.lat, operator.lng).multiplyScalar(2);
      for (const r of placed) sum.add(toVector(r.lat, r.lng));
      if (sum.length() < 0.3) sum.copy(toVector(operator.lat, operator.lng));
      sum.normalize();
      spot = { lat: Math.asin(sum.y) / DEG, lng: Math.atan2(sum.x, sum.z) / DEG };
    }
    if (!spot) return;
    s.view.targetY = -spot.lng * DEG;
    s.view.targetX = THREE.MathUtils.clamp(spot.lat * DEG, -1.1, 1.1);
    s.lastInteraction = performance.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, operator?.lat, operator?.lng, placed.length]);

  const register = (id: string, lat: number, lng: number) => (el: HTMLElement | null) => {
    if (!el) {
      markers.current.delete(id);
      return;
    }
    markers.current.set(id, {
      el,
      pos: toVector(lat, lng, 1.01),
      top: id === '__operator',
    });
  };

  return (
    <div className="fleet-globe" ref={host}>
      <div className="fleet-globe-canvas" ref={canvasHost} />
      <div className="fleet-globe-markers">
        {operator && (
          <div
            className="fleet-pin operator"
            ref={register('__operator', operator.lat, operator.lng)}
          >
            <span className="fleet-pin-icon">
              <User size={13} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="fleet-pin-label">
              You · {operator.label}
              {operator.approximate ? ' (approx.)' : ''}
            </span>
          </div>
        )}
        {placed.map((robot) => (
          <button
            key={robot.identity}
            type="button"
            className={`fleet-pin robot ${robot.connection} ${selected === robot.identity ? 'selected' : ''}`}
            style={{ '--pin': CONNECTION_COLORS[robot.connection] } as React.CSSProperties}
            ref={register(robot.identity, robot.pinLat, robot.pinLng)}
            onClick={() => onSelect(selected === robot.identity ? undefined : robot.identity)}
            aria-label={`${robot.name}, ${CONNECTION_LABELS[robot.connection]}`}
          >
            <span className="fleet-pin-icon">
              <Bot size={13} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="fleet-pin-label">
              {robot.name}
              <small>{CONNECTION_LABELS[robot.connection]}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
