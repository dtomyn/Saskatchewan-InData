// Town Report and Town Finder side panels.
import { Data, Muni, NowRiverRow, RiverStation, fmt, km } from './data';
import { ageTag, alertList, alertsInEffect, aqhiText, aqhiWord, drawable, outlookList, plainAge } from './now';
import { lineChart } from './charts';
import { townProjectionRow } from './projections';
import { smallView } from './small';
import { cityTractsHTML, drawCityTracts } from './tracts';
import { esc } from './html';
import { startReach, campsWithin } from './camping';
import { CRITERIA, CareTrip, TownMetrics, driveMin, getWork, migrate, rankTowns, saveWeights, setWork, townMetrics, workplace } from './metrics';
import { placesWithin, startCommute } from './commute';
import { NEEDS, PlaceNeeds, countedWhere } from './needs';
import { SchoolTrip } from './schools';
import { PlaceNet } from './internet';
import { COMMUNITY_COLOR, PlaceCommunity, RELIGIONS, people } from './community';
import { pctText } from './subdivisions';
import { ERRANDS, NewcomerTrip, PlaceNewcomer, tripText } from './newcomer';
import { DOCTORS_COLOR, DoctorTrip, PlaceDoctors, SITE_KINDS, doctorTripText } from './doctors';
import { CHILDCARE_COLOR, ChildcareTrip, PlaceChildcare, childcareTripText } from './childcare';
import { INDUSTRY_COLOR, PlaceIndustry, kmText, kvText, placePower, plantText, tonnes } from './industry';
import { CROPS_COLOR, cropsBar, cropsText, placeCrops } from './crops';
import { PlaceWater, WATER_COLOR, WATER_KINDS, lastedText, waterDays } from './water';
import { PlaceRadon, RADON_RAMP } from './radon';
import { BUS_COLOR, CITY_COLOR, PlaceTransit, RAIL_COLOR, TRANSIT_COLOR, airText, sysText } from './transit';
import { droughtNow, droughtStrip } from './drought';
import { AURORA_BANDS, AURORA_RAMP, DAY_RAMP, PRESERVE_COLOR, PlaceLight, hm, mlText } from './light';

type MetricFn = (label: string, dot: string, v: string, sub: string) => string;
const tripV = (t: CareTrip) => (t.inferred ? 'In town' : t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);
const tripSub = (t: CareTrip) => t.inferred ? `${esc(t.name)}: the place has its own police service (Statistics Canada), though no station is mapped in OpenStreetMap` : `${t.min != null ? 'drive' : 'straight line'} to ${esc(t.name)}${t.city ? `, ${esc(t.city)}` : ''} · ${Math.round(t.km)} km`;

// ---------------------------------------------------------------------------------------------

