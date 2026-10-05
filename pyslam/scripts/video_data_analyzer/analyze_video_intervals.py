#!/usr/bin/env python3
"""
Video Interval Analyzer

Analyzes video files across subfolders in a target directory (e.g., KrK_2026).
All video files inside a subfolder are treated as parts of one consolidated video.
Uses the video files' modification datetimes (and duration of first chunk) to measure
exact start times, end times, durations, and pauses between video recordings.
"""

import os
import sys
import json
import argparse
import subprocess
from datetime import datetime


def format_duration(seconds: float) -> str:
    """Format duration in seconds into a human-readable string."""
    if seconds < 0:
        return f"-{format_duration(abs(seconds))}"
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        minutes = int(seconds // 60)
        secs = seconds % 60
        return f"{minutes}m {secs:.1f}s"
    else:
        hours = int(seconds // 3600)
        rem = seconds % 3600
        minutes = int(rem // 60)
        secs = rem % 60
        return f"{hours}h {minutes}m {secs:.1f}s"


def get_video_duration(filepath: str) -> float:
    """Retrieve video duration in seconds using ffprobe or exiftool fallback."""
    # Try ffprobe
    try:
        cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filepath]
        res = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True).strip()
        if res:
            return float(res)
    except Exception:
        pass

    # Try exiftool fallback
    try:
        cmd = ['exiftool', '-s3', '-Duration', filepath]
        res = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True).strip()
        if res:
            # Parse format like '0:03:00' or '180.00 s'
            parts = res.replace('s', '').strip().split(':')
            if len(parts) == 3:
                return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
            elif len(parts) == 2:
                return float(parts[0]) * 60 + float(parts[1])
            else:
                return float(parts[0])
    except Exception:
        pass

    return 0.0


