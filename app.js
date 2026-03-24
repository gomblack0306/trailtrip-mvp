const defaultRoute = window.TRAILTRIP_ROUTE;
let activeRoute = structuredClone(window.TRAILTRIP_ROUTE);

const STORAGE_KEY = 'trailtrip-hagwi-v7-draft';
const SESSION_VERSION = 7;
const TRACK_PAN_INTERVAL_MS = 2500;

const syncState = { inFlight: false, pending: false, lastSyncedAt: null, lastError: null };
const config = window.TRAILTRIP_CONFIG || { kakaoJavascriptKey: '', supabaseUrl: '', supabaseAnonKey: '' };
const supabaseClient = (config.supabaseUrl && config.supabaseAnonKey && window.supabase)
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

let map = null;
let routePolyline = null;
let walkedPathPolyline = null;
let accuracyCircle = null;
let currentLocationMarker = null;
let checkpointMarkers = [];
let spotMarkers = [];
let infoWindows = [];
let mapReady = false;
let pendingOps = [];
let lastPanAt = 0;
let isTracking = false;
let routeBounds = null;

let startedAt = null;
let endedAt = null;
let watchId = null;
let path = [];
let totalDistanceMeters = 0;
let latestSpeedKmh = 0;
let timerId = null;
let latestPosition = null;
let selectedSpotCoords = null;
let selectedPhotoDataUrl = '';
let spotRecords = [];
let sessionId = crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}`;

const checkpointList = document.getElementById('checkpointList');
const startBtn = document.getElementById('startBtn');
const gpsStatus = document.getElementById('gpsStatus');
const saveStatusBadge = document.getElementById('saveStatusBadge');
const distanceValue = document.getElementById('distanceValue');
const timeValue = document.getElementById('timeValue');
const speedValue = document.getElementById('speedValue');
const progressValue = document.getElementById('progressValue');
const plannedDistance = document.getElementById('plannedDistance');
const downloadLogBtn = document.getElementById('downloadLogBtn');
const exportGpxBtn = document.getElementById('exportGpxBtn');
const gpxFileInput = document.getElementById('gpxFileInput');
const resetRouteBtn = document.getElementById('resetRouteBtn');
const routeSourceBadge = document.getElementById('routeSourceBadge');
const fieldNotes = document.getElementById('fieldNotes');
const spotCategory = document.getElementById('spotCategory');
const spotTitle = document.getElementById('spotTitle');
const spotDescription = document.getElementById('spotDescription');
const spotPhotoInput = document.getElementById('spotPhotoInput');
const spotPhotoPreview = document.getElementById('spotPhotoPreview');
const useCurrentLocationBtn = document.getElementById('useCurrentLocationBtn');
const addSpotBtn = document.getElementById('addSpotBtn');
const spotCoordsPreview = document.getElementById('spotCoordsPreview');
const spotRecordList = document.getElementById('spotRecordList');
const spotCountBadge = document.getElementById('spotCountBadge');
const scrollToMapBtn = document.getElementById('scrollToMapBtn');
const syncNowBtn = document.getElementById('syncNowBtn');
const newSessionBtn = document.getElementById('newSessionBtn');
const centerMapBtn = document.getElementById('centerMapBtn');
const mapNotice = document.getElementById('mapNotice');

const tabButtons = [...document.querySelectorAll('.tab-btn')];
const tabPanels = [...document.querySelectorAll('.tab-panel')];

function switchTab(tabName) {
  tabButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === tabName));
  tabPanels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === tabName));
}

tabButtons.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

function setSaveStatus(text, tone = 'soft') {
  saveStatusBadge.textContent = text;
  saveStatusBadge.className = 'badge';
  if (tone === 'soft') saveStatusBadge.classList.add('badge-soft');
  if (tone === 'ok') saveStatusBadge.classList.add('badge-ok');
  if (tone === 'warn') saveStatusBadge.classList.add('badge-warn');
}

function setMapNotice(text = '', tone = 'warn') {
  if (!text) {
    mapNotice.classList.add('hidden');
    mapNotice.textContent = '';
    return;
  }
  mapNotice.classList.remove('hidden');
  mapNotice.textContent = text;
  mapNotice.dataset.tone = tone;
}

function formatDuration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polylineDistanceKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total / 1000;
}

function updateTimer() {
  if (!startedAt) {
    timeValue.textContent = '00:00:00';
    return;
  }
  const end = endedAt || Date.now();
  timeValue.textContent = formatDuration(end - startedAt);
}

function updateStats() {
  distanceValue.textContent = `${(totalDistanceMeters / 1000).toFixed(2)} km`;
  speedValue.textContent = `${latestSpeedKmh.toFixed(1)} km/h`;
  const plannedMeters = (activeRoute.meta.distanceKm || 0) * 1000;
  const ratio = plannedMeters > 0 ? Math.min(100, Math.round((totalDistanceMeters / plannedMeters) * 100)) : 0;
  progressValue.textContent = `${ratio}%`;
  plannedDistance.textContent = `약 ${Number(activeRoute.meta.distanceKm || 0).toFixed(1)} km`;
}

function updateSelectedCoordsPreview() {
  if (!selectedSpotCoords) {
    spotCoordsPreview.textContent = '아직 현재 위치가 없습니다.';
    return;
  }
  spotCoordsPreview.textContent = `위도 ${selectedSpotCoords.lat.toFixed(6)} / 경도 ${selectedSpotCoords.lng.toFixed(6)}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clearSpotForm() {
  spotTitle.value = '';
  spotDescription.value = '';
  spotPhotoInput.value = '';
  selectedPhotoDataUrl = '';
  spotPhotoPreview.className = 'spot-photo-preview empty';
  spotPhotoPreview.textContent = '선택한 사진 미리보기가 여기에 표시됩니다.';
}

