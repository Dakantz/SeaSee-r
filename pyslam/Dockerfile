FROM nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04

# Prevent interactive prompts during apt install
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies required for PySLAM, OpenCV, Pangolin, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    wget \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    freeglut3-dev \
    libglew-dev \
    libegl1-mesa-dev \
    x11-apps \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

# Clone pyslam repository
# We use --recursive to pull in all submodules required by pyslam
RUN git clone --recursive https://github.com/luigifreda/pyslam.git /opt/pyslam

# Set up python environment and install pyslam dependencies
WORKDIR /opt/pyslam

# Create a venv and activate it by default
ENV VIRTUAL_ENV=/opt/pyslam/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Optimize compilation for GTX 970 (Maxwell) and prevent Out-Of-Memory errors in WSL2
ENV MAX_JOBS=1
ENV TORCH_CUDA_ARCH_LIST="5.2"


# Install base python dependencies and pip upgrade
RUN pip install --upgrade pip setuptools wheel

# Modify install scripts to not require interactive sudo password, or we can just run them as root.
# PySLAM's install_all.sh installs some apt packages and then builds thirdparty libs.
RUN sed -i 's/sudo apt-get/apt-get -y/g' install_all.sh || true
RUN sed -i 's/sudo apt/apt-get -y/g' install_all.sh || true

# Note: Building PySLAM via install_all.sh in Docker might take a while.
# We will provide a helper script to build it inside the container when it runs, 
# or the user can run `./install_all.sh` manually to see the progress.

# Install custom pinned requirements for PyTorch compatibility
COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# For now, we install basic python requirements from pyslam too
RUN pip install -r requirements.txt || true

WORKDIR /workspace

# Provide a simple entrypoint to keep it running for devcontainer
CMD ["sleep", "infinity"]
