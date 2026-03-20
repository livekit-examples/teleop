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

#include "pan_tilt_controller.h"

#include <array>
#include <atomic>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

#ifndef _WIN32
#include <termios.h>
#include <unistd.h>
#endif

namespace
{
constexpr s16 kVelocityStepsPerSec = 1400;
constexpr int kPanIndex = 0;
constexpr int kTiltIndex = 1;

std::atomic<bool> g_running{true};

#ifndef _WIN32
struct termios g_original_termios {
};
bool g_raw_mode_enabled = false;
#endif

void handleSignal(int)
{
	g_running.store(false);
}

int parseServoId(const char* value, const char* name)
{
	try {
		const int id = std::stoi(value);
		if (id < 0 || id > 253) {
			throw std::runtime_error(std::string(name) + " out of range [0, 253]: " + value);
		}
		return id;
	} catch (const std::exception&) {
		throw std::runtime_error(std::string("Invalid ") + name + ": " + value);
	}
}

#ifndef _WIN32
void disableRawMode()
{
	if (g_raw_mode_enabled) {
		tcsetattr(STDIN_FILENO, TCSAFLUSH, &g_original_termios);
		g_raw_mode_enabled = false;
	}
}

void enableRawMode()
{
	if (tcgetattr(STDIN_FILENO, &g_original_termios) != 0) {
		throw std::runtime_error("Failed to read terminal attributes");
	}

	struct termios raw = g_original_termios;
	raw.c_lflag &= ~(ICANON | ECHO);
	raw.c_cc[VMIN] = 1;
	raw.c_cc[VTIME] = 0;
	if (tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw) != 0) {
		throw std::runtime_error("Failed to set raw terminal mode");
	}
	g_raw_mode_enabled = true;
}

char readKeyBlocking()
{
	char key = 0;
	if (read(STDIN_FILENO, &key, 1) != 1) {
		throw std::runtime_error("Failed to read key input");
	}
	return key;
}
#else
void disableRawMode() {}
void enableRawMode() {}
char readKeyBlocking()
{
	char key = 0;
	std::cin.get(key);
	return key;
}
#endif

class KeyboardController
{
  public:
	KeyboardController(const std::string& serial_port, const u8 pan_id, const u8 tilt_id,
	                   const bool run_calibration_ofs)
	    : pan_tilt_(serial_port, {pan_id, tilt_id}), run_calibration_ofs_(run_calibration_ofs)
	{
	}

	void run()
	{
		LK_LOG_INFO("[keyboard_controller] Initializing pan/tilt controller");
		if (!pan_tilt_.initialize(run_calibration_ofs_)) {
			throw std::runtime_error("PanTiltController initialization failed");
		}

		if (!pan_tilt_.haltMotors()) {
			throw std::runtime_error("Failed to set initial zero velocities");
		}

		// Create a thread that runs
		// a lambda expression
		// std::thread t([this]() {
		// 	while (g_running.load()) {
		// 		auto pan_state = pan_tilt_.pollState()[kPanIndex];
		// 		auto tilt_state = pan_tilt_.pollState()[kTiltIndex];
		// 		LK_LOG_INFO("[keyboard_controller] [POLL] [PAN] ticks={}, current(milliamps)={}, speed={}",
		// 		            pan_state.position_ticks, pan_state.current_milliamps, pan_state.speed);
		// 		LK_LOG_INFO("[keyboard_controller] [POLL] [TILT] ticks={}, current(milliamps)={}, speed={}",
		// 		            tilt_state.position_ticks, tilt_state.current_milliamps, tilt_state.speed);
		// 		usleep(10000 * 1000);
		// 	}
		// });

		LK_LOG_INFO("[keyboard_controller] Ready. Controls: a=pan CCW, d=pan CW, "
		            "w=tilt CCW, x=tilt CW, space=stop, q=quit");

		while (g_running.load()) {
			const char key = readKeyBlocking();
			if (!g_running.load()) {
				break;
			}

			switch (key) {
			case 'a':
			case 'A':
				commandPanCcw();
				break;
			case 'd':
			case 'D':
				commandPanCw();
				break;
			case 'w':
			case 'W':
				commandTiltCcw();
				break;
			case 'x':
			case 'X':
				commandTiltCw();
				break;
			case ' ':
				if (!pan_tilt_.haltMotors()) {
					throw std::runtime_error("Failed to stop motors");
				}
				LK_LOG_INFO("[keyboard_controller] Stopped all motors");
				break;
			case 'q':
			case 'Q':
				LK_LOG_INFO("[keyboard_controller] Quit requested");
				g_running.store(false);
				break;
			case 's':
			case 'S':
				LK_LOG_INFO("[keyboard_controller] Stopping all motors");
				if (!pan_tilt_.haltMotors()) {
					throw std::runtime_error("Failed to halt all motors");
				}
				break;
			default:
				LK_LOG_DEBUG("[keyboard_controller] Ignoring key '{}'", key);
				break;
			}
		}

		if (!pan_tilt_.haltMotors()) {
			LK_LOG_WARN("[keyboard_controller] Failed to stop motors during exit");
		}
	}

