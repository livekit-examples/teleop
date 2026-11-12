'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Globe, Info, List } from 'lucide-react';
import wordmark from '../../../public/lk-wordmark.svg';
import {
  CONNECTION_COLORS,
  CONNECTION_LABELS,
  CONTROL_LABELS,
  type ConnectionState,
  type Field,
  type FleetRobot,
} from '@/lib/fleet/attributes';
import { useFleet } from '@/lib/fleet/use-fleet';
import { sortRobots, type Sort, type SortKey } from '@/lib/fleet/sort';
import { nearestPlace, placeFromTimeZone } from '@/lib/fleet/places';
import { FleetGlobe, type OperatorPin } from './fleet-globe';
import { Missing } from './missing';
import { RobotPanel } from './robot-panel';
import { AttributesPanel } from './attributes-panel';
import { PanelFrame } from './panel-frame';

const COLUMNS: [SortKey, string][] = [
  ['robot', 'Robot'],
  ['connection', 'Connection'],
  ['type', 'Type'],
  ['control', 'Control'],
  ['location', 'Location'],
];

function Value<T>({ field, children }: { field: Field<T>; children(value: T): React.ReactNode }) {
  return field.ok ? <>{children(field.value)}</> : <Missing keys={field.missing} invalid={field.invalid} />;
}

function Connection({ state, since }: { state: ConnectionState; since?: number }) {
  return (
    <span className={`fleet-connection ${state}`} style={{ '--state': CONNECTION_COLORS[state] } as React.CSSProperties}>
      <span className="fleet-dot" aria-hidden="true" />
      {CONNECTION_LABELS[state]}
      {since !== undefined && <small>{ago(since)}</small>}
    </span>
  );
}

function ago(since: number) {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function Location({ robot }: { robot: FleetRobot }) {
  const { location, coordinates } = robot;
  if (!location.ok) return <Missing keys={location.missing} />;
  const { city, country } = location.value;
  return (
    <span className="fleet-location">
      <span>
        {city ?? <Missing keys={['lk.fleet.city']} />}
        {city && country ? ', ' : ' '}
        {country ?? <Missing keys={['lk.fleet.country']} />}
      </span>
      {coordinates.ok && !coordinates.value.approximate ? (
        <small>
          {coordinates.value.lat.toFixed(2)}, {coordinates.value.lng.toFixed(2)}
        </small>
      ) : coordinates.ok ? (
        <small title="Placed at the city center. Set lk.fleet.lat / lk.fleet.lng for an exact pin.">
          City center (approx.)
        </small>
      ) : null}
    </span>
  );
}

function Control({ robot }: { robot: FleetRobot }) {
  return (
    <span className="fleet-control">
      <Value field={robot.control}>
        {(mode) => <span className={`fleet-chip ${mode}`}>{CONTROL_LABELS[mode]}</span>}
      </Value>
      {robot.activeOperator && <small>Operator: {robot.activeOperator}</small>}
    </span>
  );
}

function useOperatorLocation(enabled: boolean): OperatorPin | undefined {
  const [pin, setPin] = useState<OperatorPin | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const zone = placeFromTimeZone();
    if (zone)
      setPin((p) => p ?? { lat: zone.lat, lng: zone.lng, label: `${zone.city}, ${zone.country}`, approximate: true });
    if (!('geolocation' in navigator)) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (cancelled) return;
        const near = nearestPlace(coords.latitude, coords.longitude);
        setPin({
          lat: coords.latitude,
          lng: coords.longitude,
          label: `${near.city}, ${near.country}`,
          approximate: false,
        });
      },
      () => {
        /* Declined or unavailable: keep the time-zone guess. */
      },
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return pin;
}

