// GROUNDWATER — will a well find water here, and how deep. The Water Security Agency's water well layer (built from the
// drillers' reports every water well driller must file) binned into ~4 km hexagons, coloured by the typical depth to
// water (static water level) of the wells people draw from, by a chip their typical bore depth, or what the water is
// used for; a further chip draws the Saskatchewan Geological Survey's glacial drift thickness (surface to bedrock).
// Aggregates only (the stage keeps no well row, owner or driller). A static layer.
// BELOW THE SURFACE: a chip that tilts the map and hangs each hexagon's typical well under it, a sand-coloured sleeve
// from the surface down to the water and a blue core on to the bottom of the hole, with the base of the glacial drift
// (the top of the bedrock) as a terraced sheet beneath. Depths are stretched (more when zoomed out) so they show.
import * as d3 from 'd3';
import { ColumnLayer, PolygonLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { fmt } from './data';
import type { Data, GwHex, GwPlace } from './data';
import { barChart, rampCSS } from './charts';
import { esc, safeUrl } from './html';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine } from './layer-kit';
import { metric, link, na } from './report-kit';
import { TERRAIN_Z } from './buildings';
import { reducedMotion } from './particles';

export const GROUNDWATER_COLOR = '#26c6da';
const FT = 0.3048;
/** depth to water (ft): shallow water bright, deep water dark */
export const LEVEL_RAMP = d3.scaleSequentialLog(d3.interpolateRgbBasis(['#b8f6ff', '#3fc1e6', '#2f6fd0', '#4a3c9a', '#3b2350'])).domain([5, 200]).clamp(true);
/** bore depth (ft): sand to rust, the deeper the hole */
export const BORE_RAMP = d3.scaleSequentialLog(d3.interpolateRgbBasis(['#fff1b8', '#f4c06a', '#e0803f', '#b44a3a', '#6e2638'])).domain([20, 600]).clamp(true);
const USE_COLORS = ['#8fd3ff', '#ffd166', '#f4a261', '#59d18c', '#c3b5ff', '#9aa3b2'];
const DRIFT_COLORS = ['#f6e7bd', '#e7cc94', '#d0aa70', '#b38755', '#946841', '#734d31', '#523522'];
const DRY = '#c9a06a', WET = '#3aa6e0';

/** feet as the drillers record them, with metres: "67 ft (20 m)" */
export const ftText = (ft: number) => `${fmt.int(ft)} ft (${fmt.int(ft * FT)} m)`;
const driftText = (c: [number, number | null]) => (c[1] == null ? `${c[0]} m or more` : `${c[0]}–${c[1]} m`);

/** One place's water wells, from its town limits. */
export type PlaceGroundwater = GwPlace & { use: string | null; drift: string | null };
export function placeGroundwater(data: Data, key: string): PlaceGroundwater | null {
  const G = data.groundwater;
  const t = G?.towns[key];
  if (!G || !t) return null;
  return { ...t, use: t.u != null ? G.uses[t.u] : null, drift: t.d != null && G.drift.classes[t.d] ? driftText(G.drift.classes[t.d]) : null };
}

type Measure = 'level' | 'bore' | 'use' | 'drift';
const MEASURES: Record<Measure, string> = { level: 'Depth to water', bore: 'Well depth', use: 'Water use', drift: 'Glacial drift' };

/** how many times depths are stretched: about 800 at province scale, less as the map zooms in, so a typical well stays
 * a few pixels long at any zoom */
export const stretchAt = (zoom: number) => Math.max(25, Math.min(1000, 800 * 2 ** (5.35 - zoom)));

