// EVERY CENSUS SUBDIVISION — the province beyond the atlas's 62 places. Statistics Canada's 2021 census subdivisions
// (cities, towns, villages, resort villages, rural municipalities, reserves, northern municipalities and the unorganized
// north; public/data/subdivisions.json) tint the census layers (Home costs, Jobs & income, Who lives here) under their
// town columns, and a click on one that is not an atlas place opens a short census-only report.
//
// Honesty rules: a value Statistics Canada suppressed is never drawn or shown as zero ("—"); a share on a rounded 0
// shows "—" (`pctText`); a reserve that was not fully counted in 2021 says "not enumerated"; a rural municipality
// surrounds its towns and villages but excludes them.
import { PolygonLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Subdivision, fmt } from './data';
import type { CommunityCensus } from './data';
import { esc } from './html';
import type { AtlasEvent, RGBA } from './layer-kit';

/** A census count field of the Who lives here profile (not the birthplace or language lists). */
export type CountKey = keyof Omit<CommunityCensus, 'birth' | 'lang'>;
/**
 * A share in % from census counts, or null. Census counts are randomly rounded to a multiple of 5, so a 0 means "none or
 * a handful": it comes back as 0 here (for the map and the Finder) but is shown as "—" by `pctText`.
 */
export const share = (c: Partial<CommunityCensus> | undefined, n: CountKey, of: CountKey) => {
  const a = c?.[n], b = c?.[of];
  return a == null || !b ? null : (a / b) * 100;
};
/** A share for reading: "—" when suppressed or when the rounded count is 0 (too few to say), else one decimal. */
export const pctText = (c: Partial<CommunityCensus> | undefined, n: CountKey, of: CountKey) => {
  const v = share(c, n, of);
  return v == null || !c?.[n] ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
};

export type CsdPoly = { s: Subdivision; poly: [number, number][][] };
const polyMemo = new WeakMap<object, CsdPoly[]>();
/** One row per polygon (a subdivision with islands or detached parts has several). */
export function csdPolys(data: Data): CsdPoly[] {
  const S = data.subdivisions;
  if (!S) return [];
  let out = polyMemo.get(S);
  if (!out) { out = S.csds.flatMap((s) => s.p.map((poly) => ({ s, poly }))); polyMemo.set(S, out); }
  return out;
}

export const isCsd = (info: PickingInfo) => !!info.layer?.id.endsWith('-csd') && !!(info.object as CsdPoly | undefined)?.s;
export const csdOf = (info: PickingInfo) => (isCsd(info) ? (info.object as CsdPoly).s : null);

/**
 * A province-wide tint by census subdivision, drawn flat under a layer's columns. `value` returns null for a suppressed
 * or missing value: those subdivisions are left nearly clear, never coloured as zero.
 */
export function csdTint(id: string, data: Data, value: (s: Subdivision) => number | null, color: (v: number) => RGBA, trigger: unknown, strong = true): Layer[] {
  const rows = csdPolys(data);
  if (!rows.length) return [];
  return [new PolygonLayer<CsdPoly>({
    id: `${id}-csd`,
    data: rows,
    getPolygon: (d) => d.poly,
    getFillColor: (d) => { const v = value(d.s); if (v == null) return [120, 130, 150, 16]; const c = color(v); return [c[0], c[1], c[2], strong ? 150 : 95]; },
    getLineColor: [230, 240, 255, 55],
    lineWidthUnits: 'pixels',
    getLineWidth: 0.6,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 50],
    parameters: { depthWriteEnabled: false, depthCompare: 'always' },
    updateTriggers: { getFillColor: [trigger, strong] },
  } as any)];
}

/** The subdivision's type as Statistics Canada names it ("Rural municipality", "Indian reserve"…). */
export const csdType = (data: Data, s: Subdivision) => data.subdivisions?.types[s.t] ?? s.t;
const isRM = (s: Subdivision) => s.t === 'RM';
const isReserve = (s: Subdivision) => s.t === 'IRI' || s.t === 'S-É';

/** What a missing value means here: "not enumerated" on a reserve not fully counted, else "—" (suppressed or none). */
export const missing = (s: Subdivision) => (s.ne ? 'not enumerated' : '—');

/** Short notes on what the subdivision is and is not, for tooltips and the report. */
export function csdNotes(data: Data, s: Subdivision): string[] {
  const out: string[] = [];
  if (isRM(s)) out.push('A rural municipality surrounds the towns and villages inside it but excludes them: its figures are for the countryside, farms and hamlets only.');
  if (isReserve(s)) out.push('A First Nation reserve is its own census subdivision, not part of the town or rural municipality around it (see the Treaties & reserves layer).');
  if (s.ne) out.push('This reserve was not fully enumerated in the 2021 census (Statistics Canada’s data quality flag), so its census figures are not published: shown as “not enumerated”, never as zero.');
  if (s.t === 'NO') out.push('The unorganized part of the Northern Saskatchewan Administration District: everything in the north outside its villages, hamlets and reserves.');
  if (/\(Saskatchewan part\)/.test(s.n)) out.push('Only the Saskatchewan side is counted here.');
  return out;
}

