# Study Note S1: OGC Services and Coordinate Reference Systems (CRS)

## 1. OGC Web Services Landscape
Open Geospatial Consortium (OGC) standards define interoperable client-server protocols for sharing geographic information across the web:

* **WMS (Web Map Service)**: Delivers rendered georeferenced raster map images (PNG/JPEG) from vector or raster layers.
* **WFS (Web Feature Service)**: Delivers actual vector geographic features with geometry and attribute tables (GML, GeoJSON).
* **WCS (Web Coverage Service)**: Delivers multi-band, multi-dimensional raster coverage data with raw numerical cell values (e.g., elevation DEMs, satellite surface reflectance), rather than just visual pixels.
* **OGC API – Features**: The modern RESTful, OpenAPI-compliant successor to WFS. It uses JSON/GeoJSON payloads, resource-oriented URI patterns (`/collections/{collectionId}/items/{featureId}`), and standard HTTP methods.

```
       +--------------------------------------------------------+
       |                  Client (Web / GIS)                    |
       +--------------------------------------------------------+
             |                 |                 |          |
         GetMap (PNG)    GetFeature (GeoJSON) GetCoverage  GET /items
             |                 |                 |          |
             v                 v                 v          v
          +-----+           +-----+           +-----+   +-------------+
          | WMS |           | WFS |           | WCS |   | OGC API - F |
          +-----+           +-----+           +-----+   +-------------+
             |                 |                 |          |
             +-----------------+-----------------+----------+
                               |
                       PostGIS / GeoTIFF
```

---

## 2. The EPSG:4326 Axis-Order Trap (WMS 1.1.1 vs WMS 1.3.0)

A classic pitfall in WebGIS stems from differing interpretations of EPSG:4326 (WGS 84):
* **WMS 1.1.1 (`SRS=EPSG:4326`)**: Dictates coordinate ordering as **(Easting, Northing)** or **(Longitude, Latitude) = (X, Y)**. A request specifies `BBOX=minLon,minLat,maxLon,maxLat`.
* **WMS 1.3.0 (`CRS=EPSG:4326`)**: Adheres strictly to the official EPSG geodetic authority registry, which defines EPSG:4326 with axis 1 as **Latitude (Northing)** and axis 2 as **Longitude (Easting)**. Therefore, WMS 1.3.0 requires:
  $$\text{BBOX} = \text{minLat,minLon,maxLat,maxLon}$$
* **Consequence**: Sending a WMS 1.1.1 ordered BBOX into a WMS 1.3.0 endpoint results in transposed coordinates, triggering either an empty map, a pink error tile, or requesting an area completely flipped into Antarctica or the Indian Ocean.

---

## 3. WFS 2.0 with Filtering
WFS 2.0 allows server-side filtering so that clients only retrieve features of interest, minimizing network transfer:
* **Filter Encoding (FE 2.0 / OGC Filter)**: XML-based predicate tree (`<fes:Filter>`, `<fes:PropertyIsEqualTo>`, `<fes:BBOX>`).
* **CQL / ECQL (Common Query Language)**: Human-readable predicates supported by GeoServer (e.g., `CQL_FILTER=name IS NOT NULL AND status='active'`).
* **Pagination & Counts**: Returns `numberMatched` (total matches on server) and `numberReturned` (features in current page), supporting `startIndex` and `count`.

---

## 4. CRS Comparison: EPSG:4326 vs EPSG:3857 vs UTM Zone 43N

| Parameter | EPSG:4326 (WGS 84) | EPSG:3857 (Web Mercator) | EPSG:32643 (UTM Zone 43N) |
| :--- | :--- | :--- | :--- |
| **Type** | Geographic 2D (Ellipsoidal) | Projected (Spherical Mercator) | Projected (Transverse Mercator) |
| **Coordinate Units** | Decimal Degrees ($^\circ$) | Projected Meters ($m$) | Projected Meters ($m$) |
| **Primary Use** | Global GPS, GeoJSON storage | Web slippy tiles (Google/OSM) | Local engineering, metric analytics |
| **Shape / Angle** | Distorted (non-conformal) | Conformal (preserves angles) | Conformal within 6° zone |
| **Area Distortion** | Degree math invalid for area | Inflates by $1/\cos^2(\phi)$ | Negligible ($\le 0.1\%$ within zone) |

```
                       SPATIAL REFERENCE DISTORTION
     EPSG:4326                      EPSG:3857                  EPSG:32643 (UTM 43N)
 (Angular Degrees)              (Spherical Mercator)         (Local Transverse Mercator)
   y ^ (lat)                      y ^                           y ^
     |   [Square degree             |   [Huge area                |   [True conformal
     |    distorts with             |    inflation at             |    metric geometry;
     |    latitude]                 |    high latitudes]          |    area valid!]
     +--------> x (lon)             +--------> x                  +--------> x
```

### Why Area Calculations Depend on the CRS
Calculating area on a planar Cartesian formula ($\iint dx\,dy$) requires linear metric units.
1. In **EPSG:4326**, 1 degree of longitude at the equator is $\approx 111.32\text{ km}$, but at latitude $\phi = 23^\circ$ (Ahmedabad), it contracts to $\approx 111.32 \times \cos(23^\circ) \approx 102.47\text{ km}$. `ST_Area` on geometry(4326) returns square degrees, which cannot be converted to square meters by a constant multiplier.
2. In **EPSG:3857**, the projection forces meridians into parallel vertical lines on a sphere. The linear scale factor is $k = \sec(\phi) = 1/\cos(\phi)$, causing areal inflation of $k^2 = 1/\cos^2(\phi)$. At latitude $23.03^\circ$, $k^2 \approx 1.179$, inflating measured planar area by **~18%**!
3. In **UTM Zone 43N (EPSG:32643)**, the projection wraps a cylinder along the central meridian ($75^\circ\text{ E}$), with a scale factor between $0.9996$ and $1.001$, yielding true metric distances and accurate land areas.
