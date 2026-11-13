// Treaties & reserves: the numbered treaty areas that cover Saskatchewan (Indigenous Services Canada) and the legal
// boundaries of reserves (Canada Lands Survey System). A static layer; the treaty signings are curated events.
import * as d3 from 'd3';
import { PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { Reserve, Treaty, fmt } from './data';
import { esc } from './html';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine } from './layer-kit';
import type { Data } from './data';

const PALETTE = ['#f4a261', '#e9c46a', '#2a9d8f', '#8ab17d', '#e76f51', '#9d8df1', '#64b5f6'];

export function treatiesLayer(data: Data): AtlasLayer {
  const color = '#e9c46a';
  const T = data.treaties;
  const treaties: Treaty[] = T?.treaties ?? [];
  const reserves: Reserve[] = T?.reserves ?? [];
  const tColor = (i: number) => PALETTE[i % PALETTE.length];
  type Poly = { i: number; poly: [number, number][][] };
  const tPolys: Poly[] = treaties.flatMap((t, i) => t.polys.map((poly) => ({ i, poly })));
  type RPoly = { r: Reserve; poly: [number, number][][] };
  const rPolys: RPoly[] = reserves.flatMap((r) => r.polys.map((poly) => ({ r, poly })));
  const centre = (t: Treaty): [number, number] => {
    // label at the treaty's largest part, pulled inside the province's box
    const ring = t.polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0] ?? [[0, 0]];
    const lon = d3.mean(ring, (p) => p[0]) ?? 0, lat = d3.mean(ring, (p) => p[1]) ?? 0;
    return [Math.max(-109.5, Math.min(-102, lon)), Math.max(49.5, Math.min(59.5, lat))];
  };
  const totalKm2 = d3.sum(reserves, (r) => r.km2);

  const l: AtlasLayer = {
    id: 'treaties',
    name: 'Treaties & reserves',
    icon: '◈',
    color,
    range: [1871, 1906.99],
    static: true,
    period: treaties.length ? `treaties ${d3.min(treaties, (t) => t.year)}–${d3.max(treaties, (t) => t.end ?? t.year)}` : 'treaty areas',
    available: treaties.length > 0 || reserves.length > 0,
    unavailable: 'The treaty and reserve boundary services could not be reached when this copy of the data was built. Run <code>npm run data treaties</code>, then reload.',
    build({ focusedId }) {
      const focused = focusedId === 'treaties';
      const out: Layer[] = [
        new PolygonLayer<Poly>({
          id: 'treaties-base',
          data: tPolys,
          getPolygon: (d) => d.poly,
          getFillColor: (d) => rgb(tColor(d.i), focused ? 46 : 26),
          getLineColor: (d) => rgb(tColor(d.i), 200),
          lineWidthUnits: 'pixels',
          getLineWidth: 1.4,
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new PolygonLayer<RPoly>({
          id: 'treaties-reserves',
          data: rPolys,
          getPolygon: (d) => d.poly,
          getFillColor: [255, 236, 179, 190],
          getLineColor: [255, 248, 225, 255],
          lineWidthUnits: 'pixels',
          getLineWidth: 0.6,
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
      ];
      if (focused)
        out.push(new TextLayer<Treaty>({
          id: 'treaties-labels',
          data: treaties,
          getPosition: (t) => centre(t),
          getText: (t) => `${t.name}\n${t.year}${t.end ? `–${t.end}` : ''}`,
          getSize: 14,
          getColor: (t) => rgb(tColor(treaties.indexOf(t)), 255),
          fontFamily: 'Fraunces, Georgia, serif',
          fontWeight: 700,
          outlineWidth: 4,
          outlineColor: [6, 10, 18, 235],
          fontSettings: { sdf: true },
          characterSet: 'auto',
          parameters: { depthCompare: 'always' },
        } as any));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Treaty land · the numbered treaties')}
        <h2>All of Saskatchewan is treaty land</h2>`;
      if (!T) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Between ${d3.min(treaties, (t) => t.year)} and ${d3.max(treaties, (t) => t.end ?? t.year)} First Nations and the Crown signed the numbered treaties that cover the whole province. The tinted areas are the treaty areas as Canada maps them; the bright shapes are the ${fmt.int(reserves.length)} reserve parcels set aside since.</p>`);
      const hero = heroStats(el, 4);
      hero(0, String(treaties.length), 'numbered treaties');
      hero(1, fmt.int(reserves.length), 'reserve parcels');
      hero(2, `${fmt.int(totalKm2)} km²`, 'of reserve land');
      hero(3, `${((totalKm2 / 651036) * 100).toFixed(1)}%`, 'of the province’s area');
      const list = el.appendChild(mk('div'));
      list.innerHTML = `<h3>The treaties</h3>
        <div class="legend" style="display:grid;gap:6px">${treaties.map((t, i) => `<span><i class="sw" style="background:${tColor(i)}"></i><b>${esc(t.name)}</b> · ${t.year}${t.end ? `–${t.end}` : ''}</span>`).join('')}</div>
        <h3>Largest reserves</h3>
        <ol class="rank-list">${reserves.slice(0, 8).map((r, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.name)}</span></span><span><div class="bar"><i style="width:${Math.round((r.km2 / reserves[0].km2) * 100)}%;background:${color}"></i></div><div class="bar-v">${fmt.int(r.km2)}</div></span></li>`).join('')}</ol>`;
      el.insertAdjacentHTML('beforeend', `
        <p class="note">Treaty boundaries here are Indigenous Services Canada’s depiction; First Nations’ understanding of their treaty territories, and of what the treaties promised, can differ. Reserve boundaries are the legal survey boundaries; parcels added through Treaty Land Entitlement keep being created, and some are not yet in the survey data. Areas are worked out here from the simplified shapes, so they are approximate. Saskatchewan’s total area is taken as 651,036 km².</p>
        ${sourceLine(T.source)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      const o: any = info.object;
      if (!o) return null;
      if (id === 'treaties-reserves') return `<b>${esc(o.r.name)}</b><br><span class="tk">Reserve land</span> <span class="tv">${o.r.km2 < 1 ? '<1' : fmt.int(o.r.km2)} km²</span>`;
      if (id === 'treaties-base') { const t = treaties[o.i]; return `<b>${esc(t.label)}</b><br><span class="tk">Numbered treaty area</span>`; }
      return null;
    },
  };
  return l;
}
