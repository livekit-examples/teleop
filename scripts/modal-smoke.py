"""Run the Modal workbench smoke test. API secrets stay on the laptop."""
import argparse
import asyncio
from datetime import timedelta
import json
from pathlib import Path
import secrets
import sys
import time
import modal

ROOT = Path(__file__).resolve().parents[1]
SIMS = ROOT / 'robo-sims'
sys.path.insert(0, str(SIMS))
from sims.livekit_auth import read_env_file
from livekit import api, rtc
from sims.contract.rtc_schema import SchemaRoom, publish_json
from sims.contract.schemas import TRAJECTORY_SCHEMA

def positive_int(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError('must be a positive integer')
    return number

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fps', type=positive_int, default=12,
                    help='target frames per second for each camera (default: %(default)s)')
args = parser.parse_args()

RUN = 'modal-' + secrets.token_hex(5)
ROBOT = 'simulation-trossen-workbench-whack-' + RUN
DIRECTORY = SIMS / '.demo' / RUN
DIRECTORY.mkdir(mode=0o700)
settings = read_env_file(SIMS / '.env.local')
web = read_env_file(ROOT / 'web/.env.local')
for key in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_ROOM_NAME'):
    assert settings[key] == web[key], f'Simulator/web mismatch: {key}'

def token(identity):
    return (api.AccessToken(settings['LIVEKIT_API_KEY'], settings['LIVEKIT_API_SECRET'])
            .with_identity(identity).with_ttl(timedelta(minutes=10))
            .with_grants(api.VideoGrants(room_join=True, room=settings['LIVEKIT_ROOM_NAME'],
                can_publish=True, can_subscribe=True, can_publish_data=True,
                can_update_own_metadata=True)).to_jwt())

ENTRY = '''import logging, pathlib, runpy, sys, threading, time
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
p=pathlib.Path("/run/session"); p.mkdir(parents=True, exist_ok=True)
def events():
    last=""
    while True:
        try:
            now=(p/"event.json").read_text()
            if now != last: print("WORKER_EVENT", now, flush=True); last=now
        except FileNotFoundError: pass
        time.sleep(.2)
threading.Thread(target=events, daemon=True).start()
sys.argv=["worker", "--id", RUN_ID, "--simulation", "trossen-workbench-whack", "--directory", str(p), "--fps", FPS_VALUE]
try: runpy.run_module("sims.demo.worker", run_name="__main__")
finally:
    if (p/"event.json").exists(): print("FINAL_EVENT", (p/"event.json").read_text(), flush=True)
'''.replace('RUN_ID', repr(RUN)).replace('FPS_VALUE', repr(str(args.fps)))

image = (modal.Image.debian_slim(python_version='3.12')
    .apt_install('libegl1', 'libgl1', 'libopengl0', 'libglib2.0-0', 'libosmesa6')
    .pip_install_from_requirements(SIMS / 'requirements.txt')
    .run_commands("mkdir -p /usr/share/glvnd/egl_vendor.d && echo '{\"file_format_version\":\"1.0.0\",\"ICD\":{\"library_path\":\"libEGL_nvidia.so.0\"}}' > /usr/share/glvnd/egl_vendor.d/10_nvidia.json")
    .env({'MUJOCO_GL':'egl', 'PYOPENGL_PLATFORM':'egl', 'PYTHONUNBUFFERED':'1',
          'NVIDIA_DRIVER_CAPABILITIES':'all'})
    .workdir('/app')
    .add_local_dir(SIMS / 'sims', '/app/sims', ignore=['**/__pycache__/**'])
    .add_local_dir(SIMS / 'assets', '/app/assets'))

