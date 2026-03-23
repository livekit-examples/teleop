# Overview
A project for teleoperating a pan/tilt robot via LiveKit.

In this project `pt` means "pan/tilt" for the pan tilt robot.
In this project `servo` and `motor` are used interchangeably.

# Building
This project uses cmake to build and depends on LiveKit SDK, SCServo, SDL3, and
librealsense2. LiveKit SDK, SCServo, and SDL3 are downloaded and built by cmake.
librealsense2 must be installed on the system (see "RealSense Camera" below).
```
# Build the project
./build.sh

# Clean build the project
./build.sh clean

# Use a locally built LiveKit SDK (e.g. when no prebuilt release exists for your platform).
# First, install the SDK into a local prefix from the SDK build tree:
#   cmake --install <sdk-build-dir> --prefix ~/livekit-sdk-local
# Then point the build at that prefix:
./build.sh -DLIVEKIT_LOCAL_SDK_DIR=$HOME/livekit-sdk-local
```

# Running
## Generate tokens
...

In one terminal, run the robot:
```
./build/PanTiltRobot --serial-port /dev/ttyACM0 --imu-address 0x69
```

In another terminal, run the teleop controller:
```
./build/PanTiltController --robot <id_of_robot_used_in_token_generation>
```

## RealSense Camera
PanTiltRobot uses an Intel RealSense D415 RGB-D camera. The RealSense SDK
(`librealsense2`) must be installed on the system.

### Installing librealsense2

On Jetson (Ubuntu/L4T):
```
sudo apt-get install librealsense2-dev librealsense2-utils
```

Verify the camera is detected:
```
rs-enumerate-devices
```

### RealSense tracks
When enabled (default), PanTiltRobot publishes three additional tracks:

| Track name         | Type       | Source            | Description |
|--------------------|------------|-------------------|-------------|
| `camera.color`     | VideoTrack | `SOURCE_CAMERA`   | RGBA colour frames (640×480 @ 30 fps) |
| `camera.depth`     | DataTrack  | —                 | Raw Z16 depth with binary header (throttled to 10 Hz) |
| `camera.depth_vis` | VideoTrack | `SOURCE_SCREENSHARE` | Grayscale depth visualisation (throttled to 10 Hz) |

#### Depth DataTrack binary format (`camera.depth`)
Each frame is a flat payload with a 16-byte header followed by raw pixel data:

| Offset | Size | Type       | Description |
|--------|------|------------|-------------|
| 0      | 4    | `uint32_t` | width in pixels |
| 4      | 4    | `uint32_t` | height in pixels |
| 8      | 8    | `uint64_t` | timestamp (microseconds since epoch) |
| 16     | w×h×2 | `uint16_t[]` | Z16 depth values (millimetres, little-endian) |

### Disabling the camera
Pass `--no-realsense` to PanTiltRobot to run without the camera:
```
./build/PanTiltRobot --serial-port /dev/ttyACM0 --no-realsense
```

# Architecture
## PanTiltRobot
A LiveKit participant executable for a real pan/tilt robot. It
owns the pan/tilt servo controller (`PanTiltController`), gyro
(`L3G4200D_GYRO`), and RealSense camera (`RealsenseCamera`), publishes robot
state and camera feeds, and accepts remote velocity commands.
- `pan_tilt_controller.cpp/h`: the controller for the pan and tilt servos
- `pan_tilt_livekit.cpp/h`: the object which interfaces the servo controller, gyro, and camera with LiveKit
- `pan_tilt_main.cpp`: the executable for the pan tilt robot
- `realsense_camera.cpp/h`: wraps the librealsense2 pipeline, provides RGBA colour and raw Z16 depth frames

## TeleopController
A LiveKit participant that subscribes to the DataTracks and VideoTracks of the
`PanTiltRobot`, renders the live camera feed in an SDL window, and (if control
is acquired) sends keyboard-driven velocity commands to the robot.
- `teleop_main.cpp`: the executable which creates a LiveKit participant, renders video, gets SDL3 input, and sends control commands.

### Keyboard controls (SDL window must have focus)
| Key     | Action |
|---------|--------|
| A / D   | Pan left / right |
| W / X   | Tilt up / down |
| S       | Stop all motors |
| Space   | Toggle between RGB and depth visualisation |
| Q       | Quit |


### Track namespace
- Published DataTracks:
  - `state.gyro`
  - `state.pan`
  - `state.tilt`
  - `camera.depth` (raw Z16 depth, binary header + pixel data)
