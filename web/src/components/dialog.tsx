import { useState } from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';

interface DialogProps {
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ children, className }: DialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={cn('relative')}>
      <motion.div
        key="background"
        initial={{ opacity: 0, width: 0, height: 0 }}
        animate={{
          opacity: [0, 1, 1],
          width: [0, 0, '100%'],
          height: [0, '100%', '100%'],
        }}
        exit={{ opacity: 0 }}
        transition={{
          duration: 0.8,
          ease: ['linear', 'easeOut'],
          times: [0, 0.6, 1],
        }}
        onAnimationComplete={() => setIsOpen(true)}
        className="border-input bg-card absolute top-1/2 left-1/2 z-0 -translate-x-1/2 -translate-y-1/2 rounded-lg border backdrop-blur-lg"
      />
      <div
        className={cn(
          'relative z-10 overflow-clip rounded-lg p-px duration-500',
          isOpen ? 'opacity-100' : 'opacity-0',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
