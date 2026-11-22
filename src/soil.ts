// SOIL — what the land under an acreage or a farm is made of and good for: Agriculture and Agri-Food Canada's
// Saskatchewan detailed soil survey (SKSIDv4, 1:100,000), each polygon's capability for agriculture from the derived
// Thematic Soil Maps of Saskatchewan, and the Prairie Soil Zones. The `soil` stage writes the polygons into a PMTiles
// file (each carrying only its index `i`) and everything the index means into soil.json; at province scale the layer
// paints the zones as a continuous band (or a 3 km picture of the chosen colouring), past zoom 6.5 the polygons
// themselves. A click on a polygon digs a pit: the soil's horizons drawn down from the surface, with texture, organic
// carbon, pH and salt. The survey records no colour, so each horizon's is inferred from its great group and zone.
import * as d3 from 'd3';
import { BitmapLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { Data, Soil, SoilHorizon, SoilType } from './data';
import { esc, safeUrl } from './html';
import { AtlasEvent, AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine } from './layer-kit';
import { link, metric } from './report-kit';
import { reducedMotion } from './particles';

export const SOIL_COLOR = '#c08a52';
/** the zones, Brown → Gray, as the prairie's own colours lifted a little for a dark map */
export const ZONE_COLORS = ['#c69057', '#93653d', '#5d473a', '#8a8178', '#b9b4aa'];
/** the Soils colouring: Chernozems by great group, the other orders whole (index as the stage's `soilClasses`) */
const SOIL_CLASS_COLORS = ['#000000', '#c69057', '#93653d', '#5d473a', '#8a8178', '#c79ad6', '#d8cba8', '#e3c98f', '#5e93a8', '#d98c4a', '#3f7a4e', '#a3524f', '#7b7f88'];
/** capability classes 1–7, then organic */
export const CAP_COLORS = ['#2ecc71', '#9bd65a', '#e6d94a', '#f2a541', '#e8743b', '#c94f4f', '#8e3b5f', '#4c9a9a'];
export const CAP_TEXT = [
  'no significant limitations for crops',
  'moderate limitations that restrict the range of crops or need moderate conservation',
  'moderately severe limitations that restrict the range of crops or need special conservation',
  'severe limitations: a narrow range of crops, or special conservation, or both',
  'very severe limitations: perennial forage crops only, with improvement possible',
  'perennial forage only (grazing): improvement not feasible',
  'no capability for arable crops or permanent pasture',
  'organic soils (peat), not rated',
];
const TEX_COLORS = ['#000000', '#f3d98b', '#d9b26a', '#a7825a', '#8c6f8f', '#6b5fa8', '#3f7a4e'];
const SALT_COLORS = ['#000000', '#273450', '#46608a', '#6f8fbf', '#a2c0e6', '#d8e6f6', '#fff4c2', '#ffffff'];

type Mode = 'zone' | 'soil' | 'cap' | 'tex' | 'salt';
const MODES: { id: Mode; label: string }[] = [
  { id: 'zone', label: 'Soil zones' }, { id: 'soil', label: 'Soils' }, { id: 'cap', label: 'Farmland class' }, { id: 'tex', label: 'Texture' }, { id: 'salt', label: 'Salinity' },
];
/** below this zoom the province-scale pictures draw, above it the survey's polygons */
const TILES_FROM = 6.5;

// ---------------------------------------------------------------------------------------------
// reading the stage's columns

const b36 = (s: string, i: number) => parseInt(s[i], 36) || 0;
/** one polygon's attributes (the tiles' `i`) */
export type SoilPoly = { i: number; u: number; c: number; z: number; s: number; d: number; w: number; p: number; e: number; n: boolean };
export function soilPoly(S: Soil, i: number): SoilPoly | null {
  if (!(i >= 0) || i * 3 >= S.cols.u.length) return null;
  const C = S.cols;
  return { i, u: parseInt(C.u.substr(i * 3, 3), 36) - 1, c: b36(C.c, i), z: b36(C.z, i), s: b36(C.s, i), d: b36(C.d, i), w: b36(C.w, i), p: b36(C.p, i), e: b36(C.e, i), n: C.n[i] === '1' };
}
const soilName = (S: Soil, t: SoilType) => (t.k === 'N' ? 'not soil' : [t.sg ? S.subgroups[t.sg] : null, t.g ? S.groups[t.g] : t.o ? `${S.orders[t.o]} soil` : null].filter(Boolean).join(' ') || 'unclassified') + (t.k === 'U' ? ', undifferentiated' : '');
const titleSeries = (t: SoilType) => t.n.replace(/\b\p{L}/gu, (m) => m.toUpperCase());
const capLabel = (c: number) => (c >= 1 && c <= 7 ? `Class ${c}` : c === 8 ? 'Organic' : 'Not rated');
const unitTexCode = (S: Soil, u: number) => S.textures[S.units[u]?.[0]?.[2] ?? 0]?.[0] ?? 'UD';

// ---------------------------------------------------------------------------------------------
// the colour of a horizon, inferred (the survey records none): the A from the great group or the zone (humus darkens
// it from the Brown zone to the Black), eluviated horizons pale, B horizons brown, carbonate and salt layers pale and
// flecked, gleyed ones grey, peat dark brown

const ZONE_A = ['#7a5a3c', '#5a412c', '#2f2620', '#4a4038', '#6a5f52'];
const GROUP_A: Record<string, string> = { BC: ZONE_A[0], DBC: ZONE_A[1], BLC: ZONE_A[2], DGC: ZONE_A[3] };
function horizonColour(h: SoilHorizon, t: SoilType, zone: number) {
  const lab = h[0].replace(/^I+/, '');
  const m = /^(LFH|LF|LH|FH|AB|AC|BA|BC|CB|A|B|C|L|F|H|O|R|W)(.*)$/.exec(lab);
  const mas = m?.[1] ?? '', suf = m?.[2] ?? '';
  const a = (t.g && GROUP_A[t.g]) ?? ZONE_A[zone - 1] ?? '#5a4a3a';
  const mix = (c1: string, c2: string, k: number) => d3.interpolateRgb(c1, c2)(k);
  let c: string;
  if (/^(L|F|H|LF|LH|FH|LFH|O)$/.test(mas)) c = mas === 'L' ? '#5a4128' : '#33241a';
  else if (mas === 'R') c = '#6b6b70';
  else if (mas === 'W') c = '#2d4f6b';
  else if (mas.startsWith('A')) c = /e/.test(suf) && !/h/.test(suf) ? '#bdb5a6' : /e/.test(suf) ? mix(a, '#bdb5a6', 0.5) : mas === 'AB' || mas === 'AC' ? mix(a, '#8c6a48', 0.4) : a;
  else if (mas.startsWith('B')) c = /n/.test(suf) ? mix(a, '#4b3a2e', 0.6) : /t/.test(suf) ? '#7a573c' : /f/.test(suf) ? '#9a5a2a' : mix(a, '#8c6a48', 0.65);
  else c = /sa|s/.test(suf) ? '#c9c2ae' : /k|ca/.test(suf) ? '#b6a888' : '#a3906e';
  if (/g/.test(suf)) c = mix(c, '#7c8378', 0.45);
  return c;
}

// ---------------------------------------------------------------------------------------------
// the pit: a column grows down from the surface, horizon by horizon; beside it each horizon's texture and chemistry

function drawPit(el: HTMLElement, S: Soil, t: SoilType, zone: number) {
  const hz = t.h.filter((h) => h[2] > h[1] || h[1] > h[2]);
  if (!hz.length) { el.insertAdjacentHTML('beforeend', '<p class="note">The survey has no horizon data for this soil.</p>'); return; }
  // organic surface layers (L, F, H) are measured upward from the mineral surface: draw them above zero
  const rows = hz.map((h) => {
    const up = /^(L|F|H|LF|LH|FH|LFH)/.test(h[0]) && h[1] > h[2];
    return { h, top: up ? -h[1] : h[1], bot: up ? -h[2] : h[2] };
  }).sort((a, b) => a.top - b.top);
  const minD = Math.min(0, ...rows.map((r) => r.top)), maxD = Math.min(Math.max(...rows.map((r) => r.bot), 30), 200);
  const W = 340, colX = 26, colW = 86, top = 30, H = 300;
  const y = d3.scaleLinear().domain([minD, maxD]).range([top, top + H]);
  const rowH = Math.min(52, H / rows.length), rowX = colX + colW + 30;
  const rowY = (i: number) => top + (H - rowH * rows.length) / 2 + i * rowH;
  const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${top + H + 24}`).attr('width', '100%').attr('class', 'soil-pit').attr('role', 'img')
    .attr('aria-label', `Soil profile of ${t.n}: ${rows.map((r) => `${r.h[0]} ${r.top} to ${r.bot} cm`).join(', ')}`);
  const clipId = `pit-clip-${Math.random().toString(36).slice(2, 8)}`;
  const clip = svg.append('defs').append('clipPath').attr('id', clipId).append('rect').attr('x', colX - 2).attr('y', y(minD)).attr('width', colW + 4).attr('height', 0);
  // the ground either side of the pit, and grass (native) or stubble (cultivated)
  svg.append('rect').attr('x', 0).attr('y', y(0)).attr('width', colX - 6).attr('height', 3).attr('fill', '#6f8f4a').attr('opacity', 0.8);
  const surf = svg.append('g');
  for (let k = 0; k < 14; k++) {
    const x = colX + 3 + (k * (colW - 6)) / 13;
    surf.append('line').attr('x1', x).attr('x2', x + (t.n0 ? (k % 2 ? 2 : -2) : 0)).attr('y1', y(minD)).attr('y2', y(minD) - (t.n0 ? 7 + (k % 3) * 2 : 4))
      .attr('stroke', t.n0 ? '#7fa65a' : '#c9b070').attr('stroke-width', 1.3).attr('stroke-linecap', 'round');
  }
  svg.append('text').attr('x', colX + colW / 2).attr('y', 12).attr('text-anchor', 'middle').attr('fill', 'var(--ink-3)').attr('font-size', 10)
    .text(t.n0 ? 'native grassland or forest' : 'cultivated field');
  const col = svg.append('g').attr('clip-path', `url(#${clipId})`);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  rows.forEach((r) => {
    const y0 = y(r.top), y1 = y(r.bot), c = horizonColour(r.h, t, zone);
    col.append('rect').attr('x', colX).attr('y', y0).attr('width', colW).attr('height', Math.max(1, y1 - y0)).attr('fill', c);
    // sand grains (by the sand share), and carbonate or salt flecks
    const sand = r.h[3] ?? 0, lime = /k|ca/.test(r.h[0]) || (r.h[9] ?? 0) > 5, salt = /sa/.test(r.h[0]) || (r.h[8] ?? 0) >= 4;
    const n = Math.round(((y1 - y0) * colW * sand) / 9000);
    for (let k = 0; k < n; k++) col.append('circle').attr('cx', colX + rnd() * colW).attr('cy', y0 + rnd() * (y1 - y0)).attr('r', 0.7).attr('fill', '#e8dcc0').attr('opacity', 0.35);
    if (lime || salt) for (let k = 0; k < Math.round(((y1 - y0) * colW) / 260); k++) col.append('rect').attr('x', colX + rnd() * colW).attr('y', y0 + rnd() * (y1 - y0)).attr('width', 2.2).attr('height', 1.2).attr('fill', salt ? '#ffffff' : '#efe6cf').attr('opacity', salt ? 0.75 : 0.5);
    // roots in the upper layers
    if (r.top < 40) for (let k = 0; k < 3; k++) { const x = colX + 8 + rnd() * (colW - 16); col.append('path').attr('d', `M${x},${Math.max(y0, y(0))} q${(rnd() - 0.5) * 10},${(y1 - y0) / 2} ${(rnd() - 0.5) * 6},${Math.min(y1 - y0, 40)}`).attr('stroke', '#d9c7a0').attr('stroke-width', 0.6).attr('fill', 'none').attr('opacity', 0.35); }
    col.append('line').attr('x1', colX).attr('x2', colX + colW).attr('y1', y1).attr('y2', y1).attr('stroke', '#0b0f17').attr('stroke-opacity', 0.35);
  });
  col.append('rect').attr('x', colX).attr('y', y(minD)).attr('width', colW).attr('height', y(maxD) - y(minD)).attr('fill', 'none').attr('stroke', 'var(--line-strong)');
  // depth axis
  svg.append('g').attr('transform', `translate(${colX - 4},0)`).attr('class', 'axis').call(d3.axisLeft(y).ticks(6).tickSize(3).tickFormat((v) => `${v}`) as any)
    .call((g) => g.select('.domain').remove()).selectAll('text').attr('font-size', 9).attr('fill', 'var(--ink-3)');
  svg.append('text').attr('x', 2).attr('y', top + H + 18).attr('fill', 'var(--ink-3)').attr('font-size', 9).text('cm');
  // a row per horizon: name and depths, a sand / silt / clay bar, and organic carbon, pH and salt
  const g = svg.append('g');
  const barW = W - rowX - 4;
  const TEX = [['sand', '#e3c98f'], ['silt', '#b99a72'], ['clay', '#8c6f8f']] as const;
  const items = rows.map((r, i) => {
    const gy = rowY(i), mid = (y(r.top) + y(r.bot)) / 2;
    const it = g.append('g').attr('opacity', 0);
    it.append('path').attr('d', `M${colX + colW + 2},${mid} C${colX + colW + 16},${mid} ${rowX - 16},${gy + 9} ${rowX - 4},${gy + 9}`).attr('stroke', 'var(--line-strong)').attr('fill', 'none');
    it.append('rect').attr('x', rowX).attr('y', gy + 3).attr('width', 9).attr('height', 11).attr('rx', 2).attr('fill', horizonColour(r.h, t, zone)).attr('stroke', 'var(--line-strong)');
    it.append('text').attr('x', rowX + 14).attr('y', gy + 12).attr('fill', 'var(--ink)').attr('font-size', 11.5).attr('font-weight', 700).text(r.h[0]);
    it.append('text').attr('x', rowX + 14 + r.h[0].length * 7.5 + 6).attr('y', gy + 12).attr('fill', 'var(--ink-3)').attr('font-size', 10).text(`${r.top}–${r.bot} cm`);
    const [sa, si, cl] = [r.h[3], r.h[4], r.h[5]];
    if (rowH >= 30 && sa != null && si != null && cl != null && sa + si + cl > 0) {
      let x = rowX;
      const tot = sa + si + cl;
      [sa, si, cl].forEach((v, k) => { const w = (barW * v) / tot; it.append('rect').attr('x', x).attr('y', gy + 17).attr('width', Math.max(0, w - 0.5)).attr('height', 6).attr('fill', TEX[k][1]).append('title').text(`${TEX[k][0]} ${Math.round(v)}%`); x += w; });
    }
    const chem = [r.h[6] != null ? `OC ${r.h[6].toFixed(1)}%` : null, r.h[7] != null ? `pH ${r.h[7].toFixed(1)}` : null, r.h[8] != null ? `EC ${r.h[8].toFixed(1)}` : null].filter(Boolean).join(' · ');
    if (rowH >= 40 && chem) it.append('text').attr('x', rowX).attr('y', gy + 34).attr('fill', (r.h[8] ?? 0) >= 4 ? '#ffe9a8' : 'var(--ink-2)').attr('font-size', 9.5).text(chem);
    return it;
  });
  // the dig: the column opens downward, each horizon's row appearing as the pit reaches it
  const still = reducedMotion();
  const ms = still ? 0 : 1600;
  clip.transition().duration(ms).ease(d3.easeCubicOut).attr('height', y(maxD) - y(minD) + 4);
  items.forEach((it, i) => {
    const reach = (rows[i].top - minD) / (maxD - minD || 1);
    it.transition().delay(still ? 0 : 150 + reach * ms * 0.85).duration(still ? 0 : 380).attr('opacity', 1);
  });
  el.insertAdjacentHTML('beforeend', `<div class="legend" style="margin-top:4px">${TEX.map(([k, c]) => `<span><i class="sw" style="background:${c}"></i>${k}</span>`).join('')}<span>OC organic carbon · pH in CaCl₂ · EC salt (dS/m; 4+ is saline)</span></div>
    <p class="note" style="margin-top:6px"><b>Colour inferred:</b> the survey records no soil colour, so each layer is shaded from its horizon, great group and soil zone. Depths and lab values are the survey’s typical profile for the ${esc(titleSeries(t))} soil${t.n0 ? ' under native vegetation' : ' under cultivation'}, not a measurement at this spot.</p>`);
}

