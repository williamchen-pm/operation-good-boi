import * as THREE from 'three';
import './style.css';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Supabase — backs the guest leaderboard (submit + fetch against the
// "scores" table). The publishable (anon) key is meant to be public/
// client-side — safe to embed here — with the table's Row Level Security
// policies as the only real gate on what it can do (public insert + public
// select, no update/delete; see the SQL used to create the table).
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://djyurantsagpdshiwjkc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_oSl_PQFajJKXv3M_ISygTg_g5EPDB0s';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Tone mapping: ACES gives a filmic highlight roll-off so the bright pool of
// light doesn't clip to flat white. Keep exposure at ~1 so the blacks stay black.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('app').appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// Scene — near-black background
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040405);
// NOTE: no scene.fog. In a straight-down view every floor point is ~the same
// distance from the camera, so fog just tints the whole frame uniformly (that
// was the "flat even gray" bug). The vignette here comes entirely from light
// falloff instead.

// ---------------------------------------------------------------------------
// Orthographic camera — true top-down bird's-eye view, always looking
// straight down (no angle change, ever). Follows the player, so it's zoomed
// in for a more atmospheric, detailed view rather than showing the whole map.
// ---------------------------------------------------------------------------
const VIEW_SIZE = 26; // world units visible vertically
let aspect = window.innerWidth / window.innerHeight;

const camera = new THREE.OrthographicCamera(
  (-VIEW_SIZE * aspect) / 2,
  (VIEW_SIZE * aspect) / 2,
  VIEW_SIZE / 2,
  -VIEW_SIZE / 2,
  0.1,
  100
);
const CAMERA_HEIGHT = 30;
// The point on the floor the camera is centred above/looking straight down
// at. Smoothly chases the player each frame in updateCamera() below — see
// where that's defined, after `player` exists.
const cameraFocus = new THREE.Vector2(0, 0);
camera.position.set(cameraFocus.x, CAMERA_HEIGHT, cameraFocus.y);
camera.up.set(0, 0, -1); // keep +Z pointing "down" on screen — never changes
camera.lookAt(cameraFocus.x, 0, cameraFocus.y);

// ---------------------------------------------------------------------------
// Procedural textures (canvas-based — no image assets). Kept subtle: the
// camera looks straight down, so we mostly ever see TOP faces. Wall/floor side
// detail would be nearly invisible, so texture goes where it's actually seen:
// the floor (huge, dominates the frame) and crate tops.
// ---------------------------------------------------------------------------
function makeConcreteTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#38393e';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // Soft dark stains — a few large, low-opacity radial blotches (oil/water
  // stains), drawn BEFORE the crack lines so the cracks read on top of them.
  // Low count + big soft radius so they don't turn into visible noise at the
  // tile's 30x repeat — this is meant to break up "one flat surface", not add
  // a busy pattern.
  for (let i = 0; i < 3; i++) {
    const sx = Math.random() * size;
    const sz = Math.random() * size;
    const r = 18 + Math.random() * 26;
    const grad = ctx.createRadialGradient(sx, sz, 0, sx, sz, r);
    grad.addColorStop(0, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sz, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cracks — short jagged multi-segment lines (not single straight strokes)
  // so they read as fractures in the concrete rather than scratches.
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = Math.random() * size;
    let z = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, z);
    const segments = 3 + Math.floor(Math.random() * 3);
    for (let s = 0; s < segments; s++) {
      x += (Math.random() - 0.5) * 30;
      z += (Math.random() - 0.5) * 30;
      ctx.lineTo(x, z);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 30);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCrateTopTexture() {
  const w = 64;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#5b4c3c';
  ctx.fillRect(0, 0, w, h);
  const plankH = 14;
  for (let y = -plankH / 2; y < h; y += plankH) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, y, w, 2);
    ctx.fillStyle = 'rgba(255,240,220,0.08)';
    ctx.fillRect(0, y + 2, w, plankH - 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(2, 2, 4, 4);
  ctx.fillRect(w - 6, 2, 4, 4);
  ctx.fillRect(2, h - 6, 4, 4);
  ctx.fillRect(w - 6, h - 6, 4, 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Barrel top: concentric rim rings + a scatter of rivet dots, distinct from
// both the crate's planks and the shelf's dividers so all three obstacle
// types read differently from directly above.
function makeBarrelTopTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cz = size / 2;
  ctx.fillStyle = '#4a3320';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#5c4128';
  ctx.beginPath();
  ctx.arc(cx, cz, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  for (const r of [size * 0.46, size * 0.32, size * 0.16]) {
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cz, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  const rivetR = size * 0.46;
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * rivetR, cz + Math.sin(ang) * rivetR, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Shelving-rack top: divider lines suggesting compartments, distinct from the
// crate's horizontal planks so the two obstacle types read differently.
function makeShelfTopTexture() {
  const w = 64;
  const h = 24;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a3d44';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let x = 6; x < w; x += 11) ctx.fillRect(x, 0, 2, h);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, 0, w, 2);
  ctx.fillRect(0, h - 2, w, 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Materials — desaturated concrete/industrial palette. Kept deliberately
// muted (low metalness, mid-high roughness) because with base visibility
// raised (see Lighting below), a bright/metallic surface directly under a
// lamp clips to white — that bit the player's material once already.
// ---------------------------------------------------------------------------
const floorMaterial = new THREE.MeshStandardMaterial({
  map: makeConcreteTexture(),
  roughness: 0.95,
  metalness: 0.02,
});
const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0x60636b, // cool gray, distinct from the floor — corrugated-metal feel
  roughness: 0.75,
  metalness: 0.25,
  // A constant self-glow (worn metal catching ambient bounce) so the room
  // layout reads as silhouettes in the unlit areas between lamp pools.
  emissive: 0x1c1f26,
  emissiveIntensity: 1,
});
const crateSideMaterial = new THREE.MeshStandardMaterial({
  color: 0x4c4034, // desaturated wood-crate brown
  roughness: 0.9,
  metalness: 0.05,
});
const crateTopMaterial = new THREE.MeshStandardMaterial({
  map: makeCrateTopTexture(),
  roughness: 0.9,
  metalness: 0.05,
});
// BoxGeometry material order: [+x, -x, +y(top), -y(bottom), +z, -z]
const crateMaterials = [
  crateSideMaterial,
  crateSideMaterial,
  crateTopMaterial,
  crateSideMaterial,
  crateSideMaterial,
  crateSideMaterial,
];
const barrelSideMaterial = new THREE.MeshStandardMaterial({
  color: 0x5c4128, // rusty dark drum tone, desaturated
  roughness: 0.8,
  metalness: 0.2,
});
const barrelTopMaterial = new THREE.MeshStandardMaterial({
  map: makeBarrelTopTexture(),
  roughness: 0.75,
  metalness: 0.25,
});
// CylinderGeometry material order: [side, top, bottom]
const barrelMaterials = [barrelSideMaterial, barrelTopMaterial, barrelSideMaterial];
const shelfSideMaterial = new THREE.MeshStandardMaterial({
  color: 0x34373d, // dark industrial gray-metal, distinct from crate brown
  roughness: 0.7,
  metalness: 0.35,
});
const shelfTopMaterial = new THREE.MeshStandardMaterial({
  map: makeShelfTopTexture(),
  roughness: 0.7,
  metalness: 0.3,
});
const shelfMaterials = [
  shelfSideMaterial,
  shelfSideMaterial,
  shelfTopMaterial,
  shelfSideMaterial,
  shelfSideMaterial,
  shelfSideMaterial,
];
// A second, visually distinct shelving style — an open pallet-rack frame
// (posts + horizontal beams, safety-orange) instead of a solid gray box —
// so "shelving" doesn't read as one repeated object with a size tweak.
const rackFrameMaterial = new THREE.MeshStandardMaterial({
  color: 0xb5541f,
  roughness: 0.7,
  metalness: 0.35,
});
// Vehicles — a forklift (safety yellow) and a car (muted civilian color),
// both built from a few boxes rather than a real model, same as every
// other obstacle in this file.
const forkliftBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xd6a627, roughness: 0.55, metalness: 0.35 });
const forkliftDarkMaterial = new THREE.MeshStandardMaterial({ color: 0x26262a, roughness: 0.7, metalness: 0.4 });
const carBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4a5c, roughness: 0.45, metalness: 0.45 });
const carGlassMaterial = new THREE.MeshStandardMaterial({ color: 0x171b1f, roughness: 0.25, metalness: 0.6 });
// Junk pile — small mismatched scrap pieces, two muted tones so the cluster
// doesn't read as one uniform color.
const junkMaterialA = new THREE.MeshStandardMaterial({ color: 0x57544c, roughness: 0.9, metalness: 0.25 });
const junkMaterialB = new THREE.MeshStandardMaterial({ color: 0x3d3d36, roughness: 0.85, metalness: 0.2 });
// Bicycle — thin dark tires + a colored frame bar.
const bikeFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x8a2020, roughness: 0.6, metalness: 0.4 });
const bikeWheelMaterial = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.8, metalness: 0.1 });
// Pallet — raw, weathered wood, more worn/gray than the crate's cleaner brown.
const palletMaterial = new THREE.MeshStandardMaterial({ color: 0x5c4a35, roughness: 0.95, metalness: 0.02 });
// Debris/clutter scatter — two muted tones (reused for both loose floor
// debris and small "stored goods" boxes on shelves) so a cluster of several
// pieces doesn't read as one uniform color.
const debrisMaterialA = new THREE.MeshStandardMaterial({ color: 0x4c4034, roughness: 0.9, metalness: 0.05 });
const debrisMaterialB = new THREE.MeshStandardMaterial({ color: 0x57544c, roughness: 0.9, metalness: 0.2 });

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------
const floorGeometry = new THREE.PlaneGeometry(200, 200);
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2; // lay flat on the XZ plane
floor.receiveShadow = true;
scene.add(floor);

// ---------------------------------------------------------------------------
// Shared sizing constants — declared up here (ahead of the level layout)
// because the connectivity checker used while placing crates needs
// PLAYER_RADIUS, and the level needs to know the player/puppy positions
// before any crate is placed.
// ---------------------------------------------------------------------------
const WALL_HEIGHT = 5;
const WALL_THICKNESS = 0.6;
const PLAYER_SIZE = 1.8;
const PLAYER_RADIUS = 0.95;
const NPC_SIZE = 1.8;
const NPC_RADIUS = 0.95;

// Start (bottom of the floor) and goal (top) — used both to build the
// player/puppy meshes later and, right now, as the two endpoints the
// connectivity checker must keep reachable from each other as the level is built.
const PLAYER_SPAWN_XZ = { x: 0, z: 34 };
const PUPPY_XZ = { x: -4, z: -38 };

// ---------------------------------------------------------------------------
// Obstacles — walls and crates share one flat list of axis-aligned footprints
// in the XZ plane, used for movement collision, vision-cone occlusion, AND
// (new) the connectivity check below. Height doesn't matter here: this is a
// top-down game, everything registered is treated as floor-to-ceiling solid.
// ---------------------------------------------------------------------------
const obstacles = []; // { minX, maxX, minZ, maxZ }

function registerObstacle(cx, cz, sx, sz) {
  const o = { minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 };
  obstacles.push(o);
  return o;
}

function addWall(cx, cz, sx, sz) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), wallMaterial);
  mesh.position.set(cx, WALL_HEIGHT / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  registerObstacle(cx, cz, sx, sz);
}

// levels of a stack all share the same footprint now (no extra padding beyond
// `size`) — shrinking the collision box relative to earlier phases so a crate
// is less likely to fully seal a passage. Returns the meshes + the obstacle
// entry so a caller can undo the placement (see placeObstacleSafe below).
function addCrateStack(cx, cz, size = 2.0, levels = 2, levelHeight = 1.2) {
  const meshes = [];
  for (let i = 0; i < levels; i++) {
    const s = size - i * 0.3; // each level noticeably smaller, like a real stack
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, levelHeight, s), crateMaterials);
    mesh.position.set(
      cx + (Math.random() - 0.5) * 0.15,
      levelHeight * i + levelHeight / 2,
      cz + (Math.random() - 0.5) * 0.15
    );
    mesh.rotation.y = (Math.random() - 0.5) * 0.12;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  const obstacle = registerObstacle(cx, cz, size, size);
  return { meshes, obstacle };
}

