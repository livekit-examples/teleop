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

#include "teleop_msgs.h"

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>

/** @brief Helpers for formatting and parsing the rover UART line protocol. */
namespace rover_serial_bus {
/**
 * @brief Builds the newline-terminated UART command for requesting one IMU
 * sample.
 * @return Serialized command line ready to write to the rover MCU.
 */
std::string imuQueryLine();
/**
 * @brief Builds the newline-terminated UART command for a drive request.
 * @param cmd Differential drive command to serialize.
 * @return Serialized command line ready to write to the rover MCU.
 */
std::string controlCommandLine(const teleop_msgs::ControlCmdMsg &cmd);
/**
 * @brief Parses a UART text line into an IMU sample when it contains sensor
 * data.
 * @param line Raw line read from the serial bus, without assumptions about
 * format.
 * @param error Optional destination for parse failure details.
 * @return Parsed IMU message on success, or `std::nullopt` when the line is not
 *         a supported sensor frame.
 */
std::optional<teleop_msgs::ImuMsg> parseImuLine(const std::string &line,
                                                std::string *error = nullptr);
} // namespace rover_serial_bus

/**
 * @brief Thin wrapper around the rover UART protocol.
 *
 * The bus formats outgoing commands, incrementally parses incoming IMU frames,
 * and keeps enough state to summarize transient serial parse noise.
 */
class RoverSerialBus {
public:
  /**
   * @brief Creates a serial bus wrapper for the given device path.
   * @param serial_port Filesystem path of the UART device to open.
   */
  explicit RoverSerialBus(const std::string &serial_port);
  /** @brief Closes the file descriptor and flushes parse-noise summaries. */
  ~RoverSerialBus();

  /** @brief Deleted because the serial file descriptor has single ownership. */
  RoverSerialBus(const RoverSerialBus &) = delete;
  /** @brief Deleted because the serial file descriptor has single ownership. */
  RoverSerialBus &operator=(const RoverSerialBus &) = delete;

  /**
   * @brief Opens and configures the serial port for 115200 baud raw UART I/O.
   * @return True when the serial device is ready for reads and writes.
   */
  bool open();
  /** @brief Closes the serial port and resets buffered parser state. */
  void close();
  /**
   * @brief Reports whether the serial device file descriptor is open.
   * @return True when the bus currently owns a live file descriptor.
   */
  bool isOpen() const;

  /**
   * @brief Sends a single IMU query frame to the rover MCU.
   * @return True when the command is written successfully.
   */
  bool sendIMUQuery();
  /**
   * @brief Reads available UART bytes and returns the next parsed IMU sample.
   * @return Parsed IMU sample when a complete sensor frame is available.
   */
  std::optional<teleop_msgs::ImuMsg> readSerialData();
  /**
   * @brief Sends a differential drive command to the rover MCU.
   * @param cmd Wheel throttle and steering command to write to the rover.
   * @return True when the command is written successfully.
   */
  bool sendControlCommand(const teleop_msgs::ControlCmdMsg &cmd);

private:
  /**
   * @brief Writes one preformatted line to the serial device.
   * @param line Newline-terminated text frame to write.
   * @return True when the entire line is written successfully.
   */
  bool writeLine(const std::string &line);
  /**
   * @brief Drains complete newline-delimited frames from the read buffer.
   * @return Parsed IMU sample when at least one complete supported frame
   * exists.
   */
  std::optional<teleop_msgs::ImuMsg> consumeBufferedLines();
  /**
   * @brief Records or logs a discarded frame parse failure.
   * @param error Description of the parse failure for the discarded frame.
   */
  void noteDiscardedSerialFrame(const std::string &error);
  /** @brief Emits an aggregate summary for suppressed transient parse errors.
   */
  void flushTransientParseNoiseSummary();

  std::string serial_port_; ///< Filesystem path of the serial device.
  int fd_{-1}; ///< Open UART file descriptor, or `-1` when disconnected.
  std::string read_buffer_; ///< Partial UART bytes buffered until a full line
                            ///< is available.
  std::uint64_t suppressed_transient_parse_errors_{
      0}; ///< Count of parse errors rolled into a summary.
  std::optional<std::chrono::steady_clock::time_point>
      transient_parse_window_start_; ///< Start time of the current parse-noise
                                     ///< window.
};
