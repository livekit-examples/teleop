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

#ifndef L3G4200D_GYRO_H
#define L3G4200D_GYRO_H

#include "ostream_log.h"

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>

#include <fcntl.h>
#include <linux/i2c-dev.h>
#include <sys/ioctl.h>
#include <unistd.h>

// ---------------------------------------------------------------------------
// Register map & constants for the L3G4200D 3-axis gyroscope
// ---------------------------------------------------------------------------

static constexpr uint8_t kL3G4200D_WHO_AM_I = 0x0F;
static constexpr uint8_t kL3G4200D_CTRL_REG1 = 0x20;
static constexpr uint8_t kL3G4200D_CTRL_REG4 = 0x23;
static constexpr uint8_t kL3G4200D_OUT_X_L = 0x28;

static constexpr uint8_t kL3G4200D_WHO_AM_I_VALUE = 0xD3;

// CTRL_REG1: 95 Hz ODR, 12.5 Hz cutoff, power-on, all axes enabled
static constexpr uint8_t kL3G4200D_CTRL_REG1_INIT = 0x0F;
// CTRL_REG4: 2000 dps full-scale, little-endian
static constexpr uint8_t kL3G4200D_CTRL_REG4_INIT = 0x20;

// 70 mdps/LSB at 2000 dps full scale
static constexpr double kL3G4200D_SENSITIVITY = 70.0 / 1000.0;

// Auto-increment bit for multi-byte reads
static constexpr uint8_t kI2C_AUTO_INCREMENT = 0x80;

// ---------------------------------------------------------------------------
// GYROData -- all values provided by the sensor + integrated angles
// ---------------------------------------------------------------------------

struct GYROData {
  double gyro_x_dps{0.0};
  double gyro_y_dps{0.0};
  double gyro_z_dps{0.0};
  double angle_x_deg{0.0};
  double angle_y_deg{0.0};
  double angle_z_deg{0.0};
  bool valid{false};
};

// ---------------------------------------------------------------------------
// L3G4200D_GYRO -- owns I2C handle, background polling, angle integration
// ---------------------------------------------------------------------------

class L3G4200D_GYRO {
public:
  explicit L3G4200D_GYRO(
      int bus = 7, uint8_t address = 0x69,
      std::chrono::milliseconds poll_interval = std::chrono::milliseconds(50))
      : bus_(bus), address_(address), poll_interval_(poll_interval) {}

  ~L3G4200D_GYRO() { stop(); }

  L3G4200D_GYRO(const L3G4200D_GYRO &) = delete;
  L3G4200D_GYRO &operator=(const L3G4200D_GYRO &) = delete;

  bool init() {
    std::string dev = "/dev/i2c-" + std::to_string(bus_);
    fd_ = ::open(dev.c_str(), O_RDWR);
    if (fd_ < 0) {
      WriteLine(std::cerr, "[gyro] Failed to open I2C device {}", dev);
      return false;
    }

    if (::ioctl(fd_, I2C_SLAVE, address_) < 0) {
      WriteLine(std::cerr, "[gyro] Failed to set I2C slave address {:#x}", address_);
      close();
      return false;
    }

    uint8_t who = readReg(kL3G4200D_WHO_AM_I);
    if (who != kL3G4200D_WHO_AM_I_VALUE) {
      WriteLine(std::cerr, "[gyro] Unexpected WHO_AM_I: {:#x} (expected {:#x})", who,
                   kL3G4200D_WHO_AM_I_VALUE);
      close();
      return false;
    }
    WriteLine(std::cout, "[gyro] L3G4200D detected on /dev/i2c-{} addr {:#x}", bus_,
                address_);

    writeReg(kL3G4200D_CTRL_REG1, kL3G4200D_CTRL_REG1_INIT);
    writeReg(kL3G4200D_CTRL_REG4, kL3G4200D_CTRL_REG4_INIT);

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    WriteLine(std::cout, "[gyro] Gyroscope initialized (95 Hz, 2000 dps full-scale)");
    return true;
  }

  void start() {
    if (running_.exchange(true))
      return;
    poll_thread_ = std::thread(&L3G4200D_GYRO::pollLoop, this);
    WriteLine(std::cout, "[gyro] Background polling started ({}ms interval)",
                poll_interval_.count());
  }

  void stop() {
    if (!running_.exchange(false))
      return;
    if (poll_thread_.joinable())
      poll_thread_.join();
    close();
    WriteLine(std::cout, "[gyro] Stopped");
  }

