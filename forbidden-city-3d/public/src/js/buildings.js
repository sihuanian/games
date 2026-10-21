/**
 * 建筑装配层
 * ---------------------------------------------------------------
 * 把 geometry.js 里的构件组装成可用的建筑单体：
 *   殿（庑殿 / 歇山 / 攒尖，单檐与重檐）、
 *   城台门（午门、神武门）、角楼、城墙、廊庑、院落、亭、桥。
 *
 * 约定：单体的局部原点在「台基顶面」，朝向为面阔沿 X、进深沿 Z，正南为 +Z。
 */

import * as THREE from 'three';
import { mat, plaqueMaterial } from './materials.js';
import {
  mesh,
  merge,
  boxAt,
  lerp,
  roofSurface,
  ridgeAlong,
  eaveTrim,
  kissShape,
  finialGeometry,
  dougongRing,
  podium,
  columnRing,
  friezeBand,
} from './geometry.js';

/* ================================================================ 屋顶 */

/**
 * 组装一座屋顶。局部原点位于檐口标高，屋面自原点向上生长。
 *
 * @param {object} o
 * @param {number} o.width   面阔方向总宽（含出檐）
 * @param {number} o.depth   进深方向总深（含出檐）
 * @param {number} o.height  屋脊相对檐口的高差
 * @param {'hip'|'gable-hip'|'pyramid'|'gable'} [o.kind]
 * @param {number} [o.gableY]      歇山：山花起始高度占屋脊高度的比例
 * @param {{hw:number,hd:number}} [o.ringTo] 重檐下檐：屋面收至上檐墙身矩形
 * @param {boolean} [o.noEaveTrim] 不生成檐口收头带
 * @param {boolean} [o.noRidge]    不生成正脊与吻兽
 */
export function createRoof(o) {
  const kind = o.kind || 'hip';
  const group = new THREE.Group();
  const rs = roofSurface({
    width: o.width,
    depth: o.depth,
    height: o.height,
    kind,
    gableY: o.gableY,
    push: o.push,
    tMax: o.tMax,
    upturn: o.upturn,
    flare: o.flare,
    ringTo: o.ringTo,
    skipEndFaces: kind === 'gable',
    uSeg: o.uSeg,
    vSeg: o.vSeg,
  });

  const roofMesh = mesh(rs.geometry, mat.roof, 'roof');
  group.add(roofMesh);

  // 檐口收头带：瓦当与滴水
  if (!o.noEaveTrim) {
    const drop = o.eaveDrop !== undefined ? o.eaveDrop : Math.min(0.36, o.height * 0.16);
    for (const line of rs.eaves) {
      group.add(mesh(eaveTrim(line, drop, 0.1), mat.eave, 'roof'));
    }
  }

  const H = o.height;
  const Lh = rs.Lh;
  const hw = o.width / 2;
  const dv = o.depth / 2;

  // 悬山 / 硬山：两端竖直山墙 + 排山博缝脊
  if (kind === 'gable') {
    const capGeos = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.BufferGeometry();
      const x = sx * hw;
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        x, 0, dv,
        x, 0, -dv,
        x, H, 0,
      ], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();
      capGeos.push(g);
    }
    const cap = merge(capGeos);
    if (cap) group.add(mesh(cap, mat.roofRidge, 'roof'));
  }

  // 正脊与吻兽
  const hasRidge = kind !== 'pyramid' && !o.ringTo && !o.noRidge;
  if (hasRidge && Lh > 0.4) {
    const ridgeH = o.ridgeHeight !== undefined ? o.ridgeHeight : Math.min(1.5, 0.5 + H * 0.09);
    const rg = ridgeAlong(
      [new THREE.Vector3(-Lh - 0.2, H, 0), new THREE.Vector3(Lh + 0.2, H, 0)],
      o.ridgeWidth !== undefined ? o.ridgeWidth : 0.66,
      ridgeH
    );
    if (rg) group.add(mesh(rg, mat.roofRidge, 'roof'));

    // 正吻：脊端卷曲龙形
    const kissH = Math.min(2.4, 1.1 + H * 0.13);
    const kd = (o.ridgeWidth !== undefined ? o.ridgeWidth : 0.66) * 0.95;
    const kg = kissShape(kd);
    const kissScale = kissH / 2.0;
    for (const sx of [-1, 1]) {
      const km = mesh(kg.clone(), mat.roofRidge, 'roof');
      km.position.set(sx * Lh, H + 0.06, 0);
      km.scale.set(sx * kissScale, kissScale, 1);
      group.add(km);
    }
  }

  // 垂脊 / 戗脊 / 排山脊
  const hipW = o.hipWidth !== undefined ? o.hipWidth : 0.44;
  const hipH = o.hipHeight !== undefined ? o.hipHeight : 0.34;
  const cornerSamples = 14;
  const corners = [
    { fi: 0, s: 1, sx: 1 },
    { fi: 0, s: -1, sx: -1 },
    { fi: 1, s: 1, sx: 1 },
    { fi: 1, s: -1, sx: -1 },
  ];

  const tStop = kind === 'gable-hip' ? rs.gableAt : rs.tEnd;
  const gableY0 = H * Math.pow(rs.gableAt, 1.55);

  for (const c of corners) {
    const pts = [];
    for (let i = 0; i <= cornerSamples; i++) {
      pts.push(rs.pointOn(c.fi, (i / cornerSamples) * tStop, c.s));
    }
    const rg = ridgeAlong(pts, hipW, hipH);
    if (rg) group.add(mesh(rg, mat.roofRidge, 'roof'));

    // 歇山：自戗脊顶端沿山花斜边继续升至正脊
    if (kind === 'gable-hip') {
      const top = pts[pts.length - 1];
      const up = ridgeAlong(
        [top.clone(), new THREE.Vector3(c.sx * Lh, H, 0)],
        hipW,
        hipH
      );
      if (up) group.add(mesh(up, mat.roofRidge, 'roof'));
    }
  }

  // 歇山：两端竖向山花
  if (kind === 'gable-hip') {
    const z0 = dv * rs.shrinkZ(rs.gableAt);
    for (const sx of [-1, 1]) {
      const g = new THREE.BufferGeometry();
      const x = sx * Lh;
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        x, gableY0, z0,
        x, gableY0, -z0,
        x, H, 0,
      ], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();
      group.add(mesh(g, mat.roofRidge, 'roof'));
    }
  }

  // 攒尖顶：鎏金宝顶
  if (kind === 'pyramid') {
    const fg = finialGeometry(o.finialSize !== undefined ? o.finialSize : Math.min(1.9, 0.7 + H * 0.13));
    const fm = mesh(fg, mat.gold, 'roof');
    fm.position.set(0, H - 0.15, 0);
    group.add(fm);
  }

  // 重檐下檐：顶沿围脊收口
  if (o.ringTo) {
    const rhw = o.ringTo.hw;
    const rhd = o.ringTo.hd;
    const band = ridgeAlong(
      [new THREE.Vector3(-rhw, H, rhd), new THREE.Vector3(rhw, H, rhd)],
      o.ridgeWidth !== undefined ? o.ridgeWidth : 0.5,
      0.42
    );
    group.add(mesh(band, mat.roofRidge, 'roof'));
    group.add(mesh(
      ridgeAlong([new THREE.Vector3(-rhw, H, -rhd), new THREE.Vector3(rhw, H, -rhd)], 0.5, 0.42),
      mat.roofRidge, 'roof'
    ));
    group.add(mesh(
      ridgeAlong([new THREE.Vector3(rhw, H, -rhd), new THREE.Vector3(rhw, H, rhd)], 0.5, 0.42),
      mat.roofRidge, 'roof'
    ));
    group.add(mesh(
      ridgeAlong([new THREE.Vector3(-rhw, H, -rhd), new THREE.Vector3(-rhw, H, rhd)], 0.5, 0.42),
      mat.roofRidge, 'roof'
    ));
  }

  return group;
}

