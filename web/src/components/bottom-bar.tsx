"use client";

import { useSessionContext } from "@livekit/components-react";
import { Radio, RadioOff, Gamepad2 } from "lucide-react";
import { Mode } from "@/lib/types";
import { ConnectionState } from "livekit-client";
import { ModeToggle } from "./mode-toggle";

interface BottomBarProps {
  mode: Mode;
  isRpcPending?: boolean;
  isOperatorModeLocked?: boolean;
  onModeRequest?: (next: Mode) => void | Promise<void>;
}

export function BottomBar({
  mode,
  isRpcPending = false,
  isOperatorModeLocked = false,
  onModeRequest = () => {},
}: BottomBarProps) {
  const session = useSessionContext();

  const roomName = session.room?.name;

  return (
    <div className="bg-accent-foreground/5 border-accent-foreground/15 flex items-center justify-between border-t px-4 py-2">
      {/* Actions */}
      <div className="flex w-[250px] items-center justify-start">
        {/* <button className="flex items-center justify-center size-10 rounded bg-background border border-accent-foreground/15" /> */}
      </div>

      {/* Connection Status Dropdown */}
      {session.isConnected && (
        <div className="border-accent-foreground/15 bg-background flex h-10 w-80 items-center justify-between gap-4 rounded border pr-4 font-mono text-xs font-light">
          <button
            type="button"
            onClick={() => session.end()}
            className="group grid h-10 cursor-pointer place-content-center px-4"
          >
            <Radio
              size={20}
              className="text-accent-foreground shrink-0 group-hover:hidden"
            />
            <RadioOff
              size={20}
              className="text-accent-foreground hidden shrink-0 group-hover:block"
            />
          </button>
          <span className="whitespace-nowrap">
            <span className="text-accent-foreground/50 uppercase">
              Connected to{" "}
            </span>
            <span className="text-accent-foreground">{roomName}</span>
          </span>
          <Gamepad2 size={20} className="text-accent-foreground/25 shrink-0" />
        </div>
      )}

      {!session.isConnected && (
        <button
          type="button"
          disabled={
            session.isConnected ||
            session.connectionState === ConnectionState.Connecting
          }
          onClick={() => session.start()}
          className="bg-background border-accent-foreground/15 hover:bg-accent-foreground/10 hover:border-accent-foreground/20 focus-visible:ring-accent-foreground/20 text-accent-foreground/80 hover:text-accent-foreground disabled:hover:bg-background disabled:hover:border-accent-foreground/15 flex h-10 w-80 cursor-pointer items-center justify-between rounded border px-4 font-mono text-xs font-light tracking-widest uppercase transition-colors focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Radio size={20} className="text-accent-foreground/25 shrink-0" />
          <span className="uppercase">
            {session.connectionState === ConnectionState.Connecting
              ? "Connecting…"
              : "Connect"}
          </span>
          <Gamepad2 size={20} className="text-accent-foreground/25 shrink-0" />
        </button>
      )}

      {/* Mode Toggle */}
      <ModeToggle
        mode={mode}
        onModeRequest={onModeRequest}
        isOperatorModeLocked={isOperatorModeLocked}
        isRpcPending={isRpcPending}
      />
    </div>
  );
}
