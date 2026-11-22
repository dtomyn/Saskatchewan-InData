// VOTING — federal elections in Saskatchewan as Elections Canada published them. The wow is "Draw the votes, not the
// land": one dot per few votes, placed inside the poll where they were cast and coloured by the candidate's party, so a
// city block of voters outweighs a township of fields, as it does in the count. Chips switch the polls to the winner
// (margin as strength of colour), turnout and the advance vote (both by advance polling district). The timeline steps
// through the elections: polls for 2015–2025, the ridings' seats and votes in the panel back to 1908.
//
// Plain facts only: standard party colours, counts as published, nothing ranked or judged, never in the Town Finder.
// Polls are redrawn before every election, so a poll is never compared with "the same" poll at another election.
import * as d3 from 'd3';
import { PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, fmt, loadVotingPolls } from './data';
import type { VotingAdvance, VotingElection, VotingHistory, VotingPlace, VotingPolls, VotingRiding } from './data';
import { esc } from './html';
import { ChartHandle, lineChart, rampCSS } from './charts';
import { AtlasEvent, AtlasLayer, deferChart, filterExt, heroStats, kicker, mk, rgb, sourceLine } from './layer-kit';
import type { RGBA } from './layer-kit';
import { link, metric } from './report-kit';

export const VOTING_COLOR = '#e3c98f';

/** Standard party colours (lightened a little for the dark map). Parties not listed are grey. */
const PARTY_COLORS: Record<string, string> = {
  cpc: '#4a7fe0', pc: '#7d95ea', con: '#5f7fcf', lpc: '#e8363f', ndp: '#f58220', ccf: '#f0a24a',
  gpc: '#43b649', ppc: '#8c64d8', ref: '#3cb371', ca: '#5fa3a6', sc: '#9be36e', prog: '#d9b27c',
  government: '#8f9bd6', 'national-government': '#8f9bd6', 'liberal-progressive': '#e8797f', 'canadian-future-party': '#d6a43c',
  ind: '#a5abb8', na: '#a5abb8',
};
export const partyColor = (k: string) => PARTY_COLORS[k] ?? '#b3b6c2';
/** The dots: one per `DOT_BASE` votes at the closest zoom; farther out a random share of them, one per `dotVotes(zoom)`. */
const DOT_BASE = 5;
const dotVotes = (zoom: number) => (zoom < 7 ? 20 : zoom < 9 ? 10 : 5);

type Mode = 'dots' | 'win' | 'turnout' | 'adv';
const MODES: { id: Mode; chip: string }[] = [
  { id: 'dots', chip: 'Votes, as dots' },
  { id: 'win', chip: 'Winner by poll' },
  { id: 'turnout', chip: 'Turnout' },
  { id: 'adv', chip: 'Advance vote' },
];

// ---- one election's polls, decoded once

type Ring = [number, number][];
type Poll = {
  i: number; ri: number; lab: string; name: string; adv: number | null; el: number; rej: number; votes: number[] | null;
  polys: Ring[][]; pt: [number, number] | null; areas: number[]; valid: number; win: number | null; margin: number;
};
type District = { el: number; ed: number; av: number; polls: number };
type YearView = {
  e: VotingElection; polls: Poll[]; adv: VotingAdvance[]; dist: Map<string, District>; rows: { p: Poll; poly: Ring[] }[];
  outline: Ring[]; dots: { n: number; pos: Float32Array; col: Uint8Array; q: Float32Array; drawn: number } | null;
  /** valid votes by party key, and advance ballots with no district on the map (an advance poll on a reserve, say) */
  byParty: Record<string, number>; unplaced: number;
};

