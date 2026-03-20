# Dependencies.cmake
#
# FetchContent declarations for third-party libraries that are not part of
# the LiveKit SDK.  Included once from the top-level CMakeLists.txt after
# CMAKE_MODULE_PATH is set.

include_guard(GLOBAL)
include(FetchContent)

# ---- SCServo (Feetech serial-bus servo SDK) --------------------------------
FetchContent_Declare(SCServo_Linux
  GIT_REPOSITORY https://github.com/adityakamath/SCServo_Linux.git
  GIT_TAG        main
  GIT_SHALLOW    TRUE
)

# ---- SDL3 ------------------------------------------------------------------
FetchContent_Declare(SDL3
  GIT_REPOSITORY https://github.com/libsdl-org/SDL.git
  GIT_TAG        release-3.4.2
  GIT_SHALLOW    TRUE
)
set(SDL_TEST     OFF CACHE BOOL "" FORCE)
set(SDL_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SDL_INSTALL  OFF CACHE BOOL "" FORCE)

# ---- nlohmann/json ---------------------------------------------------------
FetchContent_Declare(nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        v3.11.3
  GIT_SHALLOW    TRUE
)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)

# ---- Fetch everything -------------------------------------------------------
FetchContent_MakeAvailable(SCServo_Linux SDL3 nlohmann_json)
