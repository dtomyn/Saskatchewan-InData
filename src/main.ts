import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as maplibregl from 'maplibre-gl';
// MapLibre 6 loads its worker from a separate module file; let Vite emit it and tell MapLibre where it is.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import * as d3 from 'd3';
import { Data, MONTHS, clamp, loadAll } from './data';
import { isNow } from './now';
import { ensureFeed, onHistory, tDay } from './history';
import { AtlasEvent, AtlasLayer, CURATED_EVENTS, Ctx, PanelHandle, TimedEvent, buildLayers } from './layers';
import { eventColor, eventDate, eventLayers, fromTooltip, momentsList, renderEventPanel } from './events';
import { loadWeights, renderFinder, renderTownReport } from './panels';
import { openSources, sourcesOpen } from './sources';
import { Ranked } from './metrics';
import { SCENARIO_LABEL, ScenarioKind, clearScenario, closedSites, scenarioOn, setClosed } from './scenario';
import { esc } from './html';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const INTRO_FROM = { center: [-106.0, 54.6] as [number, number], zoom: 3.6, pitch: 0, bearing: 0 };
const HOME = { center: [-105.6, 51.75] as [number, number], zoom: 5.35, pitch: 45, bearing: -12 };
const MUNI_LAYERS = new Set(['population', 'crime', 'housing', 'jobs']);
// static layers that draw town columns only while focused
const MUNI_WHEN_FOCUSED = new Set(['hospitals', 'justice', 'camping', 'needs', 'schools', 'internet', 'commute', 'community', 'newcomer', 'transit', 'doctors', 'childcare', 'industry', 'water'])
// layer menu sections; any layer not listed lands in the last group
const LAYER_GROUPS: { name: string; ids: string[] }[] = [
  { name: 'Base map', ids: ['province'] },
  { name: 'Justice & safety', ids: ['crime', 'justice', 'treaties'] },
  { name: 'History on the timeline', ids: ['fires', 'smoke', 'tornadoes', 'hail', 'drought', 'crops', 'rivers', 'climate'] },
  { name: 'Places & living', ids: ['population', 'housing', 'jobs', 'needs', 'schools', 'internet', 'camping', 'commute', 'normals', 'light'] },
  { name: 'Health', ids: ['hospitals', 'doctors'] },
  { name: 'Settling in', ids: ['community', 'newcomer', 'childcare', 'transit'] },
  { name: 'Around the property', ids: ['industry', 'water', 'radon'] },
];

type Mode = 'layer' | 'town' | 'finder' | 'event';

const state = {
  time: 1959,
  playing: false,
  speed: 2,
  // the active layer: its story is in the panel and, if it changes over time, the timeline is its.
  // 'province' means no layer is active (the map may still have layers switched on).
  focused: 'province',
  // the timeline belongs to the last active time-based layer; static layers leave it alone
  timeLayer: 'fires',
  // the layers switched on in the menu: exactly what's drawn on the map
  visible: new Set<string>(),
  selected: null as string | null,
  hovered: null as string | null,
  mode: 'layer' as Mode,
  ranked: null as Ranked[] | null,
  beacons: [] as { ev: TimedEvent; born: number }[],
  // the event open in the side panel (mode 'event')
  event: null as AtlasEvent | null,
};

let data: Data;
let layers: AtlasLayer[] = [];
let byId: Record<string, AtlasLayer> = {};
let events: TimedEvent[] = [];
let map: maplibregl.Map;
let overlay: MapboxOverlay;
let panelHandle: PanelHandle | null = null;
let firstLabelLayer: string | undefined;

const ctx = (): Ctx => ({ time: state.time, speed: state.speed, data, selected: state.selected, hovered: state.hovered, focusedId: state.focused, clock: performance.now() });
const focusedLayer = () => byId[state.focused];
const timeLayer = () => byId[state.timeLayer];

// ---------------------------------------------------------------------------------------------
// map

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    ...INTRO_FROM,
    maxPitch: 75,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true },
  } as any);
  // deck.gl 9.4's MapLibre adapter still reads map.transform, which MapLibre 6 no longer exposes.
  // Hand it the two fields it uses, from public APIs. Drop this once deck.gl supports MapLibre 6.
  if ((map as any).transform === undefined) {
    Object.defineProperty(map, 'transform', {
      configurable: true,
      get: () => ({ height: map.getCanvas().clientHeight, elevation: map.getCenterElevation() }),
    });
  }
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

  map.on('load', () => {
    const style = map.getStyle();
    firstLabelLayer = style.layers.find((l) => l.type === 'symbol')?.id;
    const waterLayer = style.layers.find((l) => /water/.test(l.id) && l.type === 'fill')?.id;

    // shaded relief from open terrain tiles, tucked under the water so the sea stays flat
    map.addSource('dem', {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 12,
      attribution: 'Terrain: Mapzen / AWS Terrain Tiles',
    });
    map.addLayer(
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-exaggeration': 0.55,
          'hillshade-shadow-color': '#02040a',
          'hillshade-highlight-color': 'rgba(150,175,215,0.22)',
          'hillshade-accent-color': '#0b1424',
          'hillshade-illumination-direction': 315,
        },
      },
      waterLayer,
    );

    if (data.outline) {
      map.addSource('outline', { type: 'geojson', data: data.outline });
      map.addLayer({ id: 'coast-glow', type: 'line', source: 'outline', paint: { 'line-color': '#4cc9f0', 'line-width': 10, 'line-blur': 10, 'line-opacity': 0.16 } }, firstLabelLayer);
      map.addLayer({ id: 'coast-line', type: 'line', source: 'outline', paint: { 'line-color': '#8fdcff', 'line-width': 0.8, 'line-opacity': 0.5 } }, firstLabelLayer);
    }
    try {
      (map as any).setSky?.({ 'sky-color': '#060a12', 'horizon-color': '#12233d', 'fog-color': '#060a12', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 });
    } catch { /* older renderers */ }

    overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      // a few pixels of slack, so a thin trail line is easy to point at
      pickingRadius: 6,
      onHover,
      onClick,
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    } as any);
    map.addControl(overlay as any);

    $('loader').classList.add('done');
    setTimeout(() => {
      map.flyTo({ ...HOME, duration: 4200, curve: 1.6, essential: true });
    }, 300);
  });
}