export function groundwaterLayer(data: Data): AtlasLayer {
  const color = GROUNDWATER_COLOR;
  const G = data.groundwater;
  const hexes: GwHex[] = G?.hexes ?? [];
  // the hexagons with a typical bore depth (the hole) and with a typical depth to water (its dry part)
  const wetHex = hexes.filter((h) => h[4] != null), dryHex = hexes.filter((h) => h[6] != null);
  type DriftPoly = { c: number; poly: [number, number][][] };
  const driftPolys: DriftPoly[] = (G?.drift.polys ?? []).flatMap((d) => d.p.map((poly) => ({ c: d.c, poly })));
  // the base of the drift sits at the middle of its class (the open-ended class 25 m past its edge)
  const driftMid = (c: number) => { const k = G!.drift.classes[c]; return k[1] == null ? k[0] + 25 : (k[0] + k[1]) / 2; };
  let measure: Measure = 'level';
  let below = false;
  // the sheet's vertices are rebuilt only when the stretch moves by more than a tenth
  let sheet: { s: number; polys: (DriftPoly & { z: [number, number, number][][] })[] } | null = null;
  const sheetAt = (s: number) => {
    if (!sheet || Math.abs(sheet.s - s) / s > 0.1) sheet = { s, polys: driftPolys.map((d) => ({ ...d, z: d.poly.map((r) => r.map(([x, y]) => [x, y, -driftMid(d.c) * s] as [number, number, number])) })) };
    return sheet.polys;
  };
  const hexFill = (h: GwHex, a: number) => {
    // the drift chip's glass (Below the surface) keeps the depth to water
    const m = measure === 'drift' ? 'level' : measure;
    const v = m === 'bore' ? h[4] : h[6];
    if (m === 'use') return rgb(h[8] != null ? USE_COLORS[h[8]] : '#6b7280', Math.min(a, 50 + Math.log1p(h[2]) * 34));
    return v != null ? rgb(m === 'bore' ? BORE_RAMP(Math.max(1, v)) : LEVEL_RAMP(Math.max(1, v)), a) : [120, 128, 145, Math.round(a * 0.35)] as [number, number, number, number];
  };
  let grown = 0; // when Below the surface last went on (for the needles' growth)

  const l: AtlasLayer = {
    id: 'groundwater',
    name: 'Groundwater',
    icon: '💧',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'drillers’ logs since 1900',
    available: hexes.length > 0,
    unavailable: 'The Water Security Agency’s water well records could not be downloaded when this copy of the data was built. Run <code>npm run data groundwater</code>, then reload.',
    build({ focusedId, view }) {
      if (!G) return [];
      const focused = focusedId === 'groundwater';
      const R = (G.hexKm ?? 4) * 1000;
      const cut = below && focused && view.zoom < TERRAIN_Z;
      const out: Layer[] = [];
      if (measure === 'drift' && !cut) {
        out.push(new PolygonLayer<DriftPoly>({
          id: 'groundwater-drift-base', data: driftPolys, getPolygon: (d) => d.poly,
          getFillColor: (d) => rgb(DRIFT_COLORS[d.c] ?? DRIFT_COLORS[6], focused ? 150 : 95),
          getLineColor: [240, 230, 210, 110], lineWidthUnits: 'pixels', getLineWidth: 0.8,
          pickable: true, parameters: NO_DEPTH, updateTriggers: { getFillColor: focused },
        } as any));
        return out;
      }
      if (!cut) {
        out.push(new ColumnLayer<GwHex>({
          id: 'groundwater-base', data: hexes, getPosition: (h) => [h[0], h[1]],
          diskResolution: 6, angle: 90, radius: R, coverage: 0.92, extruded: false,
          getFillColor: (h) => hexFill(h, focused ? 200 : 130),
          pickable: true, parameters: NO_DEPTH, updateTriggers: { getFillColor: [focused, measure] },
        } as any));
        return out;
      }
      // Below the surface: the drift's base far beneath, the surface as tinted glass, then each typical well. deck.gl
      // draws no column of negative height, so each hangs from a base set below the ground up to the surface.
      const bed = sheetAt(stretchAt(view.zoom));
      const grow = reducedMotion() ? 1 : Math.round(Math.min(1, (performance.now() - grown) / 1400) * 24) / 24;
      const f = sheet!.s * FT * (1 - (1 - grow) ** 3);
      const hang = (id: string, rows: GwHex[], depth: (h: GwHex) => number, r: number, fill: (h: GwHex) => [number, number, number, number]) =>
        new ColumnLayer<GwHex>({
          id, data: rows, getPosition: (h) => [h[0], h[1], -depth(h) * f], getElevation: depth, elevationScale: f,
          diskResolution: 6, angle: 90, radius: R * r, extruded: true, getFillColor: fill,
          material: { ambient: 0.65, diffuse: 0.5, shininess: 24 }, pickable: true,
          updateTriggers: { getPosition: f },
        } as any);
      out.push(
        new PolygonLayer<DriftPoly & { z: [number, number, number][][] }>({
          id: 'groundwater-bedrock', data: bed, getPolygon: (d) => d.z,
          getFillColor: (d) => rgb(DRIFT_COLORS[d.c] ?? DRIFT_COLORS[6], 70), getLineColor: [240, 230, 210, 70],
          lineWidthUnits: 'pixels', getLineWidth: 0.6, pickable: true, parameters: NO_DEPTH,
          updateTriggers: { getPolygon: sheet!.s },
        } as any),
        new ColumnLayer<GwHex>({
          id: 'groundwater-glass', data: hexes, getPosition: (h) => [h[0], h[1]],
          diskResolution: 6, angle: 90, radius: R, coverage: 0.92, extruded: false,
          getFillColor: (h) => hexFill(h, 70), pickable: true, parameters: NO_DEPTH,
          updateTriggers: { getFillColor: measure },
        } as any),
        // the whole hole, water-filled below the static level (grey where no level was logged)
        hang('groundwater-wet', wetHex, (h) => h[4] ?? 0, 0.34, (h) => (h[6] != null ? rgb(WET, 235) : [140, 150, 170, 200])),
        // the dry part, from the surface down to the water, a little wider so it sleeves the core
        hang('groundwater-dry', dryHex, (h) => Math.min(h[6] ?? 0, h[4] ?? Infinity), 0.42, () => rgb(DRY, 245)),
      );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Around the property · Water Security Agency · Saskatchewan Geological Survey')}
        <h2>Will a well find water here?</h2>`;
      if (!G) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const T = G.totals;
      // the decade by whose end half the dated logs had been drilled
      const dated = T.decades.reduce((a, d) => a + d[1], 0);
      let acc = 0;
      const halfBefore = (T.decades.find((d) => (acc += d[1]) >= dated / 2)?.[0] ?? T.years[1]) + 10;
      el.insertAdjacentHTML('beforeend', `<p class="lede">Off the town water main, a home draws from its own well. Every water well driller in Saskatchewan must file a report with the Water Security Agency: how deep the hole went, where the water stood, what it is for. Hexagons gather the <b>${fmt.int(T.n)}</b> water wells and test holes on record; each is coloured by the typical (median) <b>depth to water</b> of the wells people draw from (pale = water near the surface, dark = deep), or by a chip the typical <b>depth drilled</b>, what the water is used for, or how thick the glacial drift is over the bedrock.</p>
        <div class="callout" style="--c:${color}"><b>A well log is what the driller recorded the day the well was drilled, not today’s level.</b> Water levels rise and fall with wet and dry years and with pumping nearby, and half the logs here were drilled before ${halfBefore}. A typical well near you says what neighbours found, not what a new hole on your land will find.</div>
        <div class="chips gw-measures" style="margin:2px 0 6px">${(Object.keys(MEASURES) as Measure[]).map((m) => `<button class="chip" data-gw="${m}" style="--c:${color}">${MEASURES[m]}</button>`).join('')}</div>
        <div class="chips" style="margin:0 0 10px"><button class="chip" data-below style="--c:${WET}">⬇ Below the surface</button></div>`);
      const hero = heroStats(el, 4);
      hero(0, fmt.int(T.nw), `water wells people draw from (and ${fmt.int(T.n - T.nw)} test holes, observation and other wells)`);
      hero(1, ftText(T.b[0]), `typical depth drilled (half between ${fmt.int(T.b[1])} and ${fmt.int(T.b[2])} ft)`);
      hero(2, ftText(T.l[0]), `typical depth to water when drilled (half between ${fmt.int(T.l[1])} and ${fmt.int(T.l[2])} ft)`);
      hero(3, fmt.int(T.flow), 'flowing wells: water that rose to the surface by itself');
      const legend = el.appendChild(mk('div'));
      const belowNote = el.appendChild(mk('p', 'note'));
      const drawLegend = () => {
        if (measure === 'level' || measure === 'bore') {
          const r = measure === 'level' ? LEVEL_RAMP : BORE_RAMP;
          const [a, b] = r.domain();
          legend.innerHTML = `<h3>${measure === 'level' ? 'Typical depth to water' : 'Typical depth drilled'}, wells people draw from</h3>
            <div class="ramp" style="background:${rampCSS((t) => r(a * (b / a) ** t))}"></div>
            <div class="ramp-labels"><span>${a} ft</span><span>${Math.round(Math.sqrt(a * b))} ft</span><span>${b} ft+</span></div>
            <div class="legend"><span><i class="sw" style="background:#78809199"></i>fewer than ${G.minN} wells with a ${measure === 'level' ? 'water level' : 'depth'}: counted, not coloured</span></div>`;
        } else if (measure === 'use') {
          legend.innerHTML = `<h3>What the water is mostly for, by hexagon</h3>
            <div class="legend">${G.uses.map((u, i) => `<span><i class="sw" style="background:${USE_COLORS[i]}"></i>${esc(u)} (${fmt.int(T.uses[i])})</span>`).join('')}</div>
            <p class="note">Fainter hexagons have fewer wells. “Research” is mostly the province’s own test and observation holes.</p>`;
        } else {
          legend.innerHTML = `<h3>Glacial drift: how far down to bedrock</h3>
            <div class="legend">${G.drift.classes.map((c, i) => `<span><i class="sw" style="background:${DRIFT_COLORS[i]}"></i>${driftText(c)}</span>`).join('')}</div>
            <p class="note">The sand, gravel and clay the glaciers left over the bedrock. Most farm and acreage wells are drilled into sand and gravel in the drift; where it is thin (the southwest, the Shield in the north) wells go into the bedrock below. Saskatchewan Geological Survey, 1:1,000,000: a regional picture, not a site’s.</p>`;
        }
        belowNote.innerHTML = below
          ? `<b>Below the surface.</b> Each hexagon’s typical well hangs under it: <i class="sw" style="background:${DRY};display:inline-block;width:10px;height:10px;border-radius:2px"></i> from the surface down to the water, <i class="sw" style="background:${WET};display:inline-block;width:10px;height:10px;border-radius:2px"></i> on to the bottom of the hole (grey where no level was logged). The terraced sheet far beneath is the base of the glacial drift, the top of the bedrock. Depths are stretched <b class="gw-stretch">about ${Math.round(stretchAt(5.35))}</b> times so they show (less as you zoom in), and the medians of two different sets of wells are drawn one on the other: a picture of what drillers found, not a cross-section. Tilt the map (right-drag) to look under it.`
          : `Press <b>⬇ Below the surface</b> to tilt the map and hang each hexagon’s typical well under it, down to the water and on to the bottom of the hole, with the bedrock beneath.`;
      };
      const hist = el.appendChild(mk('div'));
      const max = Math.max(...T.h);
      hist.innerHTML = `<h3>How deep the province’s water wells go</h3>
        <ol class="rank-list">${T.h.map((n, i) => `<li><span class="rk"></span><span><span class="nm">${i === T.h.length - 1 ? `${i * G.binFt} ft or more` : `${i * G.binFt}–${(i + 1) * G.binFt} ft`}</span></span><span><div class="bar"><i style="width:${Math.round((n / max) * 100)}%;background:${BORE_RAMP(Math.max(20, (i + 0.5) * G.binFt))}"></i></div><div class="bar-v">${fmt.int(n)}</div></span></li>`).join('')}</ol>`;
      const dec = el.appendChild(mk('div'));
      dec.innerHTML = `<h3>Wells logged, by decade drilled</h3><div class="ev-chart"></div>`;
      requestAnimationFrame(() => barChart(dec.querySelector<HTMLElement>('.ev-chart')!, {
        data: T.decades.map(([x, y]) => ({ x, y })), xDomain: [T.decades[0][0], T.decades.at(-1)![0]], step: 10, color, height: 120,
        yFormat: (v) => d3.format('~s')(v), tooltip: (d) => `${d.x}s: ${fmt.int(d.y)} wells logged`,
      }));
      const rows = data.munis.flatMap((m) => { const p = placeGroundwater(data, m.key); return p ? [{ m, p }] : []; })
        .sort((x, y) => (x.p.b ? x.p.b[0] : Infinity) - (y.p.b ? y.p.b[0] : Infinity) || x.m.name.localeCompare(y.m.name));
      const bmax = Math.max(1, ...rows.map((r) => r.p.b?.[0] ?? 0));
      const list = el.appendChild(mk('div'));
      list.innerHTML = `<h3>Typical well depth within ${G.wellKm} km, shallowest first</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${fmt.int(r.p.nw)} wells${r.p.l ? ` · water at ${fmt.int(r.p.l[0])} ft` : ''}${r.p.fl ? ` · ${r.p.fl} flowing` : ''}${r.p.use && r.p.use !== 'Domestic' ? ` · mostly ${esc(r.p.use.toLowerCase())}` : ''}</span></span><span><div class="bar"><i style="width:${r.p.b ? Math.round((Math.sqrt(r.p.b[0]) / Math.sqrt(bmax)) * 100) : 0}%;background:${r.p.b ? BORE_RAMP(r.p.b[0]) : '#555'}"></i></div><div class="bar-v">${r.p.b ? `${fmt.int(r.p.b[0])} ft` : '–'}</div></span></li>`).join('')}</ol>`;
      list.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.insertAdjacentHTML('beforeend', `
        <p class="note"><b>What the numbers are.</b> The typical depths are medians of the <b>withdrawal wells</b> (${fmt.int(T.nw)}, the wells people draw water from), in feet as the drillers log them; a hexagon or place needs ${G.minN} (a place ${G.minPlace}) before it gets one. Depth to water is the static level the driller measured below the ground, ${fmt.int(T.ln)} wells in all; a level logged as 0 with no flowing head is left out as not recorded, and a flowing well counts as water at the surface. Test holes (${fmt.int(T.kinds[1])}, many of them dry) and observation wells are counted on the map but not in the medians. Seismic, soil and mineral test holes (${fmt.int(T.notWater)}) are left out.</p>
        <p class="note"><b>Where the dots are.</b> Most wells sit at the centre of the quarter section they were drilled in, not on the spot; the record holds only wells a driller reported, and none has been checked in the field. Each place counts the wells within ${G.wellKm} km of its town limits: in a city that is mostly the acreages around it, since homes in town are on the municipal system. No well, owner or driller is shown: the atlas keeps only these counts and medians.</p>
        <p class="note"><b>Not in the map.</b> Water quality (hardness, iron, sulphate, nitrate, bacteria) and how much a well yields: test a private well’s water for bacteria at least twice a year and for chemistry every few years. The Water Security Agency publishes no open outlines of the aquifers (its aquifer maps are PDFs) and no open feed of its observation wells’ levels. The Geological Survey’s formation-top maps (Belly River, Milk River, Mannville…) are not drawn: their service does not state their units, and placing them under the ground needs a ground surface the atlas does not have.</p>
        ${sourceLine(`${G.source}. ${G.licence} (${G.licenceNote}). Read ${G.asOf}.`)}
        <p class="note"><a href="${esc(safeUrl(G.wellsUrl) ?? '#')}" target="_blank" rel="noopener">Water Security Agency: search the well records</a> · <a href="${esc(safeUrl(G.driftUrl) ?? '#')}" target="_blank" rel="noopener">GeoHub: glacial drift thickness</a></p>`);
      const sync = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-gw]').forEach((b) => b.classList.toggle('on', b.dataset.gw === measure));
        el.querySelector<HTMLButtonElement>('[data-below]')?.classList.toggle('on', below);
        drawLegend();
      };
      el.querySelector('.gw-measures')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-gw]')?.dataset.gw as Measure | undefined;
        if (!k || k === measure) return;
        measure = k;
        sync();
      });
      el.querySelector('[data-below]')!.addEventListener('click', () => {
        below = !below;
        grown = performance.now();
        // tilt onto the farm belt, where the wells are
        if (below) window.dispatchEvent(new CustomEvent('atlas:fly', { detail: { bounds: [[-109.6, 49.0], [-101.6, 53.6]] } }));
        sync();
      });
      sync();
      let shown = 0;
      return {
        update(ctx) {
          if (!below) return;
          const s = Math.round(stretchAt(ctx.view.zoom));
          if (s === shown) return;
          shown = s;
          const b = el.querySelector('.gw-stretch');
          if (b) b.textContent = `about ${s}`;
        },
      };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('groundwater') || !G) return null;
      const row = (k: string, v: string) => `<br><span class="tk">${k}</span> <span class="tv">${v}</span>`;
      if (id === 'groundwater-drift-base' || id === 'groundwater-bedrock') {
        const d = info.object as DriftPoly;
        return `<b>Glacial drift ${driftText(G.drift.classes[d.c])} thick</b><br><span class="tk">surface to bedrock · Saskatchewan Geological Survey, 1:1,000,000</span>`;
      }
      const h = info.object as GwHex;
      return `<b>${fmt.int(h[2])} water well${h[2] === 1 ? '' : 's'} and test holes</b> <span class="tk">in this ~${Math.round(2.6 * G.hexKm ** 2)} km² hexagon</span>`
        + row('Wells people draw from', fmt.int(h[3]))
        + row('Typical depth drilled', h[4] != null ? ftText(h[4]) : `fewer than ${G.minN} logged`)
        + row('Typical depth to water', h[6] != null ? `${ftText(h[6])} (${h[5]} logged)` : `fewer than ${G.minN} logged`)
        + (h[7] ? row('Flowing wells', fmt.int(h[7])) : '')
        + (h[8] != null ? row('Mostly for', esc(G.uses[h[8]].toLowerCase())) : '')
        + '<br><span class="tk">as logged the day each was drilled, not today’s level</span>';
    },
  };
  return l;
}