// A barrel — a simple cylinder, visually and functionally distinct from a
// crate (round footprint, approximated as a square AABB for collision, same
// as everything else in this game).
function addBarrel(cx, cz, radius = 0.7, height = 1.8) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.03, height, 16), barrelMaterials);
  mesh.position.set(cx, height / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const d = radius * 2;
  const obstacle = registerObstacle(cx, cz, d, d);
  return { meshes: [mesh], obstacle };
}

// A shelving unit — a simple rectangular rack, taller and thinner than a
// crate. `rotated` swaps it to face along Z instead of X (and swaps the
// registered footprint to match) for variety in how it reads on the floor.
function addShelf(cx, cz, width = 3.2, depth = 0.9, height = 2.8, rotated = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), shelfMaterials);
  mesh.position.set(cx, height / 2, cz);
  if (rotated) mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const footprintX = rotated ? depth : width;
  const footprintZ = rotated ? width : depth;
  const obstacle = registerObstacle(cx, cz, footprintX, footprintZ);
  return { meshes: [mesh], obstacle };
}

// A second shelving style — an open pallet-rack frame (a few thin posts +
// horizontal beams) instead of addShelf's solid box, so "tall shelving"
// isn't just one object repeated with a different size. `rotated` swaps
// which axis is the long one, same convention as addShelf — built by
// swapping which dimension the posts/beams use rather than rotating meshes,
// so there's no rotation-composition risk to get wrong.
function addPalletRack(cx, cz, width = 3.6, depth = 0.8, height = 3.2, rotated = false) {
  const w = rotated ? depth : width;
  const d = rotated ? width : depth;
  const meshes = [];
  const post = 0.16; // post/beam thickness
  const postGeo = new THREE.BoxGeometry(post, height, post);
  for (const ox of [-w / 2 + post / 2, w / 2 - post / 2]) {
    for (const oz of [-d / 2 + post / 2, d / 2 - post / 2]) {
      const m = new THREE.Mesh(postGeo, rackFrameMaterial);
      m.position.set(cx + ox, height / 2, cz + oz);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      meshes.push(m);
    }
  }
  const beamGeo = new THREE.BoxGeometry(w, 0.1, d);
  for (let level = 1; level <= 3; level++) {
    const m = new THREE.Mesh(beamGeo, rackFrameMaterial);
    m.position.set(cx, (height / 4) * level, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    meshes.push(m);
  }
  const obstacle = registerObstacle(cx, cz, w, d);
  return { meshes, obstacle };
}

// A forklift — a boxy body, a thin overhead-guard frame, and two prongs
// sticking out one end. `rotated` points it along Z instead of X.
function addForklift(cx, cz, rotated = false) {
  const bodyLen = 2.0;
  const bodyWidth = 1.3;
  const bodyHeight = 1.1;
  const forkLen = 1.0;
  const meshes = [];
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(rotated ? bodyWidth : bodyLen, bodyHeight, rotated ? bodyLen : bodyWidth),
    forkliftBodyMaterial
  );
  body.position.set(cx, bodyHeight / 2, cz);
  body.castShadow = true;
  body.receiveShadow = true;
  scene.add(body);
  meshes.push(body);
  // Overhead guard — a thin frame above the body, reads as the cab.
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(rotated ? bodyWidth * 0.7 : bodyLen * 0.6, 0.1, rotated ? bodyLen * 0.6 : bodyWidth * 0.7),
    forkliftDarkMaterial
  );
  guard.position.set(cx, bodyHeight + 0.5, cz);
  guard.castShadow = true;
  scene.add(guard);
  meshes.push(guard);
  // Forks — two thin prongs sticking out one end.
  const forkOffset = (rotated ? bodyLen : bodyLen) / 2 + forkLen / 2;
  for (const side of [-1, 1]) {
    const fork = new THREE.Mesh(
      new THREE.BoxGeometry(rotated ? 0.18 : forkLen, 0.12, rotated ? forkLen : 0.18),
      forkliftDarkMaterial
    );
    if (rotated) fork.position.set(cx + side * bodyWidth * 0.28, 0.1, cz + forkOffset);
    else fork.position.set(cx + forkOffset, 0.1, cz + side * bodyWidth * 0.28);
    fork.castShadow = true;
    scene.add(fork);
    meshes.push(fork);
  }
  const totalLen = bodyLen + forkLen;
  const obstacle = registerObstacle(cx, cz, rotated ? bodyWidth : totalLen, rotated ? totalLen : bodyWidth);
  return { meshes, obstacle };
}

// A small parked car — a body box plus an inset "glass" box for the
// windshield/cabin area, so it reads as a car and not just another crate.
function addCar(cx, cz, rotated = false) {
  const length = 3.4;
  const width = 1.5;
  const height = 0.9;
  const meshes = [];
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(rotated ? width : length, height, rotated ? length : width),
    carBodyMaterial
  );
  body.position.set(cx, height / 2, cz);
  body.castShadow = true;
  body.receiveShadow = true;
  scene.add(body);
  meshes.push(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(rotated ? width * 0.75 : length * 0.45, 0.25, rotated ? length * 0.45 : width * 0.75),
    carGlassMaterial
  );
  cabin.position.set(cx, height + 0.12, cz);
  cabin.castShadow = true;
  scene.add(cabin);
  meshes.push(cabin);
  const obstacle = registerObstacle(cx, cz, rotated ? width : length, rotated ? length : width);
  return { meshes, obstacle };
}

// A junk/scrap pile — a small cluster of irregular mismatched pieces
// (boxes and short cylinders, random size/rotation/tone) grouped tightly,
// registered as one combined obstacle footprint, same pattern as a crate
// stack's multiple levels.
function addJunkPile(cx, cz, radius = 1.1) {
  const meshes = [];
  const pieceCount = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < pieceCount; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * radius * 0.55;
    const size = 0.3 + Math.random() * 0.45;
    const h = 0.25 + Math.random() * 0.55;
    const mat = Math.random() < 0.5 ? junkMaterialA : junkMaterialB;
    const geo =
      Math.random() < 0.5
        ? new THREE.BoxGeometry(size, h, size * 0.85)
        : new THREE.CylinderGeometry(size * 0.4, size * 0.4, h, 8);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx + Math.cos(ang) * dist, h / 2, cz + Math.sin(ang) * dist);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  const obstacle = registerObstacle(cx, cz, radius * 2, radius * 2);
  return { meshes, obstacle };
}

// A bicycle — two flat-laid rings for wheels plus a thin frame bar between
// them, small enough to read as "leaning in a corner" rather than a major
// obstacle. `rotated` points it along Z instead of X.
function addBicycle(cx, cz, rotated = false) {
  const wheelRadius = 0.3;
  const bikeLength = 1.0;
  const meshes = [];
  const wheelGeo = new THREE.TorusGeometry(wheelRadius, 0.05, 6, 14);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(wheelGeo, bikeWheelMaterial);
    wheel.rotation.x = Math.PI / 2; // lay flat so it reads as a ring from above, not an edge-on loop
    if (rotated) wheel.position.set(cx, wheelRadius, cz + (side * bikeLength) / 2);
    else wheel.position.set(cx + (side * bikeLength) / 2, wheelRadius, cz);
    wheel.castShadow = true;
    scene.add(wheel);
    meshes.push(wheel);
  }
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(rotated ? 0.08 : bikeLength, 0.08, rotated ? bikeLength : 0.08),
    bikeFrameMaterial
  );
  frame.position.set(cx, 0.32, cz);
  frame.castShadow = true;
  scene.add(frame);
  meshes.push(frame);
  const footprintX = rotated ? wheelRadius * 2 + 0.2 : bikeLength + wheelRadius * 2;
  const footprintZ = rotated ? bikeLength + wheelRadius * 2 : wheelRadius * 2 + 0.2;
  const obstacle = registerObstacle(cx, cz, footprintX, footprintZ);
  return { meshes, obstacle };
}

// A pallet — a low, flat slatted base. Small footprint, but real enough
// (stacked wooden pallets are a genuine obstacle) to register normally like
// every other prop. `rotated` swaps which axis is the long one.
function addPallet(cx, cz, rotated = false) {
  const w = rotated ? 0.9 : 1.1;
  const d = rotated ? 1.1 : 0.9;
  const baseHeight = 0.14;
  const meshes = [];
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, baseHeight, d), palletMaterial);
  base.position.set(cx, baseHeight / 2, cz);
  base.castShadow = true;
  base.receiveShadow = true;
  scene.add(base);
  meshes.push(base);
  // A few top slats for silhouette detail (the individual boards a real
  // pallet's deck is built from), running across the SHORT axis.
  const slatGeo = new THREE.BoxGeometry(rotated ? w * 0.85 : 0.12, 0.04, rotated ? 0.12 : d * 0.85);
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4 - 0.5;
    const slat = new THREE.Mesh(slatGeo, palletMaterial);
    if (rotated) slat.position.set(cx, baseHeight + 0.02, cz + t * d * 0.85);
    else slat.position.set(cx + t * w * 0.85, baseHeight + 0.02, cz);
    slat.castShadow = true;
    scene.add(slat);
    meshes.push(slat);
  }
  const obstacle = registerObstacle(cx, cz, w, d);
  return { meshes, obstacle };
}

// Purely decorative loose clutter scattered near a larger object, so a spot
// reads as "things have been set down here" rather than one clean shape
// sitting alone. Deliberately NOT registered as an obstacle and not run
// through placeObstacleSafe — small, low, scattered debris like this isn't
// meant to be a new thing to path around, so it can't tighten any existing
// clearance/connectivity guarantee. Call it AT an existing large object's
// own (cx, cz) to cluster around it — `minDist` MUST clear that object's own
// half-size, or the "debris" spawns hidden inside/under it (found exactly
// this: pieces existed, correctly positioned per their own coordinates,
// completely invisible in every screenshot — because "near the crate"
// without a large-enough minimum radius put them inside the crate's own
// 2.6-unit footprint, not beside it).
function addDebrisScatter(cx, cz, count = 4, spread = 1.3, minDist = 0.6) {
  const meshes = [];
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * spread;
    const size = 0.14 + Math.random() * 0.22;
    const h = 0.12 + Math.random() * 0.22;
    const mat = Math.random() < 0.5 ? debrisMaterialA : debrisMaterialB;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, h, size * 0.85), mat);
    mesh.position.set(cx + Math.cos(ang) * dist, h / 2, cz + Math.sin(ang) * dist);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes; // no obstacle returned — nothing to register, purely visual
}

// Small "stored goods" boxes resting on top of a shelf/rack, at whatever
// height its top surface sits — same non-colliding, no-obstacle reasoning
// as addDebrisScatter (this only adds visual density to an area that
// already has a real obstacle registered for the shelf itself).
function addShelfItems(cx, cz, surfaceHeight, count = 3, spread = 0.9) {
  const meshes = [];
  for (let i = 0; i < count; i++) {
    const ox = (Math.random() - 0.5) * spread;
    const oz = (Math.random() - 0.5) * 0.35;
    const w = 0.2 + Math.random() * 0.25;
    const h = 0.18 + Math.random() * 0.22;
    const mat = Math.random() < 0.5 ? debrisMaterialA : crateSideMaterial;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), mat);
    mesh.position.set(cx + ox, surfaceHeight + h / 2, cz + oz);
    mesh.rotation.y = (Math.random() - 0.5) * 0.6;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

// ---------------------------------------------------------------------------
// Connectivity check — a coarse grid BFS over the CURRENT obstacle list.
// Used as a hard safety net when placing crates: if adding one would seal off
// the only route from the player's spawn to the puppy, the placement is
// undone. This is deliberately a real flood-fill over actual collision data,
// not a hand-checked doorway measurement — a previous pass at this level
// found (the hard way, twice) that "nominal gap minus wall thickness" is an
// unreliable way to reason about whether a passage is really walkable once
// two wall/crate collision boxes' radius-expansions compound near a doorway.
// ---------------------------------------------------------------------------
const WALK_GRID_CELL = 0.5;
const WALK_GRID_BOUNDS = { minX: -22, maxX: 22, minZ: -48, maxZ: 44 };

function isWalkableCell(x, z, extraObstacles) {
  const r = PLAYER_RADIUS;
  for (const o of obstacles) {
    if (x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r) return false;
  }
  if (extraObstacles) {
    for (const o of extraObstacles) {
      if (x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r) return false;
    }
  }
  return true;
}

