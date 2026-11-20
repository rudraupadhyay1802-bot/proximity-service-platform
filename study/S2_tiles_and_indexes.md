# Study Note S2: Tiles and Spatial Indexes

## 1. XYZ Tile Scheme and Zoom Levels
Web map tiles slice planetary geometry into hierarchical square grids:
* At zoom level $z=0$, the entire globe (from $-85.0511^\circ$ to $+85.0511^\circ$ latitude) is mapped into a single $256 \times 256$ pixel tile.
* At zoom level $z$, the earth is divided into $2^z \times 2^z = 4^z$ tiles.
* Coordinates follow $(z, x, y)$ where $x$ increments from West ($0$) to East ($2^z-1$) and $y$ increments from North ($0$) to South ($2^z-1$) in standard OSM/Google tile convention (TMS flips the $y$-axis).

```
  Zoom 0: 1 tile (0,0)         Zoom 1: 4 tiles              Zoom 2: 16 tiles
    +-------+                    +---+---+                    +-+-+-+-+
    |       |                    |0,0|1,0|                    | | | | |
    |  World|                    +---+---+                    +-+-+-+-+
    |       |                    |0,1|1,1|                    | | | | |
    +-------+                    +---+---+                    +-+-+-+-+
```

---

## 2. Raster Tiles vs Vector Tiles (MVT vs PMTiles)

| Property | Raster Tiles (PNG/JPEG) | Vector Tiles (MVT / Mapbox Vector Tile) | PMTiles (Serverless Archive) |
| :--- | :--- | :--- | :--- |
| **Content** | Pre-rendered pixels | Raw geometry & attributes in Google Protobuf | Single-file cloud-optimized archive of MVTs |
| **Payload Size** | Moderate to large (20–60 KB/tile) | Small, highly compressible (5–20 KB/tile) | Zero server overhead; chunked byte-ranges |
| **Styling** | Baked in on server (SLD) | Fully client-side dynamic (MapLibre JSON) | Fully client-side dynamic (MapLibre JSON) |
| **Interactivity** | Requires GetFeatureInfo query | Direct client hit-testing, hovers, popups | Direct client hit-testing, hovers, popups |
| **Hosting** | Requires active tile engine (GeoServer) | Requires active server (pg_tileserv) | Static object storage (GitHub Pages, S3) |

```
                       VECTOR TILE DEPLOYMENT MODELS
   Live DB Pipeline:
   PostGIS ──> pg_tileserv ──[ HTTP /z/x/y.pbf ]──> MapLibre GL JS

   Serverless PMTiles Pipeline:
   PostGIS ──> GeoJSON ──> Tippecanoe ──> file.pmtiles ──[ HTTP Range Requests ]──> MapLibre
```

---

## 3. PostGIS GiST Indexes and Two-Phase Query Evaluation
A Generalized Search Tree (GiST) index on geometry columns implements an R-tree over bounding boxes:
1. **Bounding Box Pre-filter (Index Scan)**: PostGIS checks if the 2D bounding box (Minimum Bounding Box / MBR) of feature $A$ overlaps or comes within range of feature $B$'s MBR using the `&&` operator. This rapidly discards $>99\%$ of non-matching candidates in $O(\log N)$ time.
2. **Exact Recheck (Filter Step)**: For surviving candidates, PostGIS runs the computationally expensive computational geometry algorithm (e.g. crossing numbers, Sutherland-Hodgman clipping, point-in-polygon) on the exact vertices.

```
       +-------------------------------------------------------+
       |   Query: ST_DWithin(geom_a, geom_b, 500)              |
       +-------------------------------------------------------+
                                  |
                                  v
       +-------------------------------------------------------+
       | Phase 1: GiST Index Scan (Fast BBOX overlap check)    |
       | Discards 99% of non-intersecting bounding boxes       |
       +-------------------------------------------------------+
                                  |
                                  v
       +-------------------------------------------------------+
       | Phase 2: Exact Geometric Evaluation (Precise math)    |
       | Evaluates true boundary-to-point distances on candidates|
       +-------------------------------------------------------+
```

---

## 4. H3 Discrete Global Grid System (Hexagonal Indexing)
Uber's H3 indexes the earth into a hierarchical discrete global grid system composed of hexagons (with 12 pentagons per resolution to close the icosahedron):
* **Equal Adjacency**: Unlike square grids where orthogonal neighbors have distance $d$ and diagonal neighbors have distance $\sqrt{2}d$, every hexagon has **6 identical equidistant neighbors**.
* **Isotropic Diffusion**: Movement and access models spread symmetrically in all directions.
* **Hierarchical Resolution**:
  * **Resolution 8**: Average hexagon area $\approx 0.737\text{ km}^2$, edge length $\approx 461\text{ m}$. Ideal for ward-level and neighborhood accessibility aggregation.
  * **Resolution 9**: Average hexagon area $\approx 0.105\text{ km}^2$, edge length $\approx 174\text{ m}$. Ideal for fine-grained street block and walking catchment analysis.
