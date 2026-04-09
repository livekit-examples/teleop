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

#ifndef PAN_TILT_CONTROLLER_H
#define PAN_TILT_CONTROLLER_H

#include <array>
#include <atomic>
#include <cmath>
#include <mutex>
#include <string>
#include <thread>

#include "SCServo.h"
#include "ostream_log.h"

/**
 * @brief Two-axis SMS/STS pan-tilt controller for STS3215-class servos.
 *
 * @details
 * This class owns the SMS_STS transport lifecycle (open/close), validates bus
 * connectivity, and exposes simple application-level control methods for two
 * motors:
 * - Initialize motors (mode + torque)
 * - Verify each motor responds to Ping and feedback reads
 * - Optionally run center calibration (CalibrationOfs)
 * - Home both motors to center position
 * - Set absolute angle
 * - Set relative angle (current position + delta)
 *
 * @note this assumes that limits of the motors and IDs are correctly set using
 * the SetLimits program Angle/tick conversion assumes 4096 ticks per 2*pi
 * radians.
 */
class PanTiltController {
public:
  static constexpr int kMotorCount = 2;
  static constexpr int kDefaultBaud = 1000000;
  static constexpr int kTicksPerRevolution = 4096;
  static constexpr double kPi = 3.14159265358979323846;
  static constexpr int kHomeTicks = 2048;
  static constexpr u16 kDefaultMoveSpeed =
      1000; //  Moving speed (0-3400 steps/s)
  static constexpr u8 kDefaultMoveAcc = 50;
  static constexpr int kCurrentLimitMilliamps = 100;

  /**
   * @brief Snapshot of a single servo's most recent state.
   *
   * Values map directly to SMS/STS feedback registers returned by FeedBack():
   * position, speed, load, supply voltage, internal temperature, moving flag,
   * and current. `valid` is false if feedback failed for that servo.
   */
  struct ServoState {
    int motor_id{-1};
    int position_ticks{-1};
    int speed{-1};
    int load_pwm{-1};
    int voltage_01v{-1};
    int temperature_celsius{-1};
    int moving{-1};
    int current_milliamps{-1};
    bool valid{false};
  };

  /**
   * @brief Construct a controller for a serial port and two motor IDs.
   */
  PanTiltController(const std::string &serial_port,
                    const std::array<u8, kMotorCount> &motor_ids,
                    int baud = kDefaultBaud);

  /**
   * @brief Ensures serial transport is closed on destruction.
   */
  ~PanTiltController();

  PanTiltController(const PanTiltController &) = delete;
  PanTiltController &operator=(const PanTiltController &) = delete;

  /**
   * @brief Open bus, init motors, verify ping+feedback, optional calibration,
   * then home.
   * @param run_calibration_ofs If true, runs CalibrationOfs on each motor
   * before homing.
   * @return true on success, false on any failed hardware operation.
   */
  bool initialize(bool run_calibration_ofs);

  /**
   * @brief Command both motors to home/center tick position.
   */
  bool homeMotors();

  /**
   * @brief Set absolute angle for a motor index (radians).
   * @param motor_index 0=pan, 1=tilt
   * @param absolute_angle_rad Absolute target angle in radians.
   * @param speed Optional move speed in ticks/s.
   */
  bool setMotorAngle(int motor_index, double absolute_angle_rad,
                     u16 speed = kDefaultMoveSpeed);

  /**
   * @brief Blocking absolute move for a motor index (radians).
   *
   * Calls setMotorAngle(), then polls state every 10ms until
   * that motor reports moving == 0.
   * @param speed Optional move speed in ticks/s.
   */
  bool setMotorAngleBlocking(int motor_index, double absolute_angle_rad,
                             u16 speed = kDefaultMoveSpeed);

  /**
   * @brief Set relative angle for a motor index (radians).
   *
   * Reads current encoder position and applies:
   *   target = current + relative_delta
   * @param speed Optional move speed in ticks/s.
   */
  bool setMotorAngleRelative(int motor_index, double relative_angle_rad,
                             u16 speed = kDefaultMoveSpeed);

  /**
   * @brief Blocking relative move for a motor index (radians).
   *
   * Calls setMotorAngleRelative(), then polls state every 10ms until
   * that motor reports moving == 0.
   * @param speed Optional move speed in ticks/s.
   */
  bool setMotorAngleRelativeBlocking(int motor_index, double relative_angle_rad,
                                     u16 speed = kDefaultMoveSpeed);

