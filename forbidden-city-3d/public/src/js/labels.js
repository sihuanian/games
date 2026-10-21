/**
 * 三维标注层
 * ---------------------------------------------------------------
 * 不使用额外的 DOM 渲染器，直接把世界坐标投影到屏幕，
 * 用绝对定位的 DOM 呈现汉字标注（在中文排版上比 canvas 精灵更清晰）。
 * 附带简单的避让：距离更近者优先占位，重叠的标注自动隐去。
 */

import * as THREE from 'three';

const tmp = new THREE.Vector3();

export class LabelLayer {
  /**
   * @param {HTMLElement} container 标注层容器
   * @param {HTMLCanvasElement} canvas 三维视图画布（用于取尺寸）
   */
  constructor(container, canvas) {
    this.container = container;
    this.canvas = canvas;
    this.items = [];
    this.nodes = new Map();
    this.visible = true;
    this.activeId = null;
    this.focus = null;           // 当前关注点的世界坐标，用于计算距离排序
    this._minGap = 26;           // 两个标注之间的最小屏幕间距（px）
    this._placed = [];
  }

  /**
   * @param {Array<{id:string,name:string,roofLabel?:string,position:THREE.Vector3,kind?:string,maxDist?:number}>} items
   */
  setItems(items) {
    this.items = items;
    this.container.replaceChildren();
    this.nodes.clear();
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'mark';
      const pill = document.createElement('div');
      pill.className = 'mark__pill';
      const name = document.createElement('span');
      name.className = 'mark__name';
      name.textContent = it.name;
      pill.appendChild(name);
      if (it.roofLabel) {
        const type = document.createElement('span');
        type.className = 'mark__type';
        type.textContent = it.roofLabel;
        pill.appendChild(type);
      }
      const tick = document.createElement('span');
      tick.className = 'mark__tick';
      el.append(pill, tick);
      this.container.appendChild(el);
      this.nodes.set(it.id, el);
    }
  }

  setVisible(v) {
    this.visible = v;
    this.container.style.display = v ? '' : 'none';
  }

  setActive(id) {
    this.activeId = id;
    for (const [key, el] of this.nodes) {
      el.classList.toggle('is-active', key === id);
    }
  }

  /** 每帧调用：更新投影位置、远近表现与避让 */
  update(camera) {
    if (!this.visible) return;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this._placed.length = 0;

    const projected = [];
    for (const it of this.items) {
      const el = this.nodes.get(it.id);
      if (!el) continue;

      tmp.copy(it.position).project(camera);
      const behind = tmp.z > 1;
      const x = (tmp.x * 0.5 + 0.5) * rect.width;
      const y = (-tmp.y * 0.5 + 0.5) * rect.height;

      const dist = camera.position.distanceTo(it.position);
      const maxDist = it.maxDist || 1200;
      // 距离越远越淡，超出上限则隐藏
      const fade = THREE.MathUtils.clamp(1 - (dist - maxDist * 0.55) / (maxDist * 0.45), 0, 1);

      projected.push({ it, el, x, y, dist, fade, behind });
    }

    // 近者优先占位
    projected.sort((a, b) => a.dist - b.dist);

    for (const p of projected) {
      let show = !p.behind && p.fade > 0.06;

      if (show) {
        const half = p.el.offsetWidth * 0.5 || 40;
        for (const q of this._placed) {
          if (Math.abs(p.x - q.x) < half + q.half && Math.abs(p.y - q.y) < this._minGap) {
            show = false;
            break;
          }
        }
      }

      if (!show) {
        p.el.style.opacity = '0';
        p.el.style.visibility = 'hidden';
        continue;
      }

      p.el.style.visibility = 'visible';
      p.el.style.opacity = String(p.fade);
      p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      this._placed.push({ x: p.x, y: p.y, half: (p.el.offsetWidth * 0.5) || 40 });
    }

    for (const [key, el] of this.nodes) {
      el.classList.toggle('is-dim', this.activeId !== null && key !== this.activeId);
    }
  }
}