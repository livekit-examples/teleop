# Generalized teleop workspace implementation plan

Prepared November 6, 2026. This is a plan; it does not implement the new workflow.

## Recommendation and scope

Add a generalized `/workspace` route inside `teleop/web`. Build it around a
robot-session service, a shared stream service, a visualization registry, and a
movable panel workspace. Keep `/robot` and `/rover` working during migration.
Use the requirements and discovery contract as the authority when examples or
legacy implementations disagree.

The first useful release should let an operator select a robot, automatically
see its cameras, add several views of arbitrary JSON telemetry, arrange those
views, and return to the saved layout. Complete the control framework in the
same architecture, but enable live motion only through verified adapters.

The Foxglove-like goal here is a configurable workspace: add, configure, move,
resize, dock, and tab panels. It does not expand v1 into recording/playback,
an extension marketplace, a generic service browser, or a full 3D/transform system.

## What exists and what changes

The review covered the two Teleop pages, their telemetry, command, camera and
input helpers, the Trossen controller's discovery, ownership, joint, camera and
XR paths, the vendored DataTrack APIs, and the generalization examples.

| Area | Current implementation | Plan |
| --- | --- | --- |
| Entry and connection | `web/src/app/page.tsx` selects two environment-configured devices; each page creates its own session. | Add a connection entry for a room and an attribute-based robot selector within that room. Existing credentials may bootstrap connection, but must not define robot capabilities or topic bindings. |
| Robot page | `web/src/app/robot/page-client.tsx` places fixed scales, joystick, debug rows and source-based video overlays. | Preserve it as legacy. Reuse styling and input primitives after separating their command assumptions. |
| Rover page | `web/src/app/rover/page-client.tsx` fixes topics in `ROVER_CONFIG`, offers one IMU/battery panel slot, and removes that panel when its topic disappears. | Replace these assumptions in the new route with discovered inputs, independent panels and persistent unavailable bindings. |
| Telemetry | `components/rover/telemetry.ts` strips leading slashes, assumes JSON, creates subscriptions per hook and starts IMU/battery readers regardless of panel visibility. | Bind exact names, check encoding metadata, decode once, and make subscriptions follow consumer demand. Do not copy the NaN/Infinity text replacement into the generic JSON decoder. |
| Video | `components/rover/hud.tsx` already scopes video to one robot and swaps a tile with the main view. It orders publications rather than first usable frames; the page uses a bottom thumbnail row. | Retain the swap interaction, implement first-frame ordering and a left tile column, and add exclusions, loading and stale handling. |
| Rover control | `components/rover/commands.ts` builds names from robot names, uses legacy RPCs and describes drive values in rev/s. The page disables its acquire hook. `rover/joystick.tsx` sums pointer, keyboard and gamepad input. | Use advertised destinations and profile units; separate input presentations and allow one writer per interface. No inherited numerical gains or disabled ownership check. |
| Robot control | `hooks/use-acquire-control.ts` and `lib/acquire-control.ts` parse legacy acquire responses. `use-control-cmd-track.ts` sends a fixed custom command. | Implement Portal handoff and explicit command-session teardown in new modules. The old hook's cleanup is not a generalized release implementation. |
| Trossen discovery | `controller/src/controller-app.ts` has useful generation guards and discovery retries. `robot-manifest.ts` expects arrays of arms and cameras with roles and layouts. Robot detection excludes `controller-` identities. | Reuse lifecycle patterns, not this document parser or identity rule. Both documents use `schema_version: 1` but have different shapes. Validate the complete new shape. |
| Trossen control/XR | `joint-state-controller.ts`, `vr-arms.ts` and `vr-teleop.tsx` provide feedback gates, release patterns, pose clutching and tracking checks. Commands use custom binary frames; hand assignment is inferred from arm IDs. | Extract presentation behavior behind adapters; bind hands explicitly. These encoders are not JointJog, JointTrajectory or PoseStamped implementations. |
| Trossen video | `camera-controller.ts` manages video elements and XR visibility; `fps-controller.ts` measures actual video callbacks. Camera discovery still depends on its manifest. | Reuse frame-observation and XR visibility ideas, replacing camera-role filtering and fixed FPS thresholds. |
| Persistence | Teleop has no general panel layout. Trossen stores selected robot and connection information, not a portable visualization layout. | Add a separate validated, versioned layout store containing only client configuration. |

