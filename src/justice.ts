// Courts & police: where Saskatchewan's courthouses, police detachments and correctional centres are (OpenStreetMap),
// and how long the drive is from each place to its nearest courthouse and police station. A static layer.
import * as d3 from 'd3';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { JusticeSite, Trip, fmt, lowerBound } from './data';
import { esc, safeUrl } from './html';
import { rampCSS } from './charts';
import { ADDITIVE, AtlasLayer, NO_DEPTH, dashExt, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layers';
import { Affected, CLOSED_COLOR, SCENARIO_CAVEAT, affectedTowns, closedSites, isClosed, scenarioBox, scenarioOn, scenarioTrip, scenarioVersion, setClosed } from './scenario';
import type { Data } from './data';

export const JUSTICE_KINDS = {
  court: { label: 'Courthouse', plural: 'courthouses', color: '#ffd166' },
  police: { label: 'Police', plural: 'police stations and detachments', color: '#5aa9ff' },
  corrections: { label: 'Corrections', plural: 'correctional centres', color: '#c084fc' },
} as const;
type Kind = keyof typeof JUSTICE_KINDS;

/** Police mapped in OpenStreetMap this close to the centre count as in town. */
const IN_TOWN_KM = 6;

/**
 * A place's nearest site of a kind by road: the pipeline ranked them fastest first. OpenStreetMap misses many police
 * buildings in Saskatchewan, so a place that Statistics Canada lists with its own municipal police service (a city force
 * or a municipal RCMP detachment) counts as having police in town when nothing is mapped near its centre (`inferred`).
 */
export function nearestJustice(data: Data, key: string, kind: 'court' | 'police'): (Trip & { site: JusticeSite; inferred?: boolean }) | null {
  const J = data.justice;
  const t = J?.towns[key]?.[kind]?.[0];
  const svc = data.crime?.service?.[key];
  // only a service still reporting: one that stopped (merged into a neighbour's detachment) says nothing about today
  const last = Math.max(0, ...Object.keys(data.crime?.munis[key]?.csi ?? {}).map(Number));
  const latest = Math.max(0, ...Object.keys(data.crime?.prov.csi ?? {}).map(Number));
  if (kind === 'police' && svc?.level === 'municipal' && last >= latest - 3 && (!t || t.km > IN_TOWN_KM)) {
    const m = data.munis.find((x) => x.key === key)!;
    return { f: -1, min: 0, km: 0, inferred: true, site: { kind: 'police', name: svc.name, op: svc.rcmp ? 'RCMP' : null, rcmp: svc.rcmp, city: m.name, lon: m.lon, lat: m.lat, osm: '' } };
  }
  if (!J || !t) return null;
  return { ...t, site: J.sites[t.f] };
}

export function justiceLayer(data: Data): AtlasLayer {
  const color = '#ffd166';
  const J = data.justice;
  const sites: JusticeSite[] = J?.sites ?? [];
  const routed = !!J && J.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  let target: 'court' | 'police' = 'court';
  const courtTrips = (key: string) => J?.towns[key]?.court;
  // under a closure scenario (src/scenario.ts) a place's courthouse is the nearest open one the stage kept; `beyond` when
  // every kept one is closed. Police are routed to one station only, so they never take part.
  const scCourt = (key: string): (Trip & { site: JusticeSite; beyond?: boolean }) | null => {
    const { trip, beyond } = scenarioTrip('court', courtTrips(key));
    const t = trip ?? beyond;
    return t ? { ...t, site: sites[t.f], ...(beyond ? { beyond: true } : {}) } : null;
  };
  const nearestNow = (key: string, k: 'court' | 'police'): (Trip & { site: JusticeSite; inferred?: boolean; beyond?: boolean }) | null =>
    k === 'court' && scenarioOn('court') ? scCourt(key) : nearestJustice(data, key, k);
  const val = (key: string, k = target) => { const n = nearestNow(key, k); return n ? n.min ?? n.km : null; };
  const tv = (t: Trip) => t.min ?? t.km;
  const addText = (a: Affected) => (a.added == null ? `more than +${Math.round(tv(a.beyond!) - tv(a.before))} ${unit}` : `+${Math.round(a.added)} ${unit}`);
  const ramp = d3.scaleLinear<string>().domain([5, 45, 150]).range(['#fff6d6', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 3600 + Math.min(v, 300) * 600;
  const count = (k: Kind) => sites.filter((s) => s.kind === k).length;

  type Row = { t: Trip; kind: 'court' | 'police'; closed?: boolean; label: boolean; path: [number, number][]; cum: number[] };
  const row = (m: { lon: number; lat: number }, t: Trip, kind: 'court' | 'police', label: boolean, closed = false): Row => {
    const s = sites[t.f];
    const path: [number, number][] = t.line ?? [[m.lon, m.lat], [s.lon, s.lat]];
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], (path[k][1] - path[k - 1][1]) * 1.5));
    return { t, kind, closed, label, path, cum };
  };
  let memoKey: string | null = null;
  let memoRows: Row[] = [];
  const rowsFor = (key: string | null) => {
    const mk = `${key}|${scenarioVersion}`;
    if (mk === memoKey) return memoRows;
    memoKey = mk;
    const m = data.munis.find((x) => x.key === key);
    const sc = scenarioOn('court');
    if (!m && sc && J) {
      // a closure and nothing hovered: every affected place's closed and new route
      memoRows = affectedTowns('court', data.munis, courtTrips).flatMap((a) => [row(a.m, a.before, 'court', false, true), ...(a.after ? [row(a.m, a.after, 'court', false)] : [])]);
      return memoRows;
    }
    memoRows = !m || !J ? [] : (['court', 'police'] as const).flatMap((kind) => {
      if (kind === 'court' && sc) {
        const first = courtTrips(m.key)?.[0], n = scCourt(m.key);
        return [...(first && isClosed('court', first.f) ? [row(m, first, 'court', true, true)] : []), ...(n && !n.beyond ? [row(m, n, 'court', true)] : [])];
      }
      return (nearestJustice(data, m.key, kind)?.inferred ? [] : J.towns[m.key]?.[kind] ?? []).slice(0, 1).map((t) => row(m, t, kind, true));
    });
    return memoRows;
  };
  const along = (r: Row, q: number): [number, number] => {
    const d = q * r.cum[r.cum.length - 1];
    const k = Math.max(1, lowerBound(r.cum, d, (c) => c));
    if (k >= r.path.length) return r.path[r.path.length - 1];
    const f = (d - r.cum[k - 1]) / (r.cum[k] - r.cum[k - 1] || 1);
    return [r.path[k - 1][0] + (r.path[k][0] - r.path[k - 1][0]) * f, r.path[k - 1][1] + (r.path[k][1] - r.path[k - 1][1]) * f];
  };
  const trip = (t: Trip & { inferred?: boolean }) => (t.inferred ? 'in town' : t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);

  const l: AtlasLayer = {
    id: 'justice',
    name: 'Courts & police',
    icon: '⚖',
    color,
    range: [2025, 2025.99],
    static: true,
    period: 'as mapped today',
    available: sites.length > 0,
    unavailable: 'OpenStreetMap’s Overpass service was busy when this copy of the data was built. Run <code>npm run data justice</code>, then reload.',
    build({ selected, hovered, focusedId, clock }) {
      const focused = focusedId === 'justice';
      const out: Layer[] = [];
      const sc = scenarioOn('court');
      if (focused) out.push(...townColumns('justice', data.munis, (m) => val(m.key), height, (v, m) => (target === 'court' && sc && scCourt(m.key)?.beyond ? rgb(CLOSED_COLOR, 235) : rgb(ramp(v), 235)), scenarioVersion, `${selected}${target}`));
      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        const q = (clock % 2600) / 2600;
        out.push(
          new PathLayer<Row>({
            id: 'justice-trips', data: rows, getPath: (r) => r.path,
            getColor: (r) => (r.closed ? rgb(CLOSED_COLOR, 210) : rgb(JUSTICE_KINDS[r.kind].color, 230)), getWidth: (r) => (r.label ? 3.5 : 2.5), widthUnits: 'pixels', capRounded: true, jointRounded: true,
            extensions: dashExt, getDashArray: (r) => (r.closed ? [4, 3] : [0, 0]), dashJustified: true,
            updateTriggers: { getColor: scenarioVersion, getDashArray: scenarioVersion, getWidth: scenarioVersion },
            parameters: NO_DEPTH,
          } as any),
          new ScatterplotLayer<Row>({
            id: 'justice-pulse', data: rows.filter((r) => !r.closed), getPosition: (r) => along(r, q), getRadius: 2600, radiusMinPixels: 3,
            getFillColor: (r) => rgb(JUSTICE_KINDS[r.kind].color, 240), updateTriggers: { getPosition: q }, parameters: ADDITIVE,
          }),
          new TextLayer<Row>({
            id: 'justice-mins', data: rows.filter((r) => r.label), getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${r.closed ? 'closed · ' : ''}${trip(r.t)}\n${sites[r.t.f].name}`, getSize: 12, getColor: (r) => (r.closed ? rgb(CLOSED_COLOR) : [255, 255, 255, 255]),
            updateTriggers: { getText: scenarioVersion, getColor: scenarioVersion }, getPixelOffset: [0, -14], getAlignmentBaseline: 'bottom',
            fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }
      const p = (clock % 2400) / 2400;
      out.push(
        new ScatterplotLayer<JusticeSite>({
          id: 'justice-halo', data: sites.filter((s, i) => s.kind === 'court' && !isClosed('court', i)), getPosition: (s) => [s.lon, s.lat],
          getRadius: 4000 + p * 14000, radiusMinPixels: 5, stroked: true, filled: false, lineWidthMinPixels: 1.5,
          getLineColor: rgb(JUSTICE_KINDS.court.color, 200 * (1 - p)), updateTriggers: { getRadius: p, getLineColor: p }, parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<JusticeSite>({
          id: 'justice-sites', data: sites, getPosition: (s) => [s.lon, s.lat],
          getRadius: (s) => (s.kind === 'court' ? 3400 : 2400), radiusMinPixels: (focused ? 4.5 : 3.5), radiusMaxPixels: 12,
          getFillColor: (s, { index }) => (isClosed('court', index) ? rgb(CLOSED_COLOR) : s.kind === 'court' ? [255, 255, 255, 255] : rgb(JUSTICE_KINDS[s.kind].color, 235)),
          updateTriggers: { getFillColor: scenarioVersion },
          stroked: true, getLineColor: (s) => (s.kind === 'court' ? rgb(JUSTICE_KINDS.court.color) : [6, 10, 18, 255]), lineWidthMinPixels: (s: any) => (s.kind === 'court' ? 2.5 : 1),
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
      );
      if (sc)
        out.push(new TextLayer<{ f: number }>({
          id: 'justice-closed', data: closedSites('court'), getPosition: (c) => [sites[c.f].lon, sites[c.f].lat], getText: () => 'closed (scenario)',
          getSize: 11, getColor: rgb(CLOSED_COLOR), getPixelOffset: [0, 16], getAlignmentBaseline: 'top', fontFamily: 'Inter, sans-serif', fontWeight: 700,
          outlineWidth: 3, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true }, updateTriggers: { getPosition: scenarioVersion }, parameters: { depthCompare: 'always' },
        } as any));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Justice · access to courts and police')}
        <h2>How far to court?</h2>`;
      if (!J) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Every courthouse, police station and correctional centre mapped in OpenStreetMap across Saskatchewan. Column height shows the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each town centre to its nearest courthouse or police station. Hover or click a town to see both routes.</p>
        <div class="chips" style="margin:2px 0 10px"><button class="chip on" data-k="court" style="--c:${color}">Drive to court</button><button class="chip" data-k="police" style="--c:${color}">Drive to police</button></div>`);
      if (scenarioOn('court')) el.appendChild(scenarioBox('court', data.munis, courtTrips, (f) => sites[f]?.name ?? '', addText, (t) => trip(t)));
      const hero = heroStats(el, 4);
      hero(0, String(count('court')), 'courthouses');
      hero(1, String(count('police')), 'police stations & detachments');
      hero(2, String(count('corrections')), 'correctional centres');
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === target));
        const rows = data.munis.flatMap((m) => { const v = val(m.key), n = nearestNow(m.key, target); return v != null && n ? [{ m, v, n }] : []; }).sort((a, b) => a.v - b.v);
        const sc = target === 'court' && scenarioOn('court');
        hero(3, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, `median drive to ${target === 'court' ? 'a courthouse' : 'police'}`);
        const max = d3.max(rows, (r) => r.v) ?? 1;
        body.innerHTML = `<h3>${routed ? 'Drive' : 'Distance'} to the nearest ${target === 'court' ? 'courthouse' : 'police station'}${sc ? ' <span class="sc-tag">scenario</span>' : ''}</h3>
          <ol class="rank-list">${rows.map((r, i) => `<li data-key="${r.m.key}"><span class="rk">${i + 1}</span><span><span class="nm">${r.m.name}</span><br><span class="rd">${esc(r.n.site.name)}${r.n.inferred ? ' · based in town (Statistics Canada police-service list)' : `${r.n.site.city ? ` · ${esc(r.n.site.city)}` : ''} · ${Math.round(r.n.km)} km`}${r.n.beyond ? ' · <b class="sc-closed">every courthouse kept for it is closed</b>' : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${r.n.beyond ? CLOSED_COLOR : ramp(r.v)}"></i></div><div class="bar-v">${r.n.beyond ? '>' : ''}${Math.round(r.v)}</div></span></li>`).join('')}</ol>
          <div class="ramp" style="background:${rampCSS((t) => ramp(5 + t * 145))}"></div>
          <div class="ramp-labels"><span>5 ${unit}</span><span>45</span><span>150+ ${unit}</span></div>`;
      };
      body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as 'court' | 'police' | undefined;
        if (k) { target = k; draw(); }
      });
      draw();
      const corr = sites.filter((s) => s.kind === 'corrections');
      el.insertAdjacentHTML('beforeend', `
        <div class="legend"><span><i class="sw" style="background:#fff;box-shadow:0 0 0 2px ${JUSTICE_KINDS.court.color}"></i>courthouse</span><span><i class="sw" style="background:${JUSTICE_KINDS.police.color}"></i>police</span><span><i class="sw" style="background:${JUSTICE_KINDS.corrections.color}"></i>corrections</span></div>
        <h3>What if a courthouse closed?</h3>
        <p class="note" style="margin-top:0">Pick a courthouse (or click one on the map) to see which towns would drive farther to court. Police stations can’t be closed here: the data routes each town to its nearest one only.</p>
        <select class="sc-pick" aria-label="Close a courthouse in a scenario"><option value="">Close a courthouse…</option>${sites.map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'court').sort((a, b) => a.s.name.localeCompare(b.s.name)).map((x) => `<option value="${x.i}"${isClosed('court', x.i) ? ' disabled' : ''}>${esc(x.s.name)}${x.s.city ? ` · ${esc(x.s.city)}` : ''}</option>`).join('')}</select>
        ${corr.length ? `<h3>Correctional facilities on the map</h3><p class="note" style="margin-top:0">${corr.map((s) => `<b>${esc(s.name)}</b>${s.city ? ` (${esc(s.city)})` : ''}`).join(' · ')}</p>` : ''}
        <p class="note">OpenStreetMap is mapped by volunteers, so a courthouse or detachment can be missing or out of date. Saskatchewan’s Provincial Court also sits on circuit in many smaller communities, often in a hall or band office that isn’t mapped as a courthouse, so a town’s real trip to its next court date can be shorter than shown. ${routed ? 'Drive times are the OSRM router’s free-flow estimate on OpenStreetMap roads; winter roads, ferries and fly-in communities in the far north are not modelled.' : 'No routing service was reachable, so these are straight-line distances.'}</p>
        ${sourceLine(`${J.source}, ${J.asOf}. ${J.routingSource ?? 'Straight-line distances.'}`)}`);
      el.querySelector<HTMLSelectElement>('.sc-pick')!.addEventListener('change', (e) => {
        const i = +(e.target as HTMLSelectElement).value;
        if (sites[i]) { target = 'court'; setClosed('court', i, sites[i].name, true); }
      });
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('justice')) return null;
      if (id === 'justice-sites') {
        const s = info.object as JusticeSite;
        const shut = isClosed('court', info.index);
        return `<b>${esc(s.name)}</b><br><span class="tk">${JUSTICE_KINDS[s.kind].label}${s.city ? ` · ${esc(s.city)}` : ''}</span>${s.op ? `<br><span class="tk">Run by</span> <span class="tv">${esc(s.op)}</span>` : ''}${shut ? '<br><span class="tk sc-closed">Closed in your scenario</span>' : ''}${s.kind === 'court' ? `<br><span class="tk tk-click">Click: ${shut ? 'reopen it' : 'what if this closed?'}</span>` : ''}`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const c = nearestNow(o.m.key, 'court'), p = nearestJustice(data, o.m.key, 'police');
      return `<b>${o.m.name}</b>${c ? `<br><span class="tk">Nearest ${scenarioOn('court') ? 'open courthouse (scenario)' : 'courthouse'}</span> <span class="tv">${c.beyond ? 'more than ' : ''}${trip(c)}</span>` : ''}${p ? `<br><span class="tk">Nearest police</span> <span class="tv">${trip(p)}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      if (info.layer?.id !== 'justice-sites') return null;
      const s = info.object as JusticeSite;
      const i = info.index;
      const near = data.munis.map((m) => ({ m, n: nearestJustice(data, m.key, s.kind === 'court' ? 'court' : 'police') })).filter((r) => r.n && r.n.site === s);
      const shut = isClosed('court', i);
      const web = s.web ? safeUrl(s.web) : null;
      return {
        layer: 'justice', kind: JUSTICE_KINDS[s.kind].label, lon: s.lon, lat: s.lat, zoom: 10,
        title: s.name,
        body: `${JUSTICE_KINDS[s.kind].label}${s.city ? ` in ${s.city}` : ''}${s.op ? `, run by ${s.op}` : ''}.${s.kind !== 'corrections' ? ` It is the nearest ${s.kind === 'court' ? 'courthouse' : 'police station'} by road for ${near.length} of the atlas’s places${near.length ? `: ${near.map((r) => r.m.name).join(', ')}` : ''}.` : ''}`,
        stats: near.length ? [{ v: String(near.length), l: 'places it is nearest to' }, { v: `${Math.round(d3.max(near, (r) => r.n!.min ?? r.n!.km) ?? 0)} ${unit}`, l: 'longest of those drives' }] : [],
        sources: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${s.osm}` }, ...(web ? [{ label: 'Website', url: web }] : [])],
        detail: s.kind === 'court' ? (el) => {
          el.insertAdjacentHTML('beforeend', `<button class="sc-btn" style="--c:${CLOSED_COLOR}">${shut ? '↺ Reopen it' : scenarioOn('court') ? '✕ Close this one too' : '✕ What if this closed?'}</button><p class="note">${esc(SCENARIO_CAVEAT)}</p>`);
          el.querySelector('.sc-btn')!.addEventListener('click', () => { target = 'court'; setClosed('court', i, s.name, !shut); });
        } : undefined,
      };
    },
  };
  return l;
}

export const fmtTrip = (t: { min: number | null; km: number }) => (t.min != null ? `${t.min} min` : `${fmt.int(t.km)} km`);
