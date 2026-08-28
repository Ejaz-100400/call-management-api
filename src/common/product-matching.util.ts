import { BusinessCategory, Prisma } from '@prisma/client';

/**
 * Shared by the live-call AI pipeline (worker/processors/process-call.ts),
 * the historical import path (import.service.ts), and the one-off backfill
 * script -- all three used to duplicate this logic separately.
 *
 * Products are extracted "in the customer's or agent's own words" (see
 * ai.provider.ts), so this is free text like "windshield crack repair" or
 * "underglow lighting" rather than a clean match against the catalog. Uses
 * the same pg_trgm fuzzy-similarity approach as the customer-duplicate
 * detection in customers.service.ts (word order and exact phrasing don't
 * have to match). Threshold picked empirically -- 0.25+ cleanly separated
 * real matches (0.29-1.0) from noise (~0.1 for genuinely unrelated phrases)
 * against this catalog.
 *
 * Category is a *preference*, not a hard filter: a same-category match is
 * preferred when one clears the threshold, but a cross-category match is
 * still accepted as a fallback. A hard `WHERE category = businessCategory`
 * filter means any call whose category couldn't be resolved (imports
 * default to 'unknown', which the product catalog never contains) would
 * otherwise never match anything, no matter how well the phrase matches --
 * this was silently losing product links on a large share of historical
 * imports.
 */
const PRODUCT_MATCH_THRESHOLD = 0.25;

/**
 * Exact-phrase overrides from a manual review of every distinct
 * productsDiscussed value in the database. Takes priority over the fuzzy
 * trigram match below -- some phrases share text with a product name but
 * were deliberately classified elsewhere ("ant glass", "glass-sunroof", and
 * "tailgate glass" do NOT mean Headlight Glass; "not and glass" and
 * "pipe line and glass" are noise despite containing "glass"), so a broad
 * substring/regex rule over-generalizes and gets these wrong. `null` means
 * "known noise/unclear -- leave unmatched, never link or create a product
 * for it" (this is how "Unknown" values are handled: they must not become
 * a literal "Unknown" product in the catalog).
 *
 * Phrases classified as "Others" in the same review, and a handful mapped
 * to products that don't exist in the catalog yet (Fog Lamp, Grill, Drl
 * Optical, Glass Available, Glass & Ghd500, Back Lit, Sunroof, Tailgate),
 * are deliberately left OUT of this table pending a decision on whether to
 * create those as real catalog products -- see the caller for how those are
 * surfaced instead of guessed at.
 */
