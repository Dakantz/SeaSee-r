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
