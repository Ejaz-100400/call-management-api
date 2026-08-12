/**
 * Model -> make lookup for filling in a blank Car Make when Car Model is
 * present -- mirrors what the photo-scan OCR prompt already does via Claude's
 * own world knowledge (see import.service.ts's ocr.provider), but Excel rows
 * are parsed synchronously with no AI call in the loop, so this needs a plain
 * static table instead. Covers common India-market models since that's this
 * business's customer base; unmatched models fall back to 'Unknown' at the
 * call site rather than silently staying blank.
 */
const MODEL_TO_MAKE: Record<string, string> = {
  // Maruti Suzuki
  swift: 'Maruti Suzuki',
  dzire: 'Maruti Suzuki',
  baleno: 'Maruti Suzuki',
  wagonr: 'Maruti Suzuki',
  'wagon r': 'Maruti Suzuki',
  alto: 'Maruti Suzuki',
  celerio: 'Maruti Suzuki',
  ertiga: 'Maruti Suzuki',
  'vitara brezza': 'Maruti Suzuki',
  brezza: 'Maruti Suzuki',
  's-presso': 'Maruti Suzuki',
  spresso: 'Maruti Suzuki',
  ignis: 'Maruti Suzuki',
  xl6: 'Maruti Suzuki',
  ciaz: 'Maruti Suzuki',
  eeco: 'Maruti Suzuki',
  omni: 'Maruti Suzuki',
  jimny: 'Maruti Suzuki',
  fronx: 'Maruti Suzuki',

  // Hyundai
  i10: 'Hyundai',
  'grand i10': 'Hyundai',
  i20: 'Hyundai',
  creta: 'Hyundai',
  venue: 'Hyundai',
  verna: 'Hyundai',
  santro: 'Hyundai',
  aura: 'Hyundai',
  alcazar: 'Hyundai',
  tucson: 'Hyundai',
  exter: 'Hyundai',
  eon: 'Hyundai',
  xcent: 'Hyundai',

  // Tata
  nexon: 'Tata',
  punch: 'Tata',
  tiago: 'Tata',
  tigor: 'Tata',
  altroz: 'Tata',
  harrier: 'Tata',
  safari: 'Tata',
  hexa: 'Tata',
  zest: 'Tata',
  bolt: 'Tata',
  nano: 'Tata',
  indica: 'Tata',
  indigo: 'Tata',

  // Honda
  city: 'Honda',
  amaze: 'Honda',
  jazz: 'Honda',
  'wr-v': 'Honda',
  wrv: 'Honda',
  civic: 'Honda',
  brv: 'Honda',
  'br-v': 'Honda',
  elevate: 'Honda',

  // Toyota
  innova: 'Toyota',
  fortuner: 'Toyota',
  glanza: 'Toyota',
  'urban cruiser': 'Toyota',
  camry: 'Toyota',
  etios: 'Toyota',
  yaris: 'Toyota',
  hyryder: 'Toyota',
  'hilux': 'Toyota',
  corolla: 'Toyota',

  // Mahindra
  xuv700: 'Mahindra',
  xuv500: 'Mahindra',
  xuv300: 'Mahindra',
  xuv400: 'Mahindra',
  scorpio: 'Mahindra',
  bolero: 'Mahindra',
  thar: 'Mahindra',
  kuv100: 'Mahindra',
  marazzo: 'Mahindra',
  xylo: 'Mahindra',

  // Kia
  seltos: 'Kia',
  sonet: 'Kia',
  carens: 'Kia',
  carnival: 'Kia',

  // Renault
  kwid: 'Renault',
  triber: 'Renault',
  duster: 'Renault',
  kiger: 'Renault',

  // Nissan
  magnite: 'Nissan',
  kicks: 'Nissan',
  terrano: 'Nissan',
  micra: 'Nissan',

  // Ford
  ecosport: 'Ford',
  figo: 'Ford',
  aspire: 'Ford',
  endeavour: 'Ford',

  // Volkswagen
  polo: 'Volkswagen',
  vento: 'Volkswagen',
  taigun: 'Volkswagen',
  virtus: 'Volkswagen',

  // Skoda
  rapid: 'Skoda',
  octavia: 'Skoda',
  superb: 'Skoda',
  kushaq: 'Skoda',
  slavia: 'Skoda',

  // MG
  hector: 'MG',
  astor: 'MG',
  'zs ev': 'MG',
  gloster: 'MG',
  comet: 'MG',

  // Chevrolet (legacy, still on Indian roads)
  beat: 'Chevrolet',
  spark: 'Chevrolet',
  cruze: 'Chevrolet',
  sail: 'Chevrolet',
  tavera: 'Chevrolet',

  // Datsun
  go: 'Datsun',
  'redi-go': 'Datsun',
  redigo: 'Datsun',

  // Jeep
  compass: 'Jeep',
  meridian: 'Jeep',

  // Luxury
  '3 series': 'BMW',
  '5 series': 'BMW',
  x1: 'BMW',
  x3: 'BMW',
  x5: 'BMW',
  'c-class': 'Mercedes-Benz',
  'e-class': 'Mercedes-Benz',
  gla: 'Mercedes-Benz',
  glc: 'Mercedes-Benz',
  a4: 'Audi',
  a6: 'Audi',
  q3: 'Audi',
  q5: 'Audi',
};

