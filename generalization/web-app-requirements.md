# Teleop web app requirements, v1

This document defines how the web app must use the
[discovery contract](contract.md). These are implementation requirements.
The current `web/` application does not yet implement the generalized workflow.

## Robot selection and discovery

Use participant role and protocol-version attributes to identify compatible robots.
Do not infer a robot's role from its display name or identity prefix.
Keep browsing and viewing separate from ownership of robot control.

When the user selects a robot, fetch its static `get_robot_config` document.
Validate the document before enabling commands. On reconnect, fetch it again and
clear old sample freshness and motion-input state.

Use the exact attributes, RPC payloads, and retry policy in the contract.
Keep a selection or connection generation counter. Ignore late RPC results,
frames, and callbacks from an older generation or another robot.

Read the initial data, video, and audio publications. Update the available
catalog on publication, removal, participant, and reconnect events.
Apply the selected robot's global exclusions to each media kind.

Discover every remaining publication, including tracks absent from the document.
Do not use `audio_tracks` as an allowlist. Data subscriptions follow active
consumer demand. Video subscriptions follow the automatic video behavior below.

Start with every track enabled. Disable it only when its name matches a regex
in the corresponding `exclude_*_tracks` list. Empty or omitted lists disable nothing.
Data tracks need no configuration entry. Read their type and encoding metadata
from the publication. There is no robot-side data-topic inventory to load or validate.

An exclusion overrides an expected declaration. Keep a saved binding as `excluded`
without subscribing or monitoring it. If required control feedback is excluded,
show that control as unavailable and explain which input is excluded.

Merge the live catalog with optional audio entries, saved data selections,
and control feedback bindings. An input named by one of those bindings remains
visible as unavailable until its publication appears.

If discovery fails, show the failure and keep commands disabled. The user can
inspect publication metadata. Start new media consumption only after current,
valid discovery provides the exclusions and required video-rate setting.
Saved layouts must not override the robot's current exclusions.

## Control selection

Show every `control_interfaces` entry in a visible selector. Show every advertised
operation and presentation for the selected interface. Switching modes must not
require reconnecting or editing configuration files.

Display unavailable modes with their reasons. Examples include a disconnected
gamepad, an unavailable XR session, an unknown profile, and missing feedback.
Never silently hide an advertised option or silently select a different protocol.

For compatible operations, offer the advertised joystick, keyboard, gamepad,
joint-slider, and VR presentations. The client chooses its screen arrangement.
The robot's operation contract determines the command mapping and units.

Present operation mode and input presentation as separate selections. The same
joint-slider component supports Position and Velocity through their respective profiles.
Initialize position sliders from current joint positions. Velocity sliders return
to neutral when released. Never reinterpret a held slider value during a mode change.

A VR pose mode requires its advertised Cartesian endpoint and adapter. It must
not send joint commands as pose commands. Joint sliders must distinguish position
and velocity commands in their labels and behavior.

The UI can control independent interfaces at the same time. For example, separate
VR hands can operate independent arm interfaces. Explicit user bindings determine
hand assignment. Labels and substrings in joint names cannot determine it.

Only one active presentation can send commands for a given interface at a time.
Multiple visible controls must not compete for the same command destination.
Robot-wide ownership still applies to all interfaces.

Use only `required_feedback_tracks` to block an operation for missing feedback.
Optional feedback remains selectable for display without becoming a motion prerequisite.
When a profile requires a feedback age limit, enforce it independently of visualization monitoring.

Keep unknown profiles visible as unsupported. An advertised presentation is not
permission to execute an adapter that lacks its command or release implementation.
The example generator's known-profile list validates fixtures, not runtime discovery.

## Switching control modes

A mode change must end the old input session before the new session can send.
The client must use the old profile's release or stop behavior.
The robot's own watchdog remains responsible for stopping after communication loss.

1. Disable further command writes from the old input source.
2. Send the old profile's release or stop command when connected.
3. Flush queued output when the transport supports it.
4. Remove old input handlers and reset their cached input values.
5. Bind the selected operation and presentation.
6. Require fresh operator activation before sending motion.

If release or flushing fails, show the failure and keep the new mode disarmed.
Never replay a held key, displaced joystick, or old VR pose after switching.
Saved mode preferences restore the selection without restoring active motion.

On ownership loss, robot selection changes, or disconnection, disable motion
inputs and apply the profile's release behavior when possible.
The robot must enforce ownership independently of the GUI.

Implement the Portal handoff exchange from the contract, not the legacy acquire
hooks. Restrict local command-track subscription permissions to the selected robot.
Keep robot-side command authorization in place even when the GUI disables inputs.

