"use client";

import { useState, useEffect } from "react";
import { ScaleVertical } from "@/components/scale-vertical";
import { ScaleHorizontal } from "@/components/scale-horizontal";
import { StatusBar } from "@/components/status-bar";
import { Joystick } from "@/components/joystick";
import { DebugPanel, type DebugRow } from "@/components/debug-panel";
import {
  useSessionContext,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { useAcquireControl } from "@/hooks/use-acquire-control";
import { useControlCmdTrack } from "@/hooks/use-control-cmd-track";
import { useGyro } from "@/hooks/use-gyro";
import { usePanTilt } from "@/hooks/use-pan-tilt";
import { Track } from "livekit-client";
import { Button } from "@/components/ui/button";
import { MinimizeIcon, MaximizeIcon, PowerIcon, GaugeIcon } from "lucide-react";
import { motion, AnimatePresence, type Transition } from "motion/react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { VideoDialog } from "@/components/video-dialog";

const ROBOT_IDENTITY = process.env.NEXT_PUBLIC_ROBOT_IDENTITY || "";

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
  const router = useRouter();
  const session = useSessionContext();

  // Declare the connection lifecycle effect first so its cleanup runs *last*.
  // Subsequent hooks (useGyro, useControlCmdTrack, etc.) tear down their
  // subscriptions before session.end() closes the room, so SDK abort handlers
  // don't fire against a torn-down PC manager.
  useEffect(() => {
    session.start().catch((err: unknown) => {
      toast.error("Failed to connect to robot", {
        id: "robot-connect-error",
        description: err instanceof Error ? err.message : String(err),
      });
      router.push("/");
    });

    return () => {
      session.end();
    };
  }, []);

  const gyro = useGyro(ROBOT_IDENTITY);
  const { pan, tilt } = usePanTilt(ROBOT_IDENTITY);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [depthVideoTrack] = useTracks([Track.Source.ScreenShare]);

  const { mode, isRpcPending, isOperatorModeLocked, handleModeRequest } =
    useAcquireControl({
      identity: ROBOT_IDENTITY,
      isConnected: session.isConnected,
    });

  const { pushControlCmd } = useControlCmdTrack(
    mode === "operate" && session.isConnected,
  );

  const validLabel =
    gyro.valid === undefined ? null : gyro.valid ? "yes" : "no";

  const debugRows: DebugRow[] = [
    { label: "Pan", value: pan, unit: "°" },
    { label: "Tilt", value: tilt, unit: "°" },
    { label: "valid", value: validLabel },
    { label: "ωz", value: gyro.gyro_z_dps, unit: "°/s" },
    { label: "ωy", value: gyro.gyro_y_dps, unit: "°/s" },
    { label: "ωx", value: gyro.gyro_x_dps, unit: "°/s" },
    { label: "θx", value: gyro.angle_x_deg, unit: "°" },
    { label: "θy", value: gyro.angle_y_deg, unit: "°" },
    { label: "θz", value: gyro.angle_z_deg, unit: "°" },
  ];

  const handleDisconnect = () => {
    session.end();
    setTimeout(() => {
      router.push("/");
    }, 300);
  };

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
    >
      <GaugeIcon className="text-foreground size-5" />
    </Button>,
  ];

  return (
    <div className="relative h-dvh">
      <AnimatePresence>
        {/* Fullscreen video */}
        {session.isConnected && (
          <VideoDialog isFullscreen={isFullscreen} insetX={64} insetY={64} />
        )}

        {/* Depth video */}
        {session.isConnected && depthVideoTrack && (
          <motion.div
            key="depth-video-placeholder"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, scale: 0.9 },
              visible: { opacity: 1, scale: 1 },
            }}
            transition={ANIMATION_TRANSITION}
            className="absolute top-6 right-6 z-10 overflow-hidden rounded border"
          >
            <div className="bg-foreground">
              <VideoTrack
                trackRef={depthVideoTrack}
                className="h-[100px] mix-blend-multiply"
              />
            </div>
          </motion.div>
        )}

        {/* Vertical degree scale (pitch) */}
        {session.isConnected && (
          <motion.div
            key="scale-vertical"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, translateX: -10, translateY: "-50%" },
              visible: { opacity: 1, translateX: 0, translateY: "-50%" },
            }}
            transition={ANIMATION_TRANSITION}
            className="absolute top-1/2 left-0 z-10"
          >
            <ScaleVertical
              value={tilt}
              className={cn(
                "h-[500px]",
                isFullscreen &&
                  "bg-background/30 rounded-r-lg backdrop-blur-lg",
              )}
            />
          </motion.div>
        )}

        {/* Horizontal degree scale (yaw)  */}
        {session.isConnected && (
          <motion.div
            key="scale-horizontal"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, translateY: -10, translateX: "-50%" },
              visible: { opacity: 1, translateY: 0, translateX: "-50%" },
            }}
            transition={ANIMATION_TRANSITION}
            className="absolute top-0 left-1/2 z-10"
          >
            <ScaleHorizontal
              value={pan}
              className={cn(
                "w-[700px]",
                isFullscreen &&
                  "bg-background/30 rounded-b-lg backdrop-blur-lg",
              )}
            />
          </motion.div>
        )}

        {/* Joystick */}
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
              onVelocities={pushControlCmd}
              className="absolute right-2 bottom-16 z-20 bg-black"
            />
          </motion.div>
        )}

        {/* Status bar */}
        <StatusBar
          key="status-bar"
          mode={mode}
          actions={actions}
          robotIdentity={ROBOT_IDENTITY}
          isRpcPending={isRpcPending}
          showDebugInfo={showDebugInfo}
          isOperatorModeLocked={isOperatorModeLocked}
          onModeRequest={handleModeRequest}
          className={cn(isFullscreen && "bg-background/60")}
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
            className="absolute bottom-14 left-2 w-96"
          >
            <DebugPanel
              rows={debugRows}
              className={cn(isFullscreen && "bg-background/60")}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
