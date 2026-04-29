'use client';

import { ReactElement } from 'react';
import { useSessionContext } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { Radio, RadioOff, Gamepad2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Mode } from '@/lib/types';
import { type ButtonProps } from '@/components/ui/button';
import { ModeToggle } from '@/components/mode-toggle';
import { useGamepadConnected } from '@/hooks/use-gamepad-connected';
import { cn } from '@/lib/utils';
// import { useGyro } from "@/hooks/use-gyro";
// import { Gyroscope } from "./gyroscope";

interface StatusBarProps {
  mode: Mode;
  actions?: ReactElement<ButtonProps>[];
  robotIdentity: string;
  isRpcPending?: boolean;
  showDebugInfo?: boolean;
  isOperatorModeLocked?: boolean;
  onModeRequest?: (next: Mode) => void | Promise<void>;
  className?: string;
}

export function StatusBar({
  mode,
  actions,
  // robotIdentity,
  isRpcPending = false,
  isOperatorModeLocked = false,
  onModeRequest = () => {},
  className,
}: StatusBarProps) {
  // const gyro = useGyro(robotIdentity);
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
        ease: 'easeInOut',
      }}
      className={cn('fixed inset-x-0 bottom-0 z-50', className)}
    >
      <div className="flex items-center justify-between">
        {/* Actions */}
        <div className="flex w-[300px] items-center justify-start gap-1">
          {actions && (
            <div className="bg-surface dark:border-input flex items-center gap-1 rounded-tr-xl border border-b-0 border-l-0 p-1">
              {actions}
            </div>
          )}
        </div>

        {/* Connection Status */}
        {isConnectedOrConnecting && (
          <div className="bg-surface dark:border-input flex items-center justify-between gap-1 rounded-t-xl border border-b-0 p-1">
            <div className="bg-card dark:border-input flex h-8 w-100 items-center justify-between gap-8 rounded border px-3 font-mono text-sm font-light">
              <Radio className="text-foreground size-5 shrink-0 group-hover:hidden" />
              <RadioOff className="text-foreground hidden size-5 shrink-0 group-hover:block" />

              <span className="flex gap-2 whitespace-nowrap">
                <span className="text-foreground/50 uppercase">
                  {session.connectionState === ConnectionState.Connecting ||
                  session.connectionState === ConnectionState.Reconnecting ||
                  session.connectionState === ConnectionState.SignalReconnecting
                    ? 'Connecting'
                    : 'Connected to'}
                </span>
                <span className="text-foreground">{roomName}</span>
              </span>

              <Gamepad2
                size={20}
                aria-hidden
                className={cn(
                  'shrink-0 transition-colors duration-200',
                  gamepadConnected ? 'text-foreground' : 'text-foreground/25',
                )}
              />
            </div>
          </div>
        )}

        <div className="flex w-[300px] items-center justify-end gap-1">
          {/* Gyroscope */}
          {/* {mode === 'operate' && (
            <Gyroscope x={gyro.gyro_x_dps} y={gyro.gyro_y_dps} z={gyro.gyro_z_dps} />
          )} */}

          {/* Mode Toggle */}
          <ModeToggle
            mode={mode}
            onModeRequest={onModeRequest}
            isOperatorModeLocked={isOperatorModeLocked}
            isRpcPending={isRpcPending}
            className="rounded-tr-none rounded-br-none rounded-bl-none border-r-0 border-b-0"
          />
        </div>
      </div>
    </motion.div>
  );
}
