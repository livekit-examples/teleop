"use client";

import { useState } from "react";
import { ScaleVertical } from "@/components/scale-vertical";
import { ScaleHorizontal } from "@/components/scale-horizontal";
import { StatusBar } from "@/components/status-bar";
import { Joystick } from "@/components/joystick";
import { useSessionContext, useTracks, VideoTrack } from "@livekit/components-react";
import { useAcquireControl } from "@/hooks/use-acquire-control";
import { useControlCmdTrack } from "@/hooks/use-control-cmd-track";
import { useGyro } from "@/hooks/use-gyro";
import { usePanTilt } from "@/hooks/use-pan-tilt";
import { useVideoFitContainer } from "@/hooks/use-video-fit-container";
import { ConnectionState, Track } from "livekit-client";
import { Button } from "@/components/button";
import { PowerIcon } from "lucide-react";
import { motion, AnimatePresence, type Transition } from "motion/react";

const ROBOT_IDENTITY = process.env.NEXT_PUBLIC_ROBOT_IDENTITY || "";

const ANIMATION_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const ANIMATION_TRANSITION: Transition = {
  duration: 0.2,
  ease: "easeInOut",
};

export function App() {
  const session = useSessionContext();
  const gyro = useGyro(ROBOT_IDENTITY);
  const { pan, tilt } = usePanTilt(ROBOT_IDENTITY);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [mainVideoTrack] = useTracks([Track.Source.Camera]);
  const [depthVideoTrack] = useTracks([Track.Source.ScreenShare]);
  const [mainVideoEl, setMainVideoEl] = useState<HTMLVideoElement | null>(null);

  const { mode, isRpcPending, isOperatorModeLocked, handleModeRequest } = useAcquireControl({
    identity: ROBOT_IDENTITY,
    isConnected: session.isConnected,
  });

  const { pushControlCmd } = useControlCmdTrack(mode === "operate" && session.isConnected);

  useVideoFitContainer(mainVideoEl);

  return (
    <div className="relative h-dvh">
      <AnimatePresence>
        {/* Connect button */}
        {!session.isConnected && (
          <motion.div
            key="connect-button"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
            className="absolute top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2"
          >
            <Button type="button" onClick={() => session.start()}>
              <PowerIcon size={24} className="text-foreground size-4" />
              {session.connectionState === ConnectionState.Connecting
                ? "Connecting… "
                : "Connect to "}{" "}
              <span className="text-foreground font-bold">{ROBOT_IDENTITY}</span>
            </Button>
          </motion.div>
        )}

        {/* Fullscreen video placeholder */}
        {session.isConnected && (
          <motion.div
            key="main-video-placeholder"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
            className="absolute inset-x-36 top-12 bottom-36"
          >
            <div className="flex h-full w-full items-center justify-center">
              {mainVideoTrack ? (
                <VideoTrack
                  ref={setMainVideoEl}
                  trackRef={mainVideoTrack}
                  width={mainVideoTrack.publication.dimensions?.width}
                  height={mainVideoTrack.publication.dimensions?.height}
                  className="rounded border"
                />
              ) : null}
            </div>
          </motion.div>
        )}

        {/* Small PiP video - top right */}
        {session.isConnected && depthVideoTrack && (
          <motion.div
            key="depth-video-placeholder"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
            className="absolute top-6 right-6 z-10 overflow-hidden rounded border"
          >
            <div className="bg-foreground">
              <VideoTrack trackRef={depthVideoTrack} className="h-[100px] mix-blend-multiply" />
            </div>
          </motion.div>
        )}

        {session.isConnected && (
          <motion.div
            key="scale-vertical"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
          >
            {/* Vertical degree scale (pitch) */}
            <ScaleVertical
              value={tilt}
              className="absolute top-1/2 left-2 z-10 h-[500px] -translate-y-1/2"
            />
          </motion.div>
        )}

        {session.isConnected && (
          <motion.div
            key="scale-horizontal"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
          >
            {/* Horizontal degree scale (yaw)  */}
            <ScaleHorizontal
              value={pan}
              className="absolute bottom-16 left-1/2 z-10 w-[700px] -translate-x-1/2"
            />
          </motion.div>
        )}

        {session.isConnected && mode === "operate" && (
          <motion.div
            key="joystick"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
          >
            <Joystick
              mode={mode}
              onVelocities={pushControlCmd}
              className="absolute right-2 bottom-14 z-20 bg-black"
            />
          </motion.div>
        )}

        {/* Status bar */}
        <StatusBar
          key="status-bar"
          mode={mode}
          robotIdentity={ROBOT_IDENTITY}
          isRpcPending={isRpcPending}
          showDebugInfo={showDebugInfo}
          isOperatorModeLocked={isOperatorModeLocked}
          onModeRequest={handleModeRequest}
          onShowDebugInfoChange={setShowDebugInfo}
        />

        {/* Debug info */}
        {session.isConnected && showDebugInfo && (
          <motion.div
            key="debug-info"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
            className="1 text-foreground absolute bottom-3 left-3 flex w-36 flex-col gap-3 font-mono text-xs"
          >
            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              <div className="opacity-50">Pan</div>
              <div className="text-right">{pan}°</div>
              <div className="opacity-50">Tilt</div>
              <div className="text-right">{tilt}°</div>
            </div>
            <hr className="border-border" />
            <div className="grid grid-cols-[auto_1fr_20px] gap-x-2 gap-y-0.5">
              <div className="opacity-50">ωz</div>
              <div className="text-right">
                {gyro.gyro_z_dps !== undefined ? gyro.gyro_z_dps.toFixed(2) : "—"}
              </div>
              <div>°/s</div>
              <div className="opacity-50">ωy</div>
              <div className="text-right">
                {gyro.gyro_y_dps !== undefined ? gyro.gyro_y_dps.toFixed(2) : "—"}
              </div>
              <div>°/s</div>
              <div className="opacity-50">ωx</div>
              <div className="text-right">
                {gyro.gyro_x_dps !== undefined ? gyro.gyro_x_dps.toFixed(2) : "—"}
              </div>
              <div>°/s</div>
              <div className="opacity-50">θx</div>
              <div className="text-right">
                {gyro.angle_x_deg !== undefined ? gyro.angle_x_deg.toFixed(2) : "—"}
              </div>
              <div>°</div>
              <div className="opacity-50">θy</div>
              <div className="text-right">
                {gyro.angle_y_deg !== undefined ? gyro.angle_y_deg.toFixed(2) : "—"}
              </div>
              <div>°</div>
              <div className="opacity-50">θz</div>
              <div className="text-right">
                {gyro.angle_z_deg !== undefined ? gyro.angle_z_deg.toFixed(2) : "—"}
              </div>
              <div>°</div>
              <div className="opacity-50">valid</div>
              <div className="text-right">
                {gyro.valid === undefined ? "—" : gyro.valid ? "yes" : "no"}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
