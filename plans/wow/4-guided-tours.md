# 4. Guided fly-throughs

**Effort:** M. **Depends on:** nothing. **Status:** not started. `ROADMAP.md` lists this as "Per-layer films and an overview"; this plan does it inside the live app instead of as rendered video.

## Goal

A first-time visitor sees an empty map and a menu of thirty layers. Give them a **Take the tour** button: the app drives itself through a short story (camera, layers, timeline, captions) and hands back control at any moment.

## What a visitor sees

- On the opening screen, "Take the tour" beside the Layer button, and a list of four or five tours (about 60–90 seconds each):
  1. *A province in two minutes*: wildfires through the decades, the 2021 drought, what grows here, the night sky.
  2. *Choosing a town*: the Finder, a Town Report, Workday Reach.
  3. *When the land turns*: rivers in flood, tornadoes, hail, flood-prone land.
  4. *Who is here*: treaties and reserves, who lives here, newcomer services.
- While a tour runs: a caption bar at the bottom, a progress strip with one dot per step, Pause / Back / Next / Exit. Any drag, scroll or click on the map pauses it and offers "Explore from here".
- A tour link can be shared (`?tour=province`).

## Sources

None. Tours only drive what is already built, with today's data. The captions are the atlas's own words.

## App

1. `src/tours.ts`: a tour is a list of steps, each `{ caption, camera?, do?, wait? }`, where `do` calls the same functions the `?film` handle exposes (`focus`, `setTime`, `setPlaying`, `openTown`, `openFinder`, `setClosed`…). The storyboard in `video/storyboard.py` already tells these stories in this vocabulary; port the scenes, do not invent new ones.
2. A small runner: steps advance on a timer or when a condition holds (the fly-to ended, the timeline reached a year); pausing stops the timeline too.
3. Captions are typed in the code, so they are trusted text; anything a step reads from data (a town's name) still goes through `esc()`.
4. Reduced motion: camera moves become jumps and the timeline steps instead of playing.
5. A tour never loads live readings it does not need, and never leaves a scenario or a changed Finder weight behind when it exits: it restores the state it found.

## Honest labelling

- A caption states only what the layer on screen shows; it carries the same caveats (hotspots are not fires, a projection is a range).
- Nothing in a tour is pre-rendered: the visitor is looking at the real app, and can stop and check any claim.

## Done when

- Each tour runs to its end with no console error, on the production build (`living-skies-built`, so the CSP applies).
- Exiting mid-tour leaves the map usable and the previous state restored.
- `?tour=<id>` starts that tour; an unknown id opens the normal app.
- Each tour is the `?film` check of at least one intent, replacing a hand-written check.

## To confirm before building

- Whether tours replace the rendered explainer film or sit beside it. Recommended: keep the film for places that cannot run the app, and build its scenes from the same step lists later.
- Narration: captions only (recommended), or the film's recorded voice per step.
