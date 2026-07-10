import argparse
import json
import subprocess
import numpy as np
import pandas as pd
from scipy.spatial.transform import Rotation as R
from scipy.spatial.transform import Slerp
from scipy.interpolate import interp1d
from dateutil import parser
import os

class PositionalData:
    def __init__(self, path=None, name=None, type="NONE"):
        self.path = path
        self.name = name
        self.type = type
        
        self.timestamps = None
        self.trajectory = None
        self.poses = None
        
        # Raw input arrays for interpolation
        self.pos_times = np.array([])
        self.positions = np.array([])
        self.rot_times = np.array([])
        self.quaternions = np.array([])



def get_video_metadata(video_path):
    """Returns (fps, total_frames, duration_sec, creation_time_epoch)."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate,nb_frames,duration",
        "-of", "default=noprint_wrappers=1:nokey=1", video_path
    ]
    try:
        output = subprocess.check_output(cmd, text=True).strip().split('\n')
        if len(output) < 2:
            raise IOError(f"Could not parse ffprobe output for {video_path}")
            
        fps_str = output[0].split('/')
        fps = float(fps_str[0]) / float(fps_str[1]) if len(fps_str) == 2 else float(output[0])
        
        duration_sec = float(output[1])
        
        if len(output) > 2 and output[2].isdigit():
            total_frames = int(output[2])
        else:
            total_frames = int(duration_sec * fps)
            
    except Exception as e:
        raise IOError(f"Cannot read video metadata via ffprobe: {e}")
    
    if fps <= 0:
        raise ValueError("Invalid FPS from video")
    
    creation_time_epoch = None
    cmd = [
        "ffprobe", "-v", "quiet", "-select_streams", "v:0",
        "-show_entries", "stream_tags=creation_time",
        "-of", "default=noprint_wrappers=1:nokey=1", video_path
    ]
    try:
        output = subprocess.check_output(cmd, text=True).strip()
        if output:
            dt = parser.parse(output)
            creation_time_epoch = dt.timestamp()
    except Exception as e:
        print(f"Warning: Could not extract creation_time via ffprobe. ({e})")
        
    return fps, total_frames, duration_sec, creation_time_epoch


# --- INPUT STAGE ---

class JsonPositionalData(PositionalData):
    def __init__(self, filepath):
        super().__init__(path=os.path.dirname(filepath), name=os.path.basename(filepath), type="SIMPLE")
        
        with open(filepath, 'r') as f:
            data = json.load(f)
            
        depth_records = []
        attitude_records = []
        
        for item in data:
            t_sec = item["timestamp"] / 1000.0
            ctype = item.get("type")
            payload = item.get("payload", {})
            
            if ctype == "depth":
                depth_records.append({"time": t_sec, "depth": payload.get("depth", 0.0)})
            elif ctype == "attitude":
                attitude_records.append({
                    "time": t_sec, 
                    "roll": payload.get("roll", 0.0),
                    "pitch": payload.get("pitch", 0.0),
                    "yaw": payload.get("yaw", 0.0)
                })
                
        df_depth = pd.DataFrame(depth_records).sort_values("time")
        df_attitude = pd.DataFrame(attitude_records).sort_values("time")
        
        # We store raw times and arrays to be interpolated later
        self.pos_times = df_depth["time"].values if not df_depth.empty else np.array([])
        self.positions = np.zeros((len(self.pos_times), 3))
        if not df_depth.empty:
            self.positions[:, 2] = df_depth["depth"].values # map depth to z
            
        self.rot_times = df_attitude["time"].values if not df_attitude.empty else np.array([])
        self.quaternions = np.zeros((len(self.rot_times), 4))
        if not df_attitude.empty:
            rolls = df_attitude["roll"].values
            pitches = df_attitude["pitch"].values
            yaws = df_attitude["yaw"].values
            
            r = R.from_euler('xyz', np.column_stack((rolls, pitches, yaws)), degrees=True)
            self.quaternions = r.as_quat()

class TartanairPositionalData(PositionalData):
    def __init__(self, filepath):
        super().__init__(path=os.path.dirname(filepath), name=os.path.basename(filepath), type="TUM")
        df = pd.read_csv(filepath, sep='\s+', header=None, comment='#')
        fps = 25.0
        self.pos_times = np.arange(len(df)) / fps
        self.positions = df[[0, 1, 2]].values
        self.rot_times = self.pos_times
        self.quaternions = df[[3, 4, 5, 6]].values

class TumPositionalData(PositionalData):
    def __init__(self, filepath):
        super().__init__(path=os.path.dirname(filepath), name=os.path.basename(filepath), type="TUM")
        df = pd.read_csv(filepath, sep='\s+', header=None, comment='#')
        self.pos_times = df[0].values
        self.positions = df[[1, 2, 3]].values
        self.rot_times = self.pos_times
        self.quaternions = df[[4, 5, 6, 7]].values

class KittiPositionalData(PositionalData):
    def __init__(self, filepath):
        super().__init__(path=os.path.dirname(filepath), name=os.path.basename(filepath), type="KITTI")
        df = pd.read_csv(filepath, sep='\s+', header=None)
        poses_raw = df.values
        
        self.pos_times = np.arange(len(poses_raw)) * 0.1
        times_path = os.path.join(os.path.dirname(filepath), "times.txt")
        if os.path.exists(times_path):
            times_df = pd.read_csv(times_path, header=None)
            self.pos_times = times_df[0].values
            
        self.positions = np.zeros((len(poses_raw), 3))
        self.quaternions = np.zeros((len(poses_raw), 4))
        
        for i, row in enumerate(poses_raw):
            mat = row.reshape(3, 4)
            self.positions[i] = mat[:, 3]
            r = R.from_matrix(mat[:, :3])
            self.quaternions[i] = r.as_quat()
            
        self.rot_times = self.pos_times


# --- PositionalData SYNC STAGE ---
class SyncedPositionalData(PositionalData):
    def __init__(self, input_gt: PositionalData, frame_times):
        super().__init__(path=input_gt.path, name=input_gt.name + "_synced", type=input_gt.type)
        
        # Set standardized fields so it can be exported
        self.timestamps = frame_times
        self.trajectory = np.zeros((len(frame_times), 3))
        self.poses = np.zeros((len(frame_times), 4, 4))
        
        # Interpolate positions
        if len(input_gt.pos_times) > 0 and len(input_gt.positions) > 0:
            pos_interp = interp1d(input_gt.pos_times, input_gt.positions, axis=0, kind="linear", bounds_error=False, fill_value="extrapolate")
            self.trajectory = pos_interp(frame_times)
            
        # Interpolate rotations via Slerp
        quats = np.zeros((len(frame_times), 4))
        quats[:, 3] = 1.0 # default qw=1
        if len(input_gt.rot_times) > 1 and len(input_gt.quaternions) > 1:
            rotations = R.from_quat(input_gt.quaternions)
            rot_interp = Slerp(input_gt.rot_times, rotations)
            
            # Slerp bounds clipping
            min_t, max_t = rot_interp.times[0], rot_interp.times[-1]
            clipped_times = np.clip(frame_times, min_t, max_t)
            quats = rot_interp(clipped_times).as_quat()
            
        # Build homogeneous 4x4 poses
        for i in range(len(frame_times)):
            pose = np.eye(4)
            pose[:3, :3] = R.from_quat(quats[i]).as_matrix()
            pose[:3, 3] = self.trajectory[i]
            self.poses[i] = pose


# --- OUTPUT STAGE ---

def write_positionalData(gt: PositionalData, output_path, format="tum"):
    if format == "tum":
        with open(output_path, 'w') as f:
            for i in range(len(gt.timestamps)):
                t = gt.timestamps[i]
                tx, ty, tz = gt.trajectory[i]
                
                # Extract quaternion from 4x4 pose
                r = R.from_matrix(gt.poses[i, :3, :3])
                qx, qy, qz, qw = r.as_quat()
                
                line = f"{t:.6f} {tx:.6f} {ty:.6f} {tz:.6f} {qx:.6f} {qy:.6f} {qz:.6f} {qw:.6f}\n"
                f.write(line)
                
    elif format == "kitti":
        # Write poses.txt
        with open(output_path, 'w') as f:
            for i in range(len(gt.timestamps)):
                mat = gt.poses[i, :3, :] # 3x4
                # 12 elements: r11 r12 r13 tx r21 r22 r23 ty r31 r32 r33 tz
                flat = mat.flatten()
                line = " ".join([f"{val:.6f}" for val in flat])
                f.write(line + "\n")
                
        # Write times.txt
        times_path = os.path.join(os.path.dirname(output_path), "times.txt")
        with open(times_path, 'w') as f:
            for t in gt.timestamps:
                f.write(f"{t:.6f}\n")


def convert_logdata(video, log, output, input_format, output_format="tum", start_time=None, stop_time=None):
    # ==========================================
    # 1. INPUT STAGE -> Returns a subclass of PositionalData
    # ==========================================
    print(f"Parsing input log: {log} (Format: {input_format})")
    
    if input_format == "json":
        input_gt = JsonPositionalData(log)
    elif input_format == "tum":
        input_gt = TumPositionalData(log)
    elif input_format == "kitti":
        input_gt = KittiPositionalData(log)
    elif input_format == "tartanair":
        input_gt = TartanairPositionalData(log)
        
    # ==========================================
    # 2. PositionalData STAGE -> Returns a SyncedPositionalData
    # ==========================================
    print(f"Extracting video metadata from {video}...")
    fps, total_frames, duration_sec, creation_time_epoch = get_video_metadata(video)
    print(f"Video: {fps:.2f} FPS, {total_frames} frames, duration: {duration_sec:.2f}s")
    
    if start_time:
        start_epoch = parser.parse(start_time).timestamp()
        print(f"Using provided start_time: {start_time} (Epoch: {start_epoch})")
    else:
        if creation_time_epoch is None:
            raise ValueError("Could not extract creation time from video, and --start-time not provided.")
        start_epoch = creation_time_epoch
        print(f"Using video creation_time: {creation_time_epoch}")
        
    if stop_time:
        stop_epoch = parser.parse(stop_time).timestamp()
        print(f"Using provided stop_time: {stop_time} (Epoch: {stop_epoch})")
    else:
        stop_epoch = start_epoch + duration_sec
        print(f"Using default stop_time based on duration (Epoch: {stop_epoch})")
        
    frame_times = []
    max_frames_based_on_stop = int((stop_epoch - start_epoch) * fps)
    num_frames = min(total_frames, max_frames_based_on_stop)
    
    for i in range(num_frames):
        t = start_epoch + (i / fps)
        if t <= stop_epoch:
            frame_times.append(t)
            
    frame_times = np.array(frame_times)
    if len(frame_times) == 0:
        print("Warning: No frames within the specified time range.")
        return

    print("Interpolating data to match video frames via Slerp and Linear interpolation...")
    synced_gt = SyncedPositionalData(input_gt, frame_times)
    
    # ==========================================
    # 3. OUTPUT STAGE -> Writes the PositionalData to output format
    # ==========================================
    print(f"Writing {output_format.upper()} format trajectory to {output}...")
    write_positionalData(synced_gt, output, output_format)
            
    print("Done!")


def main():
    # ==========================================
    # Parse ARG
    # ==========================================
    parser_arg = argparse.ArgumentParser(description="Preprocess ROV JSON logs to sync with video frames.")
    parser_arg.add_argument("--video", type=str, required=True, help="Path to the video file")
    parser_arg.add_argument("--log", type=str, required=True, help="Path to the input log file")
    parser_arg.add_argument("--output", type=str, required=True, help="Path to output trajectory file")
    parser_arg.add_argument("--input-format", type=str, choices=["json", "tum", "kitti", "tartanair"], required=True, help="Format of the input log")
    parser_arg.add_argument("--output-format", type=str, choices=["tum", "kitti"], default="tum", help="Format of the output trajectory")
    parser_arg.add_argument("--start-time", type=str, help="Start datetime (e.g. '2026-05-05 11:48:29'). Defaults to video creation time.")
    parser_arg.add_argument("--stop-time", type=str, help="Stop datetime. Defaults to start_time + video duration.")
    
    args = parser_arg.parse_args()
    convert_logdata(
        video=args.video, 
        log=args.log, 
        output=args.output, 
        input_format=args.input_format, 
        output_format=args.output_format, 
        start_time=args.start_time, 
        stop_time=args.stop_time
    )

if __name__ == "__main__":
    main()