/* ================================================================ 屋身 */

/**
 * 屋身：墙、檐柱、隔扇门窗、额枋彩画、斗拱、匾额。
 *
 * @param {object} o
 * @param {number} o.w 面阔（柱网，不含出檐）
 * @param {number} o.d 进深
 * @param {number} o.h 屋身高度
 * @param {number} o.veranda 檐廊宽度（墙身内缩）
 * @param {number} o.bays 面阔间数
 * @param {number} [o.doorBays] 南面正中改为板门的间数
 * @param {boolean} [o.dougong] 是否生成斗拱
 * @param {number} [o.dougongOut] 斗拱圈相对柱网的外扩
 * @param {string} [o.plaque] 匾额文字
 * @param {boolean} [o.windows] 是否生成槛窗
 */
export function createBody(o) {
  const group = new THREE.Group();
  const w = o.w;
  const d = o.d;
  const h = o.h;
  const veranda = o.veranda !== undefined ? o.veranda : 2.4;
  const wallW = Math.max(2, w - 2 * veranda);
  const wallD = Math.max(2, d - 2 * veranda);
  const bays = Math.max(1, o.bays || 5);

  // 墙身
  group.add(mesh(boxAt(wallW, h, wallD, 0, h / 2, 0), mat.wall, 'body'));

  // 檐柱与柱础
  const cols = columnRing(w, d, h, Math.max(3, w / Math.max(3, bays)), 0.34);
  if (cols) group.add(mesh(cols, mat.column, 'body'));

  // 额枋彩画带
  const friezeH = Math.min(1.0, h * 0.16);
  const fb = friezeBand(w + 0.06, d + 0.06, h - friezeH, friezeH, 0.2);
  if (fb) group.add(mesh(fb, mat.caihua, 'body'));

  // 斗拱
  if (o.dougong !== false) {
    const out = o.dougongOut !== undefined ? o.dougongOut : 0.9;
    const dg = dougongRing(w + out, d + out, h - friezeH - 0.78, 1.75);
    if (dg) group.add(mesh(dg, mat.beam, 'body'));
  }

  // 隔扇与板门：南面（+Z）
  const bayW = w / bays;
  const doorBays = o.doorBays || 0;
  const doorStart = Math.floor((bays - doorBays) / 2);
  const panelGeos = [];
  const doorGeos = [];
  for (let i = 0; i < bays; i++) {
    const cx = -w / 2 + bayW * (i + 0.5);
    const isDoor = doorBays > 0 && i >= doorStart && i < doorStart + doorBays;
    const ph = isDoor ? h * 0.78 : h * 0.6;
    const pw = bayW - 0.32;
    const pg = new THREE.BoxGeometry(pw, ph, 0.14);
    pg.translate(cx, ph / 2 + (h * 0.06), d / 2 - veranda + 0.11);
    if (isDoor) doorGeos.push(pg);
    else panelGeos.push(pg);
  }
  const panels = merge(panelGeos);
  if (panels) group.add(mesh(panels, mat.lattice, 'body'));
  const doors = merge(doorGeos);
  if (doors) group.add(mesh(doors, mat.door, 'body'));

  // 槛窗：东西两面
  if (o.windows !== false) {
    const nz = Math.max(2, Math.round(d / 3.8));
    const stepZ = d / nz;
    const winGeos = [];
    for (let side = 0; side < 2; side++) {
      const sx = side === 0 ? 1 : -1;
      for (let i = 0; i < nz; i++) {
        const cz = -d / 2 + stepZ * (i + 0.5);
        const ph = h * 0.46;
        const g = new THREE.BoxGeometry(0.13, ph, stepZ - 0.4);
        g.translate(sx * (w / 2 - veranda + 0.07), ph / 2 + h * 0.14, cz);
        winGeos.push(g);
      }
    }
    const wins = merge(winGeos);
    if (wins) group.add(mesh(wins, mat.lattice, 'body'));
  }

  // 匾额
  if (o.plaque) {
    const pm = plaqueMaterial(o.plaque);
    const pw = Math.min(w * 0.42, 3.8);
    const ph = pw * 0.3;
    const pg = new THREE.PlaneGeometry(pw, ph);
    const pmMesh = new THREE.Mesh(pg, pm);
    pmMesh.position.set(0, h * 0.86, wallD / 2 + 0.12);
    pmMesh.rotation.y = 0;
    group.add(pmMesh);
    // 匾额托架
    const frame = boxAt(pw + 0.24, ph + 0.2, 0.16, 0, h * 0.86, wallD / 2 + 0.04);
    group.add(mesh(frame, mat.gold, 'body'));
    // 匾额朝向为 +Z，无需旋转；托架在匾额之后
    pmMesh.renderOrder = 2;
  }

  return group;
}

