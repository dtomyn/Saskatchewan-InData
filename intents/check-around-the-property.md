# Check around the property

**Who:** someone about to buy or rent a home, especially an acreage, who wants to know what they cannot see from the driveway.

**The question:** What industry is nearby, is the water safe to drink, and how likely is radon?

## What answers it

The Layer menu's **Around the property** group:

- **🛢 Hidden neighbours**: oil and gas wells and facilities (share still active), licensed pipelines (sour gas red), federal lines, NPRI reporting sites, producing mines. Neutral on purpose: also where the jobs are. Its **Power grid** chip adds the high-voltage lines, substations and generating stations mapped in OpenStreetMap.
- **🚰 Drinking water**: every advisory in effect (precautionary, boil water, do not consume), sized by how long it has lasted.
- **☢ Radon**: share of tested homes over 200 Bq/m³ by 2007 health region or postal area.
- **Town Report** Hidden neighbours (with the nearest mapped power line and substation), Drinking water and Radon rows; Finder: Fewer industrial neighbours, Lower radon.

## How

Turn on the Around the property layers and zoom to the area; open the nearest Town Report.

## What it cannot tell you

- Wells include abandoned and suspended ones; flowlines are not drawn; some federally regulated lines are missing (no open CER map).
- The power grid is **partial**: OpenStreetMap only, since SaskPower publishes no open map; many lines carry no voltage and most distribution lines are missing. Power is not in the Finder.
- Water is a **snapshot** of the day the data was built; many dots are inferred from a named place or lake. **Private wells are not covered**: test bacteria twice a year.
- Radon varies **house by house**; only a long-term test tells. Health Canada advises testing every home.

## Check it

```js
atlas.clearMap(); atlas.focus('industry')   // the Power grid chip switches the grid on and off
atlas.clearMap(); atlas.focus('water')
atlas.clearMap(); atlas.focus('radon')
```
