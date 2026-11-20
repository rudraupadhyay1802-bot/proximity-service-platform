-- ============================================================
-- Proximity — Ahmedabad Student Services
-- PostgreSQL + PostGIS schema (backend_db.sql)
--
-- CRS: WGS84 / EPSG:4326 for stored geometry (matches OSM, GPS,
-- browser geolocation directly — no conversion on ingest).
-- All real-world distance calculations use ::geography casts
-- (see the example queries at the end) — never raw degree math.
--
-- This script is safe to re-run on a clean database. It drops
-- and recreates everything below, so run it on an EMPTY/throwaway
-- database, or accept that existing data in these tables is wiped.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EXTENSIONS
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;

-- ------------------------------------------------------------
-- 2. SCHEMA / TABLES  (drop first, in dependency order, for
--    reproducibility on a database that already has these)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS osm_tag_mappings CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS subcategories CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS educational_institutions CASCADE;

CREATE TABLE categories (
    id          SERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,   -- matches script.js category.id
    label       TEXT NOT NULL,          -- matches script.js category.label
    color       TEXT                    -- matches script.js category.color
);

CREATE TABLE subcategories (
    id              SERIAL PRIMARY KEY,
    category_id     INTEGER NOT NULL REFERENCES categories(id),
    slug            TEXT NOT NULL UNIQUE,             -- matches script.js sub.key
    label           TEXT NOT NULL,                    -- matches script.js sub.label
    glyph           TEXT,                              -- matches script.js sub.glyph
    budget_eligible BOOLEAN NOT NULL DEFAULT FALSE,    -- matches script.js sub.budget
    osm_available   BOOLEAN NOT NULL DEFAULT TRUE      -- FALSE = script.js sub.unavailable:true
);

CREATE TABLE osm_tag_mappings (
    id              SERIAL PRIMARY KEY,
    subcategory_id  INTEGER NOT NULL REFERENCES subcategories(id),
    tag_key         TEXT NOT NULL,   -- e.g. 'amenity', 'shop', 'leisure', 'railway', 'tourism', 'building', 'highway', 'station', 'healthcare'
    tag_value       TEXT NOT NULL,
    UNIQUE (subcategory_id, tag_key, tag_value)
);

CREATE TABLE services (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,                              -- optional, e.g. OSM description tag

    category_id     INTEGER NOT NULL REFERENCES categories(id),
    subcategory_id  INTEGER NOT NULL REFERENCES subcategories(id),
    -- NOTE: category_id is a documented denormalization for fast
    -- category-level queries without a join through subcategories.
    -- It must always match subcategories.category_id for the row's
    -- subcategory_id. Not enforced by a DB trigger (kept simple per
    -- project scope) — the seed data below and any future import
    -- script must set it via a join, as shown.

    address         TEXT,
    phone           TEXT,
    website         TEXT,
    opening_hours   TEXT,

    -- budget fields — every value nullable; NULL = "not available", never fabricated
    price_type      TEXT CHECK (price_type IN ('monthly','per_person','per_session','per_service','unknown')),
    price_min       NUMERIC CHECK (price_min IS NULL OR price_min >= 0),
    price_max       NUMERIC CHECK (price_max IS NULL OR price_max >= 0),
    currency        TEXT DEFAULT 'INR',
    CONSTRAINT chk_price_range CHECK (
        price_min IS NULL OR price_max IS NULL OR price_max >= price_min
    ),

    -- source metadata
    source          TEXT NOT NULL DEFAULT 'OpenStreetMap',
    source_id       TEXT,   -- e.g. 'node/123456789'; NULLs are not
                             -- considered duplicates of each other by
                             -- the UNIQUE constraint below (standard
                             -- SQL NULL <> NULL behavior) — reviewed,
                             -- correct, no change needed.

    city                TEXT NOT NULL DEFAULT 'Ahmedabad',
    administrative_area TEXT,

    geom            geometry(Point, 4326) NOT NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source, source_id)
);

CREATE TABLE educational_institutions (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    institution_type    TEXT,   -- e.g. 'university', 'college'
    address             TEXT,
    website             TEXT,

    source              TEXT NOT NULL DEFAULT 'OpenStreetMap',
    source_id           TEXT,

    city                TEXT NOT NULL DEFAULT 'Ahmedabad',
    administrative_area TEXT,

    geom                geometry(Point, 4326) NOT NULL,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source, source_id)
);

