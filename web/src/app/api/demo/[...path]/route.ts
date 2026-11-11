import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join('/');
  const allowed =
    (route === 'simulations' && request.method === 'GET') ||
    (/^simulations\/[a-z0-9-]+\/watch$/.test(route) && request.method === 'POST') ||
    (/^instances\/[a-f0-9]{32}$/.test(route) && request.method === 'GET') ||
    (/^instances\/[a-f0-9]{32}\/credentials$/.test(route) && request.method === 'POST') ||
    (route === 'credentials' && request.method === 'POST') ||
    (route === 'queue' && ['GET', 'POST'].includes(request.method)) ||
    (route === 'engagement' && request.method === 'POST');
  if (!allowed) return NextResponse.json({ error: 'Unknown simulation route.' }, { status: 404 });
  const key = process.env.SIM_SUPERVISOR_KEY;
  const base = process.env.SIM_SUPERVISOR_URL;
  if (!key || !base) {
    return NextResponse.json(
      route === 'simulations'
        ? { enabled: false, simulations: [] }
        : { error: 'Simulation trials are not configured.' },
      { status: route === 'simulations' ? 200 : 503 },
    );
  }
  const origin = request.headers.get('origin');
  let sameOrigin = false;
  try {
    sameOrigin =
      !!origin &&
      new URL(origin).host === request.headers.get('host') &&
      new URL(origin).protocol ===
        `${request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.slice(0, -1)}:`;
  } catch {
    /* Reject invalid origins. */
  }
  if (request.method !== 'GET' && !sameOrigin)
    return NextResponse.json({ error: 'A same-origin request is required.' }, { status: 403 });
  const jar = await cookies();
  const stored = jar.get('teleop_demo_visitor')?.value;
  const owner = stored && /^[a-f0-9]{32}$/.test(stored) ? stored : randomBytes(16).toString('hex');
  // Establish visitor identity before allowing a mutation or credential request.
  if (stored !== owner && request.method !== 'GET')
    return NextResponse.json(
      { error: 'Open the landing page before starting a simulation.' },
      { status: 401 },
    );
  let response: NextResponse;
  try {
    const body = request.method === 'POST' ? await request.text() : undefined;
    if (body && body.length > 8192)
      return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    const query = route === 'queue' ? new URL(request.url).search : '';
    const upstream = await fetch(`${base.replace(/\/$/, '')}/${route}${query}`, {
      method: request.method,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${key}`,
        'X-Demo-Owner': owner,
        'X-Sim-Proof': request.headers.get('X-Sim-Proof') ?? '',
        'Content-Type': 'application/json',
      },
    });
    if (upstream.ok) {
      const data = await upstream.json();
      if (route.endsWith('/watch') && request.method === 'POST')
        console.info(`session=${data.id} state=${data.state}`);
      response = NextResponse.json(
        route === 'simulations' ? { enabled: true, simulations: data } : data,
        { status: upstream.status },
      );
    } else {
      const sharedRoute =
        route === 'simulations' ||
        route === 'credentials' ||
        route === 'queue' ||
        route === 'engagement' ||
        route.endsWith('/watch');
      if (upstream.status === 404 && sharedRoute) {
        console.error(
          'Shared simulation API route missing. Deploy the shared Modal API and check SIM_SUPERVISOR_URL.',
          { route, status: upstream.status },
        );
        response = NextResponse.json(
          {
            error:
              'Shared simulations are not available on this deployment yet. Please try again later.',
            code: 'simulation_api_mismatch',
          },
          { status: 503 },
        );
      } else {
        const text = await upstream.text();
        let message = text;
        try {
          const data = JSON.parse(text);
          if (typeof data.error === 'string') message = data.error;
          else if (typeof data.detail === 'string') message = data.detail;
        } catch {
          /* The Modal service can return plain-text errors. */
        }
        response = NextResponse.json({ error: message }, { status: upstream.status });
      }
    }
  } catch {
    response = NextResponse.json(
      { error: 'The simulation service is unavailable. Retry with the same launch request.' },
      { status: 503 },
    );
  }
  response.headers.set('Cache-Control', 'no-store');
  if (stored !== owner)
    response.cookies.set('teleop_demo_visitor', owner, {
      httpOnly: true,
      sameSite: 'strict',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: 86400,
    });
  return response;
}
export { proxy as GET, proxy as POST, proxy as DELETE };
