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

/*
 * RoverControllerApp — LiveKit participant that teleoperates the Rover.
 *
 * Connects to the same LiveKit room as the rover robot, acquires motor
 * control via the "acquire_control" RPC, and sends throttle/steering
 * velocity commands as a DataTrack.
 *
 * Subscribes to:
 *   - <rover_id>.imu       (DataTrack — IMU JSON)
 *   - <rover_id>.arducam   (VideoTrack, SOURCE_CAMERA — RGB from ArduCam)
 *
 * An SDL window renders the live camera feed and accepts keyboard input.
 *
 * Keyboard controls (SDL window must have focus):
 *   W / S       — throttle forward / reverse
 *   A / D       — steer left / right
 *   Space       — stop all motors
 *   Q           — quit
 *
 * Usage:
 *   RoverController --url <ws-url> --token <token> --rover-id <identity>
 *   LIVEKIT_URL=... LIVEKIT_TOKEN=... RoverController --rover-id <identity>
 */

#include "livekit/livekit.h"
#include "rover_topics.h"
#include "teleop_msgs.h"

#include <SDL3/SDL.h>
#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <optional>
#include <string>
#include <vector>
#include <iomanip>
#include <iostream>

using json = nlohmann::json;
using Clock = std::chrono::steady_clock;

namespace {
constexpr double kThrottleRps = 1.0;
constexpr double kSteeringRps = 1.0;
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
  std::string rover_id;
};

void printUsage(const char *prog) {
  std::cout << "Usage: " << prog
            << " [--url <ws-url>] [--token <token>] --rover-id <identity>\n";
  std::cout << "Env fallbacks: LIVEKIT_URL, LIVEKIT_TOKEN\n";
  std::cout << "Keyboard (SDL window): W/S throttle, A/D steer, "
               "Space stop, Q quit\n";
}

bool parseArgs(int argc, char *argv[], Args &args) {
  std::vector<std::string> positional;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--url") == 0 && i + 1 < argc) {
      args.url = argv[++i];
    } else if (std::strcmp(argv[i], "--token") == 0 && i + 1 < argc) {
      args.token = argv[++i];
    } else if (std::strcmp(argv[i], "--rover-id") == 0 && i + 1 < argc) {
      args.rover_id = argv[++i];
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

  if (args.url.empty() || args.token.empty() || args.rover_id.empty()) {
    std::cerr << "[controller] Missing required url/token/rover-id\n";
    return false;
  }

  const auto token_identity = extractTokenIdentity(args.token);
  if (token_identity.has_value() && *token_identity == args.rover_id) {
    std::cerr << "[controller] Token identity matches --rover-id '" << args.rover_id
              << "'. Use a distinct participant identity for the controller.\n";
    return false;
  }

  return true;
}

class RoverControllerApp {
public:
  explicit RoverControllerApp(const Args &args) : args_(args) {}

