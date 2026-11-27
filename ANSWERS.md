# WebGIS Assignment: From Nearby Services to a Deployed Map Service
## Technical Evidence & Analytical Report (`ANSWERS.md`)

**How to read this report.** Every number below was produced on the author's machine: database results by running the scripts in `sql/` and `analysis/` against PostGIS; service results against the local Docker Compose stack (PostGIS, GeoServer, pg_tileserv, pg_featureserv); deployment results on a local kind cluster and on the public GitHub Pages site. Q9 was measured at zoom 14 only (see Q9).

---

### Project Registration Details
* **Study Area**: A hand-drawn polygon approximating Navrangpura Ward, West Zone, Ahmedabad, Gujarat, India (17.72 km²). It is **not** an official administrative boundary.
* **Service Type**: Healthcare (`amenity=hospital`, `amenity=clinic`, `amenity=pharmacy`, `healthcare=*`). Features tagged only with `healthcare=*` have `amenity = NULL` in the table.
* **OSM Feature Count**: **156 healthcare features inside the study-area polygon**; **345** after cleaning when the download margin is included. The download script expands the study-area bounding box by about **1.2 km** on each side (the brief asks for 2 km), so that services just outside the boundary can still be "nearest" for residents near the edge.
* **Buildings**: 20,607 footprints. **Walking network**: 7,607 OSM ways, which become a graph of 35,008 nodes and 38,916 edges.
* **UTM Zone & EPSG Code**: **UTM Zone 43N (EPSG:32643)** (study-area longitude about 72.56° E)
* **Walking Speed & Threshold**: Urban area, so standard adult → **15 minutes = 1200 m at 4.8 km/h**; elderly / mobility-limited → **15 minutes = 900 m at 3.6 km/h**
* **Public Deployment URL**: `https://rudraupadhyay1802-bot.github.io/proximity-service-platform/`
* **Earlier Nearby-Services Baseline**: the earlier local prototype in the `backend/` folder of this repository

---

## Phase 1 — From API Data to Your Own Database

### Evidence Question 1: One Area, Four Areas
#### Objective
Compute the study area's size four ways: `ST_Area` on EPSG:4326 geometry, on the `geography` type, after transforming to UTM Zone 43N, and after transforming to EPSG:3857. Compare the ratio of EPSG:3857 to UTM against $1/\cos^2(\phi_{\text{centroid}})$.

#### SQL (`sql/02_q1_area_comparisons.sql`)
```sql
SELECT
    name,
    ROUND(ST_Area(geom_4326)::numeric, 8) AS area_4326_sq_deg,
    ROUND(ST_Area(geom_4326::geography)::numeric, 2) AS area_geography_sq_m,
    ROUND(ST_Area(geom_utm)::numeric, 2) AS area_utm_sq_m,
    ROUND(ST_Area(ST_Transform(geom_4326, 3857))::numeric, 2) AS area_3857_sq_m,
    ROUND((ST_Area(ST_Transform(geom_4326, 3857)) / ST_Area(geom_utm))::numeric, 6) AS ratio_3857_to_utm,
    ROUND((1.0 / (cos(radians(ST_Y(ST_Centroid(geom_4326)))) ^ 2))::numeric, 6) AS theoretical_scale_factor,
    ROUND(ST_Y(ST_Centroid(geom_4326))::numeric, 6) AS centroid_latitude
FROM study_area;
```

#### Database Output (run with `psql`)
```text
name                     : Navrangpura Ward
area_4326_sq_degrees     : 0.00156000 sq degrees
area_geography_sq_m      : 17706975.50 m² (17.71 km²)
area_utm_sq_m            : 17720172.86 m² (17.72 km²)
area_3857_sq_m           : 21006945.70 m² (21.01 km²)
ratio_3857_to_utm        : 1.185482
theoretical_scale_factor : 1.180841
centroid_latitude        : 23.037829° N
```

