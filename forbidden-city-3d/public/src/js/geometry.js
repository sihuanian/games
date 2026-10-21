/**
 * 古建几何构件库
 * ---------------------------------------------------------------
 * 这里是整个沙盘的几何引擎，重点解决三件事：
 *   1. 举折——屋面自檐口向屋脊由缓转陡的凹曲线；
 *   2. 翼角起翘——檐角向外挑出并向上翘起，且相邻坡面在角部严格共点不裂开；
 *   3. 正脊 / 垂脊 / 戗脊 / 围脊 / 宝顶 / 斗拱 / 须弥座 等构件的批量生成。
 *
 * 单位统一为「米」，坐标系：X 为东西（面阔向），Z 为南北（进深向），Y 向上。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, RenderModes } from './materials.js';

const UP = new THREE.Vector3(0, 1, 0);
const _box = new THREE.BoxGeometry(1, 1, 1);

/* ------------------------------------------------------------------ 小工具 */

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 建网格并登记角色，供观察方式切换使用 */
export function mesh(geo, material, role = 'other', shadow = true) {
  const m = new THREE.Mesh(geo, material);
  RenderModes.tag(m, { role, shadow });
  return m;
}

/** 合并一组几何体，失败时退回为 Group */
export function merge(geos) {
  const list = geos.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const merged = mergeGeometries(list, false);
  if (!merged) {
    console.warn('[geometry] 几何合并失败，返回首个几何体');
    return list[0];
  }
  return merged;
}

/** 把一组网格合并为一个网格（同材质） */
export function mergeMeshes(meshes, material, role = 'other') {
  const geos = meshes.map((m) => {
    m.updateMatrix();
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrix);
    return g;
  });
  const g = merge(geos);
  if (!g) return null;
  return mesh(g, material, role);
}

