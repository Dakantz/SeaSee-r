# PySLAM Docker Container (`seasee-r`) Setup

This document describes how to use the Docker container to reliably run PySLAM on the host machine. The setup targets PyTorch 2.1.0 with CUDA 11.8 specifically to support the `sm_52` GPU architecture (e.g., GTX 970).

## Building and Starting the Container

To build and start the Docker container in the background, navigate to the repository root (`SeaSee-r` directory) and run:

```powershell
docker-compose up -d --build
```

This will build the `seasee-r` image (installing the required dependencies defined in `requirements.txt`) and keep the container running indefinitely via `sleep infinity`.

## Using the Wrapper Script

A convenient PowerShell wrapper script is provided to let you execute PySLAM Python scripts as if they were running natively, while execution actually happens inside the `seasee-r` container.

**Script Location:** `.\pyslam\scripts\run_in_docker.ps1`

### Usage Examples

To check the installed PyTorch version and GPU passthrough:
```powershell
.\pyslam\scripts\run_in_docker.ps1 "python -c `"import torch; print(torch.__version__); print(torch.cuda.is_available())`""
```

To run a specific PySLAM script (for instance, `main_vo.py`):
```powershell
.\pyslam\scripts\run_in_docker.ps1 "python main_vo.py --dataset kitti"
```

> **Note:** The wrapper script automatically sources the Python virtual environment (`/opt/pyslam/venv`) before executing your command.

## Stopping the Container

To stop the background container, run from the repository root:

```powershell
docker-compose down
```
