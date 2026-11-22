# Settle in as a newcomer

**Who:** people new to Saskatchewan (from abroad or another province), often renting first, often without a car, looking for work and for people like them. The focus of the roadmap's recent build order.

**The question:** Where will I find settlement help, English classes, community, and a way to get around?

## What answers it

- **🧭 Newcomer services** layer: the drive to the nearest Settlement help, English classes, Service Canada office and SGI issuer.
- **🤝 Who lives here**: immigrants, recent arrivals, top birthplaces, home languages, French, Indigenous identity; places of worship by religion. Framed as finding community, not ranking people.
- **🗳 Voting**: how the neighbours voted in the federal elections since 2015, poll by poll, as dots (one per few votes), the winner by poll, turnout and the advance vote; each riding's winners back to 1908. Plain counts, standard party colours, never ranked.
- **✈ Getting around**: airports with scheduled flights, VIA, intercity and city buses; the "Can live without a car" count.
- **🧸 Childcare**, **🛒 Daily needs**, **⚒ Jobs & income**, **⌂ Home costs** (rent).
- **Town Finder** preset **New to Saskatchewan**: Affordable to rent 3, Jobs nearby 3, Short commute 3 (once a workplace is set), Diverse community 2, Daily needs in town 2, Close to a hospital 2, Clinic nearby 2, Newcomer services nearby 2, Low crime 2, Fast internet 1.
- The Layer menu's **Settling in** group.

## How

Town Finder → New to Saskatchewan; or turn on Settling in layers and open a Town Report's Newcomer help and Community rows.

## What it cannot tell you

- IRCC-funded services are for permanent residents and some temporary residents.
- The province's settlement list is typed from saskatchewan.ca (`SK_SETTLEMENT`, date in `SK_SETTLEMENT_ASOF`) and must be re-checked by hand.
- Service Canada and SGI issuers are OpenStreetMap only; insurance brokers stand in for SGI issuers (**inferred**).
- Health cards are online, by mail, or in Regina only, so they are not mapped.
- Intercity bus coverage is partial; nothing here says how often a bus runs.
- Voting is federal only (Elections Saskatchewan's provincial results state no licence); a vote dot is placed at random inside its poll, not at anyone's home, and polls are redrawn every election, so they are never compared across elections.

## Check it

```js
// one line at a time: a panel fills a moment after it opens, and a tour replaces one still running
atlas.tour('people')   // the guided tour: ends on Newcomer services
document.querySelector('#tour-bar [data-t="exit"]')?.click()   // the tour must be over (or exited) before the next lines, or a later step replaces what they open
atlas.openFinder()
await new Promise((r) => setTimeout(r, 300)); document.querySelector('[data-preset="newcomer"]').click()
atlas.clearMap(); atlas.focus('voting')   // opens on 2025: dots load a moment later
document.querySelector('[data-vm="win"]').click(); atlas.setTime(1958.5)   // the panel's ridings in 1958; the map is empty before 2015
```
