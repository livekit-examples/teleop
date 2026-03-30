import { cn } from '@/lib/utils';

import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { type VariantProps } from 'class-variance-authority';
import { Button as ButtonShadcn, buttonVariants } from '@/components/ui/button';

export function Button({
  className,
  variant = 'outline',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonShadcn
      variant={variant}
      className={cn(
        'flex h-10 cursor-pointer items-center justify-center gap-3 rounded border px-3 transition-[colors,opacity]',
        'text- font-mono font-light tracking-widest uppercase',
        'text-foreground/80 hover:text-foreground',
        'bg-card/10 hover:bg-card/30',
        'ring-ring outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'disabled:hover:bg-background disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
