"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { ScaleVertical } from "@/components/scale-vertical";
import { ScaleHorizontal } from "@/components/scale-horizontal";
import { BottomBar } from "@/components/bottom-bar";
import { Joystick } from "@/components/joystick";
import { Mode } from "@/lib/types";
import logo from "./logo.svg";
import { useRemoteParticipants, useSessionContext } from "@livekit/components-react";
import { useDataTracks } from "@/hooks/use-data-tracks";

export function App() {
  const [pitch, setPitch] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [mode, setMode] = useState<Mode>("view");
  const [isOperatorModeLocked, setIsOperatorModeLocked] = useState(false);

  const session = useSessionContext();
  const dataTracks = useDataTracks(session.room);
  const remoteParticipants = useRemoteParticipants();

  useEffect(() => {
    console.log("!!! REMOTE PARTICIPANTS: ", remoteParticipants);
  }, [remoteParticipants]);

  useEffect(() => {
    console.log("!!! DATA TRACKS: ", dataTracks);
  }, [dataTracks]);

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
        <div
          className="absolute inset-0 bg-size-[33dvh_33dvh] bg-center"
          style={{
            backgroundImage: [
              "linear-gradient(0deg, color-mix(in oklch, var(--primary-foreground) 10%, transparent) 1px, transparent 1px)",
              "linear-gradient(90deg, color-mix(in oklch, var(--primary-foreground) 10%, transparent) 1px, transparent 1px)",
            ].join(", "),
          }}
        />

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
            <span className="text-accent-foreground/50">{isOperatorModeLocked ? "No" : "Yes"}</span>
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
      <BottomBar mode={mode} setMode={setMode} isOperatorModeLocked={isOperatorModeLocked} />
    </div>
  );
}
