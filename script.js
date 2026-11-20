/* ============================================================
   CONFIG: service categories -> subcategories -> Overpass tags
   Reorganized around Ahmedabad student needs. Each subcategory
   lists one or more {tagKey, tagValue} matches (some student
   services map to more than one OSM tag, e.g. College/University
   covers both amenity=college and amenity=university).

   Subcategories marked `unavailable:true` have no OSM tag that
   reliably represents them in this region (PG accommodation,
   mess/tiffin services, dedicated study spaces). Per project
   rules we do not fabricate data for these — they're shown in
   the UI as "Soon" and structured so a real data source can be
   plugged in later, but are never queried or included in results.

   Subcategories marked `budget:true` are ones where a price
   genuinely matters to a student (hostels, food, laundry, gym).
   OSM does not carry reliable pricing for these, so the UI shows
   a "Budget" indicator that is honestly labelled "Not available"
   rather than inventing numbers.
   ============================================================ */
const CATEGORIES = [
  { id:'study', label:'Study', color:'#5ec8ff',
    subcats:[
      { key:'college',   label:'College / University', glyph:'🎓',
        match:[{tagKey:'amenity', tagValue:'college'}, {tagKey:'amenity', tagValue:'university'}] },
      { key:'library',   label:'Library',              glyph:'📚', match:[{tagKey:'amenity', tagValue:'library'}] },
      { key:'bookstore', label:'Bookstore',             glyph:'📖', match:[{tagKey:'shop', tagValue:'books'}] },
      { key:'stationery',label:'Stationery',            glyph:'✏️', match:[{tagKey:'shop', tagValue:'stationery'}] },
      { key:'printing',  label:'Printing / Xerox',      glyph:'🖨', match:[{tagKey:'shop', tagValue:'copyshop'}] },
      { key:'studyspace',label:'Study Space', glyph:'📐', unavailable:true, match:[] },
    ]},
  { id:'accommodation', label:'Accommodation', color:'#ff9ecf',
    subcats:[
      { key:'hostel', label:'Hostel', glyph:'🏨', budget:true,
        match:[{tagKey:'tourism', tagValue:'hostel'}, {tagKey:'building', tagValue:'dormitory'}] },
      { key:'pg',     label:'PG / Paying Guest', glyph:'🛏', unavailable:true, budget:true, match:[] },
    ]},
  { id:'food', label:'Food', color:'#ffb347',
    subcats:[
      { key:'restaurant', label:'Restaurant', glyph:'🍽', budget:true, match:[{tagKey:'amenity', tagValue:'restaurant'}] },
      { key:'cafe',       label:'Cafe',       glyph:'☕', budget:true, match:[{tagKey:'amenity', tagValue:'cafe'}] },
      { key:'fastfood',   label:'Fast Food',  glyph:'🍔', budget:true, match:[{tagKey:'amenity', tagValue:'fast_food'}] },
      { key:'messtiffin', label:'Mess / Tiffin', glyph:'🍱', unavailable:true, budget:true, match:[] },
    ]},
  { id:'daily', label:'Daily Needs', color:'#ffe066',
    subcats:[
      { key:'grocery',     label:'Grocery',            glyph:'🥬', match:[{tagKey:'shop', tagValue:'grocery'}] },
      { key:'supermarket', label:'Supermarket',        glyph:'🛒', match:[{tagKey:'shop', tagValue:'supermarket'}] },
      { key:'convenience', label:'Convenience Store',  glyph:'🏪', match:[{tagKey:'shop', tagValue:'convenience'}] },
      { key:'laundry',     label:'Laundry', glyph:'🧺', budget:true, match:[{tagKey:'shop', tagValue:'laundry'}] },
      { key:'salon',       label:'Salon',              glyph:'💇', match:[{tagKey:'shop', tagValue:'hairdresser'}] },
      { key:'gym',         label:'Gym',     glyph:'🏋', budget:true, match:[{tagKey:'leisure', tagValue:'fitness_centre'}] },
    ]},
  { id:'transport', label:'Transport', color:'#c98bff',
    subcats:[
      { key:'busstop', label:'Bus Stop',        glyph:'🚏', match:[{tagKey:'highway', tagValue:'bus_stop'}] },
      { key:'metro',   label:'Metro Station',   glyph:'🚇', match:[{tagKey:'station', tagValue:'subway'}] },
      { key:'railway', label:'Railway Station', glyph:'🚉', match:[{tagKey:'railway', tagValue:'station'}] },
      { key:'fuel',    label:'Fuel Station',    glyph:'⛽', match:[{tagKey:'amenity', tagValue:'fuel'}] },
    ]},
  { id:'healthcare', label:'Healthcare', color:'#ff6b5e',
    subcats:[
      { key:'hospital',   label:'Hospital',          glyph:'✚', match:[{tagKey:'amenity', tagValue:'hospital'}] },
      { key:'clinic',     label:'Clinic',             glyph:'✚', match:[{tagKey:'amenity', tagValue:'clinic'}] },
      { key:'pharmacy',   label:'Pharmacy',           glyph:'⚕', match:[{tagKey:'amenity', tagValue:'pharmacy'}] },
      { key:'diagnostic', label:'Diagnostic Centre',  glyph:'🧪', match:[{tagKey:'healthcare', tagValue:'laboratory'}] },
    ]},
  { id:'finance', label:'Finance', color:'#7cff9e',
    subcats:[
      { key:'bank', label:'Bank', glyph:'🏦', match:[{tagKey:'amenity', tagValue:'bank'}] },
      { key:'atm',  label:'ATM',  glyph:'₹', match:[{tagKey:'amenity', tagValue:'atm'}] },
    ]},
  { id:'safety', label:'Safety', color:'#4d7cff',
    subcats:[
      { key:'police', label:'Police Station', glyph:'🛡', match:[{tagKey:'amenity', tagValue:'police'}] },
      { key:'fire',   label:'Fire Station',   glyph:'🚒', match:[{tagKey:'amenity', tagValue:'fire_station'}] },
    ]},
  { id:'recreation', label:'Recreation', color:'#8bd17c',
    subcats:[
      { key:'park',       label:'Park',                glyph:'🌳', match:[{tagKey:'leisure', tagValue:'park'}] },
      { key:'playground', label:'Playground',          glyph:'🛝', match:[{tagKey:'leisure', tagValue:'playground'}] },
      { key:'sportsrec',  label:'Sports / Recreation', glyph:'🏟', match:[{tagKey:'leisure', tagValue:'sports_centre'}] },
    ]},
];