const ringArea = (r: Ring) => { let s = 0; for (let i = 1; i < r.length; i++) s += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; return Math.abs(s / 2); };
function decodeRing(a: number[], q: number): Ring {
  const out: Ring = [];
  let x = 0, y = 0;
  for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; out.push([x / q, y / q]); }
  if (out.length && (out[0][0] !== out.at(-1)![0] || out[0][1] !== out.at(-1)![1])) out.push(out[0]);
  return out;
}
/** Even–odd point in a polygon with holes. */
function inside(x: number, y: number, rings: Ring[]) {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** A seeded random stream (mulberry32), so the dots fall in the same places on every visit. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Valid votes and rejected ballots as ballots cast. */
const ballots = (votes: number[] | null, rej: number) => (votes ? votes.reduce((a, b) => a + b, 0) + rej : 0);
const pct = (v: number | null, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);

export function votingLayer(data: Data): AtlasLayer {
  const color = VOTING_COLOR;
  const V = data.voting;
  const hist: VotingHistory[] = V?.history ?? [];
  const pollYears = (V?.elections ?? []).filter((e) => e.level === 'poll').sort((a, b) => a.t - b.t);
  const latest = pollYears.at(-1);
  const pname = (k: string) => V?.parties[k] ?? k;
  let mode: Mode = 'dots';
  let P: VotingPolls | null = null, asked = false;
  const views = new Map<number, YearView>();
  const ensure = () => { if (!P && !asked) { asked = true; loadVotingPolls().then((p) => { P = p; if (!p) asked = false; }); } return P; };

  const electionAt = (t: number) => [...pollYears].reverse().find((e) => e.t <= t + 1e-6) ?? null;
  const histAt = (t: number) => [...hist].reverse().find((h) => h.t <= t + 1e-6) ?? null;

  function view(e: VotingElection): YearView | null {
    if (views.has(e.year)) return views.get(e.year)!;
    const Y = P?.years[e.year];
    if (!P || !Y) return null;
    const q = P.q;
    const polls: Poll[] = Y.u.map((u, i) => {
      const [ri, lab, name, adv, el, rej, votes, g] = u;
      let polys: Ring[][] = [], pt: [number, number] | null = null;
      if (g && typeof g[0] === 'number') pt = [(g as [number, number])[0] / q, (g as [number, number])[1] / q];
      else if (g) polys = (g as number[][][]).map((p) => p.map((r) => decodeRing(r, q)));
      const valid = votes ? votes.reduce((a, b) => a + b, 0) : 0;
      let win: number | null = null, margin = 0;
      if (votes && valid) {
        const order = votes.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]);
        if (order[0][0] > (order[1]?.[0] ?? -1)) { win = order[0][1]; margin = (order[0][0] - (order[1]?.[0] ?? 0)) / valid; }
      }
      return { i, ri, lab, name, adv, el, rej, votes, polys, pt, areas: polys.map((p) => ringArea(p[0]) * Math.cos(((p[0][0]?.[1] ?? 50) * Math.PI) / 180)), valid, win, margin };
    });
    const dist = new Map<string, District>();
    for (const p of polls) {
      if (p.adv == null) continue;
      const d = dist.get(`${p.ri}:${p.adv}`) ?? dist.set(`${p.ri}:${p.adv}`, { el: 0, ed: 0, av: 0, polls: 0 }).get(`${p.ri}:${p.adv}`)!;
      d.el += p.el; d.ed += ballots(p.votes, p.rej); d.polls++;
    }
    let unplaced = 0;
    for (const a of Y.a) { const d = dist.get(`${a[0]}:${a[1]}`); if (d) d.av += ballots(a[5], a[4]); else unplaced += ballots(a[5], a[4]); }
    const byParty: Record<string, number> = {};
    e.ridings.forEach((r) => r.c.forEach((c) => (byParty[c[1]] = (byParty[c[1]] ?? 0) + c[2])));
    const order = Y.order;
    const outline = Object.values(P.outlines[order] ?? {}).flatMap((ps) => ps.flatMap((p) => p.map((r) => decodeRing(r, q))));
    const rows = polls.flatMap((p) => p.polys.map((poly) => ({ p, poly })));
    const v: YearView = { e, polls, adv: Y.a, dist, rows, outline, dots: null, byParty, unplaced };
    views.set(e.year, v);
    return v;
  }

  /** The dots for one election: election-day votes inside their poll; advance votes spread over their advance district's
   * polls by electors on the list (the atlas's own placement); special ballots have no place and are not drawn. */
  function dots(v: YearView) {
    if (v.dots) return v.dots;
    const xs: number[] = [], ys: number[] = [], cs: number[] = [];
    const ridings = v.e.ridings;
    const colOf = ridings.map((r) => r.c.map((c) => rgb(partyColor(c[1]), 235)));
    const place = (p: Poll, r: () => number): [number, number] | null => {
      if (p.pt) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.00045; return [p.pt[0] + Math.cos(a) * d * 1.5, p.pt[1] + Math.sin(a) * d]; }
      if (!p.polys.length) return null;
      const tot = p.areas.reduce((a, b) => a + b, 0);
      let pick = r() * tot, k = 0;
      while (k < p.areas.length - 1 && pick > p.areas[k]) { pick -= p.areas[k]; k++; }
      const poly = p.polys[k], o = poly[0];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of o) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      for (let t = 0; t < 60; t++) { const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0); if (inside(x, y, poly)) return [x, y]; }
      return [o.reduce((a, q) => a + q[0], 0) / o.length, o.reduce((a, q) => a + q[1], 0) / o.length];
    };
    const count = (votes: number, r: () => number) => { const e = votes / DOT_BASE, n = Math.floor(e); return n + (r() < e - n ? 1 : 0); };
    const push = (pt: [number, number] | null, c: RGBA) => { if (!pt) return; xs.push(pt[0]); ys.push(pt[1]); cs.push(c[0], c[1], c[2], c[3]); };
    for (const p of v.polls) {
      if (!p.votes) continue;
      const r = rng(hash(`${v.e.year}|${p.ri}|${p.lab}`));
      p.votes.forEach((vv, k) => { for (let n = count(vv, r); n > 0; n--) push(place(p, r), colOf[p.ri][k]); });
    }
    const byDist = new Map<string, { p: Poll; w: number }[]>();
    for (const p of v.polls) if (p.adv != null && p.el > 0 && (p.polys.length || p.pt)) (byDist.get(`${p.ri}:${p.adv}`) ?? byDist.set(`${p.ri}:${p.adv}`, []).get(`${p.ri}:${p.adv}`)!).push({ p, w: p.el });
    for (const a of v.adv) {
      const ps = byDist.get(`${a[0]}:${a[1]}`);
      if (!ps?.length) continue;
      const tot = ps.reduce((s, x) => s + x.w, 0);
      const r = rng(hash(`${v.e.year}|${a[0]}|adv${a[1]}`));
      a[5].forEach((vv, k) => {
        for (let n = count(vv, r); n > 0; n--) {
          let pick = r() * tot, j = 0;
          while (j < ps.length - 1 && pick > ps[j].w) { pick -= ps[j].w; j++; }
          push(place(ps[j].p, r), colOf[a[0]][k]);
        }
      });
    }
    // shuffled, so no party is always drawn on top
    const n = xs.length, r = rng(hash(`shuffle${v.e.year}`));
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    const pos = new Float32Array(n * 2), col = new Uint8Array(n * 4), qv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = idx[i];
      pos[i * 2] = xs[s]; pos[i * 2 + 1] = ys[s];
      for (let c = 0; c < 4; c++) col[i * 4 + c] = cs[s * 4 + c];
      qv[i] = r();
    }
    v.dots = { n, pos, col, q: qv, drawn: n };
    return v.dots;
  }

  const distOf = (v: YearView, p: Poll) => (p.adv != null ? v.dist.get(`${p.ri}:${p.adv}`) ?? null : null);
  const turnout = (d: District | null) => (d && d.el ? (d.ed + d.av) / d.el : null);
  const advShare = (d: District | null) => (d && d.ed + d.av ? d.av / (d.ed + d.av) : null);
  const ramp = (lo: number, hi: number) => d3.scaleLinear<string>().domain([lo, (lo + hi) / 2, hi]).range(['#2c2b36', '#8f7f5c', '#fbecc0']).interpolate(d3.interpolateRgb).clamp(true);
  const turnRamp = ramp(0.35, 0.85), advRamp = ramp(0, 0.6);
  const grey = '#4a5163';
  function fill(v: YearView, p: Poll): RGBA {
    if (mode === 'dots') return [20, 24, 34, p.votes ? 70 : 20];
    if (mode === 'win') {
      if (p.win == null) return [120, 128, 145, 60];
      const c = partyColor(v.e.ridings[p.ri].c[p.win][1]);
      return rgb(d3.interpolateRgb(grey, c)(0.25 + 0.75 * Math.min(1, p.margin / 0.5)), 215);
    }
    const d = distOf(v, p);
    const x = mode === 'turnout' ? turnout(d) : advShare(d);
    return x == null ? [120, 128, 145, 30] : rgb((mode === 'turnout' ? turnRamp : advRamp)(x), 200);
  }

  const l: AtlasLayer = {
    id: 'voting',
    name: 'Voting',
    icon: '🗳',
    color,
    range: [1908, 2025.99],
    opensAt: latest?.t,
    available: !!V,
    unavailable: 'Elections Canada’s results could not be downloaded when this copy of the data was built. Run <code>npm run data voting</code>, then reload.',
    build({ time, view: cam }) {
      const e = electionAt(time);
      if (!e || !ensure()) return [];
      const v = view(e);
      if (!v) return [];
      const out: Layer[] = [
        new PolygonLayer<{ p: Poll; poly: Ring[] }>({
          id: 'voting-polls', data: v.rows, getPolygon: (d) => d.poly,
          getFillColor: (d) => fill(v, d.p), stroked: mode !== 'dots', getLineColor: [10, 14, 22, 120], lineWidthUnits: 'pixels', getLineWidth: 0.4,
          pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 60],
          parameters: { depthWriteEnabled: false, depthCompare: 'always' },
          updateTriggers: { getFillColor: [mode, e.year] },
        } as any),
        new PathLayer<Ring>({
          id: 'voting-ridings', data: v.outline, getPath: (d) => d, getColor: [236, 226, 200, 170], widthUnits: 'pixels', getWidth: 1.3,
          parameters: { depthCompare: 'always' },
        } as any),
      ];
      if (mode === 'dots') {
        const D = dots(v);
        const keep = DOT_BASE / dotVotes(cam.zoom);
        out.push(new ScatterplotLayer({
          id: 'voting-dots',
          data: { length: D.n, attributes: { getPosition: { value: D.pos, size: 2 }, getFillColor: { value: D.col, size: 4, normalized: true }, getFilterValue: { value: D.q, size: 1 } } },
          radiusUnits: 'meters', getRadius: 55, radiusMinPixels: 0.9, radiusMaxPixels: 4.5,
          extensions: filterExt, filterRange: [0, keep],
          pickable: false, parameters: { depthWriteEnabled: false, depthCompare: 'always' },
        } as any));
      }
      return out;
    },
    spark: () => hist.map((h) => {
      const top = Object.entries(h.seats).sort((a, b) => b[1] - a[1])[0]?.[0];
      return { x: h.t, y: h.total, color: top ? partyColor(top) : color };
    }),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Settling in · Elections Canada · Library of Parliament')}
        <h2>How Saskatchewan votes</h2>`;
      if (!V) { el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`); return { update() {} }; }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Every federal election since 2015, poll by poll, as Elections Canada counted it. <b>Draw the votes, not the land</b>: each dot is a few votes, placed inside the poll where they were cast and coloured by the candidate’s party, so a city block of voters counts for what it is and an empty township of fields for what it is. The chips show who came first in each poll, how many electors voted, and how many voted before election day. The timeline steps through the elections; before 2015 the panel has each riding’s winner and the province’s seats and votes back to 1908.</p>
        <div class="chips vt-chips" style="margin:2px 0 10px">${MODES.map((m) => `<button class="chip${m.id === mode ? ' on' : ''}" data-vm="${m.id}" style="--c:${color}">${m.chip}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const legend = el.appendChild(mk('div'));
      const list = el.appendChild(mk('div'));
      el.insertAdjacentHTML('beforeend', `<h3>Seats from Saskatchewan, every general election</h3>`);
      const setSeats = deferChart(el.appendChild(mk('div')), (c) => seatChart(c, hist, pname));
      el.insertAdjacentHTML('beforeend', `<h3>Share of valid votes, province-wide</h3>`);
      const big = Object.keys(V.parties).filter((k) => hist.some((h) => h.total && (h.votes[k] ?? 0) / h.total >= 0.08));
      const series = big.map((k) => ({ key: k, label: pname(k), color: partyColor(k), width: 1.8, values: hist.filter((h) => h.votes[k] != null && h.total).map((h) => ({ x: h.t, y: ((h.votes[k] ?? 0) / h.total) * 100 })) }));
      const setShare = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [hist[0].t, hist.at(-1)!.t], height: 150, yFormat: (v) => `${v}%`, valueFormat: (v) => `${v.toFixed(1)}%`, xLabel: (x) => String(Math.floor(x)) }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>
        <p class="note">Parties that took 8% or more of the province’s votes at least once. Parties are shown as each election listed them: the Conservatives before 1942 (and the 1917 “Government” of the Union coalition and the 1940 “National Government”), the Progressive Conservatives, Reform, the Canadian Alliance and today’s Conservative Party are separate lines, as are the CCF and the NDP.</p>
        <h3>What the map counts</h3>
        <p class="note">A <b>poll</b> is a polling division: the street blocks or the stretch of countryside whose electors vote at one polling station on election day. Polls numbered 500 and up are mobile polls in care homes and hospitals (drawn on their building). A poll whose results Elections Canada combined with another’s is drawn as part of that poll. <b>Advance polls</b> (600 and up) serve an advance polling district, a group of polls, and have no area of their own: their dots are spread over the district’s polls in proportion to the electors on each poll’s list (the atlas’s own placement: nobody knows which poll an advance voter lives in). <b>Special ballots</b> (by mail, from abroad, in the forces) are counted for the riding only and are not drawn. Boundaries are redrawn before every election, and the ridings themselves changed in 2023, so a poll is never compared with one from another election.</p>
        <p class="note"><b>Turnout</b> is ballots cast (rejected ballots included) over the electors on the lists on election day, worked out per advance district: election-day and advance ballots together, since advance voters are on their home poll’s list but vote elsewhere. A single poll’s own figure counts election day only and reads low. Rejected ballots count only in turnout, never as votes for anyone. Every number is Elections Canada’s or the Library of Parliament’s as published; the atlas does not rank or judge places by how they vote, and voting is never part of the Town Finder.</p>
        ${sourceLine(`${V.source}; ${V.boundarySource}; ${V.historySource}. ${V.licence}.`)}`);
      el.querySelector('.vt-chips')!.addEventListener('click', (ev) => {
        const k = (ev.target as HTMLElement).closest<HTMLElement>('[data-vm]')?.dataset.vm as Mode | undefined;
        if (!k) return;
        mode = k;
        el.querySelectorAll<HTMLElement>('[data-vm]').forEach((b) => b.classList.toggle('on', b.dataset.vm === mode));
        shown = '';
      });
      let shown = '';
      return {
        update({ time, view: cam }) {
          setSeats(time); setShare(time);
          const e = electionAt(time), h = histAt(time);
          const key = `${h?.date}|${e?.year}|${mode}|${dotVotes(cam.zoom)}|${P ? 1 : 0}`;
          if (key === shown) return;
          shown = key;
          if (!h) {
            hero(0, '—', 'before Saskatchewan’s first federal election as a province (1908)');
            hero(1, '—', ''); hero(2, '—', ''); hero(3, '—', '');
            legend.innerHTML = ''; list.innerHTML = '';
            return;
          }
          const atPoll = e && h.date === e.date ? e : null;
          const seats = Object.entries(h.seats).sort((a, b) => b[1] - a[1]);
          hero(0, String(Math.floor(h.t)), `federal general election, ${h.date}`);
          hero(1, seats.map(([, n]) => n).join(' · '), seats.map(([k]) => pname(k)).join(' · ') + ` (of ${h.n} seats)`);
          const ec = (V.elections ?? []).find((x) => x.date === h.date);
          if (ec) {
            const el2 = ec.ridings.reduce((a, r) => a + r.el, 0), cast = ec.ridings.reduce((a, r) => a + r.ed + r.adv + r.sr, 0);
            hero(2, fmt.int(cast), 'ballots cast, rejected ones included');
            hero(3, pct(cast / el2), 'turnout: ballots over electors on the lists');
          } else {
            hero(2, fmt.int(h.total), 'valid votes (the record has no electors before 2011)');
            hero(3, h.accl ? String(h.accl) : '—', h.accl ? 'ridings won by acclamation (no vote)' : 'no acclamations');
          }
          const parties = Object.entries(h.votes).sort((a, b) => b[1] - a[1]);
          const n = dotVotes(cam.zoom);
          legend.innerHTML = `<div class="legend" style="margin:6px 0 4px">${parties.slice(0, 8).map(([k, v]) => `<span><i class="sw" style="background:${partyColor(k)}"></i>${esc(pname(k))} ${pct(h.total ? v / h.total : null, 1)}</span>`).join('')}${parties.length > 8 ? `<span>+${parties.length - 8} more</span>` : ''}</div>`
            + (atPoll ? modeNote(atPoll, n) : `<p class="note">${e ? `The poll map shows the ${e.year} election until the next one. ` : ''}Poll-by-poll maps start in 2015 (2011’s polling division boundaries are not read); for ${Math.floor(h.t)} the panel has each riding’s result from the ${ec ? 'Elections Canada results' : 'Library of Parliament’s riding history (general elections only, by-elections left out)'}.</p>`);
          list.innerHTML = `<h3>Ridings, ${Math.floor(h.t)}</h3><ol class="rank-list vt-ridings">${h.r.map(([rn, who, pk, share]) => `<li><span class="rk"><i class="sw" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${partyColor(pk)}"></i></span><span><span class="nm">${esc(rn)}</span><br><span class="rd">${esc(who)} · ${esc(pname(pk))}</span></span><span class="bar-v">${share != null ? `${share.toFixed(1)}%` : 'acclaimed'}</span></li>`).join('')}</ol>`;
        },
      };
    },
    tooltip(info) {
      if (info.layer?.id !== 'voting-polls' || !info.object) return null;
      const { p } = info.object as { p: Poll };
      const e = pollYears.find((x) => views.get(x.year)?.polls[p.i] === p);
      const v = e ? views.get(e.year)! : null;
      if (!v) return null;
      const R = v.e.ridings[p.ri];
      const d = distOf(v, p);
      const rows = p.votes ? R.c.map((c, k) => ({ c, v: p.votes![k] })).sort((a, b) => b.v - a.v) : [];
      return `<b>Poll ${esc(p.lab)} · ${esc(p.name)}</b><br><span class="tk">${esc(R.name)} · ${v.e.year}</span>`
        + (p.votes ? rows.map((r) => `<br><span class="tk"><i class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${partyColor(r.c[1])}"></i> ${esc(pname(r.c[1]))}</span> <span class="tv">${fmt.int(r.v)}</span>`).join('') : '<br><span class="tk">No poll held</span>')
        + `<br><span class="tk">Electors on the list</span> <span class="tv">${fmt.int(p.el)}</span>`
        + (d ? `<br><span class="tk">Advance district ${p.adv}: turnout</span> <span class="tv">${pct(turnout(d))}</span><br><span class="tk">voted in advance</span> <span class="tv">${pct(advShare(d))}</span>` : '');
    },
    describe(info) {
      if (info.layer?.id !== 'voting-polls' || !info.object) return null;
      const { p } = info.object as { p: Poll };
      const e = pollYears.find((x) => views.get(x.year)?.polls[p.i] === p);
      const v = e ? views.get(e.year)! : null;
      if (!v) return null;
      return describePoll(v, p, pname, distOf(v, p), turnout, advShare, info);
    },
  };

  function modeNote(e: VotingElection, n: number) {
    const v = views.get(e.year);
    const sr = e.ridings.reduce((a, r) => a + r.sr, 0), cast = e.ridings.reduce((a, r) => a + r.ed + r.adv + r.sr, 0);
    if (mode === 'dots') return `<p class="note">One dot = ${n} votes (${n === DOT_BASE ? 'the closest view' : 'zoom in for one dot per 5'}), coloured by the candidate’s party. ${fmt.int(sr)} special ballots (${pct(sr / cast, 1)} of all) have no place and are not drawn${v?.unplaced ? `, nor ${fmt.int(v.unplaced)} advance ballots from districts with no polls on the map` : ''}.</p>`;
    if (mode === 'win') return `<p class="note">Each poll in the colour of the party whose candidate came first there; the stronger the colour, the wider the lead over second place (full colour at 50 points or more). A tie is grey. A poll is not a riding: the riding winner is the candidate with the most votes over all its polls, advance polls and special ballots.</p>`;
    if (mode === 'turnout') return `<p class="note">Ballots cast (rejected included) over electors on the lists, by advance polling district, election day and advance together. Special ballots are counted per riding only, so every district reads a little low.</p><div class="ramp" style="background:${rampCSS((t) => turnRamp(0.35 + t * 0.5))}"></div><div class="ramp-labels"><span>35%</span><span>60%</span><span>85%+</span></div>`;
    return `<p class="note">Of the ballots cast in each advance polling district, the share cast at its advance poll before election day.</p><div class="ramp" style="background:${rampCSS((t) => advRamp(t * 0.6))}"></div><div class="ramp-labels"><span>0%</span><span>30%</span><span>60%+</span></div>`;
  }
  return l;
}