/* ================================================================ 殿 */

/**
 * 生成一座殿。
 *
 * @param {object} cfg
 * @param {number} cfg.w  面阔（柱网尺寸）
 * @param {number} cfg.d  进深
 * @param {'hip'|'gable-hip'|'pyramid'|'gable'} [cfg.roofKind]
 * @param {boolean} [cfg.doubleEave] 是否重檐
 * @param {number} cfg.bodyH 单檐时的檐口高；重檐时为上檐檐口高
 * @param {number} [cfg.lowerEaveY]   重檐下檐檐口高
 * @param {number} [cfg.lowerRoofH]   重檐下檐屋面高差
 * @param {number} [cfg.upperRoofH]   上檐屋面高差
 * @param {number} [cfg.eaveOverhang] 下檐出檐
 * @param {number} [cfg.upperOverhang] 上檐出檐
 * @param {number} [cfg.upperInset]   上檐墙身相对柱网的内缩
 * @param {object|null} [cfg.podium]  台基，null 表示直接坐落在大台基上
 * @param {string} [cfg.roofKey] 形制图谱分类键
 * @param {string} [cfg.plaque]  匾额文字
 */
export function createHall(cfg) {
  const w = cfg.w;
  const d = cfg.d;
  const kind = cfg.roofKind || 'hip';
  const isDouble = !!cfg.doubleEave;
  const veranda = cfg.veranda !== undefined ? cfg.veranda : Math.min(2.8, d * 0.11);
  const ov = cfg.eaveOverhang !== undefined ? cfg.eaveOverhang : (w > 30 ? 3.6 : 2.8);
  const upperInset = cfg.upperInset !== undefined ? cfg.upperInset : veranda + 1.3;
  const hw = Math.max(1.5, w / 2 - upperInset);
  const hd = Math.max(1.5, d / 2 - upperInset);

  const lowerEaveY = cfg.lowerEaveY !== undefined ? cfg.lowerEaveY : cfg.bodyH;
  const upperEaveY = cfg.bodyH;
  const lowerRoofH = cfg.lowerRoofH !== undefined ? cfg.lowerRoofH : 4.2;
  const upperRoofH = cfg.upperRoofH !== undefined ? cfg.upperRoofH : (cfg.roofH !== undefined ? cfg.roofH : 6.4);

  const group = new THREE.Group();

  // 台基
  const podiumH = cfg.podium ? (cfg.podium.h !== undefined ? cfg.podium.h : 2.2) : 0;
  if (cfg.podium) {
    const expand = cfg.podium.expand !== undefined ? cfg.podium.expand : 3.6;
    const steps = cfg.podium.steps
      ? {
        w: cfg.podium.steps.w !== undefined ? cfg.podium.steps.w : Math.min(w * 0.42, 16),
        h: podiumH,
        d: cfg.podium.steps.d !== undefined ? cfg.podium.steps.d : 7,
        x: 0,
        z: (d + expand) / 2,
      }
      : null;
    const gap = steps ? { edge: 'south', at: 0, width: steps.w + 1.0 } : null;
    const p = podium({
      w: w + expand,
      d: d + expand,
      h: podiumH,
      balustrade: cfg.podium.balustrade !== false,
      steps,
      gap,
    });
    p.position.y = -podiumH;
    group.add(p);
  }

  // 下段屋身
  const body = createBody({
    w,
    d,
    h: lowerEaveY,
    veranda,
    bays: cfg.bays || 9,
    doorBays: cfg.doorBays || 0,
    dougong: true,
    dougongOut: ov * 0.55,
    plaque: cfg.plaque,
    windows: cfg.windows,
  });
  group.add(body);

  if (!isDouble) {
    if (!cfg.noRoof) {
      const roof = createRoof({
        width: w + 2 * ov,
        depth: d + 2 * ov,
        height: upperRoofH,
        kind,
        gableY: cfg.gableY,
        push: cfg.push,
        upturn: cfg.upturn,
        flare: cfg.flare,
        finialSize: cfg.finialSize,
      });
      roof.position.y = upperEaveY;
      group.add(roof);
    }
  } else {
    // 下檐：四坡环状屋面，收至上檐墙身
    const lower = createRoof({
      width: w + 2 * ov,
      depth: d + 2 * ov,
      height: lowerRoofH,
      kind: 'hip',
      ringTo: { hw, hd },
      upturn: (cfg.upturn !== undefined ? cfg.upturn : 0.85) * 0.85,
      flare: (cfg.flare !== undefined ? cfg.flare : 1.35) * 0.85,
      ridgeWidth: 0.5,
      hipWidth: 0.4,
      hipHeight: 0.3,
    });
    lower.position.y = lowerEaveY;
    group.add(lower);

    // 上檐墙身
    const upperWallH = Math.max(1.2, upperEaveY - (lowerEaveY + lowerRoofH));
    const upperInsetY = lowerEaveY + lowerRoofH;
    const up = createBody({
      w: hw * 2,
      d: hd * 2,
      h: upperWallH,
      veranda: 1.1,
      bays: Math.max(3, Math.round((hw * 2) / 4)),
      doorBays: 0,
      dougong: true,
      dougongOut: (cfg.upperOverhang !== undefined ? cfg.upperOverhang : 2.6) * 0.5,
      windows: true,
    });
    up.position.y = upperInsetY;
    group.add(up);

    const ov2 = cfg.upperOverhang !== undefined ? cfg.upperOverhang : 2.6;
    if (!cfg.noRoof) {
      const roof = createRoof({
        width: hw * 2 + 2 * ov2,
        depth: hd * 2 + 2 * ov2,
        height: upperRoofH,
        kind,
        gableY: cfg.gableY,
        push: cfg.push,
        upturn: cfg.upturn,
        flare: cfg.flare,
        finialSize: cfg.finialSize,
      });
      roof.position.y = upperEaveY;
      group.add(roof);
    }
  }

  group.userData.roofKey = cfg.roofKey || 'sub';
  tagRoofKey(group, group.userData.roofKey);
  return group;
}

