// The Town Report's building blocks, shared by the panels and by each layer's own rows (`schoolsRows` in schools.ts,
// `waterRows` in water.ts…), so a layer's report section lives beside the layer.
import { esc } from './html';
import type { CareTrip } from './metrics';

/** One tile: a coloured label, the value and a line of context (HTML; callers escape outside text). */
export const metric = (label: string, dot: string, v: string, sub: string) =>
  `<div class="metric"><div class="mk"><span class="dot" style="background:${dot}"></span>${label}</div><div class="mv">${v}</div><div class="ms">${sub}</div></div>`;
export const na = '<span style="color:var(--ink-3)">n/a</span>';
/** A button that opens a layer (the report listens for `[data-layer]` clicks). */
export const link = (layer: string, text: string) => `<button class="tr-fall" data-layer="${layer}" type="button">${text} ›</button>`;

/** A trip to a facility as a value ("In town", "12 min", "40 km") and its context line. */
export const tripV = (t: CareTrip) => (t.inferred ? 'In town' : t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);
export const tripSub = (t: CareTrip) => t.inferred ? `${esc(t.name)}: the place has its own police service (Statistics Canada), though no station is mapped in OpenStreetMap` : `${t.min != null ? 'drive' : 'straight line'} to ${esc(t.name)}${t.city ? `, ${esc(t.city)}` : ''} · ${Math.round(t.km)} km`;
