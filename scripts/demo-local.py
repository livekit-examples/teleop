#!/usr/bin/env python3
"""Run the private local simulation experience around the existing teleop app."""
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SIMS = ROOT / 'robo-sims'


def main():
    python = SIMS / '.venv/bin/python'
    if not python.exists() or not shutil.which('livekit-server') or not shutil.which('pnpm'):
        raise SystemExit('Install the prerequisites in docs/modal.md first.')
    port = int(os.environ.get('SIM_WEB_PORT', '3001'))
    for number in (17880, 17881, 17882, 8001, port):
        with socket.socket() as sock:
            try:
                sock.bind(('127.0.0.1', number))
            except OSError:
                raise SystemExit(f'Port {number} is in use. Stop that service before starting the demo.')
    provider = os.environ.get('SIM_DEMO_PROVIDER', 'native')
    if provider not in ('native', 'docker'):
        raise SystemExit('SIM_DEMO_PROVIDER must be native or docker.')
    directory = SIMS / ('.demo-docker' if provider == 'docker' else '.demo')
    directory.mkdir(mode=0o700, exist_ok=True)
    key = secrets.token_hex(32)
    values = dict(LIVEKIT_URL='ws://127.0.0.1:17880', LIVEKIT_API_KEY='devkey', LIVEKIT_API_SECRET='secret',
                  LIVEKIT_ROOM_NAME='teleop-demo', SIM_SUPERVISOR_KEY=key, SIM_SUPERVISOR_URL='http://127.0.0.1:8001')
    profile = directory / 'local.env'
    profile.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
    profile.chmod(0o600)
    env = {**os.environ, **values, 'TELEOP_DEMO_DIST_DIR': '.next-demo'}
    children = []
    def stop_requested(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop_requested)
    def start(command, cwd):
        child = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
        children.append(child)
    try:
        start(['livekit-server', '--dev', '--config', 'tests/livekit-dev.yaml'], SIMS)
        start([str(python), '-m', 'sims.demo.supervisor', '--env-file', str(profile),
               '--directory', str(directory), '--provider', provider,
               '--image', os.environ.get('SIM_DEMO_IMAGE', 'teleop-simulation:local')], SIMS)
        deadline = time.monotonic() + 15
        while True:
            try:
                request = urllib.request.Request(values['SIM_SUPERVISOR_URL'] + '/simulations', headers={
                    'Authorization': f'Bearer {key}', 'X-Demo-Owner': 'local-startup-probe'})
                with urllib.request.urlopen(request, timeout=1):
                    break
            except OSError:
                if any(c.poll() is not None for c in children) or time.monotonic() > deadline:
                    raise RuntimeError('The simulation service did not start.')
                time.sleep(0.2)
        start(['pnpm', 'run', 'dev', '--hostname', '127.0.0.1', '--port', str(port)], ROOT / 'web')
        print(f'\nLocal demo: http://127.0.0.1:{port}\nPress Ctrl-C to stop all local services.\n', flush=True)
        while all(c.poll() is None for c in children):
            time.sleep(0.5)
        raise RuntimeError('A local demo service exited. Read its output above.')
    except KeyboardInterrupt:
        pass
    finally:
        # Stop the web app, then the supervisor while LiveKit can still clean rooms.
        for child in reversed(children):
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    continue
                try:
                    child.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()


if __name__ == '__main__':
    main()