/** 把形制分类键写入组内所有网格，供形制图谱着色 */
export function tagRoofKey(obj, key) {
  obj.traverse((o) => {
    if (o.isMesh && o.userData.baseMat) o.userData.roofKey = key;
  });
}

/* ================================================================ 城台门 */

/**
 * 带城台的门（午门、神武门）：城台 + 门洞 + 城楼，可选雁翅楼。
 *
 * @param {object} cfg
 * @param {number} cfg.w 城台面阔
 * @param {number} cfg.d 城台进深
 * @param {number} cfg.h 城台高
 * @param {number} [cfg.openings] 门洞数（奇数，居中排布）
 * @param {number} [cfg.openingW] 门洞宽
 * @param {object} [cfg.tower] 城楼参数（传给 createHall）
 * @param {Array<{x:number,z:number}>} [cfg.pavilions] 崇楼位置（重檐攒尖小亭）
 * @param {Array<{x:number,z:number,l:number}>} [cfg.wings] 雁翅楼（沿 Z 延伸）
 */
export function createWalledGate(cfg) {
  const group = new THREE.Group();
  const w = cfg.w;
  const d = cfg.d;
  const h = cfg.h;
  const openings = cfg.openings || 3;
  const oW = cfg.openingW || Math.min(6.2, w / (openings + 2));
  const oH = cfg.openingH || h * 0.56;          // 起拱高度
  const archR = oW / 2;
  const zHalf = d / 2;

  // 门洞中心的 x 坐标
  const centers = [];
  const step = oW * 2.1;
  for (let i = 0; i < openings; i++) {
    centers.push((i - (openings - 1) / 2) * step);
  }

  const geos = [];
  // 城台两侧的实心段
  const edges = [-w / 2, ...centers.reduce((acc, c) => {
    acc.push(c - oW / 2, c + oW / 2);
    return acc;
  }, []), w / 2].sort((a, b) => a - b);

  for (let i = 0; i < edges.length; i += 2) {
    const x0 = edges[i];
    const x1 = edges[i + 1];
    if (x1 - x0 < 0.05) continue;
    geos.push(boxAt(x1 - x0, h, d, (x0 + x1) / 2, h / 2, 0));
  }
  // 门洞上方：拱券以上的墙体
  const topY = oH + archR;
  for (const c of centers) {
    // 拱券：逐条小梁逼近半圆券脚
    const steps = 12;
    for (let k = 0; k < steps; k++) {
      const a0 = (Math.PI * k) / steps;
      const a1 = (Math.PI * (k + 1)) / steps;
      // 每小段取两条水平带，覆盖券面以上的部分
      for (const side of [-1, 1]) {
        const xs = side * Math.cos(a1) * archR;
        const xe = side * Math.cos(a0) * archR;
        const y = oH + Math.sin(a0) * archR;
        const bw = Math.abs(xe - xs);
        if (bw > 0.02 && y < topY) {
          geos.push(boxAt(bw, topY - y, d, c + (xs + xe) / 2, y + (topY - y) / 2, 0));
        }
      }
    }
  }
  geos.push(boxAt(w, h - topY, d, 0, topY + (h - topY) / 2, 0));

  const wallMesh = mesh(merge(geos), mat.brick, 'body');
  group.add(wallMesh);

  // 门洞内壁的暗部与门扇
  for (const c of centers) {
    const back = boxAt(oW, oH + archR, 0.4, c, (oH + archR) / 2, -zHalf + 0.9);
    group.add(mesh(back, mat.door, 'body'));
    const doorPanel = boxAt(oW * 0.94, oH * 0.92, 0.3, c, (oH * 0.92) / 2, zHalf - 0.5);
    group.add(mesh(doorPanel, mat.door, 'body'));
  }

  // 城台顶面的宇墙与琉璃压顶
  const parapetH = 1.05;
  const par = [];
  par.push(boxAt(w + 0.4, parapetH, 0.8, 0, h + parapetH / 2, zHalf));
  par.push(boxAt(w + 0.4, parapetH, 0.8, 0, h + parapetH / 2, -zHalf));
  par.push(boxAt(0.8, parapetH, d + 0.4, -w / 2, h + parapetH / 2, 0));
  par.push(boxAt(0.8, parapetH, d + 0.4, w / 2, h + parapetH / 2, 0));
  group.add(mesh(merge(par), mat.brick, 'body'));

  // 城楼
  if (cfg.tower) {
    const t = createHall({
      w: cfg.tower.w,
      d: cfg.tower.d,
      roofKind: cfg.tower.roofKind || 'hip',
      doubleEave: cfg.tower.doubleEave !== false,
      bodyH: cfg.tower.bodyH || 16,
      lowerEaveY: (cfg.tower.bodyH || 16) * 0.6,
      lowerRoofH: (cfg.tower.bodyH || 16) * 0.26,
      upperRoofH: (cfg.tower.bodyH || 16) * 0.42,
      eaveOverhang: cfg.tower.eaveOverhang || 3.0,
      upperOverhang: cfg.tower.upperOverhang || 2.4,
      bays: cfg.tower.bays || 9,
      doorBays: 0,
      podium: null,
      roofKey: cfg.tower.roofKey || 'hd2',
      plaque: cfg.tower.plaque,
    });
    t.position.y = h + parapetH;
    group.add(t);
  }

  // 崇楼（四座重檐小亭）
  if (cfg.pavilions) {
    for (const p of cfg.pavilions) {
      const pav = createHall({
        w: p.w || 8.4,
        d: p.w || 8.4,
        roofKind: 'pyramid',
        doubleEave: true,
        bodyH: 8.4,
        lowerEaveY: 4.6,
        lowerRoofH: 2.0,
        upperRoofH: 4.0,
        eaveOverhang: 2.0,
        upperOverhang: 1.8,
        bays: 3,
        doorBays: 0,
        windows: true,
        podium: null,
        roofKey: p.roofKey || 'zj1',
      });
      pav.position.set(p.x, h + parapetH, p.z);
      group.add(pav);
    }
  }

  // 雁翅楼：两翼沿 Z 向南延伸的城台与廊庑
  if (cfg.wings) {
    for (const wing of cfg.wings) {
      const wingH = h * 0.82;
      const body = boxAt(wing.t, wingH, wing.l, wing.x, wingH / 2, wing.z);
      group.add(mesh(body, mat.brick, 'body'));
      const cor = createCorridor({
        length: wing.l - 1.6,
        depth: wing.t - 0.8,
        height: 3.6,
        roofH: 2.0,
        roofKey: 'sub',
        plinth: 0.5,
      });
      cor.rotation.y = 0;
      cor.position.set(wing.x, wingH, wing.z);
      group.add(cor);
    }
  }

  tagRoofKey(group, cfg.roofKey || 'hd2');
  return group;
}

