# Workspace implementation and integration notes

The generalized client lives at `/workspace` in `teleop/web`. The home page links
to it. `/robot` and `/rover` retain their existing workflows.

## Try the workspace

Run `pnpm dev` from `web/`, then open `/workspace`. Supply a LiveKit URL and a
participant token for a room containing a compatible robot. The browser token
needs subscription, data publication, RPC, and own-metadata update permissions.
The connection form keeps credentials in memory; layout JSON never includes them.
Existing `NEXT_PUBLIC_ROVER_*` or `NEXT_PUBLIC_ROBOT_*` URL/token variables can
prepopulate the form. `NEXT_PUBLIC_LIVEKIT_URL` and `NEXT_PUBLIC_LIVEKIT_TOKEN`
take precedence when set.

Use **Open fixture workspace**, or visit `/workspace?fixture=1`, to exercise the
client without hardware. **Load example panels** adds a numeric plot, Boolean
indicator and state timeline. The fixture toolbar can publish a new topic,
remove the main camera and simulate reconnecting. Fixture command frames stay
inside the fake transport. They never enter a LiveKit room or reach a robot.

Use **Add visualization** to choose a view and topic. If a schema definition is
unavailable, **Preview JSON to find fields** creates a temporary consumer. Close
the preview or dialog to release it. Field paths are JSON arrays of literal keys
and indices, for example `["angular_velocity", "z"]`. Numeric joint views can
instead select one exact joint name; joint-state views can select several.
State labels come from an explicit map or supplied schema metadata.

Cameras appear automatically after valid discovery. Their initial order follows
usable frames; clicking a tile swaps it with the main camera. The camera deck
can move as one panel. An extra Video visualization can show a camera elsewhere
and apply a local side-by-side stereo interpretation.

Drag a tab, resize a divider, or use a panel's **Move** menu to arrange views.
Floating panels remain inside the browser window. **Hide** preserves a binding;
**Remove** deletes it. Inactive data tabs and hidden panels release demand.
Automatic cameras continue receiving even when their docked region is hidden.
Audio listening starts off, has a separate Listen action, and stops consuming
when its panel is inactive. Quiet audio does not generate a missing-data incident.

Edits save to this origin's localStorage under an exact robot identity. **Export
layout** downloads a snapshot. **Import layout** validates a file before replacing
the remembered layout. A failed import preserves the working configuration.
Storage failures leave editing and export available. **Reset layout** resets
the client layout only.

## Code boundaries

The non-React runtime is in `web/src/lib/teleop/`:

- `runtime.ts` owns selected robot, discovery generation, catalog and media demand.
- `validation.ts` parses discovery, detects duplicate JSON keys and checks exclusions.
- `streams.ts` shares one reader/JSON decode per publication while retaining
  independent field selection and freshness for each consumer.
- `selectors.ts` resolves literal paths and exact named joints.
- `cameras.ts` implements first-frame order, stable swaps, fallback and monitoring.
- `controls.ts` owns Portal handoff, feedback gates and command-session transitions.
- `layout.ts` validates and stores client layouts; `placement.ts` translates the
  application-owned placement format into Dockview's format.
- `livekit-transport.ts` isolates the vendored SDK. `fixture-transport.ts` is the
  fake transport used by the lab and deterministic tests.
- `xr.ts` provides explicit hand bindings, grip-relative fixture pose control,
  tracking checks and an XR camera view. It requires headset verification.

React views live in `web/src/components/workspace/`. The docking host reports
visibility to consumers; panels do not open their own SDK readers or publishers.
Media elements survive ordinary docking and tile swaps. Automatic videos disable
adaptive-stream pausing so offscreen/XR views remain live. This spends more
bandwidth than pausing invisible cameras.

V1 decodes explicit JSON frames. Schema IDs and encoding metadata come from the
vendored SDK; full schema-definition retrieval is optional and is not assumed.
Other encodings remain visible as unsupported. Data rates are optional client
settings, while every automatic camera uses discovery's positive default rate.
All missing-sample timing uses the shared monotonic-clock policy in `streams.ts`.

## Layout additions

The original minimal `layout_schema_version: 1` example remains accepted. The
implemented optional fields extend only the client layout:

- `source.joint_names`: exact names selected on each arriving named joint state.
- `source.kind`: `data`, `video`, or `audio`. Media sources use an empty `field_path`.
- Video settings: `image_layout` (`mono` or `stereo_sbs`) and `eye` (`left` or `right`).
- Audio settings: `volume` from 0 to 1 and Boolean `muted`. Listening activation
  is runtime state and is never restored from JSON.
