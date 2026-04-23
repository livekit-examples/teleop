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

#include "keyboard_controller.h"
#include "rover_serial_bus.h"

#include <chrono>
#include <unistd.h>

namespace {
constexpr double kThrottleRps = 1.0;
constexpr double kSteeringRps = 1.0;

using SteadyClock = std::chrono::steady_clock;
using Millis = std::chrono::milliseconds;

// Grace period after the last keypress before sending a stop command.
// Must exceed the OS key-repeat delay (typically 300-500ms).
constexpr Millis kKeyReleaseTimeout{600};
} // namespace

KeyboardController::KeyboardController(std::shared_ptr<RoverSerialBus> bus)
    : bus_(std::move(bus)) {}

KeyboardController::KeyboardController(ControlCmdCallback cmd_cb)
    : cmd_cb_(std::move(cmd_cb)) {}

KeyboardController::~KeyboardController() { stop(); }

void KeyboardController::start() {
  bool expected = false;
  if (!running_.compare_exchange_strong(expected, true)) {
    return;
  }
  thread_ = std::thread(&KeyboardController::run, this);
}

void KeyboardController::stop() {
  running_.store(false);
  if (thread_.joinable()) {
    thread_.join();
  }
}

void KeyboardController::setStopRequestCallback(StopRequestCallback cb) {
  stop_request_cb_ = std::move(cb);
}

void KeyboardController::run() {
  teleop_msgs::ControlCmdMsg active_cmd{};
  auto last_keypress = SteadyClock::now();

  while (running_.load()) {
    char key = 0;
    const ssize_t n = read(STDIN_FILENO, &key, 1);

    if (n <= 0) {
      if (active_cmd.throttle_rps != 0.0 || active_cmd.steering_rps != 0.0) {
        if (SteadyClock::now() - last_keypress >= kKeyReleaseTimeout) {
          active_cmd = {};
        }
        dispatchCommand(active_cmd);
      }
      continue;
    }

    last_keypress = SteadyClock::now();

    switch (key) {
    case 'w':
    case 'W':
      active_cmd.throttle_rps = kThrottleRps;
      active_cmd.steering_rps = 0.0;
      break;
    case 's':
    case 'S':
      active_cmd.throttle_rps = -kThrottleRps;
      active_cmd.steering_rps = 0.0;
      break;
    case 'a':
    case 'A':
      active_cmd.throttle_rps = 0.0;
      active_cmd.steering_rps = kSteeringRps;
      break;
    case 'd':
    case 'D':
      active_cmd.throttle_rps = 0.0;
      active_cmd.steering_rps = -kSteeringRps;
      break;
    case 3: // Ctrl-C
      active_cmd = {};
      dispatchCommand(active_cmd);
      running_.store(false);
      if (stop_request_cb_) {
        stop_request_cb_();
      }
      return;
    default:
      continue;
    }

    dispatchCommand(active_cmd);
  }

  active_cmd = {};
  dispatchCommand(active_cmd);
}

void KeyboardController::dispatchCommand(
    const teleop_msgs::ControlCmdMsg &cmd) {
  if (cmd_cb_) {
    cmd_cb_(cmd);
  }
  if (bus_) {
    bus_->sendControlCommand(cmd);
  }
}
