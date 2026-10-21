/* 比赛引擎：玩家车辆物理、AI 对手、圈速计时与名次。
   纯逻辑模块（无 DOM / 无 Canvas），固定步长 1/60s 调用 update()。 */
(function (global) {
  'use strict';

  const Util = global.Util;
  const Track = global.Track;

  const SEGMENT_LENGTH = Track.SEGMENT_LENGTH;

  const CAMERA_HEIGHT = 1000;
  const CAMERA_DEPTH = 1 / Math.tan((50 * Math.PI) / 180);
  const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH;   // 相机到车的距离

  const MAX_SPEED = (SEGMENT_LENGTH * 60) * 1.15;
  const ACCEL = MAX_SPEED / 4.6;
  const BRAKING = -MAX_SPEED / 1.9;
  const DECEL = -MAX_SPEED / 6.5;
  const OFF_ROAD_DECEL = -MAX_SPEED / 2.4;
  const OFF_ROAD_LIMIT = MAX_SPEED / 3.2;
  const CENTRIFUGAL = 0.32;
  const HANDBRAKE_DECEL = -MAX_SPEED / 2.6;
  const SPRITE_HIT_SPEED = MAX_SPEED / 3.4;

  const PLAYER_W = Track.SPRITE_W.car;
  const ATTRACT_SPEED = MAX_SPEED * 0.34;

  const RIVAL_NAMES = ['KAI', 'RYU', 'NOVA', 'ZED', 'MILA', 'ONYX'];

  function create(options) {
    const opts = options || {};
    const totalLaps = opts.laps || 3;
    const aiCount = opts.aiCount === undefined ? 5 : opts.aiCount;
    const aiMax = (opts.aiSpeed === undefined ? 0.9 : opts.aiSpeed) * MAX_SPEED;
    const rubber = opts.rubber === undefined ? 0.35 : opts.rubber;
    const trackLength = Track.length;

    const player = {
      position: 0,
      playerX: 0,
      speed: 0,
      distance: 0,
      lapsCompleted: 0,
      lapTimes: [],
      bestLap: null,
      lapStartTime: 0,
      finishTime: null,
      finished: false,
      colorIndex: 0,
      visualLean: 0,
      shake: 0,
      offroad: false,
      handbrake: false,
      braking: false,
      steer: 0,
      contactCooldown: 0,
    };

    let cars = [];
    let raceTime = 0;
    let attract = false;
    let events = makeEvents();

    function makeEvents() {
      return { lapCompleted: 0, bestLap: false, spriteHit: 0, carHit: 0, finished: false };
    }

    function reset() {
      raceTime = 0;
      events = makeEvents();

      player.position = 0;
      player.playerX = 0;
      player.speed = 0;
      player.distance = 0;
      player.lapsCompleted = 0;
      player.lapTimes = [];
      player.bestLap = null;
      player.lapStartTime = 0;
      player.finishTime = null;
      player.finished = false;
      player.visualLean = 0;
      player.shake = 0;
      player.offroad = false;
      player.handbrake = false;
      player.steer = 0;
      player.contactCooldown = 0;

      /* 清空路段上的车辆引用 */
      const segments = Track.segments;
      for (let i = 0; i < segments.length; i++) segments[i].cars.length = 0;

      cars = [];
      for (let n = 0; n < aiCount; n++) {
        const side = n % 2 === 0 ? -1 : 1;
        const lane = side * (0.32 + 0.24 * Math.floor(n / 2));
        /* 每位车手有独立节奏：最快的对手贴住 aiMax，最慢的低 5.5% */
        const pace = aiCount > 1 ? 0.945 + (0.055 * n) / (aiCount - 1) : 0.975;
        const car = {
          name: RIVAL_NAMES[n % RIVAL_NAMES.length],
          colorIndex: n + 1,
          offset: lane,
          baseOffset: lane,
          pace: pace,
          z: 0,
          speed: aiMax * pace,
          w: PLAYER_W,
          distance: (n + 1) * 2400,
          lapsCompleted: 0,
          finishTime: null,
          finished: false,
          braking: false,
        };
        car.z = Util.increase(0, car.distance, trackLength);
        cars.push(car);
        Track.findSegment(car.z).cars.push(car);
      }
    }

    /* 前瞻弯度：AI 据此决定目标车速。越近的弯权重越高，
       否则会为远处的弯提前收油，整圈节奏偏慢。 */
    function curveAhead(index, speed) {
      const segments = Track.segments;
      const len = segments.length;
      const span = 12 + Math.floor(speed / 850);
      let worst = 0;
      for (let i = 3; i < span; i++) {
        const c = Math.abs(segments[(index + i) % len].curve) * (1 - (i - 3) / span);
        if (c > worst) worst = c;
      }
      return worst;
    }

    /* AI 转向：回到自己的车道 + 避让玩家与其他车 */
    function carSteer(car, carSegment, playerSegment, playerSpeed) {
      const segments = Track.segments;
      const len = segments.length;
      let steer = Util.limit((car.baseOffset - car.offset) * 0.45, -0.6, 0.6) * 0.02;
      steer += Math.sin(car.z * 0.00022 + car.colorIndex * 1.7) * 0.0012;

      for (let i = 1; i < 20; i++) {
        const segment = segments[(carSegment.index + i) % len];

        if (
          segment === playerSegment &&
          car.speed > playerSpeed &&
          Util.overlap(player.playerX, PLAYER_W, car.offset, car.w, 1.15)
        ) {
          let dir;
          if (player.playerX > 0.5) dir = -1;
          else if (player.playerX < -0.5) dir = 1;
          else dir = car.offset > player.playerX ? 1 : -1;
          return steer + (dir / i) * ((car.speed - playerSpeed) / MAX_SPEED);
        }

        const segCars = segment.cars;
        for (let j = 0; j < segCars.length; j++) {
          const other = segCars[j];
          if (other === car) continue;
          if (car.speed > other.speed && Util.overlap(car.offset, car.w, other.offset, other.w, 1.15)) {
            const dir = other.offset > car.offset ? -1 : 1;
            return steer + (dir / i) * ((car.speed - other.speed) / MAX_SPEED);
          }
        }
      }

      if (car.offset > 0.95) steer -= 0.022;
      if (car.offset < -0.95) steer += 0.022;
      return steer;
    }

    function updateCars(dt, playerSegment, playerSpeed) {
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        const oldSegment = Track.findSegment(car.z);

        car.offset = Util.limit(car.offset + carSteer(car, oldSegment, playerSegment, playerSpeed), -1.18, 1.18);

        const ahead = curveAhead(oldSegment.index, car.speed);
        let target = aiMax * car.pace * (1 - Math.min(0.42, ahead / 9));

        if (!attract) {
          /* 轻微橡皮筋：落后时略微提速、领先时略微收油，让比赛保持悬念 */
          const gap = player.distance - car.distance;
          target *= 1 + Util.limit(gap / (trackLength * 0.6), -0.045, 0.065) * rubber;
        }
        target = Util.limit(target, aiMax * 0.4, aiMax * 1.02);

        car.braking = target < car.speed;
        const da = (car.braking ? BRAKING * 0.55 : ACCEL * 0.95) * dt;
        car.speed = Util.limit(car.speed + da, 0, MAX_SPEED * 1.02);

        car.z = Util.increase(car.z, dt * car.speed, trackLength);
        car.distance += car.speed * dt;
        car.lapsCompleted = Math.floor(car.distance / trackLength);

        const newSegment = Track.findSegment(car.z);
        if (oldSegment !== newSegment) {
          const idx = oldSegment.cars.indexOf(car);
          if (idx >= 0) oldSegment.cars.splice(idx, 1);
          newSegment.cars.push(car);
        }

        if (!attract && !car.finished && car.distance >= totalLaps * trackLength) {
          car.finished = true;
          car.finishTime = raceTime;
        }
      }
    }

    function update(dt, input) {
      events = makeEvents();

      const playerSegment = Track.findSegment(player.position + PLAYER_Z);
      const speedPercent = player.speed / MAX_SPEED;
      const dx = dt * 2 * speedPercent;

      if (!attract) raceTime += dt;

      updateCars(dt, playerSegment, player.speed);

      player.position = Util.increase(player.position, dt * player.speed, trackLength);

      if (input.left) player.playerX -= dx * (input.handbrake ? 2.1 : 1);
      else if (input.right) player.playerX += dx * (input.handbrake ? 2.1 : 1);
      player.playerX -= dx * speedPercent * playerSegment.curve * CENTRIFUGAL;

      if (input.gas) player.speed = Util.accelerate(player.speed, ACCEL, dt);
      else if (input.brake) player.speed = Util.accelerate(player.speed, BRAKING, dt);
      else player.speed = Util.accelerate(player.speed, DECEL, dt);

      player.handbrake = !!input.handbrake;
      player.braking = !!input.brake || player.handbrake;
      if (player.handbrake) player.speed = Util.accelerate(player.speed, HANDBRAKE_DECEL, dt);

      if ((player.playerX < -1 || player.playerX > 1) && player.speed > OFF_ROAD_LIMIT) {
        player.speed = Util.accelerate(player.speed, OFF_ROAD_DECEL, dt);
      }
      player.offroad = Math.abs(player.playerX) > 1 && player.speed > MAX_SPEED * 0.1;

      player.playerX = Util.limit(player.playerX, -2.4, 2.4);
      player.speed = Util.limit(player.speed, 0, attract ? ATTRACT_SPEED : MAX_SPEED);

      /* 撞路边物 */
      let seg = Track.findSegment(player.position + PLAYER_Z);
      for (let i = 0; i < seg.sprites.length; i++) {
        const sprite = seg.sprites[i];
        if (sprite.collide === false) continue;
        const center = sprite.offset + (sprite.offset < 0 ? -1 : 1) * sprite.w / 2;
        if (Util.overlap(player.playerX, PLAYER_W, center, sprite.w, 1)) {
          player.speed = Math.min(player.speed, SPRITE_HIT_SPEED);
          player.position = Util.increase(seg.p1.world.z, -PLAYER_Z, trackLength);
          player.shake = Math.max(player.shake, 0.6);
          events.spriteHit = 1;
          break;
        }
      }

      /* 与对手接触：轻擦只是互相让位，重撞才明显掉速 */
      player.contactCooldown = Math.max(0, player.contactCooldown - dt);
      seg = Track.findSegment(player.position + PLAYER_Z);
      for (let i = 0; i < seg.cars.length; i++) {
        const car = seg.cars[i];
        if (!(player.speed > car.speed && Util.overlap(player.playerX, PLAYER_W, car.offset, car.w, 0.75))) continue;

        const impact = (player.speed - car.speed) / MAX_SPEED;
        const hard = impact > 0.06;
        if (hard) {
          player.position = Util.increase(car.z, -PLAYER_Z, trackLength);
          player.speed = Math.max(car.speed * 0.72, player.speed * 0.55);
          player.shake = Math.max(player.shake, Util.limit(impact * 3.4, 0.22, 1));
        } else {
          player.speed = Math.max(car.speed * 0.97, player.speed * 0.95);
        }
        /* 双方朝相反方向让开，玩家能从侧面滑过去，而不是被顶在原地 */
        const away = player.playerX > car.offset ? 1 : -1;
        player.playerX += away * 0.09;
        car.offset = Util.limit(car.offset - away * 0.05, -1.12, 1.12);
        if (player.contactCooldown <= 0) {
          if (hard) events.carHit = impact;
          player.contactCooldown = 0.3;
        }
        break;
      }

      player.distance += player.speed * dt;

      /* 圈数与计时 */
      if (!attract && !player.finished) {
        const lapsDone = Math.floor(player.distance / trackLength);
        if (lapsDone > player.lapsCompleted) {
          const lapTime = raceTime - player.lapStartTime;
          player.lapTimes.push(lapTime);
          if (player.bestLap === null || lapTime < player.bestLap) {
            player.bestLap = lapTime;
            events.bestLap = true;
          }
          player.lapsCompleted = lapsDone;
          player.lapStartTime = raceTime;
          events.lapCompleted = lapsDone;
          if (lapsDone >= totalLaps) {
            player.finished = true;
            player.finishTime = raceTime;
            events.finished = true;
          }
        }
      }

      const targetLean = input.left ? -1 : input.right ? 1 : 0;
      player.steer = targetLean;
      player.visualLean += (targetLean - player.visualLean) * Math.min(1, dt * 9);
      player.shake *= Math.pow(0.02, dt);
      if (!isFinite(player.speed) || !isFinite(player.position)) {
        player.speed = 0;
      }
    }

    /* 名次：已完赛按完赛时间，未完赛按里程 */
    function playerRank() {
      let rank = 1;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        if (player.finished && car.finished) {
          if (car.finishTime < player.finishTime) rank++;
        } else if (car.finished) {
          rank++;
        } else if (!player.finished && car.distance > player.distance) {
          rank++;
        }
      }
      return rank;
    }

    function standings() {
      const list = cars.map((car) => ({
        name: car.name,
        colorIndex: car.colorIndex,
        isPlayer: false,
        distance: car.distance,
        lapsCompleted: car.lapsCompleted,
        finished: car.finished,
        finishTime: car.finishTime,
      }));

      list.push({
        name: '你',
        colorIndex: player.colorIndex,
        isPlayer: true,
        distance: player.distance,
        lapsCompleted: player.lapsCompleted,
        finished: player.finished,
        finishTime: player.finishTime,
      });

      list.sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        return b.distance - a.distance;
      });

      return list;
    }

    function progressOf(entity) {
      return Util.limit(entity.distance / (totalLaps * trackLength), 0, 1);
    }

    reset();

    return {
      totalLaps: totalLaps,
      trackLength: trackLength,
      player: player,
      get cars() {
        return cars;
      },
      get raceTime() {
        return raceTime;
      },
      get events() {
        return events;
      },
      get attract() {
        return attract;
      },

      setAttract(value) {
        attract = !!value;
      },

      reset: reset,
      update: update,
      playerRank: playerRank,
      standings: standings,
      progressOf: progressOf,

      /* 当前圈用时（未完赛时为实时值） */
      currentLapTime() {
        if (player.finished) {
          return player.lapTimes[player.lapTimes.length - 1];
        }
        return attract ? 0 : raceTime - player.lapStartTime;
      },

      playerSegment() {
        return Track.findSegment(player.position + PLAYER_Z);
      },

      speedKmh() {
        return Math.round((player.speed / MAX_SPEED) * 320);
      },
    };
  }

  global.Race = {
    create: create,
    MAX_SPEED: MAX_SPEED,
    PLAYER_Z: PLAYER_Z,
    PLAYER_W: PLAYER_W,
    CAMERA_HEIGHT: CAMERA_HEIGHT,
    CAMERA_DEPTH: CAMERA_DEPTH,
  };
})(typeof window !== 'undefined' ? window : globalThis);
