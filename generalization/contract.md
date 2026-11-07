# Discovery contract, v1 draft

This contract describes expected robot interfaces for a teleop client. It does
not describe the robot's complete hardware structure or prescribe a screen layout.
The examples are proposals. The current web app does not implement this contract.

The robot returns this document through `get_robot_config`, with an empty request
payload. Participant attributes identify its role and protocol version.
The document advertises control operations and optional media expectations.
Data telemetry is discovered from LiveKit publications without a topic catalog.

## Participant and discovery exchange

V1 uses Portal's existing participant attributes. The Portal protocol version and
the discovery document version are separate values.

| Attribute | Value |
| --- | --- |
| `lk.portal.role` | Robot: `robot`. Browser controller: `operator`. |
| `lk.portal.version` | `3` as a string for the current Portal protocol. |
| `lk.portal.active_operator` | Robot-owned active operator identity, or an empty string. |

Read attributes from initial participants and attribute-change events. Require an
exact supported Portal version. Report incompatible participants without enabling controls.
The browser needs permission to update its own participant metadata.

Call `get_robot_config` on the selected robot with an empty string payload.
It returns a UTF-8 JSON string without acquiring control. Use a 3000 ms response
timeout, at most three attempts, and 500 ms between attempts.

Discard an outstanding result after selection changes or the connection restarts.
The response contains public interface descriptions, not credentials or device addresses.
The robot gateway must implement this RPC. Portal does not provide it automatically.

## Top-level fields

All example documents use the following fields. Collections are maps with stable
local IDs as keys. Empty collections are valid, including on a camera-only station.

| Field | Meaning |
| --- | --- |
| `schema_version` | Required integer discovery version, currently `1`. |
| `label` | Required non-empty human-readable robot name. |
| `exclude_data_tracks` | Full-name regex exclusions for data-track discovery. Defaults to `[]`. |
| `exclude_video_tracks` | Full-name regex exclusions for video-track discovery. Defaults to `[]`. |
| `exclude_audio_tracks` | Full-name regex exclusions for audio-track discovery. Defaults to `[]`. |
| `default_video_rate_hz` | Positive monitoring rate for automatically subscribed videos. Required. |
| `control` | Required object: `scope: "robot"`, `ownership: "portal_active_operator"`. |
| `audio_tracks` | Optional expected audio tracks. Defaults to `{}` and never acts as an allowlist. |
| `control_interfaces` | Required map of operations and presentations. An empty map permits viewing only. |

The catalog of available tracks comes from LiveKit publications. Data and video
tracks need no entry in the robot document. Clients retain saved input bindings
and optional audio expectations when their publications disappear.

Reject unsupported document versions and invalid known fields. Ignore unknown
optional fields without executing them. Do not accept legacy `topics`, `videos`,
`components`, `attachments`, `services`, or `rpcs` collections as this contract.

## Discovery and exclusions

Clients discover every data, video, and audio track from the selected robot,
except names that match the corresponding global exclusion list. Data selection
does not require prior subscription. All eligible video tracks are subscribed automatically.

The eligibility rule is `enabled = not matches_any_exclusion(track_name)`.
There is no include regex and no data-topic catalog. Every data publication is
eligible unless its exact name matches an exclusion regex.

| Track | Matches an exclusion? | Enabled? |
| --- | --- | --- |
| `/imu/data_raw` | No | Yes |
| `/new_sensor` | No | Yes |
| `/debug/cpu` | Yes | No |
| `/battery_state` | Yes | No |

Patterns match the entire track name and are case-sensitive. Names retain their
exact spelling. Patterns use portable regular-expression syntax shared by Python
and JavaScript. Avoid inline flags, lookbehind, named groups, and backreferences.

```json
{
  "exclude_data_tracks": ["/debug/.*"],
  "exclude_video_tracks": ["private-.*"],
  "exclude_audio_tracks": ["private-.*"]
}
```

Empty or omitted lists exclude nothing. A literal dot needs a regex escape,
such as `state\.debug`. In a JSON string, write it as `"state\\.debug"`.
Clients must reject invalid patterns with a configuration
error. They must not silently replace an invalid filter with an unrestricted filter.

Excluded inputs do not appear in visualization pickers, receive subscriptions,
or missing-data monitoring. A saved binding to an excluded track remains saved
and displays `excluded`. Clients must not subscribe through that binding.

Exclusions take precedence over saved bindings and optional audio expectations. An input
that matches an exclusion stays disabled and creates no subscription or monitoring
demand. If a control needs that input, show the control as unavailable with the reason.

Exclusions filter client discovery and receive inputs. They do not replace
LiveKit permissions or robot-side command authorization. Expected command destinations
describe permitted output interfaces independently of incoming publication discovery.

## Dynamic data discovery

