import { BBOX, OGC, OUT } from '../lib/config.mjs';
import { asJSON, fetchBuf, log, readOut, round } from '../lib/io.mjs';
import { getProvince, inSask } from '../lib/places.mjs';

/** What scripts/history.mjs is handed (it stays free of the pipeline's modules). */
export const historyHelpers = () => ({ log, fetchBuf, asJSON, OGC, BBOX, OUT, readOut, inSask, getProvince, round });

// The daily record of the live feeds (scripts/history.mjs; plans/digital-twin/2-accumulated-state.md). Run only when
// named: `history` rolls today in, `history-backfill` (stages/history-backfill.mjs) also reaches back as far as each
// feed keeps. Both read the live files, so run them after `now`.
export default async function history() {
  const { history: roll } = await import('../history.mjs');
  await roll(historyHelpers());
}
