#!/usr/bin/env bash

# Stop on errors
set -e

echo "Downloading openSfM, pyslam, and potree submodules (no sub-submodules)..."
git submodule update --init openSfM/openSfM_core pyslam/pyslam_core seaseer-dashboard/public/potree

#if [ ! -d "$HOME/miniconda3" ]; then
#    echo "Installing Miniconda..."
#    # 1. Download the Miniconda installer
#    wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O miniconda.sh
#
#    # 2. Run the installer silently
#    bash miniconda.sh -b -p $HOME/miniconda3
#
#    # 3. Clean up the installer script
#    rm miniconda.sh
#else
#    echo "Miniconda already installed, skipping..."
#fi
#
## Initialize conda for the script
#source $HOME/miniconda3/etc/profile.d/conda.sh
#
#echo "Installing openSfM..."
## Install using conda lock files
#cd openSfM/openSfM_core
#conda create --name opensfm --file conda-linux-64.lock --yes
#conda activate opensfm
#pip install -e .
#cd - > /dev/null
#
#conda deactivate

echo "Installing pyslam fork..."
cd pyslam/pyslam_core
bash ./install_all.sh

echo "Installation complete!"
