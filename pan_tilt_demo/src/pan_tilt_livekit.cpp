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
#include "livekit/track.h"

#include <nlohmann/json.hpp>
#include <zlib.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <csignal>
#include <cstdint>
#include <fstream>
#include <limits>
#include <exception>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace {
constexpr int kPanIndex = 0;
constexpr int kTiltIndex = 1;
constexpr int kPublishGyroStateIdx = 0;
constexpr int kPublishPanStateIdx = 1;
constexpr int kPublishTiltStateIdx = 2;
constexpr int kPublishCameraColorIdx = 3;
constexpr int kPublishCameraDepthIdx = 4;
constexpr int kPublishCameraDepthVisIdx = 5;

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

bool readProcSelfMemoryKb(long long *vm_rss_kb, long long *vm_size_kb) {
  if (vm_rss_kb == nullptr || vm_size_kb == nullptr) {
    return false;
  }
  *vm_rss_kb = -1;
  *vm_size_kb = -1;
  std::ifstream f("/proc/self/status");
  if (!f) {
    return false;
  }
  std::string line;
  while (std::getline(f, line)) {
    if (line.rfind("VmRSS:", 0) == 0) {
      if (std::sscanf(line.c_str(), "VmRSS: %lld", vm_rss_kb) != 1) {
        *vm_rss_kb = -1;
      }
    } else if (line.rfind("VmSize:", 0) == 0) {
      if (std::sscanf(line.c_str(), "VmSize: %lld", vm_size_kb) != 1) {
        *vm_size_kb = -1;
      }
    }
    if (*vm_rss_kb >= 0 && *vm_size_kb >= 0) {
      return true;
    }
  }
  return *vm_rss_kb >= 0 && *vm_size_kb >= 0;
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

  if (config_.enable_realsense) {
    camera_ = std::make_unique<RealsenseCamera>(config_.realsense_cfg);
    if (!camera_->start()) {
      LK_LOG_ERROR("[pan_tilt_livekit] RealSense camera failed to start");
      return false;
    }
  }

  return true;
}

bool PtLiveKitApp::connectAndPublishTracks() {
  livekit::initialize();

  room_ = std::make_unique<livekit::Room>();

  livekit::RoomOptions options;
  options.auto_subscribe = true;
  options.dynacast = false;

  LK_LOG_INFO("[pan_tilt_livekit] Connecting to {}", config_.url);
  if (!room_->Connect(config_.url, config_.token, options)) {
    LK_LOG_ERROR("[pan_tilt_livekit] Failed to connect to LiveKit");
    return false;
  }

  auto *lp = room_->localParticipant();

  auto gyro_result = lp->publishDataTrack(pan_tilt_topics::kGyroStateTrack);
  if (!gyro_result) {
    LK_LOG_ERROR("[pan_tilt_livekit] Failed to publish data track '{}'",
                 pan_tilt_topics::kGyroStateTrack);
    return false;
  }
  tracks_.gyro_state = std::move(gyro_result).value();

  auto pan_result = lp->publishDataTrack(pan_tilt_topics::kPanStateTrack);
  if (!pan_result) {
    LK_LOG_ERROR("[pan_tilt_livekit] Failed to publish data track '{}'",
                 pan_tilt_topics::kPanStateTrack);
    return false;
  }
  tracks_.pan_state = std::move(pan_result).value();

  auto tilt_result = lp->publishDataTrack(pan_tilt_topics::kTiltStateTrack);
  if (!tilt_result) {
    LK_LOG_ERROR("[pan_tilt_livekit] Failed to publish data track '{}'",
                 pan_tilt_topics::kTiltStateTrack);
    return false;
  }
  tracks_.tilt_state = std::move(tilt_result).value();

  LK_LOG_INFO("[pan_tilt_livekit] Published data tracks: {}, {}, {}",
              pan_tilt_topics::kGyroStateTrack, pan_tilt_topics::kPanStateTrack,
              pan_tilt_topics::kTiltStateTrack);

  if (camera_) {
    tracks_.camera_color_source = std::make_shared<livekit::VideoSource>(
        camera_->width(), camera_->height());
    lp->publishVideoTrack(pan_tilt_topics::kCameraColorTrack,
                          tracks_.camera_color_source,
                          livekit::TrackSource::SOURCE_CAMERA);

    auto depth_result =
        lp->publishDataTrack(pan_tilt_topics::kCameraDepthTrack);
    if (!depth_result) {
      LK_LOG_ERROR("[pan_tilt_livekit] Failed to publish data track '{}'",
                   pan_tilt_topics::kCameraDepthTrack);
      return false;
    }
    tracks_.camera_depth = std::move(depth_result).value();

    tracks_.camera_depth_vis_source = std::make_shared<livekit::VideoSource>(
        camera_->width(), camera_->height());
    lp->publishVideoTrack(pan_tilt_topics::kCameraDepthVisTrack,
                          tracks_.camera_depth_vis_source,
                          livekit::TrackSource::SOURCE_SCREENSHARE);

    LK_LOG_INFO(
        "[pan_tilt_livekit] Published camera tracks: {} (video), {} (data), {} (video)",
        pan_tilt_topics::kCameraColorTrack, pan_tilt_topics::kCameraDepthTrack,
        pan_tilt_topics::kCameraDepthVisTrack);
  }

  return true;
}

