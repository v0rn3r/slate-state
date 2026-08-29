// One canonical notion of "today", shared by the server and both clients.
// Day boundary is DAY_RESET_HOUR local time in TZ_OFFSET_MINUTES, not midnight UTC.
export const TZ_OFFSET_MINUTES = 330; // IST
export const DAY_RESET_HOUR = 4;

export function dayKey(now = new Date()) {
  const shifted = new Date(
    now.getTime() + TZ_OFFSET_MINUTES * 60000 - DAY_RESET_HOUR * 3600000
  );
  return shifted.toISOString().slice(0, 10);
}
