'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChartLine, Check, CircleDot, Eye, Film, Gamepad2, Globe, Link2, List, X } from 'lucide-react';
import {
  CONNECTION_COLORS,
  CONNECTION_LABELS,
  CONTROL_LABELS,
  type FleetRobot,
  type LinkQuality,
} from '@/lib/fleet/attributes';
import { Missing } from './missing';

const QUALITY_LABELS: Record<LinkQuality, string> = {
  excellent: 'Excellent',
  good: 'Good',
  poor: 'Poor',
  lost: 'Lost',
  unknown: 'Unknown',
};
const QUALITY_BARS: Record<LinkQuality, number> = { excellent: 3, good: 2, poor: 1, lost: 0, unknown: 0 };

/**
 * LiveKit Cloud already has a Session analytics view (connection quality, bandwidth,
 * participants, media stats) for every session on its Sessions page. Linking a robot to its
 * session needs the Cloud project id and the room's session id; not wired up yet.
 */
const MORE = [
  {
    icon: <ChartLine size={15} strokeWidth={2} aria-hidden="true" />,
    title: 'Session analytics',
    product: 'LiveKit Cloud',
    body: 'Connection quality, bandwidth and media stats for this robot’s session, on the Cloud dashboard’s Sessions page.',
  },
];

function ago(since: number) {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

export function RobotPanel({
  robot,
  me,
  view,
  onClose,
  onShow,
}: {
  robot: FleetRobot;
  /** This browser's identity. */
  me: string;
  view: 'list' | 'globe';
  onClose(): void;
  onShow(view: 'list' | 'globe'): void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => setCopied(false), [robot.identity]);

  const id = encodeURIComponent(robot.identity);
  const teleopHref = `/?robot=${id}`;
  const watchHref = `/?robot=${id}&watch=1`;
  const offline = robot.connection === 'offline';
  const heldBy = robot.activeOperator && robot.activeOperator !== me ? robot.activeOperator : '';
  const youHold = !!robot.activeOperator && robot.activeOperator === me;
  const quality = robot.live?.quality ?? (offline ? 'lost' : 'unknown');
  const tracks = robot.live?.tracks ?? [];
  const cameras = tracks.filter((t) => t.kind === 'video');
  const data = tracks.filter((t) => t.kind === 'data');
  const audio = tracks.filter((t) => t.kind === 'audio');
  const color = CONNECTION_COLORS[robot.connection];

  const teleopNote = offline
    ? 'Offline. Teleop opens when the robot is back.'
    : heldBy
      ? `${heldBy} has control. You’ll watch until they release it.`
      : youHold
        ? 'You have control.'
        : robot.control.ok && robot.control.value === 'autonomous'
          ? 'Running autonomously. Taking control interrupts it.'
          : robot.connection === 'stale'
            ? 'Link is stale. Controls may lag or drop.'
            : 'Free to take control.';

  const copyWatch = async () => {
    try {
      await navigator.clipboard.writeText(new URL(watchHref, window.location.origin).toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard blocked: the link is still in the Watch button. */
    }
  };

  return (
    <aside
      className="fleet-panel"
      aria-label={`${robot.name} details`}
      style={{ '--state': color } as React.CSSProperties}
    >
      <header className="fleet-panel-head">
        <div className="fleet-panel-title">
          <h2>{robot.name}</h2>
          <code>{robot.identity}</code>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={onClose}
          aria-label="Close robot panel"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <div className="fleet-panel-scroll">
        <section className="fleet-panel-status" aria-label="Current status">
          <div className={`fleet-panel-banner ${robot.connection}`}>
            <span className="fleet-dot" aria-hidden="true" />
            <strong>{CONNECTION_LABELS[robot.connection]}</strong>
            {robot.since !== undefined && <span>for {ago(robot.since)}</span>}
            <span className={`fleet-bars q${QUALITY_BARS[quality]}`} title={`Link quality: ${QUALITY_LABELS[quality]}`}>
              <i />
              <i />
              <i />
            </span>
          </div>
          <dl className="fleet-panel-grid">
            <div>
              <dt>Control</dt>
              <dd>
                {robot.control.ok ? (
                  <span className={`fleet-chip ${robot.control.value}`}>{CONTROL_LABELS[robot.control.value]}</span>
                ) : (
                  <Missing keys={robot.control.missing} invalid={robot.control.invalid} />
                )}
              </dd>
            </div>
            <div>
              <dt>Operator</dt>
              <dd>{robot.activeOperator ? (youHold ? 'You' : robot.activeOperator) : 'None'}</dd>
            </div>
            <div>
              <dt>Link quality</dt>
              <dd>{QUALITY_LABELS[quality]}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>
                {robot.location.ok ? (
                  robot.location.value.label
                ) : (
                  <Missing keys={robot.location.missing} />
                )}
              </dd>
            </div>
            <div>
              <dt>Type / model</dt>
              <dd>
                {robot.model.ok ? robot.model.value.label : <Missing keys={robot.model.missing} />}
              </dd>
            </div>
            <div>
              <dt>Portal</dt>
              <dd>{robot.portalVersion ? `v${robot.portalVersion}` : <Missing keys={['lk.portal.version']} />}</dd>
            </div>
          </dl>
          <div className="fleet-panel-streams">
            <span className="fleet-eyebrow">Publishing</span>
            {offline ? (
              <p>Nothing while offline.</p>
            ) : tracks.length === 0 ? (
              <p>No tracks published.</p>
            ) : (
              <p>
                {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'} · {data.length} data{' '}
                {data.length === 1 ? 'track' : 'tracks'}
                {audio.length > 0 && ` · ${audio.length} audio`}
              </p>
            )}
          </div>
        </section>

        <section className="fleet-panel-actions" aria-label="Actions">
          <span className="fleet-eyebrow">Actions</span>
          <div className="fleet-action-primary-row">
            {offline ? (
              <span className="fleet-action primary disabled" aria-disabled="true">
                <Gamepad2 size={16} strokeWidth={2} aria-hidden="true" />
                Teleoperate
              </span>
            ) : (
              <Link className="fleet-action primary" href={teleopHref}>
                <Gamepad2 size={16} strokeWidth={2} aria-hidden="true" />
                Teleoperate
              </Link>
            )}
            {offline ? (
              <span className="fleet-action watch disabled" aria-disabled="true">
                <Eye size={16} strokeWidth={2} aria-hidden="true" />
                Watch live
              </span>
            ) : (
              <Link className="fleet-action watch" href={watchHref}>
                <Eye size={16} strokeWidth={2} aria-hidden="true" />
                Watch live
              </Link>
            )}
            <button
              type="button"
              className={`fleet-action icon ${copied ? 'copied' : ''}`}
              onClick={copyWatch}
              disabled={offline}
              aria-label={copied ? 'Watch link copied' : 'Copy watch link'}
              title={copied ? 'Copied' : 'Copy watch link'}
            >
              {copied ? (
                <Check size={16} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Link2 size={16} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="fleet-action-note">{teleopNote}</p>
          <div className="fleet-action-row">
            <div className="fleet-action soon" aria-disabled="true">
              <span>
                <CircleDot size={15} strokeWidth={2} aria-hidden="true" />
                Record now
              </span>
              <small>Coming soon!</small>
            </div>
            <div className="fleet-action soon" aria-disabled="true">
              <span>
                <Film size={15} strokeWidth={2} aria-hidden="true" />
                See recordings
              </span>
              <small>Coming soon!</small>
            </div>
          </div>
          {view === 'list' ? (
            robot.coordinates.ok && (
              <button type="button" className="fleet-action" onClick={() => onShow('globe')}>
                <Globe size={15} strokeWidth={2} aria-hidden="true" />
                Show on globe
              </button>
            )
          ) : (
            <button type="button" className="fleet-action" onClick={() => onShow('list')}>
              <List size={15} strokeWidth={2} aria-hidden="true" />
              Show in list
            </button>
          )}
        </section>

        <section className="fleet-panel-more" aria-label="More from LiveKit">
          <span className="fleet-eyebrow">More from LiveKit</span>
          <ul>
            {MORE.map((item) => (
              <li key={item.title}>
                <span className="fleet-more-icon">{item.icon}</span>
                <span>
                  <strong>
                    {item.title}
                    <span className="fleet-more-tag">Coming soon</span>
                  </strong>
                  <small>{item.product}</small>
                  <span className="fleet-more-body">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <details className="fleet-panel-attributes">
          <summary>All participant attributes</summary>
          <dl className="fleet-attributes">
            {Object.entries(robot.attributes)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value || '""'}</dd>
                </div>
              ))}
          </dl>
        </details>
      </div>
    </aside>
  );
}
