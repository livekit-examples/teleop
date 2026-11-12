/**
 * Small built-in gazetteer. It lets the globe place a robot that only sets
 * lk.fleet.city / lk.fleet.country, and places the operator from the browser
 * time zone when geolocation is unavailable or declined. Coordinates are city
 * centers, so both are marked approximate in the UI.
 */
type Place = { city: string; country: string; lat: number; lng: number; tz?: string };

const PLACES: Place[] = [
  { city: 'Denver', country: 'US', lat: 39.74, lng: -104.99, tz: 'America/Denver' },
  { city: 'Boulder', country: 'US', lat: 40.01, lng: -105.27 },
  { city: 'San Francisco', country: 'US', lat: 37.77, lng: -122.42, tz: 'America/Los_Angeles' },
  { city: 'San Jose', country: 'US', lat: 37.34, lng: -121.89 },
  { city: 'Mountain View', country: 'US', lat: 37.39, lng: -122.08 },
  { city: 'Los Angeles', country: 'US', lat: 34.05, lng: -118.24 },
  { city: 'Seattle', country: 'US', lat: 47.61, lng: -122.33 },
  { city: 'Phoenix', country: 'US', lat: 33.45, lng: -112.07, tz: 'America/Phoenix' },
  { city: 'Austin', country: 'US', lat: 30.27, lng: -97.74 },
  { city: 'Chicago', country: 'US', lat: 41.88, lng: -87.63, tz: 'America/Chicago' },
  { city: 'Pittsburgh', country: 'US', lat: 40.44, lng: -79.99 },
  { city: 'Boston', country: 'US', lat: 42.36, lng: -71.06 },
  { city: 'New York', country: 'US', lat: 40.71, lng: -74.01, tz: 'America/New_York' },
  { city: 'Detroit', country: 'US', lat: 42.33, lng: -83.05, tz: 'America/Detroit' },
  { city: 'Anchorage', country: 'US', lat: 61.22, lng: -149.9, tz: 'America/Anchorage' },
  { city: 'Honolulu', country: 'US', lat: 21.31, lng: -157.86, tz: 'Pacific/Honolulu' },
  { city: 'Toronto', country: 'CA', lat: 43.65, lng: -79.38, tz: 'America/Toronto' },
  { city: 'Vancouver', country: 'CA', lat: 49.28, lng: -123.12, tz: 'America/Vancouver' },
  { city: 'Montreal', country: 'CA', lat: 45.5, lng: -73.57 },
  { city: 'Mexico City', country: 'MX', lat: 19.43, lng: -99.13, tz: 'America/Mexico_City' },
  { city: 'São Paulo', country: 'BR', lat: -23.55, lng: -46.63, tz: 'America/Sao_Paulo' },
  { city: 'Buenos Aires', country: 'AR', lat: -34.6, lng: -58.38, tz: 'America/Argentina/Buenos_Aires' },
  { city: 'Santiago', country: 'CL', lat: -33.45, lng: -70.67, tz: 'America/Santiago' },
  { city: 'Bogotá', country: 'CO', lat: 4.71, lng: -74.07, tz: 'America/Bogota' },
  { city: 'London', country: 'GB', lat: 51.51, lng: -0.13, tz: 'Europe/London' },
  { city: 'Dublin', country: 'IE', lat: 53.35, lng: -6.26, tz: 'Europe/Dublin' },
  { city: 'Paris', country: 'FR', lat: 48.86, lng: 2.35, tz: 'Europe/Paris' },
  { city: 'Berlin', country: 'DE', lat: 52.52, lng: 13.41, tz: 'Europe/Berlin' },
  { city: 'Munich', country: 'DE', lat: 48.14, lng: 11.58 },
  { city: 'Zurich', country: 'CH', lat: 47.38, lng: 8.54, tz: 'Europe/Zurich' },
  { city: 'Amsterdam', country: 'NL', lat: 52.37, lng: 4.9, tz: 'Europe/Amsterdam' },
  { city: 'Madrid', country: 'ES', lat: 40.42, lng: -3.7, tz: 'Europe/Madrid' },
  { city: 'Barcelona', country: 'ES', lat: 41.39, lng: 2.17 },
  { city: 'Lisbon', country: 'PT', lat: 38.72, lng: -9.14, tz: 'Europe/Lisbon' },
  { city: 'Rome', country: 'IT', lat: 41.9, lng: 12.5, tz: 'Europe/Rome' },
  { city: 'Milan', country: 'IT', lat: 45.46, lng: 9.19 },
  { city: 'Stockholm', country: 'SE', lat: 59.33, lng: 18.07, tz: 'Europe/Stockholm' },
  { city: 'Oslo', country: 'NO', lat: 59.91, lng: 10.75, tz: 'Europe/Oslo' },
  { city: 'Copenhagen', country: 'DK', lat: 55.68, lng: 12.57, tz: 'Europe/Copenhagen' },
  { city: 'Helsinki', country: 'FI', lat: 60.17, lng: 24.94, tz: 'Europe/Helsinki' },
  { city: 'Warsaw', country: 'PL', lat: 52.23, lng: 21.01, tz: 'Europe/Warsaw' },
  { city: 'Vienna', country: 'AT', lat: 48.21, lng: 16.37, tz: 'Europe/Vienna' },
  { city: 'Prague', country: 'CZ', lat: 50.08, lng: 14.44, tz: 'Europe/Prague' },
  { city: 'Kyiv', country: 'UA', lat: 50.45, lng: 30.52, tz: 'Europe/Kyiv' },
  { city: 'Istanbul', country: 'TR', lat: 41.01, lng: 28.98, tz: 'Europe/Istanbul' },
  { city: 'Tel Aviv', country: 'IL', lat: 32.09, lng: 34.78, tz: 'Asia/Jerusalem' },
  { city: 'Dubai', country: 'AE', lat: 25.2, lng: 55.27, tz: 'Asia/Dubai' },
  { city: 'Cairo', country: 'EG', lat: 30.04, lng: 31.24, tz: 'Africa/Cairo' },
  { city: 'Lagos', country: 'NG', lat: 6.52, lng: 3.38, tz: 'Africa/Lagos' },
  { city: 'Nairobi', country: 'KE', lat: -1.29, lng: 36.82, tz: 'Africa/Nairobi' },
  { city: 'Cape Town', country: 'ZA', lat: -33.92, lng: 18.42 },
  { city: 'Johannesburg', country: 'ZA', lat: -26.2, lng: 28.05, tz: 'Africa/Johannesburg' },
  { city: 'Mumbai', country: 'IN', lat: 19.08, lng: 72.88 },
  { city: 'Bengaluru', country: 'IN', lat: 12.97, lng: 77.59, tz: 'Asia/Kolkata' },
  { city: 'Singapore', country: 'SG', lat: 1.35, lng: 103.82, tz: 'Asia/Singapore' },
  { city: 'Hong Kong', country: 'HK', lat: 22.32, lng: 114.17, tz: 'Asia/Hong_Kong' },
  { city: 'Shanghai', country: 'CN', lat: 31.23, lng: 121.47, tz: 'Asia/Shanghai' },
  { city: 'Shenzhen', country: 'CN', lat: 22.54, lng: 114.06 },
  { city: 'Beijing', country: 'CN', lat: 39.9, lng: 116.41 },
  { city: 'Taipei', country: 'TW', lat: 25.03, lng: 121.57, tz: 'Asia/Taipei' },
  { city: 'Seoul', country: 'KR', lat: 37.57, lng: 126.98, tz: 'Asia/Seoul' },
  { city: 'Tokyo', country: 'JP', lat: 35.68, lng: 139.69, tz: 'Asia/Tokyo' },
  { city: 'Osaka', country: 'JP', lat: 34.69, lng: 135.5 },
  { city: 'Sydney', country: 'AU', lat: -33.87, lng: 151.21, tz: 'Australia/Sydney' },
  { city: 'Melbourne', country: 'AU', lat: -37.81, lng: 144.96, tz: 'Australia/Melbourne' },
  { city: 'Brisbane', country: 'AU', lat: -27.47, lng: 153.03, tz: 'Australia/Brisbane' },
  { city: 'Perth', country: 'AU', lat: -31.95, lng: 115.86, tz: 'Australia/Perth' },
  { city: 'Auckland', country: 'NZ', lat: -36.85, lng: 174.76, tz: 'Pacific/Auckland' },
];

