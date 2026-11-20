-- ============================================================
-- 02_q1_area_comparisons.sql
-- Evidence Question 1: One area, four areas.
-- Compute area in four ways, compare 3857/UTM ratio with 1/cos^2(lat).
-- ============================================================

SELECT
    name,
    -- 1. ST_Area on EPSG:4326 (square degrees)
    ROUND(ST_Area(geom_4326)::numeric, 8) AS area_4326_sq_degrees,

    -- 2. ST_Area on geography type (square meters on WGS84 spheroid)
    ROUND(ST_Area(geom_4326::geography)::numeric, 2) AS area_geography_sq_m,

    -- 3. ST_Area on UTM Zone 43N (EPSG:32643) (projected metric square meters)
    ROUND(ST_Area(geom_utm)::numeric, 2) AS area_utm_sq_m,

    -- 4. ST_Area on Web Mercator (EPSG:3857) (inflated projected square meters)
    ROUND(ST_Area(ST_Transform(geom_4326, 3857))::numeric, 2) AS area_3857_sq_m,

    -- Ratio of 3857 area to UTM area
    ROUND((ST_Area(ST_Transform(geom_4326, 3857)) / ST_Area(geom_utm))::numeric, 6) AS ratio_3857_to_utm,

    -- Theoretical Mercator area scale factor: 1 / cos^2(lat)
    ROUND((1.0 / (cos(radians(ST_Y(ST_Centroid(geom_4326)))) ^ 2))::numeric, 6) AS theoretical_scale_factor,

    -- Area centroid latitude
    ROUND(ST_Y(ST_Centroid(geom_4326))::numeric, 6) AS centroid_latitude
FROM study_area;
