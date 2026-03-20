#!/usr/bin/env bash
# Copyright 2026 LiveKit
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -euo pipefail

usage() {
  cat <<EOF
Usage: ./build.sh [clean] [--help] [CMAKE_ARGS...]

Options:
  clean           Remove the build directory before building
  --help, -h      Show this help message and exit

Extra arguments are forwarded to cmake, e.g.:
  ./build.sh -DLIVEKIT_SDK_VERSION=0.3.0
  ./build.sh clean -DCMAKE_BUILD_TYPE=Release
  ./build.sh -DLIVEKIT_LOCAL_SDK_DIR=<path-to-local-sdk-install-prefix>
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "clean" ]]; then
  echo "Removing ${BUILD_DIR} ..."
  rm -rf "${BUILD_DIR}"
  shift
fi

mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

cmake "${SCRIPT_DIR}" "$@"
make -j"$(nproc)"
