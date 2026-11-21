// Climate twins: "by 2041–2070, Prince Albert's climate is projected to be like
// Balgonie's today", drawn as an arc from the town to its twin. The `twins` data stage does the matching (a place's
// observed normals plus the projected change, against every Saskatchewan station's normals today, on annual mean
// temperature and precipitation); this module only draws it: the Climate layer's Climate twin chip, its arcs, and the
// Town Report's row.
//
// A twin is model output matched on two numbers, never a forecast of what a town will be like, so it follows the
// projections' rules (src/projections.ts): badged, shown per emissions scenario with the twins of the models' 10th and
// 90th percentile beside the median's, and never read by the Town Finder. "Warmer than anywhere in Saskatchewan
// today" is a finding and is said plainly. Every place's normals are a nearby station's: both ends name theirs.
import type { Layer, PickingInfo } from '@deck.gl/core';
import { ArcLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Data, Muni, ProjScen, TwinMatch, TwinStation, Twins } from './data';
import { esc } from './html';
import { Ctx, NO_DEPTH, mk, rgb, sourceLine } from './layer-kit';
import { reducedMotion } from './particles';
import { PROJ_BADGE, SCEN_COLOR, SCEN_SHORT, windowText } from './projections';

const SCENS: ProjScen[] = ['ssp126', 'ssp585'];
/** What the chip shows: kept while the app is open, so the Town Report's link and a return to the layer find it. */
const st = { on: false, town: null as string | null, all: false, w: 1, sc: { ssp126: true, ssp585: true } as Record<ProjScen, boolean> };
const sig = () => `${st.on}|${st.town}|${st.all}|${st.w}|${st.sc.ssp126}|${st.sc.ssp585}`;

export const twinOn = (data: Data) => st.on && !!data.twins;

/** Opens the Climate layer on the Climate twin chip with a place picked (the Town Report's link). */
export function openTwin(key: string) {
  st.on = true; st.all = false; st.town = key; st.w = 1;
  window.dispatchEvent(new CustomEvent('atlas:layer', { detail: 'climate' }));
}

const WARMER = 'warmer than anywhere in Saskatchewan today';
const NO_MATCH = 'like nowhere in Saskatchewan today';
const muniName = (data: Data, key: string) => data.munis.find((m) => m.key === key)?.name ?? key;
/** A twin station's name as plain text: the place it stands for, or its own name. */
const stationName = (data: Data, s: TwinStation) => (s.k ? muniName(data, s.k) : s.name);
/** "like Balgonie today", "warmer than anywhere in Saskatchewan today"… (plain text). */
const twinText = (data: Data, T: Twins, e: TwinMatch) => (e[0] >= 0 ? `like ${stationName(data, T.stations[e[0]])} today` : e[0] === -1 ? WARMER : NO_MATCH);
/** One end of a range, shorter: a name, or why there is none. */
const endText = (data: Data, T: Twins, e: TwinMatch) => (e[0] >= 0 ? stationName(data, T.stations[e[0]]) : e[0] === -1 ? 'warmer than anywhere here today' : 'no close match');
const climateText = (t: number, p: number) => `${t.toFixed(1)} °C, ${Math.round(p)} mm a year`;
/** Where a twin's normals come from: its station, and how far that is from the place it stands for. */
const stationNote = (data: Data, s: TwinStation) => (s.k ? `normals at ${s.name}, ${s.km} km from ${muniName(data, s.k)}` : `a weather station, ${s.km} km from ${muniName(data, s.near)}`);
const wOf = (T: Twins) => T.windows[Math.min(st.w, T.windows.length - 1)];

/** A scenario's line for a place and window, as HTML: the median's twin, then the range. */
function scenLine(data: Data, T: Twins, key: string, sc: ProjScen, wi: number) {
  const row = T.towns[key]?.tw[sc]?.[wi];
  if (!row) return '';
  const [med, lo, hi] = row;
  const s = med[0] >= 0 ? T.stations[med[0]] : null;
  const head = s ? `like <b>${esc(stationName(data, s))}</b> today` : `<b>${med[0] === -1 ? WARMER : NO_MATCH}</b>`;
  const why = s ? `${esc(stationNote(data, s))}: ${climateText(s.t, s.p)}` : med[0] === -1 ? `the warmest station today averages ${T.maxT.toFixed(1)} °C` : 'no station is close in both warmth and precipitation';
  const range = lo[0] !== hi[0] ? `models’ range: ${esc(endText(data, T, lo))} to ${esc(endText(data, T, hi))}` : lo[0] === med[0] ? 'and across the models’ 10th to 90th percentile' : `models’ range: ${esc(endText(data, T, lo))} at both ends`;
  return `<div class="twin-line"><i class="sw proj-sw" style="--c:${SCEN_COLOR[sc]}"></i><span><span class="tk">${SCEN_SHORT[sc]}:</span> ${head} <span class="rd">(${range})</span><br><span class="rd">projected ${climateText(med[1], med[2])} · ${why}</span></span></div>`;
}

