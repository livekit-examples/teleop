'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client';

/** Building blocks of the rover HUD that are not telemetry or commands. */

/** Whether the rover is in the room, and the name it joined with. */
export function useRobotParticipant(robotIdentity: string): { online: boolean; name?: string } {
  const room = useRoomContext();
  const [state, setState] = useState<{ online: boolean; name?: string }>({ online: false });

  useEffect(() => {
    const sync = () => {
      const participant = room.remoteParticipants.get(robotIdentity);
      const online = !!participant;
      const name = participant ? participant.name || participant.identity : undefined;
      setState((prev) => (prev.online === online && prev.name === name ? prev : { online, name }));
    };
    sync();
    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
      RoomEvent.Disconnected,
    ];
    for (const e of events) room.on(e, sync);
    return () => {
      for (const e of events) room.off(e, sync);
    };
  }, [robotIdentity, room]);

  return state;
}

/**
 * Command data tracks are publications, so every rover in the shared room can
 * otherwise subscribe to them. Restrict this participant's publications at the
 * SFU to the selected rover; the policy is re-sent by the SDK after reconnects.
 */
export function useRobotCommandSubscriptionPermission(robotIdentity: string) {
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    localParticipant.setTrackSubscriptionPermissions(
      false,
      robotIdentity ? [{ participantIdentity: robotIdentity, allowAll: true }] : [],
    );
  }, [localParticipant, robotIdentity]);
}

/**
 * Subscribe to the selected rover's video only, so every other robot's cameras
 * stay off the wire.
 */
export function useRobotMediaSubscription(robotIdentity: string) {
  const room = useRoomContext();

  useEffect(() => {
    const apply = () => {
      for (const participant of room.remoteParticipants.values()) {
        const want = !!robotIdentity && participant.identity === robotIdentity;
        for (const publication of participant.videoTrackPublications.values()) {
          if (publication.isDesired !== want) publication.setSubscribed(want);
        }
      }
    };
    apply();
    const events = [
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
    ];
    for (const e of events) room.on(e, apply);
    return () => {
      for (const e of events) room.off(e, apply);
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.videoTrackPublications.values()) {
          if (publication.isDesired) publication.setSubscribed(false);
        }
      }
    };
  }, [robotIdentity, room]);
}

type CameraRef = {
  participant: RemoteParticipant;
  publication: RemoteTrackPublication;
  source: RemoteTrackPublication['source'];
};

/**
 * The selected rover's camera tracks, with a stable order the visitor controls:
 * the first is the backdrop, the rest are tiles. Selecting a tile swaps it with
 * the backdrop and leaves every other tile where it was. Publications come from
 * that participant only — never from the rest of the room.
 */
export function useCameras(robotIdentity: string) {
  const room = useRoomContext();
  const [tracks, setTracks] = useState<CameraRef[]>([]);

  useEffect(() => {
    const rebuild = () => {
      const participant = room.remoteParticipants.get(robotIdentity);
      if (!participant) {
        setTracks([]);
        return;
      }
      setTracks(
        Array.from(participant.videoTrackPublications.values()).map((publication) => ({
          participant,
          publication,
          source: publication.source,
        })),
      );
    };
    rebuild();
    const events = [
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
    ];
    for (const e of events) room.on(e, rebuild);
    return () => {
      for (const e of events) room.off(e, rebuild);
    };
  }, [robotIdentity, room]);

  const sids = useMemo(() => tracks.map((t) => t.publication.trackSid), [tracks]);
  const [order, setOrder] = useState<string[]>([]);

  // Keep the order in sync with what's live: drop gone tracks, append new ones.
  useEffect(() => {
    setOrder((current) => {
      const kept = current.filter((sid) => sids.includes(sid));
      const next = [...kept, ...sids.filter((sid) => !kept.includes(sid))];
      return next.length === current.length && next.every((s, i) => s === current[i])
        ? current
        : next;
    });
  }, [sids]);

  const bySid = new Map(tracks.map((t) => [t.publication.trackSid, t]));
  const ordered = order.flatMap((sid) => bySid.get(sid) ?? []);

  return {
    main: ordered[0],
    tiles: ordered.slice(1),
    selectTile: (sid: string) =>
      setOrder((current) => {
        const i = current.indexOf(sid);
        if (i <= 0) return current;
        const next = [...current];
        [next[0], next[i]] = [next[i], next[0]];
        return next;
      }),
  };
}

/** Standard gamepad buttons: A toggles headlights and pressing the right stick
 * homes the camera. Seed the button state before detecting rising edges so a
 * button held while control is granted does not trigger an action. */
export function useGamepadActions({
  active,
  onA,
  onRightStick,
}: {
  active: boolean;
  onA?: () => void;
  onRightStick?: () => void;
}) {
  const actions = useRef({ onA, onRightStick });
  actions.current = { onA, onRightStick };

  useEffect(() => {
    if (!active) return;

    let previous: { a: boolean; rightStick: boolean } | undefined;
    let raf = requestAnimationFrame(function poll() {
      const pad = navigator.getGamepads().find((gamepad) => gamepad?.connected);
      const current = {
        a: pad?.buttons[0]?.pressed ?? false,
        rightStick: pad?.buttons[11]?.pressed ?? false,
      };
      if (previous) {
        if (current.a && !previous.a) actions.current.onA?.();
        if (current.rightStick && !previous.rightStick) actions.current.onRightStick?.();
      }
      previous = current;
      raf = requestAnimationFrame(poll);
    });

    return () => cancelAnimationFrame(raf);
  }, [active]);
}

/** A labelled control in the right-hand stack. */
export function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-1 text-center font-mono text-[10px] tracking-wider text-white">
        {label}
      </div>
      {children}
    </div>
  );
}

export function HeadlightsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" fill="none" className={className} aria-hidden>
      <path
        d="M57 18h17c9.94 0 18 8.06 18 18v56c0 9.94-8.06 18-18 18H57C32.15 110 12 89.85 12 65S32.15 18 57 18Z"
        fill="currentColor"
      />
      <path
        d="M87 39h30M87 56h30M87 73h30M87 90h30"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}
