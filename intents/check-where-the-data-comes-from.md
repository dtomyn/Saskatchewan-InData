# Check where the data comes from

**Who:** sceptical readers, journalists, researchers, and anyone about to act on a number.

**The question:** Where does this figure come from, how old is it, what licence is it under, and what was inferred?

## What answers it

- **Data & sources** view: an aspen round, a wedge per source and a ring per year, with links (`.src-go`) to each source.
- `public/data/manifest.json`: when each stage last ran and any error (a failing stage keeps its old JSON). The live stages keep `public/data/now/manifest.json`, merged in by the app.
- The **Right now** group in Data & sources: rivers, hotspots, air and alerts, each refreshed about hourly, with the time of its last refresh (and a failed last try, if any). Every live value on the map and in panels shows its own age.
- Every layer panel and Town Report row names its source; borrowed and inferred values say so.
- The README's Data sources and Caveats sections.

## How

Click the Data & sources button (or press S, or open `#sources`), or read the source line under any panel.

## What it cannot tell you

- Whether a source has changed since the last `npm run data` (for the live readings: since the last hourly refresh, which GitHub can run late or stop).
- The atlas is an exploration tool, **not legal, safety or real-estate advice**.

## Check it

```js
atlas.showSources()
```
