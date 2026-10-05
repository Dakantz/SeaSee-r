# convert_logdata.py

## Overview
`convert_logdata.py` is a utility script to preprocess and sync positional data (such as ROV JSON logs, TUM trajectories, KITTI, or TartanAir formats) with the frame timestamps extracted from a video. It uses spherical linear interpolation (Slerp) for rotations and linear interpolation for positional data to align the trajectory with the video's frames.

## Features
* **Input Formats**: JSON, TUM, KITTI, and TartanAir.
* **Output Formats**: TUM and KITTI.
* **Video Sync**: Extracts video metadata (FPS, duration, frames) using `ffprobe` to determine precise frame timing.
* **Integration**: Usable from the Command Line (CLI) or as a Python module imported into other scripts.

---

## Command Line Usage

```bash
python convert_logdata.py \
    --video <path_to_video> \
    --log <path_to_log> \
    --output <path_to_output> \
    --input-format <format> \
    [--output-format <format>]
```

### Arguments
* `--video` **(Required)**: Path to the video file used to synchronize timestamps.
* `--log` **(Required)**: Path to the input trajectory log file.
* `--output` **(Required)**: Path to the output trajectory file.
* `--input-format` **(Required)**: Format of the input log. Choices: `json`, `tum`, `kitti`, `tartanair`.
  * *Note on TartanAir*: TartanAir format is parsed as a TUM format without explicit timestamps, assuming perfectly frame-synchronized poses at exactly 25 FPS.
* `--output-format` *(Optional)*: Format of the output trajectory. Choices: `tum`, `kitti`. (Default: `tum`).
* `--start-time` *(Optional)*: Start datetime string (e.g., `'2026-05-05 11:48:29'`). If not provided, it defaults to the video's creation time metadata.
* `--stop-time` *(Optional)*: Stop datetime string. Defaults to `start_time` + video duration.

---

## Usage as a Python Module

The core processing logic is fully decoupled from the CLI argument parser, allowing you to easily call `convert_logdata` directly from other Python scripts.

```python
from convert_logdata import convert_logdata

convert_logdata(
    video="path/to/video.mp4",
    log="path/to/pose_left.txt",
    output="path/to/output_trajectory.txt",
    input_format="tartanair",
    output_format="tum",
    start_time=None,  # Optionally pass a string like '2026-05-05 11:48:29'
    stop_time=None
)
```

### Parameters
* `video` (`str`): Path to the video file.
* `log` (`str`): Path to the input log file.
* `output` (`str`): Path to the output file.
* `input_format` (`str`): Input format (`"json"`, `"tum"`, `"kitti"`, `"tartanair"`).
* `output_format` (`str`, default `"tum"`): Output format (`"tum"`, `"kitti"`).
* `start_time` (`str`, optional): Override for video start time.
* `stop_time` (`str`, optional): Override for video stop time.

---

## Execution Pipeline
The processing pipeline executes in 3 distinct stages:
1. **INPUT STAGE**: Parses the raw input log using a format-specific loader (e.g., `JsonPositionalData`, `TartanairPositionalData`).
2. **PositionalData STAGE**: Analyzes video metadata and generates accurate timestamps for every video frame. The positions and rotations from the input data are then interpolated to precisely align with these video timestamps.
3. **OUTPUT STAGE**: Writes the final, synchronized poses to the specified output format on disk.
