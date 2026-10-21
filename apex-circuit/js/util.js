/* 通用数学、投影与格式化工具。
   不依赖 DOM，浏览器与离线仿真脚本共用。 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  const Util = {
    limit(value, min, max) {
      return Math.max(min, Math.min(value, max));
    },

    interpolate(a, b, percent) {
      return a + (b - a) * percent;
    },

    easeIn(a, b, percent) {
      return a + (b - a) * Math.pow(percent, 2);
    },

    easeOut(a, b, percent) {
      return a + (b - a) * (1 - Math.pow(1 - percent, 2));
    },

    easeInOut(a, b, percent) {
      return a + (b - a) * ((-Math.cos(percent * Math.PI) / 2) + 0.5);
    },

    percentRemaining(n, total) {
      return (n % total) / total;
    },

    accelerate(v, accel, dt) {
      return v + accel * dt;
    },

    /* 把 position 限制在 [0,max) 区间内循环前进 */
    increase(start, increment, max) {
      let result = start + increment;
      while (result >= max) result -= max;
      while (result < 0) result += max;
      return result;
    },

    /* 两个一维区间（中心点 + 宽度）是否重叠 */
    overlap(x1, w1, x2, w2, percent) {
      const half = (percent || 1) / 2;
      const min1 = x1 - w1 * half;
      const max1 = x1 + w1 * half;
      const min2 = x2 - w2 * half;
      const max2 = x2 + w2 * half;
      return max1 > min2 && min1 < max2;
    },

    exponentialFog(distance, density) {
      return 1 / Math.pow(Math.E, distance * distance * density);
    },

    /* 世界坐标 → 相机坐标 → 屏幕坐标 */
    project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth, centerY) {
      const cy = centerY === undefined ? height / 2 : centerY;
      p.camera.x = (p.world.x || 0) - cameraX;
      p.camera.y = (p.world.y || 0) - cameraY;
      p.camera.z = (p.world.z || 0) - cameraZ;
      p.screen.scale = cameraDepth / p.camera.z;
      p.screen.x = Math.round(width / 2 + (p.screen.scale * p.camera.x * width) / 2);
      p.screen.y = Math.round(cy - (p.screen.scale * p.camera.y * height) / 2);
      p.screen.w = Math.round((p.screen.scale * roadWidth * width) / 2);
    },

    /* 秒 → m:ss.mmm */
    formatTime(seconds) {
      if (seconds === null || seconds === undefined || !isFinite(seconds)) return '--:--.---';
      const sign = seconds < 0 ? '-' : '';
      const t = Math.abs(seconds);
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      const ms = Math.floor((t % 1) * 1000);
      return sign + m + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
    },

    /* 秒 → +0.412 / -0.412 */
    formatDelta(seconds) {
      if (seconds === null || seconds === undefined || !isFinite(seconds)) return '—';
      return (seconds >= 0 ? '+' : '-') + Math.abs(seconds).toFixed(3);
    },

    /* 可复现随机数：同一条赛道每次生成结果一致 */
    mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    randomChoice(rand, options) {
      return options[Math.floor(rand() * options.length) % options.length];
    },

    TAU: TAU,
  };

  global.Util = Util;
})(typeof window !== 'undefined' ? window : globalThis);