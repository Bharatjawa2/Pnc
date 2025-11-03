import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/* ---------- DOM ---------- */
const container = document.getElementById('canvas-container');
const fileInput = document.getElementById('file-input');
const fileNameLabel = document.getElementById('file-name');
const btnSendToVision = document.getElementById('btn-send-vision');

const btnAll = document.getElementById('btn-all');
const btnHit = document.getElementById('btn-hit');
const btnCompute = document.getElementById('btn-compute');
const btnExport = document.getElementById('btn-export');
const btnToggleVoxels = document.getElementById('btn-toggle-voxels');

const selX = document.getElementById('sel-x');
const selZ = document.getElementById('sel-z');
const xInfo = document.getElementById('x-info');
const yInfo = document.getElementById('y-info');
const zInfo = document.getElementById('z-info');
const computeStatus = document.getElementById('compute-status');

const startAInfo = document.getElementById('startA-info');
const btnSetStartA = document.getElementById('btn-set-startA');
const chkAOuter = document.getElementById('chkA-outer');

const startBInfo = document.getElementById('startB-info');
const btnSetStartB = document.getElementById('btn-set-startB');
const chkBOuter = document.getElementById('chkB-outer');

const startAx = document.getElementById('startA-x');
const startAy = document.getElementById('startA-y');
const startAz = document.getElementById('startA-z');

const startBx = document.getElementById('startB-x');
const startBy = document.getElementById('startB-y');
const startBz = document.getElementById('startB-z');

const startGlobalInfo = document.getElementById('start-global-info');
const edgesListContainer = document.getElementById('edges-list');

const rightSidebar = document.getElementById('right-sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');

const visionInput = document.getElementById('vision-input');
const btnSetVision = document.getElementById('btn-set-vision');

let VISION_SERVER = 'http://192.168.31.58:5002';

function normalizeVisionUrl(raw) {
  if (!raw) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    // return origin (protocol + host + port) to avoid stray paths
    return u.origin;
  } catch (e) {
    return null;
  }
}

if (visionInput) visionInput.value = VISION_SERVER;

if (btnSetVision && visionInput) {
  btnSetVision.addEventListener('click', () => {
    const raw = visionInput.value;
    let norm = normalizeVisionUrl(raw);
    if (!norm) { alert('Invalid URL. Example: 192.168.31.58:5002 or http://192.168.31.58:5002'); return; }
    if (location.protocol === 'https:' && norm.startsWith('http://')) {
      const httpsCandidate = norm.replace(/^http:\/\//i, 'https://');
      if (confirm(`Your site is HTTPS. Browser will block HTTP requests. Try setting vision server to:\n\n${httpsCandidate}\n\n(Select Cancel to keep HTTP instead.)`)) {
        norm = httpsCandidate;
      } else {
        alert('Note: calling an http:// server from an https page will be blocked by browsers when deployed.');
      }
    }
  });

  visionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnSetVision.click();
    }
  });
}

/* ---------- small housekeeping: remove pasted debug block if present ---------- */
/* The user pasted a textual dump like:
   "sis (choose X & Z) X +X (1, 0, 0) Z +Z (0, 0, 1) Y (0, 1, 0) Start A ... Tip: Shift+Click ..."
   We'll search for elements containing distinctive phrases and hide them so they don't show to the user.
*/
(function removeDebugText() {
  const searchPhrases = ['Tip: Shift+Click', 'Start A', 'Start B', 'Real Z', 'Real X', 'Real Y'];
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    try {
      const txt = (el.textContent || '').trim();
      if (!txt) continue;
      // if element contains multiple of the phrases, hide the nearest panel container
      let hits = 0;
      for (const p of searchPhrases) if (txt.includes(p)) hits++;
      if (hits >= 2) {
        // hide the nearest panel ancestor (panel or sidebar), but avoid removing functional controls
        let node = el;
        for (let i = 0; i < 6 && node; ++i) {
          if (node.classList && (node.classList.contains('panel') || node.id === 'right-sidebar' || node.classList.contains('sidebar'))) break;
          node = node.parentElement;
        }
        // If node is a direct panel/sidebar, only hide the specific child element (el) to avoid breaking UI
        if (el && el !== document.body && el !== document.documentElement) {
          // clear the text content safely (preserve child controls if any)
          // Only clear if it looks like a pure text block (no input/select descendants)
          if (el.querySelectorAll && el.querySelectorAll('input,select,button,textarea').length === 0) {
            el.style.display = 'none';
          } else {
            // otherwise, hide topmost text nodes but preserve inputs (best-effort)
            // create a wrapper for inputs and move them up if necessary (rare)
            // fallback: do nothing to avoid breaking interactive elements
          }
        }
      }
    } catch (e) { /* ignore */ }
  }
})();

/* ---------- three.js ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf8fafc);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.position.set(2, 2, 3);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
// we will size renderer via updateLayoutForSidebar()
container.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6); dirLight.position.set(4, 10, 3); scene.add(dirLight);
scene.add(new THREE.GridHelper(10, 10, 0xe0e0e0, 0xe0e0e0));

/* ---------- state ---------- */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let loadedObject = null;
let pickMeshes = [];          // meshes from OBJ (used for collision & inside tests)
let vertexMeshes = [];        // the vertex point spheres
let edgeLines = null;         // edges LineSegments
let currentHighlight = null;
let selectedLabels = [];
let axisMarkersGroup = null;
let dashedGroup = null;

let globalStartPoint = null;   // Shift+click start (in air)
let globalStartMarker = null;

// per-endpoint starts + markers + manual outer flags
const starts = { A: null, B: null };
const startMarkers = { A: null, B: null };
const manualOuter = { A: false, B: false };

/* ---------- sequence & selections ---------- */
const selectionSequence = [];
const selectedEdges = []; // selected edges array
let voxelGroup = null;
const voxelMeshes = [];
const selectedVoxels = [];

/* ---------- basis (user) ---------- */
const currentBasis = {
  x: new THREE.Vector3(1, 0, 0),
  z: new THREE.Vector3(0, 0, 1),
  y: new THREE.Vector3()
};
if (selX) selX.value = "+X";
if (selZ) selZ.value = "+Z";
currentBasis.y.copy(currentBasis.z).cross(currentBasis.x).normalize();
refreshBasisUI();
function fmt(n) { return (Math.round(n * 1000) / 1000).toFixed(3); }

/* ---------- UI helpers ---------- */
function vecFromSelectValue(val) {
  switch (val) {
    case '+X': return new THREE.Vector3(1, 0, 0);
    case '-X': return new THREE.Vector3(-1, 0, 0);
    case '+Y': return new THREE.Vector3(0, 1, 0);
    case '-Y': return new THREE.Vector3(0, -1, 0);
    case '+Z': return new THREE.Vector3(0, 0, 1);
    case '-Z': return new THREE.Vector3(0, 0, -1);
  } return new THREE.Vector3(1, 0, 0);
}
function refreshBasisUI() {
  if (!xInfo || !yInfo || !zInfo) return;
  xInfo.textContent = `(${Math.round(currentBasis.x.x)}, ${Math.round(currentBasis.x.y)}, ${Math.round(currentBasis.x.z)})`;
  zInfo.textContent = `(${Math.round(currentBasis.z.x)}, ${Math.round(currentBasis.z.y)}, ${Math.round(currentBasis.z.z)})`;
  yInfo.textContent = `(${Math.round(currentBasis.y.x)}, ${Math.round(currentBasis.y.y)}, ${Math.round(currentBasis.y.z)})`;
}
if (selX) selX.addEventListener('change', updateBasisFromUI);
if (selZ) selZ.addEventListener('change', updateBasisFromUI);
function updateBasisFromUI() {
  const bx = vecFromSelectValue(selX.value).clone().normalize();
  const bz = vecFromSelectValue(selZ.value).clone().normalize();
  if (bx.clone().cross(bz).length() < 1e-6) {
    alert('X and Z are colinear — choose different.');
    selX.value = "+Y"; selZ.value = "-Z";
    currentBasis.x.set(0, 1, 0); currentBasis.z.set(0, 0, -1);
  } else {
    currentBasis.x.copy(bx); currentBasis.z.copy(bz);
  }
  currentBasis.y.copy(currentBasis.x).cross(currentBasis.z).normalize();
  refreshBasisUI();
}

