// INSIDE THE CITIES — Regina and Saskatoon are each one dot with one home value and one crime rate on the province map.
// Their Town Reports open with a map of their 2021 census tracts (public/data/tracts.json), tinted by a census measure the
// visitor picks. Census values only: tract figures are rounded and some are suppressed ("—", left untinted), and
// nothing here is on the same scale as the province-wide layers.
import * as d3 from 'd3';
import { Data, Tract, fmt } from './data';
import { esc, safeUrl } from './html';
import { rampCSS } from './charts';

type Measure = { id: string; chip: string; label: string; value: (t: Tract) => number | null; fmt: (v: number) => string; ramp: string[] };
const pct = (a: number | undefined, b: number | undefined) => (a == null || !b ? null : (a / b) * 100);
const MEASURES: Measure[] = [
  { id: 'value', chip: 'Home value', label: 'median value of owned dwellings, 2021', value: (t) => t.value ?? null, fmt: fmt.money, ramp: ['#2a3a66', '#ffd2a8'] },
  { id: 'inc', chip: 'Income', label: 'median household income, 2020', value: (t) => t.inc ?? null, fmt: fmt.money, ramp: ['#3a3f6b', '#ffe08a'] },
  { id: 'rent', chip: 'Renters', label: 'share of households renting', value: (t) => pct(t.renters, (t.owners ?? 0) + (t.renters ?? 0)), fmt: (v) => `${v.toFixed(0)}%`, ramp: ['#23324f', '#9ad8ff'] },
  { id: 'stir', chip: 'Stretched', label: 'households spending 30 %+ of income on shelter', value: (t) => t.stir30 ?? null, fmt: (v) => `${v.toFixed(0)}%`, ramp: ['#2a3a66', '#ff7a6b'] },
  { id: 'imm', chip: 'Immigrants', label: 'immigrants, share of people in private households', value: (t) => (t.imm ? pct(t.imm, t.hhPop) : null), fmt: (v) => `${v.toFixed(0)}%`, ramp: ['#4b3a63', '#f0a6ca'] },
  { id: 'ind', chip: 'Indigenous identity', label: 'First Nations, Métis or Inuit, share of people in private households', value: (t) => (t.ind ? pct(t.ind, t.indTot) : null), fmt: (v) => `${v.toFixed(0)}%`, ramp: ['#3b3a2a', '#ffd166'] },
];

let current = 'value';

/** The neighbourhood block for a city's Town Report, or '' when the city has no census tracts. */
export function cityTractsHTML(data: Data, key: string) {
  const ts = data.tracts?.tracts.filter((t) => t.city === key && !t.out) ?? [];
  if (!ts.length) return '';
  return `<h3>Inside the city · ${ts.length} census tracts</h3>
    <div class="chips tr-ct-chips" style="margin:2px 0 6px">${MEASURES.map((m) => `<button class="chip${m.id === current ? ' on' : ''}" data-ct="${m.id}" style="--c:#9ad8ff">${m.chip}</button>`).join('')}</div>
    <div class="tr-ct-map" style="position:relative"></div>
    <div class="tr-ct-key"></div>
    <p class="note">Census 2021 by census tract (about 2,500–8,000 people each), inside the city limits; thin white lines are the city’s own neighbourhoods, named on hover (a tract and a neighbourhood rarely line up). Statistics Canada rounds counts and suppresses some tracts’ figures: those read “—” and are left grey, never zero. Nothing here is on the scale of the province-wide layers. There is no crime map: ${key === 'regina' ? 'Regina Police publish counts by their own areas and a 90-day occurrence map, but with no reuse licence' : 'Saskatoon Police publish city-wide figures only'}, so the city’s Crime Severity Index above stays the one comparable measure.</p>
    ${(() => { const h = data.tracts?.hoodSources?.[key]; const u = h && safeUrl(h.licenceUrl); return h ? `<p class="note">Neighbourhoods: ${esc(h.source)}, ${u ? `<a href="${u}" target="_blank" rel="noopener">${esc(h.licence)}</a>` : esc(h.licence)}. ${esc(data.tracts!.source)}; ${esc(data.tracts!.censusSource)}.</p>` : ''; })()}`;
}

