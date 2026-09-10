import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Same in-memory TS bundling as the isometric fixtures: no generated files.
const result = await build({
  stdin: {
    contents: 'export * from "./engine.ts"; export * from "./isometric.ts"; export * from "./seating.ts"; export * from "./sprites.ts";',
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
  }, bundle: true, write: false, format: 'esm', platform: 'node',
});
globalThis.window = {};
const images = [];
globalThis.Image = class {
  complete = true;
  naturalWidth = 112;
  constructor() { images.push(this); }
  set src(value) { queueMicrotask(() => this.onload?.()); }
};
let nextTick;
globalThis.requestAnimationFrame = (fn) => { nextTick = fn; return 1; };
globalThis.cancelAnimationFrame = () => {};
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixture() {
  const calls = [];
  const ctx = new Proxy({ globalAlpha: 1, measureText: (text) => ({ width: text.length * 5 }) }, {
    get(target, key) {
      return key in target ? target[key] : (...args) => {
        for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value));
        calls.push({ name: key, args, color: target.fillStyle });
      };
    },
  });
  const canvas = { width: 800, height: 600, getContext: () => ctx, addEventListener() {} };
  const office = api.createOffice(canvas);
  api.addCharacter(office, 'one', 'Seated agent');
  const c = office.characters.get('one');
  c.idleTimer = 100000;
  api.startLoop(office);
  let time = 0;
  function tick(dt = 100) {
    time += dt;
    const original = Math.random;
    Math.random = () => 0.99;
    try { nextTick(time); } finally { Math.random = original; }
  }
  function atLeisure(type) {
    const spot = office.leisureSpots.find((s) => s.type === type);
    spot.occupant = c.id;
    c.idleGoal = type;
    c.activity = { tv: 'watching_tv', gaming: 'gaming', coffee: 'coffee_break' }[type];
    c.x = c.targetX = spot.standX;
    c.y = c.targetY = spot.standY;
    c.leisureTimer = 20000;
    c.sitProgress = 0;
    c.seatKind = null;
    return spot;
  }
  return { office, c, ctx, calls, tick, atLeisure };
}

test('desk pose eases down in 300 ms and faces the screen, even while idle', () => {
  const { office, c, tick } = fixture();
  assert.equal(c.sitProgress, 0);
  const start = api.characterAnchor(c);
  tick(75); assert.equal(c.sitProgress, 0.25);
  tick(75); assert.equal(c.sitProgress, 0.5);
  assert.equal(api.characterPose(c).anchor.y, start.y + 2);
  tick(75); tick(75);
  assert.equal(c.sitProgress, 1);
  assert.equal(c.seatKind, 'desk');
  assert.equal(c.direction, 'right');
  assert.equal(api.characterPose(c).anchor.y, start.y + 4);
  assert.deepEqual(api.characterAnchor(c), start, 'legacy anchor remains on floor');
  api.onToolStart(office, c.id, 'edit', 'edit_file', 'writing');
  tick(); assert.equal(c.sitProgress, 1); assert.equal(c.activity, 'typing');
});

test('only correct occupied couch/desk targets allow sitting; coffee stays standing', () => {
  for (const type of ['gaming', 'tv', 'coffee']) {
    const { office, c, tick, atLeisure } = fixture();
    const spot = atLeisure(type);
    const expected = type === 'coffee' ? null : type;
    assert.equal(api.seatTarget(office, c), expected);
    c.x -= 2;
    tick(); assert.equal(c.sitProgress, 0);
    c.x = spot.standX;
    c.targetX += 2;
    tick(); assert.equal(c.sitProgress, 0);
    c.targetX = spot.standX;
    spot.occupant = 'someone-else';
    tick(); assert.equal(c.sitProgress, 0);
    spot.occupant = c.id;
    tick(); tick(); tick();
    assert.equal(c.sitProgress, type === 'coffee' ? 0 : 1);
    if (type !== 'coffee') assert.equal(c.direction, 'right');
  }
  const { office, c } = fixture();
  c.x += 10;
  assert.equal(api.seatTarget(office, c), null);
  c.x = c.deskX; c.activity = 'walking';
  assert.equal(api.seatTarget(office, c), null);
});

test('new work reserves the couch while rising, walks only upright, then sits at desk', () => {
  for (const type of ['gaming', 'tv']) {
    const { office, c, tick, atLeisure } = fixture();
    const spot = atLeisure(type);
    tick(); tick(); tick();
    const start = { x: c.x, y: c.y };
    api.onToolStart(office, c.id, 'edit', 'edit_file', 'writing');
    assert.deepEqual({ x: c.x, y: c.y }, start, 'tool event must not teleport');
    for (let i = 0; i < 3; i++) {
      tick();
      assert.deepEqual({ x: c.x, y: c.y }, start);
      assert.equal(c.direction, 'right');
      assert.equal(spot.occupant, i === 2 ? null : c.id);
    }
    assert.equal(c.sitProgress, 0);
    tick(); assert.notDeepEqual({ x: c.x, y: c.y }, start);
    for (let i = 0; i < 100 && c.activity === 'walking'; i++) {
      assert.equal(c.sitProgress, 0);
      tick();
    }
    assert.equal(c.activity, 'typing');
    assert.equal(c.x, c.deskX); assert.equal(c.y, c.deskY + 16);
    tick(); tick(); tick();
    assert.equal(c.sitProgress, 1); assert.equal(c.seatKind, 'desk');
  }
});

