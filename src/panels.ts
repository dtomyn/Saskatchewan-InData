// Town Report and Town Finder side panels.
import { Data, fmt } from './data';
import { lineChart } from './charts';
import { townProjectionRow } from './projections';
import { smallView } from './small';
import { cityTractsHTML, drawCityTracts } from './tracts';
import { esc } from './html';
import { startReach, campsWithin } from './camping';
import { CRITERIA, TownMetrics, driveMin, getWork, migrate, rankTowns, saveWeights, setWork, townMetrics, workplace } from './metrics';
import { placesWithin, startCommute, commuteMetric } from './commute';
import { CROPS_COLOR, cropsBar, cropsText, placeCrops } from './crops';
import { droughtNow, droughtStrip } from './drought';
import { metric, na, link, tripV, tripSub } from './report-kit';
import { rightNow } from './now';
import { dailyNeeds } from './needs';
import { schoolsRows } from './schools';
import { internetRows } from './internet';
import { industryRows } from './industry';
import { waterRows } from './water';
import { lightRows } from './light';
import { radonRows } from './radon';
import { communityRows } from './community';
import { doctorsRows } from './doctors';
import { childcareRows } from './childcare';
import { newcomerRows } from './newcomer';
import { transitRows } from './transit';
import { homeCosts } from './housing';
import { jobsIncome } from './jobs';
import { feelsRow } from './normals';

// ---------------------------------------------------------------------------------------------

export function renderTownReport(el: HTMLElement, data: Data, key: string, opts: { onClose: () => void; rank?: { pos: number; of: number; score: number } }) {
  const t = townMetrics(data).find((x) => x.muni.key === key);
  if (!t) return;
  const m = t.muni;
  const csiSub = t.csi != null ? `index, ${t.csiYear} (lower = safer)${t.police ? `<br>${esc(t.police.name)}${t.police.rural ? ' (covers the surrounding area)' : ''}` : ''}` : 'no police-service series for this place';

  el.innerHTML = `
    <button class="close-x" aria-label="Close town report">×</button>
    <div class="kicker" style="--c:#ffffff">${esc(m.kind)} · ${esc(m.rd)} Saskatchewan${t.treaty ? ` · ${esc(t.treaty)} territory` : ''}</div>
    <h2>${esc(m.name)}</h2>
    ${opts.rank ? `<p class="lede">Ranks <b>#${opts.rank.pos} of ${opts.rank.of}</b> in your Town Finder (score ${Math.round(opts.rank.score * 100)}).</p>` : ''}
    ${cityTractsHTML(data, key)}
    ${rightNow(data, m)}
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
      ${commuteMetric(data, key)}
    </div>
    ${data.commute ? `<div class="tr-falls" style="margin-top:8px"><button class="tr-fall tr-commute" type="button">🚗 Work in ${esc(m.name)}? ${placesWithin(data, key, getWork().limit)} other places within ${getWork().limit} min ›</button></div>` : ''}
    ${data.camping ? `<div class="tr-falls" style="margin-top:8px">${campsWithin(data, key, 120) != null ? `<button class="tr-fall tr-reach" type="button">🔥 Light the campfires: ${campsWithin(data, key, 120)} campgrounds within 2 h ›</button>` : ''}${link('camping', '⛺ Camping &amp; rec on the map')}</div>` : ''}
    ${data.needs && t.needs ? dailyNeeds(t.needs, data.needs.slackKm) : ''}
    ${data.schools && t.schools ? schoolsRows(t) : ''}
    ${data.internet && t.internet ? internetRows(t.internet) : ''}
    ${data.community && t.community ? communityRows(t.community, data.community.slackKm) : ''}
    ${data.doctors && t.doctors ? doctorsRows(t.doctors, data.doctors.slackKm) : ''}
    ${data.newcomer && t.newcomer ? newcomerRows(t.newcomer) : ''}
    ${data.transit && t.transit ? transitRows(t.transit, data) : ''}
    ${data.childcare && t.childcare ? childcareRows(t.childcare, data.childcare.slackKm) : ''}
    ${data.industry && t.industry ? industryRows(t.industry, data, key) : ''}
    ${data.water && t.water ? waterRows(t.water, data) : ''}
    ${data.radon && t.radon ? radonRows(t.radon, data) : ''}
    ${data.housing ? homeCosts(t) : ''}
    ${data.jobs ? jobsIncome(t) : ''}
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
    ${feelsRow(t, data)}
    ${data.light && t.light ? lightRows(t.light, data) : ''}
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
