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

#include "pan_tilt_controller.h"

#include <chrono>
#include <cmath>
#include <unistd.h>

namespace {
constexpr useconds_t kCommandSettleUs = 500000;
constexpr useconds_t kStatePollUs = 10 * 1000;
constexpr int kWatchdogRateHz = 30;
constexpr int kPersistentOvercurrentSamplesBeforeTorqueCut = 4;
constexpr int kBlockingTimeoutMs = 5000;
constexpr int kPositionToleranceTicks = 8;
constexpr int kSettledSampleCount = 3;

int circularDistanceTicks(const int a, const int b) {
  const int raw = std::abs(a - b);
  return std::min(raw, PanTiltController::kTicksPerRevolution - raw);
}
} // namespace

PanTiltController::PanTiltController(
    const std::string &serial_port,
    const std::array<u8, kMotorCount> &motor_ids, const int baud)
    : serial_port_(serial_port), motor_ids_(motor_ids), baud_(baud),
      opened_(false), watchdog_stop_requested_(false), watchdog_running_(false) {
}

PanTiltController::~PanTiltController() {
  stopWatchdogThread();
  if (opened_) {
    const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
    sms_sts_.end();
    opened_ = false;
  }
}

bool PanTiltController::initialize(const bool run_calibration_ofs) {
  if (!open()) {
    return false;
  }
  if (!initMotors()) {
    return false;
  }
  if (!pingMotors()) {
    return false;
  }
  if (!ensureFeedback()) {
    return false;
  }
  if (run_calibration_ofs && !runCalibrationOfs()) {
    return false;
  }
  if (!homeMotors()) {
    return false;
  }

  startWatchdogThread();
  return true;
}

bool PanTiltController::homeMotors() {
  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  LK_LOG_INFO("[pan_tilt] Homing both motors to {} ticks", kHomeTicks);
  for (int i = 0; i < kMotorCount; ++i) {
    const int id = motorId(i);
    if (!sms_sts_.WritePosEx(static_cast<u8>(id), static_cast<s16>(kHomeTicks),
                             kDefaultMoveSpeed, kDefaultMoveAcc)) {
      LK_LOG_ERROR("[pan_tilt] Home WritePosEx failed for ID {}", id);
      return false;
    }
  }

  for (int i = 0; i < kMotorCount; ++i) {
    if (!waitForMotorPositionMoveComplete(i, kHomeTicks, 3000)) {
      LK_LOG_ERROR("[pan_tilt] Home move failed for ID {}", motorId(i));
      return false;
    }
  }
  return true;
}

bool PanTiltController::setMotorAngle(const int motor_index,
                                      const double absolute_angle_rad,
                                      const u16 speed) {
  if (!isValidMotorIndex(motor_index)) {
    return false;
  }

  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  const int id = motorId(motor_index);
  const int target_ticks = wrapTicks(angleRadToTicks(absolute_angle_rad));
  if (!sms_sts_.WritePosEx(static_cast<u8>(id), static_cast<s16>(target_ticks),
                           speed, kDefaultMoveAcc)) {
    LK_LOG_ERROR("[pan_tilt] setMotorAngle failed for ID {}", id);
    return false;
  }
  LK_LOG_DEBUG("[pan_tilt] setMotorAngle ID {} -> {} rad ({} ticks)", id,
               absolute_angle_rad, target_ticks);
  return true;
}

bool PanTiltController::setMotorAngleBlocking(const int motor_index,
                                              const double absolute_angle_rad,
                                              const u16 speed) {
  if (!setMotorAngle(motor_index, absolute_angle_rad, speed)) {
    return false;
  }

  const int target_ticks = wrapTicks(angleRadToTicks(absolute_angle_rad));
  return waitForMotorPositionMoveComplete(motor_index, target_ticks,
                                          kBlockingTimeoutMs);
}

