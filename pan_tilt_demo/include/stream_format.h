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

#ifndef STREAM_FORMAT_H
#define STREAM_FORMAT_H

#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>

namespace stream_format {
namespace detail {

template <typename T, bool = std::is_enum_v<T>>
struct HexPrintType {
  using type = T;
};

template <typename T>
struct HexPrintType<T, true> {
  using type = std::underlying_type_t<T>;
};

inline void appendLiteral(std::ostringstream &stream, const std::string &text,
                          std::size_t start, std::size_t length) {
  stream.write(text.data() + static_cast<std::streamoff>(start),
               static_cast<std::streamsize>(length));
}

template <typename T>
void appendValue(std::ostringstream &stream, const std::string &spec,
                 T &&value) {
  using Decayed = std::decay_t<T>;

  if (spec.empty()) {
    stream << std::forward<T>(value);
    return;
  }

  if (spec == ":.2f") {
    if constexpr (std::is_arithmetic_v<Decayed>) {
      const auto old_flags = stream.flags();
      const auto old_precision = stream.precision();
      stream << std::fixed << std::setprecision(2)
             << static_cast<long double>(value);
      stream.flags(old_flags);
      stream.precision(old_precision);
      return;
    }
  }

  if (spec == ":x" || spec == ":#x") {
    if constexpr (std::is_integral_v<Decayed> || std::is_enum_v<Decayed>) {
      const auto old_flags = stream.flags();
      if (spec == ":#x") {
        stream << "0x";
      }
      using PrintType = typename HexPrintType<Decayed>::type;
      using UnsignedType = std::make_unsigned_t<PrintType>;
      stream << std::hex
             << static_cast<unsigned long long>(
                    static_cast<UnsignedType>(value));
      stream.flags(old_flags);
      return;
    }
  }

  throw std::invalid_argument("Unsupported stream_format specifier: {" + spec +
                              "}");
}

inline void formatToStream(std::ostringstream &stream,
                           const std::string &format) {
  std::size_t cursor = 0;
  while (cursor < format.size()) {
    const std::size_t open = format.find('{', cursor);
    if (open == std::string::npos) {
      appendLiteral(stream, format, cursor, format.size() - cursor);
      return;
    }
    if (open + 1 < format.size() && format[open + 1] == '{') {
      appendLiteral(stream, format, cursor, open - cursor + 1);
      cursor = open + 2;
      continue;
    }

    const std::size_t close = format.find('}', open);
    if (close == std::string::npos) {
      throw std::invalid_argument("Unmatched '{' in stream_format string");
    }
    appendLiteral(stream, format, cursor, open - cursor);
    throw std::invalid_argument("Missing argument for stream_format string");
  }
}

template <typename T, typename... Rest>
void formatToStream(std::ostringstream &stream, const std::string &format,
                    T &&value, Rest &&...rest) {
  std::size_t cursor = 0;
  while (cursor < format.size()) {
    const std::size_t open = format.find('{', cursor);
    if (open == std::string::npos) {
      appendLiteral(stream, format, cursor, format.size() - cursor);
      throw std::invalid_argument("Too many arguments for stream_format string");
    }
    if (open + 1 < format.size() && format[open + 1] == '{') {
      appendLiteral(stream, format, cursor, open - cursor + 1);
      cursor = open + 2;
      continue;
    }

    const std::size_t close = format.find('}', open);
    if (close == std::string::npos) {
      throw std::invalid_argument("Unmatched '{' in stream_format string");
    }

    appendLiteral(stream, format, cursor, open - cursor);
    appendValue(stream, format.substr(open + 1, close - open - 1),
                std::forward<T>(value));
    formatToStream(stream, format.substr(close + 1), std::forward<Rest>(rest)...);
    return;
  }

  throw std::invalid_argument("Too many arguments for stream_format string");
}

} // namespace detail

template <typename... Args>
std::string format(const std::string &format_string, Args &&...args) {
  std::ostringstream stream;
  detail::formatToStream(stream, format_string, std::forward<Args>(args)...);
  return stream.str();
}

} // namespace stream_format

#endif
