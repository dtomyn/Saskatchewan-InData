// 3D CITIES: building footprints from the `buildings` stage's PMTiles file, drawn
// by MapLibre as plain extruded blocks past zoom 12 in the places with a Water Security Agency flood map and the two
// cities. With River floods on, the mapped 1:500-year extent is a sheet of water and the footprints touching it are
// tinted; the stage worked out which (tile attribute `f`), so the app does no geometry. Also 3D terrain, a map toggle.
import * as maplibregl from 'maplibre-gl';
import type { Protocol } from 'pmtiles';
import type { Buildings, Data } from './data';
import { esc } from './html';
import { fmt } from './data';
import { sourceLine } from './layer-kit';

const SRC = 'bldg';
/** a footprint with no height in OpenStreetMap stands one nominal storey */
const NOMINAL_M = 3.5;
const GREY = '#5f6779';
/** the tint: floodway, the rest of the 1:500-year extent, only behind dikes */
export const BLDG_TINT = { 1: '#7aa2ff', 2: '#b4f0ff', 3: '#c9b8ff' } as const;
const SHEET: Record<string, string> = { floodway: '#2a5ad8', fringe: '#2f7fd6', 500: '#3aa6e0', protected: '#8a90b0' };

let floodsShown: boolean | null = null;

/** Adds the buildings source and layers (and the PMTiles protocol). Nothing is fetched until the map passes zoom 12. */
export function initBuildings(map: maplibregl.Map, data: Data, beforeId?: string) {
  const B = data.buildings;
  if (!B) return;
  // the PMTiles reader is fetched with the first tile, so the first load carries none of it
  let protocol: Promise<Protocol> | null = null;
  maplibregl.addProtocol('pmtiles', async (params, abort) => {
    // a failed import (a network blip) is forgotten, so the next tile asks again
    protocol ??= import('pmtiles').then((m) => new m.Protocol()).catch((e) => { protocol = null; throw e; });
    return (await protocol).tile(params, abort);
  });
  const url = new URL(`data/${B.file}`, new URL(import.meta.env.BASE_URL, location.href)).href;
  map.addSource(SRC, {
    type: 'vector',
    // tile URLs, not a TileJSON url, so the archive's header is read on the first tile request and not at load
    tiles: [`pmtiles://${url}/{z}/{x}/{y}`],
    minzoom: B.minzoom,
    maxzoom: B.maxzoom,
    bounds: B.bounds,
    attribution: 'Buildings: Microsoft (ODbL), heights © OpenStreetMap',
  });
  map.addLayer({
    id: 'bldg-flood', type: 'fill', source: SRC, 'source-layer': 'flood', minzoom: B.minzoom,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': ['match', ['get', 'k'], 'floodway', SHEET.floodway, 'fringe', SHEET.fringe, 'protected', SHEET.protected, SHEET[500]],
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], B.minzoom, 0, B.minzoom + 0.5, 0.55],
      'fill-outline-color': '#9fe3ff',
    },
  }, beforeId);
  map.addLayer({
    id: 'bldg-3d', type: 'fill-extrusion', source: SRC, 'source-layer': 'buildings', minzoom: B.minzoom,
    paint: {
      'fill-extrusion-color': GREY,
      'fill-extrusion-height': ['coalesce', ['get', 'h'], NOMINAL_M],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], B.minzoom, 0, B.minzoom + 0.6, 0.88],
      'fill-extrusion-vertical-gradient': true,
    },
  }, beforeId);
  floodsShown = null;
}

/** River floods on: the water sheet shows and touching footprints take the tint. Cheap to call every frame. */
export function syncBuildings(map: maplibregl.Map, floodsOn: boolean) {
  if (floodsOn === floodsShown || !map.getLayer('bldg-3d')) return;
  floodsShown = floodsOn;
  map.setLayoutProperty('bldg-flood', 'visibility', floodsOn ? 'visible' : 'none');
  map.setPaintProperty('bldg-3d', 'fill-extrusion-color', floodsOn
    ? ['match', ['get', 'f'], 1, BLDG_TINT[1], 2, BLDG_TINT[2], 3, BLDG_TINT[3], GREY]
    : GREY);
}

/** terrain is raised only from this zoom: deck.gl's layers are drawn flat and slide off it at province scale */
export const TERRAIN_Z = 12;
const TERRAIN = { source: 'dem-terrain', exaggeration: 1.6 };
let terrainWanted = false;

/**
 * 3D terrain from the relief shading's elevation tiles, off by default. A map button like MapLibre's own, but the
 * terrain is raised only in close-ups (TERRAIN_Z and up): there the water sheet and the buildings are MapLibre's and
 * sit on it, while further out the deck.gl layers (columns, outlines, the flood extents) would float off the valleys.
 * Turning it on further out zooms in to where it shows.
 */
