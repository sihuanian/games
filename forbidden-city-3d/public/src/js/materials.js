/**
 * 材质库与观察方式管理
 * ---------------------------------------------------------------
 * mat 对象由 initMaterials() 填充；所有网格在构建时会带上
 * userData.baseMat / userData.role / userData.roofKey，
 * 观察方式切换时由 RenderModes 统一改写材质，避免为每个网格预建四套材质。
 */

import * as THREE from 'three';
import * as TEX from './textures.js';

/** 材质实例集合，模块内共享 */
export const mat = {};

/* ------------------------------------------------ 屋顶形制分类色板（图谱） */

export const ROOF_TYPES = {
  hd2: { label: '重檐庑殿顶', color: '#d9a63c', note: '屋面四坡，重檐两层，等级最高' },
  hx2: { label: '重檐歇山顶', color: '#c0623a', note: '四坡加山花，重檐两层' },
  hx1: { label: '单檐歇山顶', color: '#5f8f5a', note: '四坡加山花，单檐一层' },
  zj1: { label: '单檐攒尖顶', color: '#3f8296', note: '四面聚于一点，上置宝顶' },
  sz3: { label: '三重檐十字脊', color: '#7a6aa8', note: '角楼形制，两向歇山交安十字脊' },
  sub: { label: '叠落与廊庑', color: '#8b8578', note: '两翼廊庑、配殿、院落门' },
};

const CLAY = new THREE.MeshStandardMaterial({
  color: 0xe4dfd3,
  roughness: 0.72,
  metalness: 0.0,
  envMapIntensity: 0.5,
});

const TYPE_NEUTRAL = new THREE.MeshStandardMaterial({
  color: 0xd8d4ca,
  roughness: 0.8,
  metalness: 0.0,
  envMapIntensity: 0.4,
});

const WIRE_COLORS = {
  roof: 0xd9a63c,
  body: 0xa5352a,
  terrace: 0xcfc9bb,
  other: 0x6f7a72,
};

