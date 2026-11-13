// CLIMATE NORMALS — a 30-year average, so the layer is the same at every point of its range
import * as d3 from 'd3';
import type { Layer } from '@deck.gl/core';
import { ScatterplotLayer, ColumnLayer, TextLayer } from '@deck.gl/layers';
import { Data, NormalsStation, fmt, MONTHS } from './data';
import { AtlasLayer, NO_DEPTH, rgb, kicker, heroStats, mk, sourceLine } from './layer-kit';
import { NormalVar } from './metrics';
import { esc } from './html';
import { rampCSS } from './charts';
import type { TownMetrics } from './metrics';
import { metric, na } from './report-kit';

export function normalsLayer(data: Data): AtlasLayer {
  const color = '#c5e86c';
  const stations = data.normals?.stations ?? [];
  const [p0, p1] = (data.normals?.period.match(/\d{4}/g) ?? ['1981', '2010']).map(Number);
  type Var = { key: NormalVar; chip: string; label: string; unit: string; best: string; low: boolean; ramp: (v: number) => string; domain: [number, number] };
  const scale = (domain: [number, number], a: string, b: string) => d3.scaleSequential(d3.interpolateRgb(a, b)).domain(domain).clamp(true);
  const VARS: Var[] = [
    { key: 'sun', chip: 'Sunshine', label: 'Bright sunshine', unit: 'h', best: 'Sunniest', low: false, domain: [2000, 2500], ramp: scale([2000, 2500], '#4b4a3a', '#fff07a') },
    { key: 'wetDays', chip: 'Rain days', label: 'Days with rain or snow (≥0.2 mm)', unit: 'days', best: 'Fewest rain days', low: true, domain: [80, 150], ramp: scale([80, 150], '#bfe3ff', '#1d4f91') },
    { key: 'frostDays', chip: 'Frost days', label: 'Days with a low of 0 °C or below', unit: 'days', best: 'Fewest frost days', low: true, domain: [180, 240], ramp: scale([180, 240], '#2f7a8a', '#dff4ff') },
    { key: 'snow', chip: 'Snowfall', label: 'Snowfall', unit: 'cm', best: 'Least snow', low: true, domain: [70, 180], ramp: scale([70, 180], '#5d7184', '#ffffff') },
  ];
  let cur = VARS[0];
  const val = (s: NormalsStation, v = cur) => s[v.key] ?? null;
  const fmtV = (v: number, x = cur) => `${fmt.int(v)} ${x.unit}`;
  const ranked = (v = cur) => stations.filter((s) => val(s, v) != null).sort((a, b) => (v.low ? val(a, v)! - val(b, v)! : val(b, v)! - val(a, v)!));
  const liveCache: Partial<Record<NormalVar, NormalsStation[]>> = {};
  const height = (v: number) => 4500 + Math.max(0, (v - cur.domain[0] * 0.8) / (cur.domain[1] - cur.domain[0] * 0.8)) * 90000;

  const l: AtlasLayer = {
    id: 'normals',
    name: 'Climate normals',
    icon: '☀',
    color,
    range: [p0, p1 + 0.99],
    static: true,
    period: `${p0}–${p1} average`,
    available: stations.length > 0,
    unavailable: 'Environment Canada’s climate-normals service could not be reached when this copy of the data was built. Run <code>npm run data normals</code>, then reload.',
    build({ focusedId }) {
      const live = (liveCache[cur.key] ??= stations.filter((s) => val(s) != null));
      const layers: Layer[] = [
        new ScatterplotLayer<NormalsStation>({
          id: 'normals-base',
          data: stations,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: 2700,
          radiusMinPixels: 2,
          getFillColor: [197, 232, 108, 70],
          pickable: true,
          parameters: NO_DEPTH,
        }),
        new ColumnLayer<NormalsStation>({
          id: 'normals-cols',
          data: live,
          getPosition: (s) => [s.lon, s.lat],
          radius: 6000,
          diskResolution: 20,
          extruded: true,
          getElevation: (s) => height(val(s)!),
          getFillColor: (s) => rgb(cur.ramp(val(s)!), 240),
          material: { ambient: 0.6, diffuse: 0.55, shininess: 40 },
          pickable: true,
          updateTriggers: { getElevation: cur.key, getFillColor: cur.key },
        }),
      ];
      if (focusedId === 'normals')
        layers.push(
          new TextLayer<NormalsStation>({
            id: 'normals-labels',
            data: live,
            getPosition: (s) => [s.lon, s.lat, height(val(s)!) + 7000],
            getText: (s) => fmt.int(val(s)!),
            getSize: 11,
            getColor: [235, 240, 248, 230],
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 220],
            fontSettings: { sdf: true },
            billboard: true,
            updateTriggers: { getText: cur.key, getPosition: cur.key },
            parameters: NO_DEPTH,
          } as any),
        );
      return layers;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, `Climate normals · ${p0}–${p1} average`)}
        <h2>What a town feels like</h2>`;
      if (!data.normals) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Annual temperature hides the differences you feel day to day. These are Environment Canada’s <b>30-year averages (${p0}–${p1})</b> at ${stations.length} weather stations, so this layer has no timeline: other layers keep playing underneath. Pick what the columns show:</p>
        <div class="chips" style="margin:2px 0 10px">${VARS.map((v) => `<button class="chip" data-v="${v.key}" style="--c:${color}">${v.chip}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === cur.key));
        const r = ranked();
        const lo = r.at(-1), hi = r[0];
        hero(0, hi ? fmtV(val(hi)!) : '–', hi ? `${cur.best.toLowerCase()}: ${hi.name}` : '');
        hero(1, lo ? fmtV(val(lo)!) : '–', lo ? `other extreme: ${lo.name}` : '');
        hero(2, String(r.length), `stations report ${cur.chip.toLowerCase()}`);
        const med = d3.median(r, (s) => val(s)!);
        hero(3, med != null ? fmtV(med) : '–', 'provincial median');
        const max = d3.max(r, (s) => val(s)!) ?? 1;
        body.innerHTML = `<h3>${cur.best} · ${cur.label}</h3>
          <ol class="rank-list">${r.map((s, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${esc(s.name)}</span>${s.yrs < 20 ? `<br><span class="rd">${s.yrs} yrs of record</span>` : ''}</span><span><div class="bar"><i style="width:${Math.round((val(s)! / max) * 100)}%;background:${cur.ramp(val(s)!)}"></i></div><div class="bar-v">${fmt.int(val(s)!)}</div></span></li>`).join('')}</ol>
          <div class="ramp" style="background:${rampCSS((t) => cur.ramp(cur.domain[0] + t * (cur.domain[1] - cur.domain[0])))}"></div>
          <div class="ramp-labels"><span>${cur.domain[0]} ${cur.unit}</span><span>${cur.domain[1]}+ ${cur.unit}</span></div>
          ${cur.key === 'sun' ? `<div class="callout" style="--c:${color}">Only ${r.length} Saskatchewan stations measure sunshine. The Town Report and Town Finder borrow the nearest one (within 150 km) and name it.</div>` : ''}`;
      };
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-v]')?.dataset.v;
        const v = VARS.find((x) => x.key === k);
        if (v) { cur = v; draw(); }
      });
      draw();
      el.insertAdjacentHTML('beforeend', `
        <p class="note">A “normal” is the average of ${p1 - p0 + 1} years of daily observations, the standard climate reference period. Some stations have gaps; those with under 20 years behind a value are flagged. Newer ${p0 + 10}–${p1 + 10} normals are not yet in Environment Canada’s open API.</p>
        ${sourceLine(data.normals.source)}`);
      return { update() {} };
    },
    tooltip(info) {
      const o = info.object as NormalsStation;
      if (!o || !info.layer?.id.startsWith('normals')) return null;
      const row = (k: string, v: string | null) => (v ? `<br><span class="tk">${k}</span> <span class="tv">${v}</span>` : '');
      const n = (v: number | undefined, u: string) => (v != null ? `${fmt.int(v)} ${u}` : null);
      return `<b>${esc(o.name)}</b>${row('Sunshine', n(o.sun, 'h/yr'))}${row('Rain days', n(o.wetDays, '/yr'))}${row('Frost days', n(o.frostDays, '/yr'))}${row('Snowfall', n(o.snow, 'cm/yr'))}${row('Precipitation', n(o.precip, 'mm/yr'))}${row('Jan / Jul mean', o.tJan != null && o.tJul != null ? `${o.tJan.toFixed(1)} / ${o.tJul.toFixed(1)} °C` : null)}${row('Wettest month', o.wet ? `${MONTHS[o.wet[0] - 1]} (${fmt.int(o.wet[1])} mm)` : null)}<br><span class="tk">${p0}–${p1} normals${o.yrs < 20 ? ` · ${o.yrs} yrs of record` : ''}</span>`;
    },
  };
  return l;
}

// ---- the Town Report section (src/panels.ts places it)

/** "What it feels like": 30-year climate normals, each from the nearest station that reports it. */
export function feelsRow(t: TownMetrics, data: Data) {
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
