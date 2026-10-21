/* 音效：全部用 WebAudio 合成，无音频文件。
   引擎声随车速变化，另有路噪、碰撞与倒计时提示音。 */
(function (global) {
  'use strict';

  const Util = global.Util;

  let ac = null;
  let master = null;
  let engineGain = null;
  let engineFilter = null;
  let osc1 = null;
  let osc2 = null;
  let noiseSource = null;
  let noiseGain = null;
  let noiseFilter = null;
  let muted = false;
  let available = false;

  function makeNoiseBuffer(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  function init() {
    if (available || ac) return available;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return false;

    try {
      ac = new Ctx();
      if (ac.state === 'suspended' && ac.resume) ac.resume();

      master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(ac.destination);

      /* 引擎：两个振荡器经低通叠加 */
      engineGain = ac.createGain();
      engineGain.gain.value = 0;
      engineFilter = ac.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 700;
      engineFilter.Q.value = 3;

      osc1 = ac.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 60;
      osc2 = ac.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 30;
      const osc2Gain = ac.createGain();
      osc2Gain.gain.value = 0.4;

      osc1.connect(engineFilter);
      osc2.connect(osc2Gain);
      osc2Gain.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);

      /* 路噪 / 轮胎 */
      noiseSource = ac.createBufferSource();
      noiseSource.buffer = makeNoiseBuffer(ac, 2);
      noiseSource.loop = true;
      noiseFilter = ac.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 900;
      noiseFilter.Q.value = 0.8;
      noiseGain = ac.createGain();
      noiseGain.gain.value = 0;
      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);

      osc1.start();
      osc2.start();
      noiseSource.start();
      available = true;
    } catch (err) {
      available = false;
    }
    return available;
  }

  function setMuted(value) {
    muted = !!value;
    if (master && ac) {
      master.gain.setTargetAtTime(muted ? 0 : 0.9, ac.currentTime, 0.05);
    }
    return muted;
  }

  /* 引擎与路噪实时跟随车速 */
  function update(state) {
    if (!available || !ac) return;
    const t = ac.currentTime;
    const p = Util.limit(state.speedPercent || 0, 0, 1.2);
    const throttle = state.throttle ? 1 : 0;
    const base = 46 + p * 150 + throttle * 6;

    osc1.frequency.setTargetAtTime(base, t, 0.06);
    osc2.frequency.setTargetAtTime(base * 0.5 + 1.5, t, 0.06);
    engineFilter.frequency.setTargetAtTime(320 + p * 2600 + (state.handbrake ? -180 : 0), t, 0.08);
    engineGain.gain.setTargetAtTime(muted ? 0 : 0.035 + p * 0.075, t, 0.08);

    const road = (state.offroad ? 0.16 : 0.02) + p * 0.028 + (state.handbrake ? 0.05 : 0);
    noiseFilter.frequency.setTargetAtTime(state.offroad ? 420 : 1200, t, 0.1);
    noiseGain.gain.setTargetAtTime(muted ? 0 : road, t, 0.08);
  }

  function silence() {
    if (!available || !ac) return;
    engineGain.gain.setTargetAtTime(0, ac.currentTime, 0.1);
    noiseGain.gain.setTargetAtTime(0, ac.currentTime, 0.1);
  }

  function beep(kind) {
    if (!available || muted || !ac) return;
    const t0 = ac.currentTime;
    const freq = kind === 'go' ? 990 : 680;
    const dur = kind === 'go' ? 0.5 : 0.14;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /* 撞击：噪声爆音 + 低频闷响 */
  function crash(intensity) {
    if (!available || muted || !ac) return;
    const t0 = ac.currentTime;
    const level = Util.limit(intensity || 0.5, 0.1, 1);

    const src = ac.createBufferSource();
    src.buffer = makeNoiseBuffer(ac, 0.3);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.5 * level, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + 0.34);

    const thump = ac.createOscillator();
    const tGain = ac.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(140, t0);
    thump.frequency.exponentialRampToValueAtTime(48, t0 + 0.25);
    tGain.gain.setValueAtTime(0.45 * level, t0);
    tGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    thump.connect(tGain);
    tGain.connect(master);
    thump.start(t0);
    thump.stop(t0 + 0.32);
  }

  /* 刷新最快圈：两声上行提示 */
  function chime() {
    if (!available || muted || !ac) return;
    const notes = [880, 1320];
    notes.forEach((freq, i) => {
      const t0 = ac.currentTime + i * 0.11;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    });
  }

  global.GameAudio = {
    init: init,
    isAvailable() {
      return available;
    },
    isMuted() {
      return muted;
    },
    setMuted: setMuted,
    update: update,
    silence: silence,
    beep: beep,
    crash: crash,
    chime: chime,
  };
})(typeof window !== 'undefined' ? window : globalThis);