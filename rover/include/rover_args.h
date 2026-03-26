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

#include "rover_config.h"

#include <optional>
#include <string>

/**
 * @brief Parses command-line arguments and environment fallbacks into config.
 * @param argc Argument count from `main()`.
 * @param argv Argument vector from `main()`.
 * @param error Optional destination for a human-readable parse failure.
 * @return Parsed rover configuration on success, or `std::nullopt` on failure.
 */
std::optional<RoverConfig> parseRoverArgs(int argc, char *argv[],
                                          std::string *error = nullptr);
/**
 * @brief Prints the supported CLI flags and environment variables.
 * @param prog_name Program name shown in the generated usage text.
 */
void printRoverUsage(const char *prog_name);