## Add visualization workflow

Provide an `Add visualization` action. Offer numeric plots, Boolean indicators,
enum or state timelines, joint-state views, and a raw-data inspector.
Offer audio listening controls for eligible audio publications.

After the user selects a view, list compatible discovered topics and fields.
Use published schemas to explain compatibility. No telemetry declaration in the
robot document is required to select a data track or its fields.

If schema definitions are unavailable, offer an explicit JSON preview to inspect
field paths. The preview is a temporary consumer and must release its subscription
when closed. Do not create permanent background subscriptions to populate field pickers.

Numeric plots select numeric fields or joint values. Boolean indicators select
Boolean fields. Enum views use schema enum metadata or a saved value-to-label map.
Do not guess enum labels from arbitrary integers.

Unknown JSON types can use the raw inspector and compatible scalar views.
Unsupported encodings remain visible with an explanation. They must not be
misreported as missing data when undecodable frames are arriving.

Preserve selected inputs when publications disappear. Show unavailable, excluded,
or unsupported status in the existing data panel. Never silently bind another
matching data topic or another robot.

## Automatic video display

Automatically subscribe to all non-excluded video tracks from the selected robot.
Subscribe to existing publications on selection and new publications as they appear.
Do not require a `videos` configuration field or an `Add visualization` action.

The first received video becomes the large main view. Display every other video
as a smaller live tile in a left-side column. Use received order rather than
alphabetical track-name order for the initial arrangement.

Selecting a tile promotes it to the main view. Put the previous main video in
the selected tile's slot and leave other tiles in place.
Continue receiving every eligible video after a selection.
New arrivals must not replace a main video that the user selected.

When a publication exists but frames have not arrived, show a loading tile.
Use the first track with usable video for the initial main view.
If no video is received, show a waiting state.

If the main track is unpublished, select the first remaining tile with usable video and
show which source became unavailable. If none remain, return to the waiting state.
A stalled main track retains its selection and displays stale status.

On robot selection changes, remove the previous robot's video elements and
subscriptions. On a new connection, choose the first received video again.
An old saved camera selection must not override that initial choice.

The main view and live tiles are video consumers for monitoring. Keep tiles live
when the main selection changes. Account for adaptive-stream visibility and XR
rendering so these views do not remain paused accidentally.

Use the published track name for its tile label. No camera role, attachment,
or robot-provided image layout is required. Start with normal full-frame display.
Explicit local image settings can select a supported stereo interpretation.

Use first usable frame order, not publication order or subscription-event order.
Break ties with the order of the client callbacks. Keep tile positions stable
when selecting a new main view. This policy resets on a new connection.

## Subscriptions and dependencies

An active consumer is a visible data visualization, an enabled control input that
needs feedback, a displayed video, or an enabled audio output. Consumers declare their dependencies
inside the client. They do not call a robot start-streaming RPC.

For data and audio, establish a subscription when the first consumer needs a stream.
For data with a configured rate, start the monitoring timer even when its publication
is absent. Audio has no missing-sample deadline. The subscription signals demand
when a producer uses that signal.

Share one decoded stream across consumers of the same publication. Removing or
hiding one panel removes only that panel's demand. Stop the subscription and
its timer when no active consumer needs it. Video subscriptions remain active
under the automatic video policy until exclusion, unpublication, robot change, or disconnection.

Keep dependencies active even when they have no visible panel. For example, a
spatial visualization can depend on frame transforms. A hidden IMU panel creates
no demand unless another active consumer still needs that stream.

For shared joint state, select values by exact joint name. Fresh messages that
omit a consumer's required joints cannot mark that consumer healthy.
The dual-Panda example uses one subscription with separate left and right selectors.

## Rates, freshness, and status

Use a local monotonic clock, such as `performance.now()`, for receive-time monitoring.
Clock alignment and capture-age measurement are deferred. Neither lossy delivery
nor publication presence expires the last value stored by a panel.

For data streams, use the saved visualization's optional `expected_rate_hz` setting.
Do not require publisher rate metadata that the current SDK does not expose.
Without an expected rate, do not monitor data for missing samples.
For automatically displayed videos, always use `default_video_rate_hz`.
No video can disable monitoring through an omitted or zero rate.

Use one shared startup grace and rate-tolerance policy in the client. Its thresholds
must allow jitter and packet loss. Do not emit a failure for each dropped frame.
Display an observed rate separately from a complete lack of usable samples.

Use these initial client defaults. Keep them in one configurable policy module,
not repeated across renderers or added as per-topic robot declarations.

