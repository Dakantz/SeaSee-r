#!/bin/bash

# 1. Check if a parameter was provided
if [ -z "$1" ]; then
    echo "Error: Please provide a resolution parameter."
    echo "Usage: ./downscale.sh [480|1080]"
    exit 1
fi

RES=$1

# 2. Validate that the input is either 480 or 1080
if [ "$RES" != "480" ] && [ "$RES" != "1080" ]; then
    echo "Error: Unsupported resolution. Please use 480 or 1080."
    exit 1
fi

# 3. Set the output directory name dynamically
OUT_DIR="downscaled_${RES}p"

# Create the directory
mkdir -p "$OUT_DIR"

echo "Starting batch downscale to ${RES}p..."

# 4. Loop through all .MP4 files
for file in *.[mM][pP]4; do
    # Check if the file actually exists (prevents errors if the folder has no .MP4 files)
    if [ -e "$file" ]; then
        echo "Processing: $file"
        ffmpeg -i "$file" -vf scale=-2:"$RES" -c:v libx264 -crf 23 -c:a copy "$OUT_DIR/${file%.MP4}_${RES}p.mp4"
    else
        echo "No .MP4 files found in the current directory."
        exit 0
    fi
done

echo "All files processed successfully!"