// ---------------------------------------------------------------------------------------------
// deck layers per frame

function render() {
  if (!overlay) return;
  const c = ctx();
  const out: Layer[] = [];
  for (const l of layers) {
    if (!l.available || !state.visible.has(l.id)) continue;
    // at the timeline's Now stop, a layer with a live reading draws it over its archive; between the archive and Now,
    // its daily record (fetched the first time the timeline enters that span)
    const rec = l.now?.recent;
    const inSpan = !!rec && state.time >= rec.from && !isNow(state.time, l.range[1]);
    if (inSpan) ensureFeed(rec!.feed, rec!.from);
    const live = l.now && isNow(state.time, l.range[1]) ? l.now.build(c) : inSpan ? rec!.build(c) : [];
    for (const dl of [...l.build(c), ...live]) {
      // flat layers go under the basemap labels; 3D columns stay on top
      const flat = /scars|embers|base|stems/.test(dl.id);
      out.push(flat && firstLabelLayer ? dl.clone({ beforeId: firstLabelLayer } as any) : dl);
    }
  }

  const anyMuni = [...state.visible].some((id) => (MUNI_LAYERS.has(id) || (MUNI_WHEN_FOCUSED.has(id) && id === state.focused)) && byId[id]?.available);
  if (state.mode === 'finder' && state.ranked) {
    const ramp = d3.scaleSequential(d3.interpolateRgb('#2b1f6b', '#7dffc4')).domain([0.2, 0.85]).clamp(true);
    const rk = state.ranked.map((r, i) => ({ ...r, i }));
    out.push(
      new ColumnLayer<any>({
        id: 'finder-cols',
        data: rk,
        getPosition: (r) => [r.t.muni.lon, r.t.muni.lat],
        radius: 5600,
        diskResolution: 32,
        extruded: true,
        getElevation: (r) => 2400 + r.score ** 1.6 * 135000,
        getFillColor: (r) => { const c2 = d3.rgb(ramp(r.score)); return [c2.r, c2.g, c2.b, r.i < 5 ? 250 : 170]; },
        material: { ambient: 0.6, diffuse: 0.6, shininess: 80 },
        pickable: true,
        transitions: { getElevation: { duration: 600, easing: d3.easeCubicOut }, getFillColor: 600 },
        updateTriggers: { getElevation: state.ranked, getFillColor: state.ranked },
      }),
      new TextLayer<any>({
        id: 'finder-labels',
        data: rk.slice(0, 10),
        getPosition: (r) => [r.t.muni.lon, r.t.muni.lat, 2400 + r.score ** 1.6 * 135000 + 9000],
        getText: (r) => `${r.i + 1} · ${r.t.muni.name}`,
        getSize: (r) => (r.i < 3 ? 15 : 12),
        getColor: [240, 244, 252, 255],
        fontFamily: 'Inter, sans-serif',
        fontWeight: 700,
        outlineWidth: 3,
        outlineColor: [6, 10, 18, 230],
        fontSettings: { sdf: true },
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        updateTriggers: { getPosition: state.ranked, getText: state.ranked },
        parameters: { depthCompare: 'always' },
      } as any),
    );
  } else if (!anyMuni) {
    // clickable town pins whenever no municipal layer is showing
    out.push(
      new ScatterplotLayer<any>({
        id: 'towns-pins',
        data: data.munis,
        getPosition: (m) => [m.lon, m.lat],
        getRadius: 2000,
        radiusMinPixels: 3.5,
        radiusMaxPixels: 7,
        getFillColor: [235, 242, 255, 210],
        stroked: true,
        getLineColor: [6, 10, 18, 255],
        lineWidthMinPixels: 1.2,
        pickable: true,
        parameters: { depthCompare: 'always' },
      } as any),
    );
  }

  // pulsing ring on the selected town
  if (state.selected) {
    const m = data.munis.find((x) => x.key === state.selected);
    if (m) {
      const p = (performance.now() % 1600) / 1600;
      out.push(
        new ScatterplotLayer<any>({
          id: 'selected-ring',
          data: [m],
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 7500 + p * 21000,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 2,
          getLineColor: [255, 255, 255, 255 * (1 - p)],
          updateTriggers: { getRadius: p, getLineColor: p },
          parameters: { depthCompare: 'always' },
        } as any),
      );
    }
  }

  // event beacons: a shockwave where a historic event happened
  const now = performance.now();
  state.beacons = state.beacons.filter((b) => now - b.born < 3500);
  if (state.beacons.length)
    out.push(
      new ScatterplotLayer<any>({
        id: 'beacons',
        data: state.beacons.flatMap((b) => [0, 0.33, 0.66].map((o) => ({ b, o }))),
        getPosition: (d) => [d.b.ev.lon, d.b.ev.lat],
        getRadius: (d) => { const a = ((now - d.b.born) / 3500 + d.o) % 1; return 6000 + a * 120000; },
        stroked: true,
        filled: false,
        lineWidthMinPixels: 2,
        getLineColor: (d) => { const a = ((now - d.b.born) / 3500 + d.o) % 1; return [255, 255, 255, 220 * (1 - a) * (1 - (now - d.b.born) / 3500)]; },
        updateTriggers: { getRadius: now, getLineColor: now },
        parameters: { depthCompare: 'always' },
      } as any),
    );

  overlay.setProps({ layers: out });
}

