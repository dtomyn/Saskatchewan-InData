// RADON — how common high indoor radon is, from Health Canada's Cross-Canada Survey of Radon Concentrations in Homes
// (long-term tests in about 1,200 Saskatchewan volunteer homes, 2009–2011). Areas are tinted by the share of tested homes
// at or above Canada's guideline, 200 Bq/m³: the survey's 2007 health regions (on the matching boundaries), or postal
// areas (FSAs, on 2021 boundaries), where small samples are faded. A static layer: radon varies house by house, so only
// a long-term test of the home itself tells.
import * as d3 from 'd3';
import { PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Data, RadonArea } from './data';
import { rampCSS } from './charts';
import { esc, safeUrl } from './html';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine } from './layer-kit';
import { metric, link } from './report-kit';

export const RADON_COLOR = '#b48cff';
// low share stays dark and cool; a quarter or more of homes over the guideline glows
export const RADON_RAMP = d3.scaleSequential(d3.interpolateRgb('#24314d', '#ff7ab8')).domain([5, 30]).clamp(true);
export const share = (a: { n: number; hi: number }) => (a.n ? (a.hi / a.n) * 100 : 0);
export const shareText = (a: { n: number; hi: number }) => `${Math.round(share(a))}%`;

/** One place's radon figures: its 2007 health region, and its own postal area(s). `few`: under the survey's
 * small-sample line. */
export type PlaceRadon = {
  region: { name: string; n: number; hi: number; pct: number };
  fsa: { ids: string[]; n: number; hi: number; pct: number; few: boolean } | null;
};
export function placeRadon(data: Data, key: string): PlaceRadon | null {
  const R = data.radon;
  const t = R?.towns[key];
  if (!R || !t || !R.regions[t.r]) return null;
  const r = R.regions[t.r];
  return {
    region: { name: r.name ?? r.id, n: r.n, hi: r.hi, pct: share(r) },
    fsa: t.fn != null && t.f.length ? { ids: t.f, n: t.fn, hi: t.fhi ?? 0, pct: share({ n: t.fn, hi: t.fhi ?? 0 }), few: t.fn < R.few } : null,
  };
}

type Mode = 'hr' | 'fsa';

