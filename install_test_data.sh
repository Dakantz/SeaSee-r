#!/usr/bin/env bash
set -e

FILE_ID="1AX6gxjcBOxRZwuUYf5Qs7KHcPmFr9Gm-"
DOWNLOAD_URL="https://drive.usercontent.google.com/download?id=${FILE_ID}&export=download&confirm=t"

ZIP_FILE="./test_data.zip"
OUTPUT_DIR="./seaseer-dashboard/public"

echo "Downloading test data..."

if command -v aria2c >/dev/null 2>&1; then
    echo "Using aria2c..."
    aria2c -x 8 -s 8 -c "$DOWNLOAD_URL" -o "$ZIP_FILE"

elif command -v curl >/dev/null 2>&1; then
    echo "aria2c not found. Using curl..."
    curl -L -C - "$DOWNLOAD_URL" -o "$ZIP_FILE"

else
    echo "Error: Neither aria2c nor curl is installed."
    exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
    echo "unzip not found. Installing..."

    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update
        sudo apt-get install -y unzip
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y unzip
    elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -S --noconfirm unzip
    elif command -v brew >/dev/null 2>&1; then
        brew install unzip
    else
        echo "Error: Could not automatically install unzip."
        exit 1
    fi
fi

echo "Extracting test data..."

mkdir -p "$OUTPUT_DIR"
unzip -q -o "$ZIP_FILE" -d "$OUTPUT_DIR"

echo "Cleaning up..."
rm "$ZIP_FILE"

echo "Test data installed successfully in $OUTPUT_DIR"