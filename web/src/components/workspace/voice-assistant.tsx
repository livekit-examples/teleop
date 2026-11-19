'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, LoaderCircle, Mic, Square, TriangleAlert } from 'lucide-react';
import { Room } from 'livekit-client';
import { VoiceSession, type VoiceRoom } from '@/lib/voice/voice-session';
import type { ProvenanceRow, VoiceCredentials, VoiceState } from '@/lib/voice/voice-types';
import './voice-assistant.css';

const STATUS: Record<VoiceState, string> = {
  idle: 'Off',
  requesting_permission: 'Waiting for microphone',
  connecting: 'Connecting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Stopped',
};

async function requestSession(robot: string): Promise<VoiceCredentials> {
  const response = await fetch('/api/voice/session', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ robot }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.token !== 'string')
    throw new Error(
      typeof body.error === 'string' ? body.error : 'Could not start the voice session.',
    );
  return body;
}

async function requestMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new DOMException('No microphone API', 'NotFoundError');
  // Asked on the click, before anything connects; the room opens its own capture afterwards.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

function createSession() {
  return new VoiceSession({
    // A second connection on purpose: voice lives in a private room, apart from the robot room.
    createRoom: () => new Room() as unknown as VoiceRoom,
    requestSession,
    requestMicrophone,
    attachAudio(track) {
      const audio = (track as { attach(): HTMLMediaElement }).attach();
      audio.hidden = true;
      document.body.appendChild(audio);
      return () => {
        (track as { detach(element: HTMLMediaElement): void }).detach(audio);
        audio.remove();
      };
    },
  });
}

function age(ms: number) {
  return ms < 1000 ? `${ms} ms old` : `${(ms / 1000).toFixed(1)} s old`;
}
function provenanceLine(row: ProvenanceRow) {
  return [row.robot, row.track, row.field, age(row.age_ms)].filter(Boolean).join(' · ');
}

/** The floating Hey ROS microphone. Read-only: it never touches the control path. */
export function VoiceAssistant({ robot, robotName }: { robot: string; robotName?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(true);
  const [session] = useState(createSession);
  const voice = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const log = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/voice/session', { cache: 'no-store' })
      .then((response) => response.json())
      .then((body) => live && setEnabled(body?.enabled === true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // Leaving the workspace ends the session and releases the microphone.
  useEffect(() => () => void session.stop(), [session]);
  // A new selection retargets the agent; it never keeps answering for the previous robot.
  useEffect(() => {
    void session.setRobot(robot);
  }, [session, robot]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [voice.transcript]);

  if (!enabled) return null;
  const active = session.active;
  const busy = voice.state === 'connecting' || voice.state === 'requesting_permission';
  const target = active ? voice.robot : robot;
  const showPanel = active || voice.state === 'error' || voice.transcript.length > 0;
  return (
    <aside className="hey-ros" data-state={voice.state} aria-label="Hey ROS voice assistant">
      {showPanel && (
        <section className="hey-ros-panel">
          <div className="hey-ros-head">
            <strong>Hey ROS</strong>
            <span className="hey-ros-status" role="status">
              {STATUS[voice.state]}
            </span>
            <span className="hey-ros-robot" title={target}>
              {target === robot ? robotName || target : target}
            </span>
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? 'Hide transcript' : 'Show transcript'}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          </div>
          {voice.error && (
            <p className="hey-ros-error" role="alert">
              {voice.error}
            </p>
          )}
          {open && voice.transcript.length > 0 && (
            <ol className="hey-ros-log" ref={log} aria-label="Transcript">
              {voice.transcript.map((entry) => (
                <li key={entry.id} data-role={entry.role} data-final={entry.final}>
                  {entry.text}
                  {entry.provenance?.map((row) => (
                    <small key={`${row.track}/${row.field}`}>{provenanceLine(row)}</small>
                  ))}
                  {!entry.provenance && entry.unavailable && <small>No valid reading</small>}
                </li>
              ))}
            </ol>
          )}
          {open && active && voice.transcript.length === 0 && !busy && (
            <p className="hey-ros-hint">Try “Hey ROS, what’s your battery level?”</p>
          )}
        </section>
      )}
      <button
        type="button"
        className="hey-ros-mic"
        aria-label={active ? 'Stop Hey ROS' : 'Talk to Hey ROS'}
        aria-pressed={active}
        title={
          active
            ? 'Stop Hey ROS'
            : robot
              ? `Talk to Hey ROS about ${robot}`
              : 'Select a robot first'
        }
        onClick={() => void session.toggle(robot)}
      >
        {busy ? (
          <LoaderCircle size={22} className="animate-spin" />
        ) : voice.state === 'error' ? (
          <TriangleAlert size={22} />
        ) : active ? (
          <Square size={18} fill="currentColor" />
        ) : (
          <Mic size={22} />
        )}
      </button>
    </aside>
  );
}
