#!/bin/bash
set -e

# Check if output directory argument is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <output_directory>"
    echo "Example: $0 ./datasets/tartanair"
    exit 1
fi

TARGET_DIR="$1"
mkdir -p "$TARGET_DIR"
OUTPUT_DIR="$(cd "$TARGET_DIR" && pwd)"

# Ensure we are in the directory containing the script and other files
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Creating python virtual environment..."
python3 -m venv venv
source venv/bin/activate

echo "Installing required packages..."
pip install --upgrade pip
pip install boto3 colorama huggingface_hub

echo "Output directory: $OUTPUT_DIR"

echo "Running download_training.py..."
python download_training.py --output-dir "$OUTPUT_DIR" --rgb --depth --seg --flow --unzip --workers 1 --huggingface

echo "Done."
