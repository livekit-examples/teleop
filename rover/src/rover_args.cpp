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

#include "rover_args.h"

#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <exception>
#include <iostream>
#include <limits>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace {
using json = nlohmann::json;

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

  const auto payload_json =
      decodeBase64Url(jwt.substr(first_dot + 1, second_dot - first_dot - 1));
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

bool parsePositiveInt(const char *value, int *out) {
  if (value == nullptr || out == nullptr) {
    return false;
  }

  char *end = nullptr;
  const long parsed = std::strtol(value, &end, 10);
  if (end == value || *end != '\0' || parsed <= 0 ||
      parsed > static_cast<long>(std::numeric_limits<int>::max())) {
    return false;
  }
  *out = static_cast<int>(parsed);
  return true;
}
} // namespace

void printRoverUsage(const char *prog_name) {
  std::cout << "Usage: " << prog_name
            << " [--url <ws-url>] [--token <token>] --rover-id <identity>\n";
  std::cout << "       [--serial-port <path>] [--query-rate-ms <ms>]\n";
  std::cout
      << "Env fallbacks: LIVEKIT_URL, LIVEKIT_TOKEN, ROVER_PORT (default "
         "/dev/ttyUSB0)\n";
}

std::optional<RoverConfig> parseRoverArgs(int argc, char *argv[],
                                          std::string *error) {
  RoverConfig config;
  std::vector<std::string> positional;

  for (int i = 1; i < argc; ++i) {
    if ((std::strcmp(argv[i], "--help") == 0) ||
        (std::strcmp(argv[i], "-h") == 0)) {
      return std::nullopt;
    }
    if ((std::strcmp(argv[i], "--url") == 0) && i + 1 < argc) {
      config.url = argv[++i];
      continue;
    }
    if ((std::strcmp(argv[i], "--token") == 0) && i + 1 < argc) {
      config.token = argv[++i];
      continue;
    }
    if ((std::strcmp(argv[i], "--rover-id") == 0) && i + 1 < argc) {
      config.rover_id = argv[++i];
      continue;
    }
    if ((std::strcmp(argv[i], "--serial-port") == 0) && i + 1 < argc) {
      config.serial_port = argv[++i];
      continue;
    }
    if ((std::strcmp(argv[i], "--query-rate-ms") == 0) && i + 1 < argc) {
      if (!parsePositiveInt(argv[++i], &config.query_rate_ms)) {
        if (error != nullptr) {
          *error = "invalid --query-rate-ms; expected integer > 0";
        }
        return std::nullopt;
      }
      continue;
    }
    positional.emplace_back(argv[i]);
  }

  for (const auto &arg : positional) {
    if (config.url.empty() &&
        (arg.rfind("ws://", 0) == 0 || arg.rfind("wss://", 0) == 0)) {
      config.url = arg;
    } else if (config.token.empty()) {
      config.token = arg;
    }
  }

  if (config.url.empty()) {
    const char *env = std::getenv("LIVEKIT_URL");
    if (env != nullptr) {
      config.url = env;
    }
  }
  if (config.token.empty()) {
    const char *env = std::getenv("LIVEKIT_TOKEN");
    if (env != nullptr) {
      config.token = env;
    }
  }
  if (config.serial_port == "/dev/ttyUSB0") {
    const char *env = std::getenv("ROVER_PORT");
    if (env != nullptr && *env != '\0') {
      config.serial_port = env;
    }
  }

  if (config.url.empty() || config.token.empty() || config.rover_id.empty()) {
    if (error != nullptr) {
      *error = "missing required url/token/rover-id";
    }
    return std::nullopt;
  }

  const auto token_identity = extractTokenIdentity(config.token);
  if (token_identity.has_value() && *token_identity != config.rover_id) {
    if (error != nullptr) {
      *error = "token identity '" + *token_identity +
               "' does not match --rover-id '" + config.rover_id + "'";
    }
    return std::nullopt;
  }

  return config;
}
