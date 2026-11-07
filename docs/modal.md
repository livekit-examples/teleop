# On-demand simulations and Modal

The main teleop page launches simulations from `robo-sims`.
The local service starts one isolated process for each run.
Each run ends 60 seconds after it becomes ready.
A worker runs one simulation.

## Local deployment

Local deployment uses Next.js, a local LiveKit server, and a Python supervisor.
The supervisor manages simulation processes and their rooms.
No Modal account is required for this mode.

Install Python 3.12, pnpm, and `livekit-server` before setup.
Initialize the repository submodules before installing dependencies.
Use the repository root for these commands:

```sh
git submodule update --init --recursive
cd robo-sims
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m sims fetch-assets
cd ../web
pnpm install
cd ..
python3 scripts/demo-local.py
```

Open [the local landing page](http://127.0.0.1:3001).
Choose a simulation, wait for `ready`, and select Preview or Open control.
Request control and arm the joint input before moving a joint.

The landing page keeps the existing device links and manual workspace connection.
Compatible registry entries appear with icons and launch controls.
Unavailable entries show a reason.

Preview consumes the same 60 seconds as control.
Refreshing or changing pages does not extend the deadline.
Press Ctrl-C in the launcher terminal to stop all three local services.

The launcher uses these local ports:

| Service | Address |
| --- | --- |
| Website | `http://127.0.0.1:3001` |
| Supervisor | `http://127.0.0.1:8001` |
| LiveKit signaling | `ws://127.0.0.1:17880` |
| LiveKit RTC | TCP `17881`, UDP `17882` |

If port `3001` is in use, set `SIM_WEB_PORT` before starting the launcher.
The launcher refuses to replace a service that already uses a required port.
Keep the development LiveKit server private because it uses public development credentials.

The launcher writes a private profile to `robo-sims/.demo/local.env`.
It passes that profile to the supervisor and Next.js.
It does not change your existing `web/.env.local`.

The profile contains these values:

```dotenv
LIVEKIT_URL=ws://127.0.0.1:17880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_ROOM_NAME=teleop-demo
SIM_SUPERVISOR_URL=http://127.0.0.1:8001
SIM_SUPERVISOR_KEY=<generated-local-key>
```

The generated key protects the private supervisor API.
The website uses a visitor cookie to restrict access to owned runs.
Browser tokens stay in memory and grant access to one room.

The supervisor stores run records and worker logs in `robo-sims/.demo/`.
Each run directory contains `worker.log` and lifecycle messages.
Read that log if the page reports a startup or renderer failure.

The supervisor allows two concurrent runs.
Each worker enforces its own deadline if the browser or supervisor stops.
The supervisor also removes the room and stops the worker after bounded cleanup.

The LiveKit fixture enables `enable_participant_data_blob: true` for schema storage.
Use `robo-sims/tests/livekit-dev.yaml` when starting LiveKit separately.
A bare development server omits this application configuration.

From `web`, run the web tests:

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm test:browser
```

From `robo-sims`, run the simulation tests:

```sh
.venv/bin/python -m unittest discover -s tests -v
ROBO_SIMS_LIVEKIT_TEST=1 ROBO_SIMS_VIDEO_TEST=1 .venv/bin/python -m unittest discover -s tests -p test_contract_livekit.py -v
```

The opt-in LiveKit test requires the local server and fetched assets.
Make sure that native processes and Docker use the same managed lifecycle:

```sh
ROBO_SIMS_DEMO_TEST=1 .venv/bin/python -m unittest discover -s tests -p test_demo_livekit.py -v
ROBO_SIMS_DEMO_TEST=1 ROBO_SIMS_DEMO_PROVIDER=docker .venv/bin/python -m unittest discover -s tests -p test_demo_livekit.py -v
```

Run these commands from `robo-sims` while local LiveKit is available.
The Docker variant also requires the built image and Docker host networking.
The regular browser suite uses generated fixture data.
The managed-session browser test requires the full local launcher.
From `web`, run it against the website that the launcher starts:

```sh
TELEOP_DEMO_E2E=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 pnpm exec playwright test tests/browser/demo.spec.ts
```

That test waits through the full 60-second deadline.
It receives real video and measures joint motion through discovered feedback.
It also tests visitor access and cleanup after a second simulation stops.

### Local Linux containers

The optional Docker provider runs the same worker in a Linux container.
Build the image from `robo-sims` after fetching the model assets.
The image includes the generalized simulator runtime and software rendering libraries.

```sh
cd robo-sims
docker build -f docker/managed/Dockerfile -t teleop-simulation:local .
cd ..
SIM_DEMO_PROVIDER=docker python3 scripts/demo-local.py
```

The provider uses Docker host networking to reach the private local LiveKit server.
On Docker Desktop, enable host networking before starting this mode.
Keep the native provider as the default if host networking is unavailable.

Docker runs use separate records in `robo-sims/.demo-docker/`.
Each container mounts only its own run directory and receives a room token.
The provider limits each container to two CPUs and 2 GB of memory.

## Remote deployment

Remote deployment is not configured yet.
Add deployment commands and required secrets here when that work begins.
Keep the same worker lifecycle and deadline across local and remote providers.

Modal runs compute in its cloud service.
A remote worker needs LiveKit Cloud or a reachable self-hosted LiveKit server.
It cannot connect to the laptop's `127.0.0.1`.

The provider interface separates compute launch from simulation behavior.
A future Modal provider can start one Sandbox for each run.
Request worker shutdown before forced Sandbox termination so the worker can stop motion and close its connections.
