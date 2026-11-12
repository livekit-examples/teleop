"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Mesh } from "three";
import type { WorkspaceRuntime } from "@/lib/teleop/runtime";
import { useRuntime } from "../context";
import { THEME, VrCanvasPanel, dot, fillRound, fit, text, type Painter } from "./canvas-panel";
import { useVrEyeOffsetCm } from "./vr-settings";
import { eyeGeometry, useLeftEyeGeometry, useVideoAspect, useVideoTexture } from "./vr-video";

export type VrCamera = {
  id: string;
  name: string;
  video?: HTMLVideoElement;
  /** Side-by-side stereo, from the camera_info of the robot. */
  stereo: boolean;
  status: string;
  fps: number;
  error?: string;
};

/** The ready cameras of the workspace, main first, with the live video element of each. */
export function useVrCameras(runtime: WorkspaceRuntime, hosts: Map<string, { video: HTMLVideoElement }>): VrCamera[] {
  const deck = runtime.cameras;
  const rate = runtime.config?.default_video_rate_hz ?? 30;
  const now = runtime.clock.now();
  const stereoTracks = new Set(
    Object.values(runtime.config?.camera_info ?? {})
      .filter((info) => "left" in info.views)
      .map((info) => info.track_name),
  );
  return [deck.main, ...deck.tiles].flatMap((id) => {
    const camera = id ? deck.cameras.get(id) : undefined;
    if (!id || !camera) return [];
    return [
      {
        id,
        name: camera.name,
        video: hosts.get(id)?.video,
        stereo: stereoTracks.has(camera.name),
        status: deck.status(id, now, rate),
        fps: deck.observedRate(id, now, rate),
        error: camera.error,
      },
    ];
  });
}

const statusColor = (status: string) =>
  status === "healthy" ? THEME.success : status === "starting" || status === "stale" ? THEME.moderate : THEME.serious;

/** One side-by-side frame. The left half goes to the left eye and the right half to the right eye. */
function StereoMeshes({ video, width, height }: { video: HTMLVideoElement; width: number; height: number }) {
  const texture = useVideoTexture(video);
  const eyeOffset = useVrEyeOffsetCm() / 100;
  const leftGeometry = useMemo(() => eyeGeometry("left"), []);
  const rightGeometry = useMemo(() => eyeGeometry("right"), []);
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);
  useEffect(() => {
    left.current?.layers.set(1);
    right.current?.layers.set(2);
    return () => {
      leftGeometry.dispose();
      rightGeometry.dispose();
    };
  }, [leftGeometry, rightGeometry]);
  return (
    <>
      <mesh ref={left} geometry={leftGeometry} position={[-eyeOffset, 0, 0]} scale={[width, height, 1]} pointerEvents="none">
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh ref={right} geometry={rightGeometry} position={[eyeOffset, 0, 0]} scale={[width, height, 1]} pointerEvents="none">
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </>
  );
}

