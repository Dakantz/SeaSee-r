# Video & Log Interval Analyzers

The primary purpose of [`analyze_video_intervals.py`](file:///home/tastegger/Documents/SeaSee-r/pyslam/scripts/video_data_analyzer/analyze_video_intervals.py) and [`analyze_log_intervals.py`](file:///home/tastegger/Documents/SeaSee-r/pyslam/scripts/video_data_analyzer/analyze_log_intervals.py) is to find and match overlapping temporal intervals between multi-day video recording sessions and ROV sensor JSON logs. By measuring precise start times, end times, active durations, record counts, and pause gaps across video subfolders and sensor log files, these scripts enable users to easily identify overlapping timestamp ranges for precise frame-to-log data synchronization.

## Usage

### Video Interval Analyzer
```bash
python3 analyze_video_intervals.py <video_directory> [-g GAP_SECONDS]
```
- `<video_directory>`: Path to the root directory containing video subfolders.
- `-g, --gap`: Pause threshold in seconds (default: 600.0s / 10 minutes).

### Log Interval Analyzer
```bash
python3 analyze_log_intervals.py <log_json_file> [-g GAP_SECONDS]
```
- `<log_json_file>`: Path to the ROV JSON log file.
- `-g, --gap`: Pause threshold in seconds to delimit intervals (default: 600.0s).