- Published VideoTracks:
  - `camera.color` (`SOURCE_CAMERA` — RGBA)
  - `camera.depth_vis` (`SOURCE_SCREENSHARE` — grayscale depth)
- Subscribed DataTracks:
  - `control_cmd` (from the current controller identity only)

### Message formats
- `control_cmd` (JSON, subscriber input):
  - `{"pan_vel": <rad_per_sec>, "tilt_vel": <rad_per_sec>}`
  - Velocities are in `rad/s` and converted internally to servo `steps/s`.
- `state.gyro` (JSON, publisher output):
  - `{"gyro_x_dps": <double>, "gyro_y_dps": <double>, "gyro_z_dps": <double>, "angle_x_deg": <double>, "angle_y_deg": <double>, "angle_z_deg": <double>, "valid": <bool>}`
- `state.pan` / `state.tilt` (JSON, publisher output):
  - `{"servo": "pan|tilt", "motor_id": <int>, "position_ticks": <int>, "speed_steps_s": <int>, "load_pwm": <int>, "voltage_01v": <int>, "temperature_celsius": <int>, "moving": <int>, "current_milliamps": <int>, "valid": <bool>}`

### Acquiring control
Control is explicitly gated by RPC:
- Call RPC method `acquire_control` to claim control when no controller is set.
- If another controller is active, the request is rejected and returns the
  current controller identity.
- The active controller can unset/release control via `acquire_control`, which
  clears the `control_cmd` subscription.

## PTController (TeleopController)
`TeleopController` is a LiveKit participant that subscribes to the servo states,
gyro state, camera colour, and depth tracks from `PanTiltRobot`. It renders the
live video feed (RGB or depth) in an SDL3 window and publishes velocity commands
(if control is acquired) to the `control_cmd` data track.

# BOM
The hardware for this project was based off the [LeRobot SO101 arm](https://huggingface.co/docs/lerobot/en/so101). It uses the base, first servo (pan) holder/sleeve, and second servo (tilt) holder/sleeve, and a custom arm mount for connecting the second servo to the Realsense D415 and L3G4200D Gyro.

| Qty | Component                                      | Description                                                  |
|-----|------------------------------------------------|--------------------------------------------------------------|
|  2  | STS3215 servos                                 | Feetech STS3215 C018 Servo – 12V 30KG High Torque Servo for SO-ARM100/101 |
|  1  | Waveshare Serial Bus Servo Driver Board         | Serial Bus Servo Controller                                  |
|  1  | Realsense D415 Sensor                          | Depth Camera                                                 |
|  1  | Jetson Nano Nx                                 | Edge AI Computing Board                                      |
|  1  | L3G4200D adafruit Gyro                          | 3-axis Gyroscope (Adafruit)                                  |

# Setup and Tests
`setup/` has tools for configuring your servos, validating your gyroscope.

## Gyroscope
First you will need to find your i2c bus and address.
```
for bus in $(i2cdetect -l | awk '{print $1}' | cut -d- -f2); do
    echo "Scanning bus $bus..."
    sudo i2cdetect -y -r $bus
done

### TODO(sderosa): what more work can we do here for i2c?

```
- `setup/gyroscope/gyro_min_i2c.py` is a lightweight python script to smoke test your gyroscope. Note: the "Configuration" section may need to be updated to your I2C bus and address.
- setup/gyroscope/gyro.cpp is a program which instantiates a `L3G4200D_GYRO` object and polls the gyroscope.

## Motor Setup
- `setup/servos/program_eprom.cpp` is a program to program the servo ID.
- `setup/servos/scan.cpp` is a program to scan for servos on the servo controller bus.
- `setup/servos/keyboard_controller.cpp` is a program to control the pan/tilt robot via keyboard. This is a great final test to ensure your robot is working as expected.

First find your servo serial port of the servo controller bus.
```
ls /dev/ttyUSB*
ls /dev/ttyACM*
```
Next, set the servo id for each servo. Ensure there is only a single servo plugged into the servo controller bus. Then, program the ID:
```
./setup/servos/build/ProgramEprom <serial_port> <current_id> <new_id> (optional --set-zero-position)
```
Do this for each servo. The defaults of the application assume Pan = 0 and tilt = 1.

NOTE: if you are unsure of what your servo ID is, you can run the `Scan` program which will print the ID of the servos found on the bus.
```
./setup/servos/build/Scan <serial_port>
```

## TODO: wiring schematic

## Gyro Setup
schematic
VCC
GND
...
...

# Notes
- the gyro has a lot of drift (~0.5 deg/sec)


# API / Track Overview
For connecting to the Pan Tilt Robot from participants see the [API_README.md](./API_README.md)