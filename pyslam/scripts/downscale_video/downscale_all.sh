#!/bin/bash

# 1. Check if arguments are provided
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <target_directory> [480|1080]"
    echo "Example: $0 /path/to/videos 1080"
    exit 1
fi

TARGET_DIR="$1"
RES="$2"

# 2. Check if the target directory exists
if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory '$TARGET_DIR' does not exist."
    exit 1
fi

# 3. Validate that the input resolution is either 480 or 1080
if [ "$RES" != "480" ] && [ "$RES" != "1080" ]; then
    echo "Error: Unsupported resolution '$RES'. Please use 480 or 1080."
    exit 1
fi

# 4. Navigate to target directory
cd "$TARGET_DIR" || exit 1

# 5. Loop through all .MP4/.mp4 files
shopt -s nullglob nocaseglob
files=(*.[mM][pP]4)

if [ ${#files[@]} -eq 0 ]; then
    echo "No .MP4 or .mp4 files found in '$TARGET_DIR'."
    exit 0
fi

# 6. Set the output directory name dynamically and create it
OUT_DIR="downscaled_${RES}p"
mkdir -p "$OUT_DIR"

echo "Starting batch downscale to ${RES}p in '$TARGET_DIR'..."

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "Processing: $file"
        base="${file%.*}"
        ffmpeg -i "$file" -vf scale=-2:"$RES" -c:v libx264 -crf 23 -c:a copy "$OUT_DIR/${base}_${RES}p.mp4"
    fi
done

echo "All files processed successfully!"
