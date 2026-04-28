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

/*
 * SimpleParticipant — joins a LiveKit room and echoes remote track publication
 * events for audio, video, and data tracks.
 *
 * Usage:
 *   SimpleParticipant --url <ws-url> --token <token>
 *   LIVEKIT_URL=... LIVEKIT_TOKEN=... SimpleParticipant
 */

#include "livekit/livekit.h"
#include "livekit/remote_data_track.h"
#include "livekit/remote_participant.h"
#include "livekit/remote_track_publication.h"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#define LK_LOG_INFO(expr)                                                     \
  do {                                                                        \
    std::cout << "[simple-participant] " << expr << '\n';                     \
  } while (false)

#define LK_LOG_WARN(expr)                                                     \
  do {                                                                        \
    std::cerr << "[simple-participant] WARN " << expr << '\n';                \
  } while (false)

#define LK_LOG_ERROR(expr)                                                    \
  do {                                                                        \
    std::cerr << "[simple-participant] ERROR " << expr << '\n';               \
  } while (false)

namespace {

std::atomic<bool> g_running{true};

void handleSignal(int) { g_running.store(false); }

struct Args {
  std::string url;
  std::string token;
};

void printUsage(const char *prog) {
  std::cout << "Usage: " << prog << " [--url <ws-url>] [--token <token>]\n";
  std::cout << "Env fallbacks: LIVEKIT_URL, LIVEKIT_TOKEN\n";
}

bool parseArgs(int argc, char *argv[], Args &args) {
  std::vector<std::string> positional;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--url") == 0 && i + 1 < argc) {
      args.url = argv[++i];
    } else if (std::strcmp(argv[i], "--token") == 0 && i + 1 < argc) {
      args.token = argv[++i];
    } else if (std::strcmp(argv[i], "--help") == 0 ||
               std::strcmp(argv[i], "-h") == 0) {
      return false;
    } else {
      positional.emplace_back(argv[i]);
    }
  }

  for (const auto &arg : positional) {
    if (args.url.empty() &&
        (arg.rfind("ws://", 0) == 0 || arg.rfind("wss://", 0) == 0)) {
      args.url = arg;
    } else if (args.token.empty()) {
      args.token = arg;
    }
  }

  if (args.url.empty()) {
    const char *e = std::getenv("LIVEKIT_URL");
    if (e != nullptr) {
      args.url = e;
    }
  }
  if (args.token.empty()) {
    const char *e = std::getenv("LIVEKIT_TOKEN");
    if (e != nullptr) {
      args.token = e;
    }
  }

  if (args.url.empty() || args.token.empty()) {
    LK_LOG_ERROR("missing required url/token");
    return false;
  }
  return true;
}

const char *trackKindName(livekit::TrackKind kind) {
  switch (kind) {
  case livekit::TrackKind::KIND_AUDIO:
    return "audio";
  case livekit::TrackKind::KIND_VIDEO:
    return "video";
  case livekit::TrackKind::KIND_UNKNOWN:
  default:
    return "unknown";
  }
}

const char *trackSourceName(livekit::TrackSource source) {
  switch (source) {
  case livekit::TrackSource::SOURCE_CAMERA:
    return "camera";
  case livekit::TrackSource::SOURCE_MICROPHONE:
    return "microphone";
  case livekit::TrackSource::SOURCE_SCREENSHARE:
    return "screenshare";
  case livekit::TrackSource::SOURCE_SCREENSHARE_AUDIO:
    return "screenshare_audio";
  case livekit::TrackSource::SOURCE_UNKNOWN:
  default:
    return "unknown";
  }
}

void logTrackPublication(const std::string &publisher_identity,
                         const livekit::TrackPublication &publication) {
  LK_LOG_INFO("remote " << trackKindName(publication.kind())
                        << " track published by '" << publisher_identity
                        << "' name='" << publication.name() << "' sid='"
                        << publication.sid() << "' source="
                        << trackSourceName(publication.source())
                        << " mime='" << publication.mimeType() << "' muted="
                        << (publication.muted() ? "true" : "false"));
}

void logDataTrackPublication(const livekit::RemoteDataTrack &track) {
  const auto &info = track.info();
  LK_LOG_INFO("remote data track published by '" << track.publisherIdentity()
                                                << "' name='" << info.name
                                                << "' sid='" << info.sid
                                                << "' e2ee="
                                                << (info.uses_e2ee ? "true"
                                                                   : "false"));
}

class SimpleParticipant final : public livekit::RoomDelegate {
public:
  int run(const Args &args) {
    std::signal(SIGINT, handleSignal);
    std::signal(SIGTERM, handleSignal);

    livekit::initialize();
    room_ = std::make_unique<livekit::Room>();
    room_->setDelegate(this);

    livekit::RoomOptions options;
    options.auto_subscribe = true;
    options.dynacast = false;

    LK_LOG_INFO("connecting to " << args.url);
    if (!room_->Connect(args.url, args.token, options)) {
      LK_LOG_ERROR("failed to connect to LiveKit room");
      shutdown();
      return 1;
    }

    auto *local_participant = room_->localParticipant();
    if (local_participant == nullptr) {
      LK_LOG_WARN("connected without a local participant");
    } else {
      LK_LOG_INFO("connected as '" << local_participant->identity() << "'");
    }

    echoExistingPublications();
    LK_LOG_INFO("running. Press Ctrl-C to exit.");
    while (g_running.load()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    shutdown();
    return 0;
  }

private:
  void onParticipantConnected(
      livekit::Room & /*room*/,
      const livekit::ParticipantConnectedEvent &event) override {
    if (event.participant == nullptr) {
      LK_LOG_WARN("participant connected event has null participant");
      return;
    }
    LK_LOG_INFO("participant connected identity='"
                << event.participant->identity() << "'");
  }

  void onParticipantDisconnected(
      livekit::Room & /*room*/,
      const livekit::ParticipantDisconnectedEvent &event) override {
    if (event.participant == nullptr) {
      return;
    }
    LK_LOG_INFO("participant disconnected identity='"
                << event.participant->identity() << "'");
  }

  void onTrackPublished(livekit::Room & /*room*/,
                        const livekit::TrackPublishedEvent &event) override {
    if (event.publication == nullptr) {
      LK_LOG_WARN("track published event has null publication");
      return;
    }
    const std::string publisher =
        event.participant == nullptr ? "<unknown>" : event.participant->identity();
    logTrackPublication(publisher, *event.publication);
  }

  void onDataTrackPublished(
      livekit::Room & /*room*/,
      const livekit::DataTrackPublishedEvent &event) override {
    if (event.track == nullptr) {
      LK_LOG_WARN("data track published event has null track");
      return;
    }
    logDataTrackPublication(*event.track);
  }

  void echoExistingPublications() const {
    if (room_ == nullptr) {
      return;
    }

    for (const auto &participant : room_->remoteParticipants()) {
      if (participant == nullptr) {
        continue;
      }
      for (const auto &entry : participant->trackPublications()) {
        if (entry.second == nullptr) {
          continue;
        }
        logTrackPublication(participant->identity(), *entry.second);
      }
    }
  }

  void shutdown() {
    room_.reset();
    livekit::shutdown();
  }

  std::unique_ptr<livekit::Room> room_;
};

} // namespace

int main(int argc, char *argv[]) {
  Args args;
  if (!parseArgs(argc, argv, args)) {
    printUsage(argv[0]);
    return 1;
  }

  SimpleParticipant participant;
  return participant.run(args);
}
