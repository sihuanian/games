/**
 * 程序化贴图库
 * ---------------------------------------------------------------
 * 全部由 canvas 实时生成，不依赖任何外部图片资源，保证离线可运行。
 * 约定：所有贴图都以「1 米见方」为一个平铺单元（tile），
 *      因此调用方直接把 UV 写成「米」即可，平铺次数由 tileMeters 反推。
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ 工具 */

/** 可复现伪随机数发生器，保证每次生成的贴图一致 */
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h === undefined ? w : h;
  return c;
}

function toTexture(canvas, { srgb = true, tileMeters = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileMeters, 1 / tileMeters);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** 叠一层细颗粒噪声，避免大平面上出现死板的纯色 */
function grain(ctx, w, h, amount, seed) {
  const rand = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * 由一维高度剖面生成法线贴图。
 * profile(u) 返回以「单位 u（0~1，即一个平铺单元）」为横坐标的高度值，
 * 函数需可导；这里用中心差分近似导数，并做限幅避免瓦口处出现极端法线。
 */
function normalFromProfile(size, profile, strength = 0.22) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const eps = 1 / (size * 2);

  // 预先求一个周期内每个像素处的高度与切线
  const nx = new Float32Array(size);
  const ny = new Float32Array(size);
  const nz = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size;
    let dL = (profile(u) - profile(u - eps)) / eps;
    let dR = (profile(u + eps) - profile(u)) / eps;
    let dh = (dL + dR) * 0.5;
    dh = Math.max(-8, Math.min(8, dh));
    // 法线 = normalize(-dh * strength, 1, 0)
    const ax = -dh * strength;
    const len = Math.hypot(ax, 1);
    nx[x] = ax / len;
    ny[x] = 1 / len;
    nz[x] = 0;
    }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      d[i] = Math.round((nx[x] * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ny[x] * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((nz[x] * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ------------------------------------------------------- 黄琉璃瓦（屋面） */

/**
 * 琉璃瓦屋面贴图。
 * 横坐标 u 表示「垂直于瓦垄、沿屋面向外」的方向（一个 1 米单元内约 3 垄），
 * 纵坐标 v 表示顺瓦垄向下的方向。
 */
export function glazedRoof(tileMeters = 1) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const rand = rng(20240);

  // 底色：瓦沟（板瓦）偏暗
  ctx.fillStyle = '#8a5f18';
  ctx.fillRect(0, 0, S, S);

  const period = 1 / 3;          // 一个瓦垄周期 = 1/3 米
  const tubWidth = period * 0.52; // 筒瓦（断面半圆）占周期的比例

  // 逐列绘制：筒瓦亮、瓦沟暗，模拟筒瓦搭接
  const px = S;
  const grad = ctx.createLinearGradient(0, 0, px / (1 / period) * 1, 0); // 占位，下面逐垄绘制
  void grad;
  for (let col = 0; col < px; col++) {
    const u = (col + 0.5) / px;
    const phase = (u % period) / period;             // 0~1 处于一个周期内
    const inTub = phase < tubWidth;
    let shade;
    if (inTub) {
      const k = phase / tubWidth;                    // 0~1 沿筒瓦断面
      // 半圆断面：中心最亮
      const arc = Math.sin(Math.PI * k);
      shade = 0.72 + arc * 0.42;
    } else {
      const k = (phase - tubWidth) / (1 - tubWidth);
      const valley = Math.sin(Math.PI * k);
      shade = 0.98 - valley * 0.28;
    }
    const base = [201, 148, 44];
    const r = Math.round(base[0] * shade);
    const g = Math.round(base[1] * shade);
    const b = Math.round(base[2] * shade * 0.94);
    ctx.fillStyle = `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`;
    ctx.fillRect(col, 0, 1, S);
  }

  // 顺屋面方向的瓦片分节：淡入的横向暗线
  ctx.globalAlpha = 0.16;
  for (let y = 0; y < S; y += S / 4) {
    ctx.fillStyle = '#4a3208';
    ctx.fillRect(0, y, S, 2);
    ctx.fillStyle = '#f0cd7d';
    ctx.fillRect(0, y + 2, S, 1);
  }
  ctx.globalAlpha = 1;

  // 窑变：同批琉璃瓦深浅不一
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 60; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const w = 4 + rand() * 10;
    ctx.fillStyle = rand() > 0.5 ? '#f5d78e' : '#6d4a10';
    ctx.fillRect(x, y, w, 6 + rand() * 14);
  }
  ctx.globalAlpha = 1;

  grain(ctx, S, S, 12, 771);

  // 法线：筒瓦半圆 + 瓦沟浅凹
  const r0 = tubWidth / 2;
  const profile = (u) => {
    const phase = u % period;
    if (phase < tubWidth) {
      const x = phase - r0;
      const inner = Math.max(r0 * r0 - x * x, 1e-6);
      return Math.sqrt(inner);
    }
    const k = (phase - tubWidth) / (1 - tubWidth);
    return -0.16 * Math.sin(Math.PI * k);
  };

  return {
    map: toTexture(c, { tileMeters }),
    normalMap: toTexture(normalFromProfile(S, profile, 0.30), { srgb: false, tileMeters }),
  };
}

/** 檐口：瓦当（圆头筒瓦）与滴水（三角板瓦）的收头带 */
export function glazedEave(tileMeters = 1) {
  const W = 512;
  const H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a5414';
  ctx.fillRect(0, 0, W, H);

  const period = 1 / 3;
  const count = Math.round(1 / period); // 一个 1 米单元内的瓦垄数
  const cell = W / count;

  for (let i = 0; i < count; i++) {
    const x = i * cell;
    // 滴水：下垂的三角板瓦
    ctx.fillStyle = '#b8842a';
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + cell * 0.5, H * 0.34);
    ctx.lineTo(x + cell, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6b4910';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 瓦当：圆形筒瓦头
    const cx = x + cell * 0.5;
    const cy = H * 0.36;
    const r = cell * 0.3;
    const rg = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    rg.addColorStop(0, '#f4d78c');
    rg.addColorStop(0.55, '#cf9c36');
    rg.addColorStop(1, '#8c6318');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5f410d';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 瓦当上的纹样
    ctx.fillStyle = '#5f410d';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  grain(ctx, W, H, 10, 991);
  return { map: toTexture(c, { tileMeters }) };
}

/* ------------------------------------------------------------ 汉白玉台基 */

export function marble(tileMeters = 2) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const rand = rng(4471);

  ctx.fillStyle = '#e6e1d5';
  ctx.fillRect(0, 0, S, S);

  // 云斑：汉白玉特有的深浅云纹
  for (let i = 0; i < 90; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 12 + rand() * 62;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() > 0.45;
    g.addColorStop(0, dark ? 'rgba(176,168,152,0.30)' : 'rgba(252,250,245,0.36)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 石缝：须弥座与栏板的分块
  ctx.strokeStyle = 'rgba(140,132,116,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 1; i += 0.5) {
    ctx.beginPath();
    ctx.moveTo(i * S, 0);
    ctx.lineTo(i * S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * S);
    ctx.lineTo(S, i * S);
    ctx.stroke();
  }

  // 极淡的青色石筋
  ctx.strokeStyle = 'rgba(150,158,150,0.22)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    let x = rand() * S;
    let y = rand() * S;
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rand() - 0.5) * 90;
      y += (rand() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  grain(ctx, S, S, 9, 2203);

  // 法线：石缝凹槽
  const profile = (u) => {
    const seam = [0, 0.5];
    let h = 0;
    for (const s of seam) {
      let d = Math.abs(u - s);
      d = Math.min(d, 1 - d);
      if (d < 0.008) h -= 1 - d / 0.008;
    }
    return h * 0.5;
  };

  return {
    map: toTexture(c, { tileMeters }),
    normalMap: toTexture(normalFromProfile(256, profile, 0.34), { srgb: false, tileMeters }),
  };
}

/* -------------------------------------------------------------- 青砖铺地 */

export function paving(tileMeters = 2.4) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const rand = rng(8123);

  ctx.fillStyle = '#4f4b43';
  ctx.fillRect(0, 0, S, S);

  const rows = 4;
  const h = S / rows;
  const w = S / 4;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (w / 2);
    for (let i = -1; i < 5; i++) {
      const x = i * w + offset;
      const y = r * h;
      const shade = 0.86 + rand() * 0.26;
      const base = [124, 120, 110];
      ctx.fillStyle = `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    }
  }

  // 砖面磨损与坑洼
  ctx.globalAlpha = 0.14;
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#e8e2d2' : '#33302a';
    const x = rand() * S;
    const y = rand() * S;
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + rand() * 12, 2 + rand() * 8, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  grain(ctx, S, S, 14, 5150);

  const profile = (u) => {
    // 竖向砖缝
    const d = Math.abs((u % 0.25) - 0);
    const m = Math.min(d, 0.25 - d);
    return m < 0.012 ? -(1 - m / 0.012) * 0.6 : 0;
  };

  return {
    map: toTexture(c, { tileMeters }),
    normalMap: toTexture(normalFromProfile(256, profile, 0.3), { srgb: false, tileMeters }),
  };
}

/* -------------------------------------------------------------- 宫墙朱红 */

export function redWall(tileMeters = 3) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const rand = rng(3391);

  ctx.fillStyle = '#9a3227';
  ctx.fillRect(0, 0, S, S);

  // 大面积深浅不匀：墙面受潮与修补
  for (let i = 0; i < 70; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 26 + rand() * 110;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? 'rgba(126,40,30,0.34)' : 'rgba(186,74,56,0.26)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 自檐下向下的雨痕
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 120; i++) {
    const x = rand() * S;
    ctx.strokeStyle = '#5e1f18';
    ctx.lineWidth = 1 + rand() * 3;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rand() - 0.5) * 8, S * (0.4 + rand() * 0.6));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  grain(ctx, S, S, 16, 6017);

  return {
    map: toTexture(c, { tileMeters }),
    roughnessMap: toTexture(c, { srgb: false, tileMeters }),
  };
}

/* -------------------------------------------------------------- 城砖下碱 */

export function greyBrick(tileMeters = 1.6) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const rand = rng(6621);

  ctx.fillStyle = '#3d3a35';
  ctx.fillRect(0, 0, S, S);

  const rows = 8;
  const h = S / rows;
  const w = S / 3;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (w / 2);
    for (let i = -1; i < 4; i++) {
      const x = i * w + offset;
      const y = r * h;
      const shade = 0.88 + rand() * 0.24;
      const base = [142, 136, 124];
      ctx.fillStyle = `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    }
  }

  grain(ctx, S, S, 16, 4404);
  return { map: toTexture(c, { tileMeters }) };
}

/* ------------------------------------------------- 隔扇门窗（菱花格心） */

export function lattice(tileMeters = 1.4) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');

  // 木质裙板底色
  ctx.fillStyle = '#6d2a20';
  ctx.fillRect(0, 0, S, S);

  const cell = S / 4;
  ctx.strokeStyle = '#c98b5a';
  ctx.lineWidth = 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(S, i * cell);
    ctx.stroke();
  }

  // 格心：每个格子内交叉的斜撑
  ctx.strokeStyle = '#e0ab72';
  ctx.lineWidth = 3;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = gx * cell;
      const y = gy * cell;
      ctx.beginPath();
      ctx.moveTo(x + cell * 0.18, y + cell * 0.18);
      ctx.lineTo(x + cell * 0.82, y + cell * 0.82);
      ctx.moveTo(x + cell * 0.82, y + cell * 0.18);
      ctx.lineTo(x + cell * 0.18, y + cell * 0.82);
      ctx.stroke();
    }
  }

  // 心板：深色木板
  ctx.fillStyle = 'rgba(40,14,10,0.55)';
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = gx * cell + cell * 0.3;
      const y = gy * cell + cell * 0.3;
      ctx.fillRect(x, y, cell * 0.4, cell * 0.4);
    }
  }

  grain(ctx, S, S, 12, 7788);
  return { map: toTexture(c, { tileMeters }) };
}

