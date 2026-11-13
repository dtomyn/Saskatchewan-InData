// The sources view: a cross-section of a trembling aspen, the tree of the parkland belt. Each data source owns a wedge, each
// year is a ring from the pith (1900) out to the bark (today), and a ring glows as bright as that
// source's own record for the year. Projections grow past the bark as a hatched halo. Every number
// here is counted from the loaded data, not typed in.
import * as d3 from 'd3';
import { Data, HistoryFeed, fmt, loadHistoryIndex } from './data';
import { esc } from './html';
import { ago } from './now';
import { ALL_SOURCES, BARK, DERIVED, FUT, NOW, Y0, span, sum } from './sources-catalog';
import { createRound } from './sources-round';

// ---------------------------------------------------------------------------------------------

let root: HTMLElement | null = null;
export const sourcesOpen = () => !!root;

export function closeSources() {
  if (!root) return;
  const el = root;
  root = null;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 260);
  if (location.hash === '#sources') history.replaceState(null, '', location.pathname + location.search);
}

export function openSources(data: Data, opts: { onShow: (layerId: string) => void }) {
  // the film never loads live readings, so their wedges stay off the round too
  const SOURCES = data.now.skipped ? ALL_SOURCES.filter((s) => s.group !== 'Right now') : ALL_SOURCES;
  if (root) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // a few source rows carry impossible dates; they stay off the round
  const rings = SOURCES.map((s) => Object.fromEntries(Object.entries(s.rings(data)).filter(([y]) => +y >= Y0 && +y <= FUT)));
  const reads = SOURCES.map((s) => s.read(data));
  const live = SOURCES.map((_, i) => Object.keys(rings[i]).length > 0);
  const records = sum(reads.map((r) => r?.n ?? 0));
  const owners = new Set([...SOURCES, ...BARK].flatMap((s) => s.owner.split(' · ')));
  const licences = d3.rollups([...SOURCES, ...BARK], (v) => v.length, (s) => s.licence.split(';')[0]).sort((a, b) => b[1] - a[1]);
  const oldest = Math.min(...rings.map((r) => span(r)?.[0] ?? Infinity));
  const status = (key?: string) => {
    const m = key ? data.manifest[key] : null;
    if (!key) return '<span class="src-st">loaded live by the map</span>';
    if (!m?.ok) return `<span class="src-st bad">not available${m?.lastError ? ` · ${esc(m.lastError)}` : ''}</span>`;
    // live stages refresh hourly: their time matters, and a failed latest attempt is worth saying even with an older file
    if (key.startsWith('now-')) return `<span class="src-st ok">refreshed ${m.updated ? ago(m.updated) : ''}${m.lastError ? ` · last try failed: ${esc(m.lastError)}` : ''}</span>`;
    return `<span class="src-st ok">refreshed ${m.updated ? new Date(m.updated).toLocaleDateString('en-CA') : ''}</span>`;
  };

  root = document.createElement('div');
  root.className = 'sources';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'src-title');
  root.innerHTML = `
    <button class="close-x" aria-label="Close sources">×</button>
    <div class="src-stage">
      <div class="src-intro">
        <div class="kicker">Data &amp; sources</div>
        <h2 id="src-title">Every ring has a source</h2>
        <p>A cross-section of the atlas, read like an aspen round. Each wedge is one source, each ring one year from ${Y0} at the pith to ${NOW} at the bark, and a ring glows as strongly as that source’s own record for the year. Projections grow past the bark, hatched. Hover to read a ring; click to open its source.</p>
        <dl class="src-stats">
          <div><dd data-count="${SOURCES.length + BARK.length}">0</dd><dt>sources</dt></div>
          <div><dd data-count="${owners.size}">0</dd><dt>publishers</dt></div>
          <div><dd data-count="${records}">0</dd><dt>records read</dt></div>
          <div><dd data-count="${NOW - oldest + 1}">0</dd><dt>years of rings</dt></div>
        </dl>
      </div>
      <div class="src-round">
        <canvas aria-label="Tree-ring chart: one wedge per data source, one ring per year from ${Y0} to ${NOW}, projections beyond to ${FUT}"></canvas>
        <div class="src-year" aria-hidden="true"></div>
        <div class="src-tip" hidden></div>
      </div>
    </div>
    <div class="src-list">
      ${['Right now', 'Justice & safety', 'Hazards', 'Climate', 'People & places'].filter((g) => g !== 'Right now' || !data.now.skipped).map((g) => `<h3>${g}</h3>${SOURCES.map((s, i) => s.group !== g ? '' : `
        <article class="src-card${live[i] ? '' : ' off'}" data-i="${i}" tabindex="0" style="--c:${s.color}">
          <header><span class="src-dot"></span><b>${s.name}</b>${status(s.key)}</header>
          <div class="src-owner">${esc(s.owner)}</div>
          <a class="src-title" href="${s.url}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>
          <p>${s.gives}</p>
          ${reads[i] ? `<div class="src-read"><b data-count="${reads[i]!.n}">0</b> records · ${esc(reads[i]!.what)}${span(rings[i]) ? ` · rings ${span(rings[i])!.join('–')}` : ''}</div>` : ''}
          <code>${esc(s.endpoint)}</code>
          <footer><span class="src-lic">${esc(s.licence)}</span>${live[i] ? `<button class="src-go" data-id="${s.id}">See it on the map →</button>` : ''}</footer>
        </article>`).join('')}`).join('')}
      <h3>The bark: what everything sits on</h3>
      ${BARK.map((b, i) => `
        <article class="src-card bark" data-b="${i}" tabindex="0">
          <header><span class="src-dot"></span><b>${b.name}</b>${status(b.key)}</header>
          <div class="src-owner">${esc(b.owner)}${b.read ? ` · ${b.read(data)}` : ''}</div>
          <a class="src-title" href="${b.url}" target="_blank" rel="noopener">${esc(b.title)} ↗</a>
          <p>${b.gives}</p>
          <footer><span class="src-lic">${esc(b.licence)}</span></footer>
        </article>`).join('')}
      <h3>What this atlas worked out itself</h3>
      <ul class="src-derived">${DERIVED.map(([k, v]) => `<li><b>${k}</b> ${v}</li>`).join('')}</ul>
      <h3>Licences</h3>
      <div class="src-lics">${licences.map(([l, n]) => `<span>${esc(l)} <b>×${n}</b></span>`).join('')}</div>
      <p class="note">Contains information licensed under the Open Government Licence – British Columbia and the Open Government Licence – Canada. Refresh everything with <code>npm run data</code>; a source that fails keeps its last good copy and shows it above. This is a personal exploration tool, not real-estate, insurance or hazard advice.</p>
      <button class="src-cite">Copy a citation</button>
    </div>`;
  document.body.appendChild(root);
  if (location.hash !== '#sources') history.replaceState(null, '', '#sources');

  const el = root;
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>('canvas');
  const tip = $('.src-tip'), yearEl = $('.src-year'), list = $('.src-list');
  const cards = [...el.querySelectorAll<HTMLElement>('.src-card:not(.bark)')];
  const barkCards = [...el.querySelectorAll<HTMLElement>('.src-card.bark')];

  const focusCard = (card: HTMLElement | undefined) => {
    if (!card) return;
    el.querySelectorAll('.src-card.on').forEach((k) => k.classList.remove('on'));
    card.classList.add('on');
    card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'nearest' });
  };
  // the round: a click on a wedge opens its card, on the bark the bark's card, elsewhere closes them
  const round = createRound(canvas, tip, SOURCES, rings, (h) => {
    if (!h) el.querySelectorAll('.src-card.on').forEach((k) => k.classList.remove('on'));
    else if ('b' in h) focusCard(barkCards[h.b]);
    else focusCard(cards[h.i]);
  });

  cards.forEach((card, i) => {
    card.addEventListener('pointerenter', () => round.pin(i));
    card.addEventListener('focus', () => round.pin(i));
  });
  barkCards.forEach((card, i) => card.addEventListener('pointerenter', () => round.hoverBark(i)));
  list.addEventListener('pointerleave', () => round.leaveList());
  el.querySelectorAll<HTMLButtonElement>('.src-go').forEach((btn) => btn.addEventListener('click', () => { closeSources(); opts.onShow(btn.dataset.id!); }));
  // each live feed's daily record (the data-history branch): first and last day, days kept, gaps, days with few runs
  const HIST: Record<string, HistoryFeed> = { 'now-rivers': 'rivers', 'now-fires': 'fires', 'now-air': 'air', 'now-alerts': 'alerts', water: 'water' };
  loadHistoryIndex().then((ix) => {
    if (!ix || !root) return;
    cards.forEach((card, i) => {
      const h = ix.feeds[HIST[SOURCES[+(card.dataset.i ?? -1)]?.key ?? '']];
      if (!h) return;
      const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      card.querySelector('code')?.insertAdjacentHTML('beforebegin', `<div class="src-hist">Daily record: ${fmtDay(h.first)} → ${fmtDay(h.last)} · ${h.days} day${h.days === 1 ? '' : 's'} · ${h.gaps} gap${h.gaps === 1 ? '' : 's'}${h.few ? ` · ${h.few} with few runs` : ''} · ${h.kb} KB</div>`);
    });
  });
  $('.close-x').addEventListener('click', closeSources);
  const cite = $<HTMLButtonElement>('.src-cite');
  cite.addEventListener('click', async () => {
    const text = `Living Skies Atlas: Saskatchewan in open data (${NOW}). Compiled from ${[...owners].join(', ')}. ${licences.map(([l]) => l).join('; ')}. Accessed ${new Date().toLocaleDateString('en-CA')}.`;
    try { await navigator.clipboard.writeText(text); cite.textContent = 'Citation copied'; } catch { cite.textContent = text; }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSources(); }
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('.src-card')) (e.target as HTMLElement).querySelector<HTMLAnchorElement>('.src-title')?.click();
  });

  // ---- growth: the round grows from the pith to today, then the halo of projections appears
  const counters = [...el.querySelectorAll<HTMLElement>('[data-count]')];
  const count = (p: number) => counters.forEach((k) => (k.textContent = fmt.int(+k.dataset.count! * p)));
  const ro = new ResizeObserver(() => { round.resize(); if (grown) round.paint(NOW, 1); });
  let grown = false;
  round.resize();
  ro.observe(canvas.parentElement!);
  const GROW = calm ? 0 : 2600, HALO = calm ? 0 : 900, t0 = performance.now();
  const ease = d3.easeCubicOut;
  const step = (now: number) => {
    if (root !== el) { ro.disconnect(); return; }
    const t = now - t0;
    const g = GROW ? ease(Math.min(1, t / GROW)) : 1;
    const h = HALO ? Math.max(0, Math.min(1, (t - GROW) / HALO)) : 1;
    const y = Math.floor(Y0 + g * (NOW - Y0));
    round.paint(y, h);
    count(g);
    yearEl.textContent = h < 1 ? String(y) : '';
    yearEl.classList.toggle('done', g >= 1);
    if (g < 1 || h < 1) requestAnimationFrame(step);
    else grown = true;
  };
  requestAnimationFrame(step);
  el.querySelector<HTMLElement>('.close-x')!.focus({ preventScroll: true });
}
