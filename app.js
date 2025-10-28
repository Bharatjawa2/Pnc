import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/* ---------- DOM ---------- */
const container = document.getElementById('canvas-container');
const fileInput = document.getElementById('file-input');
const fileNameLabel = document.getElementById('file-name');

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
const chkAOuter = document.getElementById('chkA-outer');

const startBInfo = document.getElementById('startB-info');
const chkBOuter = document.getElementById('chkB-outer');

const startGlobalInfo = document.getElementById('start-global-info');
const chkAutoStart = document.getElementById('chk-auto-start');

/* ---------- start inputs (Ax,Ay,Az, Bx,By,Bz) ---------- */
const startAx_x = document.getElementById('startAx-x');
const startAx_y = document.getElementById('startAx-y');
const startAx_z = document.getElementById('startAx-z');
const btnSetStartAx = document.getElementById('btn-set-startAx');

const startAy_x = document.getElementById('startAy-x');
const startAy_y = document.getElementById('startAy-y');
const startAy_z = document.getElementById('startAy-z');
const btnSetStartAy = document.getElementById('btn-set-startAy');

const startAz_x = document.getElementById('startAz-x');
const startAz_y = document.getElementById('startAz-y');
const startAz_z = document.getElementById('startAz-z');
const btnSetStartAz = document.getElementById('btn-set-startAz');

const startBx_x = document.getElementById('startBx-x');
const startBx_y = document.getElementById('startBx-y');
const startBx_z = document.getElementById('startBx-z');
const btnSetStartBx = document.getElementById('btn-set-startBx');

const startBy_x = document.getElementById('startBy-x');
const startBy_y = document.getElementById('startBy-y');
const startBy_z = document.getElementById('startBy-z');
const btnSetStartBy = document.getElementById('btn-set-startBy');

const startBz_x = document.getElementById('startBz-x');
const startBz_y = document.getElementById('startBz-y');
const startBz_z = document.getElementById('startBz-z');
const btnSetStartBz = document.getElementById('btn-set-startBz');