export function renderTownReport(el: HTMLElement, data: Data, key: string, opts: { onClose: () => void; rank?: { pos: number; of: number; score: number } }) {
  const t = townMetrics(data).find((x) => x.muni.key === key);
  if (!t) return;
  const m = t.muni;
  const metric: MetricFn = (label, dot, v, sub) =>
    `<div class="metric"><div class="mk"><span class="dot" style="background:${dot}"></span>${label}</div><div class="mv">${v}</div><div class="ms">${sub}</div></div>`;
  const na = '<span style="color:var(--ink-3)">n/a</span>';
  const link = (layer: string, text: string) => `<button class="tr-fall" data-layer="${layer}" type="button">${text} ›</button>`;
  const csiSub = t.csi != null ? `index, ${t.csiYear} (lower = safer)${t.police ? `<br>${esc(t.police.name)}${t.police.rural ? ' (covers the surrounding area)' : ''}` : ''}` : 'no police-service series for this place';

  el.innerHTML = `
    <button class="close-x" aria-label="Close town report">×</button>
    <div class="kicker" style="--c:#ffffff">${esc(m.kind)} · ${esc(m.rd)} Saskatchewan${t.treaty ? ` · ${esc(t.treaty)} territory` : ''}</div>
    <h2>${esc(m.name)}</h2>
    ${opts.rank ? `<p class="lede">Ranks <b>#${opts.rank.pos} of ${opts.rank.of}</b> in your Town Finder (score ${Math.round(opts.rank.score * 100)}).</p>` : ''}
    ${cityTractsHTML(data, key)}
    ${rightNow(data, m, metric, na, link)}
    <h3>Safety &amp; justice</h3>
    <div class="metric-grid">
      ${metric('Crime Severity', '#ff4d8d', t.csi != null ? t.csi.toFixed(0) : na, csiSub)}
      ${metric('Violent crime', '#ff4d8d', t.vcsi != null ? t.vcsi.toFixed(0) : na, t.vcsi != null ? `Violent Crime Severity Index, ${t.csiYear}` : '')}
      ${metric('Crimes solved', '#ff4d8d', t.clear != null ? `${t.clear.toFixed(0)}%` : na, t.clear != null ? `weighted clearance rate, ${t.csiYear}` : '')}
      ${data.justice ? metric('Courthouse', '#ffd166', t.court ? tripV(t.court) : na, t.court ? tripSub(t.court) : 'none reachable by road') : ''}
      ${data.justice ? metric('Police', '#5aa9ff', t.policeStation ? tripV(t.policeStation) : na, t.policeStation ? tripSub(t.policeStation) : 'none reachable by road') : ''}
      ${data.hospitals ? metric('Hospital', '#6c8cff', t.hospital ? tripV(t.hospital) : na, t.hospital ? tripSub(t.hospital) : 'none reachable by road') : ''}
    </div>
    <div class="tr-falls" style="margin-top:8px">${link('crime', '◆ Crime severity on the map')}${data.justice ? link('justice', '⚖ Courts &amp; police') : ''}</div>
    <h3>People</h3>
    <div class="metric-grid">
      ${metric('Population', '#3ecf8e', t.pop ? fmt.int(t.pop) : na, t.popYear ? `1 July ${t.popYear}${t.popGrowth5y != null ? ` · ${fmt.signed(t.popGrowth5y * 100, 0)}% in 5 yrs` : ''}` : '')}
      ${metric('Region', '#3ecf8e', esc(m.rd), t.treaty ? `in the ${esc(t.treaty)} area` : '')}
      ${data.camping ? metric('Campground', '#59d18c', t.camp ? tripV(t.camp) : na, t.camp ? tripSub(t.camp) : 'none reachable by road') : ''}
      ${data.camping ? metric('Parks nearby', '#59d18c', String(t.parks50km), 'provincial, national and regional parks and rec sites within 50 km') : ''}
      ${commuteMetric(data, key, metric)}
    </div>
    ${data.commute ? `<div class="tr-falls" style="margin-top:8px"><button class="tr-fall tr-commute" type="button">🚗 Work in ${esc(m.name)}? ${placesWithin(data, key, getWork().limit)} other places within ${getWork().limit} min ›</button></div>` : ''}
    ${data.camping ? `<div class="tr-falls" style="margin-top:8px">${campsWithin(data, key, 120) != null ? `<button class="tr-fall tr-reach" type="button">🔥 Light the campfires: ${campsWithin(data, key, 120)} campgrounds within 2 h ›</button>` : ''}${link('camping', '⛺ Camping &amp; rec on the map')}</div>` : ''}
    ${data.needs && t.needs ? dailyNeeds(t.needs, data.needs.slackKm, link) : ''}
    ${data.schools && t.schools ? schoolsRows(t, metric, na, link) : ''}
    ${data.internet && t.internet ? internetRows(t.internet, metric, link) : ''}
    ${data.community && t.community ? communityRows(t.community, data.community.slackKm, metric, link) : ''}
    ${data.doctors && t.doctors ? doctorsRows(t.doctors, data.doctors.slackKm, metric, na, link) : ''}
    ${data.newcomer && t.newcomer ? newcomerRows(t.newcomer, metric, na, link) : ''}
    ${data.transit && t.transit ? transitRows(t.transit, data, metric, link) : ''}
    ${data.childcare && t.childcare ? childcareRows(t.childcare, data.childcare.slackKm, metric, na, link) : ''}
    ${data.industry && t.industry ? industryRows(t.industry, data, metric, link, key) : ''}
    ${data.water && t.water ? waterRows(t.water, data, metric, link) : ''}
    ${data.radon && t.radon ? radonRows(t.radon, data, metric, link) : ''}
    ${data.housing ? homeCosts(t, metric, na, link) : ''}
    ${data.jobs ? jobsIncome(t, metric, na, link) : ''}
    <h3>Hazards &amp; climate</h3>
    <div class="metric-grid">
      ${metric('Wildfires nearby', '#ff8a3d', fmt.int(t.fires25km), `started within 25 km since 1990 · ${fmt.ha(t.burnedHa50km)} burned within 50 km`)}
      ${data.smoke ? metric('Smoke days', '#e8a87c', t.smoke ? t.smoke.avg.toFixed(0) : na, t.smoke ? `a year, ${t.smoke.from}–${t.smoke.to} (${t.smoke.worst.days} in ${t.smoke.worst.y}) · ${t.smoke.dist < 15 ? 'at' : 'borrowed from'} ${esc(t.smoke.name)}${t.smoke.dist < 15 ? '' : ` (${Math.round(t.smoke.dist)} km)`}` : `no air station within 150 km`) : ''}
      ${metric('Tornadoes', '#9ad8ff', fmt.int(t.tornadoes50km), 'on record within 50 km, 1980–2009 and 2017 on')}
      ${data.hail && t.hail ? metric('Hail', '#c3b5ff', fmt.int(t.hail.n), `storms within 50 km, ${t.hail.from}–${t.hail.to}${t.hail.max ? ` · largest ${t.hail.max.mm} mm${t.hail.max.radar ? ' (radar estimate)' : ''}, ${Math.floor(t.hail.max.t)}` : ''}`) : ''}
      ${data.drought ? metric('Drought', '#e0a43a', t.drought ? String(t.drought.d2) : na, t.drought ? `months at D2+ (severe or worse) of ${t.drought.n}, ${t.drought.from.slice(0, 4)}–${t.drought.to.slice(0, 4)} · ${droughtNow(t.drought)}` : '') : ''}
      ${metric('Climate', '#f25f5c', t.climate ? `${t.climate.meanTemp.toFixed(1)} °C` : na, t.climate ? `mean since 1991${t.climate.precip ? ` · ${Math.round(t.climate.precip)} mm/yr` : ''} · ${esc(t.climate.name)} (${Math.round(t.climate.dist)} km)` : '')}
    </div>
    ${townProjectionRow(data, key)}
    ${feelsRow(t, data, metric, na)}
    ${data.light && t.light ? lightRows(t.light, data, metric, na, link) : ''}
    ${data.drought && t.drought ? `<div class="dm-cap">Drought Monitor, every month since ${data.drought.months[0].slice(0, 4)}</div>${droughtStrip(data, key)}<div class="tr-falls" style="margin-top:8px">${link('drought', '🌾 Drought on the map')}</div>` : ''}
    ${(() => { const pc = data.crops ? placeCrops(data, key) : null; return pc ? `<h3>The land around it</h3><div class="metric-grid">${metric('What grows here', CROPS_COLOR, `${pc.crop}%`, cropsText(pc))}</div>${cropsBar(pc)}<p class="note" style="margin-top:6px">Annual Crop Inventory: each ~2 km square counts as its most common class, so small fields and sloughs vanish.</p><div class="tr-falls" style="margin-top:8px">${link('crops', '🌱 What grows here on the map')}</div>` : ''; })()}
    ${t.climate?.trend != null ? `<div class="callout" style="--c:#f25f5c">The nearest long-term station (${esc(t.climate.name)}) has warmed <b>${fmt.signed(t.climate.trend, 2)} °C per decade</b> since 1950.</div>` : ''}
    ${t.river ? `<div class="callout" style="--c:#4cc9f0"><b>${esc(t.river.name)}</b> (${t.river.dist.toFixed(0)} km away) reached 1.5× its normal peak in ${Math.round(t.river.floodShare * 100)}% of years; its record was ${t.river.record.ratio.toFixed(1)}× in ${t.river.record.year}.</div>` : ''}
    ${t.pop ? '<h3>Population</h3><div id="tr-pop"></div>' : ''}
    ${t.csi != null ? '<h3>Crime Severity Index</h3><div id="tr-crime"></div>' : ''}
    ${t.marketRent ? `<h3>Average two-bedroom rent · CMHC, ${esc(t.marketRent.centre)}</h3><div id="tr-rent"></div>` : ''}
    <p class="note">Distances are from the town centre. Crime figures come from the police service that covers the place; hazard counts describe history, not a forecast.</p>`;
  el.querySelector('.close-x')!.addEventListener('click', opts.onClose);
  el.querySelector('.tr-reach')?.addEventListener('click', () => startReach(key));
  el.querySelector('.tr-commute')?.addEventListener('click', () => startCommute(key));
  el.querySelectorAll<HTMLElement>('[data-layer]').forEach((b) => b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:layer', { detail: b.dataset.layer }))));

  requestAnimationFrame(() => {
    drawCityTracts(el, data, key);
    const p = data.population?.munis[key];
    if (p && el.querySelector('#tr-pop')) {
      const all = Object.entries(p.pop).map(([y, v]) => ({ x: +y, y: v }));
      lineChart(el.querySelector('#tr-pop')!, { height: 110, xDomain: [all[0].x, all.at(-1)!.x], yZero: false, series: [{ key: 'e', label: 'Estimate', color: '#3ecf8e', values: all }], valueFormat: fmt.int });
    }
    const c = data.crime?.munis[key]?.csi;
    if (c && el.querySelector('#tr-crime')) {
      const vals = Object.entries(c).map(([y, v]) => ({ x: +y, y: v }));
      const sk = Object.entries(data.crime?.prov?.csi ?? {}).map(([y, v]) => ({ x: +y, y: v }));
      lineChart(el.querySelector('#tr-crime')!, { height: 110, xDomain: [vals[0].x, vals.at(-1)!.x], series: [{ key: 'c', label: m.name, color: '#ff4d8d', values: vals }, { key: 'sk', label: 'Saskatchewan', color: '#ffffff', dashed: true, width: 1.5, values: sk }] });
    }
    const r = data.housing?.rent[key]?.r2;
    if (r && el.querySelector('#tr-rent')) {
      const vals = Object.entries(r as Record<string, number>).map(([y, v]) => ({ x: +y, y: v }));
      lineChart(el.querySelector('#tr-rent')!, { height: 110, xDomain: [vals[0].x, vals.at(-1)!.x], yZero: false, yFormat: (v) => `$${Math.round(v)}`, series: [{ key: 'r', label: '2-bedroom', color: '#e6a57e', values: vals }] });
    }
  });
}

/** Live readings around a place: the nearest gauge reporting, hotspots within 50 km, AQHI (its own or borrowed), and
 *  weather alerts covering it. Each shows its age; none feeds the Town Finder. */
function rightNow(data: Data, m: Muni, metric: MetricFn, na: string, link: (layer: string, text: string) => string) {
  const nw = data.now;
  if (nw.skipped) return '';
  if (!nw.rivers && !nw.fires && !nw.air && !nw.alerts && !nw.outlooks)
    return `<h3>Right now</h3><div class="unavail">This copy of the data has no live readings. Run <code>npm run data now</code>, then reload.</div>`;
  const dead = 'no reading in the past day';
  const cells: string[] = [];
  if (nw.rivers && data.rivers) {
    const gauges = new Map(data.rivers.stations.map((s) => [s.id, s]));
    let best: { s: RiverStation; row: NowRiverRow; d: number } | null = null;
    for (const row of nw.rivers.rows) {
      const s = gauges.get(row[0]);
      if (!s || !drawable(row[1])) continue;
      const d = km(m.lon, m.lat, s.lon, s.lat);
      if (d <= 100 && (!best || d < best.d)) best = { s, row, d };
    }
    const r = best?.row;
    cells.push(metric('Nearest river gauge', '#4cc9f0', r ? (r[4] != null ? `${r[4] >= 0.095 ? r[4].toFixed(r[4] >= 1 ? 1 : 2) : '<0.1'}×` : `${r[2]} m`) : na,
      best && r ? `${r[4] != null ? 'flow against its normal annual peak' : 'water level'}${r[5] ? ` (${r[5] === 'ice' ? 'ice-affected' : r[5] === 'est' ? 'estimated' : 'flagged'})` : ''} · ${esc(best.s.name)} (${Math.round(best.d)} km) · ${ageTag(r[1])}` : `no gauge within 100 km has reported in the past day`));
  }
  if (nw.fires) {
    const ok = drawable(nw.fires.asOf);
    const near = ok ? nw.fires.hotspots.map((h) => ({ h, d: km(m.lon, m.lat, h[0], h[1]) })).filter((x) => x.d <= 50).sort((a, b) => a.d - b.d) : [];
    cells.push(metric('Hotspots within 50 km', '#ff8a3d', ok ? String(near.length) : na,
      !ok ? dead : near.length ? `satellite heat, last 24 h, not confirmed fires · nearest ${Math.round(near[0].d)} km, seen ${plainAge(near[0].h[2])}` : `none in the last 24 h · read ${ageTag(nw.fires.asOf)}`));
  }
  if (nw.air) {
    const pick = nw.air.towns[m.key];
    const c = pick ? nw.air.communities[pick[0]] : null;
    const ok = c && drawable(c.t);
    cells.push(metric('Air quality (AQHI)', '#e8a87c', ok ? aqhiText(c!.v) : na,
      !c ? `no AQHI community within ${nw.air.reachKm} km` : !ok ? dead : `${aqhiWord(c.v)} · ${pick![1] < 15 ? 'at' : 'borrowed from'} ${esc(c.name)}${pick![1] < 15 ? '' : ` (${pick![1]} km)`} · ${ageTag(c.t)}`));
  }
  const alerts = nw.alerts ? alertsInEffect(data).filter((a) => a.places.includes(m.key)) : [];
  if (nw.alerts) cells.push(metric('Weather alerts', '#ffd166', drawable(nw.alerts.asOf) ? String(alerts.length) : na,
    !drawable(nw.alerts.asOf) ? dead : alerts.length ? esc(alerts.map((a) => a.short ?? a.name).join(', ')) : `none in effect · read ${ageTag(nw.alerts.asOf)}`));
  return `<h3>Right now</h3>
    <div class="metric-grid">${cells.join('')}</div>
    ${outlookList(data, m.key)}
    ${alertList(alerts, data)}
    <div class="tr-falls" style="margin-top:8px">${nw.rivers ? link('rivers', '≋ Rivers now') : ''}${nw.fires ? link('fires', '🔥 Hotspots now') : ''}${nw.air ? link('smoke', '🌫 Air now') : ''}</div>`;
}

/** The drive to the viewer's workplace ("I work in…"), when one is set. */
function commuteMetric(data: Data, key: string, metric: MetricFn) {
  const w = workplace(data);
  if (!w) return '';
  const wn = esc(data.munis.find((m) => m.key === w)!.name);
  if (w === key) return metric('Commute', '#c9a7ff', 'Here', 'this is where you work (“I work in…”)');
  const min = driveMin(data, key, w);
  return metric('Commute', '#c9a7ff', min == null ? 'n/a' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`, `${data.commute!.routed ? 'drive' : 'rough estimate'} to ${wn}, where you work`);
}

