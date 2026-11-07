'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Publication } from '@/lib/teleop/types';
import { useRuntime } from './context';

type Host = { video: HTMLVideoElement; dispose(): void };
const MediaContext = createContext<Map<string, Host>>(new Map());
export function useMediaHosts() {
  return useContext(MediaContext);
}

/** Media elements survive docking, visibility changes and tile swaps. */
export function MediaProvider({ children }: { children: ReactNode }) {
  const runtime = useRuntime();
  const [hosts] = useState(() => new Map<string, Host>());
  const parking = useRef<HTMLDivElement>(null);
  const ids = runtime
    .mediaPublications()
    .map((pub) => pub.id)
    .join('\0');
  const epoch = runtime.epoch;
  useEffect(() => {
    for (const host of hosts.values()) host.dispose();
    hosts.clear();
    const publications = runtime.mediaPublications();
    const wanted = new Set(publications.map((pub) => pub.id));
    for (const [id, host] of hosts)
      if (!wanted.has(id)) {
        host.dispose();
        hosts.delete(id);
      }
    for (const pub of publications) {
      if (hosts.has(pub.id)) continue;
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.title = pub.name;
      video.style.cssText =
        'width:100%;height:100%;object-fit:contain;display:block;background:#080d13';
      parking.current?.append(video);
      const detach = runtime.transport.attach(pub, video);
      const camera = runtime.cameras.cameras.get(pub.id);
      let stopped = false;
      let frameRequest: number | undefined;
      let lastFrame = 0;
      let lastMediaTime = -1;
      const count = (now: number, mediaTime?: number) => {
        if (runtime.cameras.cameras.get(pub.id) !== camera || video.readyState < 2 || video.videoWidth === 0) return;
        const total = video.getVideoPlaybackQuality?.().totalVideoFrames;
        if (total === undefined && mediaTime === undefined) return;
        const delta =
          total !== undefined
            ? Math.max(0, total - lastFrame)
            : mediaTime !== lastMediaTime
              ? 1
              : 0;
        if (delta > 0) {
          lastFrame = total ?? lastFrame + 1;
          lastMediaTime = mediaTime ?? lastMediaTime;
          runtime.cameras.frame(pub.id, now, delta);
        }
      };
      const schedule = () => {
        if (!video.requestVideoFrameCallback) return;
        frameRequest = video.requestVideoFrameCallback((now, metadata) => {
          if (stopped) return;
          count(now, metadata.mediaTime);
          runtime.cameras.presented(pub.id, now);
          schedule();
        });
      };
      schedule();
      // Real decoded-frame counters, never repeated UI render ticks, cover hidden media hosts.
      const timer = setInterval(() => count(performance.now()), 200);
      const playbackError = () => {
        if (camera && runtime.cameras.cameras.get(pub.id) === camera) camera.error = video.error?.message ?? 'Video playback failed.';
      };
      video.addEventListener('error', playbackError);
      void video.play().catch((error: Error) => {
        if (camera && runtime.cameras.cameras.get(pub.id) === camera) camera.error = `Playback blocked: ${error.message}`;
      });
      hosts.set(pub.id, {
        video,
        dispose: () => {
          stopped = true;
          if (frameRequest !== undefined) video.cancelVideoFrameCallback(frameRequest);
          clearInterval(timer);
          video.removeEventListener('error', playbackError);
          detach();
          video.remove();
        },
      });
    }
    runtime.notify();
  }, [runtime, ids, epoch, hosts]);
  useEffect(
    () => () => {
      for (const host of hosts.values()) host.dispose();
      hosts.clear();
    },
    [hosts],
  );
  return (
    <MediaContext.Provider value={hosts}>
      <div ref={parking} className="workspace-media-parking" aria-hidden="true" />
      {children}
    </MediaContext.Provider>
  );
}

function AutomaticVideo({ id }: { id: string }) {
  const hosts = useContext(MediaContext);
  const container = useRef<HTMLDivElement>(null);
  const host = hosts.get(id);
  useEffect(() => {
    const video = host?.video;
    if (!video || !container.current) return;
    const parent = video.parentElement;
    container.current.append(video);
    return () => {
      parent?.append(video);
    };
  }, [host]);
  return <div ref={container} className="workspace-video" />;
}

