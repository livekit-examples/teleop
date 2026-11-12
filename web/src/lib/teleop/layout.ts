import type {
  Layout,
  Panel,
  PanelSettings,
  Placement,
  PlacementNode,
  PlotSeries,
  Source,
  Visualization,
} from "./types";
import { GAUGE_DEFAULT_MAX, GAUGE_DEFAULT_MIN, HEX_COLOR } from "./gauge";
import {
  fieldPath,
  localId,
  object,
  parseJson,
  positive,
  string,
  strings,
} from "./validation";

export const SYSTEM_VIEWS = ["@cameras", "@controls", "@catalog"];
export const visualizationNames: Record<Visualization, string> = {
  plot: "Numeric plot",
  value: "Numeric value",
  gauge: "Gauge",
  boolean: "Boolean indicator",
  state: "State timeline",
  joints: "Joint states",
  raw: "Raw JSON",
  video: "Video",
  audio: "Audio listening",
};
export const MAX_SERIES = 8;
const finite = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number.`);
  return value;
};
const hexColor = (value: unknown, label: string) => {
  if (typeof value !== "string" || !HEX_COLOR.test(value))
    throw new Error(`${label} must be a #rrggbb color.`);
  return value.toLowerCase();
};
const known = (
  value: Record<string, unknown>,
  keys: string[],
  label: string,
) => {
  for (const key of Object.keys(value))
    if (!keys.includes(key))
      throw new Error(`Unsupported ${label} setting: ${key}.`);
};
/** Warn and error rates need an expected rate and must not rise above it or each other. */
function rateThresholds(
  input: Record<string, unknown>,
  expected?: number,
): { warn_rate_hz?: number; error_rate_hz?: number } {
  const out: { warn_rate_hz?: number; error_rate_hz?: number } = {};
  if (input.warn_rate_hz !== undefined)
    out.warn_rate_hz = positive(input.warn_rate_hz, "Warn rate");
  if (input.error_rate_hz !== undefined)
    out.error_rate_hz = positive(input.error_rate_hz, "Error rate");
  if (
    (out.warn_rate_hz !== undefined || out.error_rate_hz !== undefined) &&
    expected === undefined
  )
    throw new Error("Warn and error rates need an expected rate.");
  if (expected !== undefined) {
    if (out.warn_rate_hz !== undefined && out.warn_rate_hz > expected)
      throw new Error("Warn rate must not exceed the expected rate.");
    if (
      out.error_rate_hz !== undefined &&
      out.error_rate_hz > (out.warn_rate_hz ?? expected)
    )
      throw new Error("Error rate must not exceed the warn rate.");
  }
  return out;
}