/** 以「中心 + 尺寸」生成一个盒体几何 */
export function boxAt(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/* --------------------------------------------------------------- 屋面曲面 */

/**
 * 生成屋面（庑殿 / 歇山 / 攒尖，含重檐下檐所用的环状截断）。
 *
 * @param {object} o
 * @param {number} o.width    面阔方向总宽（已含出檐）
 * @param {number} o.depth    进深方向总深（已含出檐）
 * @param {number} o.height   屋脊相对檐口的高差
 * @param {'hip'|'gable-hip'|'pyramid'} [o.kind]
 * @param {number} [o.gableY] 歇山：山花起始高度占屋脊高度的比例
 * @param {number} [o.tMax]   只做到 t=tMax，用于重檐下檐形成环状屋面
 * @param {number} [o.push]   推山系数，延长正脊
 * @param {number} [o.upturn] 檐角起翘高度
 * @param {number} [o.flare]  檐角外挑距离
 * @param {number} [o.uSeg]   沿檐口方向分段
 * @param {number} [o.vSeg]   沿坡面方向分段
 * @returns {{geometry: THREE.BufferGeometry, eaves: THREE.Vector3[][], ridge: THREE.Vector3[]}}
 */
export function roofSurface(o) {
  const width = o.width;
  const depth = o.depth;
  const height = o.height;
  const kind = o.kind || 'hip';
  const gableY = o.gableY !== undefined ? o.gableY : 0.6;
  const tMax = o.tMax !== undefined ? o.tMax : 1;
  const push = o.push !== undefined ? o.push : 1.0;
  const upturn = o.upturn !== undefined ? o.upturn : 0.85;
  const flare = o.flare !== undefined ? o.flare : 1.35;
  const uSeg = o.uSeg || 26;
  const vSeg = o.vSeg || 16;

  const hm = width / 2;
  const dv = depth / 2;

  // 正脊半长：庑殿取面阔与进深之差的一半（45° 平面转角），再按推山系数加长
  let Lh;
  if (kind === 'pyramid') Lh = 0;
  else if (kind === 'gable') Lh = hm;              // 悬山 / 硬山：正脊通面阔
  else Lh = Math.max(0.0001, ((width - depth) / 2) * push);

  const P = 1.55;                       // 举折指数：>1 表示檐口平缓、屋脊陡峭
  const f = (t) => Math.pow(clamp(t, 0, 1), P);
  const gableAt = kind === 'gable-hip' ? Math.pow(gableY, 1 / P) : 1;

  const ringTo = o.ringTo || null;      // 重檐下檐：屋面收至上檐墙身所在的矩形

  let shrinkX;
  let shrinkZ;
  if (ringTo) {
    shrinkX = (t) => lerp(1, ringTo.hw / hm, clamp(t, 0, 1));
    shrinkZ = (t) => lerp(1, ringTo.hd / dv, clamp(t, 0, 1));
  } else if (kind === 'gable') {
    shrinkX = () => 1;
    shrinkZ = (t) => 1 - clamp(t, 0, 1);
  } else {
    shrinkX = (t) => {
      const tt = kind === 'gable-hip' ? Math.min(t, gableAt) / gableAt : t;
      return lerp(1, Lh / hm, clamp(tt, 0, 1));
    };
    shrinkZ = (t) => {
      const tt = kind === 'gable-hip' ? Math.min(t, gableAt) / gableAt : t;
      return 1 - clamp(tt, 0, 1);
    };
  }

  const CORNER_Q = 5;      // 起翘只影响角部
  const TAU = 0.17;        // 起翘沿坡面快速衰减
  const cornerW = (s) => Math.pow(Math.abs(s), CORNER_Q);
  const decay = (t) => Math.exp(-t / TAU);

  // 四个坡面：axis 表示「沿檐口方向」所在轴，sign 表示该面朝外的常数坐标符号
  const faces = [
    { axis: 'x', sign: 1, flip: false },  // 南坡（+Z）
    { axis: 'x', sign: -1, flip: true },  // 北坡（−Z）
    { axis: 'z', sign: 1, flip: true },   // 东坡（+X）
    { axis: 'z', sign: -1, flip: false }, // 西坡（−X）
  ];

  const positions = [];
  const uvs = [];
  const indices = [];
  const eaves = [];
  const pointFns = [];
  let base = 0;

  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi];
    const tEnd = kind === 'gable-hip' && face.axis === 'z' ? gableAt : tMax;
    const halfAcross = face.axis === 'x' ? hm : dv;
    const halfConst = face.axis === 'x' ? dv : hm;
    const shrinkAcross = face.axis === 'x' ? shrinkX : shrinkZ;
    const shrinkConst = face.axis === 'x' ? shrinkZ : shrinkX;

    const point = (t, s) => {
      const w = cornerW(s);
      const dcy = decay(t);
      const lift = upturn * w * dcy;
      const out = flare * w * dcy;

      const across = s * halfAcross * shrinkAcross(t);
      const constV = face.sign * halfConst * shrinkConst(t);

      // 外挑方向：角部沿对角线朝外，与相邻坡面严格一致，保证角点共点
      const ax = face.axis === 'x' ? s : face.sign;
      const az = face.axis === 'x' ? face.sign : s;
      const alen = Math.hypot(ax, az) || 1;

      const fx = (ax / alen) * out;
      const fz = (az / alen) * out;

      return new THREE.Vector3(
        face.axis === 'x' ? across + fx : constV + fx,
        height * f(t) + lift,
        face.axis === 'x' ? constV + fz : across + fz
      );
    };

    pointFns[fi] = point;
    // 悬山 / 硬山：两端为竖直山墙，由外部单独生成，不参与屋面网格
    if (o.skipEndFaces && face.axis === 'z') continue;

    const rowBase = [];
    for (let i = 0; i <= vSeg; i++) {
      const t = (i / vSeg) * tEnd;
      const row = [];
      for (let j = 0; j <= uSeg; j++) {
        const s = -1 + (2 * j) / uSeg;
        const p = point(t, s);
        const e = point(0, s);
        // u 沿檐口方向按米计；v 自檐口沿坡面按米计，使瓦垄疏密一致
        const v = e.distanceTo(p);
        positions.push(p.x, p.y, p.z);
        uvs.push(s * halfAcross, v);
        row.push(base + i * (uSeg + 1) + j);
      }
      rowBase.push(row);
    }

    for (let i = 0; i < vSeg; i++) {
      for (let j = 0; j < uSeg; j++) {
        const a = rowBase[i][j];
        const b = rowBase[i][j + 1];
        const c = rowBase[i + 1][j + 1];
        const d = rowBase[i + 1][j];
        if (face.flip) {
          indices.push(a, c, b, a, d, c);
        } else {
          indices.push(a, b, c, a, c, d);
        }
      }
    }

    // 记录檐口线，供檐口收头带使用
    const eaveLine = [];
    for (let j = 0; j <= uSeg; j++) {
      eaveLine.push(point(0, -1 + (2 * j) / uSeg));
    }
    eaves.push(eaveLine);

    base += (vSeg + 1) * (uSeg + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // 正脊线（用于摆放正脊与两端吻兽）
  const ridge = [
    new THREE.Vector3(-Lh, height + upturn * 0, 0),
    new THREE.Vector3(Lh, height, 0),
  ];
  ridge[0].y = height;

  return {
    geometry, eaves, ridge, gableAt, hm, dv, Lh, shrinkX, shrinkZ, f, ringTo,
    tEnd: tMax,
    pointOn: (fi, t, s) => pointFns[fi](t, s),
  };
}

/* ------------------------------------------------------- 沿折线扫出脊件 */

/**
 * 沿折线扫出一根矩形断面的脊（正脊 / 垂脊 / 戗脊 / 围脊通用）。
 * @param {THREE.Vector3[]} points
 * @param {number} w 断面宽
 * @param {number} h 断面高（自折线向上）
 */
export function ridgeAlong(points, w, h) {
  const geos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) continue;
    dir.normalize();

    const zAxis = dir.clone();
    let xAxis = new THREE.Vector3().crossVectors(UP, zAxis);
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)
    );
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mid.y += h * 0.5;
    const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(w, h, len * 1.06));
    geos.push(_box.clone().applyMatrix4(m));
  }
  return merge(geos);
}

