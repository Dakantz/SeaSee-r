/**
 * Utility functions for client-side video inspection, duration extraction,
 * and timestamp calculation.
 */

/**
 * Toggle whether video timestamp calculation and upload debugging logs are printed to the browser console.
 * Default is false.
 */
export const DEBUG_VIDEO_TIMESTAMPS = false;

export interface VideoTimeMetadata {
  file: File;
  modifiedDateTime: Date;
  duration: number; // in seconds
  video_start_at: string; // ISO 8601 string
  video_stop_at: string; // ISO 8601 string
}

/**
 * Extracts the media duration of a video File in seconds using a temporary HTML5 video element.
 * Resolves to 0 if metadata cannot be parsed or decoded by the browser.
 */
export const getVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      video.remove();
    };

    video.onloadedmetadata = () => {
      const dur = video.duration;
      cleanup();
      resolve(isNaN(dur) || !isFinite(dur) || dur < 0 ? 0 : dur);
    };

    video.onerror = () => {
      cleanup();
      resolve(0);
    };
  });
};

/**
 * Calculates start and stop timestamps for a list of video files according to the rules:
 * 1. Sort all video files by modifieddatetime (ascending).
 * 2. video_stop_at: In the browser, read the video file and extract the modifieddatetime.
 * 3. video_start_at: In the browser, read the duration and calculate the starttime
 *    by removing the duration from the video_stop_at. (Ensure that the video_start_at
 *    is at a minimum the same as the previous video's video_stop_at).
 */
export const calculateVideoTimestamps = async (
  files: File[]
): Promise<VideoTimeMetadata[]> => {
  if (!files || files.length === 0) {
    return [];
  }

  // 1. Sort all video files by modifieddatetime (ascending)
  const sortedFiles = [...files].sort((a, b) => {
    const timeA = a.lastModified || 0;
    const timeB = b.lastModified || 0;
    return timeA - timeB;
  });

  // Extract durations asynchronously for all files
  const fileWithDurations = await Promise.all(
    sortedFiles.map(async (file) => {
      const duration = await getVideoDuration(file);
      return { file, duration };
    })
  );

  const results: VideoTimeMetadata[] = [];
  let prevVideoStopMs: number | null = null;

  for (const { file, duration } of fileWithDurations) {
    const fileLastModified = file.lastModified || Date.now();
    const modifiedDateTime = new Date(fileLastModified);
    const fileStopMs = modifiedDateTime.getTime();
    const durationMs = Math.round(duration * 1000);

    // Calculate start time by removing duration from video_stop_at
    const calculatedStartMs = fileStopMs - durationMs;

    // Ensure that the video_start_at is at a minimum the same as the previous video's video_stop_at
    const startMs =
      prevVideoStopMs !== null
        ? Math.max(calculatedStartMs, prevVideoStopMs)
        : calculatedStartMs;

    // Ensure video_stop_at is at least startMs + durationMs (so duration is preserved if startMs was bumped up)
    const stopMs = Math.max(fileStopMs, startMs + durationMs);

    const video_start_at = new Date(startMs).toISOString();
    const video_stop_at = new Date(stopMs).toISOString();

    if (DEBUG_VIDEO_TIMESTAMPS) {
      console.log(`[videoUtils] Video "${file.name}":`, {
        lastModifiedMs: fileLastModified,
        lastModifiedISO: modifiedDateTime.toISOString(),
        lastModifiedLocal: modifiedDateTime.toString(),
        durationSec: duration,
        calculatedStartISO: new Date(calculatedStartMs).toISOString(),
        prevVideoStopISO: prevVideoStopMs !== null ? new Date(prevVideoStopMs).toISOString() : null,
        final_video_start_at: video_start_at,
        final_video_stop_at: video_stop_at,
      });
    }

    prevVideoStopMs = stopMs;

    results.push({
      file,
      modifiedDateTime,
      duration,
      video_start_at,
      video_stop_at,
    });
  }

  if (DEBUG_VIDEO_TIMESTAMPS) {
    console.groupCollapsed?.('[videoUtils] Video Timestamps Summary');
    console.table(
      results.map((r) => ({
        fileName: r.file.name,
        lastModifiedMs: r.file.lastModified,
        lastModifiedISO: r.modifiedDateTime.toISOString(),
        durationSec: `${r.duration.toFixed(2)}s`,
        video_start_at: r.video_start_at,
        video_stop_at: r.video_stop_at,
      }))
    );
    console.groupEnd?.();
  }

  return results;
};
