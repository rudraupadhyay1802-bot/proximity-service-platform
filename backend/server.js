require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Parses ?subcats=hospital,clinic into a validated array of slugs.
// Returns null when the param is absent, which means "no filtering".
function parseSubcats(raw) {
  if (raw === undefined) return null;
  return String(raw)
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[a-z_]{1,30}$/.test(s))
    .slice(0, 40);
}

// GET /api/services/radius?lat=..&lon=..&radius=..
app.get('/api/services/radius', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const radiusMeters = parseFloat(req.query.radius);
  const subcats = parseSubcats(req.query.subcats);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusMeters)) {
    return res.status(400).json({ error: 'lat, lon, and radius are required and must be numbers.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         s.id, s.name, s.address, s.phone, s.website, s.opening_hours,
         ST_Y(s.geom) AS lat, ST_X(s.geom) AS lon,
         sc.slug AS subcategory, c.slug AS category,
         ROUND(ST_Distance(
           s.geom::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         )) AS distance_m
       FROM services s
       JOIN subcategories sc ON sc.id = s.subcategory_id
       JOIN categories c ON c.id = s.category_id
       WHERE ST_DWithin(
         s.geom::geography,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         $3
       )
       AND ($4::text[] IS NULL OR sc.slug = ANY($4::text[]))
       ORDER BY distance_m`,
      [lon, lat, radiusMeters, subcats]
    );
    res.json({ count: result.rows.length, results: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/institutions/search?q=..
app.get('/api/institutions/search', async (req, res) => {
  const q = (req.query.q || '').trim();

  if (q.length < 2) {
    return res.status(400).json({ error: 'q must be at least 2 characters.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         id, name, institution_type, address, website,
         ST_Y(geom) AS lat, ST_X(geom) AS lon
       FROM educational_institutions
       WHERE name ILIKE $1
       ORDER BY name
       LIMIT 10`,
      [`%${q}%`]
    );
    res.json({ count: result.rows.length, results: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/categories  — full taxonomy, with subcategories nested
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         c.slug AS category_slug, c.label AS category_label, c.color,
         s.slug AS subcategory_slug, s.label AS subcategory_label,
         s.glyph, s.budget_eligible, s.osm_available
       FROM categories c
       JOIN subcategories s ON s.category_id = c.id
       ORDER BY c.label, s.label`
    );

    // Group flat rows into { category: { subcategories: [...] } } shape
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.category_slug]) {
        grouped[row.category_slug] = {
          slug: row.category_slug,
          label: row.category_label,
          color: row.color,
          subcategories: [],
        };
      }
      grouped[row.category_slug].subcategories.push({
        slug: row.subcategory_slug,
        label: row.subcategory_label,
        glyph: row.glyph,
        budgetEligible: row.budget_eligible,
        osmAvailable: row.osm_available,
      });
    }

    res.json({ categories: Object.values(grouped) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Proximity backend running on http://localhost:${PORT}`);
});

// GET /api/services/nearest?lat=..&lon=..&limit=..
app.get('/api/services/nearest', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const limit = parseInt(req.query.limit, 10) || 5;
  const subcats = parseSubcats(req.query.subcats);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon are required and must be numbers.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         s.id, s.name, s.address, s.phone, s.website, s.opening_hours,
         ST_Y(s.geom) AS lat, ST_X(s.geom) AS lon,
         sc.slug AS subcategory, c.slug AS category,
         ROUND(ST_Distance(
           s.geom::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         )) AS distance_m
       FROM services s
       JOIN subcategories sc ON sc.id = s.subcategory_id
       JOIN categories c ON c.id = s.category_id
       WHERE ($4::text[] IS NULL OR sc.slug = ANY($4::text[]))
       ORDER BY s.geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
       LIMIT $3`,
      [lon, lat, limit, subcats]
    );
    res.json({ count: result.rows.length, results: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});