/* ---------- small helpers ---------- */
function v3(v) { return [v.x, v.z, v.y]; }

/* ---------- utils ---------- */
function disposeObject(obj) {
  if (!obj) return;
  try {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      else { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
    }
  } catch (e) { }
}
function clearSelectionVisuals() {
  selectedLabels.forEach(s => { scene.remove(s); if (s.material && s.material.map) s.material.map.dispose(); if (s.material) s.material.dispose(); });
  selectedLabels = [];
  if (axisMarkersGroup) { axisMarkersGroup.children.forEach(c => disposeObject(c)); scene.remove(axisMarkersGroup); axisMarkersGroup = null; }
  if (dashedGroup) { dashedGroup.children.forEach(c => disposeObject(c)); scene.remove(dashedGroup); dashedGroup = null; }
}
function clearAll() {
  clearSelectionVisuals();
  while (selectedEdges.length) removeEdgeById(selectedEdges[0].id);
  while (selectedVoxels.length) removeVoxelById(selectedVoxels[0].id);
  if (voxelGroup) { voxelGroup.children.forEach(m => { scene.remove(m); disposeObject(m); }); scene.remove(voxelGroup); voxelGroup = null; voxelMeshes.length = 0; }
  if (edgeLines) { scene.remove(edgeLines); disposeObject(edgeLines); edgeLines = null; }
  vertexMeshes.forEach(m => { scene.remove(m); disposeObject(m); }); vertexMeshes = [];
  pickMeshes = []; if (loadedObject) { scene.remove(loadedObject); loadedObject = null; }
  if (fileNameLabel) fileNameLabel.textContent = 'No file loaded';
  if (globalStartMarker) { scene.remove(globalStartMarker); disposeObject(globalStartMarker); globalStartMarker = null; globalStartPoint = null; }
  if (startGlobalInfo) startGlobalInfo.textContent = '—';
  ['A', 'B'].forEach(k => {
    if (startMarkers[k]) { scene.remove(startMarkers[k]); disposeObject(startMarkers[k]); startMarkers[k] = null; }
    starts[k] = null; manualOuter[k] = false;
    const elx = document.getElementById(`start${k}-x`); if (elx) elx.value = '';
    const ely = document.getElementById(`start${k}-y`); if (ely) ely.value = '';
    const elz = document.getElementById(`start${k}-z`); if (elz) elz.value = '';
    const infoEl = document.getElementById(`start${k}-info`); if (infoEl) infoEl.textContent = '—';
    const chk = document.getElementById(`chk${k}-outer`); if (chk) chk.checked = false;
  });
  if (edgesListContainer) edgesListContainer.innerHTML = '';
  lastResultJSON = null;
  if (computeStatus) computeStatus.textContent = '—';
}

/* ---------- geometry helpers ---------- */
function computeCombinedBox(objects) {
  if (!objects || objects.length === 0) return null;
  const box = new THREE.Box3(); let init = false;
  objects.forEach(o => { o.updateWorldMatrix(true, false); const b = new THREE.Box3().setFromObject(o); if (!init) { box.copy(b); init = true; } else box.union(b); });
  return init ? box : null;
}
function firstHitAlong(origin, dir, targets) {
  raycaster.set(origin, dir);
  let hits = []; for (const m of targets) hits = hits.concat(raycaster.intersectObject(m, true));
  hits = hits.filter(h => h.distance > 1e-6);
  return hits.length ? hits[0] : null;
}

/* ---------- packet / compute helpers ---------- */
function computeBuffer(hitDist, diag, INF) {
  const minBufFactor = 0.02, maxBufFactor = 0.5;
  const minBuf = Math.max(1e-4, diag * minBufFactor);
  const maxBuf = Math.max(minBuf, diag * maxBufFactor);
  let preferred = hitDist * 0.4;
  let buffer = Math.min(Math.max(preferred, minBuf), maxBuf);
  if (hitDist > INF * 0.9) buffer = Math.min(buffer, INF * 0.2);
  return buffer;
}
function computeAxisSearchFrom(origin, axisDir, targets, sceneBox, diag, INF) {
  const dirPos = axisDir.clone().normalize();
  const dirNeg = dirPos.clone().negate();
  const hp = firstHitAlong(origin, dirPos, targets);
  const hn = firstHitAlong(origin, dirNeg, targets);
  let chosen = null;
  if (hp && hn) chosen = (hp.distance <= hn.distance) ? { hit: hp, dir: dirPos } : { hit: hn, dir: dirNeg };
  else if (hp) chosen = { hit: hp, dir: dirPos };
  else if (hn) chosen = { hit: hn, dir: dirNeg };
  else {
    if (sceneBox) {
      const rPos = new THREE.Ray(origin, dirPos), rNeg = new THREE.Ray(origin, dirNeg);
      const bPos = rPos.intersectBox(sceneBox, new THREE.Vector3());
      const bNeg = rNeg.intersectBox(sceneBox, new THREE.Vector3());
      if (bPos && bNeg) {
        const dpos = bPos.distanceTo(origin), dneg = bNeg.distanceTo(origin);
        chosen = (dpos <= dneg) ? { hit: { point: bPos }, dir: dirPos } : { hit: { point: bNeg }, dir: dirNeg };
      } else if (bPos) chosen = { hit: { point: bPos }, dir: dirPos };
      else if (bNeg) chosen = { hit: { point: bNeg }, dir: dirNeg };
    }
    if (!chosen) chosen = { hit: { point: origin.clone().add(dirPos.clone().multiplyScalar(INF)) }, dir: dirPos };
  }
  const raw = chosen.hit.point.clone();
  const dist = raw.clone().sub(origin).length();
  const buf = computeBuffer(dist, (sceneBox ? sceneBox.getSize(new THREE.Vector3()).length() : INF), INF);
  const search_point = raw.clone().add(chosen.dir.clone().multiplyScalar(buf));
  return { rawCollision: raw, search_point, dir: chosen.dir.clone(), buffer: buf };
}
function computeXOuterThreeStep(startOrigin, endpointPos, basis, targets, sceneBox, diag, INF = 5000, collideZRawFromStart = null) {
  const X = basis.x.clone().normalize();
  const Z = basis.z.clone().normalize();

  const hitXplus = firstHitAlong(startOrigin, X, targets);
  const hitXminus = firstHitAlong(startOrigin, X.clone().negate(), targets);
  let inwardDir;
  if (hitXplus && hitXminus) inwardDir = (hitXplus.distance <= hitXminus.distance) ? X : X.clone().negate();
  else if (hitXplus) inwardDir = X;
  else if (hitXminus) inwardDir = X.clone().negate();
  else inwardDir = X;
  const outwardDir = inwardDir.clone().negate();

  const outBox = intersectSceneBox(startOrigin, outwardDir, sceneBox);
  let step1;
  if (outBox) {
    const extra = Math.max(diag * 0.05, 5);
    step1 = outBox.clone().add(outwardDir.clone().multiplyScalar(extra));
  } else {
    step1 = startOrigin.clone().add(outwardDir.clone().multiplyScalar(INF * 0.3));
  }

  let collideZPoint = collideZRawFromStart;
  if (!collideZPoint) {
    const pzTmp = computeAxisSearchFrom(step1, Z, targets, sceneBox, diag, INF);
    collideZPoint = pzTmp.rawCollision.clone();
  }
  const tStep1 = step1.dot(Z);
  const tWallZ = collideZPoint.dot(Z);
  const delta = tWallZ - tStep1;
  const sign = (delta >= 0) ? 1 : -1;
  const EXTRA_Z_MM = 0.5;
  const moveZMag = Math.abs(delta) + EXTRA_Z_MM;
  const step2 = step1.clone().add(Z.clone().multiplyScalar(sign * moveZMag));

  const projX = p => p.dot(X);
  const xEnd = projX(endpointPos);
  const hitPlus = firstHitAlong(step2, X, targets);
  const hitMinus = firstHitAlong(step2, X.clone().negate(), targets);

  let chosenHit = null, chosenDir = null;
  if (hitPlus && hitMinus) {
    const xPlus = projX(hitPlus.point);
    const xMinus = projX(hitMinus.point);
    const ePlus = Math.abs(xPlus - xEnd);
    const eMinus = Math.abs(xMinus - xEnd);
    if (ePlus < eMinus || (ePlus === eMinus && hitPlus.distance <= hitMinus.distance)) {
      chosenHit = hitPlus; chosenDir = X;
    } else {
      chosenHit = hitMinus; chosenDir = X.clone().negate();
    }
  } else if (hitPlus) { chosenHit = hitPlus; chosenDir = X; }
  else if (hitMinus) { chosenHit = hitMinus; chosenDir = X.clone().negate(); }
  else {
    const altPlus = intersectSceneBox(step2, X, sceneBox);
    const altMinus = intersectSceneBox(step2, X.clone().negate(), sceneBox);
    if (altPlus || altMinus) {
      const p = altPlus ? altPlus : altMinus;
      const d = altPlus ? X : X.clone().negate();
      const rawCollision = p.clone();
      const search_point = rawCollision.clone().add(d.multiplyScalar(5.0));
      return { step1, step2, rawCollision, search_point };
    }
    console.warn('No ±X collision from step2; geometry may be open.');
    return { step1, step2, rawCollision: step2.clone(), search_point: step2.clone() };
  }

  const rawCollision = chosenHit.point.clone();
  const search_point = rawCollision.clone().add(chosenDir.multiplyScalar(5.0));
  return { step1, step2, rawCollision, search_point };
}
function intersectSceneBox(origin, dir, sceneBox) {
  if (!sceneBox) return null;
  const ray = new THREE.Ray(origin, dir.clone().normalize());
  const p = new THREE.Vector3();
  const hit = ray.intersectBox(sceneBox, p);
  return hit ? p.clone() : null;
}