/** Daily needs: a ✓/✗ row per everyday service mapped in OpenStreetMap inside (or just outside) the town limits. */
function dailyNeeds(p: PlaceNeeds, slackKm: number, link: (layer: string, text: string) => string) {
  return `<h3>Daily needs · ${p.met} of ${p.of} in town</h3>
    <div class="needs-list">${NEEDS.map((n) => {
      const c = p.counts[n.id];
      return `<div class="nd ${c ? 'yes' : 'no'}" style="--c:${n.color}"><b>${c ? '✓' : '✗'}</b>${n.label}<small>${c || 'none mapped'}</small></div>`;
    }).join('')}</div>
    <p class="note" style="margin-top:6px">Counted ${countedWhere(p, slackKm)} from OpenStreetMap. Small towns are unevenly mapped, so a ✗ can mean not mapped rather than not there.</p>
    <div class="tr-falls" style="margin-top:8px">${link('needs', '🛒 Daily needs on the map')}</div>`;
}

/** Schools & learning: the drive to the nearest elementary, high, French and post-secondary option, and schools in town. */
function schoolsRows(t: TownMetrics, metric: MetricFn, na: string, link: (layer: string, text: string) => string) {
  const s = t.schools!;
  const v = (x: SchoolTrip | null) => (x ? (x.min != null ? `${x.min} min` : `${Math.round(x.km)} km`) : na);
  const sub = (x: SchoolTrip | null) => (x ? `${x.min != null ? 'drive' : 'straight line'} to ${esc(x.name)}${x.city ? `, ${esc(x.city)}` : ''} · ${Math.round(x.km)} km<br>${esc(x.note)}` : 'none reachable by road');
  return `<h3>Schools &amp; learning</h3>
    <div class="metric-grid">
      ${metric('Elementary', '#9ad8ff', v(s.e), sub(s.e))}
      ${metric('High school', '#ffb703', v(s.h), sub(s.h))}
      ${metric('French schooling', '#ff7aa8', v(s.f), sub(s.f))}
      ${metric('Post-secondary', '#ffffff', v(s.p), sub(s.p))}
      ${metric('Schools in town', '#ffb703', String(s.n), 'open to any family, inside the town limits or within 1 km (ministry list, gaps filled from OpenStreetMap)')}
    </div>
    <div class="tr-falls" style="margin-top:8px">${link('schools', '🎓 Schools &amp; learning on the map')}</div>`;
}

