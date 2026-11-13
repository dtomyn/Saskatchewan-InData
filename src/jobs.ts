// JOBS & INCOME — is there work, and what kind? The Labour Force Survey (Statistics Canada) estimates unemployment and
// employment rates every year for Saskatchewan's economic regions; those tint the map and move with the timeline. The
// LFS publishes Prince Albert and Northern only as one region, so they share a colour. Columns are each place's median
// household income from the 2021 census, which also gives the industries its workers are in.
import * as d3 from 'd3';
import { PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { Data, Jobs, JobsRegion, fmt, interpYearly } from './data';
import { lineChart, rampCSS } from './charts';
import { AtlasLayer, NO_DEPTH, deferChart, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layers';
import { esc } from './html';
import { csdClick, csdOf, csdReport, csdTint, csdTooltip, missing } from './subdivisions';

type MeasureKey = 'ur' | 'er';
type Measure = { key: MeasureKey; chip: string; label: string; ramp: d3.ScaleSequential<string> };
const MEASURES: Measure[] = [
  // high unemployment glows warm; plenty of work stays cool
  { key: 'ur', chip: 'Unemployment', label: 'Unemployment rate', ramp: d3.scaleSequential(d3.interpolateRgb('#1f4f6b', '#ff8a5c')).domain([3, 9]).clamp(true) },
  { key: 'er', chip: 'Employment rate', label: 'Employment rate (share of people 15+ with a job)', ramp: d3.scaleSequential(d3.interpolateRgb('#5a2a4a', '#7fe0c0')).domain([56, 70]).clamp(true) },
];
const INCOME = d3.scaleSequential(d3.interpolateRgb('#3a3f6b', '#ffe08a')).domain([55000, 110000]).clamp(true);
const PALETTE = ['#7fd1b9', '#ffd166', '#4cc9f0', '#ff8a5c', '#b388ff'];
const pct = (v: number) => `${v.toFixed(1)}%`;

/** The latest year a region (or the province) has a value for this measure. */
export const lastYear = (s: Record<string, number> | undefined) => {
  const ys = Object.keys(s ?? {}).map(Number);
  return ys.length ? Math.max(...ys) : null;
};

/** A place's LFS region and its latest unemployment rate, or null. */
export function placeRegion(data: Data, key: string): { region: JobsRegion; ur: number | null; year: number | null } | null {
  const J = data.jobs;
  const r = J?.towns[key]?.r;
  if (!J || r == null || !J.regions[r]) return null;
  const region = J.regions[r];
  const y = lastYear(region.ur);
  return { region, ur: y != null ? region.ur[y] : null, year: y };
}

/** The top industries of a place (or the province) as "Health care 15%, Retail 11%, …". */
export function topIndustries(J: Jobs, ind: [number, number][] | undefined, n = 3) {
  return (ind ?? []).slice(0, n).map(([i, p]) => ({ name: J.naics[i] ?? '?', pct: p }));
}

export function jobsLayer(data: Data): AtlasLayer {
  const color = '#7fd1b9';
  const J = data.jobs;
  const regions = J?.regions ?? [];
  const towns = J?.towns ?? {};
  const ys = [...new Set(regions.flatMap((r) => Object.keys(r.ur)))].map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 2011, y1 = ys.at(-1) ?? 2025;
  const nm = (k: string) => data.munis.find((m) => m.key === k)?.name ?? k;
  type Poly = { r: number; poly: [number, number][][] };
  const rPolys: Poly[] = regions.flatMap((reg, r) => reg.polys.map((poly) => ({ r, poly })));
  let cur = MEASURES[0];
  let shownTime = y1;
  /** what tints the map: the LFS regions' rate, or every census subdivision's median household income */
  let tint: 'region' | 'csd' = 'region';
  const at = (r: number, t: number) => interpYearly(regions[r]?.[cur.key], Math.min(t, y1 + 0.99));

  const l: AtlasLayer = {
    id: 'jobs',
    name: 'Jobs & income',
    icon: '⚒',
    color,
    range: [y0, y1 + 0.99],
    available: !!J,
    unavailable: 'Statistics Canada’s Labour Force Survey table or census profile could not be downloaded when this copy of the data was built. Run <code>npm run data jobs</code>, then reload.',
    build({ time, selected, focusedId }) {
      shownTime = time;
      const focused = focusedId === 'jobs';
      const byCsd = tint === 'csd' && !!data.subdivisions;
      const out: Layer[] = [
        ...(byCsd ? csdTint('jobs', data, (s) => J?.csd?.[s.id]?.inc ?? null, (v) => rgb(INCOME(v)), 'inc', focused) : []),
        new PolygonLayer<Poly>({
          id: 'jobs-base',
          data: rPolys,
          getPolygon: (d) => d.poly,
          getFillColor: (d) => { if (byCsd) return [0, 0, 0, 0]; const v = at(d.r, time); return v == null ? [120, 130, 150, 30] : rgb(cur.ramp(v), focused ? 120 : 80); },
          getLineColor: [230, 240, 255, 150],
          lineWidthUnits: 'pixels',
          getLineWidth: 1.2,
          pickable: !byCsd,
          parameters: NO_DEPTH,
          updateTriggers: { getFillColor: [time, cur.key, focused, byCsd] },
        } as any),
        ...townColumns('jobs', data.munis, (m) => towns[m.key]?.inc ?? null, (v) => Math.max(0, v - 30000) * 0.9, (v) => rgb(INCOME(v), 235), time, `${selected}`),
      ];
      if (focused && !byCsd)
        out.push(new TextLayer<JobsRegion>({
          id: 'jobs-labels',
          data: regions,
          getPosition: (r) => r.c,
          getText: (r) => { const v = at(regions.indexOf(r), time); return `${r.name}\n${v == null ? 'n/a' : pct(v)}`; },
          getSize: 13,
          getColor: [240, 244, 252, 240],
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          outlineWidth: 4,
          outlineColor: [6, 10, 18, 235],
          fontSettings: { sdf: true },
          characterSet: 'auto',
          parameters: { depthCompare: 'always' },
          updateTriggers: { getText: [Math.floor(time * 10), cur.key] },
        } as any));
      return out;
    },
    spark: () => ys.map((x) => ({ x, y: J?.prov.ur[x] ?? 0 })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Places & living · Labour Force Survey and Census 2021')}
        <h2>Is there work?</h2>`;
      if (!J) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Statistics Canada’s Labour Force Survey estimates, every year, how many people have work in each of Saskatchewan’s economic regions. The regions are tinted by the chosen rate and change with the timeline. Columns are each place’s median household income from the 2021 census: taller and brighter is higher.</p>
        <div class="chips" style="margin:2px 0 10px">${MEASURES.map((m) => `<button class="chip" data-m="${m.key}" style="--c:${color}">${m.chip}</button>`).join('')}${data.subdivisions && J.csd ? `<button class="chip" data-tint="csd" style="--c:${color}" title="Tint every census subdivision by its median household income (2020)">Income by subdivision</button>` : ''}</div>`);
      const hero = heroStats(el, 4);
      const chartTitle = el.appendChild(mk('h3'));
      const chartBox = el.appendChild(mk('div'));
      const series = (k: MeasureKey) => [
        ...regions.map((r, i) => ({ key: r.name, label: r.name, color: PALETTE[i % PALETTE.length], width: 2, values: Object.entries(r[k]).map(([y, v]) => ({ x: +y, y: v })) })),
        { key: 'sk', label: 'Saskatchewan', color: '#ffffff', dashed: true, width: 1.5, values: Object.entries(J.prov[k]).map(([y, v]) => ({ x: +y, y: v })) },
      ];
      el.insertAdjacentHTML('beforeend', `<div class="legend">${regions.map((r, i) => `<span><i class="sw" style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(r.name)}</span>`).join('')}<span><i class="sw" style="background:#fff"></i>Saskatchewan</span></div>`);
      const rampBox = el.appendChild(mk('div'));
      const list = el.appendChild(mk('div'));
      const sk = topIndustries(J, J.prov.ind);
      el.insertAdjacentHTML('beforeend', `
        <p class="note">Labour Force Survey rates are annual averages for people 15 and over. The survey does not cover people living on reserves, so the northern and Prince Albert figures leave out many First Nations communities. It is a sample: a region’s rate can move a point from year to year by chance. The LFS publishes Prince Albert and Northern only as one combined region; each place takes the region its centre lies in (economic regions from Statistics Canada’s 2021 boundary file).</p>
        <p class="note">Census figures are for each place’s own census subdivision. Household income is the median total income of households in 2020, a year of pandemic benefits. Industries are where the labour force (people working, or last worked, since January 2020) is employed, by NAICS sector${sk.length ? `; across Saskatchewan the biggest are ${sk.map((s) => `${esc(s.name.toLowerCase())} (${s.pct.toFixed(0)}%)`).join(', ')}` : ''}. Statistics Canada rounds counts and suppresses figures for the smallest places.</p>
        ${sourceLine(J.source)}${sourceLine(J.censusSource)}${sourceLine(J.areaSource)}`);

      const drawChart = () => {
        chartTitle.textContent = `${cur.label} by region`;
        chartBox.innerHTML = '';
        return deferChart(chartBox, (c) => lineChart(c, { series: series(cur.key), xDomain: [y0, y1], height: 170, yZero: false, yFormat: (v) => `${v}%`, valueFormat: pct }));
      };
      let set = drawChart();
      const drawRamp = () => {
        const [a, b] = cur.ramp.domain();
        const [ia, ib] = INCOME.domain();
        rampBox.innerHTML = (tint === 'csd'
          ? `<p class="note">The map is tinted by each census subdivision’s median household income (2020), on the column scale below: rural municipalities, villages and reserves included. A subdivision whose income Statistics Canada suppressed is left clear. Click one for its census report.</p>`
          : `<h3>Region colour: ${esc(cur.chip.toLowerCase())}</h3>
          <div class="ramp" style="background:${rampCSS((t) => cur.ramp(a + t * (b - a)))}"></div>
          <div class="ramp-labels"><span>${a}%</span><span>${(a + b) / 2}%</span><span>${b}%+</span></div>`)
          + `<h3>${tint === 'csd' ? 'Tint and column' : 'Column'}: median household income, 2020</h3>
          <div class="ramp" style="background:${rampCSS((t) => INCOME(ia + t * (ib - ia)))}"></div>
          <div class="ramp-labels"><span>${fmt.money(ia)}</span><span>${fmt.money((ia + ib) / 2)}</span><span>${fmt.money(ib)}+</span></div>`;
      };
      const rows = Object.entries(towns).filter(([, t]) => t.inc != null).sort((a, b) => b[1].inc! - a[1].inc!);
      const max = d3.max(rows, ([, t]) => t.inc!) ?? 1;
      list.innerHTML = `<h3>Median household income, 2020 · highest first</h3>
        <ol class="rank-list">${rows.map(([k, t], i) => `<li data-key="${esc(k)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(nm(k))}</span><br><span class="rd">${topIndustries(J, t.ind, 2).map((s) => `${esc(s.name)} ${s.pct.toFixed(0)}%`).join(' · ')}</span></span><span><div class="bar"><i style="width:${Math.round((t.inc! / max) * 100)}%;background:${color}"></i></div><div class="bar-v">${fmt.money(t.inc!)}</div></span></li>`).join('')}</ol>`;
      list.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      const tintBtn = el.querySelector<HTMLButtonElement>('[data-tint]');
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-tint]')) {
          tint = tint === 'csd' ? 'region' : 'csd';
          tintBtn?.classList.toggle('on', tint === 'csd');
          drawRamp();
          return;
        }
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
        const m = MEASURES.find((x) => x.key === k);
        if (!m) return;
        cur = m;
        tint = 'region';
        tintBtn?.classList.remove('on');
        set = drawChart();
        drawRamp();
        el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === cur.key));
      });
      el.querySelector<HTMLButtonElement>(`[data-m="${cur.key}"]`)?.classList.add('on');
      drawRamp();
      return {
        update({ time }) {
          const y = Math.min(Math.max(Math.floor(time), y0), y1);
          const inYears = time >= y0 && time < y1 + 1;
          hero(0, inYears && J.prov.ur[y] != null ? pct(J.prov.ur[y]) : '–', `unemployment, Saskatchewan ${inYears ? y : `(${y0}–${y1})`}`);
          hero(1, inYears && J.prov.er[y] != null ? pct(J.prov.er[y]) : '–', `of people 15+ have a job, ${inYears ? y : 'LFS'}`);
          hero(2, J.prov.inc ? fmt.money(J.prov.inc) : '–', 'median household income, Saskatchewan 2020');
          hero(3, sk[0] ? `${sk[0].pct.toFixed(0)}%` : '–', sk[0] ? `work in ${sk[0].name.toLowerCase()}, the biggest sector (2021)` : 'top industry');
          set(time);
        },
      };
    },
    click: csdClick,
    describe(info) { const s = csdOf(info); return s ? csdReport(data, s, 'jobs') : null; },
    tooltip(info) {
      const o: any = info.object;
      const id = info.layer?.id ?? '';
      if (!o || !id.startsWith('jobs')) return null;
      const s = csdOf(info);
      if (s) {
        const c = J?.csd?.[s.id];
        return csdTooltip(data, s, [['Median household income', c?.inc != null ? fmt.money(c.inc) : missing(s)], ['Unemployment, May 2021', c?.cur != null ? pct(c.cur) : missing(s)]]);
      }
      const row = (k: string, v: string) => `<br><span class="tk">${k}</span> <span class="tv">${v}</span>`;
      const y = Math.min(Math.max(Math.floor(shownTime), y0), y1);
      if (id === 'jobs-base') {
        const reg = regions[o.r];
        return `<b>${esc(reg.name)}</b>${reg.combined ? '<br><span class="tk">two economic regions the survey reports together</span>' : ''}`
          + row(`Unemployment ${y}`, reg.ur[y] != null ? pct(reg.ur[y]) : 'n/a')
          + row(`Employment rate ${y}`, reg.er[y] != null ? pct(reg.er[y]) : 'n/a')
          + `<br><span class="tk">${esc(reg.ers.join(' · '))}</span>`;
      }
      const t = towns[o.m.key];
      const reg = t?.r != null ? regions[t.r] : null;
      return `<b>${esc(o.m.name)}</b>${row('Median household income', fmt.money(o.v))}`
        + (t?.ind?.length ? row('Top industry', `${esc(J!.naics[t.ind[0][0]])} ${t.ind[0][1].toFixed(0)}%`) : '')
        + (reg && reg.ur[y] != null ? row(`Region unemployment ${y}`, pct(reg.ur[y])) : '')
        + '<br><span class="tk">Click for town report</span>';
    },
  };
  return l;
}
