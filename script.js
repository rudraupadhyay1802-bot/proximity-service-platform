/* ============================================================
   CONFIG: Healthcare service sub-types → Overpass tags
   Study area: Navrangpura Ward, Ahmedabad
   Service: HEALTHCARE ONLY (hospital, clinic, pharmacy, etc.)
   ============================================================ */
const HEALTHCARE_SUBCATS = [
  { key: 'hospital',   label: 'Hospital',       glyph: '✚', color: '#ff6b5e',
    match: [{tagKey:'amenity', tagValue:'hospital'}, {tagKey:'healthcare', tagValue:'hospital'}] },
  { key: 'clinic',     label: 'Clinic',          glyph: '✚', color: '#ff9e8b',
    match: [{tagKey:'amenity', tagValue:'clinic'}, {tagKey:'healthcare', tagValue:'clinic'}] },
  { key: 'pharmacy',   label: 'Pharmacy',        glyph: '⚕', color: '#ffd166',
    match: [{tagKey:'amenity', tagValue:'pharmacy'}] },
  { key: 'doctors',    label: 'Doctors / GP',    glyph: '👨‍⚕️', color: '#06d6a0',
    match: [{tagKey:'amenity', tagValue:'doctors'}, {tagKey:'healthcare', tagValue:'doctor'}] },
  { key: 'dentist',    label: 'Dentist',         glyph: '🦷', color: '#4cc9f0',
    match: [{tagKey:'amenity', tagValue:'dentist'}] },
  { key: 'centre',     label: 'Health Centre',   glyph: '🏥', color: '#a8dadc',
    match: [{tagKey:'amenity', tagValue:'health_centre'}, {tagKey:'healthcare', tagValue:'centre'}] },
];

// Active subtypes set (all on by default)
let activeSubtypes = new Set(HEALTHCARE_SUBCATS.map(s => s.key));

// Flat lookup: key → subcat config
const SUBCAT_INDEX = {};
HEALTHCARE_SUBCATS.forEach(s => { SUBCAT_INDEX[s.key] = s; });

function findSubcatEntry(tags) {
  if (!tags) return null;
  for (const sub of HEALTHCARE_SUBCATS) {
    const hit = sub.match.find(m => tags[m.tagKey] === m.tagValue);
    if (hit) return { sub, matchedTag: hit };
  }
  return null;
}

let map, originMarker = null, bufferLayer = null, clusterGroup = null, routeLayer = null;
let originLatLng = null;
let searchMode = 'radius';  // 'radius' | 'nearest'
let dataSource = 'overpass'; // 'overpass' | 'backend'
const BACKEND_BASE = 'http://localhost:4000';
let lastResults = [];
let selectedCardEl = null;
let selectedRouteId = null;
const routeCache = new Map();

/* ── Ahmedabad scope ─────────────────────────────────────────────────── */
const AHMEDABAD_CENTER = { lat: 23.0225, lng: 72.5714 };
const AHMEDABAD_VIEWBOX = '72.44,23.15,72.75,22.85'; // for Nominatim
function isWithinAhmedabadArea(lat, lon) {
  return lat >= 22.80 && lat <= 23.20 && lon >= 72.40 && lon <= 72.80;
}

