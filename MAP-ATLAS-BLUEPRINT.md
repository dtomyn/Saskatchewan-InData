# Map Atlas Blueprint

A reusable spec for building an animated, open-data map atlas with the same look, feel and capabilities as **Island Atlas** (Vancouver Island in data), plus a scripted explainer video filmed from the real app.

**How to use this file**

1. Copy it into a new, empty repository.
2. Fill in **Part 1 – Project brief** (the only part you need to write). Delete the example lines in *italics*.
3. Give it to Claude Code with: *"Build this atlas from MAP-ATLAS-BLUEPRINT.md. Start with the milestones in Part 9, one at a time."*

Parts 2–8 are the house style and architecture. Change them only on purpose, so every atlas you make feels like part of the same family.

---

## Part 1 – Project brief (Living Skies Atlas)

### 1.1 The idea

| Field | Answer |
|---|---|
| Atlas name | Living Skies Atlas |
| Tagline | Saskatchewan’s safety, justice and land, in open data |
| The one question it answers | How safe is each Saskatchewan community, and how far is it from police, a court and a hospital? |
| Region | Saskatchewan |
| Bounding box (W, S, E, N) | -110.1, 48.9, -101.3, 60.1 |
| Opening camera | intro: -106.0, 54.6, zoom 3.6, flat; home: -105.6, 51.75, zoom 5.35, pitch 45, bearing -12 |
| Outline geometry | Statistics Canada 2021 cartographic boundary file, PRUID 47 |
| Timeline span | 1871 (treaties) → today; history layers 1886 → 2025 |
| Accent / brand colours | defaults |

### 1.2 Places

| Field | Answer |
|---|---|
| What a place is | tier 1: city, town or northern village (62), everything below; tier 2: every other city, town, village, resort village and northern municipality (417, from their 2021 census subdivisions; `tier: 2` in municipalities.json), a small-community report (census, what is mapped in town, hazards by location, nearest services in a straight line) and an opt-in place in the Finder; every other census subdivision (951 in all: rural municipalities, villages, resort villages, reserves, the unorganized north) gets a census-only report from the census layers' province-wide tint |
| Where the list comes from | names in `scripts/places.mjs`, located with the CGNDB geonames API |
| Report / finder names | Town Report / Town Finder |
| Finder headline question | Where should we live? |

### 1.3 Layers

