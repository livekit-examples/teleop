import type { Sighting } from './hand-teleop';
import type { V3 } from './linalg';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

type Landmarker = {
  detectForVideo(
    video: HTMLVideoElement,
    ms: number,
  ): {
    handedness: { categoryName: string }[][];
    landmarks: { x: number; y: number }[][];
    worldLandmarks: { x: number; y: number; z: number }[][];
  };
  close(): void;
};

/**
 * The webcam and MediaPipe's hand landmarker. Detection runs on the raw frame, and only the
 * preview is mirrored, because the model labels a hand as it appears in the image it is given.
 */
export class HandTracker {
  readonly video = document.createElement('video');
  private stream?: MediaStream;
  private landmarker?: Landmarker;
  private seq = 0;
  private lastTime = -1;
  private latestSighting: Sighting | null = null;

  async start() {
    if (!window.isSecureContext)
      throw new Error(
        'Hand tracking needs HTTPS or localhost, because the browser blocks the webcam on other pages.',
      );
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera unavailable in this browser.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: 30 },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO' as const,
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = (await HandLandmarker.createFromOptions(
        files,
        options('GPU'),
      )) as Landmarker;
    } catch {
      this.landmarker = (await HandLandmarker.createFromOptions(
        files,
        options('CPU'),
      )) as Landmarker;
    }
  }

  /** Detect on the newest webcam frame, if there is one since the last call. */
  poll(now: number): Sighting | null {
    const video = this.video;
    if (!this.landmarker || video.readyState < 2 || video.videoWidth === 0)
      return this.latestSighting;
    if (video.currentTime === this.lastTime) return this.latestSighting;
    this.lastTime = video.currentTime;
    const { videoWidth: w, videoHeight: h } = video;
    const result = this.landmarker.detectForVideo(video, now);
    this.latestSighting = {
      seq: ++this.seq,
      at: now,
      width: w,
      height: h,
      hands: result.handedness.map((handed, i) => ({
        label: handed[0].categoryName.toLowerCase() === 'left' ? 'left' : 'right',
        image: result.landmarks[i].map((p) => [p.x * w, p.y * h] as [number, number]),
        world: result.worldLandmarks[i].map((p) => [p.x, p.y, p.z] as V3),
      })),
    };
    return this.latestSighting;
  }

  stop() {
    this.landmarker?.close();
    this.landmarker = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    this.latestSighting = null;
  }
}
