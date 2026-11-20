require('dotenv').config();
const pool = require('./db');

const BBOX = { south: 22.98, west: 72.50, north: 23.10, east: 72.62 };
const TARGET_SUBCATEGORIES = ['hospital', 'clinic', 'college', 'library', 'bank'];

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const REQUEST_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'User-Agent': 'Proximity-Ahmedabad-Student-WebGIS/1.0 (academic project)',
  'Accept': '*/*',
};

function bboxToOverpassString(box) {
  return `${box.south},${box.west},${box.north},${box.east}`;
}

function splitBBox(box, rows, cols) {
  const latStep = (box.north - box.south) / rows;
  const lonStep = (box.east - box.west) / cols;
  const boxes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      boxes.push({
        south: box.south + r * latStep,
        north: box.south + (r + 1) * latStep,
        west: box.west + c * lonStep,
        east: box.west + (c + 1) * lonStep,
      });
    }
  }
  return boxes;
}

async function fetchTagMappings() {
  const result = await pool.query(
    `SELECT s.id AS subcategory_id, s.slug AS subcategory_slug,
            s.category_id, m.tag_key, m.tag_value
     FROM subcategories s
     JOIN osm_tag_mappings m ON m.subcategory_id = s.id
         WHERE s.slug = ANY($1) AND s.osm_available = TRUE`,
        [TARGET_SUBCATEGORIES]
  );
  return result.rows;
}

async function queryOverpassWithMirrors(query, label) {
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: REQUEST_HEADERS,
        body: query,
        signal: AbortSignal.timeout(40000),
      });
      if (res.ok) {
        return await res.json();
      }
      console.error(`  [${label}] ${mirror} -> HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      if (err.name === 'TimeoutError') {
        console.error(`  [${label}] ${mirror} -> timed out after 40s`);
      } else {
        console.error(`  [${label}] ${mirror} -> network error: ${err.message}`);
      }
    }
  }
  return null;
}

async function insertElements(elements, subcategoryId, categoryId) {
  let inserted = 0;
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;

    const tags = el.tags || {};
    const name = tags.name || null;
    if (!name) continue;

    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb']]
      .filter(Boolean).join(', ') || null;
    const sourceId = `${el.type}/${el.id}`;
    const operatorType = tags['operator:type'] || tags.ownership || null;

    const result = await pool.query(
      `INSERT INTO services
         (name, category_id, subcategory_id, address, phone, website, opening_hours, operator_type, source, source_id, city, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OpenStreetMap',$9,'Ahmedabad',
               ST_SetSRID(ST_MakePoint($10,$11),4326))
       ON CONFLICT (source, source_id) DO UPDATE
         SET operator_type = COALESCE(EXCLUDED.operator_type, services.operator_type)
       RETURNING (xmax = 0) AS was_inserted`,
      [
        name, categoryId, subcategoryId, address,
        tags.phone || tags['contact:phone'] || null,
        tags.website || tags['contact:website'] || null,
        tags.opening_hours || null,
        operatorType,
        sourceId, lon, lat,
      ]
    );
    if (result.rows[0].was_inserted) inserted++;
  }
  return inserted;
}

async function importSubcategorySplit(subcategoryId, subcategorySlug, categoryId, tagPairs) {
  const subBoxes = splitBBox(BBOX, 2, 2); // always split, learned from the restaurant case
  let totalFetched = 0;
  let totalInserted = 0;

  for (let i = 0; i < subBoxes.length; i++) {
    const box = subBoxes[i];
    const clauses = tagPairs
      .map(({ tag_key, tag_value }) => `nwr["${tag_key}"="${tag_value}"](${bboxToOverpassString(box)});`)
      .join('');
    const query = `[out:json][timeout:25];(${clauses});out center;`;

    const data = await queryOverpassWithMirrors(query, `${subcategorySlug} q${i + 1}`);
    if (!data) {
      console.log(`  ${subcategorySlug} quadrant ${i + 1}/4: all mirrors failed`);
      continue;
    }
    const elements = data.elements || [];
    const inserted = await insertElements(elements, subcategoryId, categoryId);
    console.log(`  ${subcategorySlug} quadrant ${i + 1}/4: fetched ${elements.length}, inserted ${inserted} new`);
    totalFetched += elements.length;
    totalInserted += inserted;

    await new Promise(r => setTimeout(r, 6000));
  }

  return { fetched: totalFetched, inserted: totalInserted };
}

async function main() {
  console.log(`Importing subcategories: ${TARGET_SUBCATEGORIES.join(', ')}\n`);

  const mappings = await fetchTagMappings();
  const bySubcat = new Map();
  for (const row of mappings) {
    if (!bySubcat.has(row.subcategory_id)) {
      bySubcat.set(row.subcategory_id, { slug: row.subcategory_slug, categoryId: row.category_id, tags: [] });
    }
    bySubcat.get(row.subcategory_id).tags.push({ tag_key: row.tag_key, tag_value: row.tag_value });
  }

  let totalFetched = 0;
  let totalInserted = 0;

  for (const [subcategoryId, info] of bySubcat) {
    console.log(`Fetching ${info.slug}...`);
    const { fetched, inserted } = await importSubcategorySplit(subcategoryId, info.slug, info.categoryId, info.tags);
    console.log(`${info.slug} TOTAL: fetched ${fetched}, inserted ${inserted} new\n`);
    totalFetched += fetched;
    totalInserted += inserted;
  }

  console.log(`Done. Total fetched: ${totalFetched}, total newly inserted: ${totalInserted}`);
  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  pool.end();
});

