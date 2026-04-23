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

/** @brief Shared topic and RPC naming helpers for the rover reference app. */
namespace rover_topics {

/** @brief RPC name used by teleop clients to claim or release rover control. */
constexpr char kAcquireControlRpc[] = "acquire_control";

/**
 * @brief Builds the LiveKit data track name for IMU telemetry.
 * @param rover_id Stable identity of the rover participant.
 * @return Track name carrying IMU samples for the rover.
 */
inline std::string imuTrackName(const std::string &rover_id) {
  return rover_id + ".imu";
}

/**
 * @brief Builds the LiveKit video track name for the Arducam feed.
 * @param rover_id Stable identity of the rover participant.
 * @return Track name carrying Arducam video for the rover.
 */
inline std::string arducamTrackName(const std::string &rover_id) {
  return rover_id + ".arducam";
}

/**
 * @brief Builds the LiveKit data track name for control commands.
 * @param rover_id Stable identity of the rover participant.
 * @return Track name carrying control commands for the rover.
 */
inline std::string controlCmdTrackName(const std::string &rover_id) {
  return rover_id + ".control_cmd";
}

} // namespace rover_topics