/* ================================================================ 城墙 */

/**
 * 一段城墙：带收分的梯形墙体 + 城砖下碱 + 朱红墙身 + 琉璃压顶。
 * 沿 X 方向延伸。
 */
// 官网：城墙高 9.90 m，底部宽 8.62 m，顶部宽 6.66 m，内外各收分 0.96 m
export function createCityWall({ length, bottomW = 8.62, topW = 6.66, height = 9.9 }) {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-bottomW / 2, 0);
  shape.lineTo(bottomW / 2, 0);
  shape.lineTo(topW / 2, height);
  shape.lineTo(-topW / 2, height);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -length / 2);
  group.add(mesh(g, mat.wall, 'body'));

  // 琉璃压顶
  const cap = ridgeAlong(
    [new THREE.Vector3(0, height, -length / 2), new THREE.Vector3(0, height, length / 2)],
    topW + 0.5,
    0.5
  );
  if (cap) group.add(mesh(cap, mat.roofRidge, 'body'));

  // 城砖下碱
  const base = boxAt(bottomW + 0.16, 1.5, length, 0, 0.75, 0);
  group.add(mesh(base, mat.brick, 'body'));

  tagRoofKey(group, 'sub');
  return group;
}

/* ================================================================ 角楼 */

/**
 * 角楼：三重檐、上出十字脊、鎏金宝顶。
 * 局部原点在城墙顶面。
 */