// Flat lookup: subcategory key -> { cat, sub, shade }. "shade" cycles
// 0/1/2 within a category so pins for different subtypes of the same
// category are still visually distinct (e.g. hospital vs pharmacy).
const SUBCAT_INDEX = {};
CATEGORIES.forEach(cat=>{
  cat.subcats.forEach((sub, i)=>{
    SUBCAT_INDEX[sub.key] = { cat, sub, shade: i % 3 };
  });
});

// Finds which subcategory an Overpass element's tags belong to.
// Skips "unavailable" subcategories entirely (they have no match
// rules and are never queried, so this is mostly a safety net).
function findSubcatEntry(tags){
  if(!tags) return null;
  for(const key in SUBCAT_INDEX){
    const entry = SUBCAT_INDEX[key];
    if(entry.sub.unavailable) continue;
    const matched = entry.sub.match.find(m=>tags[m.tagKey]===m.tagValue);
    if(matched) return { cat:entry.cat, sub:entry.sub, shade:entry.shade, matchedTag:matched };
  }
  return null;
}

// Builds one Overpass clause per distinct tagKey among a category's
// *active, available* subcategories (e.g. Transport's "railway=station"
// is a separate clause from its "highway=bus_stop" clause). Values for
// the same tagKey are merged so one clause covers all of them.
function buildCategoryClauses(cat){
  const activeSubs = cat.subcats.filter(s=>!s.unavailable && activeSubcats.has(s.key));
  const byTagKey = new Map();
  activeSubs.forEach(s=>{
    s.match.forEach(m=>{
      if(!byTagKey.has(m.tagKey)) byTagKey.set(m.tagKey, new Set());
      byTagKey.get(m.tagKey).add(m.tagValue);
    });
  });
  const clauses = [];
  byTagKey.forEach((values, tagKey)=>{
    clauses.push(`nwr["${tagKey}"~"${[...values].join('|')}"]`);
  });
  return clauses;
}