// ---------------------------------------------------------------------------------------------
// interaction

const tooltipEl = () => $('tooltip');

function onHover(info: PickingInfo) {
  const t = tooltipEl();
  const o: any = info.object;
  state.hovered = o ? o.m?.key ?? o.t?.muni?.key ?? (info.layer?.id.startsWith('towns') ? o.key : null) : null;
  if (!info.object || !info.layer) { t.hidden = true; return; }
  let html: string | null = null;
  const id = info.layer.id;
  if (id.startsWith('finder')) {
    const r = info.object as Ranked & { i: number };
    html = `<b>#${r.i + 1} ${r.t.muni.name}</b><br><span class="tk">Score</span> <span class="tv">${Math.round(r.score * 100)}</span><br><span class="tk">Click for town report</span>`;
  } else if (id.startsWith('towns')) {
    html = `<b>${info.object.name}</b><br><span class="tk">Click for town report</span>`;
  } else {
    const owner = layers.find((l) => id.startsWith(l.id));
    html = owner?.tooltip(info) ?? null;
  }
  if (!html) { t.hidden = true; return; }
  // every feature opens a details panel on click; say so unless the tooltip already says what a click does
  if (!/click/i.test(html)) html += '<br><span class="tk tk-click">Click for details</span>';
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = `${Math.min(info.x, window.innerWidth - r.width - 30)}px`;
  t.style.top = `${Math.min(info.y, window.innerHeight - r.height - 30)}px`;
}

function onClick(info: PickingInfo) {
  const o: any = info.object;
  if (!o) return;
  const owner = info.layer ? layers.find((l) => info.layer!.id.startsWith(l.id)) : null;
  if (owner?.click?.(info)) return;
  // a town (a dot, or a town's column on any layer) opens its report
  const key = o.m?.key ?? o.t?.muni?.key ?? (info.layer?.id.startsWith('towns') ? o.key : null);
  if (key) { openTown(key); return; }
  // anything else opens its details: the layer's own description, or one built from its tooltip
  const rec = featureDetails(owner, info);
  if (rec) openEvent(rec);
}

/** What a click on a map feature opens: the layer's describe(), or failing that, its tooltip turned into a panel. */
function featureDetails(owner: AtlasLayer | null | undefined, info: PickingInfo): AtlasEvent | null {
  if (!owner) return null;
  const own = owner.describe?.(info);
  if (own) return own;
  const html = owner.tooltip(info);
  return html ? fromTooltip(owner, html, (info.coordinate as [number, number] | undefined) ?? null) : null;
}

function openTown(key: string) {
  state.selected = key;
  const m = data.munis.find((x) => x.key === key)!;
  const prevMode = state.mode === 'town' ? 'layer' : state.mode;
  const fromEvent = state.mode === 'event' ? state.event : null;
  state.mode = 'town';
  let rank: { pos: number; of: number; score: number } | undefined;
  if (state.ranked) {
    const i = state.ranked.findIndex((r) => r.t.muni.key === key);
    if (i >= 0) rank = { pos: i + 1, of: state.ranked.length, score: state.ranked[i].score };
  }
  swapPanel(() => {
    panelHandle = null;
    renderTownReport($('panel'), data, key, {
      rank,
      onClose: () => { state.selected = null; if (fromEvent) openEvent(fromEvent); else if (prevMode === 'finder') openFinder(); else showLayerPanel(); },
    });
  });
  map.flyTo({ center: [m.lon, m.lat], zoom: Math.max(map.getZoom(), 8), pitch: 55, duration: 1600, essential: true });
}

function openFinder() {
  state.mode = 'finder';
  $('finder-btn').classList.add('active');
  const weights = loadWeights();
  swapPanel(() => {
    panelHandle = null;
    renderFinder($('panel'), data, weights, {
      onChange: (ranked) => { state.ranked = ranked; },
      onPick: (key) => openTown(key),
      onClose: () => closeFinder(),
    });
  });
  if (map.getZoom() > 7) map.flyTo({ ...HOME, duration: 1400 });
}

function closeFinder() {
  state.mode = 'layer';
  state.ranked = null;
  state.selected = null;
  $('finder-btn').classList.remove('active');
  showLayerPanel();
}

function swapPanel(fill: () => void) {
  const p = $('panel');
  if (state.mode !== 'layer') setPanelOpen(true);
  p.classList.add('swap');
  setTimeout(() => {
    p.scrollTop = 0;
    fill();
    p.classList.remove('swap');
  }, 160);
}