export function createCornerTower({ scale = 1 } = {}) {
  const group = new THREE.Group();
  const s = scale;

  const tiers = [
    { w: 9.2 * s, h: 4.4 * s, ring: 6.2 * s, roofH: 1.7 * s },
    { w: 6.4 * s, h: 3.6 * s, ring: 4.2 * s, roofH: 1.6 * s },
    { w: 4.4 * s, h: 3.0 * s, ring: 2.6 * s, roofH: 1.5 * s },
  ];

  let y = 0;
  tiers.forEach((t, i) => {
    const body = createHall({
      w: t.w,
      d: t.w,
      roofKind: 'hip',
      doubleEave: false,
      bodyH: t.h,
      eaveOverhang: 1.6 * s,
      veranda: 0.9 * s,
      bays: 3,
      doorBays: 0,
      windows: true,
      podium: null,
      roofKey: 'sz3',
      noRoof: true,   // 角楼的屋檐由环状屋面单独表达
    });
    body.position.y = y;
    group.add(body);

    const ring = createRoof({
      width: t.w + 3.2 * s,
      depth: t.w + 3.2 * s,
      height: t.roofH,
      kind: 'hip',
      ringTo: { hw: t.ring / 2, hd: t.ring / 2 },
      upturn: 0.9 * s,
      flare: 1.4 * s,
      ridgeWidth: 0.42,
      hipWidth: 0.34,
      hipHeight: 0.26,
    });
    ring.position.y = y + t.h;
    group.add(ring);

    // 四向抱厦
    for (const dir of [0, 1, 2, 3]) {
      const bay = createRoof({
        width: 4.4 * s,
        depth: 3.2 * s,
        height: 1.35 * s,
        kind: 'gable-hip',
        gableY: 0.58,
        upturn: 0.35 * s,
        flare: 0.5 * s,
        ridgeWidth: 0.34,
        hipWidth: 0.28,
        hipHeight: 0.22,
        eaveDrop: 0.2,
      });
      const dist = t.w / 2 + 1.2 * s;
      const ang = (Math.PI / 2) * dir;
      bay.rotation.y = ang;
      bay.position.set(Math.sin(ang) * dist, y + t.h - 0.2 * s, Math.cos(ang) * dist);
      group.add(bay);
    }

    y += t.h + t.roofH;
  });

  // 顶层十字脊：两向歇山交安
  for (const rot of [0, Math.PI / 2]) {
    const cross = createRoof({
      width: 7.4 * s,
      depth: 5.0 * s,
      height: 3.4 * s,
      kind: 'gable-hip',
      gableY: 0.5,
      upturn: 0.8 * s,
      flare: 1.2 * s,
      ridgeWidth: 0.46,
      hipWidth: 0.36,
      hipHeight: 0.3,
    });
    cross.rotation.y = rot;
    cross.position.y = y - 0.4 * s;
    group.add(cross);
  }

  const fin = mesh(finialGeometry(1.1 * s), mat.gold, 'roof');
  fin.position.y = y + 2.9 * s;
  group.add(fin);

  tagRoofKey(group, 'sz3');
  return group;
}