| id | Name | Icon | Colour | Kind | Years | Visual idiom | Source | Licence |
|---|---|---|---|---|---|---|---|---|
| crime | Crime severity | ◆ | #ff4d8d | time | 1998 → 2025 | place columns (chips: CSI, violent, solved) | StatCan 35-10-0061-01 | StatCan Open Licence |
| justice | Courts & police | ⚖ | #ffd166 | static | today | sites + drive-time columns + route pulses | OpenStreetMap / OSRM | ODbL |
| treaties | Treaties & reserves | ◈ | #e9c46a | static | 1871–1906 | tinted areas + bright parcels | ISC Historic Treaties; NRCan CLSS | OGL – Canada |
| fires | Wildfires | 🔥 | #ff8a3d | time | 1959 → 2025, then Now | flare then scar: the NBAC mapped outline for a burn of 200 ha or more (1972 to its latest year; it appears at its first start point's date, and the start points inside it draw no circle), an area-true circle otherwise, the tooltip saying which; at Now, satellite hotspots of the last 24 h (pale yellow, fading with age) and CWFIS estimated perimeters (dashed) | NRCan CNFDB points; NRCan NBAC outlines (CWFIS WFS `public:nbac`); CWFIS hotspots and M3 perimeters (live) | OGL – Canada |
| smoke | Smoke & air | 🌫 | #e8a87c | time | 2001 → 2023 (Sask. in NAPS so far), then Now (AQHI columns in Environment Canada's colours, never with smoke days) | station columns, height = smoke days (24 h PM2.5 > 25 µg/m³) that year, haze grey → ember red; data-driven event for the smokiest year | ECCC NAPS hourly PM2.5 | OGL – Canada |
| tornadoes | Tornadoes | 🌪 | #9ad8ff | time (monthly) | 1980 → today (gap 2010–2016) | funnel flare then dot; track lines (estimated ends faint) | ECCC National Tornado Database; Northern Tornadoes Project | OGL – Canada; CC BY-NC 4.0 |
| hail | Hail | 🧊 | #c3b5ff | time (monthly) | 2022 → today (radar swaths 2022–2024) | ice-burst flare then dot sized and coloured by largest hail (pea → softball, grey when not given), swath centre lines; research-database storms white-rimmed; events for investigated storms and 100 mm+ swaths | Northern Hail Project: MESH hail swaths, NHP Research Database | CC BY-NC 4.0 |
| drought | Drought | 🌾 | #e0a43a | time (monthly) | Nov 2002 → today | each month's Canadian Drought Monitor map tinted D0–D4 in the drought monitor's ramp (D4 lifted from dark maroon for the dark map), not analyzed in faint grey; when focused, town dots coloured by their cell's category; event for the worst drought year (highest average share of the province at D2+) | AAFC Canadian Drought Monitor (image service, read as raw categories on a 10 km Web Mercator grid) | OGL – Canada |
| crops | What grows here | 🌱 | #c9d65b | time (yearly) | 2009 → 2025 | each year's Annual Crop Inventory as a bitmap, ~2 km squares tinted by their most common class (11 classes; not mapped and cloud blank); the panel charts cereals, canola, pulses, pasture and grassland as shares of the footprint mapped every year; events for the most-canola year and, when it stands out, the year most fields were too wet to seed | AAFC Annual Crop Inventory (image services, raw categories sampled at 500 m into 3 km Web Mercator cells) | OGL – Canada |
| rivers | River floods | ≋ | #4cc9f0 | time | 1912 → 2025, then Now | columns vs. normal; at Now, the latest real-time flow vs. the normal annual peak (amber ring: ice-affected or estimated) | ECCC HYDAT; real-time hydrometric data (live) | OGL – Canada |
| climate | Climate | 🌡 | #f25f5c | time | 1886 → 2020 | station colour + stripes | ECCC AHCCD | OGL – Canada |
| normals | Climate normals | ☀ | #c5e86c | static | 1981–2010 | columns with chips | ECCC normals | OGL – Canada |
| light | Light & dark | ☾ | #a3b8ff | static (computed) | computed from latitude | 0.25° latitude rows tinted by hours from sunrise to sunset (chips: Dec 21, Mar 20, Jun 21) or, by the Aurora chip, 0.25°×0.5° cells tinted by geomagnetic latitude; RASC dark-sky preserves outlined in violet; place dots in the same colour; when focused, one labelled place per degree of latitude (the largest) and the preserve names; panel chart of day length through the year at 49°, 54° and 60° N | Computed in the `light` stage: NOAA solar position equations (sunrise/sunset at 90.833°, civil twilight at 96°); geomagnetic latitude from the IGRF-14 dipole (g₁⁰, g₁¹, h₁¹ of the newest epoch, read from IAGA's coefficient file) with NOAA SWPC's Kp rule (oval edge ≈ 66° − 2°·Kp) for the bands often (≥ 62°) / sometimes (58–62°) / rarely (< 58°); RASC Dark-Sky Sites table (designation) matched by name to the `camping` stage's park outlines; OSRM drive to the nearest campground inside a preserve | Computed; IGRF freely available; park outlines OGL – Saskatchewan / Canada; routes ODbL |
| population | Population | ◍ | #3ecf8e | time | 2001 → 2025 | place columns (colour = 5-yr growth) | StatCan 17-10-0155-01 | StatCan Open Licence |
| housing | Home costs | ⌂ | #e6a57e | time (CMHC) + static (census) | 2000 → 2025; Census 2021 | place columns (chips: home value, rent paid, stretched 30 %+, market rent coloured by vacancy, property tax: the indicative yearly tax on the median home); for the three census chips, every census subdivision tinted by the same measure (suppressed left clear; click one outside the 62 for its census report) | StatCan Census Profile 2021 (SDMX API); CMHC Rental Market Survey via StatCan 34-10-0133/0130/0132; Ministry of Government Relations Mill Rate Survey Results (Publications Centre, latest year, 2025) | StatCan Open Licence; mill rates Crown copyright (non-commercial) |
| jobs | Jobs & income | ⚒ | #7fd1b9 | time (LFS) + static (census) | 2011 → 2025; Census 2021 | economic regions tinted by unemployment or employment rate (chips), labelled when focused; place columns of median household income; chip *Income by subdivision* swaps the region tint for every census subdivision's median household income | StatCan LFS Table 14-10-0464-01 (annual, by economic region); Census Profile 2021 (SDMX API); 2021 economic-region boundaries | StatCan Open Licence |
| needs | Daily needs | 🛒 | #2ec4b6 | static | as mapped today | site dots coloured by need (grocery, pharmacy, school, bank, gas, library, post office, clinic); when focused, town-limit outlines and place columns (needs met of 8, or one need's count via chips) | OSM via Overpass; StatCan 2021 census subdivision boundaries (town limits + 1 km) | ODbL; StatCan Open Licence |
| schools | Schools & learning | 🎓 | #ffb703 | static | listed today | K-12 school dots coloured by sector (public, separate, Fransaskois, First Nations, independent; pink ring = French-language or French immersion); post-secondary rings by kind (university, polytechnic/technical, regional college); when focused, drive-time columns (chips: high school, elementary, French, post-secondary) and the hovered/selected place's four routes | Sask. Ministry of Education SchoolsAndDivisions and Ministry of Advanced Education institutions (GeoHub ArcGIS REST); OSM `amenity=school` for schools the ministry layer lacks and `amenity=university\|college` for missing Sask Polytech campuses; OSRM | OGL – Saskatchewan; ODbL |
| internet | Internet & mobile | 📶 | #e9a8ff | static | service offered today | ISED's 25 km² hexagons tinted by the share of homes offered fixed 50/10 Mbps (chips: Fixed 50/10 = wired or fixed wireless, By wire, Mobile LTE, Carriers = mobile networks listed); when focused, the same per place as columns (homes inside town limits) | ISED National Broadband Data (NBD PHH Speeds, current; NBD Map hexagon providers) + Pseudo-Household Demographic Distribution 2021, weighted by households | OGL – Canada |
| community | Who lives here | 🤝 | #f0a6ca | static | Census 2021 · mapped today | When focused, a column per place, height and colour by the share picked (chips: Immigrants, Arrived 2016–21, Other home language, Speak French, Indigenous identity), over every census subdivision tinted by the same share; always, places of worship in or within 1 km of town limits as small dots coloured by religion (Christian, Muslim, Sikh, Hindu, Buddhist, Jewish, other, not tagged). Framed as finding community, not ranking people | Statistics Canada Census 2021 profile by CSD (SDMX API) + OSM `amenity=place_of_worship` | Statistics Canada Open Licence; ODbL |
| newcomer | Newcomer services | 🧭 | #4fd1c5 | static | offices listed today | When focused, a column per place, height and colour by the drive to the nearest of the errand picked (chips: Settlement help, English classes, Service Canada, SGI issuer); hover or click a place for routes to all four. Always, settlement and language offices as teal dots (white ring: on the province's settlement list, the Regional Newcomer Gateways), Service Canada offices red (outreach sites faded), SGI issuers green (insurance brokers faded: inferred issuers) | IRCC "Find free newcomer services" list (`services-info.js`); Government of Saskatchewan settlement services, typed into the script from the web page with the date read; OSM Service Canada offices, SGI issuers and insurance brokers; OSRM | Government web content (non-commercial reproduction); ODbL |
| childcare | Childcare | 🧸 | #ffc4a3 | static | licensed facilities listed today | When focused, a column per place, height and colour by the drive to the nearest of the target picked (chips: Centre, Any licensed care); hover or click a place for routes to both. Always, licensed centres as apricot dots (white ring: takes infants) and family child care homes as lavender circles sized by their count per community, at a point rounded to 0.02°, never a home. A callout: licensed is not a space open; $10 a day is for regulated spaces | Sask. Ministry of Education regulated child care list (saskatchewan.ca finder page); OSRM | Crown copyright, non-commercial; ODbL |
| transit | Getting around | ✈ | #f28482 | static | flights, trains and buses today | airports with scheduled flights as coral dots (white-ringed), IATA codes when focused; VIA Rail lines yellow with stations (faint: flag stops); intercity bus routes dashed green with stops; city bus routes as thin lines in their GTFS colours; when focused, a column per place, height and colour by the chip picked (Drive to an airport; Without a car: city bus 2 + intercity bus stop 1 + VIA stop 1 in town); hover or click a place for its route to the airport. A note that STC closed in 2017 and intercity bus coverage is partial | OurAirports `airports.csv` (`scheduled_service`) placed by OSM aerodromes; OSM VIA stations and train routes and `route=bus` relations (40 km+ = intercity; shorter ones give towns with no feed their buses); Regina, Saskatoon, Moose Jaw and Prince Albert GTFS (longest shape per route, stop counts, Wednesday trips); OSRM | Public domain; ODbL; city open data terms (Moose Jaw and Prince Albert: no licence stated) |
| industry | Hidden neighbours | 🛢 | #d4e157 | static | licensed and reported today | ~4 km hexagon columns of oil and gas wells and facilities (height = count when focused, flat otherwise; colour = share still active, abandoned brown → sulphur yellow); licensed pipelines in use coloured by substance (sour gas red; abandoned and discontinued ones left off); federally regulated lines white; NPRI reporting sites as orange dots sized by tonnes released; producing mines as ringed dots by commodity (potash, uranium, coal, metals, other). When focused, a column per place: its industrial-neighbour count. A neutral callout: also where the jobs are; wells include abandoned and suspended. Chips **Oil, gas & mines** and **Power grid** switch each set off: the grid is OSM high-voltage lines dashed in blues by voltage class (so they never read as pipelines), substations as hollow dots and generating stations ringed, coloured by fuel, sized by MW (coverage partial: said in the panel) | Sask. Ministry of Energy and Resources GeoHub (Petroleum, Pipelines, Mineral Deposit Index); ECCC NPRI; OSM (CER-regulated lines; `power=line`, `substation`, `plant`) | GoS Unrestricted Use Data Licence; OGL – Canada; ODbL |
| water | Drinking water | 🚰 | #64b5f6 | static | advisories in effect today | Every drinking water advisory in effect: dots coloured by type (precautionary advisory amber, boil water orange, do not consume violet), sized by how long it has lasted, white-ringed after a year; dimmer where the spot is inferred from a place or lake named in the listing. When focused, a column per place: advisories within 25 km, orange where the town's own water system has one. A callout that private wells are not covered (WSA: test bacteria twice a year). Unplaceable listings counted, not drawn | WSA / Ministry of Environment and SHA “PDWA and EBWO in effect” PDF reports (saskatchewan.ca); ISC short- and long-term First Nations advisories; NRCan CGNDB (placing) | Crown copyright (Sask.), non-commercial; Government of Canada terms, non-commercial; OGL – Canada |
| radon | Radon | ☢ | #b48cff | static | homes tested 2009–2011 | Areas tinted by the share of tested homes at or above Canada's radon guideline (200 Bq/m³): the survey's 2007 health regions (default, labelled with their share when focused) or, by a chip, postal areas (FSAs), faded where fewer than 20 homes were tested. A callout that radon varies house by house and only a long-term test tells (Health Canada advises testing every home) | Health Canada Cross-Canada Survey of Radon Concentrations in Homes (one row per home); StatCan Health Regions 82-402-X (2007 regions, 2006 geography); StatCan 2021 FSA boundaries | OGL – Canada; StatCan Open Licence |
| hospitals | Hospital access | ✚ | #6c8cff | static | 2020 list | sites + drive-time columns | StatCan ODHF; OSRM | OGL – Canada; ODbL |
| doctors | Doctors & clinics | 🩺 | #ff8fab | static | clinics listed today | When focused, a column per place, height and colour by the drive to the nearest of the target picked (chips: Clinic, Pharmacy); hover or click a place for routes to both. Always, clinics as dots by kind (pink medical clinic or doctor's office, amber SHA primary health care or health centre, lavender nurse; white ring walk-in; faded: placed at the town centre) and pharmacies teal. A callout: a clinic is not a doctor taking new patients; SHA service disruptions are notices, not data | StatCan ODHF (SHA ambulatory sites and non-hospital health centres); OSM clinics, doctors, nurses, pharmacies; OSRM | OGL – Canada; ODbL |
| camping | Camping & rec | ⛺ | #59d18c | static | today | park polygons + flickering campfires + drive-time columns; Weekend Reach ignition wave (arcs to every campground within 1–4 h, live count vs the median place, camera framed via `atlas:fly`); park report cards | Sask. PCS ParksAsTitled; Parks Canada; OSM; OSRM | OGL – Canada; ODbL |
| commute | Workday Reach | 🚗 | #c9a7ff | static (tool) | routed today | pick a workplace (any place) and a limit (15/30/45/60 min): a wave rolls out from it and an arc reaches every place whose drive to work fits, each labelled "N min · #rank in Finder" (rank under the viewer's saved weights; overlapping labels within 20 km keep the better rank), live count, best Finder match within reach, camera framed via `atlas:fly`; all places dimmed until reached | OSRM table: 62×62 place-to-place drive times (home → work) | ODbL |

Menu groups: Base map (`province`) · Justice & safety (`crime justice treaties`) · History on the timeline (`fires smoke tornadoes hail drought crops rivers climate`) · Places & living (`population housing jobs needs schools internet camping commute normals light`) · Health (`hospitals doctors`) · Settling in (`community newcomer childcare transit`) · Around the property (`industry water radon`).

### 1.4 Historic events

Treaty 4 (1874.71), Treaty 6 (1876.64), the Riel trial and execution in Regina (1885.88), Saskatchewan becomes a province (1905.67), the Regina Cyclone (1912.5), the Souris River floods (2011.45), the 2015 northern fires (2015.5). Data-driven: fires over 100,000 ha, F3+ or casualty tornadoes, province-wide high-water years, the warmest year.

### 1.5 Place Report and Finder

