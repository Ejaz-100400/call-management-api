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
 * Known synonyms whose text shares almost no characters with the catalog
 * name they actually mean -- pg_trgm similarity can never bridge that gap
 * (and can even mislead: "extra light" happens to share enough trigrams
 * with "Dickey Light" to clear the threshold for the wrong product). Checked
 * before the fuzzy match; the matched alias text is substituted in place of
 * the discussed phrase so it still goes through the normal candidate query
 * (respecting category preference, active-only, etc.) instead of hard-coding
 * a product id here.
 */
const PRODUCT_ALIASES: Array<{ pattern: RegExp; product: string }> = [
  { pattern: /\bextra\s*lights?\b/i, product: 'Auxiliary Light' },
  { pattern: /\btail\s*(light|lamp)s?\b/i, product: 'Dickey Light' },
  // "bi-led" alone scores higher against plain "LED" than "Bi LED Projector"
  // by raw trigram overlap -- force it to the specific product.
  { pattern: /\bbi[\s-]?led\b/i, product: 'Bi LED Projector' },
  // Common transcription of "bracket" in this business's notes -- no other
  // catalog product this could plausibly mean.
  { pattern: /\bbrake\b/i, product: 'Fog Bracket' },
];

function resolveAlias(discussed: string): string {
  return PRODUCT_ALIASES.find((a) => a.pattern.test(discussed))?.product ?? discussed;
}

type ProductMatchClient = Pick<Prisma.TransactionClient, '$queryRaw' | 'callProduct'>;

export interface LinkDiscussedProductsResult {
  matchedCount: number;
  unmatchedPhrases: string[];
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
    const matchText = resolveAlias(discussed);

    const candidates = await client.$queryRaw<Array<{ id: string; category: BusinessCategory; similarity: number }>>`
      SELECT id, category, similarity(name, ${matchText}) AS similarity
      FROM products
      WHERE active = true
      ORDER BY similarity DESC
      LIMIT 5;
    `;
    const sameCategory = candidates.find((c) => c.category === businessCategory && c.similarity >= PRODUCT_MATCH_THRESHOLD);
    const bestOverall = candidates.find((c) => c.similarity >= PRODUCT_MATCH_THRESHOLD);
    const match = sameCategory ?? bestOverall;
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