/* ---------- visuals / labels ---------- */
function createTextSprite(text, fontSize = 140, fill = 'white') {
  const canvas = document.createElement('canvas'); const s = 256; canvas.width = s; canvas.height = s;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, s, s);
  ctx.font = `bold ${fontSize}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(6, Math.floor(fontSize * 0.08)); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(text, s / 2, s / 2);
  ctx.fillStyle = fill; ctx.fillText(text, s / 2, s / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat); sprite.userData._tex = tex; return sprite;
}
function createOrderSprite(n, color = 'white') {
  const sprite = createTextSprite(String(n), 160, color);
  sprite.scale.setScalar(0.35);
  return sprite;
}

/* ---------- build visuals from geometry ---------- */
function buildVisualsFromGeometry(g) {
  const pos = g.getAttribute('position'); if (!pos) return;
  const edgesGeom = new THREE.EdgesGeometry(g, 1);
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x111827 });
  edgeLines = new THREE.LineSegments(edgesGeom, edgesMat);
  scene.add(edgeLines);
  const sphereGeo = new THREE.SphereGeometry(0.06, 14, 12);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const mat = new THREE.MeshStandardMaterial({ color: 0xf97316 });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.position.copy(v); mesh.userData._baseScale = 1; scene.add(mesh); vertexMeshes.push(mesh);
  }
}

/* ---------- selection + UI list rendering ---------- */
let lastResultJSON = null;
function ensureLastResult() { if (!lastResultJSON) lastResultJSON = { data: { welding_data: { edges: {}, path_plan: [], selections: [] } } }; }
function addSelectionToLastResult(entry) { ensureLastResult(); lastResultJSON.data.welding_data.selections.push(entry); }
function removeSelectionFromLastResultById(id) {
  if (!lastResultJSON || !lastResultJSON.data || !lastResultJSON.data.welding_data) return;
  const sel = lastResultJSON.data.welding_data.selections;
  const idx = sel.findIndex(s => s.id === id);
  if (idx !== -1) sel.splice(idx, 1);
  for (const s of lastResultJSON.data.welding_data.selections) {
    const seqIdx = selectionSequence.findIndex(x => x.id === s.id);
    s.order = seqIdx === -1 ? s.order : (seqIdx + 1);
  }
}

/* ---------- sequence helpers ---------- */
function addSequenceEntry(type, ref, id, pos) {
  const entry = { type, ref, id };
  selectionSequence.push(entry);
  const order = selectionSequence.length;
  const sprite = createOrderSprite(order, 'white');
  sprite.position.copy(pos.clone().add(new THREE.Vector3(0, 0.08, 0)));
  sprite.renderOrder = 9999;
  sprite.material.depthTest = false;
  scene.add(sprite); selectedLabels.push(sprite);
  ref._orderSprite = sprite;
  ref._order = order;
  addSelectionToLastResult({ type, id, order, coords: [Number(pos.x.toFixed(4)), Number(pos.y.toFixed(4)), Number(pos.z.toFixed(4))] });
  renderSelectionsList();
}
function removeSequenceEntryById(id) {
  const idx = selectionSequence.findIndex(s => s.id === id);
  if (idx === -1) return;
  const removed = selectionSequence.splice(idx, 1)[0];
  const ref = removed.ref;
  if (ref && ref._orderSprite) { scene.remove(ref._orderSprite); if (ref._orderSprite.material && ref._orderSprite.material.map) ref._orderSprite.material.map.dispose(); if (ref._orderSprite.material) ref._orderSprite.material.dispose(); ref._orderSprite = null; }
  for (let i = 0; i < selectionSequence.length; i++) {
    const s = selectionSequence[i];
    const newOrder = i + 1;
    s.ref._order = newOrder;
    if (s.ref._orderSprite) {
      scene.remove(s.ref._orderSprite);
      if (s.ref._orderSprite.material && s.ref._orderSprite.material.map) s.ref._orderSprite.material.map.dispose();
      if (s.ref._orderSprite.material) s.ref._orderSprite.material.dispose();
      const sprite = createOrderSprite(newOrder, 'white');
      const basePos = (s.type === 'edge') ? (s.ref.aPos.clone().add(s.ref.bPos).multiplyScalar(0.5)) : s.ref.pos.clone();
      sprite.position.copy(basePos.clone().add(new THREE.Vector3(0, 0.08, 0)));
      sprite.renderOrder = 9999; sprite.material.depthTest = false;
      scene.add(sprite); selectedLabels.push(sprite);
      s.ref._orderSprite = sprite;
    }
  }
  removeSelectionFromLastResultById(removed.id);
  ensureLastResult();
  lastResultJSON.data.welding_data.selections.sort((a, b) => a.order - b.order);
  for (let i = 0; i < lastResultJSON.data.welding_data.selections.length; i++) lastResultJSON.data.welding_data.selections[i].order = i + 1;
  renderSelectionsList();
}

/* ---------- edge id helper ---------- */
function edgeIdForPoints(a, b) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return `${mid.x.toFixed(4)}_${mid.y.toFixed(4)}_${mid.z.toFixed(4)}`;
}

/* ---------- highlight helpers (ensures visible orange edge) ---------- */
function createEdgeHighlight(aPos, bPos) {
  const geom = new THREE.BufferGeometry().setFromPoints([aPos.clone(), bPos.clone()]);
  const mat = new THREE.LineBasicMaterial({ color: 0xff8c00, linewidth: 3 });
  mat.depthTest = false;
  const line = new THREE.Line(geom, mat);
  line.renderOrder = 9999;
  return line;
}

/* ---------- voxel grid (full bounding box + buffer) ---------- */
const VOXEL_RESOLUTION = 10;
const VOXEL_BUFFER_FACTOR = 0.12;
function createVoxelGridForObject(meshes, resolution = VOXEL_RESOLUTION) {
  if (voxelGroup) { voxelGroup.children.forEach(m => { scene.remove(m); disposeObject(m); }); scene.remove(voxelGroup); voxelGroup = null; voxelMeshes.length = 0; }
  const box = computeCombinedBox(meshes);
  if (!box) return;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim <= 0) return;
  const buffer = maxDim * VOXEL_BUFFER_FACTOR;
  box.expandByScalar(buffer);
  const spacing = maxDim / resolution;
  const half = 0.5;
  const start = box.min.clone().add(new THREE.Vector3(spacing * half, spacing * half, spacing * half));
  const end = box.max.clone().sub(new THREE.Vector3(spacing * half, spacing * half, spacing * half));
  voxelGroup = new THREE.Group(); voxelGroup.name = 'voxelGrid';
  const sphereGeo = new THREE.SphereGeometry(Math.max(spacing * 0.18, spacing * 0.02), 8, 6);
  let idCounter = 0;
  const matBase = new THREE.MeshBasicMaterial({ color: 0x999999 });
  for (let x = start.x; x <= end.x + 1e-9; x += spacing) {
    for (let y = start.y; y <= end.y + 1e-9; y += spacing) {
      for (let z = start.z; z <= end.z + 1e-9; z += spacing) {
        const p = new THREE.Vector3(x, y, z);
        const m = new THREE.Mesh(sphereGeo, matBase.clone());
        m.position.copy(p);
        m.userData._voxelId = `vox_${idCounter++}`;
        m.userData._selected = false;
        voxelGroup.add(m);
        voxelMeshes.push(m);
      }
    }
  }
  scene.add(voxelGroup);
  console.log('Voxel grid created:', voxelMeshes.length);
}

/* ---------- voxel selection / assignment ---------- */
function toggleVoxelSelection(mesh) {
  if (!mesh || mesh.userData._selected === undefined) return;
  const waiter = selectedEdges.find(e => e.panelMeta && (e.panelMeta.waitForVoxel === 'A' || e.panelMeta.waitForVoxel === 'B'));
  if (waiter) {
    const which = waiter.panelMeta.waitForVoxel;
    assignVoxelToEdgeStart(waiter, which, mesh,false);
    waiter.panelMeta.waitForVoxel = null;
    renderSelectionsList();
    return;
  }
  if (mesh.userData._selected) {
    const id = mesh.userData._voxelId;
    removeVoxelById(id);
  } else {
    mesh.material.color.setHex(0xff8c00);
    mesh.userData._selected = true;
    const vobj = { id: mesh.userData._voxelId, mesh, pos: mesh.position.clone() };
    selectedVoxels.push(vobj);
    addSequenceEntry('voxel', vobj, vobj.id, mesh.position.clone());
  }
}
function assignVoxelToEdgeStart(edgeObj, which, mesh, addSequence = true) {
  if (!mesh) return;
  if (!mesh.userData._selected) {
    mesh.material.color.setHex(0xff8c00);
    mesh.userData._selected = true;
    const exists = selectedVoxels.find(v => v.id === mesh.userData._voxelId);
    if (!exists) {
      const vobj = { id: mesh.userData._voxelId, mesh: mesh, pos: mesh.position.clone() };
      selectedVoxels.push(vobj);
      if (addSequence){
        addSequenceEntry('voxel', vobj, vobj.id, mesh.position.clone());
      }
    }else{
      if (addSequence) {
        const exists = selectedVoxels.find(v => v.id === mesh.userData._voxelId);
        if (!exists) {
          const vobj = { id: mesh.userData._voxelId, mesh: mesh, pos: mesh.position.clone() };
          selectedVoxels.push(vobj);
          addSequenceEntry('voxel', vobj, vobj.id, mesh.position.clone());
        }
      }
    }
  }
  const pos = mesh.position.clone();
  if (which === 'A') edgeObj.startA = pos.clone(); else edgeObj.startB = pos.clone();
  renderSelectionsList();
}
function removeVoxelById(id) {
  const idx = selectedVoxels.findIndex(v => v.id === id);
  if (idx !== -1) {
    const v = selectedVoxels[idx];
    try { v.mesh.material.color.setHex(0x999999); } catch (e) { }
    v.mesh.userData._selected = false;
    selectedVoxels.splice(idx, 1);
  }
  removeSequenceEntryById(id);
}

/* ---------- load OBJ handler ---------- */
if (fileInput) {
  fileInput.addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        clearAll();
        const loader = new OBJLoader();
        const obj = loader.parse(e.target.result);
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        obj.traverse(ch => {
          if (ch.isMesh) {
            ch.geometry = ch.geometry.clone();
            ch.geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
            pickMeshes.push(ch);
            buildVisualsFromGeometry(ch.geometry);
          }
        });
        loadedObject = obj; scene.add(obj); if (fileNameLabel) fileNameLabel.textContent = f.name; zoomToFit(obj);
        createVoxelGridForObject(pickMeshes, VOXEL_RESOLUTION);
      } catch (err) { console.error(err); alert('Failed to load OBJ: ' + (err && err.message)); }
    };
    reader.readAsText(f);
  });
}
function zoomToFit(object3d) {
  if (!object3d) return;
  const box = new THREE.Box3().setFromObject(object3d);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * Math.PI / 180;
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
  cameraZ *= 1.6;
  camera.position.set(center.x, center.y, center.z + cameraZ);
  controls.target.copy(center); controls.update();
}

/* ---------- interaction: click (Shift: global start, Alt: voxel select, Ctrl: edge toggle) ---------- */
renderer.domElement.addEventListener('click', ev => {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  if (ev.shiftKey) {
    const originCam = camera.position.clone();
    const ndc = new THREE.Vector3(mouse.x, mouse.y, 0.5).unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const dTarget = camera.position.distanceTo(controls.target || new THREE.Vector3());
    const placeDist = Math.max(0.5, dTarget * 0.6);
    globalStartPoint = originCam.clone().add(dir.multiplyScalar(placeDist));
    if (globalStartMarker) { scene.remove(globalStartMarker); disposeObject(globalStartMarker); }
    globalStartMarker = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshBasicMaterial({ color: 0x8b00ff }));
    globalStartMarker.position.copy(globalStartPoint); scene.add(globalStartMarker);
    if (startGlobalInfo) startGlobalInfo.textContent = `Global start: (${fmt(globalStartPoint.x)}, ${fmt(globalStartPoint.y)}, ${fmt(globalStartPoint.z)})`;
    return;
  }

  if (ev.altKey) {
    if (!voxelGroup) return;
    const hits = raycaster.intersectObjects(voxelGroup.children, false);
    if (hits.length === 0) return;
    const hit = hits[0];
    const mesh = hit.object;
    toggleVoxelSelection(mesh);
    return;
  }

  if (!(ev.ctrlKey || ev.metaKey)) return;
  if (!edgeLines) return;
  const hits = raycaster.intersectObject(edgeLines, false);
  if (hits.length === 0) return;
  const hit = hits[0];
  const posAttr = edgeLines.geometry.getAttribute('position');
  let bestA = null, bestB = null, bestD = Infinity;
  for (let i = 0; i < posAttr.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(posAttr, i);
    const b = new THREE.Vector3().fromBufferAttribute(posAttr, i + 1);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const d = mid.distanceTo(hit.point);
    if (d < bestD) { bestD = d; bestA = a.clone(); bestB = b.clone(); }
  }
  if (!bestA || !bestB) return;
  const id = edgeIdForPoints(bestA, bestB);
  const already = selectedEdges.find(e => e.id === id);
  if (already) {
    removeEdgeById(id);
    return;
  }

  function nearestVM(pt) {
    let best = null, bd = Infinity;
    vertexMeshes.forEach(m => { const d = m.position.distanceTo(pt); if (d < bd) { bd = d; best = m; } });
    return best;
  }
  const vA = nearestVM(bestA), vB = nearestVM(bestB);
  if (!vA || !vB) { alert('Could not find vertex meshes for selected edge.'); return; }

  // highlight vertex spheres (ensure unique material)
  [vA, vB].forEach(vm => {
    if (vm.userData._prevColor === undefined) vm.userData._prevColor = vm.material.color.getHex();
    if (vm.userData._baseScale === undefined) vm.userData._baseScale = vm.scale.x || 1;
    vm.material = vm.material.clone();
    vm.material.color.setHex(0xff8c00);
    vm.scale.setScalar(1.6);
    vm.userData._selected = true;
  });

  const numA = createTextSprite('A'); numA.position.copy(vA.position).add(new THREE.Vector3(0, 0.12, 0)); numA.scale.setScalar(0.5); scene.add(numA); selectedLabels.push(numA);
  const numB = createTextSprite('B'); numB.position.copy(vB.position).add(new THREE.Vector3(0, 0.12, 0)); numB.scale.setScalar(0.5); scene.add(numB); selectedLabels.push(numB);

  const edgeObj = {
    id,
    aMesh: vA, bMesh: vB,
    aPos: vA.position.clone(), bPos: vB.position.clone(),
    startA: null, startB: null,
    manualOuterA: false, manualOuterB: false,
    panelMeta: { waitForVoxel: null },
    highlightLine: null,
    _order: null,
    _orderSprite: null
  };

  const highlightLine = createEdgeHighlight(edgeObj.aPos, edgeObj.bPos);
  scene.add(highlightLine);
  edgeObj.highlightLine = highlightLine;

  selectedEdges.push(edgeObj);
  const mid = edgeObj.aPos.clone().add(edgeObj.bPos).multiplyScalar(0.5);
  addSequenceEntry('edge', edgeObj, id, mid);
});

/* ---------- per-edge UI and list rendering ---------- */
function renderSelectionsList() {
  if (!edgesListContainer) return;
  edgesListContainer.innerHTML = '';
  selectionSequence.forEach((sel, idx) => {
    const order = idx + 1;
    if (sel.type === 'voxel') {
      const v = sel.ref;
      const wrapper = document.createElement('div');
      wrapper.className = 'item-card';
      const title = document.createElement('div'); title.style.fontWeight = '700'; title.textContent = `# ${order} AirPoint ${order}:`; wrapper.appendChild(title);
      const coord = document.createElement('div'); coord.className = 'coords'; coord.style.marginTop = '6px'; coord.textContent = `Air_point: (${fmt(v.pos.x)}, ${fmt(v.pos.y)}, ${fmt(v.pos.z)})`; wrapper.appendChild(coord);
      const removeBtn = document.createElement('button'); removeBtn.className = 'ctrl-btn'; removeBtn.style.marginTop = '8px'; removeBtn.textContent = 'Remove AirPoint';
      removeBtn.addEventListener('click', () => { removeVoxelById(v.id); });
      wrapper.appendChild(removeBtn);
      edgesListContainer.appendChild(wrapper);
    } else if (sel.type === 'edge') {
      const e = sel.ref;
      const wrapper = document.createElement('div');
      wrapper.className = 'item-card';
      const title = document.createElement('div'); title.style.fontWeight = '700'; title.textContent = `#${order} Edge ${selectedEdges.indexOf(e) + 1}:`; wrapper.appendChild(title);
      const coordsA = document.createElement('div'); coordsA.className = 'coords'; coordsA.style.marginTop = '6px'; coordsA.textContent = `A: (${fmt(e.aPos.x)}, ${fmt(e.aPos.y)}, ${fmt(e.aPos.z)})`; wrapper.appendChild(coordsA);
      const coordsB = document.createElement('div'); coordsB.className = 'coords'; coordsB.textContent = `B: (${fmt(e.bPos.x)}, ${fmt(e.bPos.y)}, ${fmt(e.bPos.z)})`; wrapper.appendChild(coordsB);

      const rowA = document.createElement('div');
      rowA.style.display = 'flex'; rowA.style.gap = '6px'; rowA.style.marginTop = '8px';
      rowA.innerHTML = `
        <div style="flex:1">
          <label class="muted" style="display:block;font-size:12px">Start A (x,y,z)</label>
          <input placeholder="x" style="width:96px;padding:6px;border-radius:6px;border:1px solid #ddd" />
          <input placeholder="y" style="width:96px;padding:6px;border-radius:6px;border:1px solid #ddd;margin-left:6px" />
          <input placeholder="z" style="width:96px;padding:6px;border-radius:6px;border:1px solid #ddd;margin-left:6px" />
        </div>
        <div style="display:flex;flex-direction:column;justify-content:center;align-items:flex-end;">
          <label style="font-size:12px"><input type="checkbox" /> Outer-X</label>
          <button class="ctrl-btn sel-vox-btn" style="margin-top:6px;height:34px;padding:6px 10px;font-size:12px">Select from voxel grid (A)</button>
        </div>
      `;
      wrapper.appendChild(rowA);

      const rowB = document.createElement('div');
      rowB.style.display = 'flex'; rowB.style.gap = '6px'; rowB.style.marginTop = '8px';
      rowB.innerHTML = `
        <div style="flex:1">
          <label class="muted" style="display:block;font-size:12px">Start B (x,y,z)</label>
          <input placeholder="x" style="width:96px;padding:6px;border-radius:6px;border:1px solid #ddd" />
          <input placeholder="y" style="width:96px;padding:6px;border-radius:6px;border:1px solid #ddd;margin-left:6px" />
          <input placeholder="z" style="width:96px;padding:6px;border-radius:6px;border:1px solid #ddd;margin-left:6px" />
        </div>
        <div style="display:flex;flex-direction:column;justify-content:center;align-items:flex-end;">
          <label style="font-size:12px"><input type="checkbox" /> Outer-X</label>
          <button class="ctrl-btn sel-vox-btn" style="margin-top:6px;height:34px;padding:6px 10px;font-size:12px">Select from voxel grid (B)</button>
        </div>
      `;
      wrapper.appendChild(rowB);

      const removeBtn = document.createElement('button'); removeBtn.className = 'ctrl-btn'; removeBtn.style.marginTop = '8px'; removeBtn.textContent = 'Remove Edge';
      removeBtn.addEventListener('click', () => { removeEdgeById(e.id); });
      wrapper.appendChild(removeBtn);

      const aInputs = rowA.querySelectorAll('input[placeholder]');
      const aOuterCheckbox = rowA.querySelector('input[type=checkbox]');
      const aSelBtn = rowA.querySelector('.sel-vox-btn');

      const bInputs = rowB.querySelectorAll('input[placeholder]');
      const bOuterCheckbox = rowB.querySelector('input[type=checkbox]');
      const bSelBtn = rowB.querySelector('.sel-vox-btn');

      if (e.startA) { aInputs[0].value = fmt(e.startA.x); aInputs[1].value = fmt(e.startA.y); aInputs[2].value = fmt(e.startA.z); }
      if (e.startB) { bInputs[0].value = fmt(e.startB.x); bInputs[1].value = fmt(e.startB.y); bInputs[2].value = fmt(e.startB.z); }
      aOuterCheckbox.checked = !!e.manualOuterA;
      bOuterCheckbox.checked = !!e.manualOuterB;

      function readVecFromInputs(list) {
        const x = parseFloat(list[0].value), y = parseFloat(list[1].value), z = parseFloat(list[2].value);
        if (isFinite(x) && isFinite(y) && isFinite(z)) return new THREE.Vector3(x, y, z);
        return null;
      }
      aInputs.forEach(inp => inp.addEventListener('change', () => { e.startA = readVecFromInputs(aInputs); }));
      bInputs.forEach(inp => inp.addEventListener('change', () => { e.startB = readVecFromInputs(bInputs); }));
      aOuterCheckbox.addEventListener('change', () => { e.manualOuterA = aOuterCheckbox.checked; });
      bOuterCheckbox.addEventListener('change', () => { e.manualOuterB = bOuterCheckbox.checked; });

      aSelBtn.addEventListener('click', () => {
        clearAllWaitForVoxelFlags();
        e.panelMeta.waitForVoxel = (e.panelMeta.waitForVoxel === 'A') ? null : 'A';
        renderSelectionsList();
      });
      bSelBtn.addEventListener('click', () => {
        clearAllWaitForVoxelFlags();
        e.panelMeta.waitForVoxel = (e.panelMeta.waitForVoxel === 'B') ? null : 'B';
        renderSelectionsList();
      });

      edgesListContainer.appendChild(wrapper);
    }
  });
}
function clearAllWaitForVoxelFlags() {
  selectedEdges.forEach(e => { if (e.panelMeta) e.panelMeta.waitForVoxel = null; });
  renderSelectionsList();
}

