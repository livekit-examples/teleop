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

#include "rover.h"

#include "rover_serial_bus.h"
#include "rover_topics.h"
#include "teleop_msgs.h"

#include <chrono>
#include <csignal>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <utility>

namespace {
/**
 * @brief Handles process termination signals by requesting rover shutdown.
 * @param Unused signal number delivered by the operating system.
 */
void signalHandler(int) { RoverApp::requestStop(); }
} // namespace

std::atomic<bool> RoverApp::g_running_{true};

RoverApp::RoverApp(const RoverConfig &config)
    : config_(config),
      serial_bus_(std::make_unique<RoverSerialBus>(config.serial_port)) {}

RoverApp::~RoverApp() { shutdown(); }

void RoverApp::requestStop() { g_running_.store(false); }

bool RoverApp::initCamera() {
  ArducamCamera::Config cam_cfg;
  cam_cfg.width = config_.video_width;
  cam_cfg.height = config_.video_height;
  camera_ = std::make_unique<ArducamCamera>(cam_cfg);
  if (!camera_->start()) {
    std::cerr << "[rover] Warning: continuing without camera\n";
    camera_.reset();
    return false;
  }
  return true;
}

void RoverApp::publishCameraTick() {
  if (!camera_) {
    return;
  }
  auto frame = camera_->poll();
  if (!frame.valid) {
    return;
  }
  livekit::VideoFrame vf(camera_->width(), camera_->height(),
                         livekit::VideoBufferType::RGBA,
                         std::move(frame.rgba));
  tracks_.arducam_source->captureFrame(vf, frame.timestamp_us);
}

bool RoverApp::connectAndPublishTracks() {
  livekit::initialize();

  room_ = std::make_unique<livekit::Room>();
  room_->setDelegate(this);

  livekit::RoomOptions options;
  options.auto_subscribe = true;
  options.dynacast = false;

  std::cout << "[rover] Connecting to " << config_.url << "\n";
  if (!room_->Connect(config_.url, config_.token, options)) {
    std::cerr << "[rover] Failed to connect to LiveKit\n";
    return false;
  }

  auto *local_participant = room_->localParticipant();
  const std::string imu_track = rover_topics::imuTrackName(config_.rover_id);
  const std::string arducam_track =
      rover_topics::arducamTrackName(config_.rover_id);

  auto imu_result = local_participant->publishDataTrack(imu_track);
  if (!imu_result) {
    std::cerr << "[rover] Failed to publish data track '" << imu_track
              << "'\n";
    return false;
  }
  tracks_.imu = std::move(imu_result).value();

  tracks_.arducam_source = std::make_shared<livekit::VideoSource>(
      config_.video_width, config_.video_height);
  local_participant->publishVideoTrack(
      arducam_track, tracks_.arducam_source, livekit::TrackSource::SOURCE_CAMERA);

  std::cout << "[rover] Published data track: " << imu_track << "\n";
  std::cout << "[rover] Published video track: " << arducam_track << "\n";

  return true;
}

bool RoverApp::registerAcquireControlRpc() {
  try {
    room_->localParticipant()->registerRpcMethod(
        rover_topics::kAcquireControlRpc,
        [this](const livekit::RpcInvocationData &data)
            -> std::optional<std::string> {
          return handleAcquireControlRpc(data);
        });
    rpc_registered_ = true;
    std::cout << "[rover] Registered RPC method '"
              << rover_topics::kAcquireControlRpc << "'\n";
    return true;
  } catch (const std::exception &e) {
    std::cerr << "[rover] Failed to register RPC '"
              << rover_topics::kAcquireControlRpc << "': " << e.what()
              << "\n";
    return false;
  }
}

