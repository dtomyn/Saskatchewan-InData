# Know the climate and the light

**Who:** people moving from a milder or more southern place who want to know what winter, summer and the dark will be like.

**The question:** How cold, warm, sunny and snowy is it here, how short are winter days, and can I see the northern lights?

## What answers it

- **🌡 Climate** (1886 → 2020): station colour and warming stripes.
- **☀ Climate normals** (1981–2010): columns with chips.
- **☾ Light & dark** (computed): day length by latitude (Dec 21, Mar 20, Jun 21), aurora bands, dark-sky preserves; a day-length chart at 49°, 54° and 60° N.
- **Town Report** Climate, normals and Light & dark rows; Finder: Milder, Sunnier, Less snow & frost, Longer winter days.

## How

Turn on Climate or Light & dark and switch chips; open a Town Report.

## What it cannot tell you

- Some places **borrow** a climate station; the report names it.
- Light & dark is **computed, not measured**: day length ignores hills and horizon; aurora bands are NOAA's Kp rule of thumb, not a probability, and clouds, the moon and city lights decide what a night shows.
- No artificial sky-brightness layer (the VIIRS world atlas is not openly licensed).

## Check it

```js
atlas.clearMap(); atlas.focus('normals')
atlas.clearMap(); atlas.focus('light')
```
