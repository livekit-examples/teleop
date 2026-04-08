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
