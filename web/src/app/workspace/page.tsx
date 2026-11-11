import { WorkspaceApp } from '@/components/workspace/workspace-app';
import { redirect } from 'next/navigation';
import 'dockview-react/dist/styles/dockview.css';
import 'uplot/dist/uPlot.min.css';
import './workspace.css';

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const { session } = await searchParams;
  if (process.env.TELEOP_PUBLIC_DEPLOYMENT === '1' && (typeof session !== 'string' || !session))
    redirect('/try');
  return <WorkspaceApp />;
}
