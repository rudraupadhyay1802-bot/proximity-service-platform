# Study Note S4: Containerization and Kubernetes Orchestration

## 1. Container Concepts: Image vs Container
* **Image**: An immutable, read-only static blueprint comprising stacked filesystem layers (built via UnionFS) that package application binaries, runtime libraries, and environment specifications.
* **Container**: A running, isolated operating system process instantiated from an image. It adds a thin, ephemeral read-write layer on top of the underlying image layers.

```
       +------------------------------------+
       |   Read/Write Container Layer (R/W) |  <-- Wiped when container dies!
       +------------------------------------+
       |   Layer 3: App Code & Config       |
       +------------------------------------+
       |   Layer 2: Installed Geospatial Libs|
       +------------------------------------+
       |   Layer 1: Base Alpine / Ubuntu OS |
       +------------------------------------+
```

---

## 2. Dockerfile Optimization and Multi-Stage Builds
In single-stage Docker builds, heavy compilers, development headers (`gcc`, `g++`, `libpq-dev`), and package caches remain trapped in the output image, producing massive $800\text{ MB}$ to $1.5\text{ GB}$ containers.

A **multi-stage build** decouples the build environment from the production runtime:
1. **Stage 1 (Builder)**: Compiles assets, builds node/python dependencies, and minifies javascript.
2. **Stage 2 (Runtime)**: Copies only the compiled static artifacts into a minimal production base image (e.g., `nginx:alpine`, ~25 MB).

```
   [ Stage 1: Build & Bundle ]              [ Stage 2: Production Nginx ]
   Node 20 / Python SDK                      nginx:alpine (~25 MB)
   + compilers + dev dependencies            + copy --from=builder /dist /usr/share/nginx/html
   (Size: ~900 MB)                           (Final Image: ~35 MB)
```

---

## 3. Kubernetes Primitives for Stateful and Stateless Workloads

| Primitive | Role in Architecture | Application to WebGIS |
| :--- | :--- | :--- |
| **Pod** | Smallest schedulable compute unit in k8s; encapsulates 1+ containers. | Unit hosting PostGIS or the Nginx client. |
| **Deployment** | Manages stateless replica sets; supports zero-downtime rolling updates. | Ideal for the MapLibre web frontend and tile servers. |
| **StatefulSet** | Manages stateful pods with ordered deployment, unique stable network IDs, and sticky storage. | **Required for PostGIS / PostgreSQL**. |
| **PersistentVolumeClaim (PVC)**| Declarative request for persistent disk storage that outlives pod lifecycles. | Bound to PostGIS so data survives pod deletion. |
| **Secret** | Securely stores sensitive credentials encoded in Base64. | Stores `POSTGRES_PASSWORD` and DB credentials. |
| **Service** | Internal stable IP and DNS entry load-balancing traffic across matching pods. | Exposes `postgis:5432` and `client:80` inside cluster. |

```
   +--------------------------------------------------------------------------+
   |                       Kubernetes Cluster (kind)                          |
   |                                                                          |
   |  Stateless Deployment:                     StatefulSet:                  |
   |  +------------------------+                +--------------------------+  |
   |  | Pod: Map Client        |                | Pod: postgis-0           |  |
   |  | (nginx:alpine)         |                | (postgis/postgis:16)     |  |
   |  +------------------------+                +--------------------------+  |
   |             ^                                           |                |
   |             |                                           v                |
   |  +------------------------+                +--------------------------+  |
   |  | Service: client-svc    |                | PVC: postgis-data        |  |
   |  | (Port: 80)             |                | (Preserved across pods!) |  |
   |  +------------------------+                +--------------------------+  |
   |             ^                                                            |
   +-------------|------------------------------------------------------------+
                 |
      kubectl port-forward
```

---

## 4. Self-Healing and State Preservation in Databases
* **Self-Healing**: If a PostGIS container crashes or is deleted via `kubectl delete pod postgis-0`, the Kubernetes StatefulSet controller detects a discrepancy between the desired state (1 replica) and current state (0 replicas) and immediately schedules a new replacement pod.
* **Why Databases Require StatefulSet + PVC**: In a standard Deployment with an `emptyDir` volume, storage is tied directly to the pod instance; deleting the pod wipes all database tables, geometries, and WAL logs. A StatefulSet paired with a `PersistentVolumeClaim` ensures that the newly spawned pod mounts the exact same underlying persistent volume, keeping database transactions and spatial tables intact.
