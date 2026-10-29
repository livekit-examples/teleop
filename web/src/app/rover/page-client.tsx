'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionContext, VideoTrack } from '@livekit/components-react';
import {
  BatteryMediumIcon,
  ChartLineIcon,
  HouseIcon,
  MaximizeIcon,
  MinimizeIcon,
  PowerIcon,
} from 'lucide-react';
import { StatusBar } from '@/components/status-bar';
import { Button } from '@/components/ui/button';
import { Joystick } from '@/components/rover/joystick';
import { BatteryInfo, HeadingRibbon, ImuPlot, PanTiltDial } from '@/components/rover/panels';
import {
  driveTopicFor,
  homePanTilt,
  MAX_PAN_TILT_RAD_PER_SEC,
  setHeadlights,
  useAcquireControl,
  useDriveTrack,
  usePanTiltTrack,
  useServiceCall,
} from '@/components/rover/commands';
import {
  useBattery,
  useHeadlightState,
  useImuHistory,
  useJointAngles,
  useOdomYaw,
  usePanTilt,
  useRobotTopics,
} from '@/components/rover/telemetry';
import {
  HeadlightsIcon,
  Labelled,
  useCameras,
  useGamepadActions,
  useRobotCommandSubscriptionPermission,
  useRobotMediaSubscription,
  useRobotParticipant,
} from '@/components/rover/hud';
import { useConnection } from '@/hooks/use-connection';
import { cn } from '@/lib/utils';

const ROVER_ID = process.env.NEXT_PUBLIC_ROVER_IDENTITY || '';

/** Rover topic and RPC names. Matches the livekit-actuate rover defaults. */
const ROVER_CONFIG = {
  commandTopic: 'cmd_vel',
  imuTopic: '/imu/data_raw',
  odomTopic: 'odom',
  batteryTopic: 'battery_state',
  panTopic: 'state.pan',
  tiltTopic: 'state.tilt',
  headlightTopic: '/headlights_state',
  headlightRpcMethod: 'ros2_service_call',
  acquireControlEnabled: true,
};

/**
 * The rover teleop HUD: the rover's cameras as the backdrop, the heading ribbon
 * on top, the joysticks and hardware buttons on the right, and the telemetry
 * panels above the status bar.
 */