function pathExists(fromX, fromZ, toX, toZ, extraObstacles) {
  const { minX, maxX, minZ, maxZ } = WALK_GRID_BOUNDS;
  const cols = Math.ceil((maxX - minX) / WALK_GRID_CELL);
  const rows = Math.ceil((maxZ - minZ) / WALK_GRID_CELL);
  const cellOf = (x, z) => ({
    c: Math.floor((x - minX) / WALK_GRID_CELL),
    r: Math.floor((z - minZ) / WALK_GRID_CELL),
  });
  const cellCenter = (c, r) => ({ x: minX + (c + 0.5) * WALK_GRID_CELL, z: minZ + (r + 0.5) * WALK_GRID_CELL });
  const inBounds = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
  const walkable = (c, r) => {
    if (!inBounds(c, r)) return false;
    const { x, z } = cellCenter(c, r);
    return isWalkableCell(x, z, extraObstacles);
  };

  const start = cellOf(fromX, fromZ);
  const goal = cellOf(toX, toZ);
  if (!walkable(start.c, start.r) || !walkable(goal.c, goal.r)) return false;

  const visited = new Uint8Array(cols * rows);
  const key = (c, r) => r * cols + c;
  const queue = [start];
  visited[key(start.c, start.r)] = 1;
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    if (cur.c === goal.c && cur.r === goal.r) return true;
    const neighbors = [
      [cur.c + 1, cur.r],
      [cur.c - 1, cur.r],
      [cur.c, cur.r + 1],
      [cur.c, cur.r - 1],
    ];
    for (const [nc, nr] of neighbors) {
      const k = key(nc, nr);
      if (inBounds(nc, nr) && !visited[k] && walkable(nc, nr)) {
        visited[k] = 1;
        queue.push({ c: nc, r: nr });
      }
    }
  }
  return false;
}

// Minimum gap required between any obstacle's edge and the nearest other
// obstacle (or wall) — enough for the player (diameter 2*PLAYER_RADIUS) to
// pass through comfortably, with real margin to spare, not just barely fit.
const MIN_OBSTACLE_CLEARANCE = 2.8;

// Shortest distance between two axis-aligned boxes (0 if they touch/overlap).
function boxGap(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
  return Math.hypot(dx, dz);
}

// Every other registered obstacle (walls included) must be at least
// MIN_OBSTACLE_CLEARANCE away from `obstacle`.
function hasClearance(obstacle) {
  for (const o of obstacles) {
    if (o === obstacle) continue;
    if (boxGap(obstacle, o) < MIN_OBSTACLE_CLEARANCE) return false;
  }
  return true;
}

// Places any obstacle (crate stack, barrel, or shelf — anything whose builder
// returns {meshes, obstacle}), then checks TWO things: that it has real
// clearance from every wall and every other obstacle already placed
// (hasClearance), and that the start->puppy route still exists (pathExists —
// belt-and-suspenders, since good clearance everywhere should already imply
// this, but it's cheap to double-check). If either fails, the placement is
// undone — meshes removed, obstacle entry removed — and a warning is logged
// instead of silently leaving a too-tight gap or a sealed route.
function placeObstacleSafe(builder, cx, cz, ...args) {
  const { meshes, obstacle } = builder(cx, cz, ...args);
  const clearanceOk = hasClearance(obstacle);
  const routeOk = pathExists(PLAYER_SPAWN_XZ.x, PLAYER_SPAWN_XZ.z, PUPPY_XZ.x, PUPPY_XZ.z);
  if (!clearanceOk || !routeOk) {
    for (const m of meshes) {
      scene.remove(m);
      m.geometry.dispose();
    }
    const idx = obstacles.indexOf(obstacle);
    if (idx !== -1) obstacles.splice(idx, 1);
    console.warn(
      `[level] obstacle at (${cx}, ${cz}) skipped — ${!clearanceOk ? 'too close to a wall/obstacle' : 'would seal the only route'}.`
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Collision — movers are treated as circles of radius `r`. Push-out always
// happens along whichever axis needs the SMALLER correction (not just "the
// axis we happened to move on") — walls here are long, thin boxes, and
// resolving on the wrong axis of a long box flings the mover to its far end.
// Doing this after the X move and again after the Z move gives wall-sliding.
// ---------------------------------------------------------------------------
function resolveObstacle(pos, r, o) {
  const minX = o.minX - r;
  const maxX = o.maxX + r;
  const minZ = o.minZ - r;
  const maxZ = o.maxZ + r;
  if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) return; // no overlap
  const pushLeft = pos.x - minX;
  const pushRight = maxX - pos.x;
  const pushUp = pos.z - minZ;
  const pushDown = maxZ - pos.z;
  const xPush = Math.min(pushLeft, pushRight);
  const zPush = Math.min(pushUp, pushDown);
  if (xPush < zPush) {
    pos.x = pushLeft < pushRight ? minX : maxX;
  } else {
    pos.z = pushUp < pushDown ? minZ : maxZ;
  }
}

function resolveCollisions(pos, r) {
  for (const o of obstacles) resolveObstacle(pos, r, o);
}

function moveWithCollision(pos, dx, dz, r) {
  pos.x += dx;
  resolveCollisions(pos, r);
  pos.z += dz;
  resolveCollisions(pos, r);
}

// ---------------------------------------------------------------------------
// Ray/segment occlusion — used both to cut the drawn vision cone off at
// obstacles and to decide whether an NPC can actually SEE the player through
// one (cone + range are necessary but no longer sufficient for detection).
// ---------------------------------------------------------------------------
function rayAABBEntry(ox, oz, dx, dz, o) {
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < o.minX || ox > o.maxX) return Infinity;
  } else {
    let t1 = (o.minX - ox) / dx;
    let t2 = (o.maxX - ox) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < o.minZ || oz > o.maxZ) return Infinity;
  } else {
    let t1 = (o.minZ - oz) / dz;
    let t2 = (o.maxZ - oz) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmin > tmax || tmax < 0) return Infinity;
  return Math.max(tmin, 0);
}

// Distance from (ox,oz) to the nearest obstacle along `dirAngle`, capped at maxDist.
function rayObstacleDistance(ox, oz, dirAngle, maxDist) {
  const dx = Math.cos(dirAngle);
  const dz = Math.sin(dirAngle);
  let best = maxDist;
  for (const o of obstacles) {
    const t = rayAABBEntry(ox, oz, dx, dz, o);
    if (t < best) best = t;
  }
  return best;
}

// Is there an obstacle anywhere on the straight line between the two points?
function segmentBlocked(ox, oz, tx, tz) {
  const dx = tx - ox;
  const dz = tz - oz;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return false;
  const hit = rayObstacleDistance(ox, oz, Math.atan2(dz, dx), dist);
  return hit < dist - 0.02; // small epsilon so grazing the far edge isn't a false block
}

// ---------------------------------------------------------------------------
// Warehouse layout — ONE large open floor, not a series of small rooms and
// corridors. Walls only frame the outer edges (player starts near the
// bottom, the puppy waits near the top — same overall vertical shape as
// before, just without any interior walls carving it into rooms/hallways).
// Navigation challenge and cover now come entirely from the freestanding
// obstacles scattered across the open floor below, not from tight geometry.
// ---------------------------------------------------------------------------
function buildOuterWalls(x, z) {
  const zc = (z[0] + z[1]) / 2;
  const zLen = z[1] - z[0];
  addWall(x[0], zc, WALL_THICKNESS, zLen); // west wall
  addWall(x[1], zc, WALL_THICKNESS, zLen); // east wall
  const xc = (x[0] + x[1]) / 2;
  const xLen = x[1] - x[0];
  addWall(xc, z[1], xLen, WALL_THICKNESS); // south wall (bottom, near the player)
  addWall(xc, z[0], xLen, WALL_THICKNESS); // north wall (top, near the puppy)
}

const FLOOR_X = [-15, 15]; // 30 units wide
const FLOOR_Z = [-41, 37]; // 78 units tall — same overall vertical span as before
buildOuterWalls(FLOOR_X, FLOOR_Z);

// Obstacles — a deliberate zigzag of crates, barrels, and shelving units
// spaced down the length of the floor, each placed with placeObstacleSafe
// (which skips, and warns about, anything that ends up too close to a wall
// or another obstacle, or that would seal the route — see above). This is
// hand-placed for sightline/cover purposes, not randomly scattered.
// Sizes/levels/heights deliberately span a wide range now (small single
// crates up to tall triple stacks, squat kegs up to tall drums, low-wide
// racks up to tall-narrow ones) so the floor doesn't read as one obstacle
// type repeated with a paint-by-numbers size tweak.
placeObstacleSafe(addCrateStack, 5, 28, 2.6, 2, 1.3); // near the start — a big double stack
placeObstacleSafe(addBarrel, -9, 27, 0.65, 1.6);
placeObstacleSafe(addShelf, 2, 18, 3.2, 0.9, 2.8, true);
placeObstacleSafe(addCrateStack, -8, 13, 1.4, 1, 1.1); // small single crate, not a stack at all
placeObstacleSafe(addBarrel, 7, 9, 0.85, 2.3); // a big drum
placeObstacleSafe(addShelf, -3, 4, 2.7, 0.9, 3.2, false); // taller, narrower rack
placeObstacleSafe(addCrateStack, 8, -3, 2.0, 3, 1.0); // tall triple stack, shorter levels
placeObstacleSafe(addBarrel, -7, -7, 0.55, 1.4); // a small keg
placeObstacleSafe(addShelf, 3, -13, 3.8, 0.9, 2.4, true); // wide, low rack
placeObstacleSafe(addCrateStack, -5, -19, 1.6, 2, 1.2);
placeObstacleSafe(addBarrel, 8, -23, 0.75, 2.0);
placeObstacleSafe(addShelf, -2, -29, 3.0, 0.9, 3.0, false);
placeObstacleSafe(addCrateStack, 6, -33, 2.3, 2, 1.3); // near the puppy
placeObstacleSafe(addBarrel, -8, -36, 0.7, 1.8);
// A few extra scattered barrels/crates tucked into otherwise-open stretches,
// purely for texture/variety — not tied to the original zigzag cover line.
placeObstacleSafe(addBarrel, 11, 22, 0.6, 1.5);
placeObstacleSafe(addBarrel, -11, -1, 0.6, 1.7);
placeObstacleSafe(addCrateStack, 10, 3, 1.5, 1, 1.0);

// Density/variety pass: a second shelving style, two vehicles, a junk pile,
// and bicycles — a warehouse should have more going on in it than one
// obstacle type repeated. Placed off the original zigzag, mostly hugging
// the long open stretches nearer the east/west walls.
placeObstacleSafe(addPalletRack, 11, -8, 3.4, 0.8, 3.2, true);
placeObstacleSafe(addPalletRack, -11, -26, 3.2, 0.8, 2.9, true);
placeObstacleSafe(addForklift, -10.3, 8, false);
placeObstacleSafe(addCar, 10.5, 32, true); // parked near the entrance
placeObstacleSafe(addJunkPile, 10.5, -16, 1.1);
placeObstacleSafe(addJunkPile, -10.5, 20, 1.0);
placeObstacleSafe(addBicycle, 11, -30, false);
placeObstacleSafe(addBicycle, -11, -16, true);

// Clutter pass: a couple of pallets as their own small prop, loose debris
// scattered around a few of the larger objects above, and small "stored
// goods" boxes resting on a couple of shelves/racks — so a given area mixes
// several distinct prop types and reads as lived-in/scattered rather than
// one clean shape sitting alone in otherwise-empty space. The scatter/items
// calls are deliberately NOT placeObstacleSafe — see addDebrisScatter's own
// comment for why they carry no collision footprint at all.
placeObstacleSafe(addPallet, -8, 3, true);
placeObstacleSafe(addPallet, -4, 24, false);
addDebrisScatter(5, 28, 4, 1.3, 1.6); // around the start-area crate stack (2.6-wide, half=1.3)
addDebrisScatter(8, -3, 3, 1.2, 1.3); // around the tall triple crate stack (2.0-wide, half=1.0)
addDebrisScatter(-10.3, 8, 3, 1.4, 1.7); // around the forklift (~3.0 long, half=1.5)
addDebrisScatter(10.5, 32, 3, 1.3, 2.0); // around the parked car (3.4 long, half=1.7)
addShelfItems(2, 18, 2.8, 3, 0.9); // resting on the shelf at (2,18), height 2.8
addShelfItems(-3, 4, 3.2, 3, 0.9); // resting on the shelf at (-3,4), height 3.2
addShelfItems(11, -8, 3.2 * 0.75, 3, 0.7); // resting on the pallet rack's top beam

