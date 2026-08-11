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
          'The date written at the very top of the page, before the first entry/row (most commonly the ' +
          'top-left corner), if there is one. Put it here as YYYY-MM-DD, ignoring any time portion written ' +
          'alongside it. If the date is numeric and the day/month order is ambiguous (e.g. "12/03/2024"), ' +
          'assume DD/MM/YYYY (day first) -- this is an Indian business and notes follow Indian date ' +
          'conventions. If there is genuinely no date at the top of the page, return an empty string. Note: ' +
          'a page can contain MULTIPLE date sections -- a new date written partway down the left margin ' +
          'starts a new section and applies to the rows below it. This field is only for the date at the ' +
          'very top; per-entry callDate (below) handles the rest.',
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
            callDate: {
              type: 'string',
              description:
                'ISO 8601 date (YYYY-MM-DD) that applies to THIS row. Ledger pages typically write a date ' +
                'once at the left margin (top of the page, or partway down before a new block of rows) ' +
                'rather than next to every single row -- that date carries forward and applies to this row ' +
                "and every row below it, until a new date appears at the left margin. To fill this in: find " +
                'the closest such date marker at or above this row (reading top to bottom) and use it, even ' +
                "if it's several rows above and not adjacent to this specific entry. If a date IS written " +
                'directly next to this row, that takes precedence over any carried-forward date. Assume ' +
                'DD/MM/YYYY if the day/month order is ambiguous (Indian convention). Only omit this if there ' +
                'is truly no date marker anywhere at or above this row on the page.',
            },
            employeeName: { type: 'string', description: 'The staff member who took the call/note, if named. Omit if not present.' },
            carMake: {
              type: 'string',
              description:
                'The vehicle manufacturer/brand. If only a model name is written (e.g. "Seltos", "Swift", ' +
                '"Creta"), infer the make from that model using your general knowledge of car brands ' +
                '(e.g. Seltos -> Kia, Swift -> Maruti Suzuki, Creta -> Hyundai) -- this is applying general ' +
                'knowledge, not inventing information, so it is fine even though the make itself was not ' +
                'literally written. Correct illegible/misspelled handwriting to the real manufacturer\'s ' +
                'official spelling and capitalization. Omit only if the model is not recognizable at all.',
            },
            carModel: {
              type: 'string',
              description:
                'The vehicle model ONLY, read from the handwriting or inferred from context -- never prefixed ' +
                'with the make (write "Swift", not "Maruti Swift"; the make already has its own field). ' +
                'Correct illegible/misspelled handwriting to the real model\'s official spelling and ' +
                'capitalization, including the manufacturer\'s own unusual casing (e.g. "EcoSport" not ' +
                '"Ecosport", "320d" stays lowercase "d" for BMW\'s diesel naming).',
            },
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

/**
 * Backstop for carMake when Claude's own inference is inconsistent across a
 * large batch -- deterministic lookup of common India-market model names to
 * their manufacturer, checked as a substring against the extracted carModel.
 * Sorted longest-keyword-first so "grand i10" wins over "i10", etc.
 */
