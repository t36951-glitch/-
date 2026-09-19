import './style.css';

const canvas = document.querySelector('#game-canvas');
const ctx = canvas.getContext('2d');
const shell = document.querySelector('#game-shell');

const WORLD = { width: 2400, height: 1600 };
const player = { x: 1200, y: 805, radius: 25, speed: 245, facing: 'down', bob: 0, footOffsetY: 46 };
const camera = { x: 0, y: 0 };
const keys = new Set();
const touchVector = { x: 0, y: 0 };
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let lastTime = performance.now();

const trees = [
  [260, 210], [430, 310], [720, 175], [1040, 230], [1440, 180], [1780, 245], [2110, 185], [2280, 430],
  [230, 920], [410, 1120], [690, 1320], [1030, 1210], [1530, 1325], [1860, 1180], [2180, 1260], [2290, 900],
  [760, 540], [1780, 680], [520, 720], [2030, 740]
];
const rocks = [[350, 570], [620, 1010], [890, 380], [1120, 1260], [1480, 480], [1710, 1030], [2050, 520], [2150, 1020], [980, 930]];
const flowers = [[520, 460], [570, 470], [650, 480], [1550, 760], [1600, 780], [680, 1180], [1900, 580], [1950, 595], [300, 1280], [2010, 1370], [1320, 300]];
const fences = [[820, 620], [860, 620], [900, 620], [940, 620], [980, 620]];
const collisions = [
  ...trees.map(([x, y]) => ({ x, y, r: 39 })),
  ...rocks.map(([x, y]) => ({ x, y, r: 30 }))
];

// Static map barriers. House walls keep a doorway-sized opening on the south side.
const staticRects = [
  { x: 816, y: 586, w: 208, h: 54, name: 'fence' },
  ...houseCollisionRects(1260, 480),
  ...houseCollisionRects(430, 760)
];

// Sampled points follow the same two Bézier curves used by the visible river.
const riverCenterline = [
  [1830, -50], [1818, 135], [1819, 300], [1835, 465], [1862, 620], [1883, 770], [1810, 920],
  [1784, 1055], [1758, 1190], [1753, 1325], [1781, 1460], [1810, 1590], [1780, 1700]
];
const RIVER_WATER_HALF_WIDTH = 22;
// This is the horizontal path crossing over the stream; only this rectangle bypasses river collision.
const bridgePassage = { x: 1808, y: 760, w: 112, h: 80 };
const DEBUG_COLLISIONS = false;

function houseCollisionRects(x, y) {
  const doorGapLeft = x - 41;
  const doorGapRight = x + 41;
  return [
    // The roof is blocked as a single footprint above the body.
    { x: x - 100, y: y - 75, w: 200, h: 80, name: 'house roof' },
    // Side walls stay solid from the roof line to the bottom of the body.
    { x: x - 80, y, w: 14, h: 80, name: 'house left wall' },
    { x: x + 66, y, w: 14, h: 80, name: 'house right wall' },
    // Bottom wall is split around the visual 28px-wide door. The wider gap
    // accounts for the player's radius while keeping the door centered.
    { x: x - 80, y: y + 66, w: doorGapLeft - (x - 80), h: 14, name: 'house door wall left' },
    { x: doorGapRight, y: y + 66, w: (x + 80) - doorGapRight, h: 14, name: 'house door wall right' }
  ];
}

const houseLayouts = [
  { x: 1260, y: 480, name: 'right house' },
  { x: 430, y: 760, name: 'left house' }
];
const houseDoors = houseLayouts.map(({ x, y, name }) => ({ x, y: y + 55, name }));
const doorPassages = houseLayouts.map(({ x, y, name }) => ({
  x: x - 41, y: y + 28, w: 82, h: 64, name: `${name} door passage`
}));
const doorNotice = document.querySelector('#door-notice');
function updateDoorNotice() {
  const atDoor = houseDoors.some((door) => Math.hypot(player.x - door.x, player.y - door.y) < 52);
  doorNotice?.classList.toggle('is-visible', atDoor);
}

function resize() {
  const rect = shell.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) {
    event.preventDefault();
    keys.add(key);
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));