export function Cameras() {
  const runtime = useRuntime();
  const deck = runtime.cameras;
  const rate = runtime.config?.default_video_rate_hz ?? 30;
  const positions = [...deck.tiles, ...deck.pending()];
  return (
    <div className="camera-deck">
      {!deck.main && (
        <div className="camera-waiting">
          <span className="workspace-eyebrow">LIVE VIDEO</span>
          <h2>Waiting for camera frames</h2>
          <p>Eligible cameras appear automatically after discovery.</p>
        </div>
      )}
      {[...deck.cameras.values()].map((camera) => {
        const main = deck.main === camera.id;
        const slot = positions.indexOf(camera.id);
        const status = deck.status(camera.id, runtime.clock.now(), rate);
        return (
          <div
            key={camera.id}
            className={`camera-frame ${main ? 'camera-main' : 'camera-tile'}`}
            style={{
              gridColumn: main ? 2 : 1,
              gridRow: main ? `1 / span ${Math.max(1, positions.length)}` : slot + 1,
            }}
          >
            <AutomaticVideo id={camera.id} />
            {!camera.ready && <div className="camera-loading">Loading frames…</div>}
            {!main && camera.ready && (
              <button
                className="camera-select"
                aria-label={`Promote ${camera.name}`}
                onClick={() => {
                  deck.select(camera.id);
                  runtime.notify();
                }}
              />
            )}
            <div className="camera-caption">
              <span>{camera.name}</span>
              <span className={`status status-${status}`}>
                {status} · {deck.observedRate(camera.id, runtime.clock.now(), rate).toFixed(1)} FPS
              </span>
            </div>
            {camera.error && <p className="camera-problem">{camera.error}</p>}
          </div>
        );
      })}
      {deck.notice && (
        <p className="camera-notice" role="status">
          {deck.notice}
        </p>
      )}
    </div>
  );
}

export function ExtraVideo({
  publication,
  stereo,
  eye,
}: {
  publication: Publication;
  stereo?: boolean;
  eye?: 'left' | 'right';
}) {
  const runtime = useRuntime();
  const ref = useRef<HTMLVideoElement>(null);
  const currentPub = useRef(publication);
  useEffect(() => {
    currentPub.current = publication;
  }, [publication]);
  useEffect(() => {
    const element = ref.current!;
    const detach = runtime.transport.attach(currentPub.current, element);
    void element.play().catch(() => {});
    return detach;
  }, [runtime, publication.id, runtime.epoch]);
  return (
    <div className={`extra-video ${stereo ? 'stereo-video' : ''}`}>
      <video
        ref={ref}
        autoPlay
        muted
        playsInline
        style={
          stereo
            ? {
                width: '200%',
                maxWidth: 'none',
                transform: eye === 'right' ? 'translateX(-50%)' : undefined,
              }
            : undefined
        }
      />
    </div>
  );
}

export function AudioView({
  active,
  publication,
  volume,
  muted,
}: {
  active: boolean;
  publication?: Publication;
  volume: number;
  muted: boolean;
}) {
  const runtime = useRuntime();
  const ref = useRef<HTMLAudioElement>(null);
  const [listening, setListening] = useState(false);
  const [playback, setPlayback] = useState('Listening is off');
  const currentPub = useRef(publication);
  useEffect(() => {
    currentPub.current = publication;
  }, [publication]);
  useEffect(() => {
    const pub = currentPub.current;
    const element = ref.current!;
    if (!active || !listening || !pub || runtime.discovery !== 'ready') return;
    const release = runtime.listen(pub.name);
    const detach = runtime.transport.attach(pub, element);
    void element
      .play()
      .then(() =>
        setPlayback(runtime.transport.fixture ? 'Fixture: no microphone input' : 'Listening'),
      )
      .catch((error: Error) =>
        setPlayback(
          `Playback blocked: ${error.message}. Select Listen again after enabling browser audio.`,
        ),
      );
    return () => {
      element.pause();
      detach();
      release();
    };
  }, [runtime, active, listening, publication?.id, runtime.discovery, runtime.epoch]);
  useEffect(() => {
    if (ref.current) {
      ref.current.volume = volume;
      ref.current.muted = muted;
    }
  }, [volume, muted]);
  // Live robot audio does not publish a caption track.
  return (
    <div className="audio-view">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={ref} />
      <button disabled={!publication} onClick={() => setListening((value) => !value)}>
        {listening ? 'Stop listening' : 'Listen'}
      </button>
      <p role="status">{listening ? playback : 'Listening is off'}</p>
      <p className="muted">Quiet audio is valid. Audio has no missing-sample timer.</p>
    </div>
  );
}