/** 从檐口线生成收头带（瓦当与滴水），并补出檐口厚度 */
export function eaveTrim(eaveLine, drop = 0.34, out = 0.1) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const n = eaveLine.length;

  // 求出檐口线的主方向，用于判断外法线
  const center = new THREE.Vector3();
  for (const p of eaveLine) center.add(p);
  center.multiplyScalar(1 / n);

  let arc = 0;
  for (let i = 0; i < n; i++) {
    const p = eaveLine[i];
    if (i > 0) arc += p.distanceTo(eaveLine[i - 1]);

    // 外侧方向：自檐口线中心指向该点，取水平分量
    const outward = new THREE.Vector3(p.x - center.x, 0, p.z - center.z);
    if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
    outward.normalize();

    const top = p.clone();
    const bottom = p.clone().addScaledVector(outward, out).setY(p.y - drop);
    positions.push(top.x, top.y, top.z, bottom.x, bottom.y, bottom.z);
    uvs.push(arc, 0, arc, 1);
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2 + 1;
    const d = (i + 1) * 2;
    indices.push(a, b, c, a, c, d);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/* --------------------------------------------------------------- 脊饰 */

/** 正吻：侧面为卷曲龙形轮廓的薄片，沿脊厚方向挤出 */
export function kissShape(depth = 0.62) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(1.15, 0);
  s.lineTo(1.28, 0.55);
  s.lineTo(1.1, 1.05);
  s.lineTo(1.34, 1.5);
  s.lineTo(1.05, 1.86);
  s.lineTo(0.72, 1.7);
  s.lineTo(0.62, 1.98);
  s.lineTo(0.3, 1.96);
  s.lineTo(0.34, 1.6);
  s.lineTo(0.12, 1.3);
  s.lineTo(0.2, 0.72);
  s.lineTo(0.02, 0.36);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** 宝顶：鎏金顶饰，座 + 宝珠 + 尖 */
export function finialGeometry(size = 1) {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.46, 0.02),
    new THREE.Vector2(0.5, 0.1),
    new THREE.Vector2(0.38, 0.16),
    new THREE.Vector2(0.34, 0.24),
    new THREE.Vector2(0.3, 0.3),
    new THREE.Vector2(0.42, 0.4),
    new THREE.Vector2(0.46, 0.56),
    new THREE.Vector2(0.34, 0.72),
    new THREE.Vector2(0.18, 0.82),
    new THREE.Vector2(0.1, 0.96),
    new THREE.Vector2(0.13, 1.08),
    new THREE.Vector2(0.06, 1.24),
    new THREE.Vector2(0, 1.32),
  ];
  const g = new THREE.LatheGeometry(pts, 22);
  g.scale(size, size, size);
  return g;
}

