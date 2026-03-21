/**
 * Formats speed in meters per second (m/s) to pace (min:sec per km).
 * @param speedMps Speed in m/s
 * @returns Formatted pace string like "5:30" or "–" if speed is invalid.
 */
export function formatPace(speedMps: number | null) {
  if (!speedMps || speedMps <= 0) return "–";
  const kmh = speedMps * 3.6;
  const minutesPerKm = 60 / kmh;
  const mins = Math.floor(minutesPerKm);
  const secs = Math.round((minutesPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
