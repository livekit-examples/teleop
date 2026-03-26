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

#pragma once

#include <string>

/**
 * @brief Static configuration needed to start the rover application.
 */
struct RoverConfig {
  std::string url;      ///< LiveKit server WebSocket URL.
  std::string token;    ///< Access token used by the rover participant.
  std::string rover_id; ///< Stable rover identity used in room presence.
  std::string serial_port{"/dev/ttyUSB0"}; ///< UART device path for the MCU.
  int query_rate_ms{100}; ///< Interval between IMU query commands in ms.
  int video_width{1280};  ///< Requested published video width in pixels.
  int video_height{720};  ///< Requested published video height in pixels.
};
