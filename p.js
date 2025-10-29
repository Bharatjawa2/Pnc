// app.js — Final corrected file: axis-permute -> real coords, camera compensation, and lift-to-grid

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

/* ---------- three.js (robust Z-up initialization) ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf8fafc);

// Defensive Z-up setup (handles different three.js builds)
(function ensureZUp() {
  const Z_UP = new THREE.Vector3(0,0,1);
  if (THREE && THREE.Object3D) {
    if (THREE.Object3D.DefaultUp && typeof THREE.Object3D.DefaultUp.set === 'function') {
      try { THREE.Object3D.DefaultUp.set(0,0,1); } catch(e){/*ignore*/ }
    } else if (THREE.Object3D.defaultUp && typeof THREE.Object3D.defaultUp.set === 'function') {
      try { THREE.Object3D.defaultUp.set(0,0,1); } catch(e){/*ignore*/ }
    } else {
      if (!THREE.Object3D.prototype.up) THREE.Object3D.prototype.up = Z_UP.clone();
    }
  } else {
    console.warn('THREE.Object3D not found when initializing Z-up.');
  }
})();

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.position.set(2,2,3);
if (camera && camera.up && typeof camera.up.set === 'function') camera.up.set(0,0,1);

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
if (controls) {
  if (controls.up && typeof controls.up.set === 'function') controls.up.set(0,0,1);
  else controls.up = new THREE.Vector3(0,0,1);
}

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6); dirLight.position.set(4,10,3); scene.add(dirLight);
scene.add(new THREE.GridHelper(10,10,0xe0e0e0,0xe0e0e0));

/* ---------- state ---------- */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let loadedObject = null;
let pickMeshes = [];
let vertexMeshes = [];
let edgeLines = null;
let currentHighlight = null;
let selectedVertexMeshes = []; // [A,B]
let selectedLabels = [];
let axisMarkersGroup = null;
let infiniteLinesGroup = null;
let dashedGroup = null;

let globalStartPoint = null;
let globalStartMarker = null;

const starts = { A: null, B: null };
const startMarkers = { A: null, B: null };
const manualOuter = { A: false, B: false };

/* ---------- basis (user) ---------- */
const currentBasis = {
  x: new THREE.Vector3(1, 0, 0),
  z: new THREE.Vector3(0, 0, 1),
  y: new THREE.Vector3()
};
selX.value = "+X"; selZ.value = "+Z";
currentBasis.y.copy(currentBasis.z).cross(currentBasis.x).normalize();
refreshBasisUI();
function fmt(n){ return (Math.round(n*1000)/1000).toFixed(3); }

/* ---------- UI helpers ---------- */
function vecFromSelectValue(val){
  switch(val){
    case '+X': return new THREE.Vector3(1,0,0);
    case '-X': return new THREE.Vector3(-1,0,0);
    case '+Y': return new THREE.Vector3(0,1,0);
    case '-Y': return new THREE.Vector3(0,-1,0);
    case '+Z': return new THREE.Vector3(0,0,1);
    case '-Z': return new THREE.Vector3(0,0,-1);
  } return new THREE.Vector3(1,0,0);
}
function refreshBasisUI(){
  xInfo.textContent = `(${currentBasis.x.x|0}, ${currentBasis.x.y|0}, ${currentBasis.x.z|0})`;
  zInfo.textContent = `(${currentBasis.z.x|0}, ${currentBasis.z.y|0}, ${currentBasis.z.z|0})`;
  yInfo.textContent = `(${currentBasis.y.x|0}, ${currentBasis.y.y|0}, ${currentBasis.y.z|0})`;
}
function updateBasisFromUI(){
  const bx = vecFromSelectValue(selX.value).clone().normalize();
  const bz = vecFromSelectValue(selZ.value).clone().normalize();
  if (bx.clone().cross(bz).length() < 1e-6){
    alert('X and Z are colinear — choose different.');
    selX.value = "+Y"; selZ.value = "-Z";
    currentBasis.x.set(0,1,0); currentBasis.z.set(0,0,-1);
  } else {
    currentBasis.x.copy(bx); currentBasis.z.copy(bz);
  }
  currentBasis.y.copy(currentBasis.x).cross(currentBasis.z).normalize();
  refreshBasisUI();
}
selX.addEventListener('change', updateBasisFromUI);
selZ.addEventListener('change', updateBasisFromUI);
refreshBasisUI();

/* ---------- AXIS PERMUTE MATRIX (Three -> your real-world) ---------- */
/*
  Your convention:
    +X = inward, -X = outward
    +Y = left,   -Y = right
    +Z = up,     -Z = down

  From earlier reasoning:
    Xr = -three.z
    Yr = -three.x
    Zr =  three.y

  So the matrix (applied to geometry positions) is:
    [ 0  0 -1  0
     -1  0  0  0
      0  1  0  0
      0  0  0  1 ]
*/
const AXIS_PERMUTE_MATRIX = new THREE.Matrix4().set(
   0,  0, -1, 0,
  -1,  0,  0, 0,
   0,  1,  0, 0,
   0,  0,  0, 1
);

/* ---------- three <-> real converters (after permutation they match) ---------- */
function threeToReal(vec3){
  if(!vec3) return null;
  // After geometry permutation, reading mesh positions gives [Xr, Yr, Zr] directly
  return [ Number(vec3.x), Number(vec3.y), Number(vec3.z) ];
}
function realToThree(arr){
  if(!Array.isArray(arr) || arr.length < 3) return null;
  return new THREE.Vector3(Number(arr[0]), Number(arr[1]), Number(arr[2]));
}