/* ------------------------------------------------------ 板门（门钉与门环） */

export function studdedDoor(tileMeters = 3) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#71281e';
  ctx.fillRect(0, 0, S, S);

  // 门板拼缝
  ctx.strokeStyle = 'rgba(40,12,8,0.7)';
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo((i * S) / 4, 0);
    ctx.lineTo((i * S) / 4, S);
    ctx.stroke();
  }

  // 门钉：九路金钉
  const cols = 9;
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    for (let cI = 0; cI < cols; cI++) {
      const x = ((cI + 0.5) * S) / cols;
      const y = ((r + 0.5) * S) / rows;
      const rad = S / cols / 2.6;
      const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.35, rad * 0.1, x, y, rad);
      g.addColorStop(0, '#f6dc9a');
      g.addColorStop(0.6, '#cfa03a');
      g.addColorStop(1, '#6d4d10');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  grain(ctx, S, S, 10, 1122);
  return { map: toTexture(c, { tileMeters }) };
}

/* ---------------------------------------------------------- 青绿彩画额枋 */

export function caihua(tileMeters = 2.4) {
  const W = 512;
  const H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#1f4f4d';
  ctx.fillRect(0, 0, W, H);

  // 旋子彩画：青、绿相间，鎏金箍头
  const seg = W / 4;
  for (let i = 0; i < 4; i++) {
    const x = i * seg;
    ctx.fillStyle = i % 2 === 0 ? '#265f5c' : '#2f6b4c';
    ctx.fillRect(x, 0, seg, H);
    // 箍头金线
    ctx.strokeStyle = '#c9a24a';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 3, 3, seg - 6, H - 6);
    // 旋眼
    ctx.fillStyle = 'rgba(10,30,30,0.6)';
    ctx.beginPath();
    ctx.ellipse(x + seg / 2, H / 2, seg * 0.22, H * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e2c477';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#c9a24a';
    ctx.beginPath();
    ctx.arc(x + seg / 2, H / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 上下金线
  ctx.fillStyle = '#c9a24a';
  ctx.fillRect(0, 0, W, 4);
  ctx.fillRect(0, H - 4, W, 4);

  grain(ctx, W, H, 8, 2020);
  return { map: toTexture(c, { tileMeters }) };
}

/* -------------------------------------------------------------- 树木叶片 */

export function foliage(tileMeters = 2) {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const rand = rng(9091);

  ctx.fillStyle = '#2c3f22';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 3 + rand() * 12;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const hue = rand();
    const col = hue > 0.66 ? '58,86,40' : hue > 0.33 ? '44,68,32' : '76,102,48';
    g.addColorStop(0, `rgba(${col},0.85)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  grain(ctx, S, S, 18, 3311);
  return { map: toTexture(c, { tileMeters }) };
}

/* ------------------------------------------------------------ 水面波纹法线 */

export function waterNormal(tileMeters = 24) {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;

  // 多组正弦叠加，形成自然的水面细波
  const waves = [
    { fx: 1, fy: 0, a: 0.5, p: 0 },
    { fx: 0, fy: 1, a: 0.42, p: 1.1 },
    { fx: 1, fy: 1, a: 0.3, p: 2.2 },
    { fx: 3, fy: -2, a: 0.22, p: 0.6 },
    { fx: -2, fy: 4, a: 0.16, p: 3.4 },
  ];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const arg = (u * w.fx + v * w.fy) * Math.PI * 2 + w.p;
        dx += Math.cos(arg) * w.a * w.fx;
        dy += Math.cos(arg) * w.a * w.fy;
      }
      const s = 0.05;
      const ax = -dx * s;
      const ay = -dy * s;
      const len = Math.hypot(ax, ay, 1);
      const i = (y * S + x) * 4;
      d[i] = Math.round((ax / len * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ay / len * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { normalMap: toTexture(c, { srgb: false, tileMeters }) };
}