  /**
   * @brief Set wheel-mode velocity for a motor index (steps/s).
   *
   * Switches the target motor into closed-loop wheel mode and commands speed.
   * Positive values rotate one direction, negative values reverse.
   * @param motor_index 0=pan, 1=tilt
   * @param velocity_steps_per_sec Target velocity in range [-3400, 3400].
   * @param acc Optional acceleration (units of 100 steps/s^2).
   */
  bool setVelocity(int motor_index, s16 velocity_steps_per_sec,
                   u8 acc = kDefaultMoveAcc);

  /**
   * @brief Stop all motors by commanding zero wheel velocity.
   *
   * Sends setVelocity(..., 0) to each configured motor.
   * @param acc Optional acceleration (units of 100 steps/s^2).
   */
  bool haltMotors(u8 acc = kDefaultMoveAcc);

  /**
   * @brief Poll all available state fields for both motors.
   *
   * Uses one FeedBack() transaction per motor, then decodes all cached fields.
   * @return Array with one ServoState per motor index.
   */
  std::array<ServoState, kMotorCount> pollState();

private:
  /**
   * @brief Wait until a motor reaches target ticks and reports not moving.
   * @param motor_index The motor index (0..kMotorCount-1)
   * @param target_ticks Target position in servo ticks
   * @param timeout_ms Timeout in milliseconds
   * @return true when target is reached and motion is settled; false on
   * timeout/error
   */
  bool waitForMotorPositionMoveComplete(int motor_index, int target_ticks,
                                        int timeout_ms);

  /**
   * @brief Open the /dev/tty* device
   * @return true on success, false on failure
   */
  bool open();
  /**
   * @brief Initialize the motors
   * @return true on success, false on failure
   */
  bool initMotors();
  /**
   * @brief Ping the motors
   * @return true on success, false on failure
   */
  bool pingMotors();
  /**
   * @brief Ensure the feedback is enabled
   * @return true on success, false on failure
   */
  bool ensureFeedback();
  /**
   * @brief Run the calibration ofs (sets the current position to 0)
   * @return true on success, false on failure
   */
  bool runCalibrationOfs();
  /**
   * @brief Check if the motor index is valid
   * @param motor_index The motor index
   * @return true if the motor index is valid, false otherwise
   */
  bool isValidMotorIndex(int motor_index) const;
  /**
   * @brief Get the motor ID
   * @param motor_index The motor index
   * @return the motor ID
   */
  int motorId(int motor_index) const;
  /**
   * @brief Start the watchdog thread
   */
  void startWatchdogThread();
  /**
   * @brief Stop the watchdog thread
   */
  void stopWatchdogThread();
  /**
   * @brief The main function for the watchdog thread
   */
  void watchdogThreadMain();
  /**
   * @brief Read the motor current in milliamps
   * @param motor_index The motor index
   * @param current_milliamps The current in milliamps
   * @return true on success, false on failure
   */
  bool readMotorCurrentMilliamps(int motor_index, int &current_milliamps);
  /**
   * @brief Disable the motor torque
   * @param motor_index The motor index
   * @return true on success, false on failure
   */
  bool disableMotorTorque(int motor_index);

  /**
   * @brief Wrap the ticks
   * @param raw_ticks The raw ticks
   * @return the wrapped ticks
   */
  static inline int wrapTicks(int raw_ticks) {
    int wrapped = raw_ticks % kTicksPerRevolution;
    if (wrapped < 0) {
      wrapped += kTicksPerRevolution;
    }
    return wrapped;
  }

  /**
   * @brief Convert angle to ticks
   * @param angle_rad The angle in radians
   * @return the angle in ticks
   */
  static inline int angleRadToTicks(const double angle_rad) {
    const double ticks_per_radian =
        static_cast<double>(kTicksPerRevolution) / (2.0 * kPi);
    return static_cast<int>(std::lround(angle_rad * ticks_per_radian));
  }

  std::string serial_port_;
  std::array<u8, kMotorCount> motor_ids_;
  int baud_;
  SMS_STS sms_sts_;
  bool opened_;
  mutable std::recursive_mutex bus_mutex_;
  std::atomic<bool> watchdog_stop_requested_;
  std::atomic<bool> watchdog_running_;
  std::thread watchdog_thread_;
  std::atomic<std::chrono::steady_clock::time_point>
      last_user_input_velocity_set_time_;
};

#endif // PAN_TILT_CONTROLLER_H