/* --------------------------------------------------------------- 斗拱 */

/**
 * 檐下斗拱：以「斗 + 拱 + 昂」简化体块沿檐口成列布置。
 * @param {number} w 面阔方向柱列长度
 * @param {number} d 进深方向柱列长度
 * @param {number} y 斗拱底面高度
 * @param {number} spacing 攒当间距
 */
export function dougongRing(w, d, y, spacing = 1.7) {
  const geos = [];
  const hw = w / 2;
  const hd = d / 2;

  const put = (x, z, rot) => {
    const m = new THREE.Matrix4().makeRotationY(rot);
    m.setPosition(x, y, z);
    // 斗
    geos.push(_box.clone().applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + 0.16, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
      new THREE.Vector3(0.62, 0.32, 0.62)
    )));
    // 拱（横向伸长）
    geos.push(_box.clone().applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + 0.44, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
      new THREE.Vector3(1.9, 0.24, 0.34)
    )));
    // 升
    geos.push(_box.clone().applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + 0.66, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
      new THREE.Vector3(0.42, 0.22, 0.42)
    )));
    void m;
  };

  // 南北两面
  const nx = Math.max(2, Math.round(w / spacing));
  for (let i = 0; i <= nx; i++) {
    const x = -hw + (w * i) / nx;
    put(x, hd, 0);
    put(x, -hd, 0);
  }
  // 东西两面
  const nz = Math.max(2, Math.round(d / spacing));
  for (let i = 1; i < nz; i++) {
    const z = -hd + (d * i) / nz;
    put(hw, z, Math.PI / 2);
    put(-hw, z, Math.PI / 2);
  }

  return merge(geos);
}

/* --------------------------------------------------------------- 台基 */

/**
 * 须弥座台基：圭角 + 束腰 + 上枋的三段式，四角可带栏板望柱。
 */
export function podium({
  w,
  d,
  h,
  balustrade = true,
  postSpacing = 1.45,
  steps = null,
  gap = null,
}) {
  const geos = [];

  const lower = h * 0.36;
  const waist = h * 0.28;
  const upper = h - lower - waist;

  geos.push(boxAt(w, lower, d, 0, lower / 2, 0));
  geos.push(boxAt(w - 0.42, waist, d - 0.42, 0, lower + waist / 2, 0));
  geos.push(boxAt(w + 0.1, upper, d + 0.1, 0, lower + waist + upper / 2, 0));

  const g = merge(geos);

  const group = new THREE.Group();
  const body = mesh(g, mat.marble, 'terrace');
  group.add(body);

  if (balustrade) {
    const bal = balustradeRing(w + 0.1, d + 0.1, h, postSpacing, gap);
    if (bal) group.add(mesh(bal, mat.marble, 'terrace'));
  }

  if (steps) {
    const st = stepFlight(steps);
    if (st) group.add(mesh(st, mat.marble, 'terrace'));
  }

  return group;
}

/**
 * 栏板望柱：沿台基上沿一圈，望柱为方柱带柱头，柱间为栏板。
 * @param {null|{edge:'south'|'north'|'east'|'west', at:number, width:number}} gap 台阶处断开
 */
export function balustradeRing(w, d, y, spacing = 1.45, gap = null) {
  const geos = [];
  const hw = w / 2;
  const hd = d / 2;
  const postW = 0.24;
  const postH = 1.02;
  const panelH = 0.52;

  const skip = (x, z) => {
    if (!gap) return false;
    const g = gap.width / 2 + 1.2;
    if (gap.edge === 'south') return Math.abs(x - gap.at) < g && z > 0;
    if (gap.edge === 'north') return Math.abs(x - gap.at) < g && z < 0;
    if (gap.edge === 'east') return Math.abs(z - gap.at) < g && x > 0;
    return Math.abs(z - gap.at) < g && x < 0;
  };

  const line = (ax, az, bx, bz, top) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = lerp(ax, bx, t);
      const z = lerp(az, bz, t);
      if (skip(x, z)) continue;
      geos.push(boxAt(postW, postH, postW, x, y + postH / 2, z));
      // 柱头
      geos.push(boxAt(postW * 1.5, 0.14, postW * 1.5, x, y + postH + 0.06, z));
      if (i < n) {
        const x2 = lerp(ax, bx, (i + 1) / n);
        const z2 = lerp(az, bz, (i + 1) / n);
        if (skip(x2, z2)) continue;
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
    void top;
  };

  line(-hw + postW, -hd, hw - postW, -hd, true);
  line(-hw, hd - postW, hw, hd - postW, true);
  line(hw - postW, -hd + postW, hw - postW, hd - postW, true);
  line(-hw + postW, -hd + postW, -hw + postW, hd - postW, true);

  return merge(geos);
}

