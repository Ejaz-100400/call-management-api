// This business operates in India (IST, UTC+5:30). Date-only strings like
// "2026-08-10" parse as UTC midnight, which is 5:30am IST -- so a naive
// `gte`/`lte` comparison against that value cuts off the first 5.5 hours of
// the "from" day and everything after 5:30am on the "to" day. These convert
// a plain YYYY-MM-DD into the actual IST calendar-day boundaries in UTC.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function startOfDayIST(dateStr: string): Date {
  return new Date(new Date(dateStr).getTime() - IST_OFFSET_MS);
}

/** Exclusive upper bound (start of the next IST day) -- use with `lt`, not `lte`. */
export function endOfDayIST(dateStr: string): Date {
  return new Date(new Date(dateStr).getTime() + 24 * 60 * 60 * 1000 - IST_OFFSET_MS);
}

/**
 * Exotel's own timestamp fields (CurrentTime, Created, StartTime, EndTime,
 * ...) are IST wall-clock strings like "2026-08-13 12:43:02" with no
 * timezone marker. `new Date(str)` interprets a timezone-less string using
 * the RUNNING PROCESS's own local timezone -- UTC on Render -- which
 * silently misreads "12:43:02 IST" as "12:43:02 UTC", storing a call time
 * 5.5 hours into the future; displaying that (correctly, in IST) then adds
 * another 5.5 hours on top, so a call from ~1pm IST showed as ~6:30pm IST
 * in the UI. This parses the components explicitly against the known IST
 * offset instead, so it's correct no matter what timezone the server
 * process happens to be running in.
 */
export function parseIstTimestamp(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return new Date(utcMs - IST_OFFSET_MS);
}
