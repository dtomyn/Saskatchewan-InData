// The detail view in the side panel for a timeline event (opened from a timeline marker, the event ticker, or a
// layer's list of key moments) and for anything clicked on the map (a quake, a gauge, a station): both are AtlasEvents,
// a map feature simply has no date when it isn't a moment. Everything beyond an event's title and body is optional (see AtlasEvent in layers.ts):
// headline numbers, sections, a photo, sources, the layers that tell the story, and a `detail` hook for anything
// richer. The panel also adds context of its own for every event: the layer year by year with this moment marked,
// what else was happening at the time on other layers, the closest towns, and the previous and next moments.
import { barChart } from './charts';
import { Data, MONTHS, km } from './data';
import { esc, safeUrl } from './html';
import type { AtlasEvent, AtlasLayer, TimedEvent } from './layer-kit';

/** A stable key for an event, so it can be found again after the list is rebuilt. */
export const eventKey = (ev: TimedEvent) => `${ev.layer}@${ev.t.toFixed(3)}`;
export const eventDate = (t: number) => `${MONTHS[Math.min(11, Math.floor((t % 1) * 12))]} ${Math.floor(t)}`;

export type EventContext = {
  data: Data;
  byId: Record<string, AtlasLayer>;
  /** every timeline event, in time order */
  events: TimedEvent[];
  /** where the back button goes, and what it says */
  backLabel: string;
  onBack: () => void;
  onOpen: (ev: AtlasEvent) => void;
  /** put the event's layers on the map at its date */
  onShow: (ev: AtlasEvent) => void;
  onTown: (key: string) => void;
};

export const eventColor = (ev: AtlasEvent, byId: Record<string, AtlasLayer>) => (ev.layer === '*' ? '#ffffff' : byId[ev.layer]?.color ?? '#ffffff');
const layerName = (ev: AtlasEvent, byId: Record<string, AtlasLayer>) => (ev.layer === '*' ? 'Province-wide' : byId[ev.layer]?.name ?? ev.layer);

/** The layers an event's story is told with: its own (if it has one), then any it names. */
export const eventLayers = (ev: AtlasEvent, byId: Record<string, AtlasLayer>) =>
  [...new Set([...(ev.layer === '*' ? [] : [ev.layer]), ...(ev.layers ?? [])])].filter((id) => byId[id]?.available);

const item = (e: TimedEvent, byId: Record<string, AtlasLayer>, i: number) =>
  `<button class="ev-item" data-ev="${i}" style="--c:${eventColor(e, byId)}"><span class="ev-dot"></span><span><b>${esc(e.title)}</b><small>${esc(layerName(e, byId))} · ${eventDate(e.t)}</small></span><span class="ev-go">›</span></button>`;

