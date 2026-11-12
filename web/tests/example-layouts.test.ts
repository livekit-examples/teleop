import { describe, expect, it } from 'vitest';
import arm from '../src/lib/teleop/example-layouts/arm.json';
import f1tenth from '../src/lib/teleop/example-layouts/f1tenth.json';
import { parseLayout } from '../src/lib/teleop/layout';

describe('example layouts', () => {
  it('parse and rebind to the selected robot', () => {
    expect(Object.keys(parseLayout(JSON.stringify(f1tenth), 'simulation-f1tenth-x').panels)).toHaveLength(2);
    expect(Object.keys(parseLayout(JSON.stringify(arm), 'simulation-trossen-workbench-x').panels)).toHaveLength(3);
  });
});