  int run() {
    std::signal(SIGINT, handleSignal);
    std::signal(SIGTERM, handleSignal);

    livekit::initialize();
    room_ = std::make_unique<livekit::Room>();

    livekit::RoomOptions options;
    options.auto_subscribe = true;
    options.dynacast = false;

    if (!room_->Connect(args_.url, args_.token, options)) {
      std::cerr << "[controller] Failed to connect to room\n";
      room_.reset();
      livekit::shutdown();
      return 1;
    }

    const auto token_identity = extractTokenIdentity(args_.token);
    if (token_identity.has_value()) {
      std::cout << "[controller] Connected. Local identity='" << *token_identity
                << "', rover identity='" << args_.rover_id << "'\n";
    } else {
      std::cerr << "[controller] Connected. Rover identity='" << args_.rover_id
                << "' (could not decode local identity from token)\n";
    }

    setupSubscribers();
    acquireControl();

    if (!initSdl()) {
      room_.reset();
      livekit::shutdown();
      return 1;
    }

    std::cout << "[controller] Controls: w/s throttle, a/d steer, "
                 "space stop, q quit\n";

    auto next_tick = Clock::now();
    auto next_print = Clock::now();
    while (g_running.load()) {
      const bool motion_active = pollSdlInputAndUpdateCmd();
      if (control_acquired_) {
        publishControlCmdIfNeeded(motion_active);
      }

      renderVideoFrame();

      const auto now = Clock::now();
      if (now >= next_print) {
        next_print = now + kPrintPeriod;
        printLatestStates();
      }

      next_tick += kLoopPeriod;
      const auto now2 = Clock::now();
      if (next_tick < now2) {
        next_tick = now2;
      }
      std::this_thread::sleep_until(next_tick);
    }

    releaseControl();
    teardownSdl();
    control_track_.reset();
    room_.reset();
    livekit::shutdown();
    return 0;
  }

private:
  bool initSdl() {
    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS)) {
      std::cerr << "[controller] SDL_Init failed: " << SDL_GetError() << '\n';
      return false;
    }

    sdl_window_ = SDL_CreateWindow("Rover Controller", kDefaultVideoWidth,
                                   kDefaultVideoHeight, SDL_WINDOW_RESIZABLE);
    if (sdl_window_ == nullptr) {
      std::cerr << "[controller] SDL_CreateWindow failed: " << SDL_GetError() << '\n';
      SDL_Quit();
      return false;
    }

    sdl_renderer_ = SDL_CreateRenderer(sdl_window_, nullptr);
    if (sdl_renderer_ == nullptr) {
      std::cerr << "[controller] SDL_CreateRenderer failed: " << SDL_GetError() << '\n';
      SDL_DestroyWindow(sdl_window_);
      sdl_window_ = nullptr;
      SDL_Quit();
      return false;
    }

    sdl_texture_ = SDL_CreateTexture(sdl_renderer_, SDL_PIXELFORMAT_ABGR8888,
                                     SDL_TEXTUREACCESS_STREAMING,
                                     kDefaultVideoWidth, kDefaultVideoHeight);
    if (sdl_texture_ == nullptr) {
      std::cerr << "[controller] SDL_CreateTexture failed: " << SDL_GetError() << '\n';
      SDL_DestroyRenderer(sdl_renderer_);
      sdl_renderer_ = nullptr;
      SDL_DestroyWindow(sdl_window_);
      sdl_window_ = nullptr;
      SDL_Quit();
      return false;
    }

    SDL_RaiseWindow(sdl_window_);
    SDL_PumpEvents();
    std::cout << "[controller] SDL window ready (" << kDefaultVideoWidth << "x"
              << kDefaultVideoHeight << "). Keep it focused for controls.\n";
    return true;
  }

  void teardownSdl() {
    if (sdl_texture_ != nullptr) {
      SDL_DestroyTexture(sdl_texture_);
      sdl_texture_ = nullptr;
    }
    if (sdl_renderer_ != nullptr) {
      SDL_DestroyRenderer(sdl_renderer_);
      sdl_renderer_ = nullptr;
    }
    if (sdl_window_ != nullptr) {
      SDL_DestroyWindow(sdl_window_);
      sdl_window_ = nullptr;
    }
    SDL_Quit();
  }

  void setupSubscribers() {
    const std::string imu_track = rover_topics::imuTrackName(args_.rover_id);
    std::cout << "[controller] Subscribing to data track '" << imu_track
              << "' from '" << args_.rover_id << "'\n";
    room_->addOnDataFrameCallback(
        args_.rover_id, imu_track,
        [this](const std::vector<std::uint8_t> &payload,
               std::optional<std::uint64_t>) {
          teleop_msgs::ImuMsg imu_msg;
          std::string error;
          if (!teleop_msgs::fromPayload(payload, &imu_msg, &error)) {
            std::cerr << "[controller] Invalid imu payload: " << error << '\n';
            return;
          }

          std::lock_guard<std::mutex> lock(imu_mu_);
          latest_imu_ = imu_msg;
          ++valid_imu_count_;
        });

    std::cout << "[controller] Subscribing to video track '"
              << rover_topics::arducamTrackName(args_.rover_id) << "' from '"
              << args_.rover_id << "'\n";
    room_->setOnVideoFrameCallback(
        args_.rover_id, livekit::TrackSource::SOURCE_CAMERA,
        [this](const livekit::VideoFrame &frame, std::int64_t timestamp_us) {
          (void)timestamp_us;
          const std::size_t expected =
              static_cast<std::size_t>(frame.width()) * frame.height() * 4;
          if (frame.dataSize() != expected) {
            return;
          }
          std::lock_guard<std::mutex> lock(video_mu_);
          if (video_frame_count_ == 0) {
            std::cout << "[controller] First arducam frame received ("
                      << frame.width() << "x" << frame.height() << ")\n";
          }
          video_buffer_.assign(frame.data(), frame.data() + frame.dataSize());
          video_width_ = frame.width();
          video_height_ = frame.height();
          ++video_frame_count_;
        });
  }

  void acquireControl() {
    try {
      const auto response = room_->localParticipant()->performRpc(
          args_.rover_id, rover_topics::kAcquireControlRpc,
          std::string(teleop_msgs::toJson(
                          teleop_msgs::AcquireControlRequest{true})
                          .dump()),
          5.0);
      std::cout << "[controller] Control acquired. RPC response='" << response << "'\n";

      const std::string control_track_name =
          rover_topics::controlCmdTrackName(args_.rover_id);
      auto track_result =
          room_->localParticipant()->publishDataTrack(control_track_name);
      if (!track_result) {
        std::cerr << "[controller] Failed to publish control track '"
                  << control_track_name << "'\n";
        releaseControl();
        return;
      }
      control_track_ = std::move(track_result).value();
      control_acquired_ = true;
      std::cout << "[controller] Published control track '" << control_track_name << "'\n";
    } catch (const std::exception &e) {
      std::cerr << "[controller] acquire_control failed: " << e.what() << '\n';
    }
  }

  void releaseControl() {
    if (!control_acquired_) {
      return;
    }
    try {
      room_->localParticipant()->performRpc(
          args_.rover_id, rover_topics::kAcquireControlRpc,
          std::string(teleop_msgs::toJson(
                          teleop_msgs::AcquireControlRequest{false})
                          .dump()),
          3.0);
      std::cout << "[controller] Control released\n";
    } catch (const std::exception &e) {
      std::cerr << "[controller] Failed to release control: " << e.what() << '\n';
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

    double throttle = 0.0;
    double steering = 0.0;
    if (keys[SDL_SCANCODE_W]) {
      throttle += kThrottleRps;
    }
    if (keys[SDL_SCANCODE_S]) {
      throttle -= kThrottleRps;
    }
    if (keys[SDL_SCANCODE_A]) {
      steering += kSteeringRps;
    }
    if (keys[SDL_SCANCODE_D]) {
      steering -= kSteeringRps;
    }
    if (keys[SDL_SCANCODE_SPACE]) {
      throttle = 0.0;
      steering = 0.0;
    }
    setControlCmd(throttle, steering);
    const bool motion_active = (throttle != 0.0) || (steering != 0.0);
    return motion_active;
  }

  void setControlCmd(double throttle_rps, double steering_rps) {
    std::lock_guard<std::mutex> lock(cmd_mu_);
    if (throttle_rps_ == throttle_rps && steering_rps_ == steering_rps) {
      return;
    }
    throttle_rps_ = throttle_rps;
    steering_rps_ = steering_rps;
    cmd_dirty_ = true;
  }

  void publishControlCmdIfNeeded(bool motion_active) {
    double throttle_rps = 0.0;
    double steering_rps = 0.0;
    {
      std::lock_guard<std::mutex> lock(cmd_mu_);
      const auto now = Clock::now();
      if (!cmd_dirty_ &&
          (!motion_active ||
           (now - last_cmd_publish_time_) < kHeldCmdRefreshPeriod)) {
        return;
      }
      throttle_rps = throttle_rps_;
      steering_rps = steering_rps_;
      cmd_dirty_ = false;
      last_cmd_publish_time_ = now;
    }

    teleop_msgs::ControlCmdMsg cmd;
    cmd.throttle_rps = throttle_rps;
    cmd.steering_rps = steering_rps;
    (void)control_track_->tryPush(teleop_msgs::toPayload(cmd));
  }

  void renderVideoFrame() {
    if (sdl_renderer_ == nullptr || sdl_texture_ == nullptr) {
      return;
    }

    std::vector<std::uint8_t> frame_copy;
    int w = 0;
    int h = 0;
    {
      std::lock_guard<std::mutex> lock(video_mu_);
      if (video_buffer_.empty() ||
          last_rendered_frame_count_ == video_frame_count_) {
        return;
      }
      frame_copy = video_buffer_;
      w = video_width_;
      h = video_height_;
      last_rendered_frame_count_ = video_frame_count_;
    }

    if (w != texture_width_ || h != texture_height_) {
      SDL_DestroyTexture(sdl_texture_);
      sdl_texture_ = SDL_CreateTexture(sdl_renderer_, SDL_PIXELFORMAT_ABGR8888,
                                       SDL_TEXTUREACCESS_STREAMING, w, h);
      if (sdl_texture_ == nullptr) {
        std::cerr << "[controller] Failed to recreate texture: " << SDL_GetError() << '\n';
        return;
      }
      texture_width_ = w;
      texture_height_ = h;
    }

    SDL_UpdateTexture(sdl_texture_, nullptr, frame_copy.data(), w * 4);
    SDL_RenderClear(sdl_renderer_);
    SDL_RenderTexture(sdl_renderer_, sdl_texture_, nullptr, nullptr);
    SDL_RenderPresent(sdl_renderer_);
  }

  void printLatestStates() {
    double throttle_rps = 0.0;
    double steering_rps = 0.0;
    {
      std::lock_guard<std::mutex> lock(cmd_mu_);
      throttle_rps = throttle_rps_;
      steering_rps = steering_rps_;
    }

    std::optional<teleop_msgs::ImuMsg> imu;
    std::uint64_t imu_count = 0;
    {
      std::lock_guard<std::mutex> lock(imu_mu_);
      imu = latest_imu_;
      imu_count = valid_imu_count_;
    }

    std::uint64_t vframes = 0;
    {
      std::lock_guard<std::mutex> lock(video_mu_);
      vframes = video_frame_count_;
    }

    std::cout << std::fixed << std::setprecision(2)
              << "[controller] cmd throttle=" << throttle_rps
              << "rps steering=" << steering_rps << "rps\n";
    if (imu.has_value()) {
      std::cout << std::fixed << std::setprecision(2)
                << "[controller] IMU#" << imu_count
                << " roll=" << imu->orientation_rad.roll
                << " pitch=" << imu->orientation_rad.pitch
                << " yaw=" << imu->orientation_rad.yaw
                << std::setprecision(1)
                << " temp=" << imu->temperature_c << "C\n";
    } else {
      std::cout << "[controller] IMU: n/a\n";
    }
    std::cout << "[controller] video frames=" << vframes << '\n';
  }

  static constexpr int kDefaultVideoWidth = 640;
  static constexpr int kDefaultVideoHeight = 480;

  Args args_;
  std::unique_ptr<livekit::Room> room_;
  std::shared_ptr<livekit::LocalDataTrack> control_track_;
  bool control_acquired_{false};

  SDL_Window *sdl_window_{nullptr};
  SDL_Renderer *sdl_renderer_{nullptr};
  SDL_Texture *sdl_texture_{nullptr};
  int texture_width_{kDefaultVideoWidth};
  int texture_height_{kDefaultVideoHeight};

  std::mutex imu_mu_;
  std::optional<teleop_msgs::ImuMsg> latest_imu_;
  std::uint64_t valid_imu_count_{0};

  std::mutex video_mu_;
  std::vector<std::uint8_t> video_buffer_;
  int video_width_{0};
  int video_height_{0};
  std::uint64_t video_frame_count_{0};
  std::uint64_t last_rendered_frame_count_{0};

  std::mutex cmd_mu_;
  double throttle_rps_{0.0};
  double steering_rps_{0.0};
  bool cmd_dirty_{false};
  Clock::time_point last_cmd_publish_time_{Clock::now()};
};
} // namespace

int main(int argc, char *argv[]) {
  Args args;
  if (!parseArgs(argc, argv, args)) {
    printUsage(argv[0]);
    return 1;
  }

  RoverControllerApp app(args);
  return app.run();
}
