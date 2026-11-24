"""
04_export_client_data.py
Exports PostGIS layers into optimized GeoJSON files for the MapLibre client
and serverless PMTiles / GitHub Pages deployment.
"""

import os
import pyproj
os.environ['PROJ_DATA'] = pyproj.datadir.get_data_dir()
os.environ['PROJ_LIB'] = pyproj.datadir.get_data_dir()

import json
import psycopg2
import geopandas as gpd

DB_PARAMS = {
    'dbname': 'proximity',
    'user': 'postgres',
    'password': os.environ['DB_PASSWORD'],
    'host': 'localhost',
    'port': 5432
}

print("Connecting to PostGIS...")
conn = psycopg2.connect(**DB_PARAMS)

os.makedirs('client/data', exist_ok=True)

# 1. Study Area
print("Exporting study area GeoJSON...")
gdf_area = gpd.read_postgis("SELECT id, name, zone, city, geom_4326 FROM study_area;", conn, geom_col="geom_4326")
gdf_area.to_file('client/data/study_area.geojson', driver='GeoJSON')

# 2. Services
print("Exporting services GeoJSON...")
gdf_services = gpd.read_postgis("""
    SELECT id, osm_id, name, amenity, healthcare, service_type, geom_4326 
    FROM services_clean;
""", conn, geom_col="geom_4326")
gdf_services.to_file('client/data/services.geojson', driver='GeoJSON')

# 3. Hex Access Resolution 9
print("Exporting hex accessibility GeoJSON...")
gdf_hex = gpd.read_postgis("""
    SELECT 
        h3_index, resolution, network_dist_m, straight_dist_m, 
        building_area_sq_m, est_population, served_15min, served_elderly,
        geom_4326 
    FROM hex_access_res9;
""", conn, geom_col="geom_4326")
gdf_hex.to_file('client/data/hex_access_res9.geojson', driver='GeoJSON')

# 4. Buildings (for WFS GeoJSON performance benchmark)
print("Exporting buildings GeoJSON...")
gdf_buildings = gpd.read_postgis("""
    SELECT id, osm_id, name, building_type, area_sq_m, geom_4326 
    FROM buildings;
""", conn, geom_col="geom_4326")
gdf_buildings.to_file('client/data/buildings.geojson', driver='GeoJSON')

conn.close()
print("All client datasets exported successfully!")
