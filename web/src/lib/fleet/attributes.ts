/**
 * Fleet Portal participant-attribute contract.
 *
 * The Fleet Portal reads everything it shows from LiveKit participant
 * attributes. Robots don't publish most of these yet. Every key is optional:
 * when one is missing, the portal shows the key name in place of the value so
 * the robot owner knows exactly what to set.
 *
 * Full reference: ../docs/fleet-portal.md (repo root) (keep the two in sync).
 */

/** A participant is a robot when this is 'robot'. Existing Portal v3 key. */
export const ROLE_KEY = 'lk.portal.role';
/** Existing Portal v3 key. Identity of the operator holding control, or ''. */
export const ACTIVE_OPERATOR_KEY = 'lk.portal.active_operator';

export const FLEET_KEYS = {
  /** City the robot is in, e.g. "Denver". */
  city: 'lk.fleet.city',
  /** Country, ISO 3166-1 alpha-2 preferred ("US"), full names accepted. */
  country: 'lk.fleet.country',
  /** Decimal degrees, -90..90. Places the robot on the globe. */
  lat: 'lk.fleet.lat',
  /** Decimal degrees, -180..180. Places the robot on the globe. */
  lng: 'lk.fleet.lng',
  /** Robot type / model id. See MODEL_LABELS for known ids. Free-form is allowed. */
  model: 'lk.fleet.model',
  /** One of CONTROL_MODES. */
  control: 'lk.fleet.control',
} as const;

export type FleetKey = (typeof FLEET_KEYS)[keyof typeof FLEET_KEYS];

export const CONTROL_MODES = ['autonomous', 'teleop', 'standby'] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

export const CONTROL_LABELS: Record<ControlMode, string> = {
  autonomous: 'Autonomous',
  teleop: 'Operator teleop',
  standby: 'Standing by',
};

/** Known model ids. Unknown ids are shown as-is. */
export const MODEL_LABELS: Record<string, string> = {
  'trossen-arm': 'Trossen arm',
  'trossen-workbench': 'Trossen workbench',
  'carla-sim': 'CARLA sim',
  'f1tenth-sim': 'F1TENTH sim',
  'mujoco-sim': 'MuJoCo sim',
  rover: 'Rover',
};

/**
 * Connection state is derived from the room, not from an attribute:
 * - connected: in the room with a usable link.
 * - stale: still in the room but LiveKit reports ConnectionQuality.Lost
 *   (media/data stopped arriving; it may recover or time out).
 * - offline: was seen in this session and has since left the room.
 */
export type ConnectionState = 'connected' | 'stale' | 'offline';

export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  stale: 'Stale',
  offline: 'Offline',
};

/** Same color for the status dot, globe marker and the globe arc. */
export const CONNECTION_COLORS: Record<ConnectionState, string> = {
  connected: '#1fd5f9', // LiveKit cyan
  stale: '#ffb752', // amber / moderate
  offline: '#ff7566', // red / serious
};

/** A field is either a value, or the attribute key(s) the robot didn't set. */
export type Field<T> = { ok: true; value: T } | { ok: false; missing: string[]; invalid?: string };

export type FleetRobot = {
  identity: string;
  name: string;
  connection: ConnectionState;
  /** ms epoch when the connection state last changed (as seen by this page). */
  since?: number;
  activeOperator: string;
  location: Field<{ city?: string; country?: string; label: string }>;
  coordinates: Field<{ lat: number; lng: number; approximate: boolean }>;
  model: Field<{ id: string; label: string }>;
  control: Field<ControlMode>;
  portalVersion: string;
  /** Room-derived detail, filled in by useFleet. */
  live?: LiveStatus;
  attributes: Record<string, string>;
};

export type LinkQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export type LiveStatus = {
  quality: LinkQuality;
  /** Media and data tracks the robot publishes right now. */
  tracks: { kind: 'video' | 'audio' | 'data'; name: string }[];
};

const text = (attributes: Record<string, string>, key: string) => attributes[key]?.trim() || '';

function number(value: string, min: number, max: number) {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
}