| Measurement | Initial policy |
| --- | --- |
| Expected period | `1000 / expected_rate_hz` milliseconds. |
| Startup grace | `max(3000, 5 * expected_period_ms)` after demand starts. |
| Stale deadline | `max(1000, 5 * expected_period_ms)` after the last usable sample. |
| Observed-rate window | `max(5000, 10 * expected_period_ms)` milliseconds. |

Only declare stale after startup grace expires. A valid new sample recovers the
consumer. No configured data rate means no missing-sample deadline or outage incident.
Rates must be positive finite numbers. Reject zero, negative, Boolean, or non-finite values.

Track transport arrivals, usable decoded samples, and display progress separately.
Invalid payloads do not refresh a visualization's usable-sample timer.
For video, measure decoded or presented frames rather than repeated UI render ticks.

Use these status meanings throughout the app:

| Status | Meaning |
| --- | --- |
| `not_requested` | No active consumer needs this input. |
| `starting` | A consumer needs it and the startup grace has not expired. |
| `healthy` | Usable samples arrive within the monitoring policy. |
| `stale` | No usable sample arrived before the deadline. |
| `unmonitored` | Data has no configured expected rate. |
| `unavailable` | A selected publication is absent and no missing-sample deadline applies. |
| `invalid` | Frames arrive but required decoding or selected fields fail. |
| `unsupported` | The client lacks the required decoder, renderer, or profile. |
| `excluded` | A global exclusion blocks the saved binding. |

Unavailable, excluded, invalid, and unsupported states take precedence over a
receive-rate label. A saved input without a configured rate can be unavailable
without generating a missing-data failure. Return to `unmonitored` after usable data arrives.

A stream with no active consumer must not produce missing-data incidents.
When its panel becomes active again, start a fresh grace period.
Incompatibility with a saved field binding or control profile needs an explicit
explanation. Subscription permission failures also need an explicit explanation.

Log transitions such as stale and recovered, with stream identity and outage duration.
Avoid a log entry per missing frame. When the room or robot disconnects,
report the connection failure and suppress duplicate per-stream outage messages.

Fresh telemetry is separate from equipment readiness and control permission.
A robot fault can appear inside a healthy stream. The GUI must not treat a
healthy receive timer as evidence that motion is permitted.

## Audio behavior

List eligible audio tracks without automatically playing them. The user enables
listening, chooses a track, and controls mute and volume.
Show browser playback restrictions as playback status.

Quiet samples do not indicate a stream failure. Audio silence and blocked browser
playback must not be reported as missing sensor data.
Release audio subscriptions when no active consumer needs them.

## Saved layouts and identity

Save visualization type, input fields, local image settings, control mode preferences,
and explicit controller-hand bindings in client-owned layout state.
Do not write these user choices into the robot's equipment expectations.

Persist this configuration as versioned JSON in browser-local storage. Restore
the last saved layout for the same app origin and robot identity on the next visit.
Save layout edits automatically and show whether the local save succeeded.

Provide `Export layout` to download a local `.json` file. Export the same
configuration that the browser remembers. Provide `Import layout` to load a saved
file, validate it, and make it the browser's remembered layout.

The browser stores its own copy. The downloaded file is a snapshot and does not
update automatically when the layout changes. Restoring the browser copy must not
require the user to select that file again or grant filesystem access.

Persist bindings for dynamically discovered topics without adding a robot-side
topic catalog. Save exact track names, selected fields or joints,
visualization settings, enum labels, panel visibility, and panel arrangement.

Use stable robot and endpoint bindings from the contract. Preserve exact external
track, joint, and frame names. Labels are display text and cannot be lookup keys.
Rebind saved endpoints to new publication IDs after reconnection.

Wait for the selected robot before resolving its saved bindings. If a topic has
not appeared, keep its panel as unavailable. Start its normal startup grace when
that panel becomes active. Do not delete the binding or select a substitute.

Apply current exclusion rules and check schema compatibility before consuming a
restored input. If a track is excluded or incompatible, retain the panel with
the reason. Restoring a hidden data panel must not create subscription or monitoring demand.

Restore control selections without restoring ownership, armed motion, held input
values, or command payloads. Credentials, tokens, telemetry history, and temporary
publication IDs must not appear in the saved JSON.

Validate imported versions, references, and supported visualization settings before
replacing a working layout. Reject malformed or unsupported files with a readable
error. Import must not execute scripts or initiate robot commands.

If browser-local storage fails, preserve the current in-memory layout and show
that it is not saved. Keep JSON export available. Provide a reset action for
the remembered layout without changing the robot's discovery configuration.