bool PanTiltController::setMotorAngleRelative(const int motor_index,
                                              const double relative_angle_rad,
                                              const u16 speed) {
  if (!isValidMotorIndex(motor_index)) {
    return false;
  }

  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  const int id = motorId(motor_index);
  const int current_ticks = sms_sts_.ReadPos(static_cast<u8>(id));
  if (current_ticks < 0) {
    LK_LOG_ERROR("[pan_tilt] ReadPos failed for ID {}", id);
    return false;
  }

  const int delta_ticks = angleRadToTicks(relative_angle_rad);
  const int target_ticks = wrapTicks(current_ticks + delta_ticks);
  if (!sms_sts_.WritePosEx(static_cast<u8>(id), static_cast<s16>(target_ticks),
                           speed, kDefaultMoveAcc)) {
    LK_LOG_ERROR("[pan_tilt] setMotorAngleRelative failed for ID {}", id);
    return false;
  }

  LK_LOG_DEBUG("[pan_tilt] Relative move ID {}: {} rad ({} -> {} ticks)", id,
               relative_angle_rad, current_ticks, target_ticks);
  return true;
}

bool PanTiltController::setMotorAngleRelativeBlocking(
    const int motor_index, const double relative_angle_rad, const u16 speed) {

  if (!setMotorAngleRelative(motor_index, relative_angle_rad, speed)) {
    return false;
  }

  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  const int id = motorId(motor_index);
  const int current_ticks = sms_sts_.ReadPos(static_cast<u8>(id));
  if (current_ticks < 0) {
    LK_LOG_ERROR("[pan_tilt] setMotorAngleRelativeBlocking ReadPos failed for ID {}",
                 id);
    return false;
  }
  const int target_ticks =
      wrapTicks(current_ticks + angleRadToTicks(relative_angle_rad));

  return waitForMotorPositionMoveComplete(motor_index, target_ticks,
                                          kBlockingTimeoutMs);
}

bool PanTiltController::setVelocity(const int motor_index,
                                    const s16 velocity_steps_per_sec,
                                    const u8 acc) {
  if (!isValidMotorIndex(motor_index)) {
    return false;
  }
  if (velocity_steps_per_sec < -3400 || velocity_steps_per_sec > 3400) {
    LK_LOG_ERROR("[pan_tilt] Velocity {} out of range [-3400, 3400]",
                 velocity_steps_per_sec);
    return false;
  }
  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  const int id = motorId(motor_index);
  if (!sms_sts_.InitMotor(static_cast<u8>(id), SMS_STS_MODE_WHEEL_CLOSED, 1)) {
    LK_LOG_ERROR("[pan_tilt] Failed to set wheel mode for ID {}", id);
    return false;
  }
  if (!sms_sts_.WriteSpe(static_cast<u8>(id), velocity_steps_per_sec, acc)) {
    LK_LOG_ERROR("[pan_tilt] setVelocity WriteSpe failed for ID {}", id);
    return false;
  }

  if (velocity_steps_per_sec < 2 && velocity_steps_per_sec > -2) {
    last_user_input_velocity_set_time_.store(std::chrono::steady_clock::now());
  }

  LK_LOG_DEBUG("[pan_tilt] setVelocity ID {} -> {} steps/s", id,
               velocity_steps_per_sec);
  return true;
}

bool PanTiltController::haltMotors(const u8 acc) {
  for (int i = 0; i < kMotorCount; ++i) {
    if (!setVelocity(i, 0, acc)) {
      LK_LOG_ERROR("[pan_tilt] halt failed for motor index {}", i);
      return false;
    }
  }
  LK_LOG_DEBUG("[pan_tilt] halt complete");
  return true;
}

std::array<PanTiltController::ServoState, PanTiltController::kMotorCount>
PanTiltController::pollState() {
  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  std::array<ServoState, kMotorCount> states{};

  for (int i = 0; i < kMotorCount; ++i) {
    const int id = motorId(i);
    ServoState &state = states[i];
    state.motor_id = id;

    if (!sms_sts_.FeedBack(id)) {
      LK_LOG_WARN("[pan_tilt] FeedBack failed while polling ID {}", id);
      continue;
    }

    state.position_ticks = sms_sts_.ReadPos(-1);
    state.speed = sms_sts_.ReadSpeed(-1);
    state.load_pwm = sms_sts_.ReadLoad(-1);
    state.voltage_01v = sms_sts_.ReadVoltage(-1);
    state.temperature_celsius = sms_sts_.ReadTemper(-1);
    state.moving = sms_sts_.ReadMove(-1);
    state.current_milliamps = sms_sts_.ReadCurrent(-1);

    state.valid = (state.position_ticks >= 0 && state.voltage_01v >= 0 &&
                   state.temperature_celsius >= 0 && state.moving >= 0 &&
                   state.current_milliamps >= 0);
    if (!state.valid) {
      LK_LOG_WARN("[pan_tilt] State decode incomplete for ID {}", id);
    }
  }

  return states;
}

