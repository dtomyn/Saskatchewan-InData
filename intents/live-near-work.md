# Live near work

**Who:** someone with a job (or job offer) in one place who could live in another; someone looking for where the work is.

**The question:** Where can I live and still get to work in my limit, and where are the jobs?

## What answers it

- **🚗 Workday Reach**: pick a workplace and a limit (15/30/45/60 min); a wave rolls out and an arc reaches every place whose drive fits, labelled "N min · #rank in Finder" under your saved weights, with the best Finder match within reach.
- **"I work in…"** in the Town Finder: one setting shared with Workday Reach (`getWork`/`setWork` in `metrics.ts`); switches on Short commute.
- **Town Report** Commute row and the "🚗 Work in <place>?" button.
- **⚒ Jobs & income**: economic regions tinted by unemployment or employment rate; median household income per place; top industries in the report.
- **🛢 Hidden neighbours** also shows where resource jobs are.

## How

Open Workday Reach, or set "I work in…" in the Finder; or click "Work in <place>?" in a Town Report.

## What it cannot tell you

- Drives are OSRM free-flow, centre to centre: no rush hour, winter roads or construction, so real commutes run longer.
- Only the 62 places, not acreages and hamlets between them.
- Labour Force Survey rates are for whole economic regions, so places in a region tie; Prince Albert and Northern share one series; reserves are left out.
- Census income is 2020 (pandemic benefits); in-town unemployment is census week, May 2021.

## Check it

```js
atlas.clearMap(); atlas.focus('commute')
atlas.clearMap(); atlas.focus('jobs')
```
