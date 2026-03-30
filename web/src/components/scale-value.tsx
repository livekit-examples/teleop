import { ChevronLeft, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScaleValueProps {
  value: number;
  orientation: "vertical" | "horizontal";
  className?: string;
}

export function ScaleValue({ value, orientation, className }: ScaleValueProps) {
  return (
    <div
      className={cn(
        "text-foreground items-center justify-center font-mono",
        orientation === "vertical" ? "flex flex-col" : "flex flex-row",
        className,
      )}
    >
      <div className="text-foreground relative grid h-8 w-20 place-content-center">
        <div className="bg-card/10 absolute inset-0" />
        <div className="absolute top-px left-px size-1.5 border-t border-l border-foreground" />
        <div className="absolute top-px right-px size-1.5 border-t border-r border-foreground" />
        <div className="absolute bottom-px left-px size-1.5 border-b border-l border-foreground" />
        <div className="absolute right-px bottom-px size-1.5 border-r border-b border-foreground" />
        <span className="whitespace-pre">
          {value >= 0 ? ` ${value.toFixed(1)}°` : `${value.toFixed(1)}°`}
        </span>
        {orientation === "vertical" && (
          <div className="pointer-events-none absolute top-1/2 left-0 -translate-x-full -translate-y-1/2">
            <ChevronLeft size={16} />
          </div>
        )}
        {orientation === "horizontal" && (
          <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full">
            <ChevronDown size={16} />
          </div>
        )}
      </div>
    </div>
  );
}
