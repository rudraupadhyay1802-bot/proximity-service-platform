/**
 * app.js
 * MapLibre GL JS client consuming Vector Tiles (PMTiles / GeoJSON),
 * DEM WMS, interactive popups, data-driven styling, and WFS performance testing.
 */

// Initialize PMTiles protocol
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// Ahmedabad Navrangpura center
const AHMEDABAD_CENTER = [72.564, 23.036];

// Initialize Map
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'osm-basemap': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm-tiles',
        type: 'raster',
        source: 'osm-basemap',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  },
  center: AHMEDABAD_CENTER,
  zoom: 13.8
});

map.addControl(new maplibregl.NavigationControl(), 'top-left');

let currentMode = 'adult'; // 'adult' | 'elderly'

map.on('load', async () => {
  console.log('MapLibre GL initialized. Loading spatial layers...');

  // 1. Study Area Boundary
  map.addSource('study-area', {
    type: 'geojson',
    data: 'data/study_area.geojson'
  });

  map.addLayer({
    id: 'study-area-line',
    type: 'line',
    source: 'study-area',
    paint: {
      'line-color': '#38bdf8',
      'line-width': 2.5,
      'line-dasharray': [3, 2]
    }
  });

  // 2. DEM WMS Layer (GeoServer / Local WMS endpoint)
  map.addSource('dem-wms', {
    type: 'raster',
    tiles: [
      'http://localhost:8080/geoserver/proximity/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=proximity:navrangpura_dem&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'
    ],
    tileSize: 256
  });

  map.addLayer({
    id: 'dem-wms-layer',
    type: 'raster',
    source: 'dem-wms',
    paint: { 'raster-opacity': 0.4 },
    layout: { visibility: 'none' }
  });

  // 3. Hex Accessibility Grid (Res 9)
  map.addSource('hex-grid', {
    type: 'vector',
    url: 'pmtiles://data/proximity_tiles.pmtiles'
  });

  map.addLayer({
    id: 'hex-fill',
    type: 'fill',
    source: 'hex-grid',
    'source-layer': 'hex',
    paint: {
      'fill-color': [
        'step',
        ['get', 'network_dist_m'],
        '#10b981', // < 600m
        600, '#f59e0b', // 600 - 1200m
        1200, '#ef4444' // > 1200m (Underserved)
      ],
      'fill-opacity': 0.65
    }
  });

  map.addLayer({
    id: 'hex-line',
    type: 'line',
    source: 'hex-grid',
    'source-layer': 'hex',
    paint: {
      'line-color': '#0f172a',
      'line-width': 0.5,
      'line-opacity': 0.4
    }
  });

  // 4. Healthcare Services Points
  map.addSource('services', {
    type: 'vector',
    url: 'pmtiles://data/proximity_tiles.pmtiles'
  });

  map.addLayer({
    id: 'services-points',
    type: 'circle',
    source: 'services',
    'source-layer': 'services',
    paint: {
      'circle-radius': 6.5,
      'circle-color': '#e63946',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  });

  // Interactive Click Popups on Services
  map.on('click', 'services-points', (e) => {
    const props = e.features[0].properties;
    const coords = e.features[0].geometry.coordinates.slice();
    const name = props.name || 'Unnamed Healthcare Facility';
    const type = (props.service_type || 'Healthcare').toUpperCase();
    const osmId = props.osm_id || '';

    new maplibregl.Popup()
      .setLngLat(coords)
      .setHTML(`
        <div class="popup-title">${name}</div>
        <div class="popup-tag">${type}</div>
        <div style="font-size:0.75rem; color:#94a3b8;">
          OSM: <code>${osmId}</code><br>
          Lat: ${coords[1].toFixed(5)}, Lon: ${coords[0].toFixed(5)}
        </div>
      `)
      .addTo(map);
  });

  map.on('mouseenter', 'services-points', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'services-points', () => {
    map.getCanvas().style.cursor = '';
  });

  // Interactive Hover Popups on Hexagons
  const hexPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false
  });

  map.on('mousemove', 'hex-fill', (e) => {
    if (e.features.length > 0) {
      map.getCanvas().style.cursor = 'pointer';
      const props = e.features[0].properties;
      const netDist = parseFloat(props.network_dist_m).toFixed(0);
      const strDist = parseFloat(props.straight_dist_m).toFixed(0);
      const pop = parseFloat(props.est_population).toFixed(0);

      hexPopup.setLngLat(e.lngLat)
        .setHTML(`
          <strong>H3 Cell: ${props.h3_index}</strong><br>
          Network Walk: <b>${netDist} m</b> (${(netDist/80).toFixed(1)} min)<br>
          Straight Line: <b>${strDist} m</b><br>
          Est. Population: <b>${pop} people</b>
        `)
        .addTo(map);
    }
  });

  map.on('mouseleave', 'hex-fill', () => {
    map.getCanvas().style.cursor = '';
    hexPopup.remove();
  });
});

