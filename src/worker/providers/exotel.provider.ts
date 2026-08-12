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
    startTime: call.StartTime ? new Date(call.StartTime as string) : null,
  };
}

/** Basic-auth header Exotel requires to actually download a recording file (its URLs aren't publicly fetchable). */
export function exotelRecordingAuthHeader(): Record<string, string> {
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  if (!apiKey || !apiToken) return {};
  const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
  return { Authorization: `Basic ${auth}` };
}