bool PanTiltController::waitForMotorPositionMoveComplete(
    const int motor_index, const int target_ticks, const int timeout_ms) {
  if (!isValidMotorIndex(motor_index)) {
    return false;
  }

  const int id = motorId(motor_index);
  int settled_samples = 0;
  const auto start = std::chrono::steady_clock::now();
  while (true) {
    if (std::chrono::steady_clock::now() - start >
        std::chrono::milliseconds(timeout_ms)) {
      LK_LOG_ERROR(
          "[pan_tilt] waitForMotorPositionMoveComplete timeout for ID {}", id);
      return false;
    }

    const auto states = pollState();
    const ServoState &state = states[motor_index];
    if (!state.valid) {
      LK_LOG_ERROR("[pan_tilt] waitForMotorPositionMoveComplete failed while polling ID {}",
                   id);
      return false;
    }

    const int dist_ticks =
        circularDistanceTicks(state.position_ticks, target_ticks);
    if (state.moving == 0 && dist_ticks <= kPositionToleranceTicks) {
      ++settled_samples;
    } else {
      settled_samples = 0;
    }

    if (settled_samples >= kSettledSampleCount) {
      return true;
    }
    usleep(kStatePollUs);
  }
}

bool PanTiltController::open() {
  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  LK_LOG_INFO("[pan_tilt] Opening {} @ {} baud", serial_port_, baud_);
  if (!sms_sts_.begin(baud_, serial_port_.c_str())) {
    LK_LOG_ERROR("[pan_tilt] Failed to init SMS/STS bus");
    return false;
  }
  sms_sts_.Level = 1;
  opened_ = true;
  return true;
}

void PanTiltController::startWatchdogThread() {
  if (watchdog_running_.load()) {
    return;
  }

  watchdog_stop_requested_.store(false);
  watchdog_thread_ = std::thread(&PanTiltController::watchdogThreadMain, this);
  watchdog_running_.store(true);
  LK_LOG_INFO("[pan_tilt] Current watchdog started at {} Hz", kWatchdogRateHz);
}

void PanTiltController::stopWatchdogThread() {
  if (!watchdog_running_.load()) {
    return;
  }

  watchdog_stop_requested_.store(true);
  if (watchdog_thread_.joinable()) {
    watchdog_thread_.join();
  }
  watchdog_running_.store(false);
  LK_LOG_INFO("[pan_tilt] Current watchdog stopped");
}

void PanTiltController::watchdogThreadMain() {
  const auto watchdog_period = std::chrono::milliseconds(1000 / kWatchdogRateHz);
  auto next_wakeup = std::chrono::steady_clock::now();
  std::array<int, kMotorCount> overcurrent_sample_counts{};
  bool torque_cut_applied = false;
  uint64_t count = 0;
  while (!watchdog_stop_requested_.load()) {
    ++count;
    bool any_motor_overcurrent = false;

    const auto time_since_last_user_input_velocity_set = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - last_user_input_velocity_set_time_.load());
    if (time_since_last_user_input_velocity_set.count() > 300) {
      if (count % 10 == 0) {
        LK_LOG_WARN("[pan_tilt] Time since last user input velocity set: {} ms", time_since_last_user_input_velocity_set.count());
      }
      haltMotors();
    }
    for (int i = 0; i < kMotorCount; ++i) {
      int current_milliamps = -1;
      if (!readMotorCurrentMilliamps(i, current_milliamps)) {
        continue;
      }

      if (current_milliamps > kCurrentLimitMilliamps) {
        any_motor_overcurrent = true;
        ++overcurrent_sample_counts[i];
        const int id = motorId(i);

        if (overcurrent_sample_counts[i] == 1) {
          LK_LOG_WARN(
              "[pan_tilt] Overcurrent detected on ID {}: {} mA > {} mA; halting motors",
              id, current_milliamps, kCurrentLimitMilliamps);
          if (!haltMotors()) {
            LK_LOG_ERROR("[pan_tilt] Failed to halt motors after overcurrent");
          }
        }

        if (!torque_cut_applied &&
            overcurrent_sample_counts[i] >=
                kPersistentOvercurrentSamplesBeforeTorqueCut) {
          LK_LOG_ERROR(
              "[pan_tilt] Persistent overcurrent on ID {} after halt; disabling torque",
              id);
          for (int m = 0; m < kMotorCount; ++m) {
            if (!disableMotorTorque(m)) {
              LK_LOG_ERROR("[pan_tilt] Failed to disable torque for motor index {}",
                           m);
            }
          }
          torque_cut_applied = true;
        }
      } else {
        overcurrent_sample_counts[i] = 0;
      }
    }

    // Rearm persistent overcurrent handling after currents normalize.
    if (!any_motor_overcurrent) {
      torque_cut_applied = false;
    }

    next_wakeup += watchdog_period;
    const auto now = std::chrono::steady_clock::now();
    if (next_wakeup > now) {
      std::this_thread::sleep_until(next_wakeup);
    } else {
      next_wakeup = now;
    }
  }
}