Report rows: Crime Severity, Violent crime, Crimes solved, Courthouse, Police, Hospital, Population, Region / treaty, Campground, Parks nearby, Home costs (Home value, Rent paid, Owner costs, Stretched, Market rent and Vacancy for CMHC-surveyed centres, with a 2-bedroom rent chart; Property tax: the indicative yearly tax on the median home, with the residential mill rate and year, uniform rate × factor when a factor is used, and whether the place also charges a base or minimum tax, which is not included), Jobs & income (Regional unemployment: the place's LFS region, latest year; Household income: Census 2021 median; Unemployed in town: census week May 2021; Top industries: three NAICS sectors by share of the labour force), Daily needs (✓/✗ with a count per need: grocery store, pharmacy, school, bank or credit union, gas station, library, post office, clinic or doctor; counted inside town limits or within 1 km), Schools & learning (drive to the nearest Elementary, High school, French schooling — Fransaskois or French immersion — and Post-secondary site, each with its name, sector and grades; Schools in town: schools any family can attend, ministry list + OSM gap-fill, inside town limits + 1 km), Internet (Fast internet: % of homes inside town limits offered 50/10 Mbps, and % by wire; Best offered: the top ISED tier offered anywhere in town, with technologies; Mobile: LTE or none, % of homes reached and the networks listed; 5G is not in the open data), Community (Immigrants: % of people in private households, with the share who arrived 2016–2021; Arrived 2016–21, with temporary residents; Born in: top five named birthplaces of immigrants; Home languages: % speaking a non-official language most often at home, top five; French: % who can speak it, and % French mother tongue; Indigenous identity, in the town's own CSD; Places of worship in town + 1 km by religion; a share on a rounded 0 count shows "—"), Doctors & clinics (Clinic: the drive to the nearest clinic, doctor's office or primary health care centre, with its kind and source, or "In town" (inferred) when no clinic is mapped but the place has a hospital; Pharmacy: the drive to the nearest pharmacy; In town: clinics and pharmacies inside town limits or within 1 km; a note that a clinic is not a doctor taking new patients and that closures are posted only as notices), Childcare (Centre: the drive to the nearest licensed centre, its name and options; In town: licensed centres and family child care homes inside town limits or within 1 km, and how many take infants; a note that the list has no capacity, licensed is not a space open, and $10 a day applies to regulated spaces only), Hidden neighbours (Wells: oil and gas wells within 5 km of the town limits, split active / suspended / abandoned, with oil and gas facilities; Pipelines: licensed lines in use within 2 km, how many carry sour gas, and federal lines by name; Nearest emitter: the nearest NPRI-reporting site, its sector, distance from the town limits and tonnes released; Mine nearby: yes/no, a producing mine within 25 km, named; Power line: the nearest mapped high-voltage line from the town limits and its voltage class, the nearest substation, and a generating station within 10 km with its fuel and MW, marked OpenStreetMap, partial; a neutral note that these are also where many of the jobs are), Drinking water (Town water system: the advisory on the place's own waterworks on the Water Security Agency's list, its type, start date, how long it has lasted and the part affected, or No advisory; Within 25 km: advisories of any kind in effect within 25 km of the town centre by type, and the nearest other one; a note that advisories come and go, private wells are not covered and some spots are approximate), Radon (Radon: the share of tested homes at or above 200 Bq/m³ in the place's 2007 health region, with the number tested; Postal area(s): the same for the city FSAs covering the town limits, else the rural FSA of its centre, flagged “few tests” under 20; a note that radon varies house by house and only a long-term test tells), Getting around (Airport: the drive to the nearest airport with scheduled flights, named with its IATA code; Train: VIA stops in town and their line; Intercity bus: stops mapped in town and their operators, or none mapped (partial); City bus: the system, its routes and stops, from GTFS or OpenStreetMap; a note that STC closed in 2017 and none of it says how often anything runs), Newcomer help (the drive to the nearest Settlement help, English classes, Service Canada office and SGI issuer, each with its name and whether it is on the province's list, an outreach site or an inferred issuer; a note that health cards are online, by mail or in Regina), Commute (the drive to the viewer's workplace, only once "I work in…" is set; "Here" for the workplace itself) with a "🚗 Work in <place>? N other places within L min" button that sets the workplace and opens Workday Reach, Wildfires nearby, Smoke days (the nearest NAPS station within 150 km, borrowed and named: its average smoke days a year over the last ten years of record, at least five counted, and its worst year), Tornadoes, Hail (Northern Hail Project radar swaths and research-database storms passing within 50 km, and the largest hail among them, flagged when it is a radar estimate), Drought (months at D2+ over the last ten years of monthly maps at the town centre's 10 km cell, the latest month's category, and a strip of every month since 2002), The land around it (What grows here: the share of the land within 25 km cropped in the latest crop inventory and the first, the three biggest classes, and a stacked bar of every class; a note that small fields vanish), Climate, climate normals, Light & dark (Dec 21 and Jun 21 daylight with civil twilight, the aurora band with geomagnetic latitude, the drive to the nearest campground in a RASC dark-sky preserve).

Finder criteria (default weight): Low crime (3), Low violent crime (2), Crimes get solved (1), Police nearby (1), Court nearby (1), Close to a hospital (3), Close to camping (0), Affordable to buy (0), Lower property tax (0; indicative yearly tax on the 2021 census median home: value × 80 % × (factored residential municipal + education mill rate) ÷ 1000, latest Mill Rate Survey; base and minimum tax left out), Affordable to rent (0), Jobs nearby (0; lower unemployment in the place's LFS region, latest year), Higher income (0; Census 2021 median household income), Low wildfire exposure (1), Fewer smoke days (0; average smoke days a year at the nearest air station within 150 km, borrowed), Fewer tornadoes (0), Less hail (0; Northern Hail Project storms within 50 km: radar swaths 2022–2024 and its research database), Fewer drought months (0; months at D2+ on the Canadian Drought Monitor over the last ten years, at the town centre's 10 km cell), Milder (1), Sunnier (1), Less snow & frost (0), Growing (2), School nearby (0; drive to the nearest high or K-12 school), Fast internet (0; % of homes inside town limits offered fixed 50/10 Mbps, wired or fixed wireless — offered, not measured), French schooling (0; drive to the nearest Fransaskois or French immersion school), Diverse community (0; immigrants as a % of people in private households, Census 2021), Near an airport (0; the drive to the nearest airport with scheduled passenger flights, OurAirports' flag), Can live without a car (0; what is mapped in town: a city bus 2, an intercity bus stop 1, a VIA stop 1; both are kept because they answer different questions, one for the family that flies, one for the person who does not drive), Newcomer services nearby (0; drive to the nearest settlement agency: IRCC-funded offices giving general settlement help, needs assessments or community connections, or on the province's list), Childcare nearby (0; drive to the nearest licensed child care centre on the Ministry of Education's list; not whether a space is open), Clinic nearby (0; drive to the nearest medical clinic, doctor's office or primary health care centre: SHA sites in the ODHF and OSM; not whether it takes new patients), Fewer industrial neighbours (0; wells of any status and oil and gas facilities within 5 km of the town limits + NPRI sites within 5 km + licensed pipelines in use within 2 km + 1 for a producing mine within 25 km, one count each), Lower radon (0; share of tested homes at or above 200 Bq/m³ in the place's 2007 health region, Health Canada 2009–2011: the regions range from 7% to 26%, a real difference, but every home should be tested regardless), no Drinking water criterion (an advisory in effect is a point-in-time fact, usually weeks long, not a lasting trait of a place), Daily needs in town (2; replaced Services & amenities, the log of population: preset and saved `services` weights map to `needs`), Short commute (0: the drive to the viewer's workplace; switched off, slider disabled, until "I work in…" is set), Longer winter days (0: hours of daylight on Dec 21). Presets: Balanced, Safety first, Growing family, Quiet & small, New to Saskatchewan (Affordable to rent 3, Jobs nearby 3, Short commute 3 once a workplace is set, Diverse community 2, Daily needs in town 2, Close to a hospital 2, Clinic nearby 2, Newcomer services nearby 2, Low crime 2, Fast internet 1).

Finder switch **"Include small communities"** (off by default, kept while the page is open): ranks the 417 tier-2 communities with the 62 through `smallView` (src/small.ts), which merges each stage's `small` table and each community's census subdivision figures into a copy of the data. Criteria a small community lacks are skipped, never penalized; drive-time criteria (`drive: true`) skip it too, since its distances are straight lines; each row says how many of the weighted criteria it was scored on ("scored on 9 of 14").

City tract map (src/tracts.ts): the Regina and Saskatoon Town Reports open with an SVG map of their census tracts inside the city (chips: Home value, Income, Renters, Stretched, Immigrants, Indigenous identity; suppressed tracts grey, "—"), the city's neighbourhood outlines drawn over it and named in the tooltip. No neighbourhood crime (no licensed source); never on a province-wide scale.

Small-community report (src/small.ts, `renderSmallReport`): population (Census 2021 and change since 2016), Crime (absent: no series of its own), nearest hospital, police, courthouse, clinic, pharmacy, child care centre, elementary and high school (~km in a straight line), in town (daily needs, schools, clinics and pharmacies, licensed child care, fast internet; places of worship absent), hazards and climate by location (wildfires, tornadoes, hail, drought, smoke days, radon, mean temperature, shortest day and aurora band, river gauge, treaty), the list of what is worked out for the 62 only, links to the three nearest of the 62, then the census picture. Every absent value says why.

Finder setting **"I work in…"** (none by default), at the top of the Finder: it switches Short commute on, adds "N min to work" to each ranked place, and offers a "🚗 Workday Reach" button. It is one setting with Workday Reach's workplace and limit (`getWork`/`setWork` in `metrics.ts`, `atlas:work` when it changes), remembered in `localStorage` under `living-skies-atlas:work` (try/catch). Workday Reach ranks places with the same `rankTowns` and saved weights as the Finder, so its labels and the Finder agree.

### 1.6 Deep finder

Not built.

### 1.7 Data & sources view

An aspen round (the tree of the parkland belt): wedge per source, ring per year.

### 1.8 Explainer film

Not built yet.

---

## Part 2 – Principles (don't break these)