export function parseRobot(
  identity: string,
  name: string | undefined,
  attributes: Record<string, string>,
  connection: ConnectionState,
  lookupCity: (city: string, country: string) => { lat: number; lng: number } | undefined,
): FleetRobot {
  const city = text(attributes, FLEET_KEYS.city);
  const country = text(attributes, FLEET_KEYS.country);
  const location: FleetRobot['location'] =
    city || country
      ? {
          ok: true,
          value: {
            city: city || undefined,
            country: country || undefined,
            label: [city, country].filter(Boolean).join(', '),
          },
        }
      : { ok: false, missing: [FLEET_KEYS.city, FLEET_KEYS.country] };

  const lat = number(text(attributes, FLEET_KEYS.lat), -90, 90);
  const lng = number(text(attributes, FLEET_KEYS.lng), -180, 180);
  let coordinates: FleetRobot['coordinates'];
  if (lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    coordinates = { ok: true, value: { lat, lng, approximate: false } };
  } else {
    const guess = city ? lookupCity(city, country) : undefined;
    const missing = [
      ...(lat === undefined ? [FLEET_KEYS.lat] : []),
      ...(lng === undefined ? [FLEET_KEYS.lng] : []),
    ];
    const invalid =
      Number.isNaN(lat) || Number.isNaN(lng) ? 'lat/lng must be decimal degrees' : undefined;
    coordinates = guess
      ? { ok: true, value: { ...guess, approximate: true } }
      : { ok: false, missing: missing.length ? missing : [FLEET_KEYS.lat, FLEET_KEYS.lng], invalid };
  }

  const modelId = text(attributes, FLEET_KEYS.model);
  const model: FleetRobot['model'] = modelId
    ? { ok: true, value: { id: modelId, label: MODEL_LABELS[modelId.toLowerCase()] ?? modelId } }
    : { ok: false, missing: [FLEET_KEYS.model] };

  const controlRaw = text(attributes, FLEET_KEYS.control).toLowerCase();
  const control: FleetRobot['control'] = !controlRaw
    ? { ok: false, missing: [FLEET_KEYS.control] }
    : (CONTROL_MODES as readonly string[]).includes(controlRaw)
      ? { ok: true, value: controlRaw as ControlMode }
      : {
          ok: false,
          missing: [FLEET_KEYS.control],
          invalid: `"${controlRaw}" is not one of ${CONTROL_MODES.join(' | ')}`,
        };

  return {
    identity,
    name: name || identity,
    portalVersion: text(attributes, 'lk.portal.version'),
    connection,
    activeOperator: text(attributes, ACTIVE_OPERATOR_KEY),
    location,
    coordinates,
    model,
    control,
    attributes,
  };
}

/** Rows for the in-app "Expected attributes" reference. */
export const CONTRACT: { key: string; required: string; example: string; note: string }[] = [
  {
    key: ROLE_KEY,
    required: 'Yes',
    example: 'robot',
    note: 'Existing Portal key. Only participants with this value are listed.',
  },
  { key: FLEET_KEYS.city, required: 'No', example: 'Denver', note: 'Shown in Location.' },
  {
    key: FLEET_KEYS.country,
    required: 'No',
    example: 'US',
    note: 'ISO 3166-1 alpha-2 preferred. Shown in Location.',
  },
  {
    key: FLEET_KEYS.lat,
    required: 'No',
    example: '39.7392',
    note: 'Globe placement. Without it, the portal guesses from a built-in city table.',
  },
  {
    key: FLEET_KEYS.lng,
    required: 'No',
    example: '-104.9903',
    note: 'Globe placement. Set together with lat.',
  },
  {
    key: FLEET_KEYS.model,
    required: 'No',
    example: 'trossen-arm',
    note: `Known: ${Object.keys(MODEL_LABELS).join(', ')}. Anything else is shown as-is.`,
  },
  {
    key: FLEET_KEYS.control,
    required: 'No',
    example: 'teleop',
    note: `One of ${CONTROL_MODES.join(' | ')}.`,
  },
  {
    key: ACTIVE_OPERATOR_KEY,
    required: 'No',
    example: 'controller-curie',
    note: 'Existing Portal key. Shown under Control when set.',
  },
];