const SORTED_MODEL_ENTRIES = Object.entries(MODEL_TO_MAKE).sort((a, b) => b[0].length - a[0].length);

// Real-world "Car Model" cells are often actually "Make Model" typed
// together (e.g. "Toyota Innova"), or occasionally just a make with no
// model at all (e.g. someone typing "Hyundai" and leaving it at that) --
// this lets splitMakeAndModel() recognize a make name at the start of the
// cell, separately from the model-name lookup above.
const MAKE_ALIASES: Record<string, string> = Object.fromEntries(
  Array.from(new Set(Object.values(MODEL_TO_MAKE))).map((make) => [make.toLowerCase(), make]),
);
Object.assign(MAKE_ALIASES, {
  maruti: 'Maruti Suzuki',
  suzuki: 'Maruti Suzuki',
  mercedes: 'Mercedes-Benz',
  benz: 'Mercedes-Benz',
  vw: 'Volkswagen',
  chevy: 'Chevrolet',
});
const SORTED_MAKE_ALIASES = Object.entries(MAKE_ALIASES).sort((a, b) => b[0].length - a[0].length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, '');
}

/** Returns the known make for a car model string (word-boundary match), or undefined if not recognized. */
export function inferCarMakeFromModel(rawModel: string): string | undefined {
  const normalized = rawModel.trim();
  if (!normalized) return undefined;

  for (const [model, make] of SORTED_MODEL_ENTRIES) {
    if (new RegExp(`\\b${escapeRegExp(model)}\\b`, 'i').test(normalized)) {
      return make;
    }
  }

  // Catches compound codes typed with different spacing/punctuation than the
  // table above, e.g. "XUV 500" vs the map's "xuv500", or "S Presso" vs
  // "spresso" -- compare with spaces/hyphens stripped from both sides.
  const compacted = compact(normalized);
  for (const [model, make] of SORTED_MODEL_ENTRIES) {
    if (compacted.includes(compact(model))) return make;
  }
  return undefined;
}

export interface SplitMakeAndModel {
  make?: string;
  model?: string;
}

/**
 * Cleans up a "Car Model" cell that may actually contain the make too --
 * "Toyota Innova" becomes { make: "Toyota", model: "Innova" }, a bare
 * "Hyundai" becomes { make: "Hyundai", model: undefined } (there's no real
 * model there), and a plain model like "Fronx" falls through to the
 * model->make lookup above, model left as typed.
 */
export function splitMakeAndModel(raw: string): SplitMakeAndModel {
  const normalized = raw.trim();
  if (!normalized) return {};

  const wholeCellIsJustAMake = MAKE_ALIASES[normalized.toLowerCase()];
  if (wholeCellIsJustAMake) return { make: wholeCellIsJustAMake };

  for (const [alias, canonical] of SORTED_MAKE_ALIASES) {
    const prefixPattern = new RegExp(`^${escapeRegExp(alias)}\\b\\s*`, 'i');
    if (prefixPattern.test(normalized)) {
      const rest = normalized.replace(prefixPattern, '').trim();
      return { make: canonical, model: rest || undefined };
    }
  }

  return { make: inferCarMakeFromModel(normalized), model: normalized };
}
