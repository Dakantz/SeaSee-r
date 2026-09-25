# Documentation: `downscale_all.sh`

**Script Path**: `./SeaSee-r/pyslam/scripts/downscale_video/downscale_all.sh`

## Overview
This is a Bash script designed to batch downscale all `.MP4` video files in the current working directory to a specified vertical resolution (either `480p` or `1080p`). It utilizes `ffmpeg` to process the videos while maintaining their original aspect ratio.

## Prerequisites
- `ffmpeg` must be installed and accessible in the system's `$PATH`.

## Usage
Navigate to the directory containing your `.MP4` videos and execute the script, providing the desired vertical resolution as the first argument:

```bash
./downscale_all.sh [480|1080]
```

### Arguments
- `$1` (Resolution): The target vertical resolution. The script strictly accepts only `480` or `1080`.

## Behavior and Workflow
1. **Input Validation**: The script checks if exactly one argument is provided and if it matches either `480` or `1080`. If not, it exits with an error message.
2. **Output Directory Creation**: It dynamically creates a subdirectory named `downscaled_480p` or `downscaled_1080p` (depending on the requested resolution) to store the processed videos.
3. **Batch Processing**: It iterates over all files in the current directory that have an `.MP4` or `.mp4` extension.
4. **Encoding with `ffmpeg`**:
   - For each file, it runs an `ffmpeg` command.
   - The video filter (`-vf scale=-2:"$RES"`) scales the height to the target resolution while automatically calculating the appropriate width to maintain the original aspect ratio (`-2`).
   - The video is encoded using the `libx264` codec with a Constant Rate Factor (`-crf`) of `23`, which offers a good balance between visual quality and file size.
   - The audio stream is copied exactly without re-encoding (`-c:a copy`).
5. **Output**: Processed files are saved into the target output directory with the resolution appended to their original filenames (e.g., original `video.MP4` becomes `video_1080p.mp4`).
