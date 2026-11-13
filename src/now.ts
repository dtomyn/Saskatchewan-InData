// Right now: shared helpers for the live readings (public/data/now/, rebuilt hourly by .github/workflows/live.yml).
// The app never assumes a reading is fresh: every value shows its age, a reading older than STALE_H hours is greyed and
// labelled stale, and one older than DROP_H hours is not drawn.
import { PathLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';
import { Data, WeatherAlert } from './data';
import { esc, safeUrl } from './html';

export const STALE_H = 3;
export const DROP_H = 24;
const YEAR_MS = 365.25 * 864e5;

/** Today as a fractional year (the same calendar as `isoDate` in layers.ts), fixed when the page loads. */
export const NOW_T = (() => {
  const d = new Date();
  const y = d.getUTCFullYear();
  return y + (d.getTime() - Date.UTC(y, 0, 1)) / YEAR_MS;
})();
/** The Now stop counts from here: the timeline's last ~2 days. */
export const isNow = (t: number, end: number) => t >= end - 0.005;

export const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
export const ageH = (iso: string | null | undefined) => (Date.now() - ms(iso)) / 36e5;
export type Fresh = 'fresh' | 'stale' | 'old';
export const freshness = (iso: string | null | undefined): Fresh => {
  const h = ageH(iso);
  return !(h < DROP_H) ? 'old' : h > STALE_H ? 'stale' : 'fresh';
};
export const drawable = (iso: string | null | undefined) => freshness(iso) !== 'old';

/** "just now", "40 minutes ago", "3 hours ago", "yesterday", "4 days ago" */
export function ago(iso: string | null | undefined) {
  const m = (Date.now() - ms(iso)) / 6e4;
  if (!Number.isFinite(m)) return 'at an unknown time';
  if (m < 0) return 'just now';
  if (m < 2) return 'just now';
  if (m < 60) return `${Math.round(m)} minutes ago`;
  const h = m / 60;
  if (h < 1.5) return 'an hour ago';
  if (h < 24) return `${Math.round(h)} hours ago`;
  if (h < 48) return 'yesterday';
  return `${Math.round(h / 24)} days ago`;
}
/** Clock time in Saskatchewan (CST all year, no daylight time). */
export const skTime = (iso: string) => new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Regina', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** An age tag that keeps itself current (see `tickAges`): "40 minutes ago", plus "stale" past STALE_H hours. */
export const ageTag = (iso: string) => `<span class="now-age ${freshness(iso)}" data-age="${esc(iso)}" title="${esc(skTime(iso))} Saskatchewan time">${ageLabel(iso)}</span>`;
const ageLabel = (iso: string) => { const f = freshness(iso); return `${ago(iso)}${f === 'stale' ? ' · stale' : f === 'old' ? ' · too old to show' : ''}`; };
/** A plain age, never labelled stale: for an item inside a list whose window is longer than STALE_H (a hotspot seen
 *  up to 24 h before the list was read). The list's own read time carries the staleness. */
export const plainAge = (iso: string) => `<span class="now-age" data-age="${esc(iso)}" data-plain="1" title="${esc(skTime(iso))} Saskatchewan time">${ago(iso)}</span>`;
let lastTick = 0;
/** Refreshes every age tag under `el`, at most once every 20 s. */
export function tickAges(el: HTMLElement) {
  const t = performance.now();
  if (t - lastTick < 20000) return;
  lastTick = t;
  el.querySelectorAll<HTMLElement>('[data-age]').forEach((s) => {
    const iso = s.dataset.age!;
    const plain = !!s.dataset.plain;
    const txt = plain ? ago(iso) : ageLabel(iso);
    if (s.textContent !== txt) s.textContent = txt;
    s.className = plain ? 'now-age' : `now-age ${freshness(iso)}`;
  });
}

/** The "Right now" block at the top of a layer panel, or the dashed box when this copy has no live file. */
export function nowBlock(opts: { color: string; asOf: string | null; body: string; source: string; sourceUrl?: string; missing: string }) {
  if (!opts.asOf) return `<div class="now-block missing"><div class="now-h">Right now</div><div class="unavail">${opts.missing} Run <code>npm run data now</code>, then reload.</div></div>`;
  const f = freshness(opts.asOf);
  const url = opts.sourceUrl ? safeUrl(opts.sourceUrl) : null;
  return `<div class="now-block ${f}" style="--c:${opts.color}">
    <div class="now-h"><span class="now-dot"></span>Right now <span class="now-asof">read ${ageTag(opts.asOf)}</span></div>
    ${f === 'old' ? `<p class="now-old">The newest reading is more than ${DROP_H} hours old, so nothing is drawn. The hourly refresh may have stopped.</p>` : opts.body}
    <div class="now-src">${url ? `<a href="${url}" target="_blank" rel="noopener">${esc(opts.source)} ↗</a>` : esc(opts.source)}</div>
  </div>`;
}

// ---- weather alerts

/** Alert types worth showing on a hazard layer: by the alert's name. */
export const ALERTS_FOR: Record<string, RegExp> = {
  rivers: /flood|rain|freezing rain|thunderstorm|storm surge|water/i,
  fires: /fire|smoke|air quality|heat|wind/i,
  smoke: /smoke|air quality|heat|dust/i,
};
const RISK: Record<string, [number, number, number]> = { yellow: [255, 214, 90], orange: [255, 150, 60], red: [255, 70, 70] };
export const alertRGB = (a: WeatherAlert) => RISK[a.colour ?? ''] ?? [200, 210, 230];
export const alertCSS = (a: WeatherAlert) => `rgb(${alertRGB(a).join(',')})`;

/** Alerts in effect (not past their end or expiry) for one layer, or every one with no layer. */
export function alertsInEffect(data: Data, layerId?: string) {
  const all = data.now.alerts && drawable(data.now.alerts.asOf) ? data.now.alerts.alerts : [];
  const re = layerId ? ALERTS_FOR[layerId] : null;
  const now = Date.now();
  return all.filter((a) => (!re || re.test(`${a.name} ${a.short ?? ''}`)) && !(ms(a.expires) < now));
}

const dash = [new PathStyleExtension({ dash: true })];
/** Alert regions drawn as dashed outlines in the alert's risk colour. `id` must start with the owning layer's id. */
export function alertOutlines(id: string, alerts: WeatherAlert[]): Layer[] {
  if (!alerts.length) return [];
  const paths = alerts.flatMap((a) => a.polys.flatMap((p) => p.map((ring) => ({ a, ring }))));
  return [
    new PathLayer<any>({
      id,
      data: paths,
      getPath: (d) => d.ring,
      getColor: (d) => [...alertRGB(d.a), 200],
      getWidth: 1.5,
      widthUnits: 'pixels',
      getDashArray: [5, 3],
      dashJustified: true,
      extensions: dash,
      pickable: true,
      parameters: { depthCompare: 'always' },
    } as any),
  ];
}
export const alertTooltip = (a: WeatherAlert) =>
  `<b>${esc(a.short ?? a.name)}</b> <span class="tk">${esc(a.type)}</span><br><span class="tk">Issued</span> <span class="tv">${esc(ago(a.issued))}</span>${a.ends ? `<br><span class="tk">Until</span> <span class="tv">${esc(skTime(a.ends))}</span>` : ''}<br><span class="tk">${a.areas.length} forecast region${a.areas.length === 1 ? '' : 's'}</span>`;

/** A short list of alerts for a panel: name, issued, until, the places it covers, and its text behind a toggle. */
export function alertList(alerts: WeatherAlert[], data: Data) {
  if (!alerts.length) return '';
  const name = (k: string) => data.munis.find((m) => m.key === k)?.name ?? k;
  return `<div class="now-alerts">${alerts.map((a) => `
    <details class="now-alert" style="--ac:${alertCSS(a)}">
      <summary><b>${esc(a.short ?? a.name)}</b> · issued ${ageTag(a.issued)}${a.ends ? ` · until ${esc(skTime(a.ends))}` : ''}${a.places.length ? `<br><span class="tk">${esc(a.places.slice(0, 6).map(name).join(', '))}${a.places.length > 6 ? ` and ${a.places.length - 6} more` : ''}</span>` : `<br><span class="tk">${esc(a.areas.slice(0, 3).join('; '))}${a.areas.length > 3 ? ` and ${a.areas.length - 3} more regions` : ''}</span>`}</summary>
      <p>${esc(a.text).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, ' ')}</p>
    </details>`).join('')}</div>`;
}

