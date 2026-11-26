"""
03_isochrones_and_h3.py
Conducts walking network analysis, isochrones, H3 hexagonal indexing (res 8 and 9),
population proxy aggregation from building footprints, and straight-line vs network
comparison for Phase 3 evidence questions.
"""

import os
import pyproj
os.environ['PROJ_DATA'] = pyproj.datadir.get_data_dir()
os.environ['PROJ_LIB'] = pyproj.datadir.get_data_dir()

import json
import numpy as np
import pandas as pd
import geopandas as gpd
import psycopg2
from psycopg2.extras import execute_values
from shapely.geometry import Point, Polygon, LineString, MultiPolygon
from shapely.ops import unary_union, transform
import networkx as nx
import h3

# Database connection
DB_PARAMS = {
    'dbname': 'proximity',
    'user': 'postgres',
    'password': os.environ['DB_PASSWORD'],
    'host': 'localhost',
    'port': 5432
}

print("1. Connecting to PostgreSQL and loading layers...")
conn = psycopg2.connect(**DB_PARAMS)
conn.autocommit = True
cur = conn.cursor()

# Load study area
gdf_area = gpd.read_postgis("SELECT id, name, geom_4326 FROM study_area;", conn, geom_col="geom_4326")
gdf_area['geom_utm'] = gdf_area['geom_4326'].to_crs('EPSG:32643')
area_poly_4326 = gdf_area.geometry.iloc[0]
area_poly_utm = gdf_area['geom_utm'].iloc[0]

# Load services
gdf_services = gpd.read_postgis("SELECT id, name, service_type, geom_4326 FROM services_clean;", conn, geom_col="geom_4326")
print(f"Loaded {len(gdf_services)} healthcare services.")

# Load buildings
gdf_buildings = gpd.read_postgis("SELECT id, name, building_type, area_sq_m, geom_4326 FROM buildings;", conn, geom_col="geom_4326")
gdf_buildings['geom_utm'] = gdf_buildings['geom_4326'].to_crs('EPSG:32643')
print(f"Loaded {len(gdf_buildings)} buildings.")

# Load walking edges
gdf_edges = gpd.read_postgis("SELECT id, highway, geom_4326, length_m FROM walking_network_edges;", conn, geom_col="geom_4326")
gdf_edges['geom_utm'] = gdf_edges['geom_4326'].to_crs('EPSG:32643')
print(f"Loaded {len(gdf_edges)} walking network edges.")

# 2. Build NetworkX graph from UTM edges
print("2. Constructing walking network graph...")
G = nx.Graph()
for idx, row in gdf_edges.iterrows():
    geom = row['geom_utm']
    if geom and geom.geom_type == 'LineString':
        coords = list(geom.coords)
        for i in range(len(coords) - 1):
            u = coords[i]
            v = coords[i+1]
            dist = Point(u).distance(Point(v))
            G.add_edge(u, v, weight=dist)

print(f"Graph constructed: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges.")

# Transformers
proj_wgs84 = pyproj.CRS("EPSG:4326")
proj_utm = pyproj.CRS("EPSG:32643")
tf_to_utm = pyproj.Transformer.from_crs(proj_wgs84, proj_utm, always_xy=True).transform
tf_to_wgs84 = pyproj.Transformer.from_crs(proj_utm, proj_wgs84, always_xy=True).transform

# Helper function to find nearest graph node
node_coords = np.array(list(G.nodes()))

def get_nearest_node(pt_utm):
    dists = np.hypot(node_coords[:, 0] - pt_utm.x, node_coords[:, 1] - pt_utm.y)
    idx = np.argmin(dists)
    return tuple(node_coords[idx])

# Precompute service nodes
service_nodes = []
for idx, row in gdf_services.iterrows():
    pt_4326 = row['geom_4326']
    ux, uy = tf_to_utm(pt_4326.x, pt_4326.y)
    pt_utm = Point(ux, uy)
    node = get_nearest_node(pt_utm)
    service_nodes.append((row['id'], row['name'], pt_utm, node))

