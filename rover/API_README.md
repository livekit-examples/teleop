# Rover LiveKit API Reference

This document describes the LiveKit data tracks and RPC method used by the
`rover/` reference project. It is participant-agnostic: any LiveKit participant
in the same room can subscribe to these tracks or call this RPC.

Track names are parameterized by `rover_id`.

For `rover_id = rover-1`:
- IMU data track: `rover-1.imu`
- Control command data track: `rover-1.control_cmd`
- Camera video track: `rover-1.arducam`
- RPC method: `acquire_control`

---

## Data Tracks

### `<rover_id>.imu`

Direction: Rover -> Room  
Encoding: UTF-8 JSON  
Publish pattern: periodic, driven by serial bus query rate

The message is the JSON form of the ROS 2
[`sensor_msgs/msg/Imu`](https://docs.ros2.org/foxy/api/sensor_msgs/msg/Imu.html)
message. Magnetometer and temperature readings from the IMU are not part of
this message.

#### JSON schema

```json
{
  "angular_velocity": {
    "x": 0.0,
    "y": 0.0,
    "z": 0.0
  },
  "angular_velocity_covariance": [0, 0, 0, 0, 0, 0, 0, 0, 0],
  "header": {
    "frame_id": "",
    "stamp": {
      "nanosec": 0,
      "sec": 0
    }
  },
  "linear_acceleration": {
    "x": 0.0,
    "y": 0.0,
    "z": 0.0
  },
  "linear_acceleration_covariance": [0, 0, 0, 0, 0, 0, 0, 0, 0],
  "orientation": {
    "w": 1.0,
    "x": 0.0,
    "y": 0.0,
    "z": 0.0
  },
  "orientation_covariance": [0, 0, 0, 0, 0, 0, 0, 0, 0]
}
```

#### Field types

| Field | Type | Unit | Notes |
|---|---|---|---|
| `header.frame_id` | string | - | Coordinate frame; currently empty |
| `header.stamp.sec` | integer | s | Sample time seconds; currently 0 |
| `header.stamp.nanosec` | integer | ns | Sample time nanoseconds; currently 0 |
| `orientation.x` / `.y` / `.z` / `.w` | number | - | Unit quaternion orientation |
| `orientation_covariance` | number[9] | rad^2 | Row-major 3x3 about x/y/z; all zeros = unknown |
| `angular_velocity.x` / `.y` / `.z` | number | rad/s | Gyroscope rates |
| `angular_velocity_covariance` | number[9] | (rad/s)^2 | Row-major 3x3; all zeros = unknown |
| `linear_acceleration.x` / `.y` / `.z` | number | m/s^2 | Accelerometer |
| `linear_acceleration_covariance` | number[9] | (m/s^2)^2 | Row-major 3x3; all zeros = unknown |

All fields are required. Subscriber implementations in this repo validate the
JSON and convert it to `teleop_msgs::ImuMsg` immediately on reception.

---

### `<rover_id>.control_cmd`

Direction: Controller -> Rover  
Encoding: UTF-8 JSON  
Publish pattern: created only after control is acquired

#### JSON schema

```json
{
  "angular": {
    "x": 0.0,
    "y": 0.0,
    "z": 0.0
  },
  "linear": {
    "x": 0.0,
    "y": 0.0,
    "z": 0.0
  }
}
```

#### Field types

| Field | Type | Unit | Notes |
|---|---|---|---|
| `linear.x` | number | rev/s | Forward/reverse command |
| `angular.z` | number | rev/s | Steering command |
| `linear.y` | number | - | Reserved; send 0, ignored by the rover |
| `linear.z` | number | - | Reserved; send 0, ignored by the rover |
| `angular.x` | number | - | Reserved; send 0, ignored by the rover |
| `angular.y` | number | - | Reserved; send 0, ignored by the rover |

Both the `linear` and `angular` objects are required, each with numeric
`x`/`y`/`z` fields. The rover uses only `linear.x` and `angular.z`. The rover
validates the JSON and converts it to `teleop_msgs::ControlCmdMsg` immediately
on reception.

---

## Video Track

### `<rover_id>.arducam`

Direction: Rover -> Room  
Track type: LiveKit video track  
Source: `SOURCE_CAMERA`

Frames are captured from an Arducam (libcamera) RGB
camera and published as RGBA `VideoFrame` data on each main-loop tick.

---

## RPC

### `acquire_control`

Requests or releases exclusive control of `<rover_id>.control_cmd`.

Direction: Caller -> Rover

__NOTE__: the caller identity must be non-empty.

#### Request payload

The rover accepts any of these JSON forms:

Acquire control:

```json
{
  "acquire": true
}
```

Release control:

```json
{
  "acquire": false
}
```

Alternate release aliases also accepted by the current implementation:

```json
{
  "release": true
}
```
```json
{
  "unset": true
}
```

#### Request structure

| Field | Type | Required | Meaning |
|---|---|---|---|
| `acquire` | boolean | one of `acquire` / `release` / `unset` required | `true` acquires, `false` releases |
| `release` | boolean | one of `acquire` / `release` / `unset` required | `true` releases |
| `unset` | boolean | one of `acquire` / `release` / `unset` required | `true` releases |

#### Response format

Important: the current rover implementation returns a plain UTF-8 string from
LiveKit RPC, not a JSON object.

Successful acquire examples:

```text
control acquired by controller-1
```

Successful release examples:

```text
control released by controller-1
```

Non-error but denied/state examples:

```text
already controller: controller-1
```

```text
controller is currently controller-2
```

```text
no controller is set
```

#### Structured interpretation

If a client wants to normalize the string response into JSON locally, this is a
reasonable interpretation shape:

Successful acquire:

```json
{
  "ok": true,
  "action": "acquire",
  "controller_id": "controller-1",
  "message": "control acquired by controller-1"
}
```

Successful release:

```json
{
  "ok": true,
  "action": "release",
  "controller_id": "controller-1",
  "message": "control released by controller-1"
}
```

Denied because another controller holds control:

```json
{
  "ok": false,
  "reason": "controller_active",
  "controller_id": "controller-2",
  "message": "controller is currently controller-2"
}
```

Denied because no controller is set during release:

```json
{
  "ok": false,
  "reason": "no_controller",
  "message": "no controller is set"
}
```

#### Invalid request behavior

If the payload is not valid JSON, or if the JSON does not contain a valid
boolean `acquire`, `release`, or `unset` field, the rover throws an RPC error.
The current implementation uses this error text:

```text
invalid acquire_control payload; expected acquire/release/unset boolean
```
