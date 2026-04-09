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

#include "rover_serial_bus.h"

#include <cerrno>
#include <cmath>
#include <chrono>
#include <cstring>
#include <exception>
#include <iostream>
#include <string>
#include <utility>

#include <fcntl.h>
#include <termios.h>
#include <unistd.h>

#include <nlohmann/json.hpp>

namespace {
using json = nlohmann::json;

constexpr double kDegToRad = 3.14159265358979323846 / 180.0;

bool readOptionalNumber(const json &value, const char *field_name, double *out,
                        std::string *error) {
  if (!value.contains(field_name)) {
    *out = 0.0;
    return true;
  }

  const auto &field = value.at(field_name);
  if (!field.is_number()) {
    if (error != nullptr) {
      *error = std::string("serial field '") + field_name +
               "' must be numeric";
    }
    return false;
  }

  *out = field.get<double>();
  return true;
}

// If the UART sends multiple JSON objects on one line (e.g. `}{` with no newline),
// json::parse fails. Extract the first top-level `{ ... }` honoring strings.
std::optional<std::pair<std::string, std::string>>
splitFirstJsonObject(const std::string &line) {
  const size_t start = line.find_first_not_of(" \t\r\n");
  if (start == std::string::npos || line[start] != '{') {
    return std::nullopt;
  }

  int depth = 0;
  bool in_string = false;
  bool escape = false;

  for (size_t j = start; j < line.size(); ++j) {
    const char c = line[j];
    if (in_string) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c == '\\') {
        escape = true;
        continue;
      }
      if (c == '"') {
        in_string = false;
      }
      continue;
    }
    if (c == '"') {
      in_string = true;
      continue;
    }
    if (c == '{') {
      ++depth;
      continue;
    }
    if (c == '}') {
      --depth;
      if (depth == 0) {
        return std::pair<std::string, std::string>{
            line.substr(start, j - start + 1), line.substr(j + 1)};
      }
    }
  }
  return std::nullopt;
}

void prependChunkAsNextLine(std::string *read_buffer, std::string chunk) {
  while (!chunk.empty() && (chunk.front() == ' ' || chunk.front() == '\t')) {
    chunk.erase(0, 1);
  }
  while (!chunk.empty() &&
         (chunk.back() == ' ' || chunk.back() == '\t' || chunk.back() == '\r')) {
    chunk.pop_back();
  }
  if (chunk.empty()) {
    return;
  }
  read_buffer->insert(0, chunk + "\n");
}

// Typical when a line is split mid-JSON or multiple root objects share a line.
bool isTransientUartJsonParseError(const std::string &error) {
  if (error.find("invalid JSON:") == std::string::npos) {
    return false;
  }
  return error.find("unexpected end of input") != std::string::npos ||
         error.find("unexpected '{'") != std::string::npos;
}
} // namespace

