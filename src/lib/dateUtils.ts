/**
 * Returns a human-readable relative time string.
 * e.g. "3 days", "2 hours", "5 minutes"
 */
export function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return "a few seconds";
  if (diffSeconds < 3600) {
    const m = Math.floor(diffSeconds / 60);
    return `${m} minute${m !== 1 ? "s" : ""}`;
  }
  if (diffSeconds < 86400) {
    const h = Math.floor(diffSeconds / 3600);
    return `${h} hour${h !== 1 ? "s" : ""}`;
  }
  if (diffSeconds < 2592000) {
    const d = Math.floor(diffSeconds / 86400);
    return `${d} day${d !== 1 ? "s" : ""}`;
  }
  if (diffSeconds < 31536000) {
    const mo = Math.floor(diffSeconds / 2592000);
    return `${mo} month${mo !== 1 ? "s" : ""}`;
  }
  const y = Math.floor(diffSeconds / 31536000);
  return `${y} year${y !== 1 ? "s" : ""}`;
}

/**
 * Formats a date to a locale-friendly short string.
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
