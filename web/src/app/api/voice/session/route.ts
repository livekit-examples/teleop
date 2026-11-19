import { NextResponse } from 'next/server';
import { VoiceError, createVoiceSession, voiceEnabled } from '../../../../lib/voice/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

/** Lets the workspace decide whether to show the microphone at all. */
export async function GET() {
  return NextResponse.json({ enabled: voiceEnabled() }, { headers: noStore });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  try {
    return !!origin && new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

/** Start a private Hey ROS voice session for the robot named in the body. */
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: 'A same-origin request is required.' }, { status: 403 });
  let robot: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) throw new Error('too large');
    robot = JSON.parse(text).robot;
  } catch {
    return NextResponse.json({ error: 'Expected {"robot": "<identity>"}.' }, { status: 400 });
  }
  const caller = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  try {
    return NextResponse.json(await createVoiceSession(robot, caller), { headers: noStore });
  } catch (error) {
    if (error instanceof VoiceError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: noStore },
      );
    console.error('Voice session failed:', error);
    return NextResponse.json({ error: 'Could not start the voice session.' }, { status: 500 });
  }
}
