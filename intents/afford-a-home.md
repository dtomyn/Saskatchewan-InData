# Afford a home

**Who:** buyers and renters comparing what a place costs.

**The question:** What will a home cost here to buy, to rent, and in property tax, and how stretched are the people who already live here?

## What answers it

- **⌂ Home costs** layer (CMHC timeline 2000 → 2025 + Census 2021): chips for home value, rent paid, stretched 30 %+, market rent coloured by vacancy, and property tax.
- **Town Report** Home costs rows: home value, rent paid, owner costs, stretched, market rent and vacancy (CMHC centres) with a 2-bedroom rent chart; property tax with the mill rate and year.
- **⚒ Jobs & income** for household income alongside.
- **Town Finder**: Affordable to buy, Affordable to rent, Lower property tax, Higher income (all 0 by default).

## How

Turn on Home costs and switch chips; open a Town Report for the full Home costs block.

## What it cannot tell you

- Census values are 2021, owners' own estimates; shelter costs include utilities.
- CMHC covers purpose-built rentals of 3+ units in 9 centres, for whole metro areas, shown only on the place each is named after.
- **Property tax is indicative, never a bill**: median value × 80 % × (uniform mill rate × residential factor + education rate) ÷ 1000, from the latest Mill Rate Survey. Base tax, minimum tax, library and special levies are not added, so many real bills are higher. Lloydminster gets a rate but no estimate.
- No listings or current prices.

## Check it

```js
atlas.clearMap(); atlas.focus('housing')
atlas.openTown('regina')
```
