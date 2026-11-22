// Streaming GeoJSON out of a zip: one feature at a time, so a 160 MB FeatureCollection written on one line is never
// held as objects all at once.

import { createReadStream } from 'node:fs';
import { Unzip, UnzipInflate } from 'fflate';

/**
 * Calls `onFeature(feature)` for every feature of the FeatureCollection(s) in the zip whose entry names pass `want`.
 * Features are cut out of the text by bracket depth (outside strings) and parsed one by one: a feature is an object
 * three levels down (the collection, its `features` array, the feature).
 */
export function zipFeatures(file, want, onFeature) {
  return new Promise((resolve, reject) => {
    const uz = new Unzip();
    uz.register(UnzipInflate);
    let open = 0, ended = false, failed = false;
    const fail = (e) => { if (!failed) { failed = true; rs.destroy(); reject(e); } };
    const settle = () => { if (ended && !open && !failed) resolve(); };
    uz.onfile = (f) => {
      if (!want(f.name)) return;
      open++;
      const dec = new TextDecoder('utf-8');
      let depth = 0, inStr = false, esc = false, parts = null, from = 0;
      f.ondata = (err, chunk, final) => {
        if (err) return fail(err);
        const s = dec.decode(chunk, { stream: !final });
        from = 0;
        try {
          for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            if (inStr) {
              if (esc) esc = false;
              else if (c === 92) esc = true; // backslash
              else if (c === 34) inStr = false;
              continue;
            }
            if (c === 34) inStr = true;
            else if (c === 123 || c === 91) { // { [
              depth++;
              if (c === 123 && depth === 3) { parts = []; from = i; }
            } else if (c === 125 || c === 93) { // } ]
              if (c === 125 && depth === 3 && parts) {
                parts.push(s.slice(from, i + 1));
                onFeature(JSON.parse(parts.join('')));
                parts = null;
              }
              depth--;
            }
          }
          if (parts) { parts.push(s.slice(from)); from = 0; }
        } catch (e) { return fail(e); }
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
