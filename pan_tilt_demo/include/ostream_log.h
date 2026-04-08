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

#include <iostream>
#include <string_view>
#include <utility>

#include <fmt/format.h>

inline void WriteLine(std::ostream& stream, std::string_view message) {
  stream << message << '\n';
}

template <typename... Args>
inline void WriteLine(std::ostream& stream, fmt::format_string<Args...> format,
                      Args&&... args) {
  stream << fmt::format(format, std::forward<Args>(args)...) << '\n';
}

namespace console_log {

template <typename... Args>
inline void trace(fmt::format_string<Args...> format, Args&&... args) {
  WriteLine(std::cout, format, std::forward<Args>(args)...);
}

template <typename... Args>
inline void debug(fmt::format_string<Args...> format, Args&&... args) {
  WriteLine(std::cout, format, std::forward<Args>(args)...);
}

template <typename... Args>
inline void info(fmt::format_string<Args...> format, Args&&... args) {
  WriteLine(std::cout, format, std::forward<Args>(args)...);
}

template <typename... Args>
inline void warn(fmt::format_string<Args...> format, Args&&... args) {
  WriteLine(std::cerr, format, std::forward<Args>(args)...);
}

template <typename... Args>
inline void error(fmt::format_string<Args...> format, Args&&... args) {
  WriteLine(std::cerr, format, std::forward<Args>(args)...);
}

template <typename... Args>
inline void critical(fmt::format_string<Args...> format, Args&&... args) {
  WriteLine(std::cerr, format, std::forward<Args>(args)...);
}

}  // namespace console_log
