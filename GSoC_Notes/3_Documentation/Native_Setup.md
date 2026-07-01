# PySLAM Native Setup on Linux Host

This document describes how to run PySLAM and its test scripts natively on a Linux host system. The setup utilizes a portable CPython 3.10 runtime environment and matches the project's PyTorch 2.1.0 and CUDA 11.8 requirement to maintain complete configuration alignment with the Docker setup, enabling GPU acceleration directly on the host.

## Prerequisites

- Linux Host System (tested on Ubuntu 25.04)
- NVIDIA GPU (e.g., GTX 970 with `sm_52` architecture) with standard Nvidia drivers installed.
- System dependencies (such as OpenGL and OpenCV system libraries) should be present.
- A standard Python 3 interpreter (used only once to bootstrap the download process).

## Native Execution Wrapper

To simplify execution and automate the environment setup, a wrapper script is provided:

**Script Location:** `pyslam/scripts/run_native.sh`

This script will automatically:
1. Download a portable standalone `CPython 3.10` build inside a local `.python3.10/` directory (if not already downloaded).
2. Create a virtual environment at `venv/` at the root of the project.
3. Bootstrap `pip` (since `ensurepip` is not packaged by default on some Linux host installations).
4. Install all Python dependencies from `pyslam/requirements.txt` (specifically targeting `torch==2.1.0+cu118` and its corresponding packages).
5. Set `PYSLAM_DIR` to point to the local PySLAM repository clone (`pyslam/thirdparty/pyslam`).
6. Source the virtual environment and run the requested Python script.

## Usage Examples

Run all Python scripts via the `run_native.sh` wrapper from the repository root:

### 1. Verify PyTorch GPU Acceleration
To check if PyTorch natively accesses the host GPU:
```bash
./pyslam/scripts/run_native.sh python pyslam/tests/test_gpu.py
```
Expected output confirms CUDA availability and names the active GPU:
```
Testing PyTorch GPU Acceleration...
CUDA Available: True
Number of GPUs: 1
Active GPU Device Name: NVIDIA GeForce GTX 970
Current Device ID: 0
```

### 2. Run Video Processing Test Script
To run the video processing test natively on the host:
```bash
./pyslam/scripts/run_native.sh python pyslam/scripts/process_video.py --video pyslam/sample.mp4
```

## Setup Troubleshooting & Paths

- **Virtual Environment location:** `venv/` (relative to the repository root directory).
- **Standalone Python location:** `.python3.10/` (relative to the repository root directory).
- If the virtual environment needs to be fully reset, delete both directories and run the wrapper script again:
  ```bash
  rm -rf venv/ .python3.10/
  ```
