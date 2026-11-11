// The places Living Skies Atlas compares: Saskatchewan's cities, its larger towns, and the northern villages
// that anchor the north. This name list is the only hand-typed data in the atlas. Coordinates are not typed:
// the `places` stage looks each name up in the Canadian Geographical Names Database (CGNDB), and population,
// crime and drive times are joined by `key`, a normalized name.
//
// `geo` overrides the name searched in the CGNDB where it differs from the display name; `kinds` lists the
// CGNDB feature types to accept (city, town, village, northern village…).

export const PLACES_LIST = [
  // cities
  { name: 'Regina' }, { name: 'Saskatoon' }, { name: 'Prince Albert' }, { name: 'Moose Jaw' },
  { name: 'Swift Current' }, { name: 'Yorkton' }, { name: 'North Battleford' }, { name: 'Estevan' },
  { name: 'Weyburn' }, { name: 'Lloydminster' }, { name: 'Warman' }, { name: 'Martensville' },
  { name: 'Melfort' }, { name: 'Humboldt' }, { name: 'Meadow Lake' }, { name: 'Melville' },
  // towns, south
  { name: 'Maple Creek' }, { name: 'Shaunavon' }, { name: 'Assiniboia' }, { name: 'Gravelbourg' },
  { name: 'Carlyle' }, { name: 'Oxbow' }, { name: 'Carnduff' }, { name: 'Moosomin' },
  { name: 'Indian Head' }, { name: "Fort Qu'Appelle", geo: "Fort Qu'Appelle" }, { name: 'White City' }, { name: 'Pilot Butte' },
  { name: 'Balgonie' }, { name: 'Lumsden' }, { name: 'Esterhazy' }, { name: 'Langenburg' },
  // towns, central
  { name: 'Kindersley' }, { name: 'Rosetown' }, { name: 'Outlook' }, { name: 'Biggar' },
  { name: 'Unity' }, { name: 'Kerrobert' }, { name: 'Battleford' }, { name: 'Davidson' },
  { name: 'Watrous' }, { name: 'Lanigan' }, { name: 'Wynyard' }, { name: 'Wadena' },
  { name: 'Canora' }, { name: 'Kamsack' }, { name: 'Preeceville' }, { name: 'Rosthern' },
  { name: 'Shellbrook' }, { name: 'Spiritwood' }, { name: 'Tisdale' }, { name: 'Nipawin' },
  { name: 'Hudson Bay' },
  // the north
  { name: 'La Ronge' }, { name: 'Creighton' }, { name: 'Beauval' }, { name: 'Île-à-la-Crosse', geo: 'Île-à-la-Crosse' },
  { name: 'Buffalo Narrows' }, { name: 'La Loche' }, { name: 'Pinehouse' }, { name: 'Cumberland House' },
  { name: 'Sandy Bay' },
];

/** The key every table is joined on: lower case, accents and punctuation folded, "City of" and the like dropped. */
export function normalizeName(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\((city|town|village|northern village|rm|cy|t|vl|nv|nh|rv)\)/g, '')
    .replace(/^(city|town|village|northern village|resort village) of /, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const PLACE_KEYS = new Set(PLACES_LIST.map((p) => normalizeName(p.name)));
