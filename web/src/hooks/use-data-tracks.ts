import { type Room, RoomEvent, type RoomEventCallbacks } from 'livekit-client';
import { useEffect, useState } from 'react';

/** Any data track in the room (local publish or remote). */
export type RoomDataTrack =
  | Parameters<RoomEventCallbacks['dataTrackPublished']>[0]
  | Parameters<RoomEventCallbacks['localDataTrackPublished']>[0];

/**
 * Subscribes to all data track publish/unpublish events (local and remote).
 */
export function useDataTracks(room: Room | undefined | null) {
  const [dataTracks, setDataTracks] = useState<RoomDataTrack[]>([]);

  useEffect(() => {
    if (!room) return;

    function handleRemotePublished(track: Parameters<RoomEventCallbacks['dataTrackPublished']>[0]) {
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
