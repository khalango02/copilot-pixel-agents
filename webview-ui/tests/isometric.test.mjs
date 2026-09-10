import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle in memory: test the actual TypeScript without generated test artifacts
// or browser globals leaking into production code.
const result = await build({
  stdin: {
    contents: 'export * from "./engine.ts"; export * from "./isometric.ts";',
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
globalThis.window = {};
globalThis.Image = class {
  complete = false;
  naturalWidth = 0;
  set src(value) { queueMicrotask(() => this.onerror?.()); }
};
const engine = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixture(count = 1) {
  const handlers = new Map();
  const captures = new Set();
  const calls = [];
  const ctx = new Proxy({
    measureText: (text) => ({ width: text.length * 5 }),
  }, {
    get(target, key) {
      return key in target ? target[key] : (...args) => {
        for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${String(key)}: finite coordinates`);
        calls.push([key, ...args]);
      };
    },
  });
  const canvas = {
    width: 800, height: 600,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }),
    classList: { add() {}, remove() {} },
    addEventListener(name, fn) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
    },
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
  };
  const office = engine.createOffice(canvas);
  for (let i = 0; i < count; i++) engine.addCharacter(office, `agent-${i}`, `Agent ${i}`);
  const emit = (name, event = {}) => handlers.get(name)?.forEach((fn) => fn({ pointerId: 1, button: 0, isPrimary: true, ...event }));
  return { office, canvas, calls, emit };
}

test('projection keeps height upright and produces a 2:1 diamond', () => {
  assert.deepEqual(engine.project(16, 0), { x: 16, y: 8 });
  assert.deepEqual(engine.project(0, 16), { x: -16, y: 8 });
  assert.deepEqual(engine.project(16, 16, 12), { x: 0, y: 4 });
});

test('camera fits all floor corners and wall tops in portrait and landscape views', () => {
  const { office } = fixture(8);
  for (const [w, h] of [[280, 600], [360, 700], [1200, 600], [700, 260]]) {
    engine.resizeOffice(office, w, h);
    const camera = engine.officeCamera(office);
    for (const [x, y, z] of [[0, 0, 52], [office.cols * 16, 0, 52], [0, office.rows * 16, 52], [office.cols * 16, office.rows * 16, -10]]) {
      const p = engine.project(x, y, z);
      assert.ok(p.x * camera.scale + camera.x >= 0 && p.x * camera.scale + camera.x <= w);
      assert.ok(p.y * camera.scale + camera.y >= 0 && p.y * camera.scale + camera.y <= h);
    }
  }
});

test('hit testing shares the camera transform at every zoom and after panning', () => {
  const { office } = fixture(2);
  const c = office.characters.get('agent-0');
  for (const zoom of [0.5, 1, 1.25, 3]) {
    engine.setOfficeZoom(office, zoom);
    office.panX = 65;
    office.panY = -28;
    const p = engine.characterAnchor(c), camera = engine.officeCamera(office);
    assert.equal(engine.hitTestCharacter(office, camera.x + p.x * camera.scale, camera.y + (p.y - 20) * camera.scale), c);
  }
  assert.equal(engine.hitTestCharacter(office, -1000, -1000), undefined);
});

test('overlapping characters select the frontmost sprite', () => {
  const { office } = fixture(2);
  const back = office.characters.get('agent-0'), front = office.characters.get('agent-1');
  front.x = back.x + 3; front.y = back.y + 3;
  const camera = engine.officeCamera(office), p = engine.characterAnchor(front);
  assert.equal(engine.hitTestCharacter(office, camera.x + p.x * camera.scale, camera.y + (p.y - 18) * camera.scale), front);
});

test('resize preserves work, leisure occupancy and logical positions', () => {
  const { office } = fixture(2);
  engine.onToolStart(office, 'agent-0', 'tool', 'edit_file', 'writing');
  const c = office.characters.get('agent-1');
  const spot = office.leisureSpots.find((s) => s.type === 'gaming');
  spot.occupant = c.id; c.idleGoal = 'gaming'; c.activity = 'gaming';
  c.x = spot.standX; c.y = spot.standY;
  const before = JSON.stringify([...office.characters.values()]);
  engine.resizeOffice(office, 280, 700);
  assert.equal(JSON.stringify([...office.characters.values()]), before);
  assert.equal(office.leisureSpots.find((s) => s.type === 'gaming').occupant, c.id);
  assert.equal(office.characters.get('agent-0').activeTools.size, 1);
});

test('growing and shrinking the room preserves leisure assignments and keeps desks inside', () => {
  const { office } = fixture(2);
  const c = office.characters.get('agent-0');
  c.idleGoal = 'tv'; c.activity = 'watching_tv';
  office.leisureSpots.find((s) => s.type === 'tv').occupant = c.id;
  for (let i = 2; i < 12; i++) engine.addCharacter(office, `agent-${i}`, `Agent ${i}`);
  const tv = office.leisureSpots.find((s) => s.type === 'tv');
  assert.equal(tv.occupant, c.id);
  assert.equal(c.y, tv.standY);
  for (const character of office.characters.values()) {
    assert.ok(character.deskX >= 16 && character.deskX + 32 < office.cols * 16);
    assert.ok(character.deskY + 48 < (office.rows - 4) * 16);
  }
  for (let i = 11; i > 1; i--) engine.removeCharacter(office, `agent-${i}`);
  assert.equal(office.rows, 16);
  assert.equal(c.y, office.leisureSpots.find((s) => s.type === 'tv').standY);
});

test('zoom clamps and reset clears pan', () => {
  const { office } = fixture();
  engine.setOfficeZoom(office, 100); assert.equal(office.zoom, 3);
  engine.setOfficeZoom(office, -2); assert.equal(office.zoom, 0.5);
  engine.setOfficeZoom(office, NaN); assert.equal(office.zoom, 0.5);
  office.panX = 30; office.panY = -40;
  engine.resetOfficeView(office);
  assert.equal(office.zoom, 1); assert.equal(office.panX, 0); assert.equal(office.panY, 0);
});

test('drag pans without opening the inspector, next genuine click still selects', () => {
  const { office, emit } = fixture();
  const selections = [];
  office.onCharacterClick = (id) => selections.push(id);
  emit('pointerdown', { clientX: 20, clientY: 20 });
  emit('pointermove', { clientX: 22, clientY: 22 });
  assert.equal(office.panX, 0);
  emit('pointermove', { clientX: 50, clientY: 45 });
  emit('pointerup', { clientX: 50, clientY: 45 });
  emit('click', { clientX: 50, clientY: 45 });
  assert.deepEqual(selections, []);
  assert.equal(office.panX, 30); assert.equal(office.panY, 25);
  const p = engine.characterAnchor(office.characters.get('agent-0')), camera = engine.officeCamera(office);
  const event = { clientX: camera.x + p.x * camera.scale, clientY: camera.y + (p.y - 20) * camera.scale };
  emit('pointerdown', event); emit('pointerup', event); emit('click', event);
  assert.deepEqual(selections, ['agent-0']);
});

test('renderer draws empty, active and leisure scenes with missing-sprite fallbacks', () => {
  for (const count of [0, 1, 6, 12]) {
    const { office, calls } = fixture(count);
    for (const c of office.characters.values()) {
      c.selected = true; c.inputTokens = 10000; c.speechBubble = { text: 'edit_file', expiresAt: Date.now() + 1000 };
    }
    if (count) engine.onToolStart(office, 'agent-0', 't', 'run', 'running');
    office.leisureSpots.forEach((spot) => { spot.occupant = 'agent-0'; });
    engine.renderIsometric(office);
    assert.ok(calls.filter(([name]) => name === 'fill').length > 100);
    assert.equal(calls.filter(([name]) => name === 'save').length, calls.filter(([name]) => name === 'restore').length);
  }
});