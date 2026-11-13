"""Generate proposed discovery documents, not a working teleop implementation.

Uses only the standard library. Rates and generic hardware endpoints are
illustrative. Panda joint/controller names follow the MoveIt dual-Panda demo.
See ../../docs/configuration.md for the field reference.
"""

import copy
import json
import math
import re
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "examples"
IDENTIFIER = re.compile(r"[a-z][a-z0-9_]*")
EXCLUSIONS = ("exclude_data_tracks", "exclude_video_tracks", "exclude_audio_tracks")
PROFILES = {
    'base.twist.v1',
    'base.holonomic_twist.v1',
    'base.ackermann_drive.v1',
    'joints.velocity_jog.v1',
    'joints.trajectory.v1',
    'arm.cartesian_pose.v1',
    'gripper.position.v1',
}


def operation(profile, command_track, msg_type, feedback_tracks=()):
    value = {
        "profile": profile,
        "command": {"track_name": command_track, "msg_type": msg_type, "format": "json"},
    }
    if feedback_tracks:
        value["feedback_tracks"] = list(feedback_tracks)
    return value


def base_model(kinematics="differential"):
    profile = {
        "differential": "base.twist.v1",
        "ackermann": "base.ackermann_drive.v1",
        "holonomic": "base.holonomic_twist.v1",
    }[kinematics]
    command_track = "/ackermann_cmd" if kinematics == "ackermann" else "/cmd_vel"
    command_type = (
        "ackermann_msgs/msg/AckermannDrive" if kinematics == "ackermann"
        else "geometry_msgs/msg/Twist"
    )
    return {
        "control_interfaces": {
            "base": {
                "label": "Rover",
                "frame_id": "base_link",
                "operations": {"drive": operation(profile, command_track, command_type)},
            }
        },
    }


def joint_model(key, label, names=None, *, arm=True, vr=False):
    names = names or [f"{key}_joint_{i}" for i in range(1, 7)]
    state_track = f"/{key}/joint_states"
    model = {
        "control_interfaces": {
            key: {
                "label": label,
                "frame_id": f"{key}_base_link",
                "joint_names": names,
                "operations": {
                    "joint_velocity": operation(
                        "joints.velocity_jog.v1", f"/{key}/joint_jog",
                        "control_msgs/msg/JointJog",
                    )
                },
            }
        },
    }
    if arm:
        model["control_interfaces"][key]["operations"]["joint_position"] = operation(
            "joints.trajectory.v1", f"/{key}/joint_trajectory",
            "trajectory_msgs/msg/JointTrajectory", [state_track],
        )
        gripper =operation("gripper.position.v1", f"/{key}/gripper_trajectory",
                            "trajectory_msgs/msg/JointTrajectory", [state_track])
        gripper.update(control_channel="gripper", joint_names=[f"{key}_gripper_joint"])
        model["control_interfaces"][key]["operations"]["gripper_position"] = gripper
    if vr:
        model["control_interfaces"][key]["operations"]["cartesian_pose"] = operation(
            "arm.cartesian_pose.v1", f"/{key}/pose_target", "geometry_msgs/msg/PoseStamped",
            [f"/{key}/end_effector_pose"],
        )
    return model


def panda_model():
    model = {"control_interfaces": {}}
    for side in ("left", "right"):
        key = f"{side}_arm"
        model["control_interfaces"][key] = {
            "label": f"{side.capitalize()} Panda arm",
            "frame_id": f"{side}_panda_link0",
            "joint_names": [f"{side}_panda_joint{i}" for i in range(1, 8)],
            "operations": {
                "trajectory": operation(
                    "joints.trajectory.v1", f"/{side}_arm_controller/joint_trajectory",
                    "trajectory_msgs/msg/JointTrajectory", ["/joint_states"],
                )
            },
        }
    return model


def document(label, *models):
    value = {
        "schema_version": 1,
        "label": label,
        "exclude_data_tracks": [],
        "exclude_video_tracks": [],
        "exclude_audio_tracks": [],
        "default_video_rate_hz": 30,
        "control": {"scope": "robot", "ownership": "portal_active_operator"},
        "control_interfaces": {},
    }
    for model in models:
        for collection, entries in model.items():
            for key, entry in entries.items():
                if key in value[collection]:
                    raise ValueError(f"Repeated {collection} ID: {key}")
                value[collection][key] = copy.deepcopy(entry)
    return value


