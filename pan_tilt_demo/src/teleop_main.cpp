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

#include "livekit_bridge/livekit_bridge.h"
#include "pan_tilt_topics.h"
#include "livekit/lk_log.h"

#include <SDL3/SDL.h>
#include <nlohmann/json.hpp>

#include <atomic>
#include <cctype>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

using json = nlohmann::json;
using Clock = std::chrono::steady_clock;

namespace {
constexpr double kTeleopVelRadPerSec = 1.4;
constexpr auto kLoopPeriod = std::chrono::milliseconds(33); // ~30Hz
constexpr auto kPrintPeriod = std::chrono::milliseconds(200);
constexpr auto kHeldCmdRefreshPeriod = std::chrono::milliseconds(80);

std::atomic<bool> g_running{true};

void handleSignal(int) { g_running.store(false); }

std::optional<std::string> decodeBase64Url(const std::string &in) {
  auto decodeChar = [](unsigned char c) -> int {
    if (c >= 'A' && c <= 'Z') {
      return static_cast<int>(c - 'A');
    }
    if (c >= 'a' && c <= 'z') {
      return static_cast<int>(c - 'a') + 26;
    }
    if (c >= '0' && c <= '9') {
      return static_cast<int>(c - '0') + 52;
    }
    if (c == '+') {
      return 62;
    }
    if (c == '/') {
      return 63;
    }
    return -1;
  };

  std::string normalized;
  normalized.reserve(in.size() + 4);
  for (const char ch : in) {
    if (ch == '-') {
      normalized.push_back('+');
    } else if (ch == '_') {
      normalized.push_back('/');
    } else {
      normalized.push_back(ch);
    }
  }
  while ((normalized.size() % 4) != 0U) {
    normalized.push_back('=');
  }

  std::string out;
  out.reserve((normalized.size() / 4) * 3);
  for (size_t i = 0; i < normalized.size(); i += 4) {
    const char c0 = normalized[i];
    const char c1 = normalized[i + 1];
    const char c2 = normalized[i + 2];
    const char c3 = normalized[i + 3];

    const int v0 = decodeChar(static_cast<unsigned char>(c0));
    const int v1 = decodeChar(static_cast<unsigned char>(c1));
    if (v0 < 0 || v1 < 0) {
      return std::nullopt;
    }

    int v2 = 0;
    int v3 = 0;
    if (c2 != '=') {
      v2 = decodeChar(static_cast<unsigned char>(c2));
      if (v2 < 0) {
        return std::nullopt;
      }
    }
    if (c3 != '=') {
      v3 = decodeChar(static_cast<unsigned char>(c3));
      if (v3 < 0) {
        return std::nullopt;
      }
    }

    const std::uint32_t triple = (static_cast<std::uint32_t>(v0) << 18) |
                                 (static_cast<std::uint32_t>(v1) << 12) |
                                 (static_cast<std::uint32_t>(v2) << 6) |
                                 static_cast<std::uint32_t>(v3);

    out.push_back(static_cast<char>((triple >> 16) & 0xFFU));
    if (c2 != '=') {
      out.push_back(static_cast<char>((triple >> 8) & 0xFFU));
    }
    if (c3 != '=') {
      out.push_back(static_cast<char>(triple & 0xFFU));
    }
  }
  return out;
}

std::optional<std::string> extractTokenIdentity(const std::string &jwt) {
  const size_t first_dot = jwt.find('.');
  if (first_dot == std::string::npos) {
    return std::nullopt;
  }
  const size_t second_dot = jwt.find('.', first_dot + 1);
  if (second_dot == std::string::npos || second_dot <= first_dot + 1) {
    return std::nullopt;
  }

  const std::string payload_b64 =
      jwt.substr(first_dot + 1, second_dot - first_dot - 1);
  const auto payload_json = decodeBase64Url(payload_b64);
  if (!payload_json.has_value()) {
    return std::nullopt;
  }

  try {
    const json payload = json::parse(*payload_json);
    if (payload.contains("sub") && payload.at("sub").is_string()) {
      return payload.at("sub").get<std::string>();
    }
  } catch (const std::exception &) {
    return std::nullopt;
  }
  return std::nullopt;
}

struct Args {
  std::string url;
  std::string token;
  std::string robot_identity{"robot"};
};

void printUsage(const char *prog) {
  LK_LOG_INFO("Usage: {} [--url <ws-url>] [--token <token>] "
              "[--robot <identity>]",
              prog);
  LK_LOG_INFO("Env fallbacks: LIVEKIT_URL, LIVEKIT_TOKEN");
}

bool parseArgs(int argc, char *argv[], Args &args) {
  std::vector<std::string> positional;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--url") == 0 && i + 1 < argc) {
      args.url = argv[++i];
    } else if (std::strcmp(argv[i], "--token") == 0 && i + 1 < argc) {
      args.token = argv[++i];
    } else if (std::strcmp(argv[i], "--robot") == 0 && i + 1 < argc) {
      args.robot_identity = argv[++i];
    } else if (std::strcmp(argv[i], "--help") == 0 ||
               std::strcmp(argv[i], "-h") == 0) {
      return false;
    } else {
      positional.emplace_back(argv[i]);
    }
  }

  for (const auto &arg : positional) {
    if (args.url.empty() &&
        (arg.rfind("ws://", 0) == 0 || arg.rfind("wss://", 0) == 0)) {
      args.url = arg;
    } else if (args.token.empty()) {
      args.token = arg;
    }
  }

  if (args.url.empty()) {
    const char *e = std::getenv("LIVEKIT_URL");
    if (e != nullptr) {
      args.url = e;
    }
  }
  if (args.token.empty()) {
    const char *e = std::getenv("LIVEKIT_TOKEN");
    if (e != nullptr) {
      args.token = e;
    }
  }

  if (args.url.empty() || args.token.empty()) {
    LK_LOG_ERROR("[pt_controller] Missing url/token");
    return false;
  }
  return true;
}

