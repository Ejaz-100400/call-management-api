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

// Properly-cased display text for each key above -- used to reduce a messy
// "Car Model" cell ("Swift 2019 ZXI variant", "city ivtec 2012") down to
// just the recognized model name, dropping the year/trim/engine-code text
// that's often typed alongside it.
const MODEL_DISPLAY: Record<string, string> = {
  swift: 'Swift',
  dzire: 'Dzire',
  baleno: 'Baleno',
  wagonr: 'WagonR',
  'wagon r': 'WagonR',
  alto: 'Alto',
  celerio: 'Celerio',
  ertiga: 'Ertiga',
  'vitara brezza': 'Vitara Brezza',
  brezza: 'Brezza',
  's-presso': 'S-Presso',
  spresso: 'S-Presso',
  ignis: 'Ignis',
  xl6: 'XL6',
  ciaz: 'Ciaz',
  eeco: 'Eeco',
  omni: 'Omni',
  jimny: 'Jimny',
  fronx: 'Fronx',

  i10: 'i10',
  'grand i10': 'Grand i10',
  i20: 'i20',
  creta: 'Creta',
  venue: 'Venue',
  verna: 'Verna',
  santro: 'Santro',
  aura: 'Aura',
  alcazar: 'Alcazar',
  tucson: 'Tucson',
  exter: 'Exter',
  eon: 'Eon',
  xcent: 'Xcent',

  nexon: 'Nexon',
  punch: 'Punch',
  tiago: 'Tiago',
  tigor: 'Tigor',
  altroz: 'Altroz',
  harrier: 'Harrier',
  safari: 'Safari',
  hexa: 'Hexa',
  zest: 'Zest',
  bolt: 'Bolt',
  nano: 'Nano',
  indica: 'Indica',
  indigo: 'Indigo',

  city: 'City',
  amaze: 'Amaze',
  jazz: 'Jazz',
  'wr-v': 'WR-V',
  wrv: 'WR-V',
  civic: 'Civic',
  brv: 'BR-V',
  'br-v': 'BR-V',
  elevate: 'Elevate',

  innova: 'Innova',
  fortuner: 'Fortuner',
  glanza: 'Glanza',
  'urban cruiser': 'Urban Cruiser',
  camry: 'Camry',
  etios: 'Etios',
  yaris: 'Yaris',
  hyryder: 'Hyryder',
  hilux: 'Hilux',
  corolla: 'Corolla',

  xuv700: 'XUV700',
  xuv500: 'XUV500',
  xuv300: 'XUV300',
  xuv400: 'XUV400',
  scorpio: 'Scorpio',
  bolero: 'Bolero',
  thar: 'Thar',
  kuv100: 'KUV100',
  marazzo: 'Marazzo',
  xylo: 'Xylo',

  seltos: 'Seltos',
  sonet: 'Sonet',
  carens: 'Carens',
  carnival: 'Carnival',

  kwid: 'Kwid',
  triber: 'Triber',
  duster: 'Duster',
  kiger: 'Kiger',

  magnite: 'Magnite',
  kicks: 'Kicks',
  terrano: 'Terrano',
  micra: 'Micra',

  ecosport: 'EcoSport',
  figo: 'Figo',
  aspire: 'Aspire',
  endeavour: 'Endeavour',

  polo: 'Polo',
  vento: 'Vento',
  taigun: 'Taigun',
  virtus: 'Virtus',

  rapid: 'Rapid',
  octavia: 'Octavia',
  superb: 'Superb',
  kushaq: 'Kushaq',
  slavia: 'Slavia',

  hector: 'Hector',
  astor: 'Astor',
  'zs ev': 'ZS EV',
  gloster: 'Gloster',
  comet: 'Comet',

  beat: 'Beat',
  spark: 'Spark',
  cruze: 'Cruze',
  sail: 'Sail',
  tavera: 'Tavera',

  go: 'GO',
  'redi-go': 'redi-GO',
  redigo: 'redi-GO',

  compass: 'Compass',
  meridian: 'Meridian',

  '3 series': '3 Series',
  '5 series': '5 Series',
  x1: 'X1',
  x3: 'X3',
  x5: 'X5',
  'c-class': 'C-Class',
  'e-class': 'E-Class',
  gla: 'GLA',
  glc: 'GLC',
  a4: 'A4',
  a6: 'A6',
  q3: 'Q3',
  q5: 'Q5',
};

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

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

