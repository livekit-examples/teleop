# Pan/Tilt Robot — LiveKit Track & RPC API Reference

This document describes the LiveKit tracks and RPC methods used by the pan/tilt
robot system. It is **platform and participant agnostic**: any LiveKit
participant in the same room can subscribe to these tracks or call these RPCs
regardless of language or SDK.

All track names and RPC method names are string constants. Byte order for all
binary fields is **little-endian** unless noted otherwise.

---

## Track Summary

| Track Name         | Track Type | LiveKit Source        | Direction        | Encoding | Rate        |
|--------------------|------------|-----------------------|------------------|----------|-------------|
| `camera.color`     | Video      | `SOURCE_CAMERA`       | Robot → Room     | RGBA     | ~30 fps     |
| `camera.depth_vis` | Video      | `SOURCE_SCREENSHARE`  | Robot → Room     | RGBA     | ~10 fps     |
| `camera.depth`     | Data       | —                     | Robot → Room     | Binary   | ~10 fps     |
| `state.gyro`       | Data       | —                     | Robot → Room     | JSON     | ~20 Hz      |
| `state.pan`        | Data       | —                     | Robot → Room     | JSON     | ~20 Hz      |
| `state.tilt`       | Data       | —                     | Robot → Room     | JSON     | ~20 Hz      |
| `control_cmd`      | Data       | —                     | Controller → Robot | JSON   | On change   |

---

## Video Tracks

### `camera.color`

RGB colour video from the RealSense depth camera.

| Property    | Value |
|-------------|-------|
| Source      | `SOURCE_CAMERA` |
| Pixel format | RGBA (4 bytes/pixel) |
| Resolution  | 640 × 480 (default) |
| Frame rate  | ~30 fps |

Subscribers receive decoded `VideoFrame` objects from the LiveKit SDK. The
pixel buffer is `width × height × 4` bytes, row-major, with channels
R, G, B, A (alpha is always `0xFF`).

### `camera.depth_vis`

Grayscale visualisation of depth data from the RealSense depth camera, intended
for human viewing rather than machine consumption.

| Property    | Value |
|-------------|-------|
| Source      | `SOURCE_SCREENSHARE` |
| Pixel format | RGBA (4 bytes/pixel, R=G=B=grey, A=0xFF) |
| Resolution  | 640 × 480 (default) |
| Frame rate  | ~10 fps |

The greyscale mapping is: closer objects appear brighter (white), farther
objects appear darker (black). Depth = 0 (invalid) and depth > 10 m both map
to black.

---

## Data Tracks

### `camera.depth`

Raw 16-bit depth frames from the RealSense camera. Each payload is a flat
binary buffer with a fixed-size header followed by pixel data.

**Publish rate:** ~10 Hz (configurable via `depth_publish_rate_hz`).

#### Wire format

```
Offset  Size     Type        Description
──────  ───────  ──────────  ──────────────────────────────────
 0      4 bytes  uint32_t    width — image width in pixels
 4      4 bytes  uint32_t    height — image height in pixels
 8      8 bytes  uint64_t    timestamp_us — microseconds since Unix epoch
16      w×h×2    uint16_t[]  depth pixels (Z16)
```

**Total payload size:** `16 + width × height × 2` bytes.

Each pixel is an unsigned 16-bit integer representing depth in **millimetres**.
A value of `0` means no depth reading (invalid/too close). The default
resolution is 640 × 480, giving `16 + 614400 = 614416` bytes per frame.

**Byte order:** little-endian (native ARM64 / x86-64).

#### Example: reading a depth frame (pseudocode)

```python
width      = uint32_le(payload[0:4])
height     = uint32_le(payload[4:8])
timestamp  = uint64_le(payload[8:16])
depth_mm   = numpy.frombuffer(payload[16:], dtype="<u2").reshape(height, width)
```

---

### `state.gyro`

Gyroscope telemetry from the L3G4200D 3-axis gyroscope.

**Publish rate:** ~20 Hz (configurable via `publish_rate_hz`).

**Encoding:** UTF-8 JSON.

#### Schema

```json
{
  "gyro_x_dps":  <number>,
  "gyro_y_dps":  <number>,
  "gyro_z_dps":  <number>,
  "angle_x_deg": <number>,
  "angle_y_deg": <number>,
  "angle_z_deg": <number>,
  "valid":       <boolean>
}
```

