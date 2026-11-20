// WILDFIRES — the Canadian National Fire Database's start points, and the National Burned Area Composite's mapped
// outlines. A fire of 200 ha or more that NBAC outlines (1972 on) is drawn as its outline; every other fire's scar is
// a circle with the same area as the fire, so the burned country is to scale either way. The tooltip says which.
import { ScatterplotLayer, PathLayer, PolygonLayer, LineLayer } from '@deck.gl/layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import * as d3 from 'd3';
import { Data, FirePoint, BurnPerimeter, lowerBound, Hotspot, fmt, FirePerimeter } from './data';
import { AtlasLayer, Ctx, rgb, RecentSpan, filterExt, NO_DEPTH, ADDITIVE, dashExt, glowWindow, RGBA, nearestTown, kicker, heroStats, deferChart, mk, sourceLine, isoDate } from './layer-kit';
import { HistHotspot, firesHistory, dayT, tDay, DAY_T, dayText, FireSeason, fireSeason, fireSeasonYears } from './history';
import { reducedMotion } from './particles';
import { airLayers, airPanel, airTooltip } from './wind';
import { ms, freshness, plainAge, provinceOutlook, alertList, alertsInEffect, nowBlock, NOW_T, drawable, alertOutlines, tickAges, isNow, alertEvent, ago, skTime, alertTooltip } from './now';
import { barChart } from './charts';
import { safeUrl, esc } from './html';

// ---- the replay's estimated spread
const filter2 = [new DataFilterExtension({ filterSize: 2 })];
/** grid cells of about 2.2 km (the longitude step is right near 55° N) */
const SPREAD_DX = 0.035, SPREAD_DY = 0.02;
/** a patch needs this many cells (about 30 km²) before it gets an edge, so a lone flare or field burn gets none */
const SPREAD_MIN = 6;
/** one side of a lit cell: drawn from when the cell first lit (`from`) until the cell across it lights (`to`) */
type SpreadEdge = { p: [number, number]; q: [number, number]; from: number; to: number };
/**
 * The edge of the ground where hotspots have been seen, as it grows: hotspots are dropped on a grid, each cell keeps
 * the time it first lit, and a cell's side is an edge while the cell across it has not lit. Each side is drawn short of
 * its corners, so the edge reads as dashes: an estimate, never a mapped perimeter. `pts` must be in time order.
 */
function spreadEdges(pts: HistHotspot[]): SpreadEdge[] {
  const key = (ix: number, iy: number) => ix * 4096 + iy;
  const first = new Map<number, number>();
  for (const p of pts) {
    const k = key(Math.floor((p[0] + 112) / SPREAD_DX), Math.floor((p[1] - 48) / SPREAD_DY));
    if (!first.has(k)) first.set(k, p[2]);
  }
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const seen = new Set<number>();
  const out: SpreadEdge[] = [];
  for (const k0 of first.keys()) {
    if (seen.has(k0)) continue;
    // the patch this cell belongs to by the end of the season (cells sharing a side)
    const patch = [k0];
    seen.add(k0);
    for (let i = 0; i < patch.length; i++) {
      const ix = Math.floor(patch[i] / 4096), iy = patch[i] % 4096;
      for (const [dx, dy] of NB) { const k = key(ix + dx, iy + dy); if (first.has(k) && !seen.has(k)) { seen.add(k); patch.push(k); } }
    }
    if (patch.length < SPREAD_MIN) continue;
    for (const k of patch) {
      const ix = Math.floor(k / 4096), iy = k % 4096, from = first.get(k)!;
      const x0 = ix * SPREAD_DX - 112, y0 = iy * SPREAD_DY + 48, x1 = x0 + SPREAD_DX, y1 = y0 + SPREAD_DY;
      const gx = SPREAD_DX * 0.2, gy = SPREAD_DY * 0.2;
      for (const [dx, dy] of NB) {
        const to = first.get(key(ix + dx, iy + dy)) ?? Infinity;
        if (to <= from) continue;
        out.push(dx ? { p: [dx > 0 ? x1 : x0, y0 + gy], q: [dx > 0 ? x1 : x0, y1 - gy], from, to } : { p: [x0 + gx, dy > 0 ? y1 : y0], q: [x1 - gx, dy > 0 ? y1 : y0], from, to });
      }
    }
  }
  return out;
}