const COUNTRY_ALIASES: Record<string, string> = {
  'united states': 'US',
  usa: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  england: 'GB',
  germany: 'DE',
  france: 'FR',
  japan: 'JP',
  canada: 'CA',
  china: 'CN',
  india: 'IN',
  australia: 'AU',
  switzerland: 'CH',
  netherlands: 'NL',
  spain: 'ES',
  italy: 'IT',
  brazil: 'BR',
  singapore: 'SG',
  'south korea': 'KR',
  korea: 'KR',
};

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

const countryCode = (country: string) => {
  const c = fold(country);
  return (COUNTRY_ALIASES[c] ?? c).toUpperCase();
};

export function lookupCity(city: string, country: string) {
  const name = fold(city);
  const code = country ? countryCode(country) : '';
  const place =
    PLACES.find((p) => fold(p.city) === name && (!code || p.country === code)) ??
    PLACES.find((p) => fold(p.city) === name);
  return place ? { lat: place.lat, lng: place.lng } : undefined;
}

/** Best guess at where the browser is, from its IANA time zone. */
export function placeFromTimeZone(): Place | undefined {
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
  return PLACES.find((p) => p.tz === tz);
}

/** Nearest gazetteer city, used to label a raw geolocation fix. */
export function nearestPlace(lat: number, lng: number): Place {
  const rad = Math.PI / 180;
  let best = PLACES[0];
  let bestD = Infinity;
  for (const p of PLACES) {
    const d =
      Math.sin(((p.lat - lat) * rad) / 2) ** 2 +
      Math.cos(lat * rad) * Math.cos(p.lat * rad) * Math.sin(((p.lng - lng) * rad) / 2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
