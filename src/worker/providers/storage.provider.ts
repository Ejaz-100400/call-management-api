import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET!;

/** Fetches a call recording from the telephony provider's (usually temporary) URL. */
export async function fetchFromProviderUrl(url: string): Promise<Buffer> {
  // TODO: some providers require an Authorization header on their recording
  // URLs (Exotel does, for example) -- add that here once you're integrating
  // a real provider. Something like:
  //   const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.TELEPHONY_API_KEY}` } });
  const res = await fetch(url);
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