// ---- the map

type Arc = { key: string; sc: ProjScen; q: number; from: [number, number]; to: [number, number] };
type Dot = { m: Muni; state: number };
type Label = { pos: [number, number]; text: string; color: [number, number, number, number]; up: boolean };
let memo: { sig: string; arcs: Arc[]; dots: Dot[]; labels: Label[]; ends: { s: TwinStation; sc: ProjScen }[] } | null = null;
/** The selection whose arcs have left the ground: a new one is first drawn flat, so its arcs grow from the town. */
let grownFor = '';

function scene(data: Data, T: Twins) {
  const who = `${st.all}|${st.town}`;
  const flat = who !== grownFor && !reducedMotion();
  const s = `${sig()}|${flat}`;
  if (memo?.sig === s) return memo;
  grownFor = who;
  const wi = Math.min(st.w, T.windows.length - 1);
  const on = SCENS.filter((sc) => st.sc[sc]);
  const pos = (m: Muni): [number, number] => [m.lon, m.lat];
  const arcs: Arc[] = [];
  const labels: Label[] = [];
  const ends: { s: TwinStation; sc: ProjScen }[] = [];
  const arcsOf = (m: Muni, qs: number[]) => {
    // every scenario keeps its rows (a hidden one is drawn with no length), so the arcs slide when the window moves
    for (const sc of SCENS) for (const q of qs) {
      const e = T.towns[m.key]?.tw[sc]?.[wi]?.[q];
      const hit = !flat && st.sc[sc] && e && e[0] >= 0 ? T.stations[e[0]] : null;
      arcs.push({ key: m.key, sc, q, from: pos(m), to: hit ? [hit.lon, hit.lat] : pos(m) });
      if (hit && q === 0) ends.push({ s: hit, sc });
    }
  };
  const town = st.all ? null : data.munis.find((m) => m.key === st.town && T.towns[m.key]);
  if (st.all) for (const m of data.munis) arcsOf(m, [0]);
  else if (town) {
    arcsOf(town, [1, 2, 0]);
    // the scenarios with no twin, said at the town: one line when they agree
    const none = new Map<string, ProjScen[]>();
    for (const sc of on) { const e = T.towns[town.key].tw[sc][wi][0]; if (e[0] < 0) { const why = endText(data, T, e); none.set(why, [...(none.get(why) ?? []), sc]); } }
    labels.push({ pos: pos(town), text: [`${town.name}, ${windowText(T.windows[wi], T.windowYears)}`, ...[...none].map(([why, scs]) => `${scs.map((sc) => SCEN_SHORT[sc]).join(' and ')}:\n${why}`)].join('\n'), color: [255, 255, 255, 255], up: false });
    const byStation = new Map<TwinStation, ProjScen[]>();
    for (const e of ends) byStation.set(e.s, [...(byStation.get(e.s) ?? []), e.sc]);
    for (const [stn, scs] of byStation)
      labels.push({ pos: [stn.lon, stn.lat], text: `like ${stationName(data, stn)} today\n${scs.map((sc) => SCEN_SHORT[sc]).join(' and ')}`, color: rgb(SCEN_COLOR[scs[scs.length - 1]], 255), up: true });
  }
  // a place's dot: 0 has a twin under a shown scenario, 1 warmer than anywhere under one, 2 no close match, 3 no data
  const dots = data.munis.map((m) => {
    const es = on.map((sc) => T.towns[m.key]?.tw[sc]?.[wi]?.[0]).filter((e): e is TwinMatch => !!e);
    return { m, state: !es.length ? 3 : es.some((e) => e[0] === -1) ? 1 : es.some((e) => e[0] >= 0) ? 0 : 2 };
  });
  return (memo = { sig: s, arcs, dots, labels, ends });
}

const DOT: [number, number, number, number][] = [[255, 255, 255, 235], [224, 49, 43, 255], [150, 156, 170, 235], [90, 96, 110, 160]];