// Lighten/darken a hex color by a small shade index (0/1/2) so
// subtypes within the same category read as related but distinct.
function shadeColor(hex, shade){
  if(!shade) return hex;
  const n = parseInt(hex.slice(1), 16);
  const amt = shade === 1 ? -28 : 28;
  let r = (n>>16) + amt, g = (n>>8 & 0xff) + amt, b = (n & 0xff) + amt;
  r = Math.max(0,Math.min(255,r)); g = Math.max(0,Math.min(255,g)); b = Math.max(0,Math.min(255,b));
  return '#' + ((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1);
}

let map, originMarker=null, bufferLayer=null, clusterGroup=null, routeLayer=null;
let originLatLng=null;
let activeSubcats=new Set();
CATEGORIES.forEach(cat=>cat.subcats.forEach(s=>{ if(!s.unavailable) activeSubcats.add(s.key); }));
let searchMode='radius'; // 'radius' | 'nearest'
let dataSource = 'overpass'; // 'overpass' | 'backend'
const BACKEND_BASE = 'http://localhost:4000';
let lastResults=[];
let selectedCardEl=null;
let selectedRouteId=null;
const routeCache = new Map(); // id -> route data, avoids re-fetching on repeated clicks

/* ============================================================
   AHMEDABAD SCOPE
   This build is fixed to Ahmedabad (per project direction — no
   multi-city selector yet). Search results are biased/restricted
   to this bounding box, and the map opens centered on the city
   instead of a country-wide view.
   ============================================================ */
const AHMEDABAD_CENTER = { lat:23.0225, lng:72.5714 };
const AHMEDABAD_VIEWBOX = '72.44,23.15,72.75,22.85'; // left,top,right,bottom for Nominatim
// A looser box than the strict search viewbox, used only to advise
// (not block) when a manually-entered or geolocated point falls
// outside the city's general area.
function isWithinAhmedabadArea(lat, lon){
  return lat>=22.80 && lat<=23.20 && lon>=72.40 && lon<=72.80;
}

/* ============================================================
   MAP INIT
   ============================================================ */
function initMap(){
  if(typeof L === 'undefined'){
    document.getElementById('map').innerHTML =
      '<div style="padding:40px;color:#ff6b5e;font-family:monospace;">Map library failed to load. Check your internet connection and reload the page.</div>';
    return;
  }
  map = L.map('map', { zoomControl:false, attributionControl:true }).setView([AHMEDABAD_CENTER.lat, AHMEDABAD_CENTER.lng], 12);

  L.control.zoom({ position:'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'&copy; OpenStreetMap contributors',
    subdomains:'abc', maxZoom:19
  }).addTo(map);

  clusterGroup = L.markerClusterGroup({ maxClusterRadius:50 });
  map.addLayer(clusterGroup);
  routeLayer = L.layerGroup().addTo(map);

  map.on('mousemove', e => {
    document.getElementById('coordReadout').innerHTML =
      `<span class="lbl">POINT</span>${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
  });

  map.on('click', e => {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    setOrigin(lat, lng, null, false);
    document.getElementById('latInput').value = lat.toFixed(5);
    document.getElementById('lonInput').value = lng.toFixed(5);
    if(!isWithinAhmedabadArea(lat, lng)){
      const statusEl = document.getElementById('searchStatus');
      statusEl.className = 'status-line active';
      statusEl.textContent += ' — outside Ahmedabad; results may be sparse.';
    }
  });
}

/* ============================================================
   CATEGORY CHIPS (with expandable subcategory checklists)
   ============================================================ */
function buildChips(){
  const grid = document.getElementById('chipGrid');
  CATEGORIES.forEach(cat=>{
    const block = document.createElement('div');
    block.className = 'cat-block';

    const header = document.createElement('label');
    header.className = 'chip active';
    header.innerHTML = `<span class="dot" style="background:${cat.color}"></span>${cat.label}
      <button type="button" class="chip-expand">▾</button>
      <input type="checkbox" checked>`;

    const subList = document.createElement('div');
    subList.className = 'subcat-list';
    cat.subcats.forEach(sub=>{
      const subRow = document.createElement('label');
      subRow.className = 'subcat-item' + (sub.unavailable ? ' disabled' : ' active');

      const soonBadge = sub.unavailable ? `<span class="soon-badge">Soon</span>` : '';
      const budgetBadge = sub.budget ? `<span class="budget-tag">Budget: N/A</span>` : '';
      subRow.innerHTML = `<input type="checkbox" ${sub.unavailable ? 'disabled' : 'checked'} data-sub="${sub.key}"> ${sub.label}${soonBadge}${budgetBadge}`;

      if(!sub.unavailable){
        const checkbox = subRow.querySelector('input');
        checkbox.addEventListener('change', ()=>{
          if(checkbox.checked) activeSubcats.add(sub.key);
          else activeSubcats.delete(sub.key);
          subRow.classList.toggle('active', checkbox.checked);
          syncCategoryHeader(cat, header);
          updateCatCount();
          updateRunState();
        });
      }
      subList.appendChild(subRow);
    });

    header.addEventListener('click', (ev)=>{
      if(ev.target.classList.contains('chip-expand')){
        ev.preventDefault();
        subList.classList.toggle('open');
        ev.target.classList.toggle('rotated');
        return;
      }
      ev.preventDefault();
      const availableSubs = cat.subcats.filter(s=>!s.unavailable);
      const anyActive = availableSubs.some(s=>activeSubcats.has(s.key));
      availableSubs.forEach(s=>{
        if(anyActive) activeSubcats.delete(s.key);
        else activeSubcats.add(s.key);
      });
      subList.querySelectorAll('.subcat-item:not(.disabled)').forEach(row=>{
        const cb = row.querySelector('input[type="checkbox"]');
        cb.checked = !anyActive;
        row.classList.toggle('active', !anyActive);
      });
      syncCategoryHeader(cat, header);
      updateCatCount();
      updateRunState();
    });

    block.appendChild(header);
    block.appendChild(subList);
    grid.appendChild(block);
  });
  updateCatCount();
}

function syncCategoryHeader(cat, header){
  const anyActive = cat.subcats.some(s=>!s.unavailable && activeSubcats.has(s.key));
  header.classList.toggle('active', anyActive);
  header.querySelector('input[type="checkbox"]').checked = anyActive;
}

function updateCatCount(){
  const activeCategoryCount = CATEGORIES.filter(cat=>cat.subcats.some(s=>!s.unavailable && activeSubcats.has(s.key))).length;
  document.getElementById('catCount').textContent = `${activeCategoryCount} categories · ${activeSubcats.size} types`;
}

function updateRunState(){
  const hasSelection = originLatLng && activeSubcats.size>0;
  document.getElementById('runBtn').disabled = !hasSelection;
}

/* ============================================================
   ORIGIN SELECTION
   ============================================================ */
function setOrigin(lat, lng, label, recenter = true){
  originLatLng = {lat, lng};

  if(originMarker) map.removeLayer(originMarker);
  const icon = L.divIcon({ className:'', html:'<div class="origin-pin"></div>', iconSize:[18,18] });
  originMarker = L.marker([lat,lng], {icon}).addTo(map);

  if(recenter) map.setView([lat,lng], 14);
  updateRunState();

  const statusEl = document.getElementById('searchStatus');
  statusEl.className = 'status-line ok';
  statusEl.textContent = label ? `Located: ${label}` : `Point set: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  drawBuffer();
}

function drawBuffer(){
  if(!originLatLng) return;
  if(bufferLayer){ map.removeLayer(bufferLayer); bufferLayer = null; }
  if(searchMode !== 'radius') return; // no fixed radius to draw in nearest-N mode
  const km = parseFloat(document.getElementById('radiusSlider').value);
  const circle = turf.circle([originLatLng.lng, originLatLng.lat], km, {units:'kilometers', steps:64});
  bufferLayer = L.geoJSON(circle, {
    // className hooks the CSS "grow outward from origin" entrance animation
    // (.buffer-circle). Purely visual — the geometry itself is unchanged.
    style:{ color:'#7cff9e', weight:1.5, fillColor:'#7cff9e', fillOpacity:0.06, dashArray:'4,4', className:'buffer-circle' }
  }).addTo(map);
}

/* ============================================================
   SEARCH (Nominatim) — with autocomplete suggestions
   ============================================================ */
let suggestTimer = null;
let suggestItems = [];
let suggestHlIndex = -1;

// Searches our own educational_institutions table. Returns results shaped
// like Nominatim's, so the existing suggestion list and pickSuggestion()
// work unchanged. Returns [] on any failure so callers fall back to Nominatim.
async function searchInstitutionsBackend(q){
  try{
    const res = await fetch(`${BACKEND_BASE}/api/institutions/search?q=${encodeURIComponent(q)}`);
    if(!res.ok) return [];
    const data = await res.json();
    return data.results.map(r => ({
      display_name: [r.name, r.address, 'Ahmedabad'].filter(Boolean).join(', '),
      lat: r.lat,
      lon: r.lon
    }));
  }catch(err){
    console.error('Institution search failed:', err);
    return [];
  }
}

async function fetchSuggestions(q){
  if(q.length < 3){ hideSuggestions(); return; }
  try{
    if(dataSource === 'backend'){
      const own = await searchInstitutionsBackend(q);
      if(own.length){ renderSuggestions(own); return; }
    }
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&viewbox=${AHMEDABAD_VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if(!res.ok) return;
    const data = await res.json();
    renderSuggestions(data);
  }catch(err){
    console.error('Suggest error:', err);
  }
}

function renderSuggestions(items){
  suggestItems = items;
  suggestHlIndex = -1;
  const box = document.getElementById('suggestBox');
  if(!items.length){ hideSuggestions(); return; }
  box.innerHTML = items.map((it,i)=>{
    const main = it.display_name.split(',')[0];
    const rest = it.display_name.split(',').slice(1,4).join(',');
    return `<div class="suggest-item" data-i="${i}"><b>${escapeHtml(main)}</b>${escapeHtml(rest)}</div>`;
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.suggest-item').forEach(el=>{
    el.addEventListener('click', ()=> pickSuggestion(parseInt(el.dataset.i)));
  });
}

function hideSuggestions(){
  const box = document.getElementById('suggestBox');
  box.classList.remove('open');
  box.innerHTML = '';
  suggestItems = [];
  suggestHlIndex = -1;
}

function pickSuggestion(i){
  const it = suggestItems[i];
  if(!it) return;
  document.getElementById('searchInput').value = it.display_name.split(',').slice(0,2).join(',');
  hideSuggestions();
  setOrigin(parseFloat(it.lat), parseFloat(it.lon), it.display_name.split(',').slice(0,3).join(','));
}

document.getElementById('searchInput').addEventListener('input', (e)=>{
  clearTimeout(suggestTimer);
  const q = e.target.value.trim();
  suggestTimer = setTimeout(()=>fetchSuggestions(q), 350);
});

document.getElementById('searchInput').addEventListener('keydown', (e)=>{
  const box = document.getElementById('suggestBox');
  if(box.classList.contains('open')){
    const items = [...box.querySelectorAll('.suggest-item')];
    if(e.key === 'ArrowDown'){
      e.preventDefault();
      suggestHlIndex = Math.min(suggestHlIndex+1, items.length-1);
      items.forEach((it,i)=>it.classList.toggle('hl', i===suggestHlIndex));
      return;
    }
    if(e.key === 'ArrowUp'){
      e.preventDefault();
      suggestHlIndex = Math.max(suggestHlIndex-1, 0);
      items.forEach((it,i)=>it.classList.toggle('hl', i===suggestHlIndex));
      return;
    }
    if(e.key === 'Enter' && suggestHlIndex >= 0){
      e.preventDefault();
      pickSuggestion(suggestHlIndex);
      return;
    }
  }
  if(e.key === 'Enter'){ hideSuggestions(); doSearch(); }
});

document.addEventListener('click', (e)=>{
  if(!e.target.closest('.search-row') && !e.target.closest('.suggest-box')) hideSuggestions();
});

async function doSearch(){
  const q = document.getElementById('searchInput').value.trim();
  if(!q) return;
  const statusEl = document.getElementById('searchStatus');
  statusEl.className = 'status-line active';
  statusEl.textContent = 'Geocoding location…';

  if(dataSource === 'backend'){
    const own = await searchInstitutionsBackend(q);
    if(own.length){
      setOrigin(parseFloat(own[0].lat), parseFloat(own[0].lon), own[0].display_name.split(',').slice(0,3).join(','));
      return;
    }
  }

  try{
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&viewbox=${AHMEDABAD_VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if(!data.length){
      statusEl.className = 'status-line err';
      statusEl.textContent = 'No match found within Ahmedabad — try a more specific name, or use coordinates below.';
      return;
    }
    setOrigin(parseFloat(data[0].lat), parseFloat(data[0].lon), data[0].display_name.split(',').slice(0,3).join(','));
  }catch(err){
    statusEl.className = 'status-line err';
    statusEl.textContent = `Search failed: ${err.message || 'network/CORS error'}. Try clicking the map instead.`;
    console.error('Nominatim search error:', err);
  }
}

/* ============================================================
   LIVE LOCATION
   ============================================================ */
document.getElementById('liveLocBtn').addEventListener('click', ()=>{
  const statusEl = document.getElementById('searchStatus');
  if(!navigator.geolocation){
    statusEl.className = 'status-line err';
    statusEl.textContent = 'Geolocation not supported by this browser.';
    return;
  }
  statusEl.className = 'status-line active';
  statusEl.textContent = 'Getting your live location…';
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      setOrigin(pos.coords.latitude, pos.coords.longitude, 'Your live location');
      if(!isWithinAhmedabadArea(pos.coords.latitude, pos.coords.longitude)){
        statusEl.className = 'status-line active';
        statusEl.textContent += ' — outside Ahmedabad; results may be sparse.';
      }
    },
    (err)=>{
      statusEl.className = 'status-line err';
      statusEl.textContent = `Location failed: ${err.message}. Check browser permissions.`;
    },
    { enableHighAccuracy:true, timeout:10000 }
  );
});

/* ============================================================
   LAT/LON INPUT
   ============================================================ */
function setOriginFromLatLon(){
  const statusEl = document.getElementById('searchStatus');
  const latRaw = document.getElementById('latInput').value.trim();
  const lonRaw = document.getElementById('lonInput').value.trim();

  if(!latRaw || !lonRaw){
    statusEl.className = 'status-line err';
    statusEl.textContent = 'Enter both latitude and longitude.';
    return;
  }
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if(!Number.isFinite(lat) || !Number.isFinite(lon)){
    statusEl.className = 'status-line err';
    statusEl.textContent = 'Latitude and longitude must be numbers.';
    return;
  }
  if(lat < -90 || lat > 90){
    statusEl.className = 'status-line err';
    statusEl.textContent = 'Latitude must be between -90 and 90.';
    return;
  }
  if(lon < -180 || lon > 180){
    statusEl.className = 'status-line err';
    statusEl.textContent = 'Longitude must be between -180 and 180.';
    return;
  }
  hideSuggestions();
  setOrigin(lat, lon, null);
  if(!isWithinAhmedabadArea(lat, lon)){
    statusEl.className = 'status-line active';
    statusEl.textContent += ' — outside Ahmedabad; results may be sparse.';
  }
}

document.getElementById('latlonBtn').addEventListener('click', setOriginFromLatLon);
['latInput','lonInput'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') setOriginFromLatLon();
  });
});