/* ---------- small helpers ---------- */
function disposeObject(obj){
  if(!obj) return;
  if(obj.geometry) obj.geometry.dispose();
  if(obj.material){
    if(Array.isArray(obj.material)) obj.material.forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); });
    else { if(obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
  }
}
function clearSelectionVisuals(){
  if(currentHighlight){ scene.remove(currentHighlight); disposeObject(currentHighlight); currentHighlight=null; }
  selectedLabels.forEach(s=>{ scene.remove(s); if(s.material && s.material.map) s.material.map.dispose(); if(s.material) s.material.dispose(); });
  selectedLabels = [];
  selectedVertexMeshes.forEach(m=>{
    if(m.userData._prevColor!==undefined){ m.material.color.setHex(m.userData._prevColor); delete m.userData._prevColor; }
    if(m.userData._baseScale!==undefined){ m.scale.setScalar(m.userData._baseScale); delete m.userData._baseScale; }
    delete m.userData._selected;
  });
  selectedVertexMeshes = [];
  if(axisMarkersGroup){ axisMarkersGroup.children.forEach(c=>disposeObject(c)); scene.remove(axisMarkersGroup); axisMarkersGroup=null; }
  if(infiniteLinesGroup){ infiniteLinesGroup.children.forEach(c=>disposeObject(c)); scene.remove(infiniteLinesGroup); infiniteLinesGroup=null; }
  if(dashedGroup){ dashedGroup.children.forEach(c=>disposeObject(c)); scene.remove(dashedGroup); dashedGroup=null; }
}
function clearAll(){
  clearSelectionVisuals();
  if(edgeLines){ scene.remove(edgeLines); disposeObject(edgeLines); edgeLines=null; }
  vertexMeshes.forEach(m=>{ scene.remove(m); disposeObject(m); }); vertexMeshes=[];
  pickMeshes=[]; if(loadedObject){ scene.remove(loadedObject); loadedObject=null; }
  fileNameLabel.textContent='No file loaded';
  if(globalStartMarker){ scene.remove(globalStartMarker); disposeObject(globalStartMarker); globalStartMarker=null; globalStartPoint=null; }
  startGlobalInfo.textContent='—';
  ['A','B'].forEach(k=>{
    if(startMarkers[k]){ scene.remove(startMarkers[k]); disposeObject(startMarkers[k]); startMarkers[k]=null; }
    starts[k]=null; manualOuter[k]=false;
    document.getElementById(`start${k}-x`).value = '';
    document.getElementById(`start${k}-y`).value = '';
    document.getElementById(`start${k}-z`).value = '';
    document.getElementById(`start${k}-info`).textContent='—';
    document.getElementById(`chk${k}-outer`).checked = false;
  });
}

/* ---------- geometry helpers ---------- */
function computeCombinedBox(objects){
  if(!objects || objects.length===0) return null;
  const box = new THREE.Box3(); let init=false;
  objects.forEach(o=>{ o.updateWorldMatrix(true,false); const b=new THREE.Box3().setFromObject(o); if(!init){ box.copy(b); init=true; } else box.union(b); });
  return init?box:null;
}
function firstHitAlong(origin, dir, targets){
  raycaster.set(origin, dir);
  let hits=[]; for(const m of targets) hits = hits.concat(raycaster.intersectObject(m, true));
  hits = hits.filter(h=>h.distance>1e-6);
  return hits.length ? hits[0] : null;
}
function intersectSceneBox(origin, dir, sceneBox) {
  if (!sceneBox) return null;
  const ray = new THREE.Ray(origin, dir.clone().normalize());
  const p = new THREE.Vector3();
  const hit = ray.intersectBox(sceneBox, p);
  return hit ? p.clone() : null;
}
function computeBuffer(hitDist, diag, INF){
  const minBufFactor=0.02, maxBufFactor=0.5;
  const minBuf=Math.max(1e-4, diag*minBufFactor);
  const maxBuf=Math.max(minBuf, diag*maxBufFactor);
  let preferred = hitDist*0.4;
  let buffer = Math.min(Math.max(preferred, minBuf), maxBuf);
  if(hitDist > INF*0.9) buffer = Math.min(buffer, INF*0.2);
  return buffer;
}

/* ---------- core single-step (X, Y, Z) ---------- */
function computeAxisSearchFrom(origin, axisDir, targets, sceneBox, diag, INF){
  const dirPos = axisDir.clone().normalize();
  const dirNeg = dirPos.clone().negate();
  const hp = firstHitAlong(origin, dirPos, targets);
  const hn = firstHitAlong(origin, dirNeg, targets);
  let chosen = null;
  if(hp && hn) chosen = (hp.distance <= hn.distance) ? {hit:hp, dir:dirPos} : {hit:hn, dir:dirNeg};
  else if(hp) chosen = {hit:hp, dir:dirPos};
  else if(hn) chosen = {hit:hn, dir:dirNeg};
  else {
    if(sceneBox){
      const rPos = new THREE.Ray(origin, dirPos), rNeg = new THREE.Ray(origin, dirNeg);
      const bPos = rPos.intersectBox(sceneBox,new THREE.Vector3());
      const bNeg = rNeg.intersectBox(sceneBox,new THREE.Vector3());
      if(bPos && bNeg){
        const dpos=bPos.distanceTo(origin), dneg=bNeg.distanceTo(origin);
        chosen = (dpos<=dneg) ? {hit:{point:bPos}, dir:dirPos} : {hit:{point:bNeg}, dir:dirNeg};
      } else if(bPos) chosen = {hit:{point:bPos}, dir:dirPos};
      else if(bNeg) chosen = {hit:{point:bNeg}, dir:dirNeg};
    }
    if(!chosen) chosen = {hit:{point: origin.clone().add(dirPos.clone().multiplyScalar(INF))}, dir:dirPos};
  }
  const raw = chosen.hit.point.clone();
  const dist = raw.clone().sub(origin).length();
  const buf = computeBuffer(dist, (sceneBox?sceneBox.getSize(new THREE.Vector3()).length():INF), INF);
  const search_point = raw.clone().add(chosen.dir.clone().multiplyScalar(buf));
  return { rawCollision: raw, search_point, dir: chosen.dir.clone(), buffer: buf };
}

