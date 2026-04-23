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

#include <cstdint>
#include <memory>
#include <mutex>
#include <vector>

/**
 * @brief Minimal wrapper around the rover's Arducam capture pipeline.
 *
 * The camera owns the underlying libcamera resources and exposes the latest
 * frame through a polling interface.
 */
class ArducamCamera {
public:
  /** @brief Requested camera capture settings. */
  struct Config {
    int width{1280}; ///< Requested capture width in pixels.
    int height{720}; ///< Requested capture height in pixels.
  };

  /** @brief Snapshot of the most recent completed camera frame. */
  struct Frame {
    bool valid{
        false}; ///< True when this struct contains a freshly captured image.
    std::int64_t timestamp_us{
        0}; ///< Capture timestamp from libcamera metadata in microseconds.
    std::vector<std::uint8_t> rgba; ///< Interleaved RGBA image data sized to
                                    ///< `width() * height() * 4`.
  };

  /**
   * @brief Creates a camera wrapper with the requested capture configuration.
   * @param cfg Requested capture width and height.
   */
  explicit ArducamCamera(const Config &cfg);
  /** @brief Stops capture and releases camera resources. */
  ~ArducamCamera();

  /** @brief Deleted because camera handles and buffers are uniquely owned. */
  ArducamCamera(const ArducamCamera &) = delete;
  /** @brief Deleted because camera handles and buffers are uniquely owned. */
  ArducamCamera &operator=(const ArducamCamera &) = delete;

  /**
   * @brief Starts libcamera capture and begins updating the latest frame
   * buffer.
   * @return True when camera startup succeeds.
   */
  bool start();
  /** @brief Stops capture and tears down all camera resources. */
  void stop();

  /**
   * @brief Returns the newest captured frame and clears the stored snapshot.
   * @return Latest completed frame, marked invalid when no fresh frame exists.
   */
  Frame poll();

  /**
   * @brief Returns the effective capture width.
   * @return Negotiated capture width in pixels.
   */
  int width() const { return cfg_.width; }
  /**
   * @brief Returns the effective capture height.
   * @return Negotiated capture height in pixels.
   */
  int height() const { return cfg_.height; }

private:
  /** @brief Opaque libcamera state kept out of the header to minimize
   * dependencies. */
  struct Impl;

  Config cfg_; ///< Effective capture configuration after negotiation.
  std::unique_ptr<Impl>
      impl_;               ///< Runtime libcamera objects and mapped buffers.
  std::mutex frame_mutex_; ///< Guards access to `latest_frame_`.
  Frame latest_frame_; ///< Most recent completed frame waiting for `poll()`.
};