/* ============================================================
   SEARCH MODE — radius vs nearest-N
   ============================================================ */
function setSearchMode(mode){
  searchMode = mode;
  document.getElementById('modeRadiusBtn').classList.toggle('active', mode==='radius');
  document.getElementById('modeNearestBtn').classList.toggle('active', mode==='nearest');
  document.getElementById('radiusModeBox').style.display = mode==='radius' ? '' : 'none';
  document.getElementById('nearestModeBox').style.display = mode==='nearest' ? '' : 'none';
  drawBuffer();
}
document.getElementById('modeRadiusBtn').addEventListener('click', ()=>setSearchMode('radius'));
document.getElementById('modeNearestBtn').addEventListener('click', ()=>setSearchMode('nearest'));

document.getElementById('nearestNSlider').addEventListener('input', (e)=>{
  document.getElementById('nearestNVal').textContent = e.target.value;
});

/* ============================================================
   RADIUS SLIDER
   ============================================================ */
document.getElementById('radiusSlider').addEventListener('input', (e)=>{
  document.getElementById('radiusVal').textContent = e.target.value;
  drawBuffer();
});


const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

// Remember whichever mirror last worked so we try it first next time,
// instead of always re-hammering the first (often busiest) mirror.
let stickyMirrorIndex = 0;

