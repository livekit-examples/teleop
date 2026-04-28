#
# Copyright 2026 LiveKit
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

cmake_minimum_required(VERSION 3.20)
project(rover LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

set(LIVEKIT_SDK_VERSION "latest" CACHE STRING "LiveKit C++ SDK version to download")
set(LIVEKIT_LOCAL_SDK_DIR "" CACHE PATH "Path to a local LiveKit SDK install prefix (skips download)")

if(LIVEKIT_LOCAL_SDK_DIR)
  message(STATUS "Using local LiveKit SDK: ${LIVEKIT_LOCAL_SDK_DIR}")
  list(PREPEND CMAKE_PREFIX_PATH "${LIVEKIT_LOCAL_SDK_DIR}")
else()
  include(LiveKitSDK)
  livekit_sdk_setup(
    VERSION "${LIVEKIT_SDK_VERSION}"
    SDK_DIR "${CMAKE_BINARY_DIR}/_deps/livekit-sdk"
    GITHUB_TOKEN "$ENV{GITHUB_TOKEN}"
  )
endif()

find_package(LiveKit CONFIG REQUIRED)
find_package(ZLIB REQUIRED)

include(Dependencies)

get_filename_component(_lk_cmake_dir "${LiveKit_DIR}" DIRECTORY)
get_filename_component(_lk_lib_dir "${_lk_cmake_dir}" DIRECTORY)

if(LINUX)
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(LIBCAMERA REQUIRED libcamera)

  add_executable(RoverRobot
    src/arducam_camera.cpp
    src/rover_args.cpp
    src/rover_main.cpp
    src/rover.cpp
    src/rover_serial_bus.cpp
  )
  target_include_directories(RoverRobot PRIVATE include ${LIBCAMERA_INCLUDE_DIRS})
  target_link_libraries(RoverRobot PRIVATE
    LiveKit::livekit
    nlohmann_json::nlohmann_json
    ZLIB::ZLIB
    ${LIBCAMERA_LIBRARIES}
  )
  target_link_directories(RoverRobot PRIVATE "${_lk_lib_dir}")
endif()

add_executable(RoverController
  src/keyboard_controller.cpp
  src/rover_serial_bus.cpp
  src/teleop_main.cpp
)
target_include_directories(RoverController PRIVATE include)
target_link_libraries(RoverController PRIVATE
  LiveKit::livekit
  SDL3::SDL3
  nlohmann_json::nlohmann_json
  ZLIB::ZLIB
)
target_link_directories(RoverController PRIVATE "${_lk_lib_dir}")

add_executable(SimpleParticipant
  src/simple_participant.cpp
)
target_include_directories(SimpleParticipant PRIVATE include)
target_link_libraries(SimpleParticipant PRIVATE
  LiveKit::livekit
  ZLIB::ZLIB
)
target_link_directories(SimpleParticipant PRIVATE "${_lk_lib_dir}")

enable_testing()

add_executable(TeleopMsgsTest
  tests/teleop_msgs_test.cpp
)
target_include_directories(TeleopMsgsTest PRIVATE include)
target_link_libraries(TeleopMsgsTest PRIVATE
  nlohmann_json::nlohmann_json
)
add_test(NAME TeleopMsgsTest COMMAND TeleopMsgsTest)

add_executable(RoverSerialBusTest
  src/rover_args.cpp
  src/rover_serial_bus.cpp
  tests/rover_serial_bus_test.cpp
)
target_include_directories(RoverSerialBusTest PRIVATE include)
target_link_libraries(RoverSerialBusTest PRIVATE
  nlohmann_json::nlohmann_json
)
add_test(NAME RoverSerialBusTest COMMAND RoverSerialBusTest)

if(LINUX)
  add_executable(MotorControlTest
    src/rover_serial_bus.cpp
    src/tests/serial_bus/motor_control.cpp
  )
  target_include_directories(MotorControlTest PRIVATE include)
  target_link_libraries(MotorControlTest PRIVATE
    nlohmann_json::nlohmann_json
  )

  add_executable(KeyboardControlTest
    src/rover_serial_bus.cpp
    src/keyboard_controller.cpp
    src/tests/keyboard_control_test.cpp
  )
  target_include_directories(KeyboardControlTest PRIVATE include)
  target_link_libraries(KeyboardControlTest PRIVATE
    nlohmann_json::nlohmann_json
  )

  add_executable(SerialBusLoggerTest
    src/rover_serial_bus.cpp
    src/tests/serial_bus_logger.cpp
  )
  target_include_directories(SerialBusLoggerTest PRIVATE include)
  target_link_libraries(SerialBusLoggerTest PRIVATE
    nlohmann_json::nlohmann_json
  )

  find_package(PNG REQUIRED)

  add_executable(CameraCaptureTest
    src/tests/camera_capture_test.cpp
  )
  target_include_directories(CameraCaptureTest PRIVATE ${LIBCAMERA_INCLUDE_DIRS})
  target_link_libraries(CameraCaptureTest PRIVATE
    ${LIBCAMERA_LIBRARIES}
    PNG::PNG
  )
endif()