bool PtLiveKitApp::registerAcquireControlRpc() {
  try {
    room_->localParticipant()->registerRpcMethod(
        pan_tilt_topics::kAcquireControlRpc,
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
  if (data.caller_identity.empty()) {
    LK_LOG_ERROR("[pan_tilt_livekit] acquire_control called with empty caller identity");
    return std::nullopt;
  }

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

  if (release_requested) {
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

  try {
    if (control_cmd_callback_id_ != 0) {
      room_->removeOnDataFrameCallback(control_cmd_callback_id_);
      control_cmd_callback_id_ = 0;
    }
    control_cmd_callback_id_ = room_->addOnDataFrameCallback(
        data.caller_identity, pan_tilt_topics::kControlCmdTrack,
        [this](const std::vector<std::uint8_t> &payload,
               std::optional<std::uint64_t>) { onControlCmdPayload(payload); });
  } catch (const std::exception &e) {
    {
      std::lock_guard<std::mutex> lock(controller_mutex_);
      if (controller_identity_ == data.caller_identity) {
        controller_identity_.clear();
      }
    }
    LK_LOG_ERROR(
        "[pan_tilt_livekit] Failed subscribing controller '{}' to '{}': {}",
        data.caller_identity, pan_tilt_topics::kControlCmdTrack, e.what());
    throw std::runtime_error("failed to subscribe controller to control_cmd");
  }

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

  if (control_cmd_callback_id_ != 0) {
    room_->removeOnDataFrameCallback(control_cmd_callback_id_);
    control_cmd_callback_id_ = 0;
  }
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

  (void)tracks_.pan_state->tryPush(
      std::vector<std::uint8_t>(pan_msg.begin(), pan_msg.end()));
  publish_counts_[static_cast<std::size_t>(kPublishPanStateIdx)]
      .fetch_add(1, std::memory_order_relaxed);
  (void)tracks_.tilt_state->tryPush(
      std::vector<std::uint8_t>(tilt_msg.begin(), tilt_msg.end()));
  publish_counts_[static_cast<std::size_t>(kPublishTiltStateIdx)]
      .fetch_add(1, std::memory_order_relaxed);
  (void)tracks_.gyro_state->tryPush(
      std::vector<std::uint8_t>(gyro_msg.begin(), gyro_msg.end()));
  publish_counts_[static_cast<std::size_t>(kPublishGyroStateIdx)]
      .fetch_add(1, std::memory_order_relaxed);
}

void PtLiveKitApp::processDepthSendJob(const DepthSendJob &job) {
  if (!tracks_.camera_depth) {
    return;
  }

  using pan_tilt_topics::depth_payload::kCompressedHeaderBytes;
  using pan_tilt_topics::depth_payload::kMagicCompressed;
  using pan_tilt_topics::depth_payload::kRawHeaderBytes;

  const std::uint32_t w = static_cast<std::uint32_t>(job.depth_width);
  const std::uint32_t h = static_cast<std::uint32_t>(job.depth_height);
  const std::uint64_t ts = static_cast<std::uint64_t>(job.timestamp_us);
  const std::size_t raw_size = job.depth_raw.size();

  uLongf comp_len = compressBound(static_cast<uLong>(raw_size));
  std::vector<std::uint8_t> zlib_buf(comp_len);
  const int zr = compress2(
      zlib_buf.data(), &comp_len,
      reinterpret_cast<const Bytef *>(job.depth_raw.data()),
      static_cast<uLong>(raw_size), Z_BEST_SPEED);

  const std::size_t raw_wire = kRawHeaderBytes + raw_size;
  const std::size_t compressed_wire = kCompressedHeaderBytes + comp_len;
  const bool use_compressed =
      (zr == Z_OK && compressed_wire < raw_wire && comp_len > 0);

  std::vector<std::uint8_t> payload;
  if (use_compressed) {
    payload.resize(compressed_wire);
    std::memcpy(payload.data(), &kMagicCompressed, sizeof(kMagicCompressed));
    std::memcpy(payload.data() + 4, &w, sizeof(w));
    std::memcpy(payload.data() + 8, &h, sizeof(h));
    std::memcpy(payload.data() + 12, &ts, sizeof(ts));
    const std::uint32_t unc_u32 = static_cast<std::uint32_t>(raw_size);
    std::memcpy(payload.data() + 20, &unc_u32, sizeof(unc_u32));
    std::memcpy(payload.data() + kCompressedHeaderBytes, zlib_buf.data(),
                comp_len);
  } else {
    if (zr != Z_OK) {
      LK_LOG_WARN("[pan_tilt_livekit] zlib compress2 failed ({}), sending raw",
                  zr);
    }
    payload.resize(raw_wire);
    std::memcpy(payload.data(), &w, sizeof(w));
    std::memcpy(payload.data() + 4, &h, sizeof(h));
    std::memcpy(payload.data() + 8, &ts, sizeof(ts));
    std::memcpy(payload.data() + kRawHeaderBytes, job.depth_raw.data(),
                raw_size);
  }

  (void)tracks_.camera_depth->tryPush(
      std::move(payload), static_cast<std::uint64_t>(job.timestamp_us));
  publish_counts_[static_cast<std::size_t>(kPublishCameraDepthIdx)]
      .fetch_add(1, std::memory_order_relaxed);
}

void PtLiveKitApp::depthWorkerLoop() {
  while (true) {
    std::optional<DepthSendJob> job;
    {
      std::unique_lock<std::mutex> lock(depth_mutex_);
      depth_cv_.wait(lock, [this] {
        return depth_worker_stop_.load() || depth_pending_.has_value();
      });
      if (depth_worker_stop_.load()) {
        break;
      }
      job = std::move(depth_pending_);
      depth_pending_.reset();
    }
    if (job.has_value()) {
      processDepthSendJob(*job);
    }
  }
}

void PtLiveKitApp::startDepthWorker() {
  if (!tracks_.camera_depth) {
    return;
  }
  depth_worker_stop_.store(false);
  depth_worker_thread_ = std::thread(&PtLiveKitApp::depthWorkerLoop, this);
  LK_LOG_INFO("[pan_tilt_livekit] camera.depth send worker started");
}

void PtLiveKitApp::stopDepthWorker() {
  if (!depth_worker_thread_.joinable()) {
    return;
  }
  depth_worker_stop_.store(true);
  depth_cv_.notify_all();
  depth_worker_thread_.join();
  LK_LOG_INFO("[pan_tilt_livekit] camera.depth send worker stopped");
}

void PtLiveKitApp::publishCameraTick() {
  if (!camera_) {
    return;
  }

  auto frame = camera_->poll();
  if (!frame.valid) {
    return;
  }

  if (tracks_.camera_color_source) {
    livekit::VideoFrame vf(camera_->width(), camera_->height(),
                           livekit::VideoBufferType::RGBA,
                           std::move(frame.rgba));
    tracks_.camera_color_source->captureFrame(vf, frame.timestamp_us);
    publish_counts_[static_cast<std::size_t>(kPublishCameraColorIdx)]
        .fetch_add(1, std::memory_order_relaxed);
  }

  if (tracks_.camera_depth_vis_source) {
    const int dw = frame.depth_width;
    const int dh = frame.depth_height;
    const auto pixel_count = static_cast<std::size_t>(dw) * dh;
    const auto *z16 =
        reinterpret_cast<const std::uint16_t *>(frame.depth_raw.data());

    // Find the actual min/max of valid depth values for adaptive scaling.
    std::uint16_t min_d = std::numeric_limits<std::uint16_t>::max();
    std::uint16_t max_d = 0;
    for (std::size_t i = 0; i < pixel_count; ++i) {
      const std::uint16_t d = z16[i];
      if (d == 0) continue;
      if (d < min_d) min_d = d;
      if (d > max_d) max_d = d;
    }

    const std::uint32_t range = (max_d > min_d) ? (max_d - min_d) : 1;

    std::vector<std::uint8_t> rgba(pixel_count * 4);
    for (std::size_t i = 0; i < pixel_count; ++i) {
      const std::uint16_t d = z16[i];
      const std::uint8_t g =
          (d == 0)
              ? 0
              : static_cast<std::uint8_t>(
                    255 - (static_cast<std::uint32_t>(d - min_d) * 255 / range));
      rgba[i * 4 + 0] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = 0xFF;
    }

    livekit::VideoFrame vf(dw, dh, livekit::VideoBufferType::RGBA,
                           std::move(rgba));
    tracks_.camera_depth_vis_source->captureFrame(vf, frame.timestamp_us);
    publish_counts_[static_cast<std::size_t>(kPublishCameraDepthVisIdx)]
        .fetch_add(1, std::memory_order_relaxed);
  }

  if (tracks_.camera_depth) {
    const auto now = std::chrono::steady_clock::now();
    const auto depth_interval = std::chrono::microseconds(
        1000000 / std::max(config_.depth_publish_rate_hz, 1));
    if (now - last_depth_publish_ < depth_interval) {
      return;
    }
    last_depth_publish_ = now;

    DepthSendJob job;
    job.depth_raw = std::move(frame.depth_raw);
    job.depth_width = frame.depth_width;
    job.depth_height = frame.depth_height;
    job.timestamp_us = frame.timestamp_us;
    {
      std::lock_guard<std::mutex> lock(depth_mutex_);
      depth_pending_ = std::move(job);
    }
    depth_cv_.notify_one();
  }
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

  startDepthWorker();

  const auto publish_period =
      std::chrono::microseconds(1000000 / std::max(config_.publish_rate_hz, 1));
  auto next_tick = std::chrono::steady_clock::now();
  last_depth_publish_ = std::chrono::steady_clock::now();
  last_publish_diag_log_ = std::chrono::steady_clock::now();

  constexpr auto kMinLoopDuration = std::chrono::milliseconds(5);

  LK_LOG_INFO("[pan_tilt_livekit] Running publish loop at {} Hz{}",
              config_.publish_rate_hz,
              camera_ ? " (with RealSense camera)" : "");
  while (g_running_.load()) {
    const auto loop_start = std::chrono::steady_clock::now();

    if (loop_start >= next_tick) {
      next_tick += publish_period;
      publishStateTick();
    }

    publishCameraTick();
    logPublishDiagnosticsIfDue();

    const auto elapsed = std::chrono::steady_clock::now() - loop_start;
    if (elapsed < kMinLoopDuration) {
      std::this_thread::sleep_for(kMinLoopDuration - elapsed);
    }
  }

  shutdown();
  return 0;
}

void PtLiveKitApp::logPublishDiagnosticsIfDue() {
  const auto now = std::chrono::steady_clock::now();
  if (now - last_publish_diag_log_ < std::chrono::seconds(30)) {
    return;
  }
  last_publish_diag_log_ = now;

  long long rss_kb = -1;
  long long vsz_kb = -1;
  if (!readProcSelfMemoryKb(&rss_kb, &vsz_kb)) {
    LK_LOG_WARN(
        "[pan_tilt_livekit] could not read /proc/self/status (VmRSS/VmSize)");
    return;
  }

  LK_LOG_INFO(
      "[pan_tilt_livekit] mem VmRSS={} kB VmSize={} kB publish_total "
      "{}={} {}={} {}={} {}={} {}={} {}={}",
      rss_kb, vsz_kb, pan_tilt_topics::kGyroStateTrack,
      publish_counts_[static_cast<std::size_t>(kPublishGyroStateIdx)].load(
          std::memory_order_relaxed),
      pan_tilt_topics::kPanStateTrack,
      publish_counts_[static_cast<std::size_t>(kPublishPanStateIdx)].load(
          std::memory_order_relaxed),
      pan_tilt_topics::kTiltStateTrack,
      publish_counts_[static_cast<std::size_t>(kPublishTiltStateIdx)].load(
          std::memory_order_relaxed),
      pan_tilt_topics::kCameraColorTrack,
      publish_counts_[static_cast<std::size_t>(kPublishCameraColorIdx)].load(
          std::memory_order_relaxed),
      pan_tilt_topics::kCameraDepthTrack,
      publish_counts_[static_cast<std::size_t>(kPublishCameraDepthIdx)].load(
          std::memory_order_relaxed),
      pan_tilt_topics::kCameraDepthVisTrack,
      publish_counts_[static_cast<std::size_t>(kPublishCameraDepthVisIdx)].load(
          std::memory_order_relaxed));
}

void PtLiveKitApp::shutdown() {
  if (shutdown_done_) {
    return;
  }
  shutdown_done_ = true;

  stopDepthWorker();

  if (rpc_registered_ && room_) {
    try {
      room_->localParticipant()->unregisterRpcMethod(
          pan_tilt_topics::kAcquireControlRpc);
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

  if (camera_) {
    camera_->stop();
  }

  if (!pan_tilt_.haltMotors()) {
    LK_LOG_WARN("[pan_tilt_livekit] Failed to halt motors during shutdown");
  }
  gyro_.stop();

  tracks_ = {};
  room_.reset();
  livekit::shutdown();
}