/** A tooltip for a subdivision in a census tint: its name and type, the layer's own rows, and the notes in short. */
export function csdTooltip(data: Data, s: Subdivision, rows: [string, string][]): string {
  const row = (k: string, v: string) => `<br><span class="tk">${esc(k)}</span> <span class="tv">${v}</span>`;
  const short = isRM(s) ? 'surrounds its towns and villages, excludes them' : s.ne ? 'not fully enumerated in 2021' : isReserve(s) ? 'a First Nation reserve, its own subdivision' : '';
  return `<b>${esc(s.n)}</b><br><span class="tk">${esc(csdType(data, s))}${short ? ` · ${short}` : ''}</span>`
    + row('Population 2021', s.pop != null ? fmt.int(s.pop) : missing(s))
    + rows.map(([k, v]) => row(k, v)).join('')
    + `<br><span class="tk">${s.k ? 'Click for town report' : s.s ? 'Click for its report' : 'Click for census report'}</span>`;
}

/** Opens the Town Report (one of the 62) or the small-community report (tier 2) for a place's own subdivision; true if it did. */
export function csdClick(info: PickingInfo): boolean {
  const s = csdOf(info);
  const k = s?.k ?? s?.s;
  if (!k) return false;
  window.dispatchEvent(new CustomEvent('atlas:town', { detail: k }));
  return true;
}

const money = (v: number) => `$${fmt.int(v)}`;

/**
 * The census-only report for any subdivision: population, home costs, income and work, and who lives there, each row
 * saying why when it has no value. Opened as a map feature's panel (an AtlasEvent with no date).
 */
export function csdReport(data: Data, s: Subdivision, layer: string): AtlasEvent {
  const H = data.housing?.csd?.[s.id], J = data.jobs?.csd?.[s.id], C = data.community?.csd?.[s.id];
  const gone = missing(s);
  const type = csdType(data, s);
  const change = s.pop != null && s.pop16 ? ((s.pop - s.pop16) / s.pop16) * 100 : null;
  const notes = csdNotes(data, s);
  const ind = (J?.ind ?? []).slice(0, 3).map(([i, p]) => `${esc(data.jobs?.naics[i] ?? '?')} ${p.toFixed(0)}%`).join(' · ');
  const metric = (label: string, v: string, sub: string) => `<div class="metric"><div class="mk">${esc(label)}</div><div class="mv">${v}</div><div class="ms">${sub}</div></div>`;
  const val = (v: number | undefined, f: (v: number) => string) => (v != null ? f(v) : `<span style="color:var(--ink-3)">${gone}</span>`);
  const pt = (n: Parameters<typeof pctText>[1], of: Parameters<typeof pctText>[2]) => (C ? pctText(C, n, of) : gone);
  return {
    layer, kind: `${type} · census subdivision`, lon: s.c[0], lat: s.c[1], zoom: 9,
    title: s.n,
    body: `${s.n} is a ${type.toLowerCase()} in the 2021 census${s.km2 ? `, ${fmt.int(s.km2)} km² of land` : ''}. ${s.pop != null ? `${fmt.int(s.pop)} people lived here in 2021${change != null ? ` (${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}% since 2016)` : ''}.` : s.ne ? 'Its population was not published.' : ''} The atlas compares ${data.munis.length} places in full; this is the census picture only: no crime, drive times or services are worked out here.`,
    stats: [
      { v: s.pop != null ? fmt.int(s.pop) : gone, l: 'people, 2021' },
      { v: s.dw != null ? fmt.int(s.dw) : gone, l: 'private dwellings' },
    ],
    sections: notes.length ? [{ title: 'What this area is', text: notes.join(' ') }] : [],
    detail(el) {
      el.insertAdjacentHTML('beforeend', `
        <h3>Home costs, 2021</h3>
        <div class="metric-grid">
          ${metric('Home value', val(H?.value, fmt.money), 'median, owned dwellings')}
          ${metric('Rent paid', val(H?.rentCost, money), 'median a month, renters')}
          ${metric('Owner costs', val(H?.ownCost, money), 'median a month, owners')}
          ${metric('Stretched', val(H?.stir30, (v) => `${v.toFixed(0)}%`), 'households spending 30 %+ on shelter')}
        </div>
        <h3>Work and income</h3>
        <div class="metric-grid">
          ${metric('Household income', val(J?.inc, fmt.money), 'median, 2020 incomes')}
          ${metric('Unemployment', val(J?.cur, (v) => `${v.toFixed(1)}%`), 'census week, May 2021')}
        </div>
        ${ind ? `<p class="note" style="margin-top:6px">Top industries: ${ind}</p>` : ''}
        <h3>Who lives here</h3>
        <div class="metric-grid">
          ${metric('Immigrants', pt('imm', 'hhPop'), C?.birth?.length ? `born in ${C.birth.map((b) => esc(b[0])).join(', ')}` : 'of people in private households')}
          ${metric('Arrived 2016–21', pt('rec', 'hhPop'), 'recent immigrants')}
          ${metric('Other home language', pt('nonOff', 'homeTot'), C?.lang?.length ? esc(C.lang.map((b) => b[0]).join(', ')) : 'non-official language most often at home')}
          ${metric('Indigenous identity', pt('ind', 'indTot'), 'First Nations, Métis or Inuit')}
        </div>
        <p class="note">Census 2021, this census subdivision only. Statistics Canada rounds counts to a multiple of 5 and suppresses figures for the smallest places: “—” means none, a handful, or not published, never zero.${s.ne ? ' “Not enumerated”: this reserve was not fully counted in 2021.' : ''}</p>
        <p class="note">${esc(data.subdivisions?.source ?? '')}. ${esc(data.subdivisions?.censusSource ?? '')}.</p>`);
    },
  };
}
