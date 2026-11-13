# How safe is a place

**Who:** anyone weighing a move, a visit or a business in a Saskatchewan community; this is half of the atlas's one question.

**The question:** How much crime is there here, how violent is it, is it getting better or worse, and do crimes get solved?

## What answers it

- **◆ Crime severity** layer (timeline, 1998 → 2025): a column per place for its police service's Crime Severity Index, with chips for Violent CSI and weighted clearance rate; Saskatchewan's own index on the sparkline.
- **Town Report**: Crime Severity, Violent crime and Crimes solved rows.
- **Town Finder**: Low crime (3), Low violent crime (2), Crimes get solved (1); the Safety first preset.

## How

Open the Layer menu, turn on Crime severity, scrub or play the timeline, switch chips. Click a column for the Town Report.

## What it cannot tell you

- Crime is reported by **police service, not by town**. Small towns' municipal RCMP series stop in 2011; the atlas then uses the rural detachment of the same name, which also covers the area around it, including nearby First Nations. Series are never spliced.
- Northern detachments cover few people, so their index swings hard on a few incidents.
- A service hub's index partly reflects people who come in from outside.
- It is not a measure of personal risk on a given street.

## Check it

```js
atlas.clearMap(); atlas.focus('crime'); atlas.setTime(2024.5)
atlas.openTown('north battleford')
```