// ---------------------------------------------------------------------------------------------

export type PlaceSoil = { zone: number | null; sv: number; cap: number[] | null; good: number | null; dom: number | null; i: number | null; nk: number | null };
export function placeSoil(data: Data, key: string): PlaceSoil | null {
  const t = data.soil?.towns[key] ?? data.soil?.small?.[key];
  if (!data.soil || !t) return null;
  return { zone: t.z, sv: t.sv, cap: t.cap ?? null, good: t.good ?? null, dom: t.dom ?? null, i: t.i ?? null, nk: t.nk ?? null };
}

/** The pit's event: a click on a polygon (`lon`, `lat`), or a dig the panel or the Town Report asks for. */
export function pitEvent(S: Soil, i: number, lon: number, lat: number, where?: string): AtlasEvent | null {
  const p = soilPoly(S, i);
  if (!p) return null;
  const unit = p.u >= 0 ? S.units[p.u] : null;
  const top = unit ? S.types[unit[0][0]] : null;
  // the pit: the largest soil with a surveyed profile (an undifferentiated soil, a runway or a slough has none)
  const digC = unit?.find(([ti]) => S.types[ti].h.length && S.types[ti].k !== 'N') ?? null;
  const main = digC ? S.types[digC[0]] : top;
  const zoneName = p.z ? S.zones[p.z - 1] : null;
  const tex = unit ? S.textures[unit[0][2]]?.[1] : null;
  const capText = p.c >= 1 && p.c <= 8 ? CAP_TEXT[p.c - 1] : 'not rated for agriculture';
  const stats = [
    { v: capLabel(p.c), l: 'capability for agriculture' },
    ...(zoneName ? [{ v: zoneName, l: 'soil zone' }] : []),
    ...(tex && tex !== 'Undifferentiated' ? [{ v: tex, l: 'surface texture' }] : []),
    ...(main?.d ? [{ v: S.drainage[main.d].replace(/ drained$/, ''), l: 'drainage' }] : []),
  ];
  const water = !!top && top.k === 'N' && !digC;
  const title = p.n || water ? `Not soil: ${top && top.k === 'N' ? titleSeries(top).toLowerCase() : 'water or a pit'}` : main ? `${titleSeries(main)}: ${soilName(S, main)}` : 'Unsurveyed soil';
  const fell = !!digC && !!top && top !== main ? ` The largest part of this polygon (${unit![0][1]}%) is ${titleSeries(top).toLowerCase()} (${soilName(S, top)}), which has no typical profile in the survey; the pit is dug in the next, ${titleSeries(main!)} (${digC[1]}%).` : '';
  const body = p.n || water
    ? 'The survey maps this polygon as non-soil (a lake, a slough, a river, a gravel pit or mine spoil).'
    : `${where ? `${where}: ` : ''}${main ? `the soil here is ${titleSeries(main)}, ${/^[AEIOU]/.test(soilName(S, main)) ? 'an' : 'a'} ${soilName(S, main)}${main.m.length ? ` formed in ${main.m.map((m) => S.deposits[m].toLowerCase()).join(' over ')} material` : ''}.` : ''} Capability for agriculture: ${capLabel(p.c).toLowerCase()}, ${capText}.${fell}`;
  return {
    layer: 'soil', kind: 'Dig a pit', title, body, lon, lat, zoom: 10, stats, layers: ['soil'],
    sources: [{ label: 'Saskatchewan Detailed Soil Survey', url: S.sourceUrl }, { label: 'Thematic Soil Maps of Saskatchewan', url: S.capUrl }],
    detail(el) {
      if (main && !p.n && !water) drawPit(el, S, main, p.z);
      const rowsHtml: string[] = [];
      const row = (k: string, v: string) => rowsHtml.push(`<div class="metric"><div class="mk">${k}</div><div class="ms" style="color:var(--ink-2)">${v}</div></div>`);
      if (main) {
        if (main.m.length || main.pt || main.pc) row('Parent material', esc([main.m.map((m) => S.deposits[m]).join(' over '), [main.pt ? S.pmTex[main.pt] : null, main.pc ? S.pmChem[main.pc] : null].filter(Boolean).join(', ')].filter(Boolean).join(' · ')));
        if (main.r) row('Root-restricting layer', esc(S.restrict[main.r]));
      }
      if (p.s) row('Salinity', esc(p.s === 1 ? 'none mapped in the polygon' : `${S.saltExtent[p.s - 1]} of the polygon affected${p.d ? `, ${S.saltDegree[p.d - 1]}` : ''}${p.w ? `; on ${S.saltWhere[p.w - 1]}` : ''}`));
      if (p.p) row('Slope', esc(S.slopes[p.p - 1]));
      if (p.e) row('Water erosion risk', esc(S.erosion[p.e - 1]));
      if (rowsHtml.length) el.insertAdjacentHTML('beforeend', `<h3>The land here</h3><div class="metric-grid">${rowsHtml.join('')}</div>`);
      if (unit && unit.length > 1) {
        el.insertAdjacentHTML('beforeend', `<h3>This map unit is a mix</h3>
          <div class="crop-bar">${unit.map(([ti, pct], k) => `<i style="width:${pct}%;background:${SOIL_CLASS_COLORS[soilClassOf(S, S.types[ti])]};opacity:${1 - k * 0.12}" title="${esc(titleSeries(S.types[ti]))} ${pct}%"></i>`).join('')}</div>
          <ol class="rank-list">${unit.map(([ti, pct, tx]) => { const s = S.types[ti]; return `<li><span class="rk">${pct}%</span><span><span class="nm">${esc(titleSeries(s))}</span><br><span class="rd">${esc(soilName(S, s))}${S.textures[tx] && S.textures[tx][0] !== 'UD' ? ` · ${esc(S.textures[tx][1].toLowerCase())}` : ''}${s.d ? ` · ${esc(S.drainage[s.d].toLowerCase())}` : ''}</span></span><span></span></li>`; }).join('')}</ol>
          <p class="note">At 1:100,000 a polygon holds several soils that the survey could not draw apart (on a knoll, its slope and the slough below it); the pit shows the largest.</p>`);
      }
    },
  };
}
const soilClassOf = (S: Soil, t: SoilType) => (t.o === 'CH' ? Math.max(0, ['BC', 'DBC', 'BLC', 'DGC'].indexOf(t.g ?? '')) + 1 : ({ SZ: 5, LU: 6, RG: 7, GL: 8, BR: 9, OR: 10, VE: 11 } as Record<string, number>)[t.o ?? ''] ?? S.soilClasses.length - 1);