/** Draws the tract map into a report rendered with `cityTractsHTML`. */
export function drawCityTracts(el: HTMLElement, data: Data, key: string) {
  const box = el.querySelector<HTMLElement>('.tr-ct-map');
  if (!box) return;
  const ts = data.tracts!.tracts.filter((t) => t.city === key && !t.out);
  const W = Math.max(260, box.clientWidth || 320), H = Math.round(W * 0.82);
  // d3 wants clockwise outer rings; the stage's (GeoJSON) are counter-clockwise, so rewind them
  const rewind = (p: [number, number][][][]) => p.map((poly) => poly.map((r) => [...r].reverse()));
  const fc = { type: 'FeatureCollection', features: ts.map((t) => ({ type: 'Feature', properties: { t }, geometry: { type: 'MultiPolygon', coordinates: rewind(t.p) } })) } as any;
  // the city's own neighbourhood outlines, for names
  const hoods = (data.tracts!.hoods ?? []).filter((h) => h.city === key).map((h) => ({ n: h.n, f: { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: rewind(h.p) } } as any }));
  const hoodAt = (lonlat: [number, number]) => hoods.find((h) => d3.geoContains(h.f, lonlat))?.n ?? null;
  const proj = d3.geoMercator().fitSize([W, H], fc);
  const path = d3.geoPath(proj);
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  Object.assign(tip.style, { position: 'absolute', pointerEvents: 'none', display: 'none' });
  const draw = () => {
    const m = MEASURES.find((x) => x.id === current)!;
    const vs = ts.map(m.value).filter((v): v is number => v != null);
    const [a, b] = [d3.quantile(vs, 0.05) ?? 0, d3.quantile(vs, 0.95) ?? 1];
    const ramp = d3.scaleSequential(d3.interpolateRgb(m.ramp[0], m.ramp[1])).domain([a, b]).clamp(true);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(m.label)} by census tract">${fc.features.map((f: any, i: number) => {
      const v = m.value(f.properties.t);
      return `<path d="${path(f)}" data-i="${i}" fill="${v == null ? 'rgba(150,160,180,.18)' : ramp(v)}" stroke="rgba(6,10,18,.85)" stroke-width=".6"></path>`;
    }).join('')}${hoods.map((h) => `<path d="${path(h.f) ?? ''}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".5" pointer-events="none"></path>`).join('')}</svg>`;
    box.appendChild(tip);
    el.querySelector('.tr-ct-key')!.innerHTML = `<div class="ramp" style="background:${rampCSS((x) => ramp(a + x * (b - a)))}"></div>
      <div class="ramp-labels"><span>${m.fmt(a)}</span><span>${esc(m.label)}</span><span>${m.fmt(b)}</span></div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-ct]').forEach((x) => x.classList.toggle('on', x.dataset.ct === current));
  };
  box.addEventListener('mousemove', (e) => {
    const i = (e.target as Element).getAttribute?.('data-i');
    if (i == null) { tip.style.display = 'none'; return; }
    const t = ts[+i], m = MEASURES.find((x) => x.id === current)!;
    const v = m.value(t);
    tip.innerHTML = `<b>Census tract ${esc(t.id)}</b><br><span class="tk">${esc(m.chip)}</span> <span class="tv">${v == null ? '—' : m.fmt(v)}</span>${t.pop != null ? `<br><span class="tk">${fmt.int(t.pop)} people, 2021</span>` : ''}`;
    const r = box.getBoundingClientRect();
    const ll = proj.invert?.([((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]);
    const hn = ll ? hoodAt(ll as [number, number]) : null;
    if (hn) tip.innerHTML += `<br><span class="tk">Neighbourhood: ${esc(hn)}</span>`;
    Object.assign(tip.style, { display: 'block', left: `${Math.min(e.clientX - r.left + 12, W - 160)}px`, top: `${e.clientY - r.top + 12}px` });
  });
  box.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  el.querySelector('.tr-ct-chips')?.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-ct]')?.dataset.ct;
    if (id) { current = id; draw(); }
  });
  draw();
}