// ---------------------------------------------------------------------------
// Lighting — moody, high-contrast look: dark warehouse, broken up by several
// hanging industrial lamps, each carving its own warm pool of light.
// ---------------------------------------------------------------------------
// Ambient sets the gameplay-readable floor of visibility everywhere — a guard
// standing in a totally unlit corridor still needs its OWN body (not just its
// cone, which is unlit and already always visible) to read clearly, not just
// be technically non-zero. This number looks huge for what's still a dim,
// moody corridor — that's ACES's shadow "toe" compressing dim values hard, so
// small ambient bumps barely move the visible result; getting from "barely
// guessable" to "clearly readable" took a well-over-10x jump, not a nudge
// (confirmed by pixel readback, not just eyeballing a screenshot).
// A flat ambient bump alone flattens the lit-pool-vs-darkness contrast that
// was the whole point of phase 1's lighting, though — so the lamps below got
// a matching ~1.5x boost to keep them reading clearly brighter, and every
// material is kept muted/low-gloss so nothing clips to white under one at
// this light level (also verified per-material via pixel readback).
const ambient = new THREE.AmbientLight(0x232a38, 50);
scene.add(ambient);

// A soft global directional light for gentle form on vertical surfaces
// (walls, crates, the player/NPC cubes) — raised alongside the ambient.
const fill = new THREE.DirectionalLight(0x8ea0c0, 0.5);
fill.position.set(-4, 8, -6);
scene.add(fill);

function makeLamp(x, z, opts = {}) {
  const {
    intensity = 850,
    range = 45,
    coneAngle = 0.42,
    penumbra = 0.5,
    color = 0xffe0b8,
    height = 14,
    shadow = false,
  } = opts;
  const light = new THREE.SpotLight(color, intensity, range, coneAngle, penumbra, 2.0);
  light.position.set(x, height, z);
  light.target.position.set(x, 0, z);
  if (shadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(1536, 1536);
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 45;
    light.shadow.bias = -0.0004;
  }
  scene.add(light, light.target);
  return light;
}

// Deliberately irregular: no lamp in the corridors (keep those tense and
// dark), lamps of a few different sizes/intensities spread down the floor —
// not one evenly-spaced light per zone.
const lamps = [
  makeLamp(0, 32, { shadow: true, intensity: 1000, coneAngle: 0.38 }), // near the start
  makeLamp(-2, 8, { intensity: 1350, coneAngle: 0.48 }),
  makeLamp(6, -9, { intensity: 1300, coneAngle: 0.42 }),
  makeLamp(8, -16, { intensity: 1000, coneAngle: 0.32 }),
  makeLamp(-4, -37, { shadow: true, intensity: 1450, coneAngle: 0.46 }), // over the puppy
  makeLamp(1, -33, { intensity: 850, coneAngle: 0.3 }),
];

// ---------------------------------------------------------------------------
// Shared character builder — Roblox-style blocky humanoid built entirely
// from real 3D primitives (boxes for head/torso/limbs), no external files.
// Materials are MeshStandardMaterial, so these are properly lit/shaded by
// the scene's own lamps/ambient exactly like every crate and wall — not a
// flat, unlit sprite. Used for the player and every NPC (same body plan,
// different colors). The head sits offset toward local +X — this project's
// "forward" convention, see updateVisionCone's comment — so which way a
// character faces is legible at a glance from directly overhead. Since the
// geometry is hand-built here, "which way is front" is baked in directly by
// construction; unlike an external sprite or glTF model, there's no source
// file whose facing direction has to be reverse-engineered afterward.
// ---------------------------------------------------------------------------
function makeCharacterMesh({ size, bodyColor, headColor, limbColor, emissive, emissiveIntensity }) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8, metalness: 0.05, emissive, emissiveIntensity });
  const headMat = new THREE.MeshStandardMaterial({
    color: headColor,
    roughness: 0.75,
    metalness: 0.05,
    emissive,
    emissiveIntensity: emissiveIntensity * 0.8,
  });
  const limbMat = new THREE.MeshStandardMaterial({
    color: limbColor,
    roughness: 0.8,
    metalness: 0.05,
    emissive,
    emissiveIntensity: emissiveIntensity * 0.7,
  });

  // Proportions as fractions of `size` (matches PLAYER_SIZE/NPC_SIZE — the
  // stack of legs+torso+head adds up to exactly `size` tall). Axis
  // convention throughout this file: local +X = forward/depth, local Z =
  // left-right, local Y = up.
  const legHeight = size * 0.36;
  const torsoHeight = size * 0.36;
  const headSize = size * 0.28;
  const torsoDepth = size * 0.22; // front-to-back (X)
  const torsoWidth = size * 0.4; // shoulder-to-shoulder (Z)
  const limb = size * 0.15; // arm/leg box thickness

  const addPart = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Legs — feet at y=0, standing under the torso.
  const legGeo = new THREE.BoxGeometry(limb, legHeight, limb);
  for (const side of [-1, 1]) {
    addPart(legGeo, limbMat, 0, legHeight / 2, (side * torsoWidth) / 4);
  }

  // Torso.
  addPart(
    new THREE.BoxGeometry(torsoDepth, torsoHeight, torsoWidth),
    bodyMat,
    0,
    legHeight + torsoHeight / 2,
    0
  );

  // Arms — hang alongside the torso, same height range.
  const armGeo = new THREE.BoxGeometry(limb, torsoHeight, limb);
  for (const side of [-1, 1]) {
    addPart(armGeo, limbMat, 0, legHeight + torsoHeight / 2, side * (torsoWidth / 2 + limb / 2));
  }

  // Head — offset forward (+X) past the torso's front face, and clearly
  // overlapping/poking out ahead of the silhouette, so facing direction
  // reads at a glance.
  addPart(
    new THREE.BoxGeometry(headSize, headSize, headSize),
    headMat,
    torsoDepth / 2 + headSize * 0.35,
    legHeight + torsoHeight + headSize / 2,
    0
  );

  return group;
}

// ---------------------------------------------------------------------------
// Player — spawned near the bottom of the open floor (the puppy waits near
// the top). Distinct teal color, clearly different from the NPCs' red.
// ---------------------------------------------------------------------------
const PLAYER_SPAWN = new THREE.Vector3(PLAYER_SPAWN_XZ.x, 0, PLAYER_SPAWN_XZ.z);
const player = makeCharacterMesh({
  size: PLAYER_SIZE,
  bodyColor: 0x1f6f8a,
  headColor: 0x2f8ba8, // a touch lighter than the body — reads as a head, not just more torso
  limbColor: 0x18576d,
  // Constant self-glow so the player can always see their own character,
  // even standing in total darkness far from any lamp. This is emissive —
  // it makes the player's OWN surface glow, it does not cast any light
  // onto the floor or anything else, so it can't tip off an NPC or light
  // up the surroundings. Whether an NPC can SEE the player is still purely
  // the cone/occlusion logic in detectingNpc() — unrelated to this.
  emissive: 0x14424e,
  emissiveIntensity: 0.35,
});
player.position.copy(PLAYER_SPAWN);
// Matches lastMoveDir's default of (0,-1) ("facing up/north") below — the
// player starts already facing the direction it would first walk in.
const PLAYER_SPAWN_HEADING = -Math.PI / 2;
let playerHeading = PLAYER_SPAWN_HEADING; // current facing (eases toward playerDesiredHeading)
let playerDesiredHeading = PLAYER_SPAWN_HEADING; // where it wants to face — toward its last move direction
player.rotation.y = -playerHeading;
scene.add(player);

// Start the camera already centred on the player, so the very first frame
// doesn't pan in from the origin.
cameraFocus.set(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
camera.position.set(cameraFocus.x, CAMERA_HEIGHT, cameraFocus.y);
camera.lookAt(cameraFocus.x, 0, cameraFocus.y);

// ---------------------------------------------------------------------------
// Camera follow — smoothly chases the player's (x, z) position every frame.
// Still strictly top-down (position.y and the up vector never change, so
// there's no angle change, ever) — only where it's centred moves, and it
// eases toward the player rather than snapping, via frame-rate-independent
// exponential smoothing (1 - e^-rate*dt), not a fixed per-frame lerp factor.
// ---------------------------------------------------------------------------
const CAMERA_FOLLOW_RATE = 3.2; // higher = the camera catches up faster
function updateCamera(dt) {
  const t = 1 - Math.exp(-CAMERA_FOLLOW_RATE * dt);
  cameraFocus.x += (player.position.x - cameraFocus.x) * t;
  cameraFocus.y += (player.position.z - cameraFocus.y) * t; // .y here holds world Z
  camera.position.set(cameraFocus.x, CAMERA_HEIGHT, cameraFocus.y);
  camera.lookAt(cameraFocus.x, 0, cameraFocus.y);
}

// ---------------------------------------------------------------------------
// WASD movement — delta-time based so speed is frame-rate independent.
//
// Screen/world mapping for this top-down camera (looking down -Y, up = -Z):
//   W = "away from camera" (up on screen)  = world -Z
//   S = "toward camera"    (down on screen) = world +Z
//   A = left on screen                      = world -X
//   D = right on screen                     = world +X
// The player collides with walls and crates (see `moveWithCollision`).
// ---------------------------------------------------------------------------
const PLAYER_SPEED = 9; // world units per second
const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const moveDir = new THREE.Vector3();
// Last direction the player was actually moving in — used to trail the
// carried puppy behind the player rather than snapping it to a fixed side.
const lastMoveDir = new THREE.Vector2(0, -1); // default: facing "up"/north
function updatePlayer(dt) {
  moveDir.set(0, 0, 0);
  if (keys.has('KeyW') || keys.has('ArrowUp')) moveDir.z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) moveDir.z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) moveDir.x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) moveDir.x += 1;

  if (moveDir.lengthSq() > 0) {
    moveDir.normalize(); // keep diagonal speed equal to cardinal speed
    lastMoveDir.set(moveDir.x, moveDir.z);
    // Only retarget the desired facing while actually moving — same as an
    // NPC holding its last heading through a 'pause' — so letting go of all
    // keys just stops turning rather than snapping back to some default.
    playerDesiredHeading = Math.atan2(moveDir.z, moveDir.x);
    moveWithCollision(player.position, moveDir.x * PLAYER_SPEED * dt, moveDir.z * PLAYER_SPEED * dt, PLAYER_RADIUS);
  }

  // Ease toward the desired facing exactly like a guard does (approachAngle,
  // same TURN_SPEED cap) — reusing the identical mechanism, not a lookalike
  // one, so the player's turning speed can never be faster (or slower) than
  // what's already established as the game's own fairness/feel baseline.
  playerHeading = approachAngle(playerHeading, playerDesiredHeading, TURN_SPEED * dt);
  player.rotation.y = -playerHeading;
}

// ---------------------------------------------------------------------------
// NPCs — wandering guards with a vision cone. Detection = instant game over.
// (Values here are deliberately loose knobs, meant to be tuned later.)
// ---------------------------------------------------------------------------
const NPC_SPEED_SLOW = 1.8;
const NPC_SPEED_NORMAL = 3.6; // the original baseline
const NPC_SPEED_FAST = 6.2;
// Hard cap on how fast ANY character's facing can rotate, in radians/sec —
// shared by guards AND the player, via the same approachAngle() easing
// (guards: the call in updateNpc, below; player: the call in updatePlayer,
// above). This is a PLAYER-FAIRNESS cap for guards, not just a style knob:
// every guard rotation trigger — normal wander retargeting, the cone-overlap
// reaction, and the wall-avoidance correction — works by setting a new
// `target`/`desiredHeading` and nothing else, so this constant is the only
// thing that determines guard turn rate, uniformly, no matter which behavior
// asked for the turn. Tuned down from an earlier 4.5 (~258°/s, a 180° spin in
// 0.7s) to 2.4 (~137°/s, a 180° spin in ~1.3s) specifically so an attentive
// player has a real window to notice a guard swinging toward them and react,
// without it dragging — see the turn-speed test in this project's
// memory/testing notes for the reasoning. Reusing it for the player too
// keeps both characters' turning feeling like the same game, not two
// different rules glued together.
const TURN_SPEED = 2.4;
const VISION_RANGE = 9; // how far the cone reaches, world units
const VISION_HALF_ANGLE = THREE.MathUtils.degToRad(28); // ~56 deg full cone
const CONE_RAYS = 40; // angular resolution of the drawn (and occluded) cone
const WANDER_MIN_DIST = 4;
const WANDER_MAX_DIST = 9;
// Just inside the outer walls (FLOOR_X/FLOOR_Z). A loose global clamp only —
// WANDER_MAX_DIST (9) keeps any single hop local, and the stuck-timer below
// re-picks if a hop lands against a wall or an obstacle.
const WANDER_BOUNDS = { x: 14, z: 40 };
const PAUSE_MIN = 0.6;
const PAUSE_MAX = 2.2;
// After two guards' cones cross and they redirect, neither can be spooked by a
// cone again until this expires — stops them flip-flopping while cones linger.
const OVERLAP_COOLDOWN = 2.5;
// If a wall/crate blocks progress toward the current wander target for this
// long, give up on it and pick a new one instead of pushing on a wall forever.
const STUCK_GIVEUP = 0.4;
// A guard "noticing" its cone is mostly wasted against a nearby wall/obstacle
// and picking a more open direction instead — same redirect mechanism as the
// cone-overlap reaction above, just triggered by a different condition, and
// on its own cooldown so it doesn't re-evaluate (or flip-flop) every frame.
const WALL_HUG_CHECK_DIST = 3; // "short distance" for this check
const WALL_HUG_FRACTION = 0.6; // this much of the cone blocked within that distance counts as wall-facing
const WALL_HUG_SAMPLES = 7;
const WALL_HUG_COOLDOWN = 3.5;

