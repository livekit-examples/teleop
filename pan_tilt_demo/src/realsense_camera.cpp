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

#include "realsense_camera.h"

#include "livekit/lk_log.h"

#include <chrono>
#include <cstring>

RealsenseCamera::RealsenseCamera() : cfg_{} {}

RealsenseCamera::RealsenseCamera(const Config &cfg) : cfg_(cfg) {}

RealsenseCamera::~RealsenseCamera() { stop(); }

bool RealsenseCamera::start() {
  if (running_) {
    return true;
  }

  rs2::config rs_cfg;
  rs_cfg.enable_stream(RS2_STREAM_COLOR, cfg_.width, cfg_.height,
                       RS2_FORMAT_RGB8, cfg_.fps);
  rs_cfg.enable_stream(RS2_STREAM_DEPTH, cfg_.width, cfg_.height,
                       RS2_FORMAT_Z16, cfg_.fps);
  try {
    pipe_.start(rs_cfg);
  } catch (const rs2::error &e) {
    LK_LOG_ERROR("[realsense_camera] Failed to start pipeline: {}", e.what());
    return false;
  }

  running_ = true;
  LK_LOG_INFO("[realsense_camera] Pipeline started ({}x{} @ {} fps)",
              cfg_.width, cfg_.height, cfg_.fps);
  return true;
}

void RealsenseCamera::stop() {
  if (!running_) {
    return;
  }
  try {
    pipe_.stop();
  } catch (const rs2::error &e) {
    LK_LOG_WARN("[realsense_camera] Error stopping pipeline: {}", e.what());
  }
  running_ = false;
  LK_LOG_INFO("[realsense_camera] Pipeline stopped");
}

RealsenseCamera::Frame RealsenseCamera::poll() {
  Frame frame;
  if (!running_) {
    return frame;
  }

  rs2::frameset fs;
  if (!pipe_.poll_for_frames(&fs)) {
    return frame;
  }

  auto color = fs.get_color_frame();
  auto depth = fs.get_depth_frame();
  if (!color || !depth) {
    return frame;
  }

  const auto now_ns =
      std::chrono::duration_cast<std::chrono::nanoseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count();
  frame.timestamp_us = static_cast<std::int64_t>(now_ns / 1000);

  const auto pixel_count =
      static_cast<std::size_t>(cfg_.width * cfg_.height);
  frame.rgba.resize(pixel_count * kRgbaChannels);
  rgb8ToRgba(static_cast<const std::uint8_t *>(color.get_data()),
             frame.rgba.data(), cfg_.width, cfg_.height);

  const auto depth_bytes = static_cast<std::size_t>(depth.get_data_size());
  frame.depth_raw.resize(depth_bytes);
  std::memcpy(frame.depth_raw.data(), depth.get_data(), depth_bytes);
  frame.depth_width = depth.get_width();
  frame.depth_height = depth.get_height();

  frame.valid = true;
  return frame;
}

void RealsenseCamera::rgb8ToRgba(const std::uint8_t *rgb, std::uint8_t *rgba,
                                  int width, int height) {
  const int rgb_step = width * 3;
  const int rgba_step = width * 4;
  for (int y = 0; y < height; ++y) {
    const std::uint8_t *src = rgb + y * rgb_step;
    std::uint8_t *dst = rgba + y * rgba_step;
    for (int x = 0; x < width; ++x) {
      *dst++ = *src++;
      *dst++ = *src++;
      *dst++ = *src++;
      *dst++ = 0xFF;
    }
  }
}
