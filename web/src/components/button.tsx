import { cn } from '@/lib/utils';

import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { type VariantProps } from 'class-variance-authority';
import { Button as ButtonShadcn, buttonVariants } from '@/components/ui/button';

export function Button({
  className,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonShadcn
      className={cn(
        'flex h-10 cursor-pointer items-center justify-center rounded px-4 transition-colors',
        'font-mono text-xs font-light tracking-widest uppercase',
        'text-accent-foreground/80 hover:text-accent-foreground',
        'bg-accent-foreground/10 hover:bg-accent-foreground/30',
        'border-accent-foreground/50 hover:border-accent-foreground/80 border',
        'ring-accent-foreground/20 outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'disabled:hover:bg-background disabled:hover:border-accent-foreground/15',
        className,
      )}
      {...props}
    />
  );
}
