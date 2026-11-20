require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Healthcare service types available in services_clean table
const HEALTHCARE_TYPES = ['hospital', 'clinic', 'pharmacy', 'doctors', 'dentist', 'centre'];

// Validates a service_type slug against allowed healthcare types.
function parseServiceType(raw) {
  if (raw === undefined) return null;
  const t = String(raw).trim().toLowerCase();
  return HEALTHCARE_TYPES.includes(t) ? t : null;
}

// GET /api/services/radius?lat=..&lon=..&radius=..&service_type=..
// Returns healthcare facilities within radius metres of (lat, lon).
app.get('/api/services/radius', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const radiusMeters = parseFloat(req.query.radius);
  const serviceType = parseServiceType(req.query.service_type);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusMeters)) {
    return res.status(400).json({ error: 'lat, lon, and radius are required numbers.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         id, name, address, phone, website, opening_hours, service_type, osm_id,
         ST_Y(geom_4326) AS lat, ST_X(geom_4326) AS lon,
         ROUND(ST_Distance(
           geom_4326::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         )) AS distance_m
       FROM services_clean
       WHERE ST_DWithin(
         geom_4326::geography,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         $3
       )
       AND ($4::text IS NULL OR service_type = $4)
       ORDER BY distance_m`,
      [lon, lat, radiusMeters, serviceType]
    );
    res.json({ service: 'healthcare', count: result.rows.length, results: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database query failed.' });
  }
});

// GET /api/services/nearest?lat=..&lon=..&limit=..&service_type=..
// Returns the N nearest healthcare facilities to (lat, lon).
app.get('/api/services/nearest', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 50);
  const serviceType = parseServiceType(req.query.service_type);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon are required numbers.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         id, name, address, phone, website, opening_hours, service_type, osm_id,
         ST_Y(geom_4326) AS lat, ST_X(geom_4326) AS lon,
         ROUND(ST_Distance(
           geom_4326::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         )) AS distance_m
       FROM services_clean
       WHERE ($4::text IS NULL OR service_type = $4)
       ORDER BY geom_4326 <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
       LIMIT $3`,
      [lon, lat, limit, serviceType]
    );
    res.json({ service: 'healthcare', count: result.rows.length, results: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database query failed.' });
  }
});

// GET /api/services/types
// Returns the available healthcare service sub-types.
app.get('/api/services/types', (req, res) => {
  res.json({
    service_category: 'healthcare',
    types: [
      { key: 'hospital',  label: 'Hospital',          glyph: '✚' },
      { key: 'clinic',    label: 'Clinic',             glyph: '✚' },
      { key: 'pharmacy',  label: 'Pharmacy',           glyph: '⚕' },
      { key: 'doctors',   label: 'Doctors / GP',       glyph: '👨‍⚕️' },
      { key: 'dentist',   label: 'Dentist',            glyph: '🦷' },
      { key: 'centre',    label: 'Health Centre',      glyph: '🏥' },
    ]
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Healthcare proximity backend running on http://localhost:${PORT}`);
});


// GET /api/services/types
// Returns the available healthcare service sub-types.
app.get('/api/services/types', (req, res) => {
  res.json({
    service_category: 'healthcare',
    types: [
      { key: 'hospital',  label: 'Hospital',          glyph: '✚' },
      { key: 'clinic',    label: 'Clinic',             glyph: '✚' },
      { key: 'pharmacy',  label: 'Pharmacy',           glyph: '⚕' },
      { key: 'doctors',   label: 'Doctors / GP',       glyph: '👨‍⚕️' },
      { key: 'dentist',   label: 'Dentist',            glyph: '🦷' },
      { key: 'centre',    label: 'Health Centre',      glyph: '🏥' },
    ]
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Healthcare proximity backend running on http://localhost:${PORT}`);
});