# Know the climate and the light

**Who:** people moving from a milder or more southern place who want to know what winter, summer and the dark will be like.

**The question:** How cold, warm, sunny and snowy is it here, how short are winter days, and can I see the northern lights?

## What answers it

- **🌡 Climate** (1886 → 2020, then projected to 2100): station colour and warming stripes; past the record the timeline is hatched and shows ECCC's CMIP6 projections at each place as a range from low to high emissions, with a chart band and a table of mean temperature, daily highs and lows and precipitation for 2021–2050, 2041–2070 and 2071–2100.
- **☀ Climate normals** (1981–2010): columns with chips.
- **☾ Light & dark** (computed): day length by latitude (Dec 21, Mar 20, Jun 21), aurora bands, dark-sky preserves; a day-length chart at 49°, 54° and 60° N.
- **☾ Light & dark → Sky now** (live): NOAA's aurora forecast for the coming hour as a green glow (zoom out to see the oval over the territories), the planetary Kp, night's shade and the sunrise and sunset lines; an outlook line for the coming night from NOAA's Kp forecast. The Town Report's Right now group and a small community's report have "Aurora overhead" for the place, with a Sky now link.
- **Town Report** Climate, normals and Light & dark rows, and one projection row ("By the 2050s: +x to +y °C"); Finder: Milder, Sunnier, Less snow & frost, Longer winter days.

## How

Turn on Climate or Light & dark and switch chips; open a Town Report.

## What it cannot tell you

- Some places **borrow** a climate station; the report names it.
- Projections are **model output, not a record**: always a range (two emissions scenarios, each with the models' 10th–90th percentile), hatched and badged, and never a Finder criterion. They are 30-year averages, not a forecast of any year.
- Light & dark is **computed, not measured**: day length ignores hills and horizon; aurora bands are NOAA's Kp rule of thumb, not a probability, and clouds, the moon and city lights decide what a night shows.
- Sky now is a **model's short forecast, not a sighting**, and it is the chance of aurora *overhead*: a display can be seen low in the north from far south of the green. It is read about hourly while the oval moves within minutes, so it shows its age and is dropped 3 hours after the time it was made for. Clouds are not in it.
- No artificial sky-brightness layer (the VIIRS world atlas is not openly licensed).

## Check it

```js
atlas.clearMap(); atlas.focus('climate'); atlas.setTime(2060)   // projection
atlas.clearMap(); atlas.focus('normals')
atlas.clearMap(); atlas.focus('light')
// with /?film&now (the film alone hides the live chip):
document.querySelector('#panel [data-m="now"]').click(); atlas.map.jumpTo({ center: [-105, 59], zoom: 3.3, pitch: 0 })
```
