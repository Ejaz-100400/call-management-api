import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ExtractedEntry {
  customerName: string | null;
  phoneNumber: string | null;
  businessCategory: 'car_glasses' | 'car_modifications' | 'unknown' | null;
  callDate: string | null;
  employeeName: string | null;
  carMake: string | null;
  carModel: string | null;
  carVariant: string | null;
  location: string | null;
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
      pageDate: {
        type: 'string',
        description:
          'Check this FIRST, before reading individual entries: is there a date written once for the ' +
          'whole page rather than separately per entry (most commonly in the top-left corner)? If so, put ' +
          'it here as YYYY-MM-DD, ignoring any time portion written alongside it. If the date is numeric ' +
          'and the day/month order is ambiguous (e.g. "12/03/2024"), assume DD/MM/YYYY (day first) -- this ' +
          "is an Indian business and notes follow Indian date conventions. If there is genuinely no " +
          'page-level date, return an empty string here and rely on any per-entry dates instead.',
      },
      entries: {
        type: 'array',
        description: 'One item per distinct customer/call entry visible in the photo.',
        items: {
          type: 'object',
          properties: {
            customerName: { type: 'string', description: 'Omit if not legible/present' },
            phoneNumber: { type: 'string', description: 'Omit if not legible/present' },
            businessCategory: { type: 'string', enum: ['car_glasses', 'car_modifications', 'unknown'], description: 'Best guess from context (products/services mentioned). Use "unknown" if genuinely unclear -- do not omit.' },
            callDate: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD) for this specific entry, only if a date is actually written next to it (assume DD/MM/YYYY if ambiguous, per Indian convention). Omit otherwise -- do not guess a date (a page-level date, if any, is captured separately via pageDate).' },
            employeeName: { type: 'string', description: 'The staff member who took the call/note, if named. Omit if not present.' },
            carMake: {
              type: 'string',
              description:
                'The vehicle manufacturer/brand. If only a model name is written (e.g. "Seltos", "Swift", ' +
                '"Creta"), infer the make from that model using your general knowledge of car brands ' +
                '(e.g. Seltos -> Kia, Swift -> Maruti Suzuki, Creta -> Hyundai) -- this is applying general ' +
                'knowledge, not inventing information, so it is fine even though the make itself was not ' +
                'literally written. Omit only if the model is not recognizable at all.',
            },
            carModel: { type: 'string', description: 'The vehicle model as written (or read from context), separate from the make.' },
            carVariant: { type: 'string' },
            location: {
              type: 'string',
              description:
                'The area, shop, or place associated with this entry, if a ledger column or note gives one ' +
                '(e.g. a neighborhood/city name, or a partner shop like "SP shop" or "Ambattur"). This is a ' +
                'distinct field from customerRequirements -- do not fold it into that field. Omit if no ' +
                'location is written for this entry.',
            },
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
    required: ['pageDate', 'entries'],
  },
};

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedImageType(mimeType: string): mimeType is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mimeType);
}

async function requestExtraction(imageBuffer: Buffer, mediaType: SupportedMediaType) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    system:
      'You read photos of handwritten business notes (including cursive) for an automotive business and ' +
      'extract structured data precisely from what is actually written. Never guess or invent a fact about ' +
      "a specific customer or call that you cannot actually read -- omit that field instead. It's expected " +
      'and fine for some fields to be missing. The one exception is general world knowledge (e.g. which ' +
      'company makes a given car model) -- applying that to fill in a field is not guessing, and you should ' +
      'do it when it lets you complete a field the note only partially spelled out.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
          {
            type: 'text',
            text:
              'Extract every customer/call entry visible in this photo of handwritten notes. First check ' +
              'whether a single date is written once for the whole page (often top-left) rather than per ' +
              'entry, and record it as pageDate -- then extract each entry.',
          },
        ],
      },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: 'record_handwritten_entries' },
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a structured extraction for this image');

  const input = toolUse.input as { pageDate?: string; entries?: unknown };
  if (!Array.isArray(input.entries)) throw new Error('Malformed extraction response (entries was not a list)');
  return input as { pageDate?: string; entries: Partial<ExtractedEntry>[] };
}

export async function extractHandwrittenEntries(imageBuffer: Buffer, mediaType: SupportedMediaType): Promise<ExtractedEntry[]> {
  // Structured extraction over a large schema occasionally comes back malformed
  // (sampling variance, not a code bug) -- one retry clears it in practice.
  let input: { pageDate?: string; entries: Partial<ExtractedEntry>[] };
  try {
    input = await requestExtraction(imageBuffer, mediaType);
  } catch {
    input = await requestExtraction(imageBuffer, mediaType);
  }

  const raw = input.entries;
  return raw.map((e) => ({
    customerName: e.customerName ?? null,
    phoneNumber: e.phoneNumber ?? null,
    businessCategory: e.businessCategory ?? null,
    // A single date written once for the whole page (e.g. top-left corner) applies to every entry on it.
    // pageDate is a required schema field but comes back as "" when genuinely absent from the photo.
    callDate: input.pageDate || e.callDate || null,
    employeeName: e.employeeName ?? null,
    carMake: e.carMake ?? null,
    carModel: e.carModel ?? null,
    carVariant: e.carVariant ?? null,
    location: e.location ?? null,
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
