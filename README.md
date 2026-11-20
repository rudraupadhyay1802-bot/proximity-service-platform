# Ahmedabad Healthcare Accessibility WebGIS Platform
### Public Serverless Map URL: [https://rudraupadhyay1802-bot.github.io/proximity-service-platform/](https://rudraupadhyay1802-bot.github.io/proximity-service-platform/)

---

## 1. Project Overview
This project rebuilds an earlier local nearby-services prototype into a professional, containerized, and deployed Web GIS. It answers a crucial urban public-health planning question:
> **Which residents of Navrangpura Ward (Ahmedabad) cannot reach a healthcare facility on foot within a reasonable walking time (15 minutes), and why?**

### Key System Specifications
* **Study Area**: Navrangpura Ward, West Zone, Ahmedabad, Gujarat, India (~17.72 km²).
* **Service Analyzed**: Healthcare facilities (`hospital`, `clinic`, `pharmacy`, `healthcare=*`) — 115 deduplicated, ground-truth-verified locations.
* **Coordinate Systems**:
  * Ingestion & GPS: **WGS 84 (EPSG:4326)**
  * Projected Metric Distance & Area: **UTM Zone 43N (EPSG:32643)**
  * Web Slippy Map: **Spherical Mercator (EPSG:3857)**
* **Network Analysis**: Dijkstra shortest paths over the complete 10,425-node walkable street network extracted from OpenStreetMap.
* **Spatial Aggregation**: H3 Hexagonal Global Discrete Grid System (Resolutions 8 & 9) with building footprint area (~5,182 buildings) as population proxy.
* **Disparity Mode**: Evaluates standard adult walking ($4.8\text{ km/h} \rightarrow 1200\text{ m}$) vs vulnerable/elderly walkers ($3.6\text{ km/h} \rightarrow 900\text{ m}$).

---

## 2. Repository Layout
```text
.
├── README.md                     # Public URL, quickstart, architecture, debugging log
├── ANSWERS.md                    # Evidence questions Q1–Q12 with reproducible SQL and outputs
├── docker-compose.yml            # Multi-service stack: PostGIS, GeoServer, pg_tileserv, pg_featureserv
├── .env.example                  # Environment template (variable names only, no secrets)
├── .gitignore                    # Prevents credentials, caches, and large binary tracking
├── study/                        # Phase 0 conceptual guides + diagrams + lab proofs
│   ├── S1_ogc_services_and_crs.md
│   ├── S2_tiles_and_indexes.md
│   ├── S3_measuring_access.md
│   ├── S4_docker_and_kubernetes.md
│   └── lab_proof.md
├── sql/                          # Executable spatial SQL scripts
│   ├── 01_create_tables.sql
│   ├── 02_q1_area_comparisons.sql
│   ├── 03_q2_indexing_and_explain.sql
│   ├── 04_q3_data_quality.sql
│   └── 05_hex_coverage.sql
├── sld/                          # OGC Style Layer Descriptor
│   └── services_rules.sld
├── analysis/                     # Data processing & analytics scripts
│   ├── 01_clean_and_load.py
│   ├── 02_dem_generator.py
│   ├── 03_isochrones_and_h3.py
│   └── 04_export_client_data.py
├── client/                       # Interactive MapLibre GL JS client
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── nginx.conf
│   ├── Dockerfile
│   ├── Dockerfile.single
│   └── data/
├── k8s/                          # Production Kubernetes manifests
│   ├── 01_secrets.yaml
│   ├── 02_postgis_statefulset.yaml
│   ├── 03_client_deployment.yaml
│   └── 04_k8s_emptydir_test.yaml
└── .github/workflows/            # CI/CD automation
    └── deploy.yml
```

---

## 3. Local Setup & Reproduction

### Prerequisites
* Python 3.11+ / `uv`
* PostgreSQL 16+ with PostGIS 3+ (or Docker)
* Node.js 18+ (optional for legacy backend)

### Step 1: Environment Setup
```bash
# Clone the repository
git clone https://github.com/rudraupadhyay1802-bot/proximity-service-platform.git
cd proximity-service-platform

# Create virtual environment and install dependencies
uv venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
# source .venv/bin/activate

uv pip install geopandas osmnx shapely networkx h3 rasterio pyproj psycopg2-binary sqlalchemy geoalchemy2 pmtiles
```