const CAR_MODEL_TO_MAKE: Array<[string, string]> = [
  // Maruti Suzuki
  ['wagon r', 'Maruti Suzuki'], ['wagonr', 'Maruti Suzuki'], ['swift dzire', 'Maruti Suzuki'],
  ['grand vitara', 'Maruti Suzuki'], ['vitara brezza', 'Maruti Suzuki'], ['s-presso', 'Maruti Suzuki'],
  ['spresso', 'Maruti Suzuki'], ['zen estilo', 'Maruti Suzuki'], ['swift', 'Maruti Suzuki'], ['dzire', 'Maruti Suzuki'],
  ['baleno', 'Maruti Suzuki'], ['alto', 'Maruti Suzuki'], ['celerio', 'Maruti Suzuki'], ['ertiga', 'Maruti Suzuki'],
  ['ciaz', 'Maruti Suzuki'], ['ignis', 'Maruti Suzuki'], ['eeco', 'Maruti Suzuki'], ['omni', 'Maruti Suzuki'],
  ['gypsy', 'Maruti Suzuki'], ['xl6', 'Maruti Suzuki'], ['fronx', 'Maruti Suzuki'], ['jimny', 'Maruti Suzuki'],
  ['brezza', 'Maruti Suzuki'], ['ritz', 'Maruti Suzuki'], ['esteem', 'Maruti Suzuki'], ['a-star', 'Maruti Suzuki'],
  // Hyundai
  ['grand i10', 'Hyundai'], ['elite i20', 'Hyundai'], ['i10', 'Hyundai'], ['i20', 'Hyundai'], ['verna', 'Hyundai'],
  ['creta', 'Hyundai'], ['venue', 'Hyundai'], ['santro', 'Hyundai'], ['aura', 'Hyundai'], ['xcent', 'Hyundai'],
  ['eon', 'Hyundai'], ['tucson', 'Hyundai'], ['elantra', 'Hyundai'], ['kona', 'Hyundai'], ['alcazar', 'Hyundai'],
  ['exter', 'Hyundai'],
  // Tata
  ['nano', 'Tata'], ['tiago', 'Tata'], ['tigor', 'Tata'], ['altroz', 'Tata'], ['punch', 'Tata'], ['nexon', 'Tata'],
  ['harrier', 'Tata'], ['safari', 'Tata'], ['indica', 'Tata'], ['indigo', 'Tata'], ['zest', 'Tata'], ['bolt', 'Tata'],
  ['hexa', 'Tata'], ['sumo', 'Tata'],
  // Mahindra
  ['xuv500', 'Mahindra'], ['xuv 500', 'Mahindra'], ['xuv300', 'Mahindra'], ['xuv 300', 'Mahindra'],
  ['xuv700', 'Mahindra'], ['xuv 700', 'Mahindra'], ['scorpio', 'Mahindra'], ['bolero', 'Mahindra'],
  ['thar', 'Mahindra'], ['kuv100', 'Mahindra'], ['kuv 100', 'Mahindra'], ['marazzo', 'Mahindra'],
  ['tuv300', 'Mahindra'], ['tuv 300', 'Mahindra'], ['xylo', 'Mahindra'], ['verito', 'Mahindra'], ['quanto', 'Mahindra'],
  // Honda
  ['city', 'Honda'], ['amaze', 'Honda'], ['wr-v', 'Honda'], ['wrv', 'Honda'], ['jazz', 'Honda'], ['civic', 'Honda'],
  ['brio', 'Honda'], ['mobilio', 'Honda'], ['br-v', 'Honda'], ['brv', 'Honda'], ['elevate', 'Honda'],
  // Toyota
  ['etios', 'Toyota'], ['innova', 'Toyota'], ['fortuner', 'Toyota'], ['corolla', 'Toyota'], ['glanza', 'Toyota'],
  ['urban cruiser', 'Toyota'], ['camry', 'Toyota'], ['yaris', 'Toyota'], ['land cruiser', 'Toyota'],
  ['hilux', 'Toyota'], ['rumion', 'Toyota'], ['hyryder', 'Toyota'],
  // Ford
  ['ecosport', 'Ford'], ['figo', 'Ford'], ['aspire', 'Ford'], ['endeavour', 'Ford'], ['fiesta', 'Ford'],
  ['freestyle', 'Ford'],
  // Renault
  ['duster', 'Renault'], ['kwid', 'Renault'], ['triber', 'Renault'], ['kiger', 'Renault'], ['lodgy', 'Renault'],
  ['captur', 'Renault'],
  // Kia
  ['seltos', 'Kia'], ['sonet', 'Kia'], ['carens', 'Kia'], ['carnival', 'Kia'], ['ev6', 'Kia'],
  // Volkswagen
  ['polo', 'Volkswagen'], ['vento', 'Volkswagen'], ['ameo', 'Volkswagen'], ['taigun', 'Volkswagen'],
  ['virtus', 'Volkswagen'], ['tiguan', 'Volkswagen'], ['jetta', 'Volkswagen'],
  // Skoda
  ['rapid', 'Skoda'], ['slavia', 'Skoda'], ['kushaq', 'Skoda'], ['octavia', 'Skoda'], ['superb', 'Skoda'],
  ['laura', 'Skoda'], ['fabia', 'Skoda'],
  // Nissan
  ['micra', 'Nissan'], ['sunny', 'Nissan'], ['terrano', 'Nissan'], ['kicks', 'Nissan'], ['magnite', 'Nissan'],
  ['evalia', 'Nissan'],
  // Chevrolet (discontinued in India but still common on the road)
  ['beat', 'Chevrolet'], ['spark', 'Chevrolet'], ['cruze', 'Chevrolet'], ['sail', 'Chevrolet'], ['tavera', 'Chevrolet'],
  ['enjoy', 'Chevrolet'],
  // Datsun
  ['redi-go', 'Datsun'], ['redigo', 'Datsun'], ['datsun go', 'Datsun'],
  // Jeep
  ['compass', 'Jeep'], ['meridian', 'Jeep'], ['wrangler', 'Jeep'],
  // MG
  ['hector', 'MG'], ['astor', 'MG'], ['gloster', 'MG'], ['comet', 'MG'],
  // Isuzu
  ['d-max', 'Isuzu'], ['mu-x', 'Isuzu'],
  // Premium/luxury
  ['3 series', 'BMW'], ['5 series', 'BMW'], ['x1', 'BMW'], ['x3', 'BMW'], ['x5', 'BMW'],
  ['c-class', 'Mercedes-Benz'], ['e-class', 'Mercedes-Benz'], ['gla', 'Mercedes-Benz'], ['glc', 'Mercedes-Benz'],
  ['a4', 'Audi'], ['a6', 'Audi'], ['q3', 'Audi'], ['q5', 'Audi'], ['q7', 'Audi'],
];
CAR_MODEL_TO_MAKE.sort((a, b) => b[0].length - a[0].length);

function inferMakeFromModel(model: string): string | null {
  const normalized = model.toLowerCase();
  for (const [keyword, make] of CAR_MODEL_TO_MAKE) {
    if (normalized.includes(keyword)) return make;
  }
  return null;
}

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
              'Extract every customer/call entry visible in this photo of handwritten notes. Dates are ' +
              'often written once at the left margin rather than next to every row, and apply to that row ' +
              "and all rows below it until a new date appears -- a single page can have several such date " +
              "sections. Record the very top date as pageDate, and resolve each entry's own callDate by " +
              'carrying forward the nearest date marker above it (see the callDate field description for ' +
              'details) before extracting each entry.',
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
    // Each entry resolves its own carried-forward date (see callDate's schema description) since a page
    // can have multiple date sections. pageDate is only a fallback for the rare case an entry has none.
    callDate: e.callDate || input.pageDate || null,
    employeeName: e.employeeName ?? null,
    carMake: e.carMake ?? (e.carModel ? inferMakeFromModel(e.carModel) : null),
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
