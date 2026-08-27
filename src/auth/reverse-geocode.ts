import { Logger } from '@nestjs/common';

const logger = new Logger('ReverseGeocode');

export interface ReverseGeocodeResult {
  city: string | null;
  region: string | null;
  country: string | null;
}

/**
 * OpenStreetMap Nominatim -- free, no API key, same "no paid geolocation
 * infra" constraint as geoip-lite. Usage policy caps this at ~1 req/sec,
 * which this app's login volume never comes close to. Never throws --
 * a failed reverse-geocode just means we keep the raw lat/lng without a
 * human-readable place name.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CustomHeadlightsCRM/1.0 (customheadlights.in@gmail.com)' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: Record<string, string> };
    const address = data.address ?? {};
    const city = address.city ?? address.town ?? address.village ?? address.county ?? null;
    return { city, region: address.state ?? null, country: address.country ?? null };
  } catch (err) {
    logger.warn(`Reverse geocode failed: ${(err as Error).message}`);
    return null;
  }
}
