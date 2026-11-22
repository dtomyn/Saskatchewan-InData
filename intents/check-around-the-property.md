# Check around the property

**Who:** someone about to buy or rent a home, especially an acreage, who wants to know what they cannot see from the driveway.

**The question:** What industry is nearby, is the water safe to drink, how likely is radon, will a well find water here, and what is the land good for?

## What answers it

The Layer menu's **Around the property** group:

- **🛢 Hidden neighbours**: oil and gas wells and facilities (share still active), licensed pipelines (sour gas red), federal lines, NPRI reporting sites, producing mines. Neutral on purpose: also where the jobs are. Its **Power grid** chip adds the high-voltage lines, substations and generating stations mapped in OpenStreetMap.
- **🚰 Drinking water**: every advisory in effect (precautionary, boil water, do not consume), sized by how long it has lasted.
- **☢ Radon**: share of tested homes over 200 Bq/m³ by 2007 health region or postal area.
- **💧 Groundwater**: the drillers’ water well logs in ~4 km hexagons, coloured by the typical depth to water (chips: well depth, water use, glacial drift). **⬇ Below the surface** tilts the map and hangs each hexagon’s typical well under it, down to the water and on to the bottom of the hole, over the base of the glacial drift.
- **🟫 Soil**: the province's detailed soil survey; chips for soil zones, soils, farmland class (1–7), texture and salinity. Click a polygon (zoomed in) to **dig a pit**: the layers under that land, with texture, organic carbon, pH and salt, drainage, parent material, slope and erosion risk.
- **Town Report** Hidden neighbours (with the nearest mapped power line and substation), Drinking water, Radon, Groundwater and Soil rows (Dig a pit here); Finder: Fewer industrial neighbours, Lower radon, Shallower wells, Good farmland.

## How

Turn on the Around the property layers and zoom to the area; open the nearest Town Report.

## What it cannot tell you

- Wells include abandoned and suspended ones; flowlines are not drawn; some federally regulated lines are missing (no open CER map).
- The power grid is **partial**: OpenStreetMap only, since SaskPower publishes no open map; many lines carry no voltage and most distribution lines are missing. Power is not in the Finder.
- Water is a **snapshot** of the day the data was built; many dots are inferred from a named place or lake. **Private wells are not covered**: test bacteria twice a year.
- Radon varies **house by house**; only a long-term test tells. Health Canada advises testing every home.
- A well log is **what the driller recorded the day the well was drilled, not today’s level**; most are decades old and placed at their quarter section’s centre. No water quality or yield; a nearby typical well says what neighbours found, not what a new hole will. Below the surface is stretched hundreds of times: a picture, not a cross-section.
- Soil is a **1:100,000 survey** of mixed map units: a pit shows the largest soil's typical profile, not the field itself, and its **colours are inferred**. For a septic field or a crop plan, a percolation test or a lab soil test tells about the land itself.

## Check it

```js
atlas.clearMap(); atlas.focus('industry')   // the Power grid chip switches the grid on and off
atlas.clearMap(); atlas.focus('water')
atlas.clearMap(); atlas.focus('radon')
atlas.clearMap(); atlas.focus('groundwater')   // then the ⬇ Below the surface chip ([data-below]); [data-gw] chips switch the measure
atlas.openTown('swift current')                 // the Groundwater row: wells within 10 km, typical depth and depth to water
atlas.clearMap(); atlas.focus('soil'); atlas.map.flyTo({ center: [-106.6, 52.1], zoom: 9 })   // click a polygon to dig a pit
```
