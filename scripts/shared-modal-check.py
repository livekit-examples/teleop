#!/usr/bin/env python3
"""Deploy an isolated shared-sim test, run two browsers, then remove its resources."""
import argparse
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'robo-sims'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--livekit-env', type=Path, default=ROOT/'robo-sims/.env.local')
    parser.add_argument('--web-port', type=int, default=3305)
    args = parser.parse_args()
    import modal
    from sims.livekit_auth import read_env_file
    source = read_env_file(args.livekit_env)
    if not source.get('LIVEKIT_URL', '').startswith('wss://'):
        raise SystemExit('Use a reachable LiveKit Cloud profile for this test.')
    name = 'teleop-shared-check-'+uuid.uuid4().hex[:10]
    key = secrets.token_hex(32)
    os.environ.update(SIM_MODAL_APP=name, SIM_MODAL_SECRET=name, SIM_IMAGE_VERSION=name)
    environment = {k: source[k] for k in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')}
    environment.update(SIM_SUPERVISOR_KEY=key, SIM_LIVEKIT_ROOM_NAME=name,
        SIM_IDLE_TIMEOUT_SECONDS='45', SIM_CONTROL_TURN_SECONDS='15', SIM_MAX_RUNTIME_SECONDS='300',
        SIM_SESSION_FPS='12')
    directory = ROOT/'.demo-runs'/name
    directory.mkdir(mode=0o700, parents=True)
    from modal_app import app, api, coordinate
    deployed = False
    child = None
    modal.Secret.objects.create(name, environment)
    print('Temporary Modal app: '+name, flush=True)
    try:
        with modal.enable_output():
            app.deploy()
        deployed = True
        url = api.get_web_url()
        request = urllib.request.Request(url+'/health', headers={
            'Authorization':'Bearer '+key, 'X-Demo-Owner':'acceptance-owner-00000000'})
        with urllib.request.urlopen(request, timeout=90) as response:
            assert json.load(response)['shared']
        # Warm the coordinator before measuring browser-visible starts.
        coordinate.remote('simulations')
        base = 'http://127.0.0.1:'+str(args.web_port)
        web_env = {**os.environ, 'SIM_SUPERVISOR_URL':url, 'SIM_SUPERVISOR_KEY':key,
            'TELEOP_DEMO_DIST_DIR':'.next-demo-shared-cloud', 'TELEOP_PUBLIC_DEPLOYMENT':'1'}
        with (directory/'web.log').open('wb') as log:
            child = subprocess.Popen(['pnpm','exec','next','dev','--hostname','127.0.0.1',
                '--port',str(args.web_port)],cwd=ROOT/'web',env=web_env,
                stdout=log,stderr=log,start_new_session=True)
            deadline=time.monotonic()+90
            while True:
                try:
                    with urllib.request.urlopen(base+'/try',timeout=3): break
                except OSError:
                    if child.poll() is not None or time.monotonic()>=deadline:
                        raise RuntimeError('The test website did not start. Read '+str(directory/'web.log'))
                    time.sleep(.5)
            result = subprocess.run(['pnpm','exec','playwright','test','tests/browser/demo.spec.ts',
                '--output',str(directory/'browser-results')],
                cwd=ROOT/'web', env={**web_env,'PLAYWRIGHT_BASE_URL':base,'TELEOP_DEMO_E2E':'1'})
            (directory/'result.json').write_text(json.dumps(dict(app=name,url=url,exit_code=result.returncode),indent=2))
            if result.returncode:
                raise SystemExit(result.returncode)
    finally:
        if child:
            os.killpg(child.pid, signal.SIGTERM)
            try: child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        if deployed:
            try:
                coordinate.remote('admission', True)
                deadline=time.monotonic()+30
                while time.monotonic()<deadline:
                    response=coordinate.remote('simulations')
                    if not any(item['instance'] for item in response['result']): break
                    time.sleep(1)
            finally:
                app.stop()
                modal.Dict.objects.delete(name+'-sessions', allow_missing=True)
        modal.Secret.objects.delete(name, allow_missing=True)
        print('Temporary Modal resources removed: '+name, flush=True)


if __name__ == '__main__':
    main()