namespace rover_serial_bus {
std::string imuQueryLine() { return R"({"T":126})" "\n"; }

std::string controlCommandLine(const teleop_msgs::ControlCmdMsg &cmd) {
  const double left = cmd.throttle_rps + cmd.steering_rps;
  const double right = cmd.throttle_rps - cmd.steering_rps;
  const json command = {{"T", 1}, {"L", left}, {"R", right}};
  return command.dump() + "\n";
}

std::optional<teleop_msgs::ImuMsg>
parseImuLine(const std::string &line, std::string *error) {
  if (error != nullptr) {
    error->clear();
  }

  if (line.empty()) {
    return std::nullopt;
  }

  json value;
  try {
    value = json::parse(line);
  } catch (const std::exception &e) {
    if (error != nullptr) {
      *error = std::string("invalid JSON: ") + e.what();
    }
    return std::nullopt;
  }

  if (!value.is_object()) {
    if (error != nullptr) {
      *error = "serial frame must be an object";
    }
    return std::nullopt;
  }

  if (!value.contains("T") || !value.at("T").is_number_integer() ||
      value.at("T").get<int>() != 1002) {
    return std::nullopt;
  }

  teleop_msgs::ImuMsg msg;
  double roll_deg = 0.0;
  double pitch_deg = 0.0;
  double yaw_deg = 0.0;
  if (!readOptionalNumber(value, "r", &roll_deg, error) ||
      !readOptionalNumber(value, "p", &pitch_deg, error) ||
      !readOptionalNumber(value, "y", &yaw_deg, error) ||
      !readOptionalNumber(value, "ax", &msg.accel_mg.x, error) ||
      !readOptionalNumber(value, "ay", &msg.accel_mg.y, error) ||
      !readOptionalNumber(value, "az", &msg.accel_mg.z, error) ||
      !readOptionalNumber(value, "gx", &msg.gyro_dps.x, error) ||
      !readOptionalNumber(value, "gy", &msg.gyro_dps.y, error) ||
      !readOptionalNumber(value, "gz", &msg.gyro_dps.z, error) ||
      !readOptionalNumber(value, "mx", &msg.mag_ut.x, error) ||
      !readOptionalNumber(value, "my", &msg.mag_ut.y, error) ||
      !readOptionalNumber(value, "mz", &msg.mag_ut.z, error) ||
      !readOptionalNumber(value, "temp", &msg.temperature_c, error)) {
    return std::nullopt;
  }

  msg.orientation_rad.roll = roll_deg * kDegToRad;
  msg.orientation_rad.pitch = pitch_deg * kDegToRad;
  msg.orientation_rad.yaw = yaw_deg * kDegToRad;
  return msg;
}
} // namespace rover_serial_bus

RoverSerialBus::RoverSerialBus(const std::string &serial_port)
    : serial_port_(serial_port) {}

RoverSerialBus::~RoverSerialBus() { close(); }

bool RoverSerialBus::open() {
  if (isOpen()) {
    return true;
  }

  fd_ = ::open(serial_port_.c_str(), O_RDWR | O_NOCTTY);
  if (fd_ < 0) {
    std::cerr << "[rover_serial] Failed to open " << serial_port_ << ": "
              << std::strerror(errno) << "\n";
    return false;
  }

  termios tty {};
  if (::tcgetattr(fd_, &tty) != 0) {
    std::cerr << "[rover_serial] tcgetattr failed for " << serial_port_ << ": "
              << std::strerror(errno) << "\n";
    close();
    return false;
  }

  ::cfmakeraw(&tty);
  ::cfsetispeed(&tty, B115200);
  ::cfsetospeed(&tty, B115200);
  tty.c_cflag |= (CLOCAL | CREAD);
  tty.c_cflag &= ~PARENB;
  tty.c_cflag &= ~CSTOPB;
  tty.c_cflag &= ~CSIZE;
  tty.c_cflag |= CS8;
  tty.c_cflag &= ~CRTSCTS;
  tty.c_cc[VMIN] = 0;
  tty.c_cc[VTIME] = 0;

  if (::tcsetattr(fd_, TCSANOW, &tty) != 0) {
    std::cerr << "[rover_serial] tcsetattr failed for " << serial_port_ << ": "
              << std::strerror(errno) << "\n";
    close();
    return false;
  }

  if (::tcflush(fd_, TCIOFLUSH) != 0) {
    std::cerr << "[rover_serial] tcflush failed for " << serial_port_ << ": "
              << std::strerror(errno) << "\n";
  }

  return true;
}

void RoverSerialBus::close() {
  flushTransientParseNoiseSummary();
  if (fd_ >= 0) {
    ::close(fd_);
    fd_ = -1;
  }
  read_buffer_.clear();
}

bool RoverSerialBus::isOpen() const { return fd_ >= 0; }

bool RoverSerialBus::sendIMUQuery() {
  return writeLine(rover_serial_bus::imuQueryLine());
}

void RoverSerialBus::flushTransientParseNoiseSummary() {
  if (suppressed_transient_parse_errors_ == 0) {
    return;
  }
  std::cerr << "[rover_serial] Summary: " << suppressed_transient_parse_errors_
            << " transient UART JSON framing error(s) on " << serial_port_
            << " (not logged individually)\n";
  suppressed_transient_parse_errors_ = 0;
  transient_parse_window_start_.reset();
}

