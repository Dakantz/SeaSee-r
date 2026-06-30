# PySLAM

This directory contains the PySLAM implementation. To ensure reproducibility and support for `sm_52` GPU architectures (like the GTX 970), PySLAM is configured to run inside a dedicated Docker container (`seasee-r`) with PyTorch 2.1.0 and CUDA 11.8.

## Docker Setup Summary

1. **Start the environment** (from the repository root):
   ```powershell
   docker-compose up -d --build
   ```

2. **Run PySLAM scripts**: 
   Use the provided wrapper script to execute Python commands inside the active container. The virtual environment is automatically sourced.
   ```powershell
   .\pyslam\scripts\run_in_docker.ps1 "python main_vo.py --dataset kitti"
   ```

3. **Stop the environment**:
   ```powershell
   docker-compose down
   ```

For detailed setup notes, see [Docker_Setup.md](../GSoC_Notes/3_Documentation/Docker_Setup.md).
