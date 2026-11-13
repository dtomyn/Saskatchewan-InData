# Reach help in an emergency

**Who:** anyone choosing a place to live, especially rural or northern, older people and families; the other half of the atlas's one question.

**The question:** How far is it from here to the police, a courthouse and a hospital?

## What answers it

- **⚖ Courts & police** layer: courthouses, police stations and correctional centres; drive-time columns from each place to its nearest court and police, with route pulses.
- **✚ Hospital access** layer: hospital sites and drive-time columns.
- **🩺 Doctors & clinics** layer for non-emergency care (see [Raise a family](raise-a-family.md)).
- **Town Report**: Courthouse, Police, Hospital rows, each with the drive and the site's name.
- **Town Finder**: Police nearby (1), Court nearby (1), Close to a hospital (3).

## How

Turn on Courts & police or Hospital access; hover or click a place to see its routes.

## What it cannot tell you

- Courts and police come from OpenStreetMap, which is incomplete here. Where Statistics Canada lists a current municipal police service but nothing is mapped near the centre, police count as **in town (inferred**, `nearestJustice` in `src/justice.ts`) and the report says so.
- Provincial Court circuit points in halls or band offices are mostly unmapped.
- Hospitals are Statistics Canada's 2020 list; rural emergency departments have had temporary closures since, posted only as notices.
- Drive times are OSRM free-flow, not winter roads or ambulance response.

## Check it

```js
atlas.clearMap(); atlas.focus('justice')
atlas.clearMap(); atlas.focus('hospitals')
atlas.openTown('la ronge')
```
