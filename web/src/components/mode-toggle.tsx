import { Mode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@base-ui/react/button";
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
    <div className="bg-background flex h-10 w-[250px] items-center justify-center rounded border dark:border-input p-1">
      <div className="relative grow h-full">
        <motion.div
          animate={{ x: mode === "view" ? 0 : "100%" }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="bg-input/30 text-primary-foreground absolute z-10 h-full w-1/2 left-0 rounded border border-input"
        />
        <div className="grid grid-cols-2">
          <Button
            type="button"
            disabled={disabled}
            onClick={() => void onModeRequest("view")}
            className={cn(
              `font-mono text-xs h-full z-20 rounded-xs hover:opacity-100 transition-opacity`,
              mode !== "view" ? "opacity-50" : "opacity-100",
            )}
          >
            Viewer
          </Button>
          <Button
            type="button"
            disabled={disabled || isOperatorModeLocked}
            onClick={() => void onModeRequest("operate")}
            className={cn(
              `font-mono text-xs h-8 z-20 rounded-xs hover:opacity-100 transition-opacity`,
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
