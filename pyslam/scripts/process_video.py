import os
# Disable C++ core usage in PySLAM to use the pure Python implementation
os.environ["PYSLAM_USE_CPP"] = "true"
import sys
import argparse
import cv2
import numpy as np
import yaml
import json

# Ensure pyslam is accessible
# Try to find pyslam from environment or standard relative paths
PYSLAM_DIR = os.environ.get("PYSLAM_DIR")
if not PYSLAM_DIR:
    # First check if we are in Docker (/opt/pyslam exists)
    if os.path.exists("/opt/pyslam"):
        PYSLAM_DIR = "/opt/pyslam"
    else:
        # Check if we have a cloned copy in thirdparty relative to this script on the host
        possible_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "thirdparty", "pyslam"))
        if os.path.exists(possible_dir):
            PYSLAM_DIR = possible_dir
        else:
            PYSLAM_DIR = "/opt/pyslam"

sys.path.append(PYSLAM_DIR)

try:
    import pyslam
    import torch
    HAS_PYSLAM = True
except ImportError as e:
    print(f"Warning: Could not import pyslam or torch. Error: {e}")
    HAS_PYSLAM = False


def save_ply(filename, points, colors=None):
    """
    Saves a 3D point cloud to a standard ASCII PLY file format.
    
    :param filename: Path to the output PLY file.
    :param points: (N, 3) numpy array of 3D point coordinates.
    :param colors: (N, 3) numpy array of colors (BGR values from OpenCV).
    """
    num_points = len(points)
    with open(filename, 'w') as f:
        # PLY Header
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {num_points}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        if colors is not None and len(colors) == num_points:
            f.write("property uchar red\n")
            f.write("property uchar green\n")
            f.write("property uchar blue\n")
        f.write("end_header\n")
        
        # PLY Vertices
        for i in range(num_points):
            p = points[i]
            if colors is not None and len(colors) == num_points:
                c = colors[i]
                # Convert OpenCV BGR format to RGB for standard 3D PLY visualization
                f.write(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f} {int(c[2])} {int(c[1])} {int(c[0])}\n")
            else:
                f.write(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")


def process_video(video_path, output_map_path="map.ply", config_path=None):
    print(f"Processing underwater video: {video_path}")
    
    if not HAS_PYSLAM:
        print("Error: PySLAM is not available. Cannot process video.")
        return
        
    print(f"CUDA Available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name(0)}")
    else:
        print("WARNING: CUDA is not available. PySLAM might run very slowly.")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: Could not open video {video_path}")
        return

    # Extract video properties
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0
        
    config_data = {}
    if config_path and os.path.exists(config_path):
        print(f"Loading camera configuration from {config_path}")
        with open(config_path, 'r') as f:
            if config_path.endswith('.yaml') or config_path.endswith('.yml'):
                config_data = yaml.safe_load(f)
            elif config_path.endswith('.json'):
                config_data = json.load(f)
            else:
                print("Warning: Unsupported config file format. Please use .yaml or .json")
                
    pyslam_settings = config_data.get("pyslam_settings", {})
    intrinsics = pyslam_settings.get("intrinsics", {})
    print(intrinsics)
    #if "video_dimensions" in pyslam_settings:
    #    width = pyslam_settings["video_dimensions"][0]
    #    height = pyslam_settings["video_dimensions"][1]
    #    
    #if "fps" in pyslam_settings:
    #    fps = pyslam_settings["fps"]

    print(f"Video Dimensions: {width}x{height} @ {fps} FPS")
    
    # Step 1: Initialize PySLAM Config and set settings
    from pyslam.config import Config
    from pyslam.slam import PinholeCamera
    from pyslam.slam.slam import Slam
    from pyslam.io.dataset_types import SensorType
    from pyslam.local_features.feature_tracker_configs import FeatureTrackerConfigs
    from pyslam.utilities.logging import LoggerQueue
    from pyslam.loop_closing.loop_detector_configs import LoopDetectorConfigs
    from pyslam.config_parameters import Parameters
    from pyslam.slam.frame import Frame

    # Disable storing images in KeyFrames natively in PySLAM C++
    Frame.is_store_imgs = False

    config = Config()
    
    # Relax relocalization parameters for blurry underwater video
    # Parameters.kRelocalizationMinKpsMatches = 8
    # Parameters.kRelocalizationPoseOpt1MinMatches = 8
    # Parameters.kRelocalizationFeatureMatchRatioTest = 0.85
    # Parameters.kRelocalizationDoPoseOpt2NumInliers = 15

    
    # Configure monocular camera setup
    config.sensor_type = SensorType.MONOCULAR
    if config.cam_settings is None:
        config.cam_settings = {}
        
    # Update config.cam_settings with the resolved intrinsics
    config.cam_settings["Camera.width"] = intrinsics.get("width", width)
    config.cam_settings["Camera.height"] = intrinsics.get("height", height)

    # Define or dynamically estimate default camera intrinsic parameters if not provided
    # A standard heuristic is setting focal lengths fx, fy roughly equal to frame width,
    # and principal points cx, cy in the center of the frame.
    config.cam_settings["Camera.fx"] = intrinsics.get("fx", float(width) * 1.0)
    config.cam_settings["Camera.fy"] = intrinsics.get("fy", float(width) * 1.0)
    config.cam_settings["Camera.cx"] = intrinsics.get("cx", float(width) / 2.0)
    config.cam_settings["Camera.cy"] = intrinsics.get("cy", float(height) / 2.0)
    config.cam_settings["Camera.fps"] = intrinsics.get("fps", fps)
    config.cam_settings["Camera.k1"] = intrinsics.get("k1", 0.0)
    config.cam_settings["Camera.k2"] = intrinsics.get("k2", 0.0)
    config.cam_settings["Camera.p1"] = intrinsics.get("p1", 0.0)
    config.cam_settings["Camera.p2"] = intrinsics.get("p2", 0.0)
    config.cam_settings["Camera.k3"] = intrinsics.get("k3", 0.0)

    # Invalidate cached properties on config to force re-evaluation with our overrides
    for attr in ["_DistCoef", "_Kinv", "_bf", "_width", "_height", "_fps"]:
        if hasattr(config, attr):
            delattr(config, attr)

    # Step 2: Instantiate PinholeCamera and feature tracker settings
    camera = PinholeCamera(config)
    feature_tracker_config = FeatureTrackerConfigs.ORB2
    config.feature_tracker_config = feature_tracker_config

    # Step 3: Instantiate PySLAM Slam/Tracker system before the while loop (headless mode)
    slam = Slam(
        camera=camera,
        feature_tracker_config=feature_tracker_config,
        loop_detector_config=LoopDetectorConfigs.DBOW3,
        semantic_mapping_config=None,
        sensor_type=SensorType.MONOCULAR,
        config=config,
        headless=True
    )

    # Set the start and end time in seconds for processing
    start_time = 0
    duration = 60
    start_frame = int(start_time * fps)
    end_frame = int(duration * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    frame_count = start_frame

    try:
        while frame_count <= end_frame:
            ret, frame = cap.read()
            if not ret:
                break
                
            frame_count += 1
            timestamp = frame_count / fps
            
            # Step 4: Frame Processing - Pass the frame to the PySLAM tracker
            slam.track(frame, None, None, frame_count, timestamp)


            if frame_count % 100 == 0:
                print(f"Processed {frame_count} frames...")
                if slam.tracking.cur_R is not None and slam.tracking.cur_t is not None:
                    # Print current position for visual progress feedback
                    print(f"  Current camera position translation: t = {slam.tracking.cur_t.flatten()}")
    except KeyboardInterrupt:
        print("\nProcessing interrupted by user.")
    finally:
        cap.release()
        print(f"Finished video processing loop. Total frames: {frame_count}")

    # Step 5: Map Extraction & Export
    try:
        print("Extracting trajectory poses and 3D map points...")
        # Extract estimated camera trajectory poses
        est_poses, timestamps, ids = slam.get_final_trajectory()
        print(f"Extracted {len(est_poses)} camera trajectory poses.")
        
        # Extract mapped 3D point cloud
        map_points = slam.map.get_points()
        print(f"Extracted {len(map_points)} 3D points from map.")
        
        # Validate points and extract coordinates & colors
        points_3d = []
        colors_rgb = []
        for p in map_points:
            pt = p.pt()
            if np.all(np.isfinite(pt)):
                points_3d.append(pt)
                if p.color is not None:
                    colors_rgb.append(p.color)
                else:
                    colors_rgb.append(np.array([255, 255, 255]))
                    
        # Add camera trajectory points as red dots (BGR: [0, 0, 255])
        for pose in est_poses:
            pos = pose[:3, 3]
            if np.all(np.isfinite(pos)):
                points_3d.append(pos)
                colors_rgb.append(np.array([0, 0, 255]))
                    
        points_3d = np.array(points_3d)
        colors_rgb = np.array(colors_rgb)

        # Step 6: Save the 3D Map
        if len(points_3d) > 0:
            print(f"Saving point cloud map to {output_map_path}...")
            save_ply(output_map_path, points_3d, colors_rgb)
            print(f"Successfully saved 3D map to {output_map_path}")
        else:
            print("Warning: Point cloud is empty. No PLY file generated.")

    except Exception as e:
        print(f"Error during map extraction or export: {e}")

    # Clean up and quit PySLAM system to stop background threads/processes
    print("Shutting down PySLAM system...")
    slam.quit()
    LoggerQueue.stop_all_instances()
    print("Shutdown complete.")

#Example Call:
#./pyslam/scripts/run_native.sh python pyslam/scripts/process_video.py --video ../Data/Video/Krk\ 2026-5/sample_1.MP4 --config ../pyslam/scripts/camera_config.yaml
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process ROV underwater video using PySLAM")
    parser.add_argument("--video", type=str, required=True, help="Path to the input video file")
    parser.add_argument("--config", type=str, default=None, help="Path to camera configuration file (.yaml or .json)")
    parser.add_argument("--output_map", type=str, default="map.ply", help="Path to save output 3D map (.ply)")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.video):
        print(f"Error: File {args.video} does not exist.")
        sys.exit(1)
        
    process_video(
        video_path=args.video,
        output_map_path=args.output_map,
        config_path=args.config
    )