export function validatePanel(raw: unknown): Panel {
  const p = object(raw, "Panel");
  known(
    p,
    ["visualization", "label", "visible", "source", "series", "settings"],
    "panel",
  );
  if (
    typeof p.visualization !== "string" ||
    !Object.hasOwn(visualizationNames, p.visualization)
  )
    throw new Error("Unsupported visualization.");
  const visualization = p.visualization as Visualization;
  if (typeof p.visible !== "boolean")
    throw new Error("Panel visible must be Boolean.");
  const source = object(p.source, "Source");
  known(
    source,
    ["kind", "track_name", "field_path", "expected_msg_type", "joint_names"],
    "source",
  );
  const kind =
    visualization === "audio"
      ? "audio"
      : visualization === "video"
        ? "video"
        : "data";
  if (source.kind !== kind)
    throw new Error(`${visualization} requires a ${kind} source.`);
  const result: Source = {
    kind,
    track_name: string(source.track_name, "Track name"),
    field_path: fieldPath(
      source.field_path ?? (kind === "data" ? undefined : []),
    ),
  };
  if (source.expected_msg_type !== undefined)
    result.expected_msg_type = string(
      source.expected_msg_type,
      "Expected message type",
    );
  if (source.joint_names !== undefined) {
    result.joint_names = strings(source.joint_names, "Joint names");
    if (
      kind !== "data" ||
      !["joints", "plot", "value", "gauge"].includes(visualization)
    )
      throw new Error("Joint selection requires a joint or numeric view.");
    if (visualization !== "joints" && result.joint_names.length !== 1)
      throw new Error("Numeric joint views select exactly one named joint.");
  }
  let series: PlotSeries[] | undefined;
  if (p.series !== undefined) {
    if (visualization !== "plot")
      throw new Error("Only numeric plots can have several series.");
    if (
      !Array.isArray(p.series) ||
      p.series.length < 1 ||
      p.series.length > MAX_SERIES
    )
      throw new Error(`A plot needs 1 to ${MAX_SERIES} series.`);
    series = p.series.map((raw) => {
      const item = object(raw, "Series");
      known(
        item,
        [
          "label",
          "track_name",
          "field_path",
          "expected_msg_type",
          "expected_rate_hz",
          "warn_rate_hz",
          "error_rate_hz",
        ],
        "series",
      );
      const entry: PlotSeries = {
        label: string(item.label, "Data label"),
        track_name: string(item.track_name, "Track name"),
        field_path: fieldPath(item.field_path),
      };
      if (item.expected_msg_type !== undefined)
        entry.expected_msg_type = string(
          item.expected_msg_type,
          "Expected message type",
        );
      if (item.expected_rate_hz !== undefined)
        entry.expected_rate_hz = positive(
          item.expected_rate_hz,
          "Expected rate",
        );
      Object.assign(entry, rateThresholds(item, entry.expected_rate_hz));
      return entry;
    });
    if (series[0].track_name !== result.track_name)
      throw new Error("The first series must use the panel source track.");
  }
  const input = object(p.settings, "Settings");
  const settings: PanelSettings = {};
  const allowed =
    kind === "audio"
      ? ["volume", "muted"]
      : kind === "video"
        ? ["image_layout", "eye"]
        : [
            "expected_rate_hz",
            "warn_rate_hz",
            "error_rate_hz",
            ...(["plot", "state"].includes(visualization)
              ? ["window_seconds"]
              : []),
            ...(visualization === "state" ? ["enum_labels"] : []),
            ...(visualization === "gauge"
              ? ["min", "max", "min_color", "max_color"]
              : []),
          ];
  known(input, allowed, visualization);
  if (input.expected_rate_hz !== undefined)
    settings.expected_rate_hz = positive(
      input.expected_rate_hz,
      "Expected rate",
    );
  Object.assign(settings, rateThresholds(input, settings.expected_rate_hz));
  if (input.window_seconds !== undefined) {
    settings.window_seconds = positive(input.window_seconds, "Plot window");
    if (settings.window_seconds > 600)
      throw new Error("Maximum plot window is 600 seconds.");
  }
  if (input.enum_labels !== undefined)
    settings.enum_labels = Object.fromEntries(
      Object.entries(object(input.enum_labels, "Enum labels")).map(
        ([key, label]) => [key, string(label, "Enum label")],
      ),
    );
  if (visualization === "gauge") {
    settings.min = finite(input.min ?? GAUGE_DEFAULT_MIN, "Gauge minimum");
    settings.max = finite(input.max ?? GAUGE_DEFAULT_MAX, "Gauge maximum");
    if (settings.min >= settings.max)
      throw new Error("Gauge minimum must be less than its maximum.");
    if ((input.min_color === undefined) !== (input.max_color === undefined))
      throw new Error("Gauge colors need both a minimum and a maximum color.");
    if (input.min_color !== undefined) {
      settings.min_color = hexColor(input.min_color, "Gauge minimum color");
      settings.max_color = hexColor(input.max_color, "Gauge maximum color");
    }
  }
  if (input.image_layout !== undefined) {
    if (!["mono", "stereo_sbs"].includes(input.image_layout as string))
      throw new Error("Unsupported image layout.");
    settings.image_layout = input.image_layout as "mono" | "stereo_sbs";
  }
  if (input.eye !== undefined) {
    if (input.eye !== "left" && input.eye !== "right")
      throw new Error("Image eye must be left or right.");
    settings.eye = input.eye;
  }
  if (input.volume !== undefined) {
    if (
      typeof input.volume !== "number" ||
      !Number.isFinite(input.volume) ||
      input.volume < 0 ||
      input.volume > 1
    )
      throw new Error("Volume must be between 0 and 1.");
    settings.volume = input.volume;
  }
  if (input.muted !== undefined) {
    if (typeof input.muted !== "boolean")
      throw new Error("Muted must be Boolean.");
    settings.muted = input.muted;
  }
  return {
    visualization,
    label: string(p.label, "Panel label"),
    visible: p.visible,
    source: result,
    ...(series ? { series } : {}),
    settings,
  };
}

