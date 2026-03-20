# Copyright 2026 LiveKit
#
# L3G4200D gyroscope setup / test utility.
# Built as a subdirectory of the top-level pan_tilt_demo project so
# FetchContent dependencies (LiveKit SDK, etc.) are shared.

add_executable(Gyro
  gyro.cpp
)
target_include_directories(Gyro PRIVATE
  ${PROJECT_SOURCE_DIR}/include
)
target_link_libraries(Gyro PRIVATE LiveKit::livekit)