std::optional<std::string>
RoverApp::handleAcquireControlRpc(const livekit::RpcInvocationData &data) {
  if (data.caller_identity.empty()) {
    std::cerr << "[rover] acquire_control called with empty caller identity\n";
    return std::nullopt;
  }

  // Empty payloads default to "acquire" so existing clients can omit a body.
  teleop_msgs::AcquireControlRequest request;
  if (!data.payload.empty()) {
    std::string error;
    if (!teleop_msgs::fromPayload(
            std::vector<std::uint8_t>(data.payload.begin(), data.payload.end()),
            &request, &error)) {
      std::cerr << "[rover] Invalid acquire_control payload from '"
                << data.caller_identity << "': " << error << "\n";
      throw std::runtime_error(
          "invalid acquire_control payload; expected acquire/release/unset boolean");
    }
  }

  if (!request.acquire) {
    std::string active_controller;
    {
      std::lock_guard<std::mutex> lock(controller_mutex_);
      active_controller = controller_identity_;
    }
    if (active_controller.empty()) {
      return std::optional<std::string>{"no controller is set"};
    }
    if (active_controller != data.caller_identity) {
      return std::optional<std::string>{"controller is currently " +
                                        active_controller};
    }
    clearController();
    return std::optional<std::string>{"control released by " +
                                      data.caller_identity};
  }

  {
    std::lock_guard<std::mutex> lock(controller_mutex_);
    if (!controller_identity_.empty()) {
      if (controller_identity_ == data.caller_identity) {
        return std::optional<std::string>{"already controller: " +
                                          data.caller_identity};
      }
      return std::optional<std::string>{"controller is currently " +
                                        controller_identity_};
    }
    controller_identity_ = data.caller_identity;
  }

  const std::string control_track =
      rover_topics::controlCmdTrackName(config_.rover_id);

  try {
    // Replace any stale subscription before binding the new active controller.
    if (control_cmd_callback_id_ != 0) {
      room_->removeOnDataFrameCallback(control_cmd_callback_id_);
      control_cmd_callback_id_ = 0;
    }
    control_cmd_callback_id_ = room_->addOnDataFrameCallback(
        data.caller_identity, control_track,
        [this](const std::vector<std::uint8_t> &payload,
               std::optional<std::uint64_t>) { onControlCmdPayload(payload); });
  } catch (const std::exception &e) {
    {
      std::lock_guard<std::mutex> lock(controller_mutex_);
      if (controller_identity_ == data.caller_identity) {
        controller_identity_.clear();
      }
    }
    std::cerr << "[rover] Failed subscribing controller '"
              << data.caller_identity << "' to '" << control_track
              << "': " << e.what() << "\n";
    throw std::runtime_error("failed to subscribe controller to control_cmd");
  }

  std::cout << "[rover] Controller acquired by '" << data.caller_identity
            << "' using track '" << control_track << "'\n";
  return std::optional<std::string>{"control acquired by " +
                                    data.caller_identity};
}

void RoverApp::clearController() {
  std::string previous_controller;
  {
    std::lock_guard<std::mutex> lock(controller_mutex_);
    if (controller_identity_.empty()) {
      return;
    }
    previous_controller = controller_identity_;
    controller_identity_.clear();
  }

  if (control_cmd_callback_id_ != 0) {
    room_->removeOnDataFrameCallback(control_cmd_callback_id_);
    control_cmd_callback_id_ = 0;
  }
  std::cout << "[rover] Controller '" << previous_controller << "' released\n";
}

void RoverApp::onParticipantDisconnected(
    livekit::Room & /*room*/,
    const livekit::ParticipantDisconnectedEvent &event) {
  if (event.participant == nullptr) {
    return;
  }
  const std::string &identity = event.participant->identity();
  bool was_controller = false;
  {
    std::lock_guard<std::mutex> lock(controller_mutex_);
    was_controller = (controller_identity_ == identity);
  }
  if (was_controller) {
    clearController();
    sendStopCommand();
    std::cout << "[rover] Controller '" << identity
              << "' disconnected — control released\n";
  }
}

void RoverApp::onControlCmdPayload(const std::vector<std::uint8_t> &payload) {
  teleop_msgs::ControlCmdMsg control_cmd;
  std::string error;
  if (!teleop_msgs::fromPayload(payload, &control_cmd, &error)) {
    std::cerr << "[rover] Invalid control_cmd payload: " << error << "\n";
    return;
  }

  {
    std::lock_guard<std::mutex> lock(last_control_cmd_mutex_);
    last_control_cmd_time_ = std::chrono::steady_clock::now();
  }

  std::cout << "[rover] Received control_cmd throttle_rps="
            << control_cmd.throttle_rps
            << " steering_rps=" << control_cmd.steering_rps << "\n";

  if (serial_bus_ != nullptr && serial_bus_->isOpen() &&
      !serial_bus_->sendControlCommand(control_cmd)) {
    std::cerr << "[rover] Failed forwarding control_cmd to serial bus\n";
  }
}

