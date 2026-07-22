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
    imu.header.frame_id = "imu_link";
    imu.header.stamp.sec = 12;
    imu.header.stamp.nanosec = 340000000U;
    imu.orientation = {0.1, 0.2, 0.3, 0.9};
    imu.orientation_covariance[0] = 0.5;
    imu.angular_velocity = {4.0, 5.0, 6.0};
    imu.angular_velocity_covariance[4] = 1.5;
    imu.linear_acceleration = {7.0, 8.0, 9.0};
    imu.linear_acceleration_covariance[8] = 2.5;

    teleop_msgs::ImuMsg parsed;
    std::string error;
    assert(
        teleop_msgs::fromPayload(teleop_msgs::toPayload(imu), &parsed, &error));
    assert(parsed.header.frame_id == "imu_link");
    assert(parsed.header.stamp.sec == 12);
    assert(parsed.header.stamp.nanosec == 340000000U);
    assert(parsed.orientation.z == 0.3);
    assert(parsed.orientation.w == 0.9);
    assert(parsed.orientation_covariance[0] == 0.5);
    assert(parsed.angular_velocity.y == 5.0);
    assert(parsed.angular_velocity_covariance[4] == 1.5);
    assert(parsed.linear_acceleration.x == 7.0);
    assert(parsed.linear_acceleration_covariance[8] == 2.5);
  }

  {
    // Default-valued wire sample from rover/API_README.md parses cleanly.
    teleop_msgs::ImuMsg parsed;
    std::string error;
    assert(teleop_msgs::fromPayload(
        bytesFromString(
            R"({"angular_velocity":{"x":0,"y":0,"z":0},)"
            R"("angular_velocity_covariance":[0,0,0,0,0,0,0,0,0],)"
            R"("header":{"frame_id":"","stamp":{"nanosec":0,"sec":0}},)"
            R"("linear_acceleration":{"x":0,"y":0,"z":0},)"
            R"("linear_acceleration_covariance":[0,0,0,0,0,0,0,0,0],)"
            R"("orientation":{"w":1,"x":0,"y":0,"z":0},)"
            R"("orientation_covariance":[0,0,0,0,0,0,0,0,0]})"),
        &parsed, &error));
    assert(parsed.orientation.w == 1.0);
    assert(parsed.orientation.x == 0.0);
    assert(parsed.header.frame_id.empty());
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
    teleop_msgs::ControlCmdMsg parsed;
    std::string error;
    assert(teleop_msgs::fromPayload(
        bytesFromString(
            R"({"angular":{"x":0,"y":0,"z":-0.5},"linear":{"x":0.25,"y":0,"z":0}})"),
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
        bytesFromString(
            R"({"linear":{"x":"fast","y":0,"z":0},"angular":{"x":0,"y":0,"z":0.1}})"),
        &parsed, &error));
    assert(!error.empty());
  }

  {
    teleop_msgs::ControlCmdMsg parsed;
    std::string error;
    assert(!teleop_msgs::fromPayload(
        bytesFromString(R"({"throttle_rps":0.25,"steering_rps":-0.5})"),
        &parsed, &error));
    assert(!error.empty());
  }

  std::cout << "teleop_msgs tests passed\n";
  return 0;
}