export function firesLayer(data: Data): AtlasLayer {
  const color = '#ff8a3d';
  const fires = data.fires;
  const points: FirePoint[] = fires?.points ?? [];
  const CAUSE = [
    { name: 'Lightning', c: '#ffe08a' },
    { name: 'Human', c: '#ff6a3d' },
    { name: 'Unknown', c: '#ffb36b' },
  ];
  const causeRGB = CAUSE.map((c) => rgb(c.c));
  const radiusM = (ha: number) => Math.sqrt((ha * 10000) / Math.PI);

  const countByYear: Record<number, number> = {};
  const haByYear: Record<number, number> = {};
  const causeByYear: Record<number, number[]> = {};
  for (const p of points) {
    const y = Math.floor(p[2]);
    countByYear[y] = (countByYear[y] ?? 0) + 1;
    haByYear[y] = (haByYear[y] ?? 0) + p[3];
    (causeByYear[y] ??= [0, 0, 0])[p[4]]++;
  }
  const y0 = Math.floor(points[0]?.[2] ?? 1959);
  const y1 = Math.floor(points.at(-1)?.[2] ?? 2025);
  const bySize = [...points].sort((a, b) => b[3] - a[3]);
  const rankOf = new Map(bySize.map((p, i) => [p, i + 1]));
  const fireName = (p: FirePoint) => (p[5] ? `the ${p[5].replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} fire` : null);
  // mapped outlines: each polygon its own row; a start point inside one is drawn by the outline, not a circle
  const perims: BurnPerimeter[] = fires?.perimeters ?? [];
  const outlined = new Set(perims.flatMap((b) => b[4]));
  const circles = points.filter((_, i) => !outlined.has(i));
  type PerimPoly = { b: BurnPerimeter; poly: [number, number][][] };
  const perimPolys: PerimPoly[] = perims.flatMap((b) => b[2].map((poly) => ({ b, poly })));
  const [py0, py1] = fires?.perimeterYears ?? [0, 0];
  /** the biggest start point inside an outline, for its name and cause */
  const mainPoint = (b: BurnPerimeter) => b[4].map((i) => points[i]).sort((a, c) => c[3] - a[3])[0] ?? null;
  // right now: CWFIS satellite hotspots of the last 24 hours and the perimeters it estimates from them
  const nowF = data.now.fires;
  const hotspots = nowF?.hotspots ?? [];
  const perimeters = nowF?.perimeters ?? [];
  const isLive = (id?: string) => !!id?.startsWith('fires-now');
  // the recent span: hotspots kept by the daily record since the archive's last year (heat, not fires; never in the fire statistics)
  const FFROM = y1 + 1;
  let fPts: HistHotspot[] | null = null;
  const fPoints = () => (fPts ??= firesHistory() ? firesHistory()!.points.filter((p) => p[2] >= FFROM) : null) ?? [];
  const fDays = () => (firesHistory()?.sorted ?? []).filter((d) => dayT(d) >= FFROM);
  const firesRecent: RecentSpan = {
    feed: 'fires', from: FFROM,
    first: () => { const d = fDays()[0]; return d ? dayT(d) : null; },
    covers: (t) => t >= FFROM && !!firesHistory()?.covered.has(tDay(t)),
    spark: () => fDays().map((d) => ({ x: dayT(d), y: firesHistory()!.perDay.get(d) ?? 0 })),
    build({ time, speed }) {
      const pts = fPoints();
      if (time < FFROM || !pts.length) return [];
      // about two weeks at 2 yr/s; never less than three days
      const W = Math.max(3 * DAY_T, speed * 0.02);
      const flash = pts.slice(lowerBound(pts, time - W, (p) => p[2]), lowerBound(pts, time, (p) => p[2]));
      return [
        new ScatterplotLayer<HistHotspot>({
          id: 'fires-hist-dots',
          data: pts,
          getPosition: (d) => [d[0], d[1]],
          getRadius: 900,
          radiusMinPixels: 1,
          getFillColor: [255, 214, 140, 60],
          extensions: filterExt,
          getFilterValue: (d) => d[2],
          filterRange: [FFROM, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<HistHotspot>({
          id: 'fires-hist-flash',
          data: flash,
          getPosition: (d) => [d[0], d[1]],
          getRadius: (d) => 2500 + Math.sqrt(d[3] ?? 1) * 900,
          radiusMinPixels: 2,
          getFillColor: (d) => [255, 236, 150, 255 * (1 - (time - d[2]) / W) ** 1.5],
          updateTriggers: { getFillColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
  };
  // ---- the season replay (plans/wow/3): one season of the daily record, 1 April to 31 October, played in ~40 s.
  // Times go to the GPU as days since the season began (a float holds a fractional year only to a couple of hours).
  let season: FireSeason | null = null;
  let spread: SpreadEdge[] = [];
  let seasonBurns: PerimPoly[] = [];
  let endClock: number | null = null;
  const FLARE_DAYS = 5;
  const sDay = (t: number) => (t - season!.a) / DAY_T;
  /** the last moment of the season's last day, so the end of the replay still reads as that day */
  const sClamp = (t: number) => Math.min(Math.max(t, season!.a), season!.b - DAY_T / 1440);
  const replayEvent = (year: number | null) => window.dispatchEvent(new CustomEvent('atlas:replay', { detail: { layer: 'fires', year } }));
  const replay: NonNullable<AtlasLayer['replay']> = {
    seasons: (force) => fireSeasonYears(force),
    async start(year, force) {
      const s = await fireSeason(year, force);
      if (!s) return null;
      season = s;
      spread = spreadEdges(s.points);
      seasonBurns = perimPolys.filter((p) => p.b[0] === year);
      endClock = null;
      const md = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      return { range: [s.a, s.b], ends: [md(s.days[0].day), md(s.days.at(-1)!.day)], camera: { center: [-104.2, 54.7], zoom: 4.7, pitch: 25, bearing: 0 } };
    },
    stop() { season = null; spread = []; seasonBurns = []; endClock = null; },
    days: () => (season?.days ?? []).map((d) => ({ x: d.t, y: d.n })),
    at(t) { const day = tDay(sClamp(t)); return { day, covered: season?.days.find((d) => d.day === day)?.n != null }; },
    build({ time, clock }) {
      const s = season;
      if (!s) return [];
      const d = sDay(time), n = sDay(s.b);
      // at the end, the season's mapped burns (the official record) fade in, when the composite has published them
      const done = time >= s.b - DAY_T / 100;
      if (!done) endClock = null; else endClock ??= clock;
      const fade = done ? (reducedMotion() ? 1 : Math.min(1, (clock - endClock!) / 2500)) : 0;
      return [
        // embers: every hotspot seen so far, small and dim; they stay
        new ScatterplotLayer<HistHotspot>({
          id: 'fires-replay-embers',
          data: s.points,
          getPosition: (p) => [p[0], p[1]],
          getRadius: 900,
          radiusMinPixels: 1.2,
          getFillColor: [235, 100, 40, 75],
          extensions: filterExt,
          getFilterValue: (p) => sDay(p[2]),
          filterRange: [-1, d],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        // the edge of the ground where heat has been seen so far: the atlas's own estimate, on a ~2 km grid, in dashes
        new LineLayer<SpreadEdge>({
          id: 'fires-replay-spread',
          data: spread,
          getSourcePosition: (e) => e.p,
          getTargetPosition: (e) => e.q,
          getColor: [255, 130, 70, 210],
          getWidth: 1.4,
          widthUnits: 'pixels',
          extensions: filter2,
          getFilterValue: (e) => [sDay(e.from), Number.isFinite(e.to) ? sDay(e.to) : 1e6],
          // drawn from the day its cell first lit until the cell beyond it lights
          filterRange: [[-1, d], [d, 2e6]],
          parameters: NO_DEPTH,
        } as any),
        // the last few days' hotspots: bright when seen, fading over FLARE_DAYS (the same points, so nothing is re-uploaded)
        new ScatterplotLayer<HistHotspot>({
          id: 'fires-replay-flare',
          data: s.points,
          getPosition: (p) => [p[0], p[1]],
          getRadius: (p) => 1700 + Math.sqrt(p[3] ?? 1) * 320,
          radiusMinPixels: 2.5,
          getFillColor: [255, 190, 90, 120],
          extensions: filterExt,
          getFilterValue: (p) => sDay(p[2]),
          filterRange: [d - FLARE_DAYS, Math.min(d, n)],
          filterSoftRange: [d - 0.4, Math.min(d, n)],
          parameters: ADDITIVE,
        } as any),
        ...(fade > 0 && seasonBurns.length ? [new PolygonLayer<PerimPoly>({
          id: 'fires-replay-nbac',
          data: seasonBurns,
          getPolygon: (p) => p.poly,
          getFillColor: [150, 40, 18, 110],
          getLineColor: [230, 100, 50, 230],
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
          stroked: true,
          opacity: fade,
          pickable: true,
          parameters: NO_DEPTH,
        } as any)] : []),
      ];
    },
  };
  /** The replay's panel: the counter, the per-day bars filling in, and what the picture is and is not. */
  function replayPanel(el: HTMLElement) {
    const s = season!;
    const burns = perims.filter((b) => b[0] === s.year);
    const burnHa = burns.reduce((a, b) => a + b[1], 0);
    const whole = s.days.at(-1)!.day.slice(5) === '10-31';
    el.innerHTML = `${kicker(l, `Wildfires · season replay`)}
      <h2>The ${s.year} fire season, replayed</h2>
      <p class="lede">Every satellite hotspot the atlas’s daily record holds for ${s.year}, from ${dayText(s.days[0].day)} to ${dayText(s.days.at(-1)!.day)}${whole ? '' : ' (the last day on record so far)'}, a day at a time. Each day’s hotspots flare, then cool to embers that stay. <b>A hotspot is heat seen from a satellite, not a confirmed fire</b>: gas flares, farm and slash burning are in there too.</p>`;
    const hero = heroStats(el, 4);
    el.insertAdjacentHTML('beforeend', `<h3>Hotspots per day</h3>
      <canvas class="rp-bars" height="110" role="img" aria-label="Satellite hotspots per day through the ${s.year} season"></canvas>
      <div class="legend"><span><i class="sw" style="background:${color}"></i>hotspots that day</span><span><i class="sw rp-gap"></i>no record that day (a gap, not a zero)</span></div>
      <div class="rp-btns"><button class="chip rp-again" type="button">↻ Play it again</button><button class="chip rp-leave" type="button">Leave the replay</button></div>
      <div class="callout rp-end" style="--c:${color}" hidden></div>
      <p class="note">The dashed edges are the atlas’s own estimate: the outline of the ground where heat has been seen so far, on a grid of about 2 km, drawn only around patches of ${SPREAD_MIN} cells or more. It is not a mapped perimeter and not a burned area; hotspots miss fire under cloud or thick smoke and repeat over ground that keeps burning. The daily record is provisional and never joins the wildfire statistics.</p>
      ${sourceLine(`Natural Resources Canada, CWFIS satellite hotspots, kept by day in the atlas’s daily record${fires?.licence ? `. ${fires.licence}` : ''}`)}`);
    el.querySelector('.rp-again')!.addEventListener('click', () => replayEvent(s.year));
    el.querySelector('.rp-leave')!.addEventListener('click', () => replayEvent(null));
    const cv = el.querySelector<HTMLCanvasElement>('.rp-bars')!, endEl = el.querySelector<HTMLElement>('.rp-end')!;
    const max = Math.max(1, ...s.days.map((d) => d.n ?? 0));
    let drawn = -2;
    /** bars up to day `upTo`; the rest stay empty until the replay reaches them */
    function bars(upTo: number) {
      const w = cv.clientWidth, h = 110, dpr = window.devicePixelRatio || 1;
      if (!w) return;
      drawn = upTo;
      cv.width = w * dpr; cv.height = h * dpr;
      const g = cv.getContext('2d')!;
      g.scale(dpr, dpr);
      const base = h - 14, bw = w / s.days.length;
      g.fillStyle = 'rgba(255,255,255,.14)';
      g.fillRect(0, base, w, 1);
      g.font = '10px Inter, sans-serif';
      s.days.forEach((dy, i) => {
        if (dy.day.endsWith('-01')) {
          g.fillStyle = 'rgba(255,255,255,.45)';
          g.fillText(new Date(`${dy.day}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' }), i * bw + 2, h - 2);
          g.fillStyle = 'rgba(255,255,255,.12)';
          g.fillRect(i * bw, 0, 1, base);
        }
        if (dy.n == null) { g.fillStyle = 'rgba(160,165,180,.4)'; g.fillRect(i * bw, base - 5, Math.max(1, bw), 5); return; }
        if (i > upTo) return;
        const hh = (dy.n / max) * (base - 4);
        g.fillStyle = color;
        g.globalAlpha = i === upTo ? 1 : 0.8;
        g.fillRect(i * bw, base - hh, Math.max(1, bw - 0.4), Math.max(dy.n ? 1 : 0, hh));
        g.globalAlpha = 1;
      });
    }
    return {
      update({ time }: Ctx) {
        const t = sClamp(time), day = tDay(t), i = s.days.findIndex((d) => d.day === day), dy = s.days[i];
        const done = time >= s.b - DAY_T / 100;
        hero(0, dayText(day), 'the day on the map');
        hero(1, dy?.n == null ? '–' : fmt.int(dy.n), dy?.n == null ? 'no record for this day' : 'hotspots seen that day (not fires)');
        hero(2, fmt.int(lowerBound(s.points, done ? Infinity : time, (p) => p[2])), `hotspots so far, of ${fmt.int(s.total)}`);
        hero(3, `${s.covered} of ${s.days.length}`, 'days with a record');
        if (i !== drawn) bars(i);
        if (endEl.hidden === done) {
          endEl.hidden = !done;
          if (done) endEl.innerHTML = burns.length
            ? `The official record for ${s.year}: the National Burned Area Composite maps <b>${fmt.int(burns.length)}</b> burn${burns.length === 1 ? '' : 's'} of 200 ha or more, <b>${fmt.ha(burnHa)}</b> in all, now drawn solid over the embers. That figure is the composite’s, from imagery and agency mapping; none of it is worked out from hotspots.`
            : `<b>${fmt.int(s.total)}</b> hotspots in ${s.covered} days on record. No burned area is given: the National Burned Area Composite, the official record of what burned, ${py1 ? `reaches ${py1} and ` : ''}has not published ${s.year} yet, and hotspots cannot stand in for it.`;
        }
      },
    };
  }

  /** a hotspot fades with age across the 24-hour window */
  const hotAlpha = (h: Hotspot) => Math.round(255 * Math.max(0.35, 1 - Math.max(0, Date.now() - ms(h[2])) / (24 * 36e5)));
  function firesNow() {
    if (data.now.skipped) return '';
    const fresh = nowF ? freshness(nowF.asOf) : 'old';
    const newest = hotspots.at(-1);
    const north = hotspots.filter((h) => h[1] >= 54).length;
    const body = `<p><b>${hotspots.length}</b> satellite hotspot${hotspots.length === 1 ? '' : 's'} in Saskatchewan in the ${nowF?.hours ?? 24} hours before this reading${newest ? `, the newest seen ${plainAge(newest[2])}` : ''}${hotspots.length && north ? `; ${north} north of 54° N` : ''}. ${perimeters.length ? `${perimeters.length} fire perimeter${perimeters.length === 1 ? '' : 's'} estimated from them (dashed), with heat seen in the last ${nowF?.keepDays ?? 7} days.` : 'No estimated perimeters with heat in the last week.'}</p>
      ${provinceOutlook(data, 'fire')}
      ${fresh !== 'old' ? alertList(alertsInEffect(data, 'fires'), data) : ''}`;
    return nowBlock({ color, asOf: nowF?.asOf ?? null, body, source: nowF?.source ?? '', sourceUrl: nowF?.sourceUrl, missing: 'This copy of the data has no satellite hotspots.' });
  }

  const l: AtlasLayer = {
    id: 'fires',
    name: 'Wildfires',
    icon: '🔥',
    color,
    range: [y0, nowF ? NOW_T : y1 + 0.99],
    available: points.length > 0,
    now: nowF ? {
      asOf: () => ms(nowF.asOf),
      archiveEnd: y1 + 0.99,
      recent: firesRecent,
      build(c) {
        const { clock } = c;
        // the wind and the smoke forecast (src/wind.ts), when their chips are on, drift over the hotspots
        const air = airLayers('fires', c);
        // the list as a whole goes stale (the hourly refresh stopped), not each hotspot: a hotspot is up to 24 h old by design
        if (!drawable(nowF.asOf)) return air;
        const stale = freshness(nowF.asOf) === 'stale';
        const pulse = 0.5 + 0.5 * Math.sin(clock * 3);
        return [
          new PathLayer<any>({
            id: 'fires-now-perims',
            data: perimeters.flatMap((p) => p.polys.map((poly) => ({ p, ring: poly[0] }))),
            getPath: (d) => d.ring,
            getColor: stale ? [150, 150, 160, 200] : [255, 120, 60, 230],
            getWidth: 2,
            widthUnits: 'pixels',
            getDashArray: [6, 4],
            dashJustified: true,
            extensions: dashExt,
            pickable: true,
            parameters: NO_DEPTH,
          } as any),
          new ScatterplotLayer<Hotspot>({
            id: 'fires-now-glow',
            data: hotspots,
            getPosition: (d) => [d[0], d[1]],
            getRadius: (d) => 5000 + Math.sqrt(d[3] ?? 1) * 1800,
            radiusMinPixels: 8,
            getFillColor: (d) => (stale ? [150, 150, 160, 60] : [255, 170, 60, Math.round(hotAlpha(d) * (0.25 + 0.2 * pulse))]),
            updateTriggers: { getFillColor: Math.round(pulse * 20) },
            parameters: ADDITIVE,
          }),
          new ScatterplotLayer<Hotspot>({
            id: 'fires-now-hotspots',
            data: hotspots,
            getPosition: (d) => [d[0], d[1]],
            getRadius: 1500,
            radiusMinPixels: 3,
            getFillColor: (d) => (stale ? [170, 170, 180, 200] : [255, 240, 150, hotAlpha(d)]),
            stroked: true,
            getLineColor: [40, 10, 0, 200],
            lineWidthMinPixels: 0.8,
            pickable: true,
            parameters: NO_DEPTH,
          }),
          ...alertOutlines('fires-now-alerts', alertsInEffect(data, 'fires')),
          ...air,
        ];
      },
    } : undefined,
    replay,
    unavailable: 'The Canadian National Fire Database could not be downloaded when this copy of the data was built. Run <code>npm run data fires</code>, then reload.',
    build({ time, speed }) {
      const W = glowWindow(speed);
      const plo = lowerBound(points, time - W, (p) => p[2]);
      const phi = lowerBound(points, time, (p) => p[2]);
      const flashing = points.slice(plo, phi);
      return [
        new PolygonLayer<PerimPoly>({
          id: 'fires-perims',
          data: perimPolys,
          getPolygon: (d) => d.poly,
          getFillColor: (d) => (d.b[1] >= 1000 ? [150, 40, 18, 80] : [255, 140, 70, 70]),
          getLineColor: (d) => (d.b[1] >= 1000 ? [210, 80, 40, 150] : [255, 160, 90, 130]),
          getLineWidth: 1,
          lineWidthUnits: 'pixels',
          stroked: true,
          extensions: filterExt,
          getFilterValue: (d) => d.b[3],
          filterRange: [1800, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<FirePoint>({
          id: 'fires-scars',
          data: circles,
          getPosition: (d) => [d[0], d[1]],
          getRadius: (d) => radiusM(d[3]),
          radiusMinPixels: 0.6,
          getFillColor: (d) => (d[3] >= 1000 ? [150, 40, 18, 70] : [255, 140, 70, 60]),
          extensions: filterExt,
          getFilterValue: (d) => d[2],
          filterRange: [1800, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<FirePoint>({
          id: 'fires-flash',
          data: flashing,
          getPosition: (d) => [d[0], d[1]],
          getRadius: (d) => {
            const a = (time - d[2]) / W;
            return (2500 + radiusM(d[3]) * 1.2) * (0.4 + a * 1.2);
          },
          radiusMinPixels: 2,
          getFillColor: (d) => {
            const a = (time - d[2]) / W;
            const c = causeRGB[d[4]];
            return [c[0], c[1], c[2], 255 * (1 - a) ** 1.5] as RGBA;
          },
          updateTriggers: { getRadius: time, getFillColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
    spark: () => d3.range(y0, y1 + 1).map((x) => ({ x, y: haByYear[x] ?? 0 })),
    events() {
      return points.filter((p) => p[3] >= 100000).map((p) => {
        const { town, km: d } = nearestTown(data.munis, p[0], p[1]);
        const nmd = fireName(p);
        return {
          t: p[2], layer: 'fires', lon: p[0], lat: p[1], zoom: 7.5,
          title: `${fmt.ha(p[3])} wildfire ${d < 15 ? 'at' : 'near'} ${town.name}`,
          body: `${nmd ? `${nmd[0].toUpperCase()}${nmd.slice(1)}, a` : 'A'} ${CAUSE[p[4]].name.toLowerCase()}-caused fire${d >= 15 ? ` about ${Math.round(d)} km from ${town.name}` : ''}: one of the largest in the provincial record.`,
          stats: [{ v: fmt.ha(p[3]), l: 'burned' }, { v: CAUSE[p[4]].name, l: 'cause' }, { v: `#${rankOf.get(p)}`, l: `largest of ${fmt.int(points.length)} recorded fires` }],
        };
      });
    },
    panel(el) {
      if (season) return replayPanel(el);
      el.innerHTML = `${kicker(l, `Wildfire history · ${y0} → ${y1}`)}
        <div class="rp-host"></div>
        <div class="air-host"></div>
        ${firesNow()}
        <h2>Where Saskatchewan burns</h2>
        <p class="lede">Every fire the province and Parks Canada reported since ${y0}, at the point it started. New fires flare; each then leaves a scar: ${perims.length ? `its mapped outline where the National Burned Area Composite has one (${fmt.int(perims.length)} burns of 200 ha or more, ${py0}–${py1}), otherwise ` : ''}a circle the size of the area it burned. Almost all of the burning is in the boreal north, and most of it is started by lightning.${nowF ? ' At the <b>Now</b> stop, the pale yellow points are satellite hotspots from the last 24 hours: heat seen from space, not confirmed fires. Gas flares, farm and slash burning show up too.' : ''}</p>`;
      const air = l.now ? airPanel(el.querySelector<HTMLElement>('.air-host')!, data, { id: 'fires', atNow: (t) => isNow(t, l.range[1]) }) : null;
      // Replay the season: offered only once a season is on record (never with the film, which loads no daily record)
      const rpHost = el.querySelector<HTMLElement>('.rp-host')!;
      replay.seasons().then((ys) => {
        if (!ys.length || !rpHost.isConnected) return;
        rpHost.innerHTML = `<button class="ev-show rp-go" type="button"><span>▶</span>Replay the season</button>${ys.length > 1 ? `<select class="sc-pick rp-year" aria-label="Season to replay">${[...ys].reverse().map((y) => `<option value="${y}">${y} season</option>`).join('')}</select>` : ''}
          <p class="note">${ys.length > 1 ? 'A' : `The ${ys[0]}`} season’s satellite hotspots, day by day, in about 40 seconds. Heat seen from space, not confirmed fires.</p>`;
        rpHost.querySelector('.rp-go')!.addEventListener('click', () => replayEvent(+(rpHost.querySelector<HTMLSelectElement>('.rp-year')?.value ?? ys.at(-1)!)));
      });
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Area burned per year</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, { data: l.spark(), xDomain: [y0, y1], color, height: 130, yFormat: (v) => d3.format('~s')(v), tooltip: (d) => `<b>${d.x}</b><br>${fmt.ha(d.y)} burned<br>${fmt.int(countByYear[d.x] ?? 0)} fires` }),
      );
      const top = Object.entries(haByYear).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const north = points.filter((p) => p[1] >= 54).reduce((a, p) => a + p[3], 0) / (points.reduce((a, p) => a + p[3], 0) || 1);
      el.insertAdjacentHTML('beforeend', `
        <div class="callout" style="--c:${color}">Worst years on record: ${top.map(([y, v]) => `<b>${y}</b> (${fmt.ha(v)})`).join(', ')}. ${Math.round(north * 100)}% of all the area burned since ${y0} lies north of 54° N.</div>
        <h3>Cause</h3>
        <div class="legend">${CAUSE.map((c) => `<span><i class="sw" style="background:${c.c}"></i>${c.name}</span>`).join('')}</div>
        <p class="note">${perims.length ? `Outlines are the National Burned Area Composite’s mapped burns (from satellite imagery and agency mapping), simplified to about a twelfth of each burn’s width; a fire under 200 ha, before ${py0} or after ${py1} (the composite’s latest year) is a circle. ` : ''}A circle shows how much ground a fire burned, not its real shape. Older records are less complete, especially for small fires, and much of the far north is an observation zone where fires are watched rather than fought. Prescribed burns are left out.</p>
        ${sourceLine(`${fires?.source ?? ''}${fires?.perimeterSource ? `; ${fires.perimeterSource}` : ''}${fires?.licence ? `. ${fires.licence}` : ''}`)}`);
      return {
        update(c) {
          const { time } = c;
          air?.update(c);
          tickAges(el);
          const y = Math.floor(time);
          const cz = causeByYear[y] ?? [0, 0, 0];
          if (nowF && isNow(time, l.range[1])) hero(0, drawable(nowF.asOf) ? fmt.int(hotspots.length) : '–', 'satellite hotspots, last 24 hours');
          else if (nowF && time >= FFROM) {
            const d = tDay(time), n = firesHistory()?.perDay.get(d);
            hero(0, firesRecent.covers(time) ? fmt.int(n ?? 0) : '–', firesRecent.covers(time) ? `satellite hotspots on ${dayText(d)} (not fires)` : `no record for ${dayText(d)}`);
          } else hero(0, fmt.int(countByYear[y] ?? 0), `fires in ${y}`);
          hero(1, fmt.ha(haByYear[y] ?? 0), `burned in ${y}`);
          const tot = cz[0] + cz[1] + cz[2];
          hero(2, tot ? `${Math.round((cz[0] / tot) * 100)}%` : '–', `started by lightning in ${y}`);
          let cum = 0;
          for (const [yy, v] of Object.entries(haByYear)) if (+yy <= y) cum += v;
          hero(3, fmt.ha(cum), `burned since ${y0}`);
          set(time);
        },
      };
    },
    describe(info) {
      const lid = info.layer?.id;
      if (lid?.includes('-air-')) return null;
      if ((lid?.startsWith('fires-hist') || lid === 'fires-replay-embers') && Array.isArray(info.object)) {
        const [lon, lat, t, frp] = info.object as HistHotspot;
        const { town, km: d } = nearestTown(data.munis, lon, lat);
        return {
          t, layer: 'fires', kind: 'Satellite hotspot (recorded)', lon, lat, zoom: 9,
          title: `Heat seen from a satellite ${d < 5 ? 'at' : 'near'} ${town.name}`,
          body: `A hotspot kept by the atlas’s daily record of CWFIS’s feed${d >= 5 ? `, about ${Math.round(d)} km from ${town.name}` : ''}. It is not a confirmed fire, and hotspots never count in the wildfire statistics.`,
          stats: [{ v: dayText(tDay(t)), l: 'seen (Sask. day)' }, ...(frp != null ? [{ v: `${frp} MW`, l: 'fire radiative power' }] : [])],
          sources: [{ label: 'CWFIS satellite hotspots', url: 'https://cwfis.cfs.nrcan.gc.ca/maps/fm3' }],
        };
      }
      if (isLive(lid)) {
        const x: any = info.object;
        if (x?.a) return alertEvent(x.a, 'fires', data, info.coordinate?.[0], info.coordinate?.[1]);
        if (x?.p) {
          const p = x.p as FirePerimeter;
          const c = p.polys[0][0][0];
          const { town, km: d } = nearestTown(data.munis, c[0], c[1]);
          return {
            layer: 'fires', kind: 'Estimated fire perimeter', lon: c[0], lat: c[1], zoom: 8,
            title: `A fire perimeter ${d < 15 ? 'at' : 'near'} ${town.name}`,
            body: `An outline the Canadian Wildland Fire Information System draws around clusters of satellite hotspots. It is an estimate from heat seen from space, not a mapped perimeter, so it is drawn dashed.`,
            stats: [{ v: fmt.ha(p.ha), l: 'estimated area' }, { v: ago(p.last), l: 'last heat seen' }, { v: skTime(p.first), l: 'first heat seen' }, { v: fmt.int(p.n), l: 'hotspots in it' }],
            sources: [{ label: 'CWFIS fire M3 hotspots and perimeters', url: nowF?.sourceUrl ?? 'https://cwfis.cfs.nrcan.gc.ca/' }],
          };
        }
        if (Array.isArray(x)) {
          const h = x as Hotspot;
          const { town, km: d } = nearestTown(data.munis, h[0], h[1]);
          return {
            layer: 'fires', kind: 'Satellite hotspot', lon: h[0], lat: h[1], zoom: 9,
            title: `Heat seen from a satellite ${d < 5 ? 'at' : 'near'} ${town.name}`,
            body: `A hotspot: a satellite pixel hotter than the ground around it${d >= 5 ? `, about ${Math.round(d)} km from ${town.name}` : ''}. It is not a confirmed fire: gas flares, farm and slash burning and hot industrial sites show up too.`,
            stats: [{ v: ago(h[2]), l: `seen (${skTime(h[2])}, Sask. time)` }, ...(h[3] != null ? [{ v: `${h[3]} MW`, l: 'fire radiative power' }] : []), ...(h[4] ? [{ v: h[4], l: 'sensor' }] : [])],
            sources: [{ label: 'CWFIS satellite hotspots', url: nowF?.sourceUrl ?? 'https://cwfis.cfs.nrcan.gc.ca/' }],
          };
        }
        return null;
      }
      if (lid === 'fires-perims' || lid === 'fires-replay-nbac') {
        const { b } = info.object as PerimPoly;
        const mp = mainPoint(b);
        const [lon, lat] = mp ? [mp[0], mp[1]] : (info.coordinate as [number, number] | undefined) ?? b[2][0][0][0];
        const { town, km: d } = nearestTown(data.munis, lon, lat);
        const nmd = mp ? fireName(mp) : null;
        return {
          t: b[3], layer: 'fires', kind: 'Mapped burn outline', lon, lat, zoom: b[1] > 20000 ? 7.5 : 9,
          title: `${nmd ? `${nmd[0].toUpperCase()}${nmd.slice(1)}: ` : ''}${fmt.ha(b[1])} burned ${d < 5 ? 'at' : 'near'} ${town.name}, ${b[0]}`,
          body: `The outline the National Burned Area Composite maps for this burn, from satellite imagery and agency mapping, simplified for the map. ${b[4].length ? `${b[4].length === 1 ? 'One reported fire starts' : `${b[4].length} reported fires start`} inside it${mp ? `; the largest was ${['started by lightning', 'started by people', 'of unknown cause'][mp[4]]}` : ''}.` : 'No reported fire of that year starts inside it, so it appears at the start date the composite gives.'} The area is the composite’s, less unburned islands where it maps them, so it can differ from the size the fire was reported at.`,
          stats: [{ v: fmt.ha(b[1]), l: 'mapped burned area' }, { v: String(b[0]), l: 'year' }, ...(mp ? [{ v: CAUSE[mp[4]].name, l: 'cause' }, { v: fmt.ha(mp[3]), l: 'reported size' }] : [])],
          sources: [{ label: 'National Burned Area Composite (CWFIS)', url: safeUrl(fires?.perimeterUrl) ?? 'https://cwfis.cfs.nrcan.gc.ca/ha/nbac' }],
        };
      }
      const o = info.object as FirePoint;
      if (!Array.isArray(o)) return null;
      const [lon, lat, t, ha, cause] = o;
      const { town, km: d } = nearestTown(data.munis, lon, lat);
      const nmd = fireName(o);
      return {
        t, layer: 'fires', kind: 'Wildfire', lon, lat, zoom: ha > 10000 ? 8 : 9.5,
        title: `${ha < 1 ? 'A spot fire' : `A ${fmt.ha(ha)} fire`} ${d < 5 ? 'at' : 'near'} ${town.name}`,
        body: `${nmd ? `Named ${nmd.replace(/^the /, '')}. ` : ''}Where a reported fire started${d >= 5 ? `, about ${Math.round(d)} km from ${town.name}` : ''}.`,
        stats: [{ v: isoDate(t), l: 'reported' }, { v: ha < 1 ? 'under 1 ha' : fmt.ha(ha), l: 'final size' }, { v: CAUSE[cause].name, l: 'cause' }, { v: `#${fmt.int(rankOf.get(o) ?? 0)}`, l: `by size, of ${fmt.int(points.length)}` }],
        sources: [{ label: 'Canadian National Fire Database (CWFIS)', url: 'https://cwfis.cfs.nrcan.gc.ca/ha/nfdb' }],
      };
    },
    tooltip(info) {
      const air = airTooltip(info, data);
      if (air !== undefined) return air;
      const o: any = info.object;
      if ((info.layer?.id.startsWith('fires-hist') || info.layer?.id === 'fires-replay-embers') && Array.isArray(o)) return `<b>Satellite hotspot</b> <span class="tk">recorded, not a confirmed fire</span><br><span class="tk">Seen</span> <span class="tv">${dayText(tDay(o[2]))}</span>${o[3] != null ? `<br><span class="tk">Fire radiative power</span> <span class="tv">${o[3]} MW</span>` : ''}`;
      if (isLive(info.layer?.id)) {
        if (o?.a) return alertTooltip(o.a);
        if (o?.p) return `<b>Estimated fire perimeter</b><br><span class="tk">Area</span> <span class="tv">${fmt.ha(o.p.ha)}</span><br><span class="tk">Last heat seen</span> <span class="tv">${ago(o.p.last)}</span>`;
        if (Array.isArray(o)) return `<b>Satellite hotspot</b> <span class="tk">not a confirmed fire</span><br><span class="tk">Seen</span> <span class="tv">${ago(o[2])}</span>${o[3] != null ? `<br><span class="tk">Fire radiative power</span> <span class="tv">${o[3]} MW</span>` : ''}`;
        return null;
      }
      if ((info.layer?.id === 'fires-perims' || info.layer?.id === 'fires-replay-nbac') && o?.b) {
        const b = o.b as BurnPerimeter, mp = mainPoint(b);
        return `<b>${mp?.[5] ? `${esc(mp[5])} fire` : `Burn of ${b[0]}`}</b> <span class="tk">mapped outline</span><br><span class="tk">Mapped area</span> <span class="tv">${fmt.ha(b[1])}</span>${mp ? `<br><span class="tk">Reported</span> <span class="tv">${isoDate(mp[2])}</span><br><span class="tk">Cause</span> ${CAUSE[mp[4]].name}` : `<br><span class="tk">Year</span> <span class="tv">${b[0]}</span>`}`;
      }
      if (!Array.isArray(o)) return null;
      return `<b>${o[5] ? `${esc(o[5])} fire` : 'Wildfire'}</b>${info.layer?.id === 'fires-scars' ? ' <span class="tk">circle of the same area, no mapped outline</span>' : ''}<br><span class="tk">Reported</span> <span class="tv">${isoDate(o[2])}</span><br><span class="tk">Burned</span> <span class="tv">${o[3] < 1 ? '<1 ha' : fmt.ha(o[3])}</span><br><span class="tk">Cause</span> ${CAUSE[o[4]].name}`;
    },
  };
  return l;
}