/* ---------- remove edge ---------- */
function removeEdgeById(id) {
  const idx = selectedEdges.findIndex(e => e.id === id);
  if (idx === -1) {
    removeSequenceEntryById(id);
    return;
  }
  const edge = selectedEdges[idx];
  [edge.aMesh, edge.bMesh].forEach(m => {
    if (!m) return;
    if (m.userData._prevColor !== undefined) { m.material.color.setHex(m.userData._prevColor); delete m.userData._prevColor; }
    if (m.userData._baseScale !== undefined) { m.scale.setScalar(m.userData._baseScale); delete m.userData._baseScale; }
    delete m.userData._selected;
  });
  if (edge.highlightLine) { scene.remove(edge.highlightLine); disposeObject(edge.highlightLine); edge.highlightLine = null; }
  selectedEdges.splice(idx, 1);
  removeSequenceEntryById(id);
  renderSelectionsList();

}

/* ---------- showPacket (visualize computed packet) ---------- */
function showPacket(name, pkt) {
  if (!pkt) return;
  if (!axisMarkersGroup) axisMarkersGroup = new THREE.Group();
  if (!dashedGroup) dashedGroup = new THREE.Group();

  const baseColorsInner = { X: 0xff0000, Y: 0x00a65a, Z: 0x0066ff };
  const baseColorsOuterX = { X: 0xff2e00, Y: 0x00a65a, Z: 0x00d0ff };
  const colors = pkt.isOuterX ? baseColorsOuterX : baseColorsInner;

  // start marker
  const startColor = pkt.isOuterX ? 0xb91c1c : 0x2563eb;
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 12), new THREE.MeshBasicMaterial({ color: startColor }));
  s.position.copy(pkt.start); axisMarkersGroup.add(s);

  // helper for normal axis drawing (dashed to touch, red to raw, markers + label)
  const drawAxis = (axisKey, color) => {
    const touch = pkt[`touch_${axisKey}`], raw = pkt[`raw_${axisKey}`];
    if (!touch || !raw) return;

    // dashed start → touch
    const geom = new THREE.BufferGeometry().setFromPoints([pkt.start.clone(), touch.clone()]);
    const mat = new THREE.LineDashedMaterial({ color: 0x666666, dashSize: 0.12, gapSize: 0.22 });
    const dashed = new THREE.Line(geom, mat); dashed.computeLineDistances(); dashedGroup.add(dashed);

    // solid red start → raw
    const g2 = new THREE.BufferGeometry().setFromPoints([pkt.start.clone(), raw.clone()]);
    const l2 = new THREE.Line(g2, new THREE.LineBasicMaterial({ color: 0xff0000 })); axisMarkersGroup.add(l2);

    // collide and search markers
    const hitS = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    hitS.position.copy(raw); axisMarkersGroup.add(hitS);

    const spS = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color }));
    spS.position.copy(touch); axisMarkersGroup.add(spS);

    // label
    const label = createTextSprite(`${name}:${axisKey} → (${fmt(touch.x)}, ${fmt(touch.y)}, ${fmt(touch.z)})`, 84, 'white');
    label.position.copy(pkt.start.clone().add(touch).multiplyScalar(0.5)).add(new THREE.Vector3(0, 0.05, 0));
    label.scale.setScalar(0.42);
    axisMarkersGroup.add(label); selectedLabels.push(label);
  };

  // Draw Z and Y normally
  drawAxis('Z', colors.Z);
  drawAxis('Y', colors.Y);

  // X: normal or 3-step outer
  if (!pkt.isOuterX) {
    drawAxis('X', colors.X);
  } else {
    const c1 = 0xffd34d, c2 = 0xff7b00, c3 = 0x7c3aed; // Step1, Step2, Step3
    if (pkt.xSteps) {
      // Step1: start → step1 (outward X with YZ locked)
      const g1 = new THREE.BufferGeometry().setFromPoints([pkt.start.clone(), pkt.xSteps.step1.clone()]);
      axisMarkersGroup.add(new THREE.Line(g1, new THREE.LineBasicMaterial({ color: c1 })));

      // Step2: step1 → step2 (pure Z)
      const g2 = new THREE.BufferGeometry().setFromPoints([pkt.xSteps.step1.clone(), pkt.xSteps.step2.clone()]);
      axisMarkersGroup.add(new THREE.Line(g2, new THREE.LineBasicMaterial({ color: c2 })));

      // Step3: step2 → touch_X (purple)
      const g3 = new THREE.BufferGeometry().setFromPoints([pkt.xSteps.step2.clone(), pkt.touch_X.clone()]);
      axisMarkersGroup.add(new THREE.Line(g3, new THREE.LineBasicMaterial({ color: c3 })));

      // raw (red) from step2 → raw_X
      const gRaw = new THREE.BufferGeometry().setFromPoints([pkt.xSteps.step2.clone(), pkt.raw_X.clone()]);
      axisMarkersGroup.add(new THREE.Line(gRaw, new THREE.LineBasicMaterial({ color: 0xff0000 })));
    }

    // markers for X
    const hitS = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    hitS.position.copy(pkt.raw_X); axisMarkersGroup.add(hitS);

    const spS = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: colors.X }));
    spS.position.copy(pkt.touch_X); axisMarkersGroup.add(spS);

    const label = createTextSprite(`${name}:X → (${fmt(pkt.touch_X.x)}, ${fmt(pkt.touch_X.y)}, ${fmt(pkt.touch_X.z)})`, 84, 'white');
    label.position.copy(pkt.xSteps.step2.clone().add(pkt.touch_X).multiplyScalar(0.5)).add(new THREE.Vector3(0, 0.05, 0));
    label.scale.setScalar(0.42);
    axisMarkersGroup.add(label); selectedLabels.push(label);
  }

  // add groups to scene if not already
  if (!scene.children.includes(dashedGroup)) scene.add(dashedGroup);
  if (!scene.children.includes(axisMarkersGroup)) scene.add(axisMarkersGroup);
}


