import { type Room, RoomEvent, type RoomEventCallbacks, RemoteDataTrack } from 'livekit-client';
import { useEffect, useState } from 'react';

/**
 * Subscribes to remote data track publish/unpublish events, seeding with
 * any tracks that are already published when the hook mounts.
 */
export function useRemoteDataTracks(room: Room | undefined | null) {
  const [dataTracks, setDataTracks] = useState<RemoteDataTrack[]>([]);

  useEffect(() => {
    if (!room) return;

    // Seed with already-published remote data tracks
    const existing: RemoteDataTrack[] = [];
    for (const participant of room.remoteParticipants.values()) {
      for (const track of participant.dataTracks.values()) {
        existing.push(track);
      }
    }
    if (existing.length > 0) {
      setDataTracks(existing);
    }

    function handleRemotePublished(
      track: Parameters<RoomEventCallbacks['dataTrackPublished']>[0],
    ) {
      setDataTracks((prev) => [...prev, track]);
    }

    function handleUnpublished(sid: string) {
      setDataTracks((prev) => prev.filter((track) => track.info?.sid !== sid));
    }

    room.on(RoomEvent.DataTrackPublished, handleRemotePublished);
    room.on(RoomEvent.DataTrackUnpublished, handleUnpublished);

    return () => {
      room.off(RoomEvent.DataTrackPublished, handleRemotePublished);
      room.off(RoomEvent.DataTrackUnpublished, handleUnpublished);
    };
  }, [room]);

  return dataTracks;
}