function showLayerPanel() {
  state.mode = state.mode === 'finder' ? 'finder' : 'layer';
  if (state.mode === 'finder') return;
  const l = focusedLayer();
  swapPanel(() => {
    const p = $('panel');
    p.style.setProperty('--c', l.color);
    const on = layers.filter((x) => x.id !== 'province' && x.available && state.visible.has(x.id));
    if (l.id === 'province' && on.length) { panelHandle = null; renderOnMap(p, on); return; }
    panelHandle = l.panel(p, ctx());
    panelHandle.update(ctx());
    // the layer's key moments, above its source line: each opens in its own panel
    const moments = events.filter((e) => e.layer === l.id || (e.layer === '*' && ((!l.static && e.t >= l.range[0] && e.t <= l.range[1]) || e.layers?.includes(l.id))));
    if (l.id !== 'province' && moments.length) {
      const box = momentsList(moments, byId, openEvent);
      const src = p.querySelector(':scope > .source');
      if (src) p.insertBefore(box, src); else p.appendChild(box);
    }
  });
}

/** No active layer but some on the map: list them, each a click away from its story and timeline. */
function renderOnMap(p: HTMLElement, on: AtlasLayer[]) {
  p.innerHTML = `<div class="kicker">On the map</div>
    <h2>${on.length} layer${on.length > 1 ? 's' : ''} switched on</h2>
    <p class="lede">None of them is picked, so there’s no story or timeline showing. Click one to see its story${on.some((x) => !x.static) ? ' and play its years' : ''}.</p>
    <div class="onmap">${on.map((x) => `<button class="layer-row" data-id="${x.id}" style="--c:${x.color}"><div class="ic">${x.icon}</div><div><div class="nm">${x.name}</div><div class="rg">${x.static ? x.period ?? 'no timeline' : `${Math.floor(x.range[0])}–${Math.floor(x.range[1])} · timeline`}</div></div><span class="onmap-go">›</span></button>`).join('')}</div>
    <p class="note">Open <b>Layer</b> to switch layers on and off, or <i>Clear the map</i> to start over.</p>`;
  p.querySelectorAll<HTMLElement>('[data-id]').forEach((b) => b.addEventListener('click', () => focus(b.dataset.id!)));
}

// ---------------------------------------------------------------------------------------------
// layer menu

const menuEl = () => $('layer-menu');
const menuOpen = () => !menuEl().hidden;

function setMenu(open: boolean) {
  menuEl().hidden = !open;
  $('layers-btn').setAttribute('aria-expanded', String(open));
  if (open) menuEl().querySelector<HTMLElement>('.layer-row.focused')?.focus({ preventScroll: true });
}

function renderLayerMenu() {
  const f = focusedLayer();
  const on = [...state.visible].filter((id) => byId[id]?.available);
  // no active layer but some on the map: say how many are on rather than "Just the province"
  const loose = f.id === 'province' && on.length > 0;
  $('picker-ic').textContent = f.icon;
  $('picker-nm').textContent = loose ? `${on.length} layer${on.length > 1 ? 's' : ''} on` : f.name;
  const extra = on.filter((id) => id !== f.id).length;
  const ex = $('picker-extra');
  ex.hidden = !extra || loose;
  ex.textContent = `+${extra}`;
  ex.title = `${extra} more layer${extra > 1 ? 's' : ''} on the map`;

  const menu = menuEl();
  const listed = new Set(LAYER_GROUPS.flatMap((g) => g.ids));
  const groups = LAYER_GROUPS.map((g, i) => ({ name: g.name, items: layers.filter((l) => g.ids.includes(l.id) || (i === LAYER_GROUPS.length - 1 && !listed.has(l.id))) }));
  menu.innerHTML = '';
  for (const g of groups) {
    if (!g.items.length) continue;
    const sec = document.createElement('div');
    sec.className = 'menu-group';
    sec.innerHTML = `<div class="menu-gh">${g.name}</div>`;
    for (const l of g.items) {
      const row = document.createElement('div');
      row.className = `layer-row${l.id === state.focused ? ' focused' : ''}${l.available ? '' : ' unavailable'}`;
      row.style.setProperty('--c', l.color);
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const [a, b] = l.range;
      // "Just the province" is the empty map: selected only when nothing is on, otherwise a reset
      const clear = l.id === 'province' && on.length > 0;
      if (l.id === 'province') { row.title = clear ? 'Turn every layer off' : 'Nothing is on the map'; row.classList.toggle('reset', clear); row.classList.toggle('focused', !clear); }
      const isOn = state.visible.has(l.id);
      if (l.id !== 'province') row.title = l.id === state.focused ? 'Showing its story and timeline' : `Show its story${l.static ? '' : ' and timeline'}${isOn ? '' : ' (switches it on)'}`;
      row.innerHTML = `<div class="ic">${l.icon}</div><div><div class="nm">${clear ? 'Clear the map' : l.name}</div><div class="rg">${clear ? 'back to just the province' : !l.available ? 'data unavailable' : l.static ? l.period ?? 'no timeline' : `${Math.floor(a)}–${Math.floor(b)}`}</div></div>${l.id === 'province' ? '' : `<button class="eye${isOn ? ' on' : ''}" role="switch" aria-checked="${isOn}" aria-label="${l.name} on the map" title="${isOn ? 'Take it off the map' : 'Put it on the map'}"></button>`}`;
      const pick = () => { if (l.id === 'province') clearMap(); else focus(l.id); };
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('eye')) { setLayerOn(l.id, !state.visible.has(l.id)); return; }
        pick();
        setMenu(false);
      });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) { pick(); setMenu(false); $('layers-btn').focus(); } });
      sec.appendChild(row);
    }
    menu.appendChild(sec);
  }
  menu.insertAdjacentHTML('beforeend', `<div class="menu-hint">The switch puts a layer on the map or takes it off. Click a layer’s name to show its story and its timeline; the other layers stay on. <i>Clear the map</i> at the top turns everything off. Click any town on the map for its report card.</div>`);
}