export function radonLayer(data: Data): AtlasLayer {
  const color = RADON_COLOR;
  const R = data.radon;
  const regions = R?.regions ?? [];
  const fsas = R?.fsas ?? [];
  type Poly = { a: RadonArea; poly: [number, number][][]; fsa: boolean };
  const hrPolys: Poly[] = regions.flatMap((a) => a.polys.map((poly) => ({ a, poly, fsa: false })));
  // rural FSAs first so the small urban ones draw on top
  const fsaPolys: Poly[] = [...fsas].sort((a, b) => Number(a.urban) - Number(b.urban)).flatMap((a) => a.polys.map((poly) => ({ a, poly, fsa: true })));
  let mode: Mode = 'hr';
  const few = (a: RadonArea) => !!R && a.n < R.few;
  const hrName = (id: string | null | undefined) => regions.find((r) => r.id === id)?.name ?? null;

  const l: AtlasLayer = {
    id: 'radon',
    name: 'Radon',
    icon: '☢',
    color,
    range: [2009, 2011.99],
    static: true,
    period: 'homes tested 2009–2011',
    available: regions.length > 0,
    unavailable: 'Health Canada’s radon survey could not be downloaded when this copy of the data was built. Run <code>npm run data radon</code>, then reload.',
    build({ focusedId }) {
      const focused = focusedId === 'radon';
      const data = mode === 'hr' ? hrPolys : fsaPolys;
      const out: Layer[] = [
        new PolygonLayer<Poly>({
          id: 'radon-base',
          data,
          getPolygon: (d) => d.poly,
          getFillColor: (d) => rgb(RADON_RAMP(share(d.a)), few(d.a) ? (focused ? 45 : 30) : (focused ? 140 : 95)),
          getLineColor: (d) => (d.fsa && d.a.urban ? [230, 240, 255, 90] : [230, 240, 255, 150]),
          lineWidthUnits: 'pixels',
          getLineWidth: (d) => (d.fsa ? 0.8 : 1.2),
          pickable: true,
          parameters: NO_DEPTH,
          updateTriggers: { getFillColor: [focused, mode] },
        } as any),
      ];
      if (focused && mode === 'hr')
        out.push(new TextLayer<RadonArea>({
          id: 'radon-labels', data: regions, getPosition: (r) => r.c,
          getText: (r) => `${r.id === '4714' ? 'North' : r.name ?? r.id}\n${shareText(r)}`,
          getSize: 13, getColor: [240, 244, 252, 240], fontFamily: 'Inter, sans-serif', fontWeight: 700,
          outlineWidth: 4, outlineColor: [6, 10, 18, 235], fontSettings: { sdf: true }, characterSet: 'auto',
          parameters: { depthCompare: 'always' },
        } as any));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Around the property · Health Canada')}
        <h2>Is there radon in the basement?</h2>`;
      if (!R) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const P = R.prov;
      const worst = [...regions].sort((a, b) => share(b) - share(a))[0];
      el.insertAdjacentHTML('beforeend', `<p class="lede">Radon is a colourless, odourless radioactive gas that seeps out of the ground into basements, and the leading cause of lung cancer in people who have never smoked. Health Canada tested <b>${P.n.toLocaleString('en-CA')}</b> Saskatchewan homes, most for three months or more, in ${esc(R.years)}. Areas are tinted by the share of tested homes at or above Canada’s guideline of ${R.guide} Bq/m³.</p>
        <div class="callout" style="--c:${color}"><b>A map can’t tell you about your house.</b> Radon varies from house to house, even next door. The only way to know is a long-term test (at least three months, ideally over the heating season) in the lowest lived-in level. <a href="${esc(safeUrl(R.testUrl) ?? '#')}" target="_blank" rel="noopener">Health Canada</a> advises testing every home, wherever it is.</div>
        <div class="chips" style="margin:2px 0 10px"><button class="chip" data-m="hr" style="--c:${color}">Health regions</button><button class="chip" data-m="fsa" style="--c:${color}">Postal areas (FSA)</button></div>`);
      const hero = heroStats(el, 4);
      hero(0, shareText(P), `of tested homes at or above ${R.guide} Bq/m³`);
      hero(1, P.n.toLocaleString('en-CA'), `homes tested, ${R.years}`);
      hero(2, worst ? shareText(worst) : '–', worst ? `in ${worst.name}, the highest region` : 'highest region');
      hero(3, String(P.vhi), `homes at ${R.oldGuide} Bq/m³ or more (the old guideline)`);
      const rampBox = el.appendChild(mk('div'));
      const [a, b] = RADON_RAMP.domain();
      rampBox.innerHTML = `<h3>Share of tested homes at or above ${R.guide} Bq/m³</h3>
        <div class="ramp" style="background:${rampCSS((t) => RADON_RAMP(a + t * (b - a)))}"></div>
        <div class="ramp-labels"><span>${a}%</span><span>${(a + b) / 2}%</span><span>${b}%+</span></div>
        <div class="legend"><span><i class="sw" style="background:${RADON_RAMP(20)};opacity:.35"></i>faded: fewer than ${R.few} homes tested</span></div>`;
      const list = el.appendChild(mk('div'));
      const drawList = () => {
        // postal areas with few tests sink to the bottom, so a 3-of-6 doesn't top the list
        const rows = (mode === 'hr' ? regions : fsas).filter((x) => x.n).sort((x, y) => Number(few(x)) - Number(few(y)) || share(y) - share(x));
        list.innerHTML = `<h3>${mode === 'hr' ? 'Health regions (2007)' : 'Postal areas (FSA)'} · highest share first${mode === 'fsa' ? `, few tests last` : ''}</h3>
          <ol class="rank-list">${rows.map((x, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${esc(mode === 'hr' ? x.name ?? x.id : `${x.id}${x.urban ? '' : ' (rural)'}`)}</span><br><span class="rd">${x.hi} of ${x.n} homes${few(x) ? ' · few tests' : ''}${mode === 'fsa' && hrName(x.hr) ? ` · ${esc(hrName(x.hr)!)}` : ''}${x.med != null ? ` · median ${x.med} Bq/m³` : ''}</span></span><span><div class="bar"><i style="width:${Math.min(100, Math.round(share(x) / 0.4))}%;background:${RADON_RAMP(share(x))}"></i></div><div class="bar-v">${shareText(x)}</div></span></li>`).join('')}</ol>`;
      };
      drawList();
      el.insertAdjacentHTML('beforeend', `
        <p class="note"><b>What the numbers are.</b> Volunteer homes, about 100 per health region, each tested once (most for three months or more) in ${esc(R.years)}. Each share is a sample and moves by several points either way by chance; a region at 7% and one at 25% are genuinely different, two at 13% and 15% are not. Postal areas give a finer picture where many homes were tested (the rural FSAs, S0A–S0P), but most city FSAs had only a handful of tests: they are faded and flagged “few tests”. Results under 15 Bq/m³ (the detection limit) count as low.</p>
        <p class="note"><b>Boundaries.</b> The survey reports the 2007 health regions (the regional health authorities before the 2017 merger into one Saskatchewan Health Authority), drawn on Statistics Canada’s matching boundary file; it pooled the three northern regions (Mamawetan Churchill River, Keewatin Yatthé, Athabasca) into one. FSAs are drawn on 2021 boundaries, which may differ slightly from those of the test years. Each place takes the health region its centre lies in, and the city FSAs covering its town limits (else the rural FSA its centre is in).</p>
        <p class="note">Newer testing points higher: the Evict Radon national study (University of Calgary) reports about one Saskatchewan home in three over the guideline. Its data are not open, so this map uses Health Canada’s survey. Fixing high radon (usually a sub-slab depressurization system) typically costs a few thousand dollars; Health Canada advises fixing a home within two years when it tests above ${R.guide} Bq/m³, and within one year above ${R.oldGuide}.</p>
        ${sourceLine(`${R.source}. ${R.licence}.`)}${sourceLine(R.areaSource)}
        <p class="note"><a href="${esc(safeUrl(R.reportUrl) ?? '#')}" target="_blank" rel="noopener">Health Canada: final report</a> · <a href="${esc(safeUrl(R.url) ?? '#')}" target="_blank" rel="noopener">open data</a></p>`);
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m as Mode | undefined;
        if (!k || k === mode) return;
        mode = k;
        drawList();
        el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((btn) => btn.classList.toggle('on', btn.dataset.m === mode));
      });
      el.querySelector<HTMLButtonElement>(`[data-m="${mode}"]`)?.classList.add('on');
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('radon') || !R) return null;
      const o = info.object as Poly | RadonArea;
      const a = 'a' in o ? o.a : o;
      const row = (k: string, v: string) => `<br><span class="tk">${k}</span> <span class="tv">${v}</span>`;
      const isFsa = 'fsa' in o ? o.fsa : false;
      return `<b>${esc(isFsa ? `Postal area ${a.id}` : a.name ?? a.id)}</b>`
        + row(`At or above ${R.guide} Bq/m³`, `${shareText(a)} (${a.hi} of ${a.n} homes)`)
        + (a.med != null ? row('Median home', `${a.med} Bq/m³`) : '')
        + (few(a) ? '<br><span class="tk">few tests: a rough figure</span>' : '')
        + (isFsa && hrName(a.hr) ? `<br><span class="tk">most tests in ${esc(hrName(a.hr)!)}</span>` : '')
        + '<br><span class="tk">Only a long-term test tells for a given house</span>';
    },
  };
  return l;
}