export function FleetPortal() {
  const fleet = useFleet();
  const [view, setView] = useState<'list' | 'globe'>('globe');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [globeOpened, setGlobeOpened] = useState(true);
  const operator = useOperatorLocation(globeOpened);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('view');
    // The globe is the default view; ?view=list opens the table.
    if (fromUrl === 'list') setView('list');
  }, []);
  const openView = (next: 'list' | 'globe') => {
    setView(next);
    if (next === 'globe') setGlobeOpened(true);
    const url = new URL(window.location.href);
    if (next === 'list') url.searchParams.set('view', 'list');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  };

  const { robots } = fleet;
  const selectedRobot = robots.find((r) => r.identity === selected);
  const toggle = useCallback(
    (identity: string) => setSelected((id) => (id === identity ? undefined : identity)),
    [],
  );
  const close = useCallback(() => setSelected(undefined), []);
  // Click a column label to sort by it; click again to reverse.
  const [sort, setSort] = useState<Sort | undefined>(undefined);
  const sortBy = (key: SortKey) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const sortedRobots = useMemo(() => sortRobots(robots, sort), [robots, sort]);
  // One side panel at a time: the attribute reference or a robot.
  const [infoOpen, setInfoOpen] = useState(false);
  const toggleInfo = () => {
    setInfoOpen((open) => !open);
    setSelected(undefined);
  };
  const closeInfo = useCallback(() => setInfoOpen(false), []);
  useEffect(() => {
    if (selected) setInfoOpen(false);
  }, [selected]);
  const counts = useMemo(() => {
    const c = { connected: 0, stale: 0, offline: 0, teleop: 0, autonomous: 0, standby: 0, incomplete: 0 };
    for (const r of robots) {
      c[r.connection] += 1;
      if (r.control.ok) c[r.control.value] += 1;
      if (!r.location.ok || !r.model.ok || !r.control.ok || !r.coordinates.ok) c.incomplete += 1;
    }
    return c;
  }, [robots]);
  const unplaced = robots.filter((r) => !r.coordinates.ok);

  const statusClass =
    fleet.status === 'connected' ? 'online' : fleet.status === 'disconnected' ? 'offline' : 'pending';

  return (
    <main className="fleet-app">
      <header className="fleet-topbar">
        <div className="fleet-brand-group">
          <Link className="fleet-brand" href="/fleet" aria-label="Fleet Portal home">
            <Image src={wordmark} alt="LiveKit" priority />
            <small>Fleet</small>
          </Link>
          <button
            type="button"
            className="fleet-info-button"
            aria-pressed={infoOpen}
            aria-label="Participant attributes"
            title="Participant attributes"
            onClick={toggleInfo}
          >
            <Info size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <nav className="fleet-nav" aria-label="Sections">
          <Link href="/">Teleop</Link>
          <Link href="/try">Simulations</Link>
        </nav>
        <span className={`fleet-room ${statusClass}`} role="status">
          <span className="fleet-dot" aria-hidden="true" />
          {fleet.mode === 'fixture' ? 'Fixture' : fleet.status}
          {fleet.room && <span className="fleet-room-name">· {fleet.room}</span>}
        </span>
        <div className="fleet-views" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={view === 'globe'}
            onClick={() => openView('globe')}
            title="Globe"
          >
            <Globe size={15} strokeWidth={2} aria-hidden="true" />
            <span>Globe</span>
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => openView('list')}
            title="List"
          >
            <List size={15} strokeWidth={2} aria-hidden="true" />
            <span>List</span>
          </button>
        </div>
      </header>

      {fleet.error && (
        <div className="fleet-alert" role="alert">
          <span>{fleet.error}</span>
          <button type="button" onClick={fleet.retry}>
            Retry connection
          </button>
        </div>
      )}

      <div className="fleet-main">
      <div className={`fleet-body ${view}`}>
        <section className="fleet-summary" aria-label="Fleet summary">
          <div className="fleet-heading">
            <p className="fleet-eyebrow">Fleet portal</p>
            <h1>
              {robots.length} {robots.length === 1 ? 'robot' : 'robots'} in{' '}
              <span>{fleet.room || 'this room'}</span>
            </h1>
          </div>
          <dl className="fleet-stats">
            {(['connected', 'stale', 'offline'] as const).map((state) => (
              <div key={state} style={{ '--state': CONNECTION_COLORS[state] } as React.CSSProperties}>
                <dt>
                  <span className="fleet-dot" aria-hidden="true" />
                  {CONNECTION_LABELS[state]}
                </dt>
                <dd>{counts[state]}</dd>
              </div>
            ))}
            <div>
              <dt>Teleop</dt>
              <dd>{counts.teleop}</dd>
            </div>
            <div>
              <dt>Autonomous</dt>
              <dd>{counts.autonomous}</dd>
            </div>
            <div>
              <dt>Standing by</dt>
              <dd>{counts.standby}</dd>
            </div>
          </dl>
        </section>

        {view === 'list' ? (
          <>
            <section className="fleet-table-wrap" aria-label="Robots">
              {robots.length === 0 ? (
                <div className="fleet-empty">
                  <h2>{fleet.status === 'connected' ? 'No robots in this room' : 'Connecting to the room…'}</h2>
                  <p>
                    A participant shows up here when it sets <code>lk.portal.role</code> to{' '}
                    <code>robot</code>. Open <Link href="/fleet?fixture=1">/fleet?fixture=1</Link> to see
                    the portal with sample robots.
                  </p>
                </div>
              ) : (
                <table className="fleet-table">
                  <thead>
                    <tr>
                      {COLUMNS.map(([key, label]) => {
                        const active = sort?.key === key;
                        return (
                          <th
                            key={key}
                            scope="col"
                            aria-sort={
                              active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                            }
                          >
                            <button
                              type="button"
                              className={`fleet-sort ${active ? 'active' : ''}`}
                              onClick={() => sortBy(key)}
                            >
                              {label}
                              {active ? (
                                sort.dir === 'asc' ? (
                                  <ArrowUp size={12} strokeWidth={2} aria-hidden="true" />
                                ) : (
                                  <ArrowDown size={12} strokeWidth={2} aria-hidden="true" />
                                )
                              ) : (
                                <ArrowUpDown size={12} strokeWidth={2} aria-hidden="true" />
                              )}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRobots.map((robot) => (
                      <tr
                        key={robot.identity}
                        className={`${robot.connection} ${selected === robot.identity ? 'selected' : ''}`}
                        onClick={() => toggle(robot.identity)}
                      >
                        <th scope="row">
                          <span className="fleet-robot">
                            <span>
                              <button
                                type="button"
                                className="fleet-robot-name"
                                aria-pressed={selected === robot.identity}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggle(robot.identity);
                                }}
                              >
                                {robot.name}
                              </button>
                              {robot.name !== robot.identity && <small>{robot.identity}</small>}
                            </span>
                          </span>
                        </th>
                        <td>
                          <Connection state={robot.connection} since={robot.since} />
                        </td>
                        <td>
                          <Value field={robot.model}>
                            {(model) => (
                              <span className="fleet-model">
                                {model.label}
                                {model.label !== model.id && <small>{model.id}</small>}
                              </span>
                            )}
                          </Value>
                        </td>
                        <td>
                          <Control robot={robot} />
                        </td>
                        <td>
                          <Location robot={robot} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        ) : (
          <section className="fleet-globe-view" aria-label="Fleet globe">
            <FleetGlobe robots={robots} operator={operator} selected={selected} onSelect={setSelected} />
            <aside className="fleet-globe-side">
              <div className="fleet-legend" aria-label="Legend">
                {(['connected', 'stale', 'offline'] as const).map((state) => (
                  <Connection key={state} state={state} />
                ))}
              </div>
              <p className="fleet-operator-note">
                <span className="fleet-eyebrow">Operator</span>
                {operator ? (
                  <>
                    {fleet.identity || 'You'} · {operator.label}
                    <small>
                      {operator.approximate
                        ? 'From your time zone. Allow location access for an exact pin.'
                        : 'From browser location.'}
                    </small>
                  </>
                ) : (
                  <>
                    {fleet.identity || 'You'}
                    <small>Location unknown. Allow location access to draw links.</small>
                  </>
                )}
              </p>
              <ul className="fleet-side-list">
                {robots.map((robot) => (
                  <li key={robot.identity}>
                    <button
                      type="button"
                      aria-pressed={selected === robot.identity}
                      onClick={() => toggle(robot.identity)}
                    >
                      <span className="fleet-side-text">
                        <strong>{robot.name}</strong>
                        {robot.location.ok ? (
                          <small>{robot.location.value.label}</small>
                        ) : (
                          <Missing keys={robot.location.missing} />
                        )}
                        {!robot.coordinates.ok && robot.location.ok && (
                          <Missing keys={robot.coordinates.missing} invalid={robot.coordinates.invalid} />
                        )}
                      </span>
                      <span
                        className="fleet-dot"
                        style={{ '--state': CONNECTION_COLORS[robot.connection] } as React.CSSProperties}
                        title={CONNECTION_LABELS[robot.connection]}
                      />
                    </button>
                  </li>
                ))}
              </ul>
              {unplaced.length > 0 && (
                <p className="fleet-side-foot">
                  {unplaced.length} not on the globe: set <code>lk.fleet.lat</code> and{' '}
                  <code>lk.fleet.lng</code>, or a known <code>lk.fleet.city</code>.
                </p>
              )}
            </aside>
          </section>
        )}
      </div>
      {(infoOpen || selectedRobot) && (
        <PanelFrame>
          {infoOpen && <AttributesPanel incomplete={counts.incomplete} onClose={closeInfo} />}
          {selectedRobot && (
            <RobotPanel
              robot={selectedRobot}
              me={fleet.identity}
              view={view}
              onClose={close}
              onShow={openView}
            />
          )}
        </PanelFrame>
      )}
      </div>
    </main>
  );
}
