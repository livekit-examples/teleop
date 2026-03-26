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

/** @brief Euler orientation in radians. */
struct OrientationRad {
  double roll{0.0};  ///< Rotation around the rover's X axis.
  double pitch{0.0}; ///< Rotation around the rover's Y axis.
  double yaw{0.0};   ///< Rotation around the rover's Z axis.
};

/** @brief Typed IMU sample kept in C++ form until serialized for transport. */
struct ImuMsg {
  OrientationRad orientation_rad; ///< Filtered orientation estimate in radians.
  Vec3 accel_mg;                  ///< Linear acceleration in milli-g.
  Vec3 gyro_dps;                  ///< Angular velocity in degrees per second.
  Vec3 mag_ut;                    ///< Magnetic field strength in microtesla.
  double temperature_c{0.0};      ///< Sensor temperature in degrees Celsius.
};

/** @brief Differential drive command expressed in revolutions per second. */
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
 * @brief Parses a `{roll,pitch,yaw}` object from a named field.
 * @param value JSON object containing the field.
 * @param field_name Name of the orientation field.
 * @param out Destination for the parsed orientation.
 * @param error Optional destination for parse failure details.
 * @return True when the field is present and contains numeric Euler angles.
 */
inline bool parseOrientation(const json &value, const char *field_name,
                             OrientationRad *out, std::string *error) {
  if (!requireField(value, field_name, error)) {
    return false;
  }
  const auto &field = value.at(field_name);
  if (!requireObject(field, field_name, error)) {
    return false;
  }
  return readRequiredNumber(field, "roll", &out->roll, error) &&
         readRequiredNumber(field, "pitch", &out->pitch, error) &&
         readRequiredNumber(field, "yaw", &out->yaw, error);
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
      {"orientation_rad",
       {{"roll", msg.orientation_rad.roll},
        {"pitch", msg.orientation_rad.pitch},
        {"yaw", msg.orientation_rad.yaw}}},
      {"accel_mg",
       {{"x", msg.accel_mg.x}, {"y", msg.accel_mg.y}, {"z", msg.accel_mg.z}}},
      {"gyro_dps",
       {{"x", msg.gyro_dps.x}, {"y", msg.gyro_dps.y}, {"z", msg.gyro_dps.z}}},
      {"mag_ut",
       {{"x", msg.mag_ut.x}, {"y", msg.mag_ut.y}, {"z", msg.mag_ut.z}}},
      {"temperature_c", msg.temperature_c},
  };
}

/**
 * @brief Serializes a control command to the canonical wire JSON schema.
 * @param msg Typed control command to serialize.
 * @return JSON representation of the control command.
 */
inline json toJson(const ControlCmdMsg &msg) {
  return json{
      {"throttle_rps", msg.throttle_rps},
      {"steering_rps", msg.steering_rps},
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
  return detail::parseOrientation(value, "orientation_rad",
                                  &out->orientation_rad, error) &&
         detail::parseVec3(value, "accel_mg", &out->accel_mg, error) &&
         detail::parseVec3(value, "gyro_dps", &out->gyro_dps, error) &&
         detail::parseVec3(value, "mag_ut", &out->mag_ut, error) &&
         detail::readRequiredNumber(value, "temperature_c", &out->temperature_c,
                                    error);
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
  return detail::readRequiredNumber(value, "throttle_rps", &out->throttle_rps,
                                    error) &&
         detail::readRequiredNumber(value, "steering_rps", &out->steering_rps,
                                    error);
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
