import { Orientation, type SerializedDockview } from 'dockview-react';
import type { Layout, Placement, PlacementNode } from './types';

type GridNode = SerializedDockview['grid']['root'];
export function readPlacement(dock: SerializedDockview): Placement {
  let group = 0;
  const node = (n: GridNode): PlacementNode => {
    if (n.type === 'branch')
      return {
        type: 'split',
        weight: Math.max(1, n.size ?? 1),
        children: (n.data as GridNode[]).map(node),
      };
    const data = n.data as { views: string[]; activeView?: string };
    return {
      type: 'group',
      id: `group_${group++}`,
      weight: Math.max(1, n.size ?? 1),
      panels: data.views,
      active: data.activeView ?? data.views[0],
    };
  };
  return {
    version: 1,
    orientation: dock.grid.orientation,
    root: node(dock.grid.root),
    floating: (dock.floatingGroups ?? []).map((f) => ({
      node: f.grid ? node(f.grid.root) : node({ type: 'leaf', data: f.data!, size: 1 }),
      x: 'left' in f.position ? f.position.left : 20,
      y: 'top' in f.position ? f.position.top : 20,
      width: f.position.width,
      height: f.position.height,
    })),
  };
}
export function writePlacement(
  placement: Placement,
  layout: Layout,
  width = 1200,
  height = 800,
): SerializedDockview {
  const panels: SerializedDockview['panels'] = {};
  const node = (n: PlacementNode): GridNode => {
    if (n.type === 'split') return { type: 'branch', size: n.weight, data: n.children.map(node) };
    for (const id of n.panels)
      panels[id] = {
        id,
        contentComponent: 'workspace',
        title:
          layout.panels[id]?.label ??
          { '@cameras': 'Live cameras', '@controls': 'Controls', '@catalog': 'Topics & panels' }[
            id
          ],
        renderer: 'always',
        minimumWidth: id.startsWith('@') ? 200 : 230,
        minimumHeight: id === '@cameras' ? 220 : 190,
      };
    return {
      type: 'leaf',
      size: n.weight,
      data: { id: n.id, views: n.panels, activeView: n.active },
    };
  };
  const root = node(placement.root);
  const floatingGroups = placement.floating.map((f) => ({
    grid: {
      root: node(f.node),
      width: f.width,
      height: f.height,
      orientation: placement.orientation as Orientation,
    },
    position: {
      left: Math.max(0, Math.min(f.x, width - 100)),
      top: Math.max(0, Math.min(f.y, height - 100)),
      width: Math.min(f.width, width),
      height: Math.min(f.height, height),
    },
  }));
  return {
    grid: { root, width, height, orientation: placement.orientation as Orientation },
    panels,
    floatingGroups,
  };
}
export function prunePlacement(
  placement: Placement | undefined,
  ids: string[],
): Placement | undefined {
  if (!placement) return;
  const keep = new Set([...ids, '@cameras', '@controls', '@catalog']);
  const prune = (n: PlacementNode): PlacementNode | undefined => {
    if (n.type === 'group') {
      const panels = n.panels.filter((id) => keep.has(id));
      return panels.length
        ? { ...n, panels, active: panels.includes(n.active) ? n.active : panels[0] }
        : undefined;
    }
    const children = n.children.flatMap((child) => {
      const result = prune(child);
      return result ? [result] : [];
    });
    return children.length ? { ...n, children } : undefined;
  };
  return {
    ...placement,
    root: prune(placement.root) ?? { type: 'split', weight: 1, children: [] },
    floating: placement.floating.flatMap((f) => {
      const result = prune(f.node);
      return result ? [{ ...f, node: result }] : [];
    }),
  };
}
