/* 主控制：固定步长循环、输入、HUD、比赛流程（菜单 → 倒计时 → 比赛 → 结算）。 */
(function (global) {
  'use strict';

  const Util = global.Util;
  const Track = global.Track;
  const Sprites = global.Sprites;
  const Race = global.Race;
  const Renderer = global.Renderer;
  const GameAudio = global.GameAudio;

  const FIXED_STEP = 1 / 60;
  const HUD_INTERVAL = 1 / 20;
  const TOTAL_LAPS = 3;
  const BEST_KEY = 'apex-circuit.best-lap';

  const DIFFICULTIES = {
    easy: { label: '轻松', cars: 3, aiSpeed: 0.8, rubber: 0.15, hint: '3 位对手，节奏留有余量，适合先熟悉走线。' },
    normal: { label: '标准', cars: 5, aiSpeed: 0.9, rubber: 0.38, hint: '5 位对手，节奏贴近你的极限。' },
    hard: { label: '狂野', cars: 5, aiSpeed: 0.975, rubber: 0.65, hint: '对手全速贴地过弯，几乎没有失误空间。' },
  };

  const KEY_MAP = {
    ArrowUp: 'gas', KeyW: 'gas',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'handbrake',
  };

  const COUNTDOWN = [
    { text: '3', note: '准备发车' },
    { text: '2', note: '保持转速' },
    { text: '1', note: '盯住第一个弯' },
    { text: 'GO', note: '' },
  ];

  const el = {};
  let renderer = null;
  let race = null;
  let phase = 'menu';
  let difficulty = 'normal';
  let bestLap = null;

  const keys = { gas: false, brake: false, left: false, right: false, handbrake: false };
  const touchInput = { gas: false, brake: false, left: false, right: false };
  const input = { gas: false, brake: false, left: false, right: false, handbrake: false };

  let accumulator = 0;
  let hudAccumulator = 0;
  let lastTime = 0;
  let countdownTimer = 0;
  let countdownStage = -1;
  let rivalMarkers = [];
  let toastTimer = null;
  let muted = false;

  /* ── 个人纪录 ── */

  function loadBest() {
    try {
      const raw = global.localStorage.getItem(BEST_KEY);
      const value = parseFloat(raw);
      return isFinite(value) && value > 0 ? value : null;
    } catch (err) {
      return null;
    }
  }

  function saveBest(value) {
    bestLap = value;
    try {
      global.localStorage.setItem(BEST_KEY, String(value));
    } catch (err) {
      /* 隐私模式下写入失败时仅保留在内存中 */
    }
  }

  /* ── 画面切换 ── */

  function showScreen(name) {
    const screens = { menu: el.screenMenu, pause: el.screenPause, result: el.screenResult };
    Object.keys(screens).forEach((key) => {
      screens[key].hidden = key !== name;
    });
  }

  function setPhase(next) {
    phase = next;
    el.hud.hidden = next !== 'racing' && next !== 'countdown';
    el.touch.hidden = el.hud.hidden || !isTouchDevice();
    if (next === 'menu' || next === 'result') el.countdown.hidden = true;
    if (next === 'menu' || next === 'racing' || next === 'countdown') showScreen(next === 'menu' ? 'menu' : null);
    if (next === 'paused') showScreen('pause');
    if (next === 'result') showScreen('result');
  }

  function isTouchDevice() {
    return (
      (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) ||
      'ontouchstart' in global
    );
  }

  function announce(text) {
    el.liveRegion.textContent = text;
  }

  function showToast(text, isBest) {
    el.toast.textContent = text;
    el.toast.classList.toggle('is-best', !!isBest);
    el.toast.classList.add('is-show');
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(() => {
      el.toast.classList.remove('is-show');
    }, 2400);
  }

  /* ── 比赛流程 ── */

  function applyDifficulty(level) {
    difficulty = DIFFICULTIES[level] ? level : 'normal';
    el.difficultyHint.textContent = DIFFICULTIES[difficulty].hint;
    const buttons = el.difficulty.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-checked', String(buttons[i].dataset.level === difficulty));
    }
  }

  function createRace() {
    const cfg = DIFFICULTIES[difficulty];
    return Race.create({ laps: TOTAL_LAPS, aiCount: cfg.cars, aiSpeed: cfg.aiSpeed, rubber: cfg.rubber });
  }

  function buildProgressMarkers() {
    el.progressRivals.innerHTML = '';
    rivalMarkers = race.cars.map((car) => {
      const marker = document.createElement('i');
      marker.className = 'progress__rival';
      marker.style.background = Sprites.carColor(car.colorIndex);
      el.progressRivals.appendChild(marker);
      return marker;
    });
  }

  function startRace() {
    race = createRace();
    buildProgressMarkers();

    el.hudTotal.textContent = race.cars.length + 1;
    el.hudLaps.textContent = race.totalLaps;
    el.hudBest.textContent = Util.formatTime(null);
    el.hudSpeed.textContent = '0';
    el.speedoFill.style.width = '0%';
    el.progressFill.style.width = '0%';
    el.progressMe.style.left = '0%';

    countdownTimer = 0;
    countdownStage = -1;
    accumulator = 0;
    lastTime = global.performance.now();

    GameAudio.init();
    GameAudio.setMuted(muted);

    el.countdown.hidden = false;
    setPhase('countdown');
    stepCountdown(true);
  }

  function stepCountdown(force) {
    const stage = Math.min(COUNTDOWN.length - 1, Math.floor(countdownTimer));
    if (!force && stage === countdownStage) return;

    countdownStage = stage;
    const step = COUNTDOWN[stage];
    el.countdownText.textContent = step.text;
    el.countdownNote.textContent = step.note;
    el.countdownText.classList.toggle('is-go', step.text === 'GO');
    el.countdownText.classList.remove('is-pop');
    void el.countdownText.offsetWidth; /* 重新触发动画 */
    el.countdownText.classList.add('is-pop');

    if (step.text === 'GO') {
      GameAudio.beep('go');
      announce('出发');
      phase = 'racing';
      lastTime = global.performance.now();
      accumulator = 0;
    } else {
      GameAudio.beep('count');
      announce(step.text);
    }
  }

  function onLapCompleted(lapsDone) {
    const times = race.player.lapTimes;
    const lapTime = times[times.length - 1];
    const last = lapsDone >= race.totalLaps;

    if (bestLap === null || lapTime < bestLap) {
      saveBest(lapTime);
      showToast('个人最快单圈 ' + Util.formatTime(lapTime), true);
      announce('新的个人最快单圈 ' + Util.formatTime(lapTime));
    } else if (last) {
      showToast('冲线 ' + Util.formatTime(lapTime));
    } else {
      showToast('第 ' + lapsDone + ' 圈 ' + Util.formatTime(lapTime));
      announce('第 ' + lapsDone + ' 圈用时 ' + Util.formatTime(lapTime));
    }
  }

  function finishRace() {
    const list = race.standings();
    const rank = list.findIndex((entry) => entry.isPlayer) + 1;
    const player = race.player;
    const newRecord = bestLap !== null && player.bestLap !== null && player.bestLap <= bestLap;

    el.resultPlace.textContent = '第 ' + rank + ' 名';
    el.resultEyebrow.textContent = rank === 1 ? '比赛结束 · 冠军' : '比赛结束';

    const notes = {
      1: '从末位发车一路超到第一，弯道节奏干净利落。',
      2: '登上领奖台，出弯再早一点给油还能更快。',
      3: '站上领奖台边缘，注意第二个 S 弯的走线。',
    };
    el.resultNote.textContent = notes[rank] || '对手的弯速更稳，试试用空格手刹调整入弯角度。';

    el.resTotal.textContent = Util.formatTime(player.finishTime);
    el.resBest.textContent = Util.formatTime(player.bestLap);
    el.resRecord.innerHTML =
      Util.formatTime(bestLap) + (newRecord ? '<span class="badge">本场刷新</span>' : '');

    el.resultBody.innerHTML = '';
    list.forEach((entry, i) => {
      const row = document.createElement('tr');
      if (entry.isPlayer) row.className = 'is-player';
      if (i < 3) row.classList.add('is-podium');

      const place = document.createElement('td');
      place.className = 'num';
      place.textContent = String(i + 1);

      const driver = document.createElement('td');
      const wrap = document.createElement('span');
      wrap.className = 'driver';
      const dot = document.createElement('i');
      dot.style.background = Sprites.carColor(entry.colorIndex);
      wrap.appendChild(dot);
      wrap.appendChild(document.createTextNode(entry.name));
      driver.appendChild(wrap);

      const result = document.createElement('td');
      result.className = 'num';
      result.textContent = entry.finished
        ? Util.formatTime(entry.finishTime)
        : '第 ' + Math.min(entry.lapsCompleted + 1, race.totalLaps) + ' 圈';

      row.appendChild(place);
      row.appendChild(driver);
      row.appendChild(result);
      el.resultBody.appendChild(row);
    });

    el.menuBest.textContent = Util.formatTime(bestLap);
    setPhase('result');
    GameAudio.silence();
    announce('比赛结束，第 ' + rank + ' 名');
  }

  function pauseRace() {
    if (phase !== 'racing' && phase !== 'countdown') return;
    el.pauseNote.textContent = '当前第 ' + Math.min(race.player.lapsCompleted + 1, race.totalLaps) + ' 圈 · 已完成 ' + race.player.lapsCompleted + ' 圈';
    setPhase('paused');
    GameAudio.silence();
  }

  function resumeRace() {
    if (phase !== 'paused') return;
    el.countdown.hidden = true; /* 从暂停恢复直接回到比赛，不再补显倒计时 */
    setPhase('racing');
    lastTime = global.performance.now();
    accumulator = 0;
  }

  function toMenu() {
    race = createRace();
    race.setAttract(true);
    setPhase('menu');
    el.menuBest.textContent = Util.formatTime(bestLap);
    announce('已返回主菜单');
  }

  /* ── 主菜单里的自动巡航 ── */

  function attractInput() {
    const player = race.player;
    const segment = race.playerSegment();
    const target = Util.limit(segment.curve * 0.055, -0.35, 0.35);
    const next = { gas: true, brake: false, left: false, right: false, handbrake: false };
    if (player.playerX > target + 0.05) next.left = true;
    else if (player.playerX < target - 0.05) next.right = true;
    return next;
  }

  /* ── 输入 ── */

  function readInput() {
    input.gas = keys.gas || touchInput.gas;
    input.brake = keys.brake || touchInput.brake;
    input.left = keys.left || touchInput.left;
    input.right = keys.right || touchInput.right;
    input.handbrake = keys.handbrake;
  }

  function onKeyDown(event) {
    const action = KEY_MAP[event.code];
    if (action) {
      keys[action] = true;
      event.preventDefault();
      return;
    }
    if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault();
      if (phase === 'racing' || phase === 'countdown') pauseRace();
      else if (phase === 'paused') resumeRace();
    } else if (event.code === 'KeyM') {
      toggleMute();
    } else if (event.code === 'KeyR') {
      if (phase === 'racing' || phase === 'paused' || phase === 'result') startRace();
    } else if (event.code === 'Enter' && phase === 'menu') {
      startRace();
    }
  }

  function onKeyUp(event) {
    const action = KEY_MAP[event.code];
    if (action) {
      keys[action] = false;
      event.preventDefault();
    }
  }

  function clearKeys() {
    Object.keys(keys).forEach((key) => {
      keys[key] = false;
    });
    Object.keys(touchInput).forEach((key) => {
      touchInput[key] = false;
    });
  }

  function bindTouchButton(node, action) {
    const press = (event) => {
      event.preventDefault();
      touchInput[action] = true;
      node.classList.add('is-active');
      if (node.setPointerCapture && event.pointerId !== undefined) {
        try {
          node.setPointerCapture(event.pointerId);
        } catch (err) {
          /* 忽略指针捕获失败 */
        }
      }
    };
    const release = (event) => {
      if (event) event.preventDefault();
      touchInput[action] = false;
      node.classList.remove('is-active');
    };
    node.addEventListener('pointerdown', press);
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    node.addEventListener('lostpointercapture', release);
    node.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  function toggleMute() {
    muted = !muted;
    GameAudio.setMuted(muted);
    el.btnMute.setAttribute('aria-pressed', String(muted));
    el.btnMute.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
    showToast(muted ? '已静音' : '声音已打开');
  }

  /* ── HUD ── */

  function updateHud() {
    const player = race.player;
    el.hudPos.textContent = String(race.playerRank());
    el.hudLap.textContent = String(Math.min(player.lapsCompleted + 1, race.totalLaps));
    el.hudLapTime.textContent = Util.formatTime(race.currentLapTime());
    el.hudBest.textContent = Util.formatTime(player.bestLap);
    el.hudSpeed.textContent = String(race.speedKmh());
    el.speedoFill.style.width = Util.limit((player.speed / Race.MAX_SPEED) * 100, 0, 100).toFixed(1) + '%';

    const total = race.totalLaps * race.trackLength;
    const playerProgress = Util.limit(player.distance / total, 0, 1);
    el.progressFill.style.width = (playerProgress * 100).toFixed(2) + '%';
    el.progressMe.style.left = (playerProgress * 100).toFixed(2) + '%';

    for (let i = 0; i < rivalMarkers.length; i++) {
      const progress = Util.limit(race.cars[i].distance / total, 0, 1);
      rivalMarkers[i].style.left = (progress * 100).toFixed(2) + '%';
    }
  }

  function updateAudio(dt) {
    const player = race.player;
    GameAudio.update({
      speedPercent: Util.limit(player.speed / Race.MAX_SPEED, 0, 1.1),
      throttle: input.gas,
      handbrake: player.handbrake,
      offroad: player.offroad,
    });
  }

  function consumeEvents() {
    const events = race.events;
    if (events.spriteHit) GameAudio.crash(0.5);
    if (events.carHit) GameAudio.crash(Util.limit(0.35 + events.carHit, 0.35, 0.9));
    if (events.lapCompleted) onLapCompleted(events.lapCompleted);
    if (events.finished) finishRace();
  }

  /* ── 循环 ── */

  function advance(seconds, live) {
    accumulator += seconds;
    let guard = 0;
    while (accumulator >= FIXED_STEP && guard < 12) {
      race.update(FIXED_STEP, live);
      accumulator -= FIXED_STEP;
      guard++;
      if (phase === 'racing') consumeEvents();
    }
  }

  function loop(now) {
    global.requestAnimationFrame(loop);

    const seconds = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    if (phase === 'menu') {
      advance(seconds, attractInput());
    } else if (phase === 'racing') {
      readInput();
      advance(seconds, input);
    } else if (phase === 'countdown') {
      countdownTimer += seconds;
      stepCountdown(false);
    }

    /* GO 时 phase 已切到 racing，覆盖层在这里再停留约 0.8s 后淡出 */
    if (!el.countdown.hidden && phase !== 'countdown') {
      countdownTimer += seconds;
      if (countdownTimer >= 3.8) el.countdown.hidden = true;
    }

    renderer.render(race, seconds);

    if (phase === 'racing') {
      hudAccumulator += seconds;
      if (hudAccumulator >= HUD_INTERVAL) {
        hudAccumulator = 0;
        updateHud();
      }
      updateAudio(seconds);
    } else if (phase === 'paused') {
      GameAudio.update({ speedPercent: 0, throttle: false, handbrake: false, offroad: false });
    }
  }

  /* ── 启动 ── */

  function cacheElements() {
    [
      'app', 'stage', 'hud', 'hudPos', 'hudTotal', 'hudLap', 'hudLaps', 'hudLapTime', 'hudBest',
      'hudSpeed', 'speedoFill', 'progressFill', 'progressRivals', 'progressMe',
      'countdown', 'countdownText', 'countdownNote', 'screenMenu', 'screenPause', 'screenResult',
      'difficulty', 'difficultyHint', 'menuBest', 'btnStart', 'btnPause', 'btnMute', 'btnResume',
      'btnRestart', 'btnQuit', 'btnAgain', 'btnToMenu', 'pauseNote', 'resultEyebrow', 'resultPlace',
      'resultNote', 'resTotal', 'resBest', 'resRecord', 'resultBody', 'touch', 'btnLeft', 'btnRight',
      'btnBrake', 'btnGas', 'toast', 'liveRegion',
    ].forEach((id) => {
      el[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    global.addEventListener('keydown', onKeyDown);
    global.addEventListener('keyup', onKeyUp);
    global.addEventListener('blur', clearKeys);
    global.addEventListener('resize', () => renderer.resize());
    global.addEventListener('orientationchange', () => renderer.resize());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (phase === 'racing' || phase === 'countdown')) pauseRace();
      clearKeys();
    });

    el.btnStart.addEventListener('click', startRace);
    el.btnPause.addEventListener('click', pauseRace);
    el.btnMute.addEventListener('click', toggleMute);
    el.btnResume.addEventListener('click', resumeRace);
    el.btnRestart.addEventListener('click', startRace);
    el.btnQuit.addEventListener('click', toMenu);
    el.btnAgain.addEventListener('click', startRace);
    el.btnToMenu.addEventListener('click', toMenu);

    el.difficulty.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-level]');
      if (button) applyDifficulty(button.dataset.level);
    });

    bindTouchButton(el.btnLeft, 'left');
    bindTouchButton(el.btnRight, 'right');
    bindTouchButton(el.btnBrake, 'brake');
    bindTouchButton(el.btnGas, 'gas');

    document.addEventListener('touchstart', () => {
      if (!el.hud.hidden) el.touch.hidden = false;
    }, { once: true });
  }

  function boot() {
    cacheElements();
    Track.build();
    Sprites.init();
    renderer = Renderer.create(el.stage);

    bestLap = loadBest();
    el.menuBest.textContent = Util.formatTime(bestLap);

    race = createRace();
    race.setAttract(true);
    applyDifficulty('normal');
    setPhase('menu');
    bindEvents();

    lastTime = global.performance.now();
    global.requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
