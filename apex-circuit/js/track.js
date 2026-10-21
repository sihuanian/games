/* 赛道：由直道、弯组、坡道拼装成闭合环线，并布置路边物。
   纯数据模块（无 DOM），浏览器与离线仿真脚本共用。 */
(function (global) {
  'use strict';

  const Util = global.Util;

  const SEGMENT_LENGTH = 200;   // 单段长度（世界单位）
  const RUMBLE_LENGTH = 3;      // 相邻同色段的段数
  const ROAD_WIDTH = 2000;      // 半路宽（世界单位）
  const LANES = 4;

  const LENGTH = { NONE: 0, SHORT: 25, MEDIUM: 50, LONG: 100 };
  const CURVE = { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6 };
  const HILL = { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 };

  /* 路边物宽度：以「半路宽」为单位，投影尺寸与碰撞判定共用同一数值 */
  const SPRITE_W = {
    pine1: 0.55, pine2: 0.42, birch: 0.38, bush: 0.32,
    rock1: 0.40, rock2: 0.30, cone: 0.05,
    boardChevron: 1.10, boardTurbo: 1.10, boardDrift: 1.10,
    gantry: 2.30, car: 0.50,
  };

  const COLORS = {
    LIGHT: { road: '#4f545b', grass: '#15301f', rumble: '#e7ecf1', lane: '#dbe3ec' },
    DARK: { road: '#484d54', grass: '#122a1c', rumble: '#c8452c' },
    START: { road: '#e7ecf1', grass: '#15301f', rumble: '#e7ecf1' },
    FINISH: { road: '#23272e', grass: '#15301f', rumble: '#23272e' },
  };

  const TREE_KINDS = ['pine1', 'pine1', 'pine1', 'pine2', 'birch', 'bush'];
  const BILLBOARDS = ['boardChevron', 'boardTurbo', 'boardDrift'];
  const ROCKS = ['rock1', 'rock2'];

  let segments = [];

  function lastY() {
    return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y;
  }

  function addSegment(curve, y) {
    const n = segments.length;
    const startY = lastY();
    segments.push({
      index: n,
      p1: { world: { y: startY, z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
      p2: { world: { y: y, z: (n + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
      curve: curve,
      sprites: [],
      cars: [],
      color: Math.floor(n / RUMBLE_LENGTH) % 2 ? COLORS.DARK : COLORS.LIGHT,
      clip: 0,
      fog: 1,
    });
  }

  /* 进入、保持、离开三段式铺路；curve 为弯度，y 为该路段末端的相对高度（段数） */
  function addRoad(enter, hold, leave, curve, y) {
    const startY = lastY();
    const endY = startY + (y || 0) * SEGMENT_LENGTH;
    const total = enter + hold + leave;
    let n;
    for (n = 0; n < enter; n++) addSegment(Util.easeIn(0, curve, n / enter), Util.easeInOut(startY, endY, n / total));
    for (n = 0; n < hold; n++) addSegment(curve, Util.easeInOut(startY, endY, (enter + n) / total));
    for (n = 0; n < leave; n++) addSegment(Util.easeInOut(curve, 0, n / leave), Util.easeInOut(startY, endY, (enter + hold + n) / total));
  }

  function addStraight(num) {
    const n = num || LENGTH.MEDIUM;
    addRoad(n, n, n, 0, 0);
  }

  function addHill(num, height) {
    const n = num || LENGTH.MEDIUM;
    addRoad(n, n, n, 0, height || HILL.MEDIUM);
  }

  function addCurve(num, curve, height) {
    const n = num || LENGTH.MEDIUM;
    addRoad(n, n, n, curve || CURVE.MEDIUM, height === undefined ? HILL.NONE : height);
  }

  function addLowRollingHills(num, height) {
    const n = num || LENGTH.SHORT;
    const h = height || HILL.LOW;
    addRoad(n, n, n, 0, h / 2);
    addRoad(n, n, n, 0, -h);
    addRoad(n, n, n, 0, h / 2);
    addRoad(n, n, n, 0, 0);
  }

  function addSCurves() {
    const n = LENGTH.SHORT;
    addRoad(n, n, n, -CURVE.EASY, HILL.NONE);
    addRoad(n, n, n, CURVE.MEDIUM, HILL.MEDIUM);
    addRoad(n, n, n, CURVE.EASY, -HILL.LOW);
    addRoad(n, n, n, -CURVE.EASY, HILL.MEDIUM);
    addRoad(n, n, n, -CURVE.MEDIUM, -HILL.MEDIUM);
  }

  function addBumps() {
    const n = 10;
    addRoad(n, n, n, 0, 5);
    addRoad(n, n, n, 0, -2);
    addRoad(n, n, n, 0, -4);
    addRoad(n, n, n, 0, 7);
    addRoad(n, n, n, 0, 4);
  }

  function addDownhillToEnd(num) {
    const n = num || LENGTH.MEDIUM;
    addRoad(n, n, n, -CURVE.EASY, -lastY() / SEGMENT_LENGTH);
  }

  /* 起点（计时线）与终点门 */
  function markLines() {
    const total = segments.length;
    let n;
    for (n = 0; n < RUMBLE_LENGTH * 2; n++) segments[n].color = COLORS.START;
    for (n = 0; n < RUMBLE_LENGTH; n++) segments[total - 1 - n].color = COLORS.FINISH;
    segments[0].sprites.push({ kind: 'gantry', offset: 0, centered: true, collide: false, w: SPRITE_W.gantry });
  }

  /* 路边景物：用固定种子的伪随机数，保证每次开赛的赛道完全一致 */
  function placeRoadside() {
    const rand = Util.mulberry32(0x5eed17);
    const total = segments.length;

    for (let n = 0; n < total; n++) {
      const seg = segments[n];

      if (n % 4 === 0) {
        const dist = 1.18 + rand() * 1.5;
        seg.sprites.push({ kind: Util.randomChoice(rand, TREE_KINDS), offset: -dist, w: 0 });
        if (rand() < 0.72) {
          seg.sprites.push({ kind: Util.randomChoice(rand, TREE_KINDS), offset: dist * (0.95 + rand() * 0.6), w: 0 });
        }
      }

      if (n % 13 === 0) {
        const kind = Util.randomChoice(rand, ROCKS);
        seg.sprites.push({ kind: kind, offset: (rand() < 0.5 ? -1 : 1) * (1.34 + rand() * 1.1), w: 0 });
      }

      if (n % 29 === 0) {
        const kind = Util.randomChoice(rand, BILLBOARDS);
        seg.sprites.push({ kind: kind, offset: (rand() < 0.5 ? -1 : 1) * (1.75 + rand() * 0.7), w: 0 });
      }

      /* 弯道外侧摆锥桶，提示走线 */
      if (seg.curve >= CURVE.MEDIUM && n % 5 === 0) {
        seg.sprites.push({ kind: 'cone', offset: -(1.05 + rand() * 0.05), w: 0 });
      } else if (seg.curve <= -CURVE.MEDIUM && n % 5 === 0) {
        seg.sprites.push({ kind: 'cone', offset: 1.05 + rand() * 0.05, w: 0 });
      }
    }

    /* 补齐宽度字段 */
    for (let n = 0; n < total; n++) {
      const sprites = segments[n].sprites;
      for (let i = 0; i < sprites.length; i++) {
        if (!sprites[i].w) sprites[i].w = SPRITE_W[sprites[i].kind];
      }
    }
  }

  function build() {
    segments.length = 0;

    addStraight(LENGTH.SHORT);                       // 发车直道 + 计时线
    addLowRollingHills(LENGTH.SHORT, HILL.LOW);      // 起伏路
    addSCurves();                                    // 第一组 S 弯
    addBumps();                                      // 搓板路
    addCurve(LENGTH.LONG, CURVE.MEDIUM, HILL.MEDIUM);  // 长上坡右弯
    addHill(LENGTH.MEDIUM, HILL.HIGH);               // 盲顶
    addCurve(LENGTH.MEDIUM, -CURVE.HARD, -HILL.MEDIUM); // 下坡左急弯
    addSCurves();                                    // 第二组 S 弯
    addCurve(LENGTH.MEDIUM, CURVE.EASY, HILL.LOW);
    addDownhillToEnd(80);                            // 下坡收尾直线，冲向计时线

    markLines();
    placeRoadside();
    return segments;
  }

  const Track = {
    SEGMENT_LENGTH: SEGMENT_LENGTH,
    RUMBLE_LENGTH: RUMBLE_LENGTH,
    ROAD_WIDTH: ROAD_WIDTH,
    LANES: LANES,
    LENGTH: LENGTH,
    CURVE: CURVE,
    HILL: HILL,
    COLORS: COLORS,
    SPRITE_W: SPRITE_W,

    build: build,

    /* 按 z 坐标取所属路段 */
    findSegment(z) {
      return segments[Math.floor(z / SEGMENT_LENGTH) % segments.length];
    },

    get segments() {
      return segments;
    },

    get count() {
      return segments.length;
    },

    /* 一圈长度（世界单位） */
    get length() {
      return segments.length * SEGMENT_LENGTH;
    },
  };

  global.Track = Track;
})(typeof window !== 'undefined' ? window : globalThis);