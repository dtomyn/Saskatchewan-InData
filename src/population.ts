// POPULATION — each place's population year by year (Statistics Canada estimates), drawn as town columns.
import * as d3 from 'd3';
import { Data, interpYearly, fmt } from './data';
import { AtlasLayer, townColumns, rgb, kicker, heroStats, deferChart, mk, sourceLine } from './layer-kit';
import { lineChart, rampCSS } from './charts';

export function populationLayer(data: Data): AtlasLayer {
  const color = '#3ecf8e';
  const pop = data.population?.munis ?? {};
  const keys = Object.keys(pop);
  const allYears = new Set<number>();
  Object.values(pop).forEach((p) => Object.keys(p.pop).forEach((y) => allYears.add(+y)));
  const ys = [...allYears].sort((a, b) => a - b);
  const y0 = ys[0] ?? 2001, y1 = ys.at(-1) ?? 2025;
  const total = (y: number) => d3.sum(Object.values(pop), (p) => p.pop[y] ?? 0);
  // colour: growth over the previous five years (or since the first year), so booming and shrinking towns stand apart
  const growth = (key: string, t: number) => {
    const p = pop[key]?.pop;
    const now = interpYearly(p, t), before = interpYearly(p, Math.max(y0, t - 5));
    return now != null && before ? now / before - 1 : null;
  };
  const ramp = d3.scaleLinear<string>().domain([-0.1, 0, 0.1, 0.25]).range(['#7a2e3a', '#5d6b84', '#3ecf8e', '#d9ffef']).interpolate(d3.interpolateRgb).clamp(true);
  let shownTime = y0;

  const l: AtlasLayer = {
    id: 'population',
    name: 'Population',
    icon: '◍',
    color,
    range: [y0, y1 + 0.99],
    available: keys.length > 0,
    unavailable: 'Statistics Canada’s population table could not be downloaded when this copy of the data was built. Run <code>npm run data population</code>, then reload.',
    build({ time, selected }) {
      shownTime = time;
      return townColumns('population', data.munis, (m) => interpYearly(pop[m.key]?.pop, time), (v) => Math.sqrt(v) * 300, (_v, m) => rgb(ramp(growth(m.key, time) ?? 0), 240), time, selected);
    },
    spark: () => ys.map((x) => ({ x, y: total(x) })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, `Statistics Canada estimates · ${y0} → ${y1}`)}
        <h2>Where Saskatchewan is growing</h2>
        <p class="lede">Column height shows each place’s population on 1 July; colour shows how much it grew over the five years before (green growing, grey flat, red shrinking). Watch the bedroom towns around Saskatoon and Regina pull ahead.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Population, largest places</h3>`);
      const palette = ['#3ecf8e', '#4cc9f0', '#ffd166', '#ff8a3d', '#b388ff', '#ff5d8f'];
      const big = keys.filter((k) => !['saskatoon', 'regina'].includes(k)).sort((a, b) => (pop[b].pop[y1] ?? 0) - (pop[a].pop[y1] ?? 0)).slice(0, 6);
      const series = big.map((k, i) => ({ key: k, label: data.munis.find((m) => m.key === k)?.name ?? k, color: palette[i], width: 2, values: Object.entries(pop[k].pop).map(([y, v]) => ({ x: +y, y: v })) }));
      const set = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [y0, y1], height: 160, yFormat: (v) => d3.format('~s')(v), valueFormat: fmt.int }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
        <p class="note">Saskatoon and Regina are left off the chart so the smaller cities can be read; their columns are on the map.</p>`);
      const fast = keys.map((k) => ({ k, g: growth(k, y1) })).filter((r) => r.g != null && (pop[r.k].pop[y1] ?? 0) >= 2000).sort((a, b) => b.g! - a.g!);
      const nm = (k: string) => data.munis.find((m) => m.key === k)?.name ?? k;
      el.insertAdjacentHTML('beforeend', `
        <div class="callout" style="--c:${color}">Fastest growing over ${y1 - 5}–${y1} (2,000+ people): ${fast.slice(0, 3).map((r) => `<b>${nm(r.k)}</b> (${fmt.signed(r.g! * 100, 0)}%)`).join(', ')}. Shrinking most: ${fast.slice(-2).reverse().map((r) => `<b>${nm(r.k)}</b> (${fmt.signed(r.g! * 100, 0)}%)`).join(', ')}.</div>
        <h3>Colour: five-year growth</h3>
        <div class="ramp" style="background:${rampCSS((t) => ramp(-0.1 + t * 0.35))}"></div>
        <div class="ramp-labels"><span>−10%</span><span>0</span><span>+10%</span><span>+25%</span></div>
        <p class="note">Covers the ${keys.length} places in the atlas, each as its census subdivision (the city, town or northern village itself, not its rural municipality). Lloydminster counts only its Saskatchewan side. Estimates are revised after each census.</p>
        ${sourceLine(data.population?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.min(Math.floor(time), y1);
          hero(0, fmt.int(total(y)), `people in the atlas’s ${keys.length} places, ${y}`);
          hero(1, `${fmt.signed(((total(y) / total(y0)) - 1) * 100, 0)}%`, `growth since ${y0}`);
          const share = (total(y) && pop.saskatoon && pop.regina) ? ((pop.saskatoon.pop[y] ?? 0) + (pop.regina.pop[y] ?? 0)) / total(y) : null;
          hero(2, share != null ? `${Math.round(share * 100)}%` : '–', `of them in Saskatoon or Regina`);
          const top = keys.map((k) => ({ k, g: growth(k, y) })).filter((r) => r.g != null && (pop[r.k].pop[y] ?? 0) >= 2000).sort((a, b) => b.g! - a.g!)[0];
          hero(3, top ? nm(top.k) : '–', top ? `fastest growing (${fmt.signed(top.g! * 100, 0)}% in 5 yrs)` : '');
          set(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('population')) return null;
      const g = growth(o.m.key, shownTime);
      return `<b>${o.m.name}</b><br><span class="tk">Population</span> <span class="tv">${fmt.int(o.v)}</span>${g != null ? `<br><span class="tk">Five-year growth</span> <span class="tv">${fmt.signed(g * 100, 1)}%</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}
