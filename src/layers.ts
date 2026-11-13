// The layer registry: every atlas layer in menu order, and the province outline under them all.
import { Data } from './data';
import { AtlasLayer, kicker } from './layer-kit';
import { crimeLayer } from './crime';
import { justiceLayer } from './justice';
import { treatiesLayer } from './treaties';
import { firesLayer } from './fires';
import { tornadoLayer } from './tornado';
import { hailLayer } from './hail';
import { riversLayer } from './rivers';
import { climateLayer } from './climate';
import { smokeLayer } from './smoke';
import { droughtLayer } from './drought';
import { cropsLayer } from './crops';
import { normalsLayer } from './normals';
import { lightLayer } from './light';
import { populationLayer } from './population';
import { housingLayer } from './housing';
import { jobsLayer } from './jobs';
import { needsLayer } from './needs';
import { schoolsLayer } from './schools';
import { internetLayer } from './internet';
import { communityLayer } from './community';
import { newcomerLayer } from './newcomer';
import { transitLayer } from './transit';
import { childcareLayer } from './childcare';
import { industryLayer } from './industry';
import { waterLayer } from './water';
import { radonLayer } from './radon';
import { hospitalsLayer } from './hospitals';
import { doctorsLayer } from './doctors';
import { campingLayer } from './camping';
import { commuteLayer } from './commute';

// JUST THE PROVINCE — the plain map the atlas opens on, with nothing overlaid
function provinceLayer(data: Data): AtlasLayer {
  const l: AtlasLayer = {
    id: 'province',
    name: 'Just the province',
    icon: '◌',
    color: '#4cc9f0',
    range: [1900, 2026],
    static: true,
    period: 'no data overlaid',
    available: true,
    build: () => [],
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Start here')}
        <h2>Saskatchewan, plain</h2>
        <p class="lede">Nothing is overlaid yet. The dots are the ${data.munis.length} cities, towns and northern villages in the atlas.</p>
        <ol class="howto">
          <li><b>Click a town dot</b> for its report card: crime, the drive to court, police and hospital, hazards and climate.</li>
          <li><b>Layer</b> (top left, or press <kbd>L</kbd>): flip a switch to put a data set on the map, and click its name for its story and timeline. <i>Clear the map</i> turns them all off.</li>
          <li>On a history layer, press <b>▶</b> (or <kbd>Space</kbd>) on the timeline to play the years.</li>
          <li><b>Town Finder</b> ranks places by what matters to you.</li>
          <li><b>Data &amp; sources</b> shows where every number comes from.</li>
        </ol>
        <p class="note">Drag to pan, scroll to zoom, right-drag (or Ctrl-drag) to tilt and turn the map.</p>`;
      return { update() {} };
    },
    tooltip: () => null,
  };
  return l;
}

export function buildLayers(data: Data): AtlasLayer[] {
  return [provinceLayer(data), crimeLayer(data), justiceLayer(data), treatiesLayer(data), firesLayer(data), tornadoLayer(data), hailLayer(data), riversLayer(data), climateLayer(data), smokeLayer(data), droughtLayer(data), cropsLayer(data), normalsLayer(data), lightLayer(data), populationLayer(data), housingLayer(data), jobsLayer(data), needsLayer(data), schoolsLayer(data), internetLayer(data), communityLayer(data), newcomerLayer(data), transitLayer(data), childcareLayer(data), industryLayer(data), waterLayer(data), radonLayer(data), hospitalsLayer(data), doctorsLayer(data), campingLayer(data), commuteLayer(data)];
}