async function queryOverpassWithRetry(overpassQL, onStatus, perMirrorTimeoutMs = 18000){
  let lastErr = null;
  const order = [stickyMirrorIndex, ...OVERPASS_MIRRORS.map((_,i)=>i).filter(i=>i!==stickyMirrorIndex)];

  for(let attempt=0; attempt<order.length; attempt++){
    const i = order[attempt];
    const mirror = OVERPASS_MIRRORS[i];
    const host = mirror.replace('https://','').split('/')[0];
    onStatus(`Querying ${host}${attempt>0 ? ' (retry '+attempt+')' : ''}…`);
    try{
      const controller = new AbortController();
      const timeout = setTimeout(()=>controller.abort('timeout'), perMirrorTimeoutMs);
      const res = await fetch(mirror, {
        method:'POST',
        body:'data=' + encodeURIComponent(overpassQL),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if(res.status === 429 || res.status === 504){
        throw new Error(`${host} is overloaded (HTTP ${res.status})`);
      }
      if(!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
      const data = await res.json();
      stickyMirrorIndex = i;
      return data;
    }catch(err){
      lastErr = (err.name === 'AbortError')
        ? new Error(`${host} timed out (${Math.round(perMirrorTimeoutMs/1000)}s)`)
        : err;
      await new Promise(r=>setTimeout(r, 350));
    }
  }
  throw lastErr || new Error('All Overpass mirrors failed');
}

async function fetchBackendRadius(lat, lon, radiusM) {
  const subcats = encodeURIComponent([...activeSubcats].join(','));
  const url = `${BACKEND_BASE}/api/services/radius?lat=${lat}&lon=${lon}&radius=${radiusM}&subcats=${subcats}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backend HTTP ${res.status}`);
  const data = await res.json();
  return data.results;
}

async function fetchBackendNearest(lat, lon, limit) {
  const subcats = encodeURIComponent([...activeSubcats].join(','));
  const url = `${BACKEND_BASE}/api/services/nearest?lat=${lat}&lon=${lon}&limit=${limit}&subcats=${subcats}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backend HTTP ${res.status}`);
  const data = await res.json();
  return data.results;
}

// Converts one backend API row into the same shape appendResults()
// builds from Overpass elements, so every downstream function
// (markers, popups, tooltips, results list) works identically
// regardless of which data source produced the result.
function backendRowToResult(row) {
  const entry = SUBCAT_INDEX[row.subcategory];
  if (!entry) return null; // backend returned an unrecognized subcategory slug

  return {
    id: `backend-${row.id}`,
    lat: row.lat,
    lon: row.lon,
    name: row.name,
    cat: entry.cat,
    sub: entry.sub,
    dist: row.distance_m / 1000,
    address: row.address,
    phone: row.phone,
    website: row.website,
    hours: row.opening_hours,
    glyph: entry.sub.glyph,
    pinColor: shadeColor(entry.cat.color, entry.shade),
  };
}

/* ------------------------------------------------------------
   Category queries are run one at a time instead of bundled into
   one giant request. This matters because:
   - a single huge query (large radius × many categories) is far
     more likely to hit the ~25s server-side execution cap that
     public Overpass instances enforce, so it fails as an all-or-
     nothing unit even when the server is only moderately busy
   - per-category requests are small enough to usually succeed
     individually, and results can be shown as they arrive rather
     than waiting on the slowest category
   - if one category's queries fail everywhere, the rest of the
     survey still completes instead of the whole run erroring out
   ------------------------------------------------------------ */
async function runSurvey(){
  if(!originLatLng) return;
  const runStatus = document.getElementById('runStatus');
  const runBtn = document.getElementById('runBtn');
  const activeCategories = CATEGORIES.filter(cat=>cat.subcats.some(s=>activeSubcats.has(s.key)));

  if(activeCategories.length === 0){
    runStatus.className = 'status-line err';
    runStatus.textContent = 'Select at least one category or type first.';
    return;
  }

  runBtn.disabled = true;
  lastResults = [];
  drawMarkersAndList(); // clear previous run from map/list before starting

  if (dataSource === 'backend') {
    if (searchMode === 'nearest') {
      await runBackendNearestSurvey(runStatus);
    } else {
      await runBackendRadiusSurvey(runStatus);
    }
  } else {
    if(searchMode === 'nearest'){
      await runNearestNSurvey(activeCategories, runStatus);
    } else {
      await runRadiusSurvey(activeCategories, runStatus);
    }
  }

  runBtn.disabled = false;
}

async function runBackendRadiusSurvey(runStatus) {
  const km = parseFloat(document.getElementById('radiusSlider').value);
  const radiusM = Math.round(km * 1000);
  const { lat, lng } = originLatLng;

  runStatus.className = 'status-line active';
  runStatus.textContent = 'Querying our database…';

  try {
    const rows = await fetchBackendRadius(lat, lng, radiusM);
    lastResults = rows
      .map(backendRowToResult)
      .filter(r => r && activeSubcats.has(r.sub.key));
    lastResults.sort((a, b) => a.dist - b.dist);
  } catch (err) {
    console.error('Backend radius query failed:', err);
    runStatus.className = 'status-line err';
    runStatus.textContent = `Backend unreachable: ${err.message}. Is "npm run dev" running?`;
    return;
  }
  drawMarkersAndList();
}

async function runBackendNearestSurvey(runStatus) {
  const targetN = parseInt(document.getElementById('nearestNSlider').value, 10);
  const { lat, lng } = originLatLng;

  runStatus.className = 'status-line active';
  runStatus.textContent = 'Querying our database…';

  try {
    // The server now filters by subcategory, so ask for exactly N.
    const rows = await fetchBackendNearest(lat, lng, targetN);
    lastResults = rows
      .map(backendRowToResult)
      .filter(r => r && activeSubcats.has(r.sub.key))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, targetN);
  } catch (err) {
    console.error('Backend nearest query failed:', err);
    runStatus.className = 'status-line err';
    runStatus.textContent = `Backend unreachable: ${err.message}. Is "npm run dev" running?`;
    return;
  }
  drawMarkersAndList();
}

