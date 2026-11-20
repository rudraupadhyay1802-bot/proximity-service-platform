"""
01_clean_and_load.py
Parses raw OpenStreetMap XML (Navrangpura, Ahmedabad), cleans geometries,
converts polygons to points for services, computes UTM Zone 43N (EPSG:32643)
reprojections, and loads layers into PostgreSQL/PostGIS.
"""

import xml.etree.ElementTree as ET
import json
import psycopg2
from psycopg2.extras import execute_values
from shapely.geometry import Point, Polygon, MultiPolygon, LineString
import geopandas as gpd
import pandas as pd
from shapely.ops import transform
import pyproj

# Connect to database
DB_PARAMS = {
    'dbname': 'proximity',
    'user': 'postgres',
    'password': 'Rudra@1234',
    'host': 'localhost',
    'port': 5432
}

print("1. Connecting to PostgreSQL/PostGIS...")
conn = psycopg2.connect(**DB_PARAMS)
conn.autocommit = True
cur = conn.cursor()

# Run table creation DDL
with open('sql/01_create_tables.sql', 'r') as f:
    ddl = f.read()
cur.execute(ddl)
print("Table schemas initialized.")

# Load study area
print("2. Loading study area...")
with open('data/study_area.geojson', 'r') as f:
    area_geojson = json.load(f)
area_feature = area_geojson['features'][0]
area_poly_coords = area_feature['geometry']['coordinates'][0]
area_poly = Polygon(area_poly_coords)

cur.execute("""
    INSERT INTO study_area (name, zone, city, geom_4326, geom_utm)
    VALUES (%s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 32643));
""", (
    area_feature['properties']['name'],
    area_feature['properties']['zone'],
    area_feature['properties']['city'],
    json.dumps(area_feature['geometry']),
    json.dumps(area_feature['geometry'])
))
print("Study area loaded successfully.")

# Parse raw OSM XML
print("3. Parsing raw OSM data...")
tree = ET.parse('data/raw_osm_navrangpura.osm')
root = tree.getroot()

nodes_dict = {}
node_tags = {}
for n in root.findall('node'):
    nid = n.attrib['id']
    lon = float(n.attrib['lon'])
    lat = float(n.attrib['lat'])
    nodes_dict[nid] = (lon, lat)
    tags = {t.attrib['k']: t.attrib['v'] for t in n.findall('tag')}
    if tags:
        node_tags[nid] = tags

print(f"Extracted {len(nodes_dict)} OSM nodes.")

# Extract healthcare services (nodes + ways)
services_records = []
HEALTHCARE_AMENITIES = {'hospital', 'clinic', 'doctors', 'pharmacy'}

# Process node services
for nid, tags in node_tags.items():
    amenity = tags.get('amenity')
    healthcare = tags.get('healthcare')
    if amenity in HEALTHCARE_AMENITIES or healthcare:
        lon, lat = nodes_dict[nid]
        name = tags.get('name')
        stype = amenity if amenity in HEALTHCARE_AMENITIES else (healthcare or 'healthcare')
        services_records.append({
            'osm_id': f"node/{nid}",
            'name': name,
            'amenity': amenity,
            'healthcare': healthcare,
            'service_type': stype,
            'geom_4326': Point(lon, lat)
        })

# Process way services & buildings
buildings_records = []
highways_records = []

for w in root.findall('way'):
    wid = w.attrib['id']
    tags = {t.attrib['k']: t.attrib['v'] for t in w.findall('tag')}
    nd_refs = [nd.attrib['ref'] for nd in w.findall('nd')]
    coords = [nodes_dict[ref] for ref in nd_refs if ref in nodes_dict]

    if len(coords) < 2:
        continue

    # Healthcare ways (convert polygon/line to centroid point)
    amenity = tags.get('amenity')
    healthcare = tags.get('healthcare')
    if amenity in HEALTHCARE_AMENITIES or healthcare:
        if len(coords) >= 4 and coords[0] == coords[-1]:
            poly = Polygon(coords)
            pt = poly.centroid
        else:
            line = LineString(coords)
            pt = line.centroid
        name = tags.get('name')
        stype = amenity if amenity in HEALTHCARE_AMENITIES else (healthcare or 'healthcare')
        services_records.append({
            'osm_id': f"way/{wid}",
            'name': name,
            'amenity': amenity,
            'healthcare': healthcare,
            'service_type': stype,
            'geom_4326': pt
        })

    # Buildings
    if 'building' in tags:
        if len(coords) >= 4 and coords[0] == coords[-1]:
            try:
                poly = Polygon(coords)
                if poly.is_valid and not poly.is_empty:
                    buildings_records.append({
                        'osm_id': f"way/{wid}",
                        'name': tags.get('name'),
                        'building_type': tags.get('building'),
                        'geom_4326': poly
                    })
            except Exception:
                pass

    # Walking highways
    if 'highway' in tags:
        hw = tags.get('highway')
        # Pedestrian walkable highways
        if hw in {'footway', 'pedestrian', 'path', 'residential', 'living_street', 'service', 'tertiary', 'secondary', 'primary', 'track', 'steps'}:
            if len(coords) >= 2:
                try:
                    line = LineString(coords)
                    highways_records.append({
                        'osm_id': f"way/{wid}",
                        'highway': hw,
                        'name': tags.get('name'),
                        'geom_4326': line
                    })
                except Exception:
                    pass