-- ------------------------------------------------------------
-- 3. INDEXES
-- ------------------------------------------------------------
-- Spatial (GiST) — required for ST_DWithin and KNN (<->) to be fast
CREATE INDEX idx_services_geom     ON services USING GIST (geom);
CREATE INDEX idx_institutions_geom ON educational_institutions USING GIST (geom);

-- Regular indexes — filtering happens before/alongside spatial checks
CREATE INDEX idx_services_category    ON services (category_id);
CREATE INDEX idx_services_subcategory ON services (subcategory_id);
CREATE INDEX idx_services_city        ON services (city);
CREATE INDEX idx_institutions_city    ON educational_institutions (city);

-- ------------------------------------------------------------
-- 4. CATEGORY SEED DATA  (all 9, matching script.js exactly)
-- ------------------------------------------------------------
INSERT INTO categories (slug, label, color) VALUES
('study',         'Study',          '#5ec8ff'),
('accommodation', 'Accommodation',  '#ff9ecf'),
('food',          'Food',           '#ffb347'),
('daily',         'Daily Needs',    '#ffe066'),
('transport',     'Transport',      '#c98bff'),
('healthcare',    'Healthcare',     '#ff6b5e'),
('finance',       'Finance',        '#7cff9e'),
('safety',        'Safety',         '#4d7cff'),
('recreation',    'Recreation',     '#8bd17c');

-- ------------------------------------------------------------
-- 5. SUBCATEGORY SEED DATA  (all 33, matching script.js exactly,
--    including budget_eligible / osm_available flags)
-- ------------------------------------------------------------
INSERT INTO subcategories (category_id, slug, label, glyph, budget_eligible, osm_available)
SELECT id, v.slug, v.label, v.glyph, v.budget, v.osm_available
FROM categories c
JOIN (VALUES
    -- study
    ('study', 'college',    'College / University', '🎓', FALSE, TRUE),
    ('study', 'library',    'Library',               '📚', FALSE, TRUE),
    ('study', 'bookstore',  'Bookstore',             '📖', FALSE, TRUE),
    ('study', 'stationery', 'Stationery',            '✏️', FALSE, TRUE),
    ('study', 'printing',   'Printing / Xerox',      '🖨', FALSE, TRUE),
    ('study', 'studyspace', 'Study Space',           '📐', FALSE, FALSE),
    -- accommodation
    ('accommodation', 'hostel', 'Hostel',              '🏨', TRUE, TRUE),
    ('accommodation', 'pg',     'PG / Paying Guest',   '🛏', TRUE, FALSE),
    -- food
    ('food', 'restaurant', 'Restaurant',    '🍽', TRUE, TRUE),
    ('food', 'cafe',       'Cafe',          '☕', TRUE, TRUE),
    ('food', 'fastfood',   'Fast Food',     '🍔', TRUE, TRUE),
    ('food', 'messtiffin', 'Mess / Tiffin', '🍱', TRUE, FALSE),
    -- daily needs
    ('daily', 'grocery',     'Grocery',           '🥬', FALSE, TRUE),
    ('daily', 'supermarket', 'Supermarket',       '🛒', FALSE, TRUE),
    ('daily', 'convenience', 'Convenience Store', '🏪', FALSE, TRUE),
    ('daily', 'laundry',     'Laundry',           '🧺', TRUE, TRUE),
    ('daily', 'salon',       'Salon',             '💇', FALSE, TRUE),
    ('daily', 'gym',         'Gym',               '🏋', TRUE, TRUE),
    -- transport
    ('transport', 'busstop', 'Bus Stop',        '🚏', FALSE, TRUE),
    ('transport', 'metro',   'Metro Station',   '🚇', FALSE, TRUE),
    ('transport', 'railway', 'Railway Station', '🚉', FALSE, TRUE),
    ('transport', 'fuel',    'Fuel Station',    '⛽', FALSE, TRUE),
    -- healthcare
    ('healthcare', 'hospital',   'Hospital',         '✚', FALSE, TRUE),
    ('healthcare', 'clinic',     'Clinic',           '✚', FALSE, TRUE),
    ('healthcare', 'pharmacy',   'Pharmacy',         '⚕', FALSE, TRUE),
    ('healthcare', 'diagnostic', 'Diagnostic Centre','🧪', FALSE, TRUE),
    -- finance
    ('finance', 'bank', 'Bank', '🏦', FALSE, TRUE),
    ('finance', 'atm',  'ATM',  '₹', FALSE, TRUE),
    -- safety
    ('safety', 'police', 'Police Station', '🛡', FALSE, TRUE),
    ('safety', 'fire',   'Fire Station',   '🚒', FALSE, TRUE),
    -- recreation
    ('recreation', 'park',       'Park',                'ЁЯМ│', FALSE, TRUE),
    ('recreation', 'playground', 'Playground',          '🛝', FALSE, TRUE),
    ('recreation', 'sportsrec',  'Sports / Recreation', '🏟', FALSE, TRUE)
) AS v(cat_slug, slug, label, glyph, budget, osm_available)
    ON v.cat_slug = c.slug;

