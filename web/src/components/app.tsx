'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ScaleVertical } from '@/components/scale-vertical';
import { ScaleHorizontal } from '@/components/scale-horizontal';
import { BottomBar } from '@/components/bottom-bar';
import { Joystick } from '@/components/joystick';
import { useSessionContext, useTracks, VideoTrack } from '@livekit/components-react';
import { useAcquireControl } from '@/hooks/use-acquire-control';
import { useControlCmdTrack } from '@/hooks/use-control-cmd-track';
import { usePanTilt } from '@/hooks/use-pan-tilt';
import { useVideoFitContainer } from '@/hooks/use-video-fit-container';
import { ConnectionState, Track } from 'livekit-client';
import { Button } from '@/components/button';

import logo from './logo.svg';

const ROBOT_IDENTITY = process.env.NEXT_PUBLIC_ROBOT_IDENTITY || '';

export function App() {
  const session = useSessionContext();
  const { pan, tilt } = usePanTilt();
  const [mainVideoTrack] = useTracks([Track.Source.Camera]);
  const [depthVideoTrack] = useTracks([Track.Source.ScreenShare]);
  const [mainVideoEl, setMainVideoEl] = useState<HTMLVideoElement | null>(null);

  const { mode, isRpcPending, isOperatorModeLocked, handleModeRequest } = useAcquireControl({
    identity: ROBOT_IDENTITY,
    isConnected: session.isConnected,
  });

  const { pushControlCmd } = useControlCmdTrack(mode === 'operate' && session.isConnected);

  useVideoFitContainer(mainVideoEl);

  return (
    <div className="flex h-dvh flex-col bg-black">
      {/* Header */}
      <header className="fixed top-6 left-6 z-50 flex items-baseline gap-4">
        <Image src={logo} alt="TeleOps UI" className="size-4" />
        <h1 className="font-mono text-xl font-light tracking-widest text-white uppercase">
          Robotics
        </h1>
      </header>

      {/* Connect button */}
      {!session.isConnected && (
        <div className="absolute top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
          <Button type="button" onClick={() => session.start()}>
            {session.connectionState === ConnectionState.Connecting ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      )}

      {/* Main viewport area */}
      <div
        className="relative flex-1 bg-size-[33dvh_33dvh] bg-center"
        style={{
          backgroundImage: [
            'linear-gradient(0deg, color-mix(in oklch, var(--primary-foreground) 10%, transparent) 1px, transparent 1px)',
            'linear-gradient(90deg, color-mix(in oklch, var(--primary-foreground) 10%, transparent) 1px, transparent 1px)',
          ].join(', '),
        }}
      >
        {/* Fullscreen video placeholder */}
        <div className="absolute inset-x-36 inset-y-20">
          <div className="flex h-full w-full items-center justify-center">
            {mainVideoTrack ? (
              <VideoTrack
                ref={setMainVideoEl}
                trackRef={mainVideoTrack}
                width={mainVideoTrack.publication.dimensions?.width}
                height={mainVideoTrack.publication.dimensions?.height}
                className="border-accent-foreground/50 rounded border"
              />
            ) : (
              // <div className="aspect-4/3 h-full max-w-full mx-auto bg-black border border-accent-foreground/20 rounded" />
              <></>
            )}
          </div>
        </div>

        {/* Small PiP video - top right */}
        <div className="bg-accent-foreground absolute top-6 right-6 z-10 overflow-hidden rounded">
          {depthVideoTrack ? (
            <VideoTrack
              trackRef={depthVideoTrack}
              className="border-accent-foreground/20 h-[100px] rounded border mix-blend-multiply"
            />
          ) : (
            // <div className="aspect-4/3 h-[100px] grid place-content-center rounded">
            //   <Image
            //     src={logo}
            //     alt="TeleOps UI"
            //     className="size-8 opacity-10"
            //   />
            // </div>
            <></>
          )}
        </div>

        {/* Debug info */}
        {session.isConnected && (
          <>
            <div className="text-muted-foreground/50 absolute bottom-3 left-3 flex flex-col gap-2 font-mono text-xs">
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <div>Pan:</div>
                <div className="text-accent-foreground/50">{pan}°</div>
                <div>Tilt:</div>
                <div className="text-accent-foreground/50">{tilt}°</div>
              </div>
              <div>
                Control Available:{' '}
                <span className="text-accent-foreground/50">
                  {isOperatorModeLocked ? 'No' : 'Yes'}
                </span>
              </div>
            </div>
            {/* Vertical degree scale (pitch) - left side */}
            <ScaleVertical
              value={tilt}
              className="absolute top-1/2 left-2 z-10 h-[500px] -translate-y-1/2"
            />

            {/* Horizontal degree scale (yaw) - bottom */}
            <ScaleHorizontal
              value={pan}
              className="absolute bottom-2 left-1/2 z-10 w-[700px] -translate-x-1/2"
            />

            <Joystick
              mode={mode}
              onVelocities={pushControlCmd}
              disabled={mode === 'view'}
              className="absolute right-6 bottom-6 z-20 bg-black"
            />
          </>
        )}
      </div>

      {/* Bottom status bar */}
      <BottomBar
        mode={mode}
        isRpcPending={isRpcPending}
        onModeRequest={handleModeRequest}
        isOperatorModeLocked={isOperatorModeLocked}
      />
    </div>
  );
}