/* ---------- compute (path plan) ---------- */
if (btnCompute) {
  btnCompute.addEventListener('click', () => {
    try {
      if (selectedEdges.length === 0) {
        alert('Select one or more edges (Ctrl/Cmd+Click edges) to compute.');
        return;
      }
      if (axisMarkersGroup) { axisMarkersGroup.children.forEach(disposeObject); scene.remove(axisMarkersGroup); axisMarkersGroup = null; }
      if (dashedGroup) { dashedGroup.children.forEach(disposeObject); scene.remove(dashedGroup); dashedGroup = null; }
      axisMarkersGroup = new THREE.Group(); dashedGroup = new THREE.Group();
      const basis = { x: currentBasis.x.clone(), y: currentBasis.y.clone(), z: currentBasis.z.clone() };
      const pathPlanEntries = [];
      for (const edgeObj of selectedEdges) {
        const originA = edgeObj.startA ? edgeObj.startA.clone() : (globalStartPoint ? globalStartPoint.clone() : (starts.A ? starts.A.clone() : null));
        const originB = edgeObj.startB ? edgeObj.startB.clone() : (globalStartPoint ? globalStartPoint.clone() : (starts.B ? starts.B.clone() : null));
        if (!originA || !originB) { alert('Select the edge and input the values).'); return; }
        const packetA = computePacketForEndpoint(originA, edgeObj.aPos.clone(), pickMeshes, basis, { forceOuter: !!edgeObj.manualOuterA });
        const packetB = computePacketForEndpoint(originB, edgeObj.bPos.clone(), pickMeshes, basis, { forceOuter: !!edgeObj.manualOuterB });
        showPacket(`Edge`, packetA); showPacket(`Edge`, packetB);
        pathPlanEntries.push(buildPathPlanEntry(packetA, `edge_${edgeObj.id}_A`, v3(edgeObj.aPos), v3(edgeObj.bPos)));
        pathPlanEntries.push(buildPathPlanEntry(packetB, `edge_${edgeObj.id}_B`, v3(edgeObj.aPos), v3(edgeObj.bPos)));
      }
      lastResultJSON = lastResultJSON || { data: { welding_data: { edges: {}, path_plan: [], selections: [] } } };
      lastResultJSON.data.welding_data.path_plan = pathPlanEntries;
      if (computeStatus) computeStatus.textContent = `Computed for ${selectedEdges.length} edge(s).`;
      scene.add(dashedGroup); scene.add(axisMarkersGroup);
      renderSelectionsList();
      console.log('lastResultJSON', lastResultJSON);
    } catch (err) {
      console.error('Compute failed:', err);
      alert('Compute failed — see console for details: ' + (err && err.message));
    }
  });
}