/** A poll's own panel: its candidates' votes, electors and its advance district. */
function describePoll(v: YearView, p: Poll, pname: (k: string) => string, d: District | null, turnout: (d: District | null) => number | null, advShare: (d: District | null) => number | null, info: PickingInfo): AtlasEvent {
  const R: VotingRiding = v.e.ridings[p.ri];
  const rows = p.votes ? R.c.map((c, k) => ({ c, n: p.votes![k] })).sort((a, b) => b.n - a.n) : [];
  const max = Math.max(1, ...rows.map((r) => r.n));
  const [lon, lat] = (info.coordinate as [number, number] | undefined) ?? [undefined, undefined];
  return {
    layer: 'voting', kind: `Poll · federal election ${v.e.year}`, lon, lat, zoom: 12,
    title: `Poll ${p.lab}: ${p.name}`,
    body: `One of the polls of ${R.name} in the ${v.e.year} federal election (${v.e.date}). ${p.votes ? `${fmt.int(p.valid)} valid votes and ${fmt.int(p.rej)} rejected ballots were cast here on election day, with ${fmt.int(p.el)} electors on the list.` : 'No poll was held here.'} Its advance voters cast their ballots at advance poll ${p.adv ?? '—'}, which serves several polls.`,
    stats: [
      { v: p.votes ? fmt.int(p.valid + p.rej) : '—', l: 'ballots on election day' },
      { v: fmt.int(p.el), l: 'electors on the list' },
      { v: pct(turnout(d)), l: `turnout in advance district ${p.adv ?? '—'} (election day and advance)` },
      { v: pct(advShare(d)), l: 'of that district’s ballots cast in advance' },
    ],
    detail(el) {
      if (!rows.length) return;
      el.insertAdjacentHTML('beforeend', `<h3>Votes at this poll, election day</h3><ol class="rank-list">${rows.map((r) => `<li style="cursor:default"><span class="rk">${r.c[3] ? '✓' : ''}</span><span><span class="nm">${esc(r.c[0])}</span><br><span class="rd">${esc(pname(r.c[1]))}${r.c[4] ? ' · incumbent' : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.n / max) * 100)}%;background:${partyColor(r.c[1])}"></i></div><div class="bar-v">${fmt.int(r.n)}</div></span></li>`).join('')}</ol>
        <p class="note">✓ elected in the riding (over all its polls, advance polls and special ballots). Votes as Elections Canada published them; a poll’s own turnout counts election day only, so it is not shown.</p>`);
    },
    sources: [{ label: `Elections Canada, official results ${v.e.year}`, url: v.e.url }],
  };
}

/** Seats by party, a stacked column per general election, with a playhead. */
function seatChart(el: HTMLElement, hist: VotingHistory[], pname: (k: string) => string): ChartHandle {
  el.innerHTML = '';
  el.classList.add('chart');
  const W = el.clientWidth || 340, H = 140, m = { t: 8, r: 8, b: 20, l: 28 };
  const w = W - m.l - m.r, h = H - m.t - m.b;
  const x = d3.scaleLinear().domain([hist[0].t - 2, hist.at(-1)!.t + 2]).range([0, w]);
  const y = d3.scaleLinear().domain([0, d3.max(hist, (d) => d.n) ?? 21]).nice().range([h, 0]);
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H);
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-w).tickFormat(() => '')).call((s) => s.select('.domain').remove());
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(Math.min(6, Math.floor(w / 55))).tickFormat((v) => String(v)).tickSizeOuter(0));
  g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(6)).call((s) => s.select('.domain').remove());
  const bw = Math.max(2, Math.min(7, w / hist.length - 1.5));
  for (const e of hist) {
    let acc = 0;
    for (const [k, n] of Object.entries(e.seats).sort((a, b) => b[1] - a[1])) {
      g.append('rect').attr('x', x(e.t) - bw / 2).attr('width', bw).attr('y', y(acc + n)).attr('height', Math.max(0.5, y(acc) - y(acc + n) - 0.4)).attr('fill', partyColor(k)).attr('rx', 1);
      acc += n;
    }
  }
  const tip = document.getElementById('tooltip');
  g.append('rect').attr('width', w).attr('height', h).attr('fill', 'transparent')
    .on('mousemove', (ev: MouseEvent) => {
      const xv = x.invert(d3.pointer(ev)[0]);
      const e = hist.reduce((a, b) => (Math.abs(b.t - xv) < Math.abs(a.t - xv) ? b : a));
      if (!tip) return;
      tip.innerHTML = `<b>${esc(e.date)}</b>${Object.entries(e.seats).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<br><span class="tk">${esc(pname(k))}</span> <span class="tv">${n}</span>`).join('')}<br><span class="tk">of ${e.n} seats</span>`;
      tip.hidden = false;
      tip.style.left = `${Math.min(ev.clientX, window.innerWidth - tip.getBoundingClientRect().width - 30)}px`;
      tip.style.top = `${ev.clientY}px`;
    })
    .on('mouseleave', () => { if (tip) tip.hidden = true; });
  const ph = svg.append('g').attr('transform', `translate(${m.l},${m.t})`).style('pointer-events', 'none');
  const line = ph.append('line').attr('y1', -4).attr('y2', h).attr('stroke', '#fff').attr('stroke-width', 1.5).attr('opacity', 0);
  return { setPlayhead(t: number) { const [a, b] = x.domain(); const vis = t >= a && t <= b; line.attr('x1', x(Math.min(t, b))).attr('x2', x(Math.min(t, b))).attr('opacity', vis ? 0.9 : 0); } };
}

