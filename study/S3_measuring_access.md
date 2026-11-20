# Study Note S3: Measuring Accessibility and Spatial Modeling

## 1. Straight-Line Euclidean Distance vs Street Network Distance
In naive GIS applications, proximity is calculated "as the crow flies" ($d = \sqrt{\Delta x^2 + \Delta y^2}$ or Haversine/great-circle formulas).
* **The Fallacy of Straight-Line Buffers**: Assumes an isotropic, obstacle-free landscape where humans float directly to destinations.
* **Network Distance Reality**: Pedestrians walk on a physical graph composed of nodes (intersections) and edges (walkable streets, footpaths, pedestrian crossings). Physical barriers (rivers like the Sabarmati, railway tracks, enclosed highway corridors, gated communities) turn a 300-meter Euclidean proximity into a 2.5-kilometer detour.

```
   Straight-line Euclidean Buffer            Network Walking Catchment
          . - ~ ~ - .                                 \     /
      .               .                                \___/
    .         *         .                          -----*-----
      .    (Service)  .                                /   \
          . - ~ ~ - .                                 /     \
    [Uniform Circle / Float]                  [Constrained to Street Graph]
```

---

## 2. Walking Isochrones
An **isochrone** is an isoline or boundary polygon connecting all geographical locations reachable from an origin within a specified time limit $T$:
$$T = \frac{d_{\text{network}}}{v_{\text{walk}}}$$
* Walking speed benchmarks:
  * Standard adult pedestrian: $4.8\text{ km/h} \approx 1.33\text{ m/s}$ ($15\text{ minutes} \rightarrow 1.2\text{ km}$ network distance).
  * Vulnerable / elderly / child pedestrian: $3.6\text{ km/h} \approx 1.0\text{ m/s}$ ($15\text{ minutes} \rightarrow 0.9\text{ km}$ network distance).
* Generating isochrones on street graphs involves shortest-path tree expansion (Dijkstra's algorithm via OSMnx / NetworkX or `pgr_drivingDistance`), followed by boundary hull reconstruction (convex hull, concave alpha-shapes, or edge-buffering).

---

## 3. The Modifiable Areal Unit Problem (MAUP)
The Modifiable Areal Unit Problem is an unavoidable source of statistical bias that arises when spatial point phenomena are aggregated into continuous geographic zones. It exhibits two distinct dimensions:

```
            MAUP: Scale Effect                      MAUP: Zone Effect
     +-------------+-------------+             +-------------+-------------+
     |             |             |             |             |             |
     |   Zone A    |   Zone B    |             |   Zone 1   /   Zone 2     |
     |             |             |             |           /               |
     +-------------+-------------+             +----------/----------------+
     |             |             |             |         /                 |
     |   Zone C    |   Zone D    |             |  Zone 3/     Zone 4       |
     |             |             |             |       /                   |
     +-------------+-------------+             +------/--------------------+
     (Aggregating to coarse vs fine)            (Rotating/shifting boundaries)
```

1. **Scale Effect**: Spatial summary statistics (e.g., percentage of unserved population) change systematically depending on the granularity of aggregation (e.g., comparing 100-meter street blocks, H3 resolution 9 cells, H3 resolution 8 cells, and municipal wards). Finer scales uncover hidden accessibility deserts that are averaged out at the city-ward level.
2. **Zone (Aggregation) Effect**: Even holding the scale constant, redistricting or altering the boundary shape of analytical units alters the computed correlations and unserved percentages. Using standardized, regular partitions like H3 hexagons mitigates arbitrary political boundary artifacts.
