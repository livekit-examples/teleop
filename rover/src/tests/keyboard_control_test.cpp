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
#include "teleop_msgs.h"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>
#include <termios.h>
#include <thread>
#include <unistd.h>

namespace {

std::atomic<bool> g_running{true};
void signalHandler(int) { g_running.store(false, std::memory_order_release); }

// Restores terminal settings on destruction.
class RawTerminal {
public:
  RawTerminal() {
    tcgetattr(STDIN_FILENO, &original_);
    struct termios raw = original_;
    raw.c_lflag &= ~(ICANON | ECHO | ISIG);
    raw.c_cc[VMIN] = 0;
    raw.c_cc[VTIME] = 1;
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw);
  }
  ~RawTerminal() { tcsetattr(STDIN_FILENO, TCSAFLUSH, &original_); }

  RawTerminal(const RawTerminal &) = delete;
  RawTerminal &operator=(const RawTerminal &) = delete;

private:
  struct termios original_ {};
};

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

  std::printf("[keyboard_control] Opening serial port: %s\n", port.c_str());
  auto bus = std::make_shared<RoverSerialBus>(port);
  if (!bus->open()) {
    std::fprintf(stderr, "[keyboard_control] Failed to open serial port\n");
    return 1;
  }

  std::printf("[keyboard_control] Controls (hold to move, release to stop):\n");
  std::printf("  W - forward\n");
  std::printf("  S - backward\n");
  std::printf("  A - rotate left\n");
  std::printf("  D - rotate right\n");
  std::printf("  Ctrl-C - quit\n\n");

  RawTerminal raw_terminal;
  KeyboardController keyboard(bus);
  keyboard.setStopRequestCallback(
      [] { g_running.store(false, std::memory_order_release); });
  keyboard.start();

  while (g_running.load(std::memory_order_acquire)) {
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }

  keyboard.stop();

  teleop_msgs::ControlCmdMsg stop{};
  bus->sendControlCommand(stop);

  std::printf("\n[keyboard_control] Stopped.\n");
  return 0;
}
