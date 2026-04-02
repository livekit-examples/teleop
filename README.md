# Overview
LiveKit teleop examples.

## [pan_tilt_demo](pan_tilt_demo/README.md)
A pan/tilt robot with a gyroscope and RealSense attached to the end effector is controlled by another participant.
- `PanTiltRobot`: streams depth, gyro, servo state, and RGB data.
- `TeleopController`: subscribes to all data and sends control commands.

## [web](web/README.md)
A browser-based teleoperation UI built with Next.js and LiveKit. Provides a full-screen video viewport with joystick and keyboard controls for pan/tilt movement, degree scales, and operator mode locking.