export function twinLayers(data: Data, ctx: Ctx): Layer[] {
  const T = data.twins;
  if (!T) return [];
  const sc = scene(data, T);
  const ms = reducedMotion() ? 0 : 900;
  const one = !st.all;
  const out: Layer[] = [
    // the stations a twin can land on, faint: what "today" means here
    new ScatterplotLayer<TwinStation>({
      id: 'climate-twin-stations', data: T.stations, getPosition: (s) => [s.lon, s.lat], getRadius: 1600, radiusMinPixels: 2, radiusMaxPixels: 5,
      getFillColor: [197, 232, 108, 110], pickable: true, parameters: NO_DEPTH,
    }),
    new ArcLayer<Arc>({
      id: one ? 'climate-twin-arcs' : 'climate-twin-arcs-all', data: sc.arcs,
      getSourcePosition: (a) => a.from, getTargetPosition: (a) => a.to,
      getSourceColor: (a) => [255, 255, 255, a.q === 0 ? (one ? 220 : 120) : 70],
      getTargetColor: (a) => rgb(SCEN_COLOR[a.sc], a.q === 0 ? (one ? 255 : 190) : 110),
      getWidth: (a) => (a.q === 0 ? (one ? 4 : 1.6) : 1.4), widthUnits: 'pixels', getHeight: 0.45, greatCircle: false,
      transitions: { getTargetPosition: ms },
      parameters: NO_DEPTH,
    } as any),
    new ScatterplotLayer<Dot>({
      id: 'climate-twin-places', data: sc.dots, getPosition: (d) => [d.m.lon, d.m.lat],
      getRadius: (d) => (d.m.key === st.town && one ? 3400 : 2300), radiusMinPixels: 3.5, radiusMaxPixels: 10,
      getFillColor: (d) => DOT[d.state], stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 1.2,
      updateTriggers: { getFillColor: sc, getRadius: sc }, pickable: true, parameters: NO_DEPTH,
    } as any),
  ];
  if (one && sc.ends.length)
    out.push(new ScatterplotLayer<{ s: TwinStation; sc: ProjScen }>({
      id: 'climate-twin-ends', data: sc.ends, getPosition: (e) => [e.s.lon, e.s.lat], getRadius: 3000, radiusMinPixels: 6, radiusMaxPixels: 11,
      filled: false, stroked: true, getLineColor: (e) => rgb(SCEN_COLOR[e.sc], 255), lineWidthMinPixels: 2.5, parameters: NO_DEPTH,
    } as any));
  if (sc.labels.length && ctx.focusedId === 'climate')
    out.push(new TextLayer<Label>({
      id: 'climate-twin-labels', data: sc.labels, getPosition: (l) => l.pos, getText: (l) => l.text, getColor: (l) => l.color,
      getSize: 13, getPixelOffset: (l) => [0, l.up ? -16 : 16], getAlignmentBaseline: (l) => (l.up ? 'bottom' : 'top'),
      fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 4, outlineColor: [6, 10, 18, 235], fontSettings: { sdf: true },
      parameters: NO_DEPTH,
    } as any));
  return out;
}