function payloadForExport() {
  return {
    version: SESSION_VERSION,
    sessionId,
    routeMeta: activeRoute.meta,
    routePolyline: activeRoute.polyline,
    routeCheckpoints: activeRoute.checkpoints,
    routeSourceLabel: routeSourceBadge.textContent,
    startedAt,
    endedAt,
    totalDistanceMeters,
    latestSpeedKmh,
    path,
    spotRecords,
    fieldNotes: fieldNotes.value,
    exportedAt: new Date().toISOString()
  };
}

function persistDraft(reason = '저장됨', scheduleServerSync = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payloadForExport()));
  setSaveStatus(reason, 'soft');
  if (scheduleServerSync) scheduleSync();
}

function queueMapOp(fn) {
  if (mapReady) fn();
  else pendingOps.push(fn);
}

function latLng(lat, lng) {
  return new kakao.maps.LatLng(lat, lng);
}

function ensureBoundsFromRoute() {
  if (!window.kakao || !activeRoute?.polyline?.length) return null;
  const bounds = new kakao.maps.LatLngBounds();
  activeRoute.polyline.forEach(([lat, lng]) => bounds.extend(latLng(lat, lng)));
  routeBounds = bounds;
  return bounds;
}

function drawRoutePolyline() {
  if (!map) return;
  if (routePolyline) routePolyline.setMap(null);
  const pathLatLng = activeRoute.polyline.map(([lat, lng]) => latLng(lat, lng));
  routePolyline = new kakao.maps.Polyline({
    path: pathLatLng,
    strokeWeight: 6,
    strokeColor: '#0f766e',
    strokeOpacity: 0.92,
    strokeStyle: 'solid'
  });
  routePolyline.setMap(map);
  const bounds = ensureBoundsFromRoute();
  if (bounds) map.setBounds(bounds, 40, 40, 40, 40);
}

function openInfoWindow(marker, html) {
  const info = new kakao.maps.InfoWindow({ content: `<div style="padding:10px 12px; max-width:220px; font-size:13px; line-height:1.45;">${html}</div>` });
  infoWindows.push(info);
  kakao.maps.event.addListener(marker, 'click', () => {
    infoWindows.forEach((iw) => iw.close());
    info.open(map, marker);
  });
}

function renderCheckpoints(route) {
  checkpointList.innerHTML = '';
  queueMapOp(() => {
    checkpointMarkers.forEach((marker) => marker.setMap(null));
    checkpointMarkers = [];

    route.checkpoints.forEach((checkpoint, index) => {
      const card = document.createElement('article');
      card.className = 'checkpoint-item';
      card.innerHTML = `
        <h3>${escapeHtml(checkpoint.name)} · ${checkpoint.km}km</h3>
        <p class="muted">${escapeHtml(checkpoint.prompt || '')}</p>
        <div>${(checkpoint.facilities || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('')}</div>
      `;
      checkpointList.appendChild(card);

      const marker = new kakao.maps.Marker({
        position: latLng(checkpoint.lat, checkpoint.lng),
        title: checkpoint.name,
        clickable: true
      });
      marker.setMap(map);
      openInfoWindow(marker, `<strong>${escapeHtml(checkpoint.name)}</strong><br>${checkpoint.km}km<br>${escapeHtml(checkpoint.prompt || '')}`);
      checkpointMarkers.push(marker);
    });
  });
}

