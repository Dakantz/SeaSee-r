/**
 * Formats a duration in seconds into hours, minutes, and seconds (e.g. "2h 15m 58s", "5m 30s", "45s").
 */
export const formatDurationSeconds = (totalSeconds: number): string => {
  if (totalSeconds < 0 || isNaN(totalSeconds)) return '-';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

/**
 * Calculates and formats the duration between start and end timestamps (or current time if active).
 */
export const calculateDuration = (
  startStr?: string | null,
  endStr?: string | null,
  nowMs: number = Date.now()
): string => {
  if (!startStr) return '-';
  const start = new Date(startStr).getTime();
  if (isNaN(start)) return '-';

  const end = endStr ? new Date(endStr).getTime() : nowMs;
  if (isNaN(end)) return '-';

  const diffMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(diffMs / 1000);
  return formatDurationSeconds(totalSeconds);
};
