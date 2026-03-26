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
#include "rover_serial_bus.h"

#include <cassert>
#include <cmath>
#include <iostream>
#include <string>

namespace {
constexpr double kPi = 3.14159265358979323846;

void testImuQueryEncoding() {
  assert(rover_serial_bus::imuQueryLine() == std::string(R"({"T":126})"
                                                         "\n"));
}

void testImuParsingAndUnitConversion() {
  std::string error;
  const auto imu = rover_serial_bus::parseImuLine(
      R"({"T":1002,"r":180.0,"p":90.0,"y":-45.0,"ax":1,"ay":2,"az":3,"gx":4,"gy":5,"gz":6,"mx":7,"my":8,"mz":9,"temp":10.5})",
      &error);
  assert(error.empty());
  assert(imu.has_value());
  assert(std::abs(imu->orientation_rad.roll - kPi) < 1e-9);
  assert(std::abs(imu->orientation_rad.pitch - (kPi / 2.0)) < 1e-9);
  assert(std::abs(imu->orientation_rad.yaw + (kPi / 4.0)) < 1e-9);
  assert(imu->accel_mg.x == 1.0);
  assert(imu->gyro_dps.z == 6.0);
  assert(imu->mag_ut.y == 8.0);
  assert(imu->temperature_c == 10.5);
}

void testMalformedJsonIsRejected() {
  std::string error;
  const auto imu = rover_serial_bus::parseImuLine(R"({"T":1002)", &error);
  assert(!imu.has_value());
  assert(!error.empty());
}

void testNonImuFramesAreIgnored() {
  std::string error;
  const auto imu =
      rover_serial_bus::parseImuLine(R"({"T":1,"L":0.1,"R":0.2})", &error);
  assert(!imu.has_value());
  assert(error.empty());
}

void testControlCommandMixing() {
  const teleop_msgs::ControlCmdMsg cmd{0.25, -0.5};
  const std::string line = rover_serial_bus::controlCommandLine(cmd);
  assert(line.find(R"("T":1)") != std::string::npos);
  assert(line.find(R"("L":-0.25)") != std::string::npos);
  assert(line.find(R"("R":0.75)") != std::string::npos);
}

void testParseArgsDefaultsAndOverride() {
  {
    char arg0[] = "RoverRobot";
    char arg1[] = "--url";
    char arg2[] = "wss://example";
    char arg3[] = "--token";
    char arg4[] = "header.eyJzdWIiOiJyb3Zlci0xIn0.sig";
    char arg5[] = "--rover-id";
    char arg6[] = "rover-1";
    char *argv[] = {arg0, arg1, arg2, arg3, arg4, arg5, arg6};
    std::string error;
    const auto config = parseRoverArgs(
        static_cast<int>(sizeof(argv) / sizeof(argv[0])), argv, &error);
    assert(config.has_value());
    assert(error.empty());
    assert(config->serial_port == "/dev/ttyUSB0");
    assert(config->query_rate_ms == 100);
  }

  {
    char arg0[] = "RoverRobot";
    char arg1[] = "--url";
    char arg2[] = "wss://example";
    char arg3[] = "--token";
    char arg4[] = "header.eyJzdWIiOiJyb3Zlci0xIn0.sig";
    char arg5[] = "--rover-id";
    char arg6[] = "rover-1";
    char arg7[] = "--serial-port";
    char arg8[] = "/dev/serial0";
    char arg9[] = "--query-rate-ms";
    char arg10[] = "250";
    char *argv[] = {arg0, arg1, arg2, arg3, arg4, arg5,
                    arg6, arg7, arg8, arg9, arg10};
    std::string error;
    const auto config = parseRoverArgs(
        static_cast<int>(sizeof(argv) / sizeof(argv[0])), argv, &error);
    assert(config.has_value());
    assert(error.empty());
    assert(config->serial_port == "/dev/serial0");
    assert(config->query_rate_ms == 250);
  }
}

void testParseArgsRejectsInvalidQueryRate() {
  char arg0[] = "RoverRobot";
  char arg1[] = "--url";
  char arg2[] = "wss://example";
  char arg3[] = "--token";
  char arg4[] = "header.eyJzdWIiOiJyb3Zlci0xIn0.sig";
  char arg5[] = "--rover-id";
  char arg6[] = "rover-1";
  char arg7[] = "--query-rate-ms";
  char arg8[] = "0";
  char *argv[] = {arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8};

  std::string error;
  const auto config = parseRoverArgs(
      static_cast<int>(sizeof(argv) / sizeof(argv[0])), argv, &error);
  assert(!config.has_value());
  assert(error == "invalid --query-rate-ms; expected integer > 0");
}
} // namespace

int main() {
  testImuQueryEncoding();
  testImuParsingAndUnitConversion();
  testMalformedJsonIsRejected();
  testNonImuFramesAreIgnored();
  testControlCommandMixing();
  testParseArgsDefaultsAndOverride();
  testParseArgsRejectsInvalidQueryRate();

  std::cout << "rover serial bus tests passed\n";
  return 0;
}