def analyze_video_intervals(base_dir: str, gap_threshold_seconds: float = 600.0):
    """
    Scans base_dir for subfolders containing video files.
    Groups chunks in each subfolder into a single video recording entity.
    Measures start time (first mtime - duration), end time (last mtime),
    and computes pauses between video recordings.
    """
    print(f"Scanning directory: {base_dir}")
    video_extensions = ('.mp4', '.mov', '.avi', '.mkv', '.m4v')

    folder_videos = []

    for root, dirs, files in os.walk(base_dir):
        vfiles = [f for f in files if f.lower().endswith(video_extensions)]
        if not vfiles:
            continue

        file_list = []
        total_bytes = 0
        for vf in vfiles:
            full_path = os.path.join(root, vf)
            try:
                mtime = os.path.getmtime(full_path)
                size = os.path.getsize(full_path)
                total_bytes += size
                file_list.append({
                    'filename': vf,
                    'path': full_path,
                    'mtime': mtime,
                    'size': size
                })
            except OSError:
                continue

        if not file_list:
            continue

        # Sort files by modification time
        file_list.sort(key=lambda x: x['mtime'])

        first_file = file_list[0]
        last_file = file_list[-1]

        # Get duration of first chunk to estimate exact recording start time
        first_duration = get_video_duration(first_file['path'])

        start_time = first_file['mtime'] - first_duration
        end_time = last_file['mtime']
        duration = end_time - start_time

        rel_folder = os.path.relpath(root, base_dir)

        folder_videos.append({
            'folder': rel_folder,
            'full_dir': root,
            'chunk_count': len(file_list),
            'start_time': start_time,
            'end_time': end_time,
            'duration': duration,
            'size_bytes': total_bytes,
            'files': file_list
        })

    if not folder_videos:
        print("No video files found in the specified directory.")
        return

    # Sort subfolder video recordings chronologically by start time
    folder_videos.sort(key=lambda x: x['start_time'])

    # Compute pauses between consecutive subfolder videos
    for i in range(len(folder_videos)):
        if i < len(folder_videos) - 1:
            pause = folder_videos[i + 1]['start_time'] - folder_videos[i]['end_time']
            folder_videos[i]['next_pause'] = pause
        else:
            folder_videos[i]['next_pause'] = None

    # Group into macro intervals based on gap_threshold_seconds
    macro_intervals = []
    curr_group = [folder_videos[0]]

    for v in folder_videos[1:]:
        prev_v = curr_group[-1]
        gap = v['start_time'] - prev_v['end_time']
        if gap > gap_threshold_seconds:
            macro_intervals.append(curr_group)
            curr_group = [v]
        else:
            curr_group.append(v)
    macro_intervals.append(curr_group)

    # Output Section 1: Detailed Subfolder Videos Table
    print(f"\nFound {len(folder_videos)} video subfolders across {len(macro_intervals)} recording session groups:\n")

    header = f"{'#':<3} | {'Subfolder / Video':<33} | {'Chunks':<6} | {'Start Time':<19} | {'End Time':<19} | {'Duration':<11} | {'Size (GB)':<9} | {'Pause to Next':<14}"
    divider = "-" * len(header)
    print(header)
    print(divider)

    total_video_duration = 0.0
    total_size_bytes = 0
    total_chunks = 0

    for idx, v in enumerate(folder_videos, 1):
        s_dt = datetime.fromtimestamp(v['start_time']).strftime('%Y-%m-%d %H:%M:%S')
        e_dt = datetime.fromtimestamp(v['end_time']).strftime('%Y-%m-%d %H:%M:%S')
        dur_str = format_duration(v['duration'])
        size_gb = v['size_bytes'] / (1024 ** 3)
        pause_str = format_duration(v['next_pause']) if v['next_pause'] is not None else "N/A (End)"

        total_video_duration += max(0, v['duration'])
        total_size_bytes += v['size_bytes']
        total_chunks += v['chunk_count']

        # Highlight if pause to next is part of same group vs long break
        folder_display = v['folder'] if len(v['folder']) <= 33 else v['folder'][:30] + "..."

        print(f"{idx:<3} | {folder_display:<33} | {v['chunk_count']:<6} | {s_dt:<19} | {e_dt:<19} | {dur_str:<11} | {size_gb:<9.2f} | {pause_str:<14}")

    print(divider)

    # Output Section 2: Macro Interval Groups (if threshold > 0)
    if len(macro_intervals) > 1 and len(macro_intervals) != len(folder_videos):
        print(f"\nGrouped into {len(macro_intervals)} Macro Recording Intervals (Pause Threshold > {format_duration(gap_threshold_seconds)}):\n")
        m_header = f"{'Group':<6} | {'Folders Included':<35} | {'Start Time':<19} | {'End Time':<19} | {'Total Dur':<11} | {'Chunks':<6} | {'Pause to Next':<14}"
        m_divider = "-" * len(m_header)
        print(m_header)
        print(m_divider)

        for g_idx, group in enumerate(macro_intervals, 1):
            g_start = group[0]['start_time']
            g_end = group[-1]['end_time']
            g_dur = g_end - g_start
            g_chunks = sum(x['chunk_count'] for x in group)
            g_next_pause = group[-1]['next_pause']
            g_pause_str = format_duration(g_next_pause) if g_next_pause is not None else "N/A (End)"

            if len(group) == 1:
                f_summary = group[0]['folder']
            else:
                f_summary = f"{group[0]['folder']} ... {group[-1]['folder']} ({len(group)} folders)"

            if len(f_summary) > 35:
                f_summary = f_summary[:32] + "..."

            s_dt = datetime.fromtimestamp(g_start).strftime('%Y-%m-%d %H:%M:%S')
            e_dt = datetime.fromtimestamp(g_end).strftime('%Y-%m-%d %H:%M:%S')

            print(f"#{g_idx:<5} | {f_summary:<35} | {s_dt:<19} | {e_dt:<19} | {format_duration(g_dur):<11} | {g_chunks:<6} | {g_pause_str:<14}")

        print(m_divider)

    # Overall Summary Statistics
    first_overall_start = folder_videos[0]['start_time']
    last_overall_end = folder_videos[-1]['end_time']
    overall_span = last_overall_end - first_overall_start
    overall_pauses = overall_span - total_video_duration

    print("\nSummary Statistics:")
    print(f" - Total Video Subfolders:   {len(folder_videos)}")
    print(f" - Total Video Chunks (.MP4):{total_chunks:,}")
    print(f" - Total Video Storage Size: {total_size_bytes / (1024**3):.2f} GB")
    print(f" - Total Active Video Time:  {format_duration(total_video_duration)}")
    print(f" - Overall Date Range:       {datetime.fromtimestamp(first_overall_start).strftime('%Y-%m-%d %H:%M:%S')} to {datetime.fromtimestamp(last_overall_end).strftime('%Y-%m-%d %H:%M:%S')}")
    print(f" - Overall Timespan:         {format_duration(overall_span)}")
    print(f" - Total Inactive / Pauses:  {format_duration(overall_pauses)}")


def main():
    parser = argparse.ArgumentParser(description="Analyze video file intervals across subfolders using file modification times.")
    parser.add_argument(
        "dirpath",
        help="Path to root video folder"
    )
    parser.add_argument(
        "-g", "--gap",
        type=float,
        default=600.0,
        help="Pause threshold in seconds to group video sessions (default: 600.0s / 10 minutes)"
    )

    args = parser.parse_args()
    analyze_video_intervals(args.dirpath, args.gap)


if __name__ == "__main__":
    main()