#### Explanation
1. **Match with theory**: Web Mercator stretches linear distances by $\sec(\phi)$, so areas inflate by $\sec^2(\phi)$. At $\phi = 23.037829^\circ$ the predicted factor is **1.180841**. The measured ratio of the EPSG:3857 area to the UTM area is **1.185482**, which is 0.39% higher than the prediction.
2. **Likely cause of the 0.39% gap**: the formula assumes a sphere, while UTM 43N uses the WGS 84 ellipsoid and has its own small scale variation across the zone. This explanation was not tested separately.
3. **CRS used by the earlier project**: the earlier prototype (`backend/server.js`) measured distance with the PostGIS `geography` type, `ST_Distance(geom_4326::geography, ...)`. That gives ellipsoidal metres on WGS 84, not UTM and not EPSG:3857.
4. **Which area is "right"**: the UTM and `geography` areas agree to within 0.1% (17.72 vs 17.71 km²). The EPSG:3857 area is about 19% too large and must not be used for measuring. The degrees-squared value has no physical unit.

---

### Evidence Question 2: Indexes and Query Plans
#### Objective
Count building footprints within 500 m of each healthcare facility with `ST_DWithin` on UTM geometry. Compare `EXPLAIN ANALYZE` without a GiST index, with a GiST index, and rewritten as `ST_Distance(a, b) < 500`.

#### SQL (`sql/03_q2_indexing_and_explain.sql`)
The script first drops every GiST index on the two tables (both names that have been used in this project), runs the query, creates the indexes, runs it again, then runs the `ST_Distance` rewrite.

#### Results (single runs, 345 services × 20,607 buildings = 7,109,415 pairs)
| Metric | No GiST index | GiST index, `ST_DWithin` | `ST_Distance(...) < 500` |
| :--- | :--- | :--- | :--- |
| **Execution time** | **8,686 ms** | **400 ms** (21.7× faster) | **9,682 ms** (24.2× slower than indexed) |
| **Scan on `buildings`** | `Seq Scan` | `Index Scan using idx_buildings_utm` | `Seq Scan` |
| **Index condition** | none | `geom_utm && st_expand(s.geom_utm, 500)` | none |
| **Pairs tested exactly** | 7,109,415 | about 502 candidates per service (about 409 pass, 141,048 in total) | 7,109,415 |
| **Rows removed by join filter** | 6,968,367 | 93 per service by the filter | 6,968,367 |

All three plans return the same 141,048 matching pairs. Only the work needed to find them differs.

#### Explanation
* **Why the index helps**: PostGIS rewrites `ST_DWithin(a, b, 500)` into a bounding-box test `a.geom && ST_Expand(b.geom, 500)` that the GiST R-tree can answer. Only about 500 of the 20,607 buildings per service are then checked exactly.
* **Why `ST_Distance < 500` cannot use it**: the planner treats `ST_Distance(a, b)` as an opaque function and does not know that a small result implies bounding-box overlap. It therefore tests all 7.1 million pairs. It was also slightly slower than the no-index `ST_DWithin` run, probably because computing the exact distance for every pair costs more than the `ST_DWithin` test.
* **Caveat**: each figure is one run, not an average. The ratios are stable, but the millisecond values will vary a little between runs.

---

### Evidence Question 3: Data Quality vs Earlier Source
#### SQL (`sql/04_q3_data_quality.sql`)
Counts services with no name, pairs of services within 25 m, the earlier prototype's count in the same box, and a reproducible sample of five facilities.

#### Results
```text
total_services      : 345   (156 inside the polygon + 189 in the download margin)
unnamed_count       : 5   (1.45% of all 345)
pairs_within_25m    : 76  (across all 345)
earlier prototype   : 108 healthcare facilities in the box 72.54–72.58 E, 23.02–23.05 N
this project        : 113 healthcare facilities in the SAME box (services_clean)
```

#### Explanation
* **Same-box comparison**: the earlier prototype counted 108 facilities in the box 72.54–72.58 E, 23.02–23.05 N. This project's cleaned table has **113** in the same box. The 345 figure covers the whole area plus margin and is not comparable with 108.
* **Likely reason for the 5 extra**: the earlier importer (`backend/import-osm.js`, line 85) contains `if (!name) continue;`, which drops every feature without a name tag. This project keeps unnamed features (5 in total). This explains the direction of the difference, but I did not count how many of the 5 unnamed features fall inside the comparison box, so it is **not proven** that they account for all 5 extra.
* **Clustering (76 pairs within 25 m)**: pairs this close usually mean a pharmacy beside a clinic, or several departments of one hospital mapped as separate points. Whether any of the 76 are true duplicates was not checked.

