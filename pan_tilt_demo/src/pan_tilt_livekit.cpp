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

#include "pan_tilt_livekit.h"
#include "pan_tilt_topics.h"

#include "livekit/lk_log.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdint>
#include <exception>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace {
constexpr int kPanIndex = 0;
constexpr int kTiltIndex = 1;
constexpr double kTwoPi = 6.28318530717958647692;
constexpr double kServoStepsPerRadian =
    static_cast<double>(PanTiltController::kTicksPerRevolution) / kTwoPi;
constexpr int kServoVelocityLimitStepsPerSec = 3400;

void signalHandler(int) { PtLiveKitApp::requestStop(); }

std::int16_t radPerSecToServoStepsPerSec(const double rad_per_sec) {
  const double unclamped_steps = rad_per_sec * kServoStepsPerRadian;
  const double clamped_steps = std::clamp(
      unclamped_steps, -static_cast<double>(kServoVelocityLimitStepsPerSec),
      static_cast<double>(kServoVelocityLimitStepsPerSec));
  return static_cast<std::int16_t>(std::lround(clamped_steps));
}

json buildServoStateJson(const PanTiltController::ServoState &state,
                         const char *name) {
  return json{
      {"servo", name},
      {"motor_id", state.motor_id},
      {"position_ticks", state.position_ticks},
      {"speed_steps_s", state.speed},
      {"load_pwm", state.load_pwm},
      {"voltage_01v", state.voltage_01v},
      {"temperature_celsius", state.temperature_celsius},
      {"moving", state.moving},
      {"current_milliamps", state.current_milliamps},
      {"valid", state.valid},
  };
}

json buildGyroStateJson(const GYROData &gyro) {
  return json{
      {"gyro_x_dps", gyro.gyro_x_dps},
      {"gyro_y_dps", gyro.gyro_y_dps},
      {"gyro_z_dps", gyro.gyro_z_dps},
      {"angle_x_deg", gyro.angle_x_deg},
      {"angle_y_deg", gyro.angle_y_deg},
      {"angle_z_deg", gyro.angle_z_deg},
      {"valid", gyro.valid},
  };
}
} // namespace

std::atomic<bool> PtLiveKitApp::g_running_{true};

PtLiveKitApp::PtLiveKitApp(const PtLiveKitConfig &config)
    : config_(config), gyro_(config.gyro_bus, config.gyro_address),
      pan_tilt_(config.serial_port, config.motor_ids) {}

PtLiveKitApp::~PtLiveKitApp() { shutdown(); }

void PtLiveKitApp::requestStop() { g_running_.store(false); }

bool PtLiveKitApp::initializeHardware() {
  LK_LOG_INFO(
      "[pan_tilt_livekit] Initializing pan/tilt on {} (pan-id={}, tilt-id={})",
      config_.serial_port, config_.motor_ids[0], config_.motor_ids[1]);
  if (!pan_tilt_.initialize(config_.run_calibration_ofs)) {
    LK_LOG_ERROR("[pan_tilt_livekit] PanTiltController initialize failed");
    return false;
  }
  if (!pan_tilt_.haltMotors()) {
    LK_LOG_ERROR("[pan_tilt_livekit] Failed to zero motor velocities at startup");
    return false;
  }

  LK_LOG_INFO("[pan_tilt_livekit] Initializing GYRO on bus={} addr={:#x}",
              config_.gyro_bus, config_.gyro_address);
  if (!gyro_.init()) {
    LK_LOG_ERROR("[pan_tilt_livekit] GYRO init failed");
    return false;
  }
  gyro_.start();
  return true;
}

