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

#pragma once

#include "arducam_camera.h"
#include "livekit/livekit.h"
#include "rover_config.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

class RoverSerialBus;

/**
 * @brief Minimal rover-side LiveKit app that publishes telemetry and video.
 *
 * The app owns the LiveKit room connection, optional camera, and serial bus
 * used to bridge local rover hardware with remote teleoperation clients.
 */
class RoverApp : public livekit::RoomDelegate {
public:
  /**
   * @brief Creates the rover runtime using the provided configuration.
   * @param config LiveKit connection and hardware settings for this rover.
   */
  explicit RoverApp(const RoverConfig &config);
  /** @brief Shuts down the room, camera, and serial bus if they are active. */
  ~RoverApp();

  /** @brief Deleted because the app owns process-wide runtime resources. */
  RoverApp(const RoverApp &) = delete;
  /** @brief Deleted because the app owns process-wide runtime resources. */
  RoverApp &operator=(const RoverApp &) = delete;

  /**
   * @brief Runs the main rover event loop until shutdown is requested.
   * @return Process exit code for the rover app.
   */
  int run();
  /** @brief Requests the global rover loop to exit on the next iteration. */
  static void requestStop();

private:
  /** @brief Handles for tracks published by the rover participant. */
  struct PublishedTracks {
    std::shared_ptr<livekit::LocalDataTrack> imu; ///< IMU telemetry data track.
    std::shared_ptr<livekit::VideoSource>
        arducam_source; ///< Video source feeding the published camera track.
  };

  /**
   * @brief Starts the camera when available.
   * @return True when camera startup succeeds or video is not required.
   */
  bool initCamera();
  /** @brief Publishes the latest camera frame when one is available. */
  void publishCameraTick();
  /**
   * @brief Connects to LiveKit and publishes the rover's outbound tracks.
   * @return True when the room connection and track publication succeed.
   */
  bool connectAndPublishTracks();
  /**
   * @brief Registers the RPC used by operators to acquire exclusive control.
   * @return True when the RPC handler is registered successfully.
   */
  bool registerAcquireControlRpc();
  /**
   * @brief Handles one incoming acquire or release control RPC invocation.
   * @param data RPC payload and caller metadata from LiveKit.
   * @return Optional error text to send back to the caller, or no value on
   *         success.
   */
  std::optional<std::string>
  handleAcquireControlRpc(const livekit::RpcInvocationData &data);
  /** @brief Releases the active controller and unsubscribes from its track. */
  void clearController();
  /**
   * @brief Parses one incoming control command payload and forwards it to UART.
   * @param payload Encoded control command bytes received from LiveKit.
   */
  void onControlCmdPayload(const std::vector<std::uint8_t> &payload);
  /** @brief Sends a zero-velocity command to stop the rover immediately. */
  void sendStopCommand();
  /** @brief Stops the rover if control commands have timed out. */
  void checkControlWatchdog();
  /** @brief Performs one-time teardown of room, RPC, camera, and serial state. */
  void shutdown();

  // livekit::RoomDelegate overrides
  void onDataTrackPublished(
      livekit::Room &room,
      const livekit::DataTrackPublishedEvent &event) override;
  void onParticipantDisconnected(
      livekit::Room &room,
      const livekit::ParticipantDisconnectedEvent &event) override;

  static std::atomic<bool>
      g_running_; ///< Process-wide stop flag toggled by signal handlers.
  RoverConfig config_; ///< Startup configuration captured at construction time.
  std::unique_ptr<livekit::Room>
      room_; ///< Active LiveKit room connection for the rover participant.
  std::unique_ptr<RoverSerialBus>
      serial_bus_; ///< UART transport for IMU polling and motor control.
  std::unique_ptr<ArducamCamera>
      camera_; ///< Optional local camera used for the rover video track.
  PublishedTracks tracks_; ///< Handles for tracks published by this rover.
  std::mutex controller_mutex_; ///< Guards access to the active controller.
  std::string
      controller_identity_; ///< Identity of the operator holding control.
  std::mutex control_cmd_callback_mutex_; ///< Guards control callback id updates.
  livekit::DataFrameCallbackId
      control_cmd_callback_id_{0}; ///< Subscription id for control commands.
  bool rpc_registered_{false}; ///< True after the control RPC is registered.
  bool shutdown_done_{false}; ///< Ensures shutdown logic runs only once.
  std::uint64_t imu_publish_count_{0}; ///< Count of IMU samples published.
  std::mutex
      last_control_cmd_mutex_; ///< Guards access to the watchdog timestamp.
  std::chrono::steady_clock::time_point
      last_control_cmd_time_{}; ///< Time the most recent control command arrived.
};
