// Logging, downloads with retries, the .cache/ store and writing public/data/.

import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Unzip, UnzipInflate } from 'fflate';
import { CACHE, OUT, UA } from './config.mjs';

export const log = (...a) => console.log('·', ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const round = (v, d = 4) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Writes through a `.part` file and a rename, so a run stopped mid-write never leaves a truncated file behind. */
export async function writeAtomic(file, data) {
  await fs.writeFile(`${file}.part`, data);
  await fs.rename(`${file}.part`, file);
}

/** A cache file's path; a name (some come from a server: a download's file name) never reaches outside .cache/. */
function cachePath(name) {
  const file = path.resolve(CACHE, name);
  if (!file.startsWith(path.resolve(CACHE) + path.sep)) throw new Error(`cache name outside .cache/: ${name}`);
  return file;
}

export async function cached(name, producer, valid) {
  const file = cachePath(name);
  try {
    const buf = await fs.readFile(file);
    // a file cached before a check existed (or by an older run) that fails it is fetched again
    if (valid && !valid(buf)) throw new Error('cached file failed its check');
    return buf;
  } catch {
    const buf = await producer();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeAtomic(file, buf);
    return buf;
  }
}

/** A large download streamed straight to a file in the cache (not held in memory); returns its path. */
export async function cachedFile(name, url, { timeout = 1_800_000 } = {}) {
  const file = cachePath(name);
  try { await fs.access(file); return file; } catch { /* not cached yet */ }
  await fs.mkdir(path.dirname(file), { recursive: true });
  log(`  downloading ${url} …`);
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${file}.part`));
  await fs.rename(`${file}.part`, file);
  return file;
}

/** Streams the text files in a zip whose names pass `want`, line by line, without unpacking it to memory or disk. */
export function zipLines(file, want, onLine) {
  return new Promise((resolve, reject) => {
    const uz = new Unzip();
    uz.register(UnzipInflate);
    let open = 0, ended = false, failed = false;
    const fail = (e) => { if (!failed) { failed = true; rs.destroy(); reject(e); } };
    const settle = () => { if (ended && !open && !failed) resolve(); };
    uz.onfile = (f) => {
      if (!want(f.name)) return;
      open++;
      const dec = new TextDecoder();
      let rest = '';
      f.ondata = (err, chunk, final) => {
        if (err) return fail(err);
        const lines = (rest + dec.decode(chunk, { stream: !final })).split('\n');
        rest = final ? '' : lines.pop();
        try { for (const l of lines) if (l.trim()) onLine(l.replace(/\r$/, ''), f.name); } catch (e) { return fail(e); }
        if (final) { open--; settle(); }
      };
      f.start();
    };
    const rs = createReadStream(file, { highWaterMark: 1 << 20 });
    rs.on('data', (c) => { try { uz.push(new Uint8Array(c.buffer, c.byteOffset, c.length)); } catch (e) { fail(e); } });
    rs.on('end', () => { try { uz.push(new Uint8Array(0), true); } catch (e) { return fail(e); } ended = true; settle(); });
    rs.on('error', fail);
  });
}

/** `maxBytes` bounds the answer (read as it arrives): a larger one fails at once, without a retry. */
export async function fetchBuf(url, { retries = 3, timeout = 180_000, method, body, headers, maxBytes } = {}) {
  const tooBig = () => Object.assign(new Error(`more than ${maxBytes} bytes from ${url.slice(0, 140)}`), { final: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method, body, headers: { ...UA, ...(headers ?? {}) }, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url.slice(0, 140)}`), { status: res.status });
      if (!maxBytes) return Buffer.from(await res.arrayBuffer());
      if (+res.headers.get('content-length') > maxBytes) throw tooBig();
      const parts = [];
      let n = 0;
      for await (const c of res.body) { n += c.length; if (n > maxBytes) throw tooBig(); parts.push(c); }
      return Buffer.concat(parts);
    } catch (e) {
      if (e.final || attempt >= retries) throw e;
      await sleep((e.status === 429 ? 10000 : 1500) * attempt);
    }
  }
}

/** Parses JSON and refuses HTML error pages, so a bad answer is never cached. */
export const asJSON = (buf, what) => {
  const s = buf.toString('utf8');
  if (/^\s*</.test(s)) throw new Error(`${what}: got HTML, not JSON`);
  return JSON.parse(s);
};
/** `check(json)` may throw to refuse an answer (an error in a 200, say) before it is cached. */
export const cachedJSON = async (name, url, { check, ...opts } = {}) => asJSON(await cached(name, async () => { const b = await fetchBuf(url, opts); check?.(asJSON(b, name)); return b; }), name);

export async function writeOut(name, data) {
  await fs.mkdir(OUT, { recursive: true });
  const text = JSON.stringify(data);
  await writeAtomic(path.join(OUT, `${name}.json`), text);
  log(`wrote ${name}.json (${(text.length / 1024).toFixed(0)} KB)`);
}
export const readOut = async (name) => JSON.parse(await fs.readFile(path.join(OUT, `${name}.json`), 'utf8'));

export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

export async function writeNow(name, data) {
  await fs.mkdir(path.join(OUT, 'now'), { recursive: true });
  const text = JSON.stringify(data);
  await writeAtomic(path.join(OUT, 'now', `${name}.json`), text);
  log(`wrote now/${name}.json (${(text.length / 1024).toFixed(0)} KB)`);
}
