# User Story: Verify PyTorch GPU Acceleration

## Description
As a developer, I want to create a simple Python script to check if PyTorch is correctly utilizing the GPU inside the `seasee-r` Docker container, so that I can ensure the CUDA environment and GPU (`sm_52`) compatibility are correctly configured before running more complex SLAM algorithms.

## Acceptance Criteria
- [ ] A Python script is created that imports PyTorch and checks for CUDA availability.
- [ ] The script prints out the status of GPU availability and the name of the active GPU device.
- [ ] The script can be successfully executed inside the `seasee-r` Docker container and reports that the GPU is available.

## Technical Constraints / Notes
- The script should be executed within the `seasee-r` Docker container using the existing `docker-compose` setup.
- It must test against the installed version of PyTorch (2.1.0 or earlier) which supports the `sm_52` architecture.

## Implementation Tasks (for Antigravity)
- [ ] Write a simple Python script (e.g., `test_gpu.py`) to verify `torch.cuda.is_available()` and `torch.cuda.get_device_name()`.
- [ ] Execute the script inside the Docker container to ensure GPU acceleration works.
- [ ] Document the script usage in `3_Documentation` if necessary.
