# Raise a family

**Who:** parents and parents-to-be choosing a town for their children.

**The question:** Where are the schools, childcare, doctors and everyday services our kids will need?

## What answers it

- **🎓 Schools & learning**: K-12 schools by sector (public, separate, Fransaskois, First Nations, independent; French ring), post-secondary sites; drive-time chips for high school, elementary, French and post-secondary.
- **🧸 Childcare**: licensed centres (ring: takes infants) and family child care homes as a count per community; drive to the nearest centre or any licensed care.
- **🩺 Doctors & clinics**: drive to the nearest clinic and pharmacy.
- **🛒 Daily needs**: eight needs met in town.
- **Town Finder**: Growing family preset; School nearby, French schooling, Childcare nearby, Clinic nearby, Daily needs in town.

## How

Town Finder → Growing family; or turn on the layers and read a Town Report's Schools, Childcare and Doctors rows.

## What it cannot tell you

- **Licensed is not a space open**; the list has no capacity. $10 a day applies to regulated spaces only. Family homes keep no name or address (a count at a point rounded to 0.02°).
- **A clinic is not a doctor taking new patients.** Where no clinic is mapped but there is a hospital in town, the hospital stands in (**inferred**).
- Provincial schools' grades are read from the name; an unstated one may count as K-12 (inferred). Check grades with the division.
- Drives skip Hutterite colony, band and independent schools.

## Check it

```js
atlas.clearMap(); atlas.focus('schools')
atlas.clearMap(); atlas.focus('childcare')
atlas.openFinder(); document.querySelector('[data-preset="family"]').click()
```
