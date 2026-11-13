// Paging clients for the public APIs: MSC GeoMet OGC API, ArcGIS REST, Overpass (with mirrors), StatCan WDS.

import { strFromU8, unzipSync } from 'fflate';
import { OGC, OVERPASS } from './config.mjs';
import { asJSON, cached, cachedJSON, fetchBuf, log, sleep } from './io.mjs';

/** Page through an MSC GeoMet OGC API collection. */
export async function ogcAll(collection, params, cacheKey) {
  const features = [];
  const limit = 10000;
  for (let offset = 0; ; offset += limit) {
    const q = new URLSearchParams({ f: 'json', limit: String(limit), offset: String(offset), ...params });
    const page = await cachedJSON(`ogc/${cacheKey}-${offset}.json`, `${OGC}/${collection}/items?${q}`);
    features.push(...page.features);
    if (page.features.length < limit) break;
  }
  return features;
}

/** Page through an ArcGIS REST layer's query endpoint as GeoJSON. */
export async function arcgisAll(layerUrl, params, cacheKey, pageSize = 1000) {
  const features = [];
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({ f: 'geojson', outSR: '4326', resultOffset: String(offset), resultRecordCount: String(pageSize), ...params });
    const page = await cachedJSON(`arcgis/${cacheKey}-${offset}.json`, `${layerUrl}/query?${q}`, { timeout: 300_000 });
    if (!Array.isArray(page.features)) throw new Error(`${cacheKey}: ${JSON.stringify(page.error ?? page).slice(0, 200)}`);
    features.push(...page.features);
    if (page.features.length < pageSize && !page.properties?.exceededTransferLimit && !page.exceededTransferLimit) break;
  }
  return features;
}

/** An Overpass query: tries each mirror (POST, then GET) and caches the answer once it is real, complete JSON. */
export async function overpass(cacheFile, query) {
  return asJSON(await cached(`osm/${cacheFile}`, async () => {
    let last;
    for (let r = 0; r < 4; r++)
      for (const url of OVERPASS) {
        try {
          const buf = r % 2
            ? await fetchBuf(`${url}?data=${encodeURIComponent(query)}`, { retries: 1, timeout: 300_000 })
            : await fetchBuf(url, { method: 'POST', body: new URLSearchParams({ data: query }), retries: 1, timeout: 300_000 });
          let j;
          try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('busy (not JSON)'); }
          if (!Array.isArray(j.elements) || /runtime error|timed out|out of memory/i.test(j.remark ?? '')) throw new Error(`busy (${j.remark ?? 'no elements'})`);
          return buf;
        } catch (e) { last = e; log(`  overpass ${cacheFile}: ${e.message}, trying again`); await sleep(8000); }
      }
    throw last;
  }), cacheFile);
}

/** Downloads a full Statistics Canada table (CSV inside a zip) through the WDS API, cached. */
export async function statcanTable(pid) {
  const zip = await cached(`statcan/${pid}.zip`, async () => {
    const meta = asJSON(await fetchBuf(`https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/${pid}/en`), `table ${pid}`);
    const b = await fetchBuf(meta.object, { timeout: 900_000 });
    if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error('Statistics Canada returned a non-zip response (site may be down for maintenance)');
    return b;
  });
  const files = unzipSync(new Uint8Array(zip), { filter: (f) => /^\d+\.csv$/.test(f.name) });
  return strFromU8(files[Object.keys(files)[0]]);
}
