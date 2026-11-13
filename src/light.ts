// LIGHT & DARK — a computed layer: how long the days are (sunrise to sunset and civil twilight, from each place's latitude
// with NOAA's solar position equations), how often the aurora comes overhead (geomagnetic latitude from the IGRF-14
// dipole, read against NOAA SWPC's Kp rule), and where the province's RASC dark-sky preserves are. Nothing here is
// measured: the sky's clearness, light pollution and solar activity decide what a given night actually looks like.
import * as d3 from 'd3';
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Data, Light, LightTown, Muni } from './data';
import { MONTHS } from './data';
import { rampCSS } from './charts';
import { esc, safeUrl } from './html';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine } from './layer-kit';

export const LIGHT_COLOR = '#a3b8ff';
// night blue to pale sun, over the hours of daylight Saskatchewan sees through the year
export const DAY_RAMP = d3.scaleSequential(d3.interpolateRgb('#0d1838', '#ffe39a')).domain([6.5, 18.5]).clamp(true);
// geomagnetic latitude: dark south, aurora green in the north
export const AURORA_RAMP = d3.scaleSequential(d3.interpolateRgb('#14233b', '#3dffa8')).domain([56.5, 63.5]).clamp(true);
export const PRESERVE_COLOR = '#c9b6ff';
export const AURORA_BANDS: Record<LightTown['a'], { label: string; text: string }> = {
  often: { label: 'Often', text: 'the auroral oval reaches overhead even on quiet nights (Kp 2 or less)' },
  sometimes: { label: 'Sometimes', text: 'overhead on unsettled to active nights (Kp 3–4); low in the north more often' },
  rarely: { label: 'Rarely', text: 'overhead only in geomagnetic storms (Kp 5+); low on the northern horizon more often' },
};

/** Geomagnetic latitude to 0.1°, rounded down so it never reads as the next band's edge (57.97° shows 57.9°). */
export const mlText = (ml: number) => (Math.floor(ml * 10 + 1e-9) / 10).toFixed(1);

/** Hours as "7 h 59 m"; 24 as "24 h". */
export const hm = (h: number) => {
  if (h >= 24) return '24 h';
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
};

export type PlaceLight = LightTown & { dark: { name: string; preserve: string; min: number | null; km: number } | null };
export function placeLight(data: Data, key: string): PlaceLight | null {
  const L = data.light;
  const t = L?.towns[key];
  if (!L || !t) return null;
  const tg = t.dk ? L.targets[t.dk.f] : null;
  return { ...t, dark: t.dk && tg ? { name: tg.name, preserve: L.preserves[tg.k]?.name ?? '', min: t.dk.min, km: t.dk.km } : null };
}

type Mode = 'dec' | 'mar' | 'jun' | 'aurora';
const MODE_IDX: Record<Exclude<Mode, 'aurora'>, number> = { dec: 0, mar: 1, jun: 2 };

/** One labelled place per degree of latitude (the largest, as the place list runs biggest first), so labels never pile up. */
function labelPlaces(munis: Muni[], L: Light) {
  const seen = new Set<number>();
  return munis.filter((m) => {
    const b = Math.floor(m.lat);
    if (seen.has(b) || !L.towns[m.key]) return false;
    seen.add(b);
    return true;
  });
}

