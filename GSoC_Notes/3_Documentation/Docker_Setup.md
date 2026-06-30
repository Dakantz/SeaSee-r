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

To verify PyTorch GPU acceleration inside the Docker container:
```powershell
powershell.exe -ExecutionPolicy Bypass -File .\pyslam\scripts\run_in_docker.ps1 "python tests/test_gpu.py"
```

## Stopping the Container

To stop the background container, run from the repository root:

```powershell
docker-compose down
```