1. **Open data only.** Every number comes from a named public source with a licence. No scraped paywalled data, no invented values (e.g. tsunami arrival times only from published modelling, never estimated).
2. **Re-runnable data, no manual downloads.** All data arrives through `npm run data` stages. Prove it by deleting `.cache/` and running from empty. Anything genuinely impossible to fetch (no feed exists) is typed into a script with a dated comment and listed under "Still open" in the roadmap.
3. **Fully static site.** No backend. Pre-built JSON in `public/data/` is committed, so `npm install && npm run dev` works immediately.
4. **Honest labelling.** Projections look different from records (hatched, dashed, a "projection, not a record" badge). Show ranges, not single numbers, for model output. Say when a value is borrowed from the nearest station, estimated, or covers a wider area. Missing data is skipped, never penalized.
5. **Starts empty.** The map opens on just the region with place dots. Nothing is overlaid until the user picks a layer.
6. **Every number is counted from the loaded data**, including the counts on the sources page and figures said in the video narration.
7. **Escape everything from data.** Names from crowd-edited sources (OpenStreetMap, Wikidata) or the visitor go through `esc()` before `innerHTML`; links go through `safeUrl()`. A build-time Content-Security-Policy backs this up.
8. **Plain English.** UI text, panel ledes and narration are short, concrete and jargon-free. Explain what a measure means ("2% chance in 50 years") the first time it appears.
9. **Caveats section.** The README says it's an exploration tool, not professional advice, and names the main limitations of the data.

---

## Part 3 – Stack and repo layout

- **MapLibre GL JS** basemap: CARTO Dark Matter style, shaded relief from Mapzen/AWS Terrarium tiles.
- **deck.gl** (`@deck.gl/core`, `layers`, `aggregation-layers`, `geo-layers`, `extensions`, `mapbox`) through `MapboxOverlay({ interleaved: true })`, so flat layers can sit under basemap labels.
- **d3** for panel charts and scales.
- **Vite + TypeScript**, `base: './'` so it works from any GitHub Pages sub-path.
- Pipeline: **Node ESM scripts**; dev deps only (`@turf/*`, `exceljs`, `fflate` as needed).
- Video: **Python 3.12 + Playwright (Microsoft Edge for GPU WebGL) + imageio-ffmpeg + kokoro-onnx + soundfile + numpy**, in a `uv` venv at `.venv/`.

```
index.html                 app shell: map, appbar, panel, top actions, timeline (with its event ticker), tooltip, modal, loader
src/main.ts                state, map init, render loop, focus/menu/timeline, keyboard, hashes, ?film handle
src/layers.ts              AtlasLayer interface + one factory per layer + CURATED_EVENTS
src/data.ts                types for every JSON file, loadAll(), formatters (fmt), helpers (km, lowerBound…)
src/metrics.ts             per-place derived metrics, CRITERIA, rankPlaces()
src/panels.ts              Place Report and Place Finder panels, weights in localStorage
src/charts.ts              d3 barChart, lineChart, scatterChart, stripes, rampCSS — all with a playhead
src/sources.ts             the Data & sources view
src/<deepfinder>.ts        optional deep finder (rail, funnel, report, shortlist)
src/html.ts                esc(), safeUrl()
src/style.css              the whole design system (Part 4)
scripts/fetch-data.mjs     pipeline runner: stage order, manifest
scripts/stages/<name>.mjs  one stage per source (default export), imported only when it runs
scripts/lib/*.mjs          shared helpers: config, io (cache, fetch, writeOut), apis, parse, geo, places…
scripts/places.mjs         the place list and any hand-typed facts
public/data/*.json         committed outputs + manifest.json
video/storyboard.py        main film scenes; storyboard_<film>.py for supplements
video/render.py            the renderer (Film class)
video/sfx.py               synthesized sounds and music bed
video/stage/               stage.html/css/js (the framed "set") and vt.js (animation clock sync)
.devcontainer/             Node 22 container for app + pipeline
.github/workflows/deploy.yml  build + deploy to Pages, least privilege
README.md, ROADMAP.md
```

`package.json` scripts: `dev` → `vite`, `build` → `tsc --noEmit && vite build`, `preview`, `data` → `node scripts/fetch-data.mjs`.

---

## Part 4 – Look and feel

### 4.1 Mood

Dark, cinematic, glowing data on a near-black map. Frosted-glass UI floating over a full-bleed 3D map. Data *moves*: things flare, ripple, rise and cool. Serif display numbers give it an editorial, atlas-like feel; a mono face marks data values and ranges.

### 4.2 Design tokens (copy exactly)

```css
:root {
  --bg: #060a12;
  --glass: rgba(11, 17, 30, 0.74);
  --glass-strong: rgba(9, 14, 26, 0.9);
  --line: rgba(148, 170, 210, 0.14);
  --line-strong: rgba(148, 170, 210, 0.28);
  --ink: #e9eef7;
  --ink-2: #b4bfd2;
  --ink-3: #7d8aa3;
  --accent: #ff8a3d;          /* swap per project in 1.1 */
  --good: #3ecf8e;
  --radius: 14px;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  --font: 'Inter', system-ui, -apple-system, Segoe UI, sans-serif;
  --display: 'Fraunces', Georgia, serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
  color-scheme: dark;
}
```

Fonts from Google Fonts: Inter 400/500/600/700, Fraunces (opsz 9–144, 500/700), JetBrains Mono 500. Base size 14px (13px under 820px). Bad = `#ff6b6b`. Links `#9cc7ff`.

**Per-element colour:** every layer, section and card sets `--c` to its own colour, and components use `color-mix(in srgb, var(--c) N%, transparent)` for tints, borders and glows. This is what makes each layer feel coloured without new CSS.

Fixed feature colours: Finder violet `#a99bff` / `#7b61ff`; deep finder teal→lime `#5eead4 → #a3e635 → #fde047`; place/"good" green `#3ecf8e`; sources cedar `#ffb86b`.

### 4.3 Typography roles

| Role | Style |
|---|---|
| Brand name | Fraunces 700, 26px |
| Panel title (h2) | Fraunces 700, 24px, line-height 1.15 |
| Big numbers (hero stats, year readout 34px, metric values 19px) | Fraunces 700, `tabular-nums` |
| Kicker above titles | 11px, uppercase, letter-spacing 1.4px, weight 600, colour `var(--c)` |
| Section heads (h3) | 12px uppercase, letter-spacing 1.1px, `--ink-3` |
| Lede | 13.5px, `--ink-2`, line-height 1.55 |
| Data values, ranges, axis labels | JetBrains Mono 10.5–11.5px |
| Notes, source lines | 11–11.5px `--ink-3` |

### 4.4 Screen layout (desktop)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ (◎) Atlas Name        [● Layer: Wildfires  +1 ▾]     [Deep finder][◎ Finder][Data & sources][▯] │
│     tagline                                                          ┌───────────┐ │
│                                                                      │  panel    │ │
│                                                                      │  380px    │ │
│                    full-bleed 3D map + vignette                      │  kicker   │ │
│                                                                      │  h2       │ │
│                                                                      │  lede     │ │
│                                                                      │  hero ×2  │ │
│                                                                      │  chart    │ │
│ ┌──────────────────────────── timeline (92px) ───────────────────┐   │  source   │ │
│ │ (▶)  1950   ▁▂▃▅▂▁▇▃ sparkline ◆ ◆ events  ━━━━●──────  Speed │   └───────────┘ │
│ └────────────────────────────────────────────────────────────────┘                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **App bar** top-left (14px/16px): spinning conic-gradient brand mark (38px ring, 18s spin, glow), name, tagline; then the **layer picker** — one pill button showing the focused layer's icon, a "LAYER" micro-label, its name, a `+N` badge for extra visible layers, and a chevron.
- **Top actions** top-right: pill buttons. The Finder button is violet-glowing (`.accent`); the deep finder has a teal-lime gradient; Data & sources has a tiny tree-ring icon; an icon button hides the panel (`P`).
- **Side panel** right, 380px, glass, `top: 72px`, scrolls; collapses with a fade + slide.
- **Timeline** bottom, glass, radius 18px, grid `52px 92px 1fr 92px`: round accent play button (pulses while playing), year + month readout, track (sparkline canvas 34px, event diamonds, range scrubber with glowing thumb and filled-to-here track, mono min/label/max), speed select (½, 1, 2, 4, 8 yr/s; default 2).
- **Event ticker** docked on the timeline's top edge: one line (mono date in the event's colour, bold title, a **Details ›** pill) that shows as playback crosses an event and fades after 7s. Never a stack of cards over the map; the full story belongs in the panel.
- **Tooltip** follows the pointer (+14px), glass-strong, max 280px, key/value with mono values.
- **Map controls** moved left of the panel; restyled to glass with inverted icons.
- **Vignette** radial darkening over the map edges.
- **Loader** full-screen: spinning conic ring + one-line message ("Loading a century of … history…"), fades out over 0.8s.

**Responsive:** under 1100px the panel is 330px and the brand tagline hides. Under 820px: brand text hides, the layer menu becomes full-width fixed, Data & sources and panel buttons hide, the panel docks above the timeline (max 34vh), the timeline spans the width without the speed control, and map controls hide.

### 4.5 Components

