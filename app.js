// ===== CONFIG =====
const config = window.TRAILTRIP_CONFIG || {};

// ===== SUPABASE (충돌 방지 수정) =====
const supabaseClient = (config.supabaseUrl && config.supabaseAnonKey && window.supabase)
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

// ===== STATE =====
let map;
let currentMarker;
let path = [];
let watchId = null;
let startTime = null;

// ===== KAKAO MAP INIT =====
function initMap() {
  kakao.maps.load(() => {
    const container = document.getElementById('map');
    map = new kakao.maps.Map(container, {
      center: new kakao.maps.LatLng(33.45, 126.57),
      level: 4
    });
  });
}

// ===== CURRENT LOCATION =====
function startTracking() {
  if (!navigator.geolocation) {
    alert("GPS 지원 안됨");
    return;
  }

  watchId = navigator.geolocation.watchPosition((pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    const position = new kakao.maps.LatLng(lat, lon);

    // 현재 위치 마커
    if (!currentMarker) {
      currentMarker = new kakao.maps.Marker({
        map: map,
        position: position
      });
    } else {
      currentMarker.setPosition(position);
    }

    // 지도 이동 (너무 흔들리지 않게)
    if (!map.getBounds().contain(position)) {
      map.panTo(position);
    }

    // 경로 저장
    path.push({
      lat,
      lon,
      time: new Date().toISOString()
    });

  }, (err) => {
    console.error(err);
  }, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 5000
  });

  startTime = Date.now();
}

// ===== STOP =====
function stopTracking() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// ===== JSON 저장 =====
function saveJSON() {
  const data = {
    path,
    startedAt: startTime,
    endedAt: Date.now()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trailtrip.json';
  a.click();
}

// ===== GPX 저장 =====
function saveGPX() {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TrailTrip">
<trk><name>Trail</name><trkseg>`;

  path.forEach(p => {
    gpx += `<trkpt lat="${p.lat}" lon="${p.lon}">
      <time>${p.time}</time>
    </trkpt>`;
  });

  gpx += `</trkseg></trk></gpx>`;

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'trailtrip.gpx';
  a.click();
}

// ===== SERVER SYNC =====
async function syncToServer() {
  if (!supabaseClient) {
    alert("Supabase 연결 안됨");
    return;
  }

  const { error } = await supabaseClient
    .from('walk_sessions')
    .insert({
      path,
      created_at: new Date()
    });

  if (error) {
    console.error(error);
    alert("저장 실패");
  } else {
    alert("서버 저장 완료");
  }
}

// ===== INIT =====
window.onload = () => {
  initMap();

  document.getElementById('startBtn')?.addEventListener('click', startTracking);
  document.getElementById('stopBtn')?.addEventListener('click', stopTracking);
  document.getElementById('jsonBtn')?.addEventListener('click', saveJSON);
  document.getElementById('gpxBtn')?.addEventListener('click', saveGPX);
  document.getElementById('syncBtn')?.addEventListener('click', syncToServer);
};