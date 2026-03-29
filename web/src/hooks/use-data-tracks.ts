import { type Room, RoomEvent, type RoomEventCallbacks, RemoteDataTrack } from 'livekit-client';
import { useEffect, useState } from 'react';

/**
 * Returns a live array of all {@link RemoteDataTrack}s in the room.
 *
 * On mount, seeds the list by iterating every remote participant's `dataTracks` map.
 * After that, listens for `DataTrackPublished` / `DataTrackUnpublished` room events
 * to keep the array in sync. The returned reference changes on every publish or
 * unpublish, so downstream effects that depend on it will re-run.
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
