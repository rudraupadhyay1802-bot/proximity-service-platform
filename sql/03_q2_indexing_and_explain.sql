-- ============================================================
-- 03_q2_indexing_and_explain.sql
-- Evidence Question 2: Spatial Indexes and Query Plans
-- ============================================================

-- Step A: Without GiST index
DROP INDEX IF EXISTS idx_buildings_geom_utm;
DROP INDEX IF EXISTS idx_services_geom_utm;

EXPLAIN ANALYZE
SELECT s.id, count(b.id) AS building_count
FROM services_clean s
JOIN buildings b ON ST_DWithin(s.geom_utm, b.geom_utm, 500)
GROUP BY s.id;

-- Step B: With GiST index
CREATE INDEX idx_buildings_geom_utm ON buildings USING GIST (geom_utm);
CREATE INDEX idx_services_geom_utm ON services_clean USING GIST (geom_utm);

EXPLAIN ANALYZE
SELECT s.id, count(b.id) AS building_count
FROM services_clean s
JOIN buildings b ON ST_DWithin(s.geom_utm, b.geom_utm, 500)
GROUP BY s.id;

-- Step C: Rewritten as ST_Distance < 500 (bypasses index pre-filter)
EXPLAIN ANALYZE
SELECT s.id, count(b.id) AS building_count
FROM services_clean s
JOIN buildings b ON ST_Distance(s.geom_utm, b.geom_utm) < 500
GROUP BY s.id;
