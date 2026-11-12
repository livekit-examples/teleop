'use client';

import { useEffect } from 'react';
import { Info, X } from 'lucide-react';
import { CONTRACT } from '@/lib/fleet/attributes';

/** Side panel: the participant attributes the portal reads. Opened from the info button by "Fleet". */
export function AttributesPanel({ incomplete, onClose }: { incomplete: number; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="fleet-panel info" aria-label="Participant attributes">
      <header className="fleet-panel-head">
        <span className="fleet-robot-icon large info-icon">
          <Info size={18} strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="fleet-panel-title">
          <span className="fleet-eyebrow">Participant attributes</span>
          <h2>What the portal expects</h2>
        </div>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close attributes panel">
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>
      <div className="fleet-panel-scroll">
        {incomplete > 0 && (
          <p className="fleet-chip warn fleet-info-warn">
            {incomplete} {incomplete === 1 ? 'robot is' : 'robots are'} missing attributes
          </p>
        )}
        <p className="fleet-info-intro">
          Robots set these with <code>localParticipant.setAttributes()</code>. Every{' '}
          <code>lk.fleet.*</code> key is optional. When one is missing, the portal shows the key name
          in its place.
        </p>
        <ul className="fleet-contract-list">
          {CONTRACT.map((row) => (
            <li key={row.key}>
              <div className="fleet-contract-key">
                <code>{row.key}</code>
                {row.required === 'Yes' && <span className="fleet-chip teleop">Required</span>}
              </div>
              <p>{row.note}</p>
              <span className="fleet-contract-example">
                e.g. <code>{row.example}</code>
              </span>
            </li>
          ))}
        </ul>
        <div className="fleet-info-note">
          <span className="fleet-eyebrow">Connection state</span>
          <p>
            Not an attribute. The portal reads it from the room: <strong>Connected</strong>,{' '}
            <strong>Stale</strong> when LiveKit reports the link as lost, and <strong>Offline</strong>{' '}
            for robots that left the room since this page loaded.
          </p>
        </div>
      </div>
    </aside>
  );
}
