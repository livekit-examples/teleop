"use client";

import { bindHand, type Hand } from "@/lib/teleop/xr-bindings";
import { CollapsibleSection } from "./collapsible-section";
import { useRuntime } from "./context";
import { ImmersiveVrButton, useImmersiveVr } from "./immersive-vr";

export function XrControls({ supported }: { supported: boolean }) {
  const runtime = useRuntime();
  const vr = useImmersiveVr();
  return (
    <section className="control-card">
      <CollapsibleSection heading="h3" title="VR controller bindings">
        {(["left", "right"] as Hand[]).map((hand) => (
          <label key={hand}>
            {hand} hand
            <select
              value={runtime.layout?.controller_hands?.[hand] ?? ""}
              onChange={(event) => void bindHand(runtime, hand, event.target.value)}
            >
              <option value="">Unassigned</option>
              {Object.entries(runtime.config?.control_interfaces ?? {}).map(
                ([id, equipment]) => (
                  <option key={id} value={id}>
                    {equipment.label}
                  </option>
                ),
              )}
            </select>
          </label>
        ))}
        <p className="muted">
          {vr.status ||
            (supported
              ? "Bind a hand and arm its interface, then select Immersive VR. Hold grip to move, release to stop."
              : "Immersive VR is unavailable in this browser.")}
        </p>
        <div className="control-actions">
          <ImmersiveVrButton />
        </div>
      </CollapsibleSection>
    </section>
  );
}
