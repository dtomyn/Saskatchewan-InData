// WILDFIRES — the Canadian National Fire Database's start points, and the National Burned Area Composite's mapped
// outlines. A fire of 200 ha or more that NBAC outlines (1972 on) is drawn as its outline; every other fire's scar is
// a circle with the same area as the fire, so the burned country is to scale either way. The tooltip says which.
import { ScatterplotLayer, PathLayer, PolygonLayer } from '@deck.gl/layers';
import * as d3 from 'd3';
import { Data, FirePoint, BurnPerimeter, lowerBound, Hotspot, fmt, FirePerimeter } from './data';
import { AtlasLayer, rgb, RecentSpan, filterExt, NO_DEPTH, ADDITIVE, dashExt, glowWindow, RGBA, nearestTown, kicker, heroStats, deferChart, mk, sourceLine, isoDate } from './layer-kit';
import { HistHotspot, firesHistory, dayT, tDay, DAY_T, dayText } from './history';
import { ms, freshness, plainAge, provinceOutlook, alertList, alertsInEffect, nowBlock, NOW_T, drawable, alertOutlines, tickAges, isNow, alertEvent, ago, skTime, alertTooltip } from './now';
import { barChart } from './charts';
import { safeUrl, esc } from './html';

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
      build({ clock }) {
        // the list as a whole goes stale (the hourly refresh stopped), not each hotspot: a hotspot is up to 24 h old by design
        if (!drawable(nowF.asOf)) return [];
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
        ];
      },
    } : undefined,
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
      el.innerHTML = `${kicker(l, `Wildfire history · ${y0} → ${y1}`)}
        ${firesNow()}
        <h2>Where Saskatchewan burns</h2>
        <p class="lede">Every fire the province and Parks Canada reported since ${y0}, at the point it started. New fires flare; each then leaves a scar: ${perims.length ? `its mapped outline where the National Burned Area Composite has one (${fmt.int(perims.length)} burns of 200 ha or more, ${py0}–${py1}), otherwise ` : ''}a circle the size of the area it burned. Almost all of the burning is in the boreal north, and most of it is started by lightning.${nowF ? ' At the <b>Now</b> stop, the pale yellow points are satellite hotspots from the last 24 hours: heat seen from space, not confirmed fires. Gas flares, farm and slash burning show up too.' : ''}</p>`;
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
        update({ time }) {
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
      if (lid?.startsWith('fires-hist') && Array.isArray(info.object)) {
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
      if (lid === 'fires-perims') {
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
      const o: any = info.object;
      if (info.layer?.id.startsWith('fires-hist') && Array.isArray(o)) return `<b>Satellite hotspot</b> <span class="tk">recorded, not a confirmed fire</span><br><span class="tk">Seen</span> <span class="tv">${dayText(tDay(o[2]))}</span>${o[3] != null ? `<br><span class="tk">Fire radiative power</span> <span class="tv">${o[3]} MW</span>` : ''}`;
      if (isLive(info.layer?.id)) {
        if (o?.a) return alertTooltip(o.a);
        if (o?.p) return `<b>Estimated fire perimeter</b><br><span class="tk">Area</span> <span class="tv">${fmt.ha(o.p.ha)}</span><br><span class="tk">Last heat seen</span> <span class="tv">${ago(o.p.last)}</span>`;
        if (Array.isArray(o)) return `<b>Satellite hotspot</b> <span class="tk">not a confirmed fire</span><br><span class="tk">Seen</span> <span class="tv">${ago(o[2])}</span>${o[3] != null ? `<br><span class="tk">Fire radiative power</span> <span class="tv">${o[3]} MW</span>` : ''}`;
        return null;
      }
      if (info.layer?.id === 'fires-perims' && o?.b) {
        const b = o.b as BurnPerimeter, mp = mainPoint(b);
        return `<b>${mp?.[5] ? `${esc(mp[5])} fire` : `Burn of ${b[0]}`}</b> <span class="tk">mapped outline</span><br><span class="tk">Mapped area</span> <span class="tv">${fmt.ha(b[1])}</span>${mp ? `<br><span class="tk">Reported</span> <span class="tv">${isoDate(mp[2])}</span><br><span class="tk">Cause</span> ${CAUSE[mp[4]].name}` : `<br><span class="tk">Year</span> <span class="tv">${b[0]}</span>`}`;
      }
      if (!Array.isArray(o)) return null;
      return `<b>${o[5] ? `${esc(o[5])} fire` : 'Wildfire'}</b>${info.layer?.id === 'fires-scars' ? ' <span class="tk">circle of the same area, no mapped outline</span>' : ''}<br><span class="tk">Reported</span> <span class="tv">${isoDate(o[2])}</span><br><span class="tk">Burned</span> <span class="tv">${o[3] < 1 ? '<1 ha' : fmt.ha(o[3])}</span><br><span class="tk">Cause</span> ${CAUSE[o[4]].name}`;
    },
  };
  return l;
}