/* ================================================================ 廊庑 */

/**
 * 廊庑 / 配殿：沿 X 延伸的低矮长条建筑，悬山屋面。
 * 局部原点在台基顶面。
 */
export function createCorridor({ length, depth, height = 3.6, roofH = 2.0, plinth = 0.8, roofKey = 'sub' }) {
  const group = new THREE.Group();

  if (plinth > 0) {
    const base = boxAt(length + 1.8, plinth, depth + 1.6, 0, -plinth / 2, 0);
    group.add(mesh(base, mat.marble, 'terrace'));
  }

  const wall = boxAt(length, height, depth, 0, height / 2, 0);
  group.add(mesh(wall, mat.wall, 'body'));

  const cols = columnRing(length, depth, height, 3.6, 0.24);
  if (cols) group.add(mesh(cols, mat.column, 'body'));

  const fb = friezeBand(length + 0.05, depth + 0.05, height - 0.6, 0.62, 0.14);
  if (fb) group.add(mesh(fb, mat.caihua, 'body'));

  const roof = createRoof({
    width: length + 0.9,
    depth: depth + 2.4,
    height: roofH,
    kind: 'gable',
    upturn: 0.4,
    flare: 0.5,
    ridgeWidth: 0.36,
    hipWidth: 0.3,
    hipHeight: 0.24,
    eaveDrop: 0.24,
  });
  roof.position.y = height;
  group.add(roof);

  tagRoofKey(group, roofKey);
  return group;
}

/* ================================================================ 院落 */

/**
 * 一进院落：院墙 + 南墙院门 + 正殿 + 东西配殿。
 * 局部原点在院落中心的地面。
 *
 * @param {object} cfg
 * @param {number} cfg.w 院落面阔
 * @param {number} cfg.d 院落进深
 * @param {number} [cfg.hallW] 正殿面阔
 * @param {number} [cfg.hallD] 正殿进深
 * @param {'hip'|'gable-hip'|'gable'} [cfg.hallRoof]
 * @param {boolean} [cfg.doubleEave]
 * @param {boolean} [cfg.gate] 南墙是否开院门
 * @param {string} [cfg.roofKey]
 */
export function createCourtyard(cfg) {
  const group = new THREE.Group();
  const w = cfg.w;
  const d = cfg.d;
  const wallH = cfg.wallH !== undefined ? cfg.wallH : 3.0;
  const wallT = 0.7;
  const hallW = cfg.hallW !== undefined ? cfg.hallW : w * 0.5;
  const hallD = cfg.hallD !== undefined ? cfg.hallD : d * 0.34;
  const roofKey = cfg.roofKey || 'sub';

  // 院墙
  const walls = [];
  walls.push(boxAt(w, wallH, wallT, 0, wallH / 2, d / 2));
  walls.push(boxAt(w, wallH, wallT, 0, wallH / 2, -d / 2));
  walls.push(boxAt(wallT, wallH, d, -w / 2, wallH / 2, 0));
  walls.push(boxAt(wallT, wallH, d, w / 2, wallH / 2, 0));
  group.add(mesh(merge(walls), mat.wall, 'body'));

  const caps = [];
  caps.push(ridgeAlong([new THREE.Vector3(-w / 2, wallH, d / 2), new THREE.Vector3(w / 2, wallH, d / 2)], wallT + 0.5, 0.34));
  caps.push(ridgeAlong([new THREE.Vector3(-w / 2, wallH, -d / 2), new THREE.Vector3(w / 2, wallH, -d / 2)], wallT + 0.5, 0.34));
  caps.push(ridgeAlong([new THREE.Vector3(-w / 2, wallH, -d / 2), new THREE.Vector3(-w / 2, wallH, d / 2)], wallT + 0.5, 0.34));
  caps.push(ridgeAlong([new THREE.Vector3(w / 2, wallH, -d / 2), new THREE.Vector3(w / 2, wallH, d / 2)], wallT + 0.5, 0.34));
  const capGeos = caps.filter(Boolean);
  if (capGeos.length) {
    for (const c of capGeos) group.add(mesh(c, mat.roofRidge, 'body'));
  }

  // 院门：南墙上的小门楼
  if (cfg.gate !== false) {
    const gw = Math.min(6.5, w * 0.3);
    const opening = boxAt(gw, 3.2, wallT + 0.3, 0, 1.6, d / 2);
    group.add(mesh(opening, mat.door, 'body'));
    const gateRoof = createRoof({
      width: gw + 2.6,
      depth: 3.4,
      height: 1.5,
      kind: 'gable',
      upturn: 0.3,
      flare: 0.4,
      ridgeWidth: 0.3,
      hipWidth: 0.26,
      hipHeight: 0.2,
      eaveDrop: 0.2,
    });
    gateRoof.position.set(0, 3.6, d / 2 + 0.5);
    group.add(gateRoof);
  }

  // 正殿（居北端，坐北朝南）
  const hall = createHall({
    w: hallW,
    d: hallD,
    roofKind: cfg.hallRoof || 'gable-hip',
    doubleEave: !!cfg.doubleEave,
    bodyH: cfg.doubleEave ? hallD * 0.72 : hallD * 0.6,
    lowerEaveY: hallD * 0.42,
    lowerRoofH: hallD * 0.2,
    upperRoofH: hallD * 0.34,
    eaveOverhang: 1.8,
    upperOverhang: 1.5,
    veranda: 1.4,
    bays: 5,
    doorBays: 3,
    windows: false,
    podium: { h: 1.5, expand: 2.4, balustrade: false, steps: { w: hallW * 0.4, d: 3.4 } },
    roofKey,
    gableY: 0.58,
    upturn: 0.5,
    flare: 0.7,
  });
  hall.position.set(0, 0, -d / 2 + wallT + hallD / 2 + 4.5);
  group.add(hall);

  // 东西配殿
  const sideD = Math.min(d * 0.42, 16);
  const sideW = Math.min(w * 0.3, 14);
  for (const sx of [-1, 1]) {
    const side = createHall({
      w: sideW,
      d: sideD,
      roofKind: 'gable',
      doubleEave: false,
      bodyH: 4.2,
      roofH: 2.2,
      eaveOverhang: 1.6,
      veranda: 1.2,
      bays: 3,
      doorBays: 0,
      windows: true,
      podium: { h: 0.9, expand: 1.8, balustrade: false, steps: { w: sideW * 0.4, d: 2.4 } },
      roofKey: 'sub',
      upturn: 0.35,
      flare: 0.45,
    });
    side.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    side.position.set(sx * (w / 2 - wallT - sideW / 2 - 2.2), 0, -d / 2 + sideD / 2 + 6);
    group.add(side);
  }

  tagRoofKey(group, roofKey);
  return group;
}

