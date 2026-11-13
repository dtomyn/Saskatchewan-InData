import { historyHelpers } from './history.mjs';

// `history`, reaching back once as far as each feed keeps (gauges ~30 days, AQHI ~3 days, CWFIS hotspots the season).
export default async function historyBackfill() {
  const { history: roll } = await import('../history.mjs');
  await roll(historyHelpers(), { backfill: true });
}
