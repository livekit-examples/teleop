# Web UI

A browser-based teleoperation interface for controlling the pan/tilt robot via LiveKit. The UI displays real-time camera feeds and provides joystick and keyboard controls for pan/tilt movement.

## Features

- Full-screen video viewport with picture-in-picture secondary feed
- Draggable joystick control for pan (yaw) and tilt (pitch)
- Arrow key keyboard input with hold-to-repeat
- Animated degree scales showing current yaw and pitch angles
- View/Operator mode toggle with operator seat locking
- Real-time connection status display
- LiveKit data track subscription for robot state

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm` or use corepack)
- A running LiveKit server
- A LiveKit access token with permission to join the robot's room

## Environment variables

Create a `.env.local` file in the `web/` directory:

```bash
# Robot (arm) — LiveKit credentials and participant identity
NEXT_PUBLIC_ROBOT_IDENTITY=pt_robot
NEXT_PUBLIC_ROBOT_LIVEKIT_URL=wss://<your-livekit-server>
NEXT_PUBLIC_ROBOT_LIVEKIT_TOKEN=<your-participant-token>

# Rover — LiveKit credentials and participant identity
NEXT_PUBLIC_ROVER_IDENTITY=rover-1
NEXT_PUBLIC_ROVER_LIVEKIT_URL=wss://<your-livekit-server>
NEXT_PUBLIC_ROVER_LIVEKIT_TOKEN=<your-participant-token>
```

For local development with the token generation API:

```bash
LIVEKIT_API_KEY=<your-api-key>
LIVEKIT_API_SECRET=<your-api-secret>
LIVEKIT_URL=wss://<your-livekit-server>
```

> **Note:** The `/api/token` route is for development only and must not be used in production without an authentication layer.

## Getting started

```bash
# Install dependencies
pnpm install

# Run the development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Controls

### Joystick (Operator mode)

Click and drag the joystick knob to control pan (horizontal) and tilt (vertical). The joystick springs back to center on release.

### Keyboard (Operator mode)

| Key   | Action    |
| ----- | --------- |
| Left  | Pan left  |
| Right | Pan right |
| Up    | Tilt up   |
| Down  | Tilt down |

Hold a key to repeat the input continuously.

### Modes

- **View** -- read-only mode, controls are disabled
- **Operator** -- active control of the robot, locked when another operator is connected

## Tech stack

- [Next.js](https://nextjs.org) 16 with React 19
- [LiveKit Client SDK](https://docs.livekit.io/client-sdk-js/) and [@livekit/components-react](https://docs.livekit.io/components-react/)
- [Tailwind CSS](https://tailwindcss.com) v4
- [Motion](https://motion.dev) for spring-based animations
- [Base UI](https://base-ui.com) for headless components
- TypeScript

## Project structure

```
src/
  app/
    page.tsx               # Main entry point, LiveKit session setup
    layout.tsx             # Root layout
    api/token/route.ts     # Development-only token generation endpoint
  components/
    app.tsx                # Main UI shell: video viewport, scales, joystick, status bar
    joystick.tsx           # Draggable 3x3 grid joystick with spring animation
    bottom-bar.tsx         # Connection status, mode toggle
    scale-vertical.tsx     # Pitch degree scale (left side)
    scale-horizontal.tsx   # Yaw degree scale (bottom)
    scale-value.tsx        # Numeric degree value display
    ui/button.tsx          # Base button component (CVA variants)
  hooks/
    use-data-tracks.ts     # LiveKit data track subscription management
    use-arrow-key-degrees.ts  # Keyboard input handler for arrow keys
    use-repeat-step.ts     # Hold-to-repeat input utility
  lib/
    types.ts               # Mode type definition ('view' | 'operate')
    utils.ts               # cn() helper (clsx + tailwind-merge)
```
