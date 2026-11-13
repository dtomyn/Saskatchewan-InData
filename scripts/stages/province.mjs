import { writeOut } from '../lib/io.mjs';
import { getProvince } from '../lib/places.mjs';

// Statistics Canada 2021 cartographic boundary file: Saskatchewan's outline.
export default async function province() {
  const { display } = await getProvince();
  await writeOut('province', { type: 'Feature', properties: { name: 'Saskatchewan' }, geometry: { type: 'MultiPolygon', coordinates: display } });
}
