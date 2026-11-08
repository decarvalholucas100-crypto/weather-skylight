// Cities for the location picker, and a rough light-pollution model. Each entry: name, lat,
// lon, IANA time zone, metro population in millions. Coordinates are city centres (public
// facts). The light-pollution estimate sums the glow of nearby metros, falling off with
// distance: crude, but it puts Manhattan, the suburbs, a mid-size city and the countryside in
// the right order. It only knows the cities listed here, so remote areas near an unlisted
// town will read a bit darker than reality.

export interface City { name: string; lat: number; lon: number; tz: string; pop: number }

export const CITIES: City[] = [
  { name: 'New York', lat: 40.713, lon: -74.006, tz: 'America/New_York', pop: 19.5 },
  { name: 'Los Angeles', lat: 34.052, lon: -118.244, tz: 'America/Los_Angeles', pop: 12.9 },
  { name: 'Chicago', lat: 41.878, lon: -87.630, tz: 'America/Chicago', pop: 9.4 },
  { name: 'Houston', lat: 29.760, lon: -95.370, tz: 'America/Chicago', pop: 7.3 },
  { name: 'Dallas', lat: 32.777, lon: -96.797, tz: 'America/Chicago', pop: 7.9 },
  { name: 'Miami', lat: 25.762, lon: -80.192, tz: 'America/New_York', pop: 6.1 },
  { name: 'Atlanta', lat: 33.749, lon: -84.388, tz: 'America/New_York', pop: 6.3 },
  { name: 'Washington, DC', lat: 38.907, lon: -77.037, tz: 'America/New_York', pop: 6.3 },
  { name: 'Philadelphia', lat: 39.953, lon: -75.165, tz: 'America/New_York', pop: 6.2 },
  { name: 'Boston', lat: 42.360, lon: -71.059, tz: 'America/New_York', pop: 4.9 },
  { name: 'Phoenix', lat: 33.448, lon: -112.074, tz: 'America/Phoenix', pop: 5.0 },
  { name: 'San Francisco', lat: 37.775, lon: -122.419, tz: 'America/Los_Angeles', pop: 4.6 },
  { name: 'Seattle', lat: 47.606, lon: -122.332, tz: 'America/Los_Angeles', pop: 4.0 },
  { name: 'Denver', lat: 39.739, lon: -104.990, tz: 'America/Denver', pop: 3.0 },
  { name: 'Las Vegas', lat: 36.170, lon: -115.140, tz: 'America/Los_Angeles', pop: 2.3 },
  { name: 'Salt Lake City', lat: 40.761, lon: -111.891, tz: 'America/Denver', pop: 1.3 },
  { name: 'Honolulu', lat: 21.307, lon: -157.858, tz: 'Pacific/Honolulu', pop: 1.0 },
  { name: 'Anchorage', lat: 61.218, lon: -149.900, tz: 'America/Anchorage', pop: 0.4 },
  { name: 'Toronto', lat: 43.653, lon: -79.383, tz: 'America/Toronto', pop: 6.4 },
  { name: 'Montreal', lat: 45.502, lon: -73.567, tz: 'America/Toronto', pop: 4.3 },
  { name: 'Vancouver', lat: 49.283, lon: -123.121, tz: 'America/Vancouver', pop: 2.6 },
  { name: 'Mexico City', lat: 19.433, lon: -99.133, tz: 'America/Mexico_City', pop: 21.8 },
  { name: 'São Paulo', lat: -23.551, lon: -46.633, tz: 'America/Sao_Paulo', pop: 22.4 },
  { name: 'Rio de Janeiro', lat: -22.907, lon: -43.173, tz: 'America/Sao_Paulo', pop: 13.6 },
  { name: 'Buenos Aires', lat: -34.604, lon: -58.382, tz: 'America/Argentina/Buenos_Aires', pop: 15.4 },
  { name: 'Lima', lat: -12.046, lon: -77.043, tz: 'America/Lima', pop: 11.0 },
  { name: 'Bogotá', lat: 4.711, lon: -74.072, tz: 'America/Bogota', pop: 11.3 },
  { name: 'Santiago', lat: -33.449, lon: -70.669, tz: 'America/Santiago', pop: 6.9 },
  { name: 'London', lat: 51.507, lon: -0.128, tz: 'Europe/London', pop: 14.3 },
  { name: 'Paris', lat: 48.857, lon: 2.352, tz: 'Europe/Paris', pop: 11.2 },
  { name: 'Madrid', lat: 40.417, lon: -3.704, tz: 'Europe/Madrid', pop: 6.8 },
  { name: 'Barcelona', lat: 41.385, lon: 2.173, tz: 'Europe/Madrid', pop: 5.6 },
  { name: 'Lisbon', lat: 38.722, lon: -9.139, tz: 'Europe/Lisbon', pop: 2.9 },
  { name: 'Rome', lat: 41.903, lon: 12.496, tz: 'Europe/Rome', pop: 4.3 },
  { name: 'Milan', lat: 45.464, lon: 9.190, tz: 'Europe/Rome', pop: 4.3 },
  { name: 'Berlin', lat: 52.520, lon: 13.405, tz: 'Europe/Berlin', pop: 6.1 },
  { name: 'Amsterdam', lat: 52.368, lon: 4.904, tz: 'Europe/Amsterdam', pop: 2.5 },
  { name: 'Zurich', lat: 47.377, lon: 8.540, tz: 'Europe/Zurich', pop: 1.4 },
  { name: 'Vienna', lat: 48.208, lon: 16.374, tz: 'Europe/Vienna', pop: 2.9 },
  { name: 'Stockholm', lat: 59.329, lon: 18.069, tz: 'Europe/Stockholm', pop: 2.4 },
  { name: 'Oslo', lat: 59.913, lon: 10.752, tz: 'Europe/Oslo', pop: 1.6 },
  { name: 'Reykjavík', lat: 64.146, lon: -21.942, tz: 'Atlantic/Reykjavik', pop: 0.24 },
  { name: 'Athens', lat: 37.984, lon: 23.728, tz: 'Europe/Athens', pop: 3.6 },
  { name: 'Istanbul', lat: 41.008, lon: 28.978, tz: 'Europe/Istanbul', pop: 15.8 },
  { name: 'Moscow', lat: 55.756, lon: 37.617, tz: 'Europe/Moscow', pop: 17.1 },
  { name: 'Cairo', lat: 30.044, lon: 31.236, tz: 'Africa/Cairo', pop: 22.2 },
  { name: 'Lagos', lat: 6.524, lon: 3.379, tz: 'Africa/Lagos', pop: 15.9 },
  { name: 'Nairobi', lat: -1.292, lon: 36.822, tz: 'Africa/Nairobi', pop: 5.3 },
  { name: 'Cape Town', lat: -33.925, lon: 18.424, tz: 'Africa/Johannesburg', pop: 4.8 },
  { name: 'Johannesburg', lat: -26.204, lon: 28.047, tz: 'Africa/Johannesburg', pop: 10.5 },
  { name: 'Marrakesh', lat: 31.629, lon: -7.981, tz: 'Africa/Casablanca', pop: 1.3 },
  { name: 'Dubai', lat: 25.205, lon: 55.271, tz: 'Asia/Dubai', pop: 3.6 },
  { name: 'Tel Aviv', lat: 32.085, lon: 34.782, tz: 'Asia/Jerusalem', pop: 4.2 },
  { name: 'Mumbai', lat: 19.076, lon: 72.878, tz: 'Asia/Kolkata', pop: 21.3 },
  { name: 'Delhi', lat: 28.614, lon: 77.209, tz: 'Asia/Kolkata', pop: 33.0 },
  { name: 'Bangkok', lat: 13.756, lon: 100.502, tz: 'Asia/Bangkok', pop: 11.2 },
  { name: 'Singapore', lat: 1.352, lon: 103.820, tz: 'Asia/Singapore', pop: 6.0 },
  { name: 'Hong Kong', lat: 22.320, lon: 114.169, tz: 'Asia/Hong_Kong', pop: 7.5 },
  { name: 'Shanghai', lat: 31.230, lon: 121.474, tz: 'Asia/Shanghai', pop: 29.2 },
  { name: 'Beijing', lat: 39.904, lon: 116.407, tz: 'Asia/Shanghai', pop: 21.8 },
  { name: 'Seoul', lat: 37.567, lon: 126.978, tz: 'Asia/Seoul', pop: 25.5 },
  { name: 'Tokyo', lat: 35.676, lon: 139.650, tz: 'Asia/Tokyo', pop: 37.2 },
  { name: 'Manila', lat: 14.600, lon: 120.984, tz: 'Asia/Manila', pop: 14.7 },
  { name: 'Jakarta', lat: -6.208, lon: 106.846, tz: 'Asia/Jakarta', pop: 11.2 },
  { name: 'Sydney', lat: -33.869, lon: 151.209, tz: 'Australia/Sydney', pop: 5.3 },
  { name: 'Melbourne', lat: -37.814, lon: 144.963, tz: 'Australia/Melbourne', pop: 5.2 },
  { name: 'Perth', lat: -31.951, lon: 115.861, tz: 'Australia/Perth', pop: 2.2 },
  { name: 'Auckland', lat: -36.848, lon: 174.763, tz: 'Pacific/Auckland', pop: 1.7 },
  // Dark-sky places, for comparison
  { name: 'Moab, Utah (dark sky)', lat: 38.573, lon: -109.550, tz: 'America/Denver', pop: 0.005 },
  { name: 'Atacama Desert, Chile (dark sky)', lat: -23.0, lon: -67.75, tz: 'America/Santiago', pop: 0.001 },
  { name: 'Mauna Kea, Hawaii (dark sky)', lat: 19.82, lon: -155.47, tz: 'Pacific/Honolulu', pop: 0.0 },
];

function distKm(a: number, b: number, c: number, d: number): number {
  const r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

/**
 * Light pollution 0 (pristine) .. ~0.95 (big-city core). Each metro glows over a radius that
 * grows with population; contributions add. Calibrated so Manhattan ~0.93, NYC suburbs ~0.8,
 * a mid-size city centre ~0.65, 50+ km from cities ~0.1.
 */
export function estimateLightPollution(lat: number, lon: number): number {
  let glow = 0;
  for (const c of CITIES) {
    if (c.pop <= 0) continue;
    const d = distKm(lat, lon, c.lat, c.lon);
    if (d > 400) continue;
    const R = 8 * Math.sqrt(c.pop); // km
    glow += Math.sqrt(c.pop) / (1 + (d / R) ** 2);
  }
  return Math.min(0.95, 0.05 + 0.9 * (1 - Math.exp(-0.6 * glow)));
}

export function nearestCity(lat: number, lon: number): { city: City; km: number } {
  let best = CITIES[0], bd = Infinity;
  for (const c of CITIES) {
    const d = distKm(lat, lon, c.lat, c.lon);
    if (d < bd) { bd = d; best = c; }
  }
  return { city: best, km: bd };
}
