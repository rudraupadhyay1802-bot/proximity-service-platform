# WebGIS Assignment: From Nearby Services to a Deployed Map Service
## Technical Evidence & Analytical Report (`ANSWERS.md`)

**How to read this report.** Every number below was produced by running the scripts in `sql/` and `analysis/` against the project database (PostGIS) on the author's machine. Questions that require a running GeoServer, Docker, Kubernetes or browser DevTools session were **not run** and are marked **NOT RUN**, with the reason. No screenshots or outputs are included for them. See the *Limitations* section at the end.

---

### Project Registration Details
* **Study Area**: A hand-drawn polygon approximating Navrangpura Ward, West Zone, Ahmedabad, Gujarat, India (17.72 km²). It is **not** an official administrative boundary.
* **Service Type**: Healthcare (`amenity=hospital`, `amenity=clinic`, `amenity=pharmacy`, `healthcare=*`)
* **OSM Feature Count**: **345 healthcare features** after cleaning (baseline requirement: at least 15)
* **Buildings**: 20,607 footprints. **Walking network**: 7,607 OSM ways, which become a graph of 35,008 nodes and 38,916 edges.
* **UTM Zone & EPSG Code**: **UTM Zone 43N (EPSG:32643)** (study-area longitude about 72.56° E)
* **Walking Speed & Threshold**: Standard adult → **15 minutes = 1200 m at 4.8 km/h**; elderly / mobility-limited → **15 minutes = 900 m at 3.6 km/h**
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
Counts services with no name, pairs of services within 25 m, the earlier prototype's count in the same box, and a sample of five facilities.

#### Results
```text
total_services      : 345
unnamed_count       : 5   (1.45%)
pairs_within_25m    : 76
earlier prototype   : 108 healthcare facilities in the box 72.54–72.58 E, 23.02–23.05 N
this project        : 113 healthcare facilities in the SAME box (services_clean)
```

#### Explanation
* **Same-box comparison**: the earlier prototype counted 108 facilities in the box 72.54–72.58 E, 23.02–23.05 N. This project's cleaned table has **113** in the same box. The 345 figure covers the whole, larger study area and is not comparable with 108.
* **Likely reason for the 5 extra**: the earlier importer (`backend/import-osm.js`, line 85) contains `if (!name) continue;`, which drops every feature without a name tag. This project keeps unnamed features (5 in the whole study area). This explains the direction of the difference, but I did not count how many of the 5 unnamed features fall inside the comparison box, so it is **not proven** that they account for all 5 extra.
* **Clustering (76 pairs within 25 m)**: pairs this close usually mean a pharmacy beside a clinic, or several departments of one hospital mapped as separate points. Whether any of the 76 are true duplicates was not checked.
* **Ground-truth check of five facilities**: not yet done.

---

## Phase 2 — Publish Your Own OGC Services

### Evidence Question 4: The Axis-Order Trap (WMS 1.1.1 vs 1.3.0)
**NOT RUN.** This needs a running GeoServer instance. Docker was not available on the author's machine, and no GeoServer was started, so there are no requests, responses or images to show.

What the OGC specifications say (reference only, **not tested in this project**): WMS 1.1.1 reads the bounding box of `EPSG:4326` as longitude, latitude. WMS 1.3.0 follows the EPSG registry, in which EPSG:4326 is latitude, longitude. The same `BBOX=72.540,23.018,72.582,23.058` would therefore be read as a latitude of 72.54° N and a longitude of 23.018° E by a 1.3.0 server, which is nowhere near Ahmedabad, and the map would be expected to come back empty. In 1.3.0 the box has to be written `BBOX=23.018,72.540,23.058,72.582`.

---

### Evidence Question 5: WFS with a Filter (GeoJSON vs GML 3.2)
**NOT RUN.** This also needs GeoServer, so no `numberMatched`, payload sizes or coordinates were measured.

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
* **Largest unserved cell**: H3 `8942ceb5d23ffff` (res 9), centre about 72.5449 E, 23.0314 N, network distance **1,252 m** (about 15.7 minutes), estimated population **805**.
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
**NOT RUN.** The tiled-WMS and WFS options need GeoServer, and no browser DevTools measurements were taken, so I give no request counts, sizes or timings.

**Earlier project, by reading its code (not measured).** `backend/server.js` answers `/api/services/radius` by running one database query per request and returning only the rows inside the chosen radius as JSON; the page (`script.js`) fetches that, not the whole dataset. Payloads are therefore small for small radii. But there is no tiling and no caching, every slider change or search is a new database query, and the radius query has no `LIMIT`, so a large radius over a city-sized dataset would return thousands of rows as one JSON response.

Reasoning only (not measured): a single WFS GeoJSON response sends every feature's geometry regardless of zoom level, so its size grows with the number of buildings, which makes it the first to become unworkable as the area grows. Tiled WMS images and vector tiles both send only what the current view needs.

---

## Phase 5 — Deploy It, for Free

### Evidence Question 10: Image Size (Multi-Stage vs Single-Stage Dockerfile)
**NOT RUN.** Docker is not installed on the author's machine, so neither image was built. `client/Dockerfile` and `client/Dockerfile.single` exist in the repository but have not been built, and no sizes are claimed.

### Evidence Question 11: Self-Healing and State in Kubernetes
**NOT RUN.** No Kubernetes cluster was created. The manifests in `k8s/` have not been applied by the author, and no pod-recovery times or data-survival results are claimed.

---

### Evidence Question 12: Static vs Server Deployment
**Measurements NOT RUN.** I did not inspect the PMTiles requests on the live site, so no `Range` headers, status codes or transfer sizes are reported.

Reasoning only:
* **What the server stack can do that the static site cannot**: run live spatial SQL (for example `ST_DWithin` or nearest-neighbour searches on user input), and accept and store new data with access control.
* **What the static site does better**: it has no server or database to keep running, no connection limits, and costs nothing on GitHub Pages.

---

## Limitations
1. **Study area**: the polygon was drawn by hand and is not an official ward boundary.
2. **Population is a proxy**: building footprint area × 0.04, counting every building type. It is not residential population.
3. **Hex-centre method**: each hexagon is judged by one point. Cells whose centre lies on a river edge, or on a disconnected road fragment, give misleading distances. One of the 179 resolution-9 cells (`8942ceb4857ffff`, about 121 people) could not reach any service by road and was given an estimated distance of 1.35 × its straight-line distance.
4. **Threshold cliff**: results depend on a hard cut-off at 900 m and 1200 m, and no sensitivity test has been run.
6. **Network data**: the street graph comes from OpenStreetMap and may be missing footpaths. The route behind each detour was not inspected.
7. **Q6 sample**: 30 random points is a small sample. The 30% and the median 1.706 are indicative, not precise.
8. **Single runs**: the Q2 timings are single runs on one laptop.