/**
 * Catches typos in a model name that don't match anything via exact/substring
 * comparison ("Erthiga" -> "Ertiga"). Only applies to keys of 5+ characters --
 * short alphanumeric codes (i10 vs i20, x1 vs x3 vs x5, a4 vs a6, q3 vs q5,
 * gla vs glc) sit one edit apart from a genuinely different real model, so
 * fuzzy-matching those would silently swap one car for another instead of
 * fixing a typo.
 */
function fuzzyModelMatch(compactedText: string): [model: string, make: string] | undefined {
  let best: { model: string; make: string; distance: number } | undefined;

  for (const [model, make] of SORTED_MODEL_ENTRIES) {
    const key = compact(model);
    if (key.length < 5) continue;
    const maxDistance = key.length <= 7 ? 1 : 2;

    // Slide a window of the key's length (+/- 1) across the text and take
    // the best alignment, so a typo anywhere in the word (or a trailing
    // variant word right after it) doesn't throw off the comparison.
    for (let len = key.length - 1; len <= key.length + 1; len++) {
      if (len < 1) continue;
      for (let start = 0; start + len <= compactedText.length; start++) {
        const window = compactedText.slice(start, start + len);
        const distance = levenshtein(window, key);
        if (distance <= maxDistance && (!best || distance < best.distance)) {
          best = { model, make, distance };
        }
      }
    }
  }

  return best ? [best.model, best.make] : undefined;
}

/**
 * Returns the known make for a car model string (word-boundary match), or
 * undefined if not recognized. `fuzzy` (default true) allows the typo-
 * tolerant Levenshtein pass -- built for clean, human-typed Excel cells
 * where a typo is genuinely 1-2 characters off the real word. Pass `false`
 * for speech-to-text output: a garbled ASR string can look superficially
 * close to an unrelated model (e.g. "Rigo Sport" landing within edit-
 * distance of "EcoSport") without actually being it, so call sites reading
 * transcripts should stick to exact/substring matches only.
 */
export function inferCarMakeFromModel(rawModel: string, fuzzy = true): string | undefined {
  const normalized = rawModel.trim();
  if (!normalized) return undefined;

  for (const [model, make] of SORTED_MODEL_ENTRIES) {
    if (new RegExp(`\\b${escapeRegExp(model)}\\b`, 'i').test(normalized)) {
      return make;
    }
  }

  // Catches compound codes typed with different spacing/punctuation than the
  // table above, e.g. "XUV 500" vs the map's "xuv500", or "S Presso" vs
  // "spresso" -- compare with spaces/hyphens stripped from both sides. Only
  // for keys of 5+ characters, same reasoning as fuzzyModelMatch below: a
  // short code like "go" or "x1" is prone to appearing as a false substring
  // inside unrelated text (e.g. "Rigo Sport" contains "go") -- short codes
  // are still reachable via the exact word-boundary check above.
  const compacted = compact(normalized);
  for (const [model, make] of SORTED_MODEL_ENTRIES) {
    const key = compact(model);
    if (key.length >= 5 && compacted.includes(key)) return make;
  }

  return fuzzy ? fuzzyModelMatch(compacted)?.[1] : undefined;
}

/**
 * Reduces a "Car Model" cell down to just the recognized model name --
 * "Swift 2019 ZXI variant" -> "Swift", "city ivtec 2012" -> "City",
 * "TOYATA FORTUNER" -> "Fortuner" (catches the make typo too, since this
 * only looks at the model-name table). Returns undefined when nothing in
 * the table matches, so the caller can fall back to the raw text rather
 * than losing an unrecognized model entirely.
 */
function canonicalizeModel(rawModel: string): string | undefined {
  const normalized = rawModel.trim();
  if (!normalized) return undefined;

  for (const [model] of SORTED_MODEL_ENTRIES) {
    if (new RegExp(`\\b${escapeRegExp(model)}\\b`, 'i').test(normalized)) {
      return MODEL_DISPLAY[model];
    }
  }

  const compacted = compact(normalized);
  for (const [model] of SORTED_MODEL_ENTRIES) {
    const key = compact(model);
    if (key.length >= 5 && compacted.includes(key)) return MODEL_DISPLAY[model];
  }

  const fuzzy = fuzzyModelMatch(compacted);
  return fuzzy ? MODEL_DISPLAY[fuzzy[0]] : undefined;
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
 * model->make lookup above, model left as typed. Whatever text ends up as
 * the model is further reduced to just its recognized model name via
 * canonicalizeModel -- "Swift 2019 ZXI variant" becomes "Swift" -- falling
 * back to the text as typed when nothing in the table matches.
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
      return { make: canonical, model: rest ? (canonicalizeModel(rest) ?? rest) : undefined };
    }
  }

  return { make: inferCarMakeFromModel(normalized), model: canonicalizeModel(normalized) ?? normalized };
}
