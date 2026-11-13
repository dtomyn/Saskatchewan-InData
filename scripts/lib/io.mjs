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

export async function cached(name, producer) {
  const file = path.join(CACHE, name);
  try {
    return await fs.readFile(file);
  } catch {
    const buf = await producer();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
  }
}

/** A large download streamed straight to a file in the cache (not held in memory); returns its path. */
export async function cachedFile(name, url, { timeout = 1_800_000 } = {}) {
  const file = path.join(CACHE, name);
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

export async function fetchBuf(url, { retries = 3, timeout = 180_000, method, body, headers } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method, body, headers: { ...UA, ...(headers ?? {}) }, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url.slice(0, 140)}`), { status: res.status });
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= retries) throw e;
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
export const cachedJSON = async (name, url, opts) => asJSON(await cached(name, async () => { const b = await fetchBuf(url, opts); asJSON(b, name); return b; }), name);

export async function writeOut(name, data) {
  await fs.mkdir(OUT, { recursive: true });
  const text = JSON.stringify(data);
  await fs.writeFile(path.join(OUT, `${name}.json`), text);
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
  await fs.writeFile(path.join(OUT, 'now', `${name}.json`), text);
  log(`wrote now/${name}.json (${(text.length / 1024).toFixed(0)} KB)`);
}
