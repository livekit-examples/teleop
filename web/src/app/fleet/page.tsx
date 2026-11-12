import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FleetPortal } from '@/components/fleet/fleet-portal';
import './fleet.css';

export const metadata: Metadata = {
  title: 'Fleet · LiveKit',
  description: 'Every robot in the room: location, model, control and connection.',
};

export default function FleetPage() {
  // The portal joins the room with the same server credentials as the workspace.
  if (process.env.TELEOP_PUBLIC_DEPLOYMENT === '1') notFound();
  return <FleetPortal />;
}
