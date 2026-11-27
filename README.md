# Ahmedabad Healthcare Accessibility WebGIS
### Public map (static, GitHub Pages): [https://rudraupadhyay1802-bot.github.io/proximity-service-platform/](https://rudraupadhyay1802-bot.github.io/proximity-service-platform/)

---

## 1. Project Overview
This project rebuilds an earlier local nearby-services prototype into a Web GIS backed by PostGIS. It asks a public-health planning question:
> **Which residents of the study area (a hand-drawn polygon approximating Navrangpura Ward, Ahmedabad) cannot walk to a healthcare facility within 15 minutes, and where are they?**

### Key Facts
* **Study area**: hand-drawn polygon, 17.72 km², approximating Navrangpura Ward, West Zone, Ahmedabad. It is not an official boundary.
* **Services analysed**: 345 healthcare features from OpenStreetMap (`hospital`, `clinic`, `pharmacy`, `healthcare=*`): **156 inside the study polygon**, the rest in a ≈1.2 km download margin (the brief asks for 2 km) so that edge residents can reach services just outside.
* **Buildings**: 20,607 footprints. **Walking network**: 7,607 OSM ways → a graph of 35,008 nodes and 38,916 edges.
* **Coordinate systems**: WGS 84 (EPSG:4326) for storage and GPS, UTM Zone 43N (EPSG:32643) for distances and areas, Web Mercator (EPSG:3857) for display only.
* **Network analysis**: one multi-source Dijkstra search (NetworkX) from all services at once gives the street-network distance from every road node to its nearest service.
* **Aggregation**: H3 hexagons at resolutions 8 (28 cells) and 9 (179 cells). Population is a proxy: building footprint area × 0.04 persons per m², counting all building types.
* **Thresholds**: adults 4.8 km/h → 1200 m in 15 min; elderly 3.6 km/h → 900 m in 15 min.

### Main Findings (from `analysis/03_isochrones_and_h3.py`)
* A straight-line 1200 m buffer says 0.00% of the estimated population is unserved. By street network, **2.10%** is.
* For the elderly threshold (900 m), **6.48%** is unserved, 4.38 percentage points more than for adults.
* In 9 of 30 random points (30%), the nearest service on foot is not the nearest in a straight line. The median walking route is 1.71× the straight-line distance.
* The unserved share depends on the grid: 0.0% for the ward as one unit, 7.95% at H3 resolution 8, 2.10% at resolution 9.

### Service and Deployment Findings
* **Tile delivery (Q9, buildings, zoom 14)**: MVT from pg_tileserv 6 requests / 469 kB / 1.8 s; WMS PNG 16 / 535 kB / 5.8 s; one WFS GeoJSON 1 / 2,297 kB (13 MB decoded) / 9.9 s.
* **Static site (Q12)**: hexes and services are served from one PMTiles file on GitHub Pages using HTTP Range requests (`206 Partial Content`), with no tile server.
* **Containers (Q10)**: the multi-stage client image is 83.6 MB against 1.6 GB single-stage.
* **Kubernetes (Q11)**: the PostGIS pod recovered in about 2 s and kept its data with a PersistentVolumeClaim; with `emptyDir` the data was lost.

Details and caveats are in [`ANSWERS.md`](ANSWERS.md).

### Status
| Part | Status |
| :--- | :--- |
| OSM download, cleaning, PostGIS load | Done and run |
| Network analysis, H3 aggregation, Q6–Q8 | Done and run |
| SQL evidence (Q1–Q3) | Done and run |
| Map client (MapLibre, PMTiles), deployed to GitHub Pages | Done, live |
| Docker Compose stack, GeoServer WMS/WFS (Q4, Q5) | Done and run |
| Performance comparison (Q9) | Measured at zoom 14 only |
| Docker image builds (Q10) | Built and measured |
| Kubernetes on kind (Q11) | Applied and tested |
| PMTiles Range requests on the live site (Q12) | Measured |
| DEM layer with SLD in GeoServer | Not done; the DEM layer only works against a local GeoServer |

---

