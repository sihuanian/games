/**
 * 界面层：轴线导航、形制详情、观察方式、图层、日照时刻、图例、提示
 * ---------------------------------------------------------------
 * 所有重复内容（轴线各站、图例）都由数据渲染，不散落地写在标记里。
 */

import { STOPS, STOP_BY_ID, ROOF_LABEL } from './data.js';
import { ROOF_TYPES } from './materials.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};

export function createUI(handlers) {
  const railList = document.getElementById('railList');
  const detail = document.getElementById('detail');
  const tooltip = document.getElementById('tooltip');
  const controls = document.getElementById('controls');
  const controlsHandle = document.getElementById('controlsHandle');
  const modeGroup = document.getElementById('modeGroup');
  const layerGroup = document.getElementById('layerGroup');
  const timeSlider = document.getElementById('timeSlider');
  const timeValue = document.getElementById('timeValue');
  const tourBtn = document.getElementById('tourBtn');
  const resetBtn = document.getElementById('resetBtn');
  const legend = document.getElementById('legend');
  const legendList = document.getElementById('legendList');
  const liveRegion = document.getElementById('liveRegion');

  const railButtons = new Map();

  /* ---------------------------------------------------------- 轴线导航 */

  const railEntries = [
    STOPS.find((s) => s.id === 'overview'),
    ...STOPS.filter((s) => s.index),
    ...STOPS.filter((s) => !s.index && s.kind !== 'overview'),
  ].filter(Boolean);

  for (const stop of railEntries) {
    const li = el('li');
    const btn = el('button', 'stop' + (stop.special || stop.kind === 'overview' ? ' stop--special' : ''));
    btn.type = 'button';
    btn.dataset.id = stop.id;
    btn.setAttribute('aria-current', 'false');

    const idx = el('span', 'stop__index', stop.kind === 'overview' ? '全' : stop.special ? '特' : String(stop.index).padStart(2, '0'));
    const body = el('span', 'stop__body');
    body.append(
      el('span', 'stop__name', stop.name),
      el('span', 'stop__type', stop.roof ? stop.roof : (stop.kind === 'overview' ? '南 → 北' : ''))
    );
    btn.append(idx, body);
    btn.addEventListener('click', () => handlers.onSelect(stop.id));
    li.append(btn);
    railList.append(li);
    railButtons.set(stop.id, btn);
  }

  /* ---------------------------------------------------------- 观察方式 */

  const modeButtons = new Map();
  for (const btn of modeGroup.querySelectorAll('button')) {
    modeButtons.set(btn.dataset.mode, btn);
    btn.addEventListener('click', () => handlers.onMode(btn.dataset.mode));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const keys = [...modeButtons.keys()];
      const i = keys.indexOf(btn.dataset.mode);
      const next = keys[(i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
      handlers.onMode(next);
      modeButtons.get(next).focus();
    });
  }

  /* ---------------------------------------------------------- 图层 */

  for (const input of layerGroup.querySelectorAll('input[data-layer]')) {
    input.addEventListener('change', () => handlers.onLayer(input.dataset.layer, input.checked));
  }

  /* ---------------------------------------------------------- 日照时刻 */

  timeSlider.addEventListener('input', () => handlers.onTime(Number(timeSlider.value)));

  /* ---------------------------------------------------------- 动作 */

  tourBtn.addEventListener('click', () => handlers.onTour());
  resetBtn.addEventListener('click', () => handlers.onSelect('overview'));

  if (controlsHandle) {
    controlsHandle.addEventListener('click', () => {
      const open = controls.dataset.open === 'true';
      controls.dataset.open = open ? 'false' : 'true';
      controlsHandle.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  }

  /* ---------------------------------------------------------- 详情面板 */

  function renderDetail(stop) {
    detail.replaceChildren();
    const close = el('button', 'detail__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭详情');
    close.addEventListener('click', () => handlers.onClose());
    detail.append(close);

    detail.append(el('span', 'detail__kicker', stop.kicker || ''));

    const h = el('h2', 'detail__title', stop.name);
    h.id = 'detailTitle';
    detail.append(h);
    if (stop.alias && stop.alias !== stop.name) {
      detail.append(el('p', 'detail__sub', stop.alias));
    }
    if (stop.sub) {
      detail.append(el('p', 'detail__sub', stop.sub));
    }

    if (stop.roof) {
      const chip = el('span', 'detail__roof');
      const sw = el('i');
      const t = ROOF_TYPES[stop.roofKey];
      sw.style.setProperty('--swatch', t ? t.color : '#d9a63c');
      chip.append(sw, document.createTextNode(stop.roof));
      detail.append(chip);
    }

    if (stop.facts && stop.facts.length) {
      const grid = el('div', 'detail__facts');
      stop.facts.forEach(([k, v], i) => {
        const wide = i === stop.facts.length - 1 && stop.facts.length % 2 === 1;
        const f = el('div', 'fact' + (wide ? ' fact--wide' : ''));
        f.append(el('span', 'fact__k', k), el('span', 'fact__v', v));
        grid.append(f);
      });
      detail.append(grid);
    }

    if (stop.role) {
      const f = el('div', 'detail__facts');
      const item = el('div', 'fact fact--wide');
      item.append(el('span', 'fact__k', '功能'), el('span', 'fact__v', stop.role));
      f.append(item);
      detail.append(f);
    }

    if (stop.note) {
      detail.append(el('p', 'detail__note', stop.note));
    }

    if (stop.pending && stop.pending.length) {
      const w = el('p', 'detail__src');
      w.textContent = `待核：${stop.pending.join('；')}`;
      detail.append(w);
    }

    const src = el('p', 'detail__src');
    src.textContent = '形制与尺寸以故宫博物院官网各建筑条目为主要依据；三维模型为程序化重建，建筑体量经过简化，非测绘数据。';
    detail.append(src);
  }

  /* ---------------------------------------------------------- 图例 */

  function renderLegend(counts) {
    legendList.replaceChildren();
    for (const [key, meta] of Object.entries(ROOF_TYPES)) {
      const n = counts.get(key) || 0;
      if (n === 0) continue;
      const li = el('li');
      const sw = el('span', 'legend__swatch');
      sw.style.background = meta.color;
      li.append(sw, el('span', null, meta.label), el('span', 'legend__count', String(n)));
      legendList.append(li);
    }
  }

  /* ---------------------------------------------------------- 对外接口 */

  return {
    railEntries,

    setActive(id) {
      for (const [key, btn] of railButtons) {
        const on = key === id;
        btn.setAttribute('aria-current', on ? 'true' : 'false');
      }
      const btn = railButtons.get(id);
      if (btn && btn.scrollIntoView) {
        btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
    },

    showDetail(stop) {
      renderDetail(stop);
      detail.hidden = false;
    },

    hideDetail() {
      detail.hidden = true;
      detail.replaceChildren();
    },

    setMode(mode) {
      for (const [key, btn] of modeButtons) {
        btn.setAttribute('aria-checked', key === mode ? 'true' : 'false');
      }
      legend.hidden = mode !== 'type';
    },

    setTime(hour, text) {
      timeSlider.value = String(hour);
      timeValue.textContent = text;
      timeSlider.setAttribute('aria-valuetext', text);
    },

    setTour(active) {
      tourBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      tourBtn.textContent = active ? '停止巡游' : '轴线巡游';
    },

    showLegend(counts) {
      renderLegend(counts);
    },

    showTooltip(x, y, name, roofLabel) {
      tooltip.replaceChildren();
      const b = el('b', null, name);
      tooltip.append(b);
      if (roofLabel) tooltip.append(document.createTextNode(` · ${roofLabel}`));
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
      tooltip.hidden = false;
    },

    hideTooltip() {
      tooltip.hidden = true;
    },

    announce(msg) {
      liveRegion.textContent = msg;
    },

    get stopById() {
      return STOP_BY_ID;
    },

    ROOF_LABEL,
  };
}