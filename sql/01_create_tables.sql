-- ============================================================
-- 01_create_tables.sql
-- Base table schemas for Study Area, Services, Buildings,
-- and Hexagonal Accessibility Indices.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Study Area Boundary
DROP TABLE IF EXISTS study_area CASCADE;
CREATE TABLE study_area (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    zone TEXT,
    city TEXT,
    geom_4326 GEOMETRY(Polygon, 4326),
    geom_utm GEOMETRY(Polygon, 32643)
);

-- 2. Cleaned Services (Healthcare)
DROP TABLE IF EXISTS services_clean CASCADE;
CREATE TABLE services_clean (
    id SERIAL PRIMARY KEY,
    osm_id TEXT,
    name TEXT,
    amenity TEXT,
    healthcare TEXT,
    service_type TEXT NOT NULL,
    geom_4326 GEOMETRY(Point, 4326),
    geom_utm GEOMETRY(Point, 32643)
);

-- 3. Buildings
DROP TABLE IF EXISTS buildings CASCADE;
CREATE TABLE buildings (
    id SERIAL PRIMARY KEY,
    osm_id TEXT,
    name TEXT,
    building_type TEXT,
    geom_4326 GEOMETRY(Geometry, 4326),
    geom_utm GEOMETRY(Geometry, 32643),
    area_sq_m NUMERIC
);

-- 4. H3 Hexagons Analysis Results
DROP TABLE IF EXISTS hex_access_res8 CASCADE;
CREATE TABLE hex_access_res8 (
    id SERIAL PRIMARY KEY,
    h3_index TEXT NOT NULL UNIQUE,
    resolution INTEGER NOT NULL DEFAULT 8,
    geom_4326 GEOMETRY(Polygon, 4326),
    geom_utm GEOMETRY(Polygon, 32643),
    center_4326 GEOMETRY(Point, 4326),
    network_dist_m NUMERIC,
    straight_dist_m NUMERIC,
    building_area_sq_m NUMERIC,
    est_population NUMERIC,
    served_15min BOOLEAN,
    served_elderly BOOLEAN
);

DROP TABLE IF EXISTS hex_access_res9 CASCADE;
CREATE TABLE hex_access_res9 (
    id SERIAL PRIMARY KEY,
    h3_index TEXT NOT NULL UNIQUE,
    resolution INTEGER NOT NULL DEFAULT 9,
    geom_4326 GEOMETRY(Polygon, 4326),
    geom_utm GEOMETRY(Polygon, 32643),
    center_4326 GEOMETRY(Point, 4326),
    network_dist_m NUMERIC,
    straight_dist_m NUMERIC,
    building_area_sq_m NUMERIC,
    est_population NUMERIC,
    served_15min BOOLEAN,
    served_elderly BOOLEAN
);
