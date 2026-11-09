# Trial deployment and operations

Vercel hosts the website; Modal hosts session state, the API and simulations.
LiveKit carries video, feedback and control. No external database is needed.
`/` and `/workspace` remain direct robot dashboards; `/try` launches trials.
Opening a page never starts physics.

## Shared limit and queue

There is one hosted worker Function, `run_simulation`, for all four scene types.
It has `max_containers=20`, with one input per container and no input concurrency.
A function invocation owns the entire simulation lifetime, including stopping its
child process. Twenty is the TOTAL for all scenes, visitors, browser tabs and
computers using this deployed service, not twenty per scene or visitor.
With 40 simultaneous visitors, up to 20 are admitted and 20 wait.
Do not create a separate worker Function or parameterized container pool per scene.

The application has one FIFO queue shared across scenes. It dispatches only as
many calls as available slots permit. Queue state is stored in Modal, rather than
in the browser or an API container. Each queued response includes:

- `state: queued`
- `queue_position`: one-based position among waiting sessions
- `queue_length`: total waiting sessions
- `estimated_wait_seconds`: estimate until a slot is available, or null if unknown
- `queue_expires_at`: deadline after which the reservation will not launch

Positions reflect admission order recorded by the service. They do not claim to
be positions in Modal's internal scheduler. Startup allocation among already
admitted calls may vary. Estimates simulate the next available slots using active
session end times, startup allowances, cleanup allowances and earlier queued
trials' stored durations. Cold starts, failures, early stops, GPU availability and
cleanup delays can change the estimate. The UI labels it as an estimate, refreshes
it automatically, and logs position/estimate changes with the session ID.

Queued users can leave the queue. Reloading does not create another launch or
change position. A pending launch ID survives reload in sessionStorage; active
trial summaries are cached in localStorage. Tokens and server credentials are not
cached there. The server still checks ownership and deadlines. Once ready, the
workspace opens automatically. The active trial timer starts after first video
and feedback, so waiting consumes none of the active duration.

## Configuration

Session configuration is captured before queue entry and applies only to new
trials. Customers cannot override it.

| Setting | Default | Allowed values |
| --- | --- | --- |
| `SIM_SESSION_DURATION_SECONDS` | 60 | finite, 1–3600 seconds |
| `SIM_SESSION_FPS` | 30 | integer, 1–60 |
| `SIM_SESSION_STARTUP_SECONDS` | 45 | finite, 5–300 seconds |
| `SIM_SESSION_CLEANUP_SECONDS` | 5 | finite, 1–30 seconds |
| Hosted concurrent simulations | 20 | fixed shared worker pool |
| `SIM_QUEUE_LIMIT` | 200 | 1–1000 waiting trials on Modal |
| `SIM_QUEUE_TIMEOUT_SECONDS` | 900 | 30–3600 seconds on Modal |
| `SIM_LAUNCHES_PER_HOUR` | 120 hosted, 30 local | 1–10000 |
| `SIM_VISITOR_LAUNCHES_PER_HOUR` | 6 | 1–100 |
| `SIM_SESSION_CAPACITY` | 2 local | 1–100 locally; ignored on Modal |

Concurrency bounds simultaneous compute, not total daily spending. Launch limits
apply across API containers. Configure a Modal account budget if a currency
budget is required. Local trials use a smaller pool by default and implement the
same queued state/position/estimate fields. Their queue defaults to 200 entries
and 15-minute reservations.

The worker has its own monotonic deadline and process alarm. The hosted function
also has a hard timeout covering the maximum allowed configuration. An API or
storage outage cannot extend a simulation. Browser connection time consumes the
active duration; refresh never extends `expires_at`.

Managed trials use the same scene, gateway and physics code as the CLI. They
use classic rendering and smaller cameras; the CLI supports Filament and larger
images. Requested FPS is distinct from measured delivered FPS.

## Modal state and recovery