function validatePlacement(
  value: unknown,
  panels: Record<string, Panel>,
): Placement {
  const p = object(value, "Workspace");
  known(p, ["version", "orientation", "root", "floating"], "workspace");
  if (
    p.version !== 1 ||
    !["HORIZONTAL", "VERTICAL"].includes(p.orientation as string)
  )
    throw new Error("Unsupported workspace placement version/orientation.");
  const seen = new Set<string>();
  const groups = new Set<string>();
  const node = (raw: unknown, depth = 0): PlacementNode => {
    if (depth > 20) throw new Error("Workspace is nested too deeply.");
    const n = object(raw, "Placement");
    const weight = positive(n.weight, "Placement weight");
    if (n.type === "split") {
      known(n, ["type", "weight", "children"], "split");
      if (!Array.isArray(n.children) || n.children.length > 100)
        throw new Error("Invalid workspace split.");
      return {
        type: "split",
        weight,
        children: n.children.map((child) => node(child, depth + 1)),
      };
    }
    known(n, ["type", "weight", "id", "panels", "active"], "group");
    if (n.type !== "group") throw new Error("Unknown workspace node type.");
    const id = localId(string(n.id, "Group ID"));
    if (groups.has(id)) throw new Error(`Duplicate workspace group ${id}.`);
    groups.add(id);
    const ids = strings(n.panels, "Workspace panel references");
    if (!ids.length) throw new Error("Empty workspace group.");
    for (const ref of ids) {
      if (
        (!Object.hasOwn(panels, ref) && !SYSTEM_VIEWS.includes(ref)) ||
        seen.has(ref)
      )
        throw new Error(
          `Unknown or duplicate workspace panel reference: ${ref}.`,
        );
      if (Object.hasOwn(panels, ref) && !panels[ref].visible)
        throw new Error(`Hidden panel ${ref} cannot have a placement.`);
      seen.add(ref);
    }
    const active = string(n.active, "Active tab");
    if (!ids.includes(active))
      throw new Error("Active tab is not in its group.");
    return { type: "group", id, weight, panels: ids, active };
  };
  const root = node(p.root);
  if (!Array.isArray(p.floating) || p.floating.length > 100)
    throw new Error("Invalid floating groups.");
  const floating = p.floating.map((raw) => {
    const f = object(raw, "Floating group");
    known(f, ["node", "x", "y", "width", "height"], "floating group");
    if (
      typeof f.x !== "number" ||
      !Number.isFinite(f.x) ||
      typeof f.y !== "number" ||
      !Number.isFinite(f.y)
    )
      throw new Error("Invalid floating coordinates.");
    return {
      node: node(f.node),
      x: f.x,
      y: f.y,
      width: positive(f.width, "Floating width"),
      height: positive(f.height, "Floating height"),
    };
  });
  return {
    version: 1,
    orientation: p.orientation as Placement["orientation"],
    root,
    floating,
  };
}

