# Documentation: `download_training.py`

**Script Path**: `./SeaSee-r/pyslam/scripts/download_tartanair_dataset/download_training.py`

## Overview
This script is responsible for downloading the TartanAir dataset for training purposes. Based on the project's requirements, this script is used **exclusively to download the Ocean dataset**, as it is the only relevant environment for SeaSee-r.

## Features
- **Parallel Downloading**: Downloads dataset files concurrently using multiple threads (configurable via the `--workers` argument) to maximize bandwidth utilization.
- **Multiple Sources**: Supports downloading from different storage mirrors/sources:
  - Default: AirLab Ceph RGW public TartanAir mirror.
  - Hugging Face (`--huggingface`)
  - CloudFlare R2 (`--cloudflare`)
- **Selective Downloads**: Allows filtering what data modalities to download (RGB, depth, segmentation, optical flow) and which camera views to include (left, right).
- **Auto-Extraction**: Supports automatically unzipping files after they are downloaded (`--unzip`).

## Usage
Run the script using Python 3:

```bash
python download_training.py [OPTIONS]
```

### Key Command Line Arguments
- `--output-dir`: Root directory where the downloaded files will be stored (default: `./`).
- `--rgb`, `--depth`, `--seg`, `--flow`: Flags to specify which data modalities to download. At least one must be specified.
- `--only-easy`, `--only-hard`: Flags to specify the difficulty level of the trajectories.
- `--only-left`, `--only-right`, `--only-flow`, `--only-mask`: Flags to limit downloading to specific camera views or data types.
- `--unzip`: If set, automatically extracts the contents of the downloaded `.zip` files. *Note: this will overwrite existing files.*
- `--workers`: Number of worker threads for parallel downloading (default: `8`).

## How it Works
1. The script parses the command-line arguments to determine the output directory, requested data types, and download sources.
2. It reads a local file named `download_training_zipfiles.txt` which lists all the available `.zip` files and their file sizes.
3. It filters this list based on the requested file types (e.g., `image`, `depth`) and difficulty levels.
4. It initializes the appropriate downloader backend (AirLab, Hugging Face, or CloudFlare).
5. It performs the download in parallel using a thread pool.
6. Finally, if the `--unzip` flag is passed, it extracts the contents into the target directory.

---

## Bash Helper: `download.sh`

**Script Path**: `./SeaSee-r/pyslam/scripts/download_tartanair_dataset/download.sh`

A convenient helper script that sets up a Python virtual environment, installs dependencies (`boto3`, `colorama`, `huggingface_hub`), creates the target directory, and runs `download_training.py` with Hugging Face as the source.

### Usage
```bash
./download.sh <output_directory>
```

- `<output_directory>`: The directory where the dataset will be downloaded and unzipped.
