'use client';

import { useState } from 'react';
import { ScaleVertical } from '@/components/scale-vertical';
import { ScaleHorizontal } from '@/components/scale-horizontal';
import { StatusBar } from '@/components/status-bar';
import { Joystick } from '@/components/joystick';
import { useSessionContext, useTracks, VideoTrack } from '@livekit/components-react';
import { useAcquireControl } from '@/hooks/use-acquire-control';
import { useControlCmdTrack } from '@/hooks/use-control-cmd-track';
import { useGyro } from '@/hooks/use-gyro';
import { usePanTilt } from '@/hooks/use-pan-tilt';
import { useVideoFitContainer } from '@/hooks/use-video-fit-container';
import { ConnectionState, Track } from 'livekit-client';
import { Button } from '@/components/ui/button';
import { MinimizeIcon, MaximizeIcon, PowerIcon } from 'lucide-react';
import { motion, AnimatePresence, type Transition } from 'motion/react';
import { cn } from '@/lib/utils';

const ROBOT_IDENTITY = process.env.NEXT_PUBLIC_ROBOT_IDENTITY || '';

const ANIMATION_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

const ANIMATION_TRANSITION: Transition = {
  type: 'spring',
  duration: 0.2,
  bounce: 0.1,
};

export function App() {
  const session = useSessionContext();
  const gyro = useGyro(ROBOT_IDENTITY);
  const { pan, tilt } = usePanTilt(ROBOT_IDENTITY);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [mainVideoTrack] = useTracks([Track.Source.Camera]);
  const [depthVideoTrack] = useTracks([Track.Source.ScreenShare]);
  const [mainVideoEl, setMainVideoEl] = useState<HTMLVideoElement | null>(null);

  const { mode, isRpcPending, isOperatorModeLocked, handleModeRequest } = useAcquireControl({
    identity: ROBOT_IDENTITY,
    isConnected: session.isConnected,
  });

  const { pushControlCmd } = useControlCmdTrack(mode === 'operate' && session.isConnected);

  useVideoFitContainer(mainVideoEl, session.isConnected, isFullscreen);

  return (
    <div className="relative h-dvh">
      <AnimatePresence>
        {/* Connect button */}
        {!session.isConnected && (
          <motion.div
            key="connect-button"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
            className="absolute top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2"
          >
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => session.start()}
              className="h-10 gap-3 rounded-sm px-3 font-mono text-base font-light"
            >
              <PowerIcon size={24} className="text-foreground size-5" />
              <span className="opacity-75">
                {session.connectionState === ConnectionState.Connecting
                  ? 'Connecting… '
                  : 'Connect to '}{' '}
              </span>
              <span className="text-foreground mr-3 font-bold uppercase">{ROBOT_IDENTITY}</span>
            </Button>
          </motion.div>
        )}

        {/* Fullscreen video */}
        {session.isConnected && (
          <motion.div
            key="main-video-placeholder"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, scale: 0.9 },
              visible: { opacity: 1, scale: 1 },
            }}
            transition={ANIMATION_TRANSITION}
            className={cn(
              'absolute inset-x-36 top-12 bottom-36',
              isFullscreen ? 'inset-0' : 'inset-x-36 inset-y-16',
            )}
          >
            <div className="flex h-full w-full items-center justify-center">
              {mainVideoTrack ? (
                <VideoTrack
                  ref={setMainVideoEl}
                  trackRef={mainVideoTrack}
                  width={mainVideoTrack.publication.dimensions?.width}
                  height={mainVideoTrack.publication.dimensions?.height}
                  className="rounded border object-cover"
                />
              ) : null}
            </div>
          </motion.div>
        )}

        {/* Fullscreen button */}
        {session.isConnected && (
          <motion.div
            key="fullscreen-button"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
            className="absolute bottom-2 left-2 z-10"
          >
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={isFullscreen ? 'Minimize Fullscreen' : 'Maximize Fullscreen'}
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="size-10"
            >
              {isFullscreen ? (
                <MinimizeIcon size={24} className="text-foreground size-6" />
              ) : (
                <MaximizeIcon size={24} className="text-foreground size-6" />
              )}
            </Button>
          </motion.div>
        )}

        {/* Depth video */}
        {/* {session.isConnected && depthVideoTrack && (
          <motion.div
            key="depth-video-placeholder"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, scale: 0.9 },
              visible: { opacity: 1, scale: 1 },
            }}
            transition={ANIMATION_TRANSITION}
            className="absolute top-6 right-6 z-10 overflow-hidden rounded border"
          >
            <div className="bg-foreground">
              <VideoTrack trackRef={depthVideoTrack} className="h-[100px] mix-blend-multiply" />
            </div>
          </motion.div>
        )} */}

        {/* Vertical degree scale (pitch) */}
        {session.isConnected && (
          <motion.div
            key="scale-vertical"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, translateX: -10, translateY: '-50%' },
              visible: { opacity: 1, translateX: 0, translateY: '-50%' },
            }}
            transition={ANIMATION_TRANSITION}
            className="absolute top-1/2 left-0 z-10"
          >
            <ScaleVertical
              value={tilt}
              className={cn('h-[500px]', isFullscreen && 'bg-background/60 rounded-r-lg')}
            />
          </motion.div>
        )}

        {/* Horizontal degree scale (yaw)  */}
        {session.isConnected && (
          <motion.div
            key="scale-horizontal"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, translateY: -10, translateX: '-50%' },
              visible: { opacity: 1, translateY: 0, translateX: '-50%' },
            }}
            transition={ANIMATION_TRANSITION}
            className="absolute top-0 left-1/2 z-10"
          >
            <ScaleHorizontal
              value={pan}
              className={cn('w-[700px]', isFullscreen && 'bg-background/60 rounded-b-lg')}
            />
          </motion.div>
        )}

        {/* Joystick */}
        {session.isConnected && mode === 'operate' && (
          <motion.div
            key="joystick"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, x: 10 },
              visible: { opacity: 1, x: 0 },
            }}
            transition={ANIMATION_TRANSITION}
          >
            <Joystick
              mode={mode}
              onVelocities={pushControlCmd}
              className="absolute right-2 bottom-16 z-20 bg-black"
            />
          </motion.div>
        )}

        {/* Status bar */}
        <StatusBar
          key="status-bar"
          mode={mode}
          robotIdentity={ROBOT_IDENTITY}
          isRpcPending={isRpcPending}
          showDebugInfo={showDebugInfo}
          isOperatorModeLocked={isOperatorModeLocked}
          onModeRequest={handleModeRequest}
          onShowDebugInfoChange={setShowDebugInfo}
          className={cn(isFullscreen && 'bg-background/60')}
        />

        {/* Debug info */}
        {session.isConnected && showDebugInfo && (
          <motion.div
            key="debug-info"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={ANIMATION_VARIANTS}
            transition={ANIMATION_TRANSITION}
            className={cn(
              'bg-card text-foreground border-input absolute bottom-14 left-1/2 grid w-120 -translate-x-1/2 grid-cols-3 gap-8 rounded-lg border p-4 font-mono text-xs',
              isFullscreen && 'bg-background/60',
            )}
          >
            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              {/* Pan */}
              <div className="opacity-50">Pan</div>
              <div className="text-right">{pan}°</div>
              {/* Tilt */}
              <div className="opacity-50">Tilt</div>
              <div className="text-right">{tilt}°</div>
              {/* Gyroscope validity */}
              <div className="opacity-50">valid</div>
              <div className="text-right">
                {gyro.valid === undefined ? '—' : gyro.valid ? 'yes' : 'no'}
              </div>
            </div>

            <div className="grid grid-cols-[auto_1fr_20px] gap-x-2 gap-y-0.5">
              {/* Angular velocity */}
              <div className="opacity-50">ωz</div>
              <div className="text-right">
                {gyro.gyro_z_dps !== undefined ? gyro.gyro_z_dps.toFixed(2) : '—'}
              </div>
              <div>°/s</div>
              <div className="opacity-50">ωy</div>
              <div className="text-right">
                {gyro.gyro_y_dps !== undefined ? gyro.gyro_y_dps.toFixed(2) : '—'}
              </div>
              <div>°/s</div>
              <div className="opacity-50">ωx</div>
              <div className="text-right">
                {gyro.gyro_x_dps !== undefined ? gyro.gyro_x_dps.toFixed(2) : '—'}
              </div>
              <div>°/s</div>
            </div>

            <div className="grid grid-cols-[auto_1fr_20px] gap-x-2 gap-y-0.5">
              {/* Angular position */}
              <div className="opacity-50">θx</div>
              <div className="text-right">
                {gyro.angle_x_deg !== undefined ? gyro.angle_x_deg.toFixed(2) : '—'}
              </div>
              <div>°</div>
              <div className="opacity-50">θy</div>
              <div className="text-right">
                {gyro.angle_y_deg !== undefined ? gyro.angle_y_deg.toFixed(2) : '—'}
              </div>
              <div>°</div>
              <div className="opacity-50">θz</div>
              <div className="text-right">
                {gyro.angle_z_deg !== undefined ? gyro.angle_z_deg.toFixed(2) : '—'}
              </div>
              <div>°</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
