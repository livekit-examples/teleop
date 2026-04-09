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

include_guard(GLOBAL)
include(FetchContent)

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
find_package(nlohmann_json QUIET CONFIG)
if(NOT nlohmann_json_FOUND)
  FetchContent_Declare(nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
    GIT_SHALLOW    TRUE
  )
  set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
endif()

# ---- Fetch everything -------------------------------------------------------
if(nlohmann_json_FOUND)
  FetchContent_MakeAvailable(SDL3)
else()
  FetchContent_MakeAvailable(SDL3 nlohmann_json)
endif()