test('leisure expiry rises before departure; walking arrival begins sitting only on seat', () => {
  const { c, tick, atLeisure } = fixture();
  const spot = atLeisure('tv');
  c.x -= 7; c.activity = 'walking';
  tick(); assert.equal(c.sitProgress, 0);
  tick(); assert.equal(c.activity, 'watching_tv'); assert.ok(c.sitProgress > 0);
  tick(); tick();
  c.leisureTimer = 1;
  tick(); assert.equal(c.activity, 'walking'); assert.equal(c.x, spot.standX);
  tick(); tick(); assert.equal(c.sitProgress, 0); assert.equal(c.x, spot.standX);
  tick(); assert.notEqual(c.x, spot.standX);
});

test('waiting/stop clear stale tools and typing but retain a valid seated pose', () => {
  const { office, c, tick, atLeisure } = fixture();
  api.onToolStart(office, c.id, 'edit', 'edit_file', 'writing');
  tick(); tick(); tick();
  api.setWaiting(office, c.id);
  assert.equal(c.activeTools.size, 0);
  tick(); assert.equal(c.activity, 'waiting'); assert.equal(c.sitProgress, 1);
  api.onToolStart(office, c.id, 'run', 'run', 'running');
  api.setIdle(office, c.id);
  assert.equal(c.activeTools.size, 0); assert.equal(c.speechBubble, undefined);
  tick(); assert.equal(c.activity, 'idle'); assert.equal(c.sitProgress, 1);
  atLeisure('gaming'); tick(); tick(); tick();
  api.setWaiting(office, c.id); tick();
  assert.equal(c.sitProgress, 1, 'waiting on a couch does not pop upright');
});

test('pose bounds, hit tests and overlays follow posture at all zooms without lifting shadow', () => {
  const { office, c, calls } = fixture();
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    c.sitProgress = progress; c.seatKind = 'desk';
    for (const zoom of [0.5, 1, 3]) {
      api.setOfficeZoom(office, zoom); office.panX = 57; office.panY = -31;
      const pose = api.characterPose(c), camera = api.officeCamera(office);
      const hit = (x, y) => api.hitTestCharacter(office, camera.x + x * camera.scale, camera.y + y * camera.scale);
      assert.equal(hit(pose.anchor.x, pose.bounds.top + 8), c);
      assert.equal(hit(pose.anchor.x, pose.bounds.top - 1), undefined);
      assert.equal(hit(pose.bounds.right + 1, pose.anchor.y - 12), undefined);
      calls.length = 0;
      api.renderIsometric(office);
      assert.ok(calls.some((call) => call.name === 'ellipse' && call.args[0] === pose.ground.x && call.args[1] === pose.ground.y));
      assert.ok(calls.some((call) => call.name === 'fillText' && call.args[0] === c.name
        && call.args[2] === pose.anchor.y + Math.max(5, 8 / camera.scale) + 5));
    }
  }
});

test('seated sprite crops unchanged head/torso, articulates legs and animates hands', async () => {
  const { ctx, calls } = fixture();
  await api.loadSprites();
  api.drawSeatedCharacterSprite(ctx, 0, 0, 10, 20, 1, 'desk', true);
  const torso = calls.find((c) => c.name === 'drawImage');
  assert.deepEqual(torso.args.slice(1), [0, 64, 16, 22, 0, 0, 16, 22]);
  assert.ok(calls.some((c) => c.name === 'fillRect' && c.args[2] === 9 && c.args[3] === 3), 'horizontal bent thighs');
  assert.ok(calls.some((c) => c.name === 'fillRect' && c.args[2] === 3 && c.args[3] === 5), 'vertical shins');
  const frame0 = calls.filter((c) => c.name === 'fillRect').map((c) => c.args);
  calls.length = 0;
  api.drawSeatedCharacterSprite(ctx, 0, 1, 10, 20, 1, 'desk', true);
  assert.notDeepEqual(calls.filter((c) => c.name === 'fillRect').map((c) => c.args), frame0);
  calls.length = 0;
  api.drawSeatedCharacterSprite(ctx, 0, 0, 10, 20, 1, 'gaming', true);
  assert.ok(calls.some((c) => c.name === 'fillRect' && c.color === '#263447' && c.args[2] === 7), 'controller');
  const stableHands = (frame) => {
    calls.length = 0;
    api.drawSeatedCharacterSprite(ctx, 0, frame, 10, 20, 1, 'tv', false);
    return calls.filter((c) => c.name === 'fillRect').map((c) => c.args);
  };
  assert.deepEqual(stableHands(0), stableHands(1));
});

test('seat base precedes torso and low backrest follows it; missing sprites remain seated', () => {
  for (const type of ['desk', 'gaming', 'tv']) {
    const { office, c, calls, atLeisure } = fixture();
    if (type !== 'desk') atLeisure(type);
    c.sitProgress = 1; c.seatKind = type;
    api.renderIsometric(office);
    const torsoIndex = calls.findIndex((call) => call.name === 'drawImage' && call.args[4] === 22);
    const baseColor = type === 'desk' ? '#475d75' : type === 'gaming' ? '#786899' : '#487b8b';
    const backColor = type === 'desk' ? '#425c76' : baseColor;
    assert.ok(calls.slice(0, torsoIndex).some((call) => call.name === 'fill' && call.color === baseColor));
    assert.ok(calls.slice(torsoIndex + 1).some((call) => call.name === 'fill' && call.color === backColor));
    const previous = images.map((image) => image.naturalWidth);
    images.forEach((image) => { image.naturalWidth = 0; });
    try {
      calls.length = 0;
      api.renderIsometric(office);
      assert.equal(calls.filter((call) => call.name === 'drawImage').length, 0);
      assert.ok(calls.some((call) => call.name === 'fillRect' && call.args[2] === 9 && call.args[3] === 3));
      assert.equal(calls.filter((call) => call.name === 'save').length, calls.filter((call) => call.name === 'restore').length);
    } finally { images.forEach((image, i) => { image.naturalWidth = previous[i]; }); }
  }
});