const npcs = [];

// Step `current` toward `target` angle by at most `maxDelta`, via the short way.
function approachAngle(current, target, maxDelta) {
  let diff = ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // -PI..PI
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

// heading is an angle in the XZ plane: direction = (cos h, sin h) == (dx, dz).
function pickWanderTarget(npc) {
  const ang = Math.random() * Math.PI * 2;
  const dist = WANDER_MIN_DIST + Math.random() * (WANDER_MAX_DIST - WANDER_MIN_DIST);
  npc.target.set(
    THREE.MathUtils.clamp(npc.mesh.position.x + Math.cos(ang) * dist, -WANDER_BOUNDS.x, WANDER_BOUNDS.x),
    0,
    THREE.MathUtils.clamp(npc.mesh.position.z + Math.sin(ang) * dist, -WANDER_BOUNDS.z, WANDER_BOUNDS.z)
  );
}

// A flat triangle-fan mesh: apex + a ray-per-angle rim. Rebuilt every frame so
// it can be cut short by whatever the corresponding ray actually hits.
function makeConeGeometry() {
  const vertexCount = CONE_RAYS + 2; // apex + (CONE_RAYS + 1) rim points
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const indices = [];
  for (let i = 1; i <= CONE_RAYS; i++) indices.push(0, i, i + 1);
  geo.setIndex(indices);
  return geo;
}

// Recompute the cone's shape by casting a ray per angular step and stopping at
// whatever obstacle it hits first (or VISION_RANGE if nothing's in the way).
// Coordinates are local to `npc.pivot`, whose rotation already points local
// +X along the NPC's heading — so a local ray angle `theta` corresponds to
// world angle `heading + theta`.
function updateVisionCone(npc) {
  const pos = npc.coneGeo.attributes.position.array;
  pos[0] = 0;
  pos[1] = 0.06;
  pos[2] = 0;
  const ox = npc.mesh.position.x;
  const oz = npc.mesh.position.z;
  for (let i = 0; i <= CONE_RAYS; i++) {
    const theta = -VISION_HALF_ANGLE + (i / CONE_RAYS) * (2 * VISION_HALF_ANGLE);
    const dist = rayObstacleDistance(ox, oz, npc.heading + theta, VISION_RANGE);
    const idx = (i + 1) * 3;
    pos[idx] = Math.cos(theta) * dist;
    pos[idx + 1] = 0.06;
    pos[idx + 2] = Math.sin(theta) * dist;
  }
  npc.coneGeo.attributes.position.needsUpdate = true;
}

function makeNpc(x, z, speed = NPC_SPEED_NORMAL) {
  // Deeper/rougher red than it looks like it "should" be, same reasoning as
  // the player's material: at ambient=50, a brighter red clips to white
  // under a lamp. This still reads as a clear, saturated red everywhere —
  // and clearly distinct from the player's teal. All guards share this one
  // look; per-guard color variation isn't needed right now.
  const mesh = makeCharacterMesh({
    size: NPC_SIZE,
    bodyColor: 0x8f342c,
    headColor: 0xad4536, // a touch lighter than the body — reads as a head, not just more torso
    limbColor: 0x6f251f,
    emissive: 0x2a0a08,
    emissiveIntensity: 0.12,
  });
  mesh.position.set(x, 0, z);
  scene.add(mesh);

  // Vision cone: a flat translucent fan lying on the floor, rebuilt each frame
  // by updateVisionCone() so it's cut off by walls/crates. Parented to a yaw
  // pivot at the NPC so rotating the pivot aims the whole thing.
  const coneGeo = makeConeGeometry();
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xff5a4a,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.renderOrder = 1;
  cone.frustumCulled = false; // geometry is rebuilt every frame; never cull it away

  const pivot = new THREE.Object3D();
  pivot.position.set(x, 0, z);
  pivot.add(cone);
  scene.add(pivot);

  const startHeading = Math.random() * Math.PI * 2;
  const npc = {
    mesh,
    pivot,
    coneGeo,
    speed,
    spawn: new THREE.Vector3(x, 0, z), // the model grounds itself to local y=0 — see makeCharacterMesh
    heading: startHeading, // current facing (eases toward desiredHeading)
    desiredHeading: startHeading, // where it wants to face — toward its target
    state: 'walk',
    timer: 0,
    stuckTime: 0,
    overlapCooldown: 0, // seconds left before this guard can react to a cone again
    wallHugCooldown: 0, // seconds left before this guard can react to facing a wall again
    target: new THREE.Vector3(x, 0, z),
  };
  mesh.rotation.y = -startHeading;
  pivot.rotation.y = -startHeading;
  pickWanderTarget(npc);
  updateVisionCone(npc);
  npcs.push(npc);
  return npc;
}

function updateNpc(npc, dt) {
  if (npc.overlapCooldown > 0) npc.overlapCooldown -= dt;
  if (npc.wallHugCooldown > 0) npc.wallHugCooldown -= dt;

  if (npc.state === 'pause') {
    npc.timer -= dt;
    if (npc.timer <= 0) {
      pickWanderTarget(npc);
      npc.state = 'walk';
    }
  } else {
    const dx = npc.target.x - npc.mesh.position.x;
    const dz = npc.target.z - npc.mesh.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      npc.state = 'pause';
      npc.timer = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
      npc.stuckTime = 0;
    } else {
      // face toward the target, but only *approach* that angle — don't snap to it
      npc.desiredHeading = Math.atan2(dz, dx);
      const align = Math.cos(npc.heading - npc.desiredHeading); // 1 = aligned, -1 = opposite
      // Walk along the way we're actually facing, so a redirect reads as a curve
      // into the new direction; ease off the gas while sharply turning. Once
      // close, steer straight at the target so we can't orbit it forever (the
      // turn circle, ~speed/TURN_SPEED, is wider than the arrival radius).
      let mx = Math.cos(npc.heading);
      let mz = Math.sin(npc.heading);
      if (d < 1.5) {
        mx = dx / d;
        mz = dz / d;
      }
      const speedFactor = THREE.MathUtils.clamp(0.3 + 0.7 * align, 0.15, 1);
      const stepDist = npc.speed * speedFactor * dt;
      const beforeX = npc.mesh.position.x;
      const beforeZ = npc.mesh.position.z;
      moveWithCollision(npc.mesh.position, mx * stepDist, mz * stepDist, NPC_RADIUS);
      const moved = Math.hypot(npc.mesh.position.x - beforeX, npc.mesh.position.z - beforeZ);
      // A wall or crate is blocking progress toward this target — give up on
      // it rather than shove against the obstacle indefinitely.
      if (stepDist > 1e-6 && moved < stepDist * 0.2) {
        npc.stuckTime += dt;
        if (npc.stuckTime > STUCK_GIVEUP) {
          pickWanderTarget(npc);
          npc.stuckTime = 0;
        }
      } else {
        npc.stuckTime = 0;
      }
    }
  }

  // Ease the facing (and therefore the vision cone, and the visible model —
  // see makeCharacterMesh) toward the desired heading. This is the ONLY line
  // that ever changes npc.heading during gameplay — wander/spookApart/
  // turnTowardOpenDirection all just set a new target, never heading
  // directly — so TURN_SPEED caps every rotation uniformly no matter which
  // of them asked for it.
  npc.heading = approachAngle(npc.heading, npc.desiredHeading, TURN_SPEED * dt);

  npc.mesh.rotation.y = -npc.heading;
  npc.pivot.position.x = npc.mesh.position.x;
  npc.pivot.position.z = npc.mesh.position.z;
  npc.pivot.rotation.y = -npc.heading;

  updateVisionCone(npc);
}

// Every point that currently counts for guard detection — cone AND contact
// alike funnel through this, so there's exactly one place that decides what's
// "detectable" at any moment, not two lists that could drift apart. Always
// the player's own position; ALSO the puppy's position once it's actually
// being carried (a guard spotting the dog trailing behind is just as much a
// catch as spotting the player). Before pickup the puppy is inert
// set-dressing sitting at its spawn point — explicitly NOT included, so a
// guard's cone sweeping over it there means nothing.
// `puppy`/`puppyCarried`/`PUPPY_HEIGHT` are declared further down the file
// (with the rest of the puppy's own logic); referencing them here is fine
// since this function's body only ever runs later, from animate()/`__D`,
// well after the whole module has finished initializing.
function detectionPoints() {
  const points = [{ x: player.position.x, z: player.position.z, radius: PLAYER_RADIUS }];
  if (puppyCarried) {
    points.push({ x: puppy.position.x, z: puppy.position.z, radius: PUPPY_HEIGHT });
  }
  return points;
}

// Cone + distance + line-of-sight: a wall or crate between the guard and a
// detectable point blocks detection even if that point is inside the cone's
// angle/range.
function detectingNpc() {
  const cosHalf = Math.cos(VISION_HALF_ANGLE);
  const points = detectionPoints();
  for (const npc of npcs) {
    for (const pt of points) {
      const dx = pt.x - npc.mesh.position.x;
      const dz = pt.z - npc.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > VISION_RANGE || d < 1e-4) continue;
      const dot = (dx / d) * Math.cos(npc.heading) + (dz / d) * Math.sin(npc.heading);
      if (dot < cosHalf) continue;
      if (segmentBlocked(npc.mesh.position.x, npc.mesh.position.z, pt.x, pt.z)) continue;
      return npc;
    }
  }
  return null;
}

