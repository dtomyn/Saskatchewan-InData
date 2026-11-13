# Learn the land's history

**Who:** newcomers, students and residents who want to know whose land a place is on and what shaped the province.

**The question:** Whose treaty land is this, where are the reserves, and what happened here?

## What answers it

- **◈ Treaties & reserves**: the six numbered treaty areas (1871–1906) and 826 reserve parcels.
- **Historic events** (`CURATED_EVENTS` in `src/layers.ts`, each with a source link): Treaty 4 (1874), Treaty 6 (1876), the Riel trial and execution in Regina (1885), Saskatchewan becomes a province (1905), the Regina Cyclone (1912), the Souris River floods (2011), the 2015 northern fires; plus data-driven events from the history layers.
- The **timeline** from 1871 to today; **Town Report** Region / treaty row.

## How

Turn on Treaties & reserves; drag the timeline back to 1871 and play; click an event marker for its panel.

## What it cannot tell you

- Treaty boundaries are Canada's depiction; First Nations' understanding of their territories and of the treaty promises can differ.
- Curated events are a short list of well-documented facts, not a history of the province.
- Reserves are separate census subdivisions, so a neighbouring town's Indigenous identity share does not include them.

## Check it

```js
atlas.clearMap(); atlas.focus('treaties'); atlas.setTime(1876.7)
```
