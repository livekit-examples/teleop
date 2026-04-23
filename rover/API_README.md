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

#### JSON schema

```json
{
  "orientation_rad": {
    "roll": 0.0,
    "pitch": 0.0,
    "yaw": 0.0
  },
  "accel_mg": {
    "x": 0.0,
    "y": 0.0,
    "z": 0.0
  },
  "gyro_dps": {
    "x": 0.0,
    "y": 0.0,
    "z": 0.0
  },
  "mag_ut": {
    "x": 0.0,
    "y": 0.0,
    "z": 0.0
  },
  "temperature_c": 0.0
}
```

#### Field types

| Field | Type | Unit | Notes |
|---|---|---|---|
| `orientation_rad.roll` | number | rad | Roll |
| `orientation_rad.pitch` | number | rad | Pitch |
| `orientation_rad.yaw` | number | rad | Yaw |
| `accel_mg.x` | number | mg | Acceleration X |
| `accel_mg.y` | number | mg | Acceleration Y |
| `accel_mg.z` | number | mg | Acceleration Z |
| `gyro_dps.x` | number | deg/s | Gyroscope X |
| `gyro_dps.y` | number | deg/s | Gyroscope Y |
| `gyro_dps.z` | number | deg/s | Gyroscope Z |
| `mag_ut.x` | number | uT | Magnetometer X |
| `mag_ut.y` | number | uT | Magnetometer Y |
| `mag_ut.z` | number | uT | Magnetometer Z |
| `temperature_c` | number | C | Temperature |

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
  "throttle_rps": 0.0,
  "steering_rps": 0.0
}
```

#### Field types

| Field | Type | Unit | Notes |
|---|---|---|---|
| `throttle_rps` | number | rev/s | Forward/reverse command |
| `steering_rps` | number | rev/s | Steering command |

Both fields are required. The rover validates the JSON and converts it to
`teleop_msgs::ControlCmdMsg` immediately on reception.

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