function renderRoute(route, sourceLabel = '기본 데모 경로') {
  activeRoute = structuredClone(route);
  plannedDistance.textContent = `약 ${Number(route.meta.distanceKm || 0).toFixed(1)} km`;
  routeSourceBadge.textContent = sourceLabel;
  renderCheckpoints(route);
  queueMapOp(() => drawRoutePolyline());
  updateStats();
}

function smoothPanTo(point, force = false) {
  if (!map || !point) return;
  const now = Date.now();
  if (force || now - lastPanAt > TRACK_PAN_INTERVAL_MS) {
    map.panTo(latLng(point.lat, point.lng));
    lastPanAt = now;
  }
}

function updateCurrentMarker(point, accuracy = 0) {
  queueMapOp(() => {
    if (!currentLocationMarker) {
      currentLocationMarker = new kakao.maps.Marker({ position: latLng(point.lat, point.lng), title: '현재 위치', image: markerImage('current'), zIndex: 9 });
      currentLocationMarker.setMap(map);
    } else {
      currentLocationMarker.setPosition(latLng(point.lat, point.lng));
    }

    if (!accuracyCircle) {
      accuracyCircle = new kakao.maps.Circle({
        center: latLng(point.lat, point.lng),
        radius: Math.max(8, Math.round(accuracy || 0)),
        strokeWeight: 1,
        strokeColor: '#2563eb',
        strokeOpacity: 0.4,
        strokeStyle: 'solid',
        fillColor: '#93c5fd',
        fillOpacity: 0.14
      });
      accuracyCircle.setMap(map);
    } else {
      accuracyCircle.setPosition(latLng(point.lat, point.lng));
      accuracyCircle.setRadius(Math.max(8, Math.round(accuracy || 0)));
    }
  });
}

function redrawWalkedPath() {
  queueMapOp(() => {
    if (walkedPathPolyline) walkedPathPolyline.setMap(null);
    if (path.length < 2) {
      walkedPathPolyline = null;
      return;
    }
    walkedPathPolyline = new kakao.maps.Polyline({
      path: path.map((p) => latLng(p.lat, p.lng)),
      strokeWeight: 5,
      strokeColor: '#2563eb',
      strokeOpacity: 0.92,
      strokeStyle: 'shortdash'
    });
    walkedPathPolyline.setMap(map);
  });
}

function renderSpotRecords() {
  queueMapOp(() => {
    spotMarkers.forEach((marker) => marker.setMap(null));
    spotMarkers = [];
  });

  spotCountBadge.textContent = `${spotRecords.length}개`;
  if (spotRecords.length === 0) {
    spotRecordList.className = 'spot-record-list empty-list';
    spotRecordList.textContent = '아직 기록된 포인트가 없습니다.';
    return;
  }

  spotRecordList.className = 'spot-record-list';
  spotRecordList.innerHTML = '';

  spotRecords.forEach((record) => {
    const card = document.createElement('article');
    card.className = 'spot-record-item';
    card.innerHTML = `
      <div class="spot-record-top">
        <div>
          <span class="tag tag-accent">${escapeHtml(record.category)}</span>
          <h4>${escapeHtml(record.title)}</h4>
        </div>
        <button class="danger-btn" data-record-id="${record.id}" type="button">삭제</button>
      </div>
      <p class="spot-record-desc">${escapeHtml(record.description || '')}</p>
      <p class="spot-record-meta">${new Date(record.createdAt).toLocaleString('ko-KR')} · 위도 ${record.lat.toFixed(6)} / 경도 ${record.lng.toFixed(6)}</p>
      ${record.photoDataUrl ? `<img class="spot-record-image" src="${record.photoDataUrl}" alt="${escapeHtml(record.title)}" />` : ''}
    `;
    spotRecordList.appendChild(card);

    queueMapOp(() => {
      const marker = new kakao.maps.Marker({
        position: latLng(record.lat, record.lng),
        title: record.title,
        clickable: true
      });
      marker.setMap(map);
      openInfoWindow(marker, `<strong>${escapeHtml(record.title)}</strong><br>${escapeHtml(record.category)}<br>${escapeHtml(record.description || '')}`);
      spotMarkers.push(marker);
    });
  });
}

