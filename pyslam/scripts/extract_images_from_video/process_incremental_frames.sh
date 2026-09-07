#!/bin/bash

# Usage: $0 <target_directory> [start_frames] [end_frames] [step] [frame_interval_seconds]

if [ "$#" -lt 1 ] || [ "$#" -gt 5 ]; then
    echo "Usage: $0 <target_directory> [start_frames] [end_frames] [step] [frame_interval_seconds]"
    echo "Example: $0 /path/to/videos_directory 100 500 100 1"
    exit 1
fi

TARGET_DIR="$1"
START_FRAMES="${2:-100}"
END_FRAMES="${3:-500}"
STEP="${4:-100}"
FRAME_INTERVAL="${5:-1}"

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
PROCESS_SCRIPT="${SCRIPT_DIR}/process_fixed_number_of_frames.sh"

# Check if target directory exists
if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory '$TARGET_DIR' does not exist."
    exit 1
fi

# Check if process_fixed_number_of_frames.sh exists
if [ ! -f "$PROCESS_SCRIPT" ]; then
    echo "Error: Required script '$PROCESS_SCRIPT' not found."
    exit 1
fi

# Validate integer parameters
for var_name in "START_FRAMES" "END_FRAMES" "STEP"; do
    val="${!var_name}"
    if ! [[ "$val" =~ ^[0-9]+$ ]] || [ "$val" -le 0 ]; then
        echo "Error: $var_name must be a positive integer (got '$val')."
        exit 1
    fi
done

if [ "$START_FRAMES" -gt "$END_FRAMES" ]; then
    echo "Error: start_frames ($START_FRAMES) cannot be greater than end_frames ($END_FRAMES)."
    exit 1
fi

echo "=================================================="
echo "Starting Batch Frame Processing"
echo "Target Directory: $TARGET_DIR"
echo "Start Frames: $START_FRAMES | End Frames: $END_FRAMES | Step: $STEP"
echo "Frame Interval: $FRAME_INTERVAL second(s)"
echo "=================================================="

for (( NUM_FRAMES=START_FRAMES; NUM_FRAMES<=END_FRAMES; NUM_FRAMES+=STEP )); do
    echo ""
    echo "=================================================="
    echo "Processing iteration: NUM_FRAMES = $NUM_FRAMES"
    echo "=================================================="

    "$PROCESS_SCRIPT" "$TARGET_DIR" "$NUM_FRAMES" "$FRAME_INTERVAL"
    
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
        echo "Warning: Iteration with NUM_FRAMES=$NUM_FRAMES exited with code $EXIT_CODE."
    fi
done

echo "=================================================="
echo "Batch frame processing complete!"
echo "=================================================="
