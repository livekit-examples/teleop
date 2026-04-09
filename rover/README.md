# Rover LiveKit C++ Reference

This directory is a compact LiveKit C++ reference for robotics developers. It
contains a rover-side participant, a controller participant, and a shared typed
message layer that validates JSON as soon as it is received.

# Dependencies
- cmake


## Build

```bash
./build.sh
./build.sh clean -DCMAKE_BUILD_TYPE=Release
./build.sh -DLIVEKIT_LOCAL_SDK_DIR=/path/to/livekit-sdk-install-prefix
```

`LIVEKIT_LOCAL_SDK_DIR` behaves the same way as `pan_tilt_demo`: if provided,
CMake skips the SDK download and prepends that install prefix to
`CMAKE_PREFIX_PATH`.

## Binaries

Build output:
- `build/RoverRobot`
- `build/RoverController`
- `build/TeleopMsgsTest`

Robot usage:

```bash
./build/RoverRobot --url <ws-url> --token <token> --rover-id <identity>
```

Controller usage:

```bash
./build/RoverController --url <ws-url> --token <token> --rover-id <identity>
```

Both binaries also support `LIVEKIT_URL` and `LIVEKIT_TOKEN`.

## Track And RPC Naming

For `--rover-id rover-1`:
- IMU data track: `rover-1.imu`
- Camera video track: `rover-1.arducam`
- Control command data track: `rover-1.control_cmd`
- RPC method: `acquire_control`

The controller calls `acquire_control` on participant identity `rover-1`. If
control is granted, the rover subscribes to that controller participant's
`rover-1.control_cmd` track.

The shared `include/teleop_msgs.h` header also accepts `{"release": true}` and
`{"unset": true}` on the rover side so the control RPC mirrors the existing
`pan_tilt_demo` behavior.

## Hardware Integration

- `RoverRobot` reads IMU/temperature data from the serial bus and publishes it
  on the `<rover_id>.imu` data track. Video frames are captured via
  `ArducamCamera` (libcamera) and published on the `<rover_id>.arducam` video
  track. If the serial port or camera is unavailable at startup the robot
  continues running with the missing subsystem disabled.
- `RoverController` subscribes to IMU and video, acquires exclusive control via
  the `acquire_control` RPC, and sends WASD keyboard commands on the
  `<rover_id>.control_cmd` data track.

## Testing
It is good to test the hardware as isolated as possible.
### Motor Control:
Drive the motors forward, backward, left, right for 2 seconds each.
```bash
./build/MotorControlTest /dev/ttyserial0
```

### Serial Bus Logging:
Read/print the IMU/temperature data every 50ms
```bash
./build/SerialBusLoggerTest /dev/ttyserial0
```


### RGB
Ensure you have gone through the correct setup steps for your pi/arducam here:
https://docs.arducam.com/Raspberry-Pi-Camera/Native-camera/8MP-IMX219/#raspberry-pi-4