Clients obtain names, schema IDs, and frame encodings from LiveKit publication
metadata. A schema ID is a name and schema encoding, not the complete definition.
Retrieve definitions through the publisher's SDK schema API when available.

The robot document has no `topics` field and no per-topic
telemetry declarations, type catalog, directions, or receive-rate table.

Visualization compatibility comes from the discovered schema and the user's
selected fields. A control adapter checks discovered feedback against its profile.
Saved layouts can retain a selected type to detect incompatible changes on restore.

The vendored JS SDK exposes schema IDs and frame encodings. Full schema retrieval
must be verified before an implementation depends on it. JSON inspection and
scalar views can use decoded object fields when definitions are unavailable.

V1 requires explicit JSON frame metadata for JSON decoding. Missing encoding
metadata remains unsupported rather than triggering a guessed decoder.
No schema definition is required for the raw JSON inspector.

The initial application decoder handles JSON. Other published encodings remain
discoverable and appear as unsupported until the client has a decoder.
Do not infer command permission or motion semantics from a message type.

V1 data monitoring uses the saved visualization's optional `expected_rate_hz`.
The current vendored DataTrack metadata has no standard expected-rate field.
Do not invent a required SDK field or infer an expected rate from arrival history.
Without a user-specified rate, data remains unmonitored for missing samples.

Discovery alone cannot identify a data source that never publishes. A saved panel
or an explicit control feedback binding can still identify an absent input.
The client must not require a robot-side telemetry inventory to offer visualizations.

## Automatic video and audio

The document has no `videos` field, camera list, or per-video layout declaration.
Subscribe to every video from the selected robot unless `exclude_video_tracks`
matches its name. Apply this rule to initial publications and later publications.

The first video received becomes the large main view. Display the remaining
videos as smaller live tiles in a column on the left. Selecting a tile makes
that video the main view. The previous main video remains available as a tile.

Every video uses the positive `default_video_rate_hz` monitoring rate. Missing,
zero, or invalid rates cannot disable video monitoring. User-selected image
interpretation, including stereo, belongs to client settings rather than this document.

Audio entries contain `label` and `track_name`. Audio is discoverable without
automatic playback. A client must not interpret quiet audio as missing data.
An unknown media layout or unsupported codec must produce a visible reason.

Camera roles such as `scene` and `wrist` are not required. V1 has no mandatory
camera association, `components` map, or `attachments` graph.
Camera selection is local UI state. It does not change subscriptions to the other videos.

## Control interfaces

A control interface groups operations for one logical equipment slot, such as
`base`, `left_arm`, or `lift`. Adding an arm preserves the base interface and
its endpoint bindings. This grouping does not require a hardware attachment tree.

Each interface has a `label`, a `kind`, and an `operations` map. Interfaces can
also name a command frame, joint names, and base kinematics.
Joint lists select feedback for that interface from a shared state topic.

`kind` supports UI grouping and icons. `kinematics` describes the hardware.
Neither field selects a command encoder or adds operations beyond the advertised profiles.

| Operation field | Meaning |
| --- | --- |
| `profile` | Named contract for command mapping, units, and command lifecycle. |
| `command` | Output contract containing `track_name`, `msg_type`, and `format`. |
| `feedback_tracks` | Exact names of data publications associated with the operation. |
| `required_feedback_tracks` | Optional subset needed to activate the operation. Defaults to `[]`. |
| `presentations` | Compatible control modes that the GUI must expose. |

The command contract is local to its operation. It is needed because a command
destination is not necessarily published by the robot. The controlling client
publishes that output track after it obtains control.

`format: "json"` selects JSON frames with JSON Schema metadata. `msg_type` names
the command schema. Feedback schemas come from the actual publications.
Two operations can reference the same feedback track without copying its metadata.

Associated feedback supports displays and inspection. Only the required subset
blocks activation when absent, excluded, or incompatible. Base odometry is optional
for the example velocity controls. Position sliders need current joint positions.
VR pose control needs a current end-effector pose to establish its reference.

An adapter must reject an operation whose required subset omits an input mandatory
for that profile. An empty required subset does not override profile requirements.

Control-specific feedback age limits belong to the profile adapter. They are
separate from a visualization's optional missing-data monitoring.
Do not treat optional feedback loss as permission to change the command protocol.

```json
{
  "profile": "joints.trajectory.v1",
  "command": {
    "track_name": "/left_arm_controller/joint_trajectory",
    "msg_type": "trajectory_msgs/msg/JointTrajectory",
    "format": "json"
  },
  "feedback_tracks": ["/joint_states"],
  "required_feedback_tracks": ["/joint_states"],
  "presentations": ["joint_sliders"]
}
```

Clients must expose every advertised operation and presentation. A persistent
selector lets the user switch modes for an interface. Unsupported modes remain
visible with a reason. Missing browser features cannot silently remove a mode.

