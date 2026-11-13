#!/usr/bin/env node
// Living Skies Atlas data pipeline.
// Pulls open data for Saskatchewan from public government APIs (and OpenStreetMap), clips it to the
// province, and writes compact JSON files to public/data/ for the static web app.
//
//   node scripts/fetch-data.mjs                 # all stages
//   node scripts/fetch-data.mjs fires crime     # selected stages
//   node scripts/fetch-data.mjs now             # the four live stages (now-rivers, now-fires, now-air, now-alerts)
//   node scripts/fetch-data.mjs now history     # …and roll them into the daily record (public/data/history/)
//
// Raw downloads are cached in .cache/ so re-runs are quick. Delete it to force a refresh.
//
// Each stage is a module in scripts/stages/<name>.mjs whose default export does the work; shared helpers live in
// scripts/lib/. Stages are loaded only when they run.

import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT } from './lib/config.mjs';
import { log } from './lib/io.mjs';

/** The live stages, which `npm run data now` runs. */
const NOW_STAGES = ['now-rivers', 'now-fires', 'now-air', 'now-alerts', 'now-outlooks'];
/** The daily record (stages/history.mjs): run only when named, after `now`. */
const ON_REQUEST = ['history', 'history-backfill'];
/** Stages whose run is recorded in public/data/now/manifest.json (not committed), not in manifest.json. */
const LIVE_STAGES = [...NOW_STAGES, ...ON_REQUEST];

/** Run order: a stage comes after the stages whose output it reads (CLAUDE.md lists who reads what). */
const ORDER = [
  'province', 'places', 'subdivisions', 'tracts',
  'fires', 'tornadoes', 'hail', 'rivers', 'floods', 'climate', 'smoke', 'drought', 'crops', 'normals', 'projections',
  'population', 'crime', 'housing', 'tax', 'jobs', 'needs', 'treaties', 'justice', 'hospitals', 'camping', 'schools',
  'internet', 'community', 'newcomer', 'doctors', 'childcare', 'industry', 'power', 'water', 'radon', 'light',
  'transit', 'commute',
  ...NOW_STAGES, ...ON_REQUEST,
];

// `now` stands for the live stages
const wanted = process.argv.slice(2).flatMap((n) => (n === 'now' ? NOW_STAGES : [n]));
const unknown = wanted.filter((n) => !ORDER.includes(n));
if (unknown.length) { console.error(`Unknown stage(s): ${unknown.join(', ')}`); process.exit(1); }
const run = wanted.length ? ORDER.filter((n) => wanted.includes(n)) : ORDER.filter((n) => !ON_REQUEST.includes(n));
const stageUrl = (name) => new URL(`./stages/${name}.mjs`, import.meta.url);

// The live stages keep their own manifest beside their files (public/data/now/, not committed), so the committed
// manifest.json never changes just because the live stages ran.
const readManifest = async (file) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return {}; } };
const MANIFEST = path.join(OUT, 'manifest.json'), NOW_MANIFEST = path.join(OUT, 'now', 'manifest.json');
const manifests = { main: await readManifest(MANIFEST), now: await readManifest(NOW_MANIFEST) };

let failures = 0;
for (const name of run) {
  const t0 = Date.now();
  const manifest = LIVE_STAGES.includes(name) ? manifests.now : manifests.main;
  console.log(`\n▶ ${name}`);
  try {
    const { default: stage } = await import(stageUrl(name));
    await stage();
    manifest[name] = { ok: true, updated: new Date().toISOString() };
    log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    failures++;
    manifest[name] = { ...(manifest[name] ?? {}), ok: manifest[name]?.ok ?? false, lastError: e.message, lastAttempt: new Date().toISOString() };
    console.error(`✖ ${name} failed: ${e.message}`);
  }
}
await fs.mkdir(OUT, { recursive: true });
if (run.some((n) => !LIVE_STAGES.includes(n))) await fs.writeFile(MANIFEST, JSON.stringify(manifests.main, null, 2));
if (run.some((n) => LIVE_STAGES.includes(n))) {
  await fs.mkdir(path.dirname(NOW_MANIFEST), { recursive: true });
  await fs.writeFile(NOW_MANIFEST, JSON.stringify(manifests.now, null, 2));
}
console.log(failures ? `\nFinished with ${failures} failed source(s).` : '\nAll sources fetched.');