| Field          | Type    | Unit    | Description |
|----------------|---------|---------|-------------|
| `gyro_x_dps`  | number  | deg/s   | Angular velocity around the X axis |
| `gyro_y_dps`  | number  | deg/s   | Angular velocity around the Y axis |
| `gyro_z_dps`  | number  | deg/s   | Angular velocity around the Z axis |
| `angle_x_deg` | number  | degrees | Integrated angle around the X axis |
| `angle_y_deg` | number  | degrees | Integrated angle around the Y axis |
| `angle_z_deg` | number  | degrees | Integrated angle around the Z axis |
| `valid`        | boolean | —       | `true` if the reading is valid |

**Note:** The integrated angles accumulate drift over time (~0.5 deg/s).

---

### `state.pan`

Servo telemetry for the **pan** (horizontal rotation) motor.

**Publish rate:** ~20 Hz.

**Encoding:** UTF-8 JSON.

#### Schema

```json
{
  "servo":               "pan",
  "motor_id":            <integer>,
  "position_ticks":      <integer>,
  "speed_steps_s":       <integer>,
  "load_pwm":            <integer>,
  "voltage_01v":         <integer>,
  "temperature_celsius": <integer>,
  "moving":              <integer>,
  "current_milliamps":   <integer>,
  "valid":               <boolean>
}
```

| Field                | Type    | Unit    | Description |
|----------------------|---------|---------|-------------|
| `servo`              | string  | —       | Always `"pan"` for this track |
| `motor_id`           | integer | —       | Servo bus ID (default: 1) |
| `position_ticks`     | integer | ticks   | Current position (4096 ticks/revolution) |
| `speed_steps_s`      | integer | steps/s | Current speed reported by servo |
| `load_pwm`           | integer | PWM     | Motor load as PWM value |
| `voltage_01v`        | integer | 0.1 V   | Supply voltage in tenths of a volt |
| `temperature_celsius`| integer | °C      | Servo internal temperature |
| `moving`             | integer | —       | Non-zero if the servo is in motion |
| `current_milliamps`  | integer | mA      | Motor current draw |
| `valid`              | boolean | —       | `true` if the reading is valid |

---

### `state.tilt`

Servo telemetry for the **tilt** (vertical rotation) motor.

**Publish rate:** ~20 Hz.

**Encoding:** UTF-8 JSON.

#### Schema

Identical to `state.pan`, except:
- `"servo"` is always `"tilt"`
- `motor_id` defaults to 2

---

### `control_cmd`

Velocity command sent by the active controller to drive the pan and tilt motors.

**Direction:** Controller → Robot (the robot subscribes to this track from the
participant identity that holds control).

**Encoding:** UTF-8 JSON.

#### Schema

```json
{
  "pan_vel":  <number>,
  "tilt_vel": <number>
}
```

| Field      | Type   | Unit  | Description |
|------------|--------|-------|-------------|
| `pan_vel`  | number | rad/s | Desired pan angular velocity (positive = left) |
| `tilt_vel` | number | rad/s | Desired tilt angular velocity (positive = up) |

**Note:** Velocities are clamped internally to approximately ±3400 steps/s
(~5.2 rad/s for a 4096-tick/revolution servo).

Setting both fields to `0` stops all motion.

---

## RPC Methods

### `acquire_control`

Request or release exclusive motor control. Only one participant may hold
control at a time. The robot subscribes to `control_cmd` only from the identity
that currently holds control.

**Direction:** Caller → Robot.

#### Request payload (JSON)

Use **one** of the following fields:

| Field     | Type    | Effect |
|-----------|---------|--------|
| `acquire` | boolean | `true` to acquire, `false` to release |
| `release` | boolean | `true` to release control |
| `unset`   | boolean | `true` to release control (alias for `release`) |

An empty payload is treated as an acquire request.

#### Examples

Acquire control:
```json
{"acquire": true}
```

Release control:
```json
{"acquire": false}
```

#### Response (string)

The response is a human-readable status string:

| Scenario | Example response |
|----------|-----------------|
| Acquired successfully | `"control acquired by <identity>"` |
| Already controller | `"already controller: <identity>"` |
| Another controller active | `"controller is currently <other_identity>"` |
| Released successfully | `"control released by <identity>"` |
| No controller to release | `"no controller is set"` |
| Cannot release (not owner) | `"controller is currently <other_identity>"` |

If the payload is malformed, the RPC returns an error.
