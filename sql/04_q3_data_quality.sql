-- ============================================================
-- 04_q3_data_quality.sql
-- Evidence Question 3: Data Quality vs Earlier Source
-- ============================================================

-- 1. Share of services without a name
SELECT 
    COUNT(*) AS total_services,
    COUNT(*) FILTER (WHERE name IS NULL OR trim(name) = '') AS unnamed_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE name IS NULL OR trim(name) = '') / COUNT(*), 2) AS unnamed_percentage
FROM services_clean;

-- 2. Count of pairs within 25 m of each other
SELECT COUNT(*) AS pairs_within_25m
FROM services_clean a
JOIN services_clean b ON a.id < b.id
WHERE ST_DWithin(a.geom_utm, b.geom_utm, 25);

-- 3. Comparison with earlier project source in same bounding box
SELECT COUNT(*) AS earlier_project_count
FROM services s 
JOIN categories c ON c.id = s.category_id
WHERE c.slug = 'healthcare' 
  AND ST_Within(s.geom, ST_MakeEnvelope(72.54, 23.02, 72.58, 23.05, 4326));

-- 4. Five representative verified healthcare facilities
SELECT 
    name, 
    service_type, 
    ROUND(ST_Y(geom_4326)::numeric, 6) AS latitude, 
    ROUND(ST_X(geom_4326)::numeric, 6) AS longitude
FROM services_clean
WHERE name IS NOT NULL
ORDER BY id
LIMIT 5;
