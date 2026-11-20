-- ============================================================
-- 05_hex_coverage.sql
-- Evidence Questions 7 & 8: H3 Hexagonal Accessibility & MAUP
-- ============================================================

-- 1. Resolution 9 Population Accessibility Summary (Adult 4.8 km/h vs Elderly 3.6 km/h)
SELECT
    COUNT(*) AS total_cells,
    ROUND(SUM(est_population)::numeric, 1) AS total_estimated_population,
    -- Adult 15-min (1200m)
    ROUND(SUM(est_population) FILTER (WHERE NOT served_15min)::numeric, 1) AS unserved_pop_adult,
    ROUND((100.0 * SUM(est_population) FILTER (WHERE NOT served_15min) / NULLIF(SUM(est_population), 0))::numeric, 2) AS pct_unserved_adult,
    -- Elderly 15-min (900m)
    ROUND(SUM(est_population) FILTER (WHERE NOT served_elderly)::numeric, 1) AS unserved_pop_elderly,
    ROUND((100.0 * SUM(est_population) FILTER (WHERE NOT served_elderly) / NULLIF(SUM(est_population), 0))::numeric, 2) AS pct_unserved_elderly,
    -- Percentage points lost
    ROUND((100.0 * SUM(est_population) FILTER (WHERE NOT served_elderly) / NULLIF(SUM(est_population), 0) -
           100.0 * SUM(est_population) FILTER (WHERE NOT served_15min) / NULLIF(SUM(est_population), 0))::numeric, 2) AS pct_points_lost
FROM hex_access_res9;

-- 2. Resolution 8 Aggregation (MAUP Comparison)
SELECT
    COUNT(*) AS total_cells_res8,
    ROUND(SUM(est_population)::numeric, 1) AS total_pop_res8,
    ROUND(SUM(est_population) FILTER (WHERE NOT served_15min)::numeric, 1) AS unserved_pop_res8,
    ROUND((100.0 * SUM(est_population) FILTER (WHERE NOT served_15min) / NULLIF(SUM(est_population), 0))::numeric, 2) AS pct_unserved_res8
FROM hex_access_res8;

-- 3. Worst-Served Populated H3 Cell Identification
SELECT
    h3_index,
    resolution,
    network_dist_m,
    straight_dist_m,
    ROUND((network_dist_m / NULLIF(straight_dist_m, 0))::numeric, 3) AS detour_ratio,
    est_population,
    building_area_sq_m,
    ROUND(ST_Y(center_4326)::numeric, 6) AS center_lat,
    ROUND(ST_X(center_4326)::numeric, 6) AS center_lon
FROM hex_access_res9
WHERE est_population > 10.0
ORDER BY network_dist_m DESC
LIMIT 5;