/* ---------- three.js ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf8fafc);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.position.set(2,2,3);
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

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
let selectedVertexMeshes = []; // [A,B] after selection
let selectedLabels = [];
let axisMarkersGroup = null;
let infiniteLinesGroup = null;
let dashedGroup = null;

let globalStartPoint = null;   // Shift+click start (in air)
let globalStartMarker = null;

// per-endpoint starts + markers + manual outer flags
// starts.A = { x:Vector3|null, y:Vector3|null, z:Vector3|null }
const starts = { A: {x:null,y:null,z:null}, B: {x:null,y:null,z:null} };
const startMarkers = { A: {x:null,y:null,z:null}, B: {x:null,y:null,z:null} };
const manualOuter = { A: false, B: false };

/* ---------- basis (user) ---------- */
const currentBasis = {
  x: new THREE.Vector3(1, 0, 0), // forward
  z: new THREE.Vector3(0, 0, 1),  // up
  y: new THREE.Vector3()          // left = x × z
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

/* ---------- small helpers ---------- */
function v3(v){ return [v.z, v.x, v.y]; } // small helper used by export builder

/* ---------- utils ---------- */
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
  // clear the six start inputs and markers
  ['A','B'].forEach(k=>{
    ['x','y','z'].forEach(a=>{
      if(startMarkers[k][a]){ scene.remove(startMarkers[k][a]); disposeObject(startMarkers[k][a]); startMarkers[k][a]=null; }
      starts[k][a]=null;
    });
    manualOuter[k]=false;
    document.getElementById(`start${k}-info`).textContent='—';
    document.getElementById(`chk${k}-outer`).checked = false;
  });
  // clear input fields (best-effort)
  const inputs = document.querySelectorAll('input[type="number"]');
  inputs.forEach(i=>i.value='');
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

/* ---------- X (outer) three-step (unchanged logic) ---------- */
function computeXOuterThreeStep(
  startOrigin,
  endpointPos,
  basis,
  targets,
  sceneBox,
  diag,
  INF = 5000,
  collideZRawFromStart = null
){
  const X = basis.x.clone().normalize();
  const Z = basis.z.clone().normalize();

  // determine inward/outward on X from start
  const hitXplus  = firstHitAlong(startOrigin,  X, targets);
  const hitXminus = firstHitAlong(startOrigin,  X.clone().negate(), targets);
  let inwardDir;
  if (hitXplus && hitXminus)
    inwardDir = (hitXplus.distance <= hitXminus.distance) ? X : X.clone().negate();
  else if (hitXplus)  inwardDir = X;
  else if (hitXminus) inwardDir = X.clone().negate();
  else                inwardDir = X;
  const outwardDir = inwardDir.clone().negate();

  // STEP 1: outward in X with YZ locked to endpoint
  const outBox = intersectSceneBox(startOrigin, outwardDir, sceneBox);
    let step1;
    if (outBox) {
        const extra = Math.max(diag * 0.05, 5);
        step1 = outBox.clone().add(outwardDir.clone().multiplyScalar(extra));
    }else{
        step1 = startOrigin.clone().add(outwardDir.clone().multiplyScalar(INF * 0.3));
    }

  // STEP 2: pure Z move to Z wall + 20 mm
  let collideZPoint = collideZRawFromStart;
  if (!collideZPoint) {
    const pzTmp = computeAxisSearchFrom(step1, Z, targets, sceneBox, diag, INF);
    collideZPoint = pzTmp.rawCollision.clone();
  }
  const tStep1 = step1.dot(Z);
  const tWallZ = collideZPoint.dot(Z);
  const delta  = tWallZ - tStep1;
  const sign   = (delta >= 0) ? 1 : -1;
  const EXTRA_Z_MM = 2.0;
  const moveZMag   = Math.abs(delta) + EXTRA_Z_MM;
  const step2 = step1.clone().add(Z.clone().multiplyScalar(sign * moveZMag));

  // STEP 3: ±X cast best matching endpoint.x
  const projX = p => p.dot(X);
  const xEnd  = projX(endpointPos);
  const hitPlus  = firstHitAlong(step2,  X, targets);
  const hitMinus = firstHitAlong(step2,  X.clone().negate(), targets);

  let chosenHit = null, chosenDir = null;
  if (hitPlus && hitMinus) {
    const xPlus  = projX(hitPlus.point);
    const xMinus = projX(hitMinus.point);
    const ePlus  = Math.abs(xPlus  - xEnd);
    const eMinus = Math.abs(xMinus - xEnd);
    if (ePlus < eMinus || (ePlus === eMinus && hitPlus.distance <= hitMinus.distance)) {
      chosenHit = hitPlus;  chosenDir = X;
    } else {
      chosenHit = hitMinus; chosenDir = X.clone().negate();
    }
  } else if (hitPlus)  { chosenHit = hitPlus;  chosenDir = X; }
    else if (hitMinus) { chosenHit = hitMinus; chosenDir = X.clone().negate(); }
    else {
      const altPlus  = intersectSceneBox(step2,  X, sceneBox);
      const altMinus = intersectSceneBox(step2,  X.clone().negate(), sceneBox);
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

/* ---------- Auto-start: analyze local faces and geometry ---------- */

function gatherLocalFacesAndNormal(point, targets){
  // returns { normal: Vector3, faces: [ {a,b,c,normal,area}... ] }
  const faces = [];
  const q = point;
  const tmpV = new THREE.Vector3();
  for(const mesh of targets){
    const geom = mesh.geometry;
    if(!geom) continue;
    const pos = geom.getAttribute('position');
    const idx = geom.index;
    if(!pos) continue;
    if(idx){
      for(let i=0;i<idx.count;i+=3){
        const ia = idx.getX(i), ib = idx.getX(i+1), ic = idx.getX(i+2);
        const a = new THREE.Vector3().fromBufferAttribute(pos, ia);
        const b = new THREE.Vector3().fromBufferAttribute(pos, ib);
        const c = new THREE.Vector3().fromBufferAttribute(pos, ic);
        // compare distances to see if this tri contains the point (within tolerance)
        const dA = a.distanceToSquared(q), dB = b.distanceToSquared(q), dC = c.distanceToSquared(q);
        const tol = 1e-6;
        if(dA < 1e-8 || dB < 1e-8 || dC < 1e-8){
          const e1 = b.clone().sub(a);
          const e2 = c.clone().sub(a);
          const n = e1.clone().cross(e2);
          const area = n.length() * 0.5;
          if(n.lengthSq() > 1e-12){
            const nrm = n.clone().normalize();
            faces.push({ a,b,c,normal:nrm,area });
          }
        }
      }
    } else {
      // no index - assume triangles in order
      for(let i=0;i<pos.count;i+=3){
        const a = new THREE.Vector3().fromBufferAttribute(pos, i);
        const b = new THREE.Vector3().fromBufferAttribute(pos, i+1);
        const c = new THREE.Vector3().fromBufferAttribute(pos, i+2);
        const dA = a.distanceToSquared(q), dB = b.distanceToSquared(q), dC = c.distanceToSquared(q);
        if(dA < 1e-8 || dB < 1e-8 || dC < 1e-8){
          const e1 = b.clone().sub(a), e2 = c.clone().sub(a);
          const n = e1.clone().cross(e2);
          const area = n.length() * 0.5;
          if(n.lengthSq() > 1e-12){
            const nrm = n.clone().normalize();
            faces.push({ a,b,c,normal:nrm,area });
          }
        }
      }
    }
  }
  // compute weighted average normal
  if(faces.length === 0) return null;
  const avg = new THREE.Vector3(0,0,0);
  let totalArea = 0;
  for(const f of faces){
    avg.add(f.normal.clone().multiplyScalar(Math.max(f.area, 1e-6)));
    totalArea += Math.max(f.area, 1e-6);
  }
  if(totalArea <= 0) return null;
  avg.divideScalar(totalArea).normalize();
  return { normal: avg, faces };
}

function rayDistanceFrom(point, dir, maxDist, targets){
  // returns distance to first hit, or Infinity if no hit within maxDist
  const origin = point.clone();
  raycaster.set(origin, dir.clone().normalize());
  let hits=[]; for(const m of targets) hits = hits.concat(raycaster.intersectObject(m, true));
  hits = hits.filter(h=>h.distance>1e-6);
  if(hits.length === 0) return Infinity;
  const d = hits[0].distance;
  return d <= maxDist ? d : Infinity;
}

function nudgeOutOfCollision(s, outwardDir, targets, safeOffset=1.5, maxTries=10){
  // if s is too close to geometry or line-of-sight to p is blocked, push along outwardDir until it's clear
  for(let i=0;i<maxTries;i++){
    // cast small ray from s along outwardDir to ensure free space in that direction
    const d = rayDistanceFrom(s.clone().add(outwardDir.clone().multiplyScalar(1e-3)), outwardDir, safeOffset, targets);
    if(d === Infinity) return s; // clear outward
    s = s.clone().add(outwardDir.clone().multiplyScalar(safeOffset));
  }
  return s;
}

function computeAutoStartsForVertex(endpointPos, whichEndpointIndex){
  // whichEndpointIndex used to pick jitter sign (0 for A, 1 for B)
  const sceneBox = computeCombinedBox(pickMeshes);
  const diag = sceneBox ? sceneBox.getSize(new THREE.Vector3()).length() : 1000;
  const INF = 5000;

  // buffer constants (scaled with scene size)
  const BUF_MAIN = Math.max(diag * 0.06, 5);
  const BUF_STEP = Math.max(diag * 0.03, 3);
  const BUF_SMALL = Math.max(2.0, diag * 0.01);
  const JITTER = Math.max(0.5, diag * 0.01);
  const SAFE_OFFSET = Math.max(1.5, diag * 0.002);
  const RAY_TEST_DIST = Math.max(diag * 0.4, 50);

  // gather local normal from faces
  let local = gatherLocalFacesAndNormal(endpointPos, pickMeshes);
  let N_local = local && local.normal ? local.normal.clone() : currentBasis.z.clone().normalize();

  // candidate directions to test (face normal and basis axes both signs)
  const candidates = [];
  const Zdir = currentBasis.z.clone().normalize();
  const Xdir = currentBasis.x.clone().normalize();
  const Ydir = currentBasis.y.clone().normalize();
  candidates.push(N_local.clone(), N_local.clone().negate());
  candidates.push(Zdir.clone(), Zdir.clone().negate());
  candidates.push(Xdir.clone(), Xdir.clone().negate());
  candidates.push(Ydir.clone(), Ydir.clone().negate());

  // evaluate each candidate by raycast free distance
  const candidateScores = [];
  for(const d of candidates){
    const startOff = endpointPos.clone().add(d.clone().multiplyScalar(1e-3));
    const dist = rayDistanceFrom(startOff, d, RAY_TEST_DIST, pickMeshes);
    candidateScores.push({ dir: d.clone(), dist });
  }
  // sort by descending distance (prefer free space)
  candidateScores.sort((a,b)=> (b.dist === Infinity ? 1e9 : b.dist) - (a.dist===Infinity ? 1e9 : a.dist));

  // primary outward direction
  const D_out = candidateScores.length ? candidateScores[0].dir.clone() : Zdir.clone();
  // secondary choose next that is not too aligned with D_out
  let D_side = candidateScores.find(c=> Math.abs(c.dir.dot(D_out)) < 0.9 )?.dir || (Math.abs(Ydir.dot(D_out))<0.9 ? Ydir.clone() : Xdir.clone());

  // Build starts following the requested flow:
  // 1) startX: towards the face-normal (approach), use -N_local * BUF_MAIN
  // Add jitter perpendicular to separate A/B
  const perp = new THREE.Vector3().crossVectors(D_out, N_local).length() < 1e-6 ? new THREE.Vector3().crossVectors(Xdir, Zdir) : new THREE.Vector3().crossVectors(D_out, N_local);
  perp.normalize();
  const jitterSign = whichEndpointIndex ? 1 : -1;
  const sX_base = endpointPos.clone().add(N_local.clone().multiplyScalar(-BUF_MAIN));
  let sX = sX_base.clone().add(perp.clone().multiplyScalar(JITTER * jitterSign));

  // 2) startZ: from sX move away along N_local a bit (BUF_STEP), plus small outward along D_out
  let sZ = sX.clone().add(N_local.clone().multiplyScalar(BUF_STEP));
  sZ.add(D_out.clone().multiplyScalar(BUF_SMALL * 0.5));

  // 3) startY: from sZ move up (Zdir) and along Ydir slightly
  let sY = sZ.clone().add(Zdir.clone().multiplyScalar(BUF_SMALL)).add(Ydir.clone().multiplyScalar(BUF_SMALL));
  // add another small jitter orthogonal to separate Y from others
  const perp2 = new THREE.Vector3().crossVectors(Ydir, D_out).normalize();
  sY.add(perp2.clone().multiplyScalar(JITTER * (jitterSign * 0.5)));

  // Validate & adjust starts so they are in free space (nudge out along outward)
  sX = nudgeOutOfCollision(sX, D_out, pickMeshes, SAFE_OFFSET, 8);
  sZ = nudgeOutOfCollision(sZ, D_out, pickMeshes, SAFE_OFFSET, 8);
  sY = nudgeOutOfCollision(sY, D_out, pickMeshes, SAFE_OFFSET, 8);

  // Ensure minimum separation between starts
  const minSep = Math.max(JITTER * 0.8, 1.0);
  if(sX.distanceTo(sZ) < minSep) sZ.add(perp2.clone().multiplyScalar(minSep));
  if(sX.distanceTo(sY) < minSep) sY.add(perp.clone().multiplyScalar(minSep));
  if(sY.distanceTo(sZ) < minSep) sZ.add(perp.clone().multiplyScalar(minSep * -1));

  return { x: sX, y: sY, z: sZ };
}

/* ---------- visuals & packet builder are updated to use per-axis starts ---------- */
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

  // draw start markers for each axis (small)
  const sSmall = new THREE.Mesh(new THREE.SphereGeometry(0.04,10,8), new THREE.MeshBasicMaterial({ color:0x999999 }));
  const sx = sSmall.clone(); sx.position.copy(pkt.start_X); axisMarkersGroup.add(sx);
  const sy = sSmall.clone(); sy.position.copy(pkt.start_Y); axisMarkersGroup.add(sy);
  const sz = new THREE.Mesh(new THREE.SphereGeometry(0.055,12,10), new THREE.MeshBasicMaterial({ color:pkt.isOuterX ? 0xb91c1c : 0x2563eb }));
  sz.position.copy(pkt.start_Z); axisMarkersGroup.add(sz);

  // label the start-Z as "start"
  const sLabel = createTextSprite(`startZ: (${fmt(pkt.start_Z.x)}, ${fmt(pkt.start_Z.y)}, ${fmt(pkt.start_Z.z)})`, 72, 'white');
  sLabel.position.copy(pkt.start_Z).add(new THREE.Vector3(0,0.06,0)); sLabel.scale.setScalar(0.33);
  axisMarkersGroup.add(sLabel); selectedLabels.push(sLabel);

  // helper for normal axis drawing (dashed to touch, red to raw, markers + label)
  const drawAxis = (axisKey, color) => {
    const touch = pkt[`touch_${axisKey}`], raw = pkt[`raw_${axisKey}`];

    // dashed start → touch (use axis's own start when reasonable)
    const origin = axisKey === 'X' ? pkt.start_X : (axisKey === 'Y' ? pkt.start_Y : pkt.start_Z);
    const geom = new THREE.BufferGeometry().setFromPoints([ origin.clone(), touch.clone() ]);
    const mat  = new THREE.LineDashedMaterial({ color:0x666666, dashSize:0.12, gapSize:0.22 });
    const dashed = new THREE.Line(geom, mat); dashed.computeLineDistances(); dashedGroup.add(dashed);

    // solid red start → raw
    const g2 = new THREE.BufferGeometry().setFromPoints([ origin.clone(), raw.clone() ]);
    const l2 = new THREE.Line(g2, new THREE.LineBasicMaterial({ color:0xff0000 })); axisMarkersGroup.add(l2);

    // collide and search markers
    const hitS = new THREE.Mesh(new THREE.SphereGeometry(0.04,12,10), new THREE.MeshBasicMaterial({ color:0xff0000 })); 
    hitS.position.copy(raw); axisMarkersGroup.add(hitS);

    const spS  = new THREE.Mesh(new THREE.SphereGeometry(0.045,12,10),new THREE.MeshBasicMaterial({ color })); 
    spS.position.copy(touch); axisMarkersGroup.add(spS);

    // label
    const label = createTextSprite(`${name}:${axisKey} → (${fmt(touch.x)}, ${fmt(touch.y)}, ${fmt(touch.z)})`, 84, 'white');
    label.position.copy(origin.clone().add(touch).multiplyScalar(0.5)).add(new THREE.Vector3(0,0.05,0)); 
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
      // Step1: startX → step1 (outward X with YZ locked)
      const g1 = new THREE.BufferGeometry().setFromPoints([ pkt.start_X.clone(), pkt.xSteps.step1.clone() ]);
      axisMarkersGroup.add(new THREE.Line(g1, new THREE.LineBasicMaterial({ color:c1 })));

      // Step2: step1 → step2 (pure Z)
      const g2 = new THREE.BufferGeometry().setFromPoints([ pkt.xSteps.step1.clone(), pkt.xSteps.step2.clone() ]);
      axisMarkersGroup.add(new THREE.Line(g2, new THREE.LineBasicMaterial({ color:c2 })));

      // Step3: step2 → touch_X (purple)
      const g3 = new THREE.BufferGeometry().setFromPoints([ pkt.xSteps.step2.clone(), pkt.touch_X.clone() ]);
      axisMarkersGroup.add(new THREE.Line(g3, new THREE.LineBasicMaterial({ color:c3 })));

      // raw (red) from step2 → raw_X
      const gRaw = new THREE.BufferGeometry().setFromPoints([ pkt.xSteps.step2.clone(), pkt.raw_X.clone() ]);
      axisMarkersGroup.add(new THREE.Line(gRaw, new THREE.LineBasicMaterial({ color:0xff0000 })));
    }

    // markers for X
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

/* ---------- build visuals ---------- */
function buildVisualsFromGeometry(g){
  const pos = g.getAttribute('position'); if(!pos) return;
  const edgesGeom = new THREE.EdgesGeometry(g,1);
  const edgesMat = new THREE.LineBasicMaterial({ color:0x111827 });
  edgeLines = new THREE.LineSegments(edgesGeom, edgesMat);
  scene.add(edgeLines);
  const sphereGeo = new THREE.SphereGeometry(0.06,14,12);
  for(let i=0;i<pos.count;i++){
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color:0xf97316 }));
    mesh.position.copy(v); mesh.userData._baseScale=1; scene.add(mesh); vertexMeshes.push(mesh);
  }
}