// ---- AQHI (Environment Canada's categories)

export const aqhiWord = (v: number) => (v > 10 ? 'very high risk' : v >= 7 ? 'high risk' : v >= 4 ? 'moderate risk' : 'low risk');
export const aqhiText = (v: number) => (v > 10 ? '10+' : String(Math.round(v)));
const AQHI_COLORS = ['#00ccff', '#0099cc', '#006699', '#ffff00', '#ffcc00', '#ff9933', '#ff6666', '#ff0000', '#cc0000', '#990000', '#660000'];
export const aqhiColor = (v: number) => AQHI_COLORS[Math.max(1, Math.min(11, Math.round(v))) - 1];

/** A clicked alert region, as an event panel (a place on the map, so the timeline stays where it is). */
export function alertEvent(a: WeatherAlert, layer: string, data: Data, lon?: number, lat?: number) {
  const name = (k: string) => data.munis.find((m) => m.key === k)?.name ?? k;
  return {
    layer, kind: `Weather ${a.type}`, lon, lat, zoom: 6.5,
    title: a.short ?? a.name,
    body: a.text,
    stats: [
      { v: ago(a.issued), l: 'issued' },
      ...(a.ends ? [{ v: skTime(a.ends), l: 'expected to end (Sask. time)' }] : []),
      { v: String(a.areas.length), l: `forecast region${a.areas.length === 1 ? '' : 's'}` },
      ...(a.places.length ? [{ v: String(a.places.length), l: 'of the atlas’s places inside' }] : []),
    ],
    sections: [{ title: 'Where', text: a.areas.join('; ') }, ...(a.places.length ? [{ title: 'Places in the atlas', text: a.places.map(name).join(', ') }] : [])],
    sources: [{ label: 'Environment and Climate Change Canada, public weather alerts', url: data.now.alerts?.sourceUrl ?? 'https://weather.gc.ca/' }],
  };
}

