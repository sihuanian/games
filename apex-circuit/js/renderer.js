/* 渲染器：伪 3D 投影绘制天空、远山、路面、路边物与赛车。
   drawDistance 段由近及远逐步抬高遮挡线（maxy），避免远处重复覆盖。 */
(function (global) {
  'use strict';

  const Util = global.Util;
  const Track = global.Track;
  const Sprites = global.Sprites;

  const DRAW_DISTANCE = 300;
  const FOG_DENSITY = 5;
  const BASE_FOV = 100;
  const BASE_CAMERA_DEPTH = 1 / Math.tan(((BASE_FOV / 2) * Math.PI) / 180);
  const CAMERA_HEIGHT = 1000;
  const PLAYER_Z = CAMERA_HEIGHT * BASE_CAMERA_DEPTH;
  const FOG_COLOR = '#8b5a4e';

  const SKY_STOPS = [
    [0.00, '#070a15'],
    [0.28, '#1b2045'],
    [0.52, '#492f5c'],
    [0.72, '#9c4155'],
    [0.87, '#d9704b'],
    [1.00, '#8b5a4e'],
  ];

  const RIDGE_FAR_COLOR = '#4a3d63';
  const RIDGE_NEAR_COLOR = '#2b2440';

  function create(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });

    let width = 0;
    let height = 0;
    let dpr = 1;
    let horizonY = 0;
    let skyGradient = null;
    let dustGradient = null;
    let sun = null;
    let ridgeFar = null;
    let ridgeNear = null;
    let time = 0;
    let lastPosition = 0;

    const skyOffset = { x: 0, y: 0 };
    const hillOffset = { x: 0, y: 0 };

    /* ── 背景资源 ── */

    function buildSky() {
      skyGradient = ctx.createLinearGradient(0, 0, 0, horizonY);
      for (let i = 0; i < SKY_STOPS.length; i++) {
        skyGradient.addColorStop(SKY_STOPS[i][0], SKY_STOPS[i][1]);
      }
    }

    function buildSun() {
      const r = Math.max(38, Math.round(height * 0.125));
      const size = r * 4;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      const cx = size / 2;
      const cy = size / 2;

      const glow = g.createRadialGradient(cx, cy, r * 0.35, cx, cy, r * 2);
      glow.addColorStop(0, 'rgba(255,190,120,0.55)');
      glow.addColorStop(0.45, 'rgba(255,128,80,0.20)');
      glow.addColorStop(1, 'rgba(255,110,70,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, size, size);

      const disc = g.createLinearGradient(0, cy - r, 0, cy + r);
      disc.addColorStop(0, '#ffedb4');
      disc.addColorStop(0.42, '#ffb163');
      disc.addColorStop(1, '#ff6f4a');
      g.fillStyle = disc;
      g.beginPath();
      g.arc(cx, cy, r, 0, Util.TAU);
      g.fill();

      /* 横向切带：合成夕阳的经典分层感 */
      g.globalCompositeOperation = 'destination-out';
      let y = cy + r * 0.16;
      let bandH = r * 0.028;
      while (y < cy + r * 1.02) {
        g.fillRect(cx - r * 1.05, y, r * 2.1, bandH);
        y += bandH * 2.05;
        bandH *= 1.3;
      }
      g.globalCompositeOperation = 'source-over';

      sun = { canvas: c, r: r };
    }

    function makeRidge(seed, count, amp) {
      const rand = Util.mulberry32(seed);
      const pts = [];
      let h = 0.35 + rand() * 0.45;
      for (let i = 0; i <= count; i++) {
        h = Util.limit(h + (rand() - 0.5) * 0.6, 0.08, 1);
        pts.push(h);
      }
      return { pts: pts, amp: amp };
    }

    function drawRidge(ridge, offsetX, offsetY, color) {
      const pts = ridge.pts;
      const n = pts.length - 1;
      const amp = height * ridge.amp;
      const baseY = horizonY + offsetY;
      const o = ((offsetX % 1) + 1) % 1;
      const steps = Math.min(150, Math.max(56, Math.round(width / 11)));

      ctx.beginPath();
      ctx.moveTo(-12, baseY + 12);
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const idx = ((u + o) % 1) * n;
        const i0 = Math.floor(idx);
        const i1 = Math.min(n, i0 + 1);
        const f = idx - i0;
        const v = pts[i0] + (pts[i1] - pts[i0]) * f;
        ctx.lineTo(u * width, baseY - v * amp);
      }
      ctx.lineTo(width + 12, baseY + 12);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    /* ── 尺寸 ── */

    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(global.devicePixelRatio || 1, 2);
      width = Math.max(320, Math.round(rect.width));
      height = Math.max(240, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const aspect = width / height;
      horizonY = Math.round(height * (aspect < 1.25 ? 0.46 : 0.5));

      buildSky();
      buildSun();
      ridgeFar = makeRidge(0x11f3, 46, 0.05);
      ridgeNear = makeRidge(0x2ab7, 32, 0.082);

      dustGradient = ctx.createLinearGradient(0, height * 0.6, 0, height);
      dustGradient.addColorStop(0, 'rgba(126,94,62,0)');
      dustGradient.addColorStop(1, 'rgba(126,94,62,0.38)');
    }

    /* ── 绘制原语 ── */

    function polygon(x1, y1, x2, y2, x3, y3, x4, y4) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.lineTo(x4, y4);
      ctx.closePath();
      ctx.fill();
    }

    function drawSegment(seg) {
      const p1 = seg.p1.screen;
      const p2 = seg.p2.screen;
      const color = seg.color;
      const lanes = Track.LANES;

      const rumbleW1 = p1.w / Math.max(6, 2 * lanes);
      const rumbleW2 = p2.w / Math.max(6, 2 * lanes);
      const laneW1 = p1.w / Math.max(32, 8 * lanes);
      const laneW2 = p2.w / Math.max(32, 8 * lanes);

      ctx.fillStyle = color.grass;
      polygon(0, p1.y, width, p1.y, width, p2.y, 0, p2.y);

      ctx.fillStyle = color.rumble;
      polygon(p1.x - p1.w - rumbleW1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - rumbleW2, p2.y);
      polygon(p1.x + p1.w + rumbleW1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + rumbleW2, p2.y);

      ctx.fillStyle = color.road;
      polygon(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y);

      if (color.lane) {
        ctx.fillStyle = color.lane;
        for (let i = 1; i < lanes; i++) {
          const t = -1 + (2 * i) / lanes;
          const lx1 = p1.x + p1.w * t;
          const lx2 = p2.x + p2.w * t;
          polygon(lx1 - laneW1, p1.y, lx1 + laneW1, p1.y, lx2 + laneW2, p2.y, lx2 - laneW2, p2.y);
        }
      }

      if (seg.fog < 1) {
        ctx.globalAlpha = 1 - seg.fog;
        ctx.fillStyle = FOG_COLOR;
        ctx.fillRect(0, p2.y, width, Math.max(0, p1.y - p2.y));
        ctx.globalAlpha = 1;
      }
    }

    /* 路边物与 AI 车共用同一套投影换算 */
    function drawScaled(seg, image, roadFraction, offset, centered) {
      const p = seg.p1.screen;
      if (seg.fog <= 0.03) return;

      const destW = p.w * roadFraction;
      if (destW < 1) return;
      const destH = destW * (image.height / image.width);
      const destX = centered ? p.x - destW / 2 : p.x + p.w * offset - (offset < 0 ? destW : 0);
      const destY = p.y - destH;

      if (destX > width + 60 || destX + destW < -60) return;
      if (destW > width * 8) return;

      const clipH = seg.clip ? Math.max(0, destY + destH - seg.clip) : 0;
      if (clipH >= destH) return;

      ctx.globalAlpha = seg.fog;
      if (clipH > 0) {
        const sh = image.height * (1 - clipH / destH);
        ctx.drawImage(image, 0, 0, image.width, sh, destX, destY, destW, destH - clipH);
      } else {
        ctx.drawImage(image, destX, destY, destW, destH);
      }
      ctx.globalAlpha = 1;
    }

    function drawPlayerCar(race, speedPercent) {
      const player = race.player;
      const image = Sprites.car(player.colorIndex, player.braking);
      const carH = Util.limit(height * 0.23, 84, 198);
      const carW = carH * (image.width / image.height);
      const bottom = height - Util.limit(height * 0.035, 10, 34);
      const sway = player.visualLean * width * 0.014;
      const bob = Math.sin(time * 21) * (player.offroad ? 2.6 : 0.9) * Util.limit(speedPercent * 1.7, 0.16, 1);
      const lean = -player.visualLean * 0.05;

      ctx.save();
      ctx.translate(width / 2 + sway, bottom - carH / 2 + bob);
      ctx.rotate(lean);
      ctx.drawImage(image, -carW / 2, -carH / 2, carW, carH);
      ctx.restore();
    }

    function drawSpeedLines(speedPercent) {
      if (speedPercent <= 0.55) return;
      const k = Util.limit((speedPercent - 0.55) / 0.45, 0, 1);
      const cx = width / 2;
      const cy = horizonY;
      ctx.strokeStyle = 'rgba(255,238,214,' + (0.05 + k * 0.12).toFixed(3) + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Util.TAU + time * 0.5;
        const seedR = 0.18 + (0.08 * ((i * 37) % 11)) / 11;
        const r0 = width * seedR;
        const r1 = r0 + width * (0.07 + 0.14 * k);
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.62);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.62);
      }
      ctx.stroke();
    }

    /* ── 主渲染 ── */

    function render(race, dt) {
      time += dt;

      const segments = Track.segments;
      const player = race.player;
      const speedPercent = Util.limit(player.speed / global.Race.MAX_SPEED, 0, 1);
      const position = player.position;

      /* 车速拉大视角，靠增加相机高度补偿，保持路面几何稳定 */
      const fov = BASE_FOV + speedPercent * 8;
      const cameraDepth = 1 / Math.tan(((fov / 2) * Math.PI) / 180);
      const cameraHeight = PLAYER_Z / cameraDepth;

      const baseSegment = Track.findSegment(position);
      const basePercent = Util.percentRemaining(position, Track.SEGMENT_LENGTH);
      const playerSegment = Track.findSegment(position + PLAYER_Z);
      const playerPercent = Util.percentRemaining(position + PLAYER_Z, Track.SEGMENT_LENGTH);
      const playerY = Util.interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);

      /* 视差：由「本帧行驶段数 × 当前弯度」累积 */
      let travel = (position - lastPosition) / Track.SEGMENT_LENGTH;
      if (travel > 0.5 * (segments.length)) travel -= segments.length;
      if (travel < -0.5 * (segments.length)) travel += segments.length;
      lastPosition = position;

      skyOffset.x = Util.limit(skyOffset.x + 0.001 * playerSegment.curve * travel, -0.3, 0.3);
      hillOffset.x = Util.limit(hillOffset.x + 0.0026 * playerSegment.curve * travel, -0.4, 0.4);
      skyOffset.y = -playerY * 0.0000022;
      hillOffset.y = -playerY * 0.0000045;

      /* 画面抖动：撞击与冲出赛道 */
      const shake = player.shake + (player.offroad ? Util.limit(speedPercent, 0, 0.6) : 0);
      const shakeAmp = shake * Util.limit(height * 0.016, 4, 18);
      const shakeX = (Math.random() - 0.5) * shakeAmp;
      const shakeY = (Math.random() - 0.5) * shakeAmp * 0.7;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = FOG_COLOR;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(shakeX, shakeY);

      /* 天空 */
      ctx.fillStyle = skyGradient;
      ctx.fillRect(-14, -14, width + 28, horizonY + 14);

      /* 夕阳 + 远山 */
      if (sun) {
        const sunX = width * 0.58 - Util.limit(skyOffset.x, -0.3, 0.3) * width * 1.1;
        const sunY = horizonY - sun.r * 0.5 + skyOffset.y * height;
        ctx.drawImage(sun.canvas, sunX - sun.canvas.width / 2, sunY - sun.canvas.height / 2);
      }
      if (ridgeFar) drawRidge(ridgeFar, hillOffset.x, hillOffset.y * height * 0.5, RIDGE_FAR_COLOR);
      if (ridgeNear) drawRidge(ridgeNear, hillOffset.x * 1.6 + 0.23, hillOffset.y * height * 0.8, RIDGE_NEAR_COLOR);

      /* 路面：由近及远，用 maxy 逐段抬高遮挡线 */
      const roadWidth = Track.ROAD_WIDTH;
      const cameraX = player.playerX * roadWidth;
      const cameraY = playerY + cameraHeight;
      const cameraZ = position;
      const trackLength = race.trackLength;

      let x = 0;
      let dx = -(baseSegment.curve * basePercent);
      let maxy = height + 14;

      for (let n = 0; n < DRAW_DISTANCE; n++) {
        const seg = segments[(baseSegment.index + n) % segments.length];
        seg.looped = seg.index < baseSegment.index;
        seg.fog = Util.exponentialFog(n / DRAW_DISTANCE, FOG_DENSITY);
        seg.clip = maxy;

        const camZ = cameraZ - (seg.looped ? trackLength : 0);
        Util.project(seg.p1, cameraX - x, cameraY, camZ, cameraDepth, width, height, roadWidth, horizonY);
        Util.project(seg.p2, cameraX - x - dx, cameraY, camZ, cameraDepth, width, height, roadWidth, horizonY);

        x += dx;
        dx += seg.curve;

        if (seg.p1.camera.z <= cameraDepth) continue;
        if (seg.p2.screen.y >= seg.p1.screen.y) continue;
        if (seg.p2.screen.y >= maxy) continue;

        drawSegment(seg);
        maxy = seg.p1.screen.y;
      }

      /* 车辆与路边物：由远及近 */
      for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
        const seg = segments[(baseSegment.index + n) % segments.length];

        for (let i = 0; i < seg.cars.length; i++) {
          const car = seg.cars[i];
          drawScaled(seg, Sprites.car(car.colorIndex, car.braking), car.w, car.offset, false);
        }
        for (let i = 0; i < seg.sprites.length; i++) {
          const sprite = seg.sprites[i];
          drawScaled(seg, Sprites.get(sprite.kind), sprite.w, sprite.offset, sprite.centered);
        }
      }

      /* 玩家车（追尾视角固定在画面中下方） */
      drawPlayerCar(race, speedPercent);

      /* 速度线与越野扬尘 */
      drawSpeedLines(speedPercent);
      if (player.offroad && dustGradient) {
        ctx.fillStyle = dustGradient;
        ctx.fillRect(0, height * 0.6, width, height * 0.4);
      }

      ctx.restore();
    }

    resize();

    return {
      resize: resize,
      render: render,
      get width() {
        return width;
      },
      get height() {
        return height;
      },
    };
  }

  global.Renderer = {
    create: create,
    PLAYER_Z: PLAYER_Z,
    BASE_CAMERA_DEPTH: BASE_CAMERA_DEPTH,
  };
})(typeof window !== 'undefined' ? window : globalThis);