/* ---------- buildPathPlanEntry / packet functions ---------- */
function buildPathPlanEntry(pkt, name = "Mock_edge", pointsA, pointsB) {
  const startCommon = v3(pkt.start);
  const startX = (pkt.isOuterX && pkt.xSteps) ? v3(pkt.xSteps.step2) : startCommon;
  const defaultTorchStart = [1, 0, 0, 0], defaultTorchEnd = [1, 0, 0, 0];
  if (pkt.isOuterX && pkt.xSteps) {
    return {
      edge: name,
      id: "",
      buffer_point: [],
      torch_angle: [],
      touch_order: ['x', 'z', 'y'],
      Outer: true,
      touch_path: {
        x: { start_point: startCommon, end_point: v3(pkt.touch_Z), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd },
        y: { start_point: startX, end_point: v3(pkt.touch_X), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd },
        z: { start_point: startCommon, end_point: v3(pkt.touch_Y), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd }
      }
    };
  } else {
    return {
      edge: name,
      id: "",
      buffer_point: [],
      torch_angle: [],
      touch_order: ['x', 'z', 'y'],
      Outer: false,
      touch_path: {
        x: { start_point: startCommon, end_point: v3(pkt.touch_X), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd },
        y: { start_point: startX, end_point: v3(pkt.touch_Z), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd },
        z: { start_point: startCommon, end_point: v3(pkt.touch_Y), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd }
      }
    };
  }
}
function computePacketForEndpoint(startOrigin, endpointPos, targets, basis, flags) {
  const sceneBox = computeCombinedBox(targets);
  const INF = 5000;
  const diag = sceneBox ? sceneBox.getSize(new THREE.Vector3()).length() : INF;
  const pz = computeAxisSearchFrom(startOrigin, basis.z, targets, sceneBox, diag, INF);
  let px, xStepsInfo = null, isOuterX = false;
  if (flags.forceOuter) {
    isOuterX = true;
    const x3 = computeXOuterThreeStep(startOrigin, endpointPos, basis, targets, sceneBox, diag, INF, pz.rawCollision.clone());
    px = { rawCollision: x3.rawCollision, search_point: x3.search_point };
    xStepsInfo = { step1: x3.step1, step2: x3.step2 };
  } else px = computeAxisSearchFrom(startOrigin, basis.x, targets, sceneBox, diag, INF);
  const py = computeAxisSearchFrom(startOrigin, basis.y, targets, sceneBox, diag, INF);
  return {
    start: startOrigin.clone(),
    touch_X: px.search_point.clone(), raw_X: px.rawCollision.clone(),
    touch_Y: py.search_point.clone(), raw_Y: py.rawCollision.clone(),
    touch_Z: pz.search_point.clone(), raw_Z: pz.rawCollision.clone(),
    isOuterX,
    xSteps: xStepsInfo
  };
}