A named `modal.Dict` stores a session/room snapshot. A single synchronous
`coordinate` Function (`max_containers=1`, one input per container) performs ALL
mutations, including launches, admission, worker claims, readiness, cancellation
and completion. API containers can read committed state concurrently. Do not add
input concurrency to the coordinator or write the snapshot from other functions.
The snapshot write is not a SQL transaction; serialization provides its single
writer model. There is no PostgreSQL dependency or schema installation command.

Admission reserves a slot and dispatch nonce before spawning the worker. A worker
must claim that exact dispatch before opening a room or starting physics. A
canceled, duplicate or stale call cannot start a simulation. If a spawn
acknowledgment is lost, the service does not submit it again; the worker can
register its call ID during claim. Undispatched queued sessions are recovered by
the scheduled sweeper. Stale admissions are failed and capacity recovered.

The capped Function runs the native worker as a child process in its own private
directory. Ready/terminal events and stop commands pass through that directory;
the Function bridges them to Modal state. The child receives only its exact room,
room-limited robot token and LiveKit URL, without LiveKit API secrets. The Function
stays occupied until the child exits or is killed. Cleanup deletes only a room
whose metadata names the session. Logical capacity remains occupied until cleanup
succeeds. A scheduled sweeper retries failed cleanup and cancels stuck calls using
`terminate_containers=True`. RPC failures alone do not prove a worker has stopped.

Session metadata is retained for one day after cleanup. Policy blobs are removed
on completion. Room reservations remain until both cleanup and token expiry permit
reuse. Modal Dict entries have their own platform inactivity expiration. Session,
queue and worker events include session IDs; use the stored FunctionCall ID to
inspect Modal logs. Authenticated `/health` reports the image version and shared
capacity. Modal manages log retention according to the account's settings.

Use exactly one trial App/coordinator for the shared customer pool. Point all
Vercel instances at that API. Use separate development and production Apps,
Dicts and LiveKit projects. Those are deliberately independent deployments with
separate limits. Drain existing sessions before redeploying a coordinator or
changing image versions; do not run two coordinator versions against one Dict.
Do not mix direct robot rooms or another service's reservations into that project.

## Deploy Modal

From `robo-sims`, install `requirements-modal.txt` and fetch all required assets.
The image build fails if any of the four supported scenes is unavailable. Build
before customer traffic; requests never build an image.

Create the Modal secret `teleop-trials-dev` with:

```dotenv
SIM_SUPERVISOR_KEY=<random-at-least-32-characters>
SIM_STATE_DICT=teleop-trials-dev-sessions
LIVEKIT_URL=wss://<development-project>.livekit.cloud
LIVEKIT_API_KEY=<livekit-api-key>
LIVEKIT_API_SECRET=<livekit-api-secret>
SIM_SESSION_DURATION_SECONDS=60
SIM_SESSION_FPS=30
SIM_QUEUE_LIMIT=200
SIM_QUEUE_TIMEOUT_SECONDS=900
SIM_LAUNCHES_PER_HOUR=120
SIM_VISITOR_LAUNCHES_PER_HOUR=6
```

Then deploy:

```sh
export SIM_MODAL_APP=teleop-trials-dev
export SIM_MODAL_SECRET=teleop-trials-dev
export SIM_IMAGE_VERSION=<robo-sims-commit>
.venv/bin/modal deploy modal_app.py
```

Use the URL for the **api Function**, such as
`https://<workspace>--teleop-trials-dev-api.<region>.modal.run`.
The `https://modal.com/apps/...` URL is the dashboard, not an API endpoint.
To retrieve the URL after deployment, run from `robo-sims`:

```sh
.venv/bin/python -c "import modal; print(modal.Function.from_name('teleop-trials-dev', 'api').get_web_url())"
```


The API URL appears in deployment output. No callback URL or external database
URL is needed. The Dict is created on first use. Keep credentials out of source
control. The coordinator, API, sweeper and worker are Functions in the same App.