print(f"Extracted {len(services_records)} raw healthcare features.")
print(f"Extracted {len(buildings_records)} building footprints.")
print(f"Extracted {len(highways_records)} walkable highway segments.")

# Deduplicate services within 15 meters
print("4. Deduplicating services...")
clean_services = []
seen_coords = []

# Transformer to UTM
proj_wgs84 = pyproj.CRS("EPSG:4326")
proj_utm = pyproj.CRS("EPSG:32643")
transformer = pyproj.Transformer.from_crs(proj_wgs84, proj_utm, always_xy=True)

for s in services_records:
    pt = s['geom_4326']
    # Check duplicate
    is_dup = False
    pt_utm_x, pt_utm_y = transformer.transform(pt.x, pt.y)
    for prev_x, prev_y, prev_name in seen_coords:
        dist = ((pt_utm_x - prev_x)**2 + (pt_utm_y - prev_y)**2)**0.5
        if dist < 15.0 and (s['name'] == prev_name or s['name'] is None):
            is_dup = True
            break
    if not is_dup:
        seen_coords.append((pt_utm_x, pt_utm_y, s['name']))
        clean_services.append(s)

print(f"Deduplicated down to {len(clean_services)} unique healthcare services.")

# Insert into services_clean
for s in clean_services:
    pt = s['geom_4326']
    cur.execute("""
        INSERT INTO services_clean (osm_id, name, amenity, healthcare, service_type, geom_4326, geom_utm)
        VALUES (%s, %s, %s, %s, %s,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 32643));
    """, (s['osm_id'], s['name'], s['amenity'], s['healthcare'], s['service_type'], pt.x, pt.y, pt.x, pt.y))

# Insert buildings
print("5. Inserting buildings into PostGIS...")
cur.execute("""
    CREATE TEMP TABLE tmp_buildings (
        osm_id TEXT,
        name TEXT,
        building_type TEXT,
        geom_wkt TEXT
    );
""")
tmp_b_inserts = [(b['osm_id'], b['name'], b['building_type'], b['geom_4326'].wkt) for b in buildings_records]
execute_values(cur, "INSERT INTO tmp_buildings (osm_id, name, building_type, geom_wkt) VALUES %s", tmp_b_inserts)

cur.execute("""
    INSERT INTO buildings (osm_id, name, building_type, geom_4326, geom_utm, area_sq_m)
    SELECT
        osm_id,
        name,
        building_type,
        ST_SetSRID(ST_GeomFromText(geom_wkt), 4326),
        ST_Transform(ST_SetSRID(ST_GeomFromText(geom_wkt), 4326), 32643),
        ST_Area(ST_Transform(ST_SetSRID(ST_GeomFromText(geom_wkt), 4326), 32643))
    FROM tmp_buildings;
""")
print(f"Successfully loaded {len(buildings_records)} buildings with UTM geometries.")

# Create highways table and load
cur.execute("""
    DROP TABLE IF EXISTS walking_network_edges CASCADE;
    CREATE TABLE walking_network_edges (
        id SERIAL PRIMARY KEY,
        osm_id TEXT,
        highway TEXT,
        name TEXT,
        geom_4326 GEOMETRY(LineString, 4326),
        geom_utm GEOMETRY(LineString, 32643),
        length_m NUMERIC
    );
    CREATE TEMP TABLE tmp_highways (
        osm_id TEXT,
        highway TEXT,
        name TEXT,
        geom_wkt TEXT
    );
""")

tmp_hw_inserts = [(h['osm_id'], h['highway'], h['name'], h['geom_4326'].wkt) for h in highways_records]
execute_values(cur, "INSERT INTO tmp_highways (osm_id, highway, name, geom_wkt) VALUES %s", tmp_hw_inserts)

cur.execute("""
    INSERT INTO walking_network_edges (osm_id, highway, name, geom_4326, geom_utm, length_m)
    SELECT
        osm_id,
        highway,
        name,
        ST_SetSRID(ST_GeomFromText(geom_wkt), 4326),
        ST_Transform(ST_SetSRID(ST_GeomFromText(geom_wkt), 4326), 32643),
        ST_Length(ST_Transform(ST_SetSRID(ST_GeomFromText(geom_wkt), 4326), 32643))
    FROM tmp_highways;
""")
print(f"Loaded {len(highways_records)} walking network edges.")

# Create spatial indexes
cur.execute("""
    CREATE INDEX IF NOT EXISTS idx_services_clean_4326 ON services_clean USING GIST (geom_4326);
    CREATE INDEX IF NOT EXISTS idx_services_clean_utm ON services_clean USING GIST (geom_utm);
    CREATE INDEX IF NOT EXISTS idx_buildings_4326 ON buildings USING GIST (geom_4326);
    CREATE INDEX IF NOT EXISTS idx_buildings_utm ON buildings USING GIST (geom_utm);
    CREATE INDEX IF NOT EXISTS idx_walk_edges_utm ON walking_network_edges USING GIST (geom_utm);
""")
print("Spatial indexes created.")

conn.close()
print("Phase 1 data loading completed successfully!")