/* ---------- load OBJ ---------- */
fileInput.addEventListener('change', ev=>{
  const f = ev.target.files && ev.target.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      clearAll();
      const loader = new OBJLoader();
      const obj = loader.parse(e.target.result);
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      obj.traverse(ch=>{
        if(ch.isMesh){
          ch.geometry = ch.geometry.clone();
          ch.geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z));
          pickMeshes.push(ch);
          buildVisualsFromGeometry(ch.geometry);
        }
      });
      loadedObject = obj; scene.add(obj); fileNameLabel.textContent=f.name; zoomToFit(obj);
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

/* ---------- interaction ---------- */
// Shift+Click => global start in air (convenience)
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

  // Ctrl/Cmd => pick an edge and get its two endpoints A/B
  if(!(ev.ctrlKey || ev.metaKey)) return;
  if(!edgeLines) return;

  const hits = raycaster.intersectObject(edgeLines, false);
  if (hits.length === 0) return;
  const hit = hits[0];

  const posAttr = edgeLines.geometry.getAttribute('position');
  let bestA=null,bestB=null,bestD=Infinity;
  for(let i=0;i<posAttr.count;i+=2){
    const a=new THREE.Vector3().fromBufferAttribute(posAttr,i);
    const b=new THREE.Vector3().fromBufferAttribute(posAttr,i+1);
    const mid=a.clone().add(b).multiplyScalar(0.5);
    const d=mid.distanceTo(hit.point);
    if(d<bestD){ bestD=d; bestA=a.clone(); bestB=b.clone(); }
  }
  if(!bestA || !bestB) return;

  clearSelectionVisuals();

  const geo = new THREE.BufferGeometry().setFromPoints([bestA,bestB]);
  currentHighlight = new THREE.Line(geo, new THREE.LineBasicMaterial({ color:0xff6b00 }));
  scene.add(currentHighlight);

  function nearestVM(pt){
    let best=null,bd=Infinity;
    vertexMeshes.forEach(m=>{ const d=m.position.distanceTo(pt); if(d<bd){ bd=d; best=m; } });
    return best;
  }
  const vA = nearestVM(bestA), vB = nearestVM(bestB);
  const purple = 0x7c3aed;
  [vA,vB].forEach((vm, idx)=>{
    if(!vm) return;
    vm.userData._prevColor = vm.material.color.getHex();
    vm.userData._baseScale = vm.scale.x || 1;
    vm.material.color.setHex(purple);
    vm.scale.setScalar(1.8);
    vm.userData._selected = true;
    selectedVertexMeshes.push(vm);

    const tag = idx===0 ? 'A' : 'B';
    const num = createTextSprite(tag);
    num.position.copy(vm.position).add(new THREE.Vector3(0,0.15,0));
    num.scale.setScalar(0.6); scene.add(num); selectedLabels.push(num);

    const coords = createTextSprite(`(${fmt(vm.position.x)}, ${fmt(vm.position.y)}, ${fmt(vm.position.z)})`, 88, 'white');
    coords.position.copy(vm.position).add(new THREE.Vector3(0,0.35,0));
    coords.scale.setScalar(0.45); scene.add(coords); selectedLabels.push(coords);
  });

  computeStatus.textContent = 'Edge selected. Set Start Ax/Ay/Az and Bx/By/Bz (or use global).';

  // Auto-start: compute per-axis starts for each endpoint if enabled
  if(chkAutoStart.checked){
    try{
      // compute for A (index 0) and B (index 1)
      if(vA){
        const autosA = computeAutoStartsForVertex(vA.position.clone(), 0);
        // populate inputs and markers if not overridden by manual
        startAx_x.value = fmt(autosA.x.x); startAx_y.value = fmt(autosA.x.y); startAx_z.value = fmt(autosA.x.z);
        startAy_x.value = fmt(autosA.y.x); startAy_y.value = fmt(autosA.y.y); startAy_z.value = fmt(autosA.y.z);
        startAz_x.value = fmt(autosA.z.x); startAz_y.value = fmt(autosA.z.y); startAz_z.value = fmt(autosA.z.z);
        // set in-memory starts and markers (but manual Set still allowed)
        starts.A.x = autosA.x; starts.A.y = autosA.y; starts.A.z = autosA.z;
        // create markers (replace existing)
        ['x','y','z'].forEach(k=>{ if(startMarkers.A[k]){ scene.remove(startMarkers.A[k]); disposeObject(startMarkers.A[k]); startMarkers.A[k]=null; }});
        startMarkers.A.x = new THREE.Mesh(new THREE.SphereGeometry(0.04,10,8), new THREE.MeshBasicMaterial({ color:0xaaaaaa })); startMarkers.A.x.position.copy(autosA.x); scene.add(startMarkers.A.x);
        startMarkers.A.y = new THREE.Mesh(new THREE.SphereGeometry(0.04,10,8), new THREE.MeshBasicMaterial({ color:0xaaaaaa })); startMarkers.A.y.position.copy(autosA.y); scene.add(startMarkers.A.y);
        startMarkers.A.z = new THREE.Mesh(new THREE.SphereGeometry(0.055,12,10), new THREE.MeshBasicMaterial({ color: manualOuter.A ? 0xb91c1c : 0x2563eb })); startMarkers.A.z.position.copy(autosA.z); scene.add(startMarkers.A.z);
        startAInfo.textContent = `Auto: (${fmt(autosA.z.x)}, ${fmt(autosA.z.y)}, ${fmt(autosA.z.z)})`;
      }

      if(vB){
        const autosB = computeAutoStartsForVertex(vB.position.clone(), 1);
        startBx_x.value = fmt(autosB.x.x); startBx_y.value = fmt(autosB.x.y); startBx_z.value = fmt(autosB.x.z);
        startBy_x.value = fmt(autosB.y.x); startBy_y.value = fmt(autosB.y.y); startBy_z.value = fmt(autosB.y.z);
        startBz_x.value = fmt(autosB.z.x); startBz_y.value = fmt(autosB.z.y); startBz_z.value = fmt(autosB.z.z);
        starts.B.x = autosB.x; starts.B.y = autosB.y; starts.B.z = autosB.z;
        ['x','y','z'].forEach(k=>{ if(startMarkers.B[k]){ scene.remove(startMarkers.B[k]); disposeObject(startMarkers.B[k]); startMarkers.B[k]=null; }});
        startMarkers.B.x = new THREE.Mesh(new THREE.SphereGeometry(0.04,10,8), new THREE.MeshBasicMaterial({ color:0xaaaaaa })); startMarkers.B.x.position.copy(autosB.x); scene.add(startMarkers.B.x);
        startMarkers.B.y = new THREE.Mesh(new THREE.SphereGeometry(0.04,10,8), new THREE.MeshBasicMaterial({ color:0xaaaaaa })); startMarkers.B.y.position.copy(autosB.y); scene.add(startMarkers.B.y);
        startMarkers.B.z = new THREE.Mesh(new THREE.SphereGeometry(0.055,12,10), new THREE.MeshBasicMaterial({ color: manualOuter.B ? 0xb91c1c : 0x2563eb })); startMarkers.B.z.position.copy(autosB.z); scene.add(startMarkers.B.z);
        startBInfo.textContent = `Auto: (${fmt(autosB.z.x)}, ${fmt(autosB.z.y)}, ${fmt(autosB.z.z)})`;
      }
    }catch(err){
      console.warn('Auto-start failed:', err);
    }
  }
});

