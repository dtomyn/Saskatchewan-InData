// DRINKING WATER — the drinking water advisories in effect today: precautionary advisories and boil water orders on
// waterworks the Water Security Agency regulates (town systems, rural pipelines, parks) and on the small public supplies
// the Saskatchewan Health Authority regulates (lodges, campgrounds, halls, restaurants), and the short- and long-term
// advisories on First Nations (Indigenous Services Canada). The provincial lists give no location, so each is placed by
// a place, park or lake named in it, and says so. A static, point-in-time layer.
import * as d3 from 'd3';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Data, WaterSite } from './data';
import { esc, safeUrl } from './html';
import { AtlasLayer, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layers';

export const WATER_COLOR = '#64b5f6';

export const WATER_KINDS: Record<WaterSite['k'], { label: string; short: string; color: string }> = {
  pdwa: { label: 'Precautionary drinking water advisory', short: 'Precautionary advisory', color: '#ffd166' },
  boil: { label: 'Boil water order or advisory', short: 'Boil water', color: '#ff7a3d' },
  dnc: { label: 'Do not consume (or do not use)', short: 'Do not consume', color: '#e05cff' },
};
const SRC: Record<WaterSite['src'], string> = {
  wsa: 'Water Security Agency or Ministry of Environment (waterworks)',
  sha: 'Saskatchewan Health Authority (public water supply)',
  isc: 'Indigenous Services Canada (First Nation)',
};

/** Days an advisory has been in effect on the day its list was published. */
export function waterDays(s: { d: string | null; src: WaterSite['src'] }, W: Data['water']): number | null {
  if (!s.d || !W) return null;
  const asOf = s.src === 'isc' ? W.stAsOf : W.provAsOf;
  const d = (Date.parse(asOf) - Date.parse(s.d)) / 864e5;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
}
export function lastedText(days: number | null) {
  if (days == null) return 'date not given';
  if (days < 1) return 'since today';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${(days / 365.25).toFixed(days < 3650 ? 1 : 0)} years`;
}
const LOC: Record<WaterSite['loc'], string> = {
  name: '',
  text: 'Placed at a place named in the listing, so the spot is approximate',
  lake: 'Placed at the centre of the lake named in the listing, so the spot is approximate',
  fn: 'Placed at the First Nation community',
};
export const placeNote = (s: WaterSite) => (s.loc === 'name' ? '' : s.loc === 'fn' ? LOC.fn : `${LOC[s.loc]}${s.at ? ` (${s.at})` : ''}`);

/** One place's advisories: on the town's own water system, and within nearKm of the town centre. */
export type PlaceWater = { sys: WaterSite[]; su: number; near: { s: WaterSite; km: number }[] };
export function placeWater(data: Data, key: string): PlaceWater | null {
  const W = data.water;
  const t = W?.towns[key];
  if (!W || !t) return null;
  return { sys: t.sys.map((i) => W.sites[i]), su: t.su ?? 0, near: t.nb.map(([i, km]) => ({ s: W.sites[i], km })) };
}

export function waterLayer(data: Data): AtlasLayer {
  const color = WATER_COLOR;
  const W = data.water;
  const sites = W?.sites ?? [];
  const places = new Map(data.munis.map((m) => [m.key, placeWater(data, m.key)]));
  const days = (s: WaterSite) => waterDays(s, W);
  const ramp = d3.scaleLinear<string>().domain([0, 3, 10]).range(['#3b4252', '#4f86c6', color]).interpolate(d3.interpolateRgb).clamp(true);
  // the dot grows with how long the advisory has lasted: a week, a year, a decade
  const radius = (s: WaterSite) => 1500 + Math.sqrt(days(s) ?? 0) * 110;

  const l: AtlasLayer = {
    id: 'water',
    name: 'Drinking water',
    icon: '🚰',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'advisories in effect today',
    available: sites.length > 0,
    unavailable: 'The drinking water advisories could not be downloaded when this copy of the data was built. Run <code>npm run data water</code>, then reload.',
    build({ selected, focusedId }) {
      const focused = focusedId === 'water';
      const out: Layer[] = [
        new ScatterplotLayer<WaterSite>({
          id: 'water-sites', data: sites, getPosition: (s) => [s.lon, s.lat],
          getRadius: radius, radiusMinPixels: focused ? 3.5 : 2.5, radiusMaxPixels: 22,
          getFillColor: (s) => rgb(WATER_KINDS[s.k].color, s.loc === 'name' || s.loc === 'fn' ? (focused ? 225 : 170) : (focused ? 150 : 110)),
          stroked: true, getLineColor: (s) => (s.lt || (days(s) ?? 0) >= 365 ? [255, 255, 255, 230] : [6, 10, 18, 220]),
          getLineWidth: (s) => (s.lt || (days(s) ?? 0) >= 365 ? 1.6 : 0.8), lineWidthUnits: 'pixels',
          pickable: true, parameters: { depthCompare: 'always' }, updateTriggers: { getFillColor: focused },
        } as any),
      ];
      if (focused) out.push(...townColumns('water', data.munis, (m) => places.get(m.key)?.near.length ?? null, (v) => 2500 + Math.sqrt(v) * 9000,
        (v, m) => (places.get(m.key)?.sys.length ? rgb(WATER_KINDS.boil.color, 235) : rgb(ramp(v), 235)), 0, selected));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Around the property · Water Security Agency · Saskatchewan Health Authority · Indigenous Services Canada')}
        <h2>Is the tap water safe to drink?</h2>`;
      if (!W) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const by = (k: WaterSite['k']) => sites.filter((s) => s.k === k).length + W.unplaced.filter((s) => s.k === k).length;
      const total = sites.length + W.unplaced.length;
      const fn = sites.filter((s) => s.src === 'isc');
      el.insertAdjacentHTML('beforeend', `<p class="lede">Every drinking water advisory in effect on ${esc(W.provAsOf)}: <b>${total}</b> in all. Dots are coloured by type and grow with how long the advisory has lasted; a white ring marks one in place for a year or more. Most are on small systems (a lodge, a campground, a hall, a rural pipeline), not a whole town. Columns count each place’s advisories within ${W.nearKm} km; orange columns are places whose own town water system has one.</p>
        <div class="callout" style="--c:${color}">Most acreages and farms draw water from a private well, which no advisory covers. Testing it is the owner’s job: the <a href="${esc(safeUrl(W.wellUrl) ?? '#')}" target="_blank" rel="noopener">Water Security Agency</a> advises a bacteria test (total coliforms, E. coli) twice a year, and any time the well may be contaminated.</div>`);
      const hero = heroStats(el, 4);
      hero(0, String(by('pdwa')), 'precautionary advisories (boil or avoid until cleared)');
      hero(1, String(by('boil')), 'boil water orders and advisories');
      hero(2, String(by('dnc')), 'do-not-consume advisories');
      hero(3, String(fn.length), `on First Nations (${fn.filter((s) => s.lt).length} long-term)`);
      const towns = data.munis.flatMap((m) => { const p = places.get(m.key); return p?.sys.length || p?.su ? [{ m, p: p! }] : []; });
      const longest = [...sites].sort((a, b) => (days(b) ?? -1) - (days(a) ?? -1)).slice(0, 10);
      const body = el.appendChild(mk('div'));
      body.innerHTML = `<h3>Town water systems under an advisory</h3>
        ${towns.length ? `<ol class="rank-list">${towns.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${r.p.sys.map((s) => `${esc(WATER_KINDS[s.k].short)} since ${esc(s.d ?? '?')}${s.part ? ` · ${esc(s.part)}` : ''}`).join('; ')}</span></span><span></span></li>`).join('')}</ol>` : '<p class="note">None of the atlas’s places has an advisory on its town water system today.</p>'}
        <h3>Longest in effect</h3>
        <ol class="rank-list water-long">${longest.map((s, i) => `<li data-i="${sites.indexOf(s)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(s.n)}</span><br><span class="rd">${esc(WATER_KINDS[s.k].short)} · since ${esc(s.d ?? '?')}${s.src === 'isc' && s.reg ? ` · ${esc(s.reg)}` : s.at ? ` · near ${esc(s.at)}` : ''}</span></span><span class="bar-v">${lastedText(days(s))}</span></li>`).join('')}</ol>`;
      body.addEventListener('click', (e) => {
        const li = (e.target as HTMLElement).closest('li');
        if (li?.dataset.key) window.dispatchEvent(new CustomEvent('atlas:town', { detail: li.dataset.key }));
        else if (li?.dataset.i) { const ev = l.describe!({ layer: { id: 'water-sites' }, object: sites[+li.dataset.i] } as any); if (ev) window.dispatchEvent(new CustomEvent('atlas:event', { detail: ev })); }
      });
      const unplacedBy = d3.rollups(W.unplaced, (v) => v.length, (s) => (s.src === 'wsa' ? 'Water Security Agency' : s.reg ? `${s.reg} health area` : 'no area given')).sort((a, b) => b[1] - a[1]);
      el.insertAdjacentHTML('beforeend', `
        <div class="legend">${(Object.keys(WATER_KINDS) as WaterSite['k'][]).map((k) => `<span><i class="sw" style="background:${WATER_KINDS[k].color}"></i>${WATER_KINDS[k].label}</span>`).join('')}<span><i class="sw" style="background:#9aa3b2;box-shadow:0 0 0 2px #fff"></i>in effect a year or more</span><span><i class="sw" style="background:#9aa3b2;opacity:.55"></i>approximate spot</span></div>
        <p class="note"><b>Where the dots are is partly inferred.</b> The province’s lists name each system but give no location. A dot sits at the town, village, park or reserve the system is named for; failing that, at a place named in the listing (a lodge “near Wollaston Lake”), or at the middle of the lake it names, which can be tens of km off. ${W.unplaced.length} advisories name nothing that can be found (mostly northern lodges, rural pipelines and private businesses) and are counted above but not mapped: ${unplacedBy.map(([n, c]) => `${esc(n)} ${c}`).join(', ')}.</p>
        <p class="note">A precautionary drinking water advisory (PDWA) is issued when something has gone wrong (a line break, low chlorine, a missed test) but no health threat is confirmed; an emergency boil water order (EBWO) when one is, such as E. coli. Both usually mean boil water before drinking; a do-not-consume advisory means boiling does not help. Some listings are years old: the province asks consumers to check with their water supplier, as a lifted advisory can stay listed. First Nations advisories are Indigenous Services Canada’s (short-term as of ${esc(W.stAsOf)}).</p>
        ${sourceLine(`${W.source}. ${W.licence}. Lists published ${W.provAsOf}; built ${W.asOf}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('water')) return null;
      if (id === 'water-sites') {
        const s = info.object as WaterSite;
        const note = placeNote(s);
        return `<b>${esc(s.n)}</b><br><span class="tk">${esc(WATER_KINDS[s.k].label)}${s.lt ? ' · long-term' : ''}</span><br><span class="tk">Since</span> <span class="tv">${esc(s.d ?? 'n/a')} (${lastedText(days(s))})</span>${s.why ? `<br><span class="tk">${esc(s.why)}</span>` : ''}${s.part ? `<br><span class="tk">Affects: ${esc(s.part)}</span>` : ''}${note ? `<br><span class="tk">${esc(note)}</span>` : ''}`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const p = places.get(o.m.key);
      if (!p) return null;
      return `<b>${esc(o.m.name)}</b><br><span class="tk">Town water system</span> <span class="tv">${p.sys.length ? `${esc(WATER_KINDS[p.sys[0].k].short)}${p.sys[0].part ? ' (part)' : ''}` : 'no advisory'}</span><br><span class="tk">Advisories within ${W?.nearKm} km</span> <span class="tv">${p.near.length}</span><br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      if (info.layer?.id !== 'water-sites') return null;
      const s = info.object as WaterSite;
      const d = days(s);
      const note = placeNote(s);
      const src = s.src === 'wsa' ? W?.wsaUrl : s.src === 'sha' ? W?.shaUrl : s.lt ? W?.iscLtUrl : W?.iscUrl;
      return {
        layer: 'water', kind: WATER_KINDS[s.k].label, lon: s.lon, lat: s.lat, zoom: 10, title: s.n,
        body: `${s.t ? `${s.t}. ` : ''}${SRC[s.src]}${s.src === 'sha' && s.reg ? `, ${s.reg} area` : s.src === 'isc' && s.reg ? `, ${s.reg}` : ''}.${s.why ? ` Reason given: ${s.why}.` : ''}${s.part ? ` Affects ${s.part}.` : ''}${s.pop ? ` Serves ${s.pop}.` : ''}${note ? ` ${note}.` : ''}`,
        stats: [{ v: lastedText(d), l: `in effect, since ${s.d ?? 'n/a'}` }, ...(s.lt ? [{ v: 'Long-term', l: 'in place more than a year (ISC)' }] : [])],
        sources: [{ label: s.src === 'isc' ? 'Indigenous Services Canada: drinking water advisories' : 'Government of Saskatchewan: water advisories in effect', url: safeUrl(src) ?? 'https://www.saskatchewan.ca/' }],
      };
    },
  };
  return l;
}
