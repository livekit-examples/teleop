import type { FleetRobot } from './attributes';

export type SortKey = 'robot' | 'connection' | 'type' | 'control' | 'location';
export type Sort = { key: SortKey; dir: 'asc' | 'desc' };

const CONNECTION_RANK = { connected: 0, stale: 1, offline: 2 } as const;
const CONTROL_RANK = { teleop: 0, autonomous: 1, standby: 2 } as const;

/** Sort value for a column. undefined means the attribute is missing. */
function value(robot: FleetRobot, key: SortKey): string | number | undefined {
  switch (key) {
    case 'robot':
      return robot.name.toLowerCase();
    case 'connection':
      return CONNECTION_RANK[robot.connection];
    case 'type':
      return robot.model.ok ? robot.model.value.label.toLowerCase() : undefined;
    case 'control':
      return robot.control.ok ? CONTROL_RANK[robot.control.value] : undefined;
    case 'location':
      return robot.location.ok ? robot.location.value.label.toLowerCase() : undefined;
  }
}

/** Sorts by one column. Robots missing that attribute always go last, in either direction. */
export function sortRobots(robots: FleetRobot[], sort: Sort | undefined): FleetRobot[] {
  if (!sort) return robots;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...robots].sort((a, b) => {
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    if (va === undefined || vb === undefined) {
      if (va !== vb) return va === undefined ? 1 : -1;
    } else if (va !== vb) {
      return (va < vb ? -1 : 1) * sign;
    }
    // Ties keep a stable, readable order.
    return a.name.localeCompare(b.name);
  });
}
