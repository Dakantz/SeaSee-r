#!/bin/bash

# Check if the correct number of arguments is provided
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo "Usage: $0 <path_to_video> <start_timestamp> [end_timestamp]"
    echo "Example: $0 /path/to/video.mp4 00:00:10 00:01:00"
    exit 1
fi

VIDEO_PATH="$1"
START_TIMESTAMP="$2"
END_TIMESTAMP="$3"

# Check if the video file exists
if [ ! -f "$VIDEO_PATH" ]; then
    echo "Error: Video file '$VIDEO_PATH' does not exist."
    exit 1
fi

# Extract directory and video name
VIDEO_DIR=$(dirname "$VIDEO_PATH")
VIDEO_BASENAME=$(basename "$VIDEO_PATH")
VIDEO_NAME="${VIDEO_BASENAME%.*}"

# Sanitize the timestamp(s) to make them safe for folder names (e.g., 00:01:30 -> 00-01-30)
SAFE_START=$(echo "$START_TIMESTAMP" | tr ':' '-')
DIR_SUFFIX="$SAFE_START"

if [ -n "$END_TIMESTAMP" ]; then
    SAFE_END=$(echo "$END_TIMESTAMP" | tr ':' '-')
    DIR_SUFFIX="${SAFE_START}_to_${SAFE_END}"
fi

# Define the output directory based on the video path, name, and timestamp(s)
OUTPUT_DIR="${VIDEO_DIR}/video_dataset_${VIDEO_NAME}_${DIR_SUFFIX}/images"

# Create the output directory if it does not exist
echo "Creating directory: $OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Use ffmpeg to extract images every second
if [ -n "$END_TIMESTAMP" ]; then
    echo "Extracting images from $VIDEO_PATH from $START_TIMESTAMP to $END_TIMESTAMP..."
    ffmpeg -ss "$START_TIMESTAMP" -to "$END_TIMESTAMP" -i "$VIDEO_PATH" -vf fps=1 "$OUTPUT_DIR/image_%05d.png"
else
    echo "Extracting images from $VIDEO_PATH starting at $START_TIMESTAMP..."
    ffmpeg -ss "$START_TIMESTAMP" -i "$VIDEO_PATH" -vf fps=1 "$OUTPUT_DIR/image_%05d.png"
fi

echo "Done! Images have been saved to $OUTPUT_DIR"