  private:
	void commandPanCcw()
	{
		if (!pan_tilt_.setVelocity(kPanIndex, +kVelocityStepsPerSec)) {
			throw std::runtime_error("Failed to command pan CCW velocity");
		}
		LK_LOG_INFO("[keyboard_controller] Pan CCW at {}", kVelocityStepsPerSec);
	}

	void commandPanCw()
	{
		if (!pan_tilt_.setVelocity(kPanIndex, -kVelocityStepsPerSec)) {
			throw std::runtime_error("Failed to command pan CW velocity");
		}
		LK_LOG_INFO("[keyboard_controller] Pan CW at {}", kVelocityStepsPerSec);
	}

	void commandTiltCcw()
	{
		if (!pan_tilt_.setVelocity(kTiltIndex, +kVelocityStepsPerSec)) {
			throw std::runtime_error("Failed to command tilt CCW velocity");
		}
		LK_LOG_INFO("[keyboard_controller] Tilt CCW at {}", kVelocityStepsPerSec);
	}

	void commandTiltCw()
	{
		if (!pan_tilt_.setVelocity(kTiltIndex, -kVelocityStepsPerSec)) {
			throw std::runtime_error("Failed to command tilt CW velocity");
		}
		LK_LOG_INFO("[keyboard_controller] Tilt CW at {}", kVelocityStepsPerSec);
	}

	PanTiltController pan_tilt_;
	bool run_calibration_ofs_;
};
} // namespace

int main(int argc, char* argv[])
{
	try {
		if (argc < 2 || argc > 5) {
			LK_LOG_ERROR("Usage: KeyboardController <serial-port> [pan-id] [tilt-id] [--calibrate-ofs]");
			LK_LOG_ERROR("Example: KeyboardController /dev/ttyUSB0");
			LK_LOG_ERROR("Example: KeyboardController /dev/ttyUSB0 1 2");
			return 1;
		}

		std::signal(SIGINT, handleSignal);
		std::signal(SIGTERM, handleSignal);

		const std::string serial_port = argv[1];
		int pan_id = 1;
		int tilt_id = 2;
		bool run_calibration_ofs = false;

		std::array<std::string, 3> option_args = {"", "", ""};
		int option_count = 0;
		for (int i = 2; i < argc; ++i) {
			option_args[option_count++] = argv[i];
		}

		int id_count = 0;
		for (int i = 0; i < option_count; ++i) {
			if (option_args[i] == "--calibrate-ofs") {
				run_calibration_ofs = true;
				continue;
			}
			if (id_count == 0) {
				pan_id = parseServoId(option_args[i].c_str(), "pan-id");
				++id_count;
			} else if (id_count == 1) {
				tilt_id = parseServoId(option_args[i].c_str(), "tilt-id");
				++id_count;
			} else {
				throw std::runtime_error("Unexpected argument: " + option_args[i]);
			}
		}

		if (id_count == 1) {
			throw std::runtime_error("Provide both [pan-id] and [tilt-id], or neither");
		}
		if (pan_id == tilt_id) {
			throw std::runtime_error("pan-id and tilt-id must be unique");
		}

		LK_LOG_INFO("[keyboard_controller] Starting on {} with pan-id={} tilt-id={} "
		            "velocity={}",
		            serial_port, pan_id, tilt_id, kVelocityStepsPerSec);

		enableRawMode();
		KeyboardController controller(serial_port, static_cast<u8>(pan_id), static_cast<u8>(tilt_id),
		                              run_calibration_ofs);
		controller.run();
		disableRawMode();
		LK_LOG_INFO("[keyboard_controller] Exiting");
		return 0;
	} catch (const std::exception& e) {
		disableRawMode();
		LK_LOG_ERROR("[keyboard_controller] {}", e.what());
		return 1;
	}
}
