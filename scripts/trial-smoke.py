#!/usr/bin/env python3
"""Smoke-test the real session API, video, feedback, motion and expiry in either mode."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import sys
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'robo-sims'))
from sims.demo.rules import SUPPORTED


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--simulation', choices=SUPPORTED, action='append')
    parser.add_argument('--output', type=Path, default=Path('/tmp/teleop-trial-smoke.json'))
    args = parser.parse_args()
    base = os.environ['SIM_SUPERVISOR_URL'].rstrip('/')
    key = os.environ['SIM_SUPERVISOR_KEY']
    owner = secrets.token_hex(16)

    def request(path, method='GET', data=None):
        req = urllib.request.Request(base + '/' + path, method=method,
            data=json.dumps(data).encode() if data is not None else None,
            headers={'Authorization': 'Bearer ' + key, 'X-Demo-Owner': owner,
                     'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)

    async def probe(simulation):
        from livekit import rtc
        from sims.contract.rtc_schema import SchemaRoom, publish_json
        from sims.contract.schemas import TRAJECTORY_SCHEMA
        request_id = secrets.token_hex(16)
        run = await asyncio.to_thread(request, 'sessions', 'POST',
                                      dict(simulation_id=simulation, request_id=request_id))
        identifier = run['id']
        room = SchemaRoom()
        readers, states, frames = [], {}, {}
        async def until(predicate, seconds):
            end = time.monotonic() + seconds
            while not predicate():
                if time.monotonic() >= end:
                    raise TimeoutError(f'session={identifier} probe timed out')
                await asyncio.sleep(.1)
        @room.on('data_track_published')
        def data(track):
            async def read():
                stream = track.subscribe(buffer_size=1)
                try:
                    async for frame in stream: states[track.info.name] = json.loads(frame.payload)
                finally: await stream.aclose()
            readers.append(asyncio.create_task(read()))
        @room.on('track_subscribed')
        def subscribed(track, publication, participant):
            if track.kind != rtc.TrackKind.KIND_VIDEO: return
            async def read():
                stream = rtc.VideoStream(track)
                try:
                    async for _ in stream: frames[publication.name] = frames.get(publication.name,0)+1
                finally: await stream.aclose()
            readers.append(asyncio.create_task(read()))
        try:
            end = time.monotonic() + 120
            while run['state'] in ('queued', 'starting') and time.monotonic() < end:
                await asyncio.sleep(.5)
                run = await asyncio.to_thread(request, 'sessions/' + identifier)
            if run['state'] != 'ready': raise RuntimeError(f'session={identifier} {run}')
            credentials = await asyncio.to_thread(request, f'sessions/{identifier}/credentials', 'POST', {'mode':'control'})
            await room.connect(credentials['server_url'], credentials['token'])
            await room.local_participant.set_attributes({'lk.portal.role':'operator','lk.portal.version':'3'})
            async def rpc(method, payload=''):
                return await room.local_participant.perform_rpc(destination_identity=credentials['robot_identity'], method=method, payload=payload)
            discovery = json.loads(await rpc('get_robot_config'))
            assert discovery['default_video_rate_hz'] == run['fps'], 'Discovery FPS mismatch'
            interface = next(iter(discovery['control_interfaces'].values()))
            operation = next(op for op in interface['operations'].values() if op['profile']=='joints.trajectory.v1')
            feedback = operation['feedback_tracks'][0]
            await until(lambda: bool(frames) and feedback in states, 15)
            first = dict(frames); started = time.monotonic()
            name = interface['joint_names'][0]
            def position(): return states[feedback]['position'][states[feedback]['name'].index(name)]
            initial = position()
            await rpc('portal.set_active_operator', room.local_participant.identity)
            track = await publish_json(room.local_participant, operation['command']['track_name'], operation['command']['msg_type'], TRAJECTORY_SCHEMA)
            message = json.dumps({'joint_names':[name], 'points':[{'positions':[initial+.1], 'time_from_start':{'sec':2,'nanosec':0}}]}).encode()
            async def send():
                while True:
                    track.try_push(rtc.DataTrackFrame(payload=message)); await asyncio.sleep(.2)
            sender = asyncio.create_task(send())
            try: await until(lambda: position() > initial+.02, 8)
            finally:
                sender.cancel(); await asyncio.gather(sender, return_exceptions=True)
            moved = position()
            await asyncio.sleep(3)
            elapsed = time.monotonic()-started
            delivered = {camera: round((count-first.get(camera,0))/elapsed,2) for camera,count in frames.items()}
            # Expiry remains independent of this observer and the HTTP poller.
            await until(lambda: credentials['robot_identity'] not in room.remote_participants,
                        max(5,(run['expires_at']/1000-time.time())+15))
            end = time.monotonic()+90
            while time.monotonic()<end:
                run = await asyncio.to_thread(request, 'sessions/'+identifier)
                if run['state'] == 'expired': break
                await asyncio.sleep(1)
            assert run['state'] == 'expired', run
            result = dict(session_id=identifier, simulation=simulation, room_name=credentials['room_name'],
                          requested_fps=run['fps'], delivered_fps=delivered,
                          motion=dict(joint=name,before=initial,after=moved), state=run['state'])
            print(json.dumps(result),flush=True)
            return result
        finally:
            for reader in readers: reader.cancel()
            await asyncio.gather(*readers,return_exceptions=True)
            await room.disconnect()
            await asyncio.to_thread(request,f'sessions/{identifier}','DELETE')

    async def run():
        results=[]
        for simulation in args.simulation or SUPPORTED:
            results.append(await probe(simulation))
            args.output.write_text(json.dumps(results,indent=2)+'\n')
    asyncio.run(run())


if __name__ == '__main__':
    main()