// A second, independent fail condition: a guard bumping straight into a
// detectable point is caught regardless of where it's facing or whether its
// cone reaches that point — vision and physical contact are two separate
// checks, either one triggers "CAUGHT". Each point brings its own radius
// (player vs. carried-puppy) so the contact distance is sized to whichever
// one is actually being touched.
function touchingNpc() {
  for (const npc of npcs) {
    for (const pt of detectionPoints()) {
      const dx = pt.x - npc.mesh.position.x;
      const dz = pt.z - npc.mesh.position.z;
      if (Math.hypot(dx, dz) <= pt.radius + NPC_RADIUS) return npc;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cone-vs-cone reaction: if two guards' vision cones cross, both "notice" each
// other and pick a fresh heading away from one another.
// ---------------------------------------------------------------------------
const cosVisionHalf = Math.cos(VISION_HALF_ANGLE);

function pointInCone(x, z, npc) {
  const dx = x - npc.mesh.position.x;
  const dz = z - npc.mesh.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true; // the apex itself
  if (d > VISION_RANGE) return false;
  const dot = (dx / d) * Math.cos(npc.heading) + (dz / d) * Math.sin(npc.heading);
  return dot >= cosVisionHalf;
}

// Sample a fan of points covering `from`'s sector and see if any land in
// `other`'s sector. Approximate, but with continuous motion it reliably catches
// an overlap within a frame or two — good enough, and cheap.
function sectorSamplesInCone(from, other) {
  const RS = 4; // radial samples
  const AS = 4; // angular samples per side
  for (let ri = 1; ri <= RS; ri++) {
    const r = (ri / RS) * VISION_RANGE;
    for (let ai = 0; ai <= AS; ai++) {
      const ang = from.heading - VISION_HALF_ANGLE + (ai / AS) * (2 * VISION_HALF_ANGLE);
      const x = from.mesh.position.x + Math.cos(ang) * r;
      const z = from.mesh.position.z + Math.sin(ang) * r;
      if (pointInCone(x, z, other)) return true;
    }
  }
  return false;
}

function conesOverlap(a, b) {
  const apexDist = Math.hypot(
    a.mesh.position.x - b.mesh.position.x,
    a.mesh.position.z - b.mesh.position.z
  );
  if (apexDist > VISION_RANGE * 2) return false; // broad phase
  return sectorSamplesInCone(a, b) || sectorSamplesInCone(b, a);
}

// Redirect `npc` onto a fresh wander target — biased away from `other`, random
// spread, and chosen so the guard actually has to turn (a redirect you can't
// see isn't much of a reaction) while staying inside the wander area.
const MIN_SPOOK_TURN = THREE.MathUtils.degToRad(40);
function spookApart(npc, other) {
  const away = Math.atan2(
    npc.mesh.position.z - other.mesh.position.z,
    npc.mesh.position.x - other.mesh.position.x
  );
  let best = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    // first attempts lean away from the other guard; later ones go fully random
    const biased = attempt < 8;
    const base = biased ? away : Math.random() * Math.PI * 2;
    const spread = biased ? Math.PI * 0.9 : Math.PI * 2;
    const ang = base + (Math.random() - 0.5) * spread;
    // allow short hops too, so a guard pinned near the edge can still turn
    const dist = 2.5 + Math.random() * (WANDER_MAX_DIST - 2.5);
    const tx = npc.mesh.position.x + Math.cos(ang) * dist;
    const tz = npc.mesh.position.z + Math.sin(ang) * dist;
    const inBounds =
      Math.abs(tx) <= WANDER_BOUNDS.x && Math.abs(tz) <= WANDER_BOUNDS.z;
    const newHeading = Math.atan2(tz - npc.mesh.position.z, tx - npc.mesh.position.x);
    const turn = Math.abs(((newHeading - npc.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const score = (inBounds ? 10 : 0) + turn;
    if (!best || score > best.score) best = { tx, tz, score, turn };
    if (inBounds && turn >= MIN_SPOOK_TURN) break;
  }
  npc.target.set(
    THREE.MathUtils.clamp(best.tx, -WANDER_BOUNDS.x, WANDER_BOUNDS.x),
    0,
    THREE.MathUtils.clamp(best.tz, -WANDER_BOUNDS.z, WANDER_BOUNDS.z)
  );
  npc.state = 'walk';
  npc.timer = 0;
  npc.overlapCooldown = OVERLAP_COOLDOWN;
}

let overlapReactions = 0; // debug counter
function resolveConeOverlaps() {
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const a = npcs[i];
      const b = npcs[j];
      if (a.overlapCooldown > 0 || b.overlapCooldown > 0) continue; // still settling
      if (conesOverlap(a, b)) {
        spookApart(a, b);
        spookApart(b, a);
        overlapReactions++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wall-hugging correction: a guard whose cone is mostly eaten up by a nearby
// wall/obstacle (i.e. most of it is wasted looking at a surface a few units
// away) picks a more open direction instead. Uses the exact same "set a new
// wander target and let the existing turn-easing handle it" mechanism as the
// cone-overlap reaction, so the correction is the same smooth turn, not an
// instant snap — it just "notices" on a different trigger.
// ---------------------------------------------------------------------------
function coneMostlyBlockedByWall(npc) {
  let blocked = 0;
  for (let i = 0; i < WALL_HUG_SAMPLES; i++) {
    const theta = -VISION_HALF_ANGLE + (i / (WALL_HUG_SAMPLES - 1)) * (2 * VISION_HALF_ANGLE);
    const dist = rayObstacleDistance(npc.mesh.position.x, npc.mesh.position.z, npc.heading + theta, VISION_RANGE);
    if (dist < WALL_HUG_CHECK_DIST) blocked++;
  }
  return blocked / WALL_HUG_SAMPLES >= WALL_HUG_FRACTION;
}

// Picks whichever of several random candidate directions has the most open
// sightline (biased toward trying a handful before settling), and sends the
// guard toward it — reusing pickWanderTarget's target/state fields directly.
function turnTowardOpenDirection(npc) {
  let best = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = WANDER_MIN_DIST + Math.random() * (WANDER_MAX_DIST - WANDER_MIN_DIST);
    const tx = npc.mesh.position.x + Math.cos(ang) * dist;
    const tz = npc.mesh.position.z + Math.sin(ang) * dist;
    const inBounds = Math.abs(tx) <= WANDER_BOUNDS.x && Math.abs(tz) <= WANDER_BOUNDS.z;
    const openness = rayObstacleDistance(npc.mesh.position.x, npc.mesh.position.z, ang, VISION_RANGE);
    const score = (inBounds ? 10 : 0) + openness;
    if (!best || score > best.score) best = { tx, tz, score };
    if (inBounds && openness > VISION_RANGE * 0.7) break; // good enough, stop searching
  }
  npc.target.set(
    THREE.MathUtils.clamp(best.tx, -WANDER_BOUNDS.x, WANDER_BOUNDS.x),
    0,
    THREE.MathUtils.clamp(best.tz, -WANDER_BOUNDS.z, WANDER_BOUNDS.z)
  );
  npc.state = 'walk';
  npc.timer = 0;
  npc.wallHugCooldown = WALL_HUG_COOLDOWN;
}

let wallHugReactions = 0; // debug counter
function resolveWallHugging() {
  for (const npc of npcs) {
    if (npc.wallHugCooldown > 0) continue; // still settling into its last correction
    if (coneMostlyBlockedByWall(npc)) {
      turnTowardOpenDirection(npc);
      wallHugReactions++;
    }
  }
}

// Five guards spread out along the whole path, with a genuine mix of speeds
// so patrols feel varied rather than identical — not just 2 guards moving at
// one fixed pace. All spawns are well clear of the player's spawn so you
// can't lose while idle.
makeNpc(-9, 27, NPC_SPEED_SLOW); // near the start
makeNpc(-3, 10, NPC_SPEED_NORMAL);
makeNpc(10, -9, NPC_SPEED_FAST);
makeNpc(-1, -14, NPC_SPEED_NORMAL);
makeNpc(-9, -31, NPC_SPEED_SLOW); // guarding the approach to the puppy

// ---------------------------------------------------------------------------
// The puppy — the goal, waiting near the top of the open floor. Same
// hand-built-primitives approach as the player/NPCs (no external files):
// a block body, a smaller block head, small ear flaps, and a thin tail.
// Sized so it reads as a real, comfortably-visible dog standing next to the
// ~1-unit-wide player silhouette, not a tiny prop underfoot (an earlier
// sprite version cropped a lot of transparent padding into its nominal
// size, making the actual visible dog much smaller than intended — building
// the geometry directly here means there's no hidden padding to account
// for; every dimension below is real, visible footprint).
// ---------------------------------------------------------------------------
function makePuppyMesh() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.7, metalness: 0.05 });
  // Ears/tail/legs in a darker shade of the same gold so they read as
  // separate parts against the body, not just more block.
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xc38a2e, roughness: 0.75, metalness: 0.05 });

  const bodyLength = 1.1; // front-to-back (X)
  const bodyWidth = 0.6; // side-to-side (Z)
  const bodyHeight = 0.5;
  const legHeight = 0.32;
  const headSize = 0.46;

  const addPart = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Legs — four short stubs, one at each corner, feet at y=0.
  const legGeo = new THREE.BoxGeometry(0.16, legHeight, 0.16);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addPart(legGeo, trimMat, (sx * bodyLength) / 2.6, legHeight / 2, (sz * bodyWidth) / 2.4);
    }
  }

  // Body — sits on top of the legs.
  addPart(new THREE.BoxGeometry(bodyLength, bodyHeight, bodyWidth), bodyMat, 0, legHeight + bodyHeight / 2, 0);

  // Head — offset forward (+X) of the body's front face, clearly poking out
  // so facing direction reads at a glance, matching the humans' convention.
  const headX = bodyLength / 2 + headSize * 0.4;
  const headY = legHeight + bodyHeight * 0.68;
  addPart(new THREE.BoxGeometry(headSize, headSize, headSize * 0.9), bodyMat, headX, headY, 0);

  // Ears — small flaps on top of the head, angled outward.
  const earGeo = new THREE.BoxGeometry(0.14, 0.18, 0.07);
  for (const sz of [-1, 1]) {
    const ear = addPart(earGeo, trimMat, headX + 0.05, headY + headSize * 0.56, sz * headSize * 0.4);
    ear.rotation.x = sz * 0.35;
  }

  // Tail — a thin cone at the back, angled up and out.
  const tail = addPart(
    new THREE.ConeGeometry(0.07, 0.5, 8),
    trimMat,
    -bodyLength / 2 - 0.1,
    legHeight + bodyHeight * 0.65,
    0
  );
  tail.rotation.z = Math.PI / 2 + 0.6; // point outward and up from the back

  return group;
}

const PUPPY_HEIGHT = 0.8; // gameplay radius only (PUPPY_PICKUP_DIST / detection below) — NOT the visual size, see makePuppyMesh
const PUPPY_SPAWN = new THREE.Vector3(PUPPY_XZ.x, 0, PUPPY_XZ.z);
const puppy = makePuppyMesh();
puppy.position.copy(PUPPY_SPAWN);
scene.add(puppy);

// Picked up automatically on contact (no button) — once carried, it trails
// behind the player instead of sitting still at its spawn point.
const PUPPY_PICKUP_DIST = PLAYER_RADIUS + PUPPY_HEIGHT;
const PUPPY_TRAIL_DIST = 1.6; // how far behind the player it follows
const PUPPY_FOLLOW_RATE = 7; // higher = catches up to the trail point faster
let puppyCarried = false;

function checkPuppyPickup() {
  if (puppyCarried) return;
  const dx = player.position.x - puppy.position.x;
  const dz = player.position.z - puppy.position.z;
  if (Math.hypot(dx, dz) <= PUPPY_PICKUP_DIST) {
    puppyCarried = true;
    setDoorLocked(false); // reflect the new carrying state immediately
  }
}

// Smoothly chases a point just behind the player (opposite their last
// movement direction) — same exponential-smoothing approach as the camera,
// so it visibly trails rather than snapping to the player every frame.
function updatePuppyCarry(dt) {
  if (!puppyCarried) return;
  const targetX = player.position.x - lastMoveDir.x * PUPPY_TRAIL_DIST;
  const targetZ = player.position.z - lastMoveDir.y * PUPPY_TRAIL_DIST;
  const t = 1 - Math.exp(-PUPPY_FOLLOW_RATE * dt);
  puppy.position.x += (targetX - puppy.position.x) * t;
  puppy.position.z += (targetZ - puppy.position.z) * t;
}

// ---------------------------------------------------------------------------
// The door — the single entrance/exit, at the player's starting area. Built
// from three parts so it reads as an actual doorway, not a floor decal:
// a pale frame outline, a colored threshold panel (the locked/unlocked
// state), and a bright arrow pointing out through the wall behind it.
// Trigger logic keys off DOOR_XZ (a plain world-space point), not any mesh's
// .position, so the visual structure here is free to change independently.
// ---------------------------------------------------------------------------
const DOOR_XZ = { x: PLAYER_SPAWN_XZ.x, z: 35.6 }; // between spawn and the south wall
const DOOR_TRIGGER_DIST = 2.2;
const DOOR_W = 2.6;
const DOOR_D = 1.3;
const DOOR_LOCKED_COLOR = 0xd0342a; // clearly red
const DOOR_UNLOCKED_COLOR = 0x2fd06a; // clearly green — unmistakably different from locked

// Frame: four pale bars outlining the threshold, like a doorframe on the floor.
const doorFrameMaterial = new THREE.MeshStandardMaterial({
  color: 0xdcdad0,
  emissive: 0xdcdad0,
  emissiveIntensity: 0.18,
  roughness: 0.6,
  metalness: 0.2,
});
const FRAME_T = 0.22; // bar thickness
function addDoorFrameBar(w, d, ox, oz) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), doorFrameMaterial);
  bar.position.set(DOOR_XZ.x + ox, 0.11, DOOR_XZ.z + oz);
  bar.castShadow = true;
  bar.receiveShadow = true;
  scene.add(bar);
}
addDoorFrameBar(DOOR_W + FRAME_T * 2, FRAME_T, 0, -DOOR_D / 2 - FRAME_T / 2); // north
addDoorFrameBar(DOOR_W + FRAME_T * 2, FRAME_T, 0, DOOR_D / 2 + FRAME_T / 2); // south
addDoorFrameBar(FRAME_T, DOOR_D, -DOOR_W / 2 - FRAME_T / 2, 0); // west
addDoorFrameBar(FRAME_T, DOOR_D, DOOR_W / 2 + FRAME_T / 2, 0); // east