// ---- the Town Report section (src/panels.ts places it)

/** Radon: the share of tested homes at or above the guideline in the place's 2007 health region and in its own postal
 * area(s), from Health Canada's survey. A regional odds, never a verdict on a house. */
export function radonRows(p: PlaceRadon, data: Data) {
  const R = data.radon!;
  const f = p.fsa;
  return `<h3>Radon</h3>
    <div class="metric-grid">
      ${metric('Radon', RADON_RAMP(p.region.pct), `${Math.round(p.region.pct)}%`, `of ${p.region.n} homes tested in the ${esc(p.region.name)} health region were at or above ${R.guide} Bq/m³ (${esc(R.years)})`)}
      ${f ? metric(`Postal area${f.ids.length > 1 ? 's' : ''}`, RADON_RAMP(f.pct), `${Math.round(f.pct)}%`, `${f.hi} of ${f.n} homes tested in ${esc(f.ids.join(', '))}${f.few ? ' · <b>few tests</b>: a rough figure' : ''}`) : ''}
    </div>
    <p class="note" style="margin-top:6px">Radon varies from house to house; the only way to know is a long-term test (three months or more) in the home itself, which Health Canada advises for every home. Survey of volunteer homes, ${esc(R.years)}.</p>
    <div class="tr-falls" style="margin-top:8px">${link('radon', '☢ Radon on the map')}</div>`;
}