export function parseLayout(payload: string, robot?: string): Layout {
  const root = object(parseJson(payload), "Layout");
  known(
    root,
    [
      "layout_schema_version",
      "label",
      "robot_identity",
      "panels",
      "panel_order",
      "control_preferences",
      "control_channel_preferences",
      "controller_hands",
      "tracked_hands",
      "workspace",
    ],
    "layout",
  );
  if (![1, 2].includes(root.layout_schema_version as number))
    throw new Error("Unsupported layout_schema_version. Expected 1 or 2.");
  if (
    root.layout_schema_version === 1 &&
    root.control_channel_preferences !== undefined
  )
    throw new Error("Control channels require layout_schema_version 2.");
  // Layouts are portable: an imported layout is rebound to the target robot.
  const exported =
    root.robot_identity === undefined || root.robot_identity === ""
      ? ""
      : string(root.robot_identity, "Robot identity");
  const identity = robot ?? exported;
  const entries = Object.entries(object(root.panels, "Panels"));
  if (entries.length > 100) throw new Error("Maximum 100 panels per layout.");
  const panels = Object.fromEntries(
    entries.map(([id, p]) => [localId(id), validatePanel(p)]),
  );
  const order = strings(root.panel_order, "Panel order");
  if (
    order.length !== entries.length ||
    order.some((id) => !Object.hasOwn(panels, id))
  )
    throw new Error("panel_order must reference every panel exactly once.");
  const preferences = Object.fromEntries(
    Object.entries(
      object(root.control_preferences ?? {}, "Control preferences"),
    ).map(([id, value]) => {
      localId(id);
      const pref = object(value, "Control preference");
      known(pref, ["operation", "presentation"], "control preference");
      return [
        id,
        {
          operation: localId(string(pref.operation, "Operation")),
          presentation: string(pref.presentation, "Presentation"),
        },
      ];
    }),
  );
  const result: Layout = {
    layout_schema_version: root.layout_schema_version as 1 | 2,
    label: string(root.label, "Layout label"),
    robot_identity: identity,
    panels,
    panel_order: order,
    control_preferences: preferences,
  };
  if (root.control_channel_preferences !== undefined) {
    result.control_channel_preferences = Object.fromEntries(
      Object.entries(
        object(root.control_channel_preferences, "Control channel preferences"),
      ).map(([id, raw]) => [
        localId(id),
        Object.fromEntries(
          Object.entries(object(raw, "Control channels")).map(
            ([channel, value]) => {
              localId(channel);
              if (channel === "primary")
                throw new Error(
                  "Primary preferences belong in control_preferences.",
                );
              const pref = object(value, "Channel preference");
              known(pref, ["operation", "presentation"], "channel preference");
              return [
                channel,
                {
                  operation: localId(string(pref.operation, "Operation")),
                  presentation: string(pref.presentation, "Presentation"),
                },
              ];
            },
          ),
        ),
      ]),
    );
  }
  if (root.controller_hands !== undefined) {
    const hands = object(root.controller_hands, "Controller hands");
    known(hands, ["left", "right"], "controller hand");
    result.controller_hands = Object.fromEntries(
      Object.entries(hands).map(([hand, id]) => [
        hand,
        localId(string(id, "Interface ID")),
      ]),
    );
    if (hands.left !== undefined && hands.left === hands.right)
      throw new Error("An interface cannot be assigned to both hands.");
  }
  if (root.tracked_hands !== undefined) {
    const hands = object(root.tracked_hands, "Tracked hands");
    known(hands, ["left", "right"], "tracked hand");
    result.tracked_hands = Object.fromEntries(
      Object.entries(hands).map(([hand, id]) => [
        hand,
        localId(string(id, "Interface ID")),
      ]),
    );
    if (hands.left !== undefined && hands.left === hands.right)
      throw new Error("An interface cannot be assigned to both tracked hands.");
  }
  if (root.workspace !== undefined)
    result.workspace = validatePlacement(root.workspace, panels);
  return result;
}

export function emptyLayout(robot: string): Layout {
  return {
    layout_schema_version: 1,
    label: "My workspace",
    robot_identity: robot,
    panels: {},
    panel_order: [],
    control_preferences: {},
  };
}
export type LayoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export class LayoutStore {
  layout: Layout;
  saveStatus = "Saved locally";
  error = "";
  private key: string;
  constructor(
    robot: string,
    private storage?: LayoutStorage,
  ) {
    this.key = `teleop.layout.v1:${encodeURIComponent(robot)}`;
    this.layout = emptyLayout(robot);
    try {
      const saved = storage?.getItem(this.key);
      if (saved) this.layout = parseLayout(saved, robot);
      if (!storage) this.saveStatus = "Not saved: browser storage unavailable";
    } catch (error) {
      this.error = `Remembered layout could not be loaded: ${(error as Error).message}`;
      this.saveStatus = "Not saved";
    }
  }
  update(layout: Layout) {
    this.layout = parseLayout(
      JSON.stringify(layout),
      this.layout.robot_identity,
    );
    this.save();
  }
  import(payload: string) {
    const next = parseLayout(payload, this.layout.robot_identity);
    this.layout = next;
    this.error = "";
    this.save();
  }
  export() {
    return JSON.stringify(this.layout, null, 2);
  }
  save() {
    try {
      if (!this.storage) throw new Error("Browser storage unavailable");
      this.storage.setItem(this.key, this.export());
      this.saveStatus = "Saved locally";
    } catch (error) {
      this.saveStatus = `Not saved: ${(error as Error).message}`;
    }
  }
  reset() {
    this.layout = emptyLayout(this.layout.robot_identity);
    this.error = "";
    try {
      this.storage?.removeItem(this.key);
      this.saveStatus = this.storage
        ? "Remembered layout reset"
        : "Not saved: browser storage unavailable";
    } catch (error) {
      this.saveStatus = `Reset could not be saved: ${(error as Error).message}`;
    }
  }
}
