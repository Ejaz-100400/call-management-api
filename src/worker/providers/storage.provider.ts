import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { exotelRecordingAuthHeader } from './exotel.provider';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET!;

/**
 * Fetches a call recording from the telephony provider's (usually temporary)
 * URL. Exotel's recording URLs aren't publicly fetchable -- they require the
 * same Basic Auth (API Key/Token) as the rest of Exotel's API. Sending that
 * header is harmless for providers that don't need it (a plain 404/200 GET
 * ignores unrecognized auth), so this doesn't need to branch per-provider.
 */
export async function fetchFromProviderUrl(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: exotelRecordingAuthHeader() });
  if (!res.ok) throw new Error(`Failed to fetch recording from provider: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Fetches a recording already uploaded to object storage (used by manual reprocess). */
export async function fetchFromStorage(storageKey: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Uploads a recording to permanent object storage, returns the storage key. */
export async function uploadRecording(callId: string, audioBuffer: Buffer): Promise<string> {
  const key = `recordings/${callId}.mp3`;
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: audioBuffer, ContentType: 'audio/mpeg' }),
  );
  return key;
}

/** Signed, time-limited URL for playing a stored recording back in the dashboard. */
export async function getSignedRecordingUrl(storageKey: string, expiresInSeconds = 600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: storageKey });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