// ---- the Town Report section (src/panels.ts and src/small.ts place it)

/** Voting: the place's riding(s) and their winner, and the votes in the polls inside its limits, at the latest election. */
export function votingRows(data: Data, key: string, small = false) {
  const V = data.voting;
  const t: VotingPlace | undefined = (small ? V?.small : V?.towns)?.[key];
  if (!V || !t) return '';
  const c = VOTING_COLOR;
  const e = V.elections.find((x) => x.year === t.y);
  if (!e) return '';
  const pname = (k: string) => V.parties[k] ?? k;
  const rid = t.r.map(([id, s]) => ({ r: e.ridings.find((x) => x.id === id), s })).filter((x) => x.r) as { r: VotingRiding; s: number }[];
  const valid = Object.values(t.v).reduce((a, b) => a + b, 0);
  const cast = valid + t.rej;
  const parties = Object.entries(t.v).sort((a, b) => b[1] - a[1]);
  const winner = (r: VotingRiding) => { const w = r.c.find((x) => x[3]); const tot = r.c.reduce((a, x) => a + x[2], 0); return w ? `${esc(w[0])} (${esc(pname(w[1]))}, ${pct(w[2] / tot, 1)})` : '—'; };
  const share = (n: number) => pct(valid ? n / valid : null, 1);
  const turnoutV = t.el ? cast / t.el : null;
  const advAll = e.ridings.reduce((a, r) => a + r.adv, 0) / Math.max(1, e.ridings.reduce((a, r) => a + r.ed + r.adv + r.sr, 0));
  return `<h3>Voting · federal election ${e.year}</h3>
    <div class="metric-grid">
      ${metric(rid.length > 1 ? 'Ridings' : 'Riding', c, rid.map((x) => esc(x.r.name)).join('<br>'), rid.length > 1 ? rid.map((x) => `${pct(x.s)} of its electors in ${esc(x.r.name)}`).join('; ') : 'federal electoral district')}
      ${metric(rid.length > 1 ? 'Riding winners' : 'Riding winner', c, rid.map((x) => esc(x.r.c.find((y) => y[3])?.[0] ?? '—')).join('<br>'), rid.map((x) => winner(x.r)).join('; '))}
      ${metric('Votes here', c, parties[0] ? `${esc(pname(parties[0][0]))} ${share(parties[0][1])}` : '—', parties.length ? `${parties.map(([k, n]) => `${esc(pname(k))} ${fmt.int(n)} (${share(n)})`).join(' · ')}` : 'no votes counted')}
      ${metric(t.adv != null ? 'Turnout' : 'Election-day turnout', c, pct(turnoutV), t.adv != null ? `${fmt.int(cast)} ballots (election day and advance) of ${fmt.int(t.el)} electors on the lists; special ballots are counted per riding only` : `${fmt.int(cast)} ballots on election day of ${fmt.int(t.el)} electors; advance votes (${pct(advAll)} of the province’s ballots) were cast in districts that reach beyond ${small ? 'it' : 'the town'}, so they are not counted here and this reads low`)}
    </div>
    ${parties.length ? `<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin:8px 0 2px">${parties.map(([k, n]) => `<i style="flex:${n};background:${partyColor(k)}" title="${esc(pname(k))}"></i>`).join('')}</div>` : ''}
    <p class="note" style="margin-top:6px">${t.c ? 'No poll lies inside its limits, so these are the votes of the poll that holds its centre, which reaches beyond it.' : `The ${t.n} poll${t.n === 1 ? '' : 's'} whose area centre lies inside its limits${t.adv != null ? ', with the advance polls of the districts they make up' : ', election day only'}.`} Elections Canada’s official results, as published; polls are redrawn for every election, so earlier elections are on the map, not compared here. Voting is never part of the Town Finder.</p>
    <div class="tr-falls" style="margin-top:8px">${link('voting', '🗳 Voting on the map')}</div>`;
}
