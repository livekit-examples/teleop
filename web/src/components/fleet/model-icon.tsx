import { Bot, Car, CircleHelp, Truck, Wrench } from 'lucide-react';

/** One glyph per robot family. Unknown or missing models get a question mark. */
export function ModelIcon({ model, size = 14 }: { model: string; size?: number }) {
  const id = model.toLowerCase();
  const props = { size, strokeWidth: 2, 'aria-hidden': true } as const;
  if (!id) return <CircleHelp {...props} />;
  if (/carla|f1tenth|car|race/.test(id)) return <Car {...props} />;
  if (/rover|truck|mobile/.test(id)) return <Truck {...props} />;
  if (/workbench|bench/.test(id)) return <Wrench {...props} />;
  return <Bot {...props} />;
}
