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

/**
 * @file program_eprom.cpp
 * @brief Program the SMS/STS EEPROM with a new servo ID, and optionally
 *        calibrate the zero position.
 *
 * Usage:
 *   ./ProgramEprom <serial_port> <current_id> <new_id> [--set-zero-position]
 *
 * Examples:
 *   ./ProgramEprom /dev/ttyUSB0 1 2
 *   ./ProgramEprom /dev/ttyUSB0 1 2 --set-zero-position
 */

#include "SCServo.h"

#include <cstring>
#include <iostream>
#include <string>

namespace {
constexpr int kBaudRate = 1000000;
constexpr int kMinServoId = 0;
constexpr int kMaxServoId = 253;

void printUsage() {
  std::cout << "Usage: ProgramEprom <serial_port> <current_id> <new_id> "
               "[--set-zero-position]\n"
            << "  --set-zero-position  After writing the ID, prompt to "
               "physically set the zero\n"
            << "                       position, then call CalibrationOfs.\n"
            << "\n"
            << "Examples:\n"
            << "  ProgramEprom /dev/ttyUSB0 1 2\n"
            << "  ProgramEprom /dev/ttyUSB0 1 2 --set-zero-position\n";
}

bool isValidId(int id) {
  return id >= kMinServoId && id <= kMaxServoId;
}
} // namespace

int main(int argc, char **argv) {
  if (argc < 4) {
    printUsage();
    return 1;
  }

  const char *serial_port = argv[1];
  const int current_id = std::atoi(argv[2]);
  const int new_id = std::atoi(argv[3]);
  bool set_zero = false;

  for (int i = 4; i < argc; ++i) {
    if (std::strcmp(argv[i], "--set-zero-position") == 0) {
      set_zero = true;
    } else {
      std::cerr << "Unknown option: " << argv[i] << "\n";
      printUsage();
      return 1;
    }
  }

  if (!isValidId(current_id)) {
    std::cerr << "Invalid current_id " << current_id
              << ". Must be " << kMinServoId << "-" << kMaxServoId << ".\n";
    return 1;
  }
  if (!isValidId(new_id)) {
    std::cerr << "Invalid new_id " << new_id
              << ". Must be " << kMinServoId << "-" << kMaxServoId << ".\n";
    return 1;
  }

  SMS_STS sm_st;
  std::cout << "Opening " << serial_port << " @ " << kBaudRate << " baud\n";
  if (!sm_st.begin(kBaudRate, serial_port)) {
    std::cerr << "Failed to init SMS/STS motor on " << serial_port << "\n";
    return 1;
  }

  const auto cur = static_cast<u8>(current_id);
  const auto nid = static_cast<u8>(new_id);

  sm_st.unLockEeprom(cur);
  std::cout << "EEPROM unlocked for ID " << current_id << "\n";

  sm_st.writeByte(cur, SMS_STS_ID, nid);
  std::cout << "Wrote new ID " << new_id << " (was " << current_id << ")\n";

  sm_st.LockEeprom(nid);
  std::cout << "EEPROM locked for ID " << new_id << "\n";

  if (set_zero) {
    std::cout << "\n"
              << "=== Zero-Position Calibration ===\n"
              << "Physically move the servo (ID " << new_id
              << ") to the desired zero position.\n"
              << "Press ENTER when ready to calibrate...";
    std::cout.flush();
    std::string discard;
    std::getline(std::cin, discard);

    if (!sm_st.CalibrationOfs(nid)) {
      std::cerr << "CalibrationOfs failed for ID " << new_id << "\n";
      sm_st.end();
      return 1;
    }
    std::cout << "CalibrationOfs OK for ID " << new_id << "\n";
  }

  sm_st.end();
  std::cout << "Done.\n";
  return 0;
}