#### Ground-truth check of five facilities
Sample drawn reproducibly in one `psql` session:
```sql
SELECT setseed(0.42);
SELECT name, amenity, ROUND(ST_Y(geom)::numeric,6) AS lat, ROUND(ST_X(geom)::numeric,6) AS lon
FROM services_wgs84
ORDER BY random()
LIMIT 5;
```
Checked against Google Maps listings and Street View (second source):

| Service | OSM tag | lat, lon | Result |
| :--- | :--- | :--- | :--- |
| Shalin Eyecare Hospital | hospital | 23.047298, 72.562203 | Correct (listing on Sardar Patel Stadium Rd matches) |
| Kanan Hospital | NULL (`healthcare=*`) | 23.046750, 72.569274 | Correct (Street View ≈26 m away, consistent with address opposite Usmanpura Garden) |
| Vadilal Sarabhai Hospital | NULL (`healthcare=*`) | 23.019118, 72.571747 | Correct (listing in Ellisbridge matches; `ST_Within` the study polygon = true) |
| Infocus Diagnostics | hospital | 23.039403, 72.562702 | Location correct (listing ≈11 m away), **category wrong**: a diagnostic lab tagged as a hospital |
| Shantilal Parikh Hospital and Check Up Clinic | hospital | 23.037334, 72.570690 | Correct (listing near Dinesh Hall; open, not closed) |

**Result: 5/5 correctly located, 0 misplaced, 0 closed; 1/5 misclassified.** The misclassification matters more than the location check: OSM positions here are reliable, but `amenity=hospital` is applied loosely, which inflates hospital counts. Limitation: three pins had no Street View coverage, so they were confirmed by listing only, not by façade.

---

## Phase 2 — Publish Your Own OGC Services

GeoServer (`kartoza/geoserver:2.24.1`, port 8081), workspace `webgis`, PostGIS store `proximity_pg`, layers `webgis:services_wgs84` and `webgis:buildings`.

### Evidence Question 4: The Axis-Order Trap (WMS 1.1.1 vs 1.3.0)
#### BoundingBox from WMS 1.3.0 GetCapabilities (`webgis:services_wgs84`)
```xml
<BoundingBox CRS="EPSG:4326" minx="23.007041931152344" miny="72.52600860595703" maxx="23.06866455078125" maxy="72.59368896484375"/>
```
The `CRS:84` BoundingBox for the same layer has the same numbers longitude-first: `minx="72.52600860595703" miny="23.007041931152344" maxx="72.59368896484375" maxy="23.06866455078125"`.

#### Requests (same four numbers in BBOX)
```text
http://localhost:8081/geoserver/webgis/wms?service=WMS&version=1.1.1&request=GetMap&layers=webgis:services_wgs84&styles=&format=image/png&srs=EPSG:4326&bbox=72.52600860595703,23.007041931152344,72.59368896484375,23.06866455078125&width=768&height=700

http://localhost:8081/geoserver/webgis/wms?service=WMS&version=1.3.0&request=GetMap&layers=webgis:services_wgs84&styles=&format=image/png&crs=EPSG:4326&bbox=72.52600860595703,23.007041931152344,72.59368896484375,23.06866455078125&width=768&height=700
```

#### Result
* **WMS 1.1.1**: the red service points are drawn.
* **WMS 1.3.0**: a blank white image.

#### Explanation
WMS 1.1.1 reads an EPSG:4326 BBOX as longitude, latitude. WMS 1.3.0 follows the EPSG registry, where EPSG:4326 is defined as latitude, longitude (OGC 06-042, section 6.7.3). That is why the 1.3.0 GetCapabilities writes the box latitude-first (`minx="23.00…"`), while the `CRS:84` box, which is defined longitude-first, has the same numbers swapped. Sent with the longitude-first numbers, 1.3.0 read 72.53–72.59 as latitude and 23.01–23.07 as longitude: a box in the Arctic Ocean north of Russia, where there are no services, so the image is blank. The fix for 1.3.0 is to send `bbox=23.007,72.526,23.069,72.594`, or to use `CRS:84`.

---

