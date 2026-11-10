# Robot configuration

A discovery document describes what a robot can do. The robot sends this document to the Teleop web app as JSON. This page describes version 1 of the document and its fields.

## How the app gets the document

A participant is a robot or browser in LiveKit. A gateway connects the robot to the app. An RPC asks another participant to run code. The robot gateway must provide the RPC `get_robot_config`.

The app calls `get_robot_config` on the selected robot. A payload is the content of a request. The app sends an empty string as the request payload. The robot returns the JSON document as a UTF-8 string.

The app waits 3000 ms for a response. It tries at most three times. It waits 500 ms between tries.

Do not put credentials or device addresses in the document.

An attribute is a named value on a participant. The robot sets these participant attributes in LiveKit:

| Attribute | Value |
| --- | --- |
| `lk.portal.role` | `robot` for a robot, `operator` for a browser. |
| `lk.portal.version` | The string `3`. The app rejects any other version. |
| `lk.portal.active_operator` | The identity of the operator in control, or an empty string. |

If you change the document, restart the robot. The app reads the new document the next time it connects.

## Top-level fields

A top-level field belongs directly to the document. A map stores values under named keys. An ID identifies an item. A track carries data, video, or audio.

| Field | Required | Description |
| --- | --- | --- |
| `schema_version` | Yes | An integer that must be `1`. |
| `label` | Yes | A non-empty name that the app shows for the robot. |
| `default_video_rate_hz` | Yes | A number greater than zero. It gives the expected number of video frames per second for every video. The app uses this rate to detect missing video. |
| `control` | Yes | An object that describes control ownership. See [control](#control). |
| `control_interfaces` | Yes | A map of equipment that the app can control. An empty map means that the user can view the robot but cannot control it. |
| `camera_info` | No | A map of fixed camera calibration. If you omit this field, the robot provides no camera calibration. See [camera_info](#camera_info). |
| `exclude_data_tracks` | No | A list of patterns that exclude data tracks. The default is `[]`. |
| `exclude_video_tracks` | No | A list of patterns that exclude video tracks. The default is `[]`. |
| `exclude_audio_tracks` | No | A list of patterns that exclude audio tracks. The default is `[]`. |

The app rejects a document with an unknown `schema_version` or an invalid known field. The app ignores unknown optional fields.

## How the app finds tracks

The document does not define which data, video, or audio tracks the robot publishes. A publication describes a track that a participant publishes. The app finds tracks through the LiveKit publications of the robot. Unless an exclusion list blocks a track, the app shows it in track selectors.

A subscription lets the app receive a track. The app subscribes to every video track. A visualization displays data in the app. The app subscribes to a data track when a visualization or control needs that track. It subscribes to an audio track when the user chooses to listen.

A binding links a visualization to a track. Saved bindings keep track names even when the robot does not publish those tracks.

The app does not play audio automatically. It does not treat quiet audio as missing audio.

A schema defines the structure of data. A frame is one message from a track. An encoding defines how a track represents each frame.

The app reads each data track name, schema ID, and frame encoding from LiveKit. The app can decode JSON frames only. A JSON track must declare its encoding. The app marks tracks with other encodings as unsupported.

The app does not know how often a data track must publish. You set an expected rate on a saved visualization in the app. Without an expected rate, the app does not report missing data.

## Exclusion lists

An exclusion list names patterns for tracks to block. Each pattern is a regular expression, which describes text to match. The three `exclude_*_tracks` fields work the same way. If no pattern matches the name of a track of that kind, the app enables the track.

```json
{
  "exclude_data_tracks": ["/debug/.*"],
  "exclude_video_tracks": ["private-.*"],
  "exclude_audio_tracks": ["private-.*"]
}
```

These rules apply to the patterns:

- A pattern must match the whole track name.
- A pattern is case-sensitive.
- Use the regular expression syntax that Python and JavaScript share.
- Do not use inline flags, lookbehind, named groups, or backreferences.
- To match a literal dot, escape it. In JSON, write `"state\\.debug"`.

If a pattern is not valid, the app shows a configuration error. The app does not disable the filter to continue.

The app hides excluded tracks from track selectors. It does not subscribe to excluded tracks. If a saved binding points to an excluded track, the app keeps the binding and shows `excluded`. If a control needs an excluded track, the app shows the control as unavailable and gives the reason.

An exclusion list only filters what the app receives. It does not replace LiveKit permissions or the rules that the robot uses to accept commands.

## control

| Field | Value |
| --- | --- |
| `scope` | Must be `"robot"`. |
| `ownership` | Must be `"portal_active_operator"`. |

The active operator is the participant that owns control. Only the active operator can send commands to the robot. To take control, the app calls `portal.set_active_operator` on the robot. It sends the identity of the browser. To release control, the app sends an empty string. The last request that the robot accepts sets the owner.

An armed control can send commands. When the app connects, it leaves the controls disarmed. This rule also applies if the user already owns control. The user must request control each time the app connects. If the app loses ownership, it disarms the controls at once.

The robot gateway must reject command tracks from any participant that is not the active operator. The attribute alone does not block custom tracks.

The `control` object provides a way to control existing portal robots.

## Video behavior

The first video that arrives becomes the main view. The other videos appear as small tiles on the left. When the user selects a tile, that video becomes the main view. The browser keeps this choice locally. The choice does not change any subscription.

## camera_info

Camera calibration describes how an image relates to physical space. The optional `camera_info` map gives fixed calibration for video tracks. Each key is a local ID, such as `front` or `left_wrist`.

These entries add metadata to tracks that the app discovers. An entry does not require a track to exist or make the app subscribe to it. Video tracks without an entry still work. Exclusion lists still apply.

The app stores this metadata for future calibrated views. The current VR view does not use it to change image projection. This field belongs to the robot configuration and does not depend on a VR presentation.

Each camera entry has these fields:

| Field | Description |
| --- | --- |
| `track_name` | The exact LiveKit video track name. Each name can appear in only one camera entry. |
| `width` | The width of the full video image in pixels. It must be a positive integer. |
| `height` | The height of the full video image in pixels. It must be a positive integer. |
| `views` | An object with either `mono`, or both `left` and `right`. Each value describes one camera image. |

A stereo video can contain both eye images in one frame. The `image_region` of each view selects that eye from the full image. The two regions must not overlap. For separate video tracks, use separate camera entries with a `mono` view in each.

Each view has these fields:

| Field | Description |
| --- | --- |
| `frame_id` | The name of the camera optical frame. The two views of a stereo entry must use different names. |
| `image_region` | An object with integer `x`, `y`, `width`, and `height` values in pixels. The origin must be nonnegative. The size must be positive. The region must fit inside the full video image. |
| `intrinsics` | The projection and distortion values for this region. |
| `extrinsics` | The fixed position and orientation of this optical frame relative to a named parent frame. |

An optical frame has its origin at the camera. Its X axis points right, Y points down, and Z points forward. Pixel coordinates start at the top-left image boundary. The center of the first pixel is at `(0.5, 0.5)`.

Intrinsics map camera rays to image pixels. Use values for the transmitted image after any crop, resize, or distortion correction. The values of `cx` and `cy` use coordinates within `image_region`, with its top-left corner as the origin.

The `intrinsics` object has these fields:

| Field | Description |
| --- | --- |
| `fx`, `fy` | Positive focal lengths in pixels. |
| `cx`, `cy` | The coordinates of the principal point, where the optical axis meets the image. Both values must be finite numbers. |
| `distortion_model` | One of `none`, `plumb_bob`, `rational_polynomial`, or `equidistant`. |
| `distortion_coefficients` | A list of finite numbers. The required lengths are 0, 5, 8, and 4 for the models above, respectively. |

For `none`, the projection is `u = fx * X / Z + cx` and `v = fy * Y / Z + cy`. The coordinates `(X, Y, Z)` belong to the optical frame. The coordinates `(u, v)` belong to the image region. The other models use the [ROS distortion conventions](https://github.com/ros2/common_interfaces/blob/rolling/sensor_msgs/msg/CameraInfo.msg).

Extrinsics describe the camera position and orientation. The `extrinsics` object has these fields:

| Field | Description |
| --- | --- |
| `parent_frame_id` | The named reference frame for the transform. It must differ from `frame_id`. |
| `translation` | Three finite numbers, `[x, y, z]`, in meters. They give the optical frame origin in the parent frame. |
| `rotation_xyzw` | Four finite numbers, `[x, y, z, w]`, that form a unit quaternion. A quaternion represents a rotation. |

The transform maps optical-frame coordinates into the parent frame. Apply the rotation first, then add the translation. The quaternion length must differ from 1 by no more than `0.0001`.

For a moving wrist camera, use its mount frame as the parent. A fixed camera-to-mount transform stays valid when the wrist moves. It does not give the changing mount pose in the world. This version does not publish live transforms or calibration updates.

The RPC returns a snapshot of the calibration. If the calibration or video dimensions change, restart the robot and reconnect the app. The dimensions and regions must match the video that the robot publishes.

The example below describes two 640-by-480 eye images in one 1280-by-480 video. Both optical frames use the same parent axes. The right camera sits 0.06 meters along the parent X axis from the left camera.

```json
{
  "camera_info": {
    "front": {
      "track_name": "front-stereo",
      "width": 1280,
      "height": 480,
      "views": {
        "left": {
          "frame_id": "front_left_optical",
          "image_region": { "x": 0, "y": 0, "width": 640, "height": 480 },
          "intrinsics": {
            "fx": 500, "fy": 500, "cx": 320, "cy": 240,
            "distortion_model": "none", "distortion_coefficients": []
          },
          "extrinsics": {
            "parent_frame_id": "front_mount",
            "translation": [0, 0, 0],
            "rotation_xyzw": [0, 0, 0, 1]
          }
        },
        "right": {
          "frame_id": "front_right_optical",
          "image_region": { "x": 640, "y": 0, "width": 640, "height": 480 },
          "intrinsics": {
            "fx": 500, "fy": 500, "cx": 320, "cy": 240,
            "distortion_model": "none", "distortion_coefficients": []
          },
          "extrinsics": {
            "parent_frame_id": "front_mount",
            "translation": [0.06, 0, 0],
            "rotation_xyzw": [0, 0, 0, 1]
          }
        }
      }
    }
  }
}
```

## control_interfaces

A control interface represents a slot for equipment. Each key is the ID of a slot, such as `base`, `left_arm`, or `lift`. If you rename the label or replace the hardware, keep the ID the same. The app saves bindings with the robot identity and this ID.

Feedback is data that describes the current robot state.

| Field | Required | Description |
| --- | --- | --- |
| `label` | Yes | The name that the app shows. |
| `operations` | Yes | A map of ways to command this interface. |
| `frame_id` | No | A coordinate frame gives reference axes. This field names the coordinate frame for commands, for example `base_link`. |
| `joint_names` | No | A list of joint names. The app uses these names to select feedback for this interface from a shared joint state track. |

## Operations

An operation is one way to command an interface. Each key is a local ID, such as `drive` or `joint_position`. The app does not send this ID to the robot.

| Field | Required | Description |
| --- | --- | --- |
| `profile` | Yes | The rules for commands. See [profiles](#profiles). |
| `command` | Yes | Where and how the app sends commands. See [command](#command). |
| `presentations` | Yes | A list of control modes that the app must show. See [presentations](#presentations). |
| `feedback_tracks` | No | A list of exact data track names that this operation requires. The default is `[]`. Every listed track must be present, compatible, and outside the exclusion lists. |
| `joint_names` | No | The joints for this operation. This list replaces the list on the interface. A gripper operation must name exactly one joint. |
| `control_channel` | No | The name of an independent command channel on the interface. A channel separates commands for independently controlled equipment. The default is `primary`. |

Before an operation can run, every track in `feedback_tracks` must provide fresh feedback. If you omit `feedback_tracks`, the operation declares no feedback requirements. An empty list has the same meaning.

The app still enforces the feedback requirements of the profile. If a profile needs feedback that is not in `feedback_tracks`, the app rejects the operation. Data tracks for display alone do not belong in this list. The app finds those tracks through LiveKit.

A trajectory is a sequence of targets over time. A joint trajectory needs the current joint positions.

A pose combines position and orientation. An end effector is an arm tool. VR pose control needs the current pose of the end effector. Cartesian control uses positions and orientations.

Odometry estimates the movement of the robot base. Velocity control does not require base odometry unless you list its track in `feedback_tracks`.

Two operations can list the same feedback track.

### command

The `command` object tells the app where to send commands. It also names the schema for command messages. The app sends these messages as JSON.

| Field | Description |
| --- | --- |
| `track_name` | The LiveKit data track that the app publishes. The robot does not need to publish it. |
| `msg_type` | The name of the schema for command messages, for example `geometry_msgs/msg/Twist`. |
| `format` | Currently we only support `"json"`. |

```json
{
  "profile": "joints.trajectory.v1",
  "command": {
    "track_name": "/left_arm_controller/joint_trajectory",
    "msg_type": "trajectory_msgs/msg/JointTrajectory",
    "format": "json"
  },
  "feedback_tracks": ["/joint_states"],
  "presentations": ["joint_sliders"]
}
```

### Profiles

A profile defines how user input becomes a command. It sets the units for the command values. It also defines when commands start and stop.

| Profile | Meaning | Presentations |
| --- | --- | --- |
| `base.twist.v1` | Linear X and angular Z velocity. | `joystick`, `keyboard`, `gamepad` |
| `base.holonomic_twist.v1` | Linear X, linear Y, and angular Z velocity. | `joystick`, `keyboard`, `gamepad` |
| `base.ackermann_drive.v1` | Speed and steering angle. | `joystick`, `keyboard`, `gamepad` |
| `joints.velocity_jog.v1` | Named JointJog velocities. | `joint_sliders` (velocity mode), `gamepad` |
| `joints.trajectory.v1` | Named JointTrajectory waypoints. | `joint_sliders` (position mode) |
| `arm.cartesian_pose.v1` | PoseStamped targets for the Cartesian controller of the robot. | `vr`, `hand_tracking` |
| `gripper.position.v1` | One gripper joint, in meters, as a position-only JointTrajectory. | `gripper_controls` |

These profiles are proposals. An adapter implements a profile in the app. Before a profile can run, its adapter must define these behaviors:

- The limits
- The neutral command
- The behavior when the user releases a control
- The behavior when the app stops the operation

The app disables a profile if its adapter is incomplete. A payload of zero does not mean stop for a trajectory or pose profile.

### Presentations

A presentation is the control that the user operates. The app shows every presentation that you list. If the browser cannot support one, the app shows it as unavailable with a reason.

The values are `joystick`, `keyboard`, `gamepad`, `joint_sliders`, `vr`, `hand_tracking`, and `gripper_controls`. The profile sets the mode and the units.

The `vr` presentation does not add Cartesian control to an interface that only controls joints. An endpoint receives commands or supplies data. The robot must provide an endpoint that accepts Cartesian commands.

The `hand_tracking` presentation uses the webcam of the operator and the same Cartesian profile as `vr`. The browser finds the hands, and the robot solves its own IK. To move an arm, the operator curls the middle, ring, and pinky fingers into the palm. The arm follows the motion of the hand since that grip. Opening the hand holds the arm. Thumb and index tips set the gripper, if the arm has a `gripper.position.v1` operation on the `gripper` channel. The pose feedback track must report the end effector in the same frame as the command. The app assumes that the end effector z axis points along the gripper fingers. If that is false for a robot, the operator selects the Robot base motion frame.

## Gripper operation

An arm can have a gripper operation next to its arm operations. Use this configuration:

- Set `profile` to `gripper.position.v1`.
- Set `control_channel` to `"gripper"`.
- Set `joint_names` on the operation to one joint, for example `["left_gripper_joint"]`.
- Keep the joint list of the arm unchanged.

The gripper has its own command track. The gripper and the arm can list the same joint state track as feedback. The app makes sure that each joint has fresh feedback independently.

Only one operation sends commands for each pair of interface ID and `control_channel`. If the user changes the operation, the app releases only that channel. If the app loses ownership or the user hides the controls, the app stops all channels. Two channels cannot use the same command track.

The gripper position is the displacement of one finger in meters. It is not an angle in radians, the jaw gap, or a percentage. The adapter gives the limits, the speed, and the Open and Close targets. The app sets the target from fresh feedback. It does not move the gripper until the user acts.

To cancel a gripper command, the app sends a trajectory with empty `points`. The gripper then holds its measured position. It does not open. The profile does not report grasp success, contact force, or stall.

LiveKit data tracks can lose messages. While a channel is armed, the app sends the requested position again every 200 ms. It starts these repeated commands only after the first user input. A watchdog detects missing expected input. These repeated commands do not provide a watchdog. They do not prove that the robot received the command.

## Simulator policy

A simulator can add a `simulation_control` object that gives limits to the app. This object is not part of the base document. The current object has these fields:

| Field | Description |
| --- | --- |
| `implementation` | `"mujoco.position.v2"`. |
| `version` | `2`. |
| `max_feedback_age_ms` | The maximum age of feedback that the app accepts. |
| `operations` | The supported commands, under `operations[interface ID][operation ID]`. |

Each entry under `operations` has `profile`, `control_channel`, `joint_names`, `units`, and `joints`. The `joints` map gives `min`, `max`, and `max_velocity` for each joint. An entry for a gripper also has `coordinate_label`, `open_position`, and `closed_position`. The app still supports the older `mujoco.joint_trajectory.v1` policy for arms.

## Names and IDs

Use these rules for names and IDs:

- Use `snake_case` for field names and local map keys. A local ID must match `[a-z][a-z0-9_]*`.
- Use a unique ID in each collection. Do not repeat the key in an `id` field.
- Use any text for a label, including spaces and text from other labels. A label does not set identity or capability.
- Keep the exact spelling of track names, schema names, profile names, joint names, and frame names. The app does not change their case or punctuation.
- Keep the identity of the robot participant the same across sessions. The app uses this identity to restore saved bindings.

A layout stores the bindings of the user. The browser saves the layout locally as JSON. The user can export and import the layout as a `.json` file.

## Not in version 1

Version 1 does not support these features:

- Live document updates
- Live coordinate transforms
- Coordinated arm control
- Custom RPC lists
- Separate gripper components
- Walking or balance control
- Required Audio, Video, and Data Tracks. Its purely discover based.
- The Teleop Portal must explicitly support the control type messages it is interacting with.

The app has no form for custom RPCs. Before the app can offer Home or clear-fault actions, those actions need a command profile.

## Examples

The folder `generalization/examples/` has 14 example documents. The examples include a differential rover, an Ackermann rover, and an arm. They also include two arms on a mobile base, a humanoid, and a camera-only station. The file `generalization/examples/14-stereo-camera.json` shows fixed stereo calibration.

To change the examples, edit `generalization/scripts/build_examples.py`. From the repository root, run the script with Python 3:

```sh
python3 generalization/scripts/build_examples.py
```

The script uses only the standard library. It writes the example files. It makes sure that the names, the exclusions, and the references are valid.
