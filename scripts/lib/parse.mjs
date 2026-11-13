// Small text parsers: CSV, fractional years, and the province's advisory PDFs.

import { unzlibSync } from 'fflate';

export const parseCSVLine = (l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')).slice(0, -1);
export const parseCSV = (text) => {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const h = parseCSVLine(lines[0]).map((x) => x.trim());
  return lines.slice(1).map((l) => Object.fromEntries(parseCSVLine(l).map((v, i) => [h[i], v.trim()])));
};

export const fracYear = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  const y = d.getUTCFullYear();
  return y + (d - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
};
export const ymdFrac = (y, m, d) => (m ? fracYear(`${y}-${String(m).padStart(2, '0')}-${String(d || 15).padStart(2, '0')}T12:00:00Z`) : y + 0.55);

/** Text items {page, x, y, s} from a simple PDF: Flate-compressed page streams, text placed with `Tm` and drawn with
 * `Tj` in standard (WinAnsi) fonts, as the province's OpenPDF reports are. Not a general PDF reader. */
export function pdfText(buf) {
  const s = buf.toString('latin1');
  const items = [];
  const re = /stream\r?\n/g;
  let m, page = 0;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = s.indexOf('endstream', start);
    let out;
    try { out = Buffer.from(unzlibSync(buf.subarray(start, end))).toString('latin1'); } catch { continue; }
    if (!/\bBT\b/.test(out)) continue;
    page++;
    let x = 0, y = 0, t;
    const tok = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm|\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    while ((t = tok.exec(out))) {
      if (t[1] != null) { x = +t[5]; y = +t[6]; continue; }
      const str = t[7].replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? (/^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c)));
      if (str.trim()) items.push({ page, x, y, s: str });
    }
  }
  return items;
}

/** The rows of a "PDWA and EBWO currently in effect" report. Each row has one `1` in the PDWA or EBWO column; a row
 * runs from its mark down to the next one (or onto the next page). Columns by x: name, date (and health region),
 * title, marks, comments. */
export function advisoryRows(buf) {
  const items = pdfText(buf);
  const rows = [];
  const pages = items.length ? Math.max(...items.map((i) => i.page)) : 0;
  for (let p = 1; p <= pages; p++) {
    const its = items.filter((i) => i.page === p && i.y < 440 && i.y > 40);
    const marks = its.filter((i) => i.x >= 480 && i.x < 550 && i.s.trim() === '1').sort((a, b) => b.y - a.y);
    const bands = marks.map((mk, k) => ({ top: mk.y + 4, bottom: k + 1 < marks.length ? marks[k + 1].y + 4 : 0, kind: mk.x < 515 ? 'PDWA' : 'EBWO', items: [] }));
    for (const i of its) {
      if (i.x >= 480 && i.x < 550) continue;
      const b = bands.find((b) => i.y <= b.top && i.y > b.bottom);
      if (b) b.items.push(i);
      else if (rows.length) rows[rows.length - 1].items.push(i); // carried over from the last page
    }
    rows.push(...bands);
  }
  return rows.map((r) => {
    const col = (lo, hi) => r.items.filter((i) => i.x >= lo && i.x < hi).sort((a, b) => b.y - a.y).map((i) => i.s.trim());
    let nameLines = col(0, 185);
    const half = nameLines.length / 2; // a name is sometimes printed twice in its row
    if (nameLines.length % 2 === 0 && nameLines.slice(0, half).join('|') === nameLines.slice(half).join('|')) nameLines = nameLines.slice(0, half);
    const mid = col(185, 255);
    const date = mid.find((s) => /^\d{2}-[A-Z][a-z]{2}-\d{2}$/.test(s)) ?? null;
    const region = mid.filter((s) => s !== date).join(' ').replace(/\s*Regional Health\s*Authority\s*/i, '').trim() || null;
    const title = col(255, 480).join(' ').replace(/\s+/g, ' ').trim();
    const comments = col(550, 1000).join(' ').replace(/\s+/g, ' ');
    const pick = (k) => comments.match(new RegExp(`${k}:\\s*(.*?)(?=Operational:|Quality:|$)`))?.[1]?.trim() || null;
    return { nameLines, kind: r.kind, date, region, title, quality: pick('Quality'), operational: pick('Operational') };
  });
}