base = base_model()
head = joint_model("head", "Camera head", ["pan_joint", "tilt_joint"], arm=False)
single_arm = joint_model("arm", "Arm", vr=True)
dual = (
    joint_model("left_arm", "Left arm", vr=True),
    joint_model("right_arm", "Right arm", vr=True),
)
lift = joint_model("lift", "Lift", ["lift_joint"], arm=False)

examples = {
    "01-rover-differential": document("Differential rover", base),
    "02-rover-ackermann": document("Ackermann rover", base_model("ackermann")),
    "03-rover-pan-tilt": document("Rover with camera head", base, head),
    "04-rover-arm": document("Rover with arm", base, single_arm),
    "05-arm": document("Single arm", single_arm),
    "06-two-arms": document("Two independent arms", *dual),
    "07-two-arms-mobile": document("Two arms with mobile base", base, *dual),
    "08-rover-holonomic": document("Holonomic rover", base_model("holonomic")),
    "09-two-arms-mobile-lift": document("Rivet-style base, lift, and two arms", base, lift, *dual),
    "10-moveit-dual-panda": document("MoveIt dual-Panda demo through ROS Portal", panda_model()),
    "11-camera-only": document("Camera-only station"),
    "12-humanoid": document(
        "Illustrative humanoid with independent arm control", head, *dual,
    ),
    "13-track-exclusions": document("Rover with discovery exclusions", base),
}
examples["13-track-exclusions"].update({
    "exclude_data_tracks": [r"/debug/.*"],
    "exclude_video_tracks": [r"private-.*"],
    "exclude_audio_tracks": [r"private-.*"],
})

examples["14-stereo-camera"] = document("Station with a calibrated stereo camera")
examples["14-stereo-camera"]["camera_info"] = {
    "front": {
        "track_name": "front-stereo", "width": 1280, "height": 480,
        "views": {
            eye: {
                "frame_id": f"front_{eye}_optical",
                "image_region": {"x": index * 640, "y": 0, "width": 640, "height": 480},
                "intrinsics": {"fx": 500, "fy": 500, "cx": 320, "cy": 240,
                    "distortion_model": "none", "distortion_coefficients": []},
                "extrinsics": {"parent_frame_id": "front_mount",
                    "translation": [index * 0.06, 0, 0], "rotation_xyzw": [0, 0, 0, 1]},
            }
            for index, eye in enumerate(("left", "right"))
        },
    },
}


def is_excluded(track_name, patterns):
    """Use case-sensitive full-name matching; never normalize external names."""
    return any(re.fullmatch(pattern, track_name) is not None for pattern in patterns)


def is_track_enabled(track_name, media_kind, config):
    """Default allow; data, video, and audio publications require no catalog entry."""
    exclusion_key = {
        "data": "exclude_data_tracks",
        "video": "exclude_video_tracks",
        "audio": "exclude_audio_tracks",
    }[media_kind]
    return not is_excluded(track_name, config.get(exclusion_key, []))


def validate_names_and_identity(value):
    def validate_keys(node, path):
        if isinstance(node, dict):
            for key, child in node.items():
                if not isinstance(key, str) or not IDENTIFIER.fullmatch(key):
                    raise ValueError(f"Invalid contract field or local ID at {path}: {key!r}")
                validate_keys(child, f"{path}.{key}")
        elif isinstance(node, list):
            for index, child in enumerate(node):
                validate_keys(child, f"{path}[{index}]")

    validate_keys(value, "discovery")
    for key, entry in value.get("control_interfaces", {}).items():
        if "id" in entry:
            raise ValueError(f"control_interfaces.{key} repeats its map ID")
        label = entry.get("label")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"control_interfaces.{key} needs a non-empty label")


