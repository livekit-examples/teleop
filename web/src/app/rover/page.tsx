"use client";

import { TokenSource } from "livekit-client";
import { SessionProvider, useSession } from "@livekit/components-react";

import { App } from "./page-client";

const TOKEN_SOURCE = TokenSource.literal({
  serverUrl: process.env.NEXT_PUBLIC_ROVER_LIVEKIT_URL as string,
  participantToken: process.env.NEXT_PUBLIC_ROVER_LIVEKIT_TOKEN as string,
});

export default function Home() {
  const session = useSession(TOKEN_SOURCE);

  return (
    <SessionProvider session={session}>
      <App />
    </SessionProvider>
  );
}