function MonoMesh({ video, width, height }: { video: HTMLVideoElement; width: number; height: number }) {
  const texture = useVideoTexture(video);
  return (
    <mesh scale={[width, height, 1]} pointerEvents="none">
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

const MAIN_WIDTH = 1.8;
const MAIN_MAX_HEIGHT = 1.35;
export const MAIN_CENTER: [number, number, number] = [0, 1.55, -1.8];

/** A video in a panel, at one place. The size follows the video, up to the given box. */
export function VrVideo({
  video,
  stereo,
  width,
  maxHeight,
  position,
  rotation,
}: {
  video: HTMLVideoElement | undefined;
  stereo: boolean;
  width: number;
  maxHeight: number;
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const aspect = useVideoAspect(video, stereo);
  const height = Math.min(width / aspect, maxHeight);
  return (
    <group position={position} rotation={rotation}>
      {video &&
        (stereo ? (
          <StereoMeshes video={video} width={width} height={height} />
        ) : (
          <MonoMesh video={video} width={width} height={height} />
        ))}
    </group>
  );
}

function mainHeight(video: HTMLVideoElement | undefined, stereo: boolean) {
  const eye = video && video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / (stereo ? 2 : 1) / video.videoHeight : 16 / 9;
  return Math.min(MAIN_WIDTH / eye, MAIN_MAX_HEIGHT);
}

/** The main camera, straight ahead, with its name and rate along the lower edge. */
export function VrMainCamera({ cameras }: { cameras: VrCamera[] }) {
  const main = cameras[0];
  const aspect = useVideoAspect(main?.video, !!main?.stereo);
  const height = Math.min(MAIN_WIDTH / aspect, MAIN_MAX_HEIGHT);
  const paintCaption = (p: Painter) => {
    if (!main) return;
    fillRound(p.ctx, { x: 0, y: 0, w: p.width, h: p.height }, 0, "rgba(0, 0, 0, 0.55)");
    dot(p, 36, p.height / 2, statusColor(main.status), 10);
    text(p, fit(p, main.name, 700, 30, 600), 62, p.height / 2 + 1, { size: 30, weight: 600, color: THEME.fg0 });
    text(p, `${main.status} · ${main.fps.toFixed(1)} FPS`, p.width - 28, p.height / 2 + 1, {
      size: 28,
      mono: true,
      color: statusColor(main.status),
      align: "right",
    });
  };
  const paintEmpty = (p: Painter) => {
    fillRound(p.ctx, { x: 3, y: 3, w: p.width - 6, h: p.height - 6 }, 24, "rgba(7, 7, 7, 0.97)", THEME.line2, 4);
    text(p, "LIVE VIDEO", p.width / 2, p.height / 2 - 60, { size: 26, weight: 600, mono: true, color: THEME.accent, align: "center" });
    text(p, "Waiting for camera frames", p.width / 2, p.height / 2, { size: 48, weight: 600, color: THEME.fg0, align: "center" });
    text(p, "Eligible cameras appear automatically after discovery.", p.width / 2, p.height / 2 + 60, { size: 28, color: THEME.fg3, align: "center" });
  };
  if (!main)
    return (
      <VrCanvasPanel position={MAIN_CENTER} width={MAIN_WIDTH} canvasWidth={1280} canvasHeight={760} paint={paintEmpty} />
    );
  return (
    <>
      <VrVideo video={main.video} stereo={main.stereo} width={MAIN_WIDTH} maxHeight={MAIN_MAX_HEIGHT} position={MAIN_CENTER} />
      <VrCanvasPanel
        position={[0, MAIN_CENTER[1] - height / 2 + 0.035, MAIN_CENTER[2] + 0.01]}
        width={MAIN_WIDTH}
        canvasWidth={1440}
        canvasHeight={56}
        paint={paintCaption}
      />
    </>
  );
}

const THUMB_MAX_WIDTH_M = 0.4;
const THUMB_GAP_M = 0.04;
const BORDER_M = 0.012;

function Thumbnail({
  camera,
  left,
  top,
  width,
  onSelect,
}: {
  camera: VrCamera;
  left: number;
  top: number;
  width: number;
  onSelect(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const aspect = useVideoAspect(camera.video, camera.stereo);
  const geometry = useLeftEyeGeometry(camera.stereo);
  const texture = camera.video ? <ThumbnailTexture video={camera.video} /> : <meshBasicMaterial color={THEME.bg2} toneMapped={false} />;
  const height = width / aspect;
  const scale = hovered ? 1.06 : 1;
  const paintLabel = (p: Painter) => {
    fillRound(p.ctx, { x: 0, y: 0, w: p.width, h: p.height }, 0, "rgba(7, 7, 7, 0.78)");
    text(p, fit(p, camera.name, p.width - 40, 36, 600), 20, p.height / 2 + 1, { size: 36, weight: 600, color: THEME.fg0 });
  };
  const labelHeight = Math.min(width * (72 / 512), height / 2);
  return (
    <group position={[left + width / 2, top - height / 2, 0]} scale={[scale, scale, 1]}>
      <mesh
        scale={[width + BORDER_M * 2, height + BORDER_M * 2, 1]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={onSelect}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={hovered ? THEME.accent : THEME.line2} toneMapped={false} />
      </mesh>
      <mesh geometry={geometry} position={[0, 0, 0.001]} scale={[width, height, 1]} pointerEvents="none">
        {texture}
      </mesh>
      <group position={[0, -height / 2 + labelHeight / 2, 0.002]}>
        <VrCanvasPanel position={[0, 0, 0]} width={width} canvasWidth={512} canvasHeight={72} paint={paintLabel} />
      </group>
    </group>
  );
}

function ThumbnailTexture({ video }: { video: HTMLVideoElement }) {
  const texture = useVideoTexture(video);
  return <meshBasicMaterial map={texture} toneMapped={false} />;
}

/** The top edge of the thumbnail row, which is also the line of the toolbar beside it. */
export function cameraRowTop(cameras: VrCamera[]) {
  const bottom = MAIN_CENTER[1] - mainHeight(cameras[0]?.video, !!cameras[0]?.stereo) / 2;
  return Math.min(0.8125, bottom - 0.06);
}

/** Thumbnails of the other cameras, under the main view. Select one to promote it. */
export function VrCameraRow({ cameras }: { cameras: VrCamera[] }) {
  const runtime = useRuntime();
  const tiles = cameras.slice(1);
  if (!tiles.length) return null;
  const maxWidth = 1.15;
  const width = Math.min(THUMB_MAX_WIDTH_M, (maxWidth - THUMB_GAP_M * (tiles.length - 1)) / tiles.length);
  const top = cameraRowTop(cameras);
  return (
    <group position={[0, 0, MAIN_CENTER[2]]}>
      {tiles.map((camera, index) => (
        <Thumbnail
          key={camera.id}
          camera={camera}
          left={-0.9 + index * (width + THUMB_GAP_M)}
          top={top}
          width={width}
          onSelect={() => {
            runtime.cameras.select(camera.id);
            runtime.notify();
          }}
        />
      ))}
    </group>
  );
}