# One shortest-path search that starts from ALL facilities at once.
# Each facility is joined to a temporary node SUPER; the edge weight is the
# distance from the facility to its nearest street node.
SUPER = 'ALL_SERVICES'
for s in service_nodes:
    snap = Point(s[3]).distance(s[2])
    if G.has_edge(SUPER, s[3]):
        if snap < G[SUPER][s[3]]['weight']:
            G[SUPER][s[3]]['weight'] = snap
    else:
        G.add_edge(SUPER, s[3], weight=snap)

dist_from_service = nx.single_source_dijkstra_path_length(G, SUPER, weight='weight')
G.remove_node(SUPER)
print("Distances computed to", len(dist_from_service), "street nodes.")

# 3. Generate H3 hexagons covering the study area
print("3. Generating H3 grids at Resolution 8 and Resolution 9...")

def get_h3_gdf(res):
    # Get exterior coords in geojson [lat, lng] format
    ext_coords = [[lat, lng] for lng, lat in area_poly_4326.exterior.coords]
    geo_poly = h3.LatLngPoly(ext_coords)
    hex_ids = list(h3.polygon_to_cells(geo_poly, res=res))
    
    records = []
    for h_id in hex_ids:
        # Boundary
        boundary = h3.cell_to_boundary(h_id)  # [(lat, lng), ...]
        poly_4326 = Polygon([[lng, lat] for lat, lng in boundary])
        poly_utm = transform(tf_to_utm, poly_4326)
        
        # Center
        lat_c, lng_c = h3.cell_to_latlng(h_id)
        pt_4326 = Point(lng_c, lat_c)
        pt_utm = transform(tf_to_utm, pt_4326)
        
        records.append({
            'h3_index': h_id,
            'resolution': res,
            'geom_4326': poly_4326,
            'geom_utm': poly_utm,
            'center_4326': pt_4326,
            'center_utm': pt_utm
        })
    return gpd.GeoDataFrame(records, geometry='geom_utm', crs='EPSG:32643')

gdf_h3_r8 = get_h3_gdf(8)
gdf_h3_r9 = get_h3_gdf(9)
print(f"Generated {len(gdf_h3_r8)} H3 cells at Res 8, {len(gdf_h3_r9)} H3 cells at Res 9.")

# 4. Compute accessibility and building population proxy per cell
print("4. Computing distances and population proxy for H3 cells...")

def analyze_hexes(gdf_hex, target_table):
    results = []
    fallback_count = 0
    for idx, row in gdf_hex.iterrows():
        c_utm = row['center_utm']
        hex_poly_utm = row['geom_utm']
        
        # Straight-line distance to nearest service
        straight_dists = [c_utm.distance(s[2]) for s in service_nodes]
        min_straight = float(min(straight_dists))
        
        # Network distance to nearest service, looked up from the single search above
        c_node = get_nearest_node(c_utm)
        if c_node in dist_from_service:
            min_net = dist_from_service[c_node] + Point(c_node).distance(c_utm)
        else:
            min_net = min_straight * 1.35  # Fallback: street node not connected to any facility
            fallback_count = fallback_count + 1
            
        # Population proxy: building footprint area intersecting hexagon
        # Estimate ~0.04 people per sq meter of building footprint in Ahmedabad (high density residential/commercial)
        b_intersect = gdf_buildings[gdf_buildings['geom_utm'].intersects(hex_poly_utm)]
        building_area = float(b_intersect['geom_utm'].intersection(hex_poly_utm).area.sum())
        est_pop = round(building_area * 0.04, 1)
        
        # Thresholds: 15 min at 4.8 km/h = 1200 m
        # Elderly: 15 min at 3.6 km/h = 900 m
        served_15min = bool(min_net <= 1200.0)
        served_elderly = bool(min_net <= 900.0)
        
        results.append((
            row['h3_index'],
            row['resolution'],
            row['geom_4326'].wkt,
            row['geom_utm'].wkt,
            row['center_4326'].wkt,
            round(min_net, 2),
            round(min_straight, 2),
            round(building_area, 2),
            est_pop,
            served_15min,
            served_elderly
        ))
        
    print("Cells using the straight-line fallback:", fallback_count)
    cur.execute(f"TRUNCATE TABLE {target_table};")
    execute_values(cur, f"""
        INSERT INTO {target_table} (
            h3_index, resolution, geom_4326, geom_utm, center_4326,
            network_dist_m, straight_dist_m, building_area_sq_m, est_population,
            served_15min, served_elderly
        ) VALUES %s;
    """, results, template="""(
        %s, %s,
        ST_SetSRID(ST_GeomFromText(%s), 4326),
        ST_SetSRID(ST_GeomFromText(%s), 32643),
        ST_SetSRID(ST_GeomFromText(%s), 4326),
        %s, %s, %s, %s, %s, %s
    )""")
    print(f"Saved {len(results)} analyzed cells to {target_table}.")
    return pd.DataFrame(results, columns=[
        'h3_index', 'resolution', 'wkt4326', 'wktutm', 'centerwkt',
        'network_dist_m', 'straight_dist_m', 'building_area_sq_m', 'est_population',
        'served_15min', 'served_elderly'
    ])

