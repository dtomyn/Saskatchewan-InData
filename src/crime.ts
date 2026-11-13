// CRIME SEVERITY — each place's Crime Severity Index from one police service's series (its own municipal service while
// current, else the rural RCMP detachment of the same name), drawn as town columns; series are never spliced.
import * as d3 from 'd3';
import { Data, interpYearly } from './data';
import { AtlasLayer, townColumns, rgb, kicker, heroStats, deferChart, mk, sourceLine } from './layer-kit';
import { lineChart, rampCSS } from './charts';
import { esc } from './html';

export function crimeLayer(data: Data): AtlasLayer {
  const color = '#ff4d8d';
  const cr = data.crime?.munis ?? {};
  const ramp = d3.scaleSequential(d3.interpolateRgb('#4a0f2b', '#ffd1e3')).domain([40, 400]).clamp(true);
  const ys = [...new Set(Object.values(cr).flatMap((c) => Object.keys(c.csi ?? {})))].map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 1998, y1 = ys.at(-1) ?? 2024;
  const prov = data.crime?.prov ?? {};
  const pcsi = prov.csi ?? {};
  type Measure = { key: 'csi' | 'vcsi' | 'clear'; chip: string; label: string };
  const MEASURES: Measure[] = [
    { key: 'csi', chip: 'All crime', label: 'Crime Severity Index' },
    { key: 'vcsi', chip: 'Violent', label: 'Violent Crime Severity Index' },
    { key: 'clear', chip: 'Solved', label: 'Weighted clearance rate (%)' },
  ];
  let cur = MEASURES[0];
  const rural = (k: string) => data.crime?.service?.[k]?.level === 'rural';
  const nm = (k: string) => data.munis.find((m) => m.key === k)?.name ?? k;

  const l: AtlasLayer = {
    id: 'crime',
    name: 'Crime severity',
    icon: '◆',
    color,
    range: [y0, y1 + 0.99],
    available: !!data.crime,
    unavailable: `Statistics Canada’s download service was offline when this copy of the data was built. Run <code>npm run data crime</code> to fetch the Crime Severity Index, then reload.`,
    build({ time, selected }) {
      const k = cur.key;
      const ramp2 = k === 'clear' ? d3.scaleSequential(d3.interpolateRgb('#3a1a4a', '#b8ffde')).domain([15, 60]).clamp(true) : ramp;
      return townColumns('crime', data.munis, (m) => interpYearly(cr[m.key]?.[k], time), (v) => (k === 'clear' ? v * 1800 : Math.sqrt(v) * 5000), (v) => rgb(ramp2(v), 240), time, `${selected}${k}`);
    },
    spark: () => ys.map((x) => ({ x, y: pcsi[x] ?? 0 })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Justice · police-reported crime')}
        <h2>How much crime, and how serious?</h2>`;
      if (!data.crime) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Statistics Canada’s Crime Severity Index weights each police-reported crime by how serious it is, so one robbery counts for more than several thefts. 100 is Canada’s 2006 level. Saskatchewan has long had the highest index of any province. Pick what the columns show:</p>
        <div class="chips" style="margin:2px 0 10px">${MEASURES.map((m) => `<button class="chip" data-m="${m.key}" style="--c:${color}">${m.chip}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Crime Severity Index: Saskatchewan and selected police services</h3>`);
      const palette = ['#4cc9f0', '#ffd166', '#3ecf8e', '#b388ff', '#ff8a3d'];
      const hl = ['regina', 'saskatoon', 'prince albert', 'north battleford', 'moose jaw'];
      const series = hl.filter((k) => cr[k]?.csi).map((k, i) => ({ key: k, label: nm(k), color: palette[i], width: 2, values: Object.entries(cr[k].csi ?? {}).map(([y, v]) => ({ x: +y, y: v })) }));
      series.push({ key: 'sk', label: 'Saskatchewan', color: '#ffffff', width: 2, dashed: true, values: Object.entries(pcsi).map(([y, v]) => ({ x: +y, y: v })) } as any);
      const set = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [y0, y1], height: 170, yFormat: (v) => String(Math.round(v)) }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
        <div class="ramp" style="background:${rampCSS((t) => ramp(40 + t * 360))}"></div>
        <div class="ramp-labels"><span>40</span><span>220</span><span>400+</span></div>`);
      const list = el.appendChild(mk('div'));
      el.insertAdjacentHTML('beforeend', `
        <p class="note">Each place is shown by its own police service: a municipal force (Regina, Saskatoon, Prince Albert, Moose Jaw, Estevan, Weyburn) or the RCMP’s municipal detachment. A few northern villages have no municipal series and use the surrounding rural RCMP detachment, which covers a wider area${Object.keys(cr).filter(rural).length ? ` (${Object.keys(cr).filter(rural).map(nm).join(', ')})` : ''}. Service hubs score high partly because people come in from the surrounding area to shop, work and drink; a small town’s index can jump on a handful of incidents. The clearance rate is the weighted share of crimes police solved (charged or cleared otherwise).</p>
        ${sourceLine(data.crime.source)}`);
      let lastY = -1;
      const drawList = (y: number) => {
        const rows = Object.entries(cr).map(([k, c]) => ({ k, v: c[cur.key]?.[y] })).filter((r) => r.v != null) as { k: string; v: number }[];
        rows.sort((a, b) => (cur.key === 'clear' ? b.v - a.v : a.v - b.v));
        const max = d3.max(rows, (r) => r.v) ?? 1;
        list.innerHTML = `<h3>${cur.label}, ${y} · ${cur.key === 'clear' ? 'most solved first' : 'lowest first'}</h3>
          <ol class="rank-list">${rows.map((r, i) => `<li data-key="${r.k}"><span class="rk">${i + 1}</span><span><span class="nm">${nm(r.k)}</span>${rural(r.k) ? '<br><span class="rd">rural RCMP detachment</span>' : ''}</span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${color}"></i></div><div class="bar-v">${r.v.toFixed(0)}</div></span></li>`).join('')}</ol>`;
      };
      list.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
        const m = MEASURES.find((x) => x.key === k);
        if (m) { cur = m; lastY = -1; el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === cur.key)); }
      });
      el.querySelector<HTMLButtonElement>('[data-m="csi"]')?.classList.add('on');
      return {
        update({ time }) {
          const y = Math.min(Math.floor(time), y1);
          hero(0, pcsi[y] ? pcsi[y].toFixed(0) : '–', `Saskatchewan CSI ${y}`);
          hero(1, prov.vcsi?.[y] ? prov.vcsi[y].toFixed(0) : '–', `violent CSI ${y}`);
          hero(2, prov.clear?.[y] ? `${prov.clear[y].toFixed(0)}%` : '–', `of crime solved (weighted) ${y}`);
          const peak = Object.entries(pcsi).reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0] as [string, number]);
          hero(3, peak[0] || '–', peak[0] ? `peak year (CSI ${peak[1].toFixed(0)})` : '');
          if (y !== lastY) { lastY = y; drawList(y); }
          set(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('crime')) return null;
      const s = data.crime?.service?.[o.m.key];
      return `<b>${o.m.name}</b><br><span class="tk">${cur.label}</span> <span class="tv">${o.v.toFixed(1)}</span>${s ? `<br><span class="tk">${esc(s.name)}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}