class PtControllerApp {
public:
  explicit PtControllerApp(const Args &args) : args_(args) {}

  int run() {
    std::signal(SIGINT, handleSignal);
    std::signal(SIGTERM, handleSignal);

    livekit::RoomOptions options;
    options.auto_subscribe = true;
    options.dynacast = false;

    if (!bridge_.connect(args_.url, args_.token, options)) {
      LK_LOG_ERROR("[pt_controller] Failed to connect to room");
      return 1;
    }
    const auto token_identity = extractTokenIdentity(args_.token);
    if (token_identity.has_value()) {
      LK_LOG_INFO(
          "[pt_controller] Connected. Local identity='{}', robot identity='{}'",
          *token_identity, args_.robot_identity);
      if (*token_identity == args_.robot_identity) {
        LK_LOG_ERROR(
            "[pt_controller] Local identity matches robot identity ('{}'). "
            "Use a token generated with a distinct participant identity "
            "(e.g. --id pt_controller).",
            args_.robot_identity);
        bridge_.disconnect();
        return 1;
      }
    } else {
      LK_LOG_WARN("[pt_controller] Connected. Robot identity='{}' "
                  "(could not decode local identity from token)",
                  args_.robot_identity);
    }

    setupStateSubscribers();
    control_track_ = bridge_.createDataTrack(pan_tilt_topics::kControlCmdTrack);

    acquireControl();

    if (!initSdlInput()) {
      bridge_.disconnect();
      return 1;
    }

    LK_LOG_INFO("[pt_controller] Controls (SDL window): a/d pan, w/x tilt, "
                "space or s stop, q quit");

    auto next_tick = Clock::now();
    auto next_print = Clock::now();
    while (g_running.load()) {
      const bool motion_active = pollSdlInputAndUpdateCmd();
      if (control_acquired_) {
        publishControlCmdIfNeeded(motion_active);
      }

      const auto now = Clock::now();
      if (now >= next_print) {
        next_print = now + kPrintPeriod;
        printLatestStates();
      }

      next_tick += kLoopPeriod;
      std::this_thread::sleep_until(next_tick);
    }

    releaseControl();
    if (input_window_ != nullptr) {
      SDL_DestroyWindow(input_window_);
      input_window_ = nullptr;
    }
    SDL_Quit();
    bridge_.disconnect();
    return 0;
  }

private:
  bool initSdlInput() {
    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS)) {
      LK_LOG_ERROR("[pt_controller] SDL_Init failed: {}", SDL_GetError());
      return false;
    }

    input_window_ = SDL_CreateWindow("PT Controller Input", 420, 120, 0);
    if (input_window_ == nullptr) {
      LK_LOG_ERROR("[pt_controller] SDL_CreateWindow failed: {}",
                   SDL_GetError());
      SDL_Quit();
      return false;
    }
    SDL_RaiseWindow(input_window_);
    SDL_PumpEvents();
    LK_LOG_INFO(
        "[pt_controller] SDL input window ready. Keep it focused for controls.");
    return true;
  }

  void setupStateSubscribers() {
    LK_LOG_INFO("[pt_controller] Setting up gyro state subscriber");
    bridge_.setOnDataFrameCallback(
        args_.robot_identity, pan_tilt_topics::kGyroStateTrack,
        [this](const std::vector<std::uint8_t> &payload,
               std::optional<std::uint64_t>) {
          try {
            const json parsed = json::parse(payload.begin(), payload.end());
            std::lock_guard<std::mutex> lock(mu_);
            latest_gyro_ = parsed;
          } catch (const std::exception &e) {
            LK_LOG_WARN("[pt_controller] Bad gyro.state JSON: {}", e.what());
          }
        });

    LK_LOG_INFO("[pt_controller] Setting up pan state subscriber");
    bridge_.setOnDataFrameCallback(
        args_.robot_identity, pan_tilt_topics::kPanStateTrack,
        [this](const std::vector<std::uint8_t> &payload,
               std::optional<std::uint64_t>) {
          try {
            const json parsed = json::parse(payload.begin(), payload.end());
            std::lock_guard<std::mutex> lock(mu_);
            latest_pan_ = parsed;
          } catch (const std::exception &e) {
            LK_LOG_WARN("[pt_controller] Bad pan.state JSON: {}", e.what());
          }
        });

    LK_LOG_INFO("[pt_controller] Setting up tilt state subscriber");
    bridge_.setOnDataFrameCallback(
        args_.robot_identity, pan_tilt_topics::kTiltStateTrack,
        [this](const std::vector<std::uint8_t> &payload,
               std::optional<std::uint64_t>) {
          try {
            const json parsed = json::parse(payload.begin(), payload.end());
            std::lock_guard<std::mutex> lock(mu_);
            latest_tilt_ = parsed;
          } catch (const std::exception &e) {
            LK_LOG_WARN("[pt_controller] Bad tilt.state JSON: {}", e.what());
          }
        });
  }

  void acquireControl() {
    LK_LOG_INFO("[pt_controller] Acquiring control");
    // Requested method name first; fallback to current robot-side spelling.
    for (const std::string method : {pan_tilt_topics::kAcquireControlRpc}) {
      try {
        const auto response = bridge_.performRpc(
            args_.robot_identity, method, R"({"acquire":true})", 5.0);
        if (!response.has_value()) {
          LK_LOG_ERROR("[pt_controller] Control not acquired; teleop publishing disabled");
          return;
        }
        control_acquired_ = true;
        rpc_method_ = method;
        LK_LOG_INFO("[pt_controller] Control acquired via '{}' response='{}'",
                    method, response.value());
        return;
      } catch (const std::exception &e) {
        LK_LOG_ERROR("[pt_controller] {} failed: {}", method, e.what());
      }
    }
    LK_LOG_ERROR("[pt_controller] Control not acquired; teleop publishing disabled");
  }

  void releaseControl() {
    if (!control_acquired_) {
      return;
    }
    try {
      bridge_.performRpc(args_.robot_identity, rpc_method_,
                         R"({"acquire":false})", 3.0);
      LK_LOG_INFO("[pt_controller] Control released");
    } catch (const std::exception &e) {
      LK_LOG_WARN("[pt_controller] Failed to release control: {}", e.what());
    }
    control_acquired_ = false;
  }

  bool pollSdlInputAndUpdateCmd() {
    SDL_Event ev;
    while (SDL_PollEvent(&ev)) {
      if (ev.type == SDL_EVENT_QUIT) {
        g_running.store(false);
      }
    }
    SDL_PumpEvents();
    const bool *keys = SDL_GetKeyboardState(nullptr);
    if (keys == nullptr) {
      return false;
    }

    if (keys[SDL_SCANCODE_Q]) {
      g_running.store(false);
      return false;
    }

    double pan_vel = 0.0;
    double tilt_vel = 0.0;
    if (keys[SDL_SCANCODE_A]) {
      pan_vel += kTeleopVelRadPerSec;
    }
    if (keys[SDL_SCANCODE_D]) {
      pan_vel -= kTeleopVelRadPerSec;
    }
    if (keys[SDL_SCANCODE_W]) {
      tilt_vel += kTeleopVelRadPerSec;
    }
    if (keys[SDL_SCANCODE_X]) {
      tilt_vel -= kTeleopVelRadPerSec;
    }
    if (keys[SDL_SCANCODE_S] || keys[SDL_SCANCODE_SPACE]) {
      pan_vel = 0.0;
      tilt_vel = 0.0;
    }
    setPanTiltVel(pan_vel, tilt_vel);
    const bool motion_active = (pan_vel != 0.0) || (tilt_vel != 0.0);
    return motion_active;
  }

  void setPanTiltVel(double pan_vel_rad_s, double tilt_vel_rad_s) {
    std::lock_guard<std::mutex> lock(cmd_mu_);
    if (pan_vel_rad_s_ == pan_vel_rad_s && tilt_vel_rad_s_ == tilt_vel_rad_s) {
      return;
    }
    pan_vel_rad_s_ = pan_vel_rad_s;
    tilt_vel_rad_s_ = tilt_vel_rad_s;
    cmd_dirty_ = true;
  }

  void publishControlCmdIfNeeded(bool motion_active) {
    double pan_vel_rad_s = 0.0;
    double tilt_vel_rad_s = 0.0;
    {
      std::lock_guard<std::mutex> lock(cmd_mu_);
      const auto now = Clock::now();
      if (!cmd_dirty_ &&
          (!motion_active ||
           (now - last_cmd_publish_time_) < kHeldCmdRefreshPeriod)) {
        return;
      }
      pan_vel_rad_s = pan_vel_rad_s_;
      tilt_vel_rad_s = tilt_vel_rad_s_;
      cmd_dirty_ = false;
      last_cmd_publish_time_ = now;
    }

    const json cmd{
        {"pan_vel", pan_vel_rad_s},
        {"tilt_vel", tilt_vel_rad_s},
    };
    const std::string msg = cmd.dump();
    control_track_->pushFrame(std::vector<std::uint8_t>(msg.begin(), msg.end()));
  }

  void printLatestStates() {
    std::optional<json> gyro;
    std::optional<json> pan;
    std::optional<json> tilt;
    double pan_vel_rad_s = 0.0;
    double tilt_vel_rad_s = 0.0;
    {
      std::lock_guard<std::mutex> lock(mu_);
      gyro = latest_gyro_;
      pan = latest_pan_;
      tilt = latest_tilt_;
    }
    {
      std::lock_guard<std::mutex> cmd_lock(cmd_mu_);
      pan_vel_rad_s = pan_vel_rad_s_;
      tilt_vel_rad_s = tilt_vel_rad_s_;
    }

    LK_LOG_INFO("[pt_controller] cmd pan={:.2f}rad/s tilt={:.2f}rad/s",
                pan_vel_rad_s, tilt_vel_rad_s);
    LK_LOG_INFO("[pt_controller] latest gyro: {}",
                gyro.has_value() ? gyro->dump() : "n/a");
    LK_LOG_INFO("[pt_controller] latest pan: {}",
                pan.has_value() ? pan->dump() : "n/a");
    LK_LOG_INFO("[pt_controller] latest tilt: {}",
                tilt.has_value() ? tilt->dump() : "n/a");
  }

  Args args_;
  livekit_bridge::LiveKitBridge bridge_;
  std::shared_ptr<livekit_bridge::BridgeDataTrack> control_track_;
  SDL_Window *input_window_{nullptr};

  std::mutex mu_;
  std::optional<json> latest_gyro_;
  std::optional<json> latest_pan_;
  std::optional<json> latest_tilt_;

  std::mutex cmd_mu_;
  double pan_vel_rad_s_{0.0};
  double tilt_vel_rad_s_{0.0};
  bool cmd_dirty_{false};
  Clock::time_point last_cmd_publish_time_{Clock::now()};
  bool control_acquired_{false};
  std::string rpc_method_{pan_tilt_topics::kAcquireControlRpc};
};
} // namespace

int main(int argc, char *argv[]) {
  Args args;
  if (!parseArgs(argc, argv, args)) {
    printUsage(argv[0]);
    return 1;
  }

  PtControllerApp app(args);
  return app.run();
}
