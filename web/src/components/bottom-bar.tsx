"use client";

import { useSessionContext } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { Radio, RadioOff, Gamepad2, BugIcon, BugOffIcon, PowerIcon } from "lucide-react";
import { motion } from "motion/react";
import { Mode } from "@/lib/types";
import { Button } from "@/components/button";
import { ModeToggle } from "@/components/mode-toggle";
import { useGamepadConnected } from "@/hooks/use-gamepad-connected";
import { cn } from "@/lib/utils";

interface BottomBarProps {
  mode: Mode;
  isRpcPending?: boolean;
  showDebugInfo?: boolean;
  isOperatorModeLocked?: boolean;
  onShowDebugInfoChange?: (show: boolean) => void;
  onModeRequest?: (next: Mode) => void | Promise<void>;
}

export function BottomBar({
  mode,
  isRpcPending = false,
  showDebugInfo = false,
  isOperatorModeLocked = false,
  onModeRequest = () => {},
  onShowDebugInfoChange = () => {},
}: BottomBarProps) {
  const session = useSessionContext();
  const gamepadConnected = useGamepadConnected();
  const roomName = session.room?.name;
  const isConnectedOrConnecting =
    session.isConnected || session.connectionState === ConnectionState.Connecting;

  return (
    <motion.div
      animate={{
        translateY: isConnectedOrConnecting ? 0 : `100%`,
      }}
      transition={{
        duration: 0.2,
        ease: "easeInOut",
      }}
      className="fixed bottom-0 inset-x-0"
    >
      <div className="flex items-center justify-between px-4 py-2">
        {/* Actions */}
        <div className="flex w-[250px] items-center justify-start"></div>

        {/* Connection Status */}
        {isConnectedOrConnecting && (
          <div className="flex items-center justify-between gap-1">
            <Button
              type="button"
              title="Toggle Debug Info"
              onClick={() => onShowDebugInfoChange(!showDebugInfo)}
              className="size-10 grid place-items-center"
            >
              {showDebugInfo ? (
                <BugOffIcon size={20} className="text-accent-foreground size-5" />
              ) : (
                <BugIcon size={20} className="text-accent-foreground size-5" />
              )}
            </Button>
            <div className="bg-accent-foreground/10 border-accent-foreground/40 flex h-10 w-100 items-center justify-between gap-8 rounded border px-3 font-mono text-sm font-light">
              <Radio size={20} className="text-accent-foreground shrink-0 group-hover:hidden" />
              <RadioOff
                size={20}
                className="text-accent-foreground hidden shrink-0 group-hover:block"
              />

              <span className="flex gap-2 whitespace-nowrap">
                <span className="text-accent-foreground/50 uppercase">
                  {session.connectionState === ConnectionState.Connecting ||
                  session.connectionState === ConnectionState.Reconnecting ||
                  session.connectionState === ConnectionState.SignalReconnecting
                    ? "Connecting"
                    : "Connected to"}
                </span>
                <span className="text-accent-foreground">{roomName}</span>
              </span>

              <Gamepad2
                size={20}
                aria-hidden
                className={cn(
                  "shrink-0 transition-colors duration-200",
                  gamepadConnected ? "text-accent-foreground" : "text-accent-foreground/25",
                )}
              />
            </div>
            <Button
              type="button"
              title="Disconnect"
              onClick={() => session.end()}
              className="size-10 grid place-items-center"
            >
              <PowerIcon size={24} className="text-accent-foreground size-5" />
            </Button>
          </div>
        )}

        <ModeToggle
          mode={mode}
          onModeRequest={onModeRequest}
          isOperatorModeLocked={isOperatorModeLocked}
          isRpcPending={isRpcPending}
        />
      </div>
    </motion.div>
  );
}