-- ------------------------------------------------------------
-- 6. OSM TAG MAPPINGS  (32 rows — every non-"unavailable"
--    subcategory's script.js `match` array, exactly)
-- ------------------------------------------------------------
INSERT INTO osm_tag_mappings (subcategory_id, tag_key, tag_value)
SELECT sc.id, v.tag_key, v.tag_value
FROM subcategories sc
JOIN (VALUES
    ('college',    'amenity',   'college'),
    ('college',    'amenity',   'university'),
    ('library',    'amenity',   'library'),
    ('bookstore',  'shop',      'books'),
    ('stationery', 'shop',      'stationery'),
    ('printing',   'shop',      'copyshop'),

    ('hostel',     'tourism',   'hostel'),
    ('hostel',     'building',  'dormitory'),

    ('restaurant', 'amenity',   'restaurant'),
    ('cafe',       'amenity',   'cafe'),
    ('fastfood',   'amenity',   'fast_food'),

    ('grocery',     'shop', 'grocery'),
    ('supermarket', 'shop', 'supermarket'),
    ('convenience', 'shop', 'convenience'),
    ('laundry',     'shop', 'laundry'),
    ('salon',       'shop', 'hairdresser'),
    ('gym',         'leisure', 'fitness_centre'),

    ('busstop', 'highway', 'bus_stop'),
    ('metro',   'station', 'subway'),
    ('railway', 'railway', 'station'),
    ('fuel',    'amenity', 'fuel'),

    ('hospital',   'amenity',    'hospital'),
    ('clinic',     'amenity',    'clinic'),
    ('pharmacy',   'amenity',    'pharmacy'),
    ('diagnostic', 'healthcare', 'laboratory'),

    ('bank', 'amenity', 'bank'),
    ('atm',  'amenity', 'atm'),

    ('police', 'amenity', 'police'),
    ('fire',   'amenity', 'fire_station'),

    ('park',       'leisure', 'park'),
    ('playground', 'leisure', 'playground'),
    ('sportsrec',  'leisure', 'sports_centre')
) AS v(sub_slug, tag_key, tag_value)
    ON v.sub_slug = sc.slug;

-- ------------------------------------------------------------
-- 7. SAMPLE DATA  (real, verified — Wikipedia-sourced coordinates.
--    No fabricated Ahmedabad businesses. Only what was already
--    validated in earlier steps.)
-- ------------------------------------------------------------
INSERT INTO educational_institutions (name, institution_type, address, website, source, source_id, city, geom)
VALUES (
    'CEPT University', 'university',
    'Kasturbhai Lalbhai Campus, University Road, Navrangpura, Ahmedabad',
    'https://cept.ac.in', 'OpenStreetMap', NULL, 'Ahmedabad',
    ST_SetSRID(ST_MakePoint(72.54972, 23.03750), 4326)
);

INSERT INTO educational_institutions (name, institution_type, address, website, source, source_id, city, geom)
VALUES (
    'Gujarat University', 'university',
    'Navrangpura, Ahmedabad - 380009',
    'https://www.gujaratuniversity.org.in', 'OpenStreetMap', NULL, 'Ahmedabad',
    ST_SetSRID(ST_MakePoint(72.54639, 23.03611), 4326)
);

INSERT INTO services (name, category_id, subcategory_id, address, website, source, source_id, city, geom)
SELECT
    'Ahmedabad Civil Hospital',
    sc.category_id,
    sc.id,
    'D Block, Asarwa, Ahmedabad, Gujarat 380016',
    'https://civilhospitalahd.gujarat.gov.in',
    'OpenStreetMap', NULL, 'Ahmedabad',
    ST_SetSRID(ST_MakePoint(72.605075, 23.051362), 4326)
FROM subcategories sc WHERE sc.slug = 'hospital';

-- ------------------------------------------------------------
-- 8. EXAMPLE SPATIAL QUERIES (documentation only — commented out
--    so this script runs clean on import; uncomment to test)
-- ------------------------------------------------------------

-- A. Radius search: services within N metres of a point
-- SELECT s.name, sc.label AS subcategory,
--        ROUND(ST_Distance(s.geom::geography, pt.geom::geography)) AS distance_m
-- FROM services s
-- JOIN subcategories sc ON sc.id = s.subcategory_id
-- CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint(72.54972, 23.03750), 4326) AS geom) pt
-- WHERE ST_DWithin(s.geom::geography, pt.geom::geography, 10000)
-- ORDER BY distance_m;

