import os
import sys
import subprocess
import pandas as pd
import numpy as np
import pytest

# Add src to path so we can import convert_logdata if needed
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))


@pytest.fixture
def test_env():
    """Fixture to set up paths and clean up before/after the test."""
    base_dir = os.path.dirname(__file__)
    paths = {
        'video_path': os.path.join(base_dir, 'sample_data/dummy.mp4'),
        'log_path': os.path.join(base_dir, 'sample_data/ROV-Log-2026-05-02-2026-05-05-0505205315.json'),
        'output_tum': os.path.join(base_dir, 'trajectory_test_tum.txt'),
        'output_kitti': os.path.join(base_dir, 'trajectory_test_kitti.txt'),
        'output_kitti_times': os.path.join(base_dir, 'times.txt'), # generated alongside kitti
        'output_final_tum': os.path.join(base_dir, 'trajectory_test_final_tum.txt'),
        'output_final_kitti': os.path.join(base_dir, 'trajectory_test_final_kitti.txt'),
        'tartanair_path': os.path.join(base_dir, 'sample_data/pose_left.txt'),
        'script_path': os.path.join(base_dir, '../src/convert_logdata.py')
    }

    # Setup: Remove output files if they exist from previous runs
    for key in ['output_tum', 'output_kitti', 'output_kitti_times', 'output_final_tum', 'output_final_kitti']:
        if os.path.exists(paths[key]):
            os.remove(paths[key])

    yield paths  # Hands control over to the test function

    # Teardown: Clean up output files after test finishes
    for key in ['output_tum', 'output_kitti', 'output_kitti_times', 'output_final_tum', 'output_final_kitti']:
        if os.path.exists(paths[key]):
            os.remove(paths[key])


def test_json_to_tum_conversion(test_env):
    """Tests JSON to TUM conversion (default behavior)."""
    cmd = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['log_path'],
        "--output", test_env['output_tum'],
        "--input-format", "json",
        "--output-format", "tum"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    assert result.returncode == 0, f"Script failed with output:\n{result.stderr}"
    assert os.path.exists(test_env['output_tum']), "Output TUM file was not created."

    df = pd.read_csv(test_env['output_tum'], sep='\s+', header=None)
    assert len(df.columns) == 8, "Output should have 8 columns for TUM format."
    assert len(df) == 150, "Expected exactly 150 frames matching the dummy video duration."


def test_json_to_kitti_conversion(test_env):
    """Tests JSON to KITTI conversion."""
    cmd = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['log_path'],
        "--output", test_env['output_kitti'],
        "--input-format", "json",
        "--output-format", "kitti"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    assert result.returncode == 0, f"Script failed with output:\n{result.stderr}"
    assert os.path.exists(test_env['output_kitti']), "Output KITTI file was not created."
    assert os.path.exists(test_env['output_kitti_times']), "Output KITTI times.txt was not created."

    df = pd.read_csv(test_env['output_kitti'], sep='\s+', header=None)
    assert len(df.columns) == 12, "Output should have 12 columns for KITTI format."
    assert len(df) == 150, "Expected exactly 150 frames."


def test_tum_to_kitti_chain(test_env):
    """Generates a TUM file from JSON, then converts that TUM file to KITTI."""
    # 1. JSON -> TUM
    cmd1 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['log_path'],
        "--output", test_env['output_tum'],
        "--input-format", "json",
        "--output-format", "tum"
    ]
    subprocess.run(cmd1, check=True)

    # 2. TUM -> KITTI
    cmd2 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['output_tum'],
        "--output", test_env['output_kitti'],
        "--input-format", "tum",
        "--output-format", "kitti"
    ]
    result = subprocess.run(cmd2, capture_output=True, text=True)
    assert result.returncode == 0, f"Script failed with output:\n{result.stderr}"
    assert os.path.exists(test_env['output_kitti'])
    
    df = pd.read_csv(test_env['output_kitti'], sep='\s+', header=None)
    assert len(df.columns) == 12


def test_kitti_to_tum_chain(test_env):
    """Generates a KITTI file from JSON, then converts that KITTI file to TUM."""
    # 1. JSON -> KITTI
    cmd1 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['log_path'],
        "--output", test_env['output_kitti'],
        "--input-format", "json",
        "--output-format", "kitti"
    ]
    subprocess.run(cmd1, check=True)

    # 2. KITTI -> TUM
    cmd2 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['output_kitti'],
        "--output", test_env['output_final_tum'],
        "--input-format", "kitti",
        "--output-format", "tum"
    ]
    result = subprocess.run(cmd2, capture_output=True, text=True)
    assert result.returncode == 0, f"Script failed with output:\n{result.stderr}"
    assert os.path.exists(test_env['output_final_tum'])
    
    df = pd.read_csv(test_env['output_final_tum'], sep='\s+', header=None)
    assert len(df.columns) == 8


def test_tartanair_to_tum_kitti_tum_chain(test_env):
    """Tests the conversion chain: tartanair -> tum -> kitti -> tum."""
    # 1. tartanair -> tum
    cmd1 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['tartanair_path'],
        "--output", test_env['output_tum'],
        "--input-format", "tartanair",
        "--output-format", "tum"
    ]
    subprocess.run(cmd1, check=True)

    # 2. tum -> kitti
    cmd2 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['output_tum'],
        "--output", test_env['output_kitti'],
        "--input-format", "tum",
        "--output-format", "kitti"
    ]
    subprocess.run(cmd2, check=True)

    # 3. kitti -> tum
    cmd3 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['output_kitti'],
        "--output", test_env['output_final_tum'],
        "--input-format", "kitti",
        "--output-format", "tum"
    ]
    result = subprocess.run(cmd3, capture_output=True, text=True)
    assert result.returncode == 0, f"Script failed with output:\n{result.stderr}"
    assert os.path.exists(test_env['output_final_tum'])
    
    df = pd.read_csv(test_env['output_final_tum'], sep='\s+', header=None)
    assert len(df.columns) == 8
    
    df_original = pd.read_csv(test_env['output_tum'], sep='\s+', header=None)
    np.testing.assert_allclose(df_original.values, df.values, atol=1e-4)


def test_tartanair_to_kitti_tum_kitti_chain(test_env):
    """Tests the conversion chain: tartanair -> kitti -> tum -> kitti."""
    # 1. tartanair -> kitti
    cmd1 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['tartanair_path'],
        "--output", test_env['output_kitti'],
        "--input-format", "tartanair",
        "--output-format", "kitti"
    ]
    subprocess.run(cmd1, check=True)

    # 2. kitti -> tum
    cmd2 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['output_kitti'],
        "--output", test_env['output_tum'],
        "--input-format", "kitti",
        "--output-format", "tum"
    ]
    subprocess.run(cmd2, check=True)

    # 3. tum -> kitti
    cmd3 = [
        sys.executable, test_env['script_path'],
        "--video", test_env['video_path'],
        "--log", test_env['output_tum'],
        "--output", test_env['output_final_kitti'],
        "--input-format", "tum",
        "--output-format", "kitti"
    ]
    result = subprocess.run(cmd3, capture_output=True, text=True)
    assert result.returncode == 0, f"Script failed with output:\n{result.stderr}"
    assert os.path.exists(test_env['output_final_kitti'])
    
    df = pd.read_csv(test_env['output_final_kitti'], sep='\s+', header=None)
    assert len(df.columns) == 12
    
    df_original = pd.read_csv(test_env['output_kitti'], sep='\s+', header=None)
    np.testing.assert_allclose(df_original.values, df.values, atol=1e-4)