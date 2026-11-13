// Injected into every frame by video/render.py. Playwright's fake clock drives timers, rAF and
// performance.now(), but CSS transitions and Web Animations run on the browser's own clock. This pins
// each one to the fake clock instead, so a 300 ms fade lasts 300 ms of film however slow the capture.
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