export function addTerrainControl(map: maplibregl.Map) {
  map.addSource('dem-terrain', {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    tileSize: 256,
    encoding: 'terrarium',
    maxzoom: 12,
  });
  const apply = () => {
    const on = terrainWanted && map.getZoom() >= TERRAIN_Z;
    if (on !== !!map.getTerrain()) map.setTerrain(on ? TERRAIN : null);
  };
  map.on('zoom', apply);
  map.addControl({
    onAdd() {
      const box = document.createElement('div');
      box.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'terrain-btn';
      b.className = 'maplibregl-ctrl-terrain';
      b.title = '3D terrain (in close-ups, past zoom 12)';
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = '<span class="maplibregl-ctrl-icon" aria-hidden="true"></span>';
      b.addEventListener('click', () => {
        terrainWanted = !terrainWanted;
        b.className = terrainWanted ? 'maplibregl-ctrl-terrain-enabled' : 'maplibregl-ctrl-terrain';
        b.setAttribute('aria-pressed', String(terrainWanted));
        if (terrainWanted && map.getZoom() < TERRAIN_Z) map.easeTo({ zoom: TERRAIN_Z + 0.6, pitch: Math.max(map.getPitch(), 60), duration: 1800, essential: true });
        apply();
      });
      box.append(b);
      return box;
    },
    onRemove() { /* never removed */ },
  }, 'top-right');
}

/** River floods' panel section: buildings per mapped community touching the extent, with a fly-to for each. */
export function buildingsSection(B: Buildings | null, returnPeriod: number) {
  if (!B) return '';
  const touch = (a: Buildings['areas'][number]) => a.way + a.ext;
  const rows = B.areas.filter((a) => touch(a) || a.prot).sort((a, b) => touch(b) - touch(a));
  const total = B.areas.reduce((s, a) => s + a.n, 0), inExt = B.areas.reduce((s, a) => s + touch(a), 0);
  const measured = B.areas.reduce((s, a) => s + a.h, 0);
  const max = Math.max(1, ...rows.map((a) => Math.max(touch(a), a.prot)));
  const sw = (c: string) => `<i class="sw" style="background:${c}"></i>`;
  return `<h3>Buildings in the mapped extent</h3>
    <p class="note" style="margin-top:0">Zoom past 12 into a mapped community, or Regina or Saskatoon, and buildings rise. Of ${fmt.int(total)} footprints there, <b>${fmt.int(inExt)}</b> touch the mapped 1:${returnPeriod}-year extent (tinted). Click a place to fly there.</p>
    <div class="legend">
      <span>${sw(BLDG_TINT[1])}touches the floodway</span><span>${sw(BLDG_TINT[2])}touches the rest of the extent</span><span>${sw(BLDG_TINT[3])}only on land behind dikes</span><span>${sw(GREY)}outside it</span>
    </div>
    <ol class="rank-list bldg-list">${rows.map((a, i) => `<li data-area="${esc(a.name)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(a.name)}</span><br><span class="rd">of ${fmt.int(a.n)} buildings${a.way ? ` · ${fmt.int(a.way)} on the floodway` : ''}${a.prot ? ` · ${fmt.int(a.prot)} only behind dikes` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((Math.max(touch(a), a.prot) / max) * 100)}%;background:${touch(a) ? BLDG_TINT[a.way ? 1 : 2] : BLDG_TINT[3]}"></i></div><div class="bar-v">${fmt.int(touch(a) || a.prot)}</div></span></li>`).join('')}</ol>
    <p class="note">Touching the mapped extent is not “will flood”: floor heights, basements and defences are not in the data, and a building in a community with no flood map is unmapped, not safe. The count is this atlas’s own working: a footprint counts when any part of it meets the agency’s outline. Footprints are machine-drawn from imagery (${esc(B.source.split(',')[0])}), so some sheds are missing and some joined. Only ${fmt.int(measured)} carry a height from OpenStreetMap (a storey count is taken as ${B.storey} m each); every other building is drawn one nominal storey high, so the skyline is not measured. At zoom 12 only footprints over ${B.z12Min} m² are drawn.</p>
    ${sourceLine(`${B.source}, ${B.licence}; heights: ${B.heights}. Read ${B.asOf}.`)}`;
}

/** Wires the section's list: a click flies to that community's flood extent, close enough for buildings. */
export function wireBuildingsList(el: HTMLElement, B: Buildings | null, floodCentre: (place: string) => [number, number] | null) {
  if (!B) return;
  el.querySelector('.bldg-list')?.addEventListener('click', (e) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>('li')?.dataset.area;
    const a = B.areas.find((x) => x.name === name);
    if (!a) return;
    const centre = floodCentre(a.name) ?? [(a.box[0] + a.box[2]) / 2, (a.box[1] + a.box[3]) / 2];
    window.dispatchEvent(new CustomEvent('atlas:fly', { detail: { center: centre, zoom: 14.2 } }));
  });
}
