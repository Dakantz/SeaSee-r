import numpy as np
import pytest
from app.services.opensfm.ingest import (
    rotvec_to_matrix,
    get_camera_center,
    get_camera_viewing_direction,
    rotation_matrix_to_quaternion,
    get_camera_three_quaternion,
)


def test_rotvec_to_matrix_identity():
    R = rotvec_to_matrix([0.0, 0.0, 0.0])
    np.testing.assert_array_almost_equal(R, np.eye(3))


def test_rotvec_to_matrix_orthonormal():
    # 90 degrees around Z axis
    r = [0.0, 0.0, np.pi / 2]
    R = rotvec_to_matrix(r)
    # Check orthogonality R^T R = I
    np.testing.assert_array_almost_equal(np.dot(R.T, R), np.eye(3))
    # Check determinant = +1
    assert pytest.approx(np.linalg.norm(np.linalg.det(R)), abs=1e-5) == 1.0


def test_rotation_matrix_to_quaternion_identity():
    R = np.eye(3)
    q = rotation_matrix_to_quaternion(R)
    # q = [x, y, z, w] = [0, 0, 0, 1]
    np.testing.assert_array_almost_equal(q, [0.0, 0.0, 0.0, 1.0])


def test_get_camera_three_quaternion_zero_rotation():
    # Zero OpenSfM rotation corresponds to 180 deg flip around X axis to align OpenSfM (+Y down, +Z fwd) to Three.js (+Y up, -Z fwd)
    q = get_camera_three_quaternion([0.0, 0.0, 0.0])
    assert len(q) == 4
    # Quaternion unit norm
    assert pytest.approx(np.linalg.norm(q), abs=1e-5) == 1.0
    # For 180 deg around X: [1, 0, 0, 0] or [-1, 0, 0, 0]
    np.testing.assert_array_almost_equal(np.abs(q), [1.0, 0.0, 0.0, 0.0], decimal=4)


def test_get_camera_three_quaternion_invalid():
    q_empty = get_camera_three_quaternion([])
    assert q_empty == [1.0, 0.0, 0.0, 0.0]

    q_invalid = get_camera_three_quaternion([1.0, 2.0])
    assert q_invalid == [1.0, 0.0, 0.0, 0.0]