let quats_hard = null;

/* ---------- send to vision (build payload & de-dup) ---------- */
if (btnSendToVision) {
  btnSendToVision.addEventListener('click', async () => {
    console.log('SendToVision clicked');
    if (!lastResultJSON) { alert('Compute or select some points first.'); return; }
    let counter = 0;
    // const VISION_SERVER = 'http://192.168.31.58:5002';
    const payload = { frame: 'base', data: { cycle_id: `PNC_${Date.now()}`, project_id: 'PNC_MANUAL' }, segments: [] };
    const arrToXYZObject = arr => ({ x: Number(arr[0]), y: Number(arr[1]), z: Number(arr[2]) });
    const pathPlan = lastResultJSON?.data?.welding_data?.path_plan || [];

    const processedEdgeIds = new Set(); // avoid double-processing same geometric edge
    let lastAddedEndKey = null; // track last appended endpoint to avoid duplicating connected edges

    for (const sel of selectionSequence) {
      if (sel.type === 'edge') {
        // if this edge id was already processed (selected twice) skip it
        if (processedEdgeIds.has(sel.id)) continue;
        processedEdgeIds.add(sel.id);

        // canonicalized keys for endpoints to check connectivity
        const aPos = sel.ref.aPos.clone();
        const bPos = sel.ref.bPos.clone();
        const aKey = `${aPos.x.toFixed(4)}_${aPos.y.toFixed(4)}_${aPos.z.toFixed(4)}`;
        const bKey = `${bPos.x.toFixed(4)}_${bPos.y.toFixed(4)}_${bPos.z.toFixed(4)}`;

        // names used in pathPlan entries
        const nameA = `edge_${sel.id}_A`;
        const nameB = `edge_${sel.id}_B`;

        // find matching entries exactly matching A or B
        const matching = pathPlan.filter(p => p.edge === nameA || p.edge === nameB);

        // If previous appended end equals this edge's A, treat as connected: only push B.
        // Otherwise (not connected) push both A and B if present in pathPlan.
        const shouldOnlyAddB = (lastAddedEndKey !== null && lastAddedEndKey === aKey);

        if (shouldOnlyAddB) {
          // Only push the B entry (if present)
          const entryB = matching.find(p => p.edge === nameB);
          if (entryB) {
            const touchPath = entryB.touch_path || {};
            const outer = !!entryB.Outer;
            const orderAxes = outer ? ['z', 'x', 'y'] : ['z', 'y', 'x'];
            for (const axis of orderAxes) {
              const tp = touchPath[axis];
              if (!tp?.start_point || !tp?.end_point) continue;
              counter++;
              if (counter <= 6) quats_hard = [0.41883, -0.34532, -0.83349, -0.10312];
              else if (counter > 6 && counter <= 12) quats_hard = [0.18237, -0.86618, -0.25317, -0.39037];
              else if (counter > 12 && counter <= 18) quats_hard = [-0.11640, -0.82168, 0.37309, -0.41484];
              else if (counter > 18 && counter <= 24) quats_hard = [-0.38700, -0.26871, 0.86149, -0.18936];

              payload.segments.push({
                start: arrToXYZObject(tp.start_point),
                end: arrToXYZObject(tp.end_point),
                q: quats_hard,
                touchsense: true
              });
            }
            // update lastAddedEndKey to this edge's B so next selection knows we're connected here
            lastAddedEndKey = bKey;
          }
        } else {
          // Not connected: push A (if present) then B (if present)
          // push A
          const entryA = matching.find(p => p.edge === nameA);
          if (entryA) {
            const touchPath = entryA.touch_path || {};
            const outer = !!entryA.Outer;
            const orderAxes = outer ? ['z', 'x', 'y'] : ['z', 'y', 'x'];
            for (const axis of orderAxes) {
              const tp = touchPath[axis];
              if (!tp?.start_point || !tp?.end_point) continue;
              counter++;
              if (counter <= 6) quats_hard = [0.41883, -0.34532, -0.83349, -0.10312];
              else if (counter > 6 && counter <= 12) quats_hard = [0.18237, -0.86618, -0.25317, -0.39037];
              else if (counter > 12 && counter <= 18) quats_hard = [-0.11640, -0.82168, 0.37309, -0.41484];
              else if (counter > 18 && counter <= 24) quats_hard = [-0.38700, -0.26871, 0.86149, -0.18936];

              payload.segments.push({
                start: arrToXYZObject(tp.start_point),
                end: arrToXYZObject(tp.end_point),
                q: quats_hard,
                touchsense: true
              });
            }
            // after adding A, set lastAddedEndKey to A's end (which for an edge is B) — keep consistent with previous behaviour
            lastAddedEndKey = aKey; // note: we keep A key here so that if we only added A it's clear; we'll overwrite to B after adding B below
          }

          // push B
          const entryB = matching.find(p => p.edge === nameB);
          if (entryB) {
            const touchPath = entryB.touch_path || {};
            const outer = !!entryB.Outer;
            const orderAxes = outer ? ['z', 'x', 'y'] : ['z', 'y', 'x'];
            for (const axis of orderAxes) {
              const tp = touchPath[axis];
              if (!tp?.start_point || !tp?.end_point) continue;
              counter++;
              if (counter <= 6) quats_hard = [0.41883, -0.34532, -0.83349, -0.10312];
              else if (counter > 6 && counter <= 12) quats_hard = [0.18237, -0.86618, -0.25317, -0.39037];
              else if (counter > 12 && counter <= 18) quats_hard = [-0.11640, -0.82168, 0.37309, -0.41484];
              else if (counter > 18 && counter <= 24) quats_hard = [-0.38700, -0.26871, 0.86149, -0.18936];

              payload.segments.push({
                start: arrToXYZObject(tp.start_point),
                end: arrToXYZObject(tp.end_point),
                q: quats_hard,
                touchsense: true
              });
            }
            // update lastAddedEndKey to this edge's B so next selection knows we're connected here
            lastAddedEndKey = bKey;
          }
        }
      } else if (sel.type === 'voxel') {
        const c = sel.ref.pos || { x: 0, y: 0, z: 0 };
        payload.segments.push({ start: { x: c.x, y: c.z, z: c.y }, q: [0.18237, -0.86618, -0.25317, -0.39037], touchsense: false });
        // mark lastAddedEndKey to this voxel's position so a following edge A==this voxel will be considered connected
        lastAddedEndKey = `${c.x.toFixed(4)}_${c.y.toFixed(4)}_${c.z.toFixed(4)}`;
      }
    }

    // If nothing built
    if (!payload.segments.length) { alert('No segments built — check selections.'); return; }

    // --- DEDUPE consecutive / duplicate segments (by start+end+touchsense) ---
    function segKey(s) {
      // start always expected
      const sx = (s.start && isFinite(s.start.x)) ? Number(s.start.x).toFixed(4) : 'NaN';
      const sy = (s.start && isFinite(s.start.y)) ? Number(s.start.y).toFixed(4) : 'NaN';
      const sz = (s.start && isFinite(s.start.z)) ? Number(s.start.z).toFixed(4) : 'NaN';

      // end may be absent for voxels — use a special token when missing
      let ex = '__NOEND__', ey = '__NOEND__', ez = '__NOEND__';
      if (s.end && isFinite(s.end.x) && isFinite(s.end.y) && isFinite(s.end.z)) {
        ex = Number(s.end.x).toFixed(4);
        ey = Number(s.end.y).toFixed(4);
        ez = Number(s.end.z).toFixed(4);
      }

      const touchFlag = s.touchsense ? '1' : '0';
      return `${sx},${sy},${sz}|${ex},${ey},${ez}|${touchFlag}`;
    }

    const seen = new Set();
    const deduped = [];
    for (const seg of payload.segments) {
      const k = segKey(seg);
      if (!seen.has(k)) {
        seen.add(k);
        deduped.push(seg);
      } else {
        // duplicate — skipped.
      }
    }
    payload.segments = deduped;


    try {
      const response = await fetch(`${VISION_SERVER}/api/welding_data`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), mode: 'cors' });
      const text = await response.text().catch(() => '<no body>');
      if (response.ok) { alert('✅ Sent to vision server!'); console.log('Response:', text); } else { alert('❌ Failed to send: ' + response.status + ' ' + response.statusText); console.error('POST failed', { status: response.status, body: text }); }
    } catch (err) { alert('❌ Error while sending: ' + err.message); console.error(err); }
  });
}

