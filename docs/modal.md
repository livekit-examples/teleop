# On-demand simulations and Modal

The `/try` page launches simulations from `robo-sims`.
The `/` and `/workspace` pages remain direct robot dashboards.
The local service starts one isolated process for each run.
Each run defaults to 60 seconds after readiness. Set `SIM_SESSION_DURATION_SECONDS` to change new runs.
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

Open [the local landing page](http://127.0.0.1:3001/try).
Choose a simulation. Its workspace opens automatically when ready.
Return to `/try` to preview an existing session without requesting control.
Request control and arm the joint input before moving a joint.

The trial page links to the direct workspace. The dashboard links back to `/try`.
Only the supported scenes appear with launch controls: the four Trossen scenes, `f1tenth`, `vacuum`, and `cluttered-table`.
Unavailable entries show a reason.

Preview consumes the same fixed session duration as control.
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

The launcher writes a private trial profile and logs to `.demo-runs/local-<provider>/<launcher-id>/`.
It passes that profile to the supervisor and Next.js.
It does not change your existing `web/.env.local`.

The profile contains these values:

```dotenv
LIVEKIT_URL=ws://127.0.0.1:17880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
SIM_SUPERVISOR_URL=http://127.0.0.1:8001
SIM_SUPERVISOR_KEY=<generated-local-key>
```

The generated key protects the private supervisor API.
The website uses a visitor cookie to restrict access to owned runs.
Browser tokens stay in memory and grant access to one room.

The supervisor stores SQLite records and worker logs in the launcher log directory under `sessions/`.
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

That test waits through the configured deadline; use 20 seconds for a faster acceptance run.
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

The standalone Modal workflow runs `trossen-workbench-whack` and tests its LiveKit connection, video, feedback, motion, and shutdown.
The landing page still uses the local supervisor.
The supervisor does not yet have a Modal provider.

Modal runs compute in its cloud service.
A remote worker needs LiveKit Cloud or a reachable self-hosted LiveKit server.
It cannot connect to the laptop's `127.0.0.1`.

### Run the Modal smoke test

A smoke test checks that the main workflow works.
Use the Python 3.12 virtual environment from local setup.
Install the tested Modal client from the repository root:

```sh
robo-sims/.venv/bin/python -m pip install modal==1.6.3
robo-sims/.venv/bin/python -m modal setup
robo-sims/.venv/bin/python -m modal profile list
```

If the virtual environment already has an authenticated Modal profile, skip `modal setup`.
The successful run used the `livekit` profile and workspace.
Use your intended workspace before starting a run.
To select an existing `livekit` profile, run:

```sh
robo-sims/.venv/bin/python -m modal profile activate livekit
```

Set these values in both `robo-sims/.env.local` and `web/.env.local`:

```dotenv
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=<your-project-api-key>
LIVEKIT_API_SECRET=<your-project-api-secret>
LIVEKIT_ROOM_NAME=<your-room>
```

The launcher reads these files directly and requires all four values to match.
It does not use process environment overrides for LiveKit credentials.
Keep these files private and outside version control.
The successful run used the `robo-sims-space` room in the configured LiveKit Cloud project.

Fetch the scene assets, then launch the test from the repository root:

```sh
cd robo-sims
.venv/bin/python -m sims fetch-assets trossen-workbench-whack
cd ..
robo-sims/.venv/bin/python -u scripts/modal-smoke.py
```

To request 30 FPS per camera, pass `--fps` to the launcher:

```sh
robo-sims/.venv/bin/python -u scripts/modal-smoke.py --fps 30
```

Use `--help` to list the supported arguments.
The launcher accepts `--fps` as a positive integer and defaults to 12.
It passes the requested rate to the worker, discovery document, video loop, and encoders.
The rate is a target, and rendering or network limits can reduce the delivered FPS.
Other arguments from `python -m sims run` are not forwarded.

The command creates the `teleop-workbench-smoke` Modal app if it does not exist.
It builds a Linux image from the current simulator source, requirements, and fetched assets.
The launcher uploads `sims/`, `assets/`, and the package requirements.
The first run builds the image before starting the worker.

The test uses this resource and rendering configuration:

| Setting | Value |
| --- | --- |
| GPU | One NVIDIA L4 |
| CPU | 2 cores |
| Memory | 4096 MiB |
| Python | 3.12 |
| Renderer | EGL with NVIDIA graphics support |
| Video rate | 12 FPS per camera by default, configurable with `--fps` |
| Stereo video | Three streams, each 384 x 120 pixels with both eyes side by side |
| Scene video | One stream, 480 x 360 pixels |
| Worker startup limit | 45 seconds |
| Simulation duration | 60 seconds after readiness |
| Worker cleanup limit | 5 seconds |
| Modal Sandbox timeout | 180 seconds |

These are the managed demo resolutions from `sims/trossen/managed.py`.
The run does not measure performance at the larger default CLI resolutions.
The image sets `MUJOCO_GL=egl`, `PYOPENGL_PLATFORM=egl`, and `NVIDIA_DRIVER_CAPABILITIES=all`.
It also supplies the NVIDIA EGL vendor configuration for headless rendering.

### Credentials and lifecycle

The LiveKit API key and secret stay on the laptop.
The launcher creates tokens that expire after ten minutes.
It passes only `LIVEKIT_URL` and the robot's token through a temporary Modal Secret.
The token permits the robot to join one room, publish, subscribe, send data, and update its own attributes.

Each run gets a unique robot identity and a separate operator identity for the test.
The operator connects from the laptop and commands a small movement of one simulated joint.
The test releases control after it observes movement in the joint feedback.
It then waits for the worker to reach its deadline and disconnect.

The worker uses `sims.demo.worker` and enforces its own 60-second deadline.
The launcher waits for worker exit and then terminates the Sandbox in cleanup.
The Sandbox timeout bounds the run if the launcher disconnects.
The launcher uses the configured shared room and does not delete it.

### Results and logs

The launcher saves each run under `robo-sims/.demo/modal-<random-id>/`.
The directory contains `modal.json`, `discovery.json`, `stdout.log`, `stderr.log`, and, after a successful probe, `result.json`.
`modal.json` records the app, Sandbox, room, robot identity, requested FPS, and resource configuration.
`discovery.json` records the robot description returned by `get_robot_config`.

A successful run prints these messages:

```text
PROBE discovery, four camera streams, and feedback received
PROBE simulated movement passed ...
FINAL_EVENT {"state": "expired"}
PROBE participant disconnected at end of run
RESULT ... "sandbox_exit_code": 0 ...
```

Read `stdout.log` for worker lifecycle events.
Read `stderr.log` for renderer or LiveKit errors.
If the probe fails, the launcher terminates the Sandbox and the command exits with an error.

The initial test passed on November 8, 2026, with run ID `modal-88d2580ea2`.
It received all four camera streams, joint and battery feedback from both arms, and discovery through RPC.
The test observed `left_arm_joint_1` move by about 0.0204 radians after requesting a 0.1-radian trajectory.
The worker reported `expired`, the robot disconnected, and the Sandbox exited with code 0.

### Connect Modal to the landing page

The provider interface separates compute launch from simulation behavior.
A future Modal provider can start one Sandbox for each run.
It must preserve the supervisor's ownership rules, room management, worker deadline, and bounded cleanup.
Request worker shutdown before forced Sandbox termination so the worker can stop motion and close its connections.


## Modal development and Vercel

See [the deployment runbook](try-teleop-deployment.md) for secrets, Modal state and queue setup,
image versions, recovery, rollback, and validation commands.
Run the same local customer pages against the deployed development API:

```sh
SIM_SUPERVISOR_URL=https://<development-api>.modal.run \
SIM_SUPERVISOR_KEY=<server-key> \
python3 scripts/demo-local.py --modal
```

This mode needs pnpm and a deployed API. It does not start local LiveKit, import
simulation dependencies, or require a local Modal login. It never falls back to
local execution. Local execution is the default; only Modal execution needs `--modal`.
Neither starting the website nor opening `/try` starts a worker.
The launcher reports logs under `.demo-runs/modal/<launcher-id>/` and asks the
remote API to stop only its own sessions during normal shutdown.
After an abrupt exit, worker deadlines and the scheduled sweeper still apply.

Trial settings are separate from direct robot settings. Neither mode rewrites an
`.env.local` file or replaces the direct workspace's `LIVEKIT_*` settings.
The direct credential route continues to prioritize `web/.env.local`; the demo
proxy uses the server process values for `SIM_SUPERVISOR_URL` and `SIM_SUPERVISOR_KEY`.
Set `TELEOP_PUBLIC_DEPLOYMENT=1` on public Vercel deployments to disable direct-room
credentials. Do not put direct robot secrets in the public deployment.