df_res8 = analyze_hexes(gdf_h3_r8, 'hex_access_res8')
df_res9 = analyze_hexes(gdf_h3_r9, 'hex_access_res9')

# 5. Question 6: 30 Random Sample Points Analysis
print("\n5. Running Question 6: 30 random sample points...")
np.random.seed(101)
random_points = []
minx, miny, maxx, maxy = area_poly_utm.bounds

while len(random_points) < 30:
    rx = np.random.uniform(minx, maxx)
    ry = np.random.uniform(miny, maxy)
    pt = Point(rx, ry)
    if area_poly_utm.contains(pt):
        random_points.append(pt)

q6_rows = []
diff_count = 0
ratios = []

for i, pt in enumerate(random_points):
    # Nearest straight line
    s_dists = [(s[0], s[1], pt.distance(s[2])) for s in service_nodes]
    s_nearest = min(s_dists, key=lambda x: x[2])
    
    # Nearest network: one search from the point, then look up every facility
    pt_node = get_nearest_node(pt)
    d_all = nx.single_source_dijkstra_path_length(G, pt_node, weight='weight')
    n_dists = []
    for s in service_nodes:
        s_node = s[3]
        if s_node in d_all:
            total_net = d_all[s_node] + Point(pt_node).distance(pt) + Point(s_node).distance(s[2])
            n_dists.append((s[0], s[1], total_net))
            
    if n_dists:
        n_nearest = min(n_dists, key=lambda x: x[2])
    else:
        n_nearest = (s_nearest[0], s_nearest[1], s_nearest[2] * 1.35)
        
    diff = (s_nearest[0] != n_nearest[0])
    if diff:
        diff_count += 1
        
    ratio = n_nearest[2] / s_nearest[2] if s_nearest[2] > 0 else 1.0
    ratios.append(ratio)
    
    q6_rows.append({
        'point_id': i + 1,
        'pt_utm_x': round(pt.x, 2),
        'pt_utm_y': round(pt.y, 2),
        'straight_id': s_nearest[0],
        'straight_name': s_nearest[1],
        'straight_dist_m': round(s_nearest[2], 2),
        'network_id': n_nearest[0],
        'network_name': n_nearest[1],
        'network_dist_m': round(n_nearest[2], 2),
        'different_service': diff,
        'ratio': round(ratio, 3)
    })

df_q6 = pd.DataFrame(q6_rows)
worst_case = df_q6.loc[df_q6['ratio'].idxmax()]
median_ratio = df_q6['ratio'].median()
max_ratio = df_q6['ratio'].max()

