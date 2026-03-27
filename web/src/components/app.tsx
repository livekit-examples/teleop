"use client";

import Image from "next/image";
import { ScaleVertical } from "@/components/scale-vertical";
import { ScaleHorizontal } from "@/components/scale-horizontal";
import { BottomBar } from "@/components/bottom-bar";
import { Joystick } from "@/components/joystick";
import logo from "./logo.svg";
import { useSessionContext, useTracks, VideoTrack } from "@livekit/components-react";
import { useAcquireControl } from "@/hooks/use-acquire-control";
import { usePanTilt } from "@/hooks/use-pan-tilt";
import { Track } from "livekit-client";

const ROBOT_IDENTITY = process.env.NEXT_PUBLIC_ROBOT_IDENTITY || "";

export function App() {
  const session = useSessionContext();
  const { pan, tilt } = usePanTilt();
  const [mainVideoTrack] = useTracks([Track.Source.Camera]);
  const [depthVideoTrack] = useTracks([Track.Source.ScreenShare]);

  const { mode, isRpcPending, isOperatorModeLocked, handleModeRequest } = useAcquireControl({
    identity: ROBOT_IDENTITY,
    isConnected: session.isConnected,
  });

  return (
    <div className="flex h-dvh flex-col bg-black">
      {/* Header */}
      <header className="fixed top-6 left-6 flex items-baseline gap-4">
        <Image src={logo} alt="TeleOps UI" className="size-4" />
        <h1 className="font-mono text-xl font-light tracking-widest text-white uppercase">
          Robotics
        </h1>
      </header>

      {/* Main viewport area */}
      <div className="relative flex-1">
        {/* Fullscreen video placeholder */}
        <div className="absolute inset-y-20 inset-x-36">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-full w-full">
            {mainVideoTrack ? (
              <VideoTrack
                trackRef={mainVideoTrack}
                className="h-full rounded overflow-hidden mx-auto"
              />
            ) : (
              // <div className="aspect-4/3 h-full max-w-full mx-auto bg-black border border-accent-foreground/20 rounded" />
              <></>
            )}
          </div>
        </div>

        {/* Small PiP video - top right */}
        <div className="absolute top-6 right-6 z-10 rounded bg-black border-accent-foreground/20 border">
          {depthVideoTrack ? (
            <VideoTrack trackRef={depthVideoTrack} className="h-[100px]" />
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
        <div className="text-muted-foreground/50 absolute bottom-3 left-3 flex flex-col gap-2 font-mono text-xs">
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <div>Pan:</div>
            <div className="text-accent-foreground/50">{pan}°</div>
            <div>Tilt:</div>
            <div className="text-accent-foreground/50">{tilt}°</div>
          </div>
          <div>
            Operator Seat Available:{" "}
            <span className="text-accent-foreground/50">
              {/* {isOperatorModeLocked ? "No" : "Yes"} */}
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
          disabled={mode === "view"}
          className="absolute right-6 bottom-6 z-20 bg-black"
        />
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
