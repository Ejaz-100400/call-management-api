import { createClient } from '@deepgram/sdk';

const deepgram = createClient(process.env.DEEPGRAM_API_KEY ?? '');

export interface TranscriptionResult {
  rawText: string;
  language: string | null;
  diarized: unknown;
}

/**
 * Batch (pre-recorded) transcription with diarization -- separates employee
 * vs. customer speech, which meaningfully improves what the AI extraction
 * step can pull out later. Check the Deepgram SDK's current docs if this
 * response shape has changed since this was written.
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<TranscriptionResult> {
  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, {
    model: 'nova-3',
    smart_format: true,
    diarize: true,
    detect_language: true,
  });

  if (error) {
    throw new Error(`Deepgram transcription failed: ${error.message}`);
  }

  const channel = result.results.channels[0];
  const alternative = channel?.alternatives[0];

  if (!alternative) {
    throw new Error('Deepgram returned no transcription alternatives');
  }

  return {
    rawText: alternative.transcript,
    language: (channel as unknown as { detected_language?: string })?.detected_language ?? null,
    diarized: alternative.words ?? null,
  };
}