## 2. Repository Layout
```text
.
├── README.md
├── ANSWERS.md                    # Evidence questions Q1–Q12, with limitations
├── docker-compose.yml            # PostGIS, GeoServer, pg_tileserv, pg_featureserv
├── .env.example                  # Variable names only, no secrets
├── .gitignore
├── backend/                      # Earlier Node/Express prototype (kept for comparison)
├── study/                        # Concept notes (S1–S4)
├── sql/                          # Spatial SQL for the evidence questions
├── sld/                          # Style Layer Descriptor
├── analysis/
│   ├── 00_download_osm.py        # Downloads OSM data in 16 tiles (API node limit)
│   ├── 00b_merge_osm.py          # Merges the tiles into data/raw_osm_buffered.osm
│   ├── 01_clean_and_load.py      # Parses OSM, cleans, loads PostGIS
│   ├── 02_dem_generator.py
│   ├── 03_isochrones_and_h3.py   # Network distances, H3 cells, Q6–Q8
│   ├── 04_export_client_data.py  # Exports GeoJSON for the web client
│   └── 05_build_pmtiles.py
├── client/                       # MapLibre client, q9_test.html, PMTiles, Dockerfiles, nginx.conf
├── k8s/                          # Kubernetes manifests (tested on kind)
└── .github/workflows/deploy.yml  # GitHub Pages deployment
```

---

## 3. Reproducing the Analysis

### Prerequisites
* Python 3.11+
* PostgreSQL with PostGIS (the analysis was run on PostgreSQL 17 on Windows)

### Step 1: Environment
```bash
git clone https://github.com/rudraupadhyay1802-bot/proximity-service-platform.git
cd proximity-service-platform
python -m venv .venv
# Windows:  .venv\Scripts\activate        Linux/macOS:  source .venv/bin/activate
pip install geopandas shapely networkx h3 rasterio pyproj psycopg2-binary sqlalchemy geoalchemy2 numpy pandas
```

### Step 2: Database password (never stored in code)
The scripts read the password from the environment variable `DB_PASSWORD`. Set it in the same terminal window before running them:
```bash
# Windows cmd (no spaces around "="):   set DB_PASSWORD=yourpassword
# Linux/macOS:                          export DB_PASSWORD=yourpassword
```

### Step 3: Data and analysis
```bash
python analysis/00_download_osm.py       # 16 tiles into data/osm_tile_*.osm
python analysis/00b_merge_osm.py         # writes data/raw_osm_buffered.osm
python analysis/01_clean_and_load.py     # loads PostGIS
python analysis/03_isochrones_and_h3.py  # network analysis, H3, Q6-Q8
python analysis/04_export_client_data.py # GeoJSON for the web client
```
The raw OSM files are large and are listed in `.gitignore`; regenerate them with the first two commands.

### Step 4: SQL evidence
```bash
psql -U postgres -h localhost -d proximity -f sql/02_q1_area_comparisons.sql
psql -U postgres -h localhost -d proximity -f sql/03_q2_indexing_and_explain.sql
psql -U postgres -h localhost -d proximity -f sql/04_q3_data_quality.sql
```

### Step 5: Service stack (Docker Compose)
```bash
docker compose up -d
```
| Service | URL |
| :--- | :--- |
| GeoServer (workspace `webgis`, layers `services_wgs84`, `buildings`) | http://localhost:8081/geoserver |
| pg_tileserv | http://localhost:7800 |
| pg_featureserv | http://localhost:9000 |
| PostGIS | localhost:5433 |

Q9 test page: `cd client && python -m http.server 8000`, then open `http://localhost:8000/q9_test.html?mode=wms|wfs|mvt&z=14`.

### Step 6: PMTiles for the static site
```bash
docker run --rm -v "%cd%\client\data:/data" tippecanoe-local tippecanoe -o /data/proximity_tiles.pmtiles -zg --force --no-feature-limit --no-tile-size-limit -L services:/data/services.geojson -L hex:/data/hex_access_res9.geojson
```
Buildings are deliberately left out: with them, tippecanoe dropped features at zooms 11–12.

### Step 7: Images and Kubernetes
```bash
docker build -t webgis-client:multi client
docker build -t webgis-client:single -f client/Dockerfile.single client
kind create cluster
kubectl apply -f k8s/
```

---

## 4. Debugging Log

### Issue 1: PROJ database mismatch
* **Symptom**: `rasterio.errors.CRSError: The EPSG code is unknown ... proj.db contains DATABASE.LAYOUT.VERSION.MINOR = 2 whereas a number >= 6 is expected.`
* **Cause**: PROJ inside `rasterio` was reading the `proj.db` shipped with the local PostgreSQL install instead of the one in `pyproj`.
* **Fix**: point PROJ at `pyproj`'s data before importing `rasterio`:
  ```python
  import os, pyproj
  os.environ['PROJ_DATA'] = pyproj.datadir.get_data_dir()
  os.environ['PROJ_LIB'] = pyproj.datadir.get_data_dir()
  ```

