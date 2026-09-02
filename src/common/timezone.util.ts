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

/** The IST wall-clock hour (0-23) a given instant falls on. */
export function istHour(date: Date): number {
  return new Date(date.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** Minutes since IST midnight (0-1439) a given instant falls on -- e.g. 20:30 IST = 1230. */
export function istMinuteOfDay(date: Date): number {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Today's IST calendar date as "YYYY-MM-DD" -- for comparing against a date-only column like Sale.saleDate. */
export function todayIST(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Bounds for filtering a date-only (`@db.Date`) column -- Sale.saleDate,
 * InPersonEnquiry.enquiryDate. Those columns are written as plain
 * UTC-midnight dates (see `new Date(dto.saleDate)` at the call sites that
 * create them), NOT IST-shifted instants. Filtering them with
 * startOfDayIST/endOfDayIST is a bug: those shift the boundary by -5.5h, and
 * Postgres then truncates that shifted instant to the wrong UTC calendar day
 * when comparing against the DATE column -- silently matching the PREVIOUS
 * day's rows instead of the intended day. Use `gte: dateOnly(dateFrom), lte:
 * dateOnly(dateTo)` for these columns instead -- inclusive on both ends
 * since there's no time-of-day component to exceed.
 */
export function dateOnly(dateStr: string): Date {
  return new Date(dateStr);
}

/**
 * The inverse of parseIstTimestamp: renders a real instant as the IST
 * wall-clock string Exotel's own APIs expect (e.g. as a DateCreated filter
 * value), "YYYY-MM-DD HH:MM:SS". Formatting with plain `toISOString()`
 * instead -- which renders the UTC wall-clock -- sends a string that's off
 * by 5.5 hours, so a query window built around "now" silently only starts
 * matching once the UTC clock catches up to what was actually meant in IST.
 */
export function formatIstTimestamp(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}
