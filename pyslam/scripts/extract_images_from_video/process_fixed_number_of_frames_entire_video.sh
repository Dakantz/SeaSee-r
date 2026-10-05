#!/bin/bash

# Check if the correct number of arguments is provided
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo "Usage: $0 <target_directory> <number_of_frames> [opensfm_bin_path]"
    echo "Example: $0 /path/to/videos_directory 500"
    exit 1
fi

TARGET_DIR="$1"
NUM_FRAMES="$2"

OPENSFM_CONFIG="$(dirname "$0")/config.yaml"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DEFAULT_OPENSFM_BIN="${REPO_ROOT}/openSfM/openSfM_core/bin/opensfm_run_all"
OPENSFM_BIN="${3:-${OPENSFM_BIN:-$DEFAULT_OPENSFM_BIN}}"

# Check if the target directory exists
if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory '$TARGET_DIR' does not exist."
    exit 1
fi

# Check if number_of_frames is a positive integer
if ! [[ "$NUM_FRAMES" =~ ^[0-9]+$ ]] || [ "$NUM_FRAMES" -le 0 ]; then
    echo "Error: <number_of_frames> must be a positive integer."
    exit 1
fi

# Collect all video files (.mp4 and .MP4) directly inside TARGET_DIR and sort ascending by filename
VIDEO_FILES=()
while IFS= read -r -d '' file; do
    VIDEO_FILES+=("$file")
done < <(find "$TARGET_DIR" -maxdepth 1 -type f \( -iname "*.mp4" \) -print0 | LC_ALL=C sort -z)

if [ ${#VIDEO_FILES[@]} -eq 0 ]; then
    echo "Error: No .mp4 or .MP4 video files found in '$TARGET_DIR'."
    exit 1
fi

echo "Found ${#VIDEO_FILES[@]} video files (sorted ascending):"
for vf in "${VIDEO_FILES[@]}"; do
    echo "  - $(basename "$vf")"
done

# Calculate total duration of all video files in seconds
TOTAL_DURATION=0
for vf in "${VIDEO_FILES[@]}"; do
    DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$vf" 2>/dev/null)
    if [ -n "$DUR" ]; then
        TOTAL_DURATION=$(awk -v total="$TOTAL_DURATION" -v dur="$DUR" 'BEGIN { printf "%.6f", total + dur }')
    fi
done

if awk -v dur="$TOTAL_DURATION" 'BEGIN { if (dur <= 0) exit 0; else exit 1 }'; then
    echo "Error: Could not determine total duration of videos in '$TARGET_DIR'."
    exit 1
fi

# Calculate sampling FPS across the entire video sequence (FPS = NUM_FRAMES / TOTAL_DURATION)
FPS=$(awk -v num="$NUM_FRAMES" -v dur="$TOTAL_DURATION" 'BEGIN { printf "%.8f", num / dur }')
FRAME_INTERVAL=$(awk -v num="$NUM_FRAMES" -v dur="$TOTAL_DURATION" 'BEGIN { printf "%.4f", dur / num }')

echo "=================================================="
echo "Total video duration: ${TOTAL_DURATION} seconds"
echo "Target number of frames: ${NUM_FRAMES}"
echo "Calculated sampling FPS: ${FPS} FPS (approx 1 frame every ${FRAME_INTERVAL} second(s))"
echo "=================================================="

DATASET_DIR="${TARGET_DIR}/video_dataset_fixed_${NUM_FRAMES}_frames_entire_video"
IMAGES_DIR="${DATASET_DIR}/images"

mkdir -p "$IMAGES_DIR"

# Extract images sequentially across sorted videos until NUM_FRAMES is reached
START_NUM=1
TOTAL_EXTRACTED=0

for VIDEO_PATH in "${VIDEO_FILES[@]}"; do
    if [ "$TOTAL_EXTRACTED" -ge "$NUM_FRAMES" ]; then
        echo "Target of $NUM_FRAMES frames reached. Skipping remaining videos."
        break
    fi

    REMAINING=$((NUM_FRAMES - TOTAL_EXTRACTED))
    VIDEO_BASENAME=$(basename "$VIDEO_PATH")

    echo "--------------------------------------------------"
    echo "Processing video: $VIDEO_BASENAME"
    echo "Frames extracted so far: $TOTAL_EXTRACTED / $NUM_FRAMES (Extracting up to $REMAINING frames)..."
    
    ffmpeg -loglevel error -i "$VIDEO_PATH" -vf "fps=$FPS" -vframes "$REMAINING" -start_number "$START_NUM" "$IMAGES_DIR/image_%05d.png"
    
    # Update count based on total PNG files currently extracted
    TOTAL_EXTRACTED=$(find "$IMAGES_DIR" -maxdepth 1 -name "image_*.png" | wc -l)
    START_NUM=$((TOTAL_EXTRACTED + 1))
done

echo "=================================================="
echo "Extraction completed. Total images saved to $IMAGES_DIR: $TOTAL_EXTRACTED"
echo "=================================================="

if [ "$TOTAL_EXTRACTED" -eq 0 ]; then
    echo "Error: No images were extracted."
    exit 1
fi

# Run OpenSfM on the resulting dataset directory
if [ -f "$OPENSFM_CONFIG" ]; then
    echo "Copying OpenSfM config from $OPENSFM_CONFIG to $DATASET_DIR/config.yaml"
    cp "$OPENSFM_CONFIG" "$DATASET_DIR/config.yaml"
fi

echo "Running OpenSfM on combined dataset: $DATASET_DIR"
"$OPENSFM_BIN" "$DATASET_DIR"
