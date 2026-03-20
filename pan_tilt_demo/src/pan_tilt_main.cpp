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

#include "livekit/lk_log.h"

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <optional>
#include <string>
#include <vector>

namespace {
bool parseIntArg(const std::string &raw, int *out) {
  try {
    size_t consumed = 0;
    const int parsed = std::stoi(raw, &consumed, 10);
    if (consumed != raw.size()) {
      return false;
    }
    *out = parsed;
    return true;
  } catch (...) {
    return false;
  }
}

bool parseAddressArg(const std::string &raw, std::uint8_t *out) {
  try {
    size_t consumed = 0;
    const unsigned long parsed = std::stoul(raw, &consumed, 0);
    if (consumed != raw.size() || parsed > 0x7fUL) {
      return false;
    }
    *out = static_cast<std::uint8_t>(parsed);
    return true;
  } catch (...) {
    return false;
  }
}

bool parseServoIdArg(const std::string &raw, u8 *out) {
  int parsed = -1;
  if (!parseIntArg(raw, &parsed) || parsed < 0 || parsed > 253) {
    return false;
  }
  *out = static_cast<u8>(parsed);
  return true;
}

void printUsage(const char *prog_name) {
  LK_LOG_INFO(
      "Usage: {} --serial-port <device> [--url <ws-url>] [--token <token>] "
      "[--gyro-bus <int>] [--gyro-address <addr>] [--pan-id <id>] "
      "[--tilt-id <id>] [--calibrate-ofs]",
      prog_name);
  LK_LOG_INFO("Env fallbacks: LIVEKIT_URL, LIVEKIT_TOKEN");
}

std::optional<PtLiveKitConfig> parseArgs(int argc, char *argv[]) {
  PtLiveKitConfig cfg;
  std::vector<std::string> positional;

  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    auto require_value = [&](const char *flag) -> std::optional<std::string> {
      if (i + 1 >= argc) {
        LK_LOG_ERROR("[pan_tilt_livekit] Missing value for {}", flag);
        return std::nullopt;
      }
      return std::string(argv[++i]);
    };

    if (arg == "--help" || arg == "-h") {
      return std::nullopt;
    }
    if (arg == "--serial-port") {
      auto v = require_value("--serial-port");
      if (!v) {
        return std::nullopt;
      }
      cfg.serial_port = *v;
      continue;
    }
    if (arg == "--url") {
      auto v = require_value("--url");
      if (!v) {
        return std::nullopt;
      }
      cfg.url = *v;
      continue;
    }
    if (arg == "--token") {
      auto v = require_value("--token");
      if (!v) {
        return std::nullopt;
      }
      cfg.token = *v;
      continue;
    }
    if (arg == "--gyro-bus") {
      auto v = require_value("--gyro-bus");
      if (!v) {
        return std::nullopt;
      }
      if (!parseIntArg(*v, &cfg.gyro_bus)) {
        LK_LOG_ERROR("[pan_tilt_livekit] Invalid --gyro-bus value: {}", *v);
        return std::nullopt;
      }
      continue;
    }
    if (arg == "--gyro-address") {
      auto v = require_value("--gyro-address");
      if (!v) {
        return std::nullopt;
      }
      if (!parseAddressArg(*v, &cfg.gyro_address)) {
        LK_LOG_ERROR("[pan_tilt_livekit] Invalid --gyro-address value: {}", *v);
        return std::nullopt;
      }
      continue;
    }
    if (arg == "--pan-id") {
      auto v = require_value("--pan-id");
      if (!v) {
        return std::nullopt;
      }
      if (!parseServoIdArg(*v, &cfg.motor_ids[0])) {
        LK_LOG_ERROR("[pan_tilt_livekit] Invalid --pan-id value: {}", *v);
        return std::nullopt;
      }
      continue;
    }
    if (arg == "--tilt-id") {
      auto v = require_value("--tilt-id");
      if (!v) {
        return std::nullopt;
      }
      if (!parseServoIdArg(*v, &cfg.motor_ids[1])) {
        LK_LOG_ERROR("[pan_tilt_livekit] Invalid --tilt-id value: {}", *v);
        return std::nullopt;
      }
      continue;
    }
    if (arg == "--calibrate-ofs") {
      cfg.run_calibration_ofs = true;
      continue;
    }
    positional.push_back(arg);
  }

  if (cfg.serial_port.empty()) {
    for (const auto &arg : positional) {
      if (arg.rfind("/dev/", 0) == 0) {
        cfg.serial_port = arg;
        break;
      }
    }
  }
  if (cfg.url.empty()) {
    for (const auto &arg : positional) {
      if (arg.rfind("ws://", 0) == 0 || arg.rfind("wss://", 0) == 0) {
        cfg.url = arg;
        break;
      }
    }
  }
  if (cfg.token.empty()) {
    for (const auto &arg : positional) {
      if (arg != cfg.serial_port && arg != cfg.url) {
        cfg.token = arg;
        break;
      }
    }
  }

  if (cfg.url.empty()) {
    const char *env_url = std::getenv("LIVEKIT_URL");
    if (env_url != nullptr) {
      cfg.url = env_url;
    }
  }
  if (cfg.token.empty()) {
    const char *env_token = std::getenv("LIVEKIT_TOKEN");
    if (env_token != nullptr) {
      cfg.token = env_token;
    }
  }

  if (cfg.publish_rate_hz <= 0) {
    LK_LOG_ERROR("[pan_tilt_livekit] publish_rate_hz must be > 0");
    return std::nullopt;
  }
  if (cfg.serial_port.empty() || cfg.url.empty() || cfg.token.empty()) {
    LK_LOG_ERROR("[pan_tilt_livekit] Missing required args: serial port/url/token");
    return std::nullopt;
  }
  if (cfg.motor_ids[0] == cfg.motor_ids[1]) {
    LK_LOG_ERROR("[pan_tilt_livekit] pan-id and tilt-id must be unique");
    return std::nullopt;
  }
  return cfg;
}
} // namespace

int main(int argc, char *argv[]) {
  try {
    const auto cfg = parseArgs(argc, argv);
    if (!cfg.has_value()) {
      printUsage(argv[0]);
      return 1;
    }

    PtLiveKitApp app(*cfg);
    return app.run();
  } catch (const std::exception &e) {
    LK_LOG_ERROR("[pan_tilt_livekit] Fatal error: {}", e.what());
    return 1;
  }
}
