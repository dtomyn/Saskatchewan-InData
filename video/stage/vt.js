// Injected into every frame by video/render.py. Playwright's fake clock drives timers, rAF and
// performance.now(), but CSS transitions and Web Animations run on the browser's own clock. This pins
// each one to the fake clock instead, so a 300 ms fade lasts 300 ms of film however slow the capture.
// A scripted animation (el.animate) is paused and stamped the moment it is made, so a frame that waits in real time
// for map tiles can't let it run (or finish) on the browser's clock before the next sync sees it. CSS animations
// and transitions have no such hook; they are caught at the next sync.
const animate = Element.prototype.animate;
Element.prototype.animate = function (...args) {
  const a = animate.apply(this, args);
  a.__filmStart = performance.now();
  a.pause();
  return a;
};
window.__filmSync = () => {
  const t = performance.now();
  for (const a of document.getAnimations()) {
    if (a.playState === 'finished') continue;
    if (a.__filmStart == null) { a.__filmStart = t; a.pause(); }
    const at = t - a.__filmStart;
    const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
    if (Number.isFinite(end) && at >= end) a.finish();
    else a.currentTime = at;
  }
};
