#!/usr/bin/env python3
"""
Log File Interval Analyzer

Analyzes JSON log files (such as ROV logs) to identify continuous logging time intervals.
A gap greater than a specified threshold (default: 1.0 second) between consecutive
log entries marks the boundary between different intervals.
"""

import sys
import json
import argparse
from datetime import datetime, timezone


def format_duration(seconds: float) -> str:
    """Format duration in seconds into a human-readable string."""
    if seconds < 60:
        return f"{seconds:.3f}s"
    elif seconds < 3600:
        minutes = int(seconds // 60)
        secs = seconds % 60
        return f"{minutes}m {secs:.3f}s"
    else:
        hours = int(seconds // 3600)
        rem = seconds % 3600
        minutes = int(rem // 60)
        secs = rem % 60
        return f"{hours}h {minutes}m {secs:.3f}s"


def analyze_log_intervals(filepath: str, max_gap_seconds: float = 600.0):
    """
    Parses the JSON log file and groups entries into intervals where
    consecutive timestamps are within max_gap_seconds of each other.
    """
    print(f"Loading log file: {filepath}")
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    print(f"Total log records loaded: {len(data):,}\n")

    # Extract timestamps (milliseconds)
    entries = []
    for item in data:
        if isinstance(item, dict) and 'timestamp' in item:
            entries.append(item['timestamp'])

    if not entries:
        print("No valid timestamps found in the log file.")
        return

    # Ensure records are sorted by timestamp
    entries.sort()

    threshold_ms = max_gap_seconds * 1000.0
    intervals = []

    start_ts = entries[0]
    prev_ts = entries[0]
    count = 1

    for ts in entries[1:]:
        gap_ms = ts - prev_ts
        if gap_ms > threshold_ms:
            # End of current interval
            intervals.append({
                'start_ts': start_ts,
                'end_ts': prev_ts,
                'count': count,
                'next_gap_s': gap_ms / 1000.0
            })
            start_ts = ts
            count = 1
        else:
            count += 1
        prev_ts = ts

    # Add the last interval
    intervals.append({
        'start_ts': start_ts,
        'end_ts': prev_ts,
        'count': count,
        'next_gap_s': None
    })

    # Print Results Table
    header = f"{'#':<3} | {'Start Time':<23} | {'End Time':<23} | {'Duration':<14} | {'Entries':<8} | {'Pause to Next':<14}"
    divider = "-" * len(header)

    print(f"Found {len(intervals)} distinct logging intervals (Threshold > {max_gap_seconds}s pause):\n")
    print(header)
    print(divider)

    total_logged_duration = 0.0

    for idx, interval in enumerate(intervals, 1):
        s_dt = datetime.fromtimestamp(interval['start_ts'] / 1000.0).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        e_dt = datetime.fromtimestamp(interval['end_ts'] / 1000.0).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        dur_s = (interval['end_ts'] - interval['start_ts']) / 1000.0
        total_logged_duration += dur_s
        dur_str = format_duration(dur_s)
        
        next_gap_str = format_duration(interval['next_gap_s']) if interval['next_gap_s'] is not None else "N/A (End)"

        print(f"{idx:<3} | {s_dt:<23} | {e_dt:<23} | {dur_str:<14} | {interval['count']:<8,} | {next_gap_str:<14}")

    print(divider)
    print("\nSummary Statistics:")
    print(f" - Total Intervals:          {len(intervals)}")
    print(f" - Total Log Entries:        {len(entries):,}")
    print(f" - Active Logging Duration:  {format_duration(total_logged_duration)}")
    if len(intervals) > 1:
        first_start = intervals[0]['start_ts'] / 1000.0
        last_end = intervals[-1]['end_ts'] / 1000.0
        total_timespan = last_end - first_start
        total_pauses = total_timespan - total_logged_duration
        print(f" - Total Timespan (overall): {format_duration(total_timespan)}")
        print(f" - Total Inactive/Pause Time:{format_duration(total_pauses)}")


def main():
    parser = argparse.ArgumentParser(description="Analyze log data time intervals separated by pauses.")
    parser.add_argument(
        "filepath",
        nargs="?",
        default="/home/tastegger/Documents/Data/KrK_2026/LogProtokolle_310726bis040826/ROV-Log-2026-07-31-2026-08-04-0807185640.json",
        help="Path to the JSON log file"
    )
    parser.add_argument(
        "-g", "--gap",
        type=float,
        default=600.0,
        help="Pause threshold in seconds to delimit intervals (default: 600.0s)"
    )

    args = parser.parse_args()
    analyze_log_intervals(args.filepath, args.gap)


if __name__ == "__main__":
    main()
