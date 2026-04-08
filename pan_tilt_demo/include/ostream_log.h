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