export function soilLayer(data: Data): AtlasLayer {
  const color = SOIL_COLOR;
  const S = data.soil;
  let mode: Mode = 'zone';
  let dug = -1;
  const fileUrl = S ? new URL(`data/${S.file}`, new URL(import.meta.env.BASE_URL, location.href)).href : '';

  // the polygons: deck.gl's MVTLayer, the PMTiles reader and the vector-tile parser are fetched the first time the map
  // is close enough for them, so the first load carries none of it
  let lib: { MVTLayer: any; archive: any; parse: any; MVTLoader: any } | null = null;
  let loading = false;
  const load = () => {
    if (loading || !S) return;
    loading = true;
    Promise.all([import('@deck.gl/geo-layers'), import('pmtiles'), import('@loaders.gl/core'), import('@loaders.gl/mvt')])
      .then(([g, pm, core, mvt]) => { lib = { MVTLayer: g.MVTLayer, archive: new pm.PMTiles(fileUrl), parse: core.parse, MVTLoader: mvt.MVTLoader }; })
      .catch(() => { loading = false; }); // a network blip: asked again next frame
  };
  const fetchTile = async (url: string, { loadOptions, signal }: { loadOptions?: any; signal?: AbortSignal }) => {
    const m = /(\d+)\/(\d+)\/(\d+)$/.exec(url);
    if (!m || !lib) return null;
    const r = await lib.archive.getZxy(+m[1], +m[2], +m[3], signal);
    return r?.data ? lib.parse(r.data, lib.MVTLoader, { ...loadOptions, core: { ...loadOptions?.core, worker: false } }) : null;
  };

  // per colouring, each polygon's colour (RGBA), worked out once
  const fills = new Map<Mode, Uint8ClampedArray>();
  const classPal = (m: Mode) => (m === 'zone' ? ['#000', ...ZONE_COLORS] : m === 'soil' ? SOIL_CLASS_COLORS : m === 'cap' ? ['#000', ...CAP_COLORS] : m === 'tex' ? TEX_COLORS : SALT_COLORS);
  const fillFor = (m: Mode) => {
    let f = fills.get(m);
    if (f || !S) return f ?? new Uint8ClampedArray(0);
    const n = S.cols.c.length;
    f = new Uint8ClampedArray(n * 4);
    const pal = classPal(m).map((c) => rgb(c));
    for (let i = 0; i < n; i++) {
      const p = soilPoly(S, i)!;
      const k = p.n ? 0 : m === 'zone' ? p.z : m === 'cap' ? p.c : m === 'salt' ? p.s : p.u < 0 ? 0 : b36(m === 'soil' ? S.unitClass : S.unitTex, p.u);
      const c = pal[k] ?? pal[0];
      f.set(k ? [c[0], c[1], c[2], m === 'salt' && k === 1 ? 70 : 255] : p.n ? [58, 110, 165, 200] : [0, 0, 0, 0], i * 4);
    }
    fills.set(m, f);
    return f;
  };
  // the province-scale pictures: the zones (2 km) and each colouring's 3 km grid
  const pics = new Map<string, HTMLCanvasElement>();
  const decode = (map: string, n: number) => {
    const a = new Uint8Array(n);
    let k = 0;
    for (const [, c, ch] of map.matchAll(/(\d*)([a-z])/g)) a.fill(ch.charCodeAt(0) - 97, k, (k += c ? +c : 1));
    return a;
  };
  const grids = new Map<string, Uint8Array>();
  const gridOf = (m: Mode) => {
    if (!S) return null;
    let a = grids.get(m);
    if (!a) { a = m === 'zone' ? decode(S.zoneGrid.map, S.zoneGrid.w * S.zoneGrid.h) : decode(S.grid.maps[m], S.grid.w * S.grid.h); grids.set(m, a); }
    return a;
  };
  const picture = (m: Mode) => {
    let cv = pics.get(m);
    if (cv || !S) return cv ?? null;
    const g = m === 'zone' ? S.zoneGrid : S.grid, a = gridOf(m)!;
    const pal = classPal(m).map((c, k) => (k ? rgb(c, m === 'salt' && k === 1 ? 70 : 255) : [0, 0, 0, 0]));
    cv = document.createElement('canvas');
    cv.width = g.w; cv.height = g.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(g.w, g.h);
    for (let k = 0; k < a.length; k++) img.data.set(pal[a[k]] ?? [0, 0, 0, 0], k * 4);
    ctx.putImageData(img, 0, 0);
    pics.set(m, cv);
    return cv;
  };
  const R = 6378137;
  const cellAt = (g: Soil['grid'] | Soil['zoneGrid'], lon: number, lat: number) => {
    const x = (R * lon * Math.PI) / 180, yy = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const c = Math.floor((x - g.x0) / g.px), r = Math.floor((g.y1 - yy) / g.px);
    return c >= 0 && c < g.w && r >= 0 && r < g.h ? r * g.w + c : -1;
  };
  const legendItems = (m: Mode) => {
    if (!S) return [];
    if (m === 'zone') return S.zones.map((z, k) => [ZONE_COLORS[k], z]);
    if (m === 'soil') return S.soilClasses.slice(1).map((c, k) => [SOIL_CLASS_COLORS[k + 1], c]);
    if (m === 'cap') return CAP_COLORS.map((c, k) => [c, k < 7 ? `Class ${k + 1}` : 'Organic']);
    if (m === 'tex') return S.texGroups.slice(1).map((c, k) => [TEX_COLORS[k + 1], c]);
    return S.saltExtent.map((c, k) => [SALT_COLORS[k + 1], k ? `${c} of the land saline` : 'none mapped']);
  };

  // a dig the panel or the Town Report asks for (a button with data-soil-pit="<polygon>" and the place's name)
  if (S)
    document.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest?.<HTMLElement>('[data-soil-pit]');
      if (!b) return;
      const i = +b.dataset.soilPit!, lon = +(b.dataset.lon ?? NaN), lat = +(b.dataset.lat ?? NaN);
      const ev = Number.isFinite(lon) ? pitEvent(S, i, lon, lat, b.dataset.where) : null;
      if (!ev) return;
      dug = i;
      window.dispatchEvent(new CustomEvent('atlas:event', { detail: ev }));
    });

  const pct = (v: number | undefined) => (v == null ? '–' : `${Math.round(v)}%`);

  const l: AtlasLayer = {
    id: 'soil',
    name: 'Soil',
    icon: '🟫',
    color,
    range: [2018, 2018.99],
    static: true,
    period: 'detailed soil survey, 1:100,000',
    available: !!S && S.types.length > 0,
    unavailable: 'The soil survey could not be read when this copy of the data was built. Run <code>npm run data soil</code>, then reload.',
    build({ focusedId, view }) {
      if (!S) return [];
      const focused = focusedId === 'soil';
      const close = view.zoom >= TILES_FROM;
      const out: Layer[] = [];
      const zg = S.zoneGrid, gg = S.grid;
      // the zones sweep under everything in their colouring; another colouring's picture shows until the polygons load
      if (mode === 'zone')
        out.push(new BitmapLayer({
          id: 'soil-zones-base', image: picture('zone'), bounds: zg.bounds as [number, number, number, number],
          textureParameters: { minFilter: 'linear', magFilter: 'linear' }, opacity: close ? 0.45 : focused ? 0.85 : 0.65,
          pickable: true, parameters: NO_DEPTH, updateTriggers: { image: mode },
        } as any));
      else if (!close || !lib)
        out.push(new BitmapLayer({
          id: 'soil-grid-base', image: picture(mode), bounds: gg.bounds as [number, number, number, number],
          textureParameters: { minFilter: 'nearest', magFilter: 'nearest' }, opacity: focused ? 0.85 : 0.65,
          pickable: true, parameters: NO_DEPTH, updateTriggers: { image: mode },
        } as any));
      if (close) {
        load();
        if (lib) {
          const fill = fillFor(mode);
          const a = mode === 'zone' ? (focused ? 150 : 110) : focused ? 215 : 160;
          out.push(new lib.MVTLayer({
            id: 'soil-base',
            data: 'soil://{z}/{x}/{y}',
            minZoom: S.minzoom, maxZoom: S.maxzoom,
            fetch: fetchTile,
            loadOptions: { core: { worker: false } },
            uniqueIdProperty: 'i',
            highlightedFeatureId: dug >= 0 ? dug : null,
            autoHighlight: true, highlightColor: [255, 244, 214, 90],
            filled: true, stroked: true,
            getFillColor: (f: any) => { const k = f.properties.i * 4; return [fill[k], fill[k + 1], fill[k + 2], (fill[k + 3] * a) / 255]; },
            getLineColor: mode === 'zone' ? [240, 230, 210, 60] : [10, 12, 18, 110],
            lineWidthUnits: 'pixels', getLineWidth: 0.6,
            pickable: true, parameters: NO_DEPTH,
            updateTriggers: { getFillColor: [mode, focused], getLineColor: mode },
          }));
        }
      }
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Around the property · AAFC soil survey')}<h2>What is the land good for?</h2>`;
      if (!S) { el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`); return { update() {} }; }
      const P = S.prov;
      const good = P.cap[1] + P.cap[2] + P.cap[3];
      const bigZone = P.zone.slice(1).reduce((b, v, k, arr) => (v > arr[b] ? k : b), 0);
      const saline = P.salt.slice(3).reduce((s, v) => s + v, 0);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Saskatchewan’s soil survey mapped the farm belt polygon by polygon, ${P.polys.toLocaleString('en-CA')} of them: what each soil is, how it drains, what it formed in, and its layers down to a metre or more. From the dry Brown soils of the southwest to the Black soils of the parkland and the Gray soils of the forest edge, the colour follows the climate: more rain, more grass, more humus. <b>Click any polygon (zoom in a little) to dig a pit.</b></p>
        <div class="chips" style="margin:2px 0 10px">${MODES.map((m) => `<button class="chip" data-m="${m.id}" style="--c:${color}">${m.label}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      hero(0, pct(good), 'of the surveyed land is class 1–3, good for annual crops');
      hero(1, pct(P.zone[bigZone + 1]), `in the ${S.zones[bigZone]} zone, the largest`);
      hero(2, `${Math.round(P.km2 / 1000).toLocaleString('en-CA')}k`, 'km² surveyed');
      hero(3, pct(saline), 'in polygons with saline patches on a tenth or more of the land');
      const legend = el.appendChild(mk('div'));
      const drawLegend = () => {
        legend.innerHTML = `<div class="legend" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${legendItems(mode).map(([c, t]) => `<span><i class="sw" style="background:${c}"></i>${esc(t)}</span>`).join('')}</div>
          ${mode === 'cap' ? `<p class="note" style="margin-top:6px">Capability for agriculture: how well the land suits annual field crops without irrigation, from class 1 (no significant limitations) to class 7 (none). Limits are the soil’s and the land’s (climate, slope, stones, salinity, wetness), not its present use.</p>` : ''}
          ${mode === 'salt' ? `<p class="note" style="margin-top:6px">The survey’s salinity rating: the share of a polygon with saline soil (white crusts, kochia and foxtail barley in the low spots), and how saline. Most saline patches ring sloughs and sit in the bottoms of depressions.</p>` : ''}
          ${mode === 'zone' ? `<p class="note" style="margin-top:6px">The zones are AAFC’s generalised map of the prairie’s soil climates; zoom in for the survey’s own polygons.</p>` : ''}`;
      };
      drawLegend();
      // capability by zone
      el.insertAdjacentHTML('beforeend', `<h3>Farmland class, by soil zone</h3>
        <div class="soil-zc">${S.zones.map((z, k) => `<div style="display:grid;grid-template-columns:84px 1fr 44px;gap:8px;align-items:center;margin:4px 0;font-size:11.5px"><span style="color:var(--ink-2)"><i class="sw" style="background:${ZONE_COLORS[k]};display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px"></i>${esc(z)}</span>
          <div class="crop-bar" style="margin:0">${P.zoneCap[k].slice(1).map((v, c) => (v > 0 ? `<i style="width:${v}%;background:${CAP_COLORS[c]}" title="${c < 7 ? `Class ${c + 1}` : 'Organic'}: ${v}%"></i>` : '')).join('')}</div>
          <span style="color:var(--ink-3);text-align:right">${pct(P.zone[k + 1])}</span></div>`).join('')}
        <div class="legend" style="margin-top:6px">${CAP_COLORS.map((c, k) => `<span><i class="sw" style="background:${c}"></i>${k < 7 ? k + 1 : 'O'}</span>`).join('')}<span style="color:var(--ink-3)">right: the zone’s share of the surveyed land</span></div></div>`);
      // What grows here, by class
      const Cr = S.crops;
      if (Cr && Cr.byCap.some(Boolean))
        el.insertAdjacentHTML('beforeend', `<h3>What grows on each class, ${Cr.year}</h3>
          <div>${Cr.byCap.slice(1).map((r, c) => (r ? `<div style="display:grid;grid-template-columns:84px 1fr 40px;gap:8px;align-items:center;margin:3px 0;font-size:11.5px"><span style="color:var(--ink-2)">${c < 7 ? `Class ${c + 1}` : 'Organic'}</span><div class="crop-bar" style="margin:0"><i style="width:${r[0]}%;background:#e6c35a" title="cropped ${r[0]}%"></i><i style="width:${r[1]}%;background:#8ab17d" title="pasture and forage ${r[1]}%"></i><i style="width:${r[2]}%;background:#8d7b5a" title="grassland and shrub ${r[2]}%"></i><i style="width:${r[3]}%;background:#4a5670" title="other ${r[3]}%"></i></div><span style="color:var(--ink-3);text-align:right">${r[0]}%</span></div>` : '')).join('')}</div>
          <div class="legend" style="margin-top:6px"><span><i class="sw" style="background:#e6c35a"></i>cropped</span><span><i class="sw" style="background:#8ab17d"></i>pasture and forage</span><span><i class="sw" style="background:#8d7b5a"></i>grassland and shrub</span><span><i class="sw" style="background:#4a5670"></i>other (forest, wetland, water, built)</span></div>
          <p class="note" style="margin-top:6px">The Annual Crop Inventory’s ${Cr.year} map (What grows here), each ~2 km square at its most common class, set on the class of the soil polygon under the square’s centre. The better the class, the more of it is cropped; the poorer, the more is left in grass.</p>
          <div class="tr-falls" style="margin-top:6px">${link('crops', '🌱 What grows here on the map')}</div>`);
      // example digs: the largest place in each zone whose centre the survey covers
      const byZone = S.zones.map((_, k) => data.munis.filter((m) => S.towns[m.key]?.z === k && S.towns[m.key]?.i != null)[0] ?? null);
      if (byZone.some(Boolean))
        el.insertAdjacentHTML('beforeend', `<h3>Dig a pit</h3><p class="note" style="margin-top:0">Or start under a town in each zone:</p>
          <div class="tr-falls">${byZone.map((m, k) => (m ? `<button class="tr-fall" type="button" data-soil-pit="${S.towns[m.key].i}" data-lon="${m.lon}" data-lat="${m.lat}" data-where="${S.towns[m.key].nk != null ? 'Near' : 'Under'} ${esc(m.name)}">⛏ ${esc(m.name)} · ${esc(S.zones[k])} ›</button>` : '')).join('')}</div>`);
      el.insertAdjacentHTML('beforeend', `
        <p class="note"><b>What the map is.</b> A 1:100,000 survey, compiled over decades of field work into CanSIS’s SKSIDv4: lines are good to about 50 m, and each polygon is a map unit, a mix of soils the survey could not draw apart; the colours and the pit show the largest. Horizons and lab values are the typical profile of each named soil, not a test of a given field. Capability for agriculture comes from the derived Thematic Soil Maps of Saskatchewan (the same polygons, matched by shape); the north beyond the farm belt was not surveyed at this scale. No source records soil colour: the pit’s colours are inferred from each horizon, the great group and the zone.</p>
        <p class="note">A soil test still beats any map: for a farm or an acreage, a lab analysis (and for a septic field, a percolation test) tells about the land itself.</p>
        ${sourceLine(`${S.source}; ${S.capSource}; ${S.zoneSource}. ${S.licence}.`)}
        <p class="note"><a href="${esc(safeUrl(S.sourceUrl) ?? '#')}" target="_blank" rel="noopener">Soil survey</a> · <a href="${esc(safeUrl(S.capUrl) ?? '#')}" target="_blank" rel="noopener">thematic maps</a> · <a href="${esc(safeUrl(S.zoneUrl) ?? '#')}" target="_blank" rel="noopener">soil zones</a></p>`);
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m as Mode | undefined;
        if (!k || k === mode) return;
        mode = k;
        drawLegend();
        el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((btn) => btn.classList.toggle('on', btn.dataset.m === mode));
      });
      el.querySelector<HTMLButtonElement>(`[data-m="${mode}"]`)?.classList.add('on');
      return { update() {} };
    },
    tooltip(info) {
      if (!S) return null;
      const id = info.layer?.id ?? '';
      if (id === 'soil-base') {
        const p = soilPoly(S, (info.object as any)?.properties?.i);
        if (!p) return null;
        if (p.n) return '<b>Not soil</b> <span class="tk">water, a gravel pit or mine spoil</span>';
        const t = p.u >= 0 ? S.types[S.units[p.u][0][0]] : null;
        const row = (k: string, v: string) => `<br><span class="tk">${k}</span> <span class="tv">${v}</span>`;
        return `<b>${t ? esc(titleSeries(t)) : 'Unsurveyed'}</b>${t ? ` <span class="tk">${esc(soilName(S, t))}</span>` : ''}`
          + row('Farmland', esc(capLabel(p.c)))
          + (p.z ? row('Zone', esc(S.zones[p.z - 1])) : '')
          + (p.u >= 0 && unitTexCode(S, p.u) !== 'UD' ? row('Texture', esc(S.textures[S.units[p.u][0][2]][1])) : '')
          + (p.s > 2 ? row('Saline', esc(`${S.saltExtent[p.s - 1]} of the land`)) : '')
          + '<br><span class="tk">Click to dig a pit</span>';
      }
      if (id === 'soil-zones-base' || id === 'soil-grid-base') {
        const [lon, lat] = info.coordinate ?? [];
        if (lon == null) return null;
        const zoneMode = id === 'soil-zones-base';
        const g = zoneMode ? S.zoneGrid : S.grid;
        const k = cellAt(g, lon, lat), a = gridOf(zoneMode ? 'zone' : mode);
        if (k < 0 || !a || !a[k]) return null;
        const v = a[k];
        const name = zoneMode ? `${S.zones[v - 1]} soil zone` : mode === 'soil' ? S.soilClasses[v] : mode === 'cap' ? capLabel(v) : mode === 'tex' ? S.texGroups[v] : `Saline: ${S.saltExtent[v - 1]}`;
        return `<b>${esc(name)}</b>${zoneMode ? '' : ' <span class="tk">most of this ~2 km square</span>'}<br><span class="tk">Zoom in to the polygons to dig a pit</span>`;
      }
      return null;
    },
    describe(info: PickingInfo) {
      if (!S || info.layer?.id !== 'soil-base') return null;
      const i = (info.object as any)?.properties?.i;
      const [lon, lat] = (info.coordinate as [number, number] | undefined) ?? [];
      if (i == null || lon == null || lat == null) return null;
      dug = i;
      return pitEvent(S, i, lon, lat);
    },
  };
  return l;
}