| Component | Recipe |
|---|---|
| `.glass` | `--glass` bg, `backdrop-filter: blur(14px) saturate(140%)`, 1px `--line` border, `--radius`, `--shadow` |
| `.pill-btn` | radius 999px, 8×14px padding, `--line-strong` border, glass bg, 600 weight 12.5px |
| Layer menu | 330px dropdown, glass-strong, grouped with uppercase group heads; rows = 28px tinted icon tile, name, mono year range, and an on/off switch (`role="switch"`). The active row has a `--c` gradient and a glowing 3px left bar. The top row is the base map: highlighted as "Just the region" when nothing is on, otherwise a dashed-outline "Clear the map" reset. Ends with a hint line. Behaviour in §5.3 |
| Hero stats | 2-column grid of tiles: big Fraunces value, small label |
| Metric tile (reports) | label with coloured dot, Fraunces 19px value, 11px sub-line |
| Callout | 2px `--c` left border, faint bg, 12.5px |
| Chips | small pills; `.on` fills with `--c` at 25% |
| Legend / ramp | colour swatches; a 10px CSS gradient ramp with mono end labels |
| Source line | top border, 11px `--ink-3`, "Source: …" — every layer panel ends with one |
| Range bar | track + translucent band (10th–90th percentile) + white tick (median) + grey tick (today) |
| Projection badge | dashed `--c` border, hatched background, uppercase "Projection, not a record" |
| Static note | when the active layer is static, or no layer is active, the timeline greys out (opacity .16) and a centred note says why: "X doesn't change over time", "No layer picked — click one for its timeline", or "No history layer on the map" |
| Rank list | rank number (mono), name + sub-line, gradient score bar (`#7b61ff → #3ecf8e`) with mono 0–100 |
| Switch | 34×19 track; checked = `--c` with glow; springy thumb |
| Modal | dimmed blurred backdrop, glass sheet ≤760px, Fraunces title |
| Close button | 28px square, top-right, `×` |

Charts (`charts.ts`): small d3 bar/line/scatter/stripes charts sized to the panel width, axis text `--ink-3` 10px, grid `--line`, and a **playhead** that tracks the timeline (`setPlayhead(t)`). Dashed lines for projections; muted lines for context series. Charts are created after the panel is in the DOM (one `requestAnimationFrame`).

### 4.6 Map visual idioms (deck.gl)

Pick one per layer in the brief:

| Idiom | How it works | Used for |
|---|---|---|
| **Flare then scar** | New items extrude and glow white-yellow→red with additive blending for a glow window tied to playback speed (`max(0.25, speed × 0.9)` years), then settle into a dim flat "scar" filtered by `DataFilterExtension` to `[start, time]`. **Ageing variant** (logging): the scar changes with age (bare ground → regrowth → young forest) by stacking copies of the layer, each one colour, with `filterRange` `[time − age, time]` and a `filterSoftRange` that fades it out on the GPU, so nothing is recoloured per frame. Big shape sets load on first show | fires, logging, construction, events with area |
| **Ripple at depth** | Points drawn at true depth (exaggerated ×3) with expanding surface shockwave rings | earthquakes, incidents |
| **Drill holes** | A line from the ground down to each item's real depth (exaggerated, with ×10/×30/×100 chips), coloured by a measured value, a dot at the bottom (hollow when the value is poor) and a tick for a level inside the hole; new items flash down their hole as the timeline passes them; the matching panel chart draws them side by side, shallowest to deepest | water wells, boreholes, mines |
| **Columns vs. normal** | `ColumnLayer` per station, height = value, colour = ratio to the station's own normal | river gauges, smoke days, counts |
| **Station colour** | Points/columns coloured on a diverging ramp (blue → grey → red) + warming-stripes chart | climate anomalies |
| **Surface** | Interpolated grid drawn to a bitmap, clipped to the outline, translucent, under labels; hatched for projections | hazard models, projections |
| **Place columns** | Extruded columns at each place, height/colour by the place metric; years interpolated between data points | population, prices, crime |
| **Glowing web** | Paths with additive glow, moving particles along them, routes coloured by effort | trails, roads, routes |
| **Beams** | Vertical columns of light sized by a real value | waterfalls, towers |
| **Water rise** | Low ground as translucent extruded cells that appear as a front sweeps in (`DataFilterExtension` with a soft range, the front read from the clock), a bright additive crest at the edge, and the water rising after; label the sweep as order, not timing, unless modelled times are published | tsunami, storm surge, sea-level rise |
| **Map-wide haze** | Full-map tint whose strength follows a regional average for the year | smoke, drought |
| **Hexagon field** | The region as extruded hexagons on a published grid (shrunk ~20% so seams show), height and colour by a measured value eased between periods, a soft additive glow under each, and gaps (or dark flat cells) where there is nothing; a chip row switches between measures | internet speeds, coverage, any gridded count |

Shared rules:

- Flat layers (ids matching `/scars|embers|base|stems/`) are re-inserted before the first basemap label layer; 3D columns stay on top.
- `NO_DEPTH` (`depthWriteEnabled: false, depthCompare: 'always'`) for overlays; an `ADDITIVE` blend preset for glows.
- Transitions on elevation/colour (~600ms, cubic-out) when values change.
- Data sorted by time once; `lowerBound()` slices the "active now" window each frame instead of filtering everything.

### 4.7 Basemap styling

- CARTO Dark Matter; hillshade from Terrarium DEM (exaggeration 0.55, shadow `#02040a`, highlight `rgba(150,175,215,.22)`, accent `#0b1424`, light from 315°) inserted **under the water layer** so the sea stays flat.
- Region outline as two lines: a wide blurred glow (`#4cc9f0`, width 10, blur 10, opacity .16) and a crisp line (`#8fdcff`, 0.8px, .5).
- Sky/fog: sky `#060a12`, horizon `#12233d`.
- Opening: start at a wide flat view, then `flyTo(HOME)` over 4.2s with curve 1.6 after the loader fades.
- `maxPitch: 75`, antialiasing on, compact attribution.

### 4.8 Motion

Menu in: 0.18s fade/slide down. Panel swap: fade + 6px rise. Ticker in: 0.4s springy rise. Play button pulse ring. Brand mark slow spin. Selected place: a white ring pulsing out every 1.6s. Event beacons: three staggered expanding white rings over 3.5s. Respect `prefers-reduced-motion` for full-screen views.

---

## Part 5 – App architecture

### 5.1 The layer contract

Every layer is one factory in `layers.ts` returning:

```ts
export type Ctx = { time: number; speed: number; data: Data; selected: string | null; hovered: string | null; focusedId: string; clock: number };
export type AtlasEvent = { t: number; layer: string; title: string; body: string; lon?: number; lat?: number; zoom?: number };
export type PanelHandle = { update: (ctx: Ctx) => void };

export interface AtlasLayer {
  id: string; name: string; icon: string; color: string;
  range: [number, number];          // timeline span for this layer
  monthly?: boolean;                // arrow keys step a month instead of a year
  static?: boolean;                 // doesn't change over time (see 5.3)
  period?: string;                  // caption for a static layer, e.g. "1981–2010 average"
  available: boolean;               // false if its JSON is missing
  unavailable?: string;             // what to run to get it
  build: (ctx: Ctx) => Layer[];     // deck.gl layers for this moment
  spark: () => { x: number; y: number; color?: string }[];  // timeline sparkline
  events: () => AtlasEvent[];       // data-driven events (e.g. record years)
  panel: (el: HTMLElement, ctx: Ctx) => PanelHandle;         // story panel; update() ~every 90ms
  tooltip: (info: PickingInfo) => string | null;
  click?: (info: PickingInfo) => boolean;
  // a live reading (5.9): the layer's range ends at today, the Now stop; `build` draws the reading there
  now?: { asOf: () => number | null; archiveEnd: number; build: (ctx: Ctx) => Layer[] };
}
```

