// GETTING AROUND — life without STC, the provincial bus company, which closed in 2017: airports with scheduled
// passenger flights (OurAirports' flag, placed by OpenStreetMap), VIA Rail's stations and lines and intercity bus routes
// as mapped in OpenStreetMap (partial), and city buses from the cities' GTFS feeds (OpenStreetMap for towns with no feed).
// Per place: the drive to the nearest airport with scheduled service, and whether a train, an intercity bus or a city bus
// stops in town. A static layer.
import * as d3 from 'd3';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Data, TransitAirport, TransitStation, TransitSystem } from './data';
import { esc, safeUrl } from './html';
import { rampCSS } from './charts';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layer-kit';

export const TRANSIT_COLOR = '#f28482';
export const RAIL_COLOR = '#ffcf56';
export const BUS_COLOR = '#80ed99';
export const CITY_COLOR = '#8ecae6';

/** What a place has for getting around, in the shape the Town Report and Finder use. */
export type PlaceTransit = {
  air: { name: string; iata: string; city: string | null; prov: string; min: number | null; km: number; line?: [number, number][]; lon: number; lat: number } | null;
  rail: TransitStation[];
  bus: { ops: string[]; stops: number };
  sys: TransitSystem | null;
  /** Can live without a car: a city bus (2) + an intercity bus stop (1) + a VIA stop (1) in town, 0–4 */
  carFree: number;
};

export function placeTransit(data: Data, key: string): PlaceTransit | null {
  const T = data.transit;
  const t = T?.towns[key];
  if (!T || !t) return null;
  const a = t.air ? T.airports[t.air.f] : null;
  const rail = (t.rail ?? []).map((i) => T.stations[i]);
  const stops = (t.bus ?? []).map((i) => T.busStops[i]);
  const ops = [...new Set(stops.map((s) => s.op ?? 'unnamed operator'))];
  const sys = t.sys != null ? T.systems[t.sys] : null;
  return {
    air: a && t.air ? { name: a.n, iata: a.iata, city: a.city, prov: a.prov, min: t.air.min, km: t.air.km, line: t.air.line, lon: a.lon, lat: a.lat } : null,
    rail, bus: { ops, stops: stops.length }, sys,
    carFree: (sys ? 2 : 0) + (stops.length ? 1 : 0) + (rail.length ? 1 : 0),
  };
}

export const airText = (p: PlaceTransit) => (p.air ? (p.air.min != null ? `${p.air.min} min` : `${Math.round(p.air.km)} km`) : '–');
export const sysText = (s: TransitSystem) => `${s.routes.length} route${s.routes.length === 1 ? '' : 's'}${s.stops != null ? ` · ${s.stops.toLocaleString('en-CA')} stops` : ''}`;
// null for a feed that runs by headway (no trip list) and for OpenStreetMap routes
const weekdayTrips = (s: TransitSystem) => (s.src === 'gtfs' && s.routes.every((r) => r.trips != null) ? d3.sum(s.routes, (r) => r.trips ?? 0) : null);
const expired = (s: TransitSystem, asOf: string) => !!s.end && s.end < asOf;

type Chip = 'air' | 'car';
const CHIPS: { id: Chip; label: string }[] = [{ id: 'air', label: 'Drive to an airport' }, { id: 'car', label: 'Without a car' }];
const CARFREE = ['#4a5568', '#6d8fb3', '#8ecae6', '#b5f0c5', '#80ed99'];