### Evidence Question 5: WFS with a Filter (GeoJSON vs GML 3.2)
#### Requests (named services)
```text
Count:
http://localhost:8081/geoserver/webgis/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webgis:services_wgs84&resultType=hits&cql_filter=name%20IS%20NOT%20NULL

GML 3.2:
http://localhost:8081/geoserver/webgis/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webgis:services_wgs84&outputFormat=gml32&cql_filter=name%20IS%20NOT%20NULL

GeoJSON:
http://localhost:8081/geoserver/webgis/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webgis:services_wgs84&outputFormat=application/json&cql_filter=name%20IS%20NOT%20NULL
```

#### Results
**numberMatched = 340** (345 services minus the 5 unnamed ones from Q3).

| Format | Features | Size | First point | Order |
| :--- | :--- | :--- | :--- | :--- |
| GML 3.2 (`q5_named.gml`) | 340 | 244,303 bytes (238.6 KB) | `23.0174 72.5304` | latitude, longitude |
| GeoJSON (`q5_named.json`) | 340 | 107,795 bytes (105.3 KB) | `[72.5304, 23.0174]` | longitude, latitude |

**Note on "inside your area"**: the filter is on the name only, so the 340 include services in the download margin. Restricting to the polygon would add a spatial term such as `INTERSECTS(geom, …)` to the CQL filter; of the 156 services inside the polygon, the named subset was not counted separately.

#### Explanation
WFS 2.0 with GML 3.2 follows the EPSG axis order for `urn:ogc:def:crs:EPSG::4326`, so coordinates come out latitude first. GeoJSON (RFC 7946) always uses longitude, latitude. The same features therefore appear with swapped coordinates in the two files. GML is 2.3× larger (238.6 vs 105.3 KB) because every feature, attribute and coordinate is wrapped in namespaced XML elements, while GeoJSON uses compact JSON keys and arrays.

---

## Phase 3 — Was Your Earlier "Nearest" Right?

All results in this phase come from `analysis/03_isochrones_and_h3.py` (output in `data/q6_sample_points.csv` and the hex tables).

**Method.** The walking graph has 35,008 nodes and 38,916 edges built from 7,607 OSM ways. Each point or hexagon centre and each service is snapped to its nearest graph node; the snap distance is added to the path length. Network distance to the nearest service is computed with one multi-source Dijkstra search started from all 345 services at once (a temporary super-source node joined to every service node with an edge equal to the snap distance). During development this was compared with the slower one-search-per-pair method on an earlier, smaller version of the network, and the two agreed to within 10⁻¹² m. That comparison was not repeated on the final network.

### Evidence Question 6: Straight Line vs Street Network
#### Results (30 random points, seed 101, `data/q6_sample_points.csv`)
* **Different nearest service**: for **9 of 30 points (30.0%)** the nearest service by street network is not the one that is nearest in a straight line.
* **Median network-to-straight ratio**: **1.706**. A typical walking route is about 71% longer than the straight line.
* **Maximum ratio**: **5.884** (point 9).

The straight-line side of all 30 rows was recomputed independently from `services.geojson` and matched.

#### Two examples
| Point | Location (lon, lat) | Straight-line nearest | Network nearest | Ratio |
| :--- | :--- | :--- | :--- | :--- |
| **9** (worst ratio) | 72.5702 E, 23.0291 N | Dr. Dilip Modi Hospital, 135 m | Dr. Dilip Modi Hospital, **797 m** | **5.88** |
| **17** (different service) | 72.5758 E, 23.0516 N | Harsh Neurosurgical Hospital, 480 m | Ami Eye Clinic, **2,215 m** | 4.61 |

* At point 9 the same hospital is nearest by both methods, but the walkable route is almost six times the straight-line distance.
* At point 17 the straight-line nearest hospital is so poorly connected that a different clinic, 2.2 km away by road, is closer on foot than any route to it.
* **What causes the detours is not established.** I did not extract the actual route. Possible causes are barriers with few crossings (for example the Sabarmati river corridor, or railway and large institutional compounds) or gaps in the OpenStreetMap footpath data. A map of the route would be needed to say which.
* Two rows (points 1 and 13) have a blank service name because OpenStreetMap has no name for service 343.

---

### Evidence Question 7: Coverage and the MAUP
Population is **estimated** as building footprint area inside a cell × 0.04 persons per m². The total is 82,347 persons across the study area. This counts all buildings (not only homes), so it is a proxy, not a census.

#### Population beyond 1200 m (15 min at 4.8 km/h)
* **By street network (H3 res 9)**: **2.10%** (1,731 of 82,347 persons)
* **By straight-line distance (1200 m buffer)**: **0.00%**

