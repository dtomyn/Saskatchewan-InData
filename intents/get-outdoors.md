# Get outdoors

**Who:** residents and would-be residents who want lakes, parks and campgrounds within a weekend's drive.

**The question:** Where can we camp from here this weekend, and where is the sky dark?

## What answers it

- **⛺ Camping & rec**: park outlines, campgrounds as flickering campfires, drive-time columns, and park report cards.
- **Weekend Reach**: arcs to every campground within 1–4 h of a place, with a live count against the median place.
- **☾ Light & dark**: RASC dark-sky preserves and the drive to the nearest campground in one.
- **Town Report** Campground and Parks nearby rows; Finder: Close to camping.

## How

Turn on Camping & rec, click a place and start Weekend Reach; click a park for its card.

## What it cannot tell you

- Campgrounds outside national parks come from OpenStreetMap and can be missing; provincial park campgrounds have no open point dataset.
- Seasons, closures and bookings are not in the data.
- The rolling ring is a guide; the arcs are the drive times.

## Check it

```js
atlas.clearMap(); atlas.focus('camping')
atlas.openTown('prince albert')
```