// Layer Checkboxes
document.getElementById('chkHexagons').addEventListener('change', (e) => {
  const vis = e.target.checked ? 'visible' : 'none';
  if (map.getLayer('hex-fill')) map.setLayoutProperty('hex-fill', 'visibility', vis);
  if (map.getLayer('hex-line')) map.setLayoutProperty('hex-line', 'visibility', vis);
});

document.getElementById('chkServices').addEventListener('change', (e) => {
  const vis = e.target.checked ? 'visible' : 'none';
  if (map.getLayer('services-points')) map.setLayoutProperty('services-points', 'visibility', vis);
});

document.getElementById('chkStudyArea').addEventListener('change', (e) => {
  const vis = e.target.checked ? 'visible' : 'none';
  if (map.getLayer('study-area-line')) map.setLayoutProperty('study-area-line', 'visibility', vis);
});

document.getElementById('chkWmsDem').addEventListener('change', (e) => {
  const vis = e.target.checked ? 'visible' : 'none';
  if (map.getLayer('dem-wms-layer')) map.setLayoutProperty('dem-wms-layer', 'visibility', vis);
});

// Mode Switching (Adult vs Elderly)
document.getElementById('modeAdultBtn').addEventListener('click', () => {
  currentMode = 'adult';
  document.getElementById('modeAdultBtn').classList.add('active');
  document.getElementById('modeElderlyBtn').classList.remove('active');

  map.setPaintProperty('hex-fill', 'fill-color', [
    'step',
    ['get', 'network_dist_m'],
    '#10b981',
    600, '#f59e0b',
    1200, '#ef4444' // Adult 15-min threshold
  ]);
});

document.getElementById('modeElderlyBtn').addEventListener('click', () => {
  currentMode = 'elderly';
  document.getElementById('modeElderlyBtn').classList.add('active');
  document.getElementById('modeAdultBtn').classList.remove('active');

  map.setPaintProperty('hex-fill', 'fill-color', [
    'step',
    ['get', 'network_dist_m'],
    '#10b981',
    450, '#f59e0b',
    900, '#ef4444' // Elderly 15-min threshold at 3.6 km/h
  ]);
});

// Performance Benchmark: Load all 20,607 buildings as WFS GeoJSON
let buildingsLoaded = false;
document.getElementById('btnToggleBuildings').addEventListener('click', async () => {
  const btn = document.getElementById('btnToggleBuildings');
  const statusEl = document.getElementById('perfStatus');

  if (!buildingsLoaded) {
    statusEl.innerText = 'Requesting WFS GeoJSON (20,607 buildings)...';
    const t0 = performance.now();

    try {
      const res = await fetch('data/buildings.geojson');
      const data = await res.json();
      const t1 = performance.now();
      const elapsedMs = (t1 - t0).toFixed(0);
      const approxKb = (JSON.stringify(data).length / 1024).toFixed(1);

      if (!map.getSource('buildings-wfs')) {
        map.addSource('buildings-wfs', {
          type: 'geojson',
          data: data
        });
        map.addLayer({
          id: 'buildings-fill',
          type: 'fill',
          source: 'buildings-wfs',
          paint: {
            'fill-color': '#94a3b8',
            'fill-opacity': 0.5,
            'fill-outline-color': '#475569'
          }
        }, 'services-points');
      } else {
        map.setLayoutProperty('buildings-fill', 'visibility', 'visible');
      }

      buildingsLoaded = true;
      btn.innerText = 'Hide Buildings';
      btn.style.background = '#dc2626';
      statusEl.innerHTML = `Loaded in <b>${elapsedMs} ms</b> | Size: <b>${approxKb} KB</b> (1 request)`;
    } catch (err) {
      statusEl.innerText = 'Error loading buildings GeoJSON.';
      console.error(err);
    }
  } else {
    map.setLayoutProperty('buildings-fill', 'visibility', 'none');
    buildingsLoaded = false;
    btn.innerText = 'Load Buildings (WFS GeoJSON)';
    btn.style.background = '#2563eb';
    statusEl.innerText = 'Status: Off';
  }
});
