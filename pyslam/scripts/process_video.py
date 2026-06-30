import os
import sys
import argparse
import cv2

# Ensure pyslam is accessible
# We installed it in /opt/pyslam inside the Docker container
PYSLAM_DIR = os.environ.get("PYSLAM_DIR", "/opt/pyslam")
sys.path.append(PYSLAM_DIR)

try:
    import pyslam
    import torch
    HAS_PYSLAM = True
except ImportError as e:
    print(f"Warning: Could not import pyslam or torch. Error: {e}")
    HAS_PYSLAM = False

def process_video(video_path):
    print(f"Processing underwater video: {video_path}")
    
    if HAS_PYSLAM:
        print(f"CUDA Available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"GPU: {torch.cuda.get_device_name(0)}")
        else:
            print("WARNING: CUDA is not available. PySLAM might run very slowly.")

    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        print(f"Error: Could not open video {video_path}")
        return

    frame_count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        frame_count += 1
        
        # Here you would typically pass the frame to PySLAM
        # e.g., pose = pyslam_system.process_image(frame)
        
        # For demonstration, we just show progress
        if frame_count % 30 == 0:
            print(f"Processed {frame_count} frames...")
            
    cap.release()
    print(f"Finished processing. Total frames: {frame_count}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process ROV underwater video using PySLAM")
    parser.add_argument("--video", type=str, required=True, help="Path to the input video file")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.video):
        print(f"Error: File {args.video} does not exist.")
        sys.exit(1)
        
    process_video(args.video)
