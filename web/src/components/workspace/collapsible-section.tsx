'use client';

import { useId, useState, type ElementType, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * A heading that collapses its content. The content stays mounted while hidden, so a collapsed
 * control keeps its input handlers and an armed session keeps running.
 */
export function CollapsibleSection({
  heading: Heading,
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  heading: 'h3' | 'h4';
  title: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const body = useId();
  const H = Heading as ElementType;
  return (
    <>
      <div className="control-card-heading">
        <H>
          <button
            className="collapse-toggle"
            aria-expanded={open}
            aria-controls={body}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {title}
          </button>
        </H>
        {badge}
      </div>
      <div id={body} hidden={!open}>
        {children}
      </div>
    </>
  );
}
