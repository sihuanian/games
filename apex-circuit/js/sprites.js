/* 贴图：全部用 Canvas 2D 程序化绘制成离屏贴图，零外部图片资源。 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  const CAR_PALETTE = [
    { body: '#ff7a2f', stripe: '#12161d' }, // 0 玩家
    { body: '#2f6bd6', stripe: '#eef3f8' }, // 1 KAI
    { body: '#c8342f', stripe: '#f2e8e3' }, // 2 RYU
    { body: '#e5c02a', stripe: '#1b1808' }, // 3 NOVA
    { body: '#2fa87a', stripe: '#e8f4ee' }, // 4 ZED
    { body: '#8a3fd1', stripe: '#f0e9f7' }, // 5 MILA
    { body: '#dfe4ea', stripe: '#2b3038' }, // 6 ONYX
  ];

  const SIZES = {
    pine1: [130, 300],
    pine2: [100, 230],
    birch: [96, 240],
    bush: [112, 78],
    rock1: [124, 96],
    rock2: [96, 70],
    cone: [28, 48],
    boardChevron: [300, 180],
    boardTurbo: [300, 180],
    boardDrift: [300, 180],
    gantry: [520, 300],
  };

  const CAR_SIZE = [150, 104];

  const cache = {};
  const carCache = {};
  let ready = false;

  function make(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function ctxOf(w, h) {
    const c = make(w, h);
    return { canvas: c, ctx: c.getContext('2d') };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* amt > 0 提亮，amt < 0 压暗 */
  function shade(hex, amt) {
    const rgb = hexToRgb(hex);
    const f = (v) => Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt));
    return 'rgb(' + f(rgb[0]) + ',' + f(rgb[1]) + ',' + f(rgb[2]) + ')';
  }

  /* ── 路边景物 ── */

  function drawPine(ctx, w, h, tint) {
    ctx.fillStyle = '#3b2a1e';
    ctx.fillRect(w * 0.43, h * 0.76, w * 0.14, h * 0.24);

    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const top = h * (0.04 + i * 0.235);
      const bottom = top + h * 0.36;
      const halfB = w * (0.21 + i * 0.135);
      const g = ctx.createLinearGradient(w / 2 - halfB, 0, w / 2 + halfB, 0);
      g.addColorStop(0, tint[0]);
      g.addColorStop(0.5, tint[1]);
      g.addColorStop(1, tint[2]);

      ctx.beginPath();
      ctx.moveTo(w / 2, top);
      ctx.lineTo(w / 2 + halfB, bottom);
      ctx.quadraticCurveTo(w / 2, bottom + h * 0.035, w / 2 - halfB, bottom);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  function drawBirch(ctx, w, h) {
    ctx.fillStyle = '#cfc7b6';
    ctx.fillRect(w * 0.46, h * 0.42, w * 0.09, h * 0.58);
    ctx.fillStyle = 'rgba(40,36,30,.55)';
    ctx.fillRect(w * 0.46, h * 0.54, w * 0.09, h * 0.02);
    ctx.fillRect(w * 0.46, h * 0.68, w * 0.09, h * 0.015);

    const blobs = [
      [0.5, 0.3, 0.44, 0.3, '#6f8f3f'],
      [0.29, 0.42, 0.28, 0.22, '#5a7a33'],
      [0.72, 0.44, 0.28, 0.22, '#4f6b2c'],
    ];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      ctx.beginPath();
      ctx.ellipse(w * b[0], h * b[1], w * b[2], h * b[3], 0, 0, TAU);
      ctx.fillStyle = b[4];
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(w * 0.44, h * 0.26, w * 0.22, h * 0.14, -0.3, 0, TAU);
    ctx.fillStyle = 'rgba(190,210,120,.35)';
    ctx.fill();
  }

  function drawBush(ctx, w, h) {
    const blobs = [
      [0.34, 0.62, 0.32, 0.36, '#1d452c'],
      [0.66, 0.6, 0.3, 0.38, '#173a25'],
      [0.5, 0.5, 0.36, 0.42, '#235236'],
    ];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      ctx.beginPath();
      ctx.ellipse(w * b[0], h * b[1], w * b[2], h * b[3], 0, 0, TAU);
      ctx.fillStyle = b[4];
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(w * 0.42, h * 0.34, w * 0.2, h * 0.16, -0.35, 0, TAU);
    ctx.fillStyle = 'rgba(120,170,110,.28)';
    ctx.fill();
  }

  function drawRock(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.93, w * 0.46, h * 0.07, 0, 0, TAU);
    ctx.fill();

    const g = ctx.createLinearGradient(0, h * 0.1, 0, h);
    g.addColorStop(0, '#767b84');
    g.addColorStop(0.55, '#52565e');
    g.addColorStop(1, '#31343a');

    ctx.beginPath();
    ctx.moveTo(w * 0.04, h * 0.94);
    ctx.lineTo(w * 0.19, h * 0.44);
    ctx.lineTo(w * 0.45, h * 0.13);
    ctx.lineTo(w * 0.75, h * 0.27);
    ctx.lineTo(w * 0.97, h * 0.9);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(w * 0.19, h * 0.44);
    ctx.lineTo(w * 0.45, h * 0.13);
    ctx.lineTo(w * 0.58, h * 0.2);
    ctx.lineTo(w * 0.34, h * 0.52);
    ctx.closePath();
    ctx.fillStyle = 'rgba(226,232,240,.22)';
    ctx.fill();
  }

  function drawCone(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.94, w * 0.5, h * 0.06, 0, 0, TAU);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.04);
    ctx.lineTo(w * 0.93, h * 0.9);
    ctx.lineTo(w * 0.07, h * 0.9);
    ctx.closePath();
    ctx.fillStyle = '#ff6a1f';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(w * 0.3, h * 0.54);
    ctx.lineTo(w * 0.7, h * 0.54);
    ctx.lineTo(w * 0.76, h * 0.71);
    ctx.lineTo(w * 0.24, h * 0.71);
    ctx.closePath();
    ctx.fillStyle = '#f2f5f8';
    ctx.fill();

    ctx.fillStyle = '#c9470f';
    ctx.fillRect(w * 0.03, h * 0.86, w * 0.94, h * 0.09);
  }

  function drawBoardBase(ctx, w, h) {
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(w * 0.2, h * 0.62, w * 0.035, h * 0.38);
    ctx.fillRect(w * 0.765, h * 0.62, w * 0.035, h * 0.38);

    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.98, w * 0.3, h * 0.025, 0, 0, TAU);
    ctx.fill();

    roundRect(ctx, w * 0.02, h * 0.03, w * 0.96, h * 0.63, w * 0.03);
    ctx.fillStyle = '#171b21';
    ctx.fill();
    ctx.lineWidth = w * 0.012;
    ctx.strokeStyle = '#4a5058';
    ctx.stroke();
  }

  function drawBoardChevron(ctx, w, h) {
    drawBoardBase(ctx, w, h);
    for (let i = 0; i < 3; i++) {
      const x = w * (0.2 + i * 0.22);
      ctx.beginPath();
      ctx.moveTo(x, h * 0.16);
      ctx.lineTo(x + w * 0.11, h * 0.345);
      ctx.lineTo(x, h * 0.53);
      ctx.closePath();
      ctx.fillStyle = i === 2 ? '#ffd166' : '#ff7a2f';
      ctx.fill();
    }
    ctx.fillStyle = '#e7ecf1';
    ctx.font = '700 ' + Math.round(h * 0.11) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CURVE', w * 0.62, h * 0.6);
  }

  function drawBoardText(ctx, w, h, word, accent) {
    drawBoardBase(ctx, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.06, h * 0.42, w * 0.88, h * 0.03);
    ctx.fillStyle = '#f2f6fa';
    ctx.font = '800 ' + Math.round(h * 0.26) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, w * 0.5, h * 0.26);
  }

  function drawGantry(ctx, w, h) {
    const post = w * 0.035;

    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.985, w * 0.44, h * 0.02, 0, 0, TAU);
    ctx.fill();

    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? w * 0.02 : w - w * 0.02 - post;
      const g = ctx.createLinearGradient(x, 0, x + post, 0);
      g.addColorStop(0, '#565c66');
      g.addColorStop(0.5, '#33383f');
      g.addColorStop(1, '#22262b');
      ctx.fillStyle = g;
      ctx.fillRect(x, h * 0.3, post, h * 0.7);
      ctx.fillStyle = '#ff7a2f';
      ctx.fillRect(x, h * 0.3, post, h * 0.05);
    }

    /* 横梁 */
    const beam = { x: w * 0.02, y: h * 0.3, w: w * 0.96, h: h * 0.135 };
    const bg = ctx.createLinearGradient(0, beam.y, 0, beam.y + beam.h);
    bg.addColorStop(0, '#454b54');
    bg.addColorStop(1, '#25292f');
    ctx.fillStyle = bg;
    ctx.fillRect(beam.x, beam.y, beam.w, beam.h);
    ctx.fillStyle = '#ff7a2f';
    ctx.fillRect(beam.x, beam.y + beam.h - h * 0.016, beam.w, h * 0.016);

    ctx.fillStyle = '#f4f7fa';
    ctx.font = '800 ' + Math.round(h * 0.1) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', w * 0.5, beam.y + beam.h * 0.46);

    /* 计时线方格旗横幅 */
    const by = h * 0.44;
    const bh = h * 0.115;
    const bw = h * 0.115;
    const count = Math.floor((w * 0.86) / bw);
    const startX = (w - count * bw) / 2;
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#f4f7fa' : '#1a1d22';
        ctx.fillRect(startX + i * bw, by + j * (bh / 2), bw, bh / 2);
      }
    }
  }

  /* ── 赛车（车尾视角） ── */

  function drawCar(ctx, w, h, body, stripe, braking) {
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.95, w * 0.44, h * 0.07, 0, 0, TAU);
    ctx.fill();

    /* 轮胎 */
    ctx.fillStyle = '#111318';
    roundRect(ctx, w * 0.02, h * 0.58, w * 0.19, h * 0.38, w * 0.03);
    ctx.fill();
    roundRect(ctx, w * 0.79, h * 0.58, w * 0.19, h * 0.38, w * 0.03);
    ctx.fill();

    /* 驾驶舱 */
    ctx.beginPath();
    ctx.moveTo(w * 0.27, h * 0.47);
    ctx.lineTo(w * 0.34, h * 0.15);
    ctx.lineTo(w * 0.66, h * 0.15);
    ctx.lineTo(w * 0.73, h * 0.47);
    ctx.closePath();
    ctx.fillStyle = shade(body, -0.35);
    ctx.fill();

    /* 后窗 */
    ctx.beginPath();
    ctx.moveTo(w * 0.34, h * 0.44);
    ctx.lineTo(w * 0.39, h * 0.19);
    ctx.lineTo(w * 0.61, h * 0.19);
    ctx.lineTo(w * 0.66, h * 0.44);
    ctx.closePath();
    const gl = ctx.createLinearGradient(0, h * 0.16, 0, h * 0.47);
    gl.addColorStop(0, '#46688a');
    gl.addColorStop(0.55, '#24384c');
    gl.addColorStop(1, '#131d27');
    ctx.fillStyle = gl;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.4, h * 0.42);
    ctx.lineTo(w * 0.44, h * 0.22);
    ctx.lineTo(w * 0.52, h * 0.22);
    ctx.lineTo(w * 0.46, h * 0.42);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fill();

    /* 车身 */
    ctx.beginPath();
    ctx.moveTo(w * 0.16, h * 0.95);
    ctx.lineTo(w * 0.18, h * 0.58);
    ctx.quadraticCurveTo(w * 0.19, h * 0.46, w * 0.3, h * 0.44);
    ctx.lineTo(w * 0.7, h * 0.44);
    ctx.quadraticCurveTo(w * 0.81, h * 0.46, w * 0.82, h * 0.58);
    ctx.lineTo(w * 0.84, h * 0.95);
    ctx.closePath();
    const bg = ctx.createLinearGradient(0, h * 0.4, 0, h);
    bg.addColorStop(0, shade(body, 0.34));
    bg.addColorStop(0.5, body);
    bg.addColorStop(1, shade(body, -0.42));
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = w * 0.035;
    ctx.strokeStyle = bg;
    ctx.stroke();

    /* 尾翼 */
    ctx.fillStyle = shade(body, -0.5);
    ctx.fillRect(w * 0.26, h * 0.36, w * 0.05, h * 0.1);
    ctx.fillRect(w * 0.69, h * 0.36, w * 0.05, h * 0.1);
    roundRect(ctx, w * 0.17, h * 0.28, w * 0.66, h * 0.085, w * 0.02);
    ctx.fill();

    /* 尾灯 */
    const brake = !!braking;
    ctx.save();
    ctx.shadowColor = brake ? 'rgba(255,70,58,.95)' : 'rgba(255,70,58,.4)';
    ctx.shadowBlur = brake ? w * 0.16 : w * 0.07;
    ctx.fillStyle = brake ? '#ff3b30' : '#c02a26';
    roundRect(ctx, w * 0.22, h * 0.6, w * 0.21, h * 0.095, w * 0.02);
    ctx.fill();
    roundRect(ctx, w * 0.57, h * 0.6, w * 0.21, h * 0.095, w * 0.02);
    ctx.fill();
    ctx.restore();

    /* 保险杠与扩散器 */
    ctx.fillStyle = 'rgba(6,8,12,.55)';
    roundRect(ctx, w * 0.21, h * 0.75, w * 0.58, h * 0.16, w * 0.02);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    for (let i = 0; i < 4; i++) ctx.fillRect(w * (0.28 + i * 0.12), h * 0.79, w * 0.03, h * 0.09);

    /* 涂装条纹与号码牌 */
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = stripe;
    ctx.fillRect(w * 0.46, h * 0.44, w * 0.055, h * 0.5);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    roundRect(ctx, w * 0.42, h * 0.86, w * 0.14, h * 0.085, w * 0.015);
    ctx.fill();
  }

  /* ── 对外接口 ── */

  function buildSprite(kind) {
    const size = SIZES[kind];
    const sheet = ctxOf(size[0], size[1]);
    const ctx = sheet.ctx;
    const w = size[0];
    const h = size[1];

    switch (kind) {
      case 'pine1': drawPine(ctx, w, h, ['#1f5133', '#2d6d46', '#143322']); break;
      case 'pine2': drawPine(ctx, w, h, ['#1b472d', '#275e3d', '#122d1f']); break;
      case 'birch': drawBirch(ctx, w, h); break;
      case 'bush': drawBush(ctx, w, h); break;
      case 'rock1': drawRock(ctx, w, h); break;
      case 'rock2': drawRock(ctx, w, h); break;
      case 'cone': drawCone(ctx, w, h); break;
      case 'boardChevron': drawBoardChevron(ctx, w, h); break;
      case 'boardTurbo': drawBoardText(ctx, w, h, 'TURBO', '#ffd166'); break;
      case 'boardDrift': drawBoardText(ctx, w, h, 'DRIFT', '#5cc8ff'); break;
      case 'gantry': drawGantry(ctx, w, h); break;
      default: break;
    }
    return sheet.canvas;
  }

  function init() {
    if (ready) return;
    Object.keys(SIZES).forEach((kind) => {
      cache[kind] = buildSprite(kind);
    });
    ready = true;
  }

  function car(index, braking) {
    const i = ((index % CAR_PALETTE.length) + CAR_PALETTE.length) % CAR_PALETTE.length;
    const key = i + (braking ? '-b' : '');
    if (!carCache[key]) {
      const sheet = ctxOf(CAR_SIZE[0], CAR_SIZE[1]);
      drawCar(sheet.ctx, CAR_SIZE[0], CAR_SIZE[1], CAR_PALETTE[i].body, CAR_PALETTE[i].stripe, braking);
      carCache[key] = sheet.canvas;
    }
    return carCache[key];
  }

  global.Sprites = {
    init: init,
    get(kind) {
      if (!ready) init();
      return cache[kind] || cache.pine1;
    },
    car: car,
    carColor(index) {
      return CAR_PALETTE[((index % CAR_PALETTE.length) + CAR_PALETTE.length) % CAR_PALETTE.length].body;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);