Profiles describe supported operations. Presentations describe how the user
operates them. A joint-only interface cannot gain Cartesian control from a VR
selection. A Cartesian endpoint or an implemented conversion must exist.

Operation IDs are local identifiers, not wire commands. One `joint_sliders`
presentation can appear under both joint-position and joint-velocity operations.
The selected profile determines the mode, units, initialization, and command encoder.
Cartesian pose is a separate operation. Duplicate JSON operation keys are invalid.

The example profiles and their command semantics are still proposals:

| Profile | Meaning | Presentations |
| --- | --- | --- |
| `base.twist.v1` | Linear X and angular Z velocity. | Joystick, keyboard, gamepad. |
| `base.holonomic_twist.v1` | Linear X, linear Y, and angular Z velocity. | Joystick, keyboard, gamepad. |
| `base.ackermann_drive.v1` | Speed and steering angle. | Joystick, keyboard, gamepad. |
| `joints.velocity_jog.v1` | Named JointJog velocities. | Joint sliders in velocity mode, gamepad. |
| `joints.trajectory.v1` | Named JointTrajectory waypoints. | Joint sliders in position mode. |
| `arm.cartesian_pose.v1` | PoseStamped targets handled by the robot's Cartesian controller. | VR. |

Before a profile becomes executable, its implementation must define limits,
neutral commands, release behavior, and stopping behavior. A trajectory or pose
profile cannot assume that an all-zero payload means stop.

Each adapter must define the permitted schema, field mapping, command frame,
joint units and limits, input scaling, activation, release, and feedback age limits.
These profiles are not executable implementations or complete vendor specifications.
An incomplete adapter remains visible but disabled. Do not invent physical limits
or send a speculative stop payload to enable an example.

## Ownership and RPC scope

The discovery RPC and Portal's built-in ownership exchange remain part of v1.
`control.ownership: "portal_active_operator"` identifies that existing exchange.
The robot accepts commands only from the active operator.

To request control, call `portal.set_active_operator` on the robot with the
browser participant's raw identity string. Success returns an empty string.
Read ownership from the robot's `lk.portal.active_operator` attribute.

To release control, send an empty string when the latest known owner is this browser.
This exchange supports handoff, not an exclusive acquisition lease. The last
accepted request sets the owner. The owner identity persists across disconnects.

Require an explicit control request in each browser connection before motion.
An existing owner attribute alone must not restore armed control.
Observe attribute updates continuously and disarm immediately on ownership loss.

Restrict this browser's command publications to the selected robot through LiveKit
subscription permissions. The robot gateway must also gate each advertised command
input by active operator identity. Setting an attribute alone does not gate custom tracks.

This differs from the legacy pages' `acquire_control` methods. Do not reuse their
payloads or response parsers for the Portal ownership exchange.

Custom RPC and service catalogs are excluded from v1. The document has no
`services` or `rpcs` collection. The client has no generic custom-RPC form.
Home and clear-fault actions need a supported command profile before the GUI can offer them.

## Naming and identity

Contract field names and local map IDs use `snake_case`. Local IDs must match
`[a-z][a-z0-9_]*`. Spaces and hyphens are not allowed in local IDs.

IDs are unique within their collection. References identify both the collection
and the ID through their field. Do not repeat a map
key in an `id` field inside its entry.

Labels are non-empty display text. Spaces, punctuation, and duplicate labels
are allowed. Clients use labels for selectors, panel titles, and readable logs.
Labels do not determine identity, capabilities, or controller-hand assignments.

Track names, schema names, profile identifiers, joint names, and frame names
retain their external spelling. Clients must not change capitalization, spaces,
hyphens, underscores, or slashes in these values.

Control interface IDs identify logical equipment slots. Renaming a label or
replacing the physical left arm preserves the `left_arm` ID.
V1 uses the discovery participant's identity as the robot identity.

Saved interface references use `(robot identity, control interface ID)`.
Saved data inputs use `(robot identity, media kind, exact track name)`.
Explicit media entries can also use `(robot identity, collection, local ID)`.
These endpoint bindings do not create normalized IDs from external track names.

Deployments must preserve the robot participant identity to restore bindings
across sessions. Temporary LiveKit publication IDs cannot serve as saved identity.
After reconnection, clients bind the saved endpoint to its new publication.

The browser remembers user-selected bindings as a versioned local JSON layout.
Users can export and import that layout as a `.json` file. Dynamic topics do not
need a discovery declaration to have a saved binding.
See [web-app persistence requirements](web-app-requirements.md#saved-layouts-and-identity).

## Deferred work

Live manifest updates, complete transforms, coordinated arm control, custom RPC
catalogs, separate gripper components, and walking or balance control are outside v1.
The humanoid example exposes body telemetry and independent arm and head controls.

Fetch the static document on selection and reconnection. Missing data changes
runtime status without deleting expectations. Configuration changes take effect
after the robot restarts and the client fetches its description again.
