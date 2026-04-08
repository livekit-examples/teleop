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

#include "l3g4200d_gyro.h"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <stdexcept>
#include <thread>

static std::atomic<bool> g_running{true};

static void handleSignal(int) { g_running.store(false); }

static int parseIntArg(const char *arg, const char *name) {
  try {
    return std::stoi(arg);
  } catch (const std::exception &) {
    throw std::runtime_error(std::string("Invalid ") + name + ": " + arg);
  }
}

int main(int argc, char *argv[]) {
  try {
    int bus = 7;
    int address = 0x69;
    int period_ms = 200;

    if (argc > 1)
      bus = parseIntArg(argv[1], "bus");
    if (argc > 2)
      address = parseIntArg(argv[2], "address");
    if (argc > 3)
      period_ms = parseIntArg(argv[3], "period_ms");

    std::signal(SIGINT, handleSignal);
    std::signal(SIGTERM, handleSignal);

    WriteLine(std::cout, "[gyro_test] Starting GYRO test (bus={}, address=0x{:x}, "
                "period={}ms)",
                bus, address, period_ms);

    L3G4200D_GYRO gyro(bus, static_cast<uint8_t>(address),
                     std::chrono::milliseconds(period_ms));
    if (!gyro.init()) {
      throw std::runtime_error("GYRO initialization failed");
    }
    gyro.start();

    WriteLine(std::cout, "[gyro_test] Streaming RPY. Press Ctrl+C to stop.");

    while (g_running.load()) {
      const GYROData data = gyro.getLastGYROVal();
      if (data.valid) {
        const double roll_deg = data.angle_x_deg;
        const double pitch_deg = data.angle_y_deg;
        const double yaw_deg = data.angle_z_deg;

        WriteLine(std::cout, 
            "[gyro_test] RPY(deg): roll={:.2f}, pitch={:.2f}, yaw={:.2f}",
            roll_deg, pitch_deg, yaw_deg);
      } else {
        WriteLine(std::cerr, "[gyro_test] GYRO data not valid yet");
      }

      std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }

    gyro.stop();
    WriteLine(std::cout, "[gyro_test] Exiting");
    return 0;
  } catch (const std::exception &e) {
    WriteLine(std::cerr, "[gyro_test] {}", e.what());
    return 1;
  }
}
