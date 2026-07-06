#!/bin/bash
set -e

# Ensure we are in the directory containing the script and other files
cd "$(dirname "$0")"

echo "Creating python virtual environment..."
python3 -m venv venv
source venv/bin/activate

echo "Installing required packages..."
pip install --upgrade pip
pip install boto3 colorama huggingface_hub

echo "Creating output directory..."
mkdir -p "./datasets/tartanair"

echo "Running download_training.py..."
python download_training.py --output-dir "./datasets/tartanair" --rgb --depth --seg --flow --unzip --workers 1 --huggingface

echo "Done."