void RoverSerialBus::noteDiscardedSerialFrame(const std::string &error) {
  if (isTransientUartJsonParseError(error)) {
    ++suppressed_transient_parse_errors_;
    const auto now = std::chrono::steady_clock::now();
    if (!transient_parse_window_start_.has_value()) {
      transient_parse_window_start_ = now;
    }
    constexpr auto kSummaryInterval = std::chrono::seconds(10);
    if (now - *transient_parse_window_start_ >= kSummaryInterval) {
      std::cerr << "[rover_serial] Summary: " << suppressed_transient_parse_errors_
                << " transient UART JSON framing error(s) on " << serial_port_
                << " in the last ~10s (incomplete lines / glued objects)\n";
      suppressed_transient_parse_errors_ = 0;
      transient_parse_window_start_ = now;
    }
    return;
  }
  // std::cerr << "[rover_serial] Ignoring invalid serial frame: " << error << "\n";
}

std::optional<teleop_msgs::ImuMsg> RoverSerialBus::consumeBufferedLines() {
  while (true) {
    const size_t newline = read_buffer_.find('\n');
    if (newline == std::string::npos) {
      return std::nullopt;
    }

    std::string line = read_buffer_.substr(0, newline);
    read_buffer_.erase(0, newline + 1);
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }

    std::string error;
    auto imu_msg = rover_serial_bus::parseImuLine(line, &error);
    if (imu_msg.has_value()) {
      return imu_msg;
    }
    if (error.empty()) {
      continue;
    }

    if (auto split = splitFirstJsonObject(line)) {
      std::string err2;
      imu_msg = rover_serial_bus::parseImuLine(split->first, &err2);
      if (imu_msg.has_value()) {
        prependChunkAsNextLine(&read_buffer_, split->second);
        return imu_msg;
      }
      if (err2.empty()) {
        prependChunkAsNextLine(&read_buffer_, split->second);
        continue;
      }
      noteDiscardedSerialFrame(err2);
      continue;
    }

    noteDiscardedSerialFrame(error);
  }
}

std::optional<teleop_msgs::ImuMsg> RoverSerialBus::readSerialData() {
  if (!isOpen()) {
    return std::nullopt;
  }

  if (auto buffered = consumeBufferedLines(); buffered.has_value()) {
    return buffered;
  }

  char buffer[512];
  while (true) {
    const ssize_t bytes_read = ::read(fd_, buffer, sizeof(buffer));
    if (bytes_read > 0) {
      read_buffer_.append(buffer, static_cast<size_t>(bytes_read));
      if (auto parsed = consumeBufferedLines(); parsed.has_value()) {
        return parsed;
      }
      continue;
    }
    if (bytes_read == 0) {
      return std::nullopt;
    }
    if (errno == EINTR) {
      continue;
    }
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      return std::nullopt;
    }

    std::cerr << "[rover_serial] Read failed on " << serial_port_ << ": "
              << std::strerror(errno) << "\n";
    return std::nullopt;
  }
}

bool RoverSerialBus::sendControlCommand(const teleop_msgs::ControlCmdMsg &cmd) {
  return writeLine(rover_serial_bus::controlCommandLine(cmd));
}

bool RoverSerialBus::writeLine(const std::string &line) {
  if (!isOpen()) {
    return false;
  }

  size_t total_written = 0;
  while (total_written < line.size()) {
    const ssize_t bytes_written =
        ::write(fd_, line.data() + total_written, line.size() - total_written);
    if (bytes_written > 0) {
      total_written += static_cast<size_t>(bytes_written);
      continue;
    }
    if (bytes_written < 0 && errno == EINTR) {
      continue;
    }

    std::cerr << "[rover_serial] Write failed on " << serial_port_ << ": "
              << std::strerror(errno) << "\n";
    return false;
  }

  return true;
}
