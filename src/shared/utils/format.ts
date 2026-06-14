/**
 * Formats a duration in seconds into a human-readable string.
 *
 * Examples:
 *   45   → "0:45"
 *   90   → "1:30"
 *   3661 → "1:01:01"
 */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)

  const paddedSeconds = String(seconds).padStart(2, '0')

  if (hours > 0) {
    const paddedMinutes = String(minutes).padStart(2, '0')
    return `${String(hours)}:${paddedMinutes}:${paddedSeconds}`
  }

  return `${String(minutes)}:${paddedSeconds}`
}
