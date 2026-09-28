/**
 * Utility functions for date and time formatting.
 * Enforces 24-hour time model without AM/PM and provides date-aware formats.
 */

/**
 * Formats an ISO date string into a 24-hour date-aware string: "YYYY-MM-DD HH:mm:ss".
 * Eliminates any AM/PM display and uses zero-padded 24-hour time.
 */
export const formatDateTime = (dateStr?: string | null, fallback = '-'): string => {
  if (!dateStr) return fallback;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return fallback;

  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/**
 * Formats an ISO date string into a 24-hour time string: "HH:mm:ss".
 * Guarantees 24-hour format without AM/PM regardless of browser locale.
 */
export const formatTime24 = (dateStr?: string | null, fallback = '-'): string => {
  if (!dateStr) return fallback;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return fallback;

  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${hours}:${minutes}:${seconds}`;
};

/**
 * Alias for formatTime24 for drop-in backward compatibility.
 */
export const formatTime = formatTime24;