export function transitLayer(data: Data): AtlasLayer {
  const color = TRANSIT_COLOR;
  const T = data.transit;
  const airports = T?.airports ?? [];
  const stations = T?.stations ?? [];
  const busStops = T?.busStops ?? [];
  const routed = !!T && T.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  let chip: Chip = 'air';
  const places = new Map(data.munis.map((m) => [m.key, placeTransit(data, m.key)]));
  const val = (key: string) => {
    const p = places.get(key);
    if (!p) return null;
    return chip === 'air' ? (p.air ? p.air.min ?? p.air.km : null) : p.carFree;
  };
  const ramp = d3.scaleLinear<string>().domain([5, 60, 240]).range(['#fff0ee', color, '#7b2cbf']).interpolate(d3.interpolateRgb).clamp(true);
  const colOf = (v: number) => (chip === 'air' ? ramp(v) : CARFREE[Math.round(v)]);
  const height = (v: number) => (chip === 'air' ? 2600 + Math.min(v, 400) * 420 : 3000 + v * 30000);

  const railPaths = (T?.railLines ?? []).flatMap((l) => l.paths.map((p) => ({ n: l.n, p })));
  const busPaths = (T?.busRoutes ?? []).flatMap((b) => b.paths.map((p) => ({ n: b.op ?? 'Intercity bus', p })));
  const cityPaths = (T?.systems ?? []).flatMap((s) => s.routes.filter((r) => r.path.length >= 2).map((r) => ({ s, r })));

  const l: AtlasLayer = {
    id: 'transit',
    name: 'Getting around',
    icon: '✈',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'flights, trains and buses today',
    available: airports.length > 0,
    unavailable: 'The airport, rail and transit data could not be built when this copy of the data was made. Run <code>npm run data transit</code>, then reload.',
    build({ selected, hovered, focusedId }) {
      const focused = focusedId === 'transit';
      const out: Layer[] = [];
      if (focused) out.push(...townColumns('transit', data.munis, (m) => val(m.key), height, (v) => rgb(colOf(v), 235), 0, `${selected}${chip}`));
      out.push(
        new PathLayer<{ s: TransitSystem; r: TransitSystem['routes'][number] }>({
          id: 'transit-city', data: cityPaths, getPath: (d) => d.r.path,
          getColor: (d) => rgb(d.r.c && d.r.c !== '#ffffff' && d.r.c !== '#000000' ? d.r.c : CITY_COLOR, focused ? 210 : 150),
          getWidth: 2, widthUnits: 'pixels', widthMinPixels: 1, pickable: true, parameters: NO_DEPTH, updateTriggers: { getColor: focused },
        } as any),
        new PathLayer<{ n: string; p: [number, number][] }>({
          id: 'transit-bus', data: busPaths, getPath: (d) => d.p, getColor: rgb(BUS_COLOR, focused ? 230 : 170),
          getWidth: 2.5, widthUnits: 'pixels', getDashArray: [4, 3], pickable: true, parameters: NO_DEPTH, updateTriggers: { getColor: focused },
        } as any),
        new PathLayer<{ n: string; p: [number, number][] }>({
          id: 'transit-rail', data: railPaths, getPath: (d) => d.p, getColor: rgb(RAIL_COLOR, focused ? 240 : 180),
          getWidth: 3, widthUnits: 'pixels', pickable: true, parameters: NO_DEPTH, updateTriggers: { getColor: focused },
        } as any),
      );
      const m = data.munis.find((x) => x.key === (hovered ?? selected));
      const p = m ? places.get(m.key) : null;
      if (m && p?.air) {
        const path = p.air.line ?? [[m.lon, m.lat], [p.air.lon, p.air.lat]];
        out.push(
          new PathLayer<any>({ id: 'transit-trip', data: [path], getPath: (d: any) => d, getColor: rgb(color, 240), getWidth: 4, widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: NO_DEPTH } as any),
          new TextLayer<any>({
            id: 'transit-trip-label', data: [path.at(-1)], getPosition: (d: any) => d, getText: () => `${p.air!.iata}: ${airText(p)}`,
            getSize: 13, getColor: rgb(color, 245), getPixelOffset: [0, -16], fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto',
            outlineWidth: 3, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true }, parameters: { depthCompare: 'always' },
          } as any),
        );
      }
      out.push(
        new ScatterplotLayer<{ n: string | null; lon: number; lat: number }>({
          id: 'transit-busstops', data: busStops, getPosition: (s) => [s.lon, s.lat], getRadius: 400, radiusMinPixels: focused ? 3 : 2.4, radiusMaxPixels: 8,
          getFillColor: rgb(BUS_COLOR, 235), stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 0.8, pickable: true, parameters: { depthCompare: 'always' },
        } as any),
        new ScatterplotLayer<TransitStation>({
          id: 'transit-stations', data: stations, getPosition: (s) => [s.lon, s.lat], getRadius: 600, radiusMinPixels: focused ? 3.6 : 2.8, radiusMaxPixels: 9,
          getFillColor: (s) => rgb(RAIL_COLOR, s.k === 'halt' ? 150 : 245), stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 0.8, pickable: true, parameters: { depthCompare: 'always' },
        } as any),
        new ScatterplotLayer<TransitAirport>({
          id: 'transit-airports', data: airports, getPosition: (a) => [a.lon, a.lat], getRadius: (a) => 1500 + a.size * 900, radiusMinPixels: focused ? 5 : 4, radiusMaxPixels: 14,
          getFillColor: rgb(color, 240), stroked: true, getLineColor: [255, 255, 255, 255],
          getLineWidth: 2, lineWidthUnits: 'pixels', pickable: true, parameters: { depthCompare: 'always' },
        } as any),
      );
      if (focused)
        out.push(new TextLayer<TransitAirport>({
          id: 'transit-airport-labels', data: airports, getPosition: (a) => [a.lon, a.lat], getText: (a) => a.iata,
          getSize: 11, getColor: rgb(color, 240), getPixelOffset: [0, 14], getAlignmentBaseline: 'top', fontFamily: 'Inter, sans-serif', fontWeight: 700,
          characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true }, parameters: { depthCompare: 'always' },
        } as any));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Settling in · OurAirports · OpenStreetMap · city GTFS')}
        <h2>How do I get around without a car?</h2>`;
      if (!T) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Saskatchewan’s provincial bus, STC, closed in 2017, so between towns it is mostly a car, a private coach line or a plane. Coral dots are the ${airports.length} airports with scheduled passenger flights (in the far north, reached by air or winter road); yellow is VIA Rail (solid dots stations, faint ones flag stops); dashed green is intercity bus as mapped in OpenStreetMap; thin lines are city bus routes. Column height is the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} to the nearest airport with scheduled flights, or, by the second chip, how far a place gets you without a car (city bus 2, intercity bus 1, train 1).</p>
        <div class="chips" style="margin:2px 0 10px">${CHIPS.map((c) => `<button class="chip${c.id === chip ? ' on' : ''}" data-k="${c.id}" style="--c:${color}">${c.label}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const body = el.appendChild(mk('div'));
      const all = [...places.values()].filter(Boolean) as PlaceTransit[];
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === chip));
        const rows = data.munis.flatMap((m) => { const v = val(m.key); const p = places.get(m.key); return v != null && p ? [{ m, p, v }] : []; })
          .sort((a, b) => (chip === 'air' ? a.v - b.v : b.v - a.v));
        hero(0, String(airports.length), 'airports with scheduled flights');
        hero(1, `${Math.round(d3.median(all.filter((p) => p.air), (p) => p.air!.min ?? p.air!.km) ?? 0)} ${unit}`, 'median place to the nearest');
        hero(2, `${all.filter((p) => p.sys).length} of ${all.length}`, 'places with a city bus');
        hero(3, `${all.filter((p) => p.rail.length || p.bus.stops).length} of ${all.length}`, 'places with a train or intercity bus stop mapped');
        const max = d3.max(rows, (r) => r.v) || 1;
        const sub = (p: PlaceTransit) => chip === 'air'
          ? (p.air ? `${esc(p.air.name)} (${esc(p.air.iata)}) · ${Math.round(p.air.km)} km` : '')
          : [p.sys ? esc(p.sys.n) : '', p.bus.stops ? `bus: ${p.bus.ops.map(esc).join(', ')}` : '', p.rail.length ? 'VIA Rail' : ''].filter(Boolean).join(' · ') || 'nothing mapped';
        body.innerHTML = `<h3>${chip === 'air' ? `${routed ? 'Drive' : 'Distance'} to the nearest airport with scheduled flights` : 'Without a car (city bus 2 · intercity bus 1 · train 1)'}</h3>
          <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${sub(r.p)}</span></span><span><div class="bar"><i style="width:${Math.max(2, Math.round((r.v / max) * 100))}%;background:${colOf(r.v)}"></i></div><div class="bar-v">${Math.round(r.v)}</div></span></li>`).join('')}</ol>
          ${chip === 'air' ? `<div class="ramp" style="background:${rampCSS((t) => ramp(5 + t * 235))}"></div><div class="ramp-labels"><span>5 ${unit}</span><span>60</span><span>240+ ${unit}</span></div>` : ''}`;
      };
      body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as Chip | undefined;
        if (k) { chip = k; draw(); }
      });
      draw();
      const sysRows = T.systems.map((s) => `<li><b>${esc(s.n)}</b>: ${sysText(s)}${weekdayTrips(s) != null ? ` · ${weekdayTrips(s)!.toLocaleString('en-CA')} trips on a Wednesday` : ''}${s.src === 'osm' ? ' · as mapped in OpenStreetMap' : ''}${expired(s, T.asOf) ? ` · <i>timetable ended ${esc(s.end!)}</i>` : ''} · <span class="tk">${esc(s.licence)}</span></li>`).join('');
      el.insertAdjacentHTML('beforeend', `
        <h3>City buses</h3><ul class="note" style="padding-left:18px">${sysRows}</ul>
        <div class="legend"><span><i class="sw" style="background:${color};box-shadow:0 0 0 2px #fff"></i>Airport, scheduled flights</span><span><i class="sw" style="background:${RAIL_COLOR}"></i>VIA Rail (${stations.length} stops)</span><span><i class="sw" style="background:${BUS_COLOR}"></i>Intercity bus (${busStops.length} stops)</span><span><i class="sw" style="background:${CITY_COLOR}"></i>City bus route</span></div>
        <p class="note">Scheduled service is OurAirports’ flag, not a timetable: it can lag a route starting or ending, and a small northern airport may see a few flights a week. Airports just over the border (Lloydminster, Flin Flon) count; the far-north ones are reached by air or winter road and are never the nearest for any of the 62 places. VIA’s Canadian stops in Saskatchewan about twice a week each way, and the Winnipeg–Churchill train runs through the east; many stops are flag stops. Intercity bus is only what OpenStreetMap volunteers have mapped (partial: coach lines start, change and stop often), so a town may have a bus that is not shown. City buses are from each city’s GTFS feed where one is published (Moose Jaw’s timetable file has expired and Prince Albert’s is a copy kept by the Mobility Database), else from OpenStreetMap. The “without a car” score is a rough count of what is mapped, not a judgement of how often anything runs.</p>
        ${sourceLine(`${T.airSource}; ${T.railSource}; ${T.busSource}; ${T.transitSource}. ${T.routingSource ?? 'Straight-line distances.'} Built ${T.asOf}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('transit')) return null;
      const o: any = info.object;
      if (id === 'transit-airports') return `<b>${esc(o.n)} (${esc(o.iata)})</b><br><span class="tk">${o.city ? esc(o.city) : ''}${o.prov !== 'SK' ? `, ${esc(o.prov)}` : ''} · scheduled flights</span>`;
      if (id === 'transit-stations') return `<b>${esc(o.n)}</b><br><span class="tk">VIA Rail ${o.k === 'halt' ? 'flag stop' : 'station'}${o.line ? ` · ${esc(o.line)}` : ''}</span>`;
      if (id === 'transit-busstops') return `<b>${esc(o.n ?? 'Bus stop')}</b><br><span class="tk">Intercity bus · ${esc(o.op ?? 'operator not mapped')}</span>`;
      if (id === 'transit-rail' || id === 'transit-bus') return `<b>${esc(o.n)}</b><br><span class="tk">${id === 'transit-rail' ? 'VIA Rail' : 'Intercity bus (OpenStreetMap)'}</span>`;
      if (id === 'transit-city') return `<b>${esc(o.s.n)}</b><br><span class="tk">${o.r.s ? `${esc(o.r.s)} ` : ''}${esc(o.r.n)}${o.r.trips ? ` · ${o.r.trips} trips on a Wednesday` : ''}</span>`;
      if (!o.m) return null;
      const p = places.get(o.m.key);
      if (!p) return null;
      return `<b>${esc(o.m.name)}</b><br><span class="tk">Airport</span> <span class="tv">${airText(p)}${p.air ? ` (${esc(p.air.iata)})` : ''}</span><br><span class="tk">City bus</span> <span class="tv">${p.sys ? 'yes' : 'no'}</span><br><span class="tk">Intercity bus / train</span> <span class="tv">${p.bus.stops ? 'bus' : '–'} / ${p.rail.length ? 'VIA' : '–'}</span><br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      const id = info.layer?.id;
      const o: any = info.object;
      if (id === 'transit-airports') {
        const a = o as TransitAirport;
        const wiki = a.wiki ? safeUrl(a.wiki) : null;
        return {
          layer: 'transit', kind: 'Airport with scheduled flights', lon: a.lon, lat: a.lat, zoom: 11, title: `${a.n} (${a.iata})`,
          body: `${a.city ? `${a.city}${a.prov !== 'SK' ? `, ${a.prov}` : ''}. ` : ''}OurAirports marks it as having scheduled passenger service.${a.lat > 57 ? ' In the far north: reached by air, or by winter road in season.' : ''}`,
          stats: [],
          sources: [{ label: 'OurAirports', url: `https://ourairports.com/airports/${a.icao}/` }, ...(a.osm ? [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${a.osm}` }] : []), ...(wiki ? [{ label: 'Wikipedia', url: wiki }] : [])],
        };
      }
      if (id === 'transit-stations') {
        const s = o as TransitStation;
        return {
          layer: 'transit', kind: s.k === 'halt' ? 'VIA Rail flag stop' : 'VIA Rail station', lon: s.lon, lat: s.lat, zoom: 13, title: s.n,
          body: `${s.line ? `On ${s.line}. ` : ''}${s.k === 'halt' ? 'A flag stop: trains stop on request, booked ahead.' : ''}`,
          stats: [], sources: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${s.osm}` }, { label: 'VIA Rail', url: 'https://www.viarail.ca/en' }],
        };
      }
      if (id === 'transit-busstops') {
        return {
          layer: 'transit', kind: 'Intercity bus stop', lon: o.lon, lat: o.lat, zoom: 13, title: o.n ?? 'Bus stop',
          body: `${o.op ? `${o.op}. ` : ''}As mapped in OpenStreetMap; check the operator for times and whether it still stops here.`,
          stats: [], sources: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${o.osm}` }],
        };
      }
      return null;
    },
  };
  return l;
}