/**
 * 踏跺：自南侧下行的台阶，中央一条御路（雕龙斜坡）。
 * @param {{w:number, h:number, d:number, x?:number, z?:number}} o
 */
export function stepFlight({ w, h, d, x = 0, z = 0 }) {
  const geos = [];
  const n = Math.max(3, Math.round(h / 0.16));
  const riser = h / n;
  const tread = d / n;
  // 自台基边沿向 +Z（南）下行；传入的 z 是台基南侧边沿
  for (let i = 0; i < n; i++) {
    const y = i * riser;
    geos.push(boxAt(w, riser + 0.01, d - i * tread, x, y + riser / 2, z + (i * tread) / 2));
  }
  // 御路：中央略高的斜坡
  const ramp = new THREE.BoxGeometry(w * 0.24, 0.12, d * 1.02);
  ramp.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, h * 0.52, z + d / 2),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(h, d), 0, 0)),
    new THREE.Vector3(1, 1, 1)
  ));
  geos.push(ramp);
  return merge(geos);
}

/* --------------------------------------------------------------- 檐柱 */

/** 沿矩形环布置檐柱（含柱础） */
export function columnRing(w, d, height, spacing = 3.5, radius = 0.34) {
  const geos = [];
  const hw = w / 2;
  const hd = d / 2;

  const post = (x, z) => {
    const g = new THREE.CylinderGeometry(radius, radius * 1.04, height, 10);
    g.translate(x, height / 2, z);
    geos.push(g);
    const base = new THREE.CylinderGeometry(radius * 1.6, radius * 1.7, 0.2, 10);
    base.translate(x, 0.1, z);
    geos.push(base);
  };

  const nx = Math.max(2, Math.round(w / spacing));
  for (let i = 0; i <= nx; i++) {
    const x = -hw + (w * i) / nx;
    post(x, hd);
    post(x, -hd);
  }
  const nz = Math.max(2, Math.round(d / spacing));
  for (let i = 1; i < nz; i++) {
    const z = -hd + (d * i) / nz;
    post(hw, z);
    post(-hw, z);
  }

  return merge(geos);
}

/** 檐下额枋彩画带 */
export function friezeBand(w, d, y, h = 0.95, thickness = 0.16) {
  const geos = [];
  geos.push(boxAt(w, h, thickness, 0, y + h / 2, d / 2));
  geos.push(boxAt(w, h, thickness, 0, y + h / 2, -d / 2));
  geos.push(boxAt(thickness, h, d, w / 2, y + h / 2, 0));
  geos.push(boxAt(thickness, h, d, -w / 2, y + h / 2, 0));
  return merge(geos);
}

/* --------------------------------------------------------------- 树木 */

export function treeGeometry(seedRand, scale = 1) {
  const trunkH = (1.2 + seedRand() * 1.4) * scale;
  const trunk = new THREE.CylinderGeometry(0.16 * scale, 0.24 * scale, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);

  const canopy = [];
  const lobes = 2 + Math.floor(seedRand() * 2);
  for (let i = 0; i < lobes; i++) {
    const r = (1.5 + seedRand() * 1.1) * scale;
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3((seedRand() - 0.5) * 1.6 * scale, trunkH + (0.4 + seedRand() * 0.9) * scale, (seedRand() - 0.5) * 1.6 * scale),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(seedRand() * 3, seedRand() * 3, seedRand() * 3)),
      new THREE.Vector3(1, 0.82, 1)
    ));
    canopy.push(g);
  }
  return { trunk, canopy: merge(canopy) };
}
