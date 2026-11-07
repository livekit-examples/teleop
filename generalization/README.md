# Teleop generalization

this is the contract between the Teleop UI and the robot for the robot to be controlled via the Teleop UI
Consider a Robot Session API: where we provide building blocks for user specified teleop.

TrackAttributes: 

This directory contains proposed v1 discovery documents and web-app requirements.
The current web app does not yet implement the generalized workflow.

Read the [discovery contract](contract.md) for the robot-facing format.
Read the [web-app requirements](web-app-requirements.md) for client behavior.
The format uses dynamic data discovery, automatic video display, optional audio metadata,
and control interfaces. It has no `topics` or `videos` catalog.
It has no mandatory hardware components, attachments, camera roles, or custom RPC catalog.

## Generate examples

From the `teleop` repository, run the following command with Python 3.
The generator uses only the standard library.
Its output path does not depend on the current working directory.

```sh
python3 generalization/scripts/build_examples.py
```

Edit [scripts/build_examples.py](scripts/build_examples.py) to change the examples.
The script replaces its named files in `examples/`. It checks naming, exclusions,
rates, command contracts, compatible presentations, and reuse across robot configurations.

## Examples

All tracks are discoverable by default. Data topics have no explicit catalog.
Clients read data schemas and encodings from LiveKit publications.
Control operations carry their own output contracts and exact feedback track names.
All non-excluded videos receive automatic subscriptions. The first received video
is large, and the remaining videos appear as selectable live tiles on the left.
The last example shows the global exclusion fields.

There are no include regexes. For each media kind, start with all tracks enabled
and disable only names that match an `exclude_*_tracks` regex. Empty or omitted
exclusion lists allow every track.

| Example | Purpose |
| --- | --- |
| [01-rover-differential.json](examples/01-rover-differential.json) | Linear X and yaw through Twist. |
| [02-rover-ackermann.json](examples/02-rover-ackermann.json) | Speed and steering angle through AckermannDrive. |
| [03-rover-pan-tilt.json](examples/03-rover-pan-tilt.json) | Base and camera-head controls with a selectable camera. |
| [04-rover-arm.json](examples/04-rover-arm.json) | The same base with joint-position, joint-velocity, and Cartesian arm operations. |
| [05-arm.json](examples/05-arm.json) | The same arm without a mobile base. |
| [06-two-arms.json](examples/06-two-arms.json) | Two independent arm interfaces. |
| [07-two-arms-mobile.json](examples/07-two-arms-mobile.json) | The same arms and base in one robot description. |
| [08-rover-holonomic.json](examples/08-rover-holonomic.json) | Linear X, linear Y, and yaw through Twist. |
| [09-two-arms-mobile-lift.json](examples/09-two-arms-mobile-lift.json) | Rivet-style base, lift, and two independent arm interfaces. |
| [10-moveit-dual-panda.json](examples/10-moveit-dual-panda.json) | Shared joint state and separate trajectory destinations. |
| [11-camera-only.json](examples/11-camera-only.json) | A station with no control interfaces. |
| [12-humanoid.json](examples/12-humanoid.json) | Body telemetry, independent arm and head controls, video, and audio. |
| [13-track-exclusions.json](examples/13-track-exclusions.json) | Regex exclusions for data, video, and audio discovery. |

## Example scope

Generic endpoint names, rates, and command profiles are illustrative.
Generic arms include a proposed Cartesian endpoint to exercise joint-control and
VR selection. Those endpoints need robot-side adapters before use.
Their joint-position and joint-velocity operations share the `joint_sliders` presentation.
Required feedback is explicit. Optional base odometry does not block driving.

For implementation, start with the
[handoff requirements](web-app-requirements.md#implementation-handoff).
Live adapters still need verified limits, units, stop behavior, and robot-side ownership enforcement.

The Panda example uses the joint names, base frames, and arm controller names from
[MoveIt's dual-Panda demo](https://moveit.picknik.ai/main/doc/examples/dual_arms/dual_arms_tutorial.html).
Its [controller configuration](https://github.com/moveit/moveit_resources/blob/ros2/dual_arm_panda_moveit_config/config/ros2_controllers.yaml)
defines one joint-state broadcaster and separate arm controllers.
The command tracks target their
[`joint_trajectory` topics](https://control.ros.org/rolling/doc/ros2_controllers/joint_trajectory_controller/doc/userdoc.html#subscriber).
Both arm interfaces bind directly to the discovered `/joint_states` track.
The stock demo still needs ROS Portal routes, discovery, and control ownership wiring.

Rivet-style and humanoid examples describe interface composition.
Their joint names, frames, rates, and endpoints are not verified vendor configurations.
The humanoid example has no walking, balance, or coordinated whole-body commands.
Body joint states and IMU data are discovered at runtime without extra declarations.