async function runOneCategory(cat, radiusM, onStatus, perMirrorTimeout){
  const {lat, lng} = originLatLng;
  const clauses = buildCategoryClauses(cat);
  const catQuery = clauses.map(q=>`${q}(around:${radiusM},${lat},${lng});`).join('');
  const overpassQL = `[out:json][timeout:20];(${catQuery});out center;`;
  const data = await queryOverpassWithRetry(overpassQL, onStatus, perMirrorTimeout);
  return data.elements || [];
}

async function runRadiusSurvey(activeCategories, runStatus){
  const km = parseFloat(document.getElementById('radiusSlider').value);
  const radiusM = Math.round(km*1000);
  const failedCats = [];
  const perMirrorTimeout = activeCategories.length > 2 ? 15000 : 20000;

  for(let ci=0; ci<activeCategories.length; ci++){
    const cat = activeCategories[ci];
    const progress = `[${ci+1}/${activeCategories.length}]`;
    try{
      const elements = await runOneCategory(cat, radiusM, (msg)=>{
        runStatus.className = 'status-line active';
        runStatus.textContent = `${progress} ${cat.label}: ${msg}`;
      }, perMirrorTimeout);
      appendResults(elements);
    }catch(err){
      failedCats.push(cat.label);
      console.error(`Overpass survey error (${cat.label}):`, err);
    }
  }

  drawMarkersAndList();

  if(failedCats.length){
    runStatus.className = lastResults.length ? 'status-line active' : 'status-line err';
    const base = lastResults.length ? `${lastResults.length} services found. ` : '';
    runStatus.textContent = `${base}Couldn't reach servers for: ${failedCats.join(', ')} — try again, or narrow the radius/categories.`;
  }
}

// Nearest-N: Overpass has no "give me the closest N" query, so this
// searches an expanding radius (doubling each round, capped) until at
// least N matches are collected across all active categories, then
// keeps only the closest N by distance. Each round re-queries the
// whole (larger) radius rather than just the new ring — simpler, and
// still cheap since rounds are few (max ~5 before hitting the cap).
const NEAREST_START_RADIUS_KM = 2;
const NEAREST_MAX_RADIUS_KM = 20;

async function runNearestNSurvey(activeCategories, runStatus){
  const targetN = parseInt(document.getElementById('nearestNSlider').value, 10);
  const perMirrorTimeout = activeCategories.length > 2 ? 15000 : 20000;
  const collected = new Map(); // element id -> element, merged across rounds
  const failedCats = new Set();
  let radiusKm = NEAREST_START_RADIUS_KM;

  while(true){
    const radiusM = Math.round(radiusKm*1000);

    for(let ci=0; ci<activeCategories.length; ci++){
      const cat = activeCategories[ci];
      try{
        const elements = await runOneCategory(cat, radiusM, (msg)=>{
          runStatus.className = 'status-line active';
          runStatus.textContent = `[radius ${radiusKm}km] ${cat.label}: ${msg}`;
        }, perMirrorTimeout);
        elements.forEach(el=>collected.set(el.id, el));
        failedCats.delete(cat.label);
      }catch(err){
        failedCats.add(cat.label);
        console.error(`Overpass nearest-N error (${cat.label}) @ ${radiusKm}km:`, err);
      }
    }

    lastResults = [];
    appendResults([...collected.values()]);

    if(lastResults.length >= targetN || radiusKm >= NEAREST_MAX_RADIUS_KM) break;
    radiusKm = Math.min(radiusKm*2, NEAREST_MAX_RADIUS_KM);
  }

  lastResults = lastResults.slice(0, targetN);
  drawMarkersAndList();

  if(failedCats.size){
    runStatus.className = lastResults.length ? 'status-line active' : 'status-line err';
    const base = lastResults.length ? `${lastResults.length} of ${targetN} nearest found. ` : '';
    runStatus.textContent = `${base}Couldn't reach servers for: ${[...failedCats].join(', ')}.`;
  } else if(lastResults.length < targetN){
    runStatus.className = 'status-line err';
    runStatus.textContent = `Only found ${lastResults.length} of ${targetN} within ${NEAREST_MAX_RADIUS_KM} km — try selecting more categories/types.`;
  }
}

// Adds Overpass elements into lastResults (does not clear or redraw —
// callers decide when to call drawMarkersAndList, so partial failures
// or multi-round nearest-N accumulation still render correctly).
function appendResults(elements){
  const seen = new Set(lastResults.map(r=>r.id));

  elements.forEach(el=>{
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if(lat==null || lon==null) return;
    const tags = el.tags || {};
    const entry = findSubcatEntry(tags);
    if(!entry) return;
    if(!activeSubcats.has(entry.sub.key)) return; // defensive: ignore anything outside the current filter
    if(seen.has(el.id)) return;
    seen.add(el.id);

    const distKm = turf.distance([originLatLng.lng, originLatLng.lat], [lon, lat], {units:'kilometers'});
    const name = tags.name || tags['name:en'] || `Unnamed ${entry.sub.label}`;
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city']]
      .filter(Boolean).join(', ') || null;

    lastResults.push({
      id: el.id, lat, lon, name, cat: entry.cat, sub: entry.sub,
      dist: distKm,
      address,
      phone: tags.phone || tags['contact:phone'] || null,
      website: tags.website || tags['contact:website'] || null,
      hours: tags.opening_hours || null,
      glyph: entry.sub.glyph,
      pinColor: shadeColor(entry.cat.color, entry.shade),
      tagType: entry.matchedTag.tagValue.replace(/_/g,' ')
    });
  });

  lastResults.sort((a,b)=>a.dist-b.dist);
}

function drawMarkersAndList(){
  clusterGroup.clearLayers();
  routeLayer.clearLayers();
  selectedRouteId = null;
  lastResults.forEach((item, idx)=>{
    // Presentational only: small capped stagger so markers feel like
    // they're being placed onto the map rather than appearing all at once.
    const entranceDelay = Math.min(idx * 22, 260);
    const icon = L.divIcon({
      className:'',
      html:`<div class="service-pin" style="background:${item.pinColor}; animation-delay:${entranceDelay}ms;"><span class="glyph">${item.glyph}</span></div>`,
      iconSize:[26,26], iconAnchor:[13,26]
    });
    const marker = L.marker([item.lat, item.lon], {icon});
    marker.bindPopup(buildPopupHTML(item));
    marker.bindTooltip(buildTooltipHTML(item), {
      permanent:false, direction:'top', offset:[0,-26],
      className:'service-tooltip', sticky:true, opacity:1
    });
    marker.on('click', ()=> selectRoute(item));
    item._marker = marker;
    clusterGroup.addLayer(marker);
  });

  renderResultsList();
  renderLegend();

  const runStatus = document.getElementById('runStatus');
  if(lastResults.length===0){
    runStatus.className = 'status-line err';
    runStatus.textContent = searchMode === 'nearest'
      ? `No services found within ${NEAREST_MAX_RADIUS_KM} km — try selecting more categories/types.`
      : 'No services found in this radius — try widening it.';
  } else {
    runStatus.className = 'status-line ok';
    runStatus.textContent = `${lastResults.length} services found.`;
  }

  drawGeneralRoutes();
}

