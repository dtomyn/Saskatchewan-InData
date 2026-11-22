import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import fs from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { dpRing, ringArea } from '../lib/geo.mjs';
import { cached, cachedFile, fetchBuf, log, readOut, round, writeOut } from '../lib/io.mjs';
import { fracYear, parseCSVLine } from '../lib/parse.mjs';
import { getPlaces, getSmallPlaces, smallAreas } from '../lib/places.mjs';
import { readShapefile } from '../lib/shp.mjs';

// Federal voting in Saskatchewan. Elections Canada's poll-by-poll results (every candidate's votes at every polling
// station, the electors on the list and the rejected ballots) for the general elections of 2011–2025, and each election's
// polling division boundaries for 2015–2025 (2011 stays at riding level: its boundaries are a separate 150 MB download,
// not read); the Library of Parliament's riding history (1908–2008, general elections only) for the seats and vote shares
// before them. Per place: the polls inside its town limits at the latest election (votes by party, ballots and electors)
// and its riding(s). Plain counts as published; nothing here is ranked or judged, and none of it is in the Finder.
//
// A poll is one polling division: the area whose electors vote at one polling station on election day (a big one is split
// into stations A, B…, summed back here). Polls 500+ are mobile polls (care homes and hospitals, often merged with
// another poll), 600+ advance polls (one per advance polling district, a group of polls: no area of their own), and
// "S/R" the special ballots (by mail, abroad, in the forces), counted per riding only. A poll whose results Elections
// Canada combined with another's ("merged with") is drawn as part of that poll. Boundaries are redrawn before every
// election, so polls are never compared across elections; ridings changed in 2023 (the 2025 election).
const EC = 'https://www.elections.ca/res/rep/off';
const FTP = 'https://ftp.maps.canada.ca/pub/elections_elections/Electoral-districts_Circonscription-electorale';
const MAP25 = 'https://maps-cartes.services.geo.ca/server_serveur/rest/services/ELECTIONS/FED_Elect2025_en/MapServer';
const HFER = 'https://open.canada.ca/data/dataset/ea8f2c37-90b6-4fee-857e-984d3060184e/resource/5c8ab22c-4a5e-494b-879a-e0611bc10a95/download/hfer_e.csv';
const HFER_PAGE = 'https://open.canada.ca/data/en/dataset/ea8f2c37-90b6-4fee-857e-984d3060184e';

/** The elections at poll level (newest first): results, and the boundary file with its field names. */
const ELECTIONS = [
  { year: 2025, date: '2025-04-28', ge: 45, order: '2023', results: `${EC}/ovrGE45/62/data_donnees/pollresults_resultatsbureauCanada.zip`, page: `${EC}/ovrGE45/62/table1E.html`, pd: { kind: 'kmz' } },
  { year: 2021, date: '2021-09-20', ge: 44, order: '2013', results: `${EC}/ovr2021app/53/data_donnees/pollresults_resultatsbureauCanada.zip`, page: `${EC}/ovr2021app/53/table1E.html`, pd: { url: `${FTP}/Elections_Canada_2021/PD_CA_2021_EN.zip`, fed: 'FED_NUM', num: 'PD_NUM', sfx: 'PD_NBR_SFX', adv: 'ADV_POLL_N' } },
  { year: 2019, date: '2019-10-21', ge: 43, order: '2013', results: `${EC}/ovr2019app/51/data_donnees/pollresults_resultatsbureauCanada.zip`, page: `${EC}/ovr2019app/51/table1E.html`, pd: { url: `${FTP}/Elections_Canada_2019/polling_divisions_boundaries_2019.shp.zip`, fed: 'FEDNUM', num: 'PDNUM', sfx: 'PDNUMSFX', adv: 'ADVPOLLNUM' } },
  { year: 2015, date: '2015-10-19', ge: 42, order: '2013', results: `${EC}/ovr2015app/41/data_donnees/pollresults_resultatsbureauCanada.zip`, page: `${EC}/ovr2015app/41/table1E.html`, pd: { url: `${FTP}/polling_divisions_boundaries_2015/polling_divisions_boundaries_2015_shp.zip`, fed: 'FED_NUM', num: 'PD_NUM', sfx: 'PD_NBR_SFX', adv: 'ADV_POLL' } },
  { year: 2011, date: '2011-05-02', ge: 41, order: '2003', results: 'https://www.elections.ca/scripts/OVR2011/34/data_donnees/pollresults_resultatsbureau_canada.zip', page: 'https://www.elections.ca/scripts/ovr2011/default.html', pd: null },
];
const OUTLINES = {
  2013: { url: `${FTP}/Elections_Canada_2019/federal_electoral_districts_boundaries_2019.shp.zip`, fed: 'FEDNUM' },
  2023: { kind: 'kmz' },
};

