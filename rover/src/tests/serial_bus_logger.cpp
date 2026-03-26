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
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>

namespace {
volatile std::sig_atomic_t g_running = 1;
void signalHandler(int) { g_running = 0; }

constexpr double kRadToDeg = 180.0 / 3.14159265358979323846;
constexpr auto kQueryInterval = std::chrono::milliseconds(50);
} // namespace

int main(int argc, char *argv[]) {
  std::string port = "/dev/ttyUSB0";
  if (argc > 1) {
    port = argv[1];
  } else if (const char *env = std::getenv("ROVER_PORT");
             env != nullptr && *env != '\0') {
    port = env;
  }

  std::signal(SIGINT, signalHandler);
  std::signal(SIGTERM, signalHandler);

  std::printf("[serial_bus_logger] Opening serial port: %s\n", port.c_str());
  RoverSerialBus bus(port);
  if (!bus.open()) {
    std::fprintf(stderr, "[serial_bus_logger] Failed to open serial port\n");
    return 1;
  }

  std::printf("[serial_bus_logger] Logging IMU data every 50ms. Ctrl-C to stop.\n");
  std::printf("%-12s  %-10s %-10s %-10s  %-10s %-10s %-10s  "
              "%-10s %-10s %-10s  %-10s %-10s %-10s  %s\n",
              "time_ms", "roll_deg", "pitch_deg", "yaw_deg",
              "ax_mg", "ay_mg", "az_mg",
              "gx_dps", "gy_dps", "gz_dps",
              "mx_ut", "my_ut", "mz_ut", "temp_c");

  const auto start = std::chrono::steady_clock::now();

  while (g_running) {
    bus.sendIMUQuery();

    auto imu = bus.readSerialData();
    if (imu.has_value()) {
      const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - start);

      std::printf("%-12lld  %10.2f %10.2f %10.2f  %10.2f %10.2f %10.2f  "
                  "%10.2f %10.2f %10.2f  %10.2f %10.2f %10.2f  %.2f\n",
                  static_cast<long long>(elapsed.count()),
                  imu->orientation_rad.roll * kRadToDeg,
                  imu->orientation_rad.pitch * kRadToDeg,
                  imu->orientation_rad.yaw * kRadToDeg,
                  imu->accel_mg.x, imu->accel_mg.y, imu->accel_mg.z,
                  imu->gyro_dps.x, imu->gyro_dps.y, imu->gyro_dps.z,
                  imu->mag_ut.x, imu->mag_ut.y, imu->mag_ut.z,
                  imu->temperature_c);
      std::fflush(stdout);
    }

    std::this_thread::sleep_for(kQueryInterval);
  }

  std::printf("\n[serial_bus_logger] Stopped.\n");
  return 0;
}
