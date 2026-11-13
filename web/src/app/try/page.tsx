import Link from 'next/link';
import { connection } from 'next/server';
import { Simulations } from '@/components/demo/simulations';

export default async function TryPage() {
  await connection();
  return (
    <main className="try-page">
      {process.env.TELEOP_PUBLIC_DEPLOYMENT !== '1' && (
        <nav className="demo-simulations">
          <Link href="/workspace">Open direct robot workspace</Link>
        </nav>
      )}
      <Simulations publicDeployment={process.env.TELEOP_PUBLIC_DEPLOYMENT === '1'} />
    </main>
  );
}