/** Elections Canada's and the Library of Parliament's party names → one key each (the app colours by key). Every other
 * party keeps its own name as a key, slugged. */
const PARTY_KEYS = [
  [/^Conservative$|^Conservative Party of Canada$/, 'cpc'], [/^Liberal$/, 'lpc'], [/^NDP|^New Democratic Party$/, 'ndp'], [/^Green Party/, 'gpc'],
  [/^People's Party/, 'ppc'], [/^Independent$/, 'ind'], [/^No Affiliation|^No affiliation/, 'na'], [/^Progressive Conservative$/, 'pc'],
  [/^Co-operative Commonwealth Federation$/, 'ccf'], [/^Social Credit Party of Canada$/, 'sc'], [/^Reform Party of Canada$/, 'ref'], [/^Canadian Alliance$/, 'ca'],
  [/^Progressive$/, 'prog'], [/^Conservative \(historical\)$/, 'con'],
];
const PARTY_NAMES = { cpc: 'Conservative', lpc: 'Liberal', ndp: 'NDP', gpc: 'Green', ppc: 'People’s Party', ind: 'Independent', na: 'No affiliation', pc: 'Progressive Conservative', ccf: 'CCF', sc: 'Social Credit', ref: 'Reform', ca: 'Canadian Alliance', prog: 'Progressive', con: 'Conservative (to 1940)' };
const parties = {};
function partyKey(name) {
  const hit = PARTY_KEYS.find(([re]) => re.test(name));
  const k = hit ? hit[1] : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  parties[k] ??= PARTY_NAMES[k] ?? name;
  return k;
}

/** A text file in either encoding: Elections Canada's newer files are UTF-8 with a byte-order mark, 2011's are Latin-1. */
function decode(u8) {
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return strFromU8(u8.subarray(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return new TextDecoder('latin1').decode(u8); }
}
const dash = (s) => s.replace(/--/g, '—');
/** A station label (" 12", "12A", "33-1", "501B", "600", "S/R 1") → division number, suffix and kind. */
function label(lab) {
  const s = lab.trim();
  if (/^S\/R/i.test(s)) return { kind: 'sr', key: s };
  const m = s.match(/^(\d+)(?:-(\d+))?([A-Z]*)$/);
  if (!m) return null;
  const num = +m[1];
  return { kind: num >= 600 ? 'adv' : 'poll', num, key: `${num}-${m[2] ?? '0'}`, station: m[3] };
}

/** One election's Saskatchewan results: per riding, its candidates and its stations. */
async function readResults(e) {
  const zip = unzipSync(new Uint8Array(await cached(`voting/results-${e.year}.zip`, () => fetchBuf(e.results, { timeout: 300_000 }), (b) => b[0] === 0x50 && b[1] === 0x4b)), { filter: (f) => /pollresults_resultatsbureau47\d{3}\.csv$/i.test(f.name) });
  const files = Object.keys(zip).sort();
  if (files.length < 14) throw new Error(`${e.year}: only ${files.length} Saskatchewan riding files in the results zip`);
  return files.map((f) => {
    const lines = decode(zip[f]).split(/\r?\n/).filter((l) => l.trim());
    const rows = lines.slice(1).map(parseCSVLine);
    const id = rows[0][0].trim(), name = dash(rows[0][1].trim());
    const cands = [], cIdx = new Map(), stations = new Map();
    for (const r of rows) {
      const ck = `${r[10]}|${r[12]}|${r[13]}`;
      if (!cIdx.has(ck)) {
        cIdx.set(ck, cands.length);
        cands.push({ n: [r[12], r[11], r[10]].map((s) => s.trim()).filter(Boolean).join(' '), p: partyKey(r[13].trim()), v: 0, e: r[16] === 'Y' ? 1 : 0, i: r[15] === 'Y' ? 1 : 0 });
      }
      const lab = r[3].trim();
      let st = stations.get(lab);
      if (!st) {
        st = { lab, l: label(lab), name: r[4].trim(), void: r[5] === 'Y', np: r[6] === 'Y', merge: r[7].trim(), rej: +r[8] || 0, el: +r[9] || 0, votes: [] };
        if (!st.l) throw new Error(`${e.year} ${id}: unreadable poll number "${lab}"`);
        stations.set(lab, st);
      }
      const v = +r[17] || 0;
      st.votes[cIdx.get(ck)] = v;
      cands[cIdx.get(ck)].v += v;
    }
    for (const st of stations.values()) for (let i = 0; i < cands.length; i++) st.votes[i] ??= 0;
    return { id, name, cands, stations: [...stations.values()] };
  });
}

/**
 * Stations → units: one per polling division (stations A, B… summed), a division whose results were merged into
 * another's becoming part of that one. Advance polls the same way among themselves. Returns the units by division
 * key, the advance units by number, the special ballots, and `hostDiv` (division key → the unit drawn on it).
 */
function toUnits(r) {
  const byLab = new Map(r.stations.map((s) => [s.lab, s]));
  const byDiv = new Map();
  for (const s of r.stations) if (s.l.kind !== 'sr') (byDiv.get(s.l.key) ?? byDiv.set(s.l.key, []).get(s.l.key)).push(s);
  const find = (lab) => byLab.get(lab) ?? byDiv.get(label(lab)?.key ?? '')?.[0] ?? null;
  const host = (s) => { let h = s; for (let k = 0; k < 10 && h.merge; k++) { const n = find(h.merge); if (!n || n === h) break; h = n; } return h; };
  const out = new Map(), adv = new Map();
  const sr = { el: 0, rej: 0, votes: r.cands.map(() => 0) };
  let mergedVotes = 0;
  for (const s of r.stations) {
    if (s.l.kind === 'sr') { sr.el += s.el; sr.rej += s.rej; s.votes.forEach((v, i) => (sr.votes[i] += v)); continue; }
    if (s.void) continue;
    const h = host(s);
    if (h !== s) mergedVotes += s.votes.reduce((a, b) => a + b, 0) + s.rej;
    const key = h.l.kind === 'adv' ? h.l.num : h.l.key;
    const map = h.l.kind === 'adv' ? adv : out;
    const u = map.get(key) ?? map.set(key, { key, lab: h.l.kind === 'adv' ? String(h.l.num) : h.l.key.replace(/-0$/, ''), name: h.name, el: 0, rej: 0, votes: r.cands.map(() => 0), held: false, divs: new Set() }).get(key);
    u.el += s.el; u.rej += s.rej;
    s.votes.forEach((v, i) => (u.votes[i] += v));
    if (!s.np) u.held = true;
    if (h.l.kind !== 'adv') u.divs.add(s.l.key);
  }
  // a division is drawn as the unit its own stations report in (the host's division when all of them were merged)
  const hostDiv = new Map();
  for (const [div, ss] of byDiv) {
    if (ss[0].l.kind === 'adv') continue;
    const live = ss.filter((s) => !s.void);
    if (!live.length) continue;
    const own = live.find((s) => host(s).l.key === div);
    const h = host(own ?? live[0]);
    if (h.l.kind !== 'adv') hostDiv.set(div, h.l.key);
  }
  return { polls: out, adv, sr, hostDiv, mergedVotes };
}

// ---- boundaries

/** Polygons from a KML document (Elections Canada's MapServer answers geometry only as KMZ): per placemark, its
 * attribute table (alias → value) and its polygons, rings of [lon, lat] (the first ring outer). */
function kmlPlacemarks(text) {
  const out = [];
  for (const m of text.matchAll(/<Placemark[\s\S]*?<\/Placemark>/g)) {
    const pm = m[0];
    const attrs = {};
    for (const a of pm.matchAll(/<tr><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)) attrs[a[1].trim()] = a[2].trim();
    const polys = [...pm.matchAll(/<Polygon>([\s\S]*?)<\/Polygon>/g)].map((pg) => [...pg[1].matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)].map((c) => c[1].trim().split(/\s+/).map((t) => { const [x, y] = t.split(','); return [+x, +y]; })));
    out.push({ attrs, polys });
  }
  return out;
}
async function kmz(name, url) {
  const buf = await cached(`voting/${name}.kmz`, () => fetchBuf(url, { timeout: 300_000 }), (b) => b[0] === 0x50 && b[1] === 0x4b);
  const z = unzipSync(new Uint8Array(buf));
  const doc = Object.keys(z).find((n) => n.toLowerCase().endsWith('.kml'));
  if (!doc) throw new Error(`${name}: no KML in the KMZ`);
  return kmlPlacemarks(strFromU8(z[doc]));
}
/** Polygon divisions of one election: division key ("85-0") → { adv, type, polys (lon/lat, GeoJSON MultiPolygon coordinates) }. */
async function divisions(e, ridingIds) {
  const out = {};
  const add = (fed, key, adv, type, polys) => {
    const d = ((out[fed] ??= {})[key] ??= { adv: adv ? +adv : null, type, polys: [] });
    d.polys.push(...polys);
  };
  if (e.pd.kind === 'kmz') {
    for (const fed of ridingIds) {
      const pms = await kmz(`pd-${e.year}-${fed}`, `${MAP25}/1/query?${new URLSearchParams({ where: `FED_NUM=${fed}`, outFields: '*', returnGeometry: 'true', f: 'kmz' })}`);
      if (!pms.length) throw new Error(`${e.year} ${fed}: no polling divisions in the MapServer's answer`);
      for (const p of pms) {
        const k = Object.entries(p.attrs).find(([a]) => /^Concatenation of PDNUM/i.test(a))?.[1];
        const adv = Object.entries(p.attrs).find(([a]) => /^Advance Poll number/i.test(a))?.[1];
        const type = Object.entries(p.attrs).find(([a]) => /^Type of the Polling Division/i.test(a))?.[1];
        if (!k || !/^\d+-\d+$/.test(k)) throw new Error(`${e.year} ${fed}: a placemark with no division number`);
        add(fed, `${+k.split('-')[0]}-${+k.split('-')[1]}`, adv, type, p.polys);
      }
    }
    return out;
  }
  const f = e.pd;
  const feats = await readShapefile(await cachedFile(`voting/pd-${e.year}.zip`, f.url), (a) => ridingIds.includes(String(a[f.fed])));
  for (const { attrs: a, geom } of feats) {
    const sfx = /^\d+$/.test(a[f.sfx]) ? +a[f.sfx] : 0;
    add(String(a[f.fed]), `${+a[f.num]}-${sfx}`, a[f.adv], a.PD_TYPE ?? a.PDTYPE, geom.coordinates);
  }
  return out;
}
async function outlines(order, ridingIds) {
  const o = OUTLINES[order];
  if (o.kind === 'kmz') {
    const pms = await kmz(`fed-${order}`, `${MAP25}/3/query?${new URLSearchParams({ where: 'FED_NUM>=47000 AND FED_NUM<48000', outFields: '*', returnGeometry: 'true', f: 'kmz' })}`);
    return Object.fromEntries(pms.map((p) => [Object.entries(p.attrs).find(([a]) => /Federal Electoral District number|FED_NUM/i.test(a))?.[1], p.polys]).filter(([k]) => k));
  }
  const feats = await readShapefile(await cachedFile(`voting/fed-${order}.zip`, o.url), (a) => ridingIds.includes(String(a[o.fed])));
  return Object.fromEntries(feats.map(({ attrs, geom }) => [String(attrs[o.fed]), geom.coordinates]));
}

// ---- geometry: simplified, then written as integer steps of 1e-4° (about 10 m), each ring [x0, y0, dx, dy, …]

const Q = 1e4;
function simplify(polys) {
  return polys.map((p) => p.map((ring) => {
    const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return dpRing(ring, Math.min(0.003, Math.max(0.0001, size * 0.01)));
  })).filter((p) => p[0]?.length >= 4);
}
function encodeRing(ring) {
  const out = [];
  let px = 0, py = 0, first = true;
  for (const [x, y] of ring) {
    const ix = Math.round(x * Q), iy = Math.round(y * Q);
    if (!first && ix === px && iy === py) continue;
    out.push(first ? ix : ix - px, first ? iy : iy - py);
    px = ix; py = iy; first = false;
  }
  return out.length >= 8 ? out : null;
}
/** Encoded polygons, or the centre as one [x, y] pair when every ring collapses at 10 m (a mobile poll's building). */
function encode(polys) {
  const enc = polys.map((p) => p.map(encodeRing).filter(Boolean)).filter((p) => p.length);
  if (enc.length) return enc;
  const pts = polys.flatMap((p) => p[0] ?? []);
  if (!pts.length) return null;
  return [Math.round((pts.reduce((a, q) => a + q[0], 0) / pts.length) * Q), Math.round((pts.reduce((a, q) => a + q[1], 0) / pts.length) * Q)];
}
/** A point inside a polygon set: the largest outer ring's vertex average, or failing that a grid point inside it. */
function inner(polys) {
  const big = polys.map((p) => p[0]).filter(Boolean).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
  if (!big) return null;
  const f = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [big] } };
  const c = [big.reduce((a, q) => a + q[0], 0) / big.length, big.reduce((a, q) => a + q[1], 0) / big.length];
  if (booleanPointInPolygon(c, f)) return c;
  const xs = big.map((q) => q[0]), ys = big.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let n = 4; n <= 32; n *= 2) for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
    const p = [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n];
    if (booleanPointInPolygon(p, f)) return p;
  }
  return big[0];
}