void RoverApp::sendStopCommand() {
  teleop_msgs::ControlCmdMsg stop_cmd{};
  if (serial_bus_ != nullptr && serial_bus_->isOpen() &&
      !serial_bus_->sendControlCommand(stop_cmd)) {
    std::cerr << "[rover] Failed sending watchdog stop command to serial bus\n";
  }
}

void RoverApp::checkControlWatchdog() {
  static constexpr auto kWatchdogTimeout = std::chrono::milliseconds(300);

  std::chrono::steady_clock::time_point last_time;
  {
    std::lock_guard<std::mutex> lock(last_control_cmd_mutex_);
    last_time = last_control_cmd_time_;
  }

  if (last_time == std::chrono::steady_clock::time_point{}) {
    return;
  }

  const auto elapsed = std::chrono::steady_clock::now() - last_time;
  if (elapsed > kWatchdogTimeout) {
    std::cerr << "[rover] Control watchdog timeout — sending stop command\n";
    sendStopCommand();

    // Reset the watchdog so we emit one stop until a fresh control packet arrives.
    std::lock_guard<std::mutex> lock(last_control_cmd_mutex_);
    last_control_cmd_time_ = {};
  }
}

int RoverApp::run() {
  std::signal(SIGINT, signalHandler);
  std::signal(SIGTERM, signalHandler);
  g_running_.store(true);

  if (serial_bus_ != nullptr) {
    if (serial_bus_->open()) {
      std::cout << "[rover] Connected to serial port " << config_.serial_port
                << " at 115200 baud\n";
    } else {
      std::cerr << "[rover] Warning: continuing without serial connection on "
                << config_.serial_port << "\n";
    }
  }

  initCamera();

  if (!connectAndPublishTracks()) {
    shutdown();
    return 1;
  }
  if (!registerAcquireControlRpc()) {
    shutdown();
    return 1;
  }

  std::cout << "[rover] Running. Press Ctrl-C to exit.\n";
  // Prime the timestamp so the first loop iteration sends an IMU query immediately.
  auto last_imu_query_time = std::chrono::steady_clock::now() -
                             std::chrono::milliseconds(config_.query_rate_ms);

  while (g_running_.load()) {
    const auto now = std::chrono::steady_clock::now();
    if (serial_bus_ != nullptr && serial_bus_->isOpen()) {
      const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
          now - last_imu_query_time);
      if (elapsed_ms.count() >= config_.query_rate_ms &&
          serial_bus_->sendIMUQuery()) {
        last_imu_query_time = now;
      }

      // Drain every complete IMU frame currently buffered before sleeping again.
      while (true) {
        auto imu_msg = serial_bus_->readSerialData();
        if (!imu_msg.has_value()) {
          break;
        }
        if (tracks_.imu != nullptr) {
          (void)tracks_.imu->tryPush(teleop_msgs::toPayload(*imu_msg));
          ++imu_publish_count_;
          if ((imu_publish_count_ % 30U) == 0U) {
            std::cout << "[rover] IMU #" << imu_publish_count_ << ": "
                      << teleop_msgs::toJson(*imu_msg).dump() << "\n";
          }
        }
      }
    }

    checkControlWatchdog();
    publishCameraTick();

    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }

  shutdown();
  return 0;
}

void RoverApp::shutdown() {
  if (shutdown_done_) {
    return;
  }
  shutdown_done_ = true;

  if (rpc_registered_ && room_) {
    try {
      room_->localParticipant()->unregisterRpcMethod(
          rover_topics::kAcquireControlRpc);
    } catch (const std::exception &e) {
      std::cerr << "[rover] RPC unregister skipped: " << e.what() << "\n";
    }
    rpc_registered_ = false;
  }

  try {
    clearController();
  } catch (const std::exception &e) {
    std::cerr << "[rover] Failed to clear controller callback: " << e.what()
              << "\n";
  }

  if (camera_) {
    camera_->stop();
    camera_.reset();
  }

  if (serial_bus_ != nullptr) {
    serial_bus_->close();
  }

  // Drop published track handles before the room shuts down underneath them.
  tracks_ = {};
  room_.reset();
  livekit::shutdown();
}
