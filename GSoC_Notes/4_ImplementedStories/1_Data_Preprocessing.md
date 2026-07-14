# User Story: Data Preprocessing & Synchronization

## Description
As a system developer, I want to parse the JSON log data to extract depth and attitude streams and sync them with the video frames so that I can generate a local trajectory file with synced depth and orientation.

## Acceptance Criteria
- [X] Extract the start time of the video from its metadata.
- [X] Align the video start time with the JSON log timestamps.
- [X] Interpolate the 1Hz/2Hz log data to match the video frame rate (e.g., 30fps).
- [X] Generate a local trajectory file (e.g., TUM or KITTI format) containing Timestamp, Depth (Z-axis), and Orientation (Pitch, Roll, Yaw).

## Technical Constraints / Notes
- Relying on GPS underwater is unrealistic; the output should be in local coordinates.
- Test framework currently not setup, to be added later.

## Implementation Tasks (for Antigravity)
- [X] Write failing test (TDD) - *Note: Tests pending framework setup.*
- [X] Implement code to pass criteria.
- [X] Refactor and ensure all tests pass.
- [X] Write documentation in `3_Documentation`.