-- B. Nearest-N: KNN operator (<->) orders using the GiST index
--    without computing exact distance for every row first — fast
--    even on large tables. ST_Distance is computed separately,
--    only for the rows actually returned, to get the real metre
--    value (the <-> operator's own value is in degrees, not metres,
--    so it's for ordering only, never for the displayed distance).
-- SELECT s.name, sc.label AS subcategory,
--        ROUND(ST_Distance(s.geom::geography, pt.geom::geography)) AS distance_m
-- FROM services s
-- JOIN subcategories sc ON sc.id = s.subcategory_id
-- CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint(72.54972, 23.03750), 4326) AS geom) pt
-- ORDER BY s.geom <-> pt.geom
-- LIMIT 10;

SELECT c.label AS category, COUNT(s.id) AS subcategory_count
FROM categories c
LEFT JOIN subcategories s ON s.category_id = c.id
GROUP BY c.label
ORDER BY c.label;

SELECT s.label, s.budget_eligible, s.osm_available, COUNT(m.id) AS tag_mapping_count
FROM subcategories s
LEFT JOIN osm_tag_mappings m ON m.subcategory_id = s.id
WHERE s.osm_available = FALSE
GROUP BY s.label, s.budget_eligible, s.osm_available;

SELECT s.name, c.label AS category, sc.label AS subcategory
FROM services s
JOIN categories c ON c.id = s.category_id
JOIN subcategories sc ON sc.id = s.subcategory_id;
UPDATE subcategories SET glyph = '🌳' WHERE slug = 'park';

SELECT slug, glyph FROM subcategories WHERE slug = 'park';

SELECT sc.slug, COUNT(*) AS count
FROM services s
JOIN subcategories sc ON sc.id = s.subcategory_id
GROUP BY sc.slug
ORDER BY sc.slug;

SELECT c.label AS category, sc.label AS subcategory, COUNT(s.id) AS count
FROM subcategories sc
JOIN categories c ON c.id = sc.category_id
LEFT JOIN services s ON s.subcategory_id = sc.id
WHERE c.slug IN ('accommodation','daily','transport','safety','recreation')
GROUP BY c.label, sc.label
ORDER BY c.label, sc.label;

ALTER TABLE services ADD COLUMN operator_type TEXT;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'services' AND column_name = 'operator_type';

SELECT sc.label AS subcategory,
       COUNT(*) AS total,
       COUNT(s.operator_type) AS tagged,
       ROUND(100.0 * COUNT(s.operator_type) / COUNT(*)) AS pct_tagged
FROM services s
JOIN subcategories sc ON sc.id = s.subcategory_id
WHERE sc.slug IN ('hospital','clinic','college','library','bank')
GROUP BY sc.label
ORDER BY sc.label;

SELECT operator_type, COUNT(*) AS count
FROM services
WHERE operator_type IS NOT NULL
GROUP BY operator_type
ORDER BY count DESC;

INSERT INTO educational_institutions (name, institution_type, address, website, source, source_id, city, geom)
SELECT s.name, sc.label, s.address, s.website, s.source, s.source_id, s.city, s.geom
FROM services s
JOIN subcategories sc ON sc.id = s.subcategory_id
WHERE sc.slug = 'college'
ON CONFLICT (source, source_id) DO NOTHING;

DELETE FROM educational_institutions e
WHERE e.source_id IS NULL
  AND EXISTS (
    SELECT 1 FROM educational_institutions o
    WHERE o.source_id IS NOT NULL AND lower(o.name) = lower(e.name)
  );

SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE source_id IS NULL) AS hand_seeded
FROM educational_institutions;\

JOIN categories c ON c.id = s.category_id
WHERE ($4::text[] IS NULL OR sc.slug = ANY($4::text[]))
ORDER BY s.geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
LIMIT $3`,[lon, lat, limit, subcats]