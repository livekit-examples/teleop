'use client';

import { Dispatch, SetStateAction } from 'react';
import { cn } from '@/lib/utils';
import { useSessionContext } from '@livekit/components-react';
import { Radio, RadioOff, Lock, Menu, Unlock, Gamepad2 } from 'lucide-react';
import { Mode } from '@/lib/types';
import { ConnectionState } from 'livekit-client';

interface BottomBarProps {
  mode: Mode;
  setMode: Dispatch<SetStateAction<Mode>>;
  isOperatorModeLocked: boolean;
}

export function BottomBar({ mode, setMode, isOperatorModeLocked }: BottomBarProps) {
  const session = useSessionContext();

  const roomName = session.room?.name;

  return (
    <div className="bg-accent-foreground/5 border-accent-foreground/15 flex items-center justify-between border-t px-4 py-2">
      {/* Actions */}
      <div className="flex w-[250px] items-center justify-start">
        {/* <button className="flex items-center justify-center size-10 rounded bg-background border border-accent-foreground/15">
          <Menu size={16} className="text-accent-foreground" />
        </button> */}
      </div>

      {/* Connection Status Dropdown */}
      {session.isConnected && (
        <div className="border-accent-foreground/15 bg-background flex h-10 w-80 items-center justify-between gap-4 rounded border pr-4 font-mono text-xs font-light">
          <button
            type="button"
            onClick={() => session.end()}
            className="group grid h-10 cursor-pointer place-content-center px-4"
          >
            <Radio size={20} className="text-accent-foreground shrink-0 group-hover:hidden" />
            <RadioOff
              size={20}
              className="text-accent-foreground hidden shrink-0 group-hover:block"
            />
          </button>
          <span className="whitespace-nowrap">
            <span className="text-accent-foreground/50 uppercase">Connected to </span>
            <span className="text-accent-foreground">{roomName}</span>
          </span>
          <Gamepad2 size={20} className="text-accent-foreground/25 shrink-0" />
        </div>
      )}

      {!session.isConnected && (
        <button
          type="button"
          disabled={session.isConnected || session.connectionState === ConnectionState.Connecting}
          onClick={() => session.start()}
          className="bg-background border-accent-foreground/15 hover:bg-accent-foreground/10 hover:border-accent-foreground/20 focus-visible:ring-accent-foreground/20 text-accent-foreground/80 hover:text-accent-foreground disabled:hover:bg-background disabled:hover:border-accent-foreground/15 flex h-10 w-80 cursor-pointer items-center justify-between rounded border px-4 font-mono text-xs font-light tracking-widest uppercase transition-colors focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Radio size={20} className="text-accent-foreground/25 shrink-0" />
          <span className="uppercase">
            {session.connectionState === ConnectionState.Connecting ? 'Connecting…' : 'Connect'}
          </span>
          <Gamepad2 size={20} className="text-accent-foreground/25 shrink-0" />
        </button>
      )}

      {/* Segmented Control */}
      <div className="border-accent-foreground/15 bg-background h-10 w-[250px] items-center justify-center rounded-md border p-1">
        <div className="grid grid-cols-2 rounded">
          <button
            type="button"
            onClick={() => setMode('view')}
            className={cn(
              `flex flex-1 cursor-pointer items-center justify-center rounded px-3 py-1.5 font-mono text-xs transition-colors`,
              mode === 'view'
                ? 'bg-primary text-primary-foreground border border-primary-foreground/10'
                : 'text-accent-foreground/80',
            )}
          >
            View
          </button>
          <button
            type="button"
            disabled={isOperatorModeLocked}
            onClick={() => setMode('operate')}
            className={cn(
              `flex flex-1 cursor-pointer items-center justify-center gap-2 rounded px-3 py-1.5 font-mono text-xs transition-colors`,
              mode === 'operate'
                ? 'bg-primary text-primary-foreground border border-primary-foreground/10'
                : 'text-accent-foreground/80',
              isOperatorModeLocked && 'cursor-not-allowed',
            )}
          >
            {mode === 'operate' || isOperatorModeLocked ? (
              <Lock size={12} className="shrink-0 text-current" />
            ) : (
              <Unlock size={12} className="shrink-0 text-current" />
            )}
            Operator
          </button>
        </div>
      </div>
    </div>
  );
}
