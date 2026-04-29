import { cn } from '@/lib/utils';

interface ScaleValueProps {
  value: number;
  orientation: 'vertical' | 'horizontal';
  className?: string;
}

export function ScaleValue({ value, orientation, className }: ScaleValueProps) {
  return (
    <div
      className={cn(
        'text-foreground items-center justify-center font-mono',
        orientation === 'vertical' ? 'flex flex-col' : 'flex flex-row',
        className,
      )}
    >
      <div className="text-foreground relative grid h-8 w-20 place-content-center">
        <div className="bg-surface-2 absolute inset-0 rounded-lg" />
        <div className="border-foreground absolute top-0 left-0 size-1.5 border-t border-l" />
        <div className="border-foreground absolute top-0 right-0 size-1.5 border-t border-r" />
        <div className="border-foreground absolute bottom-0 left-0 size-1.5 border-b border-l" />
        <div className="border-foreground absolute right-0 bottom-0 size-1.5 border-r border-b" />
        <span className="z-10 whitespace-pre">
          {value >= 0 ? ` ${value.toFixed(1)}°` : `${value.toFixed(1)}°`}
        </span>
        {orientation === 'vertical' && (
          <div className="pointer-events-none absolute top-1/2 left-1 -translate-x-full -translate-y-1/2">
            <div className="border-l-foreground size-0 border-x-6 border-y-4 border-transparent" />
          </div>
        )}
        {orientation === 'horizontal' && (
          <div className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 -translate-y-full">
            <div className="border-t-foreground size-0 border-x-4 border-y-6 border-transparent" />
          </div>
        )}
      </div>
    </div>
  );
}
