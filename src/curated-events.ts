// Hand-typed timeline events: well-documented facts only, each with a source link (CLAUDE.md, Rules).
import { TimedEvent } from './layer-kit';

// CURATED EVENTS — moments the data alone doesn't name. Kept to well-documented facts; each links to a source.
export const CURATED_EVENTS: TimedEvent[] = [
  {
    t: 1874.71, layer: '*', kind: 'Treaty', title: '1874 — Treaty 4 signed at Fort Qu’Appelle',
    body: 'Cree, Saulteaux and Assiniboine leaders and the Crown sign Treaty 4 at Fort Qu’Appelle on 15 September 1874, covering most of what is now southern Saskatchewan.',
    lon: -103.79, lat: 50.77, zoom: 7,
    sections: [{ title: 'Why it matters on this map', text: 'Most of the reserves in the south of the province were set aside under Treaty 4. Its terms, including the promises read out at the signing, are still the subject of claims and negotiation today. Turn on Treaties & reserves to see the treaty areas.' }],
    sources: [{ label: 'Treaty 4 (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/treaty-4' }],
    layers: ['treaties'],
  },
  {
    t: 1876.64, layer: '*', kind: 'Treaty', title: '1876 — Treaty 6 signed at Fort Carlton',
    body: 'Plains and Woods Cree, Assiniboine and other nations sign Treaty 6 at Fort Carlton in August 1876 and at Fort Pitt that September. It covers the centre of the province.',
    lon: -106.53, lat: 52.87, zoom: 7,
    sections: [{ title: 'The medicine chest', text: 'Treaty 6 is the only numbered treaty with a “medicine chest” clause, which First Nations have long held to mean a promise of health care.' }],
    sources: [{ label: 'Treaty 6 (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/treaty-6' }],
    layers: ['treaties'],
  },
  {
    t: 1885.88, layer: '*', kind: 'Justice', title: '1885 — Louis Riel tried and hanged in Regina',
    body: 'After the North-West Resistance ended at Batoche in May 1885, Métis leader Louis Riel was tried for high treason in Regina that summer, convicted, and hanged there on 16 November 1885.',
    lon: -104.61, lat: 50.45, zoom: 8,
    sections: [
      { title: 'A trial still argued over', text: 'Riel was tried before a magistrate and a jury of six English-speaking Protestants; the jury recommended mercy, which was refused. Eight Cree and Assiniboine men were hanged at Battleford later that month, in Canada’s largest mass execution.' },
    ],
    sources: [{ label: 'Louis Riel (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/louis-riel' }],
    layers: ['justice', 'treaties'],
  },
  {
    t: 1905.67, layer: '*', title: '1905 — Saskatchewan becomes a province',
    body: 'Saskatchewan and Alberta are carved from the North-West Territories on 1 September 1905, with Regina as Saskatchewan’s capital.',
    lon: -105.9, lat: 52.5, zoom: 5,
    sources: [{ label: 'Saskatchewan (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/saskatchewan' }],
    layers: ['population'],
  },
  {
    t: 1912.5, layer: '*', kind: 'Tornado', title: '1912 — The Regina Cyclone',
    body: 'On 30 June 1912 a tornado cut through downtown Regina, killing 28 people: still the deadliest tornado in Canadian history.',
    lon: -104.61, lat: 50.45, zoom: 10,
    sections: [{ title: 'Before the record begins', text: 'The national tornado database on this map starts in 1980, so the Regina Cyclone is not one of its tracks. Turn on Tornadoes to see how often they touch down across the south.' }],
    sources: [{ label: 'Regina Cyclone (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/regina-cyclone' }],
    layers: ['tornadoes'],
  },
  {
    t: 1927.2, layer: '*', kind: 'Parks', title: '1927 — Prince Albert National Park is created',
    body: 'Canada sets aside Prince Albert National Park in the boreal forest north of Prince Albert in 1927: Saskatchewan’s first national park and still its largest park of any kind.',
    lon: -106.2, lat: 53.95, zoom: 8,
    sections: [{ title: 'Grey Owl’s cabin', text: 'The writer and conservationist Grey Owl lived at Ajawaan Lake in the park from 1931 until his death in 1938; his cabin is still reached by trail or canoe. Turn on Camping & rec to see the park’s campgrounds and light the campfires from Prince Albert.' }],
    sources: [{ label: 'Prince Albert National Park (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Prince_Albert_National_Park' }],
    layers: ['camping'],
  },
  {
    t: 2011.45, layer: '*', kind: 'Flood', title: '2011 — The Souris River floods',
    body: 'A wet spring and heavy June rains send the Souris River to record flows; Roche Percée and low-lying parts of Estevan flood, and the flood carries on downstream into North Dakota.',
    lon: -102.8, lat: 49.12, zoom: 9,
    sources: [{ label: '2011 Souris River flood (Wikipedia)', url: 'https://en.wikipedia.org/wiki/2011_Souris_River_flood' }],
    layers: ['rivers'],
  },
  {
    t: 2015.5, layer: '*', kind: 'Wildfire', title: '2015 — The north burns',
    body: 'Hundreds of fires burn across northern Saskatchewan in late June and July 2015; La Ronge, Air Ronge and the Lac La Ronge Indian Band are among the communities evacuated, in one of the largest evacuations in the province’s history.',
    lon: -105.3, lat: 55.1, zoom: 7,
    sources: [{ label: '2015 Saskatchewan wildfires (Wikipedia)', url: 'https://en.wikipedia.org/wiki/2015_Saskatchewan_wildfires' }],
    layers: ['fires'],
  },
];