bool PanTiltController::readMotorCurrentMilliamps(const int motor_index,
                                                  int &current_milliamps) {
  if (!isValidMotorIndex(motor_index)) {
    return false;
  }

  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  const auto id = motorId(motor_index);
  const int read_current = sms_sts_.ReadCurrent(static_cast<u8>(id));
  if (read_current < 0) {
    return false;
  }

  current_milliamps = read_current;
  return true;
}

bool PanTiltController::disableMotorTorque(const int motor_index) {
  if (!isValidMotorIndex(motor_index)) {
    return false;
  }

  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  const int id = motorId(motor_index);
  if (!sms_sts_.EnableTorque(static_cast<u8>(id), 0)) {
    LK_LOG_ERROR("[pan_tilt] EnableTorque(OFF) failed for ID {}", id);
    return false;
  }

  LK_LOG_WARN("[pan_tilt] Torque disabled for ID {}", id);
  return true;
}

bool PanTiltController::initMotors() {
  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  for (int i = 0; i < kMotorCount; ++i) {
    const int id = motorId(i);
    if (!sms_sts_.InitMotor(static_cast<u8>(id), SMS_STS_MODE_SERVO, 1)) {
      LK_LOG_ERROR("[pan_tilt] InitMotor failed for ID {}", id);
      return false;
    }
    LK_LOG_INFO("[pan_tilt] InitMotor OK for ID {}", id);
  }
  return true;
}

bool PanTiltController::pingMotors() {
  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  for (int i = 0; i < kMotorCount; ++i) {
    const int id = motorId(i);
    const int ping_id = sms_sts_.Ping(static_cast<u8>(id));
    if (ping_id != id) {
      LK_LOG_ERROR("[pan_tilt] Ping failed for ID {}", id);
      return false;
    }
    LK_LOG_INFO("[pan_tilt] Ping OK for ID {}", ping_id);
  }
  return true;
}

bool PanTiltController::ensureFeedback() {
  const auto states = pollState();
  for (int i = 0; i < kMotorCount; ++i) {
    const ServoState &state = states[i];
    if (!state.valid) {
      LK_LOG_ERROR("[pan_tilt] Feedback validation failed for ID {}",
                   state.motor_id);
      return false;
    }
    LK_LOG_INFO("[pan_tilt] Feedback OK for ID {} (pos={} voltage={} temp={})",
                state.motor_id, state.position_ticks, state.voltage_01v,
                state.temperature_celsius);
  }
  return true;
}

bool PanTiltController::runCalibrationOfs() {
  const std::lock_guard<std::recursive_mutex> lock(bus_mutex_);
  for (int i = 0; i < kMotorCount; ++i) {
    const int id = motorId(i);
    if (!sms_sts_.CalibrationOfs(static_cast<u8>(id))) {
      LK_LOG_ERROR("[pan_tilt] CalibrationOfs failed for ID {}", id);
      return false;
    }
    LK_LOG_INFO("[pan_tilt] CalibrationOfs OK for ID {}", id);
  }
  return true;
}

bool PanTiltController::isValidMotorIndex(const int motor_index) const {
  if (motor_index < 0 || motor_index >= kMotorCount) {
    LK_LOG_ERROR("[pan_tilt] Invalid motor index {}", motor_index);
    return false;
  }
  return true;
}

int PanTiltController::motorId(const int motor_index) const {
  return static_cast<int>(motor_ids_[motor_index]);
}