Panel recipe for every layer: kicker (layer colour) → a **Right now** block for a layer with a live reading (5.9) → h2 → lede (what you're seeing, one or two sentences) → hero stats that update with time → one or two charts with a playhead → legend/ramp → callout for the key insight → note on caveats → source line. If unavailable: a dashed box saying which `npm run data <stage>` to run.

### 5.2 State and render loop

```ts
const state = {
  time, playing, speed,
  focused: 'base',            // the ACTIVE layer: its story in the panel, its timeline; 'base' = none active
  timeLayer: '<first time layer>',  // last active time-based layer; static layers leave it alone
  visible: new Set<string>(), // the layers switched on — exactly what's drawn (never contains 'base')
  selected, hovered,          // place keys
  mode: 'layer' | 'place' | 'finder' | 'deep',
  ranked, beacons,
};
```

One `requestAnimationFrame` loop: advance time when playing (`dt × speed`, stop at the end of the range), fire events crossed since last frame (ticker + beacon), `render()` (rebuild the deck layer list from visible layers + place pins/finder columns + selected ring + beacons), sync the timeline UI, update the panel every ~90ms.

### 5.3 Layer behaviour

**On the map vs. active.** Every layer has two independent facts, and the UI shows each in exactly one place:

| | Meaning | Shown by | Changed by |
|---|---|---|---|
| **On the map** | drawn on the map (any number of layers) | the row's switch | the switch, and nothing else turns a layer off |
| **Active** | its story is in the side panel and, if it's a time layer, the timeline is its (at most one) | the highlighted row and the picker button's name | clicking the row's name |

Rules, all in two functions (`setLayerOn(id, on)` for the switch, `focus(id)` for a name click) plus `clearMap()`:

1. **Switch on** → add to `visible`. If no layer is active, it also becomes active (so the first layer you turn on gives you its story and timeline straight away). Otherwise it's just added; the active layer doesn't change.
2. **Click a name** → make it active, switching it on if it was off. Other layers stay on; nothing is replaced. The menu closes.
3. **Switch off** → remove from `visible`. If it was the active layer, there's no active layer any more: stop playback, the panel and timeline drop it (`focus('base')`, which must not clear `visible`).
4. **Clear the map** (the top row while anything is on) → empty `visible`, stop playback, no active layer.
5. **No active layer but some on** → the picker reads "N layers on", the timeline shows "No layer picked", and the panel lists the layers that are on, each a click away from becoming active. Never show "Just the region" as selected while anything is on.
6. **Picker badge** `+N` = layers on the map besides the active one.
7. **Anything that opens a layer from elsewhere** (a map click on an overlay's feature, a link in a Place Report) calls `focus(id)`: it becomes active and every other layer stays on. A feature is clickable whenever its layer is on the map, not only while it's active; the exceptions are full-coverage rasters, which would swallow clicks meant for thin lines underneath, so they're pickable only while active.

- **Scenarios** (what if this closed?, `src/scenario.ts`): a layer whose stage keeps each place's few fastest sites by road (hospitals and courthouses keep three) lets the visitor close one or more of them, from a site's panel ("What if this closed?") or the panel's picker. Every place whose nearest site is closed falls back to its next kept one; one with none left is shown as "more than" its last kept drive, never estimated. The map redraws those places' routes (the closed one dashed red, the new one white), the closed site turns red, and the panel lists the places affected, worst first, with the added minutes. A dashed red **Scenario** banner stays on the map until cleared (`atlas:scenario` re-renders the layer's panel). Only drive time changes: never capacity or waits. The Place Report and the Finder never read a scenario, so they always show the real values.
- **Projections** (`AtlasLayer.projection`, `src/projections.ts`): a time layer whose record is followed by published model output runs its range on past the record (Climate: to 2100). From `projection.from` the timeline is hatched in red, the readout says "projection, not a record", the sparkline draws each scenario's range as a band on its own scale, the panel's chart (`bandChart`) hatches the projected years and draws a band per scenario with its median dashed, the panel shows a "Projection, not a record" badge, and the map draws ranges (a solid core for the low scenario inside a wire frame for the high one), never a single value. Projections never feed the Finder.
- **The Now stop** (layers with `now`, 5.9): the range ends at today and the track's max label reads **Now**. Focusing such a layer jumps to Now, so it opens on the reading. The span between the archive's last year and today is hatched on the sparkline, and the readout says "no record yet" there. At Now, `render()` adds `now.build(ctx)` on top of the layer's own `build`.
- **Static layers**: when the active layer is static, the timeline dims with a note; the timeline keeps the last active time layer's range, so time layers that are still on keep animating underneath.
- **Per-item values from a later stage** (a deep-finder measure added after the items were built) go in their own file in the items' order with a hash of their ids, loaded optionally; a mismatch leaves the values missing (the filter passes everything) rather than misaligned. This keeps parallel work off the big items file.
- **Place layers** draw their own columns, so plain place pins hide while one is on the map. Some static layers draw place columns only while active.
- **Events**: curated (`CURATED_EVENTS`) + each layer's `events()`. Diamonds on the track. Crossing one during playback shows the ticker and a beacon. A layer's **Key moments** list holds its own events, island-wide events in a time layer's years, and any island-wide event that names the layer in `layers` (how a static layer gets its historic story).
- **An event has its own panel** (`src/events.ts`), opened from a diamond, the ticker's Details, or the **Key moments** list each layer's panel ends with. The timeline stops at the event's date and the map flies there. Only `t`, `layer`, `title` and `body` are required; optional fields deepen the panel without touching it: `stats` (headline tiles), `sections` (heading + text), `image` (with credit), `sources` (links), `layers` (what "Show it on the map" switches on, at the event's date), `end` (for events that ran a while), and `detail(el)` for anything richer a layer wants to draw. The panel adds context for every event by itself: the layer year by year with the moment marked, **Also happening** (other layers' events within 18 months), the closest towns (each opens its report, and closing it comes back to the event), and earlier / later moments. Back returns to wherever the first event was opened from.
- **Everything on the map opens a panel on click, never just a hover bubble.** A town (its dot, or its column on any layer) opens its report; any other feature opens the event panel described above, as a record with no date when it's a place rather than a moment (`t` is optional). A layer gives its features rich panels with `describe(info) → AtlasEvent` (an earthquake's rank and depth, a gauge's or station's chart of its record via `detail`). A layer without `describe` still gets a panel built from its tooltip: the bold line becomes the title and each `<span class="tk">label</span> <span class="tv">value</span>` pair a headline tile, so keep tooltips in that shape. Tooltips end with "Click for details" unless they already say what a click does.
- **Hover** anything for a tooltip; **click** a place dot → Place Report.
- **A report can open a layer** ("See a century of logging on the map"): it dispatches `atlas:layer` with the layer id; main focuses it and, for a time layer, jumps to the end of its range (today), where the story the report summarised ends.
- **A layer's panel list can open one of its features** (Floodplains' study list): it dispatches `atlas:event` with an `AtlasEvent` (the same one `describe` returns for a click on the map), and main opens it with `openEvent`, so the list and the map lead to the same details panel.
- **A layer can frame the camera** (Weekend Reach): it dispatches `atlas:fly` with `{ bounds: [[w, s], [e, n]] }` and main fits the map to it, leaving room for the side panel.
- **A report can start a layer's own action** ("Light the campfires" in the Town Report): it dispatches `atlas:reach` with the place key; the camping layer focuses itself through `atlas:layer`, then starts its wave. Workday Reach's "Work in <place>?" (Town Report) and "🚗 Workday Reach" (Finder) call `startCommute(key)`, which sets the workplace and dispatches `atlas:layer`; the layer restarts its wave whenever the workplace or limit differs from the last one it rolled. `atlas:layer` from the Finder leaves the Finder (its columns go) for the layer's story; the layer's "Change what matters in the Town Finder" dispatches `atlas:finder`.

### 5.4 Place Report and Finder

- `metrics.ts` computes a `PlaceMetrics` per place from all data (nearest station within a reach, counts within a radius since a year, trailing medians, interpolated years). Record *which* station/area a value came from and how far away, and show it.
- `CRITERIA`: `{ id, label, hint, value(t), higherIsBetter, defaultWeight }`.
- `rankPlaces()`: **percentile-rank each criterion across places** (ties share the average rank, flip if lower is better), then a weighted average over criteria the place has data for. Score 0–1, shown 0–100.
- Finder panel: violet kicker, the headline question, lede, sliders (0–5, label + hint), preset chips, ranked list, note on how scores work. Weights persist in `localStorage` under `<atlas-id>:weights` (wrapped in try/catch).
- On the map: ranked places as violet→mint columns (`#2b1f6b → #7dffc4`), top 5 brighter, top 10 labelled "1 · Name".
- Clicking a place flies there, shows the pulsing ring, opens its report; closing returns to the ranking.

### 5.5 Deep finder (if in the brief)

Left rail (360px, glass, slides in) + bottom **funnel** + right result list:

- Huge gradient count of matches at the top; preset chips ("Our brief", "Show everything").
- Collapsible sections, each with an icon tile in its colour; every slider sits on a **histogram of the items that value would let through given all the other filters** (kept bars glow in `--c`, cut range hatched).
- Funnel: one stage per section showing count after that step with a bar; the step that cuts the most is flagged "tightest"; the last stage glows.
- Matches glow on the map and rank by a score; cards show rank, title, badges, mini meters, score ring.
- Item report: hero + score ring, radar of strengths, arcs to the places it relies on, satellite toggle, links out, shortlist star with notes and asking price (localStorage).
- In deep mode the timeline, layer picker and panel button hide.
- A measure added later by its own data stage goes in its own file beside the item file (`<deep>-<topic>.json`, in the item file's order with the item ids to check it), loaded optionally: stages stay independent and re-runnable, and the item file isn't rebuilt for every new measure.
- **Extra measures from another stage** go in a side file (e.g. `land-neighbours.json`) that follows the main file's item order and carries a hash of its id column; the finder loads it if present and checks the hash, so stages built in parallel never rewrite the main file, and a stale side file is ignored rather than misread. Its filters default to off, so the starting brief is unchanged.
- **Surroundings ring** (optional): a ring around the item, sectors × distance bands, each cell coloured by what covers most of it (park, public land, water, logging by age…), measured in the pipeline on a raster grid, with a key of shares.

### 5.6 Data & sources view

Full-screen overlay (`S`, `#sources`): left = intro (kicker, big title, lede, stat row: sources, records, years covered) and the metaphor visual drawn on a canvas, with an animated year counter at its centre; right = 420px card list grouped by layer. Each card: colour bar, name, status from `manifest.json` (ok/failed, updated date), publisher, linked dataset title, what it gives, **a count read from the loaded data** ("**12,431** fire perimeters"), the endpoint in mono, licence pill, and "See it on the map →". Then a "What the atlas works out itself" list of derived figures, a licence summary and a "Copy citation" button.

### 5.7 Navigation and keys

`L` layer menu · `Space` play/pause · `←/→` step a year (or month) · `P` panel · `S` sources · `Esc` closes. Hashes: `#sources`, `#<deep-finder>`, `#<feature layer>`. Inputs never capture shortcuts. Right-drag or Ctrl-drag tilts/rotates.

### 5.8 Film handle

When loaded with `?film`, expose `window.<atlasId> = { map, state, data, layers, focus, clearMap, openPlace, openFinder, openDeep, closeDeep, setPlaying, setTime, setPanelOpen, setMenu, showSources, HOME, setClosed, clearScenario }` for the video renderer only. `?film` also skips the live readings (5.9), so the film stays repeatable; add `&now` to load them while checking by hand.

### 5.9 Right now: live readings

A few hazard layers carry a reading of today next to their archive (Living Skies Atlas: river gauges, satellite hotspots, AQHI, and weather alerts drawn on those three). The site stays static: the live stages (Part 6) write `public/data/now/*.json`, not committed, and a scheduled workflow (Part 7) rebuilds and redeploys about hourly. `src/now.ts` holds the rules every live value follows:

- **Every value shows its age** ("40 minutes ago", Saskatchewan time on hover), and the tags keep themselves current. Older than 3 hours: greyed and labelled stale. Older than 24 hours: not drawn, and the block says the refresh may have stopped. Scheduled runs are late when GitHub is busy and stop after 60 days without activity, so nothing assumes freshness.
- A list whose window is longer than 3 hours (hotspots of the last 24 hours) takes its staleness from when the list was read; each item shows a plain age.
- The **Right now** block sits at the top of the layer's panel: the reading, its age, the alerts in effect that concern the layer (by name: floods and rain for rivers; fire, smoke, air quality, heat and wind for fires; smoke, air quality and heat for smoke), and the source link. With no live file: the dashed box, "run `npm run data now`".
- The Place Report gets a **Right now** group: the nearest gauge reporting (within 100 km), hotspots within 50 km, the AQHI (its own or borrowed, with the distance) and alerts covering the place.
- **The recent span**: a layer's `now.recent` (`RecentSpan`) draws the daily record between its archive and Now. It starts on the first day after the archive's last year, so a provisional day is never joined to the official record: when the archive publishes a year, that year's provisional days drop out of view by themselves (the files stay). Month files are fetched only when the timeline first enters the span (`ensureFeed`; `loadAll` never loads them). On the sparkline the hatch runs only up to the record's first day; the record is a dashed line on its own scale, broken where a day is missing; the readout shows the day with a dashed "provisional" badge, or "no reading" for a gap. An index is never charted with a count (AQHI draws on the map only, never on the smoke-day sparkline); hotspot counts never feed the fire statistics. A point-in-time static layer can show its record in its panel instead (Drinking water: advisories listed each day since the record began).
- **Outlooks** (`now-outlooks` and the AQHI forecast in `now-air`): published forecasts only, each shown with when it was issued and the time it is valid for, and dropped once that time has passed. The Place Report lists them under its Right now readings (air quality forecast, thunderstorm outlook, fire danger, wildfire smoke tomorrow); Wildfires and Smoke & air add a one-line province outlook to their Right now block.
- Live values never feed the Finder (point-in-time, like drinking-water advisories). An index (AQHI) never shares a chart with a count (smoke days). Alert text is escaped.

---

## Part 6 – Data pipeline

The pipeline is a set of **stages**, one per source, each its own module in `scripts/stages/`, with shared helpers in `scripts/lib/`. `scripts/fetch-data.mjs` is only the runner:

```js
// scripts/stages/fires.mjs
import { cached, fetchBuf, writeOut } from '../lib/io.mjs';
import { getProvince, inSask } from '../lib/places.mjs';
export default async function fires() { /* fetch, clip to outline, simplify, quantize, writeOut('fires', …) */ }

// scripts/fetch-data.mjs
const ORDER = ['base', 'places', /* …stages that others read come first… */];
for (const name of run) await (await import(`./stages/${name}.mjs`)).default();
```

A stage's file stays a few hundred lines at most; a helper two stages need moves to `scripts/lib/`.

- `npm run data` runs all in order; `npm run data fires crime` runs some.
- Helpers: `cached(name, producer)` (raw responses in `.cache/`), `fetchBuf(url, { retries: 3, timeout })` with backoff, `fetchJSON`, `cachedJSON`, `pool(items, size, fn)` for polite concurrency, paged readers for the common APIs (WFS, OGC API), `writeOut(name, data)` (compact JSON + KB log).
- Clip everything to the region outline (`onRegion(lon, lat, tolerance)`), simplify geometry, round coordinates to 4 dp, store arrays-of-tuples for big point sets (`[lon, lat, t, size, cat]`), keep times as fractional years.
- Every output includes a `source` string (publisher, dataset, licence).
- **A failing stage never breaks the others**: it's logged, the old file stays, and `manifest.json` records `{ ok, updated, lastError, lastAttempt }`, which the sources view shows.
- Rate-limited services (routing, point-query APIs): batch, sleep between calls, cache each response.
- Huge global files sorted by a spatial key (e.g. quadkey-sorted parquet): read only the region's rows with HTTP range requests and cache the clipped rows, never the whole file.
- Validate a response before caching it: a busy BC WFS answers HTTP 200 with an XML `ExceptionReport`, which a plain cache would keep forever. Parse it, check for `features`, retry with backoff.
- Area questions (share of land logged, what's next door) are answered on a raster: rasterize polygons onto a grid (scanline fill with per-row edge buckets) and count cells, so overlaps count once. Remove slivers (road allowances, trail corridors) from ownership masks with a morphological opening.
- Stages import the helpers they use from `scripts/lib/`; a stage that fills a memo other stages read (the place list) does it through a setter in that helper module, never by assigning another module's variable.
- Feeds that change seasonally (timetables) take the most common value over the next few weeks and fail with a clear message when the feed runs out.
- **The daily record** (5.9): `scripts/history.mjs` (`npm run data history`, after the live stages) rolls each live feed into `history/<feed>/<YYYY-MM>.json`, one file per feed per month, as daily roll-ups (per gauge per day: min, max, mean flow and the number of readings; per day: hotspots; per community per day: highest AQHI and hours reported; one row per alert and per advisory with first and last seen). Every file records `source`, its first and last run, the hours a run was counted each day and the days backfilled; `history/index.json` lists each feed's months, first and last day, gaps and days with few runs. It is safe to run twice in an hour: feeds that keep a window (gauges ~30 days, AQHI ~3 days) are recomputed for whole days, hotspots are de-duplicated by position and time, alerts and advisories are keyed. `npm run data history-backfill` reaches back once as far as each feed keeps (CWFIS keeps every season's hotspots). A missed run is a gap, never a zero.
- **Live stages** (5.9) are named `now-<name>`, write `now/<name>.json` with `asOf` (the newest reading; for a list of what is in effect, when it was read), `fetched`, `source`, `sourceUrl` and the licence, cache nothing, and record themselves in `now/manifest.json` (which the app merges with `manifest.json`), so running them never changes a committed file. `npm run data now` runs them all.
- **Projections** (the `projections` stage): published model output, kept as published (median and the models' spread per window and scenario), never recomputed or extrapolated; the app interpolates only between published windows and says so.
- Acceptance: `rm -rf .cache && npm run data` completes and `npm run build` passes.

---

## Part 7 – Security, quality and deployment

- `esc()` / `safeUrl()` in `src/html.ts` for anything not a literal.
- Build-only CSP meta tag via a Vite plugin: `default-src 'self'; script-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' data: blob: https:; object-src 'none'; base-uri 'self'; form-action 'none'`.
- GitHub Pages workflow: `permissions: {}` at the top; build job `contents: read`, `persist-credentials: false`, Node 22, `npm ci`, `npm run build`, upload `dist`; deploy job alone gets `pages: write` + `id-token: write`.
- The daily record (5.9) lives on a `data-history` branch, never on main. `live.yml`'s build job checks it out read-only into `public/data/history/` (a failed checkout of an existing branch fails the run, so the record is never restarted by accident), runs `npm run data history`, builds, and uploads the record as an artifact; an `archive` job, the only one with `contents: write`, runs no repository code: it downloads the artifact, copies it over the branch (additive: nothing is deleted) and pushes. `deploy.yml` ships the branch as it is. Retention: keep everything; revisit past 200 MB.
- Live readings (5.9): a second workflow, `live.yml`, the same shape, on an hourly `schedule` plus `workflow_dispatch`, in the same `pages` concurrency group. Before the stages run, both workflows download the `now/` files the site is serving, so a feed that is down keeps its last file; then `npm run data now` (plus any daily stage worth refreshing), build, deploy. Nothing is committed.
- Optional: rulesets for owner-only pushes and a protected `main`, `CODEOWNERS`.
- Dev container: Node 22, curl, `npm ci` into a `node_modules` volume, port 5173, `ATLAS_WATCH_POLL` for file watching from Windows.
- `tsc --noEmit` must pass; the page must log no errors (the video renderer fails on page errors).

---

## Part 8 – The explainer video

A narrated, step-by-step **how-to** film, recorded from the real built app by script, so it can be re-rendered after any change to the app or data.

### 8.1 Rules for the film

- The narration says **what to click and where**, in order. It doesn't comment on what the data shows.
- Every click, drag, scroll and key press is real; the app responds for real.
- Deterministic: a virtual clock steps one frame at a time (Playwright fake clock + `vt.js`, which pins CSS/Web Animations to that clock), so every run gives the same film on any machine.
- Numbers said aloud come from the app's data (`facts()` reads them through the film handle; lines use `{name}` placeholders).
- **Master at 2560×1440, plus a 1920×1080 copy. Never 4K.** 30 fps.
- Re-render after `npm run data`.

### 8.2 The stage

`video/stage/stage.html` is a 1920×1080 "set":

- **Background**: slow aurora — three huge blurred blobs (teal `#1d6f8f`, violet `#5b3cc4`, ember `#c4612a`) drifting over faint generated contour lines (`#7fb4ff`, 22%) on a deep navy radial gradient.
- **Window**: the app in an iframe (1600×900) inside a floating browser window — rounded 16px, traffic-light dots, a URL pill showing the site address, a cool outer glow. The **camera** zooms and pans this window (Screen Studio-style): `"fill"` (app fills the frame), `"rest"` (window floats on the background), or a target element/region.
- In the window (zoom with it): a **cursor** (arrow and hand), click **ripples**, a **spotlight** that dims everything but a target, and **pins** (labels on map points).
- In the HUD (don't zoom): **title** (rises word by word out of a blur), **chapter tag** ("Step 3 of 9" + title, slides in from the left in the step colour), **chips** (on-screen hints: icon, "Drag", "to move the map"), **stats** cards, **end card** (logo spin-up, tagline, address, fine print), fades and blackout.

`Stage` API: `camera, cursorShow, cursorAt, cursorTo, mouse, press, point, rect, spot, pin, clearPins, fade, blackout, title, hideTitle, chapter, hideChapter, chip, hideChip, stats, hideStats, end, url`.

### 8.3 The `Film` API (used by scenes)

`wait(ms)`, `wait_until(js)`, `say(line_id)`, `voice_done(pad)`, `sfx(name, gain, …)`, `mark(name)`, `js(stage_expr, arg)`, `run(app_expr, arg)`, `camera(target, ms, whoosh=…)`, `cursor(on)`, `move(target, ms)`, `click(target)`, `drag(start, end, ms, button)`, `key(name)`, `scroll(dy, ms)`, `board(title, why)` (a storyboard frame: real screenshot + note).

Targets: `{"sel": css, "text": substring, "nth": i, "at": [fx, fy], "grow": px}` for an element, `{"lnglat": [lon, lat]}` for a map point, `{"cx", "cy", "z"}` for a camera view.

Scene helpers in the storyboard: `step(f, n, title, colour)` (chapter tag + whoosh), `hint(f, icon, head, body, colour)` (chip + blip), `spot/unspot`, `range_at` / `weight_at` (exact points on sliders), `open_menu_and_pick(f, name)`.

### 8.4 A scene

```python
dict(id="timeline", title="Play the timeline", run=timeline,
     shows="Play, speed, pause, dragging the slider, clicking an event marker.",
     camera="Zoomed on the timeline; full-frame for the event.",
     motion="Real clicks and a slider drag.",
     sound="Clicks.",
     lines={"time-1": "History layers play on the timeline. Click play, or press the space bar.",
            "time-2": "Use Speed to choose how many years pass each second."})
```

`run(f)` pattern: `step(...)` → `f.say(line)` → spotlight/hint → real moves and clicks → `f.board(...)` → `f.voice_done()` → next line.

### 8.5 Standard storyboard (adapt names)

| # | Scene | What happens |
|---|---|---|
| – | Intro | Black; title "How to use {Atlas}" rises; fade up on the app at HOME. Glassy note, music pad fades in. |
| 1 | Find your way around | Cursor touches a few place dots; spotlight walks: Layer button → top-right buttons → side panel → timeline. |
| 2 | Move the map | Drag, scroll-zoom, right-drag tilt/turn, zoom onto the map buttons (chips for each gesture). |
| 3 | Show a data layer | Zoom onto the menu; open Layer (or `L`); explain groups; pick the headline layer; panel updates. |
| 4 | Play the timeline | Play, change speed, pause, drag the slider, click an event diamond → map jumps, the event's panel opens. |
| 5 | Switch, combine and clear | Flip a second layer's switch on (it joins the map); click its name (it becomes active, the first stays on); point at the `+1`; click "Clear the map". |
| 6 | Open a place's report | Hover a dot (name), click; map flies; scroll the report; close. |
| 7 | Rank places with the Finder | Open; drag one slider (ranking updates); click a preset; point at the columns; open a place; close twice. |
| 8 | Deep finder (if any) | Filters, the count, a slider, presets, open an item, shortlist, satellite, back, Shortlist tab, close. |
| 9 | See where the data comes from | Open sources; hover a source; "See it on the map". |
| 10 | Keyboard shortcuts | A chip for each key as it's pressed: L, Space, arrows, P, S, Esc. |
| – | End card | Window drifts back to rest; fade; soft impact; end card with tagline + address; "That's everything you need. Enjoy exploring."; blackout. |

Give each step its own colour (tour cyan `#4cc9f0`, map `#8fdcff`, layer = the layer's colour, place green `#3ecf8e`, finder violet `#a99bff`, deep finder teal `#5eead4`, sources cedar `#d8a06a`, keys amber `#ffb35c`). `STEPS` = the number of numbered scenes.

**Supplemental films** for big features (`video/storyboard_<film>.py`, `--film <film>`): same voice and style, line ids prefixed (e.g. `tw-`) so cached narration never clashes, 5–8 steps on just that feature and where it appears elsewhere (reports, finders).

**A film per layer, and an overview** (`video/storyboard_layers.py`, `--film layer-<id>`, `--film overview`, `--film all`):

- **Layer film** (about a minute): title with a one-line hook → open the Layer menu and click the layer's name → three headline numbers count up while the narration says them → one or two **wow scenes**, the thing only this layer can show (a century played in seconds with a slow orbit; a tilt that reveals depth; an event marker clicked; chips that reshape the map) → zoom on the side panel → end card pointing to the overview.
- **Overview**: title → how the menu and timeline work → a few seconds per layer (its own moment, with a chip naming its film) → places and the finders → end card: "every layer has its own film".
- **Nothing hard-coded about the layer list.** A facts script (`video/layer_facts.js`) runs in the app before filming: it computes the narration's numbers and draws every layer's panel off-screen to read its name, headline, first sentence, four headline numbers and timeline events. The overview and `--film all` are built from that list, and a layer with no hand-written spec gets a generic film and overview moment from it. So a layer added later appears in the overview and gets a film with no film code; write a spec to give it a real hook and wow scene.
- Narration numbers come from the data or the panel's own headline numbers, so the voice never disagrees with the screen. Counters only take whole numbers; say decimals in the narration instead.
- During playback at a year a second or faster, hide the event ticker so it doesn't flicker through every event crossed; keep it for slow playback through a single event. After clicking a marker in a film, tap Back before reading the layer's own panel.
- `video/films.json` maps film names to their published links; every description links to the overview and the overview lists every layer film.

### 8.6 Sound and voice

- **Voice**: Kokoro (`kokoro-onnx`) running locally, voice `af_heart`, speed 0.98. `spoken()` rewrites symbols for speech ("3D" → "three-D", "→" → "to"); a `SOUNDS` dict fixes mispronunciations at the phoneme level. Each line is cached by text hash in `video/out/vo/` and regenerated only when its text changes. A real recording at `video/out/vo/recorded/<line-id>.wav` replaces it and the picture retimes to fit.
- **Sound effects** (synthesized in `sfx.py`, no samples): `click`, `whoosh` (panned), `riser`, `impact`, `blip(note)`.
- **Music**: a synthesized ambient pad bed with reverb that **ducks under the voice**, fading in at the intro and out at the end.

### 8.7 Outputs (`video/out/`)

`<name>.mp4` (1440p, x264 slow CRF 17, BT.709 tagged), `<name>-1080p.mp4`, `storyboard.html` (every board frame with scene title, shows/camera/motion/sound, narration), `script.md` (line ids + text), `.srt` captions, `youtube.txt` (title, description with chapters timestamps and a link to the live site).

Commands:

```bash
.venv/Scripts/python.exe video/render.py --storyboard   # storyboard page, script, captions, YouTube text
.venv/Scripts/python.exe video/render.py --preview      # quick 960×540 cut with sound
.venv/Scripts/python.exe video/render.py                # 1440p master + 1080p copy
```

Options: `--only <scene ids>`, `--start <scene>`, `--stills 10,60`, `--url`, `--no-build`, `--video-only`, `--film <name>`. The renderer builds the app, serves `dist/` locally, opens the stage in Edge, and fails if the page logs errors.

---

## Part 9 – Build order for Claude

Do one milestone at a time; each ends with `npm run build` passing and the app checked in the browser.

1. **Scaffold**: Vite + TS, `index.html` shell, `style.css` tokens and components (Part 4), map with basemap, hillshade, outline glow, loader and intro flight. Empty layer menu with "Just the region" (becomes "Clear the map" once anything is on). Place dots with tooltips.
2. **Pipeline skeleton**: `fetch-data.mjs` helpers, `base` and `places` stages, manifest. Prove from an empty cache.
3. **First time layer** end to end: stage → JSON → `AtlasLayer` (map, sparkline, panel with chart + playhead, tooltip) → timeline play/scrub/speed/keys.
4. **Events**: curated + data-driven, diamonds, the ticker, beacons, and the event panel.
5. **Remaining layers** from the brief, one per step; static-layer support when the first static one arrives; the on-the-map vs. active rules of §5.3 and `+N`.
6. **Place Report** (metrics) → **Place Finder** (criteria, ranking, presets, columns, localStorage).
7. **Data & sources** view with the chosen metaphor.
8. **Deep finder** (if in the brief).
9. **Security and deploy**: `esc`/`safeUrl` audit, CSP plugin, Pages workflow, dev container.
10. **README** (features table, tech, getting started, refreshing data, deploying, the video, data sources table, caveats) and **ROADMAP** (suggested build order table with effort, ✅ for built items, *(verify)* on unconfirmed sources, "Still open" lists).
11. **Explainer film**: stage, `vt.js`, `render.py`, `sfx.py`, `storyboard.py` with the standard scenes; render `--storyboard`, then `--preview`, then the 1440p master.

## Part 10 – Done checklist

- [ ] Opens on just the region; intro flight; no console errors.
- [ ] Every layer has map visuals, a sparkline (or static note), a full panel with a source line, and tooltips.
- [ ] Projections and estimates are visibly marked; ranges shown for model output.
- [ ] Place Report covers every layer that has a per-place meaning; Finder ranks with percentile scoring and saves weights.
- [ ] Sources view counts records from the loaded data and shows pipeline status.
- [ ] `rm -rf .cache && npm run data` works with no manual steps; a broken source doesn't break the rest.
- [ ] All outside text escaped; CSP present in the build; deploy workflow least-privilege.
- [ ] Usable at phone width (panel docks above the timeline).
- [ ] Layer menu: a switch only turns a layer on or off; a name click makes it active without turning others off; switching off the active layer drops its timeline; "Just the region" is never highlighted while a layer is on; overlay features are clickable.
- [ ] Film renders at 1440p + 1080p with storyboard, script, captions and YouTube text; narration only says where to click.
