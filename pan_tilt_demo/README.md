# Overview
A project for teleoperating a pan/tilt robot via LiveKit.

In this project `pt` means "pan/tilt" for the pan tilt robot.
In this project `servo` and `motor` are used interchangeably.

# Building
This project uses cmake to build and depends on LiveKit SDK, SCServo, and SDL3. These are downloaded and built by cmake.
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

## TODO
Realsense

# Architecture
## PanTiltRobot
A LiveKit participant executable for a real pan/tilt robot. It
owns the pan/tilt servo controller (`PanTiltController`) and gyro
(`L3G4200D_GYRO`), publishes robot state, and accepts remote velocity commands.
- `pan_tilt_controller.cpp/h`: the controller for the pan and tilt servos
- `pan_tilt_livekit.cpp/h`: the object which interfaces the servo controller and gyro with livekit
- `pan_tilt_main.cpp`: the executable for the pan tilt robot

## TeleopController
A livekit participant which uses subscribes to the DataTracks of the `PanTiltRobot` and (if control is acquired) uses SDL3 to get user keyboard input and send control commands to the robot participant.
- `teleop_main.cpp`: the executable which creates a livekit participant, gets SDL3 input, and sends control commands.


### DataTrack namespace
- Publishes:
  - `gyro.state`
  - `pan.state`
  - `tilt.state`
- Subscribes:
  - `control_cmd` (from the current controller identity only)

### Message formats
- `control_cmd` (JSON, subscriber input):
  - `{"pan_vel": <rad_per_sec>, "tilt_vel": <rad_per_sec>}`
  - Velocities are in `rad/s` and converted internally to servo `steps/s`.
- `gyro.state` (JSON, publisher output):
  - `{"gyro_x_dps": <double>, "gyro_y_dps": <double>, "gyro_z_dps": <double>, "angle_x_deg": <double>, "angle_y_deg": <double>, "angle_z_deg": <double>, "valid": <bool>}`
- `pan.state` / `tilt.state` (JSON, publisher output):
  - `{"servo": "pan|tilt", "motor_id": <int>, "position_ticks": <int>, "speed_steps_s": <int>, "load_pwm": <int>, "voltage_01v": <int>, "temperature_celsius": <int>, "moving": <int>, "current_milliamps": <int>, "valid": <bool>}`

### Acquiring control
Control is explicitly gated by RPC:
- Call RPC method `acquire_control` to claim control when no controller is set.
- If another controller is active, the request is rejected and returns the
  current controller identity.
- The active controller can unset/release control via `acquire_control`, which
  clears the `control_cmd` subscription.

## PTController
`PTController` is a LiveKit participant executable for a real pan/tilt robot. It subscribes to the servo states and gyro state. It uses SDL3 to read keyboard inputs and publishes the control commands (if control is acquired) to the `control_cmd` data track.

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