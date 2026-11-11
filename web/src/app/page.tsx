import { WorkspaceApp } from '@/components/workspace/workspace-app';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import 'dockview-react/dist/styles/dockview.css';
import 'uplot/dist/uPlot.min.css';
import './workspace/workspace.css';

export default async function Home() {
  await connection();
  if (process.env.TELEOP_PUBLIC_DEPLOYMENT === '1') redirect('/try');
  return <WorkspaceApp />;
}
