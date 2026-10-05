import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import * as THREE from 'three';

const result = await build({ stdin: { contents: "export * from './src/model/net.ts'; export * from './src/model/netVariants.ts'; export * from './src/scene/layerMath.ts'; export * from './src/model/folding.ts'; export * from './src/model/projection.ts'; export * from './src/model/serialize.ts'; export * from './src/core/History.ts'; export * from './src/model/netGenerator.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const faceOrder = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const box = new THREE.BoxGeometry();
const nativeFrames = Object.fromEntries(box.groups.map(group => {
  const ids = [0,1,2].map(i => box.index.getX(group.start + i));
  const p = ids.map(i => new THREE.Vector3().fromBufferAttribute(box.attributes.position, i));
  const uv = ids.map(i => new THREE.Vector2().fromBufferAttribute(box.attributes.uv, i));
  const a = p[1].sub(p[0]), b = p[2].sub(p[0]), x = uv[1].sub(uv[0]), y = uv[2].sub(uv[0]);
  const det = x.x*y.y-y.x*x.y;
  return [faceOrder[group.materialIndex], {
    r: a.clone().multiplyScalar(y.y).addScaledVector(b,-x.y).divideScalar(det).normalize(),
    u: b.clone().multiplyScalar(x.x).addScaledVector(a,-y.x).divideScalar(det).normalize(),
    n: new THREE.Vector3().fromBufferAttribute(box.attributes.normal, ids[0]),
  }];
}));

// Independently fold the planar cell graph, checking actual BoxGeometry UV frames, not just face centres.
function verifyLayout(layout) {
  const cells = layout.cells;
  assert.equal(new Set(cells.map(c => c.face)).size, 6);
  assert.equal(new Set(cells.map(c => `${c.col},${c.row}`)).size, 6);
  const first = cells[0], f = nativeFrames[first.face], angle = first.rot*Math.PI/180;
  const frames = new Map([[0,{ r:f.r.clone().multiplyScalar(Math.cos(angle)).addScaledVector(f.u,-Math.sin(angle)), u:f.r.clone().multiplyScalar(Math.sin(angle)).addScaledVector(f.u,Math.cos(angle)), n:f.n.clone() }]]);
  const queue=[0];
  for(let k=0;k<queue.length;k++) {
    const i=queue[k], a=cells[i], f=frames.get(i);
    for(let j=0;j<6;j++) {
      const b=cells[j], dx=b.col-a.col, dy=a.row-b.row;
      if(Math.abs(dx)+Math.abs(dy)!==1) continue;
      const next=dx ? {r:f.n.clone().multiplyScalar(-dx),u:f.u.clone(),n:f.r.clone().multiplyScalar(dx)} : {r:f.r.clone(),u:f.n.clone().multiplyScalar(-dy),n:f.u.clone().multiplyScalar(dy)};
      if(frames.has(j)) for(const axis of ['r','u','n']) assert.ok(frames.get(j)[axis].distanceTo(next[axis])<1e-8);
      else { frames.set(j,next); queue.push(j); }
    }
  }
  assert.equal(frames.size,6);
  for(let i=0;i<6;i++) {
    const c=cells[i], f=frames.get(i), wanted=nativeFrames[c.face], t=c.rot*Math.PI/180;
    assert.ok(f.n.distanceTo(wanted.n)<1e-8,`normal ${c.face}`);
    assert.ok(f.r.clone().multiplyScalar(Math.cos(t)).addScaledVector(f.u,Math.sin(t)).distanceTo(wanted.r)<1e-8,`right ${c.face}`);
    assert.ok(f.u.clone().multiplyScalar(Math.cos(t)).addScaledVector(f.r,-Math.sin(t)).distanceTo(wanted.u)<1e-8,`up ${c.face}`);
  }
}

test('all 11 shapes × 24 variants retain the same labelled, oriented cube', () => {
  assert.equal(api.NET_TEMPLATES.length,11);
  for(const template of api.NET_TEMPLATES) {
    const variants=api.netVariants({...api.defaultNetState(),templateId:template.id});
    const signatures=new Set();
    for(const state of variants) { const layout=api.netLayout(state); verifyLayout(layout); signatures.add(JSON.stringify(layout.cells)); }
    assert.equal(signatures.size,24);
  }
});

test('legacy layouts preserve original face identities and pixel orientations', () => {
  for(const template of api.NET_TEMPLATES) {
    const layout=api.netLayout(api.stateFromTemplate(template));
    assert.deepEqual(layout.cells,template.cells.map(c=>({...c,rot:api.quarter(c.rot/90)*90})));
  }
});

test('whole-net rolls are reversible, close in four steps, and reach all 24 states', () => {
  for(const state of api.netVariants(api.defaultNetState())) for(const axis of ['up','right']) {
    assert.deepEqual(api.rollNet(api.rollNet(state,axis,1),axis,-1),state);
    let next=state; for(let i=0;i<4;i++) next=api.rollNet(next,axis,1);
    assert.deepEqual(next,state);
  }
  const queue=[api.defaultNetState()], seen=new Set([JSON.stringify(queue[0])]);
  for(let i=0;i<queue.length;i++) for(const axis of ['up','right']) {
    const state=api.rollNet(queue[i],axis,1), key=JSON.stringify(state);
    if(!seen.has(key)) { seen.add(key); queue.push(state); }
  }
  assert.equal(seen.size,24);
});

test('cross-type transitions retain directed reference frame and reverse exactly', () => {
  for(const from of api.NET_TEMPLATES) for(const to of api.NET_TEMPLATES) for(const state of api.netVariants({...api.defaultNetState(),templateId:from.id})) {
    const next=api.switchNetType(state,to.id), layout=api.netLayout(next), root=layout.cells[layout.root];
    assert.equal(root.face,state.referenceFace);
    assert.equal(root.rot,state.referenceTurn*90);
    assert.deepEqual(api.switchNetType(next,from.id),state);
  }
});

test('264 folding states preserve rigid faces and shared hinges throughout, ending at native UV frames', () => {
  for (const template of api.NET_TEMPLATES) for (const state of api.netVariants({ ...api.defaultNetState(), templateId: template.id })) {
    const layout = api.netLayout(state);
    for (const sequential of [true, false]) for (const t of [0, .09, .2, .31, .5, .67, .9, 1]) {
      const matrices = api.foldTransforms(layout, state, t, sequential).map(m => new THREE.Matrix4().fromArray(m.elements));
      for (const m of matrices) assert.ok(Math.abs(m.determinant() - 1) < 1e-8);
      for (const edge of layout.edges) for (const end of [-.5, .5]) {
        const p = new THREE.Vector3(edge.dx / 2 + (edge.dx ? 0 : end), edge.dy / 2 + (edge.dy ? 0 : end), 0).applyMatrix4(matrices[edge.parent]);
        const c = new THREE.Vector3(-edge.dx / 2 + (edge.dx ? 0 : end), -edge.dy / 2 + (edge.dy ? 0 : end), 0).applyMatrix4(matrices[edge.child]);
        assert.ok(p.distanceTo(c) < 1e-8, `hinge t=${t}`);
      }
      if (t === 1) for (const [i, cell] of layout.cells.entries()) {
        const m = matrices[i].clone().multiply(new THREE.Matrix4().makeRotationZ(cell.rot * Math.PI / 180)), f = nativeFrames[cell.face];
        assert.ok(new THREE.Vector3().setFromMatrixPosition(m).distanceTo(f.n.clone().multiplyScalar(.5)) < 1e-8);
        for (const [axis, vector] of [[0, f.r], [1, f.u], [2, f.n]]) assert.ok(new THREE.Vector3().setFromMatrixColumn(m, axis).distanceTo(vector) < 1e-8);
      }
    }
  }
});

const quat = r => new THREE.Quaternion().setFromEuler(new THREE.Euler(...[r.x, r.y, r.z].map(THREE.MathUtils.degToRad)));
test('principal-axis rotations respect rotated layers, invert and close after four turns', () => {
  const rotations = [], seen = new Set();
  for (const x of [0, 90, 180, 270]) for (const y of [0, 90, 180, 270]) for (const z of [0, 90, 180, 270]) {
    const r = { x, y, z }, key = new THREE.Matrix4().makeRotationFromQuaternion(quat(r)).elements.map(Math.round).join(','); if (!seen.has(key)) { seen.add(key); rotations.push(r); }
  }
  assert.equal(rotations.length, 24);
  for (const r of rotations) for (const layer of rotations) for (const axis of [new THREE.Vector3(.2, .9, .3), new THREE.Vector3(-.8, .1, .4), new THREE.Vector3(.1, .2, -.9)]) {
    const changed = api.rotateInLayer(r, layer, axis, 90), world = quat(layer).multiply(quat(changed));
    const wanted = new THREE.Quaternion().setFromAxisAngle(api.dominantAxis(axis), Math.PI / 2).multiply(quat(layer)).multiply(quat(r));
    assert.ok(Math.abs(world.dot(wanted)) > 1 - 1e-8);
    assert.ok(Math.abs(quat(api.rotateInLayer(changed, layer, axis, -90)).dot(quat(r))) > 1 - 1e-8);
    let next = r; for (let i = 0; i < 4; i++) next = api.rotateInLayer(next, layer, axis, 90);
    assert.ok(Math.abs(quat(next).dot(quat(r))) > 1 - 1e-8);
  }
});

test('non-origin pivot remains fixed under layer rotations and world/local round trips', () => {
  const layer = { pos: { x: 4, y: -2, z: 3 }, rotation: { x: 90, y: 0, z: 90 } }, center = { x: 3, y: 2, z: -1 };
  for (const axis of ['x', 'y', 'z']) {
    const changed = api.rotateLayerAround(layer, center, axis, 90);
    assert.deepEqual(api.layerPointToWorld(center, changed), api.layerPointToWorld(center, layer));
    assert.deepEqual(api.worldToLocal(api.layerPointToWorld(center, changed), changed), center);
  }
});

test('orthographic occupancy retains occluded sources and transformed image orientation', () => {
  const layer = { id: 'l', pos: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, visible: true, opacity: 1 };
  const cubes = [0, 1].map(z => ({ id: `c${z}`, layerId: 'l', gridPos: { x: 0, y: 0, z }, rotation: { x: 0, y: 0, z: 0 } }));
  const front = api.projectCubes(cubes, [layer], 'front'), top = api.projectCubes(cubes, [layer], 'top');
  assert.equal(front.cells.length, 1); assert.equal(top.cells.length, 2); assert.equal(front.cells[0].depthCount, 2); assert.equal(front.cells[0].sources[0].cubeId, 'c1');
  const rotated = api.projectCubes(cubes, [{ ...layer, rotation: { x: 0, y: 90, z: 0 } }], 'front');
  assert.equal(rotated.cells.length, 2);
  assert.equal(api.projectCubes(cubes, [{ ...layer, opacity: 0 }], 'front').cells.length, 0);
  for (const view of ['front', 'top', 'right']) for (const cell of api.projectCubes(cubes, [layer], view).cells) {
    const [a, b, c, d] = cell.sources[0].imageMatrix; assert.equal(a * d - b * c, 1);
  }
});

test('serialization rejects bad identifiers, occupancy, rotations and future versions', () => {
  const image = 'data:image/png;base64,AAAA', c = { id: 'cube-90', gridPos: { x: 0, y: 0, z: 0 }, size: 1, rotation: { x: 0, y: 0, z: 0 }, faces: Object.fromEntries(faceOrder.map(f => [f, image])) };
  const data = { version: 1, cubes: [c] };
  assert.equal(api.validateScene(data).version, 3);
  assert.throws(() => api.validateScene({ ...data, cubes: [c, { ...c, id: 'cube-91' }] }), /重叠/);
  assert.throws(() => api.validateScene({ ...data, cubes: [c, c] }), /ID 重复/);
  assert.throws(() => api.validateScene({ ...data, cubes: [{ ...c, rotation: { x: 45, y: 0, z: 0 } }] }), /90/);
  assert.throws(() => api.validateScene({ ...data, version: 999 }), /版本/);
});

test('history memory trimming keeps shared resources alive until their final command is gone', () => {
  const history = new api.History(), key = {}, released = [];
  const command = () => ({ undo() {}, redo() {}, bytes: 40 * 1024 * 1024, resources: [{ key, release: () => released.push(true) }] });
  history.push(command()); history.push(command());
  assert.equal(released.length, 0);
  history.undo(); history.clear(); assert.equal(released.length, 1);
});

test('precomputed templates preserve generator IDs, face labels and orientations', () => {
  assert.deepEqual(api.NET_TEMPLATES, api.buildTemplates());
});
