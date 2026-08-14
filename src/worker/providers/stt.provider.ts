import { createClient } from '@deepgram/sdk';

const deepgram = createClient(process.env.DEEPGRAM_API_KEY ?? '');

export interface TranscriptionResult {
  rawText: string;
  language: string | null;
  diarized: unknown;
}

// Most customers speak Tamil with English car-part/model terms mixed in
// (a smaller share call in Hindi). Deepgram's detect_language can't tell
// Tamil apart from Hindi -- verified directly against a real Tamil call,
// where auto-detect misidentified it as Hindi and produced a garbled
// transcript, while forcing language: 'ta' transcribed it cleanly (Tamil
// isn't in Nova-3's code-switching set, but the monolingual Tamil model
// handles embedded English terms fine). Hardcoded rather than
// auto-detected since there's no reliable signal to distinguish the two
// languages for this business's calls specifically.
const PRIMARY_LANGUAGE = 'ta';

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
    language: PRIMARY_LANGUAGE,
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
    // Deepgram only populates detected_language when detect_language is
    // set, which we don't use here since the language is forced above.
    language: PRIMARY_LANGUAGE,
    diarized: alternative.words ?? null,
  };
}
