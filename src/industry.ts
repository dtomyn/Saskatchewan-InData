// HIDDEN NEIGHBOURS — the industry an acreage buyer might not notice from the road: oil and gas wells (active, suspended
// and abandoned) and facilities, binned into ~4 km hexagons; provincially licensed pipelines (sour gas picked out) and the
// federally regulated transmission lines; the industrial facilities that report releases to the National Pollutant
// Release Inventory; and the producing mines. Each place counts what lies within a few km of its town limits. Neutral
// on purpose: the same wells, plants and mines are where many of the province's jobs are. A static layer.
// The power grid shares it: transmission lines, substations and generating stations as mapped in OpenStreetMap (the
// `power` stage; SaskPower publishes no open map, so coverage is partial). Two chips switch oil and gas or the grid off.
// Power lines are dashed so they never read as pipelines.
import * as d3 from 'd3';
import { ColumnLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { fmt } from './data';
import type { Data, IndustryLine, Mine, NpriSite, PowerPlant, WellHex } from './data';
import { esc, safeUrl } from './html';
import { rampCSS } from './charts';
import { AtlasLayer, NO_DEPTH, dashExt, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layer-kit';
import { metric, link } from './report-kit';

export const INDUSTRY_COLOR = '#d4e157';

export const SUBSTANCES: Record<IndustryLine['s'], { label: string; color: string }> = {
  sour: { label: 'Sour natural gas (H₂S)', color: '#ff4d6d' },
  gas: { label: 'Natural gas', color: '#ffd166' },
  oil: { label: 'Crude oil and liquids', color: '#f4a261' },
  water: { label: 'Water', color: '#4cc9f0' },
  co2: { label: 'Carbon dioxide', color: '#b8c0ff' },
  other: { label: 'Other or not stated', color: '#9aa3b2' },
};
export const MINE_KINDS: Record<Mine['g'], { label: string; color: string }> = {
  potash: { label: 'Potash', color: '#e879f9' },
  uranium: { label: 'Uranium', color: '#a3e635' },
  coal: { label: 'Coal', color: '#94a3b8' },
  metal: { label: 'Gold, copper, zinc', color: '#fbbf24' },
  other: { label: 'Salt, sulphate, clay and others', color: '#67e8f9' },
};
const NPRI_COLOR = '#ff6f59';
/** the grid, by voltage class (kV; 0 = not tagged in OpenStreetMap) */
export const KV_CLASSES: Record<number, { label: string; color: string; w: number }> = {
  230: { label: '230 kV and up', color: '#b4c6ff', w: 2.6 },
  138: { label: '110–199 kV (mostly 138 kV)', color: '#8ea2f0', w: 2 },
  72: { label: 'Under 100 kV (mostly 72 kV)', color: '#6c7fc8', w: 1.4 },
  0: { label: 'Voltage not mapped', color: '#7b8194', w: 1.2 },
};
export const PLANT_KINDS: Record<PowerPlant['s'], { label: string; color: string }> = {
  coal: { label: 'Coal', color: '#94a3b8' },
  gas: { label: 'Natural gas', color: '#ffd166' },
  hydro: { label: 'Hydro', color: '#4cc9f0' },
  wind: { label: 'Wind', color: '#e0f2fe' },
  solar: { label: 'Solar', color: '#fde047' },
  heat: { label: 'Biomass, waste heat', color: '#a3e635' },
  other: { label: 'Other or not stated', color: '#9aa3b2' },
};
const SUB_COLOR = '#b4c6ff';
type Substation = [number, number, number | null, string | null];

/** One place's power-grid neighbours, from its town limits: the nearest mapped line and substation, a plant within plantKm. */
export type PlacePower = { line: { km: number; kv: number | null } | null; sub: number | null; plant: { plant: PowerPlant; km: number } | null };
export function placePower(data: Data, key: string): PlacePower | null {
  const P = data.power;
  const t = P?.towns[key];
  if (!P || !t) return null;
  return { line: t.line, sub: t.sub, plant: t.plant ? { plant: P.plants[t.plant.i], km: t.plant.km } : null };
}
export const kvText = (kv: number | null) => (kv === 230 ? '230 kV or more' : kv === 138 ? '138 kV class' : kv === 72 ? 'under 100 kV' : 'voltage not mapped');
export const plantText = (p: PowerPlant) => `${p.n ?? 'Generating station'} (${PLANT_KINDS[p.s].label.toLowerCase()}${p.mw ? `, ${fmt.int(p.mw)} MW` : ''})`;
const FED_COLOR = '#f1f5f9';

/** One place's industrial neighbours, measured from its town limits. */
export type PlaceIndustry = {
  wells: [number, number, number]; wellsAll: number; fac: number; pl: number; sour: number; fed: string[];
  np: { site: NpriSite; km: number } | null; n5: number; mine: { mine: Mine; km: number } | null;
  /** wells + oil and gas facilities + NPRI facilities within their reach, + pipelines within theirs, + 1 for a mine */
  score: number;
};

export function placeIndustry(data: Data, key: string): PlaceIndustry | null {
  const I = data.industry;
  const t = I?.towns[key];
  if (!I || !t) return null;
  const wellsAll = t.w[0] + t.w[1] + t.w[2];
  const fed = t.fed.map((i) => I.fed[i]?.n).filter(Boolean) as string[];
  return {
    wells: t.w, wellsAll, fac: t.f, pl: t.pl, sour: t.sour, fed,
    np: t.np ? { site: I.npri[t.np.i], km: t.np.km } : null, n5: t.n5,
    mine: t.mn ? { mine: I.mines[t.mn.i], km: t.mn.km } : null,
    score: wellsAll + t.f + t.n5 + t.pl + fed.length + (t.mn ? 1 : 0),
  };
}

export const kmText = (km: number) => (km <= 0 ? 'in town' : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);
export const tonnes = (t: number) => (t >= 1000 ? `${fmt.int(t)} t` : t >= 1 ? `${t.toFixed(t >= 10 ? 0 : 1)} t` : t > 0 ? `${Math.round(t * 1000)} kg` : 'none reported');

export function industryLayer(data: Data): AtlasLayer {
  const color = INDUSTRY_COLOR;
  const I = data.industry;
  const hexes: WellHex[] = I?.hexes ?? [];
  const pipes = I?.pipes ?? [];
  const fed = I?.fed ?? [];
  const npri = I?.npri ?? [];
  const mines = I?.mines ?? [];
  const places = new Map(data.munis.map((m) => [m.key, placeIndustry(data, m.key)]));
  // hexagon colour: the share of its wells still active (suspended count half), abandoned brown to sulphur yellow
  const mix = d3.scaleLinear<string>().domain([0, 0.5, 1]).range(['#7a6a58', '#b59a5a', color]).interpolate(d3.interpolateRgb).clamp(true);
  const activeShare = (h: WellHex) => { const n = h[2] + h[3] + h[4]; return n ? (h[2] + h[3] / 2) / n : 1; };
  const hexTotal = (h: WellHex) => h[2] + h[3] + h[4] + h[5];
  const ramp = d3.scaleSqrt<string>().domain([0, 40, 400]).range(['#3b4252', '#b59a5a', color]).interpolate(d3.interpolateRgb).clamp(true);
  const lineColor = (s: IndustryLine['s']) => SUBSTANCES[s]?.color ?? SUBSTANCES.other.color;
  type Seg = { l: IndustryLine; path: [number, number][]; fed?: boolean };
  const segs = (ls: IndustryLine[], isFed = false): Seg[] => ls.flatMap((l) => l.p.map((path) => ({ l, path, fed: isFed })));
  const liveSegs = segs(pipes);
  const owner = (l: IndustryLine) => (typeof l.o === 'number' ? I?.owners[l.o] ?? '' : l.o);
  const fedSegs = segs(fed, true);
  const P = data.power;
  type PSeg = { kv: number; path: [number, number][] };
  const powerSegs: PSeg[] = (P?.lines ?? []).flatMap((l) => l.p.map((path) => ({ kv: l.kv ?? 0, path })));
  const subs = P?.subs ?? [];
  const plants = P?.plants ?? [];
  // what the map shows: oil, gas and mines; the power grid; or both (the panel's chips)
  const show = { oil: true, power: true };

  const l: AtlasLayer = {
    id: 'industry',
    name: 'Hidden neighbours',
    icon: '🛢',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'licensed and reported today',
    available: hexes.length > 0,
    unavailable: 'The wells, pipelines and emitters could not be downloaded when this copy of the data was built. Run <code>npm run data industry</code>, then reload.',
    build({ selected, focusedId }) {
      const focused = focusedId === 'industry';
      const oil: Layer[] = [
        new ColumnLayer<WellHex>({
          id: 'industry-hex', data: hexes, getPosition: (h) => [h[0], h[1]],
          diskResolution: 6, angle: 90, radius: (I?.hexKm ?? 4) * 1000, coverage: 0.9,
          extruded: focused, getElevation: (h) => Math.sqrt(hexTotal(h)) * 1100,
          getFillColor: (h) => rgb(mix(activeShare(h)), Math.min(focused ? 215 : 150, 50 + Math.log1p(hexTotal(h)) * 32)),
          material: { ambient: 0.6, diffuse: 0.5, shininess: 20 }, pickable: true,
          updateTriggers: { getFillColor: focused },
        } as any),
        new PathLayer<Seg>({
          id: 'industry-pipes', data: liveSegs, getPath: (s) => s.path, getColor: (s) => rgb(lineColor(s.l.s), focused ? 220 : 140),
          getWidth: (s) => (s.l.s === 'sour' ? 2.2 : 1.5), widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: NO_DEPTH, pickable: true,
          updateTriggers: { getColor: focused },
        } as any),
        new PathLayer<Seg>({
          id: 'industry-fed', data: fedSegs, getPath: (s) => s.path, getColor: rgb(FED_COLOR, focused ? 230 : 160),
          getWidth: 3, widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: NO_DEPTH, pickable: true,
          updateTriggers: { getColor: focused },
        } as any),
        new ScatterplotLayer<NpriSite>({
          id: 'industry-npri', data: npri, getPosition: (s) => [s.lon, s.lat],
          getRadius: (s) => 500 + Math.sqrt(s.t) * 70, radiusMinPixels: focused ? 2.6 : 1.8, radiusMaxPixels: 16,
          getFillColor: rgb(NPRI_COLOR, focused ? 200 : 140), stroked: true, getLineColor: [6, 10, 18, 220], getLineWidth: 0.6, lineWidthUnits: 'pixels',
          pickable: true, parameters: { depthCompare: 'always' }, updateTriggers: { getFillColor: focused },
        } as any),
        new ScatterplotLayer<Mine>({
          id: 'industry-mines', data: mines, getPosition: (m) => [m.lon, m.lat],
          getRadius: 2500, radiusMinPixels: focused ? 6 : 4.5, radiusMaxPixels: 14,
          getFillColor: (m) => rgb(MINE_KINDS[m.g].color, 235), stroked: true, getLineColor: [255, 255, 255, 230], getLineWidth: 1.6, lineWidthUnits: 'pixels',
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
      ];
      const grid: Layer[] = P ? [
        new PathLayer<PSeg>({
          id: 'industry-power', data: powerSegs, getPath: (s) => s.path, getColor: (s) => rgb(KV_CLASSES[s.kv].color, focused ? 220 : 130),
          getWidth: (s) => KV_CLASSES[s.kv].w, widthUnits: 'pixels', getDashArray: [7, 3], dashJustified: true, extensions: dashExt,
          capRounded: true, jointRounded: true, parameters: NO_DEPTH, pickable: true, updateTriggers: { getColor: focused },
        } as any),
        new ScatterplotLayer<Substation>({
          id: 'industry-subs', data: subs, getPosition: (s) => [s[0], s[1]],
          getRadius: 600, radiusMinPixels: focused ? 2.4 : 1.6, radiusMaxPixels: 6,
          getFillColor: rgb('#0b1020', 230), stroked: true, getLineColor: rgb(SUB_COLOR, focused ? 230 : 150), getLineWidth: 1.2, lineWidthUnits: 'pixels',
          pickable: true, parameters: { depthCompare: 'always' }, updateTriggers: { getLineColor: focused },
        } as any),
        new ScatterplotLayer<PowerPlant>({
          id: 'industry-plants', data: plants, getPosition: (p) => [p.lon, p.lat],
          getRadius: (p) => 1500 + Math.sqrt(p.mw ?? 10) * 160, radiusMinPixels: focused ? 4.5 : 3.2, radiusMaxPixels: 16,
          getFillColor: (p) => rgb(PLANT_KINDS[p.s].color, 235), stroked: true, getLineColor: rgb(SUB_COLOR, 255), getLineWidth: 2, lineWidthUnits: 'pixels',
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
      ] : [];
      const out: Layer[] = [...(show.oil ? oil : []), ...(show.power ? grid : [])];
      if (focused && show.oil) out.push(...townColumns('industry', data.munis, (m) => places.get(m.key)?.score ?? null, (v) => 2500 + Math.sqrt(v) * 2600, (v) => rgb(ramp(v), 235), 0, selected));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Around the property · Ministry of Energy and Resources · NPRI')}
        <h2>What’s next door?</h2>`;
      if (!I) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const [a, s, b] = I.totals.wells;
      el.insertAdjacentHTML('beforeend', `${P ? `<div class="chips" style="margin:2px 0 10px"><button class="chip on" data-show="oil" style="--c:${color}">Oil, gas &amp; mines</button><button class="chip on" data-show="power" style="--c:${SUB_COLOR}">Power grid</button></div>` : ''}<p class="lede">A quiet acreage can sit beside a pumpjack, a sour-gas line or a potash mine. Hexagons count the province’s <b>${fmt.int(a + s + b)} oil and gas wells</b> and ${fmt.int(I.totals.facilities)} oil and gas facilities (taller and yellower = more, and more of them active; brown = mostly abandoned). Lines are the licensed pipelines in use (the ${fmt.int(I.totals.oldPipes)} abandoned or discontinued ones are left off), red for sour gas, with the big federally regulated lines in white; orange dots are the industrial sites that report releases to the National Pollutant Release Inventory, sized by tonnes released; ringed dots are producing mines. Columns count each place’s neighbours.${P ? ` <b>Dashed blue lines</b> are the high-voltage power grid, with its substations (hollow dots) and generating stations (ringed, sized by output), as mapped in OpenStreetMap.` : ''}</p>
        <div class="callout" style="--c:${color}">These are also where many of the jobs are: oil, gas, potash and uranium employ tens of thousands of people in Saskatchewan, and the towns with the most wells nearby are often the ones built on them. The map shows what is there, not whether it is good or bad to live near.</div>`);
      const hero = heroStats(el, 4);
      hero(0, fmt.int(a), `active wells (${fmt.int(s)} suspended, ${fmt.int(b)} abandoned)`);
      hero(1, fmt.int(I.totals.pipes), `licensed pipelines in use, ${fmt.int(I.totals.sour)} carrying sour gas`);
      hero(2, String(npri.length), `sites reporting to the NPRI, ${I.npriYear}`);
      hero(3, String(mines.length), 'producing mines');
      const rows = data.munis.flatMap((m) => { const p = places.get(m.key); return p ? [{ m, p }] : []; }).sort((x, y) => y.p.score - x.p.score || x.m.name.localeCompare(y.m.name));
      const max = Math.max(1, d3.max(rows, (r) => r.p.score) ?? 1);
      const body = el.appendChild(mk('div'));
      body.innerHTML = `<h3>Industrial neighbours, most first</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${fmt.int(r.p.wellsAll)} wells within ${I.wellKm} km (${fmt.int(r.p.wells[0])} active) · ${r.p.pl} pipeline${r.p.pl === 1 ? '' : 's'}${r.p.sour ? ` (${r.p.sour} sour gas)` : ''}${r.p.fed.length ? ` · ${esc(r.p.fed.join(', '))}` : ''}${r.p.mine ? ` · ${esc(r.p.mine.mine.cm.toLowerCase())} mine ${kmText(r.p.mine.km)}` : ''}${r.p.np ? ` · NPRI site ${kmText(r.p.np.km)}` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((Math.sqrt(r.p.score) / Math.sqrt(max)) * 100)}%;background:${ramp(r.p.score)}"></i></div><div class="bar-v">${fmt.int(r.p.score)}</div></span></li>`).join('')}</ol>
        <div class="ramp" style="background:${rampCSS((t) => ramp(t * t * 400))}"></div>
        <div class="ramp-labels"><span>none</span><span>40</span><span>400+ neighbours</span></div>`;
      body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-show]');
        const k = b?.dataset.show as keyof typeof show | undefined;
        if (!b || !k) return;
        show[k] = !show[k];
        b.classList.toggle('on', show[k]);
      });
      const used = new Set(pipes.map((p) => p.s));
      el.insertAdjacentHTML('beforeend', `
        <div class="legend">${(Object.keys(SUBSTANCES) as IndustryLine['s'][]).filter((k) => used.has(k)).map((k) => `<span><i class="sw" style="background:${SUBSTANCES[k].color}"></i>${SUBSTANCES[k].label}</span>`).join('')}<span><i class="sw" style="background:${FED_COLOR}"></i>Federally regulated line (OpenStreetMap)</span><span><i class="sw" style="background:${NPRI_COLOR}"></i>NPRI reporting site</span></div>
        <div class="legend">${(Object.keys(MINE_KINDS) as Mine['g'][]).map((k) => `<span><i class="sw" style="background:${MINE_KINDS[k].color};box-shadow:0 0 0 2px #fff"></i>${MINE_KINDS[k].label} (${mines.filter((m) => m.g === k).length})</span>`).join('')}</div>
        <p class="note"><b>Wells include abandoned and suspended ones.</b> The ministry’s list holds every well ever drilled: about half are abandoned (plugged and cut off below ground, often invisible today) and many more are suspended (shut in, not producing). Each place’s report splits them. An abandoned well still matters to a buyer: building over or beside one is restricted, and the licensee stays responsible for it. Planned or cancelled licences that were never drilled are left out.</p>
        <p class="note">A place counts wells and oil and gas facilities (batteries, satellites, injection and compressor sites, gas plants) within ${I.wellKm} km of its town limits, NPRI sites within ${I.npriKm} km, pipelines in use within ${I.pipeKm} km, and a producing mine within ${I.mineKm} km; the Town Finder’s “Fewer industrial neighbours” adds these up, one for each well, site, line or mine, which weighs a pumpjack the same as a gas plant. Pipelines are the province’s licensed lines; the ~95,000 short flowlines from wells to batteries are not drawn or counted. The Canada Energy Regulator publishes no open map of the lines it regulates, so federal lines are those OpenStreetMap names (Enbridge, Keystone, Alliance and others), and some are missing. The NPRI lists only facilities above its reporting thresholds, so many small sites never appear; a release total mixes very different substances, from carbon monoxide to ammonia, and says nothing about exposure. The mines are the ministry’s producing mines (Mineral Deposit Index) plus NPRI mine sites it lacks, such as new and project mines.</p>
        ${P ? `<h3>The power grid</h3>
        <div class="legend">${[230, 138, 72, 0].filter((k) => P.totals.km[k]).map((k) => `<span><i class="sw" style="background:${KV_CLASSES[k].color}"></i>${KV_CLASSES[k].label} (${fmt.int(P.totals.km[k])} km)</span>`).join('')}<span><i class="sw" style="background:#0b1020;box-shadow:0 0 0 2px ${SUB_COLOR}"></i>Substation (${subs.length})</span></div>
        <div class="legend">${(Object.keys(PLANT_KINDS) as PowerPlant['s'][]).filter((k) => plants.some((p) => p.s === k)).map((k) => `<span><i class="sw" style="background:${PLANT_KINDS[k].color};box-shadow:0 0 0 2px ${SUB_COLOR}"></i>${PLANT_KINDS[k].label} (${plants.filter((p) => p.s === k).length})</span>`).join('')}</div>
        <p class="note"><b>The grid is what OpenStreetMap’s mappers have drawn, so coverage is partial:</b> SaskPower publishes no open map of its lines, many lines carry no voltage, and some substations, smaller plants and most distribution lines are missing. A line runs on a right of way that restricts building under it; a place’s report gives the nearest mapped line and substation from its town limits, and a generating station within ${P.plantKm} km. Power is not added to the Town Finder’s count.</p>
        ${sourceLine(`${P.source}. ${P.licence}. Read ${P.asOf}.`)}` : ''}
        ${sourceLine(`${I.source}. ${I.licence}. NPRI ${I.npriYear} reporting year. Built ${I.asOf}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('industry')) return null;
      if (id === 'industry-hex') {
        const h = info.object as WellHex;
        return `<b>${fmt.int(h[2] + h[3] + h[4])} wells</b> in this ~${Math.round(2.6 * (I?.hexKm ?? 4) ** 2)} km² hexagon<br><span class="tk">Active</span> <span class="tv">${fmt.int(h[2])}</span><br><span class="tk">Suspended</span> <span class="tv">${fmt.int(h[3])}</span><br><span class="tk">Abandoned</span> <span class="tv">${fmt.int(h[4])}</span><br><span class="tk">Oil &amp; gas facilities</span> <span class="tv">${fmt.int(h[5])}</span>`;
      }
      if (id === 'industry-pipes' || id === 'industry-fed') {
        const s = info.object as Seg;
        const o = owner(s.l);
        const what = s.fed ? 'Federally regulated line (OpenStreetMap)' : 'Licensed pipeline, in use or being built';
        return `<b>${esc(s.l.n || o || 'Pipeline')}</b><br><span class="tk">${what}</span>${o && o !== s.l.n ? `<br><span class="tk">${s.fed ? 'Operator' : 'Licensee'}</span> <span class="tv">${esc(o)}</span>` : ''}<br><span class="tk">Carries</span> <span class="tv">${esc(SUBSTANCES[s.l.s]?.label ?? 'not stated')}</span>`;
      }
      if (id === 'industry-npri') {
        const s = info.object as NpriSite;
        return `<b>${esc(s.n)}</b><br><span class="tk">${esc(s.c)}${s.city ? ` · ${esc(s.city)}` : ''}</span><br><span class="tk">${esc(s.k)}</span><br><span class="tk">Released, ${I?.npriYear}</span> <span class="tv">${tonnes(s.t)}</span>${s.top ? `<br><span class="tk">Most: ${esc(s.top[0])}</span> <span class="tv">${tonnes(s.top[1])}</span>` : ''}`;
      }
      if (id === 'industry-power') {
        const s = info.object as { kv: number };
        return `<b>Power line</b> <span class="tk">OpenStreetMap</span><br><span class="tk">Voltage</span> <span class="tv">${esc(KV_CLASSES[s.kv]?.label ?? 'not mapped')}</span>`;
      }
      if (id === 'industry-subs') {
        const s = info.object as Substation;
        return `<b>${esc(s[3] ?? 'Substation')}</b><br><span class="tk">Substation · OpenStreetMap</span>${s[2] ? `<br><span class="tk">Highest voltage</span> <span class="tv">${s[2]} kV</span>` : ''}`;
      }
      if (id === 'industry-plants') {
        const p = info.object as PowerPlant;
        return `<b>${esc(p.n ?? 'Generating station')}</b><br><span class="tk">${esc(PLANT_KINDS[p.s].label)} · generating station</span>${p.mw ? `<br><span class="tk">Output</span> <span class="tv">${fmt.int(p.mw)} MW</span>` : ''}${p.o ? `<br><span class="tk">Operator</span> <span class="tv">${esc(p.o)}</span>` : ''}`;
      }
      if (id === 'industry-mines') {
        const m = info.object as Mine;
        return `<b>${esc(m.n)}</b><br><span class="tk">${esc(m.cm)} · producing mine${m.src === 'npri' ? ' (NPRI site)' : ''}</span>`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const p = places.get(o.m.key);
      if (!p) return null;
      return `<b>${esc(o.m.name)}</b><br><span class="tk">Wells within ${I?.wellKm} km</span> <span class="tv">${fmt.int(p.wellsAll)}</span><br><span class="tk">active / suspended / abandoned</span> <span class="tv">${p.wells.map(fmt.int).join(' / ')}</span><br><span class="tk">Pipelines within ${I?.pipeKm} km</span> <span class="tv">${p.pl + p.fed.length}${p.sour ? ` (${p.sour} sour gas)` : ''}</span><br><span class="tk">Nearest NPRI site</span> <span class="tv">${p.np ? kmText(p.np.km) : 'n/a'}</span><br><span class="tk">Mine within ${I?.mineKm} km</span> <span class="tv">${p.mine ? kmText(p.mine.km) : 'no'}</span><br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      const id = info.layer?.id;
      if (id === 'industry-npri') {
        const s = info.object as NpriSite;
        return {
          layer: 'industry', kind: 'NPRI reporting facility', lon: s.lon, lat: s.lat, zoom: 11, title: s.n,
          body: `${s.c}${s.city ? `, ${s.city}` : ''}. ${s.k}. Reported ${s.ns} substance${s.ns === 1 ? '' : 's'} to the National Pollutant Release Inventory for ${I?.npriYear}. A release total adds up very different substances and says nothing about exposure.`,
          stats: [{ v: tonnes(s.t), l: `released to air, water and land, ${I?.npriYear}` }, ...(s.top ? [{ v: tonnes(s.top[1]), l: s.top[0] }] : [])],
          sources: [{ label: 'NPRI data: facility releases', url: safeUrl(I?.npriUrl) ?? 'https://www.canada.ca/en/services/environment/pollution-waste-management/national-pollutant-release-inventory.html' }],
        };
      }
      if (id === 'industry-mines') {
        const m = info.object as Mine;
        const url = safeUrl(m.url);
        return {
          layer: 'industry', kind: `${m.cm} mine`, lon: m.lon, lat: m.lat, zoom: 10, title: m.n,
          body: m.src === 'npri' ? 'A mine site that reports to the National Pollutant Release Inventory but is not yet listed as producing in the province’s Mineral Deposit Index (a new or project mine).' : 'A producing mine in the Saskatchewan Mineral Deposit Index.',
          stats: [],
          sources: url ? [{ label: 'Saskatchewan Mineral Deposit Index', url }] : [],
        };
      }
      return null;
    },
  };
  return l;
}

// ---- the Town Report section (src/panels.ts places it)

/** Hidden neighbours: wells, pipelines, NPRI emitters and mines near the town limits (neutral: also where the jobs are). */
export function industryRows(p: PlaceIndustry, data: Data, key: string) {
  const pw = placePower(data, key);
  const I = data.industry!;
  const c = INDUSTRY_COLOR;
  const [a, s, b] = p.wells;
  const lines = p.pl + p.fed.length;
  return `<h3>Hidden neighbours</h3>
    <div class="metric-grid">
      ${metric('Wells', c, fmt.int(p.wellsAll), p.wellsAll ? `oil and gas wells within ${I.wellKm} km of town limits: ${fmt.int(a)} active, ${fmt.int(s)} suspended, ${fmt.int(b)} abandoned${p.fac ? ` · ${fmt.int(p.fac)} oil and gas facilities` : ''}` : `no oil or gas well within ${I.wellKm} km of town limits${p.fac ? ` · ${fmt.int(p.fac)} oil and gas facilities` : ''}`)}
      ${metric('Pipelines', c, String(lines), lines ? `in use within ${I.pipeKm} km${p.sour ? ` · <b>${p.sour} carrying sour gas</b>` : ''}${p.fed.length ? ` · federal: ${esc(p.fed.join(', '))}` : ''}` : `no licensed line in use within ${I.pipeKm} km (flowlines not counted)`)}
      ${metric('Nearest emitter', c, p.np ? kmText(p.np.km) : 'n/a', p.np ? `${esc(p.np.site.n)} (${esc(p.np.site.k.toLowerCase())}), ${tonnes(p.np.site.t)} released in ${I.npriYear}${p.n5 > 1 ? ` · ${p.n5} NPRI sites within ${I.npriKm} km` : ''}` : 'no NPRI site')}
      ${metric('Mine nearby', c, p.mine ? 'Yes' : 'No', p.mine ? `${esc(p.mine.mine.n)} (${esc(p.mine.mine.cm.toLowerCase())}), ${p.mine.km > 0 ? `${kmText(p.mine.km)} from town limits` : 'inside the town limits'}` : `no producing mine within ${I.mineKm} km`)}
      ${pw ? metric('Power line', '#b4c6ff', pw.line ? kmText(pw.line.km) : 'n/a', `${pw.line ? `nearest mapped high-voltage line from town limits (${esc(kvText(pw.line.kv))})` : 'no mapped line within 30 km'}${pw.sub != null ? ` · substation ${kmText(pw.sub)}` : ''}${pw.plant ? `<br>generating station ${kmText(pw.plant.km)}: ${esc(plantText(pw.plant.plant))}` : ''} · OpenStreetMap, partial`) : ''}
    </div>
    <p class="note" style="margin-top:6px">Counted from the town limits. Wells include suspended and abandoned ones, which can restrict where you build. Neutral: these are also where many of the jobs are.</p>
    <div class="tr-falls" style="margin-top:8px">${link('industry', '🛢 Hidden neighbours on the map')}</div>`;
}
