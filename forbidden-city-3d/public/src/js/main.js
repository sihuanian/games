/**
 * 入口：渲染环境、相机与交互
 * ---------------------------------------------------------------
 * 职责边界：本文件只做「接线」——
 *   1. 检测 WebGL、按步骤推进构建进度；
 *   2. 组装场景（材质 → 城市 → 天空）并驱动渲染循环；
 *   3. 把界面事件翻译成相机运动、图层开关、观察方式切换。
 * 几何、材质、界面各自的实现都在对应模块里。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { createCity } from './city.js';
import { SkySystem } from './sky.js';
import { createUI } from './ui.js';
import { LabelLayer } from './labels.js';
import { initMaterials, RenderModes } from './materials.js';
import { STOPS, STOP_BY_ID, ROOF_LABEL, roofTypeLegend } from './data.js';

const $ = (id) => document.getElementById(id);
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

const MODE_LABEL = { render: '材质效果', clay: '白模', wire: '线框', type: '形制图谱' };
const LAYER_LABEL = { outbuild: '两翼院落', wall: '宫墙角楼', water: '水系', trees: '植被', labels: '形制标注' };

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

/* ============================================================ 启动流程 */

async function start() {
  const canvas = $('viewport');
  const bootEl = $('boot');
  const bootStep = $('bootStep');
  const bootBar = $('bootBar');

  let progress = 0.03;
  const setStep = (msg, value) => {
    bootStep.textContent = msg;
    if (typeof value === 'number') progress = Math.min(0.94, value);
    else progress = Math.min(0.94, progress + 0.07);
    bootBar.style.width = `${Math.round(progress * 100)}%`;
  };

  const fail = (msg) => {
    bootEl.classList.add('is-done');
    const fb = $('fallback');
    if (msg) $('fallbackMsg').textContent = msg;
    fb.hidden = false;
  };

  setStep('检测三维渲染环境…', 0.04);
  if (!webglAvailable()) {
    fail('当前浏览器或设备未能初始化 WebGL 渲染环境。');
    return;
  }

  /* ---------------------------------------------------------- 渲染器 */

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
  } catch (err) {
    console.error('[sandbox] WebGLRenderer 初始化失败', err);
    fail('三维渲染上下文创建失败。');
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  // three r155+ 已移除 PCFSoftShadowMap，这里用 PCF 配合较大的 shadow radius
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  // 雾在建立天空系统之前创建：SkySystem 会按地平线色实时改写雾色
  scene.fog = new THREE.Fog(0x9fb2c6, 760, 4300);

  const camera = new THREE.PerspectiveCamera(
    42,
    (canvas.clientWidth || window.innerWidth) / (canvas.clientHeight || window.innerHeight),
    0.4,
    9000
  );
  camera.position.set(700, 640, 900);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.rotateSpeed = 0.62;
  controls.panSpeed = 0.7;
  controls.zoomSpeed = 0.85;
  controls.minDistance = 24;
  controls.maxDistance = 2800;
  controls.minPolarAngle = 0.06;
  controls.maxPolarAngle = Math.PI * 0.494;   // 不允许穿到地面以下
  controls.target.set(0, 6, -30);
  controls.update();

  /* ---------------------------------------------------------- 材质与城市 */

  setStep('生成琉璃、汉白玉与彩画贴图…', 0.08);
  const materials = initMaterials();
  await raf();

  let city;
  try {
    city = createCity((msg) => setStep(msg));
  } catch (err) {
    console.error('[sandbox] 装配失败', err);
    renderer.dispose();
    materials.dispose();
    fail('沙盘装配过程中出现错误，已停止渲染。');
    return;
  }
  scene.add(city.root);

  setStep('计算日照与天空环境…', 0.9);
  const sky = new SkySystem(scene, renderer);
  sky.setHour(10, true);
  await raf();

  const modes = new RenderModes();
  modes.set('render', city.root);

  /* ---------------------------------------------------------- 界面与标注 */

  const ui = createUI({
    onSelect: (id) => selectStop(id, { fly: true }),
    onMode: setMode,
    onLayer: setLayer,
    onTime: setHour,
    onTour: toggleTour,
    onClose: clearSelection,
  });

  const labels = new LabelLayer($('labelLayer'), canvas);
  labels.setItems(
    [...city.stops.values()].map((s) => {
      const data = STOP_BY_ID[s.id];
      return {
        id: s.id,
        name: data ? data.name : s.id,
        roofLabel: data && data.roof ? ROOF_LABEL[data.roofKey] : '',
        position: s.anchor.clone(),
        maxDist: s.size > 200 ? 2600 : 1500,
      };
    })
  );

  const legendIds = [...STOPS.filter((s) => s.index).map((s) => s.id), 'jiaolou'];
  const legendCounts = roofTypeLegend(legendIds);
  ui.showLegend(legendCounts);
  ui.setMode('render');
  setHour(10);

  /* ---------------------------------------------------------- 拾取 */

  const pickList = city.pickList;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const appEl = $('app');

  let pointerX = 0;
  let pointerY = 0;
  let pointerDirty = false;
  let dragging = false;
  let hoverId = null;
  let pressInfo = null;

  const isOnScreen = (obj) => {
    let o = obj;
    while (o) {
      if (o.visible === false) return false;
      o = o.parent;
    }
    return true;
  };

  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickList, false);
    for (const hit of hits) {
      if (isOnScreen(hit.object)) return hit.object.userData.stopId || null;
    }
    return null;
  }

  function refreshHover() {
    const id = dragging ? null : pickAt(pointerX, pointerY);
    if (id === hoverId) {
      if (id) placeTooltip(id);
      return;
    }
    hoverId = id;
    canvas.classList.toggle('is-hot', !!id);
    if (!id) {
      ui.hideTooltip();
      return;
    }
    placeTooltip(id);
  }

  function placeTooltip(id) {
    const data = STOP_BY_ID[id];
    if (!data) return;
    const rect = appEl.getBoundingClientRect();
    ui.showTooltip(pointerX - rect.left, pointerY - rect.top, data.name, data.roof || '');
  }

  canvas.addEventListener('pointermove', (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    pointerDirty = true;
  });

  canvas.addEventListener('pointerleave', () => {
    pointerDirty = false;
    hoverId = null;
    canvas.classList.remove('is-hot');
    ui.hideTooltip();
  });

  canvas.addEventListener('pointerdown', (e) => {
    pressInfo = { x: e.clientX, y: e.clientY, t: performance.now() };
  });

  canvas.addEventListener('pointerup', (e) => {
    const p = pressInfo;
    pressInfo = null;
    if (!p) return;
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (moved > 6 || performance.now() - p.t > 700) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id) selectStop(id, { fly: true });
  });

  controls.addEventListener('start', () => {
    dragging = true;
    flight = null;
    if (tour.active) stopTour();
  });
  controls.addEventListener('end', () => {
    dragging = false;
    pointerDirty = true;
  });

  /* ---------------------------------------------------------- 相机运动 */

  let flight = null;
  let activeId = 'overview';

  function viewFor(id) {
    if (id === 'overview') return city.overview;
    return city.stops.get(id) || null;
  }

  function flyTo(view) {
    if (!view) return;
    if (reduceMotion) {
      camera.position.copy(view.position);
      controls.target.copy(view.target);
      controls.update();
      flight = null;
      return;
    }
    flight = {
      p0: camera.position.clone(),
      p1: view.position.clone(),
      t0: controls.target.clone(),
      t1: view.target.clone(),
      start: performance.now(),
      dur: 1150,
    };
  }

  function updateFlight(now) {
    if (!flight) return;
    // 时间戳可能回退（标签页后台恢复等），必须同时钳住上下界，
    // 否则负的 t 会把相机插值到极远处
    const raw = (now - flight.start) / flight.dur;
    const t = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    if (t >= 1) flight = null;
  }

  /* ---------------------------------------------------------- 选择与状态 */

  function selectStop(id, { fly = false } = {}) {
    const data = STOP_BY_ID[id];
    const view = viewFor(id);
    if (!data || !view) return;

    activeId = id;
    ui.setActive(id);
    if (data.kind === 'overview') ui.hideDetail();
    else ui.showDetail(data);

    labels.setActive(id === 'overview' ? null : id);
    if (fly) flyTo(view);
    else {
      camera.position.copy(view.position);
      controls.target.copy(view.target);
      controls.update();
      flight = null;
    }
    ui.announce(`已定位到${data.name}`);
  }

  function clearSelection() {
    activeId = null;
    labels.setActive(null);
    ui.hideDetail();
    ui.setActive(null);
    ui.announce('已取消选择');
  }

  function setMode(mode) {
    if (!MODE_LABEL[mode]) return;
    modes.set(mode, city.root);
    ui.setMode(mode);
    if (mode === 'type') ui.showLegend(legendCounts);
    ui.announce(`观察方式：${MODE_LABEL[mode]}`);
  }

  function setLayer(key, on) {
    if (key === 'labels') {
      labels.setVisible(on);
    } else if (city.layers[key]) {
      city.layers[key].visible = on;
    } else {
      return;
    }
    ui.announce(`${LAYER_LABEL[key] || key}：${on ? '显示' : '隐藏'}`);
  }

  function setHour(hour) {
    sky.setHour(hour);
    const text = SkySystem.formatHour(hour);
    ui.setTime(hour, text);
  }

  /* ---------------------------------------------------------- 轴线巡游 */

  const tourSeq = ui.railEntries.map((s) => s.id);
  const tour = { active: false, i: 0, next: 0 };

  function stopTour() {
    if (!tour.active) return;
    tour.active = false;
    ui.setTour(false);
    ui.announce('巡游已停止');
  }

  function toggleTour() {
    tour.active = !tour.active;
    ui.setTour(tour.active);
    if (!tour.active) {
      ui.announce('巡游已停止');
      return;
    }
    tour.i = 0;
    selectStop(tourSeq[0], { fly: true });
    tour.next = performance.now() + (reduceMotion ? 2200 : 3600);
    ui.announce('开始沿中轴线巡游');
  }

  function updateTour(now) {
    if (!tour.active || flight) return;
    if (now < tour.next) return;
    tour.i = (tour.i + 1) % tourSeq.length;
    selectStop(tourSeq[tour.i], { fly: true });
    tour.next = now + (reduceMotion ? 2200 : 3600);
  }

  /* ---------------------------------------------------------- 尺寸变化 */

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

  /* ---------------------------------------------------------- 渲染循环 */

  function tick(now) {
    requestAnimationFrame(tick);

    updateFlight(now);
    updateTour(now);
    controls.update();

    if (pointerDirty) {
      pointerDirty = false;
      refreshHover();
    }
    labels.update(camera);

    renderer.render(scene, camera);
  }

  /* ---------------------------------------------------------- 首帧与收尾 */

  selectStop('overview');
  labels.update(camera);
  renderer.render(scene, camera);

  setStep('就绪', 1);
  await raf();
  bootEl.classList.add('is-done');

  requestAnimationFrame(tick);
}

start().catch((err) => {
  console.error('[sandbox] 启动失败', err);
  const boot = $('boot');
  if (boot) boot.classList.add('is-done');
  const fb = $('fallback');
  if (fb) fb.hidden = false;
});