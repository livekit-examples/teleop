/*
 * Copyright 2026 LiveKit
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef PAN_TILT_LIVEKIT_H
#define PAN_TILT_LIVEKIT_H

#include "l3g4200d_gyro.h"
#include "livekit_bridge/livekit_bridge.h"
#include "pan_tilt_controller.h"
#include "realsense_camera.h"

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>

/**
 * @brief Runtime configuration for the pan/tilt LiveKit participant.
 */
struct PtLiveKitConfig {
  std::string url;
  std::string token;
  std::string serial_port;
  int gyro_bus{7};
  std::uint8_t gyro_address{0x69};
  std::array<u8, PanTiltController::kMotorCount> motor_ids{1, 2};
  bool run_calibration_ofs{false};
  int publish_rate_hz{20};
  bool enable_realsense{true};
  RealsenseCamera::Config realsense_cfg;
  int depth_publish_rate_hz{10};
};

/**
 * @brief LiveKit participant that bridges a real pan/tilt robot + gyro.
 *
 * @details
 * This app owns:
 * - `livekit_bridge::LiveKitBridge` for room connection and data tracks
 * - `PanTiltController` for two SMS/STS motors (`0=pan`, `1=tilt`)
 * - `L3G4200D_GYRO` for gyroscope polling
 *
 * Published DataTracks:
 * - `state.gyro` with GYRO fields from `GYROData`
 * - `state.pan` from `PanTiltController::ServoState` index `0`
 * - `state.tilt` from `PanTiltController::ServoState` index `1`
 * - `camera.depth` raw 16-bit depth frames (when RealSense is enabled)
 *
 * Published VideoTracks:
 * - `camera.color` RGBA video from the RealSense (when enabled)
 * - `camera.depth_vis` grayscale depth visualization (when enabled)
 *
 * Incoming control DataTrack:
 * - `control_cmd` payload JSON:
 *   `{"pan_vel": <rad/s>, "tilt_vel": <rad/s>}`
 *
 * RPC method:
 * - `acquire_control` (spelling intentionally matches requested API)
 *   - Acquires control for caller identity when no controller is active
 *   - Rejects when another controller already owns control
 *   - Allows active controller to release/unset control
 *
 * Unit notes for called headers:
 * - `L3G4200D_GYRO`: gyro is in `deg/s`, integrated angle is in `deg`
 * - `PanTiltController::setVelocity`: expects `steps/s` in range `[-3400,
 * 3400]`
 * - `control_cmd`: velocities are `rad/s` and are converted internally to
 *   servo `steps/s` before commanding motors
 */
class PtLiveKitApp {
public:
  explicit PtLiveKitApp(const PtLiveKitConfig &config);
  ~PtLiveKitApp();

  PtLiveKitApp(const PtLiveKitApp &) = delete;
  PtLiveKitApp &operator=(const PtLiveKitApp &) = delete;

  /**
   * @brief Run until signal/shutdown, then clean up owned resources.
   * @return process exit code (0 on clean shutdown, non-zero on failure)
   */
  int run();
  static void requestStop();

private:
  struct PublishedTracks {
    std::shared_ptr<livekit_bridge::BridgeDataTrack> gyro_state;
    std::shared_ptr<livekit_bridge::BridgeDataTrack> pan_state;
    std::shared_ptr<livekit_bridge::BridgeDataTrack> tilt_state;
    std::shared_ptr<livekit_bridge::BridgeVideoTrack> camera_color;
    std::shared_ptr<livekit_bridge::BridgeDataTrack> camera_depth;
    std::shared_ptr<livekit_bridge::BridgeVideoTrack> camera_depth_vis;
  };

  bool initializeHardware();
  bool connectAndPublishTracks();
  bool registerAcquireControlRpc();
  void clearController();
  std::optional<std::string>
  handleAcquireControlRpc(const livekit::RpcInvocationData &data);
  void onControlCmdPayload(const std::vector<std::uint8_t> &payload);
  void publishStateTick();
  void publishCameraTick();
  void shutdown();

  static std::atomic<bool> g_running_;

  PtLiveKitConfig config_;
  livekit_bridge::LiveKitBridge bridge_;
  L3G4200D_GYRO gyro_;
  PanTiltController pan_tilt_;
  PublishedTracks tracks_;
  std::unique_ptr<RealsenseCamera> camera_;
  std::chrono::steady_clock::time_point last_depth_publish_;

  std::mutex controller_mutex_;
  std::string controller_identity_;
  bool rpc_registered_{false};
  bool shutdown_done_{false};
};

#endif // PAN_TILT_LIVEKIT_H
