import { useCallback, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import {
  isSeatHeldByOther,
  parseAcquireControlResponse,
  ACQUIRE_CONTROL_METHOD,
  ACQUIRE_CONTROL_PAYLOAD,
  RELEASE_CONTROL_PAYLOAD,
} from "@/lib/acquire-control";
import { RpcError } from "livekit-client";

let warnedMissingRobotIdentity = false;

export interface UseAcquireControlOptions {
  identity: string | undefined;
  isConnected: boolean;
}

export function useAcquireControl({
  identity,
  isConnected,
}: UseAcquireControlOptions) {
  const { localParticipant } = useLocalParticipant();
  const [isOperatorModeLocked, setIsOperatorModeLocked] = useState(false);
  const [isRpcPending, setIsRpcPending] = useState(false);

  const acquireOperator = useCallback(async (): Promise<boolean> => {
    if (!identity) {
      if (!warnedMissingRobotIdentity && typeof window !== "undefined") {
        warnedMissingRobotIdentity = true;
        console.warn(
          "[acquire_control] identity was not provided; cannot acquire operator control.",
        );
      }
      return false;
    }
    if (!isConnected) return false;

    setIsRpcPending(true);
    try {
      const response = await localParticipant.performRpc({
        destinationIdentity: identity,
        method: ACQUIRE_CONTROL_METHOD,
        payload: ACQUIRE_CONTROL_PAYLOAD,
      });
      const parsed = parseAcquireControlResponse(
        response,
        localParticipant.identity,
      );
      const locked = isSeatHeldByOther(parsed.kind);

      setIsOperatorModeLocked(locked);

      if (locked) return false;

      return parsed.kind === "acquired" || parsed.kind === "already_controller";
    } catch (e) {
      if (e instanceof RpcError) {
        console.warn("[acquire_control] RPC failed:", e.message);
      } else {
        console.warn("[acquire_control] RPC failed:", e);
      }
      return false;
    } finally {
      setIsRpcPending(false);
    }
  }, [identity, isConnected, localParticipant]);

  const releaseOperator = useCallback(async (): Promise<void> => {
    if (!identity || !isConnected) return;

    setIsRpcPending(true);
    try {
      const response = await localParticipant.performRpc({
        destinationIdentity: identity,
        method: ACQUIRE_CONTROL_METHOD,
        payload: RELEASE_CONTROL_PAYLOAD,
      });
      const parsed = parseAcquireControlResponse(
        response,
        localParticipant.identity,
      );
      const isOperatorModeLocked = isSeatHeldByOther(parsed.kind);

      setIsOperatorModeLocked(isOperatorModeLocked);
    } catch (e) {
      if (e instanceof RpcError) {
        console.warn("[acquire_control] release RPC failed:", e.message);
      } else {
        console.warn("[acquire_control] release RPC failed:", e);
      }
    } finally {
      setIsRpcPending(false);
    }
  }, [identity, isConnected, localParticipant]);

  return {
    isRpcPending,
    isOperatorModeLocked,
    acquireOperator,
    releaseOperator,
  };
}