/** Frames the picked town and its twins. */
function fly(data: Data) {
  const T = data.twins, m = data.munis.find((x) => x.key === st.town);
  if (!T || !m || st.all) return;
  const wi = Math.min(st.w, T.windows.length - 1);
  const pts: [number, number][] = [[m.lon, m.lat]];
  for (const sc of SCENS) if (st.sc[sc]) for (const e of T.towns[m.key]?.tw[sc]?.[wi] ?? []) if (e[0] >= 0) pts.push([T.stations[e[0]].lon, T.stations[e[0]].lat]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  window.dispatchEvent(new CustomEvent('atlas:fly', { detail: { bounds: [[Math.min(...xs) - 0.9, Math.min(...ys) - 0.5], [Math.max(...xs) + 0.9, Math.max(...ys) + 0.5]] } }));
}

/**
 * A click on a place (its twin dot, or its town pin while the chip is on) picks it; any other twin object is left
 * alone. True when the click was the twin's.
 */
export function twinClick(data: Data, info: PickingInfo) {
  const id = info.layer?.id ?? '', o: any = info.object;
  if (!twinOn(data)) return false;
  const key: string | undefined = id.startsWith('climate-twin') ? o?.m?.key : id === 'towns-pins' ? o?.key : undefined;
  if (key && data.twins?.towns[key]) { st.town = key; st.all = false; fly(data); return true; }
  return id.startsWith('climate-twin');
}

export function twinTooltip(data: Data, info: PickingInfo) {
  const T = data.twins, id = info.layer?.id ?? '', o: any = info.object;
  if (!T || !o || !id.startsWith('climate-twin')) return null;
  if (id === 'climate-twin-stations') {
    const s = o as TwinStation;
    return `<b>${esc(s.name)}</b><br><span class="tk">${esc(T.normalsPeriod)} normals</span> <span class="tv">${climateText(s.t, s.p)}</span><br><span class="tk">A station a twin can land on${s.k ? `: it stands for ${esc(muniName(data, s.k))}` : ''}</span>`;
  }
  const m: Muni | undefined = o.m;
  if (!m) return null;
  const tw = T.towns[m.key];
  if (!tw) return `<b>${esc(m.name)}</b><br><span class="tk">No station with temperature and precipitation normals nearby</span>`;
  const wi = Math.min(st.w, T.windows.length - 1);
  const lines = SCENS.filter((sc) => st.sc[sc]).map((sc) => `<br><span class="tk">${SCEN_SHORT[sc]}</span> <span class="tv">${esc(twinText(data, T, tw.tw[sc][wi][0]))}</span>`).join('');
  return `<b>${esc(m.name)}</b> <span class="proj-badge">projection</span><br><span class="tk">Climate twin, ${windowText(T.windows[wi], T.windowYears)}</span>${lines}<br><span class="tk">Click to draw its arc</span>`;
}

// ---- the Climate panel's block

export function twinPanel(el: HTMLElement, data: Data, color: string) {
  const T = data.twins;
  if (!T) return { update() {} };
  const towns = data.munis.filter((m) => T.towns[m.key]).sort((a, b) => a.name.localeCompare(b.name));
  const box = el.appendChild(mk('div', 'twin-box'));
  box.innerHTML = `<div class="chips"><button class="chip" type="button" data-twin="on" style="--c:${color}">Climate twin</button></div>
    <div class="twin-ui" hidden>
      <h3>Whose climate today is this town’s future? ${PROJ_BADGE}</h3>
      <p class="rd">Click a place on the map or pick one here. An arc lands on the Saskatchewan weather station whose climate today is nearest the place’s projected one.</p>
      <select class="sc-pick twin-town" aria-label="Place"><option value="">Pick a place…</option>${towns.map((m) => `<option value="${esc(m.key)}">${esc(m.name)}</option>`).join('')}</select>
      <div class="air-scrub" style="--c:${color}"><input type="range" min="0" max="${T.windows.length - 1}" step="1" aria-label="30-year period"><span class="twin-when"></span></div>
      <div class="chips" style="margin:6px 0 8px">${SCENS.map((sc) => `<button class="chip" type="button" data-sc="${sc}" style="--c:${SCEN_COLOR[sc]}">${SCEN_SHORT[sc]}</button>`).join('')}<button class="chip" type="button" data-twin="all" style="--c:${color}">Every place</button></div>
      <div class="twin-out" aria-live="polite"></div>
      <div class="legend"><span><i class="sw" style="background:#fff"></i>has a twin</span><span><i class="sw" style="background:#e0312b"></i>warmer than anywhere here today</span><span><i class="sw" style="background:#969caa"></i>no close match</span></div>
      <p class="note">A twin is a <b>model range matched on two numbers</b>, annual mean temperature and total precipitation, not a forecast of what a town will be like: soils, daylight, water and people do not move. Each place’s future is its own ${esc(T.normalsPeriod)} normals plus the models’ projected change since then, compared with every Saskatchewan station’s normals today; each number counts by its spread across the stations (${T.spread.t.toFixed(1)} °C, ${T.spread.p} mm), and a nearest station farther than ${T.maxD} of those spreads is no twin. The thick arc is the twin of the models’ median, the thin ones of their 10th and 90th percentile. The projections are changes from ${esc(T.baseline)}; the ${Math.round(T.baseShare * 100)}% of the change to ${windowText(T.windows[0], T.windowYears)} taken as already made by the normals’ period is the atlas’s own estimate (a straight line between the two). Every place borrows a nearby station’s normals, named with its distance. Only stations inside Saskatchewan are compared, so the south soon has no twin. The timeline does not move the twin: use the slider here. Twins never rank towns in the Town Finder.</p>
      ${sourceLine(`${T.source}, ${T.asOf}.`)}
    </div>`;
  const ui = box.querySelector<HTMLElement>('.twin-ui')!;
  const sel = box.querySelector<HTMLSelectElement>('.twin-town')!;
  const range = box.querySelector<HTMLInputElement>('input[type=range]')!;
  const out = box.querySelector<HTMLElement>('.twin-out')!;
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-twin],[data-sc]');
    if (!b) return;
    if (b.dataset.twin === 'on') st.on = !st.on;
    else if (b.dataset.twin === 'all') st.all = !st.all;
    else {
      const sc = b.dataset.sc as ProjScen;
      // one scenario always stays on
      if (!st.sc[sc] || SCENS.some((x) => x !== sc && st.sc[x])) st.sc[sc] = !st.sc[sc];
    }
    draw();
  });
  sel.addEventListener('change', () => { st.town = sel.value || null; if (st.town) { st.all = false; fly(data); } draw(); });
  range.addEventListener('input', () => { st.w = +range.value; draw(); });

  let shown = '';
  const draw = () => {
    shown = sig();
    box.querySelector('[data-twin="on"]')!.classList.toggle('on', st.on);
    ui.hidden = !st.on;
    if (!st.on) return;
    box.querySelector('[data-twin="all"]')!.classList.toggle('on', st.all);
    for (const sc of SCENS) box.querySelector(`[data-sc="${sc}"]`)!.classList.toggle('on', st.sc[sc]);
    const wi = Math.min(st.w, T.windows.length - 1);
    range.value = String(wi);
    box.querySelector('.twin-when')!.textContent = `${windowText(wOf(T), T.windowYears)} average`;
    sel.value = st.town && T.towns[st.town] ? st.town : '';
    const on = SCENS.filter((sc) => st.sc[sc]);
    if (st.all) {
      out.innerHTML = `<div class="twin-head">Every place, ${windowText(wOf(T), T.windowYears)}</div>` + on.map((sc) => {
        const es = towns.map((m) => T.towns[m.key].tw[sc][wi][0][0]);
        const n = (f: (i: number) => boolean) => es.filter(f).length;
        return `<div class="twin-line"><i class="sw proj-sw" style="--c:${SCEN_COLOR[sc]}"></i><span><span class="tk">${SCEN_SHORT[sc]}:</span> <b>${n((i) => i >= 0)}</b> of ${es.length} places have a twin in Saskatchewan, <b>${n((i) => i === -1)}</b> are ${WARMER}, ${n((i) => i === -2)} have no close match</span></div>`;
      }).join('');
      return;
    }
    const tw = st.town ? T.towns[st.town] : null;
    if (!tw || !st.town) { out.innerHTML = `<div class="rd">No place picked yet.</div>`; return; }
    const own = T.stations[tw.s];
    out.innerHTML = `<div class="twin-head">${esc(muniName(data, st.town))}, ${windowText(wOf(T), T.windowYears)}</div>
      ${on.map((sc) => scenLine(data, T, st.town!, sc, wi)).join('')}
      <div class="rd" style="margin-top:6px">${esc(muniName(data, st.town))}’s own normals are borrowed from ${esc(own.name)}, ${tw.km} km away: ${climateText(own.t, own.p)} (${esc(T.normalsPeriod)}).</div>`;
  };
  draw();
  // a click on the map changes the pick: the panel follows on the next frame
  return { update() { if (sig() !== shown) draw(); } };
}

// ---- the Town Report row (src/panels.ts places it)

/** "Climate twin, 2041–2070: like X today (models' range: Y to Z)", per scenario. */
export function twinRow(data: Data, key: string) {
  const T = data.twins, tw = T?.towns[key];
  if (!T || !tw) return '';
  const wi = Math.max(0, T.windows.indexOf(2041));
  const own = T.stations[tw.s];
  return `<div class="proj-row twin-row">
    <div class="pr-k">${PROJ_BADGE}</div>
    <div class="pr-v">Climate twin, ${windowText(T.windows[wi], T.windowYears)}</div>
    ${SCENS.map((sc) => scenLine(data, T, key, sc, wi)).join('')}
    <div class="pr-s">The Saskatchewan station whose climate today is nearest this place’s projected one, matched on annual mean temperature and precipitation only: a model range, not a forecast of what the town will be like. Its own normals are borrowed from ${esc(own.name)} (${tw.km} km).</div>
    <div class="tr-falls" style="margin-top:8px"><button class="tr-fall tr-twin" type="button">🌡 Draw the arc on the map ›</button></div>
  </div>`;
}
