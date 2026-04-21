import { Mode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
    <div className="bg-card dark:border-input flex h-10 w-[250px] items-center justify-center rounded-xl border p-1 backdrop-blur-lg">
      <div className="relative h-full grow">
        <motion.div
          animate={{ x: mode === "view" ? 0 : "100%" }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="bg-card text-primary-foreground border-input absolute left-0 z-10 h-full w-1/2 rounded border"
        />
        <div className="grid grid-cols-2">
          <Button
            type="button"
            disabled={disabled}
            variant="ghost"
            onClick={() => void onModeRequest("view")}
            className={cn(
              `z-20 h-full font-mono text-xs transition-opacity hover:opacity-100 backdrop-none uppercase`,
              mode !== "view" ? "opacity-50" : "opacity-100",
            )}
          >
            Viewer
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || isOperatorModeLocked}
            onClick={() => void onModeRequest("operate")}
            className={cn(
              `z-20 h-8 font-mono text-xs transition-opacity hover:opacity-100 backdrop-none uppercase`,
              mode !== "operate" ? "opacity-50" : "opacity-100",
            )}
          >
            Controller
          </Button>
        </div>
      </div>
    </div>
  );
}
