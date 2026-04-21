import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import {
  isSeatHeldByOther,
  parseAcquireControlResponse,
  ACQUIRE_CONTROL_METHOD,
  ACQUIRE_CONTROL_PAYLOAD,
  RELEASE_CONTROL_PAYLOAD,
} from "@/lib/acquire-control";
import { RpcError } from "livekit-client";
import { Mode } from "@/lib/types";

let warnedMissingRobotIdentity = false;

export interface UseAcquireControlOptions {
  isConnected: boolean;
  identity: string | undefined;
}

/**
 * Manages the operator control lifecycle via `acquire_control` RPC.
 *
 * Exposes `handleModeRequest` which sends an acquire or release RPC to the robot
 * participant identified by `identity`. The response is parsed to determine whether
 * the operator seat was granted, already held, or locked by another user.
 * Automatically releases control on unmount if currently in operate mode.
 */
export function useAcquireControl({ identity, isConnected }: UseAcquireControlOptions) {
  const [mode, setMode] = useState<Mode>("view");
  const { localParticipant } = useLocalParticipant();
  const [isOperatorModeLocked, setIsOperatorModeLocked] = useState(false);
  const [isRpcPending, setIsRpcPending] = useState(false);

  const handleModeRequest = async (next: Mode) => {
    if (next === "operate") {
      const ok = await acquireOperator();
      if (ok) setMode("operate");
    } else {
      await releaseOperator();
      setMode("view");
    }
  };

  const modeRef = useRef(mode);

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

      const parsed = parseAcquireControlResponse(response, localParticipant.identity);
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
      const parsed = parseAcquireControlResponse(response, localParticipant.identity);
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

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    return () => {
      if (modeRef.current === "operate") {
        void releaseOperator();
      }
    };
  }, [releaseOperator]);

  return {
    mode,
    isRpcPending,
    isOperatorModeLocked,
    acquireOperator,
    releaseOperator,
    handleModeRequest,
  };
}