/* ── Map init ────────────────────────────────────────────────────────── */
function initMap() {
  if (typeof L === 'undefined') {
    document.getElementById('map').innerHTML =
      '<div style="padding:40px;color:#ff6b5e;font-family:monospace;">Map library failed to load. Check connection.</div>';
    return;
  }
  map = L.map('map', { zoomControl: false }).setView([AHMEDABAD_CENTER.lat, AHMEDABAD_CENTER.lng], 13);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors', subdomains: 'abc', maxZoom: 19
  }).addTo(map);

  clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50 });
  map.addLayer(clusterGroup);
  routeLayer = L.layerGroup().addTo(map);

  map.on('mousemove', e => {
    const el = document.getElementById('coordReadout');
    if (el) el.innerHTML = `<span class="lbl">POINT</span>${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
  });
  map.on('click', e => {
    setOrigin(e.latlng.lat, e.latlng.lng, null, false);
    const li = document.getElementById('latInput'), lo = document.getElementById('lonInput');
    if (li) li.value = e.latlng.lat.toFixed(5);
    if (lo) lo.value = e.latlng.lng.toFixed(5);
  });
}

/* ── Service type chips ──────────────────────────────────────────────── */
function buildChips() {
  const grid = document.getElementById('chipGrid');
  if (!grid) return;
  HEALTHCARE_SUBCATS.forEach(sub => {
    const chip = document.createElement('label');
    chip.className = 'chip active';
    chip.style.setProperty('--chip-color', sub.color);
    chip.innerHTML = `<span class="dot" style="background:${sub.color}"></span>${sub.glyph} ${sub.label}
      <input type="checkbox" checked data-sub="${sub.key}">`;
    chip.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) activeSubtypes.add(sub.key);
      else activeSubtypes.delete(sub.key);
      chip.classList.toggle('active', e.target.checked);
      updateCatCount();
      updateRunState();
    });
    grid.appendChild(chip);
  });
  updateCatCount();
}

function updateCatCount() {
  const el = document.getElementById('catCount');
  if (el) el.textContent = `${activeSubtypes.size} of ${HEALTHCARE_SUBCATS.length} types selected`;
}
function updateRunState() {
  const btn = document.getElementById('runBtn');
  if (btn) btn.disabled = !(originLatLng && activeSubtypes.size > 0);
}

/* ── Origin selection ────────────────────────────────────────────────── */
function setOrigin(lat, lng, label, recenter = true) {
  originLatLng = { lat, lng };
  if (originMarker) map.removeLayer(originMarker);
  const icon = L.divIcon({ className: '', html: '<div class="origin-pin"></div>', iconSize: [18, 18] });
  originMarker = L.marker([lat, lng], { icon }).addTo(map);
  if (recenter) map.setView([lat, lng], 14);
  updateRunState();
  const statusEl = document.getElementById('searchStatus');
  if (statusEl) {
    statusEl.className = 'status-line ok';
    statusEl.textContent = label ? `Located: ${label}` : `Point set: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
  drawBuffer();
}

function drawBuffer() {
  if (!originLatLng) return;
  if (bufferLayer) { map.removeLayer(bufferLayer); bufferLayer = null; }
  if (searchMode !== 'radius') return;
  const km = parseFloat(document.getElementById('radiusSlider').value);
  const circle = turf.circle([originLatLng.lng, originLatLng.lat], km, { units: 'kilometers', steps: 64 });
  bufferLayer = L.geoJSON(circle, {
    style: { color: '#ff6b5e', weight: 1.5, fillColor: '#ff6b5e', fillOpacity: 0.06, dashArray: '4,4' }
  }).addTo(map);
}

/* ── Nominatim search ────────────────────────────────────────────────── */
let suggestTimer = null, suggestItems = [], suggestHlIndex = -1;

async function fetchSuggestions(q) {
  if (q.length < 3) { hideSuggestions(); return; }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&viewbox=${AHMEDABAD_VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
    const data = await (await fetch(url)).json();
    renderSuggestions(data);
  } catch (err) { console.error('Suggest error:', err); }
}

function renderSuggestions(items) {
  suggestItems = items; suggestHlIndex = -1;
  const box = document.getElementById('suggestBox');
  if (!items.length) { hideSuggestions(); return; }
  box.innerHTML = items.map((it, i) => {
    const main = it.display_name.split(',')[0];
    const rest = it.display_name.split(',').slice(1, 4).join(',');
    return `<div class="suggest-item" data-i="${i}"><b>${escapeHtml(main)}</b>${escapeHtml(rest)}</div>`;
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.suggest-item').forEach(el =>
    el.addEventListener('click', () => pickSuggestion(parseInt(el.dataset.i))));
}
function hideSuggestions() {
  const box = document.getElementById('suggestBox');
  box.classList.remove('open'); box.innerHTML = ''; suggestItems = []; suggestHlIndex = -1;
}
function pickSuggestion(i) {
  const it = suggestItems[i]; if (!it) return;
  document.getElementById('searchInput').value = it.display_name.split(',').slice(0, 2).join(',');
  hideSuggestions();
  setOrigin(parseFloat(it.lat), parseFloat(it.lon), it.display_name.split(',').slice(0, 3).join(','));
}

document.getElementById('searchInput').addEventListener('input', e => {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => fetchSuggestions(e.target.value.trim()), 350);
});
document.getElementById('searchInput').addEventListener('keydown', e => {
  const box = document.getElementById('suggestBox');
  if (box.classList.contains('open')) {
    const items = [...box.querySelectorAll('.suggest-item')];
    if (e.key === 'ArrowDown') { e.preventDefault(); suggestHlIndex = Math.min(suggestHlIndex + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('hl', i === suggestHlIndex)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); suggestHlIndex = Math.max(suggestHlIndex - 1, 0); items.forEach((it, i) => it.classList.toggle('hl', i === suggestHlIndex)); return; }
    if (e.key === 'Enter' && suggestHlIndex >= 0) { e.preventDefault(); pickSuggestion(suggestHlIndex); return; }
  }
  if (e.key === 'Enter') { hideSuggestions(); doSearch(); }
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-row') && !e.target.closest('.suggest-box')) hideSuggestions();
});

async function doSearch() {
  const q = document.getElementById('searchInput').value.trim(); if (!q) return;
  const statusEl = document.getElementById('searchStatus');
  statusEl.className = 'status-line active'; statusEl.textContent = 'Geocoding location…';
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&viewbox=${AHMEDABAD_VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
    const data = await (await fetch(url)).json();
    if (!data.length) { statusEl.className = 'status-line err'; statusEl.textContent = 'No match found in Ahmedabad — try clicking the map.'; return; }
    setOrigin(parseFloat(data[0].lat), parseFloat(data[0].lon), data[0].display_name.split(',').slice(0, 3).join(','));
  } catch (err) {
    statusEl.className = 'status-line err'; statusEl.textContent = `Search failed: ${err.message}`;
  }
}

/* ── Live location ───────────────────────────────────────────────────── */
document.getElementById('liveLocBtn').addEventListener('click', () => {
  const statusEl = document.getElementById('searchStatus');
  if (!navigator.geolocation) { statusEl.className = 'status-line err'; statusEl.textContent = 'Geolocation not supported.'; return; }
  statusEl.className = 'status-line active'; statusEl.textContent = 'Getting live location…';
  navigator.geolocation.getCurrentPosition(
    pos => setOrigin(pos.coords.latitude, pos.coords.longitude, 'Your live location'),
    err => { statusEl.className = 'status-line err'; statusEl.textContent = `Location failed: ${err.message}`; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

/* ── Lat/Lon manual input ────────────────────────────────────────────── */
function setOriginFromLatLon() {
  const statusEl = document.getElementById('searchStatus');
  const lat = Number(document.getElementById('latInput').value.trim());
  const lon = Number(document.getElementById('lonInput').value.trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    statusEl.className = 'status-line err'; statusEl.textContent = 'Enter valid latitude and longitude.'; return;
  }
  hideSuggestions(); setOrigin(lat, lon, null);
}
document.getElementById('latlonBtn').addEventListener('click', setOriginFromLatLon);
['latInput', 'lonInput'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') setOriginFromLatLon(); }));

/* ── Search mode ─────────────────────────────────────────────────────── */
function setSearchMode(mode) {
  searchMode = mode;
  document.getElementById('modeRadiusBtn').classList.toggle('active', mode === 'radius');
  document.getElementById('modeNearestBtn').classList.toggle('active', mode === 'nearest');
  document.getElementById('radiusModeBox').style.display = mode === 'radius' ? '' : 'none';
  document.getElementById('nearestModeBox').style.display = mode === 'nearest' ? '' : 'none';
  drawBuffer();
}
document.getElementById('modeRadiusBtn').addEventListener('click', () => setSearchMode('radius'));
document.getElementById('modeNearestBtn').addEventListener('click', () => setSearchMode('nearest'));
document.getElementById('nearestNSlider').addEventListener('input', e =>
  document.getElementById('nearestNVal').textContent = e.target.value);

/* ── Radius slider ───────────────────────────────────────────────────── */
document.getElementById('radiusSlider').addEventListener('input', e => {
  document.getElementById('radiusVal').textContent = e.target.value;
  drawBuffer();
});

/* ── Overpass query (healthcare only) ───────────────────────────────── */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
let stickyMirrorIndex = 0;

async function queryOverpassWithRetry(overpassQL, onStatus, perMirrorTimeoutMs = 18000) {
  let lastErr = null;
  const order = [stickyMirrorIndex, ...[0, 1, 2].filter(i => i !== stickyMirrorIndex)];
  for (const i of order) {
    const mirror = OVERPASS_MIRRORS[i];
    const host = mirror.replace('https://', '').split('/')[0];
    onStatus(`Querying ${host}…`);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), perMirrorTimeoutMs);
      const res = await fetch(mirror, { method: 'POST', body: 'data=' + encodeURIComponent(overpassQL), signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 429 || res.status === 504) throw new Error(`${host} overloaded (${res.status})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      stickyMirrorIndex = i;
      return await res.json();
    } catch (err) {
      lastErr = err.name === 'AbortError' ? new Error(`${host} timed out`) : err;
      await new Promise(r => setTimeout(r, 350));
    }
  }
  throw lastErr || new Error('All Overpass mirrors failed');
}

function buildHealthcareQuery(radiusM, lat, lng) {
  const activeSubs = HEALTHCARE_SUBCATS.filter(s => activeSubtypes.has(s.key));
  const clauses = activeSubs.flatMap(s =>
    s.match.map(m => `nwr["${m.tagKey}"="${m.tagValue}"](around:${radiusM},${lat},${lng});`)
  ).join('');
  return `[out:json][timeout:20];(${clauses});out center;`;
}

/* ── Backend API ─────────────────────────────────────────────────────── */
async function fetchBackendRadius(lat, lon, radiusM) {
  const url = `${BACKEND_BASE}/api/services/radius?lat=${lat}&lon=${lon}&radius=${radiusM}`;
  const data = await (await fetch(url)).json();
  return data.results;
}
async function fetchBackendNearest(lat, lon, limit) {
  const url = `${BACKEND_BASE}/api/services/nearest?lat=${lat}&lon=${lon}&limit=${limit}`;
  const data = await (await fetch(url)).json();
  return data.results;
}
function backendRowToResult(row) {
  const sub = SUBCAT_INDEX[row.service_type] || SUBCAT_INDEX['clinic'];
  return {
    id: `backend-${row.id}`, lat: row.lat, lon: row.lon,
    name: row.name, sub, dist: row.distance_m / 1000,
    address: row.address, phone: row.phone, website: row.website, hours: row.opening_hours,
    glyph: sub.glyph, pinColor: sub.color,
  };
}

/* ── Survey runner ───────────────────────────────────────────────────── */
async function runSurvey() {
  if (!originLatLng) return;
  const runStatus = document.getElementById('runStatus');
  const runBtn = document.getElementById('runBtn');
  if (activeSubtypes.size === 0) {
    runStatus.className = 'status-line err'; runStatus.textContent = 'Select at least one healthcare type.'; return;
  }
  runBtn.disabled = true;
  lastResults = [];
  drawMarkersAndList();

  if (dataSource === 'backend') {
    if (searchMode === 'nearest') await runBackendNearestSurvey(runStatus);
    else await runBackendRadiusSurvey(runStatus);
  } else {
    if (searchMode === 'nearest') await runNearestNSurvey(runStatus);
    else await runRadiusSurvey(runStatus);
  }
  runBtn.disabled = false;
}

async function runRadiusSurvey(runStatus) {
  const km = parseFloat(document.getElementById('radiusSlider').value);
  const radiusM = Math.round(km * 1000);
  const { lat, lng } = originLatLng;
  try {
    const ql = buildHealthcareQuery(radiusM, lat, lng);
    runStatus.className = 'status-line active';
    const data = await queryOverpassWithRetry(ql, msg => { runStatus.textContent = msg; }, 18000);
    appendResults(data.elements || []);
  } catch (err) {
    runStatus.className = 'status-line err'; runStatus.textContent = `Overpass failed: ${err.message}`;
  }
  drawMarkersAndList();
}

const NEAREST_START_RADIUS_KM = 1;
const NEAREST_MAX_RADIUS_KM = 20;

async function runNearestNSurvey(runStatus) {
  const targetN = parseInt(document.getElementById('nearestNSlider').value, 10);
  const { lat, lng } = originLatLng;
  let radiusKm = NEAREST_START_RADIUS_KM;
  while (radiusKm <= NEAREST_MAX_RADIUS_KM) {
    runStatus.className = 'status-line active';
    runStatus.textContent = `Searching within ${radiusKm} km…`;
    try {
      const ql = buildHealthcareQuery(radiusKm * 1000, lat, lng);
      const data = await queryOverpassWithRetry(ql, () => {}, 18000);
      appendResults(data.elements || []);
      if (lastResults.length >= targetN) break;
    } catch (err) { break; }
    radiusKm = radiusKm >= NEAREST_MAX_RADIUS_KM ? NEAREST_MAX_RADIUS_KM + 1 : Math.min(radiusKm * 2, NEAREST_MAX_RADIUS_KM);
  }
  lastResults = lastResults.sort((a, b) => a.dist - b.dist).slice(0, targetN);
  drawMarkersAndList();
}

async function runBackendRadiusSurvey(runStatus) {
  const km = parseFloat(document.getElementById('radiusSlider').value);
  runStatus.className = 'status-line active'; runStatus.textContent = 'Querying PostGIS database…';
  try {
    const rows = await fetchBackendRadius(originLatLng.lat, originLatLng.lng, Math.round(km * 1000));
    lastResults = rows.map(backendRowToResult).filter(r => r && activeSubtypes.has(r.sub.key));
    lastResults.sort((a, b) => a.dist - b.dist);
  } catch (err) {
    runStatus.className = 'status-line err'; runStatus.textContent = `Backend error: ${err.message}. Is "npm run dev" running?`; return;
  }
  drawMarkersAndList();
}

async function runBackendNearestSurvey(runStatus) {
  const targetN = parseInt(document.getElementById('nearestNSlider').value, 10);
  runStatus.className = 'status-line active'; runStatus.textContent = 'Querying PostGIS database…';
  try {
    const rows = await fetchBackendNearest(originLatLng.lat, originLatLng.lng, targetN);
    lastResults = rows.map(backendRowToResult).filter(r => r && activeSubtypes.has(r.sub.key)).slice(0, targetN);
  } catch (err) {
    runStatus.className = 'status-line err'; runStatus.textContent = `Backend error: ${err.message}. Is "npm run dev" running?`; return;
  }
  drawMarkersAndList();
}

/* ── Results processing ──────────────────────────────────────────────── */
function appendResults(elements) {
  const { lat, lng } = originLatLng;
  elements.forEach(el => {
    const tags = el.tags || {};
    const entry = findSubcatEntry(tags);
    if (!entry || !activeSubtypes.has(entry.sub.key)) return;
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (!elLat || !elLon) return;
    const dist = turf.distance([lng, lat], [elLon, elLat], { units: 'kilometers' });
    lastResults.push({
      id: `${el.type}/${el.id}`, lat: elLat, lon: elLon,
      name: tags.name || tags['name:en'] || null,
      sub: entry.sub, dist, address: tags['addr:street'] || null,
      phone: tags.phone || tags['contact:phone'] || null,
      website: tags.website || tags['contact:website'] || null,
      hours: tags.opening_hours || null,
      glyph: entry.sub.glyph, pinColor: entry.sub.color,
    });
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Render markers + result cards ──────────────────────────────────── */
function drawMarkersAndList() {
  clusterGroup.clearLayers();
  if (routeLayer) routeLayer.clearLayers();
  selectedCardEl = null; selectedRouteId = null;
  const listEl = document.getElementById('resultsList');
  const countEl = document.getElementById('resultsCount');

  if (!lastResults.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="glyph">✚</div>No healthcare facilities found in this area.</div>';
    if (countEl) countEl.textContent = '';
    document.getElementById('runStatus').className = 'status-line ok';
    document.getElementById('runStatus').textContent = 'Done — 0 results.';
    return;
  }

  if (countEl) countEl.textContent = `${lastResults.length} facilities found`;
  document.getElementById('runStatus').className = 'status-line ok';
  document.getElementById('runStatus').textContent = `Found ${lastResults.length} healthcare facility${lastResults.length !== 1 ? 'ies' : 'y'}.`;

  listEl.innerHTML = '';
  lastResults.forEach((r, i) => {
    // Marker
    const icon = L.divIcon({
      className: '',
      html: `<div class="pin-icon" style="background:${r.pinColor}">${r.glyph}</div>`,
      iconSize: [30, 30], iconAnchor: [15, 15]
    });
    const marker = L.marker([r.lat, r.lon], { icon });
    marker.bindTooltip(r.name || r.sub.label, { direction: 'top', offset: [0, -12] });
    marker.on('click', () => selectResult(i));
    clusterGroup.addLayer(marker);
    r._marker = marker;

    // Card
    const card = document.createElement('div');
    card.className = 'result-card';
    card.dataset.index = i;
    const distStr = r.dist < 1 ? `${Math.round(r.dist * 1000)} m` : `${r.dist.toFixed(2)} km`;
    card.innerHTML = `
      <div class="card-header">
        <span class="card-glyph" style="color:${r.pinColor}">${r.glyph}</span>
        <span class="card-name">${escapeHtml(r.name || 'Unnamed ' + r.sub.label)}</span>
        <span class="card-dist">${distStr}</span>
      </div>
      <div class="card-meta">
        <span class="card-type" style="color:${r.pinColor}">${r.sub.label}</span>
        ${r.address ? `<span class="card-address">📍 ${escapeHtml(r.address)}</span>` : ''}
        ${r.phone ? `<span class="card-phone">📞 ${escapeHtml(r.phone)}</span>` : ''}
        ${r.website ? `<a class="card-link" href="${escapeHtml(r.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ''}
        ${r.hours ? `<span class="card-hours">🕐 ${escapeHtml(r.hours)}</span>` : ''}
      </div>`;
    card.addEventListener('click', () => selectResult(i));
    listEl.appendChild(card);
  });
}

function selectResult(i) {
  const r = lastResults[i];
  const cards = document.querySelectorAll('.result-card');
  if (selectedCardEl) selectedCardEl.classList.remove('selected');
  selectedCardEl = cards[i];
  if (selectedCardEl) selectedCardEl.classList.add('selected');
  map.flyTo([r.lat, r.lon], 16, { duration: 0.8 });
}

/* ── Data source toggle ──────────────────────────────────────────────── */
const srcOverpassBtn = document.getElementById('sourceOverpassBtn');
const srcBackendBtn = document.getElementById('sourceBackendBtn');
if (srcOverpassBtn) {
  srcOverpassBtn.addEventListener('click', () => {
    dataSource = 'overpass';
    srcOverpassBtn.classList.add('active'); srcBackendBtn.classList.remove('active');
  });
}
if (srcBackendBtn) {
  srcBackendBtn.addEventListener('click', () => {
    dataSource = 'backend';
    srcBackendBtn.classList.add('active'); srcOverpassBtn.classList.remove('active');
  });
}

/* ── Keyboard search ─────────────────────────────────────────────────── */
document.getElementById('searchBtn').addEventListener('click', doSearch);
document.getElementById('runBtn').addEventListener('click', runSurvey);

/* ── Boot ────────────────────────────────────────────────────────────── */
initMap();
buildChips();
