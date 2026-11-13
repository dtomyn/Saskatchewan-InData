// DAILY NEEDS — whether a place has the everyday services a household runs on: a grocery store, a pharmacy, a school, a
// bank or credit union, a gas station, a library, a post office and a clinic or doctor's office. Each is counted from
// OpenStreetMap inside the place's municipal limits (its 2021 census subdivision) or just outside them. A static layer.
import * as d3 from 'd3';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { km } from './data';
import type { Data, NeedSite } from './data';
import { esc } from './html';
import { rampCSS } from './charts';
import { AtlasLayer, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layer-kit';
import { link } from './report-kit';

/** The eight needs, in the order the data stage writes them (`Needs.kinds`). */
export const NEEDS = [
  { id: 'grocery', label: 'Grocery store', plural: 'grocery stores', color: '#7ee081' },
  { id: 'pharmacy', label: 'Pharmacy', plural: 'pharmacies', color: '#ff7aa8' },
  { id: 'school', label: 'School', plural: 'schools', color: '#ffd166' },
  { id: 'bank', label: 'Bank or credit union', plural: 'banks and credit unions', color: '#5aa9ff' },
  { id: 'fuel', label: 'Gas station', plural: 'gas stations', color: '#ff9f43' },
  { id: 'library', label: 'Library', plural: 'libraries', color: '#c084fc' },
  { id: 'post', label: 'Post office', plural: 'post offices', color: '#ff5d5d' },
  { id: 'clinic', label: 'Clinic or doctor', plural: 'clinics and doctors’ offices', color: '#4ee6d6' },
] as const;
export type NeedId = (typeof NEEDS)[number]['id'];

/** One place's daily needs: how many of each kind count for it, keyed by need id, and how it was counted. */
export type PlaceNeeds = { counts: Record<NeedId, number>; met: number; of: number; how: 'csd' | 'radius'; csd?: string; r?: number };

export function placeNeeds(data: Data, key: string): PlaceNeeds | null {
  const N = data.needs;
  const t = N?.towns[key];
  if (!N || !t) return null;
  const counts = Object.fromEntries(NEEDS.map((n) => [n.id, t.n[N.kinds.indexOf(n.id)] ?? 0])) as Record<NeedId, number>;
  return { counts, met: NEEDS.filter((n) => counts[n.id] > 0).length, of: NEEDS.length, how: t.how, csd: t.csd, r: t.r };
}

/** Where a place's counts come from, in a few words. */
export const countedWhere = (p: PlaceNeeds, slackKm: number) =>
  p.how === 'csd' ? `inside town limits (${esc(p.csd ?? 'census subdivision')}) or within ${slackKm} km of them` : `within ${p.r} km of the town centre (no census subdivision matched)`;

export function needsLayer(data: Data): AtlasLayer {
  const color = '#2ec4b6';
  const N = data.needs;
  const sites: NeedSite[] = N?.sites ?? [];
  const kindOf = (s: NeedSite) => NEEDS.find((n) => n.id === N?.kinds[s[2]]) ?? NEEDS[0];
  let target: NeedId | 'all' = 'all';
  const val = (key: string) => {
    const p = placeNeeds(data, key);
    return p ? (target === 'all' ? p.met : p.counts[target]) : null;
  };
  const metRamp = d3.scaleLinear<string>().domain([1, 4.5, 8]).range(['#ff5d5d', '#ffd166', color]).interpolate(d3.interpolateRgb).clamp(true);
  const countRamp = (id: NeedId) => d3.scaleLinear<string>().domain([0, 1, 6]).range(['#5a2030', NEEDS.find((n) => n.id === id)!.color, '#ffffff']).interpolate(d3.interpolateRgb).clamp(true);
  const ring = (rings: [number, number][][][]) => rings.flatMap((p) => p.map((r) => r));
  // which place a site counts for: the one whose limits it is inside, else (a site just outside them) the nearest centre
  const countsFor = (s: NeedSite) => data.munis.find((m) => (N?.areas[m.key] ?? []).some((p) => inRing(s[0], s[1], p[0])))
    ?? d3.least(data.munis, (m) => km(m.lon, m.lat, s[0], s[1]));

  const l: AtlasLayer = {
    id: 'needs',
    name: 'Daily needs',
    icon: '🛒',
    color,
    range: [2025, 2025.99],
    static: true,
    period: 'as mapped today',
    available: sites.length > 0,
    unavailable: 'OpenStreetMap’s Overpass service was busy when this copy of the data was built. Run <code>npm run data needs</code>, then reload.',
    build({ selected, focusedId }) {
      const focused = focusedId === 'needs';
      const out: Layer[] = [];
      const shown = target === 'all' ? sites : sites.filter((s) => N!.kinds[s[2]] === target);
      if (focused) {
        const areas = Object.entries(N?.areas ?? {}).flatMap(([k, a]) => ring(a).map((path) => ({ k, path })));
        out.push(new PathLayer<{ k: string; path: [number, number][] }>({
          id: 'needs-areas-base', data: areas, getPath: (d) => d.path,
          getColor: (d) => rgb(d.k === selected ? '#ffffff' : color, d.k === selected ? 230 : 150), getWidth: 1.5, widthUnits: 'pixels', widthMinPixels: 1,
          updateTriggers: { getColor: selected },
        } as any));
        const height = target === 'all' ? (v: number) => 2500 + v * 7500 : (v: number) => 2500 + Math.min(v, 60) * 2200;
        const colorOf = target === 'all' ? (v: number) => rgb(metRamp(v), 235) : ((r) => (v: number) => rgb(r(v), 235))(countRamp(target));
        out.push(...townColumns('needs', data.munis, (m) => val(m.key), height, colorOf, 0, `${selected}${target}`));
      }
      out.push(new ScatterplotLayer<NeedSite>({
        id: 'needs-sites', data: shown, getPosition: (s) => [s[0], s[1]],
        getRadius: 180, radiusMinPixels: focused ? 3 : 2.2, radiusMaxPixels: 9,
        getFillColor: (s) => rgb(kindOf(s).color, 235), stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 0.8,
        pickable: true, parameters: { depthCompare: 'always' }, updateTriggers: { getFillColor: target },
      } as any));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Places & living · OpenStreetMap')}
        <h2>Is there a grocery store in town?</h2>`;
      if (!N) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const rows = data.munis.flatMap((m) => { const p = placeNeeds(data, m.key); return p ? [{ m, p }] : []; });
      el.insertAdjacentHTML('beforeend', `<p class="lede">Eight everyday services, counted inside each place’s town limits (or within ${N.slackKm} km of them) from OpenStreetMap. Column height shows how many of the eight a place has; pick one to see how many of that kind there are. Every counted site is a dot on the map.</p>
        <div class="chips" style="margin:2px 0 10px"><button class="chip on" data-k="all" style="--c:${color}">All eight</button>${NEEDS.map((n) => `<button class="chip" data-k="${n.id}" style="--c:${n.color}">${n.label}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      hero(0, String(rows.filter((r) => r.p.met === NEEDS.length).length), `of ${rows.length} places have all eight`);
      hero(1, `${d3.median(rows, (r) => r.p.met) ?? 0} of 8`, 'needs met in the median place');
      hero(2, String(rows.filter((r) => !r.p.counts.grocery).length), 'places with no grocery store mapped');
      hero(3, String(sites.length), 'sites counted');
      const body = el.appendChild(mk('div'));
      const strip = (p: (typeof rows)[number]['p']) => `<span class="needs-strip">${NEEDS.map((n) => `<span class="${p.counts[n.id] ? '' : 'no'}" style="color:${p.counts[n.id] ? n.color : ''}" title="${n.label}: ${p.counts[n.id]}">●</span>`).join('')}</span>`;
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === target));
        const ranked = rows.map((r) => ({ ...r, v: target === 'all' ? r.p.met : r.p.counts[target] })).sort((a, b) => b.v - a.v || b.p.met - a.p.met || a.m.name.localeCompare(b.m.name));
        const max = d3.max(ranked, (r) => r.v) || 1;
        const n = target === 'all' ? null : NEEDS.find((x) => x.id === target)!;
        const barColor = (v: number) => (n ? countRamp(n.id)(v) : metRamp(v));
        body.innerHTML = `<h3>${n ? `${n.label}: how many in town` : 'Needs met, of eight'}</h3>
          <ol class="rank-list">${ranked.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${strip(r.p)}${r.p.met < NEEDS.length ? ` · no ${NEEDS.filter((x) => !r.p.counts[x.id]).map((x) => x.label.toLowerCase()).join(', ')}` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${barColor(r.v)}"></i></div><div class="bar-v">${r.v}</div></span></li>`).join('')}</ol>
          ${n ? '' : `<div class="ramp" style="background:${rampCSS((t) => metRamp(1 + t * 7))}"></div><div class="ramp-labels"><span>1 need</span><span>4–5</span><span>all 8</span></div>`}`;
      };
      body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as NeedId | 'all' | undefined;
        if (k) { target = k; draw(); }
      });
      draw();
      el.insertAdjacentHTML('beforeend', `
        <div class="legend">${NEEDS.map((n) => `<span><i class="sw" style="background:${n.color}"></i>${n.label}</span>`).join('')}</div>
        <p class="note">Town limits are each place’s 2021 census subdivision (the city, town or northern village itself, not the rural municipality around it); a site up to ${N.slackKm} km outside them still counts, for the highway gas station or the school just past the edge of town. Grocery means a supermarket or grocery store (not a convenience store or a general store); a bank includes credit unions; a clinic includes doctors’ offices but not hospitals or health centres, which are on the Hospital access layer.</p>
        <p class="note">OpenStreetMap is mapped by volunteers and its coverage is uneven: cities are well mapped, but a small town’s credit union, library or doctor’s office is often missing, so a ✗ can mean “not mapped” rather than “not there”. Fixing it on <a href="https://www.openstreetmap.org" target="_blank" rel="noopener">openstreetmap.org</a> fixes it here on the next data build.</p>
        ${sourceLine(`${N.source}, ${N.asOf}. ${N.areaSource}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('needs')) return null;
      if (id === 'needs-sites') {
        const s = info.object as NeedSite;
        const k = kindOf(s);
        const town = countsFor(s);
        return `<b>${esc(s[3] ?? k.label)}</b><br><span class="tk">${k.label}${town ? ` · counts for ${esc(town.name)}` : ''}</span>`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const p = placeNeeds(data, o.m.key);
      if (!p) return null;
      const missing = NEEDS.filter((n) => !p.counts[n.id]).map((n) => n.label.toLowerCase());
      return `<b>${esc(o.m.name)}</b><br><span class="tk">Daily needs met</span> <span class="tv">${p.met} of ${p.of}</span>${target !== 'all' ? `<br><span class="tk">${NEEDS.find((n) => n.id === target)!.plural}</span> <span class="tv">${p.counts[target]}</span>` : ''}${missing.length ? `<br><span class="tk">None mapped: ${missing.join(', ')}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      if (info.layer?.id !== 'needs-sites') return null;
      const s = info.object as NeedSite;
      const k = kindOf(s);
      const town = countsFor(s);
      const p = town ? placeNeeds(data, town.key) : null;
      return {
        layer: 'needs', kind: k.label, lon: s[0], lat: s[1], zoom: 13,
        title: s[3] ?? k.label,
        body: `${k.label} mapped in OpenStreetMap${town ? `, counted for ${town.name}${p ? `, which has ${p.counts[k.id]} ${p.counts[k.id] === 1 ? k.label.toLowerCase() : k.plural} and ${p.met} of the ${p.of} daily needs` : ''}` : ''}.`,
        stats: p ? [{ v: `${p.met} of ${p.of}`, l: `daily needs in ${town!.name}` }, { v: String(p.counts[k.id]), l: `${k.plural} counted there` }] : [],
        sources: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[s[4][0]] ?? 'node'}/${s[4].slice(1)}` }],
      };
    },
  };
  return l;

  function inRing(lon: number, lat: number, r: [number, number][]) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
}

// ---- the Town Report section (src/panels.ts places it)

/** Daily needs: a ✓/✗ row per everyday service mapped in OpenStreetMap inside (or just outside) the town limits. */
export function dailyNeeds(p: PlaceNeeds, slackKm: number) {
  return `<h3>Daily needs · ${p.met} of ${p.of} in town</h3>
    <div class="needs-list">${NEEDS.map((n) => {
      const c = p.counts[n.id];
      return `<div class="nd ${c ? 'yes' : 'no'}" style="--c:${n.color}"><b>${c ? '✓' : '✗'}</b>${n.label}<small>${c || 'none mapped'}</small></div>`;
    }).join('')}</div>
    <p class="note" style="margin-top:6px">Counted ${countedWhere(p, slackKm)} from OpenStreetMap. Small towns are unevenly mapped, so a ✗ can mean not mapped rather than not there.</p>
    <div class="tr-falls" style="margin-top:8px">${link('needs', '🛒 Daily needs on the map')}</div>`;
}
