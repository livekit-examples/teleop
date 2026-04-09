# Dependencies.cmake
#
# FetchContent declarations for third-party libraries that are not part of
# the LiveKit SDK.  Included once from the top-level CMakeLists.txt after
# CMAKE_MODULE_PATH is set.

include_guard(GLOBAL)
include(FetchContent)

if(LINUX)
  # ---- librealsense2 -------------------------------------------------------
  # Follow the upstream Ubuntu installation flow from:
  # https://github.com/realsenseai/librealsense/blob/master/doc/installation.md
  #
  # The SDK is expected to be installed on the system (typically into
  # /usr/local after building from source). If you installed into a custom
  # prefix, point REALSENSE_LOCAL_INSTALL_DIR at that prefix so CMake can find
  # realsense2Config.cmake.
  set(REALSENSE_LOCAL_INSTALL_DIR "" CACHE PATH
    "Path to a local librealsense2 install prefix")

  if(REALSENSE_LOCAL_INSTALL_DIR)
    message(STATUS "Using local librealsense2 install: ${REALSENSE_LOCAL_INSTALL_DIR}")
    list(PREPEND CMAKE_PREFIX_PATH "${REALSENSE_LOCAL_INSTALL_DIR}")
  endif()

  find_package(realsense2 REQUIRED)

  if(TARGET realsense2::realsense2)
    set(PAN_TILT_DEMO_REALSENSE_TARGET realsense2::realsense2)
  elseif(DEFINED realsense2_LIBRARY)
    set(PAN_TILT_DEMO_REALSENSE_TARGET ${realsense2_LIBRARY})
  else()
    message(FATAL_ERROR
      "Found librealsense2, but no imported target or library variable was exported.")
  endif()

  # ---- SCServo (Feetech serial-bus servo SDK) ------------------------------
  FetchContent_Declare(SCServo_Linux
    GIT_REPOSITORY https://github.com/adityakamath/SCServo_Linux.git
    GIT_TAG        main
    GIT_SHALLOW    TRUE
  )
endif()

# ---- SDL3 ------------------------------------------------------------------
FetchContent_Declare(SDL3
  GIT_REPOSITORY https://github.com/libsdl-org/SDL.git
  GIT_TAG        release-3.4.2
  GIT_SHALLOW    TRUE
)
set(SDL_TEST     OFF CACHE BOOL "" FORCE)
set(SDL_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SDL_INSTALL  OFF CACHE BOOL "" FORCE)
if(APPLE)
  # SDL should use Cocoa on macOS. Explicitly disable X11 feature probes so
  # Apple builds do not fail on Linux-only optional packages like XSCRNSAVER.
  set(SDL_X11              OFF CACHE BOOL "" FORCE)
  set(SDL_X11_XCURSOR      OFF CACHE BOOL "" FORCE)
  set(SDL_X11_XDBE         OFF CACHE BOOL "" FORCE)
  set(SDL_X11_XFIXES       OFF CACHE BOOL "" FORCE)
  set(SDL_X11_XINPUT       OFF CACHE BOOL "" FORCE)
  set(SDL_X11_XRANDR       OFF CACHE BOOL "" FORCE)
  set(SDL_X11_XSCRNSAVER   OFF CACHE BOOL "" FORCE)
  set(SDL_X11_XSHAPE       OFF CACHE BOOL "" FORCE)
  set(SDL_X11_XSYNC        OFF CACHE BOOL "" FORCE)
endif()

# ---- nlohmann/json ---------------------------------------------------------
FetchContent_Declare(nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        v3.11.3
  GIT_SHALLOW    TRUE
)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)

# ---- Fetch everything -------------------------------------------------------
if(LINUX)
  FetchContent_MakeAvailable(SCServo_Linux SDL3 nlohmann_json)
else()
  FetchContent_MakeAvailable(SDL3 nlohmann_json)
endif()