// ---------------------------------------------------------------------------------------------
// Short-range outlooks (plan 3c): published forecasts only, each shown with when it was issued and what it is valid
// for, and dropped once that time has passed. Like every live value, they never feed the Town Finder.

export const FIRE_DANGER = ['Low', 'Moderate', 'High', 'Very high', 'Extreme'];
export const FIRE_DANGER_COLOR = ['#4caf50', '#3f8edc', '#ffd23f', '#ff8a3d', '#e0312b'];
/** Today in Saskatchewan, as YYYY-MM-DD. */
const skToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Regina' });
const skDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const future = (iso: string | null | undefined) => !!iso && Date.parse(iso) > Date.now();
const times = (issued: string | null | undefined, valid: string) => `<span class="tk">${issued ? `issued ${esc(skTime(issued))} · ` : ''}valid ${valid}</span>`;

type OutlookRow = { k: string; c: string; v: string; sub: string };
/** The outlooks still valid at a place: AQHI forecast, thunderstorm outlook, fire danger, smoke tomorrow. */
export function placeOutlooks(data: Data, key: string): OutlookRow[] {
  const nw = data.now, o = nw.outlooks, rows: OutlookRow[] = [];
  const pick = nw.air?.towns[key];
  const c = pick ? nw.air!.communities[pick[0]] : null;
  if (c?.fv != null && c.ft && future(c.fto ?? c.ft))
    rows.push({ k: 'Air quality forecast', c: '#e8a87c', v: `AQHI up to ${c.fv}`, sub: `${times(c.pub, `to ${esc(skTime(c.fto ?? c.ft))}`)} · highest at ${esc(skTime(c.ft))} · ${pick![1] < 15 ? 'for' : 'borrowed from'} ${esc(c.name)}` });
  if (o?.thunder) {
    const its = o.thunder.items.filter((it) => it.places.includes(key) && future(it.expires ?? it.valid));
    for (const it of its)
      rows.push({ k: 'Thunderstorm outlook', c: '#ffd166', v: esc(it.severity ?? it.thunder ?? it.risk ?? 'in an outlook area'), sub: `${[it.tornado ? 'tornado risk' : '', it.hail ? `hail ${esc(it.hail)}` : '', it.gust ? `gusts ${esc(it.gust)}` : ''].filter(Boolean).join(' · ')}${it.tornado || it.hail || it.gust ? ' · ' : ''}${times(it.issued, `from ${esc(skTime(it.valid))}${it.expires ? ` to ${esc(skTime(it.expires))}` : ''}`)}` });
    if (!its.length) rows.push({ k: 'Thunderstorm outlook', c: '#ffd166', v: 'None', sub: '<span class="tk">no outlook area covers this place (outlooks are issued May to October)</span>' });
  }
  if (o?.fire && o.fire.valid >= skToday()) {
    const cl = o.fire.towns[key];
    rows.push({ k: 'Fire danger', c: cl != null ? FIRE_DANGER_COLOR[cl] : '#ff8a3d', v: cl != null ? FIRE_DANGER[cl] : 'Not rated', sub: cl != null ? `${times(null, esc(skDay(o.fire.valid)))} · CWFIS class from the ${esc(o.fire.model)} weather forecast` : '<span class="tk">outside the area CWFIS rates today</span>' });
  }
  if (o?.smoke && future(o.smoke.valid)) {
    const v = o.smoke.towns[key];
    if (v != null) rows.push({ k: 'Wildfire smoke forecast', c: '#b9a48a', v: v < 1 ? 'Under 1 µg/m³' : `${v.toFixed(v < 10 ? 1 : 0)} µg/m³`, sub: `<span class="tk">highest fine particles from fire smoke over the day to ${esc(skTime(o.smoke.valid))} · model run ${esc(skTime(o.smoke.issued))}</span>` });
  }
  return rows;
}

