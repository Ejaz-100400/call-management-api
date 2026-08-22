import { parseIstTimestamp } from '../../common/timezone.util';

/**
 * Exotel's Passthru applet only sends {CallSid, CallFrom, CallTo, Direction,
 * CurrentTime, DialWhomNumber} to the webhook -- notably NOT the recording
 * URL, duration, or final status (confirmed against Exotel's own Passthru
 * Applet Guide). Those only come from a separate Call Details lookup, made
 * after the fact using the CallSid. The recording is also not always ready
 * the instant the call ends, so a "not ready yet" throw here is expected to
 * happen sometimes -- the caller (process-call.ts) relies on BullMQ's
 * existing retry/backoff to pick it up a few seconds later rather than
 * polling in a loop itself.
 */
export interface ExotelCallDetails {
  recordingUrl: string | null;
  durationSeconds: number;
  status: string;
  startTime: Date | null;
}

export async function fetchExotelCallDetails(callSid: string): Promise<ExotelCallDetails> {
  const accountSid = process.env.EXOTEL_ACCOUNT_SID;
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  if (!accountSid || !apiKey || !apiToken) {
    throw new Error('EXOTEL_ACCOUNT_SID/EXOTEL_API_KEY/EXOTEL_API_TOKEN must be set to fetch call details');
  }

  const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
  const res = await fetch(`https://api.exotel.com/v1/Accounts/${accountSid}/Calls/${callSid}.json`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    throw new Error(`Exotel call details lookup failed: ${res.status}`);
  }

  const body = (await res.json()) as { Call?: Record<string, unknown> };
  const call = body.Call ?? {};

  return {
    recordingUrl: (call.RecordingUrl as string) || null,
    durationSeconds: call.Duration != null ? Number(call.Duration) : 0,
    status: (call.Status as string) ?? 'unknown',
    // StartTime is an IST wall-clock string like everything else Exotel
    // sends -- see parseIstTimestamp's comment for why this can't be a bare
    // `new Date(...)`.
    startTime: call.StartTime ? parseIstTimestamp(call.StartTime as string) : null,
  };
}

// Exotel's own dashboard shows a friendly "Outcome" for calls that never
// connected (e.g. "Client hung-up before connecting to any user") -- these
// are the raw Status values behind that, translated into the same plain-
// language staff would recognize from that dashboard. A status not listed
// here either hasn't finished yet (still worth retrying) or is genuinely
// unrecognized, so it falls through to a generic label rather than guessing.
const TERMINAL_NO_CONNECT_REASONS: Record<string, string> = {
  'no-answer': 'No answer — nobody picked up',
  busy: 'Line busy',
  failed: 'Call failed to connect',
  canceled: 'Call canceled before connecting',
};

/**
 * True only for a status Exotel will never attach a recording to -- the
 * call is done, and it never connected. Anything else (completed, ringing,
 * in-progress, or an unrecognized value) is treated as "might still get a
 * recording shortly" and left to the caller's retry loop instead.
 */
export function isTerminalNoConnectStatus(status: string): boolean {
  return status in TERMINAL_NO_CONNECT_REASONS;
}

/** Human-readable reason for a terminal no-connect status -- only meaningful when isTerminalNoConnectStatus(status) is true. */
export function describeNoConnectReason(status: string): string {
  return TERMINAL_NO_CONNECT_REASONS[status] ?? 'Call did not connect';
}

/**
 * Human-readable reason once retries are exhausted for a call that isn't a
 * known terminal no-connect status. Exotel's "completed" here describes the
 * overall call FLOW finishing -- e.g. the IVR ran out and hung up, or the
 * customer gave up waiting -- not that a human ever picked up on our end;
 * treating it as "the call connected" is wrong more often than right.
 * durationSeconds is the actual signal: a real conversation leaves some
 * measurable talk time, so 0 (or near it) means nobody actually answered
 * regardless of what the high-level status says.
 */
export function describeStillNoRecordingReason(status: string, durationSeconds: number): string {
  if (durationSeconds < 3) {
    return status === 'ringing' ? 'No answer — call kept ringing' : 'No answer — nobody picked up';
  }
  if (status === 'completed') return 'Call connected — recording unavailable';
  return `Call ended without a recording (status: ${status})`;
}

/** Basic-auth header Exotel requires to actually download a recording file (its URLs aren't publicly fetchable). */
export function exotelRecordingAuthHeader(): Record<string, string> {
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  if (!apiKey || !apiToken) return {};
  const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
  return { Authorization: `Basic ${auth}` };
}