/* ================================================================ 亭 */

/** 方形亭：四角攒尖顶 */
export function createPavilion({ size = 6, height = 4.2, roofH = 3.4, roofKey = 'zj1' }) {
  const group = createHall({
    w: size,
    d: size,
    roofKind: 'pyramid',
    doubleEave: false,
    bodyH: height,
    roofH,
    eaveOverhang: 1.5,
    veranda: 0.7,
    bays: 3,
    doorBays: 0,
    windows: true,
    podium: { h: 0.7, expand: 2.0, balustrade: true, steps: { w: size * 0.5, d: 2.0 } },
    roofKey,
    upturn: 0.9,
    flare: 1.4,
    finialSize: 1.3,
  });
  tagRoofKey(group, roofKey);
  return group;
}

/* ================================================================ 桥 */

/**
 * 汉白玉石桥：微拱桥面 + 栏板望柱。
 * 沿 Z 方向跨越，局部原点在桥面中心。
 */
export function createBridge({ width = 6, span = 12, rise = 1.1, balustrade = true }) {
  const group = new THREE.Group();
  const segs = 12;
  const geos = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const y0 = Math.sin(Math.PI * t0) * rise;
    const y1 = Math.sin(Math.PI * t1) * rise;
    const z0 = -span / 2 + span * t0;
    const z1 = -span / 2 + span * t1;
    const len = Math.hypot(z1 - z0, y1 - y0);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(y1 - y0, z1 - z0), 0, 0));
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(0, (y0 + y1) / 2, (z0 + z1) / 2),
      q,
      new THREE.Vector3(width, 0.55, len * 1.02)
    );
    geos.push(new THREE.BoxGeometry(1, 1, 1).applyMatrix4(m));
  }
  group.add(mesh(merge(geos), mat.marble, 'terrace'));

  if (balustrade) {
    const bals = [];
    const posts = 8;
    for (const sx of [-1, 1]) {
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        const z = -span / 2 + span * t;
        const y = Math.sin(Math.PI * t) * rise + 0.28;
        bals.push(boxAt(0.22, 0.9, 0.22, sx * (width / 2 - 0.11), y + 0.45, z));
        if (i < posts) {
          const t2 = (i + 1) / posts;
          const z2 = -span / 2 + span * t2;
          const y2 = Math.sin(Math.PI * t2) * rise + 0.28;
          const len = Math.hypot(z2 - z, y2 - y) - 0.22;
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(y2 - y, z2 - z), 0, 0));
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(sx * (width / 2 - 0.11), (y + y2) / 2 + 0.52, (z + z2) / 2),
            q,
            new THREE.Vector3(0.16, 0.44, Math.max(0.2, len))
          );
          bals.push(new THREE.BoxGeometry(1, 1, 1).applyMatrix4(m));
        }
      }
    }
    group.add(mesh(merge(bals), mat.marble, 'terrace'));
  }

  return group;
}
