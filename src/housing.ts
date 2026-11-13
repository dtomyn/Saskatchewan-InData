// HOME COSTS — what a home costs in each place. Census 2021 (Statistics Canada) gives every place its median dwelling
// value, its owners' and renters' monthly shelter costs and the share of households spending 30 % or more of income on
// shelter. CMHC's Rental Market Survey adds average market rents and vacancy rates, year by year, for the centres it
// surveys; those are the only measure that moves with the timeline. Property tax is a second view: the Ministry of
// Government Relations' Mill Rate Survey gives each place's residential mill rate, and the indicative tax applies it
// (with the provincial education rate) to the census median home at 80 % of value.
import * as d3 from 'd3';
import { Data, fmt, interpYearly } from './data';
import { lineChart, rampCSS } from './charts';
import { AtlasLayer, deferChart, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layer-kit';
import { esc } from './html';
import { csdClick, csdOf, csdReport, csdTint, csdTooltip, missing } from './subdivisions';

type MeasureKey = 'value' | 'rentCost' | 'stir30' | 'market' | 'tax';
type Measure = { key: MeasureKey; chip: string; label: string; fmt: (v: number) => string; lowFirst: boolean };

const money = (v: number) => `$${fmt.int(v)}`;
const MEASURES: Measure[] = [
  { key: 'value', chip: 'Home value', label: 'Median value of owned dwellings, 2021', fmt: (v) => fmt.money(v), lowFirst: true },
  { key: 'rentCost', chip: 'Rent paid', label: 'Median monthly shelter cost, renters, 2021', fmt: money, lowFirst: true },
  { key: 'stir30', chip: 'Stretched', label: 'Households spending 30 %+ of income on shelter, 2021', fmt: (v) => `${v.toFixed(1)}%`, lowFirst: true },
  { key: 'market', chip: 'Market rent', label: 'CMHC average two-bedroom rent', fmt: money, lowFirst: true },
  { key: 'tax', chip: 'Property tax', label: 'Indicative property tax a year on the median home', fmt: (v) => `~${money(v)}`, lowFirst: true },
];

export function housingLayer(data: Data): AtlasLayer {
  const color = '#e6a57e';
  const h = data.housing;
  const census = h?.census ?? {};
  const rent = h?.rent ?? {};
  const prov = h?.prov ?? {};
  const tax = data.tax;
  const taxOf = (k: string) => tax?.places[k]?.tax ?? null;
  const rentKeys = Object.keys(rent);
  const ys = [...new Set(Object.values(rent).flatMap((r) => Object.keys(r.r2)))].map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 2000, y1 = ys.at(-1) ?? 2025;
  const nm = (k: string) => data.munis.find((m) => m.key === k)?.name ?? k;
  // the mean two-bedroom rent across the surveyed centres reporting that year
  const meanRent = (y: number) => d3.mean(rentKeys.map((k) => rent[k].r2[y]).filter((v) => v != null));

  const RAMPS: Record<MeasureKey, d3.ScaleSequential<string>> = {
    value: d3.scaleSequential(d3.interpolateRgb('#2a3a66', '#ffd2a8')).domain([100000, 420000]).clamp(true),
    rentCost: d3.scaleSequential(d3.interpolateRgb('#2a3a66', '#ffd2a8')).domain([600, 1400]).clamp(true),
    stir30: d3.scaleSequential(d3.interpolateRgb('#2a3a66', '#ff7a6b')).domain([5, 30]).clamp(true),
    // market rent columns are coloured by vacancy: tight markets (low vacancy) glow hot
    market: d3.scaleSequential(d3.interpolateRgb('#ff5a4a', '#6fd3ff')).domain([1, 9]).clamp(true),
    tax: d3.scaleSequential(d3.interpolateRgb('#2a3a66', '#ffb38a')).domain([1000, 4000]).clamp(true),
  };
  const HEIGHT: Record<MeasureKey, (v: number) => number> = {
    value: (v) => v * 0.25,
    rentCost: (v) => v * 80,
    stir30: (v) => v * 3800,
    market: (v) => v * 70,
    tax: (v) => v * 25,
  };
  let cur = MEASURES[0];
  let shownTime = y1;
  const valueAt = (key: string, t: number) => {
    if (cur.key === 'market') return interpYearly(rent[key]?.r2, t);
    if (cur.key === 'tax') return taxOf(key);
    return census[key]?.[cur.key] ?? null;
  };

  const l: AtlasLayer = {
    id: 'housing',
    name: 'Home costs',
    icon: '⌂',
    color,
    range: [y0, y1 + 0.99],
    available: !!h,
    unavailable: 'Statistics Canada’s census profile could not be downloaded when this copy of the data was built. Run <code>npm run data housing</code>, then reload.',
    build({ time, selected, focusedId }) {
      shownTime = time;
      const k = cur.key;
      // every census subdivision tinted by the same census measure (market rent and property tax are the places' own)
      const tint = k === 'value' || k === 'rentCost' || k === 'stir30'
        ? csdTint('housing', data, (s) => h?.csd?.[s.id]?.[k] ?? null, (v) => rgb(RAMPS[k](v)), k, focusedId === 'housing')
        : [];
      const colorOf = k === 'market'
        ? (_v: number, m: { key: string }) => { const vac = interpYearly(rent[m.key]?.vac, time); return vac == null ? rgb('#c9b8a8', 230) : rgb(RAMPS.market(vac), 240); }
        : (v: number) => rgb(RAMPS[k](v), 240);
      return [...tint, ...townColumns('housing', data.munis, (m) => valueAt(m.key, time), HEIGHT[k], colorOf, time, `${selected}${k}`)];
    },
    spark: () => ys.map((x) => ({ x, y: meanRent(x) ?? 0 })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Places & living · Census 2021 and CMHC')}
        <h2>What a home costs</h2>`;
      if (!h) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">The 2021 census asked every household what its home is worth and what it pays to live there. Columns show the chosen measure for each place, and the whole province is tinted by it, census subdivision by census subdivision (rural municipalities, villages and reserves included; click one for its census report); <b>Market rent</b> follows CMHC’s survey of purpose-built rentals in the ${rentKeys.length} centres it covers, year by year, coloured by how hard it is to find a vacancy. <b>Property tax</b> applies each place’s ${tax ? tax.year : ''} residential mill rate to its median home.</p>
        <div class="chips" style="margin:2px 0 10px">${MEASURES.map((m) => `<button class="chip" data-m="${m.key}" style="--c:${color}">${m.chip}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Average two-bedroom rent, CMHC surveyed centres</h3>`);
      const palette = ['#e6a57e', '#4cc9f0', '#ffd166', '#3ecf8e', '#b388ff', '#ff5d8f', '#9ad8ff', '#c5e86c', '#ff8a3d'];
      const order = rentKeys.sort((a, b) => (rent[b].r2[y1] ?? 0) - (rent[a].r2[y1] ?? 0));
      const series = order.map((k, i) => ({ key: k, label: nm(k), color: palette[i % palette.length], width: ['saskatoon', 'regina'].includes(k) ? 2.5 : 1.5, values: Object.entries(rent[k].r2 as Record<string, number>).map(([y, v]) => ({ x: +y, y: v })) }));
      const set = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [y0, y1], height: 170, yZero: false, yFormat: (v) => `$${d3.format('~s')(v)}`, valueFormat: money }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`);
      const rampBox = el.appendChild(mk('div'));
      const list = el.appendChild(mk('div'));
      el.insertAdjacentHTML('beforeend', `
        <p class="note">Census figures are for each place’s own census subdivision (the city, town or northern village, not its rural municipality); Lloydminster counts only its Saskatchewan side. Dwelling values are what owners said their home would sell for, in 2021. Shelter costs include rent or mortgage, property tax, condo fees and utilities. The 30 % share counts owner and renter households with income, off farms and reserves. Statistics Canada rounds counts and suppresses figures for the smallest places: a suppressed subdivision is left untinted and reads “—”, never zero. A rural municipality surrounds its towns and villages but excludes them; reserves are their own subdivisions, and a reserve not fully counted in 2021 reads “not enumerated”.</p>
        <p class="note">CMHC rents are October averages for two-bedroom units in purpose-built row and apartment buildings of three or more units, over the whole census metropolitan area or agglomeration named after the place (Saskatoon’s includes Warman and Martensville, for example); they are shown only on that place. Secondary rentals (basement suites, rented houses) are not surveyed. Lloydminster’s vacancy rate covers both the Saskatchewan and Alberta sides. Weyburn and the smaller towns are not surveyed.</p>
        ${tax ? `<p class="note"><b>Property tax</b> is indicative, not a bill: median home value (Census 2021) × ${Math.round(tax.pov * 100)} % (the residential <a href="${tax.povSource}" target="_blank" rel="noopener">percentage of value</a>) × (the place’s residential municipal mill rate + the provincial residential education mill rate, ${tax.edu.toFixed(2)} in ${tax.year}) ÷ 1000. The municipal rate is the uniform mill rate times the residential mill rate factor, as reported in the ${tax.year} Mill Rate Survey. Assessed value is not market value (the 2021 revaluation values homes as of January 1, 2019) and the census value is the owner’s own guess. Base tax and minimum tax (used by most towns), library levies and special levies are not added, so many bills are higher. Lloydminster is assessed under its own charter and has no estimate; Cumberland House and Sandy Bay reported no rate.</p>${sourceLine(tax.source)}` : ''}
        ${sourceLine(h.source)}${sourceLine(h.rentSource)}`);

      let lastY = -1;
      const drawRamp = () => {
        const r = RAMPS[cur.key];
        const [a, b] = r.domain();
        const f = cur.key === 'market' ? (v: number) => `${v}%` : cur.fmt;
        rampBox.innerHTML = `<h3>Colour: ${cur.key === 'market' ? 'rental vacancy rate (red = tight)' : cur.key === 'tax' ? `indicative property tax, ${tax?.year ?? ''} rates` : esc(cur.chip.toLowerCase())}</h3>
          <div class="ramp" style="background:${rampCSS((t) => r(a + t * (b - a)))}"></div>
          <div class="ramp-labels"><span>${f(a)}</span><span>${f((a + b) / 2)}</span><span>${f(b)}+</span></div>`;
      };
      const drawList = (y: number) => {
        const rows = (cur.key === 'market'
          ? rentKeys.map((k) => ({ k, v: rent[k].r2[y], sub: rent[k].vac?.[y] != null ? `${rent[k].vac![y].toFixed(1)}% vacant` : '' }))
          : cur.key === 'tax'
            ? Object.keys(tax?.places ?? {}).map((k) => { const p = tax!.places[k]; return { k, v: p.tax, sub: `${p.r.toFixed(2)} mills residential${p.bt || p.mt ? ' · plus base/min tax' : ''}` }; })
            : Object.keys(census).map((k) => ({ k, v: census[k][cur.key as Exclude<MeasureKey, 'market' | 'tax'>], sub: '' })))
          .filter((r) => r.v != null) as { k: string; v: number; sub: string }[];
        rows.sort((a, b) => a.v - b.v);
        const max = d3.max(rows, (r) => r.v) ?? 1;
        list.innerHTML = `<h3>${esc(cur.label)}${cur.key === 'market' ? `, ${y}` : ''} · lowest first</h3>
          <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.k)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(nm(r.k))}</span>${r.sub ? `<br><span class="rd">${r.sub}</span>` : ''}</span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${color}"></i></div><div class="bar-v">${cur.fmt(r.v)}</div></span></li>`).join('')}</ol>`;
      };
      list.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
        const m = MEASURES.find((x) => x.key === k);
        if (m) { cur = m; lastY = -1; drawRamp(); el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === cur.key)); }
      });
      el.querySelector<HTMLButtonElement>(`[data-m="${cur.key}"]`)?.classList.add('on');
      drawRamp();
      return {
        update({ time }) {
          const y = Math.min(Math.max(Math.floor(time), y0), y1);
          hero(0, prov.value ? fmt.money(prov.value) : '–', 'median home value, Saskatchewan 2021');
          hero(1, prov.rentCost ? money(prov.rentCost) : '–', 'median renter shelter cost a month, 2021');
          hero(2, prov.stir30 != null ? `${prov.stir30.toFixed(0)}%` : '–', `of households spend 30 %+ on shelter (renters ${prov.rent30?.toFixed(0) ?? '–'}%)`);
          const mr = meanRent(y);
          hero(3, mr ? money(mr) : '–', `average 2-bed market rent across surveyed centres, ${y}`);
          if (y !== lastY) { lastY = y; drawList(y); }
          set(time);
        },
      };
    },
    click: csdClick,
    describe(info) { const s = csdOf(info); return s ? csdReport(data, s, 'housing') : null; },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('housing')) return null;
      const s = csdOf(info);
      if (s) {
        const c = h?.csd?.[s.id];
        const f = (v: number | undefined, fm: (v: number) => string) => (v != null ? fm(v) : missing(s));
        return csdTooltip(data, s, [[cur.label.replace(/, 2021$/, ''), f(c?.[cur.key as 'value'], cur.fmt)], ...(cur.key !== 'value' ? [['Median home value', f(c?.value, fmt.money)] as [string, string]] : [])]);
      }
      const c = census[o.m.key];
      const r = rent[o.m.key];
      const y = Math.min(Math.floor(shownTime), y1);
      const row = (k: string, v: string) => `<br><span class="tk">${k}</span> <span class="tv">${v}</span>`;
      return `<b>${esc(o.m.name)}</b>${row(cur.label.replace(/, 2021$/, ''), cur.fmt(o.v))}`
        + (cur.key !== 'value' && c?.value ? row('Median home value', fmt.money(c.value)) : '')
        + (cur.key !== 'rentCost' && c?.rentCost ? row('Median rent paid', money(c.rentCost)) : '')
        + (tax?.places[o.m.key] ? row(`Mill rate ${tax.year}`, `${tax.places[o.m.key].r.toFixed(2)} residential + ${tax.edu.toFixed(2)} education`) : '')
        + (r?.vac?.[y] != null ? row(`Vacancy ${y}`, `${r.vac[y].toFixed(1)}%`) : '')
        + '<br><span class="tk">Click for town report</span>';
    },
  };
  return l;
}
