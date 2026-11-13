// Workday Reach: the sibling of Camping & rec's Weekend Reach, for the drive to work. A static layer.
//
// Pick the place you work and a commute limit (15, 30, 45 or 60 min): a wave rolls out from the workplace and an arc
// reaches each place at the moment its drive to work fits, labelled with the drive and the place's current Town Finder
// rank under your own weights, so the commute shortlist and the Finder agree. Drive times are a 62×62 OSRM table built
// by the `commute` data stage (home → work, free-flow). The workplace is the Finder's "I work in…" setting too
// (`getWork`/`setWork` in metrics.ts), remembered in this browser.
import * as d3 from 'd3';
import { ArcLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { Muni, fmt, km } from './data';
import { esc } from './html';
import { ADDITIVE, AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine } from './layers';
import { COMMUTE_LIMITS, driveMin, getWork, rankTowns, setWork, townMetrics, workplace } from './metrics';
import { loadWeights } from './panels';
import type { Data } from './data';

const COLOR = '#c9a7ff';
/** Timeline speed of the wave: milliseconds of animation per minute of driving. */
const MS_PER_MIN = 70;

/** Opens Workday Reach with `key` as the workplace (it also becomes the Finder's "I work in…"). */
export function startCommute(key: string) {
  setWork({ key });
  window.dispatchEvent(new CustomEvent('atlas:layer', { detail: 'commute' }));
}

/** How many other places are within `limit` minutes' drive of a workplace. */
export function placesWithin(data: Data, work: string, limit: number) {
  return data.munis.filter((m) => m.key !== work && (driveMin(data, m.key, work) ?? Infinity) <= limit).length;
}

type Reach = { m: Muni; min: number; pos: number | null; score: number | null };

/** Labels to draw: where two places are within LABEL_KM, only the better Finder match (or the shorter drive) is labelled. */
const LABEL_KM = 20;
function declutter(rs: Reach[]) {
  const kept: Reach[] = [];
  for (const r of [...rs].sort((a, b) => (a.pos ?? 1e3) - (b.pos ?? 1e3) || a.min - b.min))
    if (!kept.some((k) => km(k.m.lon, k.m.lat, r.m.lon, r.m.lat) < LABEL_KM)) kept.push(r);
  return kept;
}

export function commuteLayer(data: Data): AtlasLayer {
  const C = data.commute;
  const munis = [...data.munis].sort((a, b) => a.name.localeCompare(b.name));
  const muni = (k: string | null) => data.munis.find((m) => m.key === k) ?? null;
  const ramp = d3.scaleLinear<string>().domain([0, 30, 60]).range(['#ffffff', COLOR, '#5b3fd6']).interpolate(d3.interpolateRgb).clamp(true);

  // ---- the wave: restarted whenever the workplace or the limit changes
  let waveStart = -1e9;
  let waveFor = '';
  let rows: Reach[] = []; // every place with a drive to the workplace, nearest first
  const sig = () => `${workplace(data) ?? ''}:${getWork().limit}`;
  const waveMin = (clock: number) => Math.min(getWork().limit, Math.max(0, (clock - waveStart) / MS_PER_MIN));
  /** Rebuilds the drives to the workplace and the Finder rank of every place, under the viewer's current weights. */
  const measure = () => {
    const w = workplace(data);
    if (!w) { rows = []; return; }
    const weights = loadWeights();
    const any = Object.values(weights).some((v) => v > 0);
    const ranked = rankTowns(townMetrics(data), weights);
    const rank = new Map(ranked.map((r, i) => [r.t.muni.key, { pos: i + 1, score: r.score }]));
    rows = data.munis
      .map((m) => ({ m, min: driveMin(data, m.key, w), r: rank.get(m.key) }))
      .filter((x): x is { m: Muni; min: number; r: { pos: number; score: number } | undefined } => x.min != null)
      .map((x) => ({ m: x.m, min: x.min, pos: any && x.r ? x.r.pos : null, score: any && x.r ? x.r.score : null }))
      .sort((a, b) => a.min - b.min);
  };
  const inReach = () => rows.filter((r) => r.min <= getWork().limit);
  const fly = () => {
    const o = muni(workplace(data));
    if (!o) return;
    const pts = inReach().map((r) => r.m);
    const xs = [o.lon, ...pts.map((m) => m.lon)], ys = [o.lat, ...pts.map((m) => m.lat)];
    // room for the labels beside the outermost places (and around a lone workplace, so the camera doesn't dive in)
    const pad = pts.length > 1 ? 0.4 : 0.6;
    window.dispatchEvent(new CustomEvent('atlas:fly', { detail: { bounds: [[d3.min(xs)! - pad, d3.min(ys)! - pad * 0.3], [d3.max(xs)! + pad, d3.max(ys)! + pad * 0.3]] } }));
  };
  const ignite = () => {
    measure();
    waveFor = sig();
    waveStart = performance.now();
    if (rows.length) fly();
  };
  // a change from the Finder or the Town Report while the layer is up: roll the wave again on the next frame
  window.addEventListener('atlas:work', () => { waveFor = ''; });

  const l: AtlasLayer = {
    id: 'commute',
    name: 'Workday Reach',
    icon: '🚗',
    color: COLOR,
    range: [2025, 2025.99],
    static: true,
    period: 'the drive to work, from any place',
    available: !!C,
    unavailable: 'The drive-time table has not been built. Run <code>npm run data commute</code>, then reload.',
    build({ focusedId, clock, selected }) {
      const focused = focusedId === 'commute';
      const w = workplace(data);
      if (focused && sig() !== waveFor) ignite();
      const origin = muni(w);
      const limit = getWork().limit;
      const wm = focused ? waveMin(clock) : limit;
      const lead = (clock - waveStart) / MS_PER_MIN;
      const byKey = new Map(rows.map((r) => [r.m.key, r]));
      const lit = origin ? rows.filter((r) => r.min <= wm && r.m.key !== origin.key) : [];
      const out: Layer[] = [];
      // every place: lit in the wave's colour once its drive fits, a dim dot otherwise
      out.push(new ScatterplotLayer<{ m: Muni }>({
        id: 'commute-places', data: data.munis.map((m) => ({ m })), getPosition: (d) => [d.m.lon, d.m.lat],
        getRadius: (d) => (d.m.key === selected ? 3200 : 2200), radiusMinPixels: 3.5, radiusMaxPixels: 9,
        getFillColor: (d) => { const r = byKey.get(d.m.key); return origin && r && r.min <= wm ? rgb(ramp(r.min), 255) : [120, 126, 140, origin ? 150 : 220]; },
        stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 1.2,
        updateTriggers: { getFillColor: [w, Math.floor(wm), limit], getRadius: selected },
        pickable: true, parameters: { depthCompare: 'always' },
      } as any));
      if (!origin) return out;
      out.push(
        new ScatterplotLayer<Muni>({
          id: 'commute-wave', data: [origin], getPosition: (m) => [m.lon, m.lat],
          // a ring at about 90 km/h as the crow flies: only a hint of the wave, the arcs are the drive times
          getRadius: Math.max(1, wm * 1500), stroked: true, filled: false, lineWidthMinPixels: 2,
          getLineColor: rgb(COLOR, wm >= limit ? 60 : 200),
          updateTriggers: { getRadius: wm, getLineColor: wm >= limit }, parameters: NO_DEPTH,
        } as any),
        new ArcLayer<Reach>({
          id: 'commute-arcs', data: lit,
          getSourcePosition: () => [origin.lon, origin.lat],
          getTargetPosition: (r) => [r.m.lon, r.m.lat],
          getSourceColor: [255, 255, 255, 170],
          getTargetColor: (r) => rgb(ramp(r.min), 235),
          getWidth: (r) => (lead - r.min < 4 ? 3.5 : 2),
          getHeight: 0.5, greatCircle: false, widthUnits: 'pixels',
          updateTriggers: { getWidth: Math.floor(lead) },
          parameters: ADDITIVE,
        } as any),
        new ScatterplotLayer<Muni>({
          id: 'commute-origin', data: [origin], getPosition: (m) => [m.lon, m.lat],
          getRadius: 2800, radiusMinPixels: 7, getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: rgb(COLOR), lineWidthMinPixels: 3,
          parameters: { depthCompare: 'always' },
        } as any),
      );
      if (focused)
        out.push(
          new TextLayer<Reach>({
            id: 'commute-labels', data: declutter(lit), getPosition: (r) => [r.m.lon, r.m.lat],
            getText: (r) => `${r.m.name}\n${r.min} min${r.pos ? ` · #${r.pos} in Finder` : ''}`,
            // each label sits on the side away from the workplace, so neighbouring towns don't stack
            getSize: 12, getColor: [255, 255, 255, 255],
            getTextAnchor: (r) => (r.m.lon >= origin.lon ? 'start' : 'end'), getPixelOffset: (r) => [r.m.lon >= origin.lon ? 9 : -9, 0], getAlignmentBaseline: 'center',
            fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true },
            updateTriggers: { getText: [w, rows], getTextAnchor: w, getPixelOffset: w }, parameters: { depthCompare: 'always' },
          } as any),
          new TextLayer<Muni>({
            id: 'commute-clock', data: [origin], getPosition: (m) => [m.lon, m.lat],
            getText: (m) => `💼 ${m.name}\n${Math.floor(wm)} min · ${lit.length} place${lit.length === 1 ? '' : 's'}`,
            getSize: 14, getColor: [255, 255, 255, 255], getPixelOffset: [0, 22], getAlignmentBaseline: 'top',
            fontFamily: 'Inter, sans-serif', fontWeight: 800, characterSet: 'auto', outlineWidth: 4, outlineColor: [6, 10, 18, 235], fontSettings: { sdf: true },
            updateTriggers: { getText: [Math.floor(wm), lit.length, w] }, parameters: { depthCompare: 'always' },
          } as any),
        );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Workday Reach · the drive to work')}
        <h2>Where can I live and still get to work?</h2>`;
      if (!C) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Pick the place you work and how long a drive you’ll take. An arc reaches every place whose ${C.routed ? 'drive' : 'rough straight-line estimate'} to work fits, labelled with the minutes and where the place ranks in <b>your Town Finder</b>, so the shortlist here and the Finder agree. Click a place for its report.</p>`);
      const hero = heroStats(el, 3);
      const W = el.appendChild(mk('div', 'reach commute'));
      W.innerHTML = `<h3>I work in…</h3>
        <div class="reach-row">
          <select class="reach-town" aria-label="I work in"><option value="">Pick a workplace…</option>${munis.map((m) => `<option value="${m.key}">${esc(m.name)}</option>`).join('')}</select>
          <button class="reach-go" type="button" style="--c:${COLOR}">🚗 Roll the commute</button>
        </div>
        <div class="chips" style="margin:8px 0 4px">${COMMUTE_LIMITS.map((x) => `<button class="chip" data-lim="${x}" style="--c:${COLOR}">${x} min</button>`).join('')}</div>
        <div class="reach-live" aria-live="polite"></div>
        <div class="callout commute-best" style="--c:${COLOR}" hidden></div>
        <ol class="rank-list reach-places"></ol>
        <div class="tr-falls" style="margin-top:6px"><button class="tr-fall commute-finder" type="button">✦ Change what matters in the Town Finder ›</button></div>`;
      const sel = W.querySelector<HTMLSelectElement>('.reach-town')!;
      sel.value = workplace(data) ?? '';
      const liveEl = W.querySelector<HTMLElement>('.reach-live')!;
      const bestEl = W.querySelector<HTMLElement>('.commute-best')!;
      const listEl = W.querySelector<HTMLElement>('.reach-places')!;
      const chips = () => W.querySelectorAll<HTMLButtonElement>('[data-lim]').forEach((b) => b.classList.toggle('on', +b.dataset.lim! === getWork().limit));
      chips();
      W.querySelector('.chips')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lim]');
        if (!b) return;
        setWork({ limit: +b.dataset.lim! });
        chips();
        ignite();
      });
      sel.addEventListener('change', () => { setWork({ key: sel.value || null }); ignite(); });
      W.querySelector('.reach-go')!.addEventListener('click', () => { if (sel.value) { setWork({ key: sel.value }); ignite(); } else sel.focus(); });
      W.querySelector('.commute-finder')!.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:finder')));
      listEl.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest<HTMLElement>('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });

      // the province at a glance: how many places the median workplace reaches
      const medWithin = (lim: number) => d3.median(data.munis, (m) => placesWithin(data, m.key, lim)) ?? 0;
      hero(0, String(data.munis.length), 'places, every pair driven');
      hero(1, String(Math.round(medWithin(45))), 'other places a typical workplace reaches in 45 min');
      hero(2, String(Math.round(medWithin(60))), 'in an hour');

      // the panel is redrawn on every visit: restart the wave only if the workplace or limit changed (or it never ran)
      if (sig() !== waveFor) ignite(); else measure();

      let lastShown = '';
      const show = (clock: number) => {
        const w = workplace(data);
        const lim = getWork().limit;
        const wm = waveFor === sig() ? waveMin(clock) : lim;
        const s = `${w}:${lim}:${Math.floor(wm)}:${rows.length}`;
        if (s === lastShown) return;
        lastShown = s;
        if (sel.value !== (w ?? '')) sel.value = w ?? '';
        chips();
        if (!w) {
          liveEl.innerHTML = `<div class="rd">Pick a workplace to see where you could live.</div>`;
          bestEl.hidden = true;
          listEl.innerHTML = '';
          return;
        }
        const got = rows.filter((r) => r.min <= wm && r.m.key !== w);
        const pop = d3.sum(got, (r) => townMetrics(data).find((t) => t.muni.key === r.m.key)?.pop ?? 0);
        liveEl.innerHTML = `<div class="reach-big"><b>${got.length}</b> place${got.length === 1 ? '' : 's'} within <b>${Math.floor(wm)} min</b> of ${esc(muni(w)!.name)}</div>
          <div class="rd">${pop ? `${fmt.int(pop)} people live in them · ` : ''}the median workplace has ${Math.round(medWithin(lim))} within ${lim} min</div>`;
        // the shortlist: every place in reach (the workplace itself first), best Finder match called out
        const all = rows.filter((r) => r.min <= wm);
        const best = all.filter((r) => r.pos != null).sort((a, b) => a.pos! - b.pos!)[0];
        bestEl.hidden = !best;
        if (best) bestEl.innerHTML = `Your best Finder match within ${lim} min is <b>${esc(best.m.name)}</b>, <b>#${best.pos}</b> of ${data.munis.length} (score ${Math.round(best.score! * 100)})${best.m.key === w ? ', the workplace itself' : `, ${best.min} min from work`}.`;
        listEl.innerHTML = all.map((r) => `<li data-key="${r.m.key}"><span class="rk">${r.pos ?? '·'}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${r.m.key === w ? 'the workplace' : `${r.min} min to work`}${r.pos ? ` · Finder #${r.pos}, score ${Math.round(r.score! * 100)}` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.min / lim) * 100)}%;background:${ramp(r.min)}"></i></div><div class="bar-v">${r.min}</div></span></li>`).join('');
      };

      el.insertAdjacentHTML('beforeend', `
        <p class="note">The number beside each place is its rank in your Town Finder (your saved weights; no number if every weight is zero). Drive times are ${C.routed ? 'the OSRM router’s free-flow drive on OpenStreetMap roads' : 'a rough estimate (80 km/h along a road 1.3 times the straight line), as no routing service was reachable'}, from the centre of the place you live to the centre of the place you work: rush hour, winter roads, construction and where in town you live or work are not counted, so allow extra. The rolling ring is only a guide; the arcs are the drive times. Setting a workplace here also sets “I work in…” in the Town Finder, where <b>Short commute</b> can weigh it; it is saved in this browser.</p>
        ${sourceLine(`${C.source}, ${C.asOf}.`)}`);
      return { update({ clock }) { show(clock); } };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      const o: any = info.object;
      if (!o || !id.startsWith('commute')) return null;
      const m: Muni | undefined = o.m ?? (id === 'commute-origin' ? o : undefined);
      if (!m) return null;
      const w = workplace(data);
      const r = rows.find((x) => x.m.key === m.key);
      if (!w) return `<b>${esc(m.name)}</b><br><span class="tk">Pick a workplace in the panel</span><br><span class="tk">Click for town report</span>`;
      return `<b>${esc(m.name)}</b>${m.key === w ? '<br><span class="tk">Your workplace</span>' : r ? `<br><span class="tk">Drive to ${esc(muni(w)!.name)}</span> <span class="tv">${r.min} min</span>` : ''}${r?.pos ? `<br><span class="tk">Town Finder</span> <span class="tv">#${r.pos} · ${Math.round(r.score! * 100)}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}