  GYROData getLastGYROVal() const {
    std::lock_guard<std::mutex> lock(mu_);
    return data_;
  }

private:
  struct PollHealthMonitor {
    struct MissState {
      bool unhealthy{false};
      bool crossed_threshold{false};
      std::size_t consecutive_misses{0};
    };

    static constexpr std::size_t kMaxConsecutiveMisses = 5;

    bool onSuccess() {
      const bool was_unhealthy = unhealthy_;
      consecutive_misses_ = 0;
      unhealthy_ = false;
      return was_unhealthy;
    }

    MissState onMiss() {
      ++consecutive_misses_;
      const bool crossed =
          !unhealthy_ && consecutive_misses_ >= kMaxConsecutiveMisses;
      if (crossed) {
        unhealthy_ = true;
      }
      return {.unhealthy = unhealthy_,
              .crossed_threshold = crossed,
              .consecutive_misses = consecutive_misses_};
    }

  private:
    std::size_t consecutive_misses_{0};
    bool unhealthy_{false};
  };

  void close() {
    if (fd_ >= 0) {
      ::close(fd_);
      fd_ = -1;
    }
  }

  void writeReg(uint8_t reg, uint8_t value) {
    uint8_t buf[2] = {reg, value};
    if (::write(fd_, buf, 2) != 2) {
      WriteLine(std::cerr, "[gyro] I2C write failed for register {:#x}", reg);
    }
  }

  uint8_t readReg(uint8_t reg) {
    if (::write(fd_, &reg, 1) != 1) {
      WriteLine(std::cerr, "[gyro] I2C write (reg addr) failed for {:#x}", reg);
      return 0;
    }
    uint8_t value = 0;
    if (::read(fd_, &value, 1) != 1) {
      WriteLine(std::cerr, "[gyro] I2C read failed for register {:#x}", reg);
    }
    return value;
  }

  bool readBlock(uint8_t reg, uint8_t *buf, int len) {
    if (::write(fd_, &reg, 1) != 1)
      return false;
    return ::read(fd_, buf, len) == len;
  }

  static int16_t twosComplement(uint16_t val) {
    return static_cast<int16_t>(val);
  }

  bool readGyro(double &gx, double &gy, double &gz) {
    uint8_t raw[6];
    if (!readBlock(kL3G4200D_OUT_X_L | kI2C_AUTO_INCREMENT, raw, 6)) {
      WriteLine(std::cout, "[gyro] Failed to read gyro data block");
      return false;
    }

    int16_t rx = twosComplement(static_cast<uint16_t>(raw[1]) << 8 | raw[0]);
    int16_t ry = twosComplement(static_cast<uint16_t>(raw[3]) << 8 | raw[2]);
    int16_t rz = twosComplement(static_cast<uint16_t>(raw[5]) << 8 | raw[4]);

    gx = rx * kL3G4200D_SENSITIVITY;
    gy = ry * kL3G4200D_SENSITIVITY;
    gz = rz * kL3G4200D_SENSITIVITY;
    return true;
  }

  void pollLoop() {
    auto prev = std::chrono::steady_clock::now();

    while (running_.load()) {
      auto now = std::chrono::steady_clock::now();
      double dt = std::chrono::duration<double>(now - prev).count();
      prev = now;

      double gx, gy, gz;
      if (readGyro(gx, gy, gz)) {
        const bool recovered = health_monitor_.onSuccess();
        std::lock_guard<std::mutex> lock(mu_);
        data_.gyro_x_dps = gx;
        data_.gyro_y_dps = gy;
        data_.gyro_z_dps = gz;
        data_.angle_x_deg += gx * dt;
        data_.angle_y_deg += gy * dt;
        data_.angle_z_deg += gz * dt;
        data_.valid = true;
        if (recovered) {
          WriteLine(std::cout, "[gyro] Gyro stream recovered after read failures");
        }
      } else {
        const PollHealthMonitor::MissState miss = health_monitor_.onMiss();
        if (miss.crossed_threshold) {
          WriteLine(std::cerr, 
              "[gyro] Missed {} consecutive gyro reads; returning invalid data",
              miss.consecutive_misses);
        }
        if (miss.unhealthy) {
          std::lock_guard<std::mutex> lock(mu_);
          data_ = GYROData{}; // reset the data
        }
      }

      std::this_thread::sleep_for(poll_interval_);
    }
  }

  int bus_;
  uint8_t address_;
  std::chrono::milliseconds poll_interval_;
  int fd_{-1};

  std::thread poll_thread_;
  std::atomic<bool> running_{false};

  mutable std::mutex mu_;
  GYROData data_;
  PollHealthMonitor health_monitor_;
};

#endif // L3G4200D_GYRO_H