#### Modifiable Areal Unit Problem
| Spatial unit | Unserved population | Note |
| :--- | :--- | :--- |
| **Entire ward as one unit** | **0.0%** | The ward-wide mean network distance is 616 m, well under 1200 m, so everyone counts as served. |
| **H3 resolution 8** (28 cells) | **7.95%** | Large cells average distance over a big area. |
| **H3 resolution 9** (179 cells) | **2.10%** | Finer cells. |

The answer changes from 0% to 7.95% to 2.10% purely by changing the aggregation unit, which is the MAUP. I did not test further resolutions or shifted grids, so I cannot say which figure is closest to the truth.

#### Where the unserved people are
* 14 of the 179 cells are beyond 1200 m.
* **Four of them hold 1,534 of the 1,731 unserved people (89%)**: cells at 1,252, 1,326, 1,288 and 1,601 m, with populations of 805, 409, 212 and 109.
* **Worst-served populated cell (largest unserved population)**: H3 `8942ceb5d23ffff` (res 9), centre about 72.5449 E, 23.0314 N, network distance **1,252 m** (about 15.7 minutes), estimated population **805**.
* So the unserved population is mostly many people a little beyond the threshold, not a few people very far away.

#### A result that is an artefact
The cells with the longest network distances (2–5.5 km) lie in a strip around 72.572–72.576 E, 23.030–23.053 N. This strip is probably the Sabarmati riverfront (not verified). Their straight-line distance to a hospital is only 131–525 m. Four of the eight longest cells have an estimated population of 0 and the others are small. Each hexagon is represented by its centre point, and a centre on the river edge snaps to a road reached only by a long detour. These cells are **not** evidence of real 4 km walks and do not affect the 2.10% figure, since they hold almost no people.

---

### Evidence Question 8: Who Is the Model For? (Elderly Walkers at 3.6 km/h)
#### Method
The same network distances, with the threshold lowered to 900 m (15 minutes at 3.6 km/h).

#### Results
* **Adults (1200 m)**: **2.10%** unserved
* **Elderly (900 m)**: **6.48%** unserved (5,338 of 82,347 persons, 23 cells)
* **Difference**: **4.38 percentage points** of the population fall outside the threshold when the walking speed drops.
* **Where**: the 8 cells with the most unserved elderly people hold 81% of them. Most lie in the west-central part of the study area (about 72.539–72.551 E, 23.031–23.037 N), plus one cell near 72.574 E, 23.058 N.

#### Caveat on the threshold
The largest elderly-unserved cell has 860 estimated people and a network distance of **902 m**, which is 2 m past the cut-off. Any rounding or shift in where its centre snaps to the street network could move it from "unserved" to "served". A sensitivity test across thresholds around 900 m and 1200 m has not been done, so the percentages above should be read as approximate.

---

## Phase 4 — Map Client and Performance

### Evidence Question 9: Three Ways to Ship the Same Map
#### Setup
Test page `client/q9_test.html` loads **only** the buildings layer (20,607 features), with no basemap, at a fixed centre (72.5599 E, 23.0381 N). The method and zoom are chosen in the URL, e.g. `q9_test.html?mode=mvt&z=14`. Each run: Chrome DevTools Network tab, **Disable cache** on, filtered to the method's requests, hard reload.

* (a) WMS: `http://localhost:8081/geoserver/webgis/wms?...&request=GetMap&layers=webgis:buildings&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`
* (b) WFS: `http://localhost:8081/geoserver/webgis/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=webgis:buildings&outputFormat=application/json&srsName=EPSG:4326`
* (c) MVT: `http://localhost:7800/public.buildings/{z}/{x}/{y}.pbf`

#### Results (zoom 14)
| Method | Requests | Transferred | Finish |
| :--- | :--- | :--- | :--- |
| (a) WMS PNG tiles (GeoServer) | 16 | 535 kB | 5.83 s |
| (b) WFS GeoJSON (one request) | 1 | 2,297 kB (13,033 kB after decompression) | 9.91 s |
| (c) MVT (pg_tileserv) | 6 | 469 kB | 1.79 s |