function restoreDraft() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    setSaveStatus(supabaseClient ? '로컬 저장 중' : '로컬 자동저장', 'soft');
    return;
  }
  try {
    const saved = JSON.parse(raw);
    sessionId = saved.sessionId || sessionId;
    startedAt = saved.startedAt || null;
    endedAt = saved.endedAt || null;
    totalDistanceMeters = Number(saved.totalDistanceMeters || 0);
    latestSpeedKmh = Number(saved.latestSpeedKmh || 0);
    path = Array.isArray(saved.path) ? saved.path : [];
    spotRecords = Array.isArray(saved.spotRecords) ? saved.spotRecords : [];
    fieldNotes.value = saved.fieldNotes || '';
    if (saved.routeMeta && Array.isArray(saved.routePolyline) && saved.routePolyline.length >= 2) {
      activeRoute = {
        meta: saved.routeMeta,
        checkpoints: Array.isArray(saved.routeCheckpoints) ? saved.routeCheckpoints : defaultRoute.checkpoints,
        polyline: saved.routePolyline
      };
      routeSourceBadge.textContent = saved.routeSourceLabel || '복원된 경로';
    }

    if (path.length > 0) {
      latestPosition = path[path.length - 1];
      selectedSpotCoords = { lat: latestPosition.lat, lng: latestPosition.lng };
      updateCurrentMarker(latestPosition, latestPosition.accuracy || 0);
      redrawWalkedPath();
      smoothPanTo(latestPosition, true);
      gpsStatus.textContent = '이전 기록 복원';
    }

    renderRoute(activeRoute, saved.routeSourceLabel || '복원된 경로');
    renderSpotRecords();
    updateSelectedCoordsPreview();
    updateStats();
    updateTimer();
    if (startedAt && !endedAt) startBtn.textContent = '로그 재개';
    setSaveStatus('이전 기록 복원', 'ok');
  } catch (error) {
    console.error(error);
    setSaveStatus('복원 실패', 'warn');
  }
}