/** The Town Report's outlook list, under its Right now readings. */
export function outlookList(data: Data, key: string) {
  const rows = placeOutlooks(data, key);
  if (!rows.length) return '';
  return `<div class="outlooks"><div class="ol-h">Outlooks <span class="tk">published forecasts, not readings</span></div>
    ${rows.map((r) => `<div class="ol-row" style="--c:${r.c}"><span class="ol-k">${r.k}</span><b>${r.v}</b><div class="ol-s">${r.sub}</div></div>`).join('')}</div>`;
}

/** A layer's one-line outlook for the province: fire danger on Wildfires, the smoke forecast on Smoke & air. */
export function provinceOutlook(data: Data, kind: 'fire' | 'smoke') {
  const o = data.now.outlooks;
  if (kind === 'fire' && o?.fire && o.fire.valid >= skToday()) {
    const n = FIRE_DANGER.map((_, i) => Object.values(o.fire!.towns).filter((c) => c === i).length);
    const top = n.map((c, i) => ({ c, i })).filter((x) => x.c).reverse()[0];
    return `<div class="ol-line"><span class="tk">Outlook · fire danger ${esc(skDay(o.fire.valid))} (CWFIS, ${esc(o.fire.model)} forecast)</span><br>${n.map((c, i) => (c ? `<span class="sw" style="background:${FIRE_DANGER_COLOR[i]}"></span>${FIRE_DANGER[i]} ${c}` : '')).filter(Boolean).join(' · ') || 'no place rated'}${top ? ` <span class="tk">of the atlas’s places</span>` : ''}</div>`;
  }
  if (kind === 'smoke' && o?.smoke && future(o.smoke.valid)) {
    const v = Object.entries(o.smoke.towns).sort((a, b) => b[1] - a[1]);
    const name = (k: string) => esc(data.munis.find((m) => m.key === k)?.name ?? k);
    return `<div class="ol-line"><span class="tk">Outlook · wildfire smoke to ${esc(skTime(o.smoke.valid))}, RAQDPS run ${esc(skTime(o.smoke.issued))}</span><br>${v.length && v[0][1] >= 1 ? `highest fire-smoke PM2.5 ${v[0][1].toFixed(0)} µg/m³ at ${name(v[0][0])}` : 'no place above 1 µg/m³ of fire smoke'}</div>`;
  }
  return '';
}