bool PtLiveKitApp::connectAndPublishTracks() {
  livekit::RoomOptions options;
  options.auto_subscribe = true;
  options.dynacast = false;

  LK_LOG_INFO("[pan_tilt_livekit] Connecting to {}", config_.url);
  if (!bridge_.connect(config_.url, config_.token, options)) {
    LK_LOG_ERROR("[pan_tilt_livekit] Failed to connect to LiveKit");
    return false;
  }

  tracks_.gyro_state = bridge_.createDataTrack(pan_tilt_topics::kGyroStateTrack);
  tracks_.pan_state = bridge_.createDataTrack(pan_tilt_topics::kPanStateTrack);
  tracks_.tilt_state = bridge_.createDataTrack(pan_tilt_topics::kTiltStateTrack);
  LK_LOG_INFO("[pan_tilt_livekit] Published data tracks: {}, {}, {}",
              pan_tilt_topics::kGyroStateTrack, pan_tilt_topics::kPanStateTrack,
              pan_tilt_topics::kTiltStateTrack);
  return true;
}

bool PtLiveKitApp::registerAcquireControlRpc() {
  try {
    bridge_.registerRpcMethod(pan_tilt_topics::kAcquireControlRpc,
                              [this](const livekit::RpcInvocationData &data)
                                  -> std::optional<std::string> {
                                return handleAcquireControlRpc(data);
                              });
    rpc_registered_ = true;
    LK_LOG_INFO("[pan_tilt_livekit] Registered RPC method '{}'",
                pan_tilt_topics::kAcquireControlRpc);
    return true;
  } catch (const std::exception &e) {
    LK_LOG_ERROR("[pan_tilt_livekit] Failed to register RPC '{}': {}",
                 pan_tilt_topics::kAcquireControlRpc, e.what());
    return false;
  }
}

