import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ExtractionResult {
  customerName: string | null;
  carMake: string | null;
  carModel: string | null;
  carVariant: string | null;
  location: string | null;
  productsDiscussed: string[];
  customerRequirements: string | null;
  budget: number | null;
  followUpRequired: boolean;
  followUpDate: string | null; // ISO date, e.g. "2026-08-10"
  summary: string;
  sentiment: 'interested' | 'not_interested' | 'needs_follow_up';
}

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'record_call_extraction',
  description:
    'Records structured information extracted from a customer call transcript for an ' +
    'automotive business (car glass repair/replacement or vehicle modifications).',
  input_schema: {
    type: 'object',
    properties: {
      customerName: {
        type: 'string',
        description:
          'Omit if not mentioned. If spoken/written in Tamil, Hindi, or another script, transliterate it ' +
          'into English/Latin script (e.g. "Ramesh", not the Tamil or Devanagari spelling) -- this is ' +
          'transliteration of the same name, not translation, so it stays accurate.',
      },
      carMake: {
        type: 'string',
        description:
          'e.g. Maruti, Hyundai. Correct misheard/misspelled brand names to the real manufacturer\'s ' +
          'official spelling and capitalization (e.g. "Maruti Suzuki" not "maruti suzuki" or "maruthi"). ' +
          'Omit if not mentioned.',
      },
      carModel: {
        type: 'string',
        description:
          'e.g. Swift, Creta, EcoSport, 320d -- the model ONLY, never prefixed with the make (put "Swift", ' +
          'not "Maruti Swift"; the make already has its own field). Correct misheard/misspelled model names ' +
          'to the real model\'s official spelling and capitalization, including the manufacturer\'s own ' +
          'unusual casing (e.g. "EcoSport" not "Ecosport", "320d" stays lowercase "d" for BMW\'s diesel ' +
          'naming). Omit if not mentioned.',
      },
      carVariant: { type: 'string', description: 'e.g. VXI, SX(O). Omit if not mentioned' },
      location: {
        type: 'string',
        description: 'Customer\'s city/area/locality, only if they stated one. Omit if not mentioned.',
      },
      productsDiscussed: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Products/services discussed. Capture the actual meaning in the customer\'s or agent\'s own ' +
          'words, written in English regardless of what language the call was conducted in.',
      },
      customerRequirements: {
        type: 'string',
        description: 'Free-text summary of what the customer needs, written in English regardless of the call\'s language.',
      },
      budget: { type: 'number', description: 'Only if a specific number was mentioned' },
      followUpRequired: { type: 'boolean' },
      followUpDate: { type: 'string', description: 'ISO 8601 date, only if a specific date was discussed' },
      summary: { type: 'string', description: '2-3 sentence summary of the call, written in English regardless of the call\'s language.' },
      sentiment: { type: 'string', enum: ['interested', 'not_interested', 'needs_follow_up'] },
    },
    required: ['productsDiscussed', 'followUpRequired', 'summary', 'sentiment'],
  },
};

export async function extractCallInfo(
  transcript: string,
  meta: { businessCategory: string; callDate: Date },
): Promise<ExtractionResult> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    system:
      'You analyze customer service call transcripts for an automotive business. Extract the ' +
      'fields precisely from what was actually said in the transcript -- omit anything not ' +
      'mentioned, do not guess or infer beyond what the transcript actually states. Most calls ' +
      'are conducted in Tamil, Hindi, or a mix of languages rather than English -- write every ' +
      'free-text field (customerRequirements, productsDiscussed, summary) in English regardless ' +
      'of what language the call itself was in. This means translating the meaning accurately, ' +
      "not guessing content that wasn't actually said. Customer names should be transliterated " +
      'into English/Latin script rather than translated (a name has no English equivalent, but it ' +
      'can be written in Latin letters).',
    messages: [
      {
        role: 'user',
        content:
          `Business category dialed: ${meta.businessCategory}\n` +
          `Call date: ${meta.callDate.toISOString()}\n\n` +
          `Transcript:\n${transcript}`,
      },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: 'record_call_extraction' },
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error('Claude did not return a structured extraction');
  }

  const raw = toolUse.input as Partial<ExtractionResult>;
  return {
    customerName: raw.customerName ?? null,
    carMake: raw.carMake ?? null,
    carModel: raw.carModel ?? null,
    carVariant: raw.carVariant ?? null,
    location: raw.location ?? null,
    productsDiscussed: raw.productsDiscussed ?? [],
    customerRequirements: raw.customerRequirements ?? null,
    budget: raw.budget ?? null,
    followUpRequired: raw.followUpRequired ?? false,
    followUpDate: raw.followUpDate ?? null,
    summary: raw.summary ?? '',
    sentiment: raw.sentiment ?? 'needs_follow_up',
  };
}