async def probe():
    room = SchemaRoom()
    states, frames, readers = {}, {}, []
    @room.on('data_track_published')
    def data(track):
        if track.publisher_identity != ROBOT: return
        async def read():
            stream=track.subscribe(buffer_size=1)
            try:
                async for frame in stream: states[track.info.name]=json.loads(frame.payload)
            finally: await stream.aclose()
        readers.append(asyncio.create_task(read()))
    @room.on('track_subscribed')
    def subscribed(track, publication, participant):
        if participant.identity != ROBOT or track.kind != rtc.TrackKind.KIND_VIDEO: return
        async def read():
            stream=rtc.VideoStream(track)
            try:
                async for event in stream:
                    count=frames.get(publication.name,{}).get('frames',0)
                    frames[publication.name]={'frames':count+1, 'width':event.frame.width,'height':event.frame.height}
            finally: await stream.aclose()
        readers.append(asyncio.create_task(read()))
    async def until(predicate, timeout=65):
        end=time.monotonic()+timeout
        while not predicate():
            if time.monotonic()>end: raise TimeoutError('Probe timed out')
            await asyncio.sleep(.1)
    async def rpc(method, payload=''):
        return await room.local_participant.perform_rpc(destination_identity=ROBOT,method=method,payload=payload)
    result={}
    try:
        await room.connect(settings['LIVEKIT_URL'], token('demo-op-'+RUN+'-smoke'))
        await room.local_participant.set_attributes({'lk.portal.role':'operator','lk.portal.version':'3'})
        await until(lambda: ROBOT in room.remote_participants)
        await until(lambda: room.remote_participants[ROBOT].attributes.get('lk.portal.role')=='robot')
        discovery=json.loads(await rpc('get_robot_config'))
        if discovery.get('default_video_rate_hz') != args.fps:
            raise RuntimeError('Worker discovery does not match the requested FPS')
        (DIRECTORY/'discovery.json').write_text(json.dumps(discovery,indent=2))
        interfaces=discovery['control_interfaces']
        await until(lambda:len(frames)==4 and len(states)>=2,30)
        print('PROBE discovery, four camera streams, and feedback received',flush=True)
        interface_id=next(iter(interfaces)); interface=interfaces[interface_id]
        operation=interface['operations']['joint_trajectory'] if 'joint_trajectory' in interface['operations'] else next(iter(interface['operations'].values()))
        feedback=operation['feedback_tracks'][0]
        await until(lambda:feedback in states,10)
        name=interface['joint_names'][0]
        def position():
            state=states[feedback]; return state['position'][state['name'].index(name)]
        initial=position()
        await rpc('portal.set_active_operator',room.local_participant.identity)
        command=await publish_json(room.local_participant,operation['command']['track_name'],operation['command']['msg_type'],TRAJECTORY_SCHEMA)
        message=json.dumps({'joint_names':[name],'points':[{'positions':[initial+.1], 'time_from_start':{'sec':2,'nanosec':0}}]}).encode()
        async def send():
            while True:
                command.try_push(rtc.DataTrackFrame(payload=message)); await asyncio.sleep(.2)
        sender=asyncio.create_task(send())
        try: await until(lambda:position()>initial+.02,10)
        finally:
            sender.cancel(); await asyncio.gather(sender,return_exceptions=True)
        result={'discovery':True,'cameras':frames,'feedback_tracks':list(states),'motion':{'joint':name,'before':initial,'after':position()}}
        await rpc('portal.set_active_operator','')
        print('PROBE simulated movement passed',json.dumps(result['motion']),flush=True)
        await until(lambda:ROBOT not in room.remote_participants,90)
        result['participant_disconnected']=True
        result['cameras']=frames
        print('PROBE participant disconnected at end of run',flush=True)
        return result
    finally:
        for reader in readers:reader.cancel()
        await asyncio.gather(*readers,return_exceptions=True)
        await room.disconnect()

async def main():
    print('RUN',RUN,'ROOM',settings['LIVEKIT_ROOM_NAME'],'ROBOT',ROBOT,'FPS',args.fps,flush=True)
    app=await modal.App.lookup.aio('teleop-workbench-smoke',create_if_missing=True)
    with modal.enable_output():
        sandbox=await modal.Sandbox.create.aio('python','-u','-c',ENTRY,app=app,image=image,
            gpu='L4',cpu=2,memory=4096,timeout=180,workdir='/app',
            secrets=[modal.Secret.from_dict({'LIVEKIT_URL':settings['LIVEKIT_URL'],'LIVEKIT_TOKEN':token(ROBOT)})])
    metadata={'run_id':RUN,'sandbox_id':sandbox.object_id,'app_id':app.app_id,'robot':ROBOT,
              'room':settings['LIVEKIT_ROOM_NAME'],'gpu':'L4','cpu':2,'memory_mib':4096,'fps':args.fps}
    (DIRECTORY/'modal.json').write_text(json.dumps(metadata,indent=2))
    print('SANDBOX',json.dumps(metadata),flush=True)
    async def logs(stream,name):
        with (DIRECTORY/name).open('w') as out:
            async for line in stream:
                out.write(line);out.flush();print(line,end='',flush=True)
    logging_tasks=[asyncio.create_task(logs(sandbox.stdout,'stdout.log')),asyncio.create_task(logs(sandbox.stderr,'stderr.log'))]
    try:
        result=await probe()
        await sandbox.wait.aio()
        result['sandbox_exit_code']=sandbox.returncode
        result['metadata']=metadata
        (DIRECTORY/'result.json').write_text(json.dumps(result,indent=2))
        print('RESULT',json.dumps(result),flush=True)
        if sandbox.returncode != 0:raise RuntimeError('Worker failed')
    finally:
        await sandbox.terminate.aio()
        await asyncio.gather(*logging_tasks,return_exceptions=True)
        print('ARTIFACTS',DIRECTORY,flush=True)

asyncio.run(main())
