#!/bin/bash

# Check if the correct number of arguments is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <target_directory>"
    echo "Example: $0 /path/to/videos_directory"
    exit 1
fi

TARGET_DIR="$1"
# Assume the extraction script is in the same directory as this script
EXTRACT_SCRIPT="$(dirname "$0")/extract_images.sh"
OPENSFM_BIN="/home/tastegger/Documents/SeaSee-r/openSfM/openSfM_core/bin/opensfm_run_all"

# Check if the target directory exists
if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory '$TARGET_DIR' does not exist."
    exit 1
fi

# Function to convert seconds to HH:MM:SS format
seconds_to_timestamp() {
    local total_seconds=$1
    local h=$((total_seconds / 3600))
    local m=$(( (total_seconds % 3600) / 60 ))
    local s=$((total_seconds % 60))
    printf "%02d:%02d:%02d\n" $h $m $s
}

# Enable nullglob so the loop won't execute if no files match
shopt -s nullglob

# Look for all .mp4 and .MP4 files directly inside the directory
for VIDEO_PATH in "$TARGET_DIR"/*.mp4 "$TARGET_DIR"/*.MP4; do
    echo "=================================================="
    echo "Processing video: $VIDEO_PATH"
    echo "=================================================="
    
    # Get the duration of the video in seconds using ffprobe
    DURATION_FLOAT=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO_PATH")
    
    if [ -z "$DURATION_FLOAT" ]; then
        echo "Error: Could not determine the duration for $VIDEO_PATH. Skipping."
        continue
    fi
    
    # Convert float duration to integer (truncate decimal part)
    DURATION=${DURATION_FLOAT%.*}
    
    VIDEO_DIR=$(dirname "$VIDEO_PATH")
    VIDEO_BASENAME=$(basename "$VIDEO_PATH")
    VIDEO_NAME="${VIDEO_BASENAME%.*}"
    
    # Process the video in 30-second chunks
    for (( START=0; START<DURATION; START+=30 )); do
        END=$((START + 30))
        
        # Ensure the end time does not exceed the video duration
        if (( END > DURATION )); then
            END=$DURATION
        fi
        
        # Convert integer seconds to HH:MM:SS timestamps
        START_TS=$(seconds_to_timestamp $START)
        END_TS=$(seconds_to_timestamp $END)
        
        # Calculate the expected dataset directory name
        SAFE_START=$(echo "$START_TS" | tr ':' '-')
        SAFE_END=$(echo "$END_TS" | tr ':' '-')
        DATASET_DIR="${VIDEO_DIR}/video_dataset_${VIDEO_NAME}_${SAFE_START}_to_${SAFE_END}"
        
        if [ -d "$DATASET_DIR" ]; then
            echo "--------------------------------------------------"
            echo "Skipping chunk: $START_TS to $END_TS. Directory already exists ($DATASET_DIR)"
            continue
        fi

        echo "--------------------------------------------------"
        echo "Processing chunk: $START_TS to $END_TS"
        
        # Run the extraction script
        "$EXTRACT_SCRIPT" "$VIDEO_PATH" "$START_TS" "$END_TS"
        
        # Run OpenSfM on the resulting dataset directory
        if [ -d "$DATASET_DIR" ]; then
            echo "Running OpenSfM on dataset: $DATASET_DIR"
            "$OPENSFM_BIN" "$DATASET_DIR"
        else
            echo "Error: Expected dataset directory '$DATASET_DIR' not found. Skipping OpenSfM for this chunk."
        fi
    done
done