// ---- the riding history (Library of Parliament)

async function history() {
  const text = (await cached('voting/hfer_e.csv', () => fetchBuf(HFER, { timeout: 300_000 }))).toString('latin1');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const h = parseCSVLine(lines[0]);
  const col = (n) => { const i = h.indexOf(n); if (i < 0) throw new Error(`hfer_e.csv has no "${n}" column`); return i; };
  const [iD, iT, iPl, iP, iR, iL, iF, iPa, iV, iPct, iE] = ['Election Date', 'Election Type', 'Parliament', 'Province', 'Riding', 'Last Name', 'First Name', 'Party', 'Votes', 'Votes (%)', 'Elected'].map(col);
  // one row per general election, by Parliament: a riding whose vote was deferred (1921, 1963) joins its election,
  // which is dated by the day most ridings voted
  const by = new Map();
  for (const l of lines.slice(1)) {
    const r = parseCSVLine(l);
    if (r[iP] !== 'Saskatchewan' || r[iT] !== 'Gen') continue;
    const date = r[iD].replace(/\//g, '-');
    const e = by.get(r[iPl]) ?? by.set(r[iPl], { dates: {}, ridings: new Map() }).get(r[iPl]);
    if (!e.ridings.has(r[iR])) e.dates[date] = (e.dates[date] ?? 0) + 1;
    e.date = Object.entries(e.dates).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const rid = e.ridings.get(r[iR]) ?? e.ridings.set(r[iR], []).get(r[iR]);
    // the pre-1942 Conservatives get their own key, so they are never read as today's party
    const pk = r[iPa] === 'Conservative' ? partyKey('Conservative (historical)') : partyKey(r[iPa]);
    rid.push({ n: [r[iF], r[iL]].filter(Boolean).join(' '), p: pk, v: /^\d+$/.test(r[iV]) ? +r[iV] : null, pct: r[iPct] ? +r[iPct] : null, e: r[iE] === '1' });
  }
  const out = [...by.values()].sort((a, b) => a.date.localeCompare(b.date)).map((e) => summarize(e.date, [...e.ridings].map(([name, cands]) => ({ name, cands }))));
  if (out.length < 25) throw new Error(`only ${out.length} Saskatchewan general elections in hfer_e.csv`);
  return out;
}
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s—–\-(/'.])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/--/g, '—');
/** One election province-wide: seats and votes by party, and each riding's winner. */
function summarize(date, ridings) {
  const seats = {}, votes = {};
  let accl = 0, total = 0;
  const r = [];
  for (const { name, cands } of ridings) {
    const w = cands.filter((c) => c.e);
    if (cands.some((c) => c.v == null)) accl++;
    for (const c of cands) if (c.v != null) { votes[c.p] = (votes[c.p] ?? 0) + c.v; total += c.v; }
    for (const c of w) seats[c.p] = (seats[c.p] ?? 0) + 1;
    const valid = cands.reduce((a, c) => a + (c.v ?? 0), 0);
    const top = w[0];
    if (top) r.push([/[a-z]/.test(name) ? name : titleCase(name), top.n, top.p, top.v != null && valid ? round((top.v / valid) * 100, 1) : null]);
  }
  return { date, t: round(fracYear(`${date}T12:00:00Z`), 3), n: ridings.length, seats, votes, total, accl, r: r.sort((a, b) => a[0].localeCompare(b[0])) };
}

// ---- the stage

export default async function voting() {
  const places = await getPlaces();
  const smallP = await getSmallPlaces();
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: places fall back to the poll at their centre'); }
  const sAreas = await smallAreas();

  const elections = [], polls = {}, outlineSets = {};
  for (const e of ELECTIONS) {
    const res = await readResults(e);
    const rids = res.map((r) => r.id);
    const divs = e.pd ? await divisions(e, rids) : null;
    const ridings = [], units = [], advs = [];
    let noArea = 0, noResult = 0, mergedVotes = 0;
    res.forEach((r, ri) => {
      const u = toUnits(r);
      mergedVotes += u.mergedVotes;
      const ed = u.polls.size ? [...u.polls.values()].reduce((a, p) => a + p.votes.reduce((x, y) => x + y, 0) + p.rej, 0) : 0;
      const av = [...u.adv.values()].reduce((a, p) => a + p.votes.reduce((x, y) => x + y, 0) + p.rej, 0);
      const srV = u.sr.votes.reduce((a, b) => a + b, 0) + u.sr.rej;
      const el = [...u.polls.values()].reduce((a, p) => a + p.el, 0) + [...u.adv.values()].reduce((a, p) => a + p.el, 0) + u.sr.el;
      const rej = [...u.polls.values(), ...u.adv.values()].reduce((a, p) => a + p.rej, 0) + u.sr.rej;
      ridings.push({ id: r.id, name: r.name, el, rej, ed, adv: av, sr: srV, c: r.cands.map((c) => [c.n, c.p, c.v, c.e, c.i]) });
      if (!divs) return;
      const D = divs[r.id] ?? {};
      // each unit's polygons: its divisions' own, plus divisions whose results were merged into it
      const geo = new Map();
      for (const [div, d] of Object.entries(D)) {
        const hk = u.hostDiv.get(div);
        if (!hk) { noResult++; continue; }
        const g = geo.get(hk) ?? geo.set(hk, { polys: [], adv: null }).get(hk);
        g.polys.push(...d.polys);
        if (div === hk || g.adv == null) g.adv = d.adv;
      }
      for (const p of u.polls.values()) {
        const g = geo.get(p.key);
        if (!g?.polys.length) { noArea++; }
        const simp = g ? simplify(g.polys) : [];
        units.push({ ri, lab: p.lab, name: p.name, adv: g?.adv ?? null, el: p.el, rej: p.rej, votes: p.votes, held: p.held, simp, geom: g ? encode(simp.length ? simp : g.polys) : null });
      }
      for (const a of u.adv.values()) advs.push([ri, a.key, a.name, a.el, a.rej, a.votes]);
    });
    const tot = ridings.reduce((a, r) => a + r.ed + r.adv + r.sr, 0);
    log(`  ${e.year}: ${ridings.length} ridings, ${fmtN(tot)} ballots (${fmtN(ridings.reduce((a, r) => a + r.adv, 0))} advance, ${fmtN(ridings.reduce((a, r) => a + r.sr, 0))} special); ${units.length} polls${divs ? `, ${noArea} with no boundary, ${noResult} boundaries with no result` : ' (riding level only)'}; ${mergedVotes} ballots in merged stations`);
    if (divs && noArea > units.length * 0.05) throw new Error(`${e.year}: ${noArea} of ${units.length} polls have no boundary`);
    elections.push({ year: e.year, date: e.date, t: round(fracYear(`${e.date}T12:00:00Z`), 3), ge: e.ge, order: e.order, level: divs ? 'poll' : 'riding', url: e.page, ridings });
    if (divs) {
      polls[e.year] = {
        order: e.order,
        u: units.map((x) => [x.ri, x.lab, x.name, x.adv, x.el, x.rej, x.held ? x.votes : null, x.geom]),
        a: advs,
      };
      polls[e.year].units = units; // dropped before writing; kept for the places below
      outlineSets[e.order] ??= rids;
    }
  }
  const outlineOut = {};
  for (const [order, rids] of Object.entries(outlineSets)) {
    const o = await outlines(order, rids);
    if (Object.keys(o).length < rids.length) throw new Error(`riding outlines ${order}: ${Object.keys(o).length} of ${rids.length}`);
    outlineOut[order] = Object.fromEntries(Object.entries(o).map(([id, ps]) => [id, ps.map((p) => p.map((ring) => encodeRing(dpRing(ring, 0.002))).filter(Boolean)).filter((p) => p.length)]));
  }

  // ---- per place, at the latest election with polls: the polls whose inside point is within its town limits, else the
  // poll that holds its centre (which reaches beyond the town)
  const latest = ELECTIONS.find((e) => e.pd);
  const L = polls[latest.year], R = elections.find((x) => x.year === latest.year).ridings;
  const pts = L.units.map((x) => (x.simp.length ? inner(x.simp) : null));
  const feats = L.units.map((x) => (x.simp.length ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: x.simp } } : null));
  const advEl = {};
  L.units.forEach((x) => { if (x.adv != null) advEl[`${x.ri}:${x.adv}`] = (advEl[`${x.ri}:${x.adv}`] ?? 0) + x.el; });
  const advByKey = Object.fromEntries(L.a.map((a) => [`${a[0]}:${a[1]}`, a]));
  const place = (p, area) => {
    const lim = area?.length ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: area } } : null;
    let idx = lim ? L.units.map((_, i) => i).filter((i) => pts[i] && booleanPointInPolygon(pts[i], lim)) : [];
    let centre = false;
    if (!idx.length) {
      const i = feats.findIndex((f) => f && booleanPointInPolygon([p.lon, p.lat], f));
      if (i < 0) return null;
      idx = [i]; centre = true;
    }
    const cands = {}; // riding → candidate votes
    let el = 0, rej = 0, held = 0;
    const byRiding = {}, advIn = {};
    for (const i of idx) {
      const x = L.units[i];
      el += x.el; rej += x.rej;
      byRiding[x.ri] = (byRiding[x.ri] ?? 0) + x.el;
      if (x.adv != null) advIn[`${x.ri}:${x.adv}`] = (advIn[`${x.ri}:${x.adv}`] ?? 0) + x.el;
      if (!x.held) continue;
      held++;
      const c = (cands[x.ri] ??= x.votes.map(() => 0));
      x.votes.forEach((v, k) => (c[k] += v));
    }
    // advance votes join only when every advance district the town's polls are in lies (by electors) 90 %+ inside it
    const dists = Object.keys(advIn);
    const whole = !centre && dists.length && dists.every((k) => advEl[k] && advIn[k] / advEl[k] >= 0.9 && advByKey[k]);
    let aBal = 0;
    if (whole) for (const k of dists) { const a = advByKey[k]; aBal += a[5].reduce((s, v) => s + v, 0) + a[4]; const c = (cands[a[0]] ??= a[5].map(() => 0)); a[5].forEach((v, j) => (c[j] += v)); rej += a[4]; }
    const v = {};
    for (const [ri, c] of Object.entries(cands)) c.forEach((n, k) => { const pk = R[ri].c[k][1]; v[pk] = (v[pk] ?? 0) + n; });
    const ridingsIn = Object.entries(byRiding).sort((a, b) => b[1] - a[1]).map(([ri, e2]) => [R[ri].id, round(e2 / el, 3)]);
    return { y: latest.year, r: ridingsIn, n: idx.length, held, el, rej, v, ...(whole ? { adv: aBal } : {}), ...(centre ? { c: 1 } : {}) };
  };
  const towns = {}, small = {};
  for (const p of places) { const o = place(p, needs?.areas?.[p.key]); if (o) towns[p.key] = o; }
  for (const p of smallP) { const o = place(p, sAreas[p.key]); if (o) small[p.key] = o; }
  log(`  places at ${latest.year}: ${Object.keys(towns).length} of ${places.length} (${Object.values(towns).filter((t) => t.c).length} by the poll at their centre, ${Object.values(towns).filter((t) => t.adv != null).length} with their advance votes), ${Object.keys(small).length} of ${smallP.length} small communities`);

  const hist = await history();
  // the riding history continues from Elections Canada's own results (2011 on), one row per election
  for (const e of [...elections].reverse()) hist.push(summarize(e.date, e.ridings.map((r) => ({ name: r.name, cands: r.c.map(([n, p, v, el]) => ({ n, p, v, e: !!el })) }))));
  for (const k of Object.keys(polls)) delete polls[k].units;

  const meta = {
    source: 'Elections Canada, Official Voting Results, poll-by-poll results (raw data), general elections 2011–2025',
    sourceUrl: 'https://www.elections.ca/content.aspx?section=res&dir=rep/off&document=index&lang=e',
    boundarySource: 'Elections Canada, Electoral Boundary Files: polling divisions and federal electoral districts (2015, 2019, 2021 shapefiles on ftp.maps.canada.ca; 2025 from the FED_Elect2025 MapServer on maps-cartes.services.geo.ca)',
    historySource: 'Library of Parliament, History of the Federal Electoral Ridings, 1867–2010 (hfer_e.csv), via open.canada.ca',
    historyUrl: HFER_PAGE,
    licence: 'Open Government Licence – Canada',
    licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    asOf: new Date().toISOString().slice(0, 10),
  };
  await writeOut('voting', { ...meta, parties, elections: elections.reverse(), history: hist, towns, small });
  await writeOut('voting-polls', { ...meta, q: Q, outlines: outlineOut, years: polls });
}
const fmtN = (n) => n.toLocaleString('en-CA');
