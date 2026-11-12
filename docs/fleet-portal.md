# Fleet Portal

`/fleet` lists every robot in the LiveKit room and shows where each one is,
what it is, who is driving it and whether it's reachable. A globe view draws
the current operator (this browser) and a link to each robot.

- Live: `http://localhost:3000/fleet` (uses the same `/api/credentials` as the workspace and joins as `lk.portal.role=observer`).
- Sample data: `http://localhost:3000/fleet?fixture=1` (no server needed).
- The globe is the default view. Open straight into the table with `view=list`.

The page is disabled when `TELEOP_PUBLIC_DEPLOYMENT=1`.

## What the portal expects from robots

Everything comes from **participant attributes**. Robots set them with
`localParticipant.setAttributes()` (or `set_attributes()` in Python) and can
update them at any time; the portal re-renders on
`ParticipantAttributesChanged`.

Every `lk.fleet.*` key is optional. When one is missing, the portal shows the
key name in that column (for example `Missing lk.fleet.model`) so the robot
owner knows what to set. An unrecognized `lk.fleet.control` value is shown as
`Invalid`.

| Attribute | Required | Example | Used for |
| --- | --- | --- | --- |
| `lk.portal.role` | **Yes** | `robot` | Existing Portal key. Only participants with `robot` are listed. |
| `lk.fleet.city` | No | `Denver` | Location column. |
| `lk.fleet.country` | No | `US` | Location column. ISO 3166-1 alpha-2 preferred; full names work. |
| `lk.fleet.lat` | No | `39.7392` | Globe pin, decimal degrees (-90..90). |
| `lk.fleet.lng` | No | `-104.9903` | Globe pin, decimal degrees (-180..180). |
| `lk.fleet.model` | No | `trossen-arm` | Type column. |
| `lk.fleet.control` | No | `teleop` | Control column. One of `autonomous`, `teleop`, `standby`. |
| `lk.portal.active_operator` | No | `controller-curie` | Existing Portal key. Shown under Control when set; drives the Teleoperate note in the robot panel. |

Known `lk.fleet.model` ids get a friendly label: `trossen-arm`,
`trossen-workbench`, `carla-sim`, `f1tenth-sim`, `mujoco-sim`, `rover`. Any
other value is shown as-is.

If `lk.fleet.lat`/`lk.fleet.lng` are missing, the portal places the robot at
the city center from a small built-in table (`web/src/lib/fleet/places.ts`) and
marks it approximate. If the city isn't in that table either, the robot is
listed under "not on the globe".

### Example (Python robot)

```python
await room.local_participant.set_attributes({
    "lk.portal.role": "robot",
    "lk.portal.version": "3",
    "lk.fleet.city": "Denver",
    "lk.fleet.country": "US",
    "lk.fleet.lat": "39.7392",
    "lk.fleet.lng": "-104.9903",
    "lk.fleet.model": "trossen-arm",
    "lk.fleet.control": "standby",
})
```

Attribute values are strings, so send numbers as strings.

## Robot panel

Click a row, a globe pin or a robot in the globe sidebar to open a panel on the right
(Esc or × closes it). It shows:

- **Status:** connection state and how long it's held, link quality (LiveKit `ConnectionQuality`), control mode, active operator, location, model, Portal version, and how many cameras, data tracks and audio tracks the robot publishes right now.
- **Teleoperate:** opens the workspace at `/?robot=<identity>`, which selects that robot when the room connects. Disabled while the robot is offline. A note says if someone else holds control or the robot is running autonomously.
- **Watch live:** `/?robot=<identity>&watch=1` joins the workspace as `lk.portal.role=observer`, which can't take control. **Copy watch link** copies that URL.
- **Record now** and **See recordings:** coming soon (LiveKit Egress).
- **Show on globe / Show in list.**
- **Session analytics:** coming soon. LiveKit Cloud's Sessions page already has a Session analytics view (connection quality, bandwidth, participants, media stats) for every session; linking to it needs the Cloud project id and the session id.
- **All participant attributes**, for debugging.

## Attribute reference in the app

The info button next to "Fleet" in the top bar opens this attribute list in the side panel.
The panel notes how many robots are missing attributes.

## Connection state

Connection state is **not** an attribute. The portal derives it from the room:

| State | Color | Meaning |
| --- | --- | --- |
| Connected | cyan `#1FD5F9` | In the room with a working link. |
| Stale | amber `#FFB752` | Still in the room, but LiveKit reports `ConnectionQuality.Lost` (nothing has arrived for a few seconds). It recovers to Connected or drops to Offline. |
| Offline | red `#FF7566` | Seen since this page loaded and has left the room. |

The same color is used for the status dot, the globe marker and the globe link.
Offline links are dashed.

Limitation: the portal only knows about robots it has seen since the page
loaded. A robot that went offline before you opened the page isn't listed. A
persistent roster (for example a server-side registry, or room metadata the
robots update) would fix that.

## Operator location

The globe shows only the current operator: this browser. Its position comes
from the browser's geolocation (asked once, when the page loads). If that's declined, the portal falls back
to the city for the browser's time zone and marks it approximate. The operator's location is not published to the room.

A robot within about 250 km of the operator would sit under the operator's pin. The globe
draws those robots on a small ring around the operator so their links stay visible.

## Files

- `web/src/lib/fleet/attributes.ts`: the attribute contract, parsing and colors. Keep it in sync with this doc.
- `web/src/lib/fleet/use-fleet.ts`: room connection (live and fixture).
- `web/src/lib/fleet/places.ts`: city table for approximate pins.
- `web/src/lib/fleet/land-dots.ts`: generated land dots for the globe (Natural Earth via `world-atlas`).
- `web/src/components/fleet/`: the portal, globe (three.js) and model icons.
- `web/src/app/fleet/`: route and styles.