std::optional<std::string>
PtLiveKitApp::handleAcquireControlRpc(const livekit::RpcInvocationData &data) {
  bool release_requested = false;
  if (!data.payload.empty()) {
    try {
      const json request = json::parse(data.payload);
      if (request.contains("release")) {
        release_requested = request.at("release").get<bool>();
      } else if (request.contains("unset")) {
        release_requested = request.at("unset").get<bool>();
      } else if (request.contains("acquire")) {
        release_requested = !request.at("acquire").get<bool>();
      }
    } catch (const std::exception &e) {
      LK_LOG_WARN("[pan_tilt_livekit] Invalid acquire_control payload from '{}': {}",
                  data.caller_identity, e.what());
      throw std::runtime_error(
          "invalid acquire_control payload; expected JSON boolean field "
          "release/unset/acquire");
    }
  }

  std::string active_controller;
  {
    std::lock_guard<std::mutex> lock(controller_mutex_);
    active_controller = controller_identity_;
  }

  if (release_requested) {
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

  if (!active_controller.empty()) {
    if (active_controller == data.caller_identity) {
      return std::optional<std::string>{"already controller: " +
                                        data.caller_identity};
    }
    return std::optional<std::string>{"controller is currently " +
                                      active_controller};
  }

  {
    std::lock_guard<std::mutex> lock(controller_mutex_);
    controller_identity_ = data.caller_identity;
  }
  bridge_.setOnDataFrameCallback(
      data.caller_identity, pan_tilt_topics::kControlCmdTrack,
      [this](const std::vector<std::uint8_t> &payload,
             std::optional<std::uint64_t>) { onControlCmdPayload(payload); });
  LK_LOG_INFO("[pan_tilt_livekit] Controller acquired by '{}'", data.caller_identity);
  return std::optional<std::string>{"control acquired by " +
                                    data.caller_identity};
}

void PtLiveKitApp::clearController() {
  std::string previous_controller;
  {
    std::lock_guard<std::mutex> lock(controller_mutex_);
    if (controller_identity_.empty()) {
      return;
    }
    previous_controller = controller_identity_;
    controller_identity_.clear();
  }

  bridge_.clearOnDataFrameCallback(previous_controller,
                                   pan_tilt_topics::kControlCmdTrack);
  LK_LOG_INFO("[pan_tilt_livekit] Controller '{}' released", previous_controller);
}

void PtLiveKitApp::onControlCmdPayload(
    const std::vector<std::uint8_t> &payload) {
  try {
    const json cmd = json::parse(payload.begin(), payload.end());
    const double pan_vel_rad_s = cmd.value("pan_vel", 0.0);
    const double tilt_vel_rad_s = cmd.value("tilt_vel", 0.0);

    const std::int16_t pan_steps_s = radPerSecToServoStepsPerSec(pan_vel_rad_s);
    const std::int16_t tilt_steps_s =
        radPerSecToServoStepsPerSec(tilt_vel_rad_s);

    if (!pan_tilt_.setVelocity(kPanIndex, pan_steps_s)) {
      LK_LOG_ERROR(
          "[pan_tilt_livekit] Failed setting pan velocity (rad/s={}, steps/s={})",
          pan_vel_rad_s, pan_steps_s);
      return;
    }
    if (!pan_tilt_.setVelocity(kTiltIndex, tilt_steps_s)) {
      LK_LOG_ERROR(
          "[pan_tilt_livekit] Failed setting tilt velocity (rad/s={}, steps/s={})",
          tilt_vel_rad_s, tilt_steps_s);
      return;
    }

    LK_LOG_DEBUG("[pan_tilt_livekit] control_cmd pan={} rad/s tilt={} rad/s",
                 pan_vel_rad_s, tilt_vel_rad_s);
  } catch (const std::exception &e) {
    LK_LOG_WARN("[pan_tilt_livekit] Invalid control_cmd payload: {}", e.what());
  }
}

void PtLiveKitApp::publishStateTick() {
  const auto servo_states = pan_tilt_.pollState();
  const GYROData gyro_data = gyro_.getLastGYROVal();

  const json pan_json = buildServoStateJson(servo_states[kPanIndex], "pan");
  const json tilt_json = buildServoStateJson(servo_states[kTiltIndex], "tilt");
  const json gyro_json = buildGyroStateJson(gyro_data);

  const std::string pan_msg = pan_json.dump();
  const std::string tilt_msg = tilt_json.dump();
  const std::string gyro_msg = gyro_json.dump();

  tracks_.pan_state->pushFrame(
      std::vector<std::uint8_t>(pan_msg.begin(), pan_msg.end()));
  tracks_.tilt_state->pushFrame(
      std::vector<std::uint8_t>(tilt_msg.begin(), tilt_msg.end()));
  tracks_.gyro_state->pushFrame(
      std::vector<std::uint8_t>(gyro_msg.begin(), gyro_msg.end()));
}

int PtLiveKitApp::run() {
  std::signal(SIGINT, signalHandler);
  std::signal(SIGTERM, signalHandler);
  g_running_.store(true);

  if (!initializeHardware()) {
    shutdown();
    return 1;
  }
  if (!connectAndPublishTracks()) {
    shutdown();
    return 1;
  }
  if (!registerAcquireControlRpc()) {
    shutdown();
    return 1;
  }

  const auto publish_period =
      std::chrono::microseconds(1000000 / std::max(config_.publish_rate_hz, 1));
  auto next_tick = std::chrono::steady_clock::now();

  LK_LOG_INFO("[pan_tilt_livekit] Running publish loop at {} Hz",
              config_.publish_rate_hz);
  while (g_running_.load()) {
    next_tick += publish_period;
    publishStateTick();
    std::this_thread::sleep_until(next_tick);
  }

  shutdown();
  return 0;
}

void PtLiveKitApp::shutdown() {
  if (shutdown_done_) {
    return;
  }
  shutdown_done_ = true;

  if (rpc_registered_) {
    try {
      bridge_.unregisterRpcMethod(pan_tilt_topics::kAcquireControlRpc);
    } catch (const std::exception &e) {
      LK_LOG_WARN("[pan_tilt_livekit] RPC unregister skipped: {}", e.what());
    }
    rpc_registered_ = false;
  }

  try {
    clearController();
  } catch (const std::exception &e) {
    LK_LOG_WARN("[pan_tilt_livekit] Failed to clear controller callback: {}",
                e.what());
  }

  if (!pan_tilt_.haltMotors()) {
    LK_LOG_WARN("[pan_tilt_livekit] Failed to halt motors during shutdown");
  }
  gyro_.stop();
  bridge_.disconnect();
}
