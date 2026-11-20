// Guided tours (plans/wow/4-guided-tours.md): the app drives itself through a short story and hands back control at
// any moment. Nothing is pre-rendered: a tour only calls what a visitor could click, with today's data.
//
// A tour is a list of steps. Each has a caption and, optionally, a camera view, something to `do` through the same
// functions the ?film handle exposes, a stretch of timeline to `play`, and how long to hold. The stories are the
// explainer film's (video/storyboard.py), told in this vocabulary.
//
// Rules a step keeps:
// - A caption states only what the layer on screen shows, with the layer's own caveats.
// - Captions are typed here (trusted) and are set as text, never as HTML, so a name read from the data needs no escaping.
// - A tour changes no Finder weight and no scenario. The one saved setting it touches is the workplace (Workday Reach
//   needs one): it is put back when the tour ends, whichever way it ends.
// - A history layer with live readings is set to a year of its record at once, so a tour never loads the daily record.
import type * as maplibregl from 'maplibre-gl';
import type { Data } from './data';
import type { AtlasLayer } from './layer-kit';
import type { Work } from './metrics';

export type Camera = { center: [number, number]; zoom: number; pitch?: number; bearing?: number };

/** What a tour may use: the ?film handle's functions, plus the few a tour needs to leave things as it found them. */
export interface TourApi {
  map: maplibregl.Map;
  state: { time: number; speed: number; focused: string; mode: string };
  data: Data;
  layers: AtlasLayer[];
  HOME: Camera;
  focus(id: string): void;
  clearMap(): void;
  /** Leaves the Finder, a report or an event, and takes every layer off the map. */
  reset(): void;
  openTown(key: string): void;
  openFinder(): void;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
  setSpeed(v: number): void;
  /** Redraws the active layer's panel (after the workplace is put back). */
  refreshPanel(): void;
  getWork(): Work;
  setWork(w: Partial<Work>): void;
  /** Everything a tour can change, and putting it back. */
  snapshot(): unknown;
  restore(s: unknown): void;
}

export interface TourStep {
  caption: string | ((a: TourApi) => string);
  /** Where the camera goes: a flight, or a jump with reduced motion. Leave out when `do` moves it (a Town Report). */
  camera?: Camera | 'home';
  /** `inOrder` is false when the step is reached by Back, a dot or Resume rather than from the step before it. */
  do?: (a: TourApi, inOrder: boolean) => void;
  /** A stretch of the timeline to play once the camera has settled; the step lasts at least until it ends. */
  play?: { from: number; to: number; speed: number };
  /** How long to hold after the camera settles, in ms. Default: reading time for the caption. */
  wait?: number;
}

export interface Tour { id: string; title: string; blurb: string; steps: TourStep[] }

const range = (a: TourApi, id: string) => a.layers.find((l) => l.id === id)!.range;
/** Picks a layer on an otherwise empty map, at a time of its record. */
const only = (a: TourApi, id: string, t?: number) => { a.reset(); a.focus(id); if (t != null) a.setTime(t); };
/** Clicks a panel control once the panel has been drawn (it fills a moment after a layer is focused); gives up after ~1.5 s. */
const clickWhenShown = (sel: string, tries = 15) => {
  const b = document.querySelector<HTMLElement>(sel);
  if (b) { if (!b.classList.contains('on')) b.click(); return; }
  if (tries > 0) setTimeout(() => clickWhenShown(sel, tries - 1), 100);
};
/** The last whole year of a layer's record (before its Now stop, if it has one). */
const lastYear = (a: TourApi, id: string) => { const l = a.layers.find((x) => x.id === id)!; return Math.floor(l.now?.archiveEnd ?? l.range[1]); };
const n = (v: number) => v.toLocaleString('en-CA');

const NORTH: Camera = { center: [-105.6, 56.4], zoom: 5.5, pitch: 40, bearing: -8 };
const SOUTH: Camera = { center: [-105.4, 50.9], zoom: 5.9, pitch: 42, bearing: -10 };
const WIDE: Camera = { center: [-105.6, 54.3], zoom: 4.7, pitch: 20, bearing: 0 };
const SOUTH_EAST: Camera = { center: [-103.3, 49.75], zoom: 7.1, pitch: 45, bearing: -12 };
const MOOSE_JAW: Camera = { center: [-105.552, 50.3934], zoom: 11.6, pitch: 50, bearing: -15 };
const QU_APPELLE: Camera = { center: [-103.6, 50.72], zoom: 7.6, pitch: 35, bearing: -6 };
/** The workplace a tour borrows when the visitor has set none. */
const TOUR_WORK = 'saskatoon';