- `controller_hands`: optional `left` and `right` interface IDs. One interface
  cannot be assigned to both hands. Missing interface IDs remain visible.
- `workspace`: a versioned split/tab tree plus floating bounds, described below.

```json
{
  "version": 1,
  "orientation": "HORIZONTAL",
  "root": {
    "type": "split",
    "weight": 1000,
    "children": [
      {
        "type": "group",
        "id": "main_group",
        "weight": 700,
        "panels": ["@cameras", "my_numeric_panel"],
        "active": "@cameras"
      }
    ]
  },
  "floating": []
}
```

Split direction alternates at each level from the root orientation. Weights
store relative splitter sizes. Group IDs use snake_case. Each group references
visible local panel IDs, plus reserved `@cameras`, `@controls` and `@catalog`
views. `active` must reference a tab in that group. Floating entries contain
`node`, `x`, `y`, `width` and `height`; imported bounds are constrained to the
current viewport. Unknown and duplicate references are rejected. Layouts without
placement use their exact `panel_order` to form a default arrangement.

`panels` and `panel_order` still include hidden panels. The placement tree does
not. No renderer class name, script, temporary publication ID, sample history,
token or armed input state is part of this format.

## Live adapter boundary

The Portal ownership exchange is implemented. It uses
`portal.set_active_operator` with the browser's raw identity or an empty release
payload and observes `lk.portal.active_operator`. It never invokes legacy
acquire/release RPCs. Every connection requires an explicit control request;
matching remembered ownership alone cannot arm motion.

Executable adapters currently apply **only to the fixture transport**. The
fixture implements all six proposed profiles to exercise UI behavior and command
lifecycles. Its limits are illustrative fixture limits, not hardware defaults:

| Fixture profile | Mapping and limits | Release |
| --- | --- | --- |
| Differential/holonomic Twist | Normalized input to ±0.5 m/s X/Y and ±0.8 rad/s Z yaw; differential Y stays zero. | Zero linear/angular velocity. |
| AckermannDrive | ±0.5 m/s speed, ±0.4 rad steering. | Zero speed and steering. |
| JointJog | Exact configured joint names, ±1 rad/s, duration 0.15 s. | Zero named-joint velocities. |
| JointTrajectory | Exact configured names, ±3.14 rad, one-second waypoint. Current positions required. | Fixture-defined hold at current joint positions. |
| PoseStamped | Grip-relative Cartesian target, ±2 m, normalized quaternion. Current pose required. | Fixture-defined hold at current feedback pose. |

Required feedback must be usable and no more than 1000 ms old in these fixture
adapters. Velocity inputs publish at 50 ms intervals; an input gap above 250 ms
disarms the fixture session. XR input additionally rejects sample gaps above
160 ms and jumps above 0.08 m or 0.5 rad. Real robots must implement their own
watchdogs and must not adopt these numbers without verification.

Live discovery keeps known but unverified profiles visible and disabled. Before
installing a live adapter, verify its schema, units, frames, exact joints, limits,
input scaling, required feedback and maximum age, release/cancellation semantics,
watchdog behavior, and active-operator enforcement. Provide it through the
`ControlManager` adapter registry; retain the one-writer and transition gates.
Do not change the fixture-only gate to enable a robot using example limits.

The current Trossen arm/camera manifest, binary telemetry/commands and legacy
lease exchange are not this discovery contract despite also using version 1.
The rover's legacy rev/s gains likewise do not prove SI-compatible Twist units.
Their gateways still need the discovery/Portal ownership/JSON translation work
listed in the implementation plan. Hardware and custom DataTrack subscription
permission enforcement have not been verified in this change.

## Checks

From `web/`:

```sh
pnpm test
pnpm test:browser
pnpm build
pnpm lint
```

Install the browser test binary once with `pnpm exec playwright install chromium`.
Browser tests reuse a development server on port 3000 when available; otherwise
they start one. `PLAYWRIGHT_BASE_URL` can select another running server.

Unit tests cover all 13 discovery examples, exact exclusions/names, field and
joint selection, shared streams, deadlines, persistence, ownership, command
switching and reconnect/selection races. Browser tests cover real generated video,
dynamic fields/panels, sharing and hiding, persistence and import/export, placement,
control switching and legacy route availability. Headset use, deployed gateway
behavior and physical hardware remain separate integration checks.
