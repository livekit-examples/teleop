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

#include "scservo/SCServo.h"
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
  // Moderately high speed used for absolute position tracking (e.g. mirroring
  // an AR phone pose) so the robot responds quickly while staying well below
  // the 3400 steps/s hardware ceiling.
  static constexpr u16 kPositionMoveSpeed = 2400;
  static constexpr u8 kDefaultMoveAcc = 50;
  static constexpr int kCurrentLimitMilliamps = 100;

  // Software safety limits for absolute position commands, measured as an
  // offset from the home/center tick. Commands outside this range are clamped.
  // Index 0 = pan, index 1 = tilt (see kMotorCount ordering used throughout).
  static constexpr double kPanMinAngleFromHomeRad = -kPi * 75.0 / 180.0; // -75 deg
  static constexpr double kPanMaxAngleFromHomeRad = kPi * 75.0 / 180.0;  // +75 deg
  // Tilt travels only in the negative direction from home; the positive side
  // is a hard stop at home (the 0 deg limit). Driving positive torques out.
  static constexpr double kTiltMaxAngleFromHomeRad = 0.0;                // 0 deg
  static constexpr double kTiltMinAngleFromHomeRad = -kPi / 2.0;         // -90 deg

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
   * @brief Sweep both motors through the four corners of the software limit
   * box, then return home.
   *
   * Moves (blocking, in order) to: max tilt/max pan, max tilt/min pan,
   * min tilt/min pan, min tilt/max pan, then calls homeMotors(). Useful as a
   * startup self-test to verify the full range of motion is unobstructed.
   * @return true if every corner is reached and the final home succeeds.
   */
  bool exerciseLimits();

  /**
   * @brief Set absolute angle for a motor index (radians).
   * @param motor_index 0=pan, 1=tilt
   * @param absolute_angle_rad Absolute target angle in radians.
   * @param speed Optional move speed in ticks/s.
   */
  bool setMotorAngle(int motor_index, double absolute_angle_rad,
                     u16 speed = kDefaultMoveSpeed);

  /**
   * @brief Set an absolute angle measured from the home/center position.
   *
   * Intended for absolute position tracking (e.g. mirroring an external pose
   * source such as an AR phone). The requested offset is clamped to the
   * per-axis software safety limits before being commanded, the target motor
   * is switched into servo/position mode if needed, and the position is held
   * indefinitely (it does not time out). While any position is held, the
   * velocity deadman watchdog is suspended; overcurrent protection still
   * applies.
   * @param motor_index 0=pan, 1=tilt
   * @param angle_from_home_rad Target offset from home in radians (clamped to
   * the per-axis limits).
   * @param speed Optional move speed in ticks/s.
   * @return true on success, false on invalid index or hardware failure.
   */
  bool setMotorAngleFromHome(int motor_index, double angle_from_home_rad,
                             u16 speed = kPositionMoveSpeed);

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

  /**
   * @brief Poll and print the current pan/tilt angles.
   *
   * Prints both the relative angle (measured from the home/center tick) and the
   * global angle (measured from the servo's zero tick) for pan (index 0) and
   * tilt (index 1), in degrees.
   * @return true if both motors reported valid state, false otherwise.
   */
  bool printAngles();

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
   * @brief Ensure a motor is in servo/position mode before a position command.
   *
   * Tracks the last commanded bus mode per motor and only re-initializes the
   * motor when transitioning out of wheel/velocity mode, avoiding redundant
   * mode switches when streaming position commands at a high rate.
   * @param motor_index The motor index
   * @return true on success, false on failure
   */
  bool ensureServoMode(int motor_index);
  /**
   * @brief Clamp an offset-from-home angle to the per-axis software limits.
   * @param motor_index The motor index (0=pan, 1=tilt)
   * @param angle_from_home_rad Requested offset from home in radians
   * @return the clamped offset in radians
   */
  static double clampAngleFromHomeRad(int motor_index,
                                      double angle_from_home_rad);
  /**
   * @brief Convert a clamped offset-from-home angle to absolute servo ticks.
   * @param motor_index The motor index (0=pan, 1=tilt)
   * @param angle_from_home_rad Requested offset from home in radians
   * @return the absolute target position in servo ticks
   */
  static int angleFromHomeToTicks(int motor_index, double angle_from_home_rad);

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

  /**
   * @brief Convert ticks to angle in radians.
   * @param ticks The servo position in ticks
   * @return the angle in radians
   */
  static inline double ticksToAngleRad(const int ticks) {
    const double radians_per_tick =
        (2.0 * kPi) / static_cast<double>(kTicksPerRevolution);
    return static_cast<double>(ticks) * radians_per_tick;
  }

  /**
   * @brief Convert ticks to angle in degrees.
   * @param ticks The servo position in ticks
   * @return the angle in degrees
   */
  static inline double ticksToAngleDeg(const int ticks) {
    return ticksToAngleRad(ticks) * (180.0 / kPi);
  }

  /** Bus operating mode last commanded to a motor. */
  enum class BusMode { kUnknown = 0, kServo = 1, kWheel = 2 };

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
  // True while an absolute position is being held. Suspends the velocity
  // deadman watchdog so latched positions persist without timing out.
  std::atomic<bool> position_hold_active_{false};
  std::array<std::atomic<int>, kMotorCount> motor_bus_mode_;
};

#endif // PAN_TILT_CONTROLLER_H
