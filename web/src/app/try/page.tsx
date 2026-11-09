import Link from 'next/link';
import { Simulations } from '@/components/demo/simulations';

export default function TryPage() {
  return (
    <main className="try-page">
      <nav className="demo-simulations">
        <Link href="/workspace">Open direct robot workspace</Link>
      </nav>
      <Simulations />
    </main>
  );
}