function setTouchFromEvent(event) {
  const rect = document.querySelector('#joystick').getBoundingClientRect();
  const touch = event.touches?.[0] || event;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const max = rect.width * 0.27;
  let dx = touch.clientX - cx; let dy = touch.clientY - cy;
  const length = Math.hypot(dx, dy);
  if (length > max) { dx = dx / length * max; dy = dy / length * max; }
  touchVector.x = dx / max; touchVector.y = dy / max;
  document.querySelector('.joy-stick').style.transform = `translate(${dx}px, ${dy}px)`;
}
const joystick = document.querySelector('#joystick');
joystick.addEventListener('pointerdown', (event) => { joystick.setPointerCapture(event.pointerId); setTouchFromEvent(event); });
joystick.addEventListener('pointermove', (event) => { if (event.buttons) setTouchFromEvent(event); });
joystick.addEventListener('pointerup', resetTouch);
joystick.addEventListener('pointercancel', resetTouch);
function resetTouch() { touchVector.x = 0; touchVector.y = 0; document.querySelector('.joy-stick').style.transform = ''; }

function direction() {
  let x = touchVector.x; let y = touchVector.y;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  const len = Math.hypot(x, y);
  return len ? { x: x / Math.max(1, len), y: y / Math.max(1, len) } : { x: 0, y: 0 };
}

