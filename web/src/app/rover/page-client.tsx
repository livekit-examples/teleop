"use client";

import { useCallback, useState } from "react";
import { GaugeIcon, PowerIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBar } from "@/components/status-bar";
import { Joystick } from "@/components/joystick";
import { DebugPanel, type DebugRow } from "@/components/debug-panel";
import { useSessionContext } from "@livekit/components-react";
import { useAcquireControl } from "@/hooks/use-acquire-control";
import { useRoverControlCmdTrack } from "@/hooks/use-rover-control-cmd-track";
import { useImu } from "@/hooks/use-imu";
import { Button } from "@/components/ui/button";
import { MinimizeIcon, MaximizeIcon } from "lucide-react";
import { motion, AnimatePresence, type Transition } from "motion/react";
import { cn } from "@/lib/utils";
import { RAD_TO_DEG, roverArducamTrackName } from "@/lib/rover";
import { VideoDialog } from "@/components/video-dialog";
import { useConnection } from "@/hooks/use-connection";

const ROVER_ID = process.env.NEXT_PUBLIC_ROVER_IDENTITY || "";
const ROVER_CAMERA_TRACK_NAME = roverArducamTrackName(ROVER_ID);

const ANIMATION_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

const ANIMATION_TRANSITION: Transition = {
  type: "spring",
  duration: 0.2,
  bounce: 0.1,
};

export function App() {
  useConnection();
  const router = useRouter();
  const session = useSessionContext();
  const imu = useImu(ROVER_ID);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);

  const { mode, isRpcPending, isOperatorModeLocked, handleModeRequest } =
    useAcquireControl({
      identity: ROVER_ID,
      isConnected: session.isConnected,
    });

  const { pushControlCmd } = useRoverControlCmdTrack(
    ROVER_ID,
    mode === "operate" && session.isConnected,
  );

  // Joystick emits (horizontal, vertical) as (pan_vel, tilt_vel).
  // Map to rover: horizontal -> steering_rps; vertical up -> throttle forward.
  const handleVelocities = useCallback(
    (pan_vel: number, tilt_vel: number) => {
      pushControlCmd(-tilt_vel, pan_vel);
    },
    [pushControlCmd],
  );

  const handleDisconnect = () => {
    router.push("/");
  };

  const pitchDeg = imu ? imu.orientation_rad.pitch * RAD_TO_DEG : 0;
  const yawDeg = imu ? imu.orientation_rad.yaw * RAD_TO_DEG : 0;
  const rollDeg = imu ? imu.orientation_rad.roll * RAD_TO_DEG : 0;

  const debugRows: DebugRow[] = [
    { label: "roll", value: imu ? rollDeg : null, unit: "°" },
    { label: "pitch", value: imu ? pitchDeg : null, unit: "°" },
    { label: "yaw", value: imu ? yawDeg : null, unit: "°" },
    { label: "ωx", value: imu?.gyro_dps.x, unit: "°/s" },
    { label: "ωy", value: imu?.gyro_dps.y, unit: "°/s" },
    { label: "ωz", value: imu?.gyro_dps.z, unit: "°/s" },
    { label: "ax", value: imu?.accel_mg.x, unit: "mg" },
    { label: "ay", value: imu?.accel_mg.y, unit: "mg" },
    { label: "az", value: imu?.accel_mg.z, unit: "mg" },
    { label: "mx", value: imu?.mag_ut.x, unit: "µT" },
    { label: "my", value: imu?.mag_ut.y, unit: "µT" },
    { label: "mz", value: imu?.mag_ut.z, unit: "µT" },
    { label: "temp", value: imu?.temperature_c, unit: "°C" },
  ];

  const actions = [
    <Button
      key="disconnect-button"
      type="button"
      title="Disconnect"
      variant="outline"
      onClick={handleDisconnect}
      className="rounded font-mono text-xs uppercase"
    >
      <PowerIcon className="text-foreground size-4" />
      Disconnect
    </Button>,
    <Button
      key="fullscreen-button"
      size="icon"
      type="button"
      variant="outline"
      aria-label={isFullscreen ? "Minimize Fullscreen" : "Maximize Fullscreen"}
      onClick={() => setIsFullscreen(!isFullscreen)}
      className="size-8 rounded"
    >
      {isFullscreen ? (
        <MinimizeIcon size={24} className="text-foreground size-5" />
      ) : (
        <MaximizeIcon size={24} className="text-foreground size-5" />
      )}
    </Button>,
    <Button
      key="debug-info-button"
      size="icon"
      type="button"
      variant="outline"
      title="Toggle Debug Info"
      onClick={() => setShowDebugInfo(!showDebugInfo)}
      className={cn(
        "rounded",
        showDebugInfo ? "bg-foreground/10" : "bg-background/50",
      )}
    >
      <GaugeIcon className="text-foreground size-5" />
    </Button>,
  ];

  return (
    <div className="relative h-dvh">
      <AnimatePresence>
        {/* Fullscreen video */}
        {session.isConnected && (
          <VideoDialog
            isFullscreen={isFullscreen}
            insetX={64}
            insetY={64}
            participantIdentity={ROVER_ID}
            showTrackInfo={showDebugInfo}
            trackName={ROVER_CAMERA_TRACK_NAME}
          />
        )}

        {/* Joystick — vertical = throttle, horizontal = steering */}
        {session.isConnected && mode === "operate" && (
          <motion.div
            key="joystick"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, x: 10 },
              visible: { opacity: 1, x: 0 },
            }}
            transition={ANIMATION_TRANSITION}
          >
            <Joystick
              mode={mode}
              onVelocities={handleVelocities}
              className="absolute right-2 bottom-12 z-20"
            />
          </motion.div>
        )}

        {/* Status bar */}
        <StatusBar
          key="status-bar"
          mode={mode}
          actions={actions}
          robotIdentity={ROVER_ID}
          isRpcPending={isRpcPending}
          showDebugInfo={showDebugInfo}
          isOperatorModeLocked={isOperatorModeLocked}
          onModeRequest={handleModeRequest}
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
            className="absolute bottom-12 left-2 w-96"
          >
            <DebugPanel rows={debugRows} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
