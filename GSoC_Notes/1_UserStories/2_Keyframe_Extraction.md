# User Story: Keyframe Extraction & Quality Assessment

## Description
As a data pipeline processor, I want to parse the ROV video and extract only high-quality keyframes so that I can avoid processing blurry or featureless frames in SLAM/SfM and reduce computational load.

## Acceptance Criteria
- [ ] Implement a lightweight script to parse the video.
- [ ] Use image processing metrics (e.g., Variance of Laplacian) to filter out blurry frames.
- [ ] Use feature metrics (e.g., ORB feature count) to ensure texture richness.
- [ ] Output a curated set of frames that act as ideal control images for openFsM.

## Technical Constraints / Notes
- Underwater video is often plagued by motion blur, marine snow, and featureless regions (e.g., open water or plain sand).
- Test framework currently not setup, to be added later.

## Implementation Tasks (for Antigravity)
- [ ] Write failing test (TDD) - *Note: Tests pending framework setup.*
- [ ] Implement code to pass criteria.
- [ ] Refactor and ensure all tests pass.
- [ ] Write documentation in `3_Documentation`.
