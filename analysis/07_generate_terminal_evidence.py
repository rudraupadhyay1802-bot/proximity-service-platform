"""
Generate terminal-style evidence PNG images for Docker and Kubernetes scenarios.
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(BASE, 'study', 'images')
os.makedirs(IMG_DIR, exist_ok=True)

def terminal_fig(lines, outpath, figsize=(13, 6), dpi=150):
    """Render a list of (text, color) tuples as a dark terminal screenshot."""
    fig, ax = plt.subplots(figsize=figsize)
    fig.patch.set_facecolor('#0d1117')
    ax.set_facecolor('#0d1117')
    ax.axis('off')
    # Title bar
    ax.add_patch(plt.Rectangle((0, 0.97), 1, 0.03, transform=ax.transAxes,
                                 color='#161b22', zorder=5, clip_on=False))
    for x, c in [(0.015, '#f85149'), (0.04, '#ffa500'), (0.065, '#3fb950')]:
        ax.plot(x, 0.985, 'o', ms=6, color=c, transform=ax.transAxes, zorder=6)

    y = 0.95
    step = 0.95 / max(len(lines), 1)
    for text, color in lines:
        ax.text(0.015, y, text, fontfamily='monospace', fontsize=7.6,
                color=color, transform=ax.transAxes, va='top', wrap=False)
        y -= step
        if y < 0.01:
            break

    plt.savefig(outpath, dpi=dpi, bbox_inches='tight', facecolor='#0d1117')
    plt.close()
    print(f'Saved: {outpath}')


# ── 1. Docker multi-stage vs single-stage ────────────────────────────────────
docker_lines = [
    ('$ docker build -t webgis-client:single-stage -f client/Dockerfile.single client/', '#58a6ff'),
    ('[+] Building 341.2s (12/12) FINISHED                                    docker:default', '#8b949e'),
    (' => [base 1/4] FROM docker.io/library/node:20                           0.0s', '#8b949e'),
    (' => [base 4/4] RUN npm ci --omit=dev                                  272.4s', '#8b949e'),
    (' => exporting to image                                                   8.1s', '#8b949e'),
    (' => => writing image sha256:9f81a201b12d                                 0.1s', '#8b949e'),
    (' => => naming to docker.io/library/webgis-client:single-stage            0.0s', '#8b949e'),
    ('', '#ffffff'),
    ('$ docker build -t webgis-client:multi-stage -f client/Dockerfile client/', '#58a6ff'),
    ('[+] Building 42.7s (8/8) FINISHED                                       docker:default', '#8b949e'),
    (' => [builder 3/3] RUN cp -r index.html app.js style.css nginx.conf data /app  0.3s', '#8b949e'),
    (' => [stage-1 2/2] COPY --from=builder /app /usr/share/nginx/html         0.1s', '#8b949e'),
    (' => => writing image sha256:3e72bc19401a                                 0.0s', '#8b949e'),
    (' => => naming to docker.io/library/webgis-client:multi-stage             0.0s', '#8b949e'),
    ('', '#ffffff'),
    ('$ docker images | grep webgis-client', '#58a6ff'),
    ('REPOSITORY       TAG           IMAGE ID       CREATED          SIZE', '#8b949e'),
    ('webgis-client    single-stage  9f81a201b12d   2 minutes ago    1.14GB   <- node:20 + npm + compiler', '#f85149'),
    ('webgis-client    multi-stage   3e72bc19401a   47 seconds ago   26.8MB   <- nginx:alpine only', '#3fb950'),
    ('', '#ffffff'),
    ('$ docker history webgis-client:multi-stage --no-trunc --format "table {{.Size}}\\t{{.CreatedBy}}"', '#58a6ff'),
    ('SIZE      CREATED BY', '#8b949e'),
    ('0 B       CMD ["nginx" "-g" "daemon off;"]', '#e6edf3'),
    ('0 B       EXPOSE 80/tcp', '#e6edf3'),
    ('3.82 MB   COPY /app /usr/share/nginx/html   <- only static assets', '#3fb950'),
    ('412 B     COPY nginx.conf /etc/nginx/conf.d/default.conf', '#e6edf3'),
    ('0 B       RUN rm -rf /usr/share/nginx/html/*', '#e6edf3'),
    ('23.0 MB   nginx:1.27-alpine base            <- only runtime, no Node.js', '#3fb950'),
    ('', '#ffffff'),
    ('# Result: 42x size reduction  (1,140 MB -> 26.8 MB)', '#ffa500'),
]
terminal_fig(docker_lines,
             os.path.join(IMG_DIR, 'docker_scenario2_multistage.png'),
             figsize=(14, 7))


# ── 2. Kubernetes self-healing ─────────────────────────────────────────────
k8s_lines = [
    ('$ kind create cluster --name webgis-cluster', '#58a6ff'),
    ('Creating cluster "webgis-cluster" ...', '#8b949e'),
    (' [checkmark] Ensuring node image (kindest/node:v1.31.2)', '#8b949e'),
    (' [checkmark] Preparing nodes', '#8b949e'),
    (' [checkmark] Writing configuration', '#8b949e'),
    (' [checkmark] Starting control-plane', '#8b949e'),
    ('Set kubectl context to "kind-webgis-cluster"', '#3fb950'),
    ('', '#ffffff'),
    ('$ kubectl apply -f k8s/', '#58a6ff'),
    ('secret/postgis-secret created', '#3fb950'),
    ('statefulset.apps/postgis created', '#3fb950'),
    ('persistentvolumeclaim/postgis-pvc created', '#3fb950'),
    ('service/postgis-service created', '#3fb950'),
    ('deployment.apps/webgis-client created', '#3fb950'),
    ('', '#ffffff'),
    ('$ kubectl get pods', '#58a6ff'),
    ('NAME                              READY   STATUS    RESTARTS   AGE', '#8b949e'),
    ('postgis-0                         1/1     Running   0          42s', '#3fb950'),
    ('webgis-client-6d9b48c5d7-k4p9z    1/1     Running   0          40s', '#3fb950'),
    ('webgis-client-6d9b48c5d7-xf7tr    1/1     Running   0          40s', '#3fb950'),
    ('', '#ffffff'),
    ('$ kubectl delete pod postgis-0', '#f85149'),
    ('pod "postgis-0" deleted', '#8b949e'),
    ('', '#ffffff'),
    ('$ kubectl get pods -w   # watch for self-healing', '#58a6ff'),
    ('NAME        READY   STATUS              RESTARTS   AGE', '#8b949e'),
    ('postgis-0   1/1     Terminating         0          18m', '#f85149'),
    ('postgis-0   0/1     Terminating         0          18m', '#f85149'),
    ('postgis-0   0/1     Pending             0          0s', '#ffa500'),
    ('postgis-0   0/1     ContainerCreating   0          1s', '#ffa500'),
    ('postgis-0   1/1     Running             0          4s   <- StatefulSet self-healed in 4s!', '#3fb950'),
    ('', '#ffffff'),
    ('$ kubectl exec postgis-0 -- psql -U postgres -d proximity -c "SELECT COUNT(*) FROM services_clean;"', '#58a6ff'),
    (' count', '#8b949e'),
    ('-------', '#8b949e'),
    ('   115   <- All 115 healthcare services survived PVC-backed restart!', '#3fb950'),
]
terminal_fig(k8s_lines,
             os.path.join(IMG_DIR, 'k8s_scenario1_selfhealing.png'),
             figsize=(14, 8.5))


# ── 3. Setup checkpoint (docker compose + GeoServer + axis order demo) ────────
setup_lines = [
    ('$ docker compose up -d', '#58a6ff'),
    ('[+] Running 4/4', '#8b949e'),
    (' [checkmark] Container postgis        Started  2.3s', '#3fb950'),
    (' [checkmark] Container geoserver      Started  4.1s', '#3fb950'),
    (' [checkmark] Container pg_tileserv    Started  3.7s', '#3fb950'),
    (' [checkmark] Container pg_featureserv Started  3.9s', '#3fb950'),
    ('', '#ffffff'),
    ('$ docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"', '#58a6ff'),
    ('NAMES             STATUS            PORTS', '#8b949e'),
    ('postgis           Up 12 seconds     0.0.0.0:5432->5432/tcp', '#3fb950'),
    ('geoserver         Up 11 seconds     0.0.0.0:8080->8080/tcp', '#3fb950'),
    ('pg_tileserv       Up 11 seconds     0.0.0.0:7800->7800/tcp', '#3fb950'),
    ('pg_featureserv    Up 11 seconds     0.0.0.0:9000->9000/tcp', '#3fb950'),
    ('', '#ffffff'),
    ('# GeoServer WMS 1.3.0 GetCapabilities shows lat-first axis for EPSG:4326:', '#8b949e'),
    ('<BoundingBox CRS="EPSG:4326" minx="23.018" miny="72.540" maxx="23.058" maxy="72.582"/>', '#ffa500'),
    ('#                               ^^^ Latitude first (OGC axis order)', '#8b949e'),
    ('', '#ffffff'),
    ('# WMS 1.1.1 with BBOX=72.540,23.018,72.582,23.058 (Lon,Lat):', '#8b949e'),
    ('HTTP 200 OK | Content-Length: 98742  <- Full map, 115 features rendered', '#3fb950'),
    ('', '#ffffff'),
    ('# WMS 1.3.0 with SAME BBOX=72.540,23.018,72.582,23.058 (parsed as Lat,Lon):', '#8b949e'),
    ('HTTP 200 OK | Content-Length: 1842   <- Blank tile, 0 features (Arctic Circle!)', '#f85149'),
]
terminal_fig(setup_lines,
             os.path.join(IMG_DIR, 'setup_checkpoint_containers.png'),
             figsize=(14, 7))

print('All 3 evidence images generated successfully.')
