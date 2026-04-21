"use client";

import Link from "next/link";
import { PowerIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AnimatePresence } from "motion/react";
import { Dialog } from "@/components/dialog";

const armConfigured = Boolean(
  process.env.NEXT_PUBLIC_ROBOT_IDENTITY &&
  process.env.NEXT_PUBLIC_ROBOT_LIVEKIT_URL &&
  process.env.NEXT_PUBLIC_ROBOT_LIVEKIT_TOKEN,
);

const roverConfigured = Boolean(
  process.env.NEXT_PUBLIC_ROVER_IDENTITY &&
  process.env.NEXT_PUBLIC_ROVER_LIVEKIT_URL &&
  process.env.NEXT_PUBLIC_ROVER_LIVEKIT_TOKEN,
);

function EmptyState() {
  return (
    <Dialog className="flex max-w-md flex-col items-center gap-3 text-center p-8">
      <TriangleAlertIcon className="text-foreground size-12" />
      <h1 className="font-mono text-sm uppercase tracking-wide">
        No devices configured
      </h1>
      <p className="text-muted-foreground font-mono text-xs leading-relaxed">
        Define{" "}
        <code className="bg-card text-foreground rounded px-1 py-0.5">
          NEXT_PUBLIC_ROBOT_*
        </code>{" "}
        and/or{" "}
        <code className="bg-card text-foreground rounded px-1 py-0.5">
          NEXT_PUBLIC_ROVER_*
        </code>{" "}
        env vars in{" "}
        <code className="bg-card text-foreground rounded px-1 py-0.5">
          .env.local
        </code>{" "}
        and restart the dev server.
      </p>
    </Dialog>
  );
}

export default function Home() {
  return (
    <AnimatePresence>
      <div className="relative grid h-dvh place-items-center gap-4">
        {!armConfigured && !roverConfigured ? (
          <EmptyState />
        ) : (
          <Dialog className="w-sm p-8">
            <h1 className="text-2xl uppercase tracking-wide mb-4">
              TeleOp Web UI
            </h1>
            <p className="uppercase mb-2 text-sm text-muted-foreground">
              Connect to:
            </p>
            <div className="flex gap-2 justify-center">
              {armConfigured && (
                <Link href="/robot" className="grow">
                  <Button
                    size="lg"
                    variant="outline"
                    className="font-mono uppercase w-full"
                  >
                    <PowerIcon className="size-4 justify-self-start" />
                    <span className="grow text-left">Robot</span>
                  </Button>
                </Link>
              )}
              {roverConfigured && (
                <Link href="/rover" className="grow">
                  <Button
                    size="lg"
                    variant="outline"
                    className="font-mono uppercase w-full"
                  >
                    <PowerIcon className="size-4 justify-self-start" />
                    <span className="grow text-left">Rover</span>
                  </Button>
                </Link>
              )}
            </div>
          </Dialog>
        )}
      </div>
    </AnimatePresence>
  );
}
