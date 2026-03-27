import { Mode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Lock, Unlock } from 'lucide-react';

interface ModeToggleProps {
  mode: Mode;
  onModeRequest: (next: Mode) => void | Promise<void>;
  isOperatorModeLocked: boolean;
  isRpcPending: boolean;
}

export function ModeToggle({
  mode,
  onModeRequest,
  isOperatorModeLocked,
  isRpcPending,
}: ModeToggleProps) {
  const disabled = isRpcPending;

  return (
    <div className="border-accent-foreground/15 bg-background h-10 w-[250px] items-center justify-center rounded-md border p-1">
      <div className="grid grid-cols-2 rounded">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onModeRequest('view')}
          className={cn(
            `flex flex-1 cursor-pointer items-center justify-center rounded px-3 py-1.5 font-mono text-xs transition-colors`,
            mode === 'view'
              ? 'bg-primary text-primary-foreground border-primary-foreground/10 border'
              : 'text-accent-foreground/80',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          Viewer
        </button>
        <button
          type="button"
          disabled={disabled || isOperatorModeLocked}
          onClick={() => void onModeRequest('operate')}
          className={cn(
            `flex flex-1 cursor-pointer items-center justify-center gap-2 rounded px-3 py-1.5 font-mono text-xs transition-colors`,
            mode === 'operate'
              ? 'bg-primary text-primary-foreground border-primary-foreground/10 border'
              : 'text-accent-foreground/80',
            (isOperatorModeLocked || disabled) && 'cursor-not-allowed',
            disabled && 'opacity-60',
          )}
        >
          {mode === 'operate' || isOperatorModeLocked ? (
            <Lock size={12} className="shrink-0 text-current" />
          ) : (
            <Unlock size={12} className="shrink-0 text-current" />
          )}
          Controller
        </button>
      </div>
    </div>
  );
}
