# User Story: Implement Slam Test Script

## Description
As a developer, I want to create a simple Python script that uses `pyslam` to process a sample video (`sample.mp4`) inside the `seasee-r` Docker container, so that I can verify that the PySLAM environment is working correctly and processes video frames as expected.

## Acceptance Criteria
- [ ] A Python script is created to process a video file (`sample.mp4`) using `pyslam`.
- [ ] The script can be successfully executed inside the `seasee-r` Docker container.
- [ ] The script reads `sample.mp4` and performs basic SLAM processing (e.g., extracts features, outputs tracking results or camera poses).

## Technical Constraints / Notes
- The script should run within the `seasee-r` Docker container using the existing `docker-compose` setup.
- The sample video `sample.mp4` should be available to the script (e.g., via volume mounting).

## Implementation Tasks (for Antigravity)
- [ ] Create a simple Python test script to initialize and run PySLAM on a video file.
- [ ] Ensure `sample.mp4` is available in the appropriate directory or instruct the user to place one.
- [ ] Verify the script runs without errors inside the Docker container.
- [ ] Document the script usage in `3_Documentation`.
