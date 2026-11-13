// Daily needs in OpenStreetMap and the ODHF facility list, shared by the needs, doctors and hospitals stages.

import { overpass } from './apis.mjs';
import { BBOX } from './config.mjs';
import { cached, fetchBuf } from './io.mjs';
import { parseCSV } from './parse.mjs';

// Order matters: the app reads needs.json's `kinds` by index.
export const NEEDS_KINDS = [
  { id: 'grocery', test: (t) => /^(supermarket|grocery)$/.test(t.shop) },
  { id: 'pharmacy', test: (t) => t.amenity === 'pharmacy' || t.healthcare === 'pharmacy' },
  { id: 'school', test: (t) => t.amenity === 'school' },
  { id: 'bank', test: (t) => t.amenity === 'bank' },
  { id: 'fuel', test: (t) => t.amenity === 'fuel' && t.access !== 'private' },
  { id: 'library', test: (t) => t.amenity === 'library' },
  { id: 'post', test: (t) => t.amenity === 'post_office' },
  { id: 'clinic', test: (t) => /^(clinic|doctors)$/.test(t.amenity) || /^(clinic|doctor)$/.test(t.healthcare) },
];
export const needsOSM = () => overpass('sk-needs.json', `[out:json][timeout:300];(nwr["shop"~"^(supermarket|grocery)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});nwr["amenity"~"^(pharmacy|school|bank|fuel|library|post_office|clinic|doctors)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});nwr["healthcare"~"^(pharmacy|clinic|doctor)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);

// Statistics Canada's Open Database of Healthcare Facilities (shared by `hospitals` and `doctors`).
export const odhfRows = async () => parseCSV((await cached('raw/odhf.csv', () => fetchBuf('https://ftp.maps.canada.ca/pub/statcan_statcan/Health-care-facilities_Etablissement-de-sante/ODHF_BDOES/odhf_bdoes_v1.csv'))).toString('latin1')).filter((r) => r.province === 'sk');
// ODHF files health centres, clinics and primary-care teams under "Hospitals" too; many rural Saskatchewan "district
// health centres" are acute-care hospitals, so the source's type decides, and psychiatric and primary-care sites
// don't count as somewhere to go in an emergency.
export const odhfIsHospital = (r) => /hospital|hosptial|general|regional|tertiary|acute|integrated|district|emerg/i.test(`${r.source_facility_type} ${r.facility_name}`)
  && !/psychiatric/i.test(`${r.source_facility_type} ${r.facility_name}`)
  && !/primary health (care|team)|clinic|wellness|youth lodge/i.test(r.facility_name);
// ODHF names are lower case: capitalise words (not the letter after an apostrophe: "Children's"), keep short joining words low
export const odhfTitle = (s) => s.replace(/(^|[\s(\-/&[])([a-z])/g, (_, a, c) => a + c.toUpperCase()).replace(/\bAnd\b/g, 'and').replace(/\bOf\b/g, 'of').replace(/\(Ruh\)/, '(RUH)');
