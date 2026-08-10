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
