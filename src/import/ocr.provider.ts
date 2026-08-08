import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ExtractedEntry {
  customerName: string | null;
  phoneNumber: string | null;
  businessCategory: 'car_glasses' | 'car_modifications' | null;
  callDate: string | null;
  employeeName: string | null;
  carMake: string | null;
  carModel: string | null;
  carVariant: string | null;
  productsDiscussed: string[];
  customerRequirements: string | null;
  budget: number | null;
  followUpRequired: boolean;
  followUpDate: string | null;
  summary: string | null;
  sentiment: 'interested' | 'not_interested' | 'needs_follow_up' | null;
  /** Best-effort verbatim transcription of this entry's handwritten text, so a reviewer can sanity-check the structured fields against the original note. */
  rawNoteText: string;
}

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'record_handwritten_entries',
  description:
    'Records every distinct customer/call entry found in a photo of handwritten business notes for an ' +
    'automotive business (car glass repair/replacement or vehicle modifications). A photo may contain a ' +
    'single note (one entry) or a ledger-style page with many rows (many entries) -- record however many ' +
    'are actually present.',
  input_schema: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        description: 'One item per distinct customer/call entry visible in the photo.',
        items: {
          type: 'object',
          properties: {
            customerName: { type: 'string', description: 'Omit if not legible/present' },
            phoneNumber: { type: 'string', description: 'Omit if not legible/present' },
            businessCategory: { type: 'string', enum: ['car_glasses', 'car_modifications'], description: 'Best guess from context (products/services mentioned). Omit if genuinely unclear.' },
            callDate: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD), only if a date is actually written. Omit otherwise -- do not guess a date.' },
            employeeName: { type: 'string', description: 'The staff member who took the call/note, if named. Omit if not present.' },
            carMake: { type: 'string' },
            carModel: { type: 'string' },
            carVariant: { type: 'string' },
            productsDiscussed: { type: 'array', items: { type: 'string' }, description: 'Products/services mentioned, in the note\'s own words' },
            customerRequirements: { type: 'string', description: 'Free-text summary of what the customer needs' },
            budget: { type: 'number', description: 'Only if a specific number is written' },
            followUpRequired: { type: 'boolean' },
            followUpDate: { type: 'string', description: 'ISO 8601 date, only if a specific follow-up date is written' },
            summary: { type: 'string', description: '1-2 sentence summary of this entry' },
            sentiment: { type: 'string', enum: ['interested', 'not_interested', 'needs_follow_up'] },
            rawNoteText: {
              type: 'string',
              description:
                'Your best-effort verbatim transcription of the handwritten text for just this entry, ' +
                'including anything you were unsure about -- this lets a human cross-check your reading ' +
                'against the original note. Never leave this empty; if truly illegible, say so.',
            },
          },
          required: ['rawNoteText'],
        },
      },
    },
    required: ['entries'],
  },
};

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedImageType(mimeType: string): mimeType is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mimeType);
}

export async function extractHandwrittenEntries(imageBuffer: Buffer, mediaType: SupportedMediaType): Promise<ExtractedEntry[]> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    system:
      'You read photos of handwritten business notes (including cursive) for an automotive business and ' +
      'extract structured data precisely from what is actually written. Never guess or invent a value you ' +
      "cannot actually read -- omit that field instead. It's expected and fine for some fields to be missing.",
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
          {
            type: 'text',
            text: 'Extract every customer/call entry visible in this photo of handwritten notes.',
          },
        ],
      },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: 'record_handwritten_entries' },
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a structured extraction for this image');

  const raw = (toolUse.input as { entries?: Partial<ExtractedEntry>[] }).entries ?? [];
  return raw.map((e) => ({
    customerName: e.customerName ?? null,
    phoneNumber: e.phoneNumber ?? null,
    businessCategory: e.businessCategory ?? null,
    callDate: e.callDate ?? null,
    employeeName: e.employeeName ?? null,
    carMake: e.carMake ?? null,
    carModel: e.carModel ?? null,
    carVariant: e.carVariant ?? null,
    productsDiscussed: e.productsDiscussed ?? [],
    customerRequirements: e.customerRequirements ?? null,
    budget: e.budget ?? null,
    followUpRequired: e.followUpRequired ?? false,
    followUpDate: e.followUpDate ?? null,
    summary: e.summary ?? null,
    sentiment: e.sentiment ?? null,
    rawNoteText: e.rawNoteText ?? '',
  }));
}