/* ============================================================
   ROUTES — OSRM public demo server
   If OSRM itself can't be reached or returns no route (rate-limit,
   network hiccup, an unroutable point), we fall back to a plain
   straight-line "direct" indicator instead of just skipping —
   so every service always shows *something* from the input point.
   ============================================================ */
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving/';
const PER_CATEGORY_ROUTE_CAP = 6; // nearest N per category get an auto-drawn route

const BUCKET_COLOR = { route:'var(--signal)', direct:'#8a93a0' };

async function fetchRoute(item){
  if(routeCache.has(item.id)) return routeCache.get(item.id);
  const url = `${OSRM_BASE}${originLatLng.lng},${originLatLng.lat};${item.lon},${item.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if(!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  const route = data.routes && data.routes[0];
  if(!route) throw new Error('No route returned');
  const latlngs = route.geometry.coordinates.map(([lng,lat])=>[lat,lng]);
  const distanceKm = route.distance / 1000;
  const etaMin = Math.max(1, Math.round(route.duration / 60));
  const info = { latlngs, distanceKm, etaMin, bucket: 'route' };
  routeCache.set(item.id, info);
  return info;
}

// Straight-line fallback when OSRM has no real route available —
// keeps every service showing a path from the origin, just without
// a live route (labelled "direct" rather than faked).
function directLineFallback(item){
  const distanceKm = turf.distance([originLatLng.lng, originLatLng.lat], [item.lon, item.lat], {units:'kilometers'});
  return {
    latlngs: [[originLatLng.lat, originLatLng.lng], [item.lat, item.lon]],
    distanceKm, etaMin: null, bucket: 'direct'
  };
}

async function fetchRouteWithFallback(item){
  try{
    return await fetchRoute(item);
  }catch(err){
    console.warn(`Live route unavailable for ${item.name}, showing direct line:`, err.message);
    const fallback = directLineFallback(item);
    routeCache.set(item.id, fallback);
    return fallback;
  }
}

// Draw a route for every service (grouped so the nearest few per
// *category* get one, not just the nearest few overall — otherwise
// one dense category like hospitals crowds out every other category).
async function drawGeneralRoutes(){
  if(!originLatLng || lastResults.length===0) return;

  const byCat = new Map();
  lastResults.forEach(item=>{
    if(!byCat.has(item.cat.id)) byCat.set(item.cat.id, []);
    byCat.get(item.cat.id).push(item);
  });

  const subset = [];
  byCat.forEach(items=>{
    items.slice(0, PER_CATEGORY_ROUTE_CAP).forEach(i=>subset.push(i));
  });

  for(const item of subset){
    const route = await fetchRouteWithFallback(item);
    item._route = route;
    const isDirect = route.bucket === 'direct';
    const line = L.polyline(route.latlngs, {
      color: BUCKET_COLOR[route.bucket], weight:2.5, opacity:0.35,
      dashArray: isDirect ? '5,6' : null
    });
    line._itemId = item.id;
    line.on('click', ()=> selectRoute(item));
    routeLayer.addLayer(line);
    if(item._marker){
      item._marker.setTooltipContent(buildTooltipHTML(item));
      item._marker.setPopupContent(buildPopupHTML(item));
    }
    updateResultCardRoute(item);
    await new Promise(r=>setTimeout(r, 100)); // be gentle with the free demo server
  }
}

// Highlight one route: thicken/brighten the selected one, dim the rest.
async function selectRoute(item){
  selectedRouteId = item.id;
  if(!item._route){
    item._route = await fetchRouteWithFallback(item);
  }

  routeLayer.eachLayer(line=>{
    const isSelected = line._itemId === item.id;
    line.setStyle({ weight: isSelected ? 5 : 2, opacity: isSelected ? 0.9 : 0.15 });
    if(isSelected) line.bringToFront();
  });

  // this item's route may not have had a layer yet (outside the per-category cap)
  if(!routeLayer.getLayers().some(l=>l._itemId===item.id)){
    const isDirect = item._route.bucket === 'direct';
    const line = L.polyline(item._route.latlngs, {
      color: BUCKET_COLOR[item._route.bucket], weight:5, opacity:0.9,
      dashArray: isDirect ? '5,6' : null
    });
    line._itemId = item.id;
    line.on('click', ()=> selectRoute(item));
    routeLayer.addLayer(line);
  }

  if(item._marker){
    item._marker.setTooltipContent(buildTooltipHTML(item));
    item._marker.setPopupContent(buildPopupHTML(item));
  }
  updateResultCardRoute(item);

  const bounds = L.latLngBounds([[originLatLng.lat, originLatLng.lng], ...item._route.latlngs]);
  map.fitBounds(bounds, { padding:[60,60] });
}

function updateResultCardRoute(item){
  if(!item._cardEl || !item._route) return;
  const r = item._route;
  const el = item._cardEl.querySelector('.result-route');
  if(el){
    el.innerHTML = `${TRAFFIC_LABEL[r.bucket]} ${r.distanceKm.toFixed(1)} km${r.etaMin!=null ? ` · ~${r.etaMin} min` : ''}`;
    // Presentational only: restart the fade-in now that real route info
    // has arrived (the element already existed as an empty placeholder).
    el.classList.remove('route-pop');
    void el.offsetWidth;
    el.classList.add('route-pop');
  }
}

const TRAFFIC_LABEL = { route:'', direct:'Direct line (no live route) ·' };

function routeSnippetHTML(item, cls){
  if(!item._route) return '';
  const r = item._route;
  const label = TRAFFIC_LABEL[r.bucket];
  return `<div class="${cls}">${label ? label + ' ' : ''}${r.distanceKm.toFixed(1)} km${r.etaMin!=null ? ` · ~${r.etaMin} min drive` : ''}</div>`;
}

function buildTooltipHTML(item){
  return `
    <div class="tt-name">${escapeHtml(item.name)}</div>
    <div class="tt-row"><span class="tt-tag" style="color:${item.pinColor}">${escapeHtml(item.cat.label)}</span> · ${item.dist.toFixed(2)} km</div>
    ${item.hours ? `<div class="tt-hours">${escapeHtml(item.hours)}</div>` : ''}
    ${item.address ? `<div class="tt-row tt-addr">${escapeHtml(item.address)}</div>` : ''}
  `;
}

function renderLegend(){
  const el = document.getElementById('mapLegend');
  if(!el) return;
  const counts = {};
  lastResults.forEach(r=>{ counts[r.cat.id] = (counts[r.cat.id]||0) + 1; });
  const present = CATEGORIES.filter(c=>counts[c.id]);
  if(!present.length){ el.innerHTML=''; el.style.display='none'; return; }
  el.style.display='flex';
  el.innerHTML = present.map(c=>`
    <div class="legend-item">
      <span class="legend-dot" style="background:${c.color}"></span>
      ${escapeHtml(c.label)} <span class="legend-count">${counts[c.id]}</span>
    </div>
  `).join('') + `
    <div class="legend-item legend-route-key">
      <span class="legend-line" style="background:var(--signal)"></span>Route
      <span class="legend-line" style="background:#8a93a0;border-top:1px dashed #8a93a0"></span>Direct (no route)
    </div>`;
}

function buildPopupHTML(item){
  return `
    <div class="popup-name">${escapeHtml(item.name)}</div>
    <div class="popup-row"><b>Type</b> ${escapeHtml(item.cat.label)} — ${escapeHtml(item.sub.label)}</div>
    <div class="popup-row"><b>Distance</b> ${item.dist.toFixed(2)} km</div>
    ${routeSnippetHTML(item, 'popup-row')}
    ${item.address ? `<div class="popup-row"><b>Address</b> ${escapeHtml(item.address)}</div>` : ''}
    ${item.phone ? `<div class="popup-row"><b>Phone</b> ${escapeHtml(item.phone)}</div>` : ''}
    ${item.website ? `<div class="popup-row"><b>Web</b> ${escapeHtml(item.website)}</div>` : ''}
    ${item.hours ? `<div class="popup-row"><b>Hours</b> ${escapeHtml(item.hours)}</div>` : ''}
    ${item.sub.budget ? `<div class="popup-row"><b>Budget</b> <span class="na-tag">Not available (OSM)</span></div>` : ''}
    <div class="popup-row"><b>Coords</b> ${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}</div>
  `;
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ============================================================
   RESULTS LIST
   ============================================================ */
function renderResultsList(){
  const list = document.getElementById('resultsList');
  const countEl = document.getElementById('resultsCount');
  list.innerHTML = '';

  if(lastResults.length===0){
    countEl.textContent = '';
    list.innerHTML = `<div class="empty-state"><div class="glyph">∅</div>No services matched.<br>Try a wider search or more categories/types.</div>`;
    return;
  }

  countEl.textContent = `${lastResults.length} found`;

  lastResults.forEach((item, idx)=>{
    const card = document.createElement('div');
    card.className = 'result-card';
    // Presentational only: small capped stagger for the entrance animation.
    card.style.animationDelay = `${Math.min(idx * 28, 320)}ms`;
    card.innerHTML = `
      <div class="result-name">${escapeHtml(item.name)}</div>
      <div class="result-meta">
        <span class="tag">${escapeHtml(item.sub.label)}</span>
        <span class="dist">${item.dist.toFixed(2)} km</span>
      </div>
      ${item.sub.budget ? `<div class="result-budget">Budget: <span class="na-tag">Not available</span></div>` : ''}
      <div class="result-route">${item._route ? '' : 'Route: —'}</div>
    `;
    item._cardEl = card;
    if(item._route) updateResultCardRoute(item);
    card.addEventListener('click', ()=>{
      if(selectedCardEl) selectedCardEl.classList.remove('selected');
      card.classList.add('selected');
      selectedCardEl = card;
      item._marker.openPopup();
      selectRoute(item);
      if(window.innerWidth<=820) document.getElementById('sidebar').classList.remove('open');
    });
    list.appendChild(card);
  });
}

/* ============================================================
   EVENTS
   ============================================================ */
document.getElementById('searchBtn').addEventListener('click', ()=>{ hideSuggestions(); doSearch(); });
document.getElementById('runBtn').addEventListener('click', runSurvey);

document.getElementById('enterAppBtn').addEventListener('click', ()=>{
  const intro = document.getElementById('introScreen');
  intro.classList.add('intro-hide');
  setTimeout(()=>{
    intro.style.display = 'none';
    if(map) map.invalidateSize(); // map sized while hidden behind the intro; re-check its dimensions
  }, 500);
});

/* ============================================================
   INIT
   ============================================================ */
initMap();
buildChips();

/* ============================================================
   DATA SOURCE SELECTION
   ============================================================ */
const sourceOverpassBtn = document.getElementById('sourceOverpassBtn');
const sourceBackendBtn = document.getElementById('sourceBackendBtn');
const dataSourceStatus = document.getElementById('dataSourceStatus');

function setDataSource(source) {
  dataSource = source;
  sourceOverpassBtn.classList.toggle('active', source === 'overpass');
  sourceBackendBtn.classList.toggle('active', source === 'backend');
}

sourceOverpassBtn.addEventListener('click', () => {
  setDataSource('overpass');
  dataSourceStatus.className = 'status-line';
  dataSourceStatus.textContent = '';
});

sourceBackendBtn.addEventListener('click', async () => {
  setDataSource('backend');
  dataSourceStatus.className = 'status-line active';
  dataSourceStatus.textContent = 'Checking database connection…';

  try {
    const res = await fetch('http://localhost:4000/api/categories');
    if (!res.ok) throw new Error(`Server responded with status ${res.status}`);
    const data = await res.json();
    dataSourceStatus.className = 'status-line ok';
    dataSourceStatus.textContent = `Connected: ${data.categories.length} categories available.`;
  } catch (err) {
    dataSourceStatus.className = 'status-line err';
    dataSourceStatus.textContent = `Database unavailable: ${err.message}. Is "node server.js" running?`;
  }
});