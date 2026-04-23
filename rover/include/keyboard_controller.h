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

#include <atomic>
#include <functional>
#include <memory>
#include <thread>

#include "teleop_msgs.h"

class RoverSerialBus;

/**
 * @brief Reads WASD input from a raw terminal and emits rover drive commands.
 *
 * The terminal must already be in raw mode before `start()` is called.
 */
class KeyboardController {
public:
  /** @brief Callback used to emit control commands to a custom transport. */
  using ControlCmdCallback =
      std::function<void(const teleop_msgs::ControlCmdMsg &)>;

  /**
   * @brief Creates a controller that forwards commands to the rover serial bus.
   * @param bus Shared serial transport used for direct rover control.
   */
  explicit KeyboardController(std::shared_ptr<RoverSerialBus> bus);
  /**
   * @brief Creates a controller that forwards commands through a callback.
   * @param cmd_cb Callback invoked for each parsed control command.
   */
  explicit KeyboardController(ControlCmdCallback cmd_cb);
  /** @brief Stops the input thread before the controller is destroyed. */
  ~KeyboardController();

  /** @brief Deleted because the controller owns a worker thread. */
  KeyboardController(const KeyboardController &) = delete;
  /** @brief Deleted because the controller owns a worker thread. */
  KeyboardController &operator=(const KeyboardController &) = delete;
  /** @brief Deleted because the controller owns a worker thread. */
  KeyboardController(KeyboardController &&) = delete;
  /** @brief Deleted because the controller owns a worker thread. */
  KeyboardController &operator=(KeyboardController &&) = delete;

  /** @brief Starts the background loop that reads raw keyboard input. */
  void start();

  /** @brief Stops the background loop and joins the worker thread if needed. */
  void stop();

  /** @brief Callback invoked when the user presses Ctrl-C in the keyboard loop.
   */
  using StopRequestCallback = std::function<void()>;

  /**
   * @brief Registers a callback fired when the controller requests shutdown.
   * @param cb Callback to invoke when Ctrl-C is received.
   */
  void setStopRequestCallback(StopRequestCallback cb);

private:
  /** @brief Worker loop that maps keypresses to motion commands. */
  void run();
  /**
   * @brief Sends the latest command to whichever output paths were configured.
   * @param cmd Parsed control command to forward.
   */
  void dispatchCommand(const teleop_msgs::ControlCmdMsg &cmd);

  std::shared_ptr<RoverSerialBus>
      bus_; ///< Optional UART transport for direct rover control.
  ControlCmdCallback cmd_cb_; ///< Optional callback transport for tests or
                              ///< alternate frontends.
  std::thread thread_;        ///< Background thread that blocks on stdin.
  std::atomic<bool> running_{
      false}; ///< Latch coordinating worker loop lifetime.
  StopRequestCallback
      stop_request_cb_; ///< Optional shutdown hook invoked on Ctrl-C.
};