function clearCurrentSession() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (timerId) clearInterval(timerId);
  timerId = null;
  isTracking = false;
  startedAt = null;
  endedAt = null;
  totalDistanceMeters = 0;
  latestSpeedKmh = 0;
  latestPosition = null;
  selectedSpotCoords = null;
  path = [];
  spotRecords = [];
  fieldNotes.value = '';
  sessionId = crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}`;

  queueMapOp(() => {
    if (walkedPathPolyline) walkedPathPolyline.setMap(null);
    walkedPathPolyline = null;
    if (currentLocationMarker) currentLocationMarker.setMap(null);
    currentLocationMarker = null;
    if (accuracyCircle) accuracyCircle.setMap(null);
    accuracyCircle = null;
  });

  clearSpotForm();
  renderSpotRecords();
  updateSelectedCoordsPreview();
  updateStats();
  timeValue.textContent = '00:00:00';
  startBtn.textContent = '로그 시작';
  gpsStatus.textContent = '대기 중';
  localStorage.removeItem(STORAGE_KEY);
  renderRoute(structuredClone(defaultRoute), '기본 데모 경로');
  setSaveStatus(supabaseClient ? '새 기록 준비' : '로컬 자동저장', 'soft');
}

async function syncToServer() {
  if (!supabaseClient) {
    setSaveStatus('서버 미연결', 'warn');
    return false;
  }
  if (syncState.inFlight) {
    syncState.pending = true;
    return false;
  }

  syncState.inFlight = true;
  setSaveStatus('서버 동기화 중', 'soft');
  try {
    const payload = payloadForExport();
    const { error } = await supabaseClient.from('walk_sessions').upsert({
      id: payload.sessionId,
      route_name: payload.routeMeta?.name || '',
      route_meta: payload.routeMeta || {},
      route_source_label: payload.routeSourceLabel || '',
      started_at: payload.startedAt ? new Date(payload.startedAt).toISOString() : null,
      ended_at: payload.endedAt ? new Date(payload.endedAt).toISOString() : null,
      total_distance_meters: payload.totalDistanceMeters,
      latest_speed_kmh: payload.latestSpeedKmh,
      field_notes: payload.fieldNotes || '',
      path: payload.path || [],
      spot_records: payload.spotRecords || [],
      source: 'trailtrip-web',
      updated_at: new Date().toISOString()
    });
    if (error) throw error;

    syncState.lastSyncedAt = new Date().toISOString();
    syncState.lastError = null;
    setSaveStatus('서버 저장됨', 'ok');
    return true;
  } catch (error) {
    console.error(error);
    syncState.lastError = error;
    setSaveStatus('로컬만 저장됨', 'warn');
    return false;
  } finally {
    syncState.inFlight = false;
    if (syncState.pending) {
      syncState.pending = false;
      setTimeout(() => syncToServer(), 300);
    }
  }
}

let syncDebounce = null;
function scheduleSync() {
  if (!supabaseClient) return;
  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(() => syncToServer(), 2000);
}

function onPosition(position) {
  const { latitude, longitude, speed, accuracy } = position.coords;
  gpsStatus.textContent = `GPS 수신 (${Math.round(accuracy)}m)`;
  const point = { lat: latitude, lng: longitude, ts: position.timestamp, accuracy: accuracy || 0 };
  latestPosition = point;

  if (!selectedSpotCoords) {
    selectedSpotCoords = { lat: latitude, lng: longitude };
    updateSelectedCoordsPreview();
  }

  if (path.length > 0) {
    const prev = path[path.length - 1];
    const segment = haversineMeters(prev.lat, prev.lng, point.lat, point.lng);
    if (segment >= 3 && segment <= 120) totalDistanceMeters += segment;
  }
  path.push(point);

  if (typeof speed === 'number' && !Number.isNaN(speed) && speed >= 0) {
    latestSpeedKmh = speed * 3.6;
  } else if (path.length >= 2) {
    const prev = path[path.length - 2];
    const dt = Math.max(1, (point.ts - prev.ts) / 1000);
    const segment = haversineMeters(prev.lat, prev.lng, point.lat, point.lng);
    latestSpeedKmh = (segment / dt) * 3.6;
  }

  updateCurrentMarker(point, accuracy);
  redrawWalkedPath();
  smoothPanTo(point);
  updateStats();
  persistDraft('자동저장됨');
}

function onPositionError(error) {
  gpsStatus.textContent = `GPS 오류: ${error.message}`;
  persistDraft('오류 후 저장됨', false);
}

function startTracking() {
  if (!navigator.geolocation) {
    alert('이 브라우저는 위치 추적을 지원하지 않습니다.');
    return;
  }
  if (!mapReady) {
    alert('지도가 아직 준비되지 않았습니다. 카카오맵 로딩을 먼저 확인해 주세요.');
    return;
  }
  if (!startedAt || endedAt) {
    startedAt = Date.now();
    endedAt = null;
    totalDistanceMeters = 0;
    latestSpeedKmh = 0;
    path = [];
    queueMapOp(() => {
      if (walkedPathPolyline) walkedPathPolyline.setMap(null);
      walkedPathPolyline = null;
    });
  }

  updateStats();
  updateTimer();
  if (timerId) clearInterval(timerId);
  timerId = setInterval(updateTimer, 1000);

  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 3000,
    timeout: 10000
  });

  isTracking = true;
  startBtn.textContent = '로그 중지';
  gpsStatus.textContent = 'GPS 연결 중';
  persistDraft('기록 시작됨');
}

function stopTracking() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (timerId) clearInterval(timerId);
  timerId = null;
  endedAt = Date.now();
  isTracking = false;
  startBtn.textContent = '로그 재개';
  gpsStatus.textContent = '중지됨';
  persistDraft('중지 후 저장됨');
}

function parseGpx(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');
  const parserError = xml.querySelector('parsererror');
  if (parserError) throw new Error('GPX 파일 파싱에 실패했습니다.');

  const trkpts = [...xml.querySelectorAll('trkpt')];
  const rtepts = [...xml.querySelectorAll('rtept')];
  const pts = (trkpts.length ? trkpts : rtepts).map((node) => [
    Number(node.getAttribute('lat')),
    Number(node.getAttribute('lon'))
  ]).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));

  if (pts.length < 2) throw new Error('GPX 안에 경로 좌표가 부족합니다.');

  const nameNode = xml.querySelector('trk > name, rte > name');
  const name = nameNode?.textContent?.trim() || '업로드한 GPX 경로';
  const distanceKm = polylineDistanceKm(pts);
  const checkpointIndexes = [0, Math.floor(pts.length * 0.25), Math.floor(pts.length * 0.5), Math.floor(pts.length * 0.75), pts.length - 1]
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort((a, b) => a - b);

  const checkpoints = checkpointIndexes.map((idx, order) => ({
    name: order === 0 ? '출발' : order === checkpointIndexes.length - 1 ? '도착' : `체크포인트 ${order}`,
    km: Number((distanceKm * (idx / (pts.length - 1))).toFixed(1)),
    lat: pts[idx][0],
    lng: pts[idx][1],
    facilities: order === 0 ? ['현장 확인 필요'] : [],
    prompt: order === 0 ? '실제 답사 기록을 시작해보세요.' : '현장 메모를 남겨보세요.'
  }));

  return {
    meta: { name, distanceKm, durationHours: Number((distanceKm / 3.8).toFixed(1)), note: '사용자가 업로드한 GPX 경로' },
    checkpoints,
    polyline: pts
  };
}

function buildGpxFromPath(points, trackName) {
  const safeName = trackName || 'TrailTrip Walk Log';
  const trkpts = points.map((p) => `    <trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.ts).toISOString()}</time></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TrailTrip MVP" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${safeName}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>`;
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function loadKakaoMapSdk() {
  return new Promise((resolve, reject) => {
    if (window.kakao?.maps) {
      resolve();
      return;
    }

    if (!config.kakaoJavascriptKey) {
      reject(new Error('config.js에 kakaoJavascriptKey를 입력해야 합니다.'));
      return;
    }

    const existing = document.querySelector('script[data-kakao-sdk="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('카카오맵 SDK 로딩 실패')));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.kakaoJavascriptKey)}&autoload=false`;
    script.async = true;
    script.dataset.kakaoSdk = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('카카오맵 SDK 로딩 실패'));
    document.head.appendChild(script);
  });
}

