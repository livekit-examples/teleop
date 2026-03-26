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

#include "rover.h"
#include "rover_args.h"

#include <exception>
#include <iostream>

int main(int argc, char *argv[]) {
  try {
    std::string error;
    const auto config = parseRoverArgs(argc, argv, &error);
    if (!config.has_value()) {
      if (!error.empty()) {
        std::cerr << "[rover_main] " << error << "\n";
      }
      printRoverUsage(argv[0]);
      return 1;
    }

    RoverApp app(*config);
    return app.run();
  } catch (const std::exception &e) {
    std::cerr << "[rover_main] Fatal error: " << e.what() << "\n";
    return 1;
  }
}
