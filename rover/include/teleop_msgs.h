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

#pragma once

#include <nlohmann/json.hpp>

#include <array>
#include <cmath>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

/** @brief Typed rover telemetry and control message schemas plus JSON helpers.
 */
namespace teleop_msgs {

/** @brief Shared JSON type used by the message conversion helpers below. */
using json = nlohmann::json;

/** @brief Three-axis vector used by IMU-related message fields. */
struct Vec3 {
  double x{0.0}; ///< X-axis component in the enclosing message's units.
  double y{0.0}; ///< Y-axis component in the enclosing message's units.
  double z{0.0}; ///< Z-axis component in the enclosing message's units.
};

/** @brief Unit quaternion orientation. */
struct Quaternion {
  double x{0.0}; ///< Vector part X.
  double y{0.0}; ///< Vector part Y.
  double z{0.0}; ///< Vector part Z.
  double w{1.0}; ///< Scalar part; identity rotation by default.
};

/** @brief Sample time mirroring ROS2 `builtin_interfaces/msg/Time`. */
struct TimeStamp {
  std::int32_t sec{0};      ///< Whole seconds since the epoch.
  std::uint32_t nanosec{0}; ///< Nanoseconds within the current second.
};

/** @brief Message header mirroring ROS2 `std_msgs/msg/Header`. */
struct Header {
  std::string frame_id; ///< Coordinate frame the data is associated with.
  TimeStamp stamp;      ///< Sample time.
};

/** @brief Row-major 3x3 covariance matrix; all zeros means unknown. */
using Covariance3 = std::array<double, 9>;

/** @brief Typed IMU sample mirroring ROS2 `sensor_msgs/msg/Imu`.
 *
 * https://docs.ros2.org/foxy/api/sensor_msgs/msg/Imu.html
 */
struct ImuMsg {
  Header header;                              ///< Frame and sample time.
  Quaternion orientation;                     ///< Orientation estimate.
  Covariance3 orientation_covariance{};       ///< About x/y/z axes in rad^2.
  Vec3 angular_velocity;                      ///< Angular rate in rad/s.
  Covariance3 angular_velocity_covariance{};  ///< In (rad/s)^2.
  Vec3 linear_acceleration;                   ///< Acceleration in m/s^2.
  Covariance3 linear_acceleration_covariance{}; ///< In (m/s^2)^2.
};

/**
 * @brief Converts intrinsic roll/pitch/yaw Euler angles to a unit quaternion.
 * @param roll Rotation around X in radians.
 * @param pitch Rotation around Y in radians.
 * @param yaw Rotation around Z in radians.
 * @return Equivalent unit quaternion.
 */
inline Quaternion quaternionFromEulerRad(double roll, double pitch,
                                         double yaw) {
  const double cr = std::cos(roll * 0.5);
  const double sr = std::sin(roll * 0.5);
  const double cp = std::cos(pitch * 0.5);
  const double sp = std::sin(pitch * 0.5);
  const double cy = std::cos(yaw * 0.5);
  const double sy = std::sin(yaw * 0.5);
  Quaternion q;
  q.x = sr * cp * cy - cr * sp * sy;
  q.y = cr * sp * cy + sr * cp * sy;
  q.z = cr * cp * sy - sr * sp * cy;
  q.w = cr * cp * cy + sr * sp * sy;
  return q;
}

/** @brief Differential drive command expressed in revolutions per second.
 *
 * On the wire this uses a Twist-shaped JSON schema: `throttle_rps` maps to
 * `linear.x` and `steering_rps` maps to `angular.z`; the remaining axes are
 * reserved and serialized as zero.
 */
struct ControlCmdMsg {
  double throttle_rps{0.0}; ///< Forward or reverse wheel velocity request.
  double steering_rps{0.0}; ///< Differential steering velocity request.
};

/** @brief RPC payload used to claim or release exclusive rover control. */
struct AcquireControlRequest {
  bool acquire{true}; ///< True to claim control, false to release it.
};

/** @brief Internal JSON parsing helpers shared by the public conversion APIs.
 */
namespace detail {
/**
 * @brief Ensures a JSON node is an object before field-level parsing continues.
 * @param value JSON node to validate.
 * @param field_name Field label used in generated error messages.
 * @param error Optional destination for parse failure details.
 * @return True when `value` is a JSON object.
 */
inline bool requireObject(const json &value, const char *field_name,
                          std::string *error) {
  if (!value.is_object()) {
    if (error != nullptr) {
      *error = std::string(field_name) + " must be an object";
    }
    return false;
  }
  return true;
}

/**
 * @brief Verifies that a required field is present on a JSON object.
 * @param value JSON object to inspect.
 * @param field_name Name of the required field.
 * @param error Optional destination for parse failure details.
 * @return True when the field is present.
 */
inline bool requireField(const json &value, const char *field_name,
                         std::string *error) {
  if (!value.contains(field_name)) {
    if (error != nullptr) {
      *error = std::string("missing required field '") + field_name + "'";
    }
    return false;
  }
  return true;
}

/**
 * @brief Reads a required numeric field into an output variable.
 * @param value JSON object containing the field.
 * @param field_name Name of the required numeric field.
 * @param out Destination for the parsed numeric value.
 * @param error Optional destination for parse failure details.
 * @return True when the field exists and is numeric.
 */
inline bool readRequiredNumber(const json &value, const char *field_name,
                               double *out, std::string *error) {
  if (!requireField(value, field_name, error)) {
    return false;
  }
  const auto &field = value.at(field_name);
  if (!field.is_number()) {
    if (error != nullptr) {
      *error = std::string("field '") + field_name + "' must be numeric";
    }
    return false;
  }
  *out = field.get<double>();
  return true;
}

/**
 * @brief Reads a required boolean field into an output variable.
 * @param value JSON object containing the field.
 * @param field_name Name of the required boolean field.
 * @param out Destination for the parsed boolean value.
 * @param error Optional destination for parse failure details.
 * @return True when the field exists and is boolean.
 */
inline bool readRequiredBool(const json &value, const char *field_name,
                             bool *out, std::string *error) {
  if (!requireField(value, field_name, error)) {
    return false;
  }
  const auto &field = value.at(field_name);
  if (!field.is_boolean()) {
    if (error != nullptr) {
      *error = std::string("field '") + field_name + "' must be boolean";
    }
    return false;
  }
  *out = field.get<bool>();
  return true;
}

/**
 * @brief Parses a `{x,y,z}` object from a named field.
 * @param value JSON object containing the field.
 * @param field_name Name of the vector field.
 * @param out Destination for the parsed vector.
 * @param error Optional destination for parse failure details.
 * @return True when the field is present and contains numeric axes.
 */
inline bool parseVec3(const json &value, const char *field_name, Vec3 *out,
                      std::string *error) {
  if (!requireField(value, field_name, error)) {
    return false;
  }
  const auto &field = value.at(field_name);
  if (!requireObject(field, field_name, error)) {
    return false;
  }
  return readRequiredNumber(field, "x", &out->x, error) &&
         readRequiredNumber(field, "y", &out->y, error) &&
         readRequiredNumber(field, "z", &out->z, error);
}

/**
 * @brief Parses a `{x,y,z,w}` quaternion object from a named field.
 * @param value JSON object containing the field.
 * @param field_name Name of the quaternion field.
 * @param out Destination for the parsed quaternion.
 * @param error Optional destination for parse failure details.
 * @return True when the field is present and contains numeric components.
 */
inline bool parseQuaternion(const json &value, const char *field_name,
                            Quaternion *out, std::string *error) {
  if (!requireField(value, field_name, error)) {
    return false;
  }
  const auto &field = value.at(field_name);
  if (!requireObject(field, field_name, error)) {
    return false;
  }
  return readRequiredNumber(field, "x", &out->x, error) &&
         readRequiredNumber(field, "y", &out->y, error) &&
         readRequiredNumber(field, "z", &out->z, error) &&
         readRequiredNumber(field, "w", &out->w, error);
}

/**
 * @brief Parses a 9-element covariance array from a named field.
 * @param value JSON object containing the field.
 * @param field_name Name of the covariance field.
 * @param out Destination for the parsed covariance matrix.
 * @param error Optional destination for parse failure details.
 * @return True when the field is a 9-element array of numbers.
 */
inline bool parseCovariance(const json &value, const char *field_name,
                            Covariance3 *out, std::string *error) {
  if (!requireField(value, field_name, error)) {
    return false;
  }
  const auto &field = value.at(field_name);
  if (!field.is_array() || field.size() != out->size()) {
    if (error != nullptr) {
      *error = std::string("field '") + field_name +
               "' must be an array of 9 numbers";
    }
    return false;
  }
  for (std::size_t i = 0; i < out->size(); ++i) {
    if (!field[i].is_number()) {
      if (error != nullptr) {
        *error = std::string("field '") + field_name +
                 "' must be an array of 9 numbers";
      }
      return false;
    }
    (*out)[i] = field[i].get<double>();
  }
  return true;
}

/**
 * @brief Parses a `{frame_id,stamp:{sec,nanosec}}` header from a named field.
 * @param value JSON object containing the field.
 * @param field_name Name of the header field.
 * @param out Destination for the parsed header.
 * @param error Optional destination for parse failure details.
 * @return True when the field matches the header schema.
 */
inline bool parseHeader(const json &value, const char *field_name, Header *out,
                        std::string *error) {
  if (!requireField(value, field_name, error)) {
    return false;
  }
  const auto &field = value.at(field_name);
  if (!requireObject(field, field_name, error)) {
    return false;
  }
  if (!requireField(field, "frame_id", error)) {
    return false;
  }
  if (!field.at("frame_id").is_string()) {
    if (error != nullptr) {
      *error = "field 'frame_id' must be a string";
    }
    return false;
  }
  out->frame_id = field.at("frame_id").get<std::string>();
  if (!requireField(field, "stamp", error)) {
    return false;
  }
  const auto &stamp = field.at("stamp");
  if (!requireObject(stamp, "stamp", error)) {
    return false;
  }
  double sec = 0.0;
  double nanosec = 0.0;
  if (!readRequiredNumber(stamp, "sec", &sec, error) ||
      !readRequiredNumber(stamp, "nanosec", &nanosec, error)) {
    return false;
  }
  out->stamp.sec = static_cast<std::int32_t>(sec);
  out->stamp.nanosec = static_cast<std::uint32_t>(nanosec);
  return true;
}

/**
 * @brief Parses a UTF-8 JSON payload received over the wire.
 * @param payload Encoded JSON bytes.
 * @param out Destination for the parsed JSON value.
 * @param error Optional destination for parse failure details.
 * @return True when the payload contains valid JSON.
 */
inline bool parseJsonPayload(const std::vector<std::uint8_t> &payload,
                             json *out, std::string *error) {
  try {
    *out = json::parse(payload.begin(), payload.end());
    return true;
  } catch (const std::exception &e) {
    if (error != nullptr) {
      *error = std::string("invalid JSON: ") + e.what();
    }
    return false;
  }
}

/**
 * @brief Serializes JSON text to a byte payload for tracks or RPCs.
 * @param value JSON value to encode.
 * @return UTF-8 encoded bytes containing the serialized JSON text.
 */
inline std::vector<std::uint8_t> encodeJson(const json &value) {
  const std::string text = value.dump();
  return std::vector<std::uint8_t>(text.begin(), text.end());
}
} // namespace detail

/**
 * @brief Serializes an IMU sample to the canonical wire JSON schema.
 * @param msg Typed IMU sample to serialize.
 * @return JSON representation of the IMU sample.
 */
inline json toJson(const ImuMsg &msg) {
  return json{
      {"angular_velocity",
       {{"x", msg.angular_velocity.x},
        {"y", msg.angular_velocity.y},
        {"z", msg.angular_velocity.z}}},
      {"angular_velocity_covariance", msg.angular_velocity_covariance},
      {"header",
       {{"frame_id", msg.header.frame_id},
        {"stamp",
         {{"nanosec", msg.header.stamp.nanosec},
          {"sec", msg.header.stamp.sec}}}}},
      {"linear_acceleration",
       {{"x", msg.linear_acceleration.x},
        {"y", msg.linear_acceleration.y},
        {"z", msg.linear_acceleration.z}}},
      {"linear_acceleration_covariance", msg.linear_acceleration_covariance},
      {"orientation",
       {{"w", msg.orientation.w},
        {"x", msg.orientation.x},
        {"y", msg.orientation.y},
        {"z", msg.orientation.z}}},
      {"orientation_covariance", msg.orientation_covariance},
  };
}

/**
 * @brief Serializes a control command to the canonical wire JSON schema.
 * @param msg Typed control command to serialize.
 * @return JSON representation of the control command.
 */
inline json toJson(const ControlCmdMsg &msg) {
  return json{
      {"angular", {{"x", 0.0}, {"y", 0.0}, {"z", msg.steering_rps}}},
      {"linear", {{"x", msg.throttle_rps}, {"y", 0.0}, {"z", 0.0}}},
  };
}

/**
 * @brief Serializes an acquire or release request to the RPC JSON schema.
 * @param msg Typed acquire-control request to serialize.
 * @return JSON representation of the acquire-control request.
 */
inline json toJson(const AcquireControlRequest &msg) {
  return json{{"acquire", msg.acquire}};
}

/**
 * @brief Encodes an IMU message as a UTF-8 JSON payload.
 * @param msg Typed IMU message to encode.
 * @return Encoded payload suitable for a LiveKit data track.
 */
inline std::vector<std::uint8_t> toPayload(const ImuMsg &msg) {
  return detail::encodeJson(toJson(msg));
}

/**
 * @brief Encodes a control command as a UTF-8 JSON payload.
 * @param msg Typed control command to encode.
 * @return Encoded payload suitable for a LiveKit data track.
 */
inline std::vector<std::uint8_t> toPayload(const ControlCmdMsg &msg) {
  return detail::encodeJson(toJson(msg));
}

/**
 * @brief Encodes an acquire or release request as a UTF-8 JSON payload.
 * @param msg Typed acquire-control request to encode.
 * @return Encoded payload suitable for an RPC body.
 */
inline std::vector<std::uint8_t> toPayload(const AcquireControlRequest &msg) {
  return detail::encodeJson(toJson(msg));
}

/**
 * @brief Parses an IMU JSON object into a typed message structure.
 * @param value JSON object to parse.
 * @param out Destination for the parsed IMU message.
 * @param error Optional destination for parse failure details.
 * @return True when the JSON object matches the IMU schema.
 */
inline bool fromJson(const json &value, ImuMsg *out, std::string *error) {
  if (!detail::requireObject(value, "imu", error)) {
    return false;
  }
  return detail::parseHeader(value, "header", &out->header, error) &&
         detail::parseQuaternion(value, "orientation", &out->orientation,
                                 error) &&
         detail::parseCovariance(value, "orientation_covariance",
                                 &out->orientation_covariance, error) &&
         detail::parseVec3(value, "angular_velocity", &out->angular_velocity,
                           error) &&
         detail::parseCovariance(value, "angular_velocity_covariance",
                                 &out->angular_velocity_covariance, error) &&
         detail::parseVec3(value, "linear_acceleration",
                           &out->linear_acceleration, error) &&
         detail::parseCovariance(value, "linear_acceleration_covariance",
                                 &out->linear_acceleration_covariance, error);
}

/**
 * @brief Parses a control command JSON object into a typed message structure.
 * @param value JSON object to parse.
 * @param out Destination for the parsed control command.
 * @param error Optional destination for parse failure details.
 * @return True when the JSON object matches the control-command schema.
 */
inline bool fromJson(const json &value, ControlCmdMsg *out,
                     std::string *error) {
  if (!detail::requireObject(value, "control_cmd", error)) {
    return false;
  }
  Vec3 linear;
  Vec3 angular;
  if (!detail::parseVec3(value, "linear", &linear, error) ||
      !detail::parseVec3(value, "angular", &angular, error)) {
    return false;
  }
  out->throttle_rps = linear.x;
  out->steering_rps = angular.z;
  return true;
}

/**
 * @brief Parses an acquire or release JSON object.
 * @param value JSON object to parse.
 * @param out Destination for the parsed acquire-control request.
 * @param error Optional destination for parse failure details.
 * @return True when the JSON object contains a supported acquire/release flag.
 *
 * Legacy `release` and `unset` spellings are accepted for compatibility.
 */
inline bool fromJson(const json &value, AcquireControlRequest *out,
                     std::string *error) {
  if (!detail::requireObject(value, "acquire_control", error)) {
    return false;
  }
  if (value.contains("acquire")) {
    return detail::readRequiredBool(value, "acquire", &out->acquire, error);
  }
  if (value.contains("release")) {
    bool release = false;
    if (!detail::readRequiredBool(value, "release", &release, error)) {
      return false;
    }
    out->acquire = !release;
    return true;
  }
  if (value.contains("unset")) {
    bool unset = false;
    if (!detail::readRequiredBool(value, "unset", &unset, error)) {
      return false;
    }
    out->acquire = !unset;
    return true;
  }
  if (error != nullptr) {
    *error = "expected one of 'acquire', 'release', or 'unset'";
  }
  return false;
}

/**
 * @brief Parses an IMU payload from UTF-8 JSON bytes.
 * @param payload Encoded JSON payload.
 * @param out Destination for the parsed IMU message.
 * @param error Optional destination for parse failure details.
 * @return True when the payload contains a valid IMU message.
 */
inline bool fromPayload(const std::vector<std::uint8_t> &payload, ImuMsg *out,
                        std::string *error) {
  json value;
  if (!detail::parseJsonPayload(payload, &value, error)) {
    return false;
  }
  return fromJson(value, out, error);
}

/**
 * @brief Parses a control command payload from UTF-8 JSON bytes.
 * @param payload Encoded JSON payload.
 * @param out Destination for the parsed control command.
 * @param error Optional destination for parse failure details.
 * @return True when the payload contains a valid control command.
 */
inline bool fromPayload(const std::vector<std::uint8_t> &payload,
                        ControlCmdMsg *out, std::string *error) {
  json value;
  if (!detail::parseJsonPayload(payload, &value, error)) {
    return false;
  }
  return fromJson(value, out, error);
}

/**
 * @brief Parses an acquire or release payload from UTF-8 JSON bytes.
 * @param payload Encoded JSON payload.
 * @param out Destination for the parsed acquire-control request.
 * @param error Optional destination for parse failure details.
 * @return True when the payload contains a valid acquire-control message.
 */
inline bool fromPayload(const std::vector<std::uint8_t> &payload,
                        AcquireControlRequest *out, std::string *error) {
  json value;
  if (!detail::parseJsonPayload(payload, &value, error)) {
    return false;
  }
  return fromJson(value, out, error);
}

} // namespace teleop_msgs
