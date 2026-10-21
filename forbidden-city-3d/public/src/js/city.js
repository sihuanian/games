/**
 * 中轴线总平面装配
 * ---------------------------------------------------------------
 * 坐标约定：X 东正、Z 南正、Y 向上，单位米。
 * 宫城范围：东西约 753 m、南北约 960 m。
 *
 * 尺度说明：平面与高度按接近真实的米制尺度布置（宫城 753 m × 960 m、
 * 城墙高约 9.9 m、三台通高约 8.13 m 等），与 data.js 中的公开资料数值
 * 属同一套尺度；但建筑体量为程序化简化，不构成测绘数据。
 */

import * as THREE from 'three';
import { mat, RenderModes } from './materials.js';
import { mesh, merge, boxAt, treeGeometry } from './geometry.js';
import {
  createHall,
  createRoof,
  createWalledGate,
  createCityWall,
  createCornerTower,
  createCorridor,
  createCourtyard,
  createPavilion,
  createBridge,
  tagRoofKey,
} from './buildings.js';

/* ------------------------------------------------------------ 平面的关键几何 */

export const PLAN = {
  axisZ: { south: 450, north: -510 },
  wall: { x: 376.5, halfT: 4.3, height: 9.9 },
  river: { width: 52 },

  // 三台（三层汉白玉台基）平面范围
  santai: {
    south: 200,
    north: -60,
    southRect: { x: 66, z0: 105, z1: 200 },
    neck: { x: 46, z0: 55, z1: 105 },
    northRect: { x: 62, z0: -60, z1: 55 },
    tiers: [8.5, 6.0, 3.6],   // 各层相对基准轮廓的外扩量
    tierH: 2.71,              // 每层高度，三层合计约 8.13 m
  },

  z: {
    wumen: 450,
    bridge: 378,
    taihemen: 348,
    taihedian: 150,
    zhonghedian: 80,
    baohedian: 20,
    qianqingmen: -95,
    qianqinggong: -152,
    jiaotaidian: -198,
    kunninggong: -244,
    kunningmen: -288,
    shenwumen: -510,
  },

  ge: { x: 96, z: 152, w: 26, d: 20, h: 12 },   // 体仁阁 / 弘义阁
};

/** 视角预设：以目标点为中心的极坐标取景 */
const VIEWS = {
  overview: { az: 38, el: 40, dist: 1180, ty: 6 },
  wumen: { az: 30, el: 24, dist: 158, ty: 20 },
  jinshuiqiao: { az: 0, el: 9, dist: 42, ty: 2.2 },
  taihemen: { az: 26, el: 22, dist: 108, ty: 15 },
  taihedian: { az: 32, el: 26, dist: 148, ty: 22 },
  zhonghedian: { az: 34, el: 24, dist: 68, ty: 16 },
  baohedian: { az: 30, el: 24, dist: 104, ty: 17 },
  qianqingmen: { az: 27, el: 20, dist: 66, ty: 11 },
  qianqinggong: { az: 29, el: 23, dist: 96, ty: 16 },
  jiaotaidian: { az: 33, el: 22, dist: 58, ty: 13 },
  kunninggong: { az: 29, el: 23, dist: 92, ty: 16 },
  yuhuayuan: { az: 40, el: 26, dist: 152, ty: 8 },
  shenwumen: { az: 22, el: 22, dist: 126, ty: 18 },
  jiaolou: { az: 46, el: 22, dist: 62, ty: 14 },
};

/* ------------------------------------------------------------ 小工具 */

function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 沿闭合折线布置栏板望柱（可跳过若干区间，避免与踏跺冲突） */
function balustradePolyline(pts, y, spacing = 1.5, skips = []) {
  const geos = [];
  const postW = 0.26;
  const postH = 1.0;
  const panelH = 0.5;

  const skipped = (x, z) => skips.some((s) => {
    if (s.edge === 'south') return Math.abs(x - s.at) < s.span / 2 && Math.abs(z - s.z) < 8;
    if (s.edge === 'north') return Math.abs(x - s.at) < s.span / 2 && Math.abs(z - s.z) < 8;
    return Math.abs(z - s.at) < s.span / 2 && Math.abs(x - s.x) < 8;
  });

  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.round(len / spacing));
    for (let k = 0; k <= count; k++) {
      const x = a[0] + (b[0] - a[0]) * (k / count);
      const z = a[1] + (b[1] - a[1]) * (k / count);
      if (skipped(x, z)) continue;
      geos.push(boxAt(postW, postH, postW, x, y + postH / 2, z));
      geos.push(boxAt(postW * 1.5, 0.13, postW * 1.5, x, y + postH + 0.06, z));
      if (k < count) {
        const x2 = a[0] + (b[0] - a[0]) * ((k + 1) / count);
        const z2 = a[1] + (b[1] - a[1]) * ((k + 1) / count);
        if (skipped(x2, z2)) continue;
        const mx = (x + x2) / 2;
        const mz = (z + z2) / 2;
        const segLen = Math.hypot(x2 - x, z2 - z) - postW;
        const rot = Math.atan2(x2 - x, z2 - z);
        const gm = new THREE.BoxGeometry(postW * 0.7, panelH, Math.max(0.2, segLen));
        gm.applyMatrix4(new THREE.Matrix4().compose(
          new THREE.Vector3(mx, y + panelH / 2 + 0.12, mz),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
          new THREE.Vector3(1, 1, 1)
        ));
        geos.push(gm);
      }
    }
  }
  return merge(geos);
}

