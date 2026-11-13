// Paths, the province bounding box and the public endpoints every stage shares.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = path.join(ROOT, 'public', 'data');
export const CACHE = path.join(ROOT, '.cache');

// Saskatchewan (lon/lat), with a little slack.
export const BBOX = { west: -110.1, south: 48.9, east: -101.3, north: 60.1 };
export const OGC = 'https://api.weather.gc.ca/collections';
export const OSRM = 'https://router.project-osrm.org';
export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
export const UA = { 'User-Agent': 'LivingSkiesAtlas/0.1 (open-data atlas build script)' };
