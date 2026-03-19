# Copyright 2026 LiveKit
#
# Setup utilities for Feetech SCS/STS servos.
# Built as a subdirectory of the top-level pan_tilt_demo project so all
# FetchContent dependencies (SCServo, LiveKit SDK, etc.) are shared.

# --- ProgramEprom – writes servo ID to EEPROM ---
add_executable(ProgramEprom
  program_eprom.cpp
)
target_include_directories(ProgramEprom PRIVATE
  ${PROJECT_SOURCE_DIR}/include
)
target_link_libraries(ProgramEprom PRIVATE SCServo)

# --- Scan – scan for servos on the bus ---
add_executable(Scan
  scan.cpp
)
target_include_directories(Scan PRIVATE
  ${PROJECT_SOURCE_DIR}/include
)
target_link_libraries(Scan PRIVATE SCServo)

# --- KeyboardController – interactive velocity control via keyboard ---
add_executable(KeyboardController
  keyboard_controller.cpp
  ${PROJECT_SOURCE_DIR}/src/pan_tilt_controller.cpp
)
target_include_directories(KeyboardController PRIVATE
  ${PROJECT_SOURCE_DIR}/include
)
target_link_libraries(KeyboardController PRIVATE
  LiveKit::livekit
  SCServo
)