async function bootMap() {
  try {
    await loadKakaoMapSdk();
    kakao.maps.load(() => {
      const first = activeRoute.polyline[0] || [33.4867, 126.3978];
      map = new kakao.maps.Map(document.getElementById('map'), {
        center: latLng(first[0], first[1]),
        level: 8
      });
      mapReady = true;
      setMapNotice('');
      renderRoute(activeRoute, routeSourceBadge.textContent || '기본 데모 경로');
      pendingOps.forEach((fn) => fn());
      pendingOps = [];
      restoreDraft();
    });
  } catch (error) {
    console.error(error);
    gpsStatus.textContent = '지도 로딩 실패';
    setMapNotice(error.message || '카카오맵 로딩에 실패했습니다. JavaScript 키와 등록 도메인을 다시 확인해 주세요.');
  }
}

startBtn.addEventListener('click', () => {
  if (watchId) stopTracking();
  else startTracking();
});

downloadLogBtn.addEventListener('click', () => {
  downloadTextFile('trailtrip-hagwi-hyeopjae-log.json', JSON.stringify(payloadForExport(), null, 2), 'application/json');
  persistDraft('JSON 저장 완료', false);
});

exportGpxBtn.addEventListener('click', () => {
  if (path.length < 2) {
    alert('GPX로 저장하려면 먼저 실제로 조금 걸어서 GPS 로그를 쌓아야 합니다.');
    return;
  }
  const gpx = buildGpxFromPath(path, activeRoute.meta.name);
  downloadTextFile('trailtrip-walk-log.gpx', gpx, 'application/gpx+xml');
  persistDraft('GPX 저장 완료', false);
});

gpxFileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  try {
    const text = await file.text();
    const uploadedRoute = parseGpx(text);
    renderRoute(uploadedRoute, `업로드 경로: ${file.name}`);
    persistDraft('GPX 경로 반영됨');
    alert(`GPX 업로드 완료: ${uploadedRoute.meta.name} / ${uploadedRoute.meta.distanceKm.toFixed(1)}km`);
  } catch (error) {
    alert(error.message || 'GPX 업로드에 실패했습니다.');
  }
});

resetRouteBtn.addEventListener('click', () => {
  renderRoute(structuredClone(defaultRoute), '기본 데모 경로');
  gpxFileInput.value = '';
  persistDraft('기본 경로 복원');
});

spotPhotoInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    selectedPhotoDataUrl = '';
    clearSpotForm();
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('사진 읽기에 실패했습니다.'));
    reader.readAsDataURL(file);
  });
  selectedPhotoDataUrl = String(dataUrl);
  spotPhotoPreview.className = 'spot-photo-preview';
  spotPhotoPreview.innerHTML = `<img src="${selectedPhotoDataUrl}" alt="현장 사진 미리보기" />`;
  persistDraft('사진 임시저장됨');
});

