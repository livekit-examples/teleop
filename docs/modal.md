# Shared simulations and Modal

The /try page starts shared simulations on demand. All simulations in an environment join one LiveKit room. Each simulation has its own control queue.

One worker runs each active simulation type. Viewers can watch without entering a queue. A control turn lasts 60 seconds.

If nobody interacts with a simulation for 120 seconds, its worker stops. Keep watching extends activity for that simulation. Video, automatic renewal, and queue polling do not extend activity.

## Local development

Local mode starts Next.js, LiveKit, and the Python service. The service uses the same queue rules as Modal. It stores instance records in a local SQLite snapshot.

From the repository root, install the dependencies:

~~~sh
git submodule update --init --recursive
cd robo-sims
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m sims fetch-assets
cd ../web
pnpm install
cd ..
python3 scripts/demo-local.py
~~~

Open [the simulation page](http://127.0.0.1:3001/try). Select Watch to start or join a simulation. Select Join control queue in its workspace to request a turn.

When your turn starts, acquire robot control before arming an input. Other visitors keep their video connection during handoff. If nobody waits, the service renews an active controller for another turn.

The launcher uses these addresses:

| Service | Address |
| --- | --- |
| Website | http://127.0.0.1:3001 |
| Simulation service | http://127.0.0.1:8001 |
| LiveKit signaling | ws://127.0.0.1:17880 |
| LiveKit RTC | TCP 17881 and UDP 17882 |

The launcher refuses to replace services on occupied ports. It writes a private profile and logs under .demo-runs/. It does not overwrite .env.local files.

To use local Linux containers, build the managed image first:

~~~sh
cd robo-sims
docker build -f docker/managed/Dockerfile -t teleop-simulation:local .
cd ..
SIM_DEMO_PROVIDER=docker python3 scripts/demo-local.py
~~~

The Docker provider requires host networking to reach local LiveKit. Enable host networking in Docker Desktop before this mode. The native provider remains the default.

## Modal and Vercel

Modal runs the Python API, coordinator, and simulation workers. Vercel serves the website and forwards API requests. LiveKit carries video, telemetry, and commands.

The worker Function uses an L4, two CPUs, and 4096 MiB. Its container limit is seven, with one instance per supported type. It keeps no spare workers.

The coordinator serializes queue changes and reserves simulation types in Modal Dict. LiveKit participant attributes store queue order and turn deadlines. No queue database stores a second copy.

Deploy the Modal API before publishing the matching website. A Vercel deployment updates only the website. Direct robot sessions retain their separate LIVEKIT_* configuration.

A feature preview can use the existing Modal API after its shared-service code is deployed. A separate app, secret, room, and state dictionary are optional for isolated testing. If you choose isolation, set SIM_SUPERVISOR_URL and SIM_SUPERVISOR_KEY for that Git branch in Vercel Preview.

Set TELEOP_PUBLIC_DEPLOYMENT=1 for a public website. Its homepage opens /try. A workspace URL with a session parameter opens the selected shared simulation.

A submodule is a repository inside another repository. The backend lives in the robo-sims submodule. Commit its shared-service changes and update the parent repository reference before publishing a reproducible release.

For a local website against an existing development Modal API, run:

~~~sh
SIM_SUPERVISOR_URL=https://<development-api>.modal.run \
SIM_SUPERVISOR_KEY=<server-key> \
python3 scripts/demo-local.py --modal
~~~

Closing this website does not stop shared remote workers. Their activity deadlines handle abandoned viewers. The scheduled recovery task handles failed workers.

## Deployment errors

If Watch returns {"detail":"Not Found"}, make sure that SIM_SUPERVISOR_URL points to the shared Modal API. The older API can return the catalog while rejecting the new Watch route. Deploying the website does not update that API.

After changing branch variables, publish a new Vercel preview. Existing deployment URLs keep their original code and variables. Test the new URL or the branch alias.

The shared catalog includes turn_seconds and idle_seconds. Its simulation entries can also include an instance. A catalog with only a private duration_seconds value identifies the older service.

## Configuration

Configure the shared room independently of the direct robot room. Use a different shared room and state dictionary for each environment. The following values control shared simulations.

| Variable | Default |
| --- | --- |
| SIM_LIVEKIT_ROOM_NAME | The Modal app name plus -simulations, or teleop-simulations locally. |
| SIM_CONTROL_TURN_SECONDS | 60 |
| SIM_IDLE_TIMEOUT_SECONDS | 120 |
| SIM_MAX_RUNTIME_SECONDS | 21600 |
| SIM_SESSION_STARTUP_SECONDS | 45 |
| SIM_SESSION_CLEANUP_SECONDS | 5 |
| SIM_SESSION_FPS | 30 |
| SIM_LAUNCHES_PER_HOUR | 120 |
| SIM_VISITOR_LAUNCHES_PER_HOUR | 6 |

A tab can watch several simulations through one connection. It can hold one queue place or turn at a time. Different tabs can control different simulations simultaneously.

The service removes an expired viewing entry independently. If another viewing entry remains active, the tab stays connected. Stopping one simulation never deletes the shared room.

Do not treat publishing permission as a robot-specific grant. It applies to the entire room. Each worker also checks the assigned robot identity, instance generation, and turn deadline.

## Tests

Run unit tests from the repository root. The HTTP tests also need requirements-modal.txt. Tests use mocks unless an integration flag explicitly selects real services.

~~~sh
robo-sims/.venv/bin/pip install -r robo-sims/requirements-modal.txt
robo-sims/.venv/bin/python -m unittest discover -s robo-sims/tests
cd web
pnpm test
pnpm exec tsc --noEmit
~~~

With the local launcher running, use the real browser acceptance test:

~~~sh
cd web
TELEOP_DEMO_E2E=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 \
pnpm exec playwright test tests/browser/demo.spec.ts
~~~

This test uses two browser contexts and two simulation types. It measures joint movement and tests handoff, forbidden robot claims, independent activity expiry, and restart. It uses real LiveKit video.

To run the same test on a temporary Modal deployment, use:

~~~sh
robo-sims/.venv/bin/python scripts/shared-modal-check.py
~~~

This command needs an authenticated Modal profile and reachable LiveKit credentials in robo-sims/.env.local. It creates temporary secrets, state, and an isolated room. It removes its Modal resources after the test.

The test uses short timeouts only in its temporary environment. Production defaults remain 60-second turns and 120-second inactivity. Test logs appear under .demo-runs/teleop-shared-check-*/.

The standalone scripts/modal-smoke.py still tests one private Sandbox. It does not implement the shared website queue. The shared browser test exercises the new worker Function and API.
