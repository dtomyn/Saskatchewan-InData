// The tree-ring round of the Data & sources view (src/sources.ts): each source a wedge, each year a ring from the pith
// (1900) out to the bark (today), glowing as strongly as that source's own record for the year, and projections
// as a hatched halo past the bark. Canvas only; the view wires it to the source cards.
import * as d3 from 'd3';
import { esc } from './html';
import { BARK, FUT, NOW, Ring, Source, Y0, climateDiv } from './sources-catalog';

/** A spot on the round: a source's wedge in one year, a piece of the bark, or nothing. */
export type Hit = { i: number; y: number } | { b: number } | null;

/** Draws `SOURCES` (with their `rings`) on `canvas`, tooltips in `tip`; `onClick` hears what was clicked. */
export function createRound(canvas: HTMLCanvasElement, tip: HTMLElement, SOURCES: Source[], rings: Record<number, Ring>[], onClick: (h: Hit) => void) {
  const ctx = canvas.getContext('2d')!;

  // ---- geometry
  let S = 0, c = 0, rPith = 0, rBark = 0, barkW = 0, rHalo = 0, dpr = 1;
  const GAP = 0.022;
  const wedge = (i: number) => {
    const w = (Math.PI * 2) / SOURCES.length;
    const a = -Math.PI / 2 + i * w;
    return [a + GAP / 2, a + w - GAP / 2];
  };
  const R = (y: number) => y <= NOW + 1
    ? rPith + ((y - Y0) / (NOW + 1 - Y0)) * (rBark - rPith)
    : rBark + barkW + ((y - NOW - 1) / (FUT - NOW)) * (rHalo - rBark - barkW);
  const yearAtR = (r: number) => r <= rBark
    ? Math.floor(Y0 + ((r - rPith) / (rBark - rPith)) * (NOW + 1 - Y0))
    : Math.floor(NOW + 1 + ((r - rBark - barkW) / (rHalo - rBark - barkW)) * (FUT - NOW));

  // a seeded wobble so the wood grain is the same on every redraw
  const rand = d3.randomLcg(42);
  const grain = d3.range(Y0, NOW + 1).map(() => rand());
  const barkNoise = d3.range(240).map(() => rand());

  const wood = document.createElement('canvas'), glow = document.createElement('canvas');
  let hatch: Record<string, CanvasPattern> = {};

  function resize() {
    const box = canvas.parentElement!.getBoundingClientRect();
    // closing (or a hidden parent) reports an empty box; keep the last size rather than draw with negative radii
    if (Math.min(box.width, box.height || box.width) < 80) return;
    S = Math.floor(Math.min(box.width, box.height || box.width));
    dpr = Math.min(2, devicePixelRatio || 1);
    for (const k of [canvas, wood, glow]) { k.width = S * dpr; k.height = S * dpr; }
    canvas.style.width = canvas.style.height = `${S}px`;
    c = S / 2;
    labelsOn = S > 520;
    const labels = labelsOn ? 34 : 8;
    rHalo = c - labels;
    rBark = rHalo * 0.8;
    barkW = Math.max(6, rHalo * 0.035);
    rPith = rHalo * 0.045;
    hatch = {};
    paintWood();
    scene = null;
  }

  function pattern(color: string) {
    if (hatch[color]) return hatch[color];
    const p = document.createElement('canvas');
    p.width = p.height = 8 * dpr;
    const g = p.getContext('2d')!;
    g.strokeStyle = color; g.lineWidth = 2.2 * dpr;
    g.beginPath(); g.moveTo(0, 8 * dpr); g.lineTo(8 * dpr, 0); g.moveTo(-4 * dpr, 4 * dpr); g.lineTo(4 * dpr, -4 * dpr); g.moveTo(4 * dpr, 12 * dpr); g.lineTo(12 * dpr, 4 * dpr); g.stroke();
    return (hatch[color] = ctx.createPattern(p, 'repeat')!);
  }

  function paintWood() {
    const g = wood.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    // heartwood to sapwood
    const fill = g.createRadialGradient(c, c, 0, c, c, rBark);
    fill.addColorStop(0, '#3a2414'); fill.addColorStop(0.55, '#2a190e'); fill.addColorStop(0.92, '#20140c'); fill.addColorStop(1, '#2c1d12');
    g.fillStyle = fill;
    g.beginPath(); g.arc(c, c, rBark, 0, Math.PI * 2); g.fill();
    // one ring per year: a dark latewood line, stronger each decade
    for (let y = Y0 + 1; y <= NOW; y++) {
      const r = R(y), k = grain[y - Y0];
      g.strokeStyle = y % 10 === 0 ? 'rgba(255, 214, 170, 0.13)' : `rgba(8, 4, 2, ${0.25 + k * 0.35})`;
      g.lineWidth = y % 10 === 0 ? 1 : 0.5 + k * 0.8;
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    }
    // bark, with a rough outer edge
    g.beginPath();
    for (let i = 0; i <= barkNoise.length; i++) {
      const a = (i / barkNoise.length) * Math.PI * 2, r = rBark + barkW * (0.75 + barkNoise[i % barkNoise.length] * 0.5);
      i ? g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r) : g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.arc(c, c, rBark, 0, Math.PI * 2, true);
    g.fillStyle = '#4a3020'; g.fill('evenodd');
    // drying checks between the wedges
    g.strokeStyle = 'rgba(6, 9, 16, 0.95)'; g.lineWidth = 2;
    for (let i = 0; i < SOURCES.length; i++) {
      const a = wedge(i)[0] - GAP / 2;
      g.beginPath(); g.moveTo(c + Math.cos(a) * rPith * 1.6, c + Math.sin(a) * rPith * 1.6); g.lineTo(c + Math.cos(a) * (rBark + barkW), c + Math.sin(a) * (rBark + barkW)); g.stroke();
    }
    // the future, not grown yet
    g.setLineDash([2, 5]); g.strokeStyle = 'rgba(180, 191, 210, 0.22)'; g.lineWidth = 1;
    for (const y of [2050, FUT]) { g.beginPath(); g.arc(c, c, R(y), 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]);
  }

  // ---- scene: wood + glowing rings up to `upTo`, halo faded by `halo`
  let scene: HTMLCanvasElement | null = null;
  function paintScene(upTo: number, halo: number) {
    const g = glow.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    SOURCES.forEach((s, i) => {
      const [a0, a1] = wedge(i);
      for (const [ys, ring] of Object.entries(rings[i])) {
        const y = +ys;
        if (ring.proj ? halo <= 0 : y > upTo) continue;
        const r0 = R(y), r1 = y === NOW ? rBark + barkW : R(y + 1) - (y > NOW ? 0.6 : 0.25);
        g.beginPath(); g.arc(c, c, r1, a0, a1); g.arc(c, c, Math.max(rPith, r0), a1, a0, true); g.closePath();
        if (ring.proj) {
          g.globalAlpha = halo * (0.35 + 0.65 * ring.v);
          g.fillStyle = pattern(s.color);
        } else {
          const climate = s.id === 'climate';
          g.globalAlpha = climate ? 0.95 : 0.12 + 0.88 * ring.v;
          g.fillStyle = climate ? climateDiv(ring.v) : s.color;
        }
        g.fill();
      }
    });
    g.globalAlpha = 1;
    const out = document.createElement('canvas');
    out.width = out.height = S * dpr;
    const o = out.getContext('2d')!;
    o.drawImage(wood, 0, 0);
    o.globalCompositeOperation = 'lighter';
    o.filter = `blur(${7 * dpr}px)`; o.globalAlpha = 0.75; o.drawImage(glow, 0, 0);
    o.filter = 'none'; o.globalAlpha = 0.9; o.drawImage(glow, 0, 0);
    return out;
  }

  // ---- interaction state
  let hover: Hit = null;
  let pinned: number | null = null;
  let labelsOn = true;

  function draw() {
    if (!scene) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scene, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const active = hover && 'i' in hover ? hover.i : pinned;
    // dim every wedge but the active one
    if (active != null) {
      ctx.fillStyle = 'rgba(4, 7, 13, 0.62)';
      SOURCES.forEach((_, i) => {
        if (i === active) return;
        const [a0, a1] = wedge(i);
        ctx.beginPath(); ctx.arc(c, c, rHalo, a0 - GAP / 2, a1 + GAP / 2); ctx.arc(c, c, rPith * 0.9, a1 + GAP / 2, a0 - GAP / 2, true); ctx.closePath(); ctx.fill();
      });
    }
    // the hovered year, across every source
    if (hover && 'y' in hover) {
      const r = (R(hover.y) + R(hover.y + 1)) / 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
    }
    if (hover && 'b' in hover) {
      const w = (Math.PI * 2) / BARK.length, a0 = -Math.PI / 2 + hover.b * w;
      ctx.strokeStyle = '#ffd9a8'; ctx.lineWidth = barkW + 4;
      ctx.beginPath(); ctx.arc(c, c, rBark + barkW / 2, a0, a0 + w); ctx.stroke();
    }
    // year ticks up the top check
    ctx.font = '500 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const y of [1925, 1950, 1975, 2000, NOW, 2050, FUT]) {
      const r = y === NOW ? rBark + barkW / 2 : R(y), t = y === NOW ? 'today' : String(y);
      ctx.fillStyle = 'rgba(6, 10, 18, 0.8)';
      ctx.fillRect(c + 5, c - r - 7, ctx.measureText(t).width + 8, 14);
      ctx.fillStyle = y > NOW ? '#b4bfd2' : '#e9eef7';
      ctx.fillText(t, c + 9, c - r);
    }
    // source names around the rim
    if (labelsOn) {
      ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      SOURCES.forEach((s, i) => {
        const [a0, a1] = wedge(i), a = (a0 + a1) / 2;
        const flip = Math.sin(a) > 0.05;
        ctx.save();
        ctx.translate(c + Math.cos(a) * (rHalo + 16), c + Math.sin(a) * (rHalo + 16));
        ctx.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
        ctx.fillStyle = active == null || active === i ? s.color : 'rgba(180, 191, 210, 0.35)';
        ctx.fillText(s.name, 0, 0);
        ctx.restore();
      });
    }
  }

  function pick(ev: PointerEvent): Hit {
    const b = canvas.getBoundingClientRect();
    const x = ev.clientX - b.left - c, y = ev.clientY - b.top - c;
    const r = Math.hypot(x, y);
    let a = Math.atan2(y, x) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    if (r >= rBark && r <= rBark + barkW + 2) return { b: Math.floor(a / ((Math.PI * 2) / BARK.length)) };
    if (r < rPith || r > rHalo) return null;
    return { i: Math.min(SOURCES.length - 1, Math.floor(a / ((Math.PI * 2) / SOURCES.length))), y: yearAtR(r) };
  }

  function showTip(ev: PointerEvent) {
    if (!hover) { tip.hidden = true; return; }
    let html: string;
    if ('b' in hover) {
      const b = BARK[hover.b];
      html = `<b>${b.name}</b> · the bark<br>${esc(b.owner)}`;
    } else {
      const s = SOURCES[hover.i], ring = rings[hover.i][hover.y];
      html = `<b style="color:${s.color}">${s.name}</b> · ${hover.y}<br>${ring ? esc(ring.label) : '<span class="dim">no record this year</span>'}`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const b = canvas.parentElement!.getBoundingClientRect();
    const x = ev.clientX - b.left, y = ev.clientY - b.top;
    tip.style.transform = `translate(${Math.min(x + 14, b.width - tip.offsetWidth - 4)}px, ${y + 16}px)`;
  }

  canvas.addEventListener('pointermove', (ev) => {
    hover = pick(ev);
    canvas.style.cursor = hover ? 'pointer' : 'default';
    showTip(ev);
    draw();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; draw(); });
  canvas.addEventListener('click', (ev) => {
    const h = pick(ev as PointerEvent);
    pinned = h && 'i' in h ? h.i : null;
    onClick(h);
    draw();
  });

  return {
    resize,
    /** Paints the rings up to `upTo` and the projection halo at `halo` (0–1), then draws. */
    paint(upTo: number, halo: number) { scene = paintScene(upTo, halo); draw(); },
    /** Brings one source's wedge forward (a card hovered or focused). */
    pin(i: number) { pinned = i; draw(); },
    /** Lights a piece of the bark (a bark card hovered). */
    hoverBark(b: number) { hover = { b }; draw(); },
    /** The pointer left the card list: drop a bark highlight. */
    leaveList() { if (hover && 'b' in hover) hover = null; draw(); },
  };
}