// ---------------------------------------------------------------------------------------------
// story panel visibility

function setPanelOpen(open: boolean) {
  $('panel').classList.toggle('collapsed', !open);
  document.body.classList.toggle('no-panel', !open);
  const btn = $('panel-btn');
  btn.classList.toggle('on', open);
  btn.setAttribute('aria-pressed', String(open));
  btn.title = open ? 'Hide the story panel (P)' : 'Show the story panel (P)';
  requestAnimationFrame(drawSpark);
  setTimeout(drawSpark, 300);
}

/** Make a layer the active one (switching it on if it was off); other layers on the map stay on. 'province': no active layer. */
function focus(id: string, keepPanel = false) {
  const l = byId[id];
  const changed = state.focused !== id;
  state.focused = id;
  if (id !== 'province') state.visible.add(id);
  if (changed) {
    // a static layer keeps the current time, so other visible layers carry on where they were
    if (!l.static && state.timeLayer !== id) {
      state.timeLayer = id;
      const [a, b] = l.range;
      // a layer with a live reading opens at Now; the others keep the time if it is inside their range
      if (l.now) state.time = b;
      else if (state.time < a || state.time > b) state.time = a;
    }
    if (state.mode !== 'finder' && !keepPanel) { state.mode = 'layer'; state.selected = null; }
  }
  document.documentElement.style.setProperty('--accent', l.color);
  renderLayerMenu();
  setupTimeline();
  if (state.mode !== 'finder' && !keepPanel) showLayerPanel();
}

/** A menu switch: put a layer on the map or take it off. */
function setLayerOn(id: string, on: boolean) {
  if (on) {
    // with no active layer, the layer switched on becomes the active one
    if (state.focused === 'province') return focus(id);
    state.visible.add(id);
  } else {
    state.visible.delete(id);
    // switching off the active layer takes its story and timeline away too
    if (id === state.focused) {
      if (!byId[id].static) setPlaying(false);
      return focus('province');
    }
  }
  renderLayerMenu();
  setupTimeline();
}

/** "Clear the map": every layer off, nothing active. */
function clearMap() {
  state.visible.clear();
  setPlaying(false);
  focus('province');
}

// ---------------------------------------------------------------------------------------------
// timeline

const scrub = () => $<HTMLInputElement>('scrub');

function setupTimeline() {
  const l = timeLayer();
  const f = focusedLayer();
  $('timeline').classList.toggle('static', !!f.static);
  const note = $('static-note');
  note.hidden = !f.static;
  if (f.static) {
    // other visible time-based layers keep playing on the last timeline
    const others = layers.filter((x) => !x.static && x.available && state.visible.has(x.id)).map((x) => x.name);
    note.innerHTML = f.id === 'province' && !others.length ? `<div>No history layer on the map</div><span>Open <b>Layer</b> and pick one, like Crime severity or Wildfires, to travel through time</span>`
      : f.id === 'province' ? `<div>No layer picked</div><span>Click ${others.length > 1 ? 'one of the layers on the map' : `<b>${others[0]}</b>`} in the panel or the <b>Layer</b> menu for its timeline</span>` : `<div><b>${f.name}</b> doesn’t change over time</div><span>${others.length ? `${others.join(', ')} shown at <i id="static-year">${Math.floor(state.time)}</i> · Space to play` : 'Pick a timeline layer to travel through history'}</span>`;
  }
  const [a, b] = l.range;
  const s = scrub();
  s.min = String(a);
  s.max = String(b);
  s.step = l.monthly ? String(1 / 12) : '0.01';
  $('t-min').textContent = String(Math.floor(a));
  $('t-max').textContent = l.now ? 'Now' : String(Math.floor(b));
  $('t-label').textContent = l.name;
  drawSpark();
  drawEvents();
}

