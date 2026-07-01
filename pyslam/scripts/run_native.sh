#!/bin/bash
set -e

# Get directory of this script and repository root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PYTHON_DOWNLOAD_DIR="$PROJECT_ROOT/.python3.10"
VENV_DIR="$PROJECT_ROOT/venv"

# 1. Download and extract portable Python 3.10 if not present
if [ ! -f "$PYTHON_DOWNLOAD_DIR/python/bin/python3" ]; then
    echo "=========================================================="
    echo "Downloading portable CPython 3.10.20..."
    echo "=========================================================="
    mkdir -p "$PYTHON_DOWNLOAD_DIR"
    TAR_PATH="$PYTHON_DOWNLOAD_DIR/python310.tar.gz"
    
    # Download using python3 (which is available on host system)
    python3 -c "import urllib.request; urllib.request.urlretrieve('https://github.com/astral-sh/python-build-standalone/releases/download/20260623/cpython-3.10.20+20260623-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz', '$TAR_PATH')"
    
    echo "Extracting Python 3.10.20..."
    tar -xzf "$TAR_PATH" -C "$PYTHON_DOWNLOAD_DIR"
    rm "$TAR_PATH"
fi

PORTABLE_PYTHON="$PYTHON_DOWNLOAD_DIR/python/bin/python3"

# 2. Create virtual environment using the portable Python 3.10 if not present
if [ ! -d "$VENV_DIR" ]; then
    echo "=========================================================="
    echo "Creating virtual environment at $VENV_DIR..."
    echo "=========================================================="
    "$PORTABLE_PYTHON" -m venv --without-pip "$VENV_DIR"
    
    echo "Bootstrapping pip..."
    # Download get-pip.py using the portable python
    "$PORTABLE_PYTHON" -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', '$VENV_DIR/get-pip.py')"
    "$VENV_DIR/bin/python3" "$VENV_DIR/get-pip.py"
    rm "$VENV_DIR/get-pip.py"
    
    echo "Installing required Python packages..."
    "$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel
    "$VENV_DIR/bin/pip" install -r "$PROJECT_ROOT/pyslam/requirements.txt"
    "$VENV_DIR/bin/pip" install "opencv-python==4.8.1.78"
fi

# 3. Set PYSLAM_DIR to the cloned thirdparty copy if present
PYSLAM_DIR="$PROJECT_ROOT/pyslam/thirdparty/pyslam"
export PYSLAM_DIR

# 4. Activate virtual environment and run command
source "$VENV_DIR/bin/activate"

if [ $# -eq 0 ]; then
    exec bash
else
    exec "$@"
fi
