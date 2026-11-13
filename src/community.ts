// WHO LIVES HERE — help for a newcomer looking for community: how many people in each place came to Canada from
// elsewhere and how recently, where they were born, which languages besides English and French are spoken at home, who
// speaks French, and how many people identify as Indigenous (Census 2021 profile, the place's own census subdivision);
// and the places of worship mapped in OpenStreetMap in or just outside town, coloured by religion. It describes who
// already lives somewhere; it does not rank people. A static layer.
import * as d3 from 'd3';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { fmt } from './data';
import type { CommunityCensus, Data, WorshipSite } from './data';
import { esc } from './html';
import { rampCSS } from './charts';
import { AtlasLayer, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layers';

export const COMMUNITY_COLOR = '#f0a6ca';

/** Religions as the data stage writes them (`Community.religions`), with how the map shows them. */
export const RELIGIONS: Record<string, { label: string; plural: string; color: string }> = {
  christian: { label: 'Christian', plural: 'churches', color: '#ffd166' },
  muslim: { label: 'Muslim', plural: 'mosques', color: '#3ecf8e' },
  sikh: { label: 'Sikh', plural: 'gurdwaras', color: '#ff9f43' },
  hindu: { label: 'Hindu', plural: 'Hindu temples', color: '#ff5d5d' },
  buddhist: { label: 'Buddhist', plural: 'Buddhist temples', color: '#c084fc' },
  jewish: { label: 'Jewish', plural: 'synagogues', color: '#5aa9ff' },
  other: { label: 'Other faith', plural: 'other faiths’ places of worship', color: '#4ee6d6' },
  unstated: { label: 'Faith not tagged', plural: 'places of worship with no religion tagged', color: '#9aa3b2' },
};

/** What the columns can show, in the order of the panel's chips: a count over its census base. */
const MEASURES = [
  { id: 'imm', chip: 'Immigrants', label: 'immigrants', n: 'imm', of: 'hhPop', max: 25 },
  { id: 'rec', chip: 'Arrived 2016–21', label: 'recent immigrants (arrived 2016–2021)', n: 'rec', of: 'hhPop', max: 8 },
  { id: 'home', chip: 'Other home language', label: 'speaking a non-official language most often at home', n: 'nonOff', of: 'homeTot', max: 16 },
  { id: 'fr', chip: 'Speak French', label: 'able to hold a conversation in French', n: 'frKn', of: 'knTot', max: 10 },
  { id: 'ind', chip: 'Indigenous identity', label: 'First Nations, Métis or Inuit', n: 'ind', of: 'indTot', max: 100 },
] as const;
type MeasureId = (typeof MEASURES)[number]['id'];
type CountKey = keyof Omit<CommunityCensus, 'birth' | 'lang'>;

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

/** One place's community picture, for the Town Report and the Finder. */
export type PlaceCommunity = Partial<CommunityCensus> & {
  csd?: string; birth: [string, number][]; lang: [string, number][];
  /** immigrants as a % of people in private households (the Finder's Diverse community) */ immShare: number | null;
  /** places of worship in or near town, by religion id */ pw: { id: string; n: number }[];
};
export function placeCommunity(data: Data, key: string): PlaceCommunity | null {
  const C = data.community;
  const t = C?.towns[key];
  if (!C || !t) return null;
  return {
    ...t, birth: t.birth ?? [], lang: t.lang ?? [], immShare: share(t, 'imm', 'hhPop'),
    pw: C.religions.map((id, i) => ({ id, n: t.pw?.[i] ?? 0 })).filter((r) => r.n > 0),
  };
}
const rel = (C: Data['community'], i: number) => RELIGIONS[C?.religions[i] ?? 'other'] ?? RELIGIONS.other;
/** A rounded census count for reading. */
export const people = (n: number) => (n >= 1000 ? fmt.int(Math.round(n / 10) * 10) : String(n));

export function communityLayer(data: Data): AtlasLayer {
  const color = COMMUNITY_COLOR;
  const C = data.community;
  const sites: WorshipSite[] = C?.sites ?? [];
  let target: MeasureId = 'imm';
  const measure = () => MEASURES.find((m) => m.id === target)!;
  const val = (key: string) => share(C?.towns[key], measure().n, measure().of);
  const ramp = (max: number) => d3.scaleSqrt<string>().domain([0, max / 2, max]).range(['#4b3a63', color, '#fff3d6']).interpolate(d3.interpolateRgb).clamp(true);
  const nameOf = (key: string) => data.munis.find((m) => m.key === key)?.name ?? key;

  const l: AtlasLayer = {
    id: 'community',
    name: 'Who lives here',
    icon: '🤝',
    color,
    range: [2025, 2025.99],
    static: true,
    period: 'Census 2021 · places of worship as mapped today',
    available: !!C,
    unavailable: 'The census profile could not be downloaded when this copy of the data was built. Run <code>npm run data community</code>, then reload.',
    build({ selected, focusedId }) {
      const out: Layer[] = [];
      if (focusedId === 'community') {
        const m = measure();
        const r = ramp(m.max);
        out.push(...townColumns('community', data.munis, (x) => val(x.key), (v) => 2500 + Math.sqrt(Math.min(v, m.max) / m.max) * 60000, (v) => rgb(r(v), 235), 0, `${selected}${target}`));
      }
      out.push(new ScatterplotLayer<WorshipSite>({
        id: 'community-sites', data: sites, getPosition: (s) => [s[0], s[1]],
        getRadius: 150, radiusMinPixels: focusedId === 'community' ? 3 : 2.2, radiusMaxPixels: 9,
        getFillColor: (s) => rgb(rel(C, s[2]).color, 235), stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 0.8,
        pickable: true, parameters: { depthCompare: 'always' },
      } as any));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Settling in · Census 2021 · OpenStreetMap')}
        <h2>Who lives here?</h2>`;
      if (!C) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">A new place feels less new when someone nearby shares your language, your food or your faith. This layer shows who already lives in each place, from the 2021 census: people who came to Canada from elsewhere and where they were born, the languages spoken at home, French speakers and Indigenous identity. Columns show the share you pick; dots are places of worship, by religion. It is here to help you find community, not to rank people or places by who lives there.</p>
        <div class="chips" style="margin:2px 0 10px">${MEASURES.map((m) => `<button class="chip${m.id === target ? ' on' : ''}" data-k="${m.id}" style="--c:${color}">${m.chip}</button>`).join('')}</div>`);
      const rows = data.munis.flatMap((m) => { const p = placeCommunity(data, m.key); return p ? [{ m, p }] : []; });
      const P = C.prov;
      const hero = heroStats(el, 4);
      hero(0, pctText(P, 'imm', 'hhPop'), 'of Saskatchewan residents are immigrants');
      hero(1, pctText(P, 'rec', 'hhPop'), 'arrived 2016–2021');
      hero(2, P.birth[0]?.[0] ?? '—', 'most common birthplace of immigrants');
      hero(3, fmt.int(sites.length), 'places of worship in the atlas’s towns');
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === target));
        const m = measure();
        const r = ramp(m.max);
        const ranked = rows.map((x) => ({ ...x, v: share(x.p, m.n, m.of) })).sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || a.m.name.localeCompare(b.m.name));
        const max = d3.max(ranked, (x) => x.v ?? 0) || 1;
        const detail = (p: PlaceCommunity) => (target === 'home' ? p.lang : target === 'imm' || target === 'rec' ? p.birth : []).slice(0, 3).map((x) => esc(x[0])).join(', ');
        body.innerHTML = `<h3>Share ${esc(m.label)}</h3>
          <ol class="rank-list">${ranked.map((x, i) => `<li data-key="${esc(x.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(x.m.name)}</span>${detail(x.p) ? `<br><span class="rd">${detail(x.p)}</span>` : ''}</span><span><div class="bar"><i style="width:${Math.round(((x.v ?? 0) / max) * 100)}%;background:${r(x.v ?? 0)}"></i></div><div class="bar-v">${pctText(x.p, m.n, m.of)}</div></span></li>`).join('')}</ol>
          <div class="ramp" style="background:${rampCSS((t) => r(t * m.max))}"></div><div class="ramp-labels"><span>0%</span><span>${m.max / 2}%</span><span>${m.max}%+</span></div>`;
      };
      body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as MeasureId | undefined;
        if (k) { target = k; draw(); }
      });
      draw();
      const counts = C.religions.map((id, i) => ({ id, n: sites.filter((s) => s[2] === i).length }));
      el.insertAdjacentHTML('beforeend', `
        <div class="legend">${counts.map((c) => `<span><i class="sw" style="background:${(RELIGIONS[c.id] ?? RELIGIONS.other).color}"></i>${(RELIGIONS[c.id] ?? RELIGIONS.other).label} (${c.n})</span>`).join('')}</div>
        <p class="note">Figures are for each place’s own census subdivision (the city, town or village, not the rural municipality or First Nation reserves around it: reserves are their own census subdivisions, on the Treaties &amp; reserves layer). Immigrants are people who are, or have ever been, permanent residents; temporary residents such as international students and work-permit holders are counted separately and not included. Immigrants, birthplaces and Indigenous identity come from the long-form sample (one household in four), languages from every household; home languages count people who gave one language only.</p>
        <p class="note">Statistics Canada rounds every count up or down to a multiple of 5 to protect privacy, and suppresses some small places’ sample figures. A “—” means none, a handful, or not published: too few to say. Places of worship are those mapped in OpenStreetMap inside town limits or within ${C.slackKm} km of them; many small-town churches carry no religion tag (grey), and a congregation that meets in a hall or a home will not be mapped at all.</p>
        ${sourceLine(`${C.source}. ${C.worshipSource}, ${C.asOf}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('community')) return null;
      if (id === 'community-sites') {
        const s = info.object as WorshipSite;
        const r = rel(C, s[2]);
        return `<b>${esc(s[3] ?? 'Place of worship')}</b><br><span class="tk">${r.label}${s[4] ? ` · ${esc(s[4])}` : ''} · ${esc(nameOf(s[6]))}</span>`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const p = placeCommunity(data, o.m.key);
      if (!p) return null;
      const m = measure();
      return `<b>${esc(o.m.name)}</b><br><span class="tk">${m.chip}</span> <span class="tv">${pctText(p, m.n, m.of)}</span>${p.birth.length ? `<br><span class="tk">Born in: ${p.birth.slice(0, 3).map((b) => esc(b[0])).join(', ')}</span>` : ''}${p.lang.length ? `<br><span class="tk">Home languages: ${p.lang.slice(0, 3).map((b) => esc(b[0])).join(', ')}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      if (info.layer?.id !== 'community-sites') return null;
      const s = info.object as WorshipSite;
      const r = rel(C, s[2]);
      const town = nameOf(s[6]);
      const p = placeCommunity(data, s[6]);
      const total = p ? d3.sum(p.pw, (x) => x.n) : 0;
      return {
        layer: 'community', kind: 'Place of worship', lon: s[0], lat: s[1], zoom: 14,
        title: s[3] ?? `${r.label} place of worship`,
        body: `${r === RELIGIONS.unstated || r === RELIGIONS.other ? 'A place of worship' : `A ${r.label} place of worship`}${s[4] ? ` (${s[4]})` : ''} mapped in OpenStreetMap, in or near ${town}.`,
        stats: p ? [{ v: String(total), l: `places of worship mapped in ${town}` }, { v: pctText(p, 'imm', 'hhPop'), l: `of ${town}’s residents are immigrants` }] : [],
        sources: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[s[5][0]] ?? 'node'}/${s[5].slice(1)}` }],
      };
    },
  };
  return l;
}
