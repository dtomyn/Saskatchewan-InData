import { strFromU8, unzipSync } from 'fflate';
import { asJSON, cached, fetchBuf, log, readOut, round, writeOut } from '../lib/io.mjs';
import { getPlaces } from '../lib/places.mjs';
import { normalizeName } from '../places.mjs';

// Property tax. The Ministry of Government Relations' Mill Rate Survey Results (Publications Centre product 72573, one
// workbook a year, Crown copyright): every city, town, village and northern municipality's uniform municipal mill
// rate, its residential mill rate factor, whether it uses base or minimum tax, and the school (education) levy on
// residential assessment. The Publications Centre is sometimes down (HTTP 502); then the product list and workbook come
// from the Internet Archive's copy of the same URLs. Columns are found by their header text, as the sheets differ.
// The indicative tax on each place's 2021 census median home: value × 80 % (residential percentage of value) ×
// (factored residential municipal mill rate + residential education mill rate) ÷ 1000. Base tax, minimum tax, library
// and special levies are not added. Reads housing.json for the median value.
export default async function tax() {
  const PRODUCT = 'https://publications.saskatchewan.ca/api/v1/products/72573';
  const PAGE = 'https://www.saskatchewan.ca/government/municipal-administration/taxation-and-service-fees/mill-rate-returns';
  const POV = 0.8;
  const POV_SRC = 'https://www.saskatchewan.ca/government/news-and-media/2020/december/04/property-tax-percentages-of-value-updated-for-2021';
  const { gunzipSync } = await import('node:zlib');
  const wayback = (u) => `https://web.archive.org/web/2026id_/${u}`;
  const unz = (b) => (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b);
  let product, via = 'Publications Centre';
  try { product = asJSON(await fetchBuf(PRODUCT, { retries: 2, timeout: 60_000, headers: { Accept: 'application/json' } }), 'mill rate product'); } catch (e) {
    log(`  Publications Centre unavailable (${e.message}); using the Internet Archive's copy of the product list`);
    product = asJSON(unz(await fetchBuf(wayback(PRODUCT), { timeout: 120_000 })), 'archived mill rate product');
    via = 'Internet Archive copy of the Publications Centre';
  }
  const fmts = product.productFormats
    .map((f) => ({ id: f.productFormatId, year: Number(/^(\d{4})/.exec(f.description ?? '')?.[1]), file: f.digitalAttributes?.fileName }))
    .filter((f) => f.year && /\.xlsx$/i.test(f.file ?? ''))
    .sort((a, b) => b.year - a.year);
  if (!fmts.length) throw new Error('no yearly workbooks listed in the mill rate product');
  const latest = fmts[0];
  const DL = `${PRODUCT}/formats/${latest.id}/download`;
  const isZip = (b) => b[0] === 0x50 && b[1] === 0x4b;
  const book = await cached(`tax/${latest.file}`, async () => {
    for (const u of [DL, wayback(DL)]) {
      try { const b = unz(await fetchBuf(u, { retries: 2, timeout: 300_000 })); if (isZip(b)) return b; log(`  ${u.slice(0, 60)}… did not return a workbook`); } catch (e) { log(`  ${u.slice(0, 60)}… ${e.message}`); }
    }
    throw new Error(`could not download ${latest.file}`);
  });
  log(`  ${latest.year} survey: ${latest.file} (${(book.length / 1e6).toFixed(1)} MB)`);

  // --- a minimal xlsx reader: shared strings plus each sheet's rows as { column index: text }
  const z = unzipSync(new Uint8Array(book), { filter: (f) => /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(f.name) });
  const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const ss = [...strFromU8(z['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rels = Object.fromEntries([...strFromU8(z['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?(xl\/)?/, 'xl/')]));
  const sheets = [...strFromU8(z['xl/workbook.xml']).matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map((m) => ({ name: dec(m[1]), file: rels[m[2]] }));
  const colIx = (s) => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  const readSheet = (file) => {
    const rows = {};
    for (const r of strFromU8(z[file]).matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const o = {};
      for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = /t="(\w+)"/.exec(c[2])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1];
        const val = t === 's' ? ss[+v] : t === 'inlineStr' ? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1] : v;
        if (val != null && String(val).trim() !== '') o[colIx(c[1])] = dec(String(val)).trim();
      }
      rows[+r[1]] = o;
    }
    return rows;
  };
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

  // municipal sheets: Cities, Towns, Villages, North (row 2 = section headers, row 3 = column headers, col C status, col D name)
  const norm = (s) => normalizeName(s.replace(/\(SK Only\)/i, '').replace(/^city of /i, '').replace(/^town of /i, '')).replace(/[^a-z]/g, '');
  const places = await getPlaces();
  const want = new Map(places.map((p) => [norm(p.name), p]));
  const found = {};
  const STATUS = new Set(['C', 'T', 'NT', 'V', 'NV']);
  for (const sh of sheets.filter((s) => /^(city|cities|towns?|villages?|north)/i.test(s.name))) {
    const rows = readSheet(sh.file);
    const sec = Object.entries(rows[2] ?? {}).map(([k, v]) => [+k, v]).sort((a, b) => a[0] - b[0]);
    const hdr = rows[3] ?? {};
    const col = (section, sub) => {
      const i = sec.findIndex(([, v]) => v.toLowerCase().startsWith(section.toLowerCase()));
      if (i < 0) return null;
      const lo = sec[i][0], hi = sec[i + 1]?.[0] ?? Infinity;
      const hit = Object.entries(hdr).find(([k, v]) => +k >= lo && +k < hi && v.toLowerCase().startsWith(sub.toLowerCase()));
      return hit ? +hit[0] : null;
    };
    const C = {
      uniform: +Object.entries(hdr).find(([, v]) => /^uniform municipal mill rate/i.test(v))?.[0],
      base: +Object.entries(hdr).find(([, v]) => /^base tax$/i.test(v))?.[0],
      min: +Object.entries(hdr).find(([, v]) => /^min tax$/i.test(v))?.[0],
      mrf: col('Municipal Mill Rate Factors', 'Residential'),
      fac: col('Factored Municipal Mill Rate', 'Residential'),
      sA: col('School Taxable Assessment', 'Residential'),
      sL: col('School Tax Levy', 'Residential'),
      mA: col('Municipal Taxable Assessment', 'Residential'),
    };
    if (!C.uniform || !C.sA || !C.sL) { log(`  sheet ${sh.name}: columns not found, skipped`); continue; }
    for (const [n, r] of Object.entries(rows)) {
      if (+n <= 3 || !r[4] || !STATUS.has(r[3])) continue;
      const p = want.get(norm(r[4]));
      if (!p || found[p.key]) continue;
      const uniform = num(r[C.uniform]);
      if (uniform == null || uniform <= 0) continue;
      const f = num(r[C.mrf]);
      const factored = num(r[C.fac]) || (f ? uniform * f : uniform);
      const sA = num(r[C.sA]), sL = num(r[C.sL]);
      found[p.key] = {
        n: r[4], s: r[3], mr: round(uniform, 4), f: f && f !== 1 ? round(f, 4) : undefined, r: round(factored, 4),
        e: sA && sL ? round((sL / sA) * 1000, 2) : null,
        bt: /^y/i.test(r[C.base] ?? '') || undefined, mt: /^y/i.test(r[C.min] ?? '') || undefined,
      };
    }
  }
  const missing = places.filter((p) => !found[p.key]).map((p) => p.name);
  log(`  ${Object.keys(found).length} of ${places.length} places matched${missing.length ? `; not found: ${missing.join(', ')}` : ''}`);

  // the province sets the residential education mill rate: the typical per-place school levy ÷ assessment
  const eds = Object.values(found).map((o) => o.e).filter((v) => v != null).sort((a, b) => a - b);
  const edu = eds[Math.floor(eds.length / 2)];
  let housing = null;
  try { housing = await readOut('housing'); } catch { log('  housing.json missing: no indicative tax'); }
  for (const [k, o] of Object.entries(found)) {
    // Lloydminster is assessed under its own charter (Alberta-style, its own education rate): not comparable
    if (k === 'lloydminster') { o.x = 1; continue; }
    if (o.e != null && Math.abs(o.e - edu) > 0.3) log(`  ${o.n}: residential school levy works out to ${o.e} mills (province ${edu})`);
    const v = housing?.census?.[k]?.value;
    if (v) { o.v = v; o.tax = Math.round((v * POV * (o.r + edu)) / 1000); }
  }
  await writeOut('tax', {
    source: `Government of Saskatchewan, Ministry of Government Relations, ${latest.year} Municipal Mill Rate Survey Results (${latest.file}), via the ${via}`,
    sourceUrl: PAGE, year: latest.year, edu, pov: POV, povSource: POV_SRC,
    places: found,
  });
}
