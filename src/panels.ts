// Town Report and Town Finder side panels.
import { Data, fmt } from './data';
import { lineChart } from './charts';
import { esc } from './html';
import { CRITERIA, CareTrip, TownMetrics, rankTowns, townMetrics } from './metrics';

const STORE_KEY = 'living-skies-atlas:weights';

export function loadWeights(): Record<string, number> {
  const def = Object.fromEntries(CRITERIA.map((c) => [c.id, c.defaultWeight]));
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (saved && typeof saved === 'object') return { ...def, ...saved };
  } catch { /* storage unavailable */ }
  return def;
}
function saveWeights(w: Record<string, number>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(w)); } catch { /* ignore */ }
}

type MetricFn = (label: string, dot: string, v: string, sub: string) => string;
const tripV = (t: CareTrip) => (t.inferred ? 'In town' : t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);
const tripSub = (t: CareTrip) => t.inferred ? `${esc(t.name)}: the place has its own police service (Statistics Canada), though no station is mapped in OpenStreetMap` : `${t.min != null ? 'drive' : 'straight line'} to ${esc(t.name)}${t.city ? `, ${esc(t.city)}` : ''} · ${Math.round(t.km)} km`;

// ---------------------------------------------------------------------------------------------

export function renderTownReport(el: HTMLElement, data: Data, key: string, opts: { onClose: () => void; rank?: { pos: number; of: number; score: number } }) {
  const t = townMetrics(data).find((x) => x.muni.key === key);
  if (!t) return;
  const m = t.muni;
  const metric: MetricFn = (label, dot, v, sub) =>
    `<div class="metric"><div class="mk"><span class="dot" style="background:${dot}"></span>${label}</div><div class="mv">${v}</div><div class="ms">${sub}</div></div>`;
  const na = '<span style="color:var(--ink-3)">n/a</span>';
  const link = (layer: string, text: string) => `<button class="tr-fall" data-layer="${layer}" type="button">${text} ›</button>`;
  const csiSub = t.csi != null ? `index, ${t.csiYear} (lower = safer)${t.police ? `<br>${esc(t.police.name)}${t.police.rural ? ' (covers the surrounding area)' : ''}` : ''}` : 'no police-service series for this place';

  el.innerHTML = `
    <button class="close-x" aria-label="Close town report">×</button>
    <div class="kicker" style="--c:#ffffff">${esc(m.kind)} · ${esc(m.rd)} Saskatchewan${t.treaty ? ` · ${esc(t.treaty)} territory` : ''}</div>
    <h2>${esc(m.name)}</h2>
    ${opts.rank ? `<p class="lede">Ranks <b>#${opts.rank.pos} of ${opts.rank.of}</b> in your Town Finder (score ${Math.round(opts.rank.score * 100)}).</p>` : ''}
    <h3>Safety &amp; justice</h3>
    <div class="metric-grid">
      ${metric('Crime Severity', '#ff4d8d', t.csi != null ? t.csi.toFixed(0) : na, csiSub)}
      ${metric('Violent crime', '#ff4d8d', t.vcsi != null ? t.vcsi.toFixed(0) : na, t.vcsi != null ? `Violent Crime Severity Index, ${t.csiYear}` : '')}
      ${metric('Crimes solved', '#ff4d8d', t.clear != null ? `${t.clear.toFixed(0)}%` : na, t.clear != null ? `weighted clearance rate, ${t.csiYear}` : '')}
      ${data.justice ? metric('Courthouse', '#ffd166', t.court ? tripV(t.court) : na, t.court ? tripSub(t.court) : 'none reachable by road') : ''}
      ${data.justice ? metric('Police', '#5aa9ff', t.policeStation ? tripV(t.policeStation) : na, t.policeStation ? tripSub(t.policeStation) : 'none reachable by road') : ''}
      ${data.hospitals ? metric('Hospital', '#6c8cff', t.hospital ? tripV(t.hospital) : na, t.hospital ? tripSub(t.hospital) : 'none reachable by road') : ''}
    </div>
    <div class="tr-falls" style="margin-top:8px">${link('crime', '◆ Crime severity on the map')}${data.justice ? link('justice', '⚖ Courts &amp; police') : ''}</div>
    <h3>People</h3>
    <div class="metric-grid">
      ${metric('Population', '#3ecf8e', t.pop ? fmt.int(t.pop) : na, t.popYear ? `1 July ${t.popYear}${t.popGrowth5y != null ? ` · ${fmt.signed(t.popGrowth5y * 100, 0)}% in 5 yrs` : ''}` : '')}
      ${metric('Region', '#3ecf8e', esc(m.rd), t.treaty ? `in the ${esc(t.treaty)} area` : '')}
      ${data.camping ? metric('Campground', '#59d18c', t.camp ? tripV(t.camp) : na, t.camp ? tripSub(t.camp) : 'none reachable by road') : ''}
      ${data.camping ? metric('Parks nearby', '#59d18c', String(t.parks50km), 'provincial, national and regional parks and rec sites within 50 km') : ''}
    </div>
    ${data.camping ? `<div class="tr-falls" style="margin-top:8px">${link('camping', '⛺ Camping &amp; rec on the map')}</div>` : ''}
    <h3>Hazards &amp; climate</h3>
    <div class="metric-grid">
      ${metric('Wildfires nearby', '#ff8a3d', fmt.int(t.fires25km), `started within 25 km since 1990 · ${fmt.ha(t.burnedHa50km)} burned within 50 km`)}
      ${metric('Tornadoes', '#9ad8ff', fmt.int(t.tornadoes50km), 'on record within 50 km, 1980–2009 and 2017 on')}
      ${metric('Climate', '#f25f5c', t.climate ? `${t.climate.meanTemp.toFixed(1)} °C` : na, t.climate ? `mean since 1991${t.climate.precip ? ` · ${Math.round(t.climate.precip)} mm/yr` : ''} · ${esc(t.climate.name)} (${Math.round(t.climate.dist)} km)` : '')}
    </div>
    ${feelsRow(t, data, metric, na)}
    ${t.climate?.trend != null ? `<div class="callout" style="--c:#f25f5c">The nearest long-term station (${esc(t.climate.name)}) has warmed <b>${fmt.signed(t.climate.trend, 2)} °C per decade</b> since 1950.</div>` : ''}
    ${t.river ? `<div class="callout" style="--c:#4cc9f0"><b>${esc(t.river.name)}</b> (${t.river.dist.toFixed(0)} km away) reached 1.5× its normal peak in ${Math.round(t.river.floodShare * 100)}% of years; its record was ${t.river.record.ratio.toFixed(1)}× in ${t.river.record.year}.</div>` : ''}
    ${t.pop ? '<h3>Population</h3><div id="tr-pop"></div>' : ''}
    ${t.csi != null ? '<h3>Crime Severity Index</h3><div id="tr-crime"></div>' : ''}
    <p class="note">Distances are from the town centre. Crime figures come from the police service that covers the place; hazard counts describe history, not a forecast.</p>`;
  el.querySelector('.close-x')!.addEventListener('click', opts.onClose);
  el.querySelectorAll<HTMLElement>('[data-layer]').forEach((b) => b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:layer', { detail: b.dataset.layer }))));

  requestAnimationFrame(() => {
    const p = data.population?.munis[key];
    if (p && el.querySelector('#tr-pop')) {
      const all = Object.entries(p.pop).map(([y, v]) => ({ x: +y, y: v }));
      lineChart(el.querySelector('#tr-pop')!, { height: 110, xDomain: [all[0].x, all.at(-1)!.x], yZero: false, series: [{ key: 'e', label: 'Estimate', color: '#3ecf8e', values: all }], valueFormat: fmt.int });
    }
    const c = data.crime?.munis[key]?.csi;
    if (c && el.querySelector('#tr-crime')) {
      const vals = Object.entries(c).map(([y, v]) => ({ x: +y, y: v }));
      const sk = Object.entries(data.crime?.prov?.csi ?? {}).map(([y, v]) => ({ x: +y, y: v }));
      lineChart(el.querySelector('#tr-crime')!, { height: 110, xDomain: [vals[0].x, vals.at(-1)!.x], series: [{ key: 'c', label: m.name, color: '#ff4d8d', values: vals }, { key: 'sk', label: 'Saskatchewan', color: '#ffffff', dashed: true, width: 1.5, values: sk }] });
    }
  });
}

/** "What it feels like": 30-year climate normals, each from the nearest station that reports it. */
function feelsRow(t: TownMetrics, data: Data, metric: MetricFn, na: string) {
  if (!data.normals) return '';
  const f = t.feels;
  const from = (p: TownMetrics['feels']['sun']) => (p ? `${esc(p.name)} (${Math.round(p.dist)} km)` : 'no station nearby');
  const c = '#c5e86c';
  return `<h3>What it feels like · ${data.normals.period} normals</h3>
    <div class="metric-grid">
      ${metric('Sunshine', c, f.sun ? `${fmt.int(f.sun.v)} h` : na, `a year · ${from(f.sun)}`)}
      ${metric('Rain & snow days', c, f.wetDays ? fmt.int(f.wetDays.v) : na, `≥0.2 mm a year · ${from(f.wetDays)}`)}
      ${metric('Frost days', c, f.frostDays ? fmt.int(f.frostDays.v) : na, `low ≤0 °C · ${from(f.frostDays)}`)}
      ${metric('Snowfall', c, f.snow ? `${fmt.int(f.snow.v)} cm` : na, `a year · ${from(f.snow)}`)}
    </div>`;
}

// ---------------------------------------------------------------------------------------------

export function renderFinder(
  el: HTMLElement,
  data: Data,
  weights: Record<string, number>,
  opts: { onChange: (ranked: ReturnType<typeof rankTowns>) => void; onPick: (key: string) => void; onClose: () => void },
) {
  const towns: TownMetrics[] = townMetrics(data);
  el.innerHTML = `
    <button class="close-x" aria-label="Close Town Finder">×</button>
    <div class="kicker" style="--c:#a99bff">Town Finder</div>
    <h2>Where should we live?</h2>
    <p class="lede">Tell the atlas what matters to you. Every place is ranked on each factor from the open data, then blended using your weights. Columns on the map show the overall score.</p>
    <div class="weights"></div>
    <div class="chips" style="margin:6px 0 4px">
      <button class="chip" data-preset="balanced">Balanced</button>
      <button class="chip" data-preset="safe">Safety first</button>
      <button class="chip" data-preset="family">Growing family</button>
      <button class="chip" data-preset="quiet">Quiet &amp; small</button>
    </div>
    <h3>Your ranking</h3>
    <ol class="rank-list"></ol>
    <p class="note">Scores are relative (0–100 = worst to best among the atlas’s places on your criteria). Missing data (a place with no police series, say) is skipped rather than penalized. Your weights are saved in this browser.</p>`;
  el.querySelector('.close-x')!.addEventListener('click', opts.onClose);

  const wEl = el.querySelector('.weights')!;
  for (const c of CRITERIA) {
    const row = document.createElement('label');
    row.className = 'weight';
    row.title = c.hint;
    row.innerHTML = `<span>${c.label}<br><span style="color:var(--ink-3);font-size:11px">${c.hint}</span></span><input type="range" min="0" max="5" step="1" value="${weights[c.id]}" data-id="${c.id}"><span class="wv">${weights[c.id]}</span>`;
    wEl.appendChild(row);
  }
  const list = el.querySelector('.rank-list')!;
  const zero = Object.fromEntries(CRITERIA.map((c) => [c.id, 0]));
  const PRESETS: Record<string, Record<string, number>> = {
    balanced: Object.fromEntries(CRITERIA.map((c) => [c.id, c.defaultWeight])),
    safe: { ...zero, safety: 5, violent: 5, solved: 3, police: 3, court: 1, hospital: 3, fire: 1, services: 1 },
    family: { ...zero, safety: 3, violent: 3, hospital: 4, growth: 4, services: 3, warm: 1, sun: 1, fire: 1 },
    quiet: { ...zero, safety: 3, violent: 3, services: 0, fire: 3, tornado: 2, hospital: 2, sun: 1 },
  };

  const refresh = () => {
    const ranked = rankTowns(towns, weights);
    list.innerHTML = ranked
      .map((r, i) => `<li data-key="${r.t.muni.key}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.t.muni.name)}</span><br><span class="rd">${r.t.pop ? fmt.int(r.t.pop) + ' people' : ''}${r.t.csi != null ? ` · CSI ${r.t.csi.toFixed(0)}` : ''}</span></span><span><div class="bar"><i style="width:${Math.round(r.score * 100)}%"></i></div><div class="bar-v">${Math.round(r.score * 100)}</div></span></li>`)
      .join('');
    opts.onChange(ranked);
  };
  wEl.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    weights[inp.dataset.id!] = +inp.value;
    inp.nextElementSibling!.textContent = inp.value;
    saveWeights(weights);
    refresh();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      Object.assign(weights, PRESETS[b.dataset.preset!]);
      wEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.value = String(weights[i.dataset.id!]); i.nextElementSibling!.textContent = i.value; });
      saveWeights(weights);
      refresh();
    }),
  );
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (li) opts.onPick(li.dataset.key!);
  });
  refresh();
}