**Measured at zoom 14 only.** Zooms 12 and 16 were not measured. WFS (b) is one full download of every feature, so its request and size do not depend on zoom; for WMS and MVT the request count depends on how many tiles cover the view at each zoom.

#### Explanation
* **WFS breaks first as the area grows.** It ships every feature regardless of the view. Gzip reduced the transfer to 2.3 MB, but the browser still had to parse 13 MB of JSON and hold all 20,607 polygons in memory, which is why it was slowest despite making one request. Both size and parse time grow linearly with the number of buildings.
* **WMS** scales with the screen, not the data: each request is a 256 px image rendered on the server. Its weakness is server CPU under many users, and the client cannot restyle or query features.
* **MVT** scaled best: each tile holds only the features in that tile, simplified for that zoom, and the client draws them on the GPU. pg_tileserv's 512 px tiles needed 6 requests where 256 px WMS tiles needed 16.

#### Earlier project
By reading its code (not measured): `backend/server.js` answers `/api/services/radius` by running one database query per request and returning only the rows inside the chosen radius as JSON; the page (`script.js`) fetches that, not the whole dataset. Payloads are therefore small for small radii. But there is no tiling and no caching, every slider change or search is a new database query, and the radius query has no `LIMIT`, so a large radius over a city-sized dataset would return thousands of rows as one JSON response. At city scale it would behave like (b): one large response, parsed and drawn in full.

---

## Phase 5 — Deploy It, for Free

### Evidence Question 10: Image Size (Multi-Stage vs Single-Stage Dockerfile)
#### Results (`docker images`)
| Image | Dockerfile | Disk usage | Content size |
| :--- | :--- | :--- | :--- |
| `webgis-client:single` | `client/Dockerfile.single` (one stage, full base image) | **1.6 GB** | 403 MB |
| `webgis-client:multi` | `client/Dockerfile` (multi-stage, `nginx:1.27-alpine` final stage) | **83.6 MB** | 22.3 MB |

The multi-stage image is about **19× smaller** on disk.

#### `docker history webgis-client:multi` (main layers)
```text
COPY /app /usr/share/nginx/html                 8.67MB   (mine: the built client)
COPY nginx.conf /etc/nginx/conf.d/default.conf  20.5kB   (mine)
RUN rm -rf /usr/share/nginx/html/*              20.5kB   (mine)
RUN /bin/sh -c set -x && apkArch=...            38.7MB   (nginx base image: installs nginx)
RUN /bin/sh -c set -x && addgroup -g 101 ...    5.36MB   (nginx base image)
ADD alpine-minirootfs-3.21.3-x86_64.tar.gz      8.5MB    (Alpine base)
```

#### Explanation
* **Largest layer**: the **38.7 MB** `RUN … apkArch …` step from the `nginx:1.27-alpine` base image, which installs nginx and its libraries. It is the server itself, so it cannot be removed without changing the base image.
* **Largest layer I added**: the **8.67 MB** `COPY /app`, almost all of it `data/buildings.geojson` (8.4 MB). The JavaScript, CSS and HTML are tiny by comparison.
* **Why multi-stage is smaller**: the single-stage image ships the full build base (OS, package manager, build tools) alongside the site. The multi-stage build uses the full image only in the build stage and copies just the finished static files into the slim nginx Alpine image, so none of the build tooling reaches the final image.

---

### Evidence Question 11: Self-Healing and State in Kubernetes
Cluster: kind, manifests in `k8s/` (PostGIS StatefulSet with PersistentVolumeClaim and password in a Secret; client Deployment; a Service for each).

A test table `q11_test` with 3 rows was created in PostGIS before each delete.

#### Pod deletion with the PVC (`kubectl delete pod postgis-0`)
Pod status recorded with a timed loop of `kubectl get pod` (one line per second with a timestamp), not the literal `kubectl get pods -w`:
```text
04:39:00  postgis-0   1/1   Running             0   109s
04:39:01  postgis-0   1/1   Terminating         0   110s
04:39:02  postgis-0   0/1   ContainerCreating   0   0s
04:39:03  postgis-0   1/1   Running             0   2s
```
* **Recovery: about 2 s** from `Terminating` to `1/1 Running`. The new pod keeps the name `postgis-0`.
* **Data survived**: `SELECT COUNT(*) FROM q11_test` returned **3 before and 3 after**. The row count was taken around the first delete; the timestamped delete above was a second run and was not followed by a SELECT.