### Issue 2: Overpass mirrors timing out or refusing
* **Symptom**: `overpass-api.de` timed out and `overpass.openstreetmap.fr` returned `403 Forbidden`.
* **Fix**: download raw XML from the OpenStreetMap API (`/api/0.6/map?bbox=...`) instead and parse it locally.

### Issue 3: OSM API limit of 50,000 nodes per request
* **Symptom**: a single request for the whole study area is refused when it contains too many nodes.
* **Fix**: `00_download_osm.py` splits the area into a 4 × 4 grid of tiles with a pause between requests, and `00b_merge_osm.py` merges them, removing duplicate nodes and ways by id (178,424 nodes in the merged file).

### Issue 4: `ST_Distance < 500` is slow
* **Symptom**: the same 500 m query took 400 ms with `ST_DWithin` and about 9.7 s as `ST_Distance(a, b) < 500`.
* **Cause**: only `ST_DWithin` (and the `&&` operator) can use the GiST index; the planner cannot see a bounding box inside a comparison on `ST_Distance`.
* **Fix**: use `ST_DWithin` for every distance threshold (see Q2 in `ANSWERS.md`).

### Issue 5: "Without index" comparison was not actually without an index
* **Symptom**: the first plan of the Q2 script still showed `Index Scan using idx_buildings_utm`.
* **Cause**: the script dropped indexes named `idx_buildings_geom_utm` and `idx_services_geom_utm`, but `01_clean_and_load.py` had created `idx_buildings_utm` and `idx_services_clean_utm`.
* **Fix**: the script now drops both sets of names. The corrected run shows a sequential scan at 8.7 s versus 0.4 s with the index.

### Issue 6: Network analysis too slow
* **Symptom**: running one shortest-path search for every pair of hexagon and service was impractical on the larger network.
* **Fix**: one multi-source Dijkstra search from all services at once (a temporary super-source node joined to each service node), then a lookup per hexagon or point. When two services share a street node the smaller snap distance is kept; without that, the results differed by up to 6 m during testing.

### Issue 7: Misleading "worst-served cell"
* **Symptom**: the cell with the longest network distance was 4.2 km from care, although a hospital was 131 m away in a straight line.
* **Cause**: each hexagon is represented by its centre point; centres on the river edge connect to the street network only through long detours. These cells hold almost no people.
* **Fix**: "worst-served" is now defined as the cell beyond 1200 m with the most people (805 people at 1,252 m), and the river-edge effect is documented as a limitation.

### Issue 8: Windows `set` with a space
* **Symptom**: `password authentication failed` even though the password was right.
* **Cause**: `set DB_PASSWORD= pass` (space after `=`) stores a leading space in the value.
* **Fix**: `set DB_PASSWORD=pass`.

### Issue 9: GeoServer layer with two geometry columns
* **Symptom**: the services layer published from `services` used the wrong geometry column.
* **Fix**: publish a `services_wgs84` table with a single EPSG:4326 geometry.

### Issue 10: Q9 "feature type unknown"
* **Symptom**: `Feature type webgis:buildings_wgs84 unknown` / `LayerNotDefined`.
* **Cause**: buildings had never been published in GeoServer.
* **Fix**: publish `webgis:buildings` (single 4326 geometry, so no view needed); WFS then returned `numberMatched="20607"`.

### Issue 11: tippecanoe dropping features
* **Symptom**: "keeping the sparsest 68%" at zooms 11–12.
* **Cause**: the 20,607 buildings made those tiles exceed the size limit.
* **Fix**: build the PMTiles with only services and hexes (524 features) plus `--no-feature-limit --no-tile-size-limit`.

### Issue 12: PMTiles errors on the local Python server
* **Symptom**: `Server returned no content-length header ... HTTP Byte Serving`.
* **Cause**: `python -m http.server` does not handle Range requests properly.
* **Fix**: none needed; GitHub Pages supports byte serving (`Accept-Ranges: bytes`, status 206).

---

## 5. Sources and References
1. **OpenStreetMap contributors**: data under the Open Database License (ODbL).
2. **PostGIS documentation**: spatial indexing and query planning.
3. **Open Geospatial Consortium**: WMS 1.3.0 (OGC 06-042), WFS 2.0 (OGC 09-025r2).
4. **Uber H3**: hexagonal hierarchical spatial index, `https://h3geo.org`.
5. **NetworkX**: Hagberg, Schult and Swart (2008), graph analysis in Python.
6. **MapLibre GL JS** and **PMTiles** specifications.
