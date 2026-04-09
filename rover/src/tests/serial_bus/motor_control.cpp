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
#include "teleop_msgs.h"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

namespace {

constexpr double kDriveRps = 0.5;
constexpr double kTurnRps = 0.5;
constexpr auto kPhaseDuration = std::chrono::seconds(2);
constexpr auto kCommandInterval = std::chrono::milliseconds(50);

void sendCommandForDuration(RoverSerialBus &bus,
                            const teleop_msgs::ControlCmdMsg &cmd,
                            std::chrono::milliseconds duration) {
  const auto start = std::chrono::steady_clock::now();
  while (std::chrono::steady_clock::now() - start < duration) {
    if (!bus.sendControlCommand(cmd)) {
      std::cerr << "[motor_control] Failed to send command\n";
      return;
    }
    std::this_thread::sleep_for(kCommandInterval);
  }
}

void stopMotors(RoverSerialBus &bus) {
  teleop_msgs::ControlCmdMsg stop{};
  bus.sendControlCommand(stop);
}

} // namespace

int main(int argc, char *argv[]) {
  std::string port = "/dev/ttyUSB0";
  if (argc > 1) {
    port = argv[1];
  } else if (const char *env = std::getenv("ROVER_PORT");
             env != nullptr && *env != '\0') {
    port = env;
  }

  std::cout << "[motor_control] Opening serial port: " << port << "\n";
  RoverSerialBus bus(port);
  if (!bus.open()) {
    std::cerr << "[motor_control] Failed to open serial port\n";
    return 1;
  }

  std::cout << "[motor_control] Forward for 2s\n";
  sendCommandForDuration(bus, {kDriveRps, 0.0}, kPhaseDuration);
  stopMotors(bus);

  std::cout << "[motor_control] Backward for 2s\n";
  sendCommandForDuration(bus, {-kDriveRps, 0.0}, kPhaseDuration);
  stopMotors(bus);

  std::cout << "[motor_control] Rotate left for 2s\n";
  sendCommandForDuration(bus, {0.0, -kTurnRps}, kPhaseDuration);
  stopMotors(bus);

  std::cout << "[motor_control] Rotate right for 2s\n";
  sendCommandForDuration(bus, {0.0, kTurnRps}, kPhaseDuration);
  stopMotors(bus);

  std::cout << "[motor_control] Done\n";
  return 0;
}