### Step 2: Database Initialization & Ingestion
```bash
# Copy environment template
cp .env.example .env
# Edit .env with your local credentials

# Ingest raw OSM data, clean geometries, and project to UTM Zone 43N
python analysis/01_clean_and_load.py

# Generate clipped DEM elevation surface
python analysis/02_dem_generator.py

# Run network isochrone & H3 hexagonal accessibility analysis
python analysis/03_isochrones_and_h3.py

# Export client GeoJSON and vector datasets
python analysis/04_export_client_data.py
```

### Step 3: Launch Local Docker Stack
```bash
docker compose up -d
```
* **PostGIS**: `localhost:5432`
* **GeoServer**: `http://localhost:8080/geoserver`
* **pg_tileserv**: `http://localhost:7800`
* **pg_featureserv**: `http://localhost:9000`

### Step 4: Run with Kubernetes (`kind`)
```bash
kind create cluster --name webgis-cluster
kubectl apply -f k8s/01_secrets.yaml
kubectl apply -f k8s/02_postgis_statefulset.yaml
kubectl apply -f k8s/03_client_deployment.yaml

# Port forward the client
kubectl port-forward svc/webgis-client-service 8080:80
```

---

## 4. Debugging Log

### Issue 1: PROJ Version Mismatch & EPSG Definition Failure
* **Symptom**: During DEM generation with `rasterio`, the script crashed with:
  ```text
  rasterio.errors.CRSError: The EPSG code is unknown. PROJ: proj_create_from_database: 
  C:\Program Files\PostgreSQL\17\share\contrib\postgis-3.6\proj\proj.db contains 
  DATABASE.LAYOUT.VERSION.MINOR = 2 whereas a number >= 6 is expected. 
  It comes from another PROJ installation.
  ```
* **Root Cause**: Windows environment variables allowed the PROJ library embedded in `rasterio` to read the legacy `proj.db` from the local PostgreSQL 17 directory instead of the `pyproj` package directory.
* **Fix**: Added explicit Python configuration to force PROJ to use `pyproj`'s bundled data directory prior to importing `rasterio`:
  ```python
  import os, pyproj
  os.environ['PROJ_DATA'] = pyproj.datadir.get_data_dir()
  os.environ['PROJ_LIB'] = pyproj.datadir.get_data_dir()
  ```

### Issue 2: Overpass Public Mirror Timeouts & White-Listing Block
* **Symptom**: OSMnx feature queries to `overpass-api.de` stalled with `ReadTimeoutError`, and `overpass.openstreetmap.fr` responded with `403 Forbidden This service is only available to white-listed usages`.
* **Root Cause**: Public Overpass interpreters enforce aggressive throttling and IP blacklisting during heavy requests.
* **Fix**: Built a robust ingestion pipeline fetching raw OSM XML directly from the authoritative OpenStreetMap API (`https://api.openstreetmap.org/api/0.6/map?bbox=...`) using customized headers. Saved raw XML locally (`data/raw_osm_navrangpura.osm`, 11.8 MB) and wrote an XML parser to extract buildings, highways, and amenities cleanly and reproducibly without external API fragility.

### Issue 3: Invalidation of GiST Spatial Index via Scalar Comparison
* **Symptom**: Querying buildings within 500m took 39 ms with `ST_DWithin`, but rewriting the predicate as `ST_Distance(a, b) < 500` spiked execution time to 301 ms.
* **Root Cause**: PostgreSQL's query optimizer only recognizes geometric operators (`&&`, `ST_DWithin`, `<->`) for GiST R-tree bounding box expansion. A scalar `<` operator forces a complete Cartesian scan.
* **Fix**: Documented in study note `S2` and `ANSWERS.md` Q2 that all proximity thresholds must use `ST_DWithin` on projected metric geometries.

---

## 5. Sources and References
1. **OpenStreetMap Foundation**: Raw geospatial data under Open Database License (ODbL).
2. **PostGIS Documentation**: Spatial Indexing and Query Tuning (PostGIS 3.4 manual).
3. **Open Geospatial Consortium (OGC)**: WMS 1.3.0 (OGC 06-042), WFS 2.0 (OGC 09-025r2), and OGC API – Features specifications.
4. **Uber H3**: Hexagonal Hierarchical Spatial Indexing System documentation (`https://h3geo.org`).
5. **OSMnx**: Boeing, G. (2017). *OSMnx: New methods for acquiring, constructing, analyzing, and visualizing complex street networks*. Computers, Environment and Urban Systems, 65, 126-139.
6. **MapLibre GL JS & PMTiles**: MapLibre Foundation and Protomaps specification.
