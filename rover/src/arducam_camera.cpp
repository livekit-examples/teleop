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

#include "arducam_camera.h"

#include <libcamera/libcamera.h>
#include <sys/mman.h>

#include <cstring>
#include <iostream>
#include <map>

using namespace libcamera;

struct ArducamCamera::Impl {
  std::unique_ptr<CameraManager> cm;
  std::shared_ptr<Camera> camera;
  std::unique_ptr<FrameBufferAllocator> allocator;
  Stream *stream{nullptr};
  unsigned int stride{0};
  std::vector<std::unique_ptr<Request>> requests;

  struct MappedBuffer {
    void *data{nullptr};
    std::size_t length{0};
  };
  std::map<FrameBuffer *, MappedBuffer> mapped_buffers;
  bool running{false};
};

ArducamCamera::ArducamCamera(const Config &cfg) : cfg_(cfg) {}

ArducamCamera::~ArducamCamera() { stop(); }

bool ArducamCamera::start() {
  if (impl_ && impl_->running) {
    return true;
  }

  impl_ = std::make_unique<Impl>();

  impl_->cm = std::make_unique<CameraManager>();
  if (impl_->cm->start()) {
    std::cerr << "[arducam] Failed to start CameraManager\n";
    impl_.reset();
    return false;
  }

  if (impl_->cm->cameras().empty()) {
    std::cerr << "[arducam] No cameras found\n";
    impl_->cm->stop();
    impl_.reset();
    return false;
  }

  impl_->camera = impl_->cm->cameras()[0];
  if (impl_->camera->acquire()) {
    std::cerr << "[arducam] Failed to acquire camera\n";
    impl_->cm->stop();
    impl_.reset();
    return false;
  }

  auto config =
      impl_->camera->generateConfiguration({StreamRole::VideoRecording});
  auto &stream_cfg = config->at(0);
  stream_cfg.size = Size(static_cast<unsigned int>(cfg_.width),
                         static_cast<unsigned int>(cfg_.height));
  stream_cfg.pixelFormat = formats::RGB888;

  if (config->validate() == CameraConfiguration::Invalid) {
    std::cerr << "[arducam] Invalid camera configuration\n";
    impl_->camera->release();
    impl_->cm->stop();
    impl_.reset();
    return false;
  }

  if (static_cast<int>(stream_cfg.size.width) != cfg_.width ||
      static_cast<int>(stream_cfg.size.height) != cfg_.height) {
    std::cerr << "[arducam] Requested " << cfg_.width << "x" << cfg_.height
              << " but got " << stream_cfg.size.width << "x"
              << stream_cfg.size.height << "\n";
    cfg_.width = static_cast<int>(stream_cfg.size.width);
    cfg_.height = static_cast<int>(stream_cfg.size.height);
  }

  if (impl_->camera->configure(config.get())) {
    std::cerr << "[arducam] Failed to configure camera\n";
    impl_->camera->release();
    impl_->cm->stop();
    impl_.reset();
    return false;
  }

  impl_->stream = stream_cfg.stream();
  impl_->stride = stream_cfg.stride;

  impl_->allocator = std::make_unique<FrameBufferAllocator>(impl_->camera);
  if (impl_->allocator->allocate(impl_->stream) < 0) {
    std::cerr << "[arducam] Failed to allocate buffers\n";
    impl_->camera->release();
    impl_->cm->stop();
    impl_.reset();
    return false;
  }

  for (auto &buf : impl_->allocator->buffers(impl_->stream)) {
    const auto &plane = buf->planes()[0];
    void *mem =
        mmap(nullptr, plane.length, PROT_READ, MAP_SHARED, plane.fd.get(), 0);
    if (mem == MAP_FAILED) {
      std::cerr << "[arducam] Failed to mmap buffer\n";
      stop();
      return false;
    }
    impl_->mapped_buffers[buf.get()] = {mem, plane.length};
  }

  for (auto &buf : impl_->allocator->buffers(impl_->stream)) {
    auto req = impl_->camera->createRequest();
    req->addBuffer(impl_->stream, buf.get());
    impl_->requests.push_back(std::move(req));
  }

  impl_->camera->requestCompleted.connect(
      this, [this](Request *request) {
        if (request->status() == Request::RequestCancelled) {
          return;
        }

        FrameBuffer *fb = request->buffers().at(impl_->stream);
        auto it = impl_->mapped_buffers.find(fb);
        if (it == impl_->mapped_buffers.end()) {
          request->reuse(Request::ReuseBuffers);
          impl_->camera->queueRequest(request);
          return;
        }

        const auto *src = static_cast<const std::uint8_t *>(it->second.data);
        const auto w = static_cast<unsigned int>(cfg_.width);
        const auto h = static_cast<unsigned int>(cfg_.height);

        Frame frame;
        frame.valid = true;
        frame.timestamp_us =
            static_cast<std::int64_t>(fb->metadata().timestamp / 1000);
        frame.rgba.resize(static_cast<std::size_t>(w) * h * 4);

        auto *dst = frame.rgba.data();
        for (unsigned int y = 0; y < h; ++y) {
          const auto *row = src + y * impl_->stride;
          for (unsigned int x = 0; x < w; ++x) {
            dst[0] = row[x * 3 + 0];
            dst[1] = row[x * 3 + 1];
            dst[2] = row[x * 3 + 2];
            dst[3] = 0xFF;
            dst += 4;
          }
        }

        {
          std::lock_guard<std::mutex> lock(frame_mutex_);
          latest_frame_ = std::move(frame);
        }

        request->reuse(Request::ReuseBuffers);
        impl_->camera->queueRequest(request);
      });

  if (impl_->camera->start()) {
    std::cerr << "[arducam] Failed to start camera\n";
    stop();
    return false;
  }

  for (auto &req : impl_->requests) {
    impl_->camera->queueRequest(req.get());
  }

  impl_->running = true;
  std::cout << "[arducam] Started capture at " << cfg_.width << "x"
            << cfg_.height << " RGB888 (stride=" << impl_->stride << ")\n";
  return true;
}

void ArducamCamera::stop() {
  if (!impl_) {
    return;
  }

  if (impl_->running) {
    impl_->camera->stop();
    impl_->running = false;
  }

  if (impl_->camera) {
    impl_->camera->requestCompleted.disconnect(this);
  }

  impl_->requests.clear();

  for (auto &[fb, m] : impl_->mapped_buffers) {
    munmap(m.data, m.length);
  }
  impl_->mapped_buffers.clear();

  impl_->allocator.reset();

  if (impl_->camera) {
    impl_->camera->release();
    impl_->camera.reset();
  }

  if (impl_->cm) {
    impl_->cm->stop();
    impl_->cm.reset();
  }

  impl_.reset();
}

ArducamCamera::Frame ArducamCamera::poll() {
  std::lock_guard<std::mutex> lock(frame_mutex_);
  Frame out;
  std::swap(out, latest_frame_);
  return out;
}