/** 匾额：黑底金字横匾 */
export function plaqueMaterial(name) {
  const W = 512;
  const H = 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#152238';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  ctx.fillStyle = '#f0cd7d';
  ctx.font = `600 ${name.length > 3 ? 74 : 86}px "Songti SC","Noto Serif SC",serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, W / 2, H / 2 + 4);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    map: t,
    roughness: 0.42,
    metalness: 0.18,
    envMapIntensity: 1.0,
  });
}

/* --------------------------------------------------------------- 初始化 */

export function initMaterials() {
  const roof = TEX.glazedRoof(1);
  const eave = TEX.glazedEave(1);
  const stone = TEX.marble(2);
  const pave = TEX.paving(2.4);
  const wall = TEX.redWall(3);
  const brick = TEX.greyBrick(1.6);
  const window = TEX.lattice(1.4);
  const door = TEX.studdedDoor(3);
  const paint = TEX.caihua(2.4);
  const leaf = TEX.foliage(2);
  const water = TEX.waterNormal(30);

  mat.roof = new THREE.MeshStandardMaterial({
    map: roof.map,
    normalMap: roof.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    color: 0xffffff,
    roughness: 0.34,
    metalness: 0.06,
    envMapIntensity: 1.0,
  });

  mat.roofRidge = new THREE.MeshStandardMaterial({
    map: roof.map,
    normalMap: roof.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    color: 0xdfc07a,
    roughness: 0.3,
    metalness: 0.12,
    envMapIntensity: 1.05,
  });

  mat.eave = new THREE.MeshStandardMaterial({
    map: eave.map,
    color: 0xffffff,
    roughness: 0.36,
    metalness: 0.05,
    side: THREE.DoubleSide,
    envMapIntensity: 1.0,
  });

  // 檐下阴影板：屋面内面的暗部，避免从下方看到漏光的亮面
  mat.soffit = new THREE.MeshStandardMaterial({
    color: 0x3a2a1c,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    envMapIntensity: 0.2,
  });

  mat.marble = new THREE.MeshStandardMaterial({
    map: stone.map,
    normalMap: stone.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.0,
    envMapIntensity: 0.75,
  });

  mat.paving = new THREE.MeshStandardMaterial({
    map: pave.map,
    normalMap: pave.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.4,
  });

  mat.wall = new THREE.MeshStandardMaterial({
    map: wall.map,
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.0,
    envMapIntensity: 0.42,
  });

  mat.brick = new THREE.MeshStandardMaterial({
    map: brick.map,
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.0,
    envMapIntensity: 0.4,
  });

  mat.lattice = new THREE.MeshStandardMaterial({
    map: window.map,
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.02,
    envMapIntensity: 0.5,
  });

  mat.door = new THREE.MeshStandardMaterial({
    map: door.map,
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.1,
    envMapIntensity: 0.7,
  });

  mat.caihua = new THREE.MeshStandardMaterial({
    map: paint.map,
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.06,
    envMapIntensity: 0.7,
  });

  mat.column = new THREE.MeshStandardMaterial({
    color: 0x8f2f24,
    roughness: 0.46,
    metalness: 0.02,
    envMapIntensity: 0.6,
  });

  mat.beam = new THREE.MeshStandardMaterial({
    color: 0x24564f,
    roughness: 0.6,
    metalness: 0.02,
    envMapIntensity: 0.5,
  });

  mat.gold = new THREE.MeshStandardMaterial({
    color: 0xcfa53f,
    roughness: 0.26,
    metalness: 1.0,
    envMapIntensity: 1.5,
  });

  mat.foliage = new THREE.MeshStandardMaterial({
    map: leaf.map,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: true,
    envMapIntensity: 0.35,
  });

  mat.trunk = new THREE.MeshStandardMaterial({
    color: 0x4a3a2a,
    roughness: 0.95,
    metalness: 0.0,
  });

  mat.water = new THREE.MeshStandardMaterial({
    color: 0x1c2b31,
    roughness: 0.06,
    metalness: 0.0,
    normalMap: water.normalMap,
    normalScale: new THREE.Vector2(0.22, 0.22),
    envMapIntensity: 1.6,
  });
  mat.water.normalMap.repeat.set(1, 1);

  mat.ground = new THREE.MeshStandardMaterial({
    color: 0x4a4436,
    roughness: 0.95,
    metalness: 0.0,
    envMapIntensity: 0.35,
  });

  mat.bark = mat.trunk;

  return {
    textures: { roof, eave, stone, pave, wall, window, door, paint, leaf, water },
    dispose() {
      for (const [key, m] of Object.entries(mat)) {
        if (m.map && m.map.dispose) m.map.dispose();
        if (m.normalMap && m.normalMap.dispose) m.normalMap.dispose();
        m.dispose();
        delete mat[key];
      }
      CLAY.dispose();
      TYPE_NEUTRAL.dispose();
    },
  };
}

/* ------------------------------------------------------- 观察方式控制器 */

export class RenderModes {
  constructor() {
    this.mode = 'render';
    this._clay = CLAY;
    this._neutral = TYPE_NEUTRAL;
    this._wire = {};
    for (const [k, v] of Object.entries(WIRE_COLORS)) {
      this._wire[k] = new THREE.MeshBasicMaterial({
        color: v,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
    }
    this._type = {};
    for (const [k, v] of Object.entries(ROOF_TYPES)) {
      this._type[k] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(v.color),
        roughness: 0.62,
        metalness: 0.03,
        envMapIntensity: 0.6,
      });
    }
  }

  /** 为单个网格登记基础材质与语义角色 */
  static tag(mesh, { role = 'other', roofKey = 'sub', shadow = true } = {}) {
    mesh.userData.baseMat = mesh.material;
    mesh.userData.role = role;
    mesh.userData.roofKey = roofKey;
    if (shadow) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    return mesh;
  }

  set(mode, root) {
    if (mode === this.mode && !root) return;
    this.mode = mode;
    if (!root) return;

    root.traverse((o) => {
      if (!o.isMesh || !o.userData.baseMat) return;
      const role = o.userData.role || 'other';
      if (mode === 'render') {
        o.material = o.userData.baseMat;
      } else if (mode === 'clay') {
        o.material = this._clay;
      } else if (mode === 'wire') {
        o.material = this._wire[role] || this._wire.other;
      } else if (mode === 'type') {
        o.material = role === 'roof'
          ? (this._type[o.userData.roofKey] || this._type.sub)
          : this._neutral;
      }
    });
  }
}