function circleIntersectsRect(cx, cy, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return Math.hypot(cx - closestX, cy - closestY) <= radius;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function isBlockedByRiver(x, y) {
  const footY = y + player.footOffsetY;
  const onBridge = x >= bridgePassage.x && x <= bridgePassage.x + bridgePassage.w && footY >= bridgePassage.y && footY <= bridgePassage.y + bridgePassage.h;
  if (onBridge) return false;
  const riverCollisionRadius = RIVER_WATER_HALF_WIDTH + player.radius;
  return riverCenterline.slice(0, -1).some(([ax, ay], index) => {
    const [bx, by] = riverCenterline[index + 1];
    return distanceToSegment(x, footY, ax, ay, bx, by) <= riverCollisionRadius;
  });
}

function canMoveTo(x, y) {
  if (x < 45 || y < 45 || x > WORLD.width - 45 || y > WORLD.height - 45) return false;
  const footY = y + player.footOffsetY;
  const hitsNaturalObstacle = collisions.some((item) => Math.hypot(x - item.x, y - item.y) <= item.r + player.radius - 5);
  const hitsStaticObstacle = staticRects.some((rect) => {
    const testY = rect.name.startsWith('house') ? footY : y;
    return circleIntersectsRect(x, testY, player.radius, rect);
  });
  return !hitsNaturalObstacle && !hitsStaticObstacle && !isBlockedByRiver(x, y);
}

function drawCollisionDebug() {
  if (!DEBUG_COLLISIONS) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(riverCenterline[0][0], riverCenterline[0][1]);
  riverCenterline.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.strokeStyle = 'rgba(232, 76, 76, .28)';
  ctx.lineWidth = (RIVER_WATER_HALF_WIDTH + player.radius) * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = 'rgba(69, 196, 108, .34)';
  ctx.strokeStyle = 'rgba(31, 133, 69, .9)';
  ctx.lineWidth = 2;
  ctx.fillRect(bridgePassage.x, bridgePassage.y, bridgePassage.w, bridgePassage.h);
  ctx.strokeRect(bridgePassage.x, bridgePassage.y, bridgePassage.w, bridgePassage.h);
  staticRects.filter((rect) => rect.name.startsWith('house')).forEach((rect) => {
    ctx.fillStyle = 'rgba(232, 76, 76, .28)';
    ctx.strokeStyle = 'rgba(183, 35, 35, .8)';
    ctx.lineWidth = 2;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  });
  doorPassages.forEach((door) => {
    ctx.fillStyle = 'rgba(69, 196, 108, .34)';
    ctx.strokeStyle = 'rgba(31, 133, 69, .9)';
    ctx.fillRect(door.x, door.y, door.w, door.h);
    ctx.strokeRect(door.x, door.y, door.w, door.h);
  });
  const rightDoor = houseDoors.find((door) => door.name === 'right house');
  ctx.fillStyle = '#1d6f3b';
  ctx.beginPath(); ctx.arc(rightDoor.x, rightDoor.y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#253b30';
  ctx.beginPath(); ctx.arc(player.x, player.y + player.footOffsetY, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function update(delta) {
  const dir = direction();
  if (dir.x || dir.y) {
    const nextX = player.x + dir.x * player.speed * delta;
    const nextY = player.y + dir.y * player.speed * delta;
    if (canMoveTo(nextX, player.y)) player.x = nextX;
    if (canMoveTo(player.x, nextY)) player.y = nextY;
    player.bob += delta * 9;
    if (Math.abs(dir.x) > Math.abs(dir.y)) player.facing = dir.x > 0 ? 'right' : 'left';
    else player.facing = dir.y > 0 ? 'down' : 'up';
  } else player.bob *= 0.85;
  updateDoorNotice();
  const viewW = shell.clientWidth; const viewH = shell.clientHeight;
  camera.x += (player.x - viewW / 2 - camera.x) * Math.min(1, delta * 7);
  camera.y += (player.y - viewH / 2 - camera.y) * Math.min(1, delta * 7);
  camera.x = Math.max(0, Math.min(WORLD.width - viewW, camera.x));
  camera.y = Math.max(0, Math.min(WORLD.height - viewH, camera.y));
}

function roundedRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function drawWorld() {
  const w = shell.clientWidth; const h = shell.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.save(); ctx.translate(-camera.x, -camera.y);
  ctx.fillStyle = '#bde6b7'; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  // gentle grass tiles
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  for (let x = 0; x < WORLD.width; x += 80) for (let y = 0; y < WORLD.height; y += 80) {
    if ((x / 80 + y / 80) % 3 === 0) ctx.fillRect(x + 13, y + 17, 3, 3);
  }
  // winding paths and central plaza
  ctx.strokeStyle = '#ead9a3'; ctx.lineCap = 'round'; ctx.lineWidth = 112;
  ctx.beginPath(); ctx.moveTo(-100, 780); ctx.bezierCurveTo(520, 740, 760, 840, 1180, 790); ctx.bezierCurveTo(1560, 745, 1840, 820, 2500, 700); ctx.stroke();
  ctx.lineWidth = 86; ctx.beginPath(); ctx.moveTo(1200, -100); ctx.bezierCurveTo(1190, 380, 1240, 580, 1200, 790); ctx.bezierCurveTo(1140, 1060, 1300, 1240, 1350, 1700); ctx.stroke();
  ctx.fillStyle = '#f6e8b9'; ctx.beginPath(); ctx.ellipse(1200, 790, 220, 150, 0, 0, Math.PI * 2); ctx.fill();
  // bridge stream
  ctx.strokeStyle = '#83cfe0'; ctx.lineWidth = 44; ctx.beginPath(); ctx.moveTo(1830, -50); ctx.bezierCurveTo(1810, 350, 1900, 610, 1810, 920); ctx.bezierCurveTo(1730, 1160, 1840, 1430, 1780, 1700); ctx.stroke();
  ctx.strokeStyle = '#c6ebec'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(1815, -50); ctx.bezierCurveTo(1795, 350, 1885, 610, 1795, 920); ctx.bezierCurveTo(1715, 1160, 1825, 1430, 1765, 1700); ctx.stroke();
  drawHouse(1260, 480); drawHouse(430, 760); drawSign(1090, 720);
  flowers.forEach(([x, y], i) => drawFlower(x, y, i % 2 ? '#fff4a8' : '#f39c9e'));
  fences.forEach(([x, y]) => drawFence(x, y));
  trees.forEach(([x, y]) => drawTree(x, y)); rocks.forEach(([x, y]) => drawRock(x, y));
  drawPlayer();
  drawCollisionDebug();
  ctx.restore();
}
function drawTree(x, y) {
  ctx.fillStyle = 'rgba(55,100,62,.18)'; ctx.beginPath(); ctx.ellipse(x, y + 32, 49, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#936746'; roundedRect(x - 9, y + 2, 18, 45, 7); ctx.fill();
  ctx.fillStyle = '#4c9c64'; ctx.beginPath(); ctx.arc(x - 22, y - 5, 29, 0, Math.PI * 2); ctx.arc(x + 18, y - 4, 32, 0, Math.PI * 2); ctx.arc(x, y - 28, 36, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7acb7b'; ctx.beginPath(); ctx.arc(x - 11, y - 34, 13, 0, Math.PI * 2); ctx.arc(x + 20, y - 12, 10, 0, Math.PI * 2); ctx.fill();
}
function drawRock(x, y) { ctx.fillStyle = 'rgba(55,100,62,.16)'; ctx.beginPath(); ctx.ellipse(x, y + 15, 30, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#9aa9a6'; ctx.beginPath(); ctx.moveTo(x - 27, y + 12); ctx.lineTo(x - 18, y - 13); ctx.lineTo(x + 5, y - 24); ctx.lineTo(x + 28, y - 4); ctx.lineTo(x + 23, y + 15); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#c7d2cc'; ctx.beginPath(); ctx.moveTo(x - 13, y - 12); ctx.lineTo(x + 4, y - 18); ctx.lineTo(x + 13, y - 5); ctx.lineTo(x - 6, y - 2); ctx.closePath(); ctx.fill(); }
function drawFlower(x, y, color) { ctx.strokeStyle = '#4d9a5c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x, y - 2); ctx.stroke(); ctx.fillStyle = color; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 6, y - 4 + Math.sin(a) * 6, 5, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = '#f5c84c'; ctx.beginPath(); ctx.arc(x, y - 4, 3, 0, Math.PI * 2); ctx.fill(); }
function drawFence(x, y) { ctx.strokeStyle = '#b57c4a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x, y - 23); ctx.lineTo(x, y + 20); ctx.moveTo(x + 36, y - 23); ctx.lineTo(x + 36, y + 20); ctx.moveTo(x - 4, y - 8); ctx.lineTo(x + 40, y - 8); ctx.moveTo(x - 4, y + 9); ctx.lineTo(x + 40, y + 9); ctx.stroke(); }
function drawHouse(x, y) { ctx.fillStyle = 'rgba(55,100,62,.18)'; ctx.beginPath(); ctx.ellipse(x + 8, y + 75, 100, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff8d9'; roundedRect(x - 80, y, 160, 80, 14); ctx.fill(); ctx.fillStyle = '#e9876e'; ctx.beginPath(); ctx.moveTo(x - 100, y + 5); ctx.lineTo(x, y - 75); ctx.lineTo(x + 100, y + 5); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#8cc7d5'; roundedRect(x - 55, y + 22, 32, 28, 6); ctx.fill(); roundedRect(x + 23, y + 22, 32, 28, 6); ctx.fill(); ctx.fillStyle = '#9a6b55'; roundedRect(x - 14, y + 30, 28, 50, 6); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('작은 집', x, y + 108); }
function drawSign(x, y) { ctx.fillStyle = '#8f603f'; ctx.fillRect(x - 5, y, 10, 70); ctx.fillStyle = '#f6c86e'; roundedRect(x - 70, y - 40, 140, 50, 12); ctx.fill(); ctx.fillStyle = '#694d3e'; ctx.font = 'bold 19px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('반짝숲 마을', x, y - 8); }
function drawPlayer() { const bounce = Math.sin(player.bob) * (direction().x || direction().y ? 3 : 0); const x = player.x; const y = player.y + bounce; ctx.fillStyle = 'rgba(50,80,60,.2)'; ctx.beginPath(); ctx.ellipse(x, y + 30, 29, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5d83d8'; roundedRect(x - 22, y - 2, 44, 48, 15); ctx.fill(); ctx.fillStyle = '#f6c69f'; ctx.beginPath(); ctx.arc(x, y - 22, 25, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#6d4b43'; ctx.beginPath(); ctx.arc(x, y - 29, 25, Math.PI, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#283b63'; ctx.beginPath(); ctx.arc(x - 8, y - 20, 3, 0, Math.PI * 2); ctx.arc(x + 8, y - 20, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#f08a76'; ctx.beginPath(); ctx.arc(x, y - 12, 5, 0, Math.PI); ctx.stroke(); ctx.fillStyle = '#f3c85e'; ctx.beginPath(); ctx.arc(x + 19, y + 8, 8, 0, Math.PI * 2); ctx.fill(); }

function frame(now) { const delta = Math.min((now - lastTime) / 1000, 0.05); lastTime = now; update(delta); drawWorld(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
