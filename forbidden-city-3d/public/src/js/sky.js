/**
 * 天空、日照与光照
 * ---------------------------------------------------------------
 * 以「时刻」为唯一输入变量：
 *   时刻 → 太阳高度角与方位角 → 天空贴图（等距圆柱投影）→ 环境反射 + 平行光 + 雾色。
 * 天空使用内置 MeshBasicMaterial 而非自定义着色器，以便与渲染器的色调映射、
 * 色彩空间处理保持一致。
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;

/** 日出与日落时刻，以及正午最高太阳高度角（近似北京纬度） */
const SUNRISE = 5.0;
const SUNSET = 20.5;
const MAX_ALT = 62 * DEG;

const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;

/** 由时刻推求太阳方向（自原点指向太阳）与相关参数 */
export function sunAt(hour) {
  const t = cl((hour - SUNRISE) / (SUNSET - SUNRISE), 0, 1);
  const alt = Math.sin(Math.PI * t) * MAX_ALT;
  const azS = (0.5 - t) * Math.PI;      // 自正南起算，向东为正
  const dir = new THREE.Vector3(
    Math.cos(alt) * Math.sin(azS),
    Math.sin(alt),
    Math.cos(alt) * Math.cos(azS)
  );
  const k = cl(Math.sin(alt) / Math.sin(MAX_ALT), 0, 1);
  return { t, alt, azS, dir, k, day: alt > 0.02 };
}

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const C = {
  noonTop: hex('#3f74ae'),
  noonHor: hex('#d8e6f2'),
  goldTop: hex('#4a5f8a'),
  goldHor: hex('#e79a4c'),
  nightTop: hex('#0a1120'),
  nightHor: hex('#1d2a42'),
  ground: hex('#2b2823'),
};

function lerp3(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

/** 依太阳高度角给出天空上缘与地平线的颜色 */
function skyPalette(k) {
  if (k <= 0.001) {
    const top = lerp3(C.nightTop, C.goldTop, k * 60);
    const hor = lerp3(C.nightHor, C.goldHor, k * 60);
    return { top, hor };
  }
  if (k < 0.3) {
    const u = k / 0.3;
    return { top: lerp3(C.goldTop, C.noonTop, u), hor: lerp3(C.goldHor, C.noonHor, u) };
  }
  return { top: C.noonTop, hor: C.noonHor };
}

/** 日照色温：低角度偏暖 */
function sunColor(k) {
  const warm = hex('#ff8a3c');
  const white = hex('#fff4e0');
  const t = cl(k / 0.55, 0, 1);
  return lerp3(warm, white, t);
}

export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 160;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.envRT = null;

    scene.background = this.texture;
    scene.backgroundIntensity = 1;

    // 太阳平行光
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -720;
    sc.right = 720;
    sc.top = 720;
    sc.bottom = -720;
    sc.near = 1;
    sc.far = 2600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.9;
    this.sun.target.position.set(0, 0, -30);
    scene.add(this.sun);
    scene.add(this.sun.target);

    // 天光与环境补光
    this.hemi = new THREE.HemisphereLight(0xbcd4ee, 0x4a4234, 0.75);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(this.ambient);

    this.hour = 10;
    this._lastPaintedK = -1;
    this._envTimer = null;
    this.setHour(10, true);
  }

  /** 绘制等距圆柱天空贴图 */
  _paint(k, alt, dir, palette, sun) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const sx = dir.x;
    const sy = dir.y;
    const sz = dir.z;
    const sunBoost = cl(Math.sin(alt), 0, 1);
    const groundMix = cl(0.35 - k, 0, 0.35) / 0.35;

    for (let y = 0; y < H; y++) {
      const el = (0.5 - (y + 0.5) / H) * Math.PI;
      const ce = Math.cos(el);
      const dy = Math.sin(el);
      const up = dy > 0 ? Math.pow(dy, 0.6) : 0;
      for (let x = 0; x < W; x++) {
        const az = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
        const dx = ce * Math.sin(az);
        const dz = ce * Math.cos(az);

        let r;
        let g;
        let b;
        if (dy > 0) {
          r = mix(palette.hor[0], palette.top[0], up);
          g = mix(palette.hor[1], palette.top[1], up);
          b = mix(palette.hor[2], palette.top[2], up);
        } else {
          const dn = Math.pow(-dy, 0.45);
          r = mix(palette.hor[0], C.ground[0], dn);
          g = mix(palette.hor[1], C.ground[1], dn);
          b = mix(palette.hor[2], C.ground[2], dn);
        }
        void groundMix;

        const sd = dx * sx + dy * sy + dz * sz;
        if (sd > 0) {
          const disc = Math.pow(sd, 1800) * 9 * (0.4 + sunBoost);
          const halo = Math.pow(sd, 26) * 0.55 * (0.3 + sunBoost * 0.7);
          const wide = Math.pow(sd, 3.2) * 0.22 * (0.25 + sunBoost * 0.75);
          const amt = disc + halo + wide;
          r += sun[0] * amt;
          g += sun[1] * amt;
          b += sun[2] * amt;
        }

        const i = (y * W + x) * 4;
        d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.texture.needsUpdate = true;
  }

  /**
   * @param {number} hour 5 ~ 20.5
   * @param {boolean} [immediate] 是否立即重建环境反射贴图
   */
  setHour(hour, immediate = false) {
    this.hour = hour;
    const { alt, dir, k } = sunAt(hour);
    const palette = skyPalette(k);
    const sc = sunColor(k);
    this._paint(k, alt, dir, palette, sc);

    // 平行光
    const pos = dir.clone().multiplyScalar(900).add(new THREE.Vector3(0, 0, -30));
    this.sun.position.copy(pos);
    this.sun.color.setRGB(sc[0] / 255, sc[1] / 255, sc[2] / 255);
    const dayI = Math.pow(cl(Math.sin(alt), 0, 1), 0.55);
    this.sun.intensity = alt > 0.005 ? dayI * 3.4 + 0.05 : 0.06;
    this.sun.castShadow = alt > 0.012;

    // 天光与补光
    const hor = palette.hor;
    this.hemi.color.setRGB(hor[0] / 255, hor[1] / 255, hor[2] / 255);
    this.hemi.intensity = 0.14 + k * 0.85;
    this.ambient.intensity = 0.06 + k * 0.14;

    // 雾色随地平线色走，保持远景自然
    if (this.scene.fog) {
      this.scene.fog.color.setRGB(
        (hor[0] * 0.86) / 255,
        (hor[1] * 0.9) / 255,
        (hor[2] * 0.95) / 255
      );
    }
    this.scene.backgroundIntensity = 0.55 + k * 0.6;

    // 环境反射：白天强、夜间弱，按需重建
    if (immediate) {
      this._rebuildEnv();
      this._lastPaintedK = k;
    } else {
      if (this._envTimer) clearTimeout(this._envTimer);
      this._envTimer = setTimeout(() => {
        this._envTimer = null;
        if (Math.abs(k - this._lastPaintedK) > 0.015) this._rebuildEnv();
      }, 160);
    }
  }

  _rebuildEnv() {
    const prev = this.envRT;
    this.envRT = this.pmrem.fromEquirectangular(this.texture);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.35 + Math.abs(this._lastPaintedK) * 0.9;
    if (prev) prev.dispose();
  }

  /** 供界面显示的时刻文本 */
  static formatHour(hour) {
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  dispose() {
    if (this._envTimer) clearTimeout(this._envTimer);
    if (this.envRT) this.envRT.dispose();
    this.pmrem.dispose();
    this.texture.dispose();
  }
}