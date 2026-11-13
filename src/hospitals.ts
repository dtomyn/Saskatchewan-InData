// HOSPITAL ACCESS — a static layer: where emergency care is today, and how long the drive takes
import * as d3 from 'd3';
import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { Data, Facility, Trip, Muni, lowerBound } from './data';
import { AtlasLayer, mk, RGBA, rgb, townColumns, dashExt, NO_DEPTH, ADDITIVE, kicker, heroStats, sourceLine } from './layer-kit';
import { scenarioOn, scenarioTrip, Affected, scenarioVersion, isClosed, affectedTowns, CLOSED_COLOR, closedSites, scenarioBox, setClosed, SCENARIO_CAVEAT } from './scenario';
import { esc } from './html';
import { rampCSS } from './charts';

export function hospitalsLayer(data: Data): AtlasLayer {
  const color = '#6c8cff';
  const H = data.hospitals;
  const fac: Facility[] = H?.facilities ?? [];
  const routed = !!H && H.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  const tripsOf = (key: string) => H?.towns[key];
  const tv = (t: Trip) => t.min ?? t.km;
  // a place's trip to its nearest hospital: the real one, or under a closure scenario (src/scenario.ts) the nearest open
  // one the stage kept; `beyond` when every kept hospital is closed (the drive is then longer than the last kept one)
  const nearest = (key: string): { t: Trip; beyond: boolean } | null => {
    const trips = tripsOf(key);
    if (!trips?.length) return null;
    if (!scenarioOn('hospitals')) return { t: trips[0], beyond: false };
    const { trip, beyond } = scenarioTrip('hospitals', trips);
    return trip ? { t: trip, beyond: false } : beyond ? { t: beyond, beyond: true } : null;
  };
  const val = (key: string) => { const n = nearest(key); return n ? tv(n.t) : null; };
  const ramp = d3.scaleLinear<string>().domain([5, 45, 150]).range(['#e3f1ff', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 3600 + Math.min(v, 300) * 600;
  const edColor = (f: Facility) => (f.hospital ? color : '#7d879c');
  const tripText = (t: Trip) => (t.min != null ? `${t.min} min` : `${Math.round(t.km)} km (straight line)`);
  const addText = (a: Affected) => (a.added == null ? `more than +${Math.round(tv(a.beyond!) - tv(a.before))} ${unit}` : `+${Math.round(a.added)} ${unit}`);

  // road lines: the hovered / selected town's (its nearest and next, or under a scenario its closed and new routes), and
  // with a scenario and nothing hovered, every affected town's new route. Cumulative lengths drive the travelling pulse.
  type RowKind = 'near' | 'alt' | 'closed' | 'new';
  type Row = { t: Trip; kind: RowKind; label: boolean; path: [number, number][]; cum: number[] };
  const row = (m: Muni, t: Trip, kind: RowKind, label: boolean): Row => {
    const path: [number, number][] = t.line ?? [[m.lon, m.lat], [fac[t.f].lon, fac[t.f].lat]];
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], (path[k][1] - path[k - 1][1]) * 1.5));
    return { t, kind, label, path, cum };
  };
  let memoKey: string | null = null;
  let memoRows: Row[] = [];
  const rowsFor = (key: string | null) => {
    const mk = `${key}|${scenarioVersion}`;
    if (mk === memoKey) return memoRows;
    memoKey = mk;
    const m = data.munis.find((x) => x.key === key);
    const trips = m ? tripsOf(m.key) ?? [] : [];
    if (!scenarioOn('hospitals')) {
      memoRows = m ? trips.slice(0, 2).map((t, i) => row(m, t, i === 0 ? 'near' : 'alt', true)) : [];
    } else if (m) {
      const n = nearest(m.key);
      memoRows = [
        ...(trips[0] && isClosed('hospitals', trips[0].f) ? [row(m, trips[0], 'closed', true)] : []),
        ...(n && !n.beyond ? [row(m, n.t, n.t === trips[0] ? 'near' : 'new', true)] : []),
      ];
    } else {
      memoRows = affectedTowns('hospitals', data.munis, tripsOf).flatMap((a) => [row(a.m, a.before, 'closed', false), ...(a.after ? [row(a.m, a.after, 'new', false)] : [])]);
    }
    return memoRows;
  };
  const along = (r: Row, q: number): [number, number] => {
    const d = q * r.cum[r.cum.length - 1];
    const k = Math.max(1, lowerBound(r.cum, d, (c) => c));
    if (k >= r.path.length) return r.path[r.path.length - 1];
    const f = (d - r.cum[k - 1]) / (r.cum[k] - r.cum[k - 1] || 1);
    return [r.path[k - 1][0] + (r.path[k][0] - r.path[k - 1][0]) * f, r.path[k - 1][1] + (r.path[k][1] - r.path[k - 1][1]) * f];
  };
  const ROW_COLOR: Record<RowKind, RGBA> = { near: rgb('#ffffff', 235), new: rgb('#ffffff', 235), alt: rgb(color, 200), closed: rgb(CLOSED_COLOR, 210) };

  const l: AtlasLayer = {
    id: 'hospitals',
    name: 'Hospital access',
    icon: '✚',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'hospitals listed in 2020',
    available: fac.length > 0,
    unavailable: 'Statistics Canada’s Open Database of Healthcare Facilities could not be downloaded when this copy of the data was built. Run <code>npm run data hospitals</code>, then reload.',
    build({ selected, hovered, focusedId, clock }) {
      const focused = focusedId === 'hospitals';
      const sc = scenarioOn('hospitals');
      const out: Layer[] = [];
      if (focused) out.push(...townColumns('hospitals', data.munis, (m) => val(m.key), height, (v, m) => (sc && nearest(m.key)?.beyond ? rgb(CLOSED_COLOR, 235) : rgb(ramp(v), 235)), scenarioVersion, selected));

      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        const q = (clock % 2600) / 2600;
        const moving = rows.filter((r) => r.kind !== 'closed' && r.kind !== 'alt');
        out.push(
          new PathLayer<Row>({
            id: 'hospitals-trips',
            data: rows,
            getPath: (r) => r.path,
            getColor: (r) => ROW_COLOR[r.kind],
            getWidth: (r) => (r.kind === 'near' || r.kind === 'new' ? (r.label ? 4 : 3) : 2.5),
            widthUnits: 'pixels',
            capRounded: true,
            jointRounded: true,
            extensions: dashExt,
            // a closed hospital's route is dashed, like a straight line standing in for a road
            getDashArray: (r) => (r.kind === 'closed' ? [4, 3] : !r.t.line ? [3, 2] : [0, 0]),
            dashJustified: true,
            updateTriggers: { getColor: scenarioVersion, getDashArray: scenarioVersion, getWidth: scenarioVersion },
            parameters: NO_DEPTH,
          } as any),
          new ScatterplotLayer<Row>({
            id: 'hospitals-pulse',
            data: moving,
            getPosition: (r) => along(r, q),
            getRadius: 2600,
            radiusMinPixels: 3,
            getFillColor: [255, 255, 255, 230],
            updateTriggers: { getPosition: q },
            parameters: ADDITIVE,
          }),
          new TextLayer<Row>({
            id: 'hospitals-mins',
            data: rows.filter((r) => r.label),
            getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${r.kind === 'closed' ? 'closed · ' : ''}${tripText(r.t)}\n${fac[r.t.f].name}`,
            getSize: (r) => (r.kind === 'near' || r.kind === 'new' ? 13 : 11),
            getColor: (r) => (r.kind === 'closed' ? rgb(CLOSED_COLOR) : r.kind === 'alt' ? [214, 222, 255, 235] : [255, 255, 255, 255]),
            getPixelOffset: [0, -14],
            getAlignmentBaseline: 'bottom',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            characterSet: 'auto',
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 230],
            fontSettings: { sdf: true },
            updateTriggers: { getText: scenarioVersion, getColor: scenarioVersion },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }

      // round-the-clock ERs breathe; smaller sites are drawn dimmer; a hospital closed in a scenario is red and still
      const p = (clock % 2400) / 2400;
      const shut = (i: number) => sc && isClosed('hospitals', i);
      out.push(
        new ScatterplotLayer<Facility>({
          id: 'hospitals-halo',
          data: fac.filter((f, i) => f.hospital && !shut(i)),
          getPosition: (f) => [f.lon, f.lat],
          getRadius: 4000 + p * 15000,
          radiusMinPixels: 5,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1.5,
          getLineColor: rgb(color, 210 * (1 - p)),
          updateTriggers: { getRadius: p, getLineColor: p },
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<Facility>({
          id: 'hospitals-sites',
          data: fac,
          getPosition: (f) => [f.lon, f.lat],
          getRadius: (f) => (f.hospital ? 3400 : 2400),
          radiusMinPixels: focused ? 5 : 4,
          radiusMaxPixels: 13,
          getFillColor: (f, { index }) => (shut(index) ? rgb(CLOSED_COLOR) : f.hospital ? [255, 255, 255, 255] : [16, 22, 38, 235]),
          stroked: true,
          getLineColor: (f, { index }) => (shut(index) ? [255, 255, 255, 255] : rgb(edColor(f))),
          lineWidthMinPixels: 2.5,
          pickable: true,
          updateTriggers: { getFillColor: scenarioVersion, getLineColor: scenarioVersion },
          parameters: { depthCompare: 'always' },
        } as any),
      );
      if (sc)
        out.push(new TextLayer<{ f: number; name: string }>({
          id: 'hospitals-closed',
          data: closedSites('hospitals'),
          getPosition: (c) => [fac[c.f].lon, fac[c.f].lat],
          getText: () => 'closed (scenario)',
          getSize: 11,
          getColor: rgb(CLOSED_COLOR),
          getPixelOffset: [0, 16],
          getAlignmentBaseline: 'top',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          outlineWidth: 3,
          outlineColor: [6, 10, 18, 230],
          fontSettings: { sdf: true },
          updateTriggers: { getPosition: scenarioVersion },
          parameters: { depthCompare: 'always' },
        } as any));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Hospital access · drive to the nearest hospital')}
        <h2>How far to a hospital?</h2>`;
      if (!H) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const sc = scenarioOn('hospitals');
      const n24 = fac.filter((f) => f.hospital).length;
      el.insertAdjacentHTML('beforeend', `<p class="lede">The ${fac.length} Saskatchewan sites Statistics Canada’s Open Database of Healthcare Facilities files as hospitals, ${n24} of them hospitals proper (the rest are health centres and clinics). Column height shows the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each town centre to its nearest hospital. Hover or click a town to see its routes.</p>`);
      if (sc) el.appendChild(scenarioBox('hospitals', data.munis, tripsOf, (f) => fac[f]?.name ?? '', addText, tripText));
      const hero = heroStats(el, 4);
      const rows = data.munis.flatMap((m) => { const n = nearest(m.key); return n ? [{ m, v: tv(n.t), n }] : []; });
      rows.sort((a, b) => a.v - b.v);
      const near = routed ? 20 : 15;
      hero(0, sc ? `${n24 - closedSites('hospitals').length} of ${n24}` : String(n24), sc ? 'hospitals open in this scenario' : 'hospitals');
      hero(1, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, 'median place to a hospital');
      hero(2, `${rows.filter((r) => r.v <= near && !r.n.beyond).length} of ${rows.length}`, `towns within ${near} ${unit}`);
      const far = rows.at(-1);
      hero(3, far ? `${far.n.beyond ? '>' : ''}${Math.round(far.v)} ${unit}` : '–', far ? `farthest: ${far.m.name}` : '');
      const max = d3.max(rows, (r) => r.v) ?? 1;
      const small = fac.filter((f) => f.ed !== '24/7');
      const hosp = fac.map((f, i) => ({ f, i })).filter((x) => x.f.hospital).sort((a, b) => a.f.name.localeCompare(b.f.name));
      el.insertAdjacentHTML('beforeend', `
        <h3>${routed ? 'Drive' : 'Distance'} to the nearest hospital${sc ? ' <span class="sc-tag">scenario</span>' : ''}</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li data-key="${r.m.key}"><span class="rk">${i + 1}</span><span><span class="nm">${r.m.name}</span><br><span class="rd">${esc(fac[r.n.t.f].name)} · ${Math.round(r.n.t.km)} km${r.n.beyond ? ' · <b class="sc-closed">every hospital kept for it is closed</b>' : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${r.n.beyond ? CLOSED_COLOR : ramp(r.v)}"></i></div><div class="bar-v">${r.n.beyond ? '>' : ''}${Math.round(r.v)}</div></span></li>`).join('')}</ol>
        <div class="ramp" style="background:${rampCSS((t) => ramp(5 + t * 145))}"></div>
        <div class="ramp-labels"><span>5 ${unit}</span><span>45</span><span>150+ ${unit}</span></div>
        <div class="legend"><span><i class="sw" style="background:#fff;box-shadow:0 0 0 2px ${color}"></i>hospital</span><span><i class="sw" style="background:#101626;box-shadow:0 0 0 2px #7d879c"></i>health centre or clinic</span>${sc ? `<span><i class="sw" style="background:${CLOSED_COLOR}"></i>closed in this scenario</span>` : ''}</div>
        <h3>What if a hospital closed?</h3>
        <p class="note" style="margin-top:0">Pick a hospital (or click one on the map) to see which towns would drive farther, and how much farther. Each town keeps its ${H.towns[data.munis[0]?.key]?.length ?? 3} fastest hospitals by road, so up to two closures can be combined.</p>
        <select class="sc-pick" aria-label="Close a hospital in a scenario"><option value="">Close a hospital…</option>${hosp.map((x) => `<option value="${x.i}"${isClosed('hospitals', x.i) ? ' disabled' : ''}>${esc(x.f.name)} · ${esc(x.f.city)}</option>`).join('')}</select>
        ${small.length ? `<div class="callout" style="--c:${color}">${small.length} health centres and clinics are on the map but left out of the ranking: they may not offer emergency or in-patient care.</div>` : ''}
        <p class="note">${routed ? 'Drive times are the OSRM router’s estimate for normal free-flowing traffic on OpenStreetMap roads, from the town centre. They don’t include winter roads, gravel, or air ambulance, which serves much of the far north.' : 'No routing service was reachable when this data was built, so these are straight-line distances, not drive times.'} The facility list is Statistics Canada’s 2020 compilation: rural emergency departments in Saskatchewan have had temporary closures for staffing since, and services (surgery, maternity, emergency hours) differ by hospital — check the Saskatchewan Health Authority before relying on one.</p>
        ${sourceLine(`${H.source}. ${H.routingSource ?? 'Straight-line distances.'}`)}`);
      el.querySelector<HTMLSelectElement>('.sc-pick')!.addEventListener('change', (e) => {
        const i = +(e.target as HTMLSelectElement).value;
        if (fac[i]) setClosed('hospitals', i, fac[i].name, true);
      });
      el.querySelector('.rank-list')!.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('hospitals')) return null;
      if (id === 'hospitals-sites') {
        const f = info.object as Facility;
        const shut = isClosed('hospitals', info.index);
        return `<b>${esc(f.name)}</b><br><span class="tk">${f.hospital ? 'Hospital' : 'Health centre or clinic'} · ${esc(f.city)}</span>${f.type ? `<br><span class="tk">Listed as</span> <span class="tv">${esc(f.type)}</span>` : ''}${shut ? '<br><span class="tk sc-closed">Closed in your scenario</span>' : ''}${f.hospital ? `<br><span class="tk tk-click">Click: ${shut ? 'reopen it' : 'what if this closed?'}</span>` : ''}`;
      }
      const o: any = info.object;
      const n = o.m ? nearest(o.m.key) : null;
      if (!n) return null;
      const e = n.t, sc = scenarioOn('hospitals');
      return `<b>${o.m.name}</b><br><span class="tk">Nearest ${sc ? 'open ' : ''}hospital${sc ? ' (scenario)' : ''}</span> <span class="tv">${n.beyond ? 'more than ' : ''}${e.min != null ? `${e.min} min` : `${Math.round(e.km)} km`}</span><br><span class="tk">${n.beyond ? 'every hospital kept for it is closed' : `${esc(fac[e.f].name)} · ${Math.round(e.km)} km by ${e.min != null ? 'road' : 'straight line'}`}</span><br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      if (info.layer?.id !== 'hospitals-sites') return null;
      const f = info.object as Facility, i = info.index;
      const near = data.munis.filter((m) => tripsOf(m.key)?.[0]?.f === i);
      const shut = isClosed('hospitals', i);
      return {
        layer: 'hospitals', kind: f.hospital ? 'Hospital' : 'Health centre or clinic', lon: f.lon, lat: f.lat, zoom: 8,
        title: f.name,
        body: `${f.hospital ? 'Hospital' : 'Health centre or clinic'} in ${f.city}${f.type ? `, listed as ${f.type}` : ''}. ${f.hospital ? `It is the nearest hospital by road for ${near.length} of the atlas’s places${near.length ? `: ${near.map((m) => m.name).join(', ')}` : ''}.` : 'The ranking counts hospitals proper only, so no town’s drive leads here.'}`,
        stats: near.length ? [{ v: String(near.length), l: 'places it is nearest to' }, { v: `${Math.round(d3.max(near, (m) => tv(tripsOf(m.key)![0])) ?? 0)} ${unit}`, l: 'longest of those drives' }] : [],
        detail: f.hospital ? (el) => {
          el.insertAdjacentHTML('beforeend', `<button class="sc-btn" style="--c:${CLOSED_COLOR}">${shut ? '↺ Reopen it' : scenarioOn('hospitals') ? '✕ Close this one too' : '✕ What if this closed?'}</button><p class="note">${esc(SCENARIO_CAVEAT)}</p>`);
          el.querySelector('.sc-btn')!.addEventListener('click', () => setClosed('hospitals', i, f.name, !shut));
        } : undefined,
      };
    },
  };
  return l;
}