function drawSpark() {
  const l = timeLayer();
  const cv = $<HTMLCanvasElement>('spark');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  if (!l.available) return;
  const pts = l.spark();
  if (!pts.length) return;
  const [a, b] = l.range;
  const x = (v: number) => ((v - a) / (b - a)) * w;
  // between the archive's last year and today: hatched, "no record yet", up to the first day of the daily record
  if (l.now && l.now.archiveEnd < b) {
    const first = l.now.recent?.first() ?? null;
    const x0 = x(l.now.archiveEnd), x1 = first != null ? x(first) : w;
    g.save();
    g.beginPath();
    g.rect(x0, 0, x1 - x0, h);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    for (let i = x0 - h; i < x1; i += 5) { g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke(); }
    g.restore();
    g.fillStyle = l.color;
    g.globalAlpha = 0.9;
    g.fillRect(w - 2, 0, 2, h);
    g.globalAlpha = 1;
    // the daily record: a dashed line on its own scale (provisional, never part of the record's bars); a missing day breaks it
    const rp = l.now.recent?.spark() ?? [];
    if (rp.length) {
      const rmax = Math.max(...rp.map((p) => p.y)) || 1;
      const yy = (v: number) => h - 2 - (v / rmax) * (h * 0.7);
      g.save();
      g.strokeStyle = l.color;
      g.globalAlpha = 0.9;
      g.lineWidth = 1.2;
      g.setLineDash([3, 2]);
      g.beginPath();
      rp.forEach((p, i) => { const gap = i === 0 || p.x - rp[i - 1].x > 1.5 / 365.25; if (gap) g.moveTo(x(p.x), yy(p.y)); else g.lineTo(x(p.x), yy(p.y)); });
      g.stroke();
      // a lone day still shows as a dot
      rp.forEach((p, i) => { const alone = (i === 0 || p.x - rp[i - 1].x > 1.5 / 365.25) && (i === rp.length - 1 || rp[i + 1].x - p.x > 1.5 / 365.25); if (alone) g.fillRect(x(p.x) - 1, yy(p.y) - 1, 2, 2); });
      g.restore();
    }
  }
  // past the record: model output (plan 3b). Hatched in the projection's red, with each scenario's range as a band on
  // its own scale (a projection runs far past the record's few degrees), never as a line
  if (l.projection) {
    const x0 = x(l.projection.from);
    g.save();
    g.beginPath();
    g.rect(x0, 0, w - x0, h);
    g.clip();
    g.strokeStyle = 'rgba(255,120,130,0.22)';
    g.lineWidth = 1;
    for (let i = x0 - h; i < w; i += 5) { g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke(); }
    const bands = l.projection.bands();
    const bmax = Math.max(...bands.flatMap((b) => b.pts.map((p) => Math.abs(p.hi)))) || 1;
    const yy = (v: number) => h / 2 + 1 - (v / bmax) * (h / 2 - 2);
    for (const b of bands) {
      if (!b.pts.length) continue;
      g.beginPath();
      b.pts.forEach((p, i) => (i ? g.lineTo(x(p.x), yy(p.hi)) : g.moveTo(x(p.x), yy(p.hi))));
      [...b.pts].reverse().forEach((p) => g.lineTo(x(p.x), yy(p.lo)));
      g.closePath();
      g.fillStyle = b.color;
      g.globalAlpha = 0.35;
      g.fill();
    }
    g.restore();
    g.globalAlpha = 1;
  }
  const max = Math.max(...pts.map((p) => Math.abs(p.y))) || 1;
  const diverging = pts.some((p) => p.y < 0);
  const step = l.monthly ? 1 / 12 : 1;
  const bw = Math.max(1, (w / ((b - a) / step)) - (l.monthly ? 0.3 : 1));
  for (const p of pts) {
    const past = p.x <= state.time;
    g.fillStyle = p.color ?? l.color;
    g.globalAlpha = past ? 0.95 : 0.3;
    if (diverging) {
      const mid = h / 2 + 1;
      const hh = (Math.abs(p.y) / max) * (h / 2 - 2);
      g.fillRect(x(p.x), p.y >= 0 ? mid - hh : mid, bw, Math.max(1, hh));
    } else {
      const hh = (p.y / max) * (h - 4);
      g.fillRect(x(p.x), h - hh, bw, Math.max(p.y > 0 ? 1 : 0, hh));
    }
  }
  g.globalAlpha = 1;
}

function drawEvents() {
  const l = timeLayer();
  const [a, b] = l.range;
  const el = $('events');
  el.innerHTML = '';
  for (const ev of events) {
    if (ev.t < a || ev.t > b || (ev.layer !== '*' && ev.layer !== l.id)) continue;
    const d = document.createElement('div');
    d.className = 'ev';
    d.style.left = `${((ev.t - a) / (b - a)) * 100}%`;
    d.style.background = ev.layer === '*' ? '#fff' : byId[ev.layer].color;
    d.title = ev.title;
    d.addEventListener('click', () => openEvent(ev));
    el.appendChild(d);
  }
}

function setTime(t: number) {
  const [a, b] = timeLayer().range;
  state.time = clamp(t, a, b);
}

function setPlaying(p: boolean) {
  state.playing = p;
  $('play').classList.toggle('playing', p);
  $('play').setAttribute('aria-label', p ? 'Pause' : 'Play');
  if (p) {
    const [a, b] = timeLayer().range;
    if (state.time >= b - 0.01) state.time = a;
  }
}

let lastSparkYear = -1;
function syncTimelineUI() {
  const l = timeLayer();
  const [a, b] = l.range;
  const s = scrub();
  if (document.activeElement !== s || state.playing) s.value = String(state.time);
  s.style.setProperty('--p', `${((state.time - a) / (b - a)) * 100}%`);
  const atNow = !!l.now && isNow(state.time, b);
  const gap = !!l.now && !atNow && state.time > l.now.archiveEnd;
  const rec = gap ? l.now!.recent : undefined;
  const first = rec?.first() ?? null;
  // inside the daily record: the day and a provisional badge; a day it lacks is a gap, before it "no record yet"
  const recorded = !!rec && first != null && state.time >= first;
  const projected = !!l.projection && state.time >= l.projection.from;
  $('year').textContent = atNow ? 'Now' : String(Math.floor(state.time));
  $('month').classList.toggle('proj', projected);
  $('month').textContent = atNow ? '' : projected ? 'projection, not a record' : recorded ? (rec!.covers(state.time) ? `${tDay(state.time).slice(5)} · provisional` : 'no reading') : gap ? 'no record yet' : l.monthly || state.speed <= 1 ? MONTHS[Math.floor((state.time % 1) * 12)] : '';
  $('month').classList.toggle('prov', recorded && rec!.covers(state.time));
  const y = Math.floor(state.time * (l.monthly ? 12 : 1));
  if (y !== lastSparkYear) {
    lastSparkYear = y;
    drawSpark();
    const sy = document.getElementById('static-year');
    if (sy) sy.textContent = String(Math.floor(state.time));
  }
}