See [the dynamic-topic layout example](layout-examples/dynamic-topics.json) for
the proposed file shape. This layout format is separate from the robot discovery format.

The layout has `layout_schema_version: 1`, a non-empty `label`, and one exact
`robot_identity`. Its `panels` map uses stable local panel IDs. `panel_order`
lists each panel ID exactly once. Reject unknown or duplicate panel references.

Each panel records `visualization`, `label`, `visible`, `source`, and `settings`.
A data source names `kind: "data"`, the exact `track_name`, and a `field_path`.
The path is an array of literal property names and non-negative array indices.
Do not evaluate a path as JavaScript or another expression language.

An optional `expected_msg_type` detects incompatible type changes on restore.
`settings.expected_rate_hz` controls optional data monitoring. Enum mappings and
plot-window settings belong to the panel settings. Select named joints by name,
not by a persisted array offset that can change after reconnection.

`control_preferences` maps interface IDs to an `operation` ID and a `presentation`.
Missing or unsupported saved modes remain visible as unavailable. Saved control
preferences never cause publication, ownership requests, or motion without user activation.

## V1 boundaries and acceptance

The client has no generic custom-RPC browser, service-call form, or RPC catalog.
Built-in discovery and Portal control ownership remain available.
The client does not require an equipment attachment tree.

Before implementing the generalized page, use these behavior checks:

- An undeclared data, video, or audio publication becomes selectable without a configuration change.
- A matching exclusion blocks selection, subscriptions, and monitoring for that media kind.
- Video works without a `videos` field or a configured camera list.
- Every eligible initial or newly published video receives an automatic subscription.
- The first received video is large and the remaining videos appear as live tiles on the left.
- Selecting a tile swaps the main video without stopping the other live streams.
- Excluded videos do not receive subscriptions or appear in the main view or tiles.
- Losing the main publication selects a remaining video or shows the waiting state.
- Hiding a panel removes its monitoring demand without disrupting another consumer.
- Every advertised control mode remains visible, with an explanation when unavailable.
- Switching from joint controls to VR ends the old command session and requires fresh activation.
- Joint-only interfaces do not gain VR pose control through a presentation choice.
- Position and Velocity use the same slider presentation with different command profiles.
- Missing optional base odometry does not block velocity commands.
- Missing required joint or pose feedback prevents activation of the affected operation.
- Every automatically displayed video uses the default expected rate and cannot bypass monitoring.
- Reconnection restores selections without replaying commands or marking old samples fresh.
- Closing and reopening the page restores a dynamic-topic panel from browser-local JSON.
- Exporting and importing a layout preserves its bindings and visualization settings.
- A missing or excluded restored topic retains its panel without binding another source.
- An invalid import preserves the previous working layout and sends no robot command.
- The same base interface and its command contract remain identical with or without added arms.
- A data visualization works without a `topics` field in the robot document.

## Implementation handoff

The contract defines robot-facing JSON. This document defines client behavior.
The generator and example files illustrate both documents. If a fixture conflicts
with the documents, fix the fixture instead of reviving a removed catalog.

Start in `web/` and follow [its agent instructions](../web/AGENTS.md). Review the
installed Next.js documentation before code changes, as those instructions require.
Keep the legacy `/robot` and `/rover` workflows intact while adding the generalized flow.

The legacy rover command helper describes drive values in revolutions per second.
Do not assume that reusing its numeric gains satisfies a new profile's units.
Define any required unit conversion in the robot-specific adapter.

The app uses the vendored `livekit-client` workspace package. Inspect its actual
DataTrack APIs before depending on schema retrieval or optional metadata.
Do not add a general schema compiler or require a new type repository for this v1.

Keep discovery parsing, the live catalog, exclusion matching, shared subscriptions,
control adapters, monitoring, and layout storage separate from React views.
Provide clock and transport seams for deterministic tests without hardware.

First exercise the generalized UI against fixture robots and fake transport events.
Then connect verified robot adapters. The stock ROS Portal and Trossen processes
need compatible discovery and ownership wiring before they satisfy this contract.

Before enabling a live command adapter, document its exact units, limits, feedback
requirements, stop/release behavior, and robot-side watchdog and ownership enforcement.
These adapter details remain implementation work. Do not assume example profiles
already implement Cartesian solving or trajectory cancellation.

Run the repository's web build and lint commands for application changes. Add
focused behavior tests for exclusions, reconnect races, shared streams, video selection,
control-mode switching, rate deadlines, and layout persistence.
Report any adapter or hardware verification that remains incomplete.

These documents and generated examples do not implement those behaviors in `web/`.
They define the scope for the next implementation step.