export const TOURS: Tour[] = [
  {
    id: 'province',
    title: 'A province in two minutes',
    blurb: 'Wildfires through the decades, the 2021 drought, what grows here, and the light.',
    steps: [
      {
        caption: (a) => `Saskatchewan, in open data. Each bright dot is one of its ${a.data.munis.length} main towns and cities; the fainter dots are ${n(a.data.small.length)} smaller communities.`,
        camera: 'home',
        do: (a) => a.reset(),
        wait: 6500,
      },
      {
        caption: 'Wildfires, year by year. Each flare is a fire starting; the scar it leaves is the area it burned.',
        do: (a) => only(a, 'fires', range(a, 'fires')[0]),
        camera: { center: [-105.6, 54.6], zoom: 5.0, pitch: 40, bearing: -12 },
        play: { from: 1959, to: 2015, speed: 4 },
      },
      {
        caption: 'The north in 2015. Burns of 200 hectares or more are drawn as their mapped outlines, simplified; a smaller fire is a circle of the right area, not its shape.',
        do: (a) => only(a, 'fires', 2015.7),
        camera: NORTH,
      },
      {
        caption: 'July 2021 on the Canadian Drought Monitor: from abnormally dry, in yellow, to exceptional drought, in dark red. It is a consensus map on a coarse grid, so a town near an edge can read one step off.',
        do: (a) => only(a, 'drought', 2021 + 6.5 / 12),
        camera: SOUTH,
      },
      {
        caption: 'What grows here, mapped from satellite images every year since 2009. Each cell shows its most common crop, so small fields vanish.',
        do: (a) => only(a, 'crops', 2009),
        camera: SOUTH,
        play: { from: 2009, to: 2025, speed: 2 },
      },
      {
        caption: 'And the light. On the shortest day of the year the north gets less daylight than the south. This is worked out from latitude, not measured.',
        // the layer keeps the chip a visitor last picked: the caption is about the shortest day, so pick it
        do: (a) => { only(a, 'light'); clickWhenShown('#panel [data-m="dec"]'); },
        camera: WIDE,
      },
      {
        caption: 'That is the province in two minutes. Every layer is in the Layer menu, top left, and each tells its own story in the side panel.',
        camera: 'home',
        wait: 6000,
      },
    ],
  },
  {
    id: 'town',
    title: 'Choosing a town',
    blurb: 'The Town Finder, a Town Report, and Workday Reach.',
    steps: [
      {
        caption: (a) => `Town Finder ranks the ${a.data.munis.length} places by what matters to you. Each slider is a weight, from 0, ignore it, to 5, matters most.`,
        camera: 'home',
        do: (a) => { a.reset(); a.openFinder(); },
      },
      {
        caption: 'The columns are each place’s score under the weights saved in this browser. A rank reflects what you set; it is not a verdict on a place.',
        camera: { center: [-105.6, 51.6], zoom: 5.6, pitch: 52, bearing: 14 },
      },
      {
        caption: 'Click any place for its Town Report. Saskatoon’s opens with a map of its census tracts, then the live readings near town.',
        // in order, the report opens over the Finder of the step before; out of order, that is set up first
        do: (a, inOrder) => { if (!inOrder) { a.reset(); a.openFinder(); } a.openTown('saskatoon'); },
        wait: 9000,
      },
      {
        caption: 'Further down, every layer adds its part: safety, climate, schools, doctors, water and home costs. A value that is inferred or borrowed from somewhere else says so.',
        wait: 8500,
      },
      {
        caption: (a) => {
          const w = a.getWork();
          const m = a.data.munis.find((x) => x.key === w.key);
          return `Workday Reach: a wave rolls out from where you work, and an arc reaches each place whose drive fits within ${w.limit} minutes. ${m?.name ?? 'The workplace'} is ${borrowedWork ? 'the workplace for this tour' : 'your workplace'}; drives are by road, without traffic.`;
        },
        do: (a) => {
          a.reset();
          if (!a.data.munis.some((m) => m.key === a.getWork().key)) { borrowedWork = true; a.setWork({ key: TOUR_WORK }); }
          a.focus('commute');
        },
        wait: 12000,
      },
      {
        caption: 'Open Town Finder, top right, to set your own weights and the place you work.',
        wait: 6000,
      },
    ],
  },
  {
    id: 'hazards',
    title: 'When the land turns',
    blurb: 'Rivers in flood, tornadoes, hail, and flood-prone land.',
    steps: [
      {
        caption: 'River floods. Each column is a gauge’s highest flow of the year, against that river’s normal annual peak. This is 2011, when the Souris River flooded Roche Percée and low-lying parts of Estevan.',
        do: (a) => only(a, 'rivers', 2011.5),
        camera: SOUTH_EAST,
      },
      {
        caption: 'Tornadoes since 1980, month by month. Counts depend on who was there to see one, and the record has a gap from 2010 to 2016.',
        do: (a) => only(a, 'tornadoes', 1980),
        camera: SOUTH,
        play: { from: 1980, to: 2009.9, speed: 4 },
      },
      {
        caption: (a) => `Hail: the storms and radar swaths the Northern Hail Project has traced since ${Math.floor(range(a, 'hail')[0])}. Only a few summers so far, so it shows where hail fell, not how often it will.`,
        do: (a) => only(a, 'hail', range(a, 'hail')[0]),
        camera: SOUTH,
        play: { from: 0, to: 9999, speed: 0.5 },
      },
      {
        caption: 'Flood-prone land in Moose Jaw: what a 1-in-500-year flood would cover, as the Water Security Agency mapped it. A modelled flood, not this year’s risk.',
        // the last year of the record: in a flood year the gauge's column at Moose Jaw stands over the whole town
        do: (a) => only(a, 'rivers', lastYear(a, 'rivers') + 0.5),
        camera: MOOSE_JAW,
        wait: 10000,
      },
      {
        caption: (a) => `Only ${new Set(a.data.floods?.zones.map((z) => z.place)).size} communities have a published flood map. No shading does not mean no risk.`,
        camera: SOUTH,
        wait: 7000,
      },
      {
        caption: 'These layers, with Wildfires, Smoke & air and Drought, are under History on the timeline in the Layer menu. They are a record, not a forecast.',
        wait: 6500,
      },
    ],
  },
  {
    id: 'people',
    title: 'Who is here',
    blurb: 'Treaties and reserves, who lives here, and newcomer services.',
    steps: [
      {
        caption: (a) => `Treaties and reserves. ${a.data.treaties?.treaties.length} numbered treaties between First Nations and the Crown, signed from 1871 to 1906, cover what is now Saskatchewan.`,
        do: (a) => only(a, 'treaties'),
        camera: WIDE,
      },
      {
        caption: 'Treaty 4 was signed at Fort Qu’Appelle in September 1874. The pale outlines are reserves; click one for its name and size.',
        camera: QU_APPELLE,
      },
      {
        caption: (a) => `Who lives here, from the 2021 census: the province is tinted census subdivision by census subdivision, all ${a.data.subdivisions?.csds.length ?? ''} of them, by the share you pick in the side panel.`,
        do: (a) => only(a, 'community'),
        camera: 'home',
      },
      {
        caption: 'A rural municipality’s numbers leave out the towns inside it, and a reserve is its own subdivision. Census counts are randomly rounded, so a very small place can show a dash.',
        camera: { center: [-105.83, 50.93], zoom: 7.6, pitch: 35, bearing: -5 },
      },
      {
        caption: 'Newcomer services: settlement and language offices, Service Canada, and SGI licence issuers, with each place’s typical drive to the nearest. Insurance brokers stand in for SGI issuers, which is inferred from OpenStreetMap.',
        do: (a) => only(a, 'newcomer'),
        camera: 'home',
      },
      {
        caption: 'Click any place for its report, or open Town Finder and try the New to Saskatchewan preset.',
        wait: 6000,
      },
    ],
  },
];

