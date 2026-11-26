-- Step A: Without GiST index (drop BOTH possible names of each index)
DROP INDEX IF EXISTS idx_buildings_utm;
DROP INDEX IF EXISTS idx_services_clean_utm;
DROP INDEX IF EXISTS idx_buildings_geom_utm;
DROP INDEX IF EXISTS idx_services_geom_utm;

EXPLAIN ANALYZE
SELECT s.id, count(b.id) AS building_count
FROM services_clean s
JOIN buildings b ON ST_DWithin(s.geom_utm, b.geom_utm, 500)
GROUP BY s.id;

-- Step B: With GiST index (same names that 01_clean_and_load.py uses)
CREATE INDEX idx_buildings_utm ON buildings USING GIST (geom_utm);
CREATE INDEX idx_services_clean_utm ON services_clean USING GIST (geom_utm);

EXPLAIN ANALYZE
SELECT s.id, count(b.id) AS building_count
FROM services_clean s
JOIN buildings b ON ST_DWithin(s.geom_utm, b.geom_utm, 500)
GROUP BY s.id;

-- Step C: Rewritten as ST_Distance < 500 (cannot use the index)
EXPLAIN ANALYZE
SELECT s.id, count(b.id) AS building_count
FROM services_clean s
JOIN buildings b ON ST_Distance(s.geom_utm, b.geom_utm) < 500
GROUP BY s.id;
