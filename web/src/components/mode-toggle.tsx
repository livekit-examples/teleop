import { Mode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
// import { Lock, Unlock } from "lucide-react";

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
    <div className="border-accent-foreground/50 bg-background h-10 w-[250px] items-center justify-center rounded border p-1 flex">
      <div className="relative grow">
        <motion.div
          animate={{ x: mode === "view" ? 0 : "100%" }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="absolute rounded bg-accent-foreground/10 text-primary-foreground border-primary-foreground/30 border z-10 h-full w-1/2"
        />
        <div className="grid grid-cols-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void onModeRequest("view")}
            className={cn(
              `flex flex-1 cursor-pointer items-center justify-center rounded px-3 py-1.5 font-mono text-xs transition-colors z-20 relative col-start-1`,
              mode !== "view" ? "text-accent-foreground/50" : "text-accent-foreground/80 ",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            Viewer
          </button>
          <button
            type="button"
            disabled={disabled || isOperatorModeLocked}
            onClick={() => void onModeRequest("operate")}
            className={cn(
              `flex flex-1 cursor-pointer items-center justify-center gap-2 rounded px-3 py-1.5 font-mono text-xs transition-colors z-20 relative col-start-2`,
              mode !== "operate" ? "text-accent-foreground/50" : "text-accent-foreground/80",
              (isOperatorModeLocked || disabled) && "cursor-not-allowed",
              disabled && "opacity-60",
            )}
          >
            {/* {mode === "operate" || isOperatorModeLocked ? (
            <Lock size={12} className="shrink-0 text-current" />
          ) : (
            <Unlock size={12} className="shrink-0 text-current" />
          )} */}
            Controller
          </button>
        </div>
      </div>
    </div>
  );
}