const EXACT_PHRASE_OVERRIDES: Record<string, string | string[] | null> = {
  glass: 'Headlight Glass',
  led: 'LED',
  'fog projector': 'Fog Projector',
  'h/l projector': 'H/L Projector',
  fog: 'Fog Projector',
  drl: 'DRL',
  projector: 'H/L Projector',
  braket: 'Fog Bracket',
  'bi-led': 'Bi LED Projector',
  'doom cleaning': 'Doom cleaning',
  'fog lamp': 'Fog Projector',
  bracket: 'Fog Bracket',
  brake: 'Fog Bracket',
  unknown: null,
  proj: 'H/L Projector',
  '5d ring': '5D Ring',
  'super fog': 'Super Fog',
  'bi-led projector': 'Bi LED Projector',
  'headlight glass': 'Headlight Glass',
  bulb: 'LED',
  'bi led projector': 'Bi LED Projector',
  'headlight projector': 'H/L Projector',
  'fog bracket': 'Fog Bracket',
  'auxiliary light': 'Auxiliary Light',
  'extra lights': 'Auxiliary Light',
  'gear knob': 'Gear Knob',
  'devil eye': 'Devil Eye',
  lamp: 'Fog Projector',
  grill: 'Others',
  'drl optical': 'DRL',
  'glass available': 'Headlight Glass',
  'glass & ghd500': 'Headlight Glass',
  'back lit': null,
  sunroof: null,
  '1 easy tailgate': null,
  // Genuinely different one-off services with no dedicated catalog entry --
  // routed to the general "Others" bucket rather than left unmatched.
  'bat man': 'Others',
  'mirror cap': 'Others',
  polish: 'Others',
  'batman cap': 'Others',
  back: 'Others',
  batman: 'Others',
  buffing: 'Others',
  'batman cup': 'Others',
  'bilet pin': 'Others',
  matting: 'Others',
  'parking light': 'Others',
  'underglow lights': 'Others',
  'alloy wheels': 'Others',
  seat: 'Others',
  'rfi glass': 'Others',
  par: 'Others',
  wiper: 'Others',
  'halogen 380': 'Others',
  'motorized boot': 'Others',
  'white v.15d': 'Others',
  'front windshield replacement/repair': 'Others',
  'rear window tinting': 'Others',
  windshield: 'Others',
  park: 'Others',
  'multi color drl': 'DRL',
  'fog fitting': 'Fog Projector',
  'glass - 2000': 'Headlight Glass',
  'extra light': 'Auxiliary Light',
  spoiler: 'Spoiler',
  'glass s - 2500': 'Headlight Glass',
  'glass - 6000': 'Headlight Glass',
  'glass - 6500': 'Headlight Glass',
  'glass s - 2000': 'Headlight Glass',
  doom: 'Doom cleaning',
  'fog-led': 'Fog Projector',
  dsl: 'DRL',
  'glass pair': 'Headlight Glass',
  'head light': 'H/L Projector',
  dbl: 'DRL',
  hp: 'H/L Projector',
  'dickey light': 'Dickey Light',
  '9': null,
  '500': null,
  'ki ledys': 'Bi LED Projector',
  sdl: 'DRL',
  'drl multi color': 'DRL',
  'bracket for fog': 'Fog Bracket',
  'car light': 'H/L Projector',
  'drl multicolor': 'DRL',
  '000/-': null,
  'fog light bracket': 'Fog Bracket',
  'ant glass': null,
  fuel: null,
  'glass 5-2500': 'Headlight Glass',
  petrol: null,
  'glass tyr2': 'Headlight Glass',
  side: null,
  headlight: 'H/L Projector',
  'glass-10': 'Headlight Glass',
  '108 glass': 'Headlight Glass',
  'glass tyr1': 'Headlight Glass',
  'doom set': 'Doom cleaning',
  light: 'H/L Projector',
  'fog not working': 'Fog Projector',
  'projector light led': 'LED',
  'head lights': 'H/L Projector',
  door: null,
  'back stand glass': 'Headlight Glass',
  'tail lamp': 'Dickey Light',
  'head light rbg light': 'H/L Projector',
  'glass s 2 doors': 'Headlight Glass',
  'glass - 2600': 'Headlight Glass',
  'glass - 4500': 'Headlight Glass',
  'glass s - 5500': 'Headlight Glass',
  'glass - 3500': 'Headlight Glass',
  'door s - 3000': null,
  'polo utg - 8500': null,
  'glass - 2900': 'Headlight Glass',
  'glass s - 6500': 'Headlight Glass',
  'w/s (14': null,
  '500)': null,
  'glass s - 2600': 'Headlight Glass',
  'polo - lh': null,
  dent: null,
  mud: null,
  'glass pair 800/each 1000': 'Headlight Glass',
  'hp 120w 4500 43k': null,
  dal: 'DRL',
  'fog - 3200/3800/3-0': 'Fog Projector',
  'lh side glass': 'Headlight Glass',
  'all glass': 'Headlight Glass',
  'glass parts': 'Headlight Glass',
  'dsl modifications': 'DRL',
  'multi color dsl': 'DRL',
  del: 'DRL',
  silky: null,
  pro: null,
  sg: null,
  extra: 'Auxiliary Light',
  'polo glass': 'Headlight Glass',
  'hl projector': 'H/L Projector',
  'glass 5-250': 'Headlight Glass',
  'both t-6000': 'Headlight Glass',
  'glass - pair 5': 'Headlight Glass',
  '000': null,
  'led -16w 5': 'LED',
  'door polish': 'Doom cleaning',
  '120w led': 'LED',
  panel: null,
  '8pcs': null,
  'fog lad': 'Fog Projector',
  fitting: null,
  'tailgate glass': 'Dickey Light',
  lad: 'LED',
  'sun fog': 'Super Fog',
  '3 inch bracket': 'Fog Bracket',
  'head light projector': 'H/L Projector',
  dam: 'DRL',
  'multicolor dvd': 'DRL',
  num: null,
  'not and glass': null,
  'bi lead pins': 'Bi LED Projector',
  'pipe line and glass': null,
  '2 side': null,
  'glass-sunroof': null,
  'dbl side door': 'DRL',
  'muli color drl': 'DRL',
  'bi bd pin': 'Bi LED Projector',
  'side door': 'DRL',
  modify: null,
  hood: null,
  'multicolor drl': 'DRL',
  'led lights': 'LED',
  'lighting and drl': 'DRL',
  'drl upgrade': 'DRL',
  'i20 drl': 'DRL',
  'light car gear knob': 'Gear Knob',
  'h/l projector & super fog': ['H/L Projector', 'Super Fog'],
  hl: 'H/L Projector',
  fp: 'Fog Projector',
  'h/l projectors': 'H/L Projector',
  'head lamp': 'H/L Projector',
  'kk shop-mon': null,
  'ice projector': 'H/L Projector',
  'kk shop': null,
  'wrgb drl - 2 days before call me': 'DRL',
};

