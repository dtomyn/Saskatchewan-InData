// INTERNET & MOBILE — what fixed internet and mobile service is offered where people live, from ISED's National
// Broadband Data. ISED places "pseudo-households" along every road and records the fastest tier of fixed service
// (wired or fixed wireless) offered at each, and whether LTE mobile service reaches it; the data stage sums them, weighted
// by households, into ISED's 25 km² hexagons (the map tint) and into each place's town limits. Availability means a
// provider says it offers the service there, not that it works well or is affordable. A static layer.
import * as d3 from 'd3';
import { PolygonLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { fmt } from './data';
import type { Data, NetHex, NetTown } from './data';
import { esc } from './html';
import { rampCSS } from './charts';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layer-kit';
import { metric, link } from './report-kit';

/** What the map can show, in the order of the panel's chips. */
export const NET_MEASURES = [
  { id: 'f50', chip: 'Fixed 50/10', label: 'offered 50/10 Mbps by any fixed service (wired or fixed wireless)', col: 3 },
  { id: 'w50', chip: 'By wire', label: 'offered 50/10 Mbps by wire (fibre, cable or DSL)', col: 4 },
  { id: 'lte', chip: 'Mobile LTE', label: 'reached by LTE mobile service', col: 5 },
  { id: 'mob', chip: 'Carriers', label: 'mobile networks serving the hexagon', col: 6 },
] as const;
type MeasureId = (typeof NET_MEASURES)[number]['id'];

const TECH: Record<string, string> = { fibre: 'fibre', cable: 'cable', dsl: 'DSL', fw: 'fixed wireless', sat: 'satellite', mob: 'mobile' };
const techList = (t: string[]) => t.filter((x) => x !== 'mob' && x !== 'sat').map((x) => TECH[x] ?? x).join(', ');
/** A tier index as a speed ("50/10 Mbps"), from the data's own tier names. */
export const tierText = (tiers: string[], i: number) => (i <= 0 ? 'none' : i === tiers.length - 1 ? `${tiers[i]} Mbps or faster` : `${tiers[i]} Mbps`);

/** One place's internet, with the shares the Town Report and Finder use. */
export type PlaceNet = NetTown & { f50: number; w50: number; bestText: string; techText: string; mobile: 'none' | 'LTE' };
export function placeNet(data: Data, key: string): PlaceNet | null {
  const I = data.internet;
  const t = I?.towns[key];
  if (!I || !t) return null;
  return {
    ...t, f50: t.comb[5] ?? 0, w50: t.wired[5] ?? 0, bestText: tierText(I.tiers, t.best), techText: techList(t.tech),
    // ISED's open data has LTE (and better) but does not single out 5G
    mobile: (t.lte ?? 0) > 0 || t.mob.length ? 'LTE' : 'none',
  };
}

export function internetLayer(data: Data): AtlasLayer {
  const color = '#e9a8ff';
  const I = data.internet;
  const hexes: NetHex[] = I?.hexes ?? [];
  let target: MeasureId = 'f50';
  const measure = () => NET_MEASURES.find((m) => m.id === target)!;
  const share = d3.scaleLinear<string>().domain([0, 60, 100]).range(['#ff5d5d', '#8a6cff', color]).interpolate(d3.interpolateRgb).clamp(true);
  const carriers = d3.scaleLinear<string>().domain([0, 1, 3]).range(['#ff5d5d', '#8a6cff', color]).interpolate(d3.interpolateRgb).clamp(true);
  const ramp = (v: number) => (target === 'mob' ? carriers(v) : share(v));
  // ISED's hexagons are a fixed 0.1206° apart east-west; rows lie half a hexagon apart north-south, a spacing that grows
  // with latitude (about 0.0168° / cos(lat)), so each is drawn as a flat-topped hexagon around its centre
  const R = 0.1206 / 3;
  type Hex = { h: NetHex; poly: [number, number][] };
  const shapes: Hex[] = hexes.map((h) => {
    const [x, y] = h;
    const H = 0.0168 / Math.cos((y * Math.PI) / 180);
    return { h, poly: [[x - R, y], [x - R / 2, y + H], [x + R / 2, y + H], [x + R, y], [x + R / 2, y - H], [x - R / 2, y - H], [x - R, y]] };
  });
  const val = (h: NetHex) => h[measure().col];
  const townVal = (key: string) => {
    const p = placeNet(data, key);
    if (!p) return null;
    return target === 'f50' ? p.f50 : target === 'w50' ? p.w50 : target === 'lte' ? p.lte : p.mob.length;
  };

  const l: AtlasLayer = {
    id: 'internet',
    name: 'Internet & mobile',
    icon: '📶',
    color,
    range: [2025, 2025.99],
    static: true,
    period: 'service offered today',
    available: hexes.length > 0,
    unavailable: 'ISED’s National Broadband Data could not be downloaded when this copy of the data was built. Run <code>npm run data internet</code>, then reload.',
    build({ selected, focusedId }) {
      const focused = focusedId === 'internet';
      const shown = target === 'mob' ? shapes : shapes.filter((s) => s.h[2] > 0);
      const out: Layer[] = [
        new PolygonLayer<Hex>({
          id: 'internet-hex', data: shown, getPolygon: (d) => d.poly,
          getFillColor: (d) => { const v = val(d.h); return v == null ? [0, 0, 0, 0] : rgb(ramp(v), (focused ? 150 : 95) * (d.h[2] > 0 ? 1 : 0.45)); },
          stroked: false, filled: true, pickable: true, parameters: NO_DEPTH,
          updateTriggers: { getFillColor: [target, focused] },
        } as any),
      ];
      if (focused) {
        const height = target === 'mob' ? (v: number) => 2500 + v * 9000 : (v: number) => 2500 + v * 280;
        out.push(...townColumns('internet', data.munis, (m) => townVal(m.key), height, (v) => rgb(ramp(v), 235), 0, `${selected}${target}`));
      }
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Places & living · ISED National Broadband Data')}
        <h2>Can I work from home here?</h2>`;
      if (!I) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">The share of homes in each of ISED’s 25 km² hexagons that are <b>offered</b> fixed internet at 50/10 Mbps (the national target), by any wired or fixed-wireless service or by wire alone, and that LTE mobile service reaches. Columns show the same for the homes inside each place’s town limits.</p>
        <div class="chips" style="margin:2px 0 10px">${NET_MEASURES.map((m) => `<button class="chip${m.id === target ? ' on' : ''}" data-k="${m.id}" style="--c:${color}">${m.chip}</button>`).join('')}</div>`);
      const towns = data.munis.flatMap((m) => { const p = placeNet(data, m.key); return p ? [{ m, p }] : []; });
      const hero = heroStats(el, 4);
      hero(0, `${I.prov.f50 ?? 0}%`, 'of Saskatchewan homes offered 50/10');
      hero(1, `${I.prov.w50 ?? 0}%`, 'offered it by wire');
      hero(2, `${I.prov.lte ?? 0}%`, 'reached by LTE');
      hero(3, `${towns.filter((t) => t.p.f50 >= 95).length} of ${towns.length}`, 'places where 95 %+ of homes get 50/10');
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === target));
        const ms = measure();
        const rows = towns.map((t) => ({ ...t, v: townVal(t.m.key) ?? 0 })).sort((a, b) => a.v - b.v || a.p.f50 - b.p.f50 || a.m.name.localeCompare(b.m.name));
        const max = target === 'mob' ? Math.max(1, d3.max(rows, (r) => r.v) ?? 1) : 100;
        const vt = (v: number) => (target === 'mob' ? String(v) : `${v}%`);
        body.innerHTML = `<h3>${target === 'mob' ? 'Mobile networks in town' : `Homes in town ${esc(ms.label)}`}, least first</h3>
          <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">best ${esc(r.p.bestText)}${r.p.techText ? ` · ${esc(r.p.techText)}` : ''}${r.p.mob.length ? ` · ${esc(r.p.mob.join(', '))}` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${ramp(r.v)}"></i></div><div class="bar-v">${vt(r.v)}</div></span></li>`).join('')}</ol>
          <div class="ramp" style="background:${rampCSS((t) => (target === 'mob' ? carriers(t * 3) : share(t * 100)))}"></div>
          <div class="ramp-labels">${target === 'mob' ? '<span>none</span><span>1</span><span>3+ networks</span>' : '<span>0 % of homes</span><span>60 %</span><span>100 %</span>'}</div>`;
      };
      body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as MeasureId | undefined;
        if (k) { target = k; draw(); }
      });
      draw();
      el.insertAdjacentHTML('beforeend', `
        <p class="note"><b>Offered is not the same as good.</b> ISED records where providers say a service is available at a speed tier; it does not measure the speed people actually get, how a fixed-wireless or mobile signal holds up at a given farmyard, or what it costs. Fixed wireless (a tower signal to a dish on the house) counts towards 50/10 but is not the same as fibre or cable, which is why the map has a “By wire” view. Satellite (Starlink and others) is offered almost everywhere and is not counted here; ISED’s combined fixed figure leaves it out too.</p>
        <p class="note">ISED’s pseudo-households are points spread along roads, each carrying the 2021 census households near it; the shares here weight them by households, and a place counts the points inside its 2021 census subdivision (its town limits). Mobile coverage is LTE or better: ISED’s open data does not single out 5G. Carriers are the mobile networks ISED lists in a hexagon; a carrier that sells service on another’s network is not counted separately.</p>
        ${sourceLine(`${I.source} (${I.licence}), downloaded ${I.asOf}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('internet')) return null;
      if (id === 'internet-hex') {
        const h = (info.object as Hex).h;
        const pc = (v: number | null) => (v == null ? 'n/a' : `${v}%`);
        return h[2] > 0
          ? `<b>${fmt.int(h[2])} household${h[2] === 1 ? '' : 's'}</b> in this 25 km² hexagon<br><span class="tk">50/10 offered</span> <span class="tv">${pc(h[3])}</span><br><span class="tk">50/10 by wire</span> <span class="tv">${pc(h[4])}</span><br><span class="tk">LTE mobile</span> <span class="tv">${pc(h[5])}</span><br><span class="tk">Mobile networks</span> <span class="tv">${h[6]}</span>`
          : `<b>No households</b> in this hexagon<br><span class="tk">Mobile networks listed</span> <span class="tv">${h[6]}</span>`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const p = placeNet(data, o.m.key);
      if (!p) return null;
      return `<b>${esc(o.m.name)}</b><br><span class="tk">Homes offered 50/10</span> <span class="tv">${p.f50}%</span><br><span class="tk">by wire</span> <span class="tv">${p.w50}%</span><br><span class="tk">Best offered</span> <span class="tv">${esc(p.bestText)}</span><br><span class="tk">Mobile</span> <span class="tv">${p.mobile}${p.mob.length ? ` · ${esc(p.mob.join(', '))}` : ''}</span><br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

// ---- the Town Report section (src/panels.ts places it)

/** Internet: the fixed speed offered to homes in town (ISED), and mobile service. */
export function internetRows(p: PlaceNet) {
  const c = '#e9a8ff';
  return `<h3>Internet</h3>
    <div class="metric-grid">
      ${metric('Fast internet', c, `${p.f50}%`, `of homes in town offered 50/10 Mbps or better (wired or fixed wireless); ${p.w50}% by wire`)}
      ${metric('Best offered', c, p.best >= 5 ? '50/10+' : esc(p.bestText.replace(/ Mbps.*/, '')), `${p.best > 0 ? 'Mbps down/up, ' : ''}the fastest tier ISED records in town (it tops out at 50/10)${p.techText ? ` · ${esc(p.techText)}` : ''}`)}
      ${metric('Mobile', c, p.mobile, p.mobile === 'none' ? 'no LTE recorded in town' : `${p.lte ?? 0}% of homes reached by LTE or better${p.mob.length ? ` · ${esc(p.mob.join(', '))}` : ''} (5G is not in the open data)`)}
    </div>
    <p class="note" style="margin-top:6px">ISED National Broadband Data: where providers say a service is offered, not the speed people actually get or what it costs.</p>
    <div class="tr-falls" style="margin-top:8px">${link('internet', '📶 Internet &amp; mobile on the map')}</div>`;
}
