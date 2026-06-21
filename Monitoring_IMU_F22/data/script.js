/*
  F-22 IMU Web Dashboard — script.js
  Three.js GLB + WebSocket + HTTP GET/POST
*/

let scene, camera, renderer, airplane;
let targetGyroX = 0, targetGyroY = 0, targetGyroZ = 0;
let frameCount = 0, lastFpsTime = performance.now();

function pw(el) { return el.parentElement.clientWidth; }
function ph(el) { return el.parentElement.clientHeight; }

// ── Init Three.js ─────────────────────────────────────────
function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);
  scene.fog = new THREE.FogExp2(0x0d1117, 0.025);

  const c = document.getElementById("3Dcube");
  camera = new THREE.PerspectiveCamera(52, pw(c) / ph(c), 0.1, 300);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(pw(c), ph(c));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  c.appendChild(renderer.domElement);

  // Pencahayaan
  scene.add(new THREE.AmbientLight(0xe6edf3, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(10, 14, 10);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x58a6ff, 0.5);
  fill.position.set(-10, -4, -10);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xe6edf3, 0.4);
  rim.position.set(0, -10, -12);
  scene.add(rim);

  camera.position.set(0, 2, 12);
  camera.lookAt(0, 0, 0);

  loadModel();
  renderer.render(scene, camera);
}

// ── Load GLB ──────────────────────────────────────────────
function loadModel() {
  document.getElementById("loading-text").style.display = "block";
  const loader = new THREE.GLTFLoader();
  loader.load(
    'lockheed_martin_f-22_raptor.glb',
    function(gltf) {
      const model = gltf.scene;
      scene.add(model);

      const box  = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const s    = 6 / Math.max(size.x, size.y, size.z);
      model.scale.set(s, s, s);

      const box2 = new THREE.Box3().setFromObject(model);
      const ctr  = box2.getCenter(new THREE.Vector3());
      model.position.set(-ctr.x, -ctr.y, -ctr.z);

      const pivot = new THREE.Group();
      scene.remove(model);
      pivot.add(model);
      scene.add(pivot);
      airplane = pivot;

      document.getElementById("loading-text").style.display = "none";
    },
    function(xhr) {
      if (xhr.total > 0) {
        const p = Math.round(xhr.loaded / xhr.total * 100);
        document.getElementById("loading-text").innerHTML =
          `LOADING MODEL... ${p}%`;
      }
    },
    function() {
      airplane = makeFallback();
      scene.add(airplane);
      document.getElementById("loading-text").style.display = "none";
    }
  );
}

function makeFallback() {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshBasicMaterial({color:c});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.25,.15,4,12), m(0x8b949e));
  body.rotation.z = Math.PI/2; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.25,1,12), m(0x6e7681));
  nose.rotation.z = -Math.PI/2; nose.position.x = 2.5; g.add(nose);
  [-1.4,1.4].forEach(z => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(2,.06,.7), m(0xb1bac4));
    w.position.set(0,0,z); g.add(w);
  });
  return g;
}

// ── Resize ────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const c = document.getElementById("3Dcube");
  camera.aspect = pw(c) / ph(c);
  camera.updateProjectionMatrix();
  renderer.setSize(pw(c), ph(c));
});

init3D();

// ── Animation loop ────────────────────────────────────────
const LF = 0.08;
function loop() {
  requestAnimationFrame(loop);
  if (airplane) {
    airplane.rotation.x += (targetGyroY - airplane.rotation.x) * LF;
    airplane.rotation.z += (targetGyroX - airplane.rotation.z) * LF;
    airplane.rotation.y += (targetGyroZ - airplane.rotation.y) * LF;
  }
  renderer.render(scene, camera);

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    document.getElementById("fps-counter").innerHTML = frameCount + " FPS";
    frameCount = 0; lastFpsTime = now;
  }
}
loop();

// ── Bar update ────────────────────────────────────────────
function bar(id, val, max) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min(Math.abs(val)/max*100, 100) + "%";
}

// ── WebSocket ─────────────────────────────────────────────
let ws, reconnTimer = null;

