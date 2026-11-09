#!/usr/bin/env python3
"""Run /try with local workers by default; use --modal for the deployed development API."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SIMS = ROOT / 'robo-sims'


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--modal', action='store_true', help='use deployed development session API')
    modes.add_argument('--remote', action='store_true',
                       help='run local workers against the LiveKit server in robo-sims/.env.local')
    modes.add_argument('--no-modal', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--port', type=int, help='website port (default: SIM_WEB_PORT or 3001)')
    return parser.parse_args(argv)


def read_env_file(path):
    values = {}
    for line in path.read_text().splitlines():
        key, sep, value = line.strip().partition('=')
        if sep and not key.startswith('#'):
            values[key.strip()] = value.strip().strip('\'"')
    return values


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def profile(args, environ, env_file=None):
    """Validate only the selected mode. Never read or rewrite a direct-room profile."""
    name = '--port' if args.port is not None else 'SIM_WEB_PORT'
    port = args.port if args.port is not None else int(environ.get('SIM_WEB_PORT', '3001'))
    if not 1 <= port <= 65535:
        raise ValueError(f'{name} must be between 1 and 65535.')
    if args.modal:
        base, key = environ.get('SIM_SUPERVISOR_URL', ''), environ.get('SIM_SUPERVISOR_KEY', '')
        parsed = urlparse(base)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Set SIM_SUPERVISOR_URL to the HTTPS development Modal API URL.')
        if parsed.hostname == 'modal.com' or parsed.hostname.endswith('.modal.com'):
            raise ValueError(
                'SIM_SUPERVISOR_URL is a Modal dashboard URL. Use the deployed api Function endpoint '
                '(https://...modal.run), shown in deployment output or the Function dashboard.')
        if len(key) < 32:
            raise ValueError('Set SIM_SUPERVISOR_KEY to the development API key (at least 32 characters).')
        return port, dict(SIM_SUPERVISOR_URL=base.rstrip('/'), SIM_SUPERVISOR_KEY=key), 'modal'
    provider = environ.get('SIM_DEMO_PROVIDER', 'native')
    if args.remote:
        try:
            remote = read_env_file(env_file or SIMS / '.env.local')
        except OSError:
            raise ValueError('Create robo-sims/.env.local with the LIVEKIT_* values first.')
        missing = [k for k in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET') if not remote.get(k)]
        if missing:
            raise ValueError('Set ' + ', '.join(missing) + ' in robo-sims/.env.local.')
        remote = {k: v for k, v in remote.items() if k.startswith('LIVEKIT_')}
        if provider not in ('native', 'docker'):
            raise ValueError('SIM_DEMO_PROVIDER must be native or docker.')
        return port, dict(remote, SIM_SUPERVISOR_URL=f'http://127.0.0.1:{free_port()}',
                          SIM_SUPERVISOR_KEY=secrets.token_hex(32)), provider
    if provider not in ('native', 'docker'):
        raise ValueError('SIM_DEMO_PROVIDER must be native or docker.')
    return port, dict(SIM_SUPERVISOR_URL='http://127.0.0.1:8001',
                     SIM_SUPERVISOR_KEY=secrets.token_hex(32)), provider


def main():
    args = arguments()
    try:
        port, values, provider = profile(args, os.environ)
    except ValueError as error:
        raise SystemExit(str(error))
    if not shutil.which('pnpm'):
        raise SystemExit('Install pnpm and run pnpm install in web/ first.')
    python = SIMS / '.venv/bin/python'
    if not args.modal:
        if not python.exists() or not (args.remote or shutil.which('livekit-server')):
            raise SystemExit('Install the local simulation prerequisites in docs/modal.md first.')
        if provider == 'docker' and not shutil.which('docker'):
            raise SystemExit('Install Docker or use SIM_DEMO_PROVIDER=native.')
    for number in ((port,) if args.modal else ((port,) if args.remote else (17880, 17881, 17882, 8001, port))):
        with socket.socket() as sock:
            try:
                sock.bind(('127.0.0.1', number))
            except PermissionError:
                raise SystemExit('Local socket access is denied. Run this launcher with network access.')
            except OSError:
                raise SystemExit(f'Port {number} is in use. Stop that service before starting the demo.')
    launcher = secrets.token_hex(16)
    mode = 'modal' if args.modal else ('remote-' if args.remote else 'local-') + provider
    directory = ROOT / '.demo-runs' / mode / launcher
    directory.mkdir(mode=0o700, parents=True)
    # Trial configuration never replaces the LIVEKIT_* direct-room variables.
    env = {**os.environ, **values, 'SIM_LAUNCHER_ID': launcher,
           'TELEOP_DEMO_DIST_DIR': '.next-demo-' + mode}
    children, logs = [], []
    web_started = False

    def stop_requested(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop_requested)

    def start(command, cwd, name, child_env=env):
        log = (directory / f'{name}.log').open('ab', buffering=0)
        logs.append(log)
        child = subprocess.Popen(command, cwd=cwd, env=child_env, start_new_session=True,
                                 stdout=log, stderr=log)
        children.append(child)

    def api(path, method='GET'):
        request = urllib.request.Request(values['SIM_SUPERVISOR_URL'] + path, method=method,
            headers={'Authorization': 'Bearer ' + values['SIM_SUPERVISOR_KEY'],
                     'X-Demo-Owner': launcher})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    print(f'Mode: {mode}\nSession service: {values["SIM_SUPERVISOR_URL"]}\n'
          f'Website: http://127.0.0.1:{port}/try\nLogs: {directory}\n', flush=True)
    try:
        if not args.modal:
            settings = dict(values) if args.remote else {
                **values, 'LIVEKIT_URL': 'ws://127.0.0.1:17880',
                'LIVEKIT_API_KEY': 'devkey', 'LIVEKIT_API_SECRET': 'secret'}
            path = directory / 'trial.env'
            path.write_text(''.join(f'{key}={value}\n' for key, value in settings.items()))
            path.chmod(0o600)
            # Fail before starting Next.js if assets or selected local dependencies are missing.
            checked = subprocess.run([str(python), '-m', 'sims.demo.check_image'], cwd=SIMS,
                                     capture_output=True, text=True)
            if checked.returncode:
                raise RuntimeError('Required simulation assets are missing. Run sims fetch-assets. ' + checked.stderr[-500:])
            if not args.remote:
                start(['livekit-server', '--dev', '--config', 'tests/livekit-dev.yaml'], SIMS, 'livekit')
            start([str(python), '-m', 'sims.demo.supervisor', '--env-file', str(path),
                   '--port', str(urlparse(values['SIM_SUPERVISOR_URL']).port),
                   '--directory', str(directory / 'sessions'), '--provider', provider,
                   '--image', os.environ.get('SIM_DEMO_IMAGE', 'teleop-simulation:local')], SIMS,
                  'supervisor', {**env, **settings})
        deadline = time.monotonic() + (90 if args.modal else 20)
        while True:
            try:
                api('/simulations')
                break
            except json.JSONDecodeError:
                raise SystemExit('The session service returned non-JSON data. Check that SIM_SUPERVISOR_URL is the api Function endpoint, not a dashboard page.')
            except OSError as error:
                if isinstance(error, urllib.error.HTTPError):
                    if error.code in (401, 403):
                        raise SystemExit(f'The session API refused access (HTTP {error.code}). Check SIM_SUPERVISOR_KEY against the deployed Modal secret and endpoint access settings.')
                    if error.code in (400, 404):
                        raise SystemExit(f'The session API returned HTTP {error.code} for /simulations. Set SIM_SUPERVISOR_URL to the deployed api Function endpoint, not the Modal dashboard URL.')
                if any(child.poll() is not None for child in children) or time.monotonic() > deadline:
                    raise RuntimeError(f'The {mode} session service is unavailable. Read {directory}.')
                time.sleep(.3)
        start(['pnpm', 'run', 'dev:web', '--hostname', '127.0.0.1', '--port', str(port)], ROOT / 'web', 'web')
        web_started = True
        print('Ready. Open the website above. Press Ctrl-C to stop this launcher.\n', flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(.5)
        raise RuntimeError(f'A service exited. Read {directory}.')
    except KeyboardInterrupt:
        pass
    except RuntimeError as error:
        raise SystemExit(str(error))
    finally:
        # Stop the website first so it cannot launch more sessions during cleanup.
        for child in reversed(children):
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    child.wait(timeout=12)
                except ProcessLookupError:
                    pass
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
        if args.modal and web_started:
            try:
                api(f'/launchers/{launcher}/sessions', 'DELETE')
            except OSError:
                print('Remote cleanup request failed. Worker deadlines and scheduled cleanup still apply.', flush=True)
        for log in logs:
            log.close()


if __name__ == '__main__':
    main()
