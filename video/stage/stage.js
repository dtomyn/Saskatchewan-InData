// The film stage. video/render.py loads this page, steps a virtual clock one frame at a time and calls
// Stage.* to move the camera and cursor and to show titles. Everything animates from performance.now(),
// which the renderer controls, so a render is the same every time.
(() => {
  const W = 1600, H = 900, BAR = 34, SW = 1920, SH = 1080;
  const REST = { cx: W / 2, cy: (H + BAR) / 2, z: 1.02 };
  const FILL = { cx: W / 2, cy: BAR + H / 2, z: SW / W };
  const $ = (id) => document.getElementById(id);
  const now = () => performance.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const EASE = {
    linear: (t) => t,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    out: (t) => 1 - (1 - t) ** 3,
    glide: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  };

  const app = $('app'), win = $('win'), cursorEl = $('cursor'), hud = $('hud');
  app.src = new URLSearchParams(location.search).get('app') || '/?film';
  const appWin = () => app.contentWindow;
  const appDoc = () => app.contentDocument;

  // ---- tweens -------------------------------------------------------------------------------------
  const tween = (from, to, ms, ease = 'inOut', extra = {}) => ({ from, to, t0: now(), ms: Math.max(1, ms), ease: EASE[ease], ...extra });
  const progress = (tw) => tw.ease(clamp((now() - tw.t0) / tw.ms, 0, 1));

  // ---- camera -------------------------------------------------------------------------------------
  let cam = tween(FILL, FILL, 1);
  function camNow() {
    const t = progress(cam), a = cam.from, b = cam.to;
    return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)) };
  }
  /** Keeps a zoomed-in view inside the window so no background shows past its edges. */
  function contain(v) {
    if (v.z < FILL.z - 1e-3) return v;
    const hw = SW / 2 / v.z, hh = SH / 2 / v.z;
    return { z: v.z, cx: clamp(v.cx, hw, W - hw), cy: clamp(v.cy, BAR + hh, BAR + H - hh) };
  }
  /** rect in app pixels -> a view that frames it, at most `max` zoom. */
  function frameRect(r, max = 2.4, pad = 1.18) {
    const z = clamp(Math.min(SW / (r.w * pad), SH / (r.h * pad)), FILL.z, max);
    return contain({ cx: r.x + r.w / 2, cy: BAR + r.y + r.h / 2, z });
  }
  function toStage(x, y, v = camNow()) {
    return { x: SW / 2 + (x - v.cx) * v.z, y: SH / 2 + (BAR + y - v.cy) * v.z };
  }

  // ---- cursor -------------------------------------------------------------------------------------
  let cur = { x: W * 0.62, y: H * 0.58 };
  let curTw = null;
  let curShown = 0, curShowTw = null, pressT = -1e9;
  function cursorNow() {
    if (!curTw) return cur;
    const t = progress(curTw), a = curTw.from, b = curTw.to, c = curTw.ctrl;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  }

  // ---- background ---------------------------------------------------------------------------------
  (function contours() {
    const svg = $('contours');
    let d = '';
    const rings = [[420, 760, 8], [1500, 300, 7], [1650, 900, 5]];
    for (const [cx, cy, n] of rings)
      for (let k = 1; k <= n; k++) {
        const r0 = k * 58;
        let p = '';
        for (let i = 0; i <= 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const r = r0 * (1 + 0.14 * Math.sin(a * 3 + k) + 0.07 * Math.sin(a * 5 - k * 0.7));
          p += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r * 1.25).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
        }
        d += `<path d="${p}Z"/>`;
      }
    svg.innerHTML = d;
  })();
  const blobs = [...document.querySelectorAll('.blob')];

  // ---- counters (stat cards count up) -------------------------------------------------------------
  const counters = [];

  // ---- frame loop ---------------------------------------------------------------------------------
  function tick() {
    const t = now();
    const v = camNow();
    win.style.transform = `translate(${SW / 2 - v.cx * v.z}px, ${SH / 2 - v.cy * v.z}px) scale(${v.z})`;
    win.style.borderRadius = `${clamp((FILL.z - v.z) * 400, 0, 16)}px`;

    const p = cursorNow();
    if (curShowTw) curShown = lerp(curShowTw.from, curShowTw.to, progress(curShowTw));
    const press = clamp((t - pressT) / 260, 0, 1);
    const dip = press < 1 ? 1 - 0.2 * Math.sin(press * Math.PI) : 1;
    const s = (1.15 / Math.sqrt(v.z)) * dip;
    cursorEl.style.transform = `translate(${p.x - 5}px, ${BAR + p.y - 3}px) scale(${s})`;
    cursorEl.style.opacity = curShown;
    cursorEl.classList.toggle('pointer', isPointer(p));

    blobs.forEach((b, i) => {
      const k = t / 1000;
      b.style.transform = `translate(${Math.sin(k * 0.11 + i * 2) * 140}px, ${Math.cos(k * 0.09 + i) * 90}px)`;
    });
    $('contours').style.transform = `translate(${Math.sin(t / 9000) * 30}px, ${Math.cos(t / 11000) * 20}px)`;

    for (const c of counters) {
      const k = progress(c.tw);
      c.el.textContent = c.format(lerp(c.tw.from, c.tw.to, k));
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function isPointer(p) {
    try {
      const el = appDoc()?.elementFromPoint(p.x, p.y);
      return !!el && appWin().getComputedStyle(el).cursor === 'pointer';
    } catch { return false; }
  }

  // ---- HUD helpers --------------------------------------------------------------------------------
  const add = (parent, html, cls) => {
    const el = document.createElement('div');
    if (cls) el.className = cls;
    el.innerHTML = html;
    parent.appendChild(el);
    return el;
  };
  const outAndRemove = (el, frames, ms = 500) => {
    if (!el) return;
    const a = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
    a.onfinish = () => el.remove();
  };
  const IN = 'cubic-bezier(.16,1,.3,1)';
  let titleEl = null, chapterEl = null, chipEl = null, statsEl = null, endEl = null;

  /** Words rise out of a blur one after another; words in `hl` get the warm gradient. */
  function words(text, hl = []) {
    return text.split(' ').map((w) => `<span class="w${hl.some((h) => w.includes(h)) ? ' hl' : ''}">${w} </span>`).join('');
  }
  function revealWords(el, start = 0, gap = 90) {
    el.querySelectorAll('.w').forEach((w, i) =>
      w.animate([{ opacity: 0, transform: 'translateY(42px) scale(.96)', filter: 'blur(14px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
        { duration: 1000, delay: start + i * gap, easing: IN, fill: 'both' }));
  }

  // ---- public API ---------------------------------------------------------------------------------
  window.Stage = {
    W, H, BAR,
    ready: () => !!(appWin()?.atlas && appWin().atlas.map.loaded()),
    tilesLoaded: () => { try { return appWin().atlas.map.areTilesLoaded(); } catch { return true; } },
    url: (text) => { $('url-text').textContent = text; },

    // camera: 'rest' (floating window), 'fill' (app fills the frame) or a rect {x,y,w,h} in app pixels
    camera(target, ms = 1200, opts = {}) {
      const to = target === 'rest' ? REST : target === 'fill' ? FILL : target.cx != null ? contain(target) : frameRect(this.rect(target), opts.max, opts.pad);
      cam = tween(camNow(), to, ms, opts.ease || 'inOut');
    },
    view: camNow,

    cursorShow(on, ms = 350) { curShowTw = tween(curShown, on ? 1 : 0, ms, 'out'); },
    cursorAt(x, y) { cur = { x, y }; curTw = null; },
    /** Glides along a gentle arc; returns the duration used (scaled by distance unless given). */
    cursorTo(x, y, ms) {
      const from = cursorNow();
      const dist = Math.hypot(x - from.x, y - from.y);
      const dur = ms ?? clamp(380 + dist * 0.9, 450, 1300);
      const nx = -(y - from.y) / (dist || 1), ny = (x - from.x) / (dist || 1);
      const bend = dist * 0.12;
      curTw = tween(from, { x, y }, dur, 'glide', { ctrl: { x: (from.x + x) / 2 + nx * bend, y: (from.y + y) / 2 + ny * bend } });
      cur = { x, y };
      return dur;
    },
    cursor: cursorNow,
    /** The cursor's position in stage pixels, for the real mouse. */
    mouse() { const p = cursorNow(); return toStage(p.x, p.y); },
    press() {
      pressT = now();
      const p = cursorNow();
      const r = add($('marks'), '', 'ripple');
      r.style.left = `${p.x}px`;
      r.style.top = `${p.y}px`;
      r.animate([{ transform: 'scale(.25)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).onfinish = () => r.remove();
    },

    /** A point in app pixels: {sel, text, at:[fx,fy]} for an element, {lnglat:[lon,lat]} for the map, or {x,y}. */
    point(t) {
      if (t.lnglat) { const p = appWin().atlas.map.project(t.lnglat); return { x: p.x + (t.dx || 0), y: p.y + (t.dy || 0) }; }
      if (t.sel) {
        const r = this.rect(t);
        const [fx, fy] = t.at || [0.5, 0.5];
        return { x: r.x + r.w * fx + (t.dx || 0), y: r.y + r.h * fy + (t.dy || 0) };
      }
      return { x: t.x, y: t.y };
    },
    rect(t) {
      if (t.w != null) return t;
      const els = [...appDoc().querySelectorAll(t.sel)].filter((e) => !t.text || e.textContent.includes(t.text));
      const el = els[t.nth || 0];
      if (!el) throw new Error(`no element ${t.sel} ${t.text || ''}`);
      const b = el.getBoundingClientRect();
      const g = t.grow || 0;
      return { x: b.left - g, y: b.top - g, w: b.width + 2 * g, h: b.height + 2 * g };
    },

    spot(t, ms = 500) {
      const hole = $('spot').querySelector('.hole') || add($('spot'), '', 'hole');
      if (!t) { hole.animate([{ opacity: 0 }], { duration: ms, fill: 'forwards' }); return; }
      const r = this.rect(t), pad = t.pad ?? 10;
      Object.assign(hole.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.w + 2 * pad}px`, height: `${r.h + 2 * pad}px` });
      hole.animate([{ opacity: 1 }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
    },
    pin(t, text, sub) {
      const p = this.point(t);
      const el = add($('marks'), `${text}${sub ? `<small>${sub}</small>` : ''}`, 'pin');
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.animate([{ opacity: 0, transform: 'translate(-50%, calc(-100% - 4px)) scale(.8)' }, { opacity: 1, transform: 'translate(-50%, calc(-100% - 18px))' }], { duration: 600, easing: IN, fill: 'both' });
    },
    clearPins() { $('marks').querySelectorAll('.pin').forEach((el) => outAndRemove(el, [{ opacity: 0 }], 300)); },

    /** Dims the window and background (titles stay on top). */
    fade(to, ms = 800) { $('fade').animate([{ opacity: to }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' }); },
    /** Everything, titles included, to black. */
    blackout(ms = 1500) { document.body.animate([{ opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' }); },

    title(l1, l2, hl = []) {
      this.hideTitle(0);
      titleEl = add(hud, `<div class="l1">${words(l1, hl)}</div>${l2 ? `<div class="l2">${words(l2)}</div>` : ''}`, 'title');
      revealWords(titleEl.querySelector('.l1'));
      if (l2) revealWords(titleEl.querySelector('.l2'), 300 + l1.split(' ').length * 90, 40);
    },
    hideTitle(ms = 600) {
      const el = titleEl; titleEl = null;
      if (el) outAndRemove(el, [{ opacity: 0, filter: 'blur(12px)', transform: 'translateY(calc(-50% - 30px))' }], ms);
    },

    chapter(n, t, s, c = '#ffb35c') {
      this.hideChapter(200);
      chapterEl = add(hud, `<div class="n">${String(n).padStart(2, '0')}</div><div><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`, 'chapter');
      chapterEl.style.setProperty('--c', c);
      chapterEl.animate([{ opacity: 0, transform: 'translateX(-60px)', clipPath: 'inset(0 100% 0 0 round 16px)' }, { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0 round 16px)' }], { duration: 900, easing: IN, fill: 'both' });
      // it sits over the app's logo, so it leaves on its own
      chapterEl.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(-40px)' }], { duration: 600, delay: 4200, easing: 'ease-in', fill: 'forwards' });
    },
    hideChapter(ms = 500) { const el = chapterEl; chapterEl = null; outAndRemove(el, [{ opacity: 0, transform: 'translateX(-40px)' }], ms); },

    chip(ic, h, b, c = '#ffb35c', side = 'left') {
      this.hideChip(250);
      chipEl = add(hud, `<div class="ic">${ic}</div><div><div class="h">${h}</div>${b ? `<div class="b">${b}</div>` : ''}</div>`, `chip ${side}`);
      chipEl.style.setProperty('--c', c);
      chipEl.animate([{ opacity: 0, transform: 'translateY(50px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 850, easing: IN, fill: 'both' });
    },
    hideChip(ms = 450) { const el = chipEl; chipEl = null; outAndRemove(el, [{ opacity: 0, transform: 'translateY(30px)' }], ms); },

    /** stats: [{v, k, c, from?, suffix?, digits?, plain?}] - each value counts up from `from`. */
    stats(items) {
      this.hideStats(0);
      statsEl = add(hud, items.map((s) => `<div class="stat" style="--c:${s.c}"><div class="v"></div><div class="k">${s.k}</div></div>`).join(''), 'stats');
      statsEl.querySelectorAll('.stat').forEach((el, i) => {
        const s = items[i];
        el.animate([{ opacity: 0, transform: 'translateY(60px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: i * 160, easing: IN, fill: 'both' });
        const fmt = (v) => `${s.prefix || ''}${s.plain ? Math.round(v) : Math.round(v).toLocaleString('en-CA')}${s.suffix || ''}`;
        const tw = tween(s.from ?? 0, s.v, 1700, 'out');
        tw.t0 += i * 160;
        counters.push({ el: el.querySelector('.v'), tw, format: fmt });
      });
    },
    hideStats(ms = 500) {
      const el = statsEl; statsEl = null;
      if (!el) return;
      counters.length = 0;
      outAndRemove(el, [{ opacity: 0, transform: 'translateY(40px)' }], ms);
    },

    end(tagline, url, fine) {
      endEl = add(hud, `<div class="mark"></div><h1>${words('Living Skies Atlas')}</h1><p>${words(tagline)}</p>${url ? `<div><span class="url">${url}</span></div>` : ''}<div class="fine">${fine}</div>`, 'end');
      endEl.querySelector('.mark').animate([{ opacity: 0, transform: 'scale(.4) rotate(-120deg)' }, { opacity: 1, transform: 'none' }], { duration: 1400, easing: IN, fill: 'both' });
      endEl.querySelector('.mark').animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 18000, iterations: Infinity });
      revealWords(endEl.querySelector('h1'), 300, 120);
      revealWords(endEl.querySelector('p'), 800, 50);
      endEl.querySelectorAll('.url, .fine').forEach((el, i) =>
        el.animate([{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 1500 + i * 300, easing: IN, fill: 'both' }));
    },
  };
})();
