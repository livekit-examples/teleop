cmake_minimum_required(VERSION 3.20)
project(pan_tilt_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# (livekit, nlohmann_json, SDL3)
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

# --- Dependencies ---
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
find_package(realsense2 REQUIRED)
find_package(ZLIB REQUIRED)

include(Dependencies)

# setup utilities (gyro, servos, …)
add_subdirectory(setup/gyroscope)
add_subdirectory(setup/servos)

# build the participants
add_executable(PanTiltRobot
  src/pan_tilt_main.cpp
  src/pan_tilt_livekit.cpp
  src/pan_tilt_controller.cpp
  src/realsense_camera.cpp
)
target_include_directories(PanTiltRobot PRIVATE include)
target_link_libraries(PanTiltRobot PRIVATE
  LiveKit::livekit_bridge
  SCServo
  nlohmann_json::nlohmann_json
  ZLIB::ZLIB
  ${realsense2_LIBRARY}
)

add_executable(TeleopController
  src/teleop_main.cpp
)
target_include_directories(TeleopController PRIVATE
  include
  ${realsense2_INCLUDE_DIR}
)
target_link_libraries(TeleopController PRIVATE
  LiveKit::livekit_bridge
  SDL3::SDL3
  nlohmann_json::nlohmann_json
  ZLIB::ZLIB
)
