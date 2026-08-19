import os
import json
import numpy as np
from typing import List, Dict, Any, Tuple

def rotvec_to_matrix(r: List[float]) -> np.ndarray:
    """Converts a Rodrigues rotation vector r into a 3x3 rotation matrix R."""
    r_arr = np.array(r, dtype=float)
    theta = np.linalg.norm(r_arr)
    if theta < 1e-8:
        return np.eye(3)
    k = r_arr / theta
    K = np.array([
        [0, -k[2], k[1]],
        [k[2], 0, -k[0]],
        [-k[1], k[0], 0]
    ])
    R = np.eye(3) + np.sin(theta) * K + (1 - np.cos(theta)) * np.dot(K, K)
    return R

def get_camera_center(rotation: List[float], translation: List[float]) -> np.ndarray:
    """Calculates the 3D camera position in world coordinates from OpenSfM rotation and translation vectors."""
    R = rotvec_to_matrix(rotation)
    t = np.array(translation, dtype=float)
    center = -np.dot(R.T, t)
    return center

def get_camera_viewing_direction(rotation: List[float]) -> List[float]:
    """Calculates the 3D unit optical viewing direction vector in world coordinates from OpenSfM rotation vector."""
    R = rotvec_to_matrix(rotation)
    view_dir = R[2, :]  # 3rd row of rotation matrix R corresponds to R^T @ [0, 0, 1]
    norm = np.linalg.norm(view_dir)
    if norm > 1e-8:
        view_dir = view_dir / norm
    else:
        view_dir = np.array([0.0, 0.0, 1.0])
    return view_dir.tolist()

def rotation_matrix_to_quaternion(R: np.ndarray) -> List[float]:
    """
    Converts a 3x3 rotation matrix R into a normalized unit quaternion [x, y, z, w].
    Matches Three.js Quaternion constructor / method set(x, y, z, w).
    """
    tr = np.trace(R)
    if tr > 0:
        S = np.sqrt(tr + 1.0) * 2.0
        qw = 0.25 * S
        qx = (R[2, 1] - R[1, 2]) / S
        qy = (R[0, 2] - R[2, 0]) / S
        qz = (R[1, 0] - R[0, 1]) / S
    elif (R[0, 0] > R[1, 1]) and (R[0, 0] > R[2, 2]):
        S = np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2.0
        qw = (R[2, 1] - R[1, 2]) / S
        qx = 0.25 * S
        qy = (R[0, 1] + R[1, 0]) / S
        qz = (R[0, 2] + R[2, 0]) / S
    elif R[1, 1] > R[2, 2]:
        S = np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2.0
        qw = (R[0, 2] - R[2, 0]) / S
        qx = (R[0, 1] + R[1, 0]) / S
        qy = 0.25 * S
        qz = (R[1, 2] + R[2, 1]) / S
    else:
        S = np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2.0
        qw = (R[1, 0] - R[0, 1]) / S
        qx = (R[0, 2] + R[2, 0]) / S
        qy = (R[1, 2] + R[2, 1]) / S
        qz = 0.25 * S

    q = np.array([qx, qy, qz, qw], dtype=float)
    norm = np.linalg.norm(q)
    if norm > 1e-8:
        q /= norm
    else:
        q = np.array([0.0, 0.0, 0.0, 1.0])
    return q.tolist()

def get_camera_three_quaternion(rotation: List[float]) -> List[float]:
    """
    Calculates the 4D camera rotation unit quaternion [x, y, z, w] for baseline camera usage
    in Three.js (camera.quaternion.set(x, y, z, w)) from an OpenSfM Rodrigues rotation vector.
    
    OpenSfM rotation matrix R_sfm converts world -> OpenSfM camera coords.
    The camera frame in world space is R_world = R_sfm^T.
    Three.js camera coordinate frame has +X right, +Y up, -Z forward (vs OpenSfM +X right, +Y down, +Z forward).
    Thus R_three_world = R_sfm^T @ diag(1, -1, -1).
    """
    if not rotation or len(rotation) != 3:
        return [1.0, 0.0, 0.0, 0.0]
    
    R_sfm = rotvec_to_matrix(rotation)
    M_sfm_to_three = np.diag([1.0, -1.0, -1.0])
    R_three_world = np.dot(R_sfm.T, M_sfm_to_three)
    return rotation_matrix_to_quaternion(R_three_world)

def parse_reconstruction_json(reconstruction_json_path: str) -> List[Dict[str, Any]]:
    """Reads and validates an OpenSfM reconstruction.json file."""
    if not os.path.exists(reconstruction_json_path):
        return []
    with open(reconstruction_json_path, "r") as f:
        data = json.load(f)
        if isinstance(data, list):
            return data
    return []

def extract_camera_route_csv(data: Dict[str, Any], csv_file_path: str) -> int:
    """
    Extracts camera shot centers from a single OpenSfM reconstruction entry and writes them to a CSV file.
    Returns total number of valid camera shots processed.
    """
    shots = data.get("shots", {})
    if not shots:
        return 0

    valid_count = 0
    with open(csv_file_path, "w") as out_f:
        out_f.write("X,Y,Z,Red,Green,Blue\n")
        for shot_id, sdata in shots.items():
            if "rotation" not in sdata or "translation" not in sdata:
                continue
            rotation = sdata["rotation"]
            translation = sdata["translation"]
            center = get_camera_center(rotation, translation)
            x, y, z = center[0], center[1], center[2]
            r, g, b = 255, 0, 0
            out_f.write(f"{x},{y},{z},{int(r)},{int(g)},{int(b)}\n")
            valid_count += 1

    return valid_count

def parse_shots_geojson(geojson_path: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Reads a shots.geojson file and returns (header_info, frames_list)."""
    if not os.path.exists(geojson_path):
        return {}, []
    with open(geojson_path, "r") as f:
        data = json.load(f)
    
    features = data.get("features", [])
    if not features:
        return {}, []

    first_props = features[0].get("properties", {})
    header_info = {
        "focal": first_props.get("focal", 0.48455320009205993),
        "width": first_props.get("width", 3840),
        "height": first_props.get("height", 2160),
        "camera": first_props.get("camera", "v2 unknown unknown 3840 2160 brown 0.85"),
    }

    frames = []
    for feat in features:
        props = feat.get("properties", {})
        geometry = feat.get("geometry", {})
        coords = geometry.get("coordinates", [0.0, 0.0, 0.0])
        rotation = props.get("rotation", [0.0, 0.0, 0.0])
        direction = get_camera_viewing_direction(rotation) if len(rotation) == 3 else [0.0, 0.0, 1.0]
        rot_quat = get_camera_three_quaternion(rotation) if len(rotation) == 3 else [1.0, 0.0, 0.0, 0.0]
        capture_time = props.get("capture_time", 0.0)
        timestamp_val = int(capture_time * 1000) if capture_time > 1e8 else int(capture_time)
        
        frames.append({
            "filename": props.get("filename"),
            "timestamp": timestamp_val,
            "position": coords,
            "direction": direction,
            "rotation": rot_quat,
            "relative_time": props.get("relative_time", 0.0)
        })

    return header_info, frames
