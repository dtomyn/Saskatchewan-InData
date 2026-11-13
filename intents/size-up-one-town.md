# Size up one town

**Who:** someone who already has a place in mind (a job offer, family nearby, a listing) and wants the whole picture.

**The question:** What is it actually like to live in this town?

## What answers it

- **Town Report** for any of the 62 places: crime; the drive to court, police, hospital, clinic, pharmacy, school, childcare, campground, airport and settlement help; daily needs ✓/✗; schools; internet; community; home costs and indicative property tax; jobs and income; hidden neighbours; drinking water; radon; getting around; hazards (wildfires, smoke, tornadoes, hail, drought); climate and normals; light & dark; the commute once a workplace is set.
- The full row list is `MAP-ATLAS-BLUEPRINT.md` §1.5.

## How

Click a place on any layer, or open one from the Town Finder.

## What it cannot tell you

- Each row is a different source and vintage; borrowed or inferred values say so in the row (borrowed smoke station and climate station, in-town police, hospital standing in for a clinic, inferred SGI issuers).
- A ✗ in Daily needs can mean "not mapped in OpenStreetMap" rather than "not there".
- Figures are for the place's own census subdivision (its limits), not the rural municipality around it.

## Check it

```js
atlas.openTown('swift current')
```