// Threshold panel — this is what setDoorLocked()/__D.door refer to.
const doorMaterial = new THREE.MeshStandardMaterial({
  color: DOOR_LOCKED_COLOR,
  emissive: DOOR_LOCKED_COLOR,
  emissiveIntensity: 0.55,
  roughness: 0.6,
  metalness: 0.1,
});
const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, 0.16, DOOR_D), doorMaterial);
door.position.set(DOOR_XZ.x, 0.08, DOOR_XZ.z);
door.receiveShadow = true;
scene.add(door);

// Arrow — always the same bright neutral color regardless of lock state, so
// "this is the way out" reads instantly even before the color registers.
// Points toward +Z (south), i.e. out through the wall it's set against.
const doorArrowMaterial = new THREE.MeshStandardMaterial({
  color: 0xf6f3e7,
  emissive: 0xf6f3e7,
  emissiveIntensity: 0.35,
  roughness: 0.5,
  metalness: 0.05,
});
const doorArrow = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.95, 3), doorArrowMaterial);
doorArrow.rotation.x = Math.PI / 2; // lay flat — apex now points toward +Z
doorArrow.position.set(DOOR_XZ.x, 0.22, DOOR_XZ.z);
doorArrow.castShadow = true;
scene.add(doorArrow);

function setDoorLocked(locked) {
  const c = locked ? DOOR_LOCKED_COLOR : DOOR_UNLOCKED_COLOR;
  doorMaterial.color.setHex(c);
  doorMaterial.emissive.setHex(c);
}

function checkDoor() {
  const dx = player.position.x - DOOR_XZ.x;
  const dz = player.position.z - DOOR_XZ.z;
  if (Math.hypot(dx, dz) > DOOR_TRIGGER_DIST) return;
  if (puppyCarried) triggerRescued();
  // Without the puppy, reaching the door does nothing beyond the passive
  // "locked" (red) color it already shows — that IS the feedback.
}

// ---------------------------------------------------------------------------
// Screen overlays — start screen + "CAUGHT"/retry (unstyled for now, just
// needs to work; both share the same basic look via makeOverlayButton).
// ---------------------------------------------------------------------------
function makeOverlayButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = [
    'font:bold 2.2vw/1 system-ui,sans-serif',
    'padding:0.6em 1.8em',
    'background:#3fb6d3',
    'color:#04191f',
    'border:none',
    'border-radius:8px',
    'cursor:pointer',
  ].join(';');
  btn.addEventListener('click', onClick);
  return btn;
}

// Gameplay (player/NPC updates, detection, camera follow) is paused until
// this is true. Set once, by the Play button — it never goes back to false.
let gameStarted = false;

// ---------------------------------------------------------------------------
// Timer — starts the instant Play is clicked, runs live on-screen during
// gameplay, and freezes the instant the player wins (reaches the door while
// carrying the puppy). Wall-clock based (performance.now()), deliberately NOT
// accumulated from per-frame dt — dt gets clamped on a tab-switch stall (see
// animate() below) specifically so gameplay/physics can't jump, but a
// leaderboard time should still reflect real elapsed time, not the clamped
// simulation time.
// ---------------------------------------------------------------------------
let timerStartTs = 0; // performance.now() at the most recent (re)start
let finalTime = 0; // seconds, captured once at the moment of victory/catch
let timerRunning = false;

function formatTime(totalSeconds) {
  const clamped = Math.max(0, totalSeconds);
  const m = Math.floor(clamped / 60);
  const s = clamped - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

// While running, reads live off the clock; once stopped, returns the frozen
// finalTime — so callers don't need to know which state they're in.
function currentElapsed() {
  return timerRunning ? (performance.now() - timerStartTs) / 1000 : finalTime;
}

function startTimer() {
  timerStartTs = performance.now();
  timerRunning = true;
}

function stopTimer() {
  finalTime = (performance.now() - timerStartTs) / 1000;
  timerRunning = false;
}

const timerEl = document.createElement('div');
timerEl.style.cssText = [
  'position:fixed',
  'top:18px',
  'left:50%',
  'transform:translateX(-50%)',
  'font:600 1.6vw/1 system-ui,sans-serif',
  'letter-spacing:0.08em',
  'color:#eaeaea',
  'background:rgba(0,0,0,0.45)',
  'padding:0.45em 0.9em',
  'border-radius:6px',
  'z-index:5', // above the game canvas, below every overlay (10/20/30)
  'display:none', // shown only while gameStarted && !gameOver && !gameWon
  'pointer-events:none',
].join(';');
timerEl.textContent = '00:00.00';
document.body.appendChild(timerEl);

// ---------------------------------------------------------------------------
// Leaderboard — backed by the "scores" table in Supabase (name, time_seconds,
// created_at; see the SQL used to create it). Two tabs, This Week / This
// Month, each sorted fastest-first. Fetched at most once per real day: a
// timestamped local cache (localStorage) covers every panel open in
// between, so repeatedly opening/closing the panel doesn't hit the database
// each time — a successful submit busts the cache immediately though, so
// the player who just set a time sees it show up right away rather than
// waiting for the next daily refresh.
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
const LEADERBOARD_REFRESH_MS = DAY_MS; // "once per day", per the agreed design
const LEADERBOARD_WINDOW_MS = { week: 7 * DAY_MS, month: 30 * DAY_MS };
const LEADERBOARD_TOP_N = 10;
const LEADERBOARD_CACHE_KEY = 'puppy-game:leaderboard-cache-v1';

// Escapes untrusted text before it goes into innerHTML. Every submitted name
// is exactly as trustworthy as any string typed by a stranger — the RLS
// policy allows any public insert, so this isn't optional.
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function readLeaderboardCache() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.scores)) return null;
    return parsed;
  } catch {
    return null; // storage can throw (private mode, cleared, disabled) — never let that break the panel
  }
}

function writeLeaderboardCache(scores) {
  try {
    localStorage.setItem(LEADERBOARD_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), scores }));
  } catch {
    // best-effort only
  }
}

// Forces the NEXT panel open to hit the database regardless of the daily
// cache, without this call site needing to already know the fresh data.
function invalidateLeaderboardCache() {
  try {
    localStorage.removeItem(LEADERBOARD_CACHE_KEY);
  } catch {
    // best-effort only
  }
}

// One query covers both tabs: fetch everyone from the last 30 days (the
// wider of the two windows), sorted fastest-first. "This Week" is just a
// tighter client-side filter over the same list — no second request needed.
async function fetchLeaderboardScores() {
  const since = new Date(Date.now() - LEADERBOARD_WINDOW_MS.month).toISOString();
  const { data, error } = await supabase
    .from('scores')
    .select('name, time_seconds, created_at')
    .gte('created_at', since)
    .order('time_seconds', { ascending: true })
    .limit(200); // generous — real per-tab trimming happens client-side
  if (error) throw error;
  return data;
}

const leaderboardEl = document.createElement('div');
leaderboardEl.style.cssText = [
  'position:fixed',
  'inset:0',
  'display:none',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:18px',
  'font:bold 3vw/1 system-ui,sans-serif',
  'letter-spacing:0.12em',
  'color:#eaeaea',
  'background:rgba(0,0,0,0.85)',
  'z-index:30', // above the start screen (20, hidden while this is open)
].join(';');
const leaderboardTitle = document.createElement('div');
leaderboardTitle.textContent = 'LEADERBOARD';

function makeTabButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = [
    'font:600 1.1vw/1 system-ui,sans-serif',
    'padding:0.5em 1.2em',
    'border:2px solid #3fb6d3',
    'border-radius:20px',
    'cursor:pointer',
  ].join(';');
  btn.addEventListener('click', onClick);
  return btn;
}
const tabRow = document.createElement('div');
tabRow.style.cssText = 'display:flex;gap:10px;';
const weekTabBtn = makeTabButton('This Week', () => setLeaderboardTab('week'));
const monthTabBtn = makeTabButton('This Month', () => setLeaderboardTab('month'));
tabRow.append(weekTabBtn, monthTabBtn);

const leaderboardList = document.createElement('div');
leaderboardList.style.cssText = [
  'font:1.3vw/2 system-ui,sans-serif',
  'letter-spacing:0.02em',
  'min-width:16em',
  'min-height:2em', // avoid a layout jump between "Loading…" and real rows
].join(';');

let leaderboardScores = []; // last-fetched list, <=30 days old, sorted fastest-first
let leaderboardTab = 'week';
let leaderboardLoadToken = 0; // guards a slow fetch from clobbering a newer one after re-open

function renderLeaderboardList() {
  const cutoff = Date.now() - LEADERBOARD_WINDOW_MS[leaderboardTab];
  const rows = leaderboardScores
    .filter((s) => new Date(s.created_at).getTime() >= cutoff)
    .slice(0, LEADERBOARD_TOP_N);
  leaderboardList.innerHTML = rows.length
    ? rows
        .map(
          (entry, i) =>
            `<div style="display:flex;justify-content:space-between;gap:2em;"><span>${i + 1}. ${escapeHtml(entry.name)}</span><span>${formatTime(entry.time_seconds)}</span></div>`
        )
        .join('')
    : '<div style="opacity:0.6;text-align:center;">No times yet — be the first!</div>';
}

function setLeaderboardTab(tab) {
  leaderboardTab = tab;
  weekTabBtn.style.background = tab === 'week' ? '#3fb6d3' : 'transparent';
  weekTabBtn.style.color = tab === 'week' ? '#04191f' : '#eaeaea';
  monthTabBtn.style.background = tab === 'month' ? '#3fb6d3' : 'transparent';
  monthTabBtn.style.color = tab === 'month' ? '#04191f' : '#eaeaea';
  renderLeaderboardList();
}

// Accessible from more than one screen (start AND caught, so far) — remember
// which overlay was showing when the panel opened, so Close can put back the
// right one instead of always returning to the start screen.
let leaderboardReturnEl = null;
async function openLeaderboard(returnEl) {
  // Hide rather than stack — a translucent overlay on top of another
  // translucent overlay lets the one underneath bleed through (found this
  // with the start screen; same fix applies to whichever screen opens it).
  leaderboardReturnEl = returnEl;
  returnEl.style.display = 'none';
  leaderboardEl.style.display = 'flex';
  setLeaderboardTab(leaderboardTab); // repaint immediately from whatever we already have

  const cache = readLeaderboardCache();
  if (cache) {
    leaderboardScores = cache.scores;
    renderLeaderboardList();
  }
  const stale = !cache || Date.now() - cache.fetchedAt > LEADERBOARD_REFRESH_MS;
  if (!stale) return; // fetched within the last day — cache is enough, no request

  const token = ++leaderboardLoadToken;
  if (!cache) leaderboardList.innerHTML = '<div style="opacity:0.6;text-align:center;">Loading…</div>';
  try {
    const scores = await fetchLeaderboardScores();
    if (token !== leaderboardLoadToken) return; // panel closed/reopened since — this result is stale
    writeLeaderboardCache(scores);
    leaderboardScores = scores;
    renderLeaderboardList();
  } catch (err) {
    console.error('[leaderboard] fetch failed', err);
    if (token !== leaderboardLoadToken) return;
    if (!cache) leaderboardList.innerHTML = '<div style="opacity:0.6;text-align:center;">Couldn’t load the leaderboard.</div>';
    // else: keep silently showing the stale cached list — still useful
  }
}
const closeLeaderboardBtn = makeOverlayButton('Close', () => {
  leaderboardEl.style.display = 'none';
  if (leaderboardReturnEl) leaderboardReturnEl.style.display = 'flex';
});
leaderboardEl.append(leaderboardTitle, tabRow, leaderboardList, closeLeaderboardBtn);
document.body.appendChild(leaderboardEl);

// `landingEl` doesn't exist yet at this point in the file (defined just
// below, since it's what appends this button) — the click only runs later,
// once everything's been declared, so referencing it here in the closure is
// fine.
const leaderboardBtn = makeOverlayButton('Leaderboard', () => openLeaderboard(landingEl));

