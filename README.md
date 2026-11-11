# Living Skies Atlas

*Saskatchewan's safety, justice and land, in open data.*

A static, animated 3D map of Saskatchewan built on the same framework as [Island Atlas](https://github.com/dtomyn/HouseShopping-VancouverIsland) (Vancouver Island). It combines a **justice & public-safety** view (crime severity, courts, police, corrections, treaties and reserves) with the hazards and services that matter when choosing where to live (wildfires, tornadoes, river floods, climate, population, hospital access, parks and camping).

It is an exploration tool, not legal, safety or real-estate advice.

## What's on the map

| Group | Layer | Kind | Years | What it shows |
|---|---|---|---|---|
| Justice & safety | ◆ Crime severity | timeline | 1998 → 2025 | Crime Severity Index, Violent CSI and weighted clearance rate for each place's police service, as columns; Saskatchewan's own index on the sparkline |
| | ⚖ Courts & police | static | as mapped today | Courthouses, police stations and correctional centres; drive time from each place to its nearest court and police, with the routes |
| | ◈ Treaties & reserves | static | treaties 1871–1906 | The six numbered treaty areas that cover the province and 826 reserve parcels |
| History | 🔥 Wildfires | timeline | 1959 → 2025 | 27,542 reported fires flaring as they start; each leaves a scar circle the size of the area it burned |
| | 🌪 Tornadoes | timeline (monthly) | 1980 → today | 529 verified tornadoes from Environment Canada (1980–2009) and 174 from the Northern Tornadoes Project (2017 →), coloured by rating, with track lines; no open record covers 2010–2016 |
| | ≋ River floods | timeline | 1912 → 2025 | Each gauge's annual peak against its normal peak |
| | 🌡 Climate | timeline | 1886 → 2020 | Homogenized station temperatures as anomalies; warming stripes |
| Places & living | ◍ Population | timeline | 2001 → 2025 | Population of each place, coloured by five-year growth |
| | ✚ Hospital access | static | 2020 list | Hospitals and health centres; drive time to the nearest hospital |
| | ⛺ Camping & rec | static | today | Parks and rec sites; every campground as a flickering campfire; **Weekend Reach** (pick a place, watch an ignition wave light every campground within 1–4 h by road, counted against the median place); park report cards (fire history, climate, closest place by road) |
| | ☀ Climate normals | static | 1981–2010 | Sunshine, rain and snow days, frost days, snowfall |

Plus, as in Island Atlas: a **Town Report** for each of the 62 places (crime, the drive to court / police / hospital / campground, parks nearby, hazards, climate), a **Town Finder** that ranks places by weighted criteria (presets: Balanced, Safety first, Growing family, Quiet & small), curated **historic events** (Treaty 4 and 6, the Riel trial, the Regina Cyclone, the 2011 Souris flood, the 2015 northern fires), and a **Data & sources** view drawn as an aspen round.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + static build into dist/
```

`public/data/` is committed, so the app runs without the pipeline.

**Dev container:** open the folder in VS Code and choose *Reopen in Container* (needs Docker and the Dev Containers extension). It uses Node 22, runs `npm ci` on creation, keeps `node_modules` in a named volume, and forwards port 5173, so `npm run dev` works as above.

## Refreshing the data

```bash
npm run data                    # every stage
npm run data crime justice      # selected stages
```

Stages, in run order: `province places fires tornadoes rivers climate normals population crime treaties justice hospitals camping`. Raw downloads cache in `.cache/`; a failing stage keeps its old JSON and records the error in `public/data/manifest.json`, which the Data & sources view shows. `justice`, `hospitals` and `camping` call the public OSRM demo router once a second, so a cold run takes about 10 minutes.

## Data sources

| Layer | Source | Licence |
|---|---|---|
| Province outline | Statistics Canada, 2021 cartographic boundary file (ArcGIS REST) | Statistics Canada Open Licence |
| Places | Names typed in `scripts/places.mjs`; locations from NRCan's Canadian Geographical Names Database | OGL – Canada |
| Crime severity | Statistics Canada Table 35-10-0061-01, police services in Saskatchewan | Statistics Canada Open Licence |
| Courts & police | OpenStreetMap (`amenity=courthouse`, `police`, `prison`) via Overpass; drive times from the OSRM demo router | ODbL |
| Treaties & reserves | Indigenous Services Canada, *Historic Treaties* (ArcGIS REST); NRCan Canada Lands Survey System, *Aboriginal Lands of Canada Legislative Boundaries* | OGL – Canada |
| Wildfires | NRCan CWFIS, Canadian National Fire Database (fire points) | OGL – Canada |
| Tornadoes | ECCC, Canadian National Tornado Database: Verified Events 1980–2009; Northern Tornadoes Project (Western University), Event Summaries feature service, 2017 → | OGL – Canada; CC BY-NC 4.0 (non-commercial; this atlas is) |
| River floods | ECCC HYDAT annual peaks via `api.weather.gc.ca` | OGL – Canada |
| Climate, normals | ECCC AHCCD and Canadian Climate Normals via `api.weather.gc.ca` | OGL – Canada |
| Population | Statistics Canada Table 17-10-0155-01 (census subdivisions) | Statistics Canada Open Licence |
| Hospital access | Statistics Canada, Open Database of Healthcare Facilities (v1, 2020); OSRM drive times | OGL – Canada; ODbL |
| Camping & rec | Saskatchewan Ministry of Parks, Culture and Sport, ParksAsTitled boundaries; Parks Canada Accommodation and Facilities; OpenStreetMap `tourism=camp_site`/`caravan_site`; OSRM drive times | OGL – Canada; ODbL |

## Caveats

- **Crime** is reported by police service, not by town. Small towns' municipal RCMP series stop in 2011; after that the atlas uses the rural detachment of the same name, which also covers the surrounding area, including nearby First Nations. Northern detachments cover small populations, so their index swings hard on a few incidents. A high index in a service hub partly reflects people who come in from outside.
- **Courts and police** come from OpenStreetMap, which is incomplete here. Where Statistics Canada lists a place with its own current municipal police service but nothing is mapped near its centre, the atlas counts police as "in town" and says so. Provincial Court circuit points held in halls or band offices are mostly unmapped.
- **Hospitals** are Statistics Canada's 2020 list. Rural emergency departments have had temporary closures since.
- **Weekend Reach** uses one OSRM table per place to every drivable campground within 400 km, kept if within 4 h. The rolling ring on the map is only a guide; the arcs are the drive times.
- **Campgrounds** outside the national parks come from OpenStreetMap and can be missing; Parks Canada's individual campsites are grouped into campgrounds. Provincial park campgrounds have no open point dataset, so OSM stands in. Seasons and closures are not in the data.
- **Fire scars** are circles of the right area, not real perimeters. Tornado counts depend on who or what was there to spot them. The two tornado records use different scales (Fujita to 2009, Enhanced Fujita from 2017), nothing open covers 2010–2016, and NTP track ends are estimated from length and direction.
- **Treaty boundaries** are Canada's depiction; First Nations' understanding of their territories and of the treaty promises can differ.

## Next layers worth adding

- Incident-level crime from Table 35-10-0182-01 (impaired driving, break-ins, by service).
- Saskatchewan's own wildfire perimeters if they become open; NTP's 1980–2023 historical set (needs a Western University account).
- Courts of King's Bench and Provincial Court locations from an official list, if one is published openly.
- Drought (AAFC Canadian Drought Monitor), internet (ISED), and the explainer film from the blueprint.
