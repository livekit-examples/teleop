import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, PlaneGeometry, SRGBColorSpace, VideoTexture } from "three";

/** The width to height ratio of one eye of a side-by-side video, or of a mono video. */
export function useVideoAspect(video: HTMLVideoElement | null | undefined, stereo: boolean) {
  const read = () => {
    if (!video) return 16 / 9;
    const width = video.videoWidth / (stereo ? 2 : 1);
    return width > 0 && video.videoHeight > 0 ? width / video.videoHeight : 16 / 9;
  };
  const [aspect, setAspect] = useState(read);
  useEffect(() => {
    const update = () => setAspect(read());
    update();
    if (!video) return;
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("resize", update);
    return () => {
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("resize", update);
    };
    // `read` closes over `video` and `stereo`, which are the only inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, stereo]);
  return aspect;
}

export function useVideoTexture(video: HTMLVideoElement) {
  const texture = useMemo(() => {
    const next = new VideoTexture(video);
    next.colorSpace = SRGBColorSpace;
    return next;
  }, [video]);
  useEffect(() => () => texture.dispose(), [texture]);
  // Upload a frame when the video has a new one. The built-in video callback can stop while the
  // page is hidden behind the headset view, and a texture that never updates draws black.
  const last = useRef(-1);
  useFrame(() => {
    if (video.readyState < 2) return;
    // Decoded frames count new frames. A live stream can hold currentTime still.
    const mark = video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.currentTime;
    if (mark === last.current) return;
    last.current = mark;
    texture.needsUpdate = true;
  });
  return texture;
}

/** A unit plane that shows one half of a side-by-side stereo frame. */
export function eyeGeometry(eye: "left" | "right") {
  const geometry = new PlaneGeometry(1, 1);
  const uv = geometry.getAttribute("uv") as BufferAttribute;
  const offset = eye === "right" ? 0.5 : 0;
  for (let index = 0; index < uv.count; index++) uv.setX(index, uv.getX(index) * 0.5 + offset);
  uv.needsUpdate = true;
  return geometry;
}

/** A unit plane that shows the left half of a stereo video, or all of a mono video. */
export function useLeftEyeGeometry(stereo: boolean) {
  const geometry = useMemo(() => (stereo ? eyeGeometry("left") : new PlaneGeometry(1, 1)), [stereo]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}