// ---------------------------------------------------------------------------
// Landing screen — the ONE screen shown before gameplay starts: title, pitch
// line, Play, Leaderboard. This used to be two consecutive screens (a
// landing page in front of a separate "PUPPY GAME" start screen); merged
// into one after that read as a redundant extra click rather than a real
// second step. Same translucent-overlay-over-the-live-canvas treatment as
// every other screen here, so what's showing through behind it is literally
// the game's own noir warehouse lighting, not a mocked-up background.
// ---------------------------------------------------------------------------
const landingEl = document.createElement('div');
landingEl.style.cssText = [
  'position:fixed',
  'inset:0',
  'display:flex',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:22px',
  'font:bold 6vw/1 system-ui,sans-serif',
  'letter-spacing:0.13em',
  'color:#eaeaea',
  'background:rgba(0,0,0,0.78)',
  'z-index:20',
  'text-align:center',
  'padding:0 5vw', // breathing room for the pitch line on narrow windows
].join(';');
const landingTitle = document.createElement('div');
landingTitle.textContent = 'OPERATION GOOD BOI';
const landingPitch = document.createElement('div');
landingPitch.textContent = "Sneak in. Grab the good boi. Get out. Don't get caught.";
landingPitch.style.cssText = [
  'font:600 1.7vw/1.4 system-ui,sans-serif',
  'letter-spacing:0.03em',
  'color:#e8c088', // warm lamplight amber, not the title's plain white — ties the tagline to the game's own lamp-glow palette rather than reading as generic UI copy
].join(';');
const landingPlayBtn = makeOverlayButton('Play', () => {
  gameStarted = true;
  landingEl.style.display = 'none';
  startTimer();
});
landingEl.append(landingTitle, landingPitch, landingPlayBtn, leaderboardBtn);
document.body.appendChild(landingEl);

let gameOver = false;
const caughtEl = document.createElement('div');
caughtEl.style.cssText = [
  'position:fixed',
  'inset:0',
  'display:none',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:28px',
  'font:bold 10vw/1 system-ui,sans-serif',
  'letter-spacing:0.12em',
  'color:#ff3b30',
  'background:rgba(0,0,0,0.6)',
  'z-index:10',
].join(';');
const caughtText = document.createElement('div');
caughtText.textContent = 'CAUGHT';
const retryBtn = makeOverlayButton('Retry', () => resetGame());
// Same panel, same behavior as the landing screen's button — `openLeaderboard`
// just remembers to restore caughtEl (not landingEl) on Close.
const caughtLeaderboardBtn = makeOverlayButton('Leaderboard', () => openLeaderboard(caughtEl));
caughtEl.append(caughtText, retryBtn, caughtLeaderboardBtn);
document.body.appendChild(caughtEl);

function triggerCaught() {
  gameOver = true;
  stopTimer();
  caughtEl.style.display = 'flex';
}

let gameWon = false;
const rescuedEl = document.createElement('div');
rescuedEl.style.cssText = [
  'position:fixed',
  'inset:0',
  'display:none',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:22px',
  'font:bold 10vw/1 system-ui,sans-serif',
  'letter-spacing:0.12em',
  'color:#3fe07a',
  'background:rgba(0,0,0,0.6)',
  'z-index:10',
].join(';');
const rescuedText = document.createElement('div');
rescuedText.textContent = 'RESCUED';

const rescuedTimeEl = document.createElement('div');
rescuedTimeEl.style.cssText = 'font:600 2.4vw/1 system-ui,sans-serif;letter-spacing:0.05em;color:#eaeaea;';

// Guest leaderboard submission — no login/account, just a name typed in for
// this one run. Inserts straight into the "scores" table via the publishable
// key (allowed by its public-insert RLS policy) and busts the leaderboard's
// daily cache so this run shows up immediately if the panel's opened next.
const submitRow = document.createElement('div');
submitRow.style.cssText = 'display:flex;gap:10px;align-items:center;';
const nameInput = document.createElement('input');
nameInput.type = 'text';
nameInput.placeholder = 'Your name';
nameInput.maxLength = 20;
nameInput.style.cssText = [
  'font:1.2vw system-ui,sans-serif',
  'padding:0.5em 0.7em',
  'border-radius:6px',
  'border:none',
  'width:9em',
].join(';');
async function submitScore(name, timeSeconds) {
  submitBtn.textContent = 'Submitting…';
  submitBtn.disabled = true;
  try {
    const { error } = await supabase.from('scores').insert({ name, time_seconds: timeSeconds });
    if (error) throw error;
    console.log(`[leaderboard] submitted: name="${name}" time=${timeSeconds.toFixed(2)}s (${formatTime(timeSeconds)})`);
    submitBtn.textContent = 'Submitted!';
    invalidateLeaderboardCache();
  } catch (err) {
    console.error('[leaderboard] submit failed', err);
    submitBtn.textContent = 'Submit failed — retry?';
    submitBtn.disabled = false;
  }
}
const submitBtn = makeOverlayButton('Submit', () => {
  const name = nameInput.value.trim() || 'Anonymous';
  submitScore(name, finalTime);
});
submitRow.append(nameInput, submitBtn);

const playAgainBtn = makeOverlayButton('Play Again', () => resetGame());
// Same panel, same behavior as the start/caught screens' buttons —
// `openLeaderboard` just remembers to restore rescuedEl (not those) on Close.
const rescuedLeaderboardBtn = makeOverlayButton('Leaderboard', () => openLeaderboard(rescuedEl));
rescuedEl.append(rescuedText, rescuedTimeEl, submitRow, playAgainBtn, rescuedLeaderboardBtn);
document.body.appendChild(rescuedEl);

function triggerRescued() {
  gameWon = true;
  stopTimer();
  rescuedTimeEl.textContent = `Time: ${formatTime(finalTime)}`;
  nameInput.value = '';
  submitBtn.textContent = 'Submit';
  submitBtn.disabled = false;
  rescuedEl.style.display = 'flex';
}

// Full level reset: player and every NPC back to their spawn position/state,
// puppy back to un-carried at its spawn, door back to locked, cooldowns and
// wander targets cleared, camera re-centred, CAUGHT/RESCUED hidden. Used by
// the Retry/Play Again buttons and by the __D.reset() debug helper.
function resetGame() {
  gameOver = false;
  gameWon = false;
  caughtEl.style.display = 'none';
  rescuedEl.style.display = 'none';
  // Retry/Play Again both resume gameplay immediately, so the clock restarts
  // right here rather than waiting for another Play click.
  startTimer();
  keys.clear();
  player.position.copy(PLAYER_SPAWN);
  lastMoveDir.set(0, -1);
  playerHeading = playerDesiredHeading = PLAYER_SPAWN_HEADING;
  player.rotation.y = -playerHeading;
  cameraFocus.set(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
  camera.position.set(cameraFocus.x, CAMERA_HEIGHT, cameraFocus.y);
  camera.lookAt(cameraFocus.x, 0, cameraFocus.y);
  puppyCarried = false;
  puppy.position.copy(PUPPY_SPAWN);
  setDoorLocked(true);
  for (const n of npcs) {
    n.mesh.position.copy(n.spawn);
    n.pivot.position.set(n.spawn.x, 0, n.spawn.z);
    n.heading = n.desiredHeading = Math.random() * Math.PI * 2;
    n.mesh.rotation.y = n.pivot.rotation.y = -n.heading;
    n.state = 'walk';
    n.timer = 0;
    n.stuckTime = 0;
    n.overlapCooldown = 0;
    n.wallHugCooldown = 0;
    pickWanderTarget(n);
    updateVisionCone(n);
  }
}

// ---------------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.left = (-VIEW_SIZE * aspect) / 2;
  camera.right = (VIEW_SIZE * aspect) / 2;
  camera.top = VIEW_SIZE / 2;
  camera.bottom = -VIEW_SIZE / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug handle so the scene can be inspected/driven from the console.
window.__D = {
  THREE, renderer, scene, camera, player, puppy, keys, npcs,
  PLAYER_SIZE, NPC_SIZE, PLAYER_RADIUS, NPC_RADIUS,
  ambient, fill, lamps,
  obstacles, moveWithCollision, rayObstacleDistance, segmentBlocked,
  pathExists, isWalkableCell, PLAYER_SPAWN_XZ, PUPPY_XZ,
  hasClearance, boxGap, MIN_OBSTACLE_CLEARANCE, placeObstacleSafe,
  addCrateStack, addBarrel, addShelf, addPalletRack, addForklift, addCar, addJunkPile, addBicycle,
  addPallet, addDebrisScatter, addShelfItems, FLOOR_X, FLOOR_Z,
  updatePlayer, updateNpc, updateVisionCone, detectingNpc, detectionPoints, triggerCaught,
  CONE_RAYS,
  // Character builders (hand-built 3D primitives, Roblox-style) + shared turn-speed cap
  makeCharacterMesh, makePuppyMesh, TURN_SPEED, approachAngle, PLAYER_SPAWN_HEADING,
  get playerHeading() {
    return playerHeading;
  },
  get playerDesiredHeading() {
    return playerDesiredHeading;
  },
  conesOverlap, resolveConeOverlaps, resolveWallHugging, coneMostlyBlockedByWall,
  landingEl, landingPlayBtn, caughtEl, rescuedEl, retryBtn, playAgainBtn, door, doorArrow,
  checkPuppyPickup, updatePuppyCarry, checkDoor, triggerRescued, setDoorLocked,
  PUPPY_PICKUP_DIST, DOOR_TRIGGER_DIST, DOOR_XZ, PUPPY_SPAWN,
  // Timer
  formatTime, startTimer, stopTimer, currentElapsed, timerEl,
  get finalTime() {
    return finalTime;
  },
  get timerRunning() {
    return timerRunning;
  },
  // Leaderboard (submission form + real Supabase-backed display panel)
  rescuedTimeEl, nameInput, submitBtn, submitScore,
  leaderboardBtn, caughtLeaderboardBtn, rescuedLeaderboardBtn, leaderboardEl, leaderboardList, closeLeaderboardBtn,
  weekTabBtn, monthTabBtn, setLeaderboardTab, openLeaderboard,
  supabase, fetchLeaderboardScores,
  readLeaderboardCache, writeLeaderboardCache, invalidateLeaderboardCache,
  LEADERBOARD_CACHE_KEY, LEADERBOARD_REFRESH_MS, LEADERBOARD_WINDOW_MS,
  get leaderboardScores() {
    return leaderboardScores;
  },
  get leaderboardTab() {
    return leaderboardTab;
  },
  get gameOver() {
    return gameOver;
  },
  get gameWon() {
    return gameWon;
  },
  get gameStarted() {
    return gameStarted;
  },
  get puppyCarried() {
    return puppyCarried;
  },
  get overlapReactions() {
    return overlapReactions;
  },
  get wallHugReactions() {
    return wallHugReactions;
  },
  reset: resetGame,
  // Unconditional test step — runs the update logic regardless of
  // gameStarted/gameOver/gameWon, for driving the sim directly from the console.
  // Mirrors animate()'s HUD update too, so a manually-stepped run's timer
  // display matches what the real loop would have shown.
  step: (dt) => {
    updatePlayer(dt);
    for (const n of npcs) updateNpc(n, dt);
    resolveConeOverlaps();
    resolveWallHugging();
    updateCamera(dt);
    checkPuppyPickup();
    updatePuppyCarry(dt);
    checkDoor();
    if (!gameOver && !gameWon && (detectingNpc() || touchingNpc())) triggerCaught();
    const timerActive = gameStarted && !gameOver && !gameWon;
    timerEl.style.display = timerActive ? 'block' : 'none';
    if (timerActive) timerEl.textContent = formatTime(currentElapsed());
  },
  updateCamera, cameraFocus, touchingNpc,
  renderOnce: () => renderer.render(scene, camera),
};

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1); // clamp so a tab-switch stall can't teleport anyone
  if (gameStarted && !gameOver && !gameWon) {
    updatePlayer(dt);
    for (const npc of npcs) updateNpc(npc, dt);
    resolveConeOverlaps();
    resolveWallHugging();
    updateCamera(dt);
    checkPuppyPickup();
    updatePuppyCarry(dt);
    checkDoor();
    // Two independent fail conditions: seen (cone + line-of-sight) or
    // physically bumped into a guard — either one is an instant catch.
    // (!gameWon guards against the rare same-frame case where checkDoor()
    // just won the level — a win beats a catch, not both overlays at once.)
    if (!gameWon && (detectingNpc() || touchingNpc())) triggerCaught();
  }
  // Read gameOver/gameWon fresh (after the block above, which may have just
  // flipped one of them) so the HUD hides on the exact frame a catch/win
  // happens, not one frame late.
  const timerActive = gameStarted && !gameOver && !gameWon;
  timerEl.style.display = timerActive ? 'block' : 'none';
  if (timerActive) timerEl.textContent = formatTime(currentElapsed());
  renderer.render(scene, camera);
}
animate();
