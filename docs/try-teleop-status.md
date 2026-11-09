# Implementation status — November 9, 2026

The current design uses Vercel and Modal for hosting/state, alongside LiveKit for
robot media/control. PostgreSQL and its dependency/configuration have been removed.

Implemented:

- One hosted GPU Function for ALL four scene types, with `max_containers=20` and
  one simulation per invocation. It owns the child worker for its entire lifetime.
- A shared FIFO in Modal Dict with a serialized coordinator. All browsers and
  Vercel instances use the same customer service's 20-slot pool.
- Queued state, one-based position, queue length and estimated wait in the API/UI.
  Position/estimate changes are logged. Estimates account for active end times,
  startup/cleanup allowances and waiting durations; they are explicitly estimates.
- Queue cancellation/expiry, stable retries and positions after reload, browser
  caching of active trial summaries, automatic navigation once ready.
- Local native/Docker trials retain SQLite and the same queue fields/calculations.
- Stored duration/FPS, room-specific tokens, scientist room reservations, worker
  deadlines, cleanup recovery, public direct-token blocking and independent direct
  robot dashboard routes remain available.

The [deployment runbook](try-teleop-deployment.md) documents the two worker modes,
Modal-only state, queue behavior, settings and release procedure.

Local tests include a 40-visitor mixed-scene admission test: 20 are admitted and
20 remain queued. No cloud infrastructure has been deployed. Remaining release
work is deploying the Modal App/Vercel site, validating the real 20-worker cap and
queue under cloud load, testing GPU/network/cleanup failures, and committing and
pinning the submodule changes. Development and customer Apps are separate pools;
all customer instances must point to one customer App/coordinator.

Earlier native acceptance runs exercised video, feedback, named-joint motion,
refresh, early stop and expiry for all four scenes with custom 20-second and
default 60-second duration. A local API smoke measured approximately 30 delivered
FPS on trossen-wxai at 30 requested FPS. Those measurements do not establish
Modal GPU performance or deployed concurrency behavior.

Validation for the 20-slot queue revision:

- 111 web unit tests, TypeScript, and lint (0 errors) passed.
- 68 Python tests completed (3 opt-in integrations skipped), including HTTP,
  Modal wiring, snapshot persistence and the mixed-scene 40-visitor admission test.
- All 6 trial-page browser tests passed, including queue progress logging, ETA,
  reload without another launch, automatic opening when ready and cancellation.
- Real local browser tests passed for video/control/expiry and for two independent
  browsers handing off a single available slot after an early stop.

The local handoff uses a one-slot native configuration to avoid requiring 20 GPUs.
The actual deployed 20-worker ceiling remains part of remote release acceptance.

The production Webpack build passed after the queue UI changes. Test services
started for local acceptance were stopped after verification.
