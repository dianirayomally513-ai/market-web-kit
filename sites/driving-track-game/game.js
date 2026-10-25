(() => {
  "use strict";

  // ——— 车辆物理（约 3000 kg）———
  const MASS_KG = 3000;
  const DRIVE_FORCE = 9200;      // N，加速偏「重车」
  const BRAKE_FORCE = 14000;     // N
  const DRAG = 0.42;             // 空气阻力系数（简化）
  const ROLL = 18;               // 滚动阻力
  const MAX_STEER = 2.35;        // rad/s 最大转向角速度
  const STEER_RESP = 4.2;        // 转向响应
  const LATERAL_GRIP = 11.5;     // 侧向抓地（越大越不易侧滑）
  const SLIP_FACTOR = 0.55;      // 高速侧滑强度
  const WALL_PENALTY = 0.5;      // 秒
  const BOUNCE = 0.35;
  const MAX_SPEED = 52;          // m/s ≈ 187 km/h 软顶

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const elTimer = document.getElementById("timer");
  const elSpeed = document.getElementById("speed");
  const elPenalty = document.getElementById("penalty");
  const overlay = document.getElementById("overlay");
  const finish = document.getElementById("finish");
  const finalTime = document.getElementById("final-time");
  const finalPenalty = document.getElementById("final-penalty");

  // 封闭赛道：中心环状跑道（外轨/内轨椭圆 + 弯道起伏）
  // 世界坐标单位：米；画布用相机缩放
  const TRACK = {
    cx: 0,
    cy: 0,
    outerA: 95,
    outerB: 62,
    innerA: 62,
    innerB: 36,
    // 起点在右侧直道偏下
    startAngle: -0.12,
  };

  const keys = Object.create(null);

  const car = {
    x: 0,
    y: 0,
    angle: 0,       // 车头朝向
    vx: 0,
    vy: 0,
    speed: 0,       // 沿车头的标量速度 m/s（可负）
    steer: 0,       // -1..1
    width: 2.2,
    length: 4.6,
  };

  let running = false;
  let finished = false;
  let startTs = 0;
  let elapsed = 0;
  let penalty = 0;
  let lastWallHit = 0;
  let lapProgress = 0;      // 累计扫过角度（归一化）
  let lastAngleOnTrack = 0;
  let crossedStartOnce = false;
  let camX = 0;
  let camY = 0;
  let camZoom = 4.2;        // px per meter —— 第三人称俯视跟车
  let particles = [];

  function resetCar() {
    const a = TRACK.startAngle;
    const rA = (TRACK.outerA + TRACK.innerA) / 2;
    const rB = (TRACK.outerB + TRACK.innerB) / 2;
    car.x = Math.cos(a) * rA;
    car.y = Math.sin(a) * rB;
    // 沿切线方向（逆时针）
    car.angle = a + Math.PI / 2;
    car.vx = 0;
    car.vy = 0;
    car.speed = 0;
    car.steer = 0;
    camX = car.x;
    camY = car.y;
    lapProgress = 0;
    lastAngleOnTrack = normalizeAngle(Math.atan2(car.y / rB, car.x / rA));
    crossedStartOnce = false;
    penalty = 0;
    elapsed = 0;
    finished = false;
    particles = [];
    elPenalty.textContent = "0.0";
    elTimer.textContent = "0.00";
    elSpeed.textContent = "0";
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function trackAngle(x, y) {
    return Math.atan2(y / TRACK.outerB, x / TRACK.outerA);
  }

  function ellipseRadius(a, b, theta) {
    // 从原点沿 theta 方向到椭圆边界的距离
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return (a * b) / Math.sqrt(b * b * c * c + a * a * s * s);
  }

  function onTrack(x, y) {
    const theta = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    const rOut = ellipseRadius(TRACK.outerA, TRACK.outerB, theta);
    const rIn = ellipseRadius(TRACK.innerA, TRACK.innerB, theta);
    return r >= rIn && r <= rOut;
  }

  function nearestOnStrip(x, y) {
    const theta = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    const rOut = ellipseRadius(TRACK.outerA, TRACK.outerB, theta);
    const rIn = ellipseRadius(TRACK.innerA, TRACK.innerB, theta);
    const mid = (rIn + rOut) / 2;
    let nr = r;
    if (r > rOut) nr = rOut - 0.4;
    else if (r < rIn) nr = rIn + 0.4;
    else return { x, y, hit: false };
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    return { x: ux * nr, y: uy * nr, hit: true, outward: r > mid };
  }

  function updatePhysics(dt) {
    const throttle = keys.ArrowUp || keys.KeyW ? 1 : 0;
    const brake = keys.ArrowDown || keys.KeyS || keys.Space ? 1 : 0;
    let steerInput = 0;
    if (keys.ArrowLeft || keys.KeyA) steerInput -= 1;
    if (keys.ArrowRight || keys.KeyD) steerInput += 1;

    // 转向目标随车速减弱（高速不宜急打）
    const spdAbs = Math.abs(car.speed);
    const steerLimit = MAX_STEER / (1 + spdAbs * 0.045);
    const steerTarget = steerInput * steerLimit;
    car.steer += (steerTarget - car.steer) * Math.min(1, STEER_RESP * dt);

    // 纵向力：F = ma → a = F/m
    let force = 0;
    if (throttle) force += DRIVE_FORCE;
    if (brake) {
      const sign = car.speed >= 0 ? -1 : 1;
      force += sign * BRAKE_FORCE;
    }
    // 阻力
    force -= DRAG * car.speed * Math.abs(car.speed);
    force -= ROLL * Math.sign(car.speed || 0) * (spdAbs > 0.05 ? 1 : 0);

    const accel = force / MASS_KG;
    car.speed += accel * dt;
    if (Math.abs(car.speed) < 0.02 && !throttle) car.speed = 0;
    car.speed = Math.max(-8, Math.min(MAX_SPEED, car.speed));

    // 转向：角速度与速度相关；侧向速度做简化侧滑
    if (spdAbs > 0.15) {
      car.angle += car.steer * (car.speed / Math.max(spdAbs, 0.15)) * dt;
    }

    const forwardX = Math.cos(car.angle);
    const forwardY = Math.sin(car.angle);
    const rightX = -Math.sin(car.angle);
    const rightY = Math.cos(car.angle);

    // 期望速度沿车头；侧向分量衰减 = 抓地，高速时衰减变慢 → 侧滑感
    const desiredVx = forwardX * car.speed;
    const desiredVy = forwardY * car.speed;
    let lat = car.vx * rightX + car.vy * rightY;
    const grip = LATERAL_GRIP / (1 + spdAbs * SLIP_FACTOR * 0.08);
    lat *= Math.exp(-grip * dt);

    car.vx = desiredVx + rightX * lat;
    car.vy = desiredVy + rightY * lat;

    car.x += car.vx * dt;
    car.y += car.vy * dt;

    // 护栏碰撞：弹开 + 罚时
    const hit = nearestOnStrip(car.x, car.y);
    if (hit.hit) {
      car.x = hit.x;
      car.y = hit.y;
      // 反弹速度
      const nx = Math.cos(Math.atan2(car.y, car.x));
      const ny = Math.sin(Math.atan2(car.y, car.x));
      const outward = hit.outward;
      const nSign = outward ? -1 : 1;
      const vn = car.vx * nx + car.vy * ny;
      if (vn * nSign > 0) {
        car.vx -= (1 + BOUNCE) * vn * nx;
        car.vy -= (1 + BOUNCE) * vn * ny;
      } else {
        car.vx -= BOUNCE * vn * nx * nSign;
        car.vy -= BOUNCE * vn * ny * nSign;
      }
      car.speed *= 0.72;
      const now = performance.now();
      if (now - lastWallHit > 400) {
        penalty += WALL_PENALTY;
        lastWallHit = now;
        elPenalty.textContent = penalty.toFixed(1);
        spawnSparks(car.x, car.y);
      }
    }

    // 同步标量速度与车头投影
    car.speed = car.vx * forwardX + car.vy * forwardY;
  }

  function spawnSparks(x, y) {
    for (let i = 0; i < 8; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        life: 0.35 + Math.random() * 0.25,
      });
    }
  }

  function updateLap() {
    const ang = trackAngle(car.x, car.y);
    let d = normalizeAngle(ang - lastAngleOnTrack);
    // 逆时针为正进度
    if (d > 0) lapProgress += d;
    lastAngleOnTrack = ang;

    // 驶过起点线：从起点角度附近扫过一整圈
    const start = TRACK.startAngle;
    const distToStart = Math.abs(normalizeAngle(ang - start));
    if (!crossedStartOnce && lapProgress > 0.8) {
      crossedStartOnce = true;
    }
    if (crossedStartOnce && lapProgress >= Math.PI * 2 - 0.15 && distToStart < 0.25) {
      finishRace();
    }
  }

  function finishRace() {
    if (finished) return;
    finished = true;
    running = false;
    const total = elapsed + penalty;
    finalTime.textContent = total.toFixed(2);
    finalPenalty.textContent = penalty.toFixed(1);
    finish.classList.remove("hidden");
  }

  function worldToScreen(x, y) {
    return {
      x: W / 2 + (x - camX) * camZoom,
      y: H / 2 + (y - camY) * camZoom,
    };
  }

  function drawTrack() {
    // 草地背景（世界大圆）
    ctx.save();
    const g0 = worldToScreen(-200, -200);
    // 用相机变换画椭圆赛道
    ctx.translate(W / 2, H / 2);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camX, -camY);

    // 外围草地
    ctx.fillStyle = "#1f3d2a";
    ctx.beginPath();
    ctx.ellipse(0, 0, TRACK.outerA + 28, TRACK.outerB + 28, 0, 0, Math.PI * 2);
    ctx.fill();

    // 外缘路肩
    ctx.fillStyle = "#3a4558";
    ctx.beginPath();
    ctx.ellipse(0, 0, TRACK.outerA + 3.5, TRACK.outerB + 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 柏油路面 = 外椭圆减内椭圆
    ctx.fillStyle = "#2c3344";
    ctx.beginPath();
    ctx.ellipse(0, 0, TRACK.outerA, TRACK.outerB, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse(0, 0, TRACK.innerA, TRACK.innerB, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // 内圈草地
    ctx.fillStyle = "#244830";
    ctx.beginPath();
    ctx.ellipse(0, 0, TRACK.innerA - 0.5, TRACK.innerB - 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 中线虚线
    ctx.strokeStyle = "#d4c56a";
    ctx.lineWidth = 0.35;
    ctx.setLineDash([3.5, 2.8]);
    ctx.beginPath();
    const midA = (TRACK.outerA + TRACK.innerA) / 2;
    const midB = (TRACK.outerB + TRACK.innerB) / 2;
    ctx.ellipse(0, 0, midA, midB, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 护栏描边
    ctx.strokeStyle = "#8fa0b8";
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.ellipse(0, 0, TRACK.outerA, TRACK.outerB, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, TRACK.innerA, TRACK.innerB, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 起点/终点线（短横条跨过赛道）
    const sa = TRACK.startAngle;
    const rIn = ellipseRadius(TRACK.innerA, TRACK.innerB, sa);
    const rOut = ellipseRadius(TRACK.outerA, TRACK.outerB, sa);
    const ux = Math.cos(sa);
    const uy = Math.sin(sa);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(ux * rIn, uy * rIn);
    ctx.lineTo(ux * rOut, uy * rOut);
    ctx.stroke();
    // 格子旗纹
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const r0 = rIn + (rOut - rIn) * t0;
      const r1 = rIn + (rOut - rIn) * t1;
      ctx.fillStyle = i % 2 === 0 ? "#fff" : "#222";
      ctx.beginPath();
      const tx = -uy * 1.2;
      const ty = ux * 1.2;
      ctx.moveTo(ux * r0 + tx, uy * r0 + ty);
      ctx.lineTo(ux * r1 + tx, uy * r1 + ty);
      ctx.lineTo(ux * r1 - tx, uy * r1 - ty);
      ctx.lineTo(ux * r0 - tx, uy * r0 - ty);
      ctx.closePath();
      ctx.fill();
    }

    // 简易绕障锥桶（不挡死，只视觉提示弯道）
    drawCones();

    ctx.restore();
  }

  function drawCones() {
    const spots = [0.55, 1.2, 2.0, 2.7, 3.6, 4.5, 5.4];
    for (const ang of spots) {
      const midA = (TRACK.outerA + TRACK.innerA) / 2;
      const midB = (TRACK.outerB + TRACK.innerB) / 2;
      // 放在外路肩内侧一点
      const r = ellipseRadius(TRACK.outerA - 2.2, TRACK.outerB - 2.2, ang);
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.moveTo(x, y - 0.9);
      ctx.lineTo(x + 0.55, y + 0.55);
      ctx.lineTo(x - 0.55, y + 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 0.35, y - 0.15, 0.7, 0.25);
    }
  }

  function drawCar() {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camX, -camY);
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    const L = car.length;
    const Ww = car.width;

    // 车影
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(-L / 2 + 0.15, -Ww / 2 + 0.2, L, Ww);

    // 车身（第三人称俯视）
    const body = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
    body.addColorStop(0, "#1e40af");
    body.addColorStop(0.5, "#3b82f6");
    body.addColorStop(1, "#60a5fa");
    ctx.fillStyle = body;
    roundRect(-L / 2, -Ww / 2, L, Ww, 0.35);
    ctx.fill();

    // 座舱玻璃（俯视）
    ctx.fillStyle = "rgba(180, 210, 240, 0.55)";
    roundRect(-0.4, -Ww / 2 + 0.25, 1.6, Ww - 0.5, 0.2);
    ctx.fill();

    // 车头指示
    ctx.fillStyle = "#93c5fd";
    ctx.fillRect(L / 2 - 0.55, -Ww / 2 + 0.15, 0.4, Ww - 0.3);

    // 轮胎
    ctx.fillStyle = "#111827";
    const tw = 0.45, th = 0.85;
    ctx.fillRect(-L / 2 + 0.5, -Ww / 2 - 0.12, th, tw);
    ctx.fillRect(-L / 2 + 0.5, Ww / 2 - tw + 0.12, th, tw);
    ctx.fillRect(L / 2 - 1.2, -Ww / 2 - 0.12, th, tw);
    ctx.fillRect(L / 2 - 1.2, Ww / 2 - tw + 0.12, th, tw);

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawParticles(dt) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camX, -camY);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** 时速表：右下角数字 + 简易仪表盘 */
  function drawSpeedometer(kmh) {
    const cx = W - 110;
    const cy = H - 100;
    const R = 72;
    const maxKmh = 180;

    ctx.save();
    // 底盘
    ctx.beginPath();
    ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 12, 22, 0.78)";
    ctx.fill();
    ctx.strokeStyle = "#3b4f6e";
    ctx.lineWidth = 3;
    ctx.stroke();

    // 刻度弧（左下到右下，约 240°）
    const startA = Math.PI * 0.75;
    const endA = Math.PI * 2.25;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 6, startA, endA);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.stroke();

    // 色带
    const t = Math.min(1, kmh / maxKmh);
    ctx.beginPath();
    ctx.arc(cx, cy, R - 6, startA, startA + (endA - startA) * t);
    const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
    grad.addColorStop(0, "#22c55e");
    grad.addColorStop(0.55, "#eab308");
    grad.addColorStop(1, "#ef4444");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 10;
    ctx.stroke();

    // 刻度线
    for (let k = 0; k <= 6; k++) {
      const p = k / 6;
      const a = startA + (endA - startA) * p;
      const r0 = R - 16;
      const r1 = R - 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 指针
    const needle = startA + (endA - startA) * t;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(needle) * 10, cy - Math.sin(needle) * 10);
    ctx.lineTo(cx + Math.cos(needle) * (R - 22), cy + Math.sin(needle) * (R - 22));
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();

    // 数字
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 28px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(kmh)), cx, cy + 22);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("km/h", cx, cy + 42);
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText(MASS_KG + " kg", cx, cy - 28);

    ctx.restore();
  }

  function drawMinimap() {
    const mx = 70;
    const my = H - 70;
    const s = 0.55;
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(s, s);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 3 / s;
    ctx.beginPath();
    ctx.ellipse(0, 0, TRACK.outerA * 0.35, TRACK.outerB * 0.35, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, TRACK.innerA * 0.35, TRACK.innerB * 0.35, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath();
    ctx.arc(car.x * 0.35, car.y * 0.35, 4 / s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  let lastT = performance.now();

  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;

    if (running && !finished) {
      updatePhysics(dt);
      updateLap();
      elapsed = (now - startTs) / 1000;
      elTimer.textContent = (elapsed + penalty).toFixed(2);

      // 第三人称俯视相机平滑跟车
      camX += (car.x - camX) * Math.min(1, 6 * dt);
      camY += (car.y - camY) * Math.min(1, 6 * dt);
      // 略随车速拉远
      const targetZoom = 4.4 - Math.min(1.2, Math.abs(car.speed) * 0.018);
      camZoom += (targetZoom - camZoom) * Math.min(1, 3 * dt);
    }

    const kmh = Math.abs(car.speed) * 3.6;
    elSpeed.textContent = String(Math.round(kmh));

    ctx.clearRect(0, 0, W, H);
    // 天空感底色
    ctx.fillStyle = "#152033";
    ctx.fillRect(0, 0, W, H);

    drawTrack();
    drawParticles(dt);
    drawCar();
    drawMinimap();
    drawSpeedometer(kmh);

    // 进度提示
    if (running) {
      const pct = Math.min(99, Math.floor((lapProgress / (Math.PI * 2)) * 100));
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("圈进度 " + pct + "%", 16, 28);
    }

    requestAnimationFrame(frame);
  }

  function startGame() {
    resetCar();
    overlay.classList.add("hidden");
    finish.classList.add("hidden");
    running = true;
    startTs = performance.now();
  }

  document.getElementById("btn-start").addEventListener("click", startGame);
  document.getElementById("btn-restart").addEventListener("click", startGame);

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    if (!running && !finished && (e.code === "Enter" || e.code === "Space")) {
      startGame();
    }
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  // 触控
  const pad = document.getElementById("touch-pad");
  pad.querySelectorAll("button").forEach((btn) => {
    const code = btn.getAttribute("data-key");
    const map = {
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
    };
    const key = map[code];
    const on = (ev) => {
      ev.preventDefault();
      keys[key] = true;
    };
    const off = (ev) => {
      ev.preventDefault();
      keys[key] = false;
    };
    btn.addEventListener("touchstart", on, { passive: false });
    btn.addEventListener("touchend", off);
    btn.addEventListener("touchcancel", off);
    btn.addEventListener("mousedown", on);
    btn.addEventListener("mouseup", off);
    btn.addEventListener("mouseleave", off);
  });

  resetCar();
  requestAnimationFrame(frame);
})();