The Trossen application is a reference implementation, not a dependency to import
wholesale. Its imperative DOM controllers depend on `PageElements` and a different
SDK dependency (`livekit-client` 2.23.0 rather than Teleop's workspace fork).
Port small, tested behaviors into Teleop; do not create cross-repository source imports.

## Workspace behavior

The top bar contains connection and robot selection, discovery/ownership state,
`Add visualization`, layout import/export/reset, and local save status. Keep a
robot-wide control request/release action visible independently of panel focus.

The default workspace has a large camera panel, with every secondary live camera
in a column on its left. Telemetry and control panels occupy adjacent dockable
regions. Users can drag panels to another region, resize splits, group panels
as tabs, or float a panel within the browser workspace. Provide explicit move
actions as an alternative to dragging. Disable separate browser popouts in v1.

Treat the automatic camera deck as a movable, resizable panel. Its internal
main/left-tile policy stays intact when the deck moves. Video is available
without an add action or a saved camera list. As a small extension supporting
the requested individual video placement, allow `Add visualization > Video`
to create an additional view of an eligible camera. It shares the existing
video subscription and never replaces or disables the automatic deck.

Do not allow docking/tab visibility to pause automatic cameras. Keep their media
hosts alive outside transient panel mounts; account for offscreen tiles and XR
visibility explicitly. This policy is different from data-panel visibility.

`Add visualization` is a type-first flow:

1. Select numeric plot/value, Boolean indicator, enum/state timeline, joint-state
   view, raw inspector, audio listening, or an additional video view.
2. Select an eligible publication from the current robot, then compatible fields
   or exact joint names. Display message type, encoding and compatibility reasons.
3. If schema definitions are available, list schema fields without subscribing.
   Otherwise offer an explicit temporary JSON preview, visibly receiving samples.
   Opening the topic list alone must not subscribe. Closing/cancelling the preview
   releases its demand, including when no frame ever arrives.
4. Set title and view options, including optional data `expected_rate_hz`, then
   add the panel. Keep its source visible in its settings and status.

Multiple views can bind the same input. Removing a panel deletes its binding;
hiding one preserves it and removes its demand. An inactive data tab counts as
hidden. Last values and bounded history can remain in memory, but reopening starts
a new monitoring grace period. A control panel that becomes inactive ends its
input session and cannot leave a background command writer running.

## Architecture and proposed files

Keep transport and state machines outside React. Use a single workspace-scoped
runtime with injected transport, monotonic clock and scheduler. React reads small
snapshots, for example through `useSyncExternalStore`, and owns presentation only.
The following paths are proposed additions under `web/src`.

| Module | Responsibility |
| --- | --- |
| `lib/teleop/discovery/` | Runtime document validation, exclusion compilation and discovery retry policy. |
| `lib/teleop/session/` | Robot candidates, selection generation, reconnect lifecycle and teardown orchestration. |
| `lib/teleop/transport/` | LiveKit adapter plus fake transport; isolates SDK events, streams, permissions and RPCs. |
| `lib/teleop/catalog/` | Publication metadata, stable endpoint bindings, expected-but-absent inputs and compatibility. |
| `lib/teleop/streams/` | Consumer registrations, one reader/decoder per current data publication, last values and bounded buffers. |
| `lib/teleop/decoders/` | Explicit JSON decoder and scalar/joint field selectors; optional schema-definition provider. |
| `lib/teleop/monitoring/` | Shared rate policy, per-consumer health, observed rates and outage transitions. |
| `lib/teleop/media/` | Automatic camera ordering, persistent video elements/frame observers, audio playback and XR visibility. |
| `lib/teleop/controls/` | Portal ownership, profile registry, per-interface sessions, input arbitration and command publishers. |
| `lib/teleop/layout/` | Layout types/validation, workspace placement codec, browser storage and import/export. |
| `components/workspace/` | Shell, panel chrome, docking host, topic/field picker, settings and status. |
| `components/visualizations/` | Renderer registry and numeric, Boolean, state, joint, raw, video and audio views. |
| `components/controls/` | Joystick, keyboard, gamepad, joint-slider and lazy-loaded XR presentations. |
| `app/workspace/` | New route and client-side runtime/provider setup. |

Do not make a panel register room listeners or call `publishDataTrack` directly.
A renderer registration supplies its settings validator, compatibility check,
dependency selector and component. A control adapter separately supplies command
semantics and release behavior. This avoids coupling a new plot to robot motion.

Recommended library choices, to validate in the first implementation slice:

- Use `dockview-react` behind `WorkspaceHost`. Its documented docking, floating
  groups and serialization match this interaction model. Pin a compatible version
  after checking the installed React/Next build, keyboard access and video
  remount/visibility behavior. Keep the application layout independent of its
  serialized internals. See the [Dockview repository](https://github.com/dockview/dockview).
- Use a small `uPlot` wrapper for numeric time series; retain the rover canvas
  plot as a reference for buffering and visual style. Keep Boolean/state rendering
  simple. Verify resize, null gaps and streaming behavior with representative
  data before pinning. See the [uPlot repository](https://github.com/leeoniya/uPlot).
- Add focused unit tests with a fake clock/transport and browser tests for the
  workspace. Vitest and Playwright are reasonable candidates; they are not
  currently application test dependencies.

No library or dependency changes are part of this planning task.

## Runtime rules that must shape implementation

### Discovery, identity and reconnection

- Require robot attributes `lk.portal.role=robot` and `lk.portal.version="3"`;
  set browser role/version to `operator`/`"3"`. List incompatible robots with
  reasons. React to initial attributes and attribute changes.
- Configure explicit media subscriptions before connecting. Register transport
  listeners before connection and also seed from existing participants/tracks.
  Do not let a default auto-subscribe path consume excluded media first.
- Fetch `get_robot_config` with payload `""`, `responseTimeout: 3000`, at most
  three attempts and 500 ms between attempts. Reject invalid replies; do not
  retry parsing errors as though they were missing publications.
- Validate known fields, snake_case local IDs, required maps, feedback references,
  command contracts, positive finite rates and portable exclusion patterns.
  Reject legacy collections; retain unknown profiles as unsupported. Detect
  duplicate map keys before ordinary JSON parsing discards them, particularly
  operation IDs. Unknown optional fields are inert.
- Compile full-name, case-sensitive regex matches once. Test alternation and
  exact matching; never normalize external names or fall back to permissive
  exclusions after a pattern error.
- Every async RPC, subscription, frame and input callback carries a generation.
  Invalidate it immediately on selection change, robot departure, incompatible
  attributes or reconnect start. Disable writes synchronously, then tear down old
  consumers and attempt the old profile's release against the old endpoint.
- On reconnect, refetch discovery before starting media demand. Reset freshness,
  camera first-frame ordering and all motion input caches. Close old readers on
  reconnect start so SDK automatic resubscription cannot bypass revalidation.
  Saved selections survive; active motion and old fresh timestamps do not.
- On discovery failure, allow metadata inspection, display the error and keep
  commands and new media consumption disabled.

### Catalog, decoding and shared demand

Use `(robot_identity, media_kind, exact_track_name)` as the stable receive key.
Publication SIDs are generation-local handles, never persisted identity. Merge
live publications with saved data bindings, optional audio expectations and
control feedback references. Preserve absent/excluded entries and explain them;
exclude them from eligible pickers. Never bind a substitute topic or robot.

Each consumer registers dependencies and its own selector/rate requirements.
Data and audio acquire a subscription on first demand and release it on last
demand. Hidden control feedback dependencies can remain active while a control
is enabled, even with no telemetry panel. Required joint names are matched
exactly on every message; a message omitting right-arm joints cannot refresh that
arm because left-arm joints arrived.

The fork exposes `RemoteDataTrack.info.schema`, `info.frameEncoding` and
`subscribe({signal, bufferSize})`. Multiple SDK subscribers already share a
network pipeline, but the application still needs one reader and one decode
per publication to avoid repeated parsing and coordinate consumer lifetimes.
There is no expected-rate field in the inspected `DataTrackInfo`. No full
schema-definition retrieval API was found in the inspected DataTrack/participant
APIs; make the schema provider optional and start with JSON preview.

Decode only explicit `frameEncoding: "json"` in v1. Missing/other encodings stay
visible as unsupported; do not guess from message names or payload bytes. Preserve
arrival diagnostics even when decoding or field selection fails. A schema ID
is not a definition. A missing definition does not block raw JSON/scalar views.
Enum labels require schema metadata or a saved explicit map; unmapped values
remain visibly unmapped rather than receiving invented labels.

Resolve field paths as arrays of literal own-property names/non-negative array
indices, without evaluation or inherited-property traversal. Select named joints
by name at runtime. Store bounded plot buffers outside React; use receive time
for v1 plot axes and health, batch rendering, and cap history by time and sample
count. Preserve missing-data gaps and last values without calling them fresh.

### Video and audio

Automatically subscribe to every eligible video after valid discovery, including
later arrivals. Each publication gets a media host and loading tile before its
first frame. On its first usable decoded/presented frame, assign its received
ordinal; the first ready camera becomes main. Break ties by callback order.

Maintain the main key and tile slots separately. Selecting a tile swaps exactly
those two slots. New ready cameras append without replacing a user selection.
Unpublishing main selects the first remaining usable tile and reports the lost
source; if none is usable, show waiting with any loading tiles. A stalled main
keeps its slot and stale label. Reset this policy each connection; saved camera
choices cannot override first-frame selection. Labels are published track names,
and full-frame display is the default. Stereo interpretation is an explicit
local setting, never inferred from name, role or image dimensions.

Measure real frame progress per camera with video frame callbacks and a tested
decoded-frame counter fallback where needed. Reattaching an element or repainting
React does not count as a new source frame. Keep every eligible stream receiving
through tile selection and docking/XR transitions. Reuse Trossen's visibility
approach only after checking the fork's actual API. If necessary for v1, disable
adaptive pausing on these automatic videos and document the bandwidth tradeoff.

Audio starts disabled. Enabling listening acquires demand; stopping listening
releases it. Offer mute and volume, and show autoplay/codec/permission failures
as playback status. Quiet audio is valid and has no missing-sample deadline.

### Monitoring and status

Maintain transport arrival, usable decoded/selected sample and display-progress
counters separately. Implement one configurable policy using `performance.now()`:

| Policy | Value |
| --- | --- |
| Expected period | `1000 / expected_rate_hz` ms |
| Startup grace | `max(3000, 5 * expected_period_ms)` |
| Stale deadline | `max(1000, 5 * expected_period_ms)` after last usable sample |
| Observed-rate window | `max(5000, 10 * expected_period_ms)` |

Each data consumer can have a different expected rate on the same decoded
stream. No configured rate means no missing-data timer/incident. Required
control feedback has its own adapter-defined maximum age, even when its plot is
unmonitored. Every automatic video uses the required discovery default rate.
Rates reject Boolean, zero, negative, non-finite and malformed values.

Use exactly the required statuses: `not_requested`, `starting`, `healthy`,
`stale`, `unmonitored`, `unavailable`, `invalid`, `unsupported`, `excluded`.
Keep availability/compatibility details separate from rate metrics so reason
labels take precedence. An absent, rate-monitored binding starts its timer even
without a publication and becomes stale only after grace; an absent unmonitored
binding is unavailable. Unsupported decoding and invalid selected fields are
explained as such, rather than as a missing-frame outage. A valid sample recovers
its own consumer. Never emit incidents with no demand or for excluded inputs.

Log outage/recovery transitions with endpoint and duration, not individual lost
frames. Suppress duplicate stream outages during robot/room disconnects.
Receive freshness, equipment readiness and ownership remain separate states.

### Controls and command lifecycle

Implement Portal's handoff independently of legacy ownership code:

- Request with `portal.set_active_operator`, payload equal to the browser's raw
  identity; success is `""`. Continuously observe `lk.portal.active_operator`.
- Release with payload `""` only if the latest known owner is this browser.
  This is a handoff, so another operator is not an exclusive lease lockout.
- Require a successful explicit request in this browser connection plus current
  owner confirmation before motion. Persisting an owner attribute cannot arm it.
- Apply selected-robot subscription permissions before publishing commands and
  verify enforcement for custom DataTracks against the deployed server. Maintain
  robot-side active-operator checks for every advertised input regardless.

For each interface, expose separate operation and presentation selectors, with
all advertised choices and reasons for unavailable ones. A profile registry
defines schemas, wire field mapping, frames, units, limits, scaling, activation,
mandatory feedback, age limits, command cadence and release/stop behavior.
An incomplete or unknown adapter stays visible and disabled.

Use one active presentation session per interface and prevent concurrent writers
to a shared command destination. Different interfaces may operate simultaneously;
explicit hand bindings assign independent XR controllers. Split the rover's
combined joystick/keyboard/gamepad behavior into independent presentations.

A mode/presentation change must be an awaited transition:

1. Revoke the old writer token immediately.
2. Send the old adapter's release/stop while connected, flush queued output when
   supported, then close obsolete publishers.
3. Remove old handlers, clear input and activation caches, and bind the new mode.
4. Leave it disarmed until the operator returns inputs to neutral and activates
   afresh. If release/flush fails or connection changes, display why and stay disarmed.

Use the same transition for ownership loss, panel hiding, robot changes,
disconnection and page exit where transport is available. Do not rely on React
effect cleanup ordering for an asynchronous stop. The robot watchdog still owns
communication-loss stopping; SDK flush is not proof of robot execution.

Position sliders initialize from current required joint positions and use the
trajectory adapter; velocity sliders use JointJog, show velocity units and
return to neutral on release. Never carry a held slider value into another mode.
VR requires the actual Cartesian endpoint, current reference feedback and a
verified coordinate/release adapter; it cannot relabel joint commands as poses.
Optional feedback cannot block a profile or cause protocol fallback.

### Layout model and storage

Implement the documented `layout_schema_version: 1` envelope and read the
existing `layout-examples/dynamic-topics.json` unchanged. Preserve stable panel
IDs, `panel_order`, exact bindings, literal field paths, named-joint selectors,
visibility, settings, enum maps and `control_preferences`.

Before implementation, document the missing client-owned placement shape:
add an optional `workspace` object with a versioned split/tab tree, split ratios,
floating bounds and references to panel IDs plus reserved camera/control views.
Also define typed video/audio sources and explicit controller-hand bindings.
These are additions to the proposed client layout format, not robot discovery.
Layouts lacking placement use `panel_order` to build a default arrangement.
Keep a codec between this application format and the docking library's format.
Do not persist arbitrary component names or executable renderer settings.

Validate panel IDs and every reference, uniqueness, settings and supported
versions before atomically replacing the layout. A hidden panel still appears
once in `panel_order`; invalid tree references and repeated placements are
rejected. An import for another identity must not change the selected robot or
start consumption; explain the mismatch and preserve the working layout.

Use an origin-local, robot-identity-specific localStorage key and debounced
autosave after edits. Show saved/unsaved/failure state. Keep in-memory edits and
JSON export available on storage failure. Reset removes remembered client layout
only. Export serializes the same configuration stored locally; the downloaded
file is an independent snapshot. Imports validate completely before adoption.

Resolve restored bindings only after the selected robot's current discovery
validates. Apply exclusions and schema compatibility again. Restore unavailable
and unsupported panels in place. Hidden data panels create no demand. Control
preferences restore selections only: no ownership request, command publication,
arming, held input or payload replay. Never save tokens, credentials, telemetry
history, freshness timestamps or temporary publication IDs.

## Delivery sequence and completion gates

Each slice should be independently reviewable and leave the legacy routes usable.

| Slice | Deliverables | Completion gate |
| --- | --- | --- |
| 1. Foundations and decisions | Confirm layout placement/source/hand-binding types; read installed Next guides; verify fork APIs, subscription permissions and RPC timing; add fake transport/clock and fixture event sequences. Spike docking/video mounting and plot resize. | Core decisions recorded, all 13 discovery examples load as fixtures, no hardware dependency. No live command adapter enabled. |
| 2. Discovery and session | New `/workspace` route, room connection, role/version robot selector, parser, exclusions, generations and reconnect orchestration. Add navigation without replacing `/robot` or `/rover`. | Invalid discovery cannot consume new media or send commands; late replies/frames from another generation are ignored; metadata remains inspectable. |
| 3. Shared streams and monitoring | Exact-name catalog, expected absent bindings, JSON decoder, selectors, reference-counted dependencies, policy/status/logging. | Two consumers decode once; hiding one preserves the other; absent monitored inputs time out; no demand creates no incident; required-joint selectors stay independent. |
| 4. Automatic media | Camera deck, first-frame selection, stable swaps/fallbacks, local image options, per-video progress and opt-in audio. | Initial and new videos work without a camera list; exclusions win; loading and stale differ; tiles stay live; reconnect resets main; audio never autoplays or treats quiet as failure. |
| 5. Configurable workspace | Docking host, panel registry, add/settings flow, temporary preview, numeric/Boolean/state/joint/raw views and optional duplicate video view. | Several arbitrary dynamic topics can be viewed at once and moved/resized; field errors and unsupported encodings remain visible; preview teardown releases demand. |
| 6. Persistence | Layout validator/codec, autosave/status, import/export/reset and restore reconciliation. | Existing minimal layout and full workspace round-trip; malformed import preserves working layout; missing/excluded sources persist; storage failure leaves export working. This completes the viewing milestone. |
| 7. Control framework and presentations | Portal ownership, profile registry, one-writer sessions, mode switch transactions, control UI, sliders and explicit XR hands. Use fake executable adapters first. | Every advertised mode remains visible; ownership loss and all switch failures disarm; no cached input replay; independent interfaces can run together without competing writers. |
| 8. Verified adapters and rollout | Document and connect robot-side discovery/ownership/encoding/stop support; validate differential drive first, then arm operations and XR; cover other advertised profiles with fake tests until verified. | Each enabled live profile has an adapter specification and simulator/hardware evidence. All requirement acceptance checks pass; unverified profiles remain visibly disabled with reasons. |

The dependency chain is 1 → 2 → 3; media and visualization work then build on
that shared runtime. Persistence requires stable panel/settings types. Live
adapter enablement requires both the control framework and robot-side verification.
Do not postpone demand/monitoring until after building independently subscribing panels.

## Robot integration work and unresolved facts

The generalized viewing milestone can ship against fixture robots before these
deployment dependencies are complete. Full live-control completion must track
them explicitly:

| Dependency | Required resolution |
| --- | --- |
| ROS Portal gateway | Return this discovery contract via `get_robot_config`; provide the exact role/version/ownership exchange and JSON publication metadata; gate each incoming command on active operator. Stock routes alone do not establish this application contract. |
| Trossen gateway | Its inspected `robot/src/main.cpp` currently serves the arm/camera manifest and acquire/release exchange. Add a compatible discovery/Portal ownership path and JSON state/command translation for the advertised profiles, preserving existing clients as needed. Do not advertise ROS profile names for the current binary protocol. |
| Drive units and limits | Confirm robot-side Twist semantics, speed/yaw bounds, coordinate signs and any rev/s conversion. The old gain of 2 is not evidence of SI-compatible Twist behavior. |
| Joint/Cartesian lifecycle | Obtain exact joint names, units/limits, velocity scaling, trajectory cancellation/hold semantics, pose frame/reference and release behavior. The draft discovery examples do not supply all these facts. Store verified device limits in an adapter configuration until a documented contract extension exists. |
| SDK/server permissions | Prove another robot cannot subscribe to command DataTracks. Keep robot authorization even after that proof. |
| Schema retrieval | Leave full definitions optional unless a supported publisher SDK API is demonstrated. Do not add a schema compiler, type repository or a generic RPC workaround. |
| Discovery timeout | The fork sends an effective minimum timeout to the peer while its local timer uses the requested response timeout. Test the actual 3000 ms call behavior, including send/ack delays, rather than copying the other app's timeout comment. |
| Browser/XR media | Verify offscreen tile and XR decoding under adaptive streaming and browser playback rules. Do not silently unsubscribe to reduce resource use. |

## Verification and rollout

Use deterministic behavior tests for the state machines and browser tests for
interaction/media behavior. Add tests as these modules are implemented, rather
than tests that merely repeat fixture JSON.

| Coverage | Scenarios |
| --- | --- |
| Discovery and isolation | Initial participants, role/version updates, bad document/version/regex/rates, exact names, three retries, selection/reconnect races, old frames and wrong-robot events. |
| Dynamic inputs and demand | Undeclared data/video/audio arrival, publication removal/reappearance with a new SID, exclusions overriding saved/expected/required inputs, two consumers/one decode, hidden panels and preview cleanup. |
| Data and health | JSON with/without definitions, absent encoding, malformed payload, wrong fields, unmapped enums, named-joint reorder/omission, deadline boundaries, jitter/loss recovery, no-rate inputs, distinct arrival/sample/display counters and disconnect suppression. |
| Video/audio | Publication order differs from first-frame order, loading camera before a ready camera, callback ties, stable slot swap, new camera after user choice, main removal/stall, every video monitored, XR/offscreen continuity, blocked audio playback and quiet audio. |
| Layout | Minimal/full layout round-trip, automatic save/reload, robot identity isolation, missing/excluded/incompatible restored topics, unsupported versions/settings, duplicate references, failed import/storage and reset/export. |
| Controls | Portal handoff and owner changes, explicit request each connection, unsupported modes, required versus optional feedback, release-before-rebind, failed release/flush, held-key/gamepad/slider/VR reset, position versus velocity semantics, two explicit XR hands and destination collisions. |
| Regressions and integration | Legacy route smoke checks; camera-only fixture; rover with/without added arms retains identical base commands; dual-Panda uses one joint subscription with independent selectors; fake ownership/command spy observes zero commands from layout import/restore. |

For application changes run `pnpm build` and `pnpm lint` from `teleop/web`, plus
the added focused tests. The build already runs the vendored SDK build through
`prebuild`; keep the workspace fork intact. Add test scripts as part of slice 1.
The installed `web/AGENTS.md` requires reading the bundled Next.js guides before
code changes; the client/server guide was inspected for this plan.

Exercise a representative multi-panel workload and record message rate, decode
count, render frequency, memory bound and video continuity; tune rendering rather
than dropping required video subscriptions. Verify motion in a simulator before
hardware and record robot-side watchdog/ownership results per live adapter.

Expose the new route as an additional entry first. Promote it after the viewing
and verified-control gates pass. Keep the legacy routes available through that
validation period. The final implementation report must distinguish passing
fixture/browser checks from incomplete adapter or hardware verification.

## References

- [Web-app requirements](web-app-requirements.md) and [discovery contract](contract.md).
- [Discovery examples](examples/) and [minimal dynamic-topic layout](layout-examples/dynamic-topics.json).
- [Teleop web instructions](../web/AGENTS.md).
- [LiveKit data tracks](https://docs.livekit.io/transport/data/data-tracks/) for demand, stream lifecycle and flush behavior.
- [LiveKit media subscriptions](https://docs.livekit.io/transport/media/subscribe/) for subscription control and adaptive-stream visibility.
- [ROS Portal configuration](https://docs.livekit.io/robotics/integrations/ros-portal/configuration/) for gateway routing context; the local application contract remains authoritative for this plan.

This plan adds one document only. No application, adapter, dependency or hardware
behavior has been changed or tested by creating it.
