# Documentation: `downscale_all.sh`

**Script Path**: `./SeaSee-r/pyslam/scripts/downscale_video/downscale_all.sh`

## Overview
This is a Bash script designed to batch downscale all `.MP4` / `.mp4` video files in a specified directory to a desired vertical resolution (either `480p` or `1080p`). It utilizes `ffmpeg` to process the videos while maintaining their original aspect ratio.

## Prerequisites
- `ffmpeg` must be installed and accessible in the system's `$PATH`.

## Usage
Execute the script by providing the target directory containing your videos and the desired vertical resolution:

```bash
./downscale_all.sh <target_directory> [480|1080]
```

Example:
```bash
./downscale_all.sh /path/to/videos 1080
```

### Arguments
- `$1` (Target Directory): The path to the directory containing video files.
- `$2` (Resolution): The target vertical resolution. The script strictly accepts only `480` or `1080`.

## Behavior and Workflow
1. **Input Validation**: The script checks if exactly two arguments are provided (`<target_directory>` and resolution), ensures that the directory exists, and validates that the resolution is either `480` or `1080`.
2. **Directory Navigation**: It switches into the target directory to perform batch processing.
3. **Batch Processing**: It scans for matching `.mp4` / `.MP4` files in the directory. If none are found, it exits without creating unnecessary folders.
4. **Output Directory Creation**: It dynamically creates a subdirectory named `downscaled_480p` or `downscaled_1080p` inside the target directory to store the processed videos.
5. **Encoding with `ffmpeg`**:
   - For each file, it runs an `ffmpeg` command.
   - The video filter (`-vf scale=-2:"$RES"`) scales the height to the target resolution while automatically calculating the appropriate width to maintain the original aspect ratio (`-2`).
   - The video is encoded using the `libx264` codec with a Constant Rate Factor (`-crf`) of `23`, which offers a good balance between visual quality and file size.
   - The audio stream is copied exactly without re-encoding (`-c:a copy`).
6. **Output**: Processed files are saved into the target output directory with the resolution appended to their original filenames (e.g., original `video.MP4` becomes `video_1080p.mp4`).