export function App() {
  const router = useRouter();
  const session = useSessionContext();
  const connected = session.isConnected;
  const robot = useRobotParticipant(ROVER_ID);
  const robotName = robot.name ?? ROVER_ID;
  useRobotCommandSubscriptionPermission(ROVER_ID);
  useRobotMediaSubscription(ROVER_ID);

  const topics = useRobotTopics(ROVER_ID);
  const has = (topic: string) => topics.has(topic.replace(/^\//, ''));
  const hasImu = has(ROVER_CONFIG.imuTopic);
  const hasBattery = has(ROVER_CONFIG.batteryTopic);

  const yaw = useOdomYaw(ROVER_ID, ROVER_CONFIG.odomTopic);
  const { pan } = usePanTilt(ROVER_ID, ROVER_CONFIG.panTopic, ROVER_CONFIG.tiltTopic);
  const imuSamples = useImuHistory(ROVER_ID, ROVER_CONFIG.imuTopic);
  const { battery, payloadInvalid } = useBattery(ROVER_ID, ROVER_CONFIG.batteryTopic);
  const headlightsOn = useHeadlightState(ROVER_ID, ROVER_CONFIG.headlightTopic);
  const joints = useJointAngles(ROVER_ID);
  const hasPan = joints.pan !== null;
  const hasTilt = joints.tilt !== null;
  const hasPanTilt = hasPan || hasTilt;
  const panTiltAxes = useMemo(() => ({ pan: hasPan, tilt: hasTilt }), [hasPan, hasTilt]);

  const { mode, pending, locked, requestMode } = useAcquireControl(
    ROVER_ID,
    connected,
    ROVER_CONFIG.acquireControlEnabled,
  );
  const canOperate = connected && robot.online;
  const operating = mode === 'operate' && canOperate;

  // Hand the rover-side lock back if the rover or the room goes away.
  useEffect(() => {
    if (!canOperate && mode === 'operate') void requestMode('view');
  }, [canOperate, requestMode, mode]);

  const pushDrive = useDriveTrack(operating, driveTopicFor(robotName, ROVER_CONFIG.commandTopic));
  const pushPanTilt = usePanTiltTrack(
    operating && hasPanTilt,
    driveTopicFor(ROVER_ID, '/pan_tilt_velocity_cmd'),
    panTiltAxes,
  );
  const headlights = useServiceCall(ROVER_ID, ROVER_CONFIG.headlightRpcMethod, operating);
  const homing = useServiceCall(ROVER_ID, ROVER_CONFIG.headlightRpcMethod, operating && hasPanTilt);
  const toggleHeadlights = () => void headlights.call(...setHeadlights(!headlightsOn));
  const homeCamera = () => void homing.call(...homePanTilt());
  useGamepadActions({
    active: operating,
    onA: headlightsOn !== undefined && !headlights.pending ? toggleHeadlights : undefined,
    onRightStick: hasPanTilt && !homing.pending ? homeCamera : undefined,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panel, setPanel] = useState<'plot' | 'battery' | null>(null);
  useEffect(() => {
    setPanel((current) =>
      (current === 'plot' && !hasImu) || (current === 'battery' && !hasBattery) ? null : current,
    );
  }, [hasBattery, hasImu]);

  const { main, tiles, selectTile } = useCameras(ROVER_ID);

  // Registered last so its cleanup (session.end) runs after useAcquireControl's
  // release RPC and any data-track teardown — passive effect cleanups fire in
  // registration order, so disconnect must come last.
  useConnection();

  const togglePanel = (next: 'plot' | 'battery') =>
    setPanel((current) => (current === next ? null : next));

  const actions = [
    <Button
      key="disconnect-button"
      type="button"
      title="Disconnect"
      variant="outline"
      onClick={() => router.push('/')}
      className="rounded font-mono text-xs uppercase"
    >
      <PowerIcon className="text-foreground size-4" />
      Disconnect
    </Button>,
    <Button
      key="fullscreen-button"
      size="icon"
      type="button"
      variant="outline"
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Fill the viewport'}
      onClick={() => setIsFullscreen((f) => !f)}
      className="size-8 rounded"
    >
      {isFullscreen ? (
        <MinimizeIcon className="text-foreground size-5" />
      ) : (
        <MaximizeIcon className="text-foreground size-5" />
      )}
    </Button>,
    ...(hasImu
      ? [
          <Button
            key="imu-button"
            size="icon"
            type="button"
            variant="outline"
            title="Toggle IMU plot"
            aria-pressed={panel === 'plot'}
            onClick={() => togglePanel('plot')}
            className={cn('size-8 rounded', panel === 'plot' && 'bg-foreground/10')}
          >
            <ChartLineIcon className="text-foreground size-4" />
          </Button>,
        ]
      : []),
    ...(hasBattery
      ? [
          <Button
            key="battery-button"
            size="icon"
            type="button"
            variant="outline"
            title={payloadInvalid ? 'Battery payload is invalid' : 'Toggle battery info'}
            aria-pressed={panel === 'battery'}
            onClick={() => togglePanel('battery')}
            className={cn('size-8 rounded', panel === 'battery' && 'bg-foreground/10')}
          >
            {/* Red once a frame fails to decode — the panel would be stale. */}
            <BatteryMediumIcon
              className={cn('size-4', payloadInvalid ? 'text-destructive' : 'text-foreground')}
            />
          </Button>,
        ]
      : []),
  ];

  return (
    <div className="relative h-dvh overflow-hidden">
      {connected && (
        <>
          {/* Main camera */}
          <div className={isFullscreen ? 'absolute inset-0' : 'absolute inset-x-36 inset-y-16'}>
            {main ? (
              <VideoTrack
                key={main.publication.trackSid}
                trackRef={main}
                className={cn('h-full w-full object-contain', !isFullscreen && 'rounded border')}
              />
            ) : (
              <div className="grid h-full place-items-center">
                <div className="bg-background/60 text-muted-foreground rounded border px-4 py-3 font-mono text-xs uppercase">
                  {robot.online ? 'Waiting for camera' : `Waiting for ${ROVER_ID || 'rover'}`}
                </div>
              </div>
            )}
          </div>

          {/* Heading ribbon — only once this rover actually publishes a heading. */}
          {(yaw !== undefined || has(ROVER_CONFIG.panTopic)) && (
            <div className="absolute top-32 left-1/2 z-10 -translate-x-1/2">
              <HeadingRibbon
                value={yaw ?? pan}
                className={cn('w-[700px]', isFullscreen && 'bg-background/60 rounded-b-lg')}
              />
            </div>
          )}

          {/* Pan/tilt read-out */}
          {hasPanTilt && (
            <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
              <div className="text-right font-mono text-xs leading-4 whitespace-nowrap text-white tabular-nums">
                {joints.pan !== null && <div>pan: {joints.pan.toFixed(2)} deg</div>}
                {joints.tilt !== null && <div>tilt: {joints.tilt.toFixed(2)} deg</div>}
              </div>
              <PanTiltDial pan={joints.pan} tilt={joints.tilt} />
            </div>
          )}

          {/* Other cameras — click one to swap it into the backdrop. */}
          {tiles.length > 0 && (
            <div className="scrollbar-hide absolute bottom-16 left-4 z-20 flex max-w-[calc(100%-2rem)] gap-1 overflow-x-auto">
              {tiles.map((track, i) => (
                <button
                  key={track.publication.trackSid}
                  type="button"
                  title={`Select ${track.publication.trackName || `Camera ${i + 2}`}`}
                  onClick={() => selectTile(track.publication.trackSid)}
                  className="h-24 w-40 shrink-0 cursor-pointer overflow-hidden rounded-sm bg-black ring-2 ring-black"
                >
                  <VideoTrack
                    trackRef={track}
                    className="pointer-events-none h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Controls */}
          {operating && (
            <div className="absolute right-2 bottom-16 z-20 flex flex-col items-end gap-2">
              <div className="flex items-end gap-2">
                <Labelled label="ROVER">
                  <Joystick active onVelocities={pushDrive} className="bg-black" />
                </Labelled>
                {hasPanTilt && (
                  <Labelled label={hasPan && hasTilt ? 'PAN / TILT' : hasPan ? 'PAN' : 'TILT'}>
                    <Joystick
                      active
                      keyboard={false}
                      gamepadStick="right"
                      velocityGain={MAX_PAN_TILT_RAD_PER_SEC}
                      horizontal={hasPan}
                      vertical={hasTilt}
                      // Mounted pan/tilt hardware runs opposite the joystick convention.
                      onVelocities={(tilt, pan) => pushPanTilt(-pan, -tilt)}
                      className="bg-black"
                    />
                  </Labelled>
                )}
              </div>

              <div className="flex gap-2">
                {headlightsOn !== undefined && (
                  <Labelled label="HEADLIGHTS">
                    <button
                      type="button"
                      aria-label={`Turn headlights ${headlightsOn ? 'off' : 'on'}`}
                      aria-pressed={headlightsOn}
                      disabled={headlights.pending}
                      onClick={toggleHeadlights}
                      className={cn(
                        'size-16 rounded-lg border border-white/40',
                        headlightsOn ? 'bg-white text-black' : 'bg-black text-white',
                      )}
                    >
                      <HeadlightsIcon
                        className={cn('mx-auto size-8', headlights.pending && 'animate-pulse')}
                      />
                    </button>
                  </Labelled>
                )}
                {hasPanTilt && (
                  <Labelled label="HOME">
                    <button
                      type="button"
                      aria-label="Home the pan and tilt motors"
                      disabled={homing.pending}
                      onClick={homeCamera}
                      className="size-16 rounded-lg border border-white/40 bg-black text-white"
                    >
                      <HouseIcon
                        className={cn('mx-auto size-8', homing.pending && 'animate-pulse')}
                      />
                    </button>
                  </Labelled>
                )}
              </div>
            </div>
          )}

          {/* Telemetry panels share one slot above the status bar. */}
          {panel && (
            <div
              className={cn(
                'bg-surface text-foreground absolute bottom-14 left-1/2 z-20 -translate-x-1/2 rounded-lg border p-4 font-mono text-xs',
                panel === 'plot' ? 'w-140' : 'w-100',
              )}
            >
              {panel === 'plot' ? (
                <ImuPlot samples={imuSamples} />
              ) : (
                <BatteryInfo battery={battery} />
              )}
            </div>
          )}
        </>
      )}

      {/* Status bar */}
      <StatusBar
        mode={operating ? 'operate' : 'view'}
        actions={actions}
        robotIdentity={ROVER_ID}
        isRpcPending={pending}
        isOperatorModeLocked={locked}
        onModeRequest={requestMode}
      />
    </div>
  );
}
