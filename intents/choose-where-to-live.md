# Choose where to live

**Who:** a household deciding between Saskatchewan's 62 cities, towns and northern villages, each with its own priorities.

**The question:** Where should we live? (the Town Finder's headline)

## What answers it

- **Town Finder**: every criterion as a 0–5 weight slider, a ranked list of the 62 places, and presets: Balanced, Safety first, Growing family, Quiet & small, New to Saskatchewan. Most newer criteria start at 0 so the default ranking stays the atlas's original brief (safety and access).
- **"I work in…"** at the top of the Finder switches on Short commute and adds "N min to work" to each place (see [Live near work](live-near-work.md)).
- Weights and the workplace are remembered in this browser (`localStorage`, try/catch).

## How

Open the Town Finder, pick a preset or drag sliders, then open a ranked place for its Town Report.

## What it cannot tell you

- A rank is only as good as the weights: it reflects what *you* set, not a verdict on a place.
- Several criteria tie many places (Jobs nearby is per economic region; nearly every town gets Fast internet).
- Every criterion carries its own caveat; see the README's Caveats and the other intents.
- There is deliberately no Drinking water criterion: an advisory is a point-in-time fact, not a lasting trait.

## Check it

```js
atlas.openFinder()
document.querySelector('[data-preset="family"]').click()
```
