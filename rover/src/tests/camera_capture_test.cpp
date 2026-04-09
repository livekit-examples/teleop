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

#include <libcamera/libcamera.h>
#include <png.h>

#include <atomic>
#include <cstdio>
#include <cstring>
#include <thread>
#include <future>
#include <sys/mman.h>
#include <vector>

using namespace libcamera;

static constexpr unsigned int kWidth = 640;
static constexpr unsigned int kHeight = 480;
static constexpr int kFrameInterval = 30;
static constexpr int kMaxPngs = 5;

static bool writePng(const std::string &path,
                     const std::vector<uint8_t> &rgb,
                     unsigned int width,
                     unsigned int height) {
  FILE *fp = std::fopen(path.c_str(), "wb");
  if (!fp)
    return false;

  png_structp png =
      png_create_write_struct(PNG_LIBPNG_VER_STRING, nullptr, nullptr, nullptr);
  png_infop info = png_create_info_struct(png);

  if (setjmp(png_jmpbuf(png))) {
    png_destroy_write_struct(&png, &info);
    std::fclose(fp);
    return false;
  }

  png_init_io(png, fp);
  png_set_IHDR(png, info, width, height, 8, PNG_COLOR_TYPE_RGB,
               PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT,
               PNG_FILTER_TYPE_DEFAULT);
  png_write_info(png, info);

  for (unsigned int y = 0; y < height; ++y)
    png_write_row(png, rgb.data() + y * width * 3);

  png_write_end(png, nullptr);
  png_destroy_write_struct(&png, &info);
  std::fclose(fp);
  return true;
}

int main() {
  auto cm = std::make_unique<CameraManager>();
  if (cm->start()) {
    std::fprintf(stderr, "Failed to start CameraManager\n");
    return 1;
  }

  if (cm->cameras().empty()) {
    std::fprintf(stderr, "No cameras found\n");
    return 1;
  }

  auto camera = cm->cameras()[0];
  if (camera->acquire()) {
    std::fprintf(stderr, "Failed to acquire camera\n");
    return 1;
  }

  auto config = camera->generateConfiguration({StreamRole::VideoRecording});
  auto &streamConfig = config->at(0);
  streamConfig.size = Size(kWidth, kHeight);
  streamConfig.pixelFormat = formats::RGB888;

  if (config->validate() == CameraConfiguration::Invalid) {
    std::fprintf(stderr, "Invalid camera configuration\n");
    camera->release();
    return 1;
  }
  std::printf("Camera configured: %ux%u %s\n", streamConfig.size.width,
              streamConfig.size.height,
              streamConfig.pixelFormat.toString().c_str());

  if (camera->configure(config.get())) {
    std::fprintf(stderr, "Failed to configure camera\n");
    camera->release();
    return 1;
  }

  FrameBufferAllocator allocator(camera);
  Stream *stream = streamConfig.stream();

  if (allocator.allocate(stream) < 0) {
    std::fprintf(stderr, "Failed to allocate buffers\n");
    camera->release();
    return 1;
  }

  // Map each buffer's first plane so we can read pixel data.
  struct MappedBuffer {
    void *data;
    size_t length;
  };
  std::map<FrameBuffer *, MappedBuffer> mappedBuffers;
  for (auto &buf : allocator.buffers(stream)) {
    const auto &plane = buf->planes()[0];
    void *mem =
        mmap(nullptr, plane.length, PROT_READ, MAP_SHARED, plane.fd.get(), 0);
    if (mem == MAP_FAILED) {
      std::fprintf(stderr, "Failed to mmap buffer\n");
      camera->release();
      return 1;
    }
    mappedBuffers[buf.get()] = {mem, plane.length};
  }

  std::vector<std::unique_ptr<Request>> requests;
  for (auto &buf : allocator.buffers(stream)) {
    auto req = camera->createRequest();
    req->addBuffer(stream, buf.get());
    requests.push_back(std::move(req));
  }

  std::atomic<int> frameCount{0};
  std::atomic<int> pngsWritten{0};
  std::vector<std::future<void>> writeFutures;

  camera->requestCompleted.connect(
      camera.get(), [&](Request *request) {
        if (request->status() == Request::RequestCancelled)
          return;

        int n = frameCount.fetch_add(1);

        if (n % kFrameInterval == 0 && pngsWritten.load() < kMaxPngs) {
          FrameBuffer *fb = request->buffers().at(stream);
          auto &mapped = mappedBuffers[fb];

          unsigned int stride = streamConfig.stride;
          std::vector<uint8_t> rgb(kWidth * kHeight * 3);
          for (unsigned int y = 0; y < kHeight; ++y)
            std::memcpy(rgb.data() + y * kWidth * 3,
                        static_cast<uint8_t *>(mapped.data) + y * stride,
                        kWidth * 3);

          int idx = pngsWritten.fetch_add(1);
          std::string path = "frame_" + std::to_string(idx) + ".png";

          writeFutures.push_back(
              std::async(std::launch::async,
                         [rgb = std::move(rgb), path]() {
                           if (writePng(path, rgb, kWidth, kHeight))
                             std::printf("Wrote %s\n", path.c_str());
                           else
                             std::fprintf(stderr, "Failed to write %s\n",
                                          path.c_str());
                         }));
        }

        request->reuse(Request::ReuseBuffers);
        camera->queueRequest(request);
      });

  if (camera->start()) {
    std::fprintf(stderr, "Failed to start camera\n");
    camera->release();
    return 1;
  }

  for (auto &req : requests)
    camera->queueRequest(req.get());

  std::printf("Capturing every %dth frame, will write %d PNGs...\n",
              kFrameInterval, kMaxPngs);

  while (pngsWritten.load() < kMaxPngs) {
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }

  camera->stop();

  for (auto &f : writeFutures)
    f.wait();

  for (auto &[fb, m] : mappedBuffers)
    munmap(m.data, m.length);

  camera->release();
  cm->stop();

  std::printf("Done. %d PNGs written.\n", kMaxPngs);
  return 0;
}