// ---------------------------------------------------------------------------------------------
// historic events: a one-line ticker on the timeline while it plays; the full story opens in the side panel

let tickerTimer = 0;
/** Announces an event the timeline just crossed: a line above the timeline (with Details) and a shockwave on the map. */
function ticker(ev: TimedEvent) {
  const el = $('event-ticker');
  el.style.setProperty('--c', eventColor(ev, byId));
  el.replaceChildren();
  // Event text is plain (some of it built from data, like quake places), so it goes in as text.
  const date = Object.assign(document.createElement('span'), { className: 'et-date', textContent: eventDate(ev.t) });
  const title = Object.assign(document.createElement('span'), { className: 'et-title', textContent: ev.title });
  const more = Object.assign(document.createElement('button'), { className: 'et-more', textContent: 'Details ›' });
  more.addEventListener('click', () => openEvent(ev));
  el.append(date, title, more);
  el.hidden = false;
  el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  clearTimeout(tickerTimer);
  tickerTimer = window.setTimeout(() => { el.hidden = true; }, 7000);
  if (ev.lon != null) state.beacons.push({ ev, born: performance.now() });
}

let eventReturn: { label: string; go: () => void } | null = null;
/** Opens an event in the side panel: the timeline stops at its date, the map flies to it. */
function openEvent(ev: AtlasEvent) {
  // remember where we came from the first time, so Back skips over events visited on the way
  if (state.mode !== 'event') {
    const from = state.mode, key = state.selected;
    eventReturn = from === 'town' && key ? { label: data.munis.find((m) => m.key === key)?.name ?? 'Town report', go: () => openTown(key) }
      : from === 'finder' ? { label: 'Town Finder', go: () => openFinder() }
      : { label: state.focused === 'province' ? 'Back to the map' : focusedLayer().name, go: () => showLayerPanel() };
  }
  setPlaying(false);
  // a moment moves the timeline to its date; a place (a gauge, a station) leaves it where it is
  if (ev.t != null) setTime(ev.t + 0.001);
  $('event-ticker').hidden = true;
  state.mode = 'event';
  state.event = ev;
  if (ev.lon != null) {
    if (ev.t != null) state.beacons.push({ ev: ev as TimedEvent, born: performance.now() });
    map.flyTo({ center: [ev.lon, ev.lat!], zoom: ev.zoom ?? 7.5, pitch: Math.max(map.getPitch(), 40), duration: 1600, essential: true });
  }
  swapPanel(() => {
    panelHandle = null;
    const p = $('panel');
    p.style.setProperty('--c', eventColor(ev, byId));
    renderEventPanel(p, ev, {
      data, byId, events, backLabel: eventReturn?.label ?? 'Back to the map',
      onBack: () => { state.event = null; const r = eventReturn; eventReturn = null; (r?.go ?? showLayerPanel)(); },
      onOpen: openEvent, onShow: showEvent, onTown: openTown,
    });
  });
}

/** "Show it on the map": the event's layers go on (the first becomes the active one if it isn't), at the event's date. */
function showEvent(ev: AtlasEvent) {
  const ids = eventLayers(ev, byId);
  if (!ids.length) return;
  for (const id of ids) state.visible.add(id);
  if (!ids.includes(state.focused)) focus(ids[0], true);
  else { renderLayerMenu(); setupTimeline(); }
  if (ev.t != null) setTime(ev.t + 0.001);
  if (ev.lon != null) map.flyTo({ center: [ev.lon, ev.lat!], zoom: ev.zoom ?? 7.5, duration: 1200, essential: true });
}

function fireCrossedEvents(prev: number, now: number) {
  if (now <= prev || now - prev > 1.5) return;
  // province-wide events only pop up while some history layer is on the map
  const anyTime = layers.some((l) => !l.static && l.available && state.visible.has(l.id));
  for (const ev of events) {
    if (ev.t > prev && ev.t <= now && (ev.layer === '*' ? anyTime : state.visible.has(ev.layer))) ticker(ev);
  }
}

// ---------------------------------------------------------------------------------------------
// main loop

let lastFrame = performance.now();
let lastPanel = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.playing) {
    const prev = state.time;
    const [, b] = timeLayer().range;
    state.time = Math.min(b, state.time + dt * state.speed);
    fireCrossedEvents(prev, state.time);
    if (state.time >= b) setPlaying(false);
  }
  render();
  syncTimelineUI();
  if (panelHandle && now - lastPanel > 90) { lastPanel = now; panelHandle.update(ctx()); }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------------------