This implementation follows Modal's [scaling](https://modal.com/docs/guide/scale),
[input concurrency](https://modal.com/docs/guide/concurrent-inputs),
[Dict storage](https://modal.com/docs/guide/dicts),
[background jobs](https://modal.com/docs/guide/job-queue), and
[scheduled functions](https://modal.com/docs/guide/cron) documentation.

## Run the website locally

Local workers are the default. Add `--modal` only when selecting the deployed
Modal service. From `web/`, `pnpm dev` and `pnpm dev --modal` select the same modes.
Use `pnpm dev:web` for the website alone. The old `--no-modal` flag remains a
compatibility alias for local execution.

Local workers require the prerequisites in [modal.md](modal.md): Python simulation
dependencies, model assets, pnpm, and livekit-server. From the repository root:

```sh
python3 scripts/demo-local.py
SIM_SESSION_DURATION_SECONDS=20 python3 scripts/demo-local.py
SIM_SESSION_CAPACITY=1 python3 scripts/demo-local.py
SIM_DEMO_PROVIDER=docker python3 scripts/demo-local.py
```

The capacity=1 command makes local queue behavior easy to exercise from separate
browser profiles. Native mode requires no Modal login or connection. Docker mode
requires an already-built image and host networking. Open
`http://127.0.0.1:3001/try`; change the port with `SIM_WEB_PORT`.
The local supervisor uses SQLite and shares the queue calculation code.

To use the deployed development service, only pnpm/web dependencies are required:

```sh
SIM_SUPERVISOR_URL=https://<development-api>.modal.run \
SIM_SUPERVISOR_KEY=<development-server-key> \
python3 scripts/demo-local.py --modal
```

The launcher waits for the selected service before starting Next.js. It does not
fall back between modes and never rewrites either `.env.local`. Modal workers do
not call the laptop. Records/logs are separate in `.demo-runs/<mode>/<launcher-id>/`.
Normal shutdown stops only owned process groups and asks the remote service to
cancel that launcher's queued/active sessions. Worker deadlines and the sweeper
continue after abrupt launcher failure. Leave unrelated services running.

## Vercel and release

Deploy `web/` with pnpm. Configure:

```dotenv
SIM_SUPERVISOR_URL=https://<customer-api>.modal.run
SIM_SUPERVISOR_KEY=<customer-server-key>
TELEOP_PUBLIC_DEPLOYMENT=1
```

Do not supply direct robot secrets or static `NEXT_PUBLIC_*` robot tokens.
Public mode makes `/api/credentials` return 404. Private/local deployments keep
the direct-room route and its deliberate `.env.local` precedence. Trial proxy
configuration uses process values. No video/control traffic goes through Vercel.

Deploy Modal first, then Vercel. Validate before sharing the URL. For rollback,
stop new launches, cancel/drain the queue and active trials, then deploy previous
web and image revisions. Keep the same state Dict for existing reservations.
Commit simulation/SDK changes in their own repositories and update submodule
references before release.

From `web/`:

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm test:browser
TELEOP_DEMO_E2E=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 pnpm exec playwright test tests/browser/demo.spec.ts
```

From `robo-sims/`:

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_demo*.py' -v
```

Install `requirements-modal.txt` for HTTP/Modal tests. Tests cover mixed-scene
admission with 40 visitors (20 admitted, 20 queued), FIFO advancement, estimates,
cancellation, ownership, reload, collisions, lost spawn acknowledgments, stale
claims and state persistence. From the root, run launcher tests with
`python3 -m unittest discover -s scripts`.

The manual full API smoke test measures delivered FPS separately from requested
FPS, checks discovery, moves a joint and waits for expiry:

```sh
SIM_SUPERVISOR_URL=https://<development-api>.modal.run \
SIM_SUPERVISOR_KEY=<development-key> \
robo-sims/.venv/bin/python scripts/trial-smoke.py --simulation trossen-wxai
```

It starts real compute. JSON results default to `/tmp/teleop-trial-smoke.json`.
Remote release validation must additionally exercise more than 20 simultaneous
mixed-scene visitors, queue transitions, cloud rendering, outage recovery and
cleanup through the deployed Vercel/Modal/LiveKit path. Local fake-provider and
browser tests cannot prove the deployed platform's scaling behavior.
