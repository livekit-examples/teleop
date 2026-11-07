# Web UI

## Dynamic workspace

Open `/workspace` for the generalized robot viewer. It discovers publications,
automatically displays eligible cameras, and supports movable numeric plots,
Boolean indicators, state timelines, joint views, raw JSON, video and audio panels.
Layouts save locally per robot and support JSON import/export.

Use `/workspace?fixture=1` to explore generated media and dynamic topics without
hardware. The legacy `/robot` and `/rover` pages remain available.

See [workspace implementation notes](../generalization/workspace-implementation.md)
for usage, layout format, testing, and the remaining live-adapter integration work.
Executable command adapters are currently limited to fixture mode; unverified
live profiles remain visible with an explanation.

## Legacy pages

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
LIVEKIT_ROOM_NAME=robo-sims-space
LIVEKIT_USER_PASS=<your-connection-password>
```

The dynamic workspace (`/workspace`) uses a password to request a fresh, ten-minute token from `/api/credentials`. Configure `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_ROOM_NAME`, and `LIVEKIT_USER_PASS` in `web/.env.local`. The file takes priority over process environment variables. Match the URL, API key, secret, and room to `robo-sims/.env.local`. The API secret stays on the server. Restart the UI server after changing settings. Each connection gets an available `controller-<scientist>` identity.

## Getting started

```bash
# Fetch the vendored livekit-client fork
git submodule update --init

# Install dependencies
pnpm install

# Run the development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The rover needs `livekit-client` with data-track schema metadata. No published release has it. The app uses a fork on the `ladvoc/schema-metadata` branch, which is a git submodule at `vendor/client-sdk-js`. `pnpm dev` and `pnpm build` build the fork first. If the fork is missing, the rover ignores the drive and pan/tilt tracks.

### Rover vs Pan/Tilt Robot

The Rover and Robot are two different physical devices which can be controlled by this project. To switch between them, use the respective `ROBOT` or `ROVER` keyword in the .env.local file:

```
LiveKit credentials and participant identity
NEXT_PUBLIC_<ROVER/ROBOT>_IDENTITY=robot_or_rover_identity
NEXT_PUBLIC_<ROVER/ROBOT>_LIVEKIT_URL=wss://<your-livekit-server>
NEXT_PUBLIC_<ROVER/ROBOT>_LIVEKIT_TOKEN=<your-participant-token>
```

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
    api/credentials/route.ts # Password-authenticated room credentials
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

## On-demand simulations

Run the local simulation experience from the main landing page.
See [the local deployment guide](../docs/modal.md) for setup and test commands.