// ---- the Town Report section (src/panels.ts places it)

/** Soil: the zone at the centre, the land within the radius by capability class, the soil under the centre, and a dig. */
export function soilRows(p: PlaceSoil, data: Data, m: { name: string; lon: number; lat: number }) {
  const S = data.soil!;
  const poly = p.i != null ? soilPoly(S, p.i) : null;
  const comp = poly && poly.u >= 0 && !poly.n ? S.units[poly.u].find(([ti]) => S.types[ti].h.length && S.types[ti].k !== 'N') : null;
  const t = comp ? S.types[comp[0]] : null;
  const capBar = p.cap ? `<div class="crop-bar">${p.cap.map((v, c) => (v > 0 ? `<i style="width:${v}%;background:${CAP_COLORS[c]}" title="${c < 7 ? `Class ${c + 1}` : 'Organic'}: ${v}%"></i>` : '')).join('')}</div>
    <div class="legend" style="margin-top:4px">${p.cap.map((v, c) => (v >= 5 ? `<span><i class="sw" style="background:${CAP_COLORS[c]}"></i>${c < 7 ? `Class ${c + 1}` : 'Organic'} ${v}%</span>` : '')).join('')}</div>` : '';
  return `<h3>Soil</h3>
    <div class="metric-grid">
      ${p.zone != null ? metric('Soil zone', ZONE_COLORS[p.zone], esc(S.zones[p.zone]), 'at the town centre (AAFC’s Prairie Soil Zones)') : metric('Soil zone', '#7d8aa3', 'Beyond', 'north of the prairie soil zones')}
      ${p.good != null ? metric('Good farmland', CAP_COLORS[p.good >= 50 ? 1 : p.good >= 25 ? 3 : 5], `${p.good}%`, `of the rated land within ${S.radiusKm} km is class 1–3${p.dom ? ` · most is class ${p.dom}: ${CAP_TEXT[p.dom - 1]}` : ''}`) : metric('Good farmland', '#7d8aa3', '<span style="color:var(--ink-3)">n/a</span>', p.sv ? `the survey covers only ${p.sv}% of the land within ${S.radiusKm} km` : 'outside the detailed soil survey')}
      ${t && comp ? metric(p.nk != null ? 'Nearest soil' : 'Under the centre', SOIL_CLASS_COLORS[soilClassOf(S, t)], esc(titleSeries(t)), `${esc(soilName(S, t))}${S.textures[comp[2]] && S.textures[comp[2]][0] !== 'UD' ? `, ${esc(S.textures[comp[2]][1].toLowerCase())}` : ''}${t.d ? ` · ${esc(S.drainage[t.d].toLowerCase())}` : ''}${p.nk != null ? ` · ${p.nk} km from the centre (the centre is mapped as urban land or water)` : ''}`) : ''}
    </div>
    ${capBar}
    <p class="note" style="margin-top:6px">Capability for agriculture, class 1 (no significant limits for crops) to 7 (none), from the province’s 1:100,000 soil survey; a town’s own lots are often mapped as the soil they were built on. A lab test tells about a given field.</p>
    <div class="tr-falls" style="margin-top:8px">${t && p.i != null ? `<button class="tr-fall" type="button" data-soil-pit="${p.i}" data-lon="${m.lon}" data-lat="${m.lat}" data-where="${p.nk != null ? `Near ${esc(m.name)}` : `Under ${esc(m.name)}`}">⛏ Dig a pit here ›</button>` : ''}${link('soil', '🟫 Soil on the map')}</div>`;
}

/** The small-community report's one line. */
export const soilLine = (p: PlaceSoil, data: Data) => {
  const S = data.soil!;
  const z = p.zone != null ? `${S.zones[p.zone]} zone` : 'north of the soil zones';
  return { v: p.good != null ? `${p.good}%` : '—', sub: `${p.good != null ? `of the rated land within ${S.radiusKm} km is class 1–3 farmland · ` : ''}${esc(z)}` };
};