function bindControls() {
  $('play').addEventListener('click', () => setPlaying(!state.playing));
  scrub().addEventListener('input', () => { state.time = +scrub().value; });
  scrub().addEventListener('pointerdown', () => setPlaying(false));
  $<HTMLSelectElement>('speed-sel').addEventListener('change', (e) => { state.speed = +(e.target as HTMLSelectElement).value; });
  $('finder-btn').addEventListener('click', () => { state.mode === 'finder' ? closeFinder() : openFinder(); });
  $('about-btn').addEventListener('click', showSources);
  $('layers-btn').addEventListener('click', () => setMenu(!menuOpen()));
  $('panel-btn').addEventListener('click', () => setPanelOpen($('panel').classList.contains('collapsed')));
  document.addEventListener('pointerdown', (e) => { if (menuOpen() && !(e.target as HTMLElement).closest('.layer-picker')) setMenu(false); });
  window.addEventListener('resize', () => { drawSpark(); });
  window.addEventListener('keydown', (e) => {
    if (sourcesOpen() || (e.target as HTMLElement).matches('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
    const step = timeLayer().monthly ? 1 / 12 : 1;
    if (e.key === 'ArrowRight') { setPlaying(false); setTime(Math.floor(state.time / step + 1e-6) * step + step); }
    if (e.key === 'ArrowLeft') { setPlaying(false); setTime(Math.ceil(state.time / step - 1e-6) * step - step); }
    if (e.key === 'Escape') { if (menuOpen()) { setMenu(false); $('layers-btn').focus(); } else $('modal').hidden = true; }
    if (e.key === 'l' || e.key === 'L') setMenu(!menuOpen());
    if (e.key === 'p' || e.key === 'P') setPanelOpen($('panel').classList.contains('collapsed'));
    if (e.key === 's' || e.key === 'S') showSources();
  });
}

function showSources() {
  setPlaying(false);
  setMenu(false);
  openSources(data, { onShow: focus });
}

// ---------------------------------------------------------------------------------------------
// what-if scenarios (src/scenario.ts): a banner on the map while any closure is on, until it is cleared

function renderScenarioBanner() {
  const b = $('scenario-banner');
  const kinds = (Object.keys(SCENARIO_LABEL) as ScenarioKind[]).filter((k) => scenarioOn(k));
  b.hidden = !kinds.length;
  if (!kinds.length) return;
  const names = kinds.flatMap((k) => closedSites(k).map((c) => c.name));
  b.innerHTML = `<span class="sc-tag">Scenario</span><button class="sb-txt" title="Open the layer this scenario is on">What if ${names.map((n) => `<b>${esc(n)}</b>`).join(' and ')} closed?<small>your choice, not an announced plan · drive times only</small></button><button class="sb-clear">Clear</button>`;
  b.querySelector('.sb-txt')!.addEventListener('click', () => { const id = SCENARIO_LABEL[kinds[0]].layer; if (byId[id]?.available) { if (state.mode === 'finder') closeFinder(); focus(id); } });
  b.querySelector('.sb-clear')!.addEventListener('click', clearScenario);
}

function onScenario(kind: ScenarioKind | null) {
  renderScenarioBanner();
  // the Town Report and the Finder show real values only: leave them alone
  if (state.mode === 'finder' || state.mode === 'town') return;
  const id = kind ? SCENARIO_LABEL[kind].layer : null;
  // a closure opens (or redraws) its layer's panel, where the affected towns are listed
  if (id && byId[id]?.available) focus(id);
  else if (state.mode === 'layer' && Object.values(SCENARIO_LABEL).some((x) => x.layer === state.focused)) showLayerPanel();
}

async function boot() {
  data = await loadAll();
  layers = buildLayers(data);
  byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  events = [...layers.flatMap((l) => (l.available ? l.events() : [])), ...CURATED_EVENTS].sort((a, b) => a.t - b.t);
  state.timeLayer = 'crime';
  state.time = byId.crime.range[0];
  initMap();
  bindControls();
  // a daily record arriving redraws the sparkline (its dashed line, the hatch's new end)
  onHistory(() => drawSpark());
  focus('province');
  requestAnimationFrame(frame);
  // a report's link to a layer opens it at today, where its story ends
  window.addEventListener('atlas:layer', (e) => {
    const id = (e as CustomEvent).detail; const l = byId[id]; if (!l?.available) return;
    // a link out of the Town Finder (Workday Reach) leaves the Finder for the layer's own story
    if (state.mode === 'finder') { state.mode = 'layer'; state.ranked = null; $('finder-btn').classList.remove('active'); }
    focus(id); if (!l.static) setTime(l.range[1]);
  });
  // a layer's link into the Town Finder (Workday Reach's "Change what matters")
  window.addEventListener('atlas:finder', () => { if (state.mode !== 'finder') openFinder(); });
  // a layer's own list opening one of its features (Floodplains' study list)
  window.addEventListener('atlas:event', (e) => { const ev = (e as CustomEvent).detail as AtlasEvent; if (ev?.title) openEvent(ev); });
  // a layer asking the camera to frame something (Weekend Reach framing the campgrounds a place can reach)
  window.addEventListener('atlas:fly', (e) => {
    const b = (e as CustomEvent).detail?.bounds as [[number, number], [number, number]] | undefined;
    if (!b) return;
    const right = $('panel').classList.contains('collapsed') ? 60 : Math.min(440, $('panel').offsetWidth + 40);
    map.fitBounds(b, { padding: { top: 90, bottom: 150, left: 60, right }, maxZoom: 9, pitch: 50, bearing: map.getBearing(), duration: 1800, essential: true });
  });
  window.addEventListener('atlas:scenario', (e) => onScenario((e as CustomEvent).detail as ScenarioKind | null));
  window.addEventListener('atlas:town', (e) => { const k = (e as CustomEvent).detail; if (data.munis.some((m) => m.key === k)) openTown(k); });
  if (location.hash === '#sources') showSources();
  for (const id of ['crime', 'justice', 'treaties', 'fires', 'tornadoes', 'camping', 'commute']) if (location.hash === `#${id}`) map.once('load', () => setTimeout(() => focus(id), 600));
  // The explainer video (video/render.py) drives the atlas through this handle; only set with ?film.
  if (new URLSearchParams(location.search).has('film'))
    (window as any).atlas = { map, state, data, layers, focus, clearMap, openTown, openFinder, setPlaying, setTime, setPanelOpen, setMenu, showSources, HOME, setClosed, clearScenario };
}

boot();
