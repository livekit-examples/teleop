"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ScaleVertical } from "@/components/scale-vertical";
import { ScaleHorizontal } from "@/components/scale-horizontal";
import { BottomBar } from "@/components/bottom-bar";
import { Joystick } from "@/components/joystick";
import { Mode } from "@/lib/types";
import logo from "./logo.svg";
import { useSessionContext, useTracks, VideoTrack } from "@livekit/components-react";
import { useAcquireControl } from "@/hooks/use-acquire-control";
import { useDataTracks } from "@/hooks/use-data-tracks";
import { useServoTelemetryFromDataTracks } from "@/hooks/use-servo-telemetry-from-data-tracks";
import { Track } from "livekit-client";

export function App() {
  const [pitch, setPitch] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [mode, setMode] = useState<Mode>("view");

  const session = useSessionContext();
  const { room } = session;

  const remoteParticipants = Array.from(room?.remoteParticipants.values() || []);

  const robotIdentity = remoteParticipants[0]?.identity;

  const { acquireOperator, releaseOperator, isOperatorModeLocked, isRpcPending } =
    useAcquireControl({
      identity: robotIdentity,
      isConnected: session.isConnected,
    });

  const handleModeRequest = async (next: Mode) => {
    if (next === "operate") {
      const ok = await acquireOperator();
      if (ok) setMode("operate");
    } else {
      await releaseOperator();
      setMode("view");
    }
  };

  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    return () => {
      if (modeRef.current === "operate") {
        void releaseOperator();
      }
    };
  }, [releaseOperator]);
  const dataTracks = useDataTracks(session.room);
  const videoTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);

  useServoTelemetryFromDataTracks(dataTracks, setYaw, setPitch);

  const mainVideoTrack = videoTracks.find((track) => track.source === Track.Source.Camera);
  const depthVideoTrack = videoTracks.find((track) => track.source === Track.Source.ScreenShare);

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
              <div className="aspect-4/3 h-full max-w-full mx-auto bg-black border border-accent-foreground/20 rounded" />
            )}
          </div>
        </div>

        {/* Small PiP video - top right */}
        <div className="absolute top-6 right-6 z-10 aspect-4/3 w-[160px] rounded bg-black">
          <div className="bg-accent-foreground/5 border-accent-foreground/10 absolute inset-0 grid place-content-center rounded border">
            <Image src={logo} alt="TeleOps UI" className="size-8 opacity-10" />
          </div>
        </div>

        {/* Debug info */}
        <div className="text-muted-foreground/50 absolute bottom-3 left-3 flex flex-col gap-2 font-mono text-xs">
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <div>Yaw:</div>
            <div className="text-accent-foreground/50">{yaw}°</div>
            <div>Pitch:</div>
            <div className="text-accent-foreground/50">{pitch}°</div>
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
          value={pitch}
          className="absolute top-1/2 left-2 z-10 h-[500px] -translate-y-1/2"
        />

        {/* Horizontal degree scale (yaw) - bottom */}
        <ScaleHorizontal
          value={yaw}
          className="absolute bottom-2 left-1/2 z-10 w-[700px] -translate-x-1/2"
        />

        <Joystick
          mode={mode}
          setYaw={setYaw}
          setPitch={setPitch}
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