/** Internet: the fixed speed offered to homes in town (ISED), and mobile service. */
function internetRows(p: PlaceNet, metric: MetricFn, link: (layer: string, text: string) => string) {
  const c = '#e9a8ff';
  return `<h3>Internet</h3>
    <div class="metric-grid">
      ${metric('Fast internet', c, `${p.f50}%`, `of homes in town offered 50/10 Mbps or better (wired or fixed wireless); ${p.w50}% by wire`)}
      ${metric('Best offered', c, p.best >= 5 ? '50/10+' : esc(p.bestText.replace(/ Mbps.*/, '')), `${p.best > 0 ? 'Mbps down/up, ' : ''}the fastest tier ISED records in town (it tops out at 50/10)${p.techText ? ` · ${esc(p.techText)}` : ''}`)}
      ${metric('Mobile', c, p.mobile, p.mobile === 'none' ? 'no LTE recorded in town' : `${p.lte ?? 0}% of homes reached by LTE or better${p.mob.length ? ` · ${esc(p.mob.join(', '))}` : ''} (5G is not in the open data)`)}
    </div>
    <p class="note" style="margin-top:6px">ISED National Broadband Data: where providers say a service is offered, not the speed people actually get or what it costs.</p>
    <div class="tr-falls" style="margin-top:8px">${link('internet', '📶 Internet &amp; mobile on the map')}</div>`;
}

/** Hidden neighbours: wells, pipelines, NPRI emitters and mines near the town limits (neutral: also where the jobs are). */
function industryRows(p: PlaceIndustry, data: Data, metric: MetricFn, link: (layer: string, text: string) => string, key: string) {
  const pw = placePower(data, key);
  const I = data.industry!;
  const c = INDUSTRY_COLOR;
  const [a, s, b] = p.wells;
  const lines = p.pl + p.fed.length;
  return `<h3>Hidden neighbours</h3>
    <div class="metric-grid">
      ${metric('Wells', c, fmt.int(p.wellsAll), p.wellsAll ? `oil and gas wells within ${I.wellKm} km of town limits: ${fmt.int(a)} active, ${fmt.int(s)} suspended, ${fmt.int(b)} abandoned${p.fac ? ` · ${fmt.int(p.fac)} oil and gas facilities` : ''}` : `no oil or gas well within ${I.wellKm} km of town limits${p.fac ? ` · ${fmt.int(p.fac)} oil and gas facilities` : ''}`)}
      ${metric('Pipelines', c, String(lines), lines ? `in use within ${I.pipeKm} km${p.sour ? ` · <b>${p.sour} carrying sour gas</b>` : ''}${p.fed.length ? ` · federal: ${esc(p.fed.join(', '))}` : ''}` : `no licensed line in use within ${I.pipeKm} km (flowlines not counted)`)}
      ${metric('Nearest emitter', c, p.np ? kmText(p.np.km) : 'n/a', p.np ? `${esc(p.np.site.n)} (${esc(p.np.site.k.toLowerCase())}), ${tonnes(p.np.site.t)} released in ${I.npriYear}${p.n5 > 1 ? ` · ${p.n5} NPRI sites within ${I.npriKm} km` : ''}` : 'no NPRI site')}
      ${metric('Mine nearby', c, p.mine ? 'Yes' : 'No', p.mine ? `${esc(p.mine.mine.n)} (${esc(p.mine.mine.cm.toLowerCase())}), ${p.mine.km > 0 ? `${kmText(p.mine.km)} from town limits` : 'inside the town limits'}` : `no producing mine within ${I.mineKm} km`)}
      ${pw ? metric('Power line', '#b4c6ff', pw.line ? kmText(pw.line.km) : 'n/a', `${pw.line ? `nearest mapped high-voltage line from town limits (${esc(kvText(pw.line.kv))})` : 'no mapped line within 30 km'}${pw.sub != null ? ` · substation ${kmText(pw.sub)}` : ''}${pw.plant ? `<br>generating station ${kmText(pw.plant.km)}: ${esc(plantText(pw.plant.plant))}` : ''} · OpenStreetMap, partial`) : ''}
    </div>
    <p class="note" style="margin-top:6px">Counted from the town limits. Wells include suspended and abandoned ones, which can restrict where you build. Neutral: these are also where many of the jobs are.</p>
    <div class="tr-falls" style="margin-top:8px">${link('industry', '🛢 Hidden neighbours on the map')}</div>`;
}

/** Drinking water: an advisory on the town's own water system, and how many are in effect within 25 km (any kind of
 * system: lodges, campgrounds, rural pipelines, First Nations). A point-in-time fact. */
