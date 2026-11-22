// What the Soil layer loads the first time the map is close enough for its polygons: deck.gl's MVTLayer, the PMTiles
// reader and loaders.gl's vector-tile parser. Named imports in a module of their own (imported lazily by soil.ts) let
// the bundler leave out the rest of @deck.gl/geo-layers, whose 3D-tile decoders compile WebAssembly as they load and
// so break the site's CSP (script-src 'self').
export { MVTLayer } from '@deck.gl/geo-layers';
export { PMTiles } from 'pmtiles';
export { parse } from '@loaders.gl/core';
export { MVTLoader } from '@loaders.gl/mvt';