// ---- the Town Report section (src/panels.ts places it)

/** Groundwater: the water wells within wellKm of the town limits, their typical depth and depth to water as logged. */
export function groundwaterRows(p: PlaceGroundwater, data: Data) {
  const G = data.groundwater!;
  const c = GROUNDWATER_COLOR;
  const max = Math.max(1, ...(p.h ?? [1]));
  const hist = p.h && p.bn >= G.minPlace ? `<div style="display:flex;align-items:flex-end;gap:2px;height:38px;margin-top:6px" title="bore depths in ${G.binFt} ft steps, the last ${(p.h.length - 1) * G.binFt} ft and deeper">${p.h.map((n, i) => `<i style="flex:1;height:${Math.max(n ? 2 : 0, Math.round((n / max) * 38))}px;background:${BORE_RAMP(Math.max(20, (i + 0.5) * G.binFt))};border-radius:1px"></i>`).join('')}</div><div class="ramp-labels"><span>0 ft</span><span>${(p.h.length - 1) * G.binFt} ft+</span></div>` : '';
  return `<h3>Groundwater</h3>
    <div class="metric-grid">
      ${metric('Water wells', c, fmt.int(p.nw), p.n ? `wells people draw from within ${G.wellKm} km of the town limits${p.n > p.nw ? `, and ${fmt.int(p.n - p.nw)} test holes and other wells` : ''}${p.use ? ` · mostly ${esc(p.use.toLowerCase())}` : ''}` : `no water well on record within ${G.wellKm} km`)}
      ${metric('Typical well depth', BORE_RAMP(p.b?.[0] ?? 60), p.b ? `${fmt.int(p.b[0])} ft` : na, p.b ? `median of ${fmt.int(p.bn)} wells (${fmt.int(p.b[0] * FT)} m); half between ${fmt.int(p.b[1])} and ${fmt.int(p.b[2])} ft${hist}` : `fewer than ${G.minPlace} wells logged a depth`)}
      ${metric('Depth to water', LEVEL_RAMP(p.l?.[0] ?? 25), p.l ? `${fmt.int(p.l[0])} ft` : na, p.l ? `below ground when drilled, median of ${fmt.int(p.ln)} (${fmt.int(p.l[0] * FT)} m); half between ${fmt.int(p.l[1])} and ${fmt.int(p.l[2])} ft${p.fl ? ` · <b>${p.fl} flowing well${p.fl === 1 ? '' : 's'}</b>` : ''}` : `fewer than ${G.minPlace} wells logged a water level`)}
      ${p.drift ? metric('Glacial drift', '#c9a06a', esc(p.drift), 'to bedrock under the town centre (Saskatchewan Geological Survey, 1:1,000,000)') : ''}
    </div>
    <p class="note" style="margin-top:6px">A well log is what the driller recorded the day the well was drilled${p.y ? ` (here mostly around ${p.y[0]}, the latest in ${p.y[1]})` : ''}, not today’s level: levels move with wet and dry years and pumping nearby, and a new hole can find more, less or none. Most wells are placed at their quarter section’s centre. Test a private well’s water for bacteria at least twice a year.</p>
    <div class="tr-falls" style="margin-top:8px">${link('groundwater', '💧 Groundwater on the map')}</div>`;
}
