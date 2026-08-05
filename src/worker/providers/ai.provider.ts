import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ExtractionResult {
  customerName: string | null;
  carMake: string | null;
  carModel: string | null;
  carVariant: string | null;
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
      customerName: { type: 'string', description: 'Omit if not mentioned' },
      carMake: { type: 'string', description: 'e.g. Maruti, Hyundai. Omit if not mentioned' },
      carModel: { type: 'string', description: 'e.g. Swift, Creta. Omit if not mentioned' },
      carVariant: { type: 'string', description: 'e.g. VXI, SX(O). Omit if not mentioned' },
      productsDiscussed: {
        type: 'array',
        items: { type: 'string' },
        description: 'Products/services discussed, in the customer\'s or agent\'s own words',
      },
      customerRequirements: { type: 'string', description: 'Free-text summary of what the customer needs' },
      budget: { type: 'number', description: 'Only if a specific number was mentioned' },
      followUpRequired: { type: 'boolean' },
      followUpDate: { type: 'string', description: 'ISO 8601 date, only if a specific date was discussed' },
      summary: { type: 'string', description: '2-3 sentence summary of the call' },
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
      'mentioned, do not guess or infer beyond what the transcript actually states.',
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
    productsDiscussed: raw.productsDiscussed ?? [],
    customerRequirements: raw.customerRequirements ?? null,
    budget: raw.budget ?? null,
    followUpRequired: raw.followUpRequired ?? false,
    followUpDate: raw.followUpDate ?? null,
    summary: raw.summary ?? '',
    sentiment: raw.sentiment ?? 'needs_follow_up',
  };
}