export function lightLayer(data: Data): AtlasLayer {
  const color = LIGHT_COLOR;
  const L = data.light;
  type Row = Light['rows'][number];
  type Cell = Light['cells'][number];
  type PPoly = { name: string; park: string; year: number | null; poly: [number, number][][] };
  const rows = L?.rows ?? [];
  const cells = L?.cells ?? [];
  const pres: PPoly[] = (L?.preserves ?? []).flatMap((p) => p.parks.flatMap((pk) => pk.polys.map((poly) => ({ name: p.name, park: pk.name, year: p.year, poly }))));
  const presLabels = (L?.preserves ?? []).map((p) => ({ name: p.name, c: p.parks[0].c }));
  const munis = data.munis.filter((m) => L?.towns[m.key]);
  const labelled = L ? labelPlaces(munis, L) : [];
  let mode: Mode = 'dec';
  const dateLabel = (m: Mode) => L?.dates[MODE_IDX[m as Exclude<Mode, 'aurora'>]]?.label ?? '';
  const townVal = (t: LightTown) => (mode === 'aurora' ? t.ml : t.d[MODE_IDX[mode]]);
  const townColor = (t: LightTown) => (mode === 'aurora' ? AURORA_RAMP(t.ml) : DAY_RAMP(t.d[MODE_IDX[mode as Exclude<Mode, 'aurora'>]]));

  const l: AtlasLayer = {
    id: 'light',
    name: 'Light & dark',
    icon: '☾',
    color,
    range: [L?.year ?? 2026, (L?.year ?? 2026) + 0.99],
    static: true,
    period: 'computed from latitude',
    available: !!L,
    unavailable: 'The light & dark data has not been built. Run <code>npm run data light</code> (after <code>camping</code>), then reload.',
    build({ focusedId }) {
      if (!L) return [];
      const focused = focusedId === 'light';
      const out: Layer[] = [];
      if (mode === 'aurora')
        out.push(new PolygonLayer<Cell>({
          id: 'light-aurora-base', data: cells,
          getPolygon: (c) => [[c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]],
          getFillColor: (c) => rgb(AURORA_RAMP(c[4]), focused ? 150 : 100),
          stroked: false, pickable: true, parameters: NO_DEPTH,
        } as any));
      else
        out.push(new PolygonLayer<Row>({
          id: 'light-day-base', data: rows,
          getPolygon: (r) => [[r.w, r.s], [r.e, r.s], [r.e, r.n], [r.w, r.n]],
          getFillColor: (r) => rgb(DAY_RAMP(r.d[MODE_IDX[mode as Exclude<Mode, 'aurora'>]]), focused ? 150 : 100),
          stroked: false, pickable: true, parameters: NO_DEPTH,
          updateTriggers: { getFillColor: [mode, focused] },
        } as any));
      out.push(
        new PolygonLayer<PPoly>({
          id: 'light-preserve-base', data: pres, getPolygon: (p) => p.poly,
          getFillColor: [20, 12, 48, 170], getLineColor: rgb(PRESERVE_COLOR, 240),
          lineWidthUnits: 'pixels', getLineWidth: 2, pickable: true, parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<Muni>({
          id: 'light-towns', data: munis, getPosition: (m) => [m.lon, m.lat],
          getRadius: 4500, radiusMinPixels: 4, radiusMaxPixels: 9,
          getFillColor: (m) => rgb(townColor(L.towns[m.key]), 255), stroked: true, getLineColor: [8, 12, 22, 220], lineWidthMinPixels: 1,
          parameters: NO_DEPTH, updateTriggers: { getFillColor: mode },
        } as any),
      );
      if (focused)
        out.push(
          new TextLayer<Muni>({
            id: 'light-labels', data: labelled, getPosition: (m) => [m.lon, m.lat],
            getText: (m) => { const t = L.towns[m.key]; return `${m.name}\n${mode === 'aurora' ? `${AURORA_BANDS[t.a].label} · ${mlText(t.ml)}°` : hm(townVal(t))}`; },
            getSize: 12, getColor: [240, 244, 252, 240], fontFamily: 'Inter, sans-serif', fontWeight: 700,
            getPixelOffset: [0, -16], getAlignmentBaseline: 'bottom',
            outlineWidth: 4, outlineColor: [6, 10, 18, 235], fontSettings: { sdf: true }, characterSet: 'auto',
            parameters: { depthCompare: 'always' }, updateTriggers: { getText: mode },
          } as any),
          new TextLayer<{ name: string; c: [number, number] }>({
            id: 'light-preserve-labels', data: presLabels, getPosition: (p) => p.c,
            getText: (p) => `${p.name}\ndark-sky preserve`, getSize: 12, getColor: rgb(PRESERVE_COLOR, 255),
            fontFamily: 'Inter, sans-serif', fontWeight: 700, getPixelOffset: [0, 22],
            outlineWidth: 4, outlineColor: [6, 10, 18, 235], fontSettings: { sdf: true }, characterSet: 'auto',
            parameters: { depthCompare: 'always' },
          } as any),
        );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Places &amp; living · computed')}
        <h2>How long are the days, and how dark the nights?</h2>`;
      if (!L) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const ts = munis.map((m) => ({ m, t: L.towns[m.key] }));
      const by = (f: (t: LightTown) => number) => [...ts].sort((a, b) => f(a.t) - f(b.t));
      const dec = by((t) => t.d[0]), jun = by((t) => t.d[2]);
      const often = ts.filter((x) => x.t.a === 'often').length;
      el.insertAdjacentHTML('beforeend', `<p class="lede">Saskatchewan runs eleven degrees of latitude, from the 49th parallel to the 60th. On the shortest day the sun is up <b>${hm(dec.at(-1)!.t.d[0])}</b> at ${esc(dec.at(-1)!.m.name)} but <b>${hm(dec[0].t.d[0])}</b> at ${esc(dec[0].m.name)}; on the longest, the north gets the light back. The same northward run brings the auroral oval closer.</p>
        <div class="chips" style="margin:2px 0 10px">${L.dates.map((d) => `<button class="chip" data-m="${esc(d.id)}" style="--c:${color}">${esc(d.label)}</button>`).join('')}<button class="chip" data-m="aurora" style="--c:#3dffa8">Aurora</button></div>`);
      const hero = heroStats(el, 4);
      hero(0, hm(dec[0].t.d[0]), `daylight on ${dateLabel('dec')} at ${dec[0].m.name}, the shortest`);
      hero(1, hm(jun.at(-1)!.t.d[2]), `daylight on ${dateLabel('jun')} at ${jun.at(-1)!.m.name}, the longest`);
      hero(2, String(often), `of ${ts.length} places see the aurora overhead often`);
      hero(3, String(L.preserves.length), 'RASC dark-sky preserves in the province');
      const legend = el.appendChild(mk('div'));
      const drawLegend = () => {
        if (mode === 'aurora') {
          const [a, b] = AURORA_RAMP.domain();
          legend.innerHTML = `<h3>Geomagnetic latitude (IGRF-14 dipole, ${L.igrf.epoch})</h3>
            <div class="ramp" style="background:${rampCSS((t) => AURORA_RAMP(a + t * (b - a)))}"></div>
            <div class="ramp-labels"><span>${a}°</span><span>${L.kp.k0 - 4 * L.kp.perKp}° · ${L.kp.k0 - 2 * L.kp.perKp}°</span><span>${b}°</span></div>
            <ul class="note" style="margin:6px 0 0 16px;padding:0">${(['often', 'sometimes', 'rarely'] as const).map((k) => `<li><b>${AURORA_BANDS[k].label}</b> (${k === 'often' ? `${L.kp.k0 - 2 * L.kp.perKp}° and up` : k === 'sometimes' ? `${L.kp.k0 - 4 * L.kp.perKp}–${L.kp.k0 - 2 * L.kp.perKp}°` : `below ${L.kp.k0 - 4 * L.kp.perKp}°`}): ${AURORA_BANDS[k].text}. ${ts.filter((x) => x.t.a === k).length} places.</li>`).join('')}</ul>`;
        } else {
          const [a, b] = DAY_RAMP.domain();
          legend.innerHTML = `<h3>Hours from sunrise to sunset, ${esc(dateLabel(mode))}</h3>
            <div class="ramp" style="background:${rampCSS((t) => DAY_RAMP(a + t * (b - a)))}"></div>
            <div class="ramp-labels"><span>${a} h</span><span>${(a + b) / 2} h</span><span>${b} h</span></div>
            <div class="legend"><span><i class="sw" style="background:#140c30;border:1.5px solid ${PRESERVE_COLOR}"></i>dark-sky preserve (RASC)</span></div>`;
        }
      };
      drawLegend();
      el.insertAdjacentHTML('beforeend', '<h3>Daylight through the year</h3><div class="ld-chart"></div>');
      const chartBox = el.querySelector<HTMLElement>('.ld-chart')!;
      requestAnimationFrame(() => yearChart(chartBox, L));
      const presList = L.preserves.map((p) => `<li><b>${esc(p.name)}</b> (${esc(p.type)}, ${p.year ?? '?'}) · ${p.parks.map((x) => esc(x.name)).join(', ')} · <a href="${esc(safeUrl(p.info) ?? '#')}" target="_blank" rel="noopener">RASC</a></li>`).join('');
      const unm = L.unmapped.map((p) => `${esc(p.name)} (${esc(p.type)}, ${p.year ?? '?'})`).join('; ');
      el.insertAdjacentHTML('beforeend', `
        <h3>Dark-sky preserves</h3>
        <ul class="note" style="margin:0 0 6px 16px;padding:0">${presList}</ul>
        <p class="note">The Royal Astronomical Society of Canada designates places that keep their own lighting dark and shielded. Outlines are the parks’ own (Saskatchewan parts only: the Cypress Hills preserve runs on into Alberta).${unm ? ` RASC also lists ${unm}, which has no open outline, so it is not drawn.` : ''} Each place’s drive is to the nearest campground inside a preserve (${esc(L.routing)}).</p>
        <p class="note"><b>How it is worked out.</b> Day length is computed for ${L.year} from each place’s latitude with NOAA’s solar position equations: sunrise and sunset when the sun’s centre is 0.833° below the horizon (refraction and the sun’s radius), civil twilight while it is less than 6° below. It is the same at every longitude on a given latitude. Geomagnetic latitude uses the centred dipole of the ${esc(L.igrf.model)} model at ${L.igrf.epoch} (g₁⁰ ${L.igrf.g10}, g₁¹ ${L.igrf.g11}, h₁¹ ${L.igrf.h11} nT; north geomagnetic pole ${L.igrf.poleLat}°N ${Math.abs(L.igrf.poleLon)}°W). NOAA’s Space Weather Prediction Center puts the oval’s equatorward edge near ${L.kp.k0}° geomagnetic at Kp 0, about ${L.kp.perKp}° farther south for each step of Kp. The bands are that rule, not a probability: whether you see it depends on solar activity, clouds, the moon and city lights, and an aurora can be seen low in the north from hundreds of kilometres south of it.</p>
        ${sourceLine(L.source)}
        <p class="note"><a href="${esc(safeUrl(L.solarUrl) ?? '#')}" target="_blank" rel="noopener">NOAA solar equations</a> · <a href="${esc(safeUrl(L.igrf.url) ?? '#')}" target="_blank" rel="noopener">IGRF-14 coefficients</a> · <a href="${esc(safeUrl(L.kp.url) ?? '#')}" target="_blank" rel="noopener">NOAA SWPC: viewing the aurora</a> · <a href="${esc(safeUrl(L.rasc.url) ?? '#')}" target="_blank" rel="noopener">RASC dark-sky sites</a></p>`);
      const setOn = () => el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((btn) => btn.classList.toggle('on', btn.dataset.m === mode));
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m as Mode | undefined;
        if (!k || k === mode) return;
        mode = k;
        drawLegend();
        setOn();
      });
      setOn();
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('light') || !L) return null;
      const row = (k: string, v: string) => `<br><span class="tk">${k}</span> <span class="tv">${v}</span>`;
      if (id === 'light-preserve-base') {
        const p = info.object as PPoly;
        return `<b>${esc(p.name)}</b><br><span class="tk">RASC dark-sky preserve${p.year ? `, ${p.year}` : ''}</span>${row('Park', esc(p.park))}`;
      }
      if (id === 'light-aurora-base') {
        const c = info.object as Cell;
        const kp = Math.max(0, (L.kp.k0 - c[4]) / L.kp.perKp);
        const b: LightTown['a'] = c[4] >= L.kp.k0 - 2 * L.kp.perKp ? 'often' : c[4] >= L.kp.k0 - 4 * L.kp.perKp ? 'sometimes' : 'rarely';
        return `<b>Aurora overhead: ${AURORA_BANDS[b].label.toLowerCase()}</b>${row('Geomagnetic latitude', `${mlText(c[4])}°`)}${row('Oval overhead at', `Kp ${(Math.ceil(kp * 10) / 10).toFixed(1)}`)}`;
      }
      const r = info.object as Row;
      return `<b>${r.s.toFixed(2)}°–${r.n.toFixed(2)}°N</b>` + L.dates.map((d, i) => row(d.label, `${hm(r.d[i])} of daylight · ${hm(r.c[i])} with civil twilight`)).join('');
    },
  };
  return l;
}

/** Day length through the year at the province's southern edge, middle and northern edge. */
function yearChart(el: HTMLElement, L: Light) {
  const pick = [49, 54, 60].map((lat) => L.curves.find((c) => c.lat === lat)).filter((c): c is Light['curves'][number] => !!c);
  if (!pick.length) return;
  const w = el.clientWidth || 340, h = 150, m = { t: 8, r: 10, b: 20, l: 34 };
  const x = d3.scaleLinear().domain([1, 365]).range([m.l, w - m.r]);
  const y = d3.scaleLinear().domain([4, 20]).range([h - m.b, m.t]);
  const cols = ['#ffe39a', '#a3b8ff', '#3dffa8'];
  const svg = d3.select(el).append('svg').attr('width', w).attr('height', h);
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat(() => '')).call((s) => s.select('.domain').remove());
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((v) => `${v} h`).tickSize(0).tickPadding(6)).call((s) => s.select('.domain').remove());
  const monthStart = MONTHS.map((_, i) => Math.round((Date.UTC(L.year, i, 1) - Date.UTC(L.year, 0, 1)) / 864e5) + 1);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).tickValues(monthStart.filter((_, i) => i % 2 === 0)).tickFormat((v) => MONTHS[monthStart.indexOf(+v)]).tickSizeOuter(0));
  const line = d3.line<number>().x((_, i) => x(1 + i * 7)).y((v) => y(v)).curve(d3.curveMonotoneX);
  pick.forEach((c, i) => svg.append('path').attr('d', line(c.y)).attr('fill', 'none').attr('stroke', cols[i]).attr('stroke-width', 2));
  el.insertAdjacentHTML('beforeend', `<div class="legend">${pick.map((c, i) => `<span><i class="sw" style="background:${cols[i]}"></i>${c.lat}°N</span>`).join('')}</div>`);
}
