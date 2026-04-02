export const ACQUIRE_CONTROL_METHOD = 'acquire_control';

/** Matches API examples: acquire */
export const ACQUIRE_CONTROL_PAYLOAD = JSON.stringify({ acquire: true });

/** Matches API examples: release */
export const RELEASE_CONTROL_PAYLOAD = JSON.stringify({ acquire: false });

export type AcquireControlResponseKind =
  | 'acquired'
  | 'already_controller'
  | 'other_controller'
  | 'released'
  | 'no_controller'
  | 'unknown';

/**
 * Parses human-readable `acquire_control` RPC responses from the robot.
 * @see pan_tilt_demo/API_README.md
 */
export function parseAcquireControlResponse(
  response: string,
  localIdentity: string,
): {
  kind: AcquireControlResponseKind;
  /** Active controller when applicable (from server message). */
  controllerIdentity?: string;
} {
  const trimmed = response.trim();

  if (trimmed.startsWith('control acquired by ')) {
    return { kind: 'acquired' };
  }

  if (trimmed.startsWith('already controller: ')) {
    const id = trimmed.slice('already controller: '.length).trim();
    return { kind: 'already_controller', controllerIdentity: id };
  }

  if (trimmed.startsWith('control released by ')) {
    return { kind: 'released' };
  }

  if (trimmed === 'no controller is set') {
    return { kind: 'no_controller' };
  }

  if (trimmed.startsWith('controller is currently ')) {
    const id = trimmed.slice('controller is currently '.length).trim();
    if (id !== localIdentity) {
      return { kind: 'other_controller', controllerIdentity: id };
    }
    return { kind: 'already_controller', controllerIdentity: id };
  }

  return { kind: 'unknown' };
}

/** Whether another participant holds control (operator seat unavailable for us). */
export function isSeatHeldByOther(kind: AcquireControlResponseKind): boolean {
  return kind === 'other_controller';
}