function waterRows(p: PlaceWater, data: Data, metric: MetricFn, link: (layer: string, text: string) => string) {
  const W = data.water!;
  const c = WATER_COLOR;
  const s = p.sys[0];
  const kinds = (Object.keys(WATER_KINDS) as (keyof typeof WATER_KINDS)[]).map((k) => [k, p.near.filter((x) => x.s.k === k).length] as const).filter(([, n]) => n);
  const nearest = p.near.find((x) => !p.sys.includes(x.s));
  const sysSub = s
    ? `since ${esc(s.d ?? 'n/a')} (${lastedText(waterDays(s, W))})${s.part ? ` · affects ${esc(s.part)}` : ''}${s.why ? `<br>${esc(s.why)}` : ''}${p.sys.length > 1 ? `<br>and ${p.sys.length - 1} more` : ''}`
    : p.su ? 'listed for the town system (Water Security Agency)' : `none listed on ${esc(W.provAsOf)} (Water Security Agency)`;
  const nearSub = p.near.length
    ? `advisories in effect: ${kinds.map(([k, n]) => `${n} ${esc(WATER_KINDS[k].short.toLowerCase())}`).join(', ')}${nearest ? `<br>nearest other: ${esc(nearest.s.n)}, ${kmText(nearest.km)}` : ''}`
    : 'no advisory in effect nearby';
  return `<h3>Drinking water</h3>
    <div class="metric-grid">
      ${metric('Town water system', s ? WATER_KINDS[s.k].color : c, s ? esc(WATER_KINDS[s.k].short) : p.su ? 'Advisory' : 'No advisory', sysSub)}
      ${metric(`Within ${W.nearKm} km`, c, String(p.near.length), nearSub)}
    </div>
    <p class="note" style="margin-top:6px">Advisories in effect on ${esc(W.provAsOf)}; they come and go. No advisory covers a private well: testing it is the owner’s job. Some advisories are placed by a place or lake named in the listing, so the count within ${W.nearKm} km is approximate.</p>
    <div class="tr-falls" style="margin-top:8px">${link('water', '🚰 Drinking water on the map')}</div>`;
}

/** Light & dark: daylight on the shortest and longest days (computed from latitude), the aurora band (geomagnetic
 * latitude, NOAA's Kp rule) and the drive to the nearest campground in a RASC dark-sky preserve. */
function lightRows(p: PlaceLight, data: Data, metric: MetricFn, na: string, link: (layer: string, text: string) => string) {
  const L = data.light!;
  const [dDec, , dJun] = L.dates.map((d) => d.label);
  const civil = (h: number) => (h >= 24 ? 'civil twilight all night' : `${hm(h)} with civil twilight`);
  return `<h3>Light &amp; dark</h3>
    <div class="metric-grid">
      ${metric(`${esc(dDec)} daylight`, DAY_RAMP(p.d[0]), hm(p.d[0]), `sunrise to sunset on the shortest day · ${civil(p.c[0])}`)}
      ${metric(`${esc(dJun)} daylight`, DAY_RAMP(p.d[2]), hm(p.d[2]), `on the longest day · ${civil(p.c[2])}`)}
      ${metric('Aurora overhead', AURORA_RAMP(p.ml), AURORA_BANDS[p.a].label, `${AURORA_BANDS[p.a].text} · geomagnetic latitude ${mlText(p.ml)}°`)}
      ${metric('Dark-sky preserve', PRESERVE_COLOR, p.dark ? (p.dark.min != null ? `${p.dark.min} min` : `${Math.round(p.dark.km)} km`) : na, p.dark ? `${p.dark.min != null ? 'drive' : 'straight line'} to ${esc(p.dark.name)}, ${esc(p.dark.preserve)} · ${Math.round(p.dark.km)} km` : '')}
    </div>
    <p class="note" style="margin-top:6px">Computed from the place’s latitude (NOAA solar equations, ${L.year}) and the IGRF-14 geomagnetic dipole; the aurora band follows NOAA’s Kp rule and is not a probability.</p>
    <div class="tr-falls" style="margin-top:8px">${link('light', '☾ Light &amp; dark on the map')}</div>`;
}

/** Radon: the share of tested homes at or above the guideline in the place's 2007 health region and in its own postal
 * area(s), from Health Canada's survey. A regional odds, never a verdict on a house. */
