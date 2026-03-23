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

#ifndef REALSENSE_CAMERA_H
#define REALSENSE_CAMERA_H

#include <cstdint>
#include <vector>

#include <librealsense2/rs.hpp>

/**
 * @brief Wraps a RealSense RGB-D pipeline, providing RGBA color frames and
 *        raw 16-bit depth buffers suitable for sending over LiveKit tracks.
 *
 * The pipeline captures RGB8 color and Z16 depth at the configured resolution
 * and frame rate. Color is converted to RGBA on poll. Depth is exposed as a
 * raw byte vector (little-endian uint16 per pixel, units of millimetres) with
 * a simple header so the receiver can reconstruct the image.
 */
class RealsenseCamera {
public:
  static constexpr int kDefaultWidth = 640;
  static constexpr int kDefaultHeight = 480;
  static constexpr int kDefaultFps = 30;
  static constexpr int kRgbaChannels = 4;

  struct Config {
    int width{640};
    int height{480};
    int fps{30};
  };

  /**
   * @brief Snapshot returned by poll(). If valid==false the caller should
   *        skip the frame (pipeline had nothing ready).
   */
  struct Frame {
    bool valid{false};
    std::int64_t timestamp_us{0};
    std::vector<std::uint8_t> rgba;
    std::vector<std::uint8_t> depth_raw;
    int depth_width{0};
    int depth_height{0};
  };

  RealsenseCamera();
  explicit RealsenseCamera(const Config &cfg);
  ~RealsenseCamera();

  RealsenseCamera(const RealsenseCamera &) = delete;
  RealsenseCamera &operator=(const RealsenseCamera &) = delete;

  bool start();
  void stop();
  bool isRunning() const { return running_; }

  /**
   * @brief Non-blocking poll for the next aligned frameset.
   * @return Frame with valid==true if a frameset was available.
   */
  Frame poll();

  int width() const { return cfg_.width; }
  int height() const { return cfg_.height; }

private:
  static void rgb8ToRgba(const std::uint8_t *rgb, std::uint8_t *rgba,
                          int width, int height);

  Config cfg_;
  rs2::pipeline pipe_;
  bool running_{false};
};

#endif // REALSENSE_CAMERA_H