// true while the workplace on screen is the tour's own, not the visitor's
let borrowedWork = false;

export interface Tours {
  start(id: string, opts?: { fromLink?: boolean }): boolean;
  active(): boolean;
  /** Handles a key while a tour is up (Space, the arrows, Escape); true when it did. */
  key(e: KeyboardEvent): boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Long enough to read a caption at an easy pace. */
const readMs = (text: string) => Math.max(5500, text.split(/\s+/).length * 330 + 1500);
const text = (s: TourStep, a: TourApi) => (typeof s.caption === 'string' ? s.caption : s.caption(a));

export function initTours(a: TourApi): Tours {
  const bar = $('tour-bar'), menu = $('tour-menu'), btn = $('tour-btn');
  type Run = { tour: Tour; i: number; gen: number; paused: boolean; done: boolean; snap: unknown; work: Work; timer: number };
  let run: Run | null = null;

  // ---- the menu beside the Layer button
  const setMenu = (open: boolean) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  menu.replaceChildren(...TOURS.map((t) => {
    const b = document.createElement('button');
    b.className = 'tour-row';
    b.dataset.tour = t.id;
    const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: t.title });
    const bl = Object.assign(document.createElement('span'), { className: 'bl', textContent: t.blurb });
    const secs = Math.round(t.steps.reduce((s, st) => s + estimate(st), 0) / 1000 / 10) * 10;
    const tm = Object.assign(document.createElement('span'), { className: 'tm', textContent: `about ${secs} s` });
    b.append(nm, bl, tm);
    b.addEventListener('click', () => { setMenu(false); start(t.id); });
    return b;
  }), Object.assign(document.createElement('div'), { className: 'menu-hint', textContent: 'A tour drives the real app: the camera, the layers, the timeline. Touch the map and it pauses; you can stop and explore at any step.' }));
  btn.addEventListener('click', () => setMenu(!!menu.hidden));

  // ---- the bar: caption, a dot per step, the controls
  bar.innerHTML = `<div class="tour-head"><span class="tour-kicker">Tour</span><span class="tour-title"></span><span class="tour-count"></span><button class="tour-x" data-t="exit" title="Leave the tour and put the map back as it was (Esc)" aria-label="Exit the tour">×</button></div>
    <p class="tour-caption" aria-live="polite"></p>
    <div class="tour-foot"><div class="tour-dots" role="group" aria-label="Steps"></div>
      <div class="tour-ctl"><button data-t="back" title="Previous step (←)">Back</button><button data-t="pause" title="Pause or resume (Space)"></button><button data-t="next" title="Next step (→)">Next</button><button data-t="keep" class="primary" title="Stop the tour and keep the map as it is now">Explore from here</button></div></div>`;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => bar.querySelector<T>(sel)!;
  bar.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t], [data-step]');
    if (!t || !run) return;
    if (t.dataset.step) return show(+t.dataset.step);
    if (t.dataset.t === 'exit') end(false);
    else if (t.dataset.t === 'keep') end(true);
    else if (t.dataset.t === 'back') show(Math.max(0, run.i - 1));
    else if (t.dataset.t === 'next') next();
    else if (t.dataset.t === 'pause') (run.paused ? show(run.i) : pause());
  });

  // any touch of the app outside the bar pauses the tour; so does a scroll on the map
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (!menu.hidden && !t.closest('.tour-picker')) setMenu(false);
    if (run && !run.paused && !t.closest('#tour-bar, .tour-picker')) pause();
  }, true);
  $('map').addEventListener('wheel', () => { if (run && !run.paused) pause(); }, { capture: true, passive: true });

  function estimate(s: TourStep) {
    const cap = typeof s.caption === 'string' ? s.caption : s.caption.toString();
    const hold = s.wait ?? readMs(cap);
    return (s.camera ? 2200 : 0) + (s.play && s.play.to < 9000 ? Math.max(hold, ((s.play.to - s.play.from) / s.play.speed) * 1000 + 1200) : hold);
  }

  function draw() {
    if (!run) return;
    const { tour, i, paused, done } = run;
    q('.tour-title').textContent = tour.title;
    q('.tour-count').textContent = `${i + 1} of ${tour.steps.length}`;
    q('.tour-caption').textContent = text(tour.steps[i], a);
    q('.tour-dots').replaceChildren(...tour.steps.map((_, k) => {
      const d = document.createElement('button');
      d.className = `tour-dot${k === i ? ' on' : k < i ? ' seen' : ''}`;
      d.dataset.step = String(k);
      d.title = `Step ${k + 1}`;
      d.setAttribute('aria-label', `Step ${k + 1} of ${tour.steps.length}`);
      if (k === i) d.setAttribute('aria-current', 'step');
      return d;
    }));
    q<HTMLButtonElement>('[data-t="back"]').disabled = i === 0;
    q('[data-t="next"]').hidden = i === tour.steps.length - 1;
    const p = q('[data-t="pause"]');
    p.hidden = done;
    p.textContent = paused ? 'Resume' : 'Pause';
    q('[data-t="keep"]').hidden = !paused && !done;
    bar.classList.toggle('paused', paused && !done);
  }

  /** Runs a step from its start: what it does, its camera, its stretch of timeline, then the next step. */
  function show(i: number, inOrder = false) {
    if (!run) return;
    const r = run;
    clearInterval(r.timer);
    r.i = i; r.paused = false; r.done = false;
    const gen = ++r.gen;
    const s = r.tour.steps[i];
    const still = () => run === r && r.gen === gen;
    a.setPlaying(false);
    a.map.stop();
    // a step with nothing to do builds on the one before it: reached out of order (Back, a dot, Resume), that one's
    // setup runs first
    let k = i;
    if (!inOrder) while (k > 0 && !r.tour.steps[k].do) k--;
    if (r.tour.steps[k].do) { giveBackWork(r); r.tour.steps[k].do!(a, inOrder); }
    draw();

    const calm = reduced();
    let moving = false;
    const flyMs = 2400;
    if (s.camera) {
      const c = s.camera === 'home' ? a.HOME : s.camera;
      if (calm) a.map.jumpTo(c);
      else {
        moving = true;
        a.map.flyTo({ ...c, duration: flyMs, essential: true });
        a.map.once('moveend', () => { moving = false; });
      }
    }
    // a play stretch is clamped to the layer's own range (hail's years come from its data)
    const [lo, hi] = a.layers.find((l) => l.id === a.state.focused)?.range ?? [0, 0];
    const play = s.play && { from: Math.max(lo, s.play.from), to: Math.min(hi, s.play.to), speed: s.play.speed };
    const playMs = play ? ((play.to - play.from) / play.speed) * 1000 : 0;
    const hold = Math.max(s.wait ?? readMs(text(s, a)), play ? playMs + 1200 : 0);
    const t0 = performance.now();
    let settled = 0;
    r.timer = window.setInterval(() => {
      if (!still()) return clearInterval(r.timer);
      const now = performance.now();
      if (moving && now - t0 < flyMs + 1500) return;
      if (!settled) {
        settled = now;
        if (play) { a.setTime(play.from); if (!calm) { a.setSpeed(play.speed); a.setPlaying(true); } }
      }
      const el = now - settled;
      if (play) {
        // reduced motion: the timeline steps through the stretch instead of playing
        if (calm) a.setTime(play.from + (play.to - play.from) * Math.min(1, Math.floor((el / playMs) * 6) / 6));
        // (a hidden tab does not advance the timeline: the step's clock ends the stretch all the same)
        else if (a.state.time >= play.to || el > playMs + 600) a.setPlaying(false);
      }
      if (el < hold) return;
      clearInterval(r.timer);
      a.setPlaying(false);
      if (i < r.tour.steps.length - 1) show(i + 1, true);
      else { r.done = true; r.paused = true; draw(); }
    }, 120);
  }

  /** Puts the visitor's own workplace back if a step borrowed one; true when it had to. */
  function giveBackWork(r: Run) {
    const w = a.getWork();
    const changed = w.key !== r.work.key || w.limit !== r.work.limit;
    if (changed) a.setWork(r.work);
    borrowedWork = false;
    return changed;
  }

  function next() { if (run && run.i < run.tour.steps.length - 1) show(run.i + 1, !run.paused); }

  function pause() {
    if (!run || run.paused) return;
    clearInterval(run.timer);
    run.gen++;
    run.paused = true;
    a.setPlaying(false);
    a.map.stop();
    draw();
  }

  function setUrl(id: string | null) {
    const u = new URL(location.href);
    if (id) u.searchParams.set('tour', id); else u.searchParams.delete('tour');
    try { history.replaceState(null, '', u); } catch { /* a sandboxed frame */ }
  }

  function start(id: string, opts: { fromLink?: boolean } = {}) {
    const tour = TOURS.find((t) => t.id === id);
    if (!tour) return false;
    // a second tour started from the first keeps the first one's way back
    const snap = run ? run.snap : a.snapshot();
    const work = run ? run.work : { ...a.getWork() };
    if (run) clearInterval(run.timer);
    // opened from a link, the way back is the app's opening view, not the middle of its opening flight
    if (opts.fromLink) (snap as { camera: Camera }).camera = a.HOME;
    run = { tour, i: 0, gen: 0, paused: false, done: false, snap, work, timer: 0 };
    bar.hidden = false;
    document.body.classList.add('touring');
    setUrl(id);
    show(0);
    return true;
  }

  /** Ends the tour: `keep` leaves the map as the tour has it ("Explore from here"), otherwise everything goes back. */
  function end(keep: boolean) {
    if (!run) return;
    const r = run;
    clearInterval(r.timer);
    run = null;
    a.setPlaying(false);
    a.map.stop();
    bar.hidden = true;
    document.body.classList.remove('touring');
    setUrl(null);
    const workChanged = giveBackWork(r);
    if (!keep) a.restore(r.snap);
    else if (workChanged) a.refreshPanel();
  }

  function key(e: KeyboardEvent) {
    if (!run) return false;
    if (e.key === 'Escape') end(false);
    else if (e.code === 'Space') { if (!run.done) (run.paused ? show(run.i) : pause()); }
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') show(Math.max(0, run.i - 1));
    else return false;
    e.preventDefault();
    return true;
  }

  return { start, active: () => !!run, key };
}