/* ---------- Set start by coordinate (per-axis) ---------- */
function readTriple(prefix){
  const xs = document.getElementById(`${prefix}-x`).value;
  const ys = document.getElementById(`${prefix}-y`).value;
  const zs = document.getElementById(`${prefix}-z`).value;
  const x = parseFloat(xs), y = parseFloat(ys), z = parseFloat(zs);
  if(!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
  return new THREE.Vector3(x,y,z);
}
function setStartAxis(whichEndpoint, axisKey, inputPrefix, infoId){
  const vec = readTriple(inputPrefix);
  if(!vec){
    alert(`Start ${whichEndpoint}${axisKey.toUpperCase()}: please enter valid numbers`);
    return;
  }
  starts[whichEndpoint][axisKey] = vec;
  // update marker
  if(startMarkers[whichEndpoint][axisKey]){ scene.remove(startMarkers[whichEndpoint][axisKey]); disposeObject(startMarkers[whichEndpoint][axisKey]); }
  const col = (axisKey === 'z') ? (manualOuter[whichEndpoint] ? 0xb91c1c : 0x2563eb) : 0x999999;
  startMarkers[whichEndpoint][axisKey] = new THREE.Mesh(new THREE.SphereGeometry(axisKey==='z'?0.055:0.04,12,10), new THREE.MeshBasicMaterial({ color: col }));
  startMarkers[whichEndpoint][axisKey].position.copy(vec); scene.add(startMarkers[whichEndpoint][axisKey]);
  // info text shows the set triple for z-start (primary) or simple marker for others
  if(axisKey === 'z'){
    document.getElementById(infoId).textContent = `(${fmt(vec.x)}, ${fmt(vec.y)}, ${fmt(vec.z)}) ${manualOuter[whichEndpoint] ? '· OUTER-X' : '· INNER'}`;
  } else {
    document.getElementById(infoId).textContent = document.getElementById(infoId).textContent || 'axis starts set';
  }
}

/* wiring buttons for A */
btnSetStartAx.addEventListener('click', ()=>setStartAxis('A','x','startAx', 'startA-info'));
btnSetStartAy.addEventListener('click', ()=>setStartAxis('A','y','startAy', 'startA-info'));
btnSetStartAz.addEventListener('click', ()=>setStartAxis('A','z','startAz', 'startA-info'));

/* wiring buttons for B */
btnSetStartBx.addEventListener('click', ()=>setStartAxis('B','x','startBx', 'startB-info'));
btnSetStartBy.addEventListener('click', ()=>setStartAxis('B','y','startBy', 'startB-info'));
btnSetStartBz.addEventListener('click', ()=>setStartAxis('B','z','startBz', 'startB-info'));

chkAOuter.addEventListener('change', ()=>{
  manualOuter.A = chkAOuter.checked;
  if(starts.A.z && startMarkers.A.z){ startMarkers.A.z.material.color.setHex(manualOuter.A?0xb91c1c:0x2563eb); }
});
chkBOuter.addEventListener('change', ()=>{
  manualOuter.B = chkBOuter.checked;
  if(starts.B.z && startMarkers.B.z){ startMarkers.B.z.material.color.setHex(manualOuter.B?0xb91c1c:0x2563eb); }
});

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
  computeStatus.textContent = modeHit ? 'Use "Compute" to see results.' : '—';
});