function radonRows(p: PlaceRadon, data: Data, metric: MetricFn, link: (layer: string, text: string) => string) {
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

/** Community: who already lives in the place (Census 2021) and its places of worship (OpenStreetMap). "—" = none, a
 * handful or not published: census counts are rounded to a multiple of 5. */
function communityRows(p: PlaceCommunity, slackKm: number, metric: MetricFn, link: (layer: string, text: string) => string) {
  const c = COMMUNITY_COLOR;
  const list = (xs: [string, number][]) => xs.map(([n, v]) => `${esc(n)} (${people(v)})`).join(', ');
  const recShare = p.imm && p.rec != null ? Math.round((p.rec / p.imm) * 100) : null;
  const pw = p.pw.map((r) => `${r.n} ${r.id === 'unstated' ? 'with no faith tagged' : r.id === 'other' ? 'other faiths' : (RELIGIONS[r.id] ?? RELIGIONS.other).label}`).join(', ');
  return `<h3>Community</h3>
    <div class="metric-grid">
      ${metric('Immigrants', c, pctText(p, 'imm', 'hhPop'), p.imm ? `${people(p.imm)} people born outside Canada who have settled here${recShare != null && p.rec ? `; ${recShare}% of them arrived 2016–2021` : ''}` : 'none, a handful, or not published')}
      ${metric('Arrived 2016–21', c, pctText(p, 'rec', 'hhPop'), p.rec ? `${people(p.rec)} recent immigrants${p.npr ? ` · plus ${people(p.npr)} temporary residents (students, work permits)` : ''}` : 'none, a handful, or not published')}
      ${metric('Born in', c, p.birth.length ? esc(p.birth[0][0]) : '—', p.birth.length ? `top birthplaces of immigrants: ${list(p.birth)}` : 'too few immigrants to say')}
      ${metric('Home languages', c, pctText(p, 'nonOff', 'homeTot'), p.lang.length ? `speak a language other than English or French most often at home: ${list(p.lang)}` : 'speak a language other than English or French most often at home')}
      ${metric('French', c, pctText(p, 'frKn', 'knTot'), `can hold a conversation in French (knowledge of official languages)${p.frMT ? `; ${pctText(p, 'frMT', 'mtTot')} have French as a mother tongue` : ''}`)}
      ${metric('Indigenous identity', c, pctText(p, 'ind', 'indTot'), 'First Nations, Métis or Inuit, in the town itself (nearby reserves are counted separately)')}
      ${metric('Places of worship', c, String(p.pw.reduce((a, r) => a + r.n, 0)), pw ? `mapped in town or within ${slackKm} km: ${pw}` : `none mapped in town or within ${slackKm} km (OpenStreetMap)`)}
    </div>
    <p class="note" style="margin-top:6px">Census 2021 for the place itself. Counts are rounded to a multiple of 5, so “—” means none, a handful or not published. This is here to help you find community, not to rank people.</p>
    <div class="tr-falls" style="margin-top:8px">${link('community', '🤝 Who lives here on the map')}</div>`;
}

/** Doctors & clinics: the drive to the nearest clinic and pharmacy, and how many are in town. */
function doctorsRows(p: PlaceDoctors, slackKm: number, metric: MetricFn, na: string, link: (layer: string, text: string) => string) {
  const sub = (x: DoctorTrip | null) => (x ? `${x.min != null ? 'drive' : 'straight line'} to ${esc(x.name)}${x.city ? `, ${esc(x.city)}` : ''} · ${Math.round(x.km)} km<br>${esc(x.note)}` : 'none reachable by road');
  return `<h3>Doctors &amp; clinics</h3>
    <div class="metric-grid">
      ${metric('Clinic', DOCTORS_COLOR, p.c ? (p.c.inferred ? 'In town' : doctorTripText(p.c)) : na, p.c?.inferred ? `${esc(p.c.name)}. ${esc(p.c.note)}` : sub(p.c))}
      ${metric('Pharmacy', SITE_KINDS.rx.color, p.p ? doctorTripText(p.p) : na, sub(p.p))}
      ${metric('In town', DOCTORS_COLOR, `${p.nc} ${p.nc === 1 ? 'clinic' : 'clinics'}${p.nc ? '' : ' mapped'}`, `and ${p.np} ${p.np === 1 ? 'pharmacy' : 'pharmacies'}, inside town limits or within ${slackKm} km`)}
    </div>
    <p class="note" style="margin-top:6px">Clinics and health centres from the Saskatchewan Health Authority’s list (ODHF) and OpenStreetMap; pharmacies from OpenStreetMap. A clinic on the map is not a doctor taking new patients, and temporary closures are posted only as notices, so call first.</p>
    <div class="tr-falls" style="margin-top:8px">${link('doctors', '🩺 Doctors &amp; clinics on the map')}</div>`;
}

/** Childcare: the drive to the nearest licensed centre, and how many centres and family homes are in town. */
function childcareRows(p: PlaceChildcare, slackKm: number, metric: MetricFn, na: string, link: (layer: string, text: string) => string) {
  const sub = (x: ChildcareTrip | null) => (x ? `${x.min != null ? 'drive' : 'straight line'} to ${esc(x.name)}${x.city ? `, ${esc(x.city)}` : ''} · ${Math.round(x.km)} km<br>${esc(x.note)}` : 'none reachable by road');
  return `<h3>Childcare</h3>
    <div class="metric-grid">
      ${metric('Centre', CHILDCARE_COLOR, p.c ? childcareTripText(p.c) : na, sub(p.c))}
      ${metric('In town', CHILDCARE_COLOR, `${p.nc} ${p.nc === 1 ? 'centre' : 'centres'}`, `and ${p.nh} family child care ${p.nh === 1 ? 'home' : 'homes'}${p.ni ? `, ${p.ni} taking infants` : ''}, inside town limits or within ${slackKm} km`)}
    </div>
    <p class="note" style="margin-top:6px">Licensed centres and family child care homes on the Ministry of Education’s list; it gives no capacity, so spaces are not counted. Licensed is not the same as a space being open: waitlists are common, especially for infants. $10 a day applies only to regulated spaces.</p>
    <div class="tr-falls" style="margin-top:8px">${link('childcare', '🧸 Childcare on the map')}</div>`;
}

/** Newcomer help: the drive to the nearest settlement agency, English classes, Service Canada office and SGI issuer. */
function newcomerRows(p: PlaceNewcomer, metric: MetricFn, na: string, link: (layer: string, text: string) => string) {
  const sub = (x: NewcomerTrip | null) => (x ? `${x.min != null ? 'drive' : 'straight line'} to ${esc(x.name)}${x.city ? `, ${esc(x.city)}` : ''} · ${Math.round(x.km)} km<br>${esc(x.note)}` : 'none reachable by road');
  return `<h3>Newcomer help</h3>
    <div class="metric-grid">
      ${ERRANDS.map((g) => metric(g.label, g.color, p[g.id] ? tripText(p[g.id]!) : na, sub(p[g.id]))).join('')}
    </div>
    <p class="note" style="margin-top:6px">Settlement and language offices from IRCC’s list and the province’s; Service Canada (for a Social Insurance Number) and SGI motor licence issuers as mapped in OpenStreetMap, which misses many issuers. A health card is applied for online, by mail or at eHealth Saskatchewan in Regina.</p>
    <div class="tr-falls" style="margin-top:8px">${link('newcomer', '🧭 Newcomer services on the map')}</div>`;
}

/** Getting around: the drive to the nearest airport with scheduled flights; a VIA stop, an intercity bus stop and city buses in town. */
function transitRows(p: PlaceTransit, data: Data, metric: MetricFn, link: (layer: string, text: string) => string) {
  const T = data.transit!;
  const air = p.air ? `${p.air.min != null ? 'drive' : 'straight line'} to ${esc(p.air.name)} (${esc(p.air.iata)})${p.air.prov !== 'SK' ? `, ${esc(p.air.prov)}` : ''} · ${Math.round(p.air.km)} km` : 'none reachable by road';
  const rail = p.rail.length ? `${p.rail.map((s) => `${esc(s.n)}${s.k === 'halt' ? ' (flag stop)' : ''}`).join(', ')}${p.rail[0].line ? ` · ${esc(p.rail[0].line)}` : ''}` : 'no VIA stop in town';
  const bus = p.bus.stops ? `${p.bus.stops} stop${p.bus.stops === 1 ? '' : 's'} mapped · ${p.bus.ops.map(esc).join(', ')}` : 'none mapped in OpenStreetMap (partial)';
  const sys = p.sys ? `${esc(p.sys.n)}: ${sysText(p.sys)}${p.sys.src === 'osm' ? ' (OpenStreetMap)' : ''}${p.sys.end && p.sys.end < T.asOf ? ` · timetable file ended ${esc(p.sys.end)}` : ''}` : 'no city bus';
  return `<h3>Getting around</h3>
    <div class="metric-grid">
      ${metric('Airport', TRANSIT_COLOR, airText(p), air)}
      ${metric('Train', RAIL_COLOR, p.rail.length ? 'VIA' : 'None', rail)}
      ${metric('Intercity bus', BUS_COLOR, p.bus.stops ? 'Yes' : 'None mapped', bus)}
      ${metric('City bus', CITY_COLOR, p.sys ? 'Yes' : 'No', sys)}
    </div>
    <p class="note" style="margin-top:6px">STC, the provincial bus, closed in 2017. Airports are those OurAirports marks with scheduled passenger service; trains and intercity buses are as mapped in OpenStreetMap (bus coverage is partial); city buses from the city’s GTFS feed. None of it says how often anything runs.</p>
    <div class="tr-falls" style="margin-top:8px">${link('transit', '✈ Getting around on the map')}</div>`;
}

/** Home costs: Census 2021 for the place itself, and CMHC's market rent where the place is a surveyed centre. */
function homeCosts(t: TownMetrics, metric: MetricFn, na: string, link: (layer: string, text: string) => string) {
  const c = '#e6a57e';
  const dollars = (v: number | null) => (v != null ? `$${fmt.int(v)}` : na);
  const mr = t.marketRent;
  return `<h3>Home costs</h3>
    <div class="metric-grid">
      ${metric('Home value', c, t.homeValue != null ? fmt.money(t.homeValue) : na, t.homeValue != null ? 'median value of owned dwellings, Census 2021' : 'not published for this place')}
      ${metric('Rent paid', c, dollars(t.rentCost), t.rentCost != null ? 'median a month for renters, with utilities, 2021' : 'not published for this place')}
      ${metric('Owner costs', c, dollars(t.ownCost), t.ownCost != null ? 'median a month: mortgage, tax, utilities, 2021' : '')}
      ${metric('Stretched', c, t.stir30 != null ? `${t.stir30.toFixed(0)}%` : na, t.stir30 != null ? `of households spend 30 %+ of income on shelter${t.rent30 != null ? ` (renters ${t.rent30.toFixed(0)}%)` : ''}, 2021` : '')}
      ${mr ? metric('Market rent', c, dollars(mr.r2), `CMHC average 2-bedroom, ${mr.year}${mr.r1 != null ? ` · 1-bed $${fmt.int(mr.r1)}` : ''} · ${esc(mr.centre)} area`) : ''}
      ${mr ? metric('Vacancy', c, mr.vac != null ? `${mr.vac.toFixed(1)}%` : na, mr.vac != null ? `of purpose-built rentals empty, October ${mr.year} (3 % is roughly balanced)` : 'no vacancy series for this centre') : ''}
      ${propTaxMetric(t, metric, na)}
    </div>
    <div class="tr-falls" style="margin-top:8px">${link('housing', '⌂ Home costs on the map')}</div>`;
}

/** Property tax: the indicative annual tax on the median home and the residential mill rate it uses (Mill Rate Survey). */
function propTaxMetric(t: TownMetrics, metric: MetricFn, na: string) {
  const p = t.propTax;
  const c = '#e6a57e';
  if (!p) return metric('Property tax', c, na, 'no mill rate reported in the Mill Rate Survey for this place');
  const rate = `${p.r.toFixed(2)} mills residential (${p.year})${p.f ? `: uniform ${p.mr.toFixed(2)} × factor ${p.f.toFixed(2)}` : ''}`;
  if (p.x) return metric('Property tax', c, na, `${rate} · Lloydminster is assessed under its own charter, so no comparable estimate`);
  const extra = [p.bt ? 'a base tax' : '', p.mt ? 'a minimum tax' : ''].filter(Boolean).join(' and ');
  return metric('Property tax', c, p.tax != null ? `~$${fmt.int(p.tax)}` : na, `${p.tax != null ? 'a year on the median home (indicative) · ' : ''}${rate} + ${p.edu.toFixed(2)} education${extra ? ` · also charges ${extra} (not included)` : ''}`);
}

/** Jobs & income: the Labour Force Survey region's latest unemployment rate, and Census 2021 income and industries for the place. */
function jobsIncome(t: TownMetrics, metric: MetricFn, na: string, link: (layer: string, text: string) => string) {
  const c = '#7fd1b9';
  const r = t.jobsRegion;
  const ind = t.industries;
  return `<h3>Jobs &amp; income</h3>
    <div class="metric-grid">
      ${metric('Regional unemployment', c, r ? `${r.ur.toFixed(1)}%` : na, r ? `${esc(r.name)}${r.combined ? ' (two regions reported together)' : ''}, ${r.year} · Labour Force Survey; the whole region, not just this place` : 'no survey region for this place')}
      ${metric('Household income', c, t.income != null ? fmt.money(t.income) : na, t.income != null ? 'median total income of households, 2020 (Census 2021)' : 'not published for this place')}
      ${t.censusUnemp != null ? metric('Unemployed in town', c, `${t.censusUnemp.toFixed(1)}%`, 'census week, May 2021, during the pandemic') : ''}
    </div>
    ${ind.length ? `<div class="metric" style="margin-top:8px"><div class="mk"><span class="dot" style="background:${c}"></span>Top industries</div><div class="ms">${ind.map((s) => `<b>${esc(s.name)}</b> ${s.pct.toFixed(0)}%`).join(' · ')}<br>share of the labour force by industry (NAICS sectors), Census 2021</div></div>` : ''}
    <div class="tr-falls" style="margin-top:8px">${link('jobs', '⚒ Jobs &amp; income on the map')}</div>`;
}

/** "What it feels like": 30-year climate normals, each from the nearest station that reports it. */
function feelsRow(t: TownMetrics, data: Data, metric: MetricFn, na: string) {
  if (!data.normals) return '';
  const f = t.feels;
  const from = (p: TownMetrics['feels']['sun']) => (p ? `${esc(p.name)} (${Math.round(p.dist)} km)` : 'no station nearby');
  const c = '#c5e86c';
  return `<h3>What it feels like · ${data.normals.period} normals</h3>
    <div class="metric-grid">
      ${metric('Sunshine', c, f.sun ? `${fmt.int(f.sun.v)} h` : na, `a year · ${from(f.sun)}`)}
      ${metric('Rain & snow days', c, f.wetDays ? fmt.int(f.wetDays.v) : na, `≥0.2 mm a year · ${from(f.wetDays)}`)}
      ${metric('Frost days', c, f.frostDays ? fmt.int(f.frostDays.v) : na, `low ≤0 °C · ${from(f.frostDays)}`)}
      ${metric('Snowfall', c, f.snow ? `${fmt.int(f.snow.v)} cm` : na, `a year · ${from(f.snow)}`)}
    </div>`;
}

// ---------------------------------------------------------------------------------------------

/** The Finder's "Include small communities" switch: off by default, kept while the page is open. */
let includeSmall = false;

export function renderFinder(
  el: HTMLElement,
  data: Data,
  weights: Record<string, number>,
  opts: { onChange: (ranked: ReturnType<typeof rankTowns>) => void; onPick: (key: string) => void; onClose: () => void },
) {
  let towns: TownMetrics[] = townMetrics(data);
  el.innerHTML = `
    <button class="close-x" aria-label="Close Town Finder">×</button>
    <div class="kicker" style="--c:#a99bff">Town Finder</div>
    <h2>Where should we live?</h2>
    <p class="lede">Tell the atlas what matters to you. Every place is ranked on each factor from the open data, then blended using your weights. Columns on the map show the overall score.</p>
    ${data.commute ? `<div class="work-row"><label>I work in… <select class="work-sel" aria-label="I work in"><option value="">nowhere set</option>${[...data.munis].sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<option value="${m.key}">${esc(m.name)}</option>`).join('')}</select></label><button class="tr-fall tr-commute work-go" type="button">🚗 Workday Reach ›</button></div>` : ''}
    <div class="weights"></div>
    <div class="chips" style="margin:6px 0 4px">
      <button class="chip" data-preset="balanced">Balanced</button>
      <button class="chip" data-preset="safe">Safety first</button>
      <button class="chip" data-preset="family">Growing family</button>
      <button class="chip" data-preset="quiet">Quiet &amp; small</button>
      <button class="chip" data-preset="newcomer">New to Saskatchewan</button>
    </div>
    ${data.small.length ? `<label class="small-sw" style="display:flex;gap:8px;align-items:center;margin:8px 0 2px;font-size:12.5px;color:var(--ink-2)"><input type="checkbox" class="small-on"${includeSmall ? ' checked' : ''}> Include small communities (${data.small.length} more towns and villages: census, hazards and what is mapped in town; no crime, and no drive-time criteria, since their distances are straight lines)</label>` : ''}
    <h3>Your ranking</h3>
    <ol class="rank-list"></ol>
    <p class="note">Scores are relative (0–100 = worst to best among the atlas’s places on your criteria). Missing data (a place with no police series, say) is skipped rather than penalized, so a place scored on fewer of your criteria says so (“scored on 9 of 14”); small communities have no crime series and no drive times, so with those weighted they are ranked on the rest alone. Your weights and workplace are saved in this browser.</p>`;
  el.querySelector('.close-x')!.addEventListener('click', opts.onClose);

  const wEl = el.querySelector('.weights')!;
  for (const c of CRITERIA) {
    const row = document.createElement('label');
    row.className = 'weight';
    row.title = c.hint;
    row.innerHTML = `<span>${c.label}<br><span style="color:var(--ink-3);font-size:11px">${c.hint}</span></span><input type="range" min="0" max="5" step="1" value="${weights[c.id]}" data-id="${c.id}"><span class="wv">${weights[c.id]}</span>`;
    wEl.appendChild(row);
  }
  // "I work in…": switches the Short commute criterion on, and is shared with Workday Reach
  const workSel = el.querySelector<HTMLSelectElement>('.work-sel');
  const goBtn = el.querySelector<HTMLButtonElement>('.work-go');
  const commuteRow = wEl.querySelector<HTMLInputElement>('input[data-id="commute"]');
  const syncWork = () => {
    const w = workplace(data);
    if (workSel) workSel.value = w ?? '';
    if (goBtn) goBtn.hidden = !w;
    if (commuteRow) { commuteRow.disabled = !w; commuteRow.closest('.weight')!.classList.toggle('off', !w); }
  };
  syncWork();
  workSel?.addEventListener('change', () => { setWork({ key: workSel.value || null }); syncWork(); refresh(); });
  goBtn?.addEventListener('click', () => { const w = workplace(data); if (w) startCommute(w); });
  const list = el.querySelector('.rank-list')!;
  const zero = Object.fromEntries(CRITERIA.map((c) => [c.id, 0]));
  const PRESETS: Record<string, Record<string, number>> = {
    balanced: Object.fromEntries(CRITERIA.map((c) => [c.id, c.defaultWeight])),
    safe: { ...zero, ...migrate({ safety: 5, violent: 5, solved: 3, police: 3, court: 1, hospital: 3, fire: 1, services: 1 }) },
    family: { ...zero, ...migrate({ safety: 3, violent: 3, hospital: 4, growth: 4, services: 3, warm: 1, sun: 1, fire: 1 }) },
    quiet: { ...zero, ...migrate({ safety: 3, violent: 3, services: 0, fire: 3, tornado: 2, hospital: 2, sun: 1 }) },
    // Short commute only counts once "I work in…" is set
    newcomer: { ...zero, rent: 3, jobs: 3, commute: 3, diverse: 2, needs: 2, hospital: 2, clinic: 2, newcomer: 2, safety: 2, internet: 1 },
  };

  const smallBox = el.querySelector<HTMLInputElement>('.small-on');
  const pickTowns = () => { towns = includeSmall ? townMetrics(smallView(data)) : townMetrics(data); };
  pickTowns();
  smallBox?.addEventListener('change', () => { includeSmall = smallBox.checked; pickTowns(); refresh(); });
  const refresh = () => {
    const ranked = rankTowns(towns, weights);
    const w = workplace(data);
    const to = (k: string) => { if (!w) return ''; const v = driveMin(data, k, w); return k === w ? ' · where you work' : v != null ? ` · ${v} min to work` : ''; };
    // missing criteria are skipped, never penalized: say how many of the weighted ones a place was scored on
    const weighted = CRITERIA.filter((c) => (weights[c.id] ?? 0) > 0);
    const cover = (r: (typeof ranked)[number]) => { const n = weighted.filter((c) => r.parts[c.id] != null).length; return n < weighted.length ? ` · scored on ${n} of ${weighted.length}` : ''; };
    list.innerHTML = ranked
      .map((r, i) => `<li data-key="${r.t.muni.key}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.t.muni.name)}</span><br><span class="rd">${r.t.muni.tier === 2 ? `${esc(r.t.muni.kind.toLowerCase())} · ` : ''}${r.t.pop ? fmt.int(r.t.pop) + ' people' : ''}${r.t.csi != null ? ` · CSI ${r.t.csi.toFixed(0)}` : ''}${to(r.t.muni.key)}${cover(r)}</span></span><span><div class="bar"><i style="width:${Math.round(r.score * 100)}%"></i></div><div class="bar-v">${Math.round(r.score * 100)}</div></span></li>`)
      .join('');
    opts.onChange(ranked);
  };
  wEl.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    weights[inp.dataset.id!] = +inp.value;
    inp.nextElementSibling!.textContent = inp.value;
    saveWeights(weights);
    refresh();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      Object.assign(weights, PRESETS[b.dataset.preset!]);
      wEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.value = String(weights[i.dataset.id!]); i.nextElementSibling!.textContent = i.value; });
      saveWeights(weights);
      refresh();
    }),
  );
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (li) opts.onPick(li.dataset.key!);
  });
  refresh();
}