type ProductMatchClient = Pick<Prisma.TransactionClient, '$queryRaw' | 'callProduct'>;

export interface LinkDiscussedProductsResult {
  matchedCount: number;
  unmatchedPhrases: string[];
}

async function findProductByName(
  client: ProductMatchClient,
  name: string,
  businessCategory: BusinessCategory,
): Promise<{ id: string } | undefined> {
  const candidates = await client.$queryRaw<Array<{ id: string; category: BusinessCategory; similarity: number }>>`
    SELECT id, category, similarity(name, ${name}) AS similarity
    FROM products
    WHERE active = true
    ORDER BY similarity DESC
    LIMIT 5;
  `;
  const sameCategory = candidates.find((c) => c.category === businessCategory && c.similarity >= PRODUCT_MATCH_THRESHOLD);
  if (sameCategory) return sameCategory;
  // Cross-category fallback only when the call's own category is genuinely
  // unresolved -- a real, known category (car_glasses vs car_modifications)
  // should never pull in a product from the other line just because
  // nothing in its own category cleared the threshold (this is exactly how
  // a bare "glass" mention on a Car Modifications call was ending up tagged
  // with Headlight Glass, a Car Glasses-only product). 'unknown' is the one
  // case with no real category signal to trust in the first place -- that's
  // what the fallback below still covers, unchanged.
  if (businessCategory === 'unknown') {
    return candidates.find((c) => c.similarity >= PRODUCT_MATCH_THRESHOLD);
  }
  return undefined;
}

/**
 * The AI extraction often writes "Core item (extra descriptive detail)" --
 * e.g. "Auxiliary/fog lights (premium grade, available in 120W/200W/240W
 * and 2/3/4 light configurations)". The parenthetical is useful detail to
 * keep in what gets stored, but it dilutes trigram similarity enough to
 * drop a clear match below threshold ("Auxiliary/fog lights" alone scores
 * fine against "Auxiliary Light"; the full sentence doesn't). Only used as
 * a fallback when matching the phrase as written already failed.
 */
function stripTrailingParenthetical(text: string): string {
  return text.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export async function linkDiscussedProducts(
  client: ProductMatchClient,
  callId: string,
  businessCategory: BusinessCategory,
  productsDiscussed: string[],
): Promise<LinkDiscussedProductsResult> {
  // Clear any existing links first -- this runs on reprocess/re-backfill
  // too, and call_products has no natural way to "upsert" a set membership.
  await client.callProduct.deleteMany({ where: { callId } });

  const matchedProductIds = new Set<string>();
  const unmatchedPhrases: string[] = [];
  for (const discussed of productsDiscussed) {
    if (!discussed.trim()) continue;
    const normalized = discussed.trim().toLowerCase();

    if (normalized in EXACT_PHRASE_OVERRIDES) {
      const override = EXACT_PHRASE_OVERRIDES[normalized];
      if (override === null) continue; // known noise -- leave unmatched, no product created
      const names = Array.isArray(override) ? override : [override];
      let anyMatched = false;
      for (const name of names) {
        const match = await findProductByName(client, name, businessCategory);
        if (match) {
          matchedProductIds.add(match.id);
          anyMatched = true;
        }
      }
      if (!anyMatched) unmatchedPhrases.push(discussed);
      continue;
    }

    let match = await findProductByName(client, discussed, businessCategory);
    if (!match) {
      const core = stripTrailingParenthetical(discussed);
      if (core && core !== discussed) match = await findProductByName(client, core, businessCategory);
    }
    if (match) matchedProductIds.add(match.id);
    else unmatchedPhrases.push(discussed);
  }

  if (matchedProductIds.size > 0) {
    await client.callProduct.createMany({
      data: Array.from(matchedProductIds).map((productId) => ({ callId, productId })),
      skipDuplicates: true,
    });
  }

  return { matchedCount: matchedProductIds.size, unmatchedPhrases };
}
