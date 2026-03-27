'use client';

import { useSessionContext } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { Radio, RadioOff, Gamepad2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Mode } from '@/lib/types';
import { Button } from '@/components/button';
import { ModeToggle } from '@/components/mode-toggle';

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
  const isConnectedOrConnecting =
    session.isConnected || session.connectionState === ConnectionState.Connecting;

  return (
    <motion.div
      animate={{
        height: isConnectedOrConnecting ? 60 : 0,
      }}
      transition={{
        duration: 0.2,
        ease: 'easeInOut',
      }}
      className="relative"
    >
      <div className="bg-accent-foreground/5 border-accent-foreground/15 absolute inset-x-0 top-0 flex items-center justify-between border-t px-4 py-2">
        {/* Actions */}
        <div className="flex w-[250px] items-center justify-start">
          <Button type="button" onClick={() => session.end()}>
            Disconnect
          </Button>
        </div>

        {/* Connection Status Dropdown */}
        {isConnectedOrConnecting && (
          <div className="flex items-center justify-center gap-2">
            <div className="border-accent-foreground/15 bg-background flex h-10 w-80 items-center justify-between gap-4 rounded border px-4 font-mono text-sm font-light">
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
                    ? 'Connecting'
                    : 'Connected to'}
                </span>
                <span className="text-accent-foreground">{roomName}</span>
              </span>

              <Gamepad2 size={20} className="text-accent-foreground/25 shrink-0" />
            </div>
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