useCurrentLocationBtn.addEventListener('click', () => {
  if (!latestPosition) {
    acquireCurrentLocationAndCenter();
    if (!latestPosition) return;
  }
  selectedSpotCoords = { lat: latestPosition.lat, lng: latestPosition.lng };
  updateSelectedCoordsPreview();
  persistDraft('현재 위치 반영됨', false);
  switchTab('record');
});

function acquireCurrentLocationAndCenter() {
  if (!navigator.geolocation) {
    alert('이 브라우저는 위치 확인을 지원하지 않습니다.');
    return;
  }
  gpsStatus.textContent = '현재 위치 확인 중';
  navigator.geolocation.getCurrentPosition((position) => {
    const point = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      ts: position.timestamp || Date.now(),
      accuracy: position.coords.accuracy || 0
    };
    latestPosition = point;
    if (!selectedSpotCoords) {
      selectedSpotCoords = { lat: point.lat, lng: point.lng };
      updateSelectedCoordsPreview();
    }
    updateCurrentMarker(point, point.accuracy);
    smoothPanTo(point, true);
    gpsStatus.textContent = `현재 위치 확인 (${Math.round(point.accuracy || 0)}m)`;
    persistDraft('현재 위치 갱신됨', false);
  }, (error) => {
    gpsStatus.textContent = '위치 확인 실패';
    alert(`현재 위치를 가져오지 못했습니다. ${error.message}`);
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
}

centerMapBtn.addEventListener('click', () => {
  if (latestPosition) smoothPanTo(latestPosition, true);
  else acquireCurrentLocationAndCenter();
});

addSpotBtn.addEventListener('click', () => {
  if (!spotTitle.value.trim()) {
    alert('포인트 이름을 적어주세요.');
    return;
  }
  if (!selectedSpotCoords) {
    alert('포인트 좌표가 없습니다. 현재 위치를 먼저 넣어주세요.');
    return;
  }
  const record = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    category: spotCategory.value,
    title: spotTitle.value.trim(),
    description: spotDescription.value.trim(),
    lat: selectedSpotCoords.lat,
    lng: selectedSpotCoords.lng,
    createdAt: new Date().toISOString(),
    photoDataUrl: selectedPhotoDataUrl || ''
  };
  spotRecords.unshift(record);
  renderSpotRecords();
  clearSpotForm();
  persistDraft('포인트 저장됨');
  switchTab('spots');
});

spotRecordList.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-record-id]');
  if (!btn) return;
  const { recordId } = btn.dataset;
  spotRecords = spotRecords.filter((record) => record.id !== recordId);
  renderSpotRecords();
  persistDraft('포인트 삭제 반영됨');
});

fieldNotes.addEventListener('input', () => persistDraft('메모 저장됨'));
spotTitle.addEventListener('input', () => persistDraft('입력 임시저장됨', false));
spotDescription.addEventListener('input', () => persistDraft('입력 임시저장됨', false));
spotCategory.addEventListener('change', () => persistDraft('구분 저장됨', false));

scrollToMapBtn.addEventListener('click', () => {
  switchTab('map');
  if (latestPosition) smoothPanTo(latestPosition, true);
  else if (routeBounds && map) map.setBounds(routeBounds, 30, 30, 30, 30);
});

syncNowBtn.addEventListener('click', async () => {
  persistDraft('동기화 준비 중', false);
  const ok = await syncToServer();
  if (!ok && !supabaseClient) {
    alert('아직 서버가 연결되지 않았습니다. config.js에 Supabase URL과 anon key를 넣어야 합니다.');
  }
});

newSessionBtn.addEventListener('click', () => {
  const confirmed = confirm('현재 기록을 비우고 새 답사를 시작할까요? 로컬 임시저장도 함께 삭제됩니다.');
  if (confirmed) clearCurrentSession();
});

window.addEventListener('beforeunload', () => persistDraft('종료 전 저장됨', false));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) persistDraft('백그라운드 저장됨', false);
});
window.addEventListener('online', () => { if (supabaseClient) syncToServer(); });

renderRoute(activeRoute, '기본 데모 경로');
updateSelectedCoordsPreview();
renderSpotRecords();
updateStats();
updateTimer();
switchTab('map');
bootMap();
