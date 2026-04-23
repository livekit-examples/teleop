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

#include "teleop_msgs.h"

#include <cassert>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

namespace {
std::vector<std::uint8_t> bytesFromString(const std::string &value) {
  return std::vector<std::uint8_t>(value.begin(), value.end());
}
} // namespace

int main() {
  {
    teleop_msgs::ImuMsg imu;
    imu.orientation_rad.roll = 1.0;
    imu.orientation_rad.pitch = 2.0;
    imu.orientation_rad.yaw = 3.0;
    imu.accel_mg = {4.0, 5.0, 6.0};
    imu.gyro_dps = {7.0, 8.0, 9.0};
    imu.mag_ut = {10.0, 11.0, 12.0};
    imu.temperature_c = 13.0;

    teleop_msgs::ImuMsg parsed;
    std::string error;
    assert(
        teleop_msgs::fromPayload(teleop_msgs::toPayload(imu), &parsed, &error));
    assert(parsed.orientation_rad.yaw == 3.0);
    assert(parsed.temperature_c == 13.0);
  }

  {
    teleop_msgs::ControlCmdMsg control_cmd{0.25, -0.5};
    teleop_msgs::ControlCmdMsg parsed;
    std::string error;
    assert(teleop_msgs::fromPayload(teleop_msgs::toPayload(control_cmd),
                                    &parsed, &error));
    assert(parsed.throttle_rps == 0.25);
    assert(parsed.steering_rps == -0.5);
  }

  {
    teleop_msgs::AcquireControlRequest request{false};
    teleop_msgs::AcquireControlRequest parsed;
    std::string error;
    assert(teleop_msgs::fromPayload(teleop_msgs::toPayload(request), &parsed,
                                    &error));
    assert(parsed.acquire == false);
  }

  {
    teleop_msgs::AcquireControlRequest parsed;
    std::string error;
    assert(teleop_msgs::fromPayload(bytesFromString(R"({"release":true})"),
                                    &parsed, &error));
    assert(parsed.acquire == false);
  }

  {
    teleop_msgs::ImuMsg parsed;
    std::string error;
    assert(!teleop_msgs::fromPayload(
        bytesFromString(R"({"temperature_c":22.0})"), &parsed, &error));
    assert(!error.empty());
  }

  {
    teleop_msgs::ControlCmdMsg parsed;
    std::string error;
    assert(!teleop_msgs::fromPayload(
        bytesFromString(R"({"throttle_rps":"fast","steering_rps":0.1})"),
        &parsed, &error));
    assert(!error.empty());
  }

  std::cout << "teleop_msgs tests passed\n";
  return 0;
}