export function renderEventPanel(el: HTMLElement, ev: AtlasEvent, c: EventContext) {
  const { byId, events } = c;
  const colour = eventColor(ev, byId);
  const t = ev.t;
  // a timeline event has neighbours; a map feature (not in the list) has none
  const peers = events.filter((e) => e.layer === ev.layer);
  const at = peers.indexOf(ev as TimedEvent);
  const prev = at > 0 ? peers[at - 1] : null, next = at >= 0 && at < peers.length - 1 ? peers[at + 1] : null;
  // other layers' moments within a year and a half either side
  const also = t == null ? [] : events.filter((e) => e !== ev && e.layer !== ev.layer && Math.abs(e.t - t) <= 1.5).slice(0, 5);
  const towns = ev.lon != null && ev.lat != null
    ? c.data.munis.map((m) => ({ m, d: km(m.lon, m.lat, ev.lon!, ev.lat!) })).sort((a, b) => a.d - b.d).slice(0, 3)
    : [];
  const showLayers = eventLayers(ev, byId);
  // the layer to chart: the event's own, else the first time-based layer it names
  const chartLayer = t == null ? undefined : showLayers.map((id) => byId[id]).find((l) => !l.static && l.spark().length);
  const img = ev.image && safeUrl(ev.image.src);
  const imgHref = ev.image?.href ? safeUrl(ev.image.href) : null;
  const sources = (ev.sources ?? []).map((s) => ({ ...s, url: safeUrl(s.url) })).filter((s) => s.url);
  const list: TimedEvent[] = [];
  const idx = (e: TimedEvent) => list.push(e) - 1;

  el.innerHTML = `
    <button class="ld-back ev-back">‹ ${esc(c.backLabel)}</button>
    ${img ? `<a class="tr-hero ev-hero"${imgHref ? ` href="${esc(imgHref)}" target="_blank" rel="noopener"` : ''}><img alt="" src="${esc(img)}"><span>${esc(ev.image!.credit)}${imgHref ? ' ↗' : ''}</span></a>` : ''}
    <div class="kicker" style="--c:${colour}">${esc(ev.kind ?? layerName(ev, byId))}${t != null ? ` · ${eventDate(t)}${ev.end ? ` – ${eventDate(ev.end)}` : ''}` : ''}</div>
    <h2>${esc(ev.title)}</h2>
    <p class="lede">${esc(ev.body)}</p>
    ${ev.stats?.length ? `<div class="hero ev-stats">${ev.stats.map((s) => `<div class="stat"><div class="v">${esc(s.v)}</div><div class="l">${esc(s.l)}</div></div>`).join('')}</div>` : ''}
    <div class="ev-detail"></div>
    ${showLayers.length ? `<button class="ev-show" style="--c:${colour}"><span>◉</span> Show it on the map · ${esc(showLayers.map((id) => byId[id].name).join(' + '))}${t != null ? `, ${eventDate(t)}` : ''}</button>` : ''}
    ${(ev.sections ?? []).map((s) => `<h3>${esc(s.title)}</h3><p class="ev-text">${esc(s.text)}</p>`).join('')}
    ${chartLayer ? `<h3>${esc(chartLayer.name)}, year by year</h3><div class="ev-chart"></div>` : ''}
    ${also.length ? `<h3>Also happening</h3><div class="ev-list">${also.map((e) => item(e, byId, idx(e))).join('')}</div>` : ''}
    ${towns.length ? `<h3>Closest towns</h3><div class="tr-falls">${towns.map(({ m, d }) => `<button class="tr-fall tr-town" data-town="${esc(m.key)}"><span class="tr-pin"></span>${esc(m.name)} <small>${d < 2 ? 'right here' : `${d.toFixed(0)} km`} · town report ›</small></button>`).join('')}</div>` : ''}
    ${prev || next ? `<h3>${ev.layer === '*' ? 'More province-wide moments' : `More from ${esc(layerName(ev, byId))}`}</h3><div class="ev-nav">${prev ? `<button class="ev-step" data-ev="${idx(prev)}"><small>‹ Earlier · ${eventDate(prev.t)}</small><b>${esc(prev.title)}</b></button>` : '<span></span>'}${next ? `<button class="ev-step next" data-ev="${idx(next)}"><small>Later · ${eventDate(next.t)} ›</small><b>${esc(next.title)}</b></button>` : '<span></span>'}</div>` : ''}
    ${sources.length ? `<div class="ld-actions">${sources.map((s) => `<a class="ld-btn" target="_blank" rel="noopener" href="${esc(s.url!)}">${esc(s.label)} ↗</a>`).join('')}</div>` : ''}`;

  el.querySelector('.ev-back')!.addEventListener('click', c.onBack);
  el.querySelector('.ev-show')?.addEventListener('click', () => c.onShow(ev));
  el.querySelectorAll<HTMLElement>('[data-ev]').forEach((b) => b.addEventListener('click', () => c.onOpen(list[+b.dataset.ev!])));
  el.querySelectorAll<HTMLElement>('[data-town]').forEach((b) => b.addEventListener('click', () => c.onTown(b.dataset.town!)));
  if (ev.detail) ev.detail(el.querySelector<HTMLElement>('.ev-detail')!);
  if (chartLayer) {
    requestAnimationFrame(() => {
      const box = el.querySelector<HTMLElement>('.ev-chart');
      if (!box) return;
      const data = chartLayer.spark();
      const xs = data.map((d) => d.x);
      barChart(box, {
        data, xDomain: [Math.min(...xs), Math.max(...xs)], color: chartLayer.color, height: 110,
        diverging: data.some((d) => d.y < 0),
        tooltip: (d) => `<b>${d.x}</b>${Math.floor(t!) === d.x ? ' · this moment' : ''}`,
      }).setPlayhead(t!);
    });
  }
}

/** A layer's key moments, for the bottom of its story panel. */
export function momentsList(layerEvents: TimedEvent[], byId: Record<string, AtlasLayer>, onOpen: (ev: AtlasEvent) => void) {
  const box = document.createElement('div');
  box.className = 'ev-moments';
  box.innerHTML = `<h3>Key moments</h3><div class="ev-list">${layerEvents.map((e, i) => item(e, byId, i)).join('')}</div>`;
  box.querySelectorAll<HTMLElement>('[data-ev]').forEach((b) => b.addEventListener('click', () => onOpen(layerEvents[+b.dataset.ev!])));
  return box;
}

/**
 * The safety net behind "click anything for details": a feature whose layer has no describe() becomes a panel built
 * from its tooltip. The bold line is the title; each "label value" pair becomes a headline tile; other lines become
 * the body. Tooltips are built by the layers (with outside text escaped), and only their text is read here.
 */
export function fromTooltip(layer: AtlasLayer, html: string, lonLat: [number, number] | null): AtlasEvent | null {
  const box = document.createElement('div');
  box.innerHTML = html;
  const title = box.querySelector('b')?.textContent?.trim();
  if (!title) return null;
  box.querySelector('b')!.remove();
  const stats: { v: string; l: string }[] = [];
  const lines: string[] = [];
  // walk the tooltip line by line (lines are separated by <br>)
  const parts = box.innerHTML.split(/<br\s*\/?>/i);
  for (const part of parts) {
    const row = document.createElement('div');
    row.innerHTML = part;
    const k = row.querySelector('.tk')?.textContent?.trim(), v = row.querySelector('.tv')?.textContent?.trim();
    const text = row.textContent?.replace(/\s+/g, ' ').trim();
    if (!text || /^click/i.test(text)) continue;
    if (k && v) stats.push({ v, l: k });
    else lines.push(text);
  }
  return {
    layer: layer.id, kind: layer.name, title, body: lines.join(' · '),
    stats: stats.slice(0, 6),
    ...(lonLat ? { lon: lonLat[0], lat: lonLat[1] } : {}),
  };
}
