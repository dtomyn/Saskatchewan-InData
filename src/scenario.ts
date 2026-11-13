// What if this closed? (plans/digital-twin/3-forecasts-and-what-ifs.md, 3a). The visitor closes one or more sites a
// stage routes to (a hospital, a courthouse); every place whose nearest site by road is closed falls back to the next
// one the stage kept for it (up to three, `driveTimes` in scripts/fetch-data.mjs). Nothing is invented: the fallback
// is a drive the pipeline already routed. Only the drive changes, never capacity or waiting times.
//
// A scenario is the visitor's own and lives only on the map and in its layer's panel: the Town Report and the Town
// Finder never read it (metrics.ts reads the data directly), so they always show the real values.
import type { Muni, Trip } from './data';
import { esc } from './html';

/** The layers that can run a closure: their sites, and each place's kept trips (fastest first) to them. */
export type ScenarioKind = 'hospitals' | 'court';
export const SCENARIO_LABEL: Record<ScenarioKind, { layer: string; one: string; nearest: string }> = {
  hospitals: { layer: 'hospitals', one: 'hospital', nearest: 'nearest hospital' },
  court: { layer: 'justice', one: 'courthouse', nearest: 'nearest courthouse' },
};

const closed: Record<ScenarioKind, Map<number, string>> = { hospitals: new Map(), court: new Map() };
/** Bumped on every change: a deck.gl update trigger, and a memo key. */
export let scenarioVersion = 0;

const changed = (kind: ScenarioKind | null) => {
  scenarioVersion++;
  window.dispatchEvent(new CustomEvent('atlas:scenario', { detail: kind }));
};

export const isClosed = (kind: ScenarioKind, f: number) => closed[kind].has(f);
export const closedSites = (kind: ScenarioKind) => [...closed[kind]].map(([f, name]) => ({ f, name }));
export const scenarioOn = (kind?: ScenarioKind) => (kind ? closed[kind].size > 0 : closed.hospitals.size + closed.court.size > 0);
export function setClosed(kind: ScenarioKind, f: number, name: string, close: boolean) {
  if (close) closed[kind].set(f, name); else closed[kind].delete(f);
  changed(kind);
}
export function clearScenario() {
  closed.hospitals.clear();
  closed.court.clear();
  changed(null);
}

/**
 * A place's trip under the scenario: the fastest kept trip whose site is open. `beyond` when every kept trip is closed:
 * the real drive is then longer than the last kept one, by an amount the data can't say.
 */
export function scenarioTrip(kind: ScenarioKind, trips: Trip[] | undefined): { trip: Trip | null; beyond: Trip | null } {
  if (!trips?.length) return { trip: null, beyond: null };
  const open = trips.find((t) => !closed[kind].has(t.f));
  return open ? { trip: open, beyond: null } : { trip: null, beyond: trips[trips.length - 1] };
}

export type Affected = { m: Muni; before: Trip; after: Trip | null; beyond: Trip | null; added: number | null };
/** The places whose nearest site is closed, worst first (a place with no open site kept goes first). */
export function affectedTowns(kind: ScenarioKind, munis: Muni[], tripsOf: (key: string) => Trip[] | undefined): Affected[] {
  const out: Affected[] = [];
  for (const m of munis) {
    const trips = tripsOf(m.key);
    const before = trips?.[0];
    if (!before || !closed[kind].has(before.f)) continue;
    const { trip, beyond } = scenarioTrip(kind, trips);
    const v = (t: Trip) => t.min ?? t.km;
    out.push({ m, before, after: trip, beyond, added: trip ? v(trip) - v(before) : null });
  }
  return out.sort((a, b) => (b.added ?? Infinity) - (a.added ?? Infinity));
}

/** The banner's and the panels' one line on what a scenario is and isn't. */
export const SCENARIO_CAVEAT = 'A scenario you chose, not a plan anyone has announced. Only the drive changes: it says nothing about beds, staff or waiting times. The Town Report and Town Finder keep the real values.';

export const CLOSED_COLOR = '#ff5a6e';

/**
 * The scenario's box at the top of a layer's panel: what is closed (each can be reopened), the places that drive
 * farther, worst first, with their old and new trips, and a Clear button.
 */
export function scenarioBox(kind: ScenarioKind, munis: Muni[], tripsOf: (key: string) => Trip[] | undefined, siteName: (f: number) => string, addText: (a: Affected) => string, tripText: (t: Trip) => string) {
  const box = document.createElement('div');
  box.className = 'sc-box';
  const lab = SCENARIO_LABEL[kind];
  const shut = closedSites(kind);
  const hit = affectedTowns(kind, munis, tripsOf);
  box.innerHTML = `<div class="sc-head"><span class="sc-tag">Scenario</span> What if ${shut.map((c) => `<b>${esc(c.name)}</b>`).join(' and ')} closed?</div>
    <div class="sc-closed-list">${shut.map((c) => `<button class="sc-reopen" data-f="${c.f}">↺ Reopen ${esc(c.name)}</button>`).join('')}<button class="sc-clear">Clear the scenario</button></div>
    <p class="sc-sum">${hit.length ? `${hit.length} place${hit.length > 1 ? 's' : ''} had ${shut.length > 1 ? 'one of these as its' : 'it as their'} ${lab.nearest} and would drive farther:` : `No place in the atlas has ${shut.length > 1 ? 'any of these' : 'it'} as its ${lab.nearest}, so no drive changes.`}</p>
    ${hit.length ? `<ol class="sc-list">${hit.map((a) => `<li data-key="${esc(a.m.key)}"><span class="nm">${esc(a.m.name)}</span><span class="sc-add">${esc(addText(a))}</span><span class="rd">${esc(tripText(a.before))} to ${esc(siteName(a.before.f))} → ${a.after ? `${esc(tripText(a.after))} to ${esc(siteName(a.after.f))}` : `every ${lab.one} kept for it is closed`}</span></li>`).join('')}</ol>` : ''}
    <p class="note">${esc(SCENARIO_CAVEAT)}</p>`;
  box.querySelectorAll<HTMLElement>('.sc-reopen').forEach((b) => b.addEventListener('click', () => setClosed(kind, +b.dataset.f!, '', false)));
  box.querySelector('.sc-clear')!.addEventListener('click', clearScenario);
  box.querySelector('.sc-list')?.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest<HTMLElement>('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
  return box;
}