function connect() {
  if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
  const host = window.location.hostname;
  ws = new WebSocket(`ws://${host}:5000/ws-browser`);

  const timeout = setTimeout(() => { if (ws.readyState !== 1) ws.close(); }, 5000);

  ws.onopen = () => { clearTimeout(timeout); setConn(true); };

  ws.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      const gyro = d.gyro, acc = d.acc;

      targetGyroX = parseFloat(gyro.gyroX)||0;
      targetGyroY = parseFloat(gyro.gyroY)||0;
      targetGyroZ = parseFloat(gyro.gyroZ)||0;
      setText("gyroX", targetGyroX.toFixed(2));
      setText("gyroY", targetGyroY.toFixed(2));
      setText("gyroZ", targetGyroZ.toFixed(2));
      bar("bar-gx", targetGyroX, 3.14);
      bar("bar-gy", targetGyroY, 3.14);
      bar("bar-gz", targetGyroZ, 3.14);

      const ax = parseFloat(acc.accX)||0;
      const ay = parseFloat(acc.accY)||0;
      const az = parseFloat(acc.accZ)||0;
      setText("accX", ax.toFixed(2));
      setText("accY", ay.toFixed(2));
      setText("accZ", az.toFixed(2));
      bar("bar-ax", ax, 20);
      bar("bar-ay", ay, 20);
      bar("bar-az", az, 20);

      setText("temp", (parseFloat(d.temp)||0).toFixed(2));
      setWarn(d.warning);
      setRecording(d.recording);
    } catch(err) {}
  };

  ws.onerror = () => setConn(false);
  ws.onclose = () => {
    clearTimeout(timeout);
    setConn(false);
    reconnTimer = setTimeout(connect, 3000);
  };
}

connect();

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = val;
}

// ── Status ────────────────────────────────────────────────
function setConn(on) {
  const dot   = document.getElementById("dot-conn");
  const label = document.getElementById("label-conn");
  dot.className   = "status-dot " + (on ? "online" : "offline");
  label.innerHTML = on ? "ONLINE" : "OFFLINE";
  label.style.color = on ? "var(--ok)" : "var(--danger)";
}

function setWarn(warn) {
  const dot   = document.getElementById("dot-warn");
  const label = document.getElementById("label-warn");
  dot.className   = "status-dot " + (warn ? "warning" : "normal");
  label.innerHTML = warn ? "WARNING" : "NORMAL";
  label.style.color = warn ? "var(--warn)" : "var(--ok)";
  const vp = document.querySelector(".viewport");
  warn ? vp.classList.add("warn-active") : vp.classList.remove("warn-active");
}

function setRecording(rec) {
  const el = document.getElementById("status-recording");
  el.innerHTML    = rec ? "● ACTIVE" : "⏸ STANDBY";
  el.style.color  = rec ? "var(--ok)" : "rgba(139,148,158,0.7)";
}

// ── HTTP GET: Calibrate ───────────────────────────────────
function calibrate() {
  const btn = document.getElementById("btn-calibrate");
  btn.disabled = true;
  btn.innerHTML = "◌ CALIBRATING...";
  fetch('/calibrate')
    .then(r => r.json())
    .then(() => {
      targetGyroX = 0; targetGyroY = 0; targetGyroZ = 0;
      btn.innerHTML = "✓ DONE";
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = "◎ &nbsp;CALIBRATE SENSOR";
      }, 2000);
    })
    .catch(() => {
      btn.disabled = false;
      btn.innerHTML = "◎ &nbsp;CALIBRATE SENSOR";
    });
}

// ── Zoom ──────────────────────────────────────────────────
function zoomIn()  { if (camera.position.z > 4)  { camera.position.z -= 1; camera.lookAt(0,0,0); } }
function zoomOut() { if (camera.position.z < 22) { camera.position.z += 1; camera.lookAt(0,0,0); } }

// ── HTTP GET: Reset ───────────────────────────────────────
function resetPosition(id) {
  fetch('/'+id)
    .then(r => r.json())
    .then(() => {
      if (id==='reset'||id==='resetX') targetGyroX = 0;
      if (id==='reset'||id==='resetY') targetGyroY = 0;
      if (id==='reset'||id==='resetZ') targetGyroZ = 0;
    });
}