/** 由平面轮廓（[x, z] 数组）生成一块水平板 */
function shapePlate(outline, y, material, role = 'terrace') {
  const shape = new THREE.Shape();
  outline.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const m = mesh(g, material, role, false);
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

/** 由平面轮廓生成一段有高度的棱柱（用于三台各层） */
function shapeSlab(outline, height, material, role = 'terrace') {
  const shape = new THREE.Shape();
  outline.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return mesh(g, material, role);
}

/** 向外扩一段距离的矩形轮廓 */
function outsetRect(x, z0, z1, d) {
  return [
    [-x - d, z0 - d],
    [x + d, z0 - d],
    [x + d, z1 + d],
    [-x - d, z1 + d],
  ];
}

/* ================================================================ 主装配 */

export function createCity(onStep) {
  const step = typeof onStep === 'function' ? onStep : () => {};
  const root = new THREE.Group();
  root.name = '紫禁城中轴线沙盘';

  const layers = {
    axis: new THREE.Group(),
    outbuild: new THREE.Group(),
    wall: new THREE.Group(),
    water: new THREE.Group(),
    trees: new THREE.Group(),
  };
  Object.values(layers).forEach((g) => root.add(g));

  /** 记录每站：拾取对象、标注锚点、视角预设 */
  const stops = new Map();
  const pickables = [];

  const register = (id, group, { cx = 0, cz = 0, top = 10, w = 40 }) => {
    group.userData.stopId = id;
    group.traverse((o) => {
      if (o.isMesh) {
        o.userData.stopId = id;
        pickables.push(o);
      }
    });
    const v = VIEWS[id] || { az: 34, el: 24, dist: Math.max(80, w * 2.2), ty: top * 0.6 };
    const az = (v.az * Math.PI) / 180;
    const el = (v.el * Math.PI) / 180;
    const d = v.dist;
    const target = new THREE.Vector3(cx, v.ty, cz);
    const position = new THREE.Vector3(
      cx + Math.sin(az) * Math.cos(el) * d,
      v.ty + Math.sin(el) * d,
      cz + Math.cos(az) * Math.cos(el) * d
    );
    stops.set(id, {
      id,
      anchor: new THREE.Vector3(cx, top + 5, cz),
      target,
      position,
      center: new THREE.Vector3(cx, 0, cz),
      size: w,
    });
  };

  /* ---------------------------------------------------------- 地面与铺装 */

  step('铺设宫城地面与城外场地…');
  const groundY = 0;

  const outerGround = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200, 1, 1), mat.ground);
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = groundY - 0.6;
  outerGround.receiveShadow = true;
  RenderModes.tag(outerGround, { role: 'other', shadow: false });
  outerGround.receiveShadow = true;
  root.add(outerGround);

  const innerPave = shapePlate([[-372, -505], [372, -505], [372, 445], [-372, 445]], groundY, mat.paving, 'other');
  innerPave.userData.noPick = true;
  root.add(innerPave);

  /* ---------------------------------------------------------- 城墙 */

  step('砌筑宫墙与四隅角楼…');
  const wall = PLAN.wall;
  const wallSegs = [
    { length: 753, x: 0, z: PLAN.axisZ.south, rotY: 0 },
    { length: 753, x: 0, z: PLAN.axisZ.north, rotY: 0 },
    { length: 960, x: wall.x, z: (PLAN.axisZ.south + PLAN.axisZ.north) / 2, rotY: Math.PI / 2 },
    { length: 960, x: -wall.x, z: (PLAN.axisZ.south + PLAN.axisZ.north) / 2, rotY: Math.PI / 2 },
  ];
  for (const seg of wallSegs) {
    const w = createCityWall({ length: seg.length, height: wall.height });
    w.rotation.y = seg.rotY;
    w.position.set(seg.x, 0, seg.z);
    layers.wall.add(w);
  }

  // 四隅角楼
  const cornerTowers = [
    { x: wall.x, z: PLAN.axisZ.south },
    { x: -wall.x, z: PLAN.axisZ.south },
    { x: wall.x, z: PLAN.axisZ.north },
    { x: -wall.x, z: PLAN.axisZ.north },
  ];
  cornerTowers.forEach((c, i) => {
    // 官网：角楼自地面至宝顶 27.50 m，方亭每面 8.73 m。
    // 城墙顶面在 9.5 m，故塔身按 0.93 缩放，使总高与平面尺寸同时对齐。
    const t = createCornerTower({ scale: 0.93 });
    t.position.set(c.x, wall.height - 0.4, c.z);
    layers.wall.add(t);
    // 东南角楼作为「角楼」特写站，可拾取、可定位
    if (i === 0) register('jiaolou', t, { cx: c.x, cz: c.z, top: wall.height + 18, w: 30 });
  });

  /* ---------------------------------------------------------- 护城河 */

  step('开凿护城河…');
  {
    const innerX = wall.x + wall.halfT;
    const innerZs = PLAN.axisZ.south + wall.halfT;
    const innerZn = PLAN.axisZ.north - wall.halfT;
    const rw = PLAN.river.width;
    const shape = new THREE.Shape();
    const outer = [[-innerX - rw, -innerZs - rw], [innerX + rw, -innerZs - rw], [innerX + rw, -innerZn + rw], [-innerX - rw, -innerZn + rw]];
    outer.forEach(([x, z], i) => {
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    const hole = new THREE.Path();
    const inner = [[-innerX, -innerZs], [innerX, -innerZs], [innerX, -innerZn], [-innerX, -innerZn]];
    inner.forEach(([x, z], i) => {
      if (i === 0) hole.moveTo(x, -z);
      else hole.lineTo(x, -z);
    });
    hole.closePath();
    shape.holes.push(hole);

    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const water = mesh(g, mat.water, 'other', false);
    water.position.y = 0.28;
    water.receiveShadow = true;
    water.userData.noPick = true;
    layers.water.add(water);

    // 河岸石砌
    const bank = [];
    const bankRing = (xo, zo0, zo1) => {
      bank.push(boxAt(4, 2.2, Math.abs(zo1 - zo0) + 8, xo, 0.1, (zo0 + zo1) / 2));
      bank.push(boxAt(4, 2.2, Math.abs(zo1 - zo0) + 8, -xo, 0.1, (zo0 + zo1) / 2));
      bank.push(boxAt(xo * 2 + 8, 2.2, 4, 0, 0.1, zo0));
      bank.push(boxAt(xo * 2 + 8, 2.2, 4, 0, 0.1, zo1));
    };
    bankRing(innerX + rw, innerZs + rw, innerZn - rw);
    const bankMesh = mesh(merge(bank), mat.brick, 'other');
    bankMesh.userData.noPick = true;
    layers.water.add(bankMesh);
  }

  /* ---------------------------------------------------------- 三台 */

  step('起筑三层汉白玉台基…');
  const st = PLAN.santai;
  const tierDefs = [
    { d: st.tiers[0], h: st.tierH },
    { d: st.tiers[1], h: st.tierH },
    { d: st.tiers[2], h: st.tierH },
  ];
  const santaiOutline = [
    [-st.southRect.x, st.southRect.z0],
    [st.southRect.x, st.southRect.z0],
    [st.southRect.x, st.southRect.z1],
    [-st.southRect.x, st.southRect.z1],
  ];
  // 工字形轮廓（顺时针，自西南角起）
  const gongOutline = (d) => [
    [-st.southRect.x - d, st.southRect.z0 - (d > 0 ? 0 : 0)],
    [st.southRect.x + d, st.southRect.z0],
    [st.southRect.x + d, st.southRect.z1 + (d > 0 ? d : 0)],
    [-st.southRect.x - d, st.southRect.z1 + (d > 0 ? d : 0)],
  ];
  void santaiOutline;
  void gongOutline;

  const santai = new THREE.Group();
  let tierY = 0;
  const tierOutlines = [];
  for (const t of tierDefs) {
    const d = t.d;
    const outline = [
      [-st.northRect.x - d, st.northRect.z0 - d],
      [st.northRect.x + d, st.northRect.z0 - d],
      [st.neck.x + d, st.neck.z0],
      [st.neck.x + d, st.neck.z1],
      [st.southRect.x + d, st.southRect.z0],
      [st.southRect.x + d, st.southRect.z1 + d],
      [-st.southRect.x - d, st.southRect.z1 + d],
      [-st.southRect.x - d, st.southRect.z0],
      [-st.neck.x - d, st.neck.z1],
      [-st.neck.x - d, st.neck.z0],
    ];
    // 该层轮廓与上一层的差集用「先放该层再放上一层」的方式自然形成台阶
    const slab = shapeSlab(outline, tierY + t.h, mat.marble);
    santai.add(slab);
    tierOutlines.push({ outline, top: tierY + t.h, d });
    tierY += t.h;
  }
  // 三台顶面铺装
  const topOutline = tierOutlines[tierOutlines.length - 1].outline;
  santai.add(shapePlate(topOutline, tierY + 0.02, mat.marble, 'terrace'));
  const SANTAl_TOP = tierY;

  // 各层栏板
  for (const t of tierOutlines) {
    const bal = balustradePolyline(t.outline, t.top, 1.55, [
      { edge: 'south', at: 0, span: 26, z: st.southRect.z1 + t.d },
      { edge: 'north', at: 0, span: 20, z: st.northRect.z0 - t.d },
    ]);
    if (bal) santai.add(mesh(bal, mat.marble, 'terrace'));
  }
  root.add(santai);

  // 三台是三大殿共用的台基，本身没有独立的建筑条目；
  // 把它并入太和殿的可拾取范围，否则在沙盘上点到这片巨大的台基会毫无反馈。
  santai.traverse((o) => {
    if (o.isMesh) {
      o.userData.stopId = 'taihedian';
      pickables.push(o);
    }
  });

  const santaiTop = tierY;   // 三台顶面标高

  /* ---------------------------------------------------------- 三大殿 */

  step('营造太和殿、中和殿、保和殿…');

  const taihedian = createHall({
    w: 64, d: 37,
    roofKind: 'hip',
    doubleEave: true,
    bodyH: 20.2,
    lowerEaveY: 11.6,
    lowerRoofH: 4.2,
    upperRoofH: 7.2,
    eaveOverhang: 4.6,
    upperOverhang: 3.4,
    upperInset: 7.6,
    veranda: 3.2,
    bays: 11,
    doorBays: 5,
    podium: null,
    roofKey: 'hd2',
    plaque: '太和殿',
  });
  taihedian.position.set(0, santaiTop, PLAN.z.taihedian);
  layers.axis.add(taihedian);
  register('taihedian', taihedian, { cz: PLAN.z.taihedian, top: santaiTop + 28, w: 64 });

  const zhonghedian = createHall({
    w: 24, d: 24,
    roofKind: 'pyramid',
    doubleEave: false,
    bodyH: 9.2,
    roofH: 8.0,
    eaveOverhang: 3.4,
    veranda: 2.2,
    // 官网：中和殿平面呈正方形，面阔、进深各 3 间
    bays: 3,
    doorBays: 0,
    podium: null,
    roofKey: 'zj1',
    finialSize: 2.0,
    plaque: '中和殿',
  });
  zhonghedian.position.set(0, santaiTop, PLAN.z.zhonghedian);
  layers.axis.add(zhonghedian);
  register('zhonghedian', zhonghedian, { cz: PLAN.z.zhonghedian, top: santaiTop + 18, w: 24 });

  const baohedian = createHall({
    w: 50, d: 25,
    roofKind: 'gable-hip',
    gableY: 0.56,
    doubleEave: true,
    bodyH: 17.0,
    lowerEaveY: 10.0,
    lowerRoofH: 3.6,
    upperRoofH: 6.2,
    eaveOverhang: 4.0,
    upperOverhang: 3.0,
    upperInset: 6.4,
    veranda: 3.0,
    bays: 9,
    doorBays: 3,
    podium: null,
    roofKey: 'hx2',
    plaque: '保和殿',
  });
  baohedian.position.set(0, santaiTop, PLAN.z.baohedian);
  layers.axis.add(baohedian);
  register('baohedian', baohedian, { cz: PLAN.z.baohedian, top: santaiTop + 24, w: 50 });

  /* ---------------------------------------------------------- 午门 */

  step('营建宫城正门午门…');
  const wumen = createWalledGate({
    // 官网：午门墩台高 12.00 m；墩台上正楼面阔 9 间 60.05 m、进深 5 间 25.00 m。
    // 城台宽度取「正楼 60 m + 两侧钟鼓亭各三间」，使正楼按真实面阔落位。
    w: 88, d: 30, h: 12.0,
    openings: 3,
    openingW: 6.4,
    tower: {
      w: 60, d: 25, roofKind: 'hip', doubleEave: true,
      bodyH: 15.0, eaveOverhang: 4.4, upperOverhang: 3.2,
      bays: 9, roofKey: 'hd2', plaque: '午门',
    },
    pavilions: [
      { x: 38, z: 9, w: 8.0 },
      { x: -38, z: 9, w: 8.0 },
      { x: 38, z: -9, w: 8.0 },
      { x: -38, z: -9, w: 8.0 },
    ],
    wings: [
      { x: 38, z: 32, t: 8.6, l: 34 },
      { x: -38, z: 32, t: 8.6, l: 34 },
    ],
    roofKey: 'hd2',
  });
  wumen.position.set(0, 0, PLAN.z.wumen);
  layers.axis.add(wumen);
  register('wumen', wumen, { cz: PLAN.z.wumen, top: 34, w: 88 });

  /* ---------------------------------------------------------- 内金水河与五桥 */

  step('架设内金水桥…');
  {
    const riverZ = PLAN.z.bridge;
    // 河道：横贯太和门广场的一条水渠
    const channel = boxAt(184, 1.0, 13, 0, -0.35, riverZ);
    layers.water.add(mesh(channel, mat.water, 'other'));
    const wallsL = [];
    wallsL.push(boxAt(184, 2.0, 1.6, 0, 0.5, riverZ + 7.3));
    wallsL.push(boxAt(184, 2.0, 1.6, 0, 0.5, riverZ - 7.3));
    const revet = mesh(merge(wallsL), mat.marble, 'terrace');
    layers.water.add(revet);

    const bridges = new THREE.Group();
    const layout = [
      { x: 0, w: 11.5 },
      { x: -12.5, w: 8.0 },
      { x: 12.5, w: 8.0 },
      { x: -23.5, w: 6.4 },
      { x: 23.5, w: 6.4 },
    ];
    for (const b of layout) {
      const br = createBridge({ width: b.w, span: 20, rise: 1.15 });
      br.position.set(b.x, 0.55, riverZ);
      bridges.add(br);
    }
    bridges.userData.stopId = 'jinshuiqiao';
    layers.water.add(bridges);
    const gp = new THREE.Group();
    gp.position.set(0, 0, riverZ);
    gp.add(new THREE.Object3D());
    register('jinshuiqiao', bridges, { cz: riverZ, top: 5.5, w: 60 });
  }

  /* ---------------------------------------------------------- 太和门 */

  step('营造太和门…');
  const taihemen = createHall({
    w: 44, d: 20,
    roofKind: 'gable-hip',
    gableY: 0.56,
    doubleEave: true,
    bodyH: 13.2,
    lowerEaveY: 7.8,
    lowerRoofH: 2.8,
    upperRoofH: 4.8,
    eaveOverhang: 3.4,
    upperOverhang: 2.6,
    upperInset: 5.6,
    veranda: 2.6,
    bays: 9,
    doorBays: 3,
    podium: { h: 2.6, expand: 4.0, balustrade: true, steps: { w: 15, d: 7 } },
    roofKey: 'hx2',
    plaque: '太和门',
  });
  taihemen.position.set(0, 0, PLAN.z.taihemen);
  layers.axis.add(taihemen);
  register('taihemen', taihemen, { cz: PLAN.z.taihemen, top: 20, w: 44 });

  // 铜狮一对
  for (const sx of [-1, 1]) {
    const lion = new THREE.Group();
    const b = mesh(boxAt(1.5, 1.6, 2.4, 0, 0.9, 0), mat.gold, 'other');
    const h = mesh(boxAt(1.5, 1.3, 1.4, 0, 2.2, 0.2), mat.gold, 'other');
    lion.add(b, h);
    lion.position.set(sx * 15, 0, PLAN.z.taihemen + 12);
    lion.userData.noPick = true;
    layers.axis.add(lion);
  }

  /* ---------------------------------------------------------- 后三宫 */

  step('营造乾清门与后三宫…');

  const qianqingmen = createHall({
    w: 30, d: 16,
    roofKind: 'gable-hip',
    gableY: 0.58,
    doubleEave: false,
    bodyH: 8.4,
    roofH: 5.0,
    eaveOverhang: 3.0,
    veranda: 2.0,
    bays: 5,
    doorBays: 3,
    podium: { h: 2.0, expand: 3.6, balustrade: true, steps: { w: 11, d: 6 } },
    roofKey: 'hx1',
    plaque: '乾清门',
  });
  qianqingmen.position.set(0, 0, PLAN.z.qianqingmen);
  layers.axis.add(qianqingmen);
  register('qianqingmen', qianqingmen, { cz: PLAN.z.qianqingmen, top: 14, w: 30 });

  const qianqinggong = createHall({
    w: 46, d: 30,
    roofKind: 'hip',
    doubleEave: true,
    bodyH: 16.4,
    lowerEaveY: 9.6,
    lowerRoofH: 3.4,
    upperRoofH: 5.8,
    eaveOverhang: 4.0,
    upperOverhang: 3.0,
    upperInset: 6.4,
    veranda: 3.0,
    bays: 9,
    doorBays: 3,
    podium: { h: 2.6, expand: 4.0, balustrade: true, steps: { w: 14, d: 7 } },
    roofKey: 'hd2',
    plaque: '乾清宫',
  });
  qianqinggong.position.set(0, 0, PLAN.z.qianqinggong);
  layers.axis.add(qianqinggong);
  register('qianqinggong', qianqinggong, { cz: PLAN.z.qianqinggong, top: 24, w: 46 });

  const jiaotaidian = createHall({
    w: 20, d: 20,
    roofKind: 'pyramid',
    doubleEave: false,
    bodyH: 7.4,
    roofH: 6.4,
    eaveOverhang: 2.8,
    veranda: 1.8,
    bays: 3,
    doorBays: 0,
    podium: { h: 1.8, expand: 3.4, balustrade: true, steps: { w: 8, d: 5 } },
    roofKey: 'zj1',
    finialSize: 1.7,
    plaque: '交泰殿',
  });
  jiaotaidian.position.set(0, 0, PLAN.z.jiaotaidian);
  layers.axis.add(jiaotaidian);
  register('jiaotaidian', jiaotaidian, { cz: PLAN.z.jiaotaidian, top: 15, w: 20 });

  const kunninggong = createHall({
    w: 44, d: 30,
    roofKind: 'hip',
    doubleEave: true,
    bodyH: 16.0,
    lowerEaveY: 9.4,
    lowerRoofH: 3.4,
    upperRoofH: 5.6,
    eaveOverhang: 4.0,
    upperOverhang: 3.0,
    upperInset: 6.2,
    veranda: 2.8,
    bays: 9,
    doorBays: 3,
    podium: { h: 2.6, expand: 4.0, balustrade: true, steps: { w: 13, d: 7 } },
    roofKey: 'hd2',
    plaque: '坤宁宫',
  });
  kunninggong.position.set(0, 0, PLAN.z.kunninggong);
  layers.axis.add(kunninggong);
  register('kunninggong', kunninggong, { cz: PLAN.z.kunninggong, top: 23, w: 44 });

  /* ---------------------------------------------------------- 御花园 */

  step('布置御花园…');
  {
    const gz = -352;
    const garden = new THREE.Group();

    const qinandian = createHall({
      w: 22, d: 16,
      roofKind: 'gable-hip',
      gableY: 0.58,
      doubleEave: false,
      bodyH: 7.0,
      roofH: 4.6,
      eaveOverhang: 2.6,
      veranda: 1.8,
      bays: 5,
      doorBays: 0,
      podium: { h: 1.8, expand: 3.2, balustrade: true, steps: { w: 9, d: 5 } },
      roofKey: 'hx1',
    });
    qinandian.position.set(0, 0, gz - 26);
    garden.add(qinandian);

    for (const sx of [-1, 1]) {
      const p = createPavilion({ size: 7.0, height: 4.6, roofH: 4.2, roofKey: 'zj1' });
      p.position.set(sx * 32, 0, gz + 6);
      garden.add(p);
      const p2 = createPavilion({ size: 5.4, height: 3.8, roofH: 3.4, roofKey: 'zj1' });
      p2.position.set(sx * 40, 0, gz - 22);
      garden.add(p2);
    }

    // 堆秀山与御景亭
    const rock = new THREE.Group();
    const rand = rng(4096);
    const rockGeos = [];
    for (let i = 0; i < 9; i++) {
      const g = new THREE.IcosahedronGeometry(3.4 + rand() * 3.2, 0);
      g.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3((rand() - 0.5) * 12, 2 + rand() * 5, (rand() - 0.5) * 10),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)),
        new THREE.Vector3(1, 0.9, 1)
      ));
      rockGeos.push(g);
    }
    rock.add(mesh(merge(rockGeos), mat.brick, 'other'));
    rock.position.set(0, 0, gz - 46);
    garden.add(rock);

    const yujing = createPavilion({ size: 4.6, height: 3.2, roofH: 2.8, roofKey: 'zj1' });
    yujing.position.set(0, 8.6, gz - 46);
    garden.add(yujing);

    // 园墙
    const gw = [];
    gw.push(boxAt(130, 2.6, 0.7, 0, 1.3, gz + 40));
    gw.push(boxAt(130, 2.6, 0.7, 0, 1.3, gz - 58));
    gw.push(boxAt(0.7, 2.6, 98, -65, 1.3, gz - 9));
    gw.push(boxAt(0.7, 2.6, 98, 65, 1.3, gz - 9));
    garden.add(mesh(merge(gw), mat.wall, 'body'));

    layers.outbuild.add(garden);
    // 站点锚点落在钦安殿（园内主体建筑）上，避免定位到空院心
    register('yuhuayuan', garden, { cz: gz - 24, top: 12, w: 130 });
  }

  /* ---------------------------------------------------------- 神武门 */

  step('营建宫城北门神武门…');
  const shenwumen = createWalledGate({
    w: 40, d: 22, h: 10.5,
    openings: 3,
    openingW: 5.4,
    tower: {
      w: 30, d: 13, roofKind: 'hip', doubleEave: true,
      bodyH: 13.4, eaveOverhang: 3.0, upperOverhang: 2.4,
      // 官网：神武门城楼面阔 5 间、进深 1 间，四周围廊
      bays: 5, roofKey: 'hd2', plaque: '神武门',
    },
    roofKey: 'hd2',
  });
  shenwumen.position.set(0, 0, PLAN.z.shenwumen);
  layers.axis.add(shenwumen);
  register('shenwumen', shenwumen, { cz: PLAN.z.shenwumen, top: 28, w: 40 });

  // 坤宁门
  {
    const knm = createHall({
      w: 18, d: 12,
      roofKind: 'gable-hip',
      gableY: 0.58,
      doubleEave: false,
      bodyH: 6.0,
      roofH: 3.8,
      eaveOverhang: 2.2,
      veranda: 1.6,
      bays: 3,
      doorBays: 3,
      podium: { h: 1.4, expand: 2.8, balustrade: false, steps: { w: 7, d: 4 } },
      roofKey: 'sub',
    });
    knm.position.set(0, 0, PLAN.z.kunningmen);
    knm.userData.noPick = true;
    layers.outbuild.add(knm);
  }

  /* ---------------------------------------------------------- 两翼院落与配殿 */

  step('布置两翼院落、廊庑与楼阁…');
  {
    // 体仁阁 / 弘义阁：太和殿广场东西两侧的重檐楼阁
    for (const sx of [-1, 1]) {
      const ge = createHall({
        w: PLAN.ge.w, d: PLAN.ge.d,
        roofKind: 'pyramid',
        doubleEave: true,
        bodyH: 13.0,
        lowerEaveY: 7.6,
        lowerRoofH: 2.6,
        upperRoofH: 4.6,
        eaveOverhang: 3.0,
        upperOverhang: 2.4,
        veranda: 2.4,
        bays: 5,
        doorBays: 3,
        podium: { h: 2.4, expand: 3.4, balustrade: true, steps: { w: 10, d: 6 } },
        roofKey: 'zj1',
        finialSize: 1.6,
      });
      ge.position.set(sx * PLAN.ge.x, 0, PLAN.ge.z);
      layers.outbuild.add(ge);
    }

    // 三处广场的廊庑
    const corridors = [
      { x: 88, z: 240, len: 190, rot: true },     // 太和门广场东西
      { x: -88, z: 240, len: 190, rot: true },
      { x: 108, z: 82, len: 150, rot: true },      // 太和殿广场东西
      { x: -108, z: 82, len: 150, rot: true },
      { x: 72, z: -140, len: 150, rot: true },     // 后三宫东西
      { x: -72, z: -140, len: 150, rot: true },
    ];
    for (const c of corridors) {
      const cor = createCorridor({
        length: c.len,
        depth: 9,
        height: 4.4,
        roofH: 2.2,
        plinth: 0.7,
      });
      cor.rotation.y = c.rot ? -Math.PI / 2 : 0;
      cor.position.set(c.x, 0, c.z);
      layers.outbuild.add(cor);
    }

    // 大型院落：文华殿、武英殿、慈宁宫、宁寿宫
    const bigYard = [
      { id: 'wenhua', x: 178, z: 296, w: 118, d: 108, roof: 'gable-hip', dbl: false, rk: 'hx2' },
      { id: 'wuying', x: -178, z: 296, w: 118, d: 108, roof: 'gable-hip', dbl: false, rk: 'hx2' },
      { id: 'cining', x: -206, z: -78, w: 150, d: 130, roof: 'gable-hip', dbl: false, rk: 'hx2' },
      { id: 'ningshou', x: 206, z: -404, w: 150, d: 128, roof: 'gable-hip', dbl: false, rk: 'hx2' },
    ];
    for (const y of bigYard) {
      const yard = createCourtyard({
        w: y.w, d: y.d,
        hallW: y.w * 0.46,
        hallD: y.d * 0.3,
        hallRoof: y.roof,
        doubleEave: y.dbl,
        roofKey: y.rk,
        gate: true,
      });
      yard.position.set(y.x, 0, y.z);
      layers.outbuild.add(yard);
    }

    // 东西六宫：每侧两列三进
    const cols = [148, 246];
    const rows = [-146, -214, -282];
    for (const sx of [-1, 1]) {
      for (const cx of cols) {
        for (const rz of rows) {
          const yard = createCourtyard({
            w: 72, d: 62,
            hallW: 32,
            hallD: 18,
            hallRoof: 'gable',
            doubleEave: false,
            roofKey: 'sub',
            gate: true,
          });
          yard.position.set(sx * cx, 0, rz);
          layers.outbuild.add(yard);
        }
      }
    }

    // 南三所与内务府等次要院落，填补东西两翼
    const extra = [
      { x: 150, z: 400, w: 96, d: 70 },
      { x: -150, z: 400, w: 96, d: 70 },
      { x: 300, z: 60, w: 84, d: 88 },
      { x: -300, z: 60, w: 84, d: 88 },
      { x: 300, z: -180, w: 84, d: 88 },
      { x: -300, z: -180, w: 84, d: 88 },
      { x: 330, z: -420, w: 76, d: 76 },
      { x: -330, z: -420, w: 76, d: 76 },
    ];
    for (const e of extra) {
      const yard = createCourtyard({
        w: e.w, d: e.d,
        hallW: e.w * 0.44,
        hallD: e.d * 0.28,
        hallRoof: 'gable',
        roofKey: 'sub',
        gate: true,
      });
      yard.position.set(e.x, 0, e.z);
      layers.outbuild.add(yard);
    }
  }

  /* ---------------------------------------------------------- 树木 */

  step('栽植庭园树木…');
  {
    const rand = rng(9091);
    const spots = [];
    // 御花园
    for (let i = 0; i < 54; i++) {
      const x = (rand() - 0.5) * 118;
      const z = -306 - rand() * 88;
      if (Math.abs(x) < 16 && z > -330) continue;
      spots.push({ x, z, s: 0.85 + rand() * 0.5 });
    }
    // 城墙内侧环路
    for (let i = 0; i < 46; i++) {
      const t = rand();
      const side = Math.floor(rand() * 4);
      const off = 26 + rand() * 8;
      if (side === 0) spots.push({ x: (t - 0.5) * 700, z: PLAN.axisZ.south - off, s: 0.9 + rand() * 0.4 });
      else if (side === 1) spots.push({ x: (t - 0.5) * 700, z: PLAN.axisZ.north + off, s: 0.9 + rand() * 0.4 });
      else if (side === 2) spots.push({ x: wall.x - off, z: (t - 0.5) * 900 - 30, s: 0.9 + rand() * 0.4 });
      else spots.push({ x: -wall.x + off, z: (t - 0.5) * 900 - 30, s: 0.9 + rand() * 0.4 });
    }
    // 院落之间的巷道
    for (let i = 0; i < 30; i++) {
      const sx = rand() > 0.5 ? 1 : -1;
      spots.push({ x: sx * (100 + rand() * 230), z: -110 - rand() * 220, s: 0.8 + rand() * 0.4 });
    }

    const variants = 3;
    const buckets = Array.from({ length: variants }, () => []);
    spots.forEach((sp, i) => buckets[i % variants].push(sp));

    buckets.forEach((bucket, vi) => {
      if (!bucket.length) return;
      const { trunk, canopy } = treeGeometry(rng(1200 + vi), 1);
      const trunkMesh = new THREE.InstancedMesh(trunk, mat.trunk, bucket.length);
      const canopyMesh = new THREE.InstancedMesh(canopy, mat.foliage, bucket.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const r2 = rng(5100 + vi);
      bucket.forEach((sp, i) => {
        q.setFromEuler(new THREE.Euler(0, r2() * Math.PI * 2, 0));
        m.compose(new THREE.Vector3(sp.x, 0, sp.z), q, new THREE.Vector3(sp.s, sp.s, sp.s));
        trunkMesh.setMatrixAt(i, m);
        canopyMesh.setMatrixAt(i, m);
      });
      trunkMesh.instanceMatrix.needsUpdate = true;
      canopyMesh.instanceMatrix.needsUpdate = true;
      trunkMesh.castShadow = true;
      canopyMesh.castShadow = true;
      canopyMesh.receiveShadow = true;
      RenderModes.tag(trunkMesh, { role: 'other' });
      RenderModes.tag(canopyMesh, { role: 'other' });
      trunkMesh.userData.noPick = true;
      canopyMesh.userData.noPick = true;
      layers.trees.add(trunkMesh, canopyMesh);
    });
  }

  /* ---------------------------------------------------------- 反查索引 */

  // 拾取时排除地面、水体等辅助对象
  const pickList = pickables.filter((o) => !o.userData.noPick);

  // 中轴线总览视角
  const overviewView = VIEWS.overview;
  const overviewAz = (overviewView.az * Math.PI) / 180;
  const overviewEl = (overviewView.el * Math.PI) / 180;
  const overview = {
    id: 'overview',
    anchor: new THREE.Vector3(0, 90, 60),
    target: new THREE.Vector3(0, overviewView.ty, -30),
    position: new THREE.Vector3(
      Math.sin(overviewAz) * Math.cos(overviewEl) * overviewView.dist,
      overviewView.ty + Math.sin(overviewEl) * overviewView.dist,
      -30 + Math.cos(overviewAz) * Math.cos(overviewEl) * overviewView.dist
    ),
    center: new THREE.Vector3(0, 0, -30),
    size: 960,
  };

  step('整理几何与光照…');

  return {
    root,
    layers,
    stops,
    overview,
    pickList,
    santaiTop,
    planZ: PLAN.z,
    tileAnchors: true,
  };
}