#### Repeat with `emptyDir` instead of the PVC (Deployment)
| Before delete | After delete |
| :--- | :--- |
| `q11_test`: 3 rows | `ERROR: relation "q11_test" does not exist` |

* **Data was lost**: the new pod started with an empty data directory, so PostgreSQL initialised a fresh database.

#### Explanation
The StatefulSet controller notices the missing pod and recreates it with the same name (`postgis-0`), and the same name means it reattaches to the same PersistentVolumeClaim, so the database files are still there. `emptyDir` lives only as long as the pod, so deleting the pod deletes the data. A Deployment gives pods random names and treats them as interchangeable, so a replacement pod is not guaranteed to get the same volume back; a database needs a stable identity and stable storage, which is what a StatefulSet provides.

---

### Evidence Question 12: Static vs Server Deployment
#### Request (live site, zoom 14, cache disabled)
```text
GET https://rudraupadhyay1802-bot.github.io/proximity-service-platform/data/proximity_tiles.pmtiles
Request header : Range: bytes=0-16383
Status         : 206 Partial Content
Content-Range  : bytes 0-16383/63144
Content-Length : 16384
Accept-Ranges  : bytes
Server         : GitHub.com
```

#### Totals for the view
| Item | Value |
| :--- | :--- |
| PMTiles requests | 5 (16.7, 18.7, 18.6, 19.0, 18.6 kB) |
| PMTiles transferred | **91.6 kB** |
| Whole page | 1,881 kB, 50 requests (includes OSM basemap tiles and scripts) |

The PMTiles file (hex grid + services, 524 features, built with tippecanoe with `--no-feature-limit --no-tile-size-limit` so no features are dropped) is only 63,144 bytes. MapLibre's pmtiles protocol first reads the 16 KB header and root directory with a Range request, then fetches only the byte ranges of the tiles it needs. No tile server runs; GitHub Pages serves byte ranges of one static file.

#### Comparison with Q9
pg_tileserv at the same zoom made 6 requests / 469 kB for the buildings layer. The layers differ (the static site holds hexes and services, not buildings), so the kB values are not directly comparable. The mechanism is: pg_tileserv builds each tile from PostGIS on request, while PMTiles reads pre-built tiles from byte ranges of a file. Because this file is so small, Range requests saved nothing here: 91.6 kB was transferred for a 62 KB file, because of overlapping reads and per-response overhead. They pay off when the archive is large and only a small part is in view.

#### Two things the server stack can do that the static site cannot
1. **Serve live data**: an edit in PostGIS appears on the next tile request. The PMTiles file must be rebuilt with tippecanoe and redeployed.
2. **Answer queries**: WFS filters, OGC API – Features `?filter=` and per-request spatial SQL (e.g. `ST_DWithin` on a user's click).

#### One advantage of the static site
Zero cost and zero operations: no database or container to keep running, no connection limits, served from GitHub's CDN, and nothing to restart.

---

## Limitations
1. **Study area**: the polygon was drawn by hand and is not an official ward boundary.
2. **Download margin**: about 1.2 km around the study-area bounding box, not the 2 km the brief specifies. Services or streets 1.2–2 km outside the edge are missing, which may slightly overstate distances for edge cells.
3. **Population is a proxy**: building footprint area × 0.04, counting every building type. It is not residential population.
4. **Hex-centre method**: each hexagon is judged by one point. Cells whose centre lies on a river edge, or on a disconnected road fragment, give misleading distances. One of the 179 resolution-9 cells (`8942ceb4857ffff`, about 121 people) could not reach any service by road and was given an estimated distance of 1.35 × its straight-line distance.
5. **Threshold cliff**: results depend on a hard cut-off at 900 m and 1200 m, and no sensitivity test has been run.
6. **Network data**: the street graph comes from OpenStreetMap and may be missing footpaths. The route behind each detour was not inspected.
7. **Q6 sample**: 30 random points is a small sample. The 30% and the median 1.706 are indicative, not precise.
8. **Single runs**: the Q2 timings and Q9 measurements are single runs on one laptop.
9. **Q9 zoom levels**: only zoom 14 was measured; zooms 12 and 16 were not.
10. **Q3 verification**: three of the five checked facilities had no Street View coverage and were confirmed by map listing only.