/* ---------- X outer 3-step ---------- */
function computeXOuterThreeStep(
  startOrigin,
  endpointPos,
  basis,
  targets,
  sceneBox,
  diag,
  INF = 5000,
  collideXRawFromStart = null
){
  // basis: X = basis.x, Y = basis.y, Z = basis.z
  const X = basis.x.clone().normalize();
  const Y = basis.y.clone().normalize();

  // Determine "inward/outward" along Y (analogous to how you previously did for X)
  const hitYplus  = firstHitAlong(startOrigin,  Y, targets);
  const hitYminus = firstHitAlong(startOrigin,  Y.clone().negate(), targets);
  let inwardYDir;
  if (hitYplus && hitYminus)
    inwardYDir = (hitYplus.distance <= hitYminus.distance) ? Y : Y.clone().negate();
  else if (hitYplus)  inwardYDir = Y;
  else if (hitYminus) inwardYDir = Y.clone().negate();
  else                inwardYDir = Y; // fallback
  const outwardYDir = inwardYDir.clone().negate();

  // ---------- STEP 1: outward along Y (XZ locked to endpoint) ----------
  // We try to intersect the scene bounding box along outwardYDir to get a reasonable step;
  // otherwise take a long ray in that direction (INF * 0.3).
  const outBox = intersectSceneBox(startOrigin, outwardYDir, sceneBox);
  let step1;
  if (outBox) {
    const extra = Math.max(diag * 0.05, 5);
    step1 = outBox.clone().add(outwardYDir.clone().multiplyScalar(extra));
  } else {
    step1 = startOrigin.clone().add(outwardYDir.clone().multiplyScalar(INF * 0.3));
  }

  // ---------- STEP 2: move in X direction toward the face (try to collide in X) ----------
  // If the caller provided an X collision hint (collideXRawFromStart), prefer it; otherwise compute.
  let collideXPoint = collideXRawFromStart;
  if (!collideXPoint) {
    // computeAxisSearchFrom will return a rawCollision on the X axis from step1
    const pxTmp = computeAxisSearchFrom(step1, X, targets, sceneBox, diag, INF);
    collideXPoint = pxTmp.rawCollision.clone();
  }

  // Move from step1 towards collideXPoint in X by a small EXTRA amount so we're slightly past the wall.
  const tStep1 = step1.dot(X);
  const tWallX = collideXPoint.dot(X);
  const deltaX  = tWallX - tStep1;
  const signX   = (deltaX >= 0) ? 1 : -1;
  const EXTRA_X_MM = 2.0;
  const moveXMag   = Math.abs(deltaX) + EXTRA_X_MM;
  const step2 = step1.clone().add(X.clone().multiplyScalar(signX * moveXMag));

  // ---------- STEP 3: from step2, cast along ±Y to find best Y collision (try to collide in Y) ----------
  const projY = p => p.dot(Y);
  const yEnd  = projY(endpointPos);

  const hitYFromStep2_Plus  = firstHitAlong(step2,  Y, targets);
  const hitYFromStep2_Minus = firstHitAlong(step2,  Y.clone().negate(), targets);

  let chosenHit = null, chosenDir = null;
  if (hitYFromStep2_Plus && hitYFromStep2_Minus) {
    const yPlus  = projY(hitYFromStep2_Plus.point);
    const yMinus = projY(hitYFromStep2_Minus.point);
    const ePlus  = Math.abs(yPlus  - yEnd);
    const eMinus = Math.abs(yMinus - yEnd);
    // prefer the one whose projection is closer to endpoint's Y projection; tie-break on distance
    if (ePlus < eMinus || (ePlus === eMinus && hitYFromStep2_Plus.distance <= hitYFromStep2_Minus.distance)) {
      chosenHit = hitYFromStep2_Plus; chosenDir = Y;
    } else {
      chosenHit = hitYFromStep2_Minus; chosenDir = Y.clone().negate();
    }
  } else if (hitYFromStep2_Plus) {
    chosenHit = hitYFromStep2_Plus; chosenDir = Y;
  } else if (hitYFromStep2_Minus) {
    chosenHit = hitYFromStep2_Minus; chosenDir = Y.clone().negate();
  } else {
    // No direct ±Y hit from step2 — try scene box intersection along ±Y
    const altPlus  = intersectSceneBox(step2,  Y, sceneBox);
    const altMinus = intersectSceneBox(step2,  Y.clone().negate(), sceneBox);
    if (altPlus || altMinus) {
      const p = altPlus ? altPlus : altMinus;
      const d = altPlus ? Y : Y.clone().negate();
      const rawCollision = p.clone();
      const search_point = rawCollision.clone().add(d.multiplyScalar(5.0));
      return { step1, step2, rawCollision, search_point };
    }
    // No Y collision available — warn and return step2 as fallback
    console.warn('No ±Y collision from step2; geometry may be open or unreachable.');
    return { step1, step2, rawCollision: step2.clone(), search_point: step2.clone() };
  }

  // Successful Y collision chosen
  const rawCollision = chosenHit.point.clone();
  const search_point = rawCollision.clone().add(chosenDir.multiplyScalar(5.0));
  return { step1, step2, rawCollision, search_point };
}