/* ---------- export ---------- */
if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (!lastResultJSON) {
      alert('Nothing to export — compute selections first.');
      return;
    }
    try {
      const json = JSON.stringify(lastResultJSON, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'welding_data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      console.log('Exported welding_data.json');
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed — see console.');
    }
  });
}

/* ---------- voxel toggle button ---------- */
let voxelsVisible = true;

if (btnToggleVoxels) {
  btnToggleVoxels.addEventListener('click', () => {
    voxelsVisible = !voxelsVisible;
    if (voxelGroup) voxelGroup.visible = voxelsVisible;
    btnToggleVoxels.textContent = voxelsVisible ? 'Hide Voxel Grid' : 'Show Voxel Grid';
    btnToggleVoxels.classList.toggle('on', voxelsVisible);
  });
}

/* ---------- Responsive sidebar / draggable resizer ---------- */
/* Add a resizer bar on the left edge of the right sidebar so user can drag to resize
   This uses inline styles so it works without modifying HTML/CSS files.
*/
(function makeSidebarResizable() {
  if (!rightSidebar || !container) return;

  // create resizer element
  const resizer = document.createElement('div');
  resizer.style.position = 'absolute';
  resizer.style.left = '-6px';
  resizer.style.top = '0';
  resizer.style.bottom = '0';
  resizer.style.width = '12px';
  resizer.style.cursor = 'ew-resize';
  resizer.style.zIndex = '80';
  resizer.style.background = 'transparent';
  resizer.title = 'Drag to resize';

  // small visible handle
  const handle = document.createElement('div');
  handle.style.position = 'absolute';
  handle.style.left = '4px';
  handle.style.top = '50%';
  handle.style.transform = 'translateY(-50%)';
  handle.style.width = '4px';
  handle.style.height = '48px';
  handle.style.borderRadius = '3px';
  handle.style.background = 'rgba(15,23,42,0.06)';
  resizer.appendChild(handle);

  rightSidebar.style.position = 'fixed'; // ensure predictable positioning
  rightSidebar.style.top = `${document.getElementById('header')?.getBoundingClientRect().height || 68}px`;
  rightSidebar.style.right = '0';
  rightSidebar.style.bottom = '0';
  rightSidebar.style.width = rightSidebar.style.width || getComputedStyle(rightSidebar).width || '380px';
  rightSidebar.style.overflow = 'auto';
  rightSidebar.appendChild(resizer);

  let dragging = false;
  let startX = 0;
  let startW = 0;
  const minW = 200;
  const maxW = Math.max(320, Math.floor(window.innerWidth * 0.7));

  function onPointerDown(e) {
    dragging = true;
    startX = e.clientX || e.touches?.[0]?.clientX;
    startW = rightSidebar.getBoundingClientRect().width;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const dx = startX - clientX; // dragging left increases dx positive => increase width
    let newW = startW + dx;
    newW = Math.max(minW, Math.min(maxW, newW));
    rightSidebar.style.width = `${Math.round(newW)}px`;
    // update layout
    updateLayoutForSidebar();
  }
  function onPointerUp() {
    dragging = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onPointerMove);
  }

  resizer.addEventListener('pointerdown', onPointerDown);
  // support touch via pointer events already
})();

/* ---------- resize + animate ---------- */
/* Responsive sidebar/canvas helper */
let sidebarVisible = true;
function updateLayoutForSidebar() {
  const headerH = document.getElementById('header')?.getBoundingClientRect().height || 68;
  const sidebarWidth = (sidebarVisible && rightSidebar) ? rightSidebar.getBoundingClientRect().width : 0;
  const availW = Math.max(200, Math.floor(window.innerWidth - sidebarWidth));
  const availH = Math.max(200, window.innerHeight - headerH);

  if (renderer && renderer.domElement) {
    renderer.setSize(availW, availH);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.left = '0px';
    renderer.domElement.style.top = headerH + 'px';
  }
  if (camera) {
    camera.aspect = availW / availH;
    camera.updateProjectionMatrix();
  }

  if (sidebarToggle) {
    if (sidebarVisible) {
      const sidebarW = rightSidebar ? rightSidebar.getBoundingClientRect().width : 360;
      sidebarToggle.style.transform = 'translateX(8px)';
      sidebarToggle.style.right = (sidebarW - 36) + 'px';
      const ic = document.getElementById('sidebar-toggle-icon'); if (ic) ic.setAttribute('d', 'M9 6l6 6-6 6');
    } else {
      sidebarToggle.style.right = '12px';
      const ic = document.getElementById('sidebar-toggle-icon'); if (ic) ic.setAttribute('d', 'M15 6l-6 6 6 6');
    }
  }
}
window.addEventListener('resize', () => { updateLayoutForSidebar(); });

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => {
    sidebarVisible = !sidebarVisible;
    if (rightSidebar) rightSidebar.style.display = sidebarVisible ? 'block' : 'none';
    updateLayoutForSidebar();
  });
}

// call once to size renderer correctly initially
updateLayoutForSidebar();

/* animation loop */
(function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();