print(f"Q6 Results: In {diff_count}/30 cases ({diff_count/30*100:.1f}%), the nearest service is a DIFFERENT one!")
print(f"Median network-to-straight ratio: {median_ratio:.3f}")
print(f"Maximum network-to-straight ratio: {max_ratio:.3f}")
print(f"Worst case point #{worst_case['point_id']}: Straight={worst_case['straight_dist_m']}m ({worst_case['straight_name']}), Network={worst_case['network_dist_m']}m ({worst_case['network_name']}), Ratio={worst_case['ratio']}")

# Save Q6 data to CSV
df_q6.to_csv('data/q6_sample_points.csv', index=False)

# 6. Question 7: Coverage and MAUP Analysis
print("\n6. Running Question 7: Coverage and MAUP...")
# Total population proxy in study area
total_pop = df_res9['est_population'].sum()
unserved_pop_net_r9 = df_res9[~df_res9['served_15min']]['est_population'].sum()
unserved_pop_str_r9 = df_res9[df_res9['straight_dist_m'] > 1200.0]['est_population'].sum()

pct_unserved_net_r9 = (unserved_pop_net_r9 / total_pop) * 100
pct_unserved_str_r9 = (unserved_pop_str_r9 / total_pop) * 100

total_pop_r8 = df_res8['est_population'].sum()
unserved_pop_net_r8 = df_res8[~df_res8['served_15min']]['est_population'].sum()
pct_unserved_net_r8 = (unserved_pop_net_r8 / total_pop_r8) * 100

# Ward level aggregation: study area as single unit
# Average network distance across ward
avg_ward_net = df_res9['network_dist_m'].mean()
ward_unserved = 0.0 if avg_ward_net <= 1200 else 100.0

# Largest unserved group: the cell beyond 1200 m with the most people
df_unserved = df_res9[df_res9['network_dist_m'] > 1200.0]
worst_cell = df_unserved.loc[df_unserved['est_population'].idxmax()]

print(f"Share of population beyond 15-min walking threshold:")
print(f"  - By Street Network: {pct_unserved_net_r9:.2f}%")
print(f"  - By Straight-Line Buffer: {pct_unserved_str_r9:.2f}%")
print(f"MAUP comparison across spatial units:")
print(f"  - Ward unit: {ward_unserved:.1f}%")
print(f"  - H3 Resolution 8: {pct_unserved_net_r8:.2f}%")
print(f"  - H3 Resolution 9: {pct_unserved_net_r9:.2f}%")
print(f"Worst-served populated H3 cell: {worst_cell['h3_index']} (Network dist: {worst_cell['network_dist_m']} m, Est. Pop: {worst_cell['est_population']})")

# 7. Question 8: Vulnerable / Elderly Walkers (3.6 km/h)
print("\n7. Running Question 8: Elderly walker coverage (3.6 km/h)...")
unserved_pop_elderly = df_res9[~df_res9['served_elderly']]['est_population'].sum()
pct_unserved_elderly = (unserved_pop_elderly / total_pop) * 100
lost_points = pct_unserved_elderly - pct_unserved_net_r9

print(f"Elderly unserved population (at 3.6 km/h / 900m threshold): {pct_unserved_elderly:.2f}%")
print(f"Coverage lost: {lost_points:.2f} percentage points!")

# Create spatial indexes on hex tables
cur.execute("""
    CREATE INDEX IF NOT EXISTS idx_hex8_utm ON hex_access_res8 USING GIST (geom_utm);
    CREATE INDEX IF NOT EXISTS idx_hex8_4326 ON hex_access_res8 USING GIST (geom_4326);
    CREATE INDEX IF NOT EXISTS idx_hex9_utm ON hex_access_res9 USING GIST (geom_utm);
    CREATE INDEX IF NOT EXISTS idx_hex9_4326 ON hex_access_res9 USING GIST (geom_4326);
""")
print("Spatial indexes on H3 tables created.")

conn.close()
print("Phase 3 analysis completed successfully!")