/* ---------- packet computation ---------- */
function computePacketForEndpoint(startOrigin, endpointPos, targets, basis, flags){
  const sceneBox = computeCombinedBox(targets);
  const INF = 5000;
  const diag = sceneBox ? sceneBox.getSize(new THREE.Vector3()).length() : INF;

  const pz = computeAxisSearchFrom(startOrigin, basis.z, targets, sceneBox, diag, INF);

  let px, xStepsInfo=null, isOuterX=false;
  if (flags.forceOuter) {
    isOuterX = true;
    const x3 = computeXOuterThreeStep(
      startOrigin,
      endpointPos,
      basis,
      targets,
      sceneBox,
      diag,
      INF,
      pz.rawCollision.clone()
    );
    px = { rawCollision: x3.rawCollision, search_point: x3.search_point };
    xStepsInfo = { step1: x3.step1, step2: x3.step2 };
  } else {
    px = computeAxisSearchFrom(startOrigin, basis.x, targets, sceneBox, diag, INF);
  }

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

/* ---------- visuals ---------- */
function createTextSprite(text, fontSize=140, fill='white'){
  const canvas = document.createElement('canvas'); const s=256; canvas.width=s; canvas.height=s;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,s,s);
  ctx.font = `bold ${fontSize}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.lineWidth = Math.max(6, Math.floor(fontSize*0.08)); ctx.strokeStyle='rgba(0,0,0,0.85)'; ctx.strokeText(text, s/2, s/2);
  ctx.fillStyle = fill; ctx.fillText(text, s/2, s/2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map:tex, depthTest:true, depthWrite:false });
  const sprite = new THREE.Sprite(mat); sprite.userData._tex = tex; return sprite;
}
function drawLeg(a,b,color){
  const g = new THREE.BufferGeometry().setFromPoints([a,b]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent:true, opacity:1 }));
  axisMarkersGroup.add(l);
}
function showPacket(name, pkt){
  if(!axisMarkersGroup) axisMarkersGroup = new THREE.Group();
  if(!dashedGroup) dashedGroup = new THREE.Group();

  const baseColorsInner = { X:0xff0000, Y:0x00a65a, Z:0x0066ff };
  const baseColorsOuterX = { X:0xff2e00, Y:0x00a65a, Z:0x00d0ff };
  const colors = pkt.isOuterX ? baseColorsOuterX : baseColorsInner;

  const startColor = pkt.isOuterX ? 0xb91c1c : 0x2563eb;
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.058,14,12), new THREE.MeshBasicMaterial({ color:startColor }));
  s.position.copy(pkt.start); axisMarkersGroup.add(s);

  const drawAxis = (axisKey, color) => {
    const touch = pkt[`touch_${axisKey}`], raw = pkt[`raw_${axisKey}`];

    const geom = new THREE.BufferGeometry().setFromPoints([ pkt.start.clone(), touch.clone() ]);
    const mat  = new THREE.LineDashedMaterial({ color:0x666666, dashSize:0.12, gapSize:0.22 });
    const dashed = new THREE.Line(geom, mat); dashed.computeLineDistances(); dashedGroup.add(dashed);

    const g2 = new THREE.BufferGeometry().setFromPoints([ pkt.start.clone(), raw.clone() ]);
    const l2 = new THREE.Line(g2, new THREE.LineBasicMaterial({ color:0xff0000 })); axisMarkersGroup.add(l2);

    const hitS = new THREE.Mesh(new THREE.SphereGeometry(0.04,12,10), new THREE.MeshBasicMaterial({ color:0xff0000 })); 
    hitS.position.copy(raw); axisMarkersGroup.add(hitS);

    const spS  = new THREE.Mesh(new THREE.SphereGeometry(0.045,12,10),new THREE.MeshBasicMaterial({ color })); 
    spS.position.copy(touch); axisMarkersGroup.add(spS);

    const label = createTextSprite(`${name}:${axisKey} → (${fmt(touch.x)}, ${fmt(touch.y)}, ${fmt(touch.z)})`, 84, 'white');
    label.position.copy(pkt.start.clone().add(touch).multiplyScalar(0.5)).add(new THREE.Vector3(0,0.05,0)); 
    label.scale.setScalar(0.42);
    axisMarkersGroup.add(label); selectedLabels.push(label);
  };

  drawAxis('Z', colors.Z);
  drawAxis('Y', colors.Y);

  if (!pkt.isOuterX) {
    drawAxis('X', colors.X);
  } else {
    const c1 = 0xffd34d, c2 = 0xff7b00, c3 = 0x7c3aed;
    if (pkt.xSteps) {
      const g1 = new THREE.BufferGeometry().setFromPoints([ pkt.start.clone(), pkt.xSteps.step1.clone() ]);
      axisMarkersGroup.add(new THREE.Line(g1, new THREE.LineBasicMaterial({ color:c1 })));

      const g2 = new THREE.BufferGeometry().setFromPoints([ pkt.xSteps.step1.clone(), pkt.xSteps.step2.clone() ]);
      axisMarkersGroup.add(new THREE.Line(g2, new THREE.LineBasicMaterial({ color:c2 })));

      const g3 = new THREE.BufferGeometry().setFromPoints([ pkt.xSteps.step2.clone(), pkt.touch_X.clone() ]);
      axisMarkersGroup.add(new THREE.Line(g3, new THREE.LineBasicMaterial({ color:c3 })));

      const gRaw = new THREE.BufferGeometry().setFromPoints([ pkt.xSteps.step2.clone(), pkt.raw_X.clone() ]);
      axisMarkersGroup.add(new THREE.Line(gRaw, new THREE.LineBasicMaterial({ color:0xff0000 })));
    }

    const hitS = new THREE.Mesh(new THREE.SphereGeometry(0.04,12,10), new THREE.MeshBasicMaterial({ color:0xff0000 })); 
    hitS.position.copy(pkt.raw_X); axisMarkersGroup.add(hitS);

    const spS  = new THREE.Mesh(new THREE.SphereGeometry(0.045,12,10), new THREE.MeshBasicMaterial({ color:colors.X })); 
    spS.position.copy(pkt.touch_X); axisMarkersGroup.add(spS);

    const label = createTextSprite(`${name}:X → (${fmt(pkt.touch_X.x)}, ${fmt(pkt.touch_X.y)}, ${fmt(pkt.touch_X.z)})`, 84, 'white');
    label.position.copy(pkt.xSteps.step2.clone().add(pkt.touch_X).multiplyScalar(0.5)).add(new THREE.Vector3(0,0.05,0)); 
    label.scale.setScalar(0.42);
    axisMarkersGroup.add(label); selectedLabels.push(label);
  }

  scene.add(dashedGroup);
  scene.add(axisMarkersGroup);
}

/* ---------- build visuals from geometry (creates per-vertex helper spheres) ---------- */
function buildVisualsFromGeometry(g){
  const pos = g.getAttribute('position'); if(!pos) return;
  const edgesGeom = new THREE.EdgesGeometry(g,1);
  const edgesMat = new THREE.LineBasicMaterial({ color:0x111827 });
  // If there is an existing edgeLines object, remove it (we only keep the latest)
  if(edgeLines){ scene.remove(edgeLines); disposeObject(edgeLines); edgeLines = null; }
  edgeLines = new THREE.LineSegments(edgesGeom, edgesMat);
  scene.add(edgeLines);

  const sphereGeo = new THREE.SphereGeometry(0.06,14,12);
  for(let i=0;i<pos.count;i++){
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color:0xf97316 }));
    mesh.position.copy(v); mesh.userData._baseScale=1; scene.add(mesh); vertexMeshes.push(mesh);
  }
}

/* ---------- load OBJ (apply axis permutation to geometry data) ---------- */
fileInput.addEventListener('change', ev=>{
  const f = ev.target.files && ev.target.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      clearAll();
      const loader = new OBJLoader();
      const obj = loader.parse(e.target.result);

      // 1) Apply axis-permute to each mesh geometry BEFORE centering.
      obj.traverse(ch=>{
        if(ch.isMesh){
          ch.geometry = ch.geometry.clone();
          ch.geometry.applyMatrix4(AXIS_PERMUTE_MATRIX); // permute coords to your real-world frame
          if (ch.geometry.attributes.normal) ch.geometry.computeVertexNormals();
          pickMeshes.push(ch);
        }
      });

      // 2) Compute bounding box & center from transformed object and translate meshes to center
      const boxBeforeCenter = new THREE.Box3().setFromObject(obj);
      console.log('IMPORT DEBUG: bbox BEFORE centering:', boxBeforeCenter);

      const center = boxBeforeCenter.getCenter(new THREE.Vector3());
      // Translate geometry to center at origin
      obj.traverse(ch=>{
        if(ch.isMesh){
          ch.geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z));
        }
      });

      // 3) Build visuals (edges + vertex helper spheres) from transformed & centered geometry
      obj.traverse(ch=>{
        if(ch.isMesh){
          buildVisualsFromGeometry(ch.geometry);
        }
      });

      // 4) compute bbox after centering and lift to grid if needed
      const bboxAfterCenter = new THREE.Box3().setFromObject(obj);
      console.log('IMPORT DEBUG: bbox AFTER centering (before lift):', bboxAfterCenter);

      // Compute how much to lift along Z so min.z === 0
      const minZ = bboxAfterCenter.min.z;
      const liftZ = (Number.isFinite(minZ) ? -minZ : 0);
      const liftVec = new THREE.Vector3(0,0,liftZ);

      // 5) Add object and visuals to scene (object position will be modified below)
      loadedObject = obj; scene.add(obj);
      fileNameLabel.textContent = f.name;

      // 6) Apply lift to object + helper visuals so model sits on grid z=0
      if (Math.abs(liftZ) > 1e-6) {
        obj.position.add(liftVec); // move mesh instances inside obj
        // Move edgeLines and vertex markers (they are independent objects in scene)
        if (edgeLines) edgeLines.position.add(liftVec);
        vertexMeshes.forEach(m => m.position.add(liftVec));
        // Also move any start/global markers so they maintain relative placement
        if (globalStartMarker) globalStartMarker.position.add(liftVec);
        if (startMarkers.A) startMarkers.A.position.add(liftVec);
        if (startMarkers.B) startMarkers.B.position.add(liftVec);
        console.log(`IMPORT DEBUG: lifted model by ${liftZ.toFixed(4)} along +Z so min.z -> 0`);
      }

      // 7) Final bbox after lift for debugging & camera fitting
      const bboxFinal = new THREE.Box3().setFromObject(obj);
      console.log('IMPORT DEBUG: FINAL bbox after lift:', bboxFinal);

      // 8) Zoom camera to fit the model (based on final box)
      zoomToFit(obj);

      // 9) COMPENSATE CAMERA so the visual orientation matches the ORIGINAL OBJ (pre-permute)
      //    We apply the SAME permutation matrix to the camera position and controls.target
      //    relative to the object's center so the view looks identical to the un-permuted import.
      //    Use the final center (after lift).
      const centerFinal = bboxFinal.getCenter(new THREE.Vector3());
      (function compensateCameraForAxisPermute(centerPt){
        const m = AXIS_PERMUTE_MATRIX;
        const camRel = camera.position.clone().sub(centerPt);
        camRel.applyMatrix4(m);
        camera.position.copy(camRel.add(centerPt));
        const tgtRel = controls.target.clone().sub(centerPt);
        tgtRel.applyMatrix4(m);
        controls.target.copy(tgtRel.add(centerPt));
        if (camera.up && typeof camera.up.set === 'function') camera.up.set(0,0,1);
        if (controls.up && typeof controls.up.set === 'function') controls.up.set(0,0,1);
        controls.update();
      })(centerFinal);

      // done
    }catch(err){ console.error(err); alert('Failed to load OBJ: '+(err&&err.message)); }
  };
  reader.readAsText(f);
});

function zoomToFit(object3d){
  if(!object3d) return;
  const box = new THREE.Box3().setFromObject(object3d);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x,size.y,size.z);
  const fov = camera.fov * Math.PI/180;
  let cameraZ = Math.abs(maxDim/2 / Math.tan(fov/2));
  cameraZ *= 1.6;
  camera.position.set(center.x, center.y, center.z + cameraZ);
  controls.target.copy(center); controls.update();
}

/* ---------- interaction (Shift+Click global start, Ctrl+Click edge selection) ---------- */
renderer.domElement.addEventListener('click', ev=>{
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((ev.clientX - rect.left)/rect.width)*2 - 1;
  mouse.y = -((ev.clientY - rect.top)/rect.height)*2 + 1;
  raycaster.setFromCamera(mouse, camera);

  if(ev.shiftKey){
    const originCam = camera.position.clone();
    const ndc = new THREE.Vector3(mouse.x, mouse.y, 0.5).unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const dTarget = camera.position.distanceTo(controls.target);
    const placeDist = Math.max(0.5, dTarget * 0.6);
    globalStartPoint = originCam.clone().add(dir.multiplyScalar(placeDist));
    if(globalStartMarker){ scene.remove(globalStartMarker); disposeObject(globalStartMarker); }
    globalStartMarker = new THREE.Mesh(new THREE.SphereGeometry(0.05,12,10), new THREE.MeshBasicMaterial({ color:0x8b00ff }));
    globalStartMarker.position.copy(globalStartPoint); scene.add(globalStartMarker);
    startGlobalInfo.textContent = `Global start: (${fmt(globalStartPoint.x)}, ${fmt(globalStartPoint.y)}, ${fmt(globalStartPoint.z)})`;
    return;
  }

  // --- improved edge-pick block (replace the original Ctrl/Cmd selection code) ---
if(!(ev.ctrlKey || ev.metaKey)) return;
if(!edgeLines) return;

// make raycaster easier to hit thin lines (in world units)
if (!raycaster.params) raycaster.params = {};
if (!raycaster.params.Line) raycaster.params.Line = {};
raycaster.params.Line.threshold = 0.06; // increase if needed (0.06 ~ 6cm depending on units)

// intersect edge line segments
const hits = raycaster.intersectObject(edgeLines, false);
if (hits.length === 0) return;
const hit = hits[0];

// helper: read positions from the LineSegments geometry and convert each endpoint to world-space
const posAttr = edgeLines.geometry.getAttribute('position');
if (!posAttr) return;

let bestA = null, bestB = null, bestD = Infinity;
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), mid = new THREE.Vector3();
for (let i = 0; i < posAttr.count; i += 2) {
  tmpA.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  tmpB.set(posAttr.getX(i+1), posAttr.getY(i+1), posAttr.getZ(i+1));
  // transform local-space points to world-space (accounts for edgeLines.obj/obj transforms)
  edgeLines.localToWorld(tmpA);
  edgeLines.localToWorld(tmpB);
  mid.copy(tmpA).add(tmpB).multiplyScalar(0.5);
  const d = mid.distanceTo(hit.point);
  if (d < bestD) { bestD = d; bestA = tmpA.clone(); bestB = tmpB.clone(); }
}
if (!bestA || !bestB) return;

clearSelectionVisuals();

// highlight the selected segment (use world-space points)
const geo = new THREE.BufferGeometry().setFromPoints([bestA, bestB]);
currentHighlight = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff6b00 }));
scene.add(currentHighlight);

// nearest vertex-marker: find the vertex helper whose world position is nearest to each endpoint
function nearestVMWorld(pt) {
  let best = null, bd = Infinity;
  const tmp = new THREE.Vector3();
  vertexMeshes.forEach(m => {
    m.getWorldPosition(tmp);
    const d = tmp.distanceTo(pt);
    if (d < bd) { bd = d; best = m; }
  });
  return best;
}

const vA = nearestVMWorld(bestA), vB = nearestVMWorld(bestB);
const purple = 0x7c3aed;
[vA, vB].forEach((vm, idx) => {
  if(!vm) return;
  vm.userData._prevColor = vm.material.color.getHex();
  vm.userData._baseScale = vm.scale.x || 1;
  vm.material.color.setHex(purple);
  vm.scale.setScalar(1.8);
  vm.userData._selected = true;
  selectedVertexMeshes.push(vm);

  const tag = idx === 0 ? 'A' : 'B';
  const num = createTextSprite(tag);
  // use vm.getWorldPosition to place the label correctly in world-space
  const wp = new THREE.Vector3();
  vm.getWorldPosition(wp);
  num.position.copy(wp).add(new THREE.Vector3(0,0.15,0));
  num.scale.setScalar(0.6); scene.add(num); selectedLabels.push(num);

  const coords = createTextSprite(`(${fmt(wp.x)}, ${fmt(wp.y)}, ${fmt(wp.z)})`, 88, 'white');
  coords.position.copy(wp).add(new THREE.Vector3(0,0.35,0));
  coords.scale.setScalar(0.45); scene.add(coords); selectedLabels.push(coords);
});

computeStatus.textContent = 'Edge selected. Set Start A/B (or use global).';

});

/* ---------- Set start by coordinate (A/B) ---------- */
function setStartFromInputs(which){
  const xs = document.getElementById(`start${which}-x`).value;
  const ys = document.getElementById(`start${which}-y`).value;
  const zs = document.getElementById(`start${which}-z`).value;
  const x = parseFloat(xs), y = parseFloat(ys), z = parseFloat(zs);
  if(!isFinite(x) || !isFinite(y) || !isFinite(z)){
    alert(`Start ${which}: please enter valid numbers`);
    return;
  }
  const p = new THREE.Vector3(x,y,z);
  starts[which] = p;
  manualOuter[which] = document.getElementById(`chk${which}-outer`).checked; // now means "Outer-X"
  if(startMarkers[which]){ scene.remove(startMarkers[which]); disposeObject(startMarkers[which]); }
  const col = manualOuter[which] ? 0xb91c1c : 0x2563eb; // outer=red-ish, inner=blue-ish
  startMarkers[which] = new THREE.Mesh(new THREE.SphereGeometry(0.055,12,10), new THREE.MeshBasicMaterial({ color: col }));
  startMarkers[which].position.copy(p); scene.add(startMarkers[which]);
  document.getElementById(`start${which}-info`).textContent = `(${fmt(x)}, ${fmt(y)}, ${fmt(z)}) ${manualOuter[which] ? '· OUTER-X' : '· INNER'}`;
}
btnSetStartA.addEventListener('click', ()=>setStartFromInputs('A'));
btnSetStartB.addEventListener('click', ()=>setStartFromInputs('B'));
chkAOuter.addEventListener('change', ()=>{ manualOuter.A = chkAOuter.checked; if(starts.A && startMarkers.A){ startMarkers.A.material.color.setHex(manualOuter.A?0xb91c1c:0x2563eb); }});
chkBOuter.addEventListener('change', ()=>{ manualOuter.B = chkBOuter.checked; if(starts.B && startMarkers.B){ startMarkers.B.material.color.setHex(manualOuter.B?0xb91c1c:0x2563eb); }});

/* ---------- All-axis infinite (optional visual) ---------- */
let modeAll=false, modeHit=false;
function updateButtons(){ btnAll.classList.toggle('on', modeAll); btnHit.classList.toggle('on', modeHit); }
function createAllAxisLinesForSelection(){
  if(infiniteLinesGroup){ infiniteLinesGroup.children.forEach(disposeObject); scene.remove(infiniteLinesGroup); infiniteLinesGroup=null; }
  infiniteLinesGroup = new THREE.Group();
  const len=5000, colors={x:0xff0000,y:0x00a65a,z:0x0066ff};
  const dirs=[{n:'x',v:currentBasis.x},{n:'y',v:currentBasis.y},{n:'z',v:currentBasis.z}];
  selectedVertexMeshes.forEach(vm=>{
    dirs.forEach(d=>{
      const p=vm.position.clone(), dir=d.v.clone().normalize();
      const g1=new THREE.BufferGeometry().setFromPoints([p,p.clone().add(dir.clone().multiplyScalar(len))]);
      const g2=new THREE.BufferGeometry().setFromPoints([p,p.clone().add(dir.clone().multiplyScalar(-len))]);
      const l1=new THREE.Line(g1,new THREE.LineBasicMaterial({ color:colors[d.n],transparent:true,opacity:0.9 }));
      const l2=new THREE.Line(g2,new THREE.LineBasicMaterial({ color:colors[d.n],transparent:true,opacity:0.9 }));
      infiniteLinesGroup.add(l1,l2);
    });
  });
  scene.add(infiniteLinesGroup);
}
btnAll.addEventListener('click', ()=>{
  modeAll = !modeAll; if(modeAll) modeHit=false; updateButtons();
  if(selectedVertexMeshes.length){
    if(axisMarkersGroup){ axisMarkersGroup.children.forEach(disposeObject); scene.remove(axisMarkersGroup); axisMarkersGroup=null; }
    if(infiniteLinesGroup){ infiniteLinesGroup.children.forEach(disposeObject); scene.remove(infiniteLinesGroup); infiniteLinesGroup=null; }
    if(modeAll) createAllAxisLinesForSelection();
  }
});
btnHit.addEventListener('click', ()=>{
  modeHit = !modeHit; if(modeHit) modeAll=false; updateButtons();
  computeStatus.textContent = modeHit ? 'Use "Compute 8 Points" to see results.' : '—';
});

/* ---------- Compute & export (uses threeToReal for real-world coords) ---------- */
let lastResultJSON = null;

function buildPathPlanEntry(pkt, name = "Mock_edge") {
  const startCommon_real = threeToReal(pkt.start);
  const startX_three = (pkt.isOuterX && pkt.xSteps) ? pkt.xSteps.step2 : pkt.start;
  const startX_real = threeToReal(startX_three);

  const defaultTorchStart = [1, 0, 0, 0];
  const defaultTorchEnd   = [1, 0, 0, 0];

  return {
    edge: name,
    id: "",
    buffer_point: [],
    torch_angle: [],
    touch_order: ['x','z','y'],
    touch_path: {
      x: { start_point: startX_real, end_point: threeToReal(pkt.touch_X), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd },
      y: { start_point: startCommon_real, end_point: threeToReal(pkt.touch_Y), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd },
      z: { start_point: startCommon_real, end_point: threeToReal(pkt.touch_Z), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd }
    }
  };
}

btnCompute.addEventListener('click', ()=>{
  try {
    if(selectedVertexMeshes.length !== 2){
      alert('Select one edge (Ctrl/Cmd+Click) to get its two endpoints A/B.');
      return;
    }
    const origins = { A: starts.A || globalStartPoint, B: starts.B || globalStartPoint };
    if(!origins.A || !origins.B){
      alert('Provide Start A and Start B (in fields) or set a global start (Shift+Click).');
      return;
    }

    if(axisMarkersGroup){ axisMarkersGroup.children.forEach(disposeObject); scene.remove(axisMarkersGroup); axisMarkersGroup=null; }
    if(dashedGroup){ dashedGroup.children.forEach(disposeObject); scene.remove(dashedGroup); dashedGroup=null; }
    axisMarkersGroup = new THREE.Group(); dashedGroup = new THREE.Group();

    const basis = { x: currentBasis.x.clone(), y: currentBasis.y.clone(), z: currentBasis.z.clone() };

    const endA = selectedVertexMeshes[0]?.position.clone();
    const endB = selectedVertexMeshes[1]?.position.clone();
    console.log("Point A: ",endA);
    console.log("Point B: ",endB);

    const packetA = computePacketForEndpoint(origins.A, endA, pickMeshes, basis, { forceOuter: !!manualOuter.A });
    const packetB = computePacketForEndpoint(origins.B, endB, pickMeshes, basis, { forceOuter: !!manualOuter.B });

    showPacket('A', packetA);
    showPacket('B', packetB);

    lastResultJSON = {
      data:{
        welding_data: {
          edges: {},
          path_plan: [
            buildPathPlanEntry(packetA, "Mock_edge"),
            buildPathPlanEntry(packetB, "Mock_edge")
          ]
        }
      }
    };

    computeStatus.textContent = 'Computed. Outer X uses 3-step (YZ locked at endpoint).';
    scene.add(dashedGroup); scene.add(axisMarkersGroup);
    console.log('lastResultJSON', lastResultJSON);

  } catch (err) {
    console.error('Compute failed:', err);
    alert('Compute failed — see console for details: ' + (err && err.message));
  }
});

btnExport.addEventListener('click', ()=>{
  if(!lastResultJSON){ alert('Compute first.'); return; }
  const blob = new Blob([JSON.stringify(lastResultJSON, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'weld_points.json'; a.click();
  URL.revokeObjectURL(url);
});

btnSendToVision.addEventListener('click', async () => {
  console.log('SendToVision clicked');
  if (!lastResultJSON) {
    alert('Compute first (no weld points yet).');
    console.warn('lastResultJSON is empty');
    return;
  }

  const VISION_SERVER = 'http://192.168.31.58:5002'; // adjust if needed

  const payload = {
    frame: 'base',
    data: { cycle_id: `PNC_${Date.now()}`, project_id: 'PNC_MANUAL' },
    segments: []
  };

  try {
    const pathPlan = (lastResultJSON && lastResultJSON.data && lastResultJSON.data.welding_data && lastResultJSON.data.welding_data.path_plan) || [];
    if (!Array.isArray(pathPlan) || pathPlan.length === 0) {
      alert('No path_plan entries found inside lastResultJSON — compute first.');
      return;
    }

    for (const entry of pathPlan) {
      const edgeName = entry.edge || '<unknown>';
      const touchPath = entry.touch_path || {};
      ['x','y','z'].forEach(axis => {
        const tp = touchPath[axis];
        if (!tp || !tp.start_point || !tp.end_point) return;
        payload.segments.push({
          edge: edgeName,
          axis: axis,
          start: tp.start_point,
          end: tp.end_point,
          q: tp.start_torch_angle || [1,0,0,0],
          touchsense: true,
        });
      });
    }

    if (!payload.segments.length) {
      alert('Payload has zero segments after building — check path_plan structure.');
      return;
    }

    const sendUrl = `${VISION_SERVER}/api/welding_data`;
    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors',
      body: JSON.stringify(payload)
    });

    let text;
    try { text = await response.text(); } catch (e) { text = '<no body>'; }
    console.log('SendToVision status', response.status, response.statusText, 'body:', text);

    if (response.ok) {
      alert('✅ Sent to vision server!');
    } else {
      alert('❌ Failed to send: ' + response.status + ' ' + response.statusText + '\nSee console for details.');
    }
  } catch (err) {
    alert('❌ Error while sending: ' + (err && err.message));
    console.error('Error in SendToVision:', err);
  }
});

/* ---------- resize + animate ---------- */
window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
(function animate(){ requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();