/* ---------- Compute for selected edge (now using per-axis starts) ---------- */
let lastResultJSON = null;

function buildPathPlanEntry(pkt, name = "Mock_edge") {
  // Reuse v3 helper defined above
  const startCommon = v3(pkt.start); // pkt.start is start_Z for backwards compatibility
  const startX = (pkt.isOuterX && pkt.xSteps) ? v3(pkt.xSteps.step2) : startCommon;

  // default torch quaternion(s) - identity quaternion used as placeholder
  const defaultTorchStart = [1, 0, 0, 0];
  const defaultTorchEnd   = [1, 0, 0, 0];

  return {
    edge: name,
    id: "",
    buffer_point: [],
    torch_angle: [],
    touch_order: ['x','z','y'],
    touch_path: {
      x: { start_point: startX, end_point: v3(pkt.touch_Z), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd },
      y: { start_point: startCommon, end_point: v3(pkt.touch_X), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd },
      z: { start_point: startCommon, end_point: v3(pkt.touch_Y), start_torch_angle: defaultTorchStart, end_torch_angle: defaultTorchEnd }
    }
  };
}

btnCompute.addEventListener('click', ()=>{
  try {
    if(selectedVertexMeshes.length !== 2){
      alert('Select one edge (Ctrl/Cmd+Click) to get its two endpoints A/B.');
      return;
    }

    // ensure each axis has a start or global
    const missingA = (!starts.A.x && !globalStartPoint) || (!starts.A.y && !globalStartPoint) || (!starts.A.z && !globalStartPoint);
    const missingB = (!starts.B.x && !globalStartPoint) || (!starts.B.y && !globalStartPoint) || (!starts.B.z && !globalStartPoint);
    if(missingA || missingB){
      alert('Provide Start Ax/Ay/Az and Start Bx/By/Bz (in fields) or set a global start (Shift+Click) to fill missing starts.');
      return;
    }

    if(axisMarkersGroup){ axisMarkersGroup.children.forEach(disposeObject); scene.remove(axisMarkersGroup); axisMarkersGroup=null; }
    if(dashedGroup){ dashedGroup.children.forEach(disposeObject); scene.remove(dashedGroup); dashedGroup=null; }
    axisMarkersGroup = new THREE.Group(); dashedGroup = new THREE.Group();

    const basis = { x: currentBasis.x.clone(), y: currentBasis.y.clone(), z: currentBasis.z.clone() };

    // Endpoint world positions from selection
    const endA = selectedVertexMeshes[0]?.position.clone();
    const endB = selectedVertexMeshes[1]?.position.clone();

    // compute packets per-endpoint using per-axis starts (fall back to globalStartPoint if axis missing)
    const startA_forCompute = { x: starts.A.x || globalStartPoint, y: starts.A.y || globalStartPoint, z: starts.A.z || globalStartPoint };
    const startB_forCompute = { x: starts.B.x || globalStartPoint, y: starts.B.y || globalStartPoint, z: starts.B.z || globalStartPoint };

    const packetA = computePacketForEndpoint(startA_forCompute, endA, pickMeshes, basis, { forceOuter: !!manualOuter.A });
    const packetB = computePacketForEndpoint(startB_forCompute, endB, pickMeshes, basis, { forceOuter: !!manualOuter.B });

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

    computeStatus.textContent = 'Computed. Outer X uses 3-step (YZ locked at X-start).';
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

/* ---------- resize + animate ---------- */
window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
(function animate(){ requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();