def positive_rate(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def validate_document(value):
    validate_names_and_identity(value)
    if type(value.get("schema_version")) is not int or value["schema_version"] != 1:
        raise ValueError("Unsupported discovery schema version")
    if not isinstance(value.get("label"), str) or not value["label"].strip():
        raise ValueError("A non-empty robot label is required")
    if value.get("control") != {"scope": "robot", "ownership": "portal_active_operator"}:
        raise ValueError("Unsupported control ownership protocol")
    if any(key in value for key in ("topics", "videos", "components", "attachments", "services", "rpcs")):
        raise ValueError("Topic/video catalogs, components, attachments, and custom RPC catalogs are outside this draft")
    for key in EXCLUSIONS:
        patterns = value.get(key, [])
        if not isinstance(patterns, list):
            raise ValueError(f"{key} must be a list")
        for pattern in patterns:
            if not isinstance(pattern, str) or not pattern:
                raise ValueError(f"{key} patterns must be non-empty strings")
            try:
                re.compile(pattern)
            except re.error as error:
                raise ValueError(f"Invalid {key} pattern {pattern!r}: {error}") from error
    if not positive_rate(value["default_video_rate_hz"]):
        raise ValueError("A positive default video rate is required")
    for interface_id, interface in value["control_interfaces"].items():
        if not interface["operations"]:
            raise ValueError(f"Control interface has no operations: {interface_id}")
        for operation_id, op in interface["operations"].items():
            profile = op["profile"]
            if profile not in PROFILES:
                raise ValueError(f"Unknown example profile: {profile}")
            channel = op.get("control_channel", "primary")
            if not isinstance(channel, str) or not IDENTIFIER.fullmatch(channel):
                raise ValueError("Invalid control channel")
            if profile == "gripper.position.v1" and (len(op.get("joint_names", [])) != 1 or channel == "primary"):
                raise ValueError("Gripper needs one exact joint and an independent channel")
            command = op["command"]
            if command.get("format") != "json":
                raise ValueError(f"Unsupported command format: {interface_id}.{operation_id}")
            for field in ("track_name", "msg_type"):
                if not isinstance(command.get(field), str) or not command[field]:
                    raise ValueError(f"Missing command {field}: {interface_id}.{operation_id}")
            feedback = op.get("feedback_tracks", [])
            if not isinstance(feedback, list) or any(not isinstance(name, str) or not name for name in feedback):
                raise ValueError(f"Invalid feedback track binding: {interface_id}.{operation_id}")
            if profile in ("joints.trajectory.v1", "arm.cartesian_pose.v1", "gripper.position.v1") and not feedback:
                raise ValueError(f"Position and pose profiles require feedback: {interface_id}.{operation_id}")


def validate_examples():
    for value in examples.values():
        validate_document(value)
        for kind in ("data", "video", "audio"):
            assert is_track_enabled("unlisted-public-track", kind, value)
            assert is_track_enabled("any-track", kind, {})
    filtered = examples["13-track-exclusions"]
    assert not is_track_enabled("/debug/cpu", "data", filtered)
    assert not is_track_enabled("private-camera", "video", filtered)
    assert not is_track_enabled("private-microphone", "audio", filtered)
    for name in (
        "03-rover-pan-tilt", "04-rover-arm", "07-two-arms-mobile",
        "09-two-arms-mobile-lift", "13-track-exclusions",
    ):
        assert examples[name]["control_interfaces"]["base"] == base["control_interfaces"]["base"]
    for name in ("04-rover-arm", "05-arm"):
        assert examples[name]["control_interfaces"]["arm"] == single_arm["control_interfaces"]["arm"]
    for name in ("06-two-arms", "07-two-arms-mobile", "09-two-arms-mobile-lift"):
        for model in dual:
            for collection, entries in model.items():
                for key, entry in entries.items():
                    assert examples[name][collection][key] == entry
    panda = examples["10-moveit-dual-panda"]
    left, right = (panda["control_interfaces"][key] for key in ("left_arm", "right_arm"))
    assert left["operations"]["trajectory"]["feedback_tracks"] == ["/joint_states"]
    assert right["operations"]["trajectory"]["feedback_tracks"] == ["/joint_states"]
    assert len(left["joint_names"]) == len(right["joint_names"]) == 7
    assert set(left["joint_names"]).isdisjoint(right["joint_names"])


def main():
    validate_examples()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, value in examples.items():
        (OUT / f"{name}.json").write_text(
            json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
    print(f"Wrote {len(examples)} discovery examples to {OUT}")
    print("Verified IDs, exclusions, rates, references, and reusable interfaces.")


if __name__ == "__main__":
    main()
