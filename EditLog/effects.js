/*
  태태고 편집실 — 화면 이펙트 엔진
  index.html에서 분리해 둔 파일. 일반 <script>라 최상위 선언은 index.html의
  인라인 스크립트와 같은 전역 스코프를 공유한다 (모듈이 아니다).
  이 파일이 먼저 실행돼야 하므로 index.html에서 인라인 스크립트보다 위에 둔다.

  바깥(index.html)에서 가져다 쓰는 것: reducedMotion, fitCanvas, accentColor, hexAlpha
  바깥에 내주는 것: fx*() 이펙트들 — initFxButtons()가 버튼에 연결한다.
*/

/* ==========================================================================
   🌿 자연 · 날씨 이펙트
   버튼 하나가 '장면(scene)' 하나다. 장면들은 한 캔버스·한 rAF를 같이 쓰고,
   정해진 시간이 지나면 자기 장면만 목록에서 뺀다. 같은 버튼을 다시 누르면
   진행 중인 장면을 건드리지 않고 하나 더 쌓는다 (중첩 재생).
   ========================================================================== */
let nat = null;

const NR = (a, b) => a + Math.random() * (b - a);

function natLayer() {
  if (nat) return nat;
  const cv = document.createElement('canvas');
  cv.id = 'natCanvas';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  nat = { cv, scenes: [], loop: null, last: 0, beat: 0 };
  // 다른 탭에 갔다 오면 rAF가 끊겨 있을 수 있다 — 돌아오는 즉시 루프를 되살린다.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && nat && nat.scenes.length) natTick(nat);
  });
  return nat;
}

/** 장면 시작. make()가 돌려준 draw(ctx, w, h, t경과초, k진행도, f프레임가중)을 매 프레임 부른다. */
function natRun(kind, dur, make) {
  if (reducedMotion) return;
  const f = natLayer();
  // 같은 버튼을 다시 누르면 진행 중인 장면을 건드리지 않고 하나 더 쌓는다 (중첩 재생).
  // 다만 버튼을 마구 눌렀을 때 한없이 많아지지 않게 장면 수는 상한을 둔다.
  if (f.scenes.length >= 24) f.scenes.shift();
  f.scenes.push({ kind, t0: performance.now(), dur, draw: make() });
  natTick(f);
}

/** 루프가 진짜 돌고 있을 때만 그냥 두고, 멈춰 있으면 다시 살린다.
    예전엔 loop에 id만 남고 콜백은 안 오는 상태(탭 전환으로 rAF가 끊기거나,
    한 장면이 예외를 던져 step이 통째로 죽는 경우)가 되면 `if (f.loop) return`에
    걸려 그 뒤로 어떤 버튼을 눌러도 아무것도 안 나왔다. */
function natTick(f) {
  // beat는 마지막으로 프레임이 실제로 돈 시각. 최근이 아니면 루프는 죽은 것으로 본다.
  if (f.loop && performance.now() - f.beat < 400) return;
  if (f.loop) cancelAnimationFrame(f.loop);
  f.last = f.beat = performance.now();
  const step = (now) => {
    f.beat = now;
    const fit = fitCanvas(f.cv);
    if (!fit) { f.loop = requestAnimationFrame(step); return; }
    const { w, h, ctx } = fit;
    const frame = Math.min(3, Math.max(0.2, (now - f.last) / 16.7));
    f.last = now;
    ctx.clearRect(0, 0, w, h);
    f.scenes = f.scenes.filter((s) => {
      // rAF가 주는 now는 '프레임이 시작된 시각'이라, 그 프레임 안에서 눌린 버튼의
      // t0(performance.now())보다 조금 이전일 수 있다. 음수 t를 그대로 넘기면
      // k가 음수가 되고, 파도처럼 Math.pow(k, 0.75)를 쓰는 장면에서 NaN이 나와
      // createLinearGradient가 던지고 루프 전체가 멈춘다.
      const t = Math.max(0, (now - s.t0) / 1000);
      if (t > s.dur) return false;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      // 한 장면이 터져도 나머지 장면과 루프는 살아 있어야 한다.
      try { s.draw(ctx, w, h, t, t / s.dur, frame); }
      catch (err) { ctx.restore(); return false; }
      ctx.restore();
      return true;
    });
    if (f.scenes.length) { f.loop = requestAnimationFrame(step); }
    else {
      ctx.clearRect(0, 0, w, h);
      f.loop = null;
      // 다 끝난 이펙트 캔버스가 전체 화면 크기로 메모리를 계속 잡고 있을 이유가 없다.
      // 0으로 줄이면 버퍼가 풀리고, 다음 이펙트 때 fitCanvas가 다시 맞춰준다.
      f.cv.width = 0; f.cv.height = 0;
    }
  };
  f.loop = requestAnimationFrame(step);
}

/** 장면이 뚝 켜지거나 꺼지지 않게 하는 앞뒤 페이드 (0 → 1 → 0). */
function natFade(k, inK, outK) {
  return Math.max(0, Math.min(Math.min(1, k / inK), Math.min(1, (1 - k) / outK)));
}

/** ❄️ 눈 — 눈속이가 내려오며 밑에 천천히 쌓인다 (가로 96칸의 눈 높이를 들고 있는다). */
function fxSnow() {
  natRun('snow', 5, () => {
    const COLS = 96;
    let P = null;
    return (ctx, w, h, t, k, f) => {
      if (!P) P = {
        flakes: Array.from({ length: 150 }, () => ({
          x: Math.random() * w, y: Math.random() * h,
          r: NR(1.1, 3.2), v: NR(0.28, 0.8), sw: NR(0.2, 0.9), ph: NR(0, 6.28),
        })),
        pile: new Float32Array(COLS),
      };
      const a = natFade(k, 0.3, 0.16);
      const colW = w / COLS;
      const maxPile = h * 0.12;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#eef5f2';
      for (const s of P.flakes) {
        s.ph += 0.045 * f;
        s.x += Math.sin(s.ph) * s.sw * f;
        s.y += s.v * f;
        const c = Math.max(0, Math.min(COLS - 1, Math.floor(s.x / colW)));
        if (s.y >= h - P.pile[c]) {
          if (k < 0.82) P.pile[c] = Math.min(maxPile, P.pile[c] + s.r * 1.1);
          s.y = -10; s.x = Math.random() * w;
          continue;
        }
        if (s.x < -10) s.x = w + 10; else if (s.x > w + 10) s.x = -10;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.284); ctx.fill();
      }
      // 쌓인 눈은 이웃 칸과 섞여 완만하게 이어진다 (이게 없으면 기둥 모양이 된다).
      for (let i = 0; i < COLS; i++) {
        const l = P.pile[Math.max(0, i - 1)], r = P.pile[Math.min(COLS - 1, i + 1)];
        P.pile[i] += ((l + r) / 2 - P.pile[i]) * 0.12 * f;
      }
      ctx.globalAlpha = a * 0.95;
      ctx.fillStyle = '#f4faf8';
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let i = 0; i < COLS; i++) ctx.lineTo((i + 0.5) * colW, h - P.pile[i]);
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    };
  });
}

/** 🌸 벚꽃 — 바람이 불다 잔잉며 꽃입이 훀달린다. */
function fxSakura() {
  natRun('sakura', 5, () => {
    const COLORS = ['#ffe6ef', '#f9d5e0', '#f7c8d8', '#f2b3ca'];
    let P = null;
    return (ctx, w, h, t, k, f) => {
      if (!P) P = Array.from({ length: 70 }, () => ({
        x: NR(-w * 0.2, w), y: NR(-h * 0.4, h), r: NR(3.5, 8),
        rot: NR(0, 6.28), spin: NR(-0.07, 0.07), vy: NR(0.45, 1),
        sway: NR(0.5, 1.4), ph: NR(0, 6.28), c: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
      const a = natFade(k, 0.3, 0.18);
      // 바람은 살랑거리는 정도만 — 꽃잎이 옆으로 날아가기보다 아래로 떨어지게 한다.
      const gust = 0.35 + Math.sin(t * 0.55) * 0.5 + Math.sin(t * 1.7) * 0.25;
      for (const p of P) {
        p.ph += 0.06 * f; p.rot += p.spin * f;
        p.x += (gust + Math.sin(p.ph) * p.sway) * f;
        p.y += (p.vy + Math.cos(p.ph * 0.7) * 0.18) * f;
        if (p.x > w + 30) { p.x = -30; p.y = NR(-40, h); }
        if (p.y > h + 30) { p.y = -30; p.x = NR(-30, w); }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = a; ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.moveTo(0, -p.r);
        ctx.bezierCurveTo(p.r * 1.15, -p.r * 0.5, p.r * 0.95, p.r * 0.65, 0, p.r);
        ctx.bezierCurveTo(-p.r * 0.45, p.r * 0.5, -p.r * 0.7, -p.r * 0.45, 0, -p.r);
        ctx.fill(); ctx.restore();
      }
    };
  });
}

/** 🍂 낙엽 — 가을 잎사귀가 위에서 아래로 떨어진다 (뒤집힐 때는 세로로 눌린다). */
function fxLeaves() {
  natRun('leaf', 5, () => {
    const COLORS = ['#e0a83c', '#d98a3a', '#c25b2a', '#b8452a', '#8f5a2a'];
    let P = null;
    return (ctx, w, h, t, k, f) => {
      if (!P) P = Array.from({ length: 42 }, () => ({
        x: NR(-w * 0.3, w), y: NR(-h * 0.2, h), r: NR(6, 13),
        rot: NR(0, 6.28), spin: NR(-0.05, 0.05), flip: NR(0, 6.28), fsp: NR(0.05, 0.14),
        vx: NR(-0.7, 1.1), vy: NR(0.5, 1.15), ph: NR(0, 6.28), bob: NR(0.5, 1.4),
        c: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
      const a = natFade(k, 0.3, 0.18);
      // 옆바람은 흔들리는 정도만 — 잎사귀는 위에서 밑으로 떨어진다.
      const gust = 1 + Math.sin(t * 0.8) * 0.35;
      for (const p of P) {
        p.ph += 0.05 * f; p.rot += p.spin * f; p.flip += p.fsp * f;
        p.x += (p.vx * gust + Math.sin(p.ph) * p.bob) * f;
        p.y += p.vy * f;
        if (p.x > w + 40) p.x = -40; else if (p.x < -40) p.x = w + 40;
        if (p.y > h + 40) { p.y = -40; p.x = NR(-20, w + 20); }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.scale(1, Math.max(0.12, Math.abs(Math.cos(p.flip))));
        ctx.globalAlpha = a; ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.moveTo(0, -p.r);
        ctx.quadraticCurveTo(p.r * 0.85, 0, 0, p.r);
        ctx.quadraticCurveTo(-p.r * 0.85, 0, 0, -p.r);
        ctx.fill();
        ctx.globalAlpha = a * 0.5; ctx.strokeStyle = 'rgba(60,30,10,0.6)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(0, -p.r * 0.9); ctx.lineTo(0, p.r * 0.9); ctx.stroke();
        ctx.restore();
      }
    };
  });
}

/** 🌧️ 비 — 바람을 타고 사선으로 새지게 내리고, 밑에서 방울이 튀다. */
function fxDownpour() {
  natRun('pour', 5, () => {
    let P = null; const splash = [];
    return (ctx, w, h, t, k, f) => {
      if (!P) P = Array.from({ length: 260 }, () => ({
        x: NR(-w * 0.25, w), y: Math.random() * h, v: NR(15, 28), len: NR(16, 46), wd: NR(0.7, 1.8),
      }));
      const a = natFade(k, 0.3, 0.16);
      const slant = 0.24 + Math.sin(t * 0.6) * 0.06;
      ctx.globalAlpha = a * 0.24; ctx.fillStyle = '#08131f'; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = a; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(198,220,255,0.5)';
      for (const d of P) {
        d.y += d.v * f; d.x += d.v * slant * f;
        if (d.y > h - 2) {
          if (splash.length < 90) splash.push({ x: d.x, y: h - 2, r: 1, a: 1 });
          d.y = -20; d.x = NR(-w * 0.25, w);
        }
        if (d.x > w + 20) d.x = -20;
        ctx.lineWidth = d.wd;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.v * slant * 1.4, d.y - d.len); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(215,235,255,0.7)';
      for (let i = splash.length - 1; i >= 0; i--) {
        const s = splash[i];
        s.r += 0.9 * f; s.a -= 0.05 * f;
        if (s.a <= 0) { splash.splice(i, 1); continue; }
        ctx.globalAlpha = a * s.a * 0.7; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
    };
  });
}

/** 🌪️ 토네이도 — 깔뚜기가 화면을 오가며 주변 파티굴을 밙아들이며 회전한다. */
function fxTornado() {
  natRun('tornado', 5, () => {
    let P = null, M = null;
    const radAt = (u, w) => w * 0.022 + Math.pow(u, 1.35) * w * 0.2;
    return (ctx, w, h, t, k, f) => {
      if (!P) P = Array.from({ length: 210 }, () => ({
        ang: NR(0, 6.28), u: Math.random(), spd: NR(1.6, 3.4),
        base: NR(0.7, 1.15), rad: NR(2.4, 5.5), r: NR(0.8, 2.3),
      }));
      const a = natFade(k, 0.07, 0.18);
      // 이동 경로는 정해지지 않는다 — 무작위로 목표 지점을 뽑아 그곳으로 가고,
      // 당도하면 다시 새 목표를 뽑는다 (어느 쪽으로 얼마나 갔다 유턴할지 매번 달라진다).
      if (!M) M = { x: NR(0.2, 0.8), to: NR(0.06, 0.94), sp: NR(0.0015, 0.005) };
      if (Math.abs(M.to - M.x) < 0.02) { M.to = NR(0.06, 0.94); M.sp = NR(0.0015, 0.005); }
      M.x += Math.sign(M.to - M.x) * M.sp * f;
      const cx = w * M.x + Math.sin(t * 1.6) * w * 0.008;
      const baseY = h * 0.99, topY = -h * 0.06;
      ctx.strokeStyle = 'rgba(206,218,226,0.9)'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 20; i++) {
        const u = i / 19, R = radAt(u, w);
        ctx.globalAlpha = a * (0.05 + 0.11 * u);
        ctx.beginPath();
        ctx.ellipse(cx + Math.sin(t * 1.3 + u * 3.4) * w * 0.012, baseY + (topY - baseY) * u, R, R * 0.17, 0, 0, 6.284);
        ctx.stroke();
      }
      ctx.fillStyle = '#cbd8de';
      for (const p of P) {
        p.ang += p.spd * (1.4 - p.u * 0.9) * 0.07 * f;
        p.u += 0.0024 * f;
        if (p.u > 1) { p.u = 0; p.rad = NR(2.4, 5.5); }
        p.rad += (1 - p.rad) * 0.025 * f;
        const rr = radAt(p.u, w) * p.base * p.rad;
        const x = cx + Math.cos(p.ang) * rr;
        const y = baseY + (topY - baseY) * p.u + Math.sin(p.ang) * rr * 0.17;
        ctx.globalAlpha = a * (0.3 + 0.55 * (1 - p.u));
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.284); ctx.fill();
      }
      const g = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, w * 0.22);
      g.addColorStop(0, `rgba(190,204,212,${0.2 * a})`);
      g.addColorStop(1, 'rgba(190,204,212,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = g;
      ctx.fillRect(cx - w * 0.25, baseY - w * 0.25, w * 0.5, w * 0.5);
    };
  });
}

/** 🌋 화산 — 밑에서 용암과 불꽃이 솟아오른다. */
function fxVolcano() {
  natRun('volcano', 5, () => {
    let P = [];
    return (ctx, w, h, t, k, f) => {
      const a = natFade(k, 0.04, 0.16);
      const rate = Math.max(0, Math.min(1, (0.86 - k) / 0.14));
      const cx = w * 0.5;
      // 추력을 화면 높이에서 역산해 잎힌 용암이 화면 밖으로 나가지 않게 한다
      // (자유낙하 h = v²/2g — 중력 0.3, 상한은 화면의 82%).
      const vmax = Math.sqrt(2 * 0.3 * h * 0.82);
      for (let i = 0, n = Math.round(7 * rate * f); i < n; i++) {
        P.push({
          x: cx + NR(-w * 0.035, w * 0.035), y: h + 6,
          vx: NR(-4.2, 4.2), vy: -NR(vmax * 0.55, vmax), r: NR(1.6, 4.6),
          life: 1, dec: NR(0.0032, 0.0068), hue: NR(6, 46),
        });
      }
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(cx, h, 0, cx, h, Math.max(w * 0.4, h * 0.5));
      g.addColorStop(0, `rgba(255,148,44,${0.45 * a})`);
      g.addColorStop(0.45, `rgba(224,68,20,${0.16 * a})`);
      g.addColorStop(1, 'rgba(180,30,10,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      P = P.filter((p) => {
        p.vy += 0.3 * f; p.x += p.vx * f; p.y += p.vy * f;
        p.life -= p.dec * f;
        if (p.life <= 0 || p.y > h + 60) return false;
        ctx.globalAlpha = a * Math.max(0, p.life);
        ctx.fillStyle = `hsl(${p.hue},95%,${(52 + p.life * 24).toFixed(1)}%)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.45 + p.life * 0.75), 0, 6.284); ctx.fill();
        return true;
      });
    };
  });
}

/** 🌊 파도 — 거대한 파도가 화면을 덮었다가 밀려난다. */
function fxWave() {
  natRun('wave', 5, () => {
    const spray = [];
    return (ctx, w, h, t, k, f) => {
      const rise = k < 0.42 ? Math.pow(k / 0.42, 0.75) : Math.max(0, 1 - Math.pow((k - 0.42) / 0.58, 1.5));
      const top = h * (1.04 - 1.1 * rise);
      const surf = (x) => top
        + Math.sin((x / w) * 6.284 * 1.5 + t * 3.1) * h * 0.032
        + Math.sin((x / w) * 6.284 * 3.2 - t * 2.2) * h * 0.014;
      const grd = ctx.createLinearGradient(0, top, 0, h);
      grd.addColorStop(0, 'rgba(74,168,196,0.78)');
      grd.addColorStop(0.35, 'rgba(24,104,148,0.88)');
      grd.addColorStop(1, 'rgba(8,48,78,0.95)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.moveTo(0, h + 4);
      for (let x = 0; x <= w; x += 6) ctx.lineTo(x, surf(x));
      ctx.lineTo(w, h + 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(0, surf(0));
      for (let x = 6; x <= w; x += 6) ctx.lineTo(x, surf(x));
      ctx.stroke();
      if (rise > 0.1 && spray.length < 140) {
        for (let i = 0, n = Math.round(3 * f); i < n; i++) {
          const x = Math.random() * w;
          spray.push({ x, y: surf(x), vx: NR(-1.4, 1.4), vy: NR(-6.5, -2.4), r: NR(1, 2.6), life: 1 });
        }
      }
      ctx.fillStyle = 'rgba(240,250,255,0.9)';
      for (let i = spray.length - 1; i >= 0; i--) {
        const s = spray[i];
        s.vy += 0.24 * f; s.x += s.vx * f; s.y += s.vy * f; s.life -= 0.014 * f;
        if (s.life <= 0) { spray.splice(i, 1); continue; }
        ctx.globalAlpha = s.life * 0.8;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.284); ctx.fill();
      }
    };
  });
}

/** 🌌 오로라 — 밤하늘에 보라가 커튼처럼 움직인다. */
function fxAurora() {
  natRun('aurora', 5, () => {
    const BANDS = [
      { c: '52,224,176', y: 0.1, amp: 0.05, sp: 0.5, ph: 0 },
      { c: '90,200,240', y: 0.17, amp: 0.07, sp: 0.34, ph: 2.1 },
      { c: '143,130,237', y: 0.24, amp: 0.06, sp: 0.62, ph: 4.3 },
    ];
    const STRIPS = 90;
    return (ctx, w, h, t, k) => {
      const a = natFade(k, 0.24, 0.2);
      ctx.globalCompositeOperation = 'lighter';
      const sw = w / STRIPS;
      for (const b of BANDS) {
        for (let i = 0; i <= STRIPS; i++) {
          const x = i * sw, u = i / STRIPS;
          const base = h * b.y
            + Math.sin(u * 6.284 * 1.3 + t * b.sp + b.ph) * h * b.amp
            + Math.sin(u * 6.284 * 2.7 - t * b.sp * 1.6) * h * b.amp * 0.45;
          const len = h * (0.2 + 0.14 * (0.5 + 0.5 * Math.sin(u * 9 + t * 0.8 + b.ph)));
          const g = ctx.createLinearGradient(0, base, 0, base + len);
          g.addColorStop(0, `rgba(${b.c},0)`);
          g.addColorStop(0.22, `rgba(${b.c},${0.3 * a})`);
          g.addColorStop(1, `rgba(${b.c},0)`);
          ctx.fillStyle = g; ctx.fillRect(x, base, sw + 1, len);
        }
      }
    };
  });
}

/* ==========================================================================
   🔥 마법 · 원소 이펙트 — 자연·날씨와 같은 장면 엔진(natRun)을 쓴다.
   전부 5초짜리며, 생기고 사라지는 페이드를 길게 잡았다.
   ========================================================================== */

/** 🌑 암흑 마법 — 검은 연기와 입자가 톡이되어 통한다. */
function fxMagicDark() {
  natRun('mDark', 5, () => {
    let B = null, P = null;
    return (ctx, w, h, t, k, f) => {
      if (!B) {
        B = Array.from({ length: 16 }, () => ({
          ang: NR(0, 6.28), rad: NR(0, 0.15), spd: NR(0.06, 0.2), r: NR(0.12, 0.3),
        }));
        P = Array.from({ length: 80 }, () => ({
          ang: NR(0, 6.28), rad: NR(0, 0.2), spd: NR(0.4, 1.4), r: NR(1, 3), v: NR(0.002, 0.006),
        }));
      }
      const a = natFade(k, 0.3, 0.2);
      const cx = w / 2, cy = h * 0.5, S = Math.max(w, h);
      for (const b of B) {
        b.rad += b.spd * 0.004 * f;
        const R = S * b.r;
        const x = cx + Math.cos(b.ang) * S * b.rad, y = cy + Math.sin(b.ang) * S * b.rad * 0.8;
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, `rgba(24,14,34,${0.42 * a})`);
        g.addColorStop(1, 'rgba(24,14,34,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2);
      }
      ctx.fillStyle = '#b98cf0';
      for (const p of P) {
        p.ang += p.spd * 0.01 * f; p.rad += p.v * f;
        if (p.rad > 0.9) p.rad = 0.02;
        const R = S * p.rad;
        ctx.globalAlpha = a * 0.7 * Math.max(0, 1 - p.rad / 0.9);
        ctx.beginPath(); ctx.arc(cx + Math.cos(p.ang) * R, cy + Math.sin(p.ang) * R * 0.8, p.r, 0, 6.284); ctx.fill();
      }
    };
  });
}

/** 🔮 마법진 — 누르는 즉시 그려지기 시작하는 소환진 (9초).
    안쪽에서 바깥으로 고리가 그려지고, 룬 띠 3줄·눈금 띠 4줄이 서로 반대로 돌고,
    기하 문양(삼각·오각·육각)이 겹쳐 얹히고, 꼭짓점마다 작은 부속 진이 돋고,
    약 4.9초에 완성되고 3초 동안 돌다가, 마지막에 가운데 빛이 확 퍼지며 사라진다. */
function fxMagicCircle() {
  natRun('mCircle', 9, () => {
    // 룬 글자는 매번 새로 뽑아 같은 진이 두 번 나오지 않게 한다.
    // 룬에 행성·황도 기호를 섞는다 (시스템 폰트에 거의 다 들어 있는 글자들만 골랐다).
    const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟᛠᛡᚻᚿ☉☽☿♀♂♃♄♅♆♇♈♉♊♋♌♍♎♏♐♑♒♓⚹⚺⚻';
    // ♀ ♊ 같은 기호는 기본이 이모지 표현이라 그냥 쓰면 알록달록하게 찍힌다.
    // 뒤에 U+FE0E(문자 표현 선택자)를 붙여 진 색깔대로 단색으로 그려지게 한다.
    const pick = (n) => Array.from({ length: n }, () => RUNES[Math.floor(Math.random() * RUNES.length)] + '\uFE0E');
    // 선보다 문자가 주인공이 되게 — 문자 띠를 3겹에서 5겹으로 늘리고,
    // 눈금선(ticks)·보조 원(rings)·도형(shapes)은 각각 절반 가까이 덜어냈다.
    // [반지름, 글자 수, 방향, 속도, 글자 크기, 등장 시점]
    const bands = [
      { r: 0.97, n: 40, dir: 1, sp: 0.22, size: 0.079, chars: pick(40), d: 0.16 },
      { r: 0.85, n: 32, dir: -1, sp: 0.3, size: 0.07, chars: pick(32), d: 0.28 },
      { r: 0.66, n: 24, dir: 1, sp: 0.42, size: 0.092, chars: pick(24), d: 0.4 },
      { r: 0.48, n: 18, dir: -1, sp: 0.54, size: 0.078, chars: pick(18), d: 0.52 },
      { r: 0.3, n: 12, dir: 1, sp: 0.66, size: 0.086, chars: pick(12), d: 0.64 },
    ];
    const ticks = [
      { r: 0.92, n: 48, len: 0.028, dir: -1, sp: 0.16, wd: 0.8, d: 0.14 },
      { r: 0.4, n: 8, len: 0.09, dir: 1, sp: 0.72, wd: 2.2, d: 0.58 },
    ];
    const rings = [[1, 3.4, 0.1], [0.9, 1.1, 0.18], [0.72, 1.6, 0.3],
                   [0.56, 1.1, 0.44], [0.34, 1.1, 0.6], [0.14, 1.6, 0.7]];
    // 꼭짓점에 돋는 부속 진 — 안쪽에 문자를 하나씩 새긴다.
    const nodes = { n: 6, r: 0.78, sub: 0.075, d: 0.52, chars: pick(6) };
    return (ctx, w, h, t, k) => {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.4, acc = accentColor();
      // 마지막 1.1초 — 가운데 빛이 확 퍼지고 진은 그 빛에 삼켜지듯 사라진다.
      const burst = Math.max(0, Math.min(1, (t - 7.9) / 1.1));
      // 등장 시점은 초로 잡는다. 첫 고리는 0초부터 — 누르는 즉시 그려진다.
      const a = Math.min(1, t / 0.25) * (1 - burst);
      const on = (d) => Math.max(0, Math.min(1, (t - d * 6 + 0.6) / 0.9));
      ctx.globalCompositeOperation = 'lighter';

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2);
      glow.addColorStop(0, hexAlpha(acc, 0.18 * a));
      glow.addColorStop(0.7, hexAlpha(acc, 0.06 * a));
      glow.addColorStop(1, hexAlpha(acc, 0));
      ctx.globalAlpha = 1; ctx.fillStyle = glow;
      ctx.fillRect(cx - R * 1.25, cy - R * 1.25, R * 2.5, R * 2.5);

      ctx.strokeStyle = acc;
      for (const [s, wd, d] of rings) {
        const o = on(d);
        if (o <= 0) continue;
        ctx.globalAlpha = a * o * 0.55;
        ctx.lineWidth = wd;
        ctx.beginPath(); ctx.arc(cx, cy, R * s, -Math.PI / 2, -Math.PI / 2 + 6.284 * o); ctx.stroke();
      }

      for (const b of ticks) {
        const o = on(b.d);
        if (o <= 0) continue;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * b.sp * b.dir);
        ctx.globalAlpha = a * o * 0.5; ctx.lineWidth = b.wd;
        for (let j = 0; j < b.n; j++) {
          ctx.rotate(6.284 / b.n);
          ctx.beginPath();
          ctx.moveTo(0, -R * b.r); ctx.lineTo(0, -R * (b.r - b.len));
          ctx.stroke();
        }
        ctx.restore();
      }

      // 룬 띠 — 글자는 언제나 바깥을 향해 선다. 완성 후에는 차례로 번쩍인다.
      const done = on(0.8);
      for (const b of bands) {
        const o = on(b.d);
        if (o <= 0) continue;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * b.sp * b.dir);
        ctx.fillStyle = acc;
        ctx.font = `${(R * b.size).toFixed(1)}px "Noto Sans Symbols","Segoe UI Symbol",serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let j = 0; j < b.n; j++) {
          ctx.rotate(6.284 / b.n);
          const flare = done > 0 ? Math.max(0, Math.sin(t * 3 - j * 0.5)) * done : 0;
          ctx.globalAlpha = a * o * (0.7 + flare * 0.3);
          ctx.fillText(b.chars[j], 0, -R * b.r);
        }
        ctx.restore();
      }

      const poly = (n, rr, rot, step) => {
        ctx.beginPath();
        for (let j = 0; j <= n; j++) {
          const ang = rot + ((j * step) % n) * (6.284 / n) - Math.PI / 2;
          const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
          j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
      };
      const shapes = [
        { d: 0.38, n: 3, rr: 0.72, sp: -0.26, step: 1, twin: true, al: 0.4, wd: 1.6 },
        { d: 0.5, n: 5, rr: 0.5, sp: 0.4, step: 2, twin: false, al: 0.45, wd: 1.5 },
      ];
      for (const s of shapes) {
        const o = on(s.d);
        if (o <= 0) continue;
        ctx.save(); ctx.translate(cx, cy);
        ctx.globalAlpha = a * o * s.al; ctx.lineWidth = s.wd; ctx.strokeStyle = acc;
        poly(s.n, R * s.rr, t * s.sp, s.step);
        if (s.twin) poly(s.n, R * s.rr, t * s.sp + Math.PI, s.step);
        ctx.restore();
      }

      // 꼭짓점 부속 진
      const oN = on(nodes.d);
      if (oN > 0) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(-t * 0.14);
        ctx.globalAlpha = a * oN * 0.5; ctx.strokeStyle = acc; ctx.lineWidth = 1.2;
        for (let j = 0; j < nodes.n; j++) {
          ctx.rotate(6.284 / nodes.n);
          const ny = -R * nodes.r, nr = R * nodes.sub;
          ctx.beginPath(); ctx.arc(0, ny, nr, 0, 6.284); ctx.stroke();
          // 안쪽 원·십자 선 대신 문자를 하나 새긴다.
          ctx.save();
          ctx.fillStyle = acc; ctx.globalAlpha = a * oN * 0.8;
          ctx.font = `${(nr * 1.5).toFixed(1)}px "Noto Sans Symbols","Segoe UI Symbol",serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(nodes.chars[j], 0, ny);
          ctx.restore();
        }
        ctx.restore();
      }

      // 가운데 빛 하나로 끝낸다 — 진이 완성되면 커졌다 작아졌다 숨을 쉬고,
      // 마지막 1.1초에 그 빛이 그대로 화면을 삼킬 만큼 부풀어 오른다.
      // (밖으로 퍼지는 흰 링은 없앴다 — 커지는 건 가운데 빛 하나뿐이어야 한다.)
      if (done > 0) {
        const pulse = 1 + Math.sin(t * 3.2) * 0.45;
        const eo = burst > 0 ? 1 - Math.pow(1 - burst, 3) : 0;
        // 터질 땐 화면 대각선을 넘어설 때까지 키운다.
        const CR = R * 0.24 * pulse + eo * Math.hypot(w, h) * 0.8 + 1;
        // 커지는 동안에도 한동안 밝기를 유지하다 끝에서 빠르게 사그라든다.
        const lv = done * (burst > 0 ? 1 - Math.pow(burst, 2.4) : a);
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, CR);
        cg.addColorStop(0, hexAlpha('#ffffff', (0.55 + 0.4 * eo) * lv));
        cg.addColorStop(0.22, hexAlpha(acc, (0.32 + 0.22 * eo) * lv));
        cg.addColorStop(0.6, hexAlpha(acc, (0.05 + 0.12 * eo) * lv));
        cg.addColorStop(1, hexAlpha(acc, 0));
        ctx.globalAlpha = 1; ctx.fillStyle = cg;
        ctx.fillRect(cx - CR, cy - CR, CR * 2, CR * 2);
      }
    };
  });
}

/** 커서가 마지막으로 있었던 자리 (버튼을 누르면 그 버튼 자리가 된다). */
var _ptr = null;
function ptr() {
  if (!_ptr) {
    _ptr = { x: innerWidth / 2, y: innerHeight / 2 };
    addEventListener('pointermove', (e) => { _ptr.x = e.clientX; _ptr.y = e.clientY; }, { passive: true });
  }
  return _ptr;
}

/** 👽 UFO — 미끄러져 들어와 멈춰 서고, 스캔 빛을 내리쬐고 사라진다.
    선체는 금속 그라디언트 + 반사광으로 잡고, 빛줄기 안에는 스캔 링이 흐른다. */
function fxUfo() {
  natRun('sUfo', 5, () => {
    let M = [];
    return (ctx, w, h, t, k, f) => {
      const a = natFade(k, 0.18, 0.18);
      const S = Math.min(w, h) * 0.15;
      // 들어오고 나가는 동작에 감속을 준다 — 등장 후 잠시 정지 비행.
      const inn = Math.min(1, k / 0.26), out = Math.max(0, (k - 0.82) / 0.18);
      const ease = (u) => 1 - Math.pow(1 - u, 3);
      const x = w * (-0.2 + 0.7 * ease(inn) + 0.55 * Math.pow(out, 2.4));
      const bob = Math.sin(t * 2.1) * S * 0.05;
      const y = h * 0.3 + bob;
      const tilt = Math.cos(t * 2.1) * 0.05 - (1 - ease(inn)) * 0.22 + out * 0.3;
      const beam = Math.max(0, Math.min(1, (k - 0.32) / 0.14)) * Math.max(0, Math.min(1, (0.8 - k) / 0.14));

      if (beam > 0) {
        const by = y + S * 0.24;
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(0, by, 0, h);
        g.addColorStop(0, `rgba(168,255,228,${0.34 * a * beam})`);
        g.addColorStop(0.45, `rgba(120,235,205,${0.14 * a * beam})`);
        g.addColorStop(1, 'rgba(90,220,190,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - S * 0.34, by); ctx.lineTo(x + S * 0.34, by);
        ctx.lineTo(x + S * 1.9, h); ctx.lineTo(x - S * 1.9, h);
        ctx.closePath(); ctx.fill();
        // 빛줄기를 타고 내려가는 스캔 링
        ctx.strokeStyle = '#c9fff0';
        for (let n = 0; n < 3; n++) {
          const u = ((t * 0.55 + n / 3) % 1);
          const ry = by + (h - by) * u;
          const rw = S * (0.34 + 1.56 * u);
          ctx.globalAlpha = a * beam * (1 - u) * 0.5;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(x, ry, rw, rw * 0.13, 0, 0, 6.284); ctx.stroke();
        }
        // 빛에 빨려 올라가는 먼지
        if (M.length < 30) M.push({ u: 1, o: NR(-0.8, 0.8), r: NR(1, 2.6) });
        ctx.fillStyle = '#e6fff8';
        M = M.filter((m) => {
          m.u -= 0.006 * f;
          if (m.u <= 0) return false;
          const my = by + (h - by) * m.u;
          ctx.globalAlpha = a * beam * (1 - m.u) * 0.85;
          ctx.beginPath(); ctx.arc(x + m.o * S * (0.34 + 1.5 * m.u), my, m.r, 0, 6.284); ctx.fill();
          return true;
        });
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
      ctx.globalAlpha = a;

      // 선체 밑면 — 어두운 금속
      const hull = ctx.createLinearGradient(0, -S * 0.06, 0, S * 0.3);
      hull.addColorStop(0, '#9fb0c2');
      hull.addColorStop(0.45, '#5c6b7d');
      hull.addColorStop(1, '#2b333d');
      ctx.fillStyle = hull;
      ctx.beginPath(); ctx.ellipse(0, 0, S * 1.15, S * 0.3, 0, 0, 6.284); ctx.fill();

      // 테두리 하이라이트
      ctx.strokeStyle = 'rgba(226,240,255,0.55)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(0, 0, S * 1.15, S * 0.3, 0, Math.PI, 0); ctx.stroke();

      // 하부 링
      ctx.fillStyle = '#232a33';
      ctx.beginPath(); ctx.ellipse(0, S * 0.13, S * 0.78, S * 0.17, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#161b22';
      ctx.beginPath(); ctx.ellipse(0, S * 0.22, S * 0.3, S * 0.09, 0, 0, 6.284); ctx.fill();

      // 유리 돔 — 안쪽에서 은은히 빛난다
      const dome = ctx.createRadialGradient(-S * 0.16, -S * 0.4, 0, 0, -S * 0.2, S * 0.62);
      dome.addColorStop(0, 'rgba(240,255,252,0.95)');
      dome.addColorStop(0.35, 'rgba(150,226,222,0.7)');
      dome.addColorStop(1, 'rgba(58,120,132,0.55)');
      ctx.fillStyle = dome;
      ctx.beginPath(); ctx.ellipse(0, -S * 0.02, S * 0.46, S * 0.42, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(232,248,255,0.5)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(0, -S * 0.02, S * 0.46, S * 0.42, 0, Math.PI, 0); ctx.stroke();
      ctx.globalAlpha = a * 0.4; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(-S * 0.17, -S * 0.24, S * 0.09, S * 0.14, -0.5, 0, 6.284); ctx.fill();

      // 밑면 등 — 차례로 흐르듯 켜진다
      for (let n = 0; n < 9; n++) {
        const u = n / 8;
        const lx = -S * 0.92 + u * S * 1.84;
        const ly = S * 0.1 + Math.pow(Math.abs(u - 0.5) * 2, 2) * S * 0.05;
        const tw = 0.35 + 0.65 * Math.max(0, Math.sin(t * 4 - n * 0.7));
        ctx.globalAlpha = a * (0.3 + 0.7 * tw);
        ctx.fillStyle = '#7dffd0';
        ctx.beginPath(); ctx.arc(lx, ly, S * 0.045, 0, 6.284); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * tw * 0.4;
        ctx.beginPath(); ctx.arc(lx, ly, S * 0.12, 0, 6.284); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    };
  });
}

/** 나비 한 마리 (현재 지점은 호출 전에 translate해 둔다). flap이 커질수록 날개를 접는다. */
function drawButterfly(ctx, r, flap, c) {
  const s = Math.max(0.15, Math.abs(Math.cos(flap)));
  ctx.fillStyle = c;
  for (const dir of [-1, 1]) {
    ctx.save(); ctx.scale(dir * s, 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(r * 1.1, -r * 1.1, r * 1.5, -r * 0.2, r * 0.5, r * 0.25);
    ctx.bezierCurveTo(r * 0.9, r * 0.9, r * 0.2, r * 0.85, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(40,32,28,0.75)';
  ctx.beginPath(); ctx.ellipse(0, r * 0.1, r * 0.11, r * 0.42, 0, 0, 6.284); ctx.fill();
}

function drawHeart(ctx, r, c) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(0, r * 0.75);
  ctx.bezierCurveTo(-r * 1.5, -r * 0.25, -r * 0.6, -r * 1.2, 0, -r * 0.45);
  ctx.bezierCurveTo(r * 0.6, -r * 1.2, r * 1.5, -r * 0.25, 0, r * 0.75);
  ctx.fill();
}

/** 4가닥 반짝이 (별가루·보석·금봉에서 공용). */
function drawSpark(ctx, r, c) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.quadraticCurveTo(0, 0, r * 0.3, 0);
  ctx.quadraticCurveTo(0, 0, 0, r); ctx.quadraticCurveTo(0, 0, -r * 0.3, 0);
  ctx.quadraticCurveTo(0, 0, 0, -r);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-r, 0); ctx.quadraticCurveTo(0, 0, 0, r * 0.3);
  ctx.quadraticCurveTo(0, 0, r, 0); ctx.quadraticCurveTo(0, 0, 0, -r * 0.3);
  ctx.quadraticCurveTo(0, 0, -r, 0);
  ctx.fill();
}

function drawFlower(ctx, r, petals, c, core) {
  ctx.fillStyle = c;
  for (let i = 0; i < petals; i++) {
    ctx.save(); ctx.rotate((i / petals) * 6.284);
    ctx.beginPath(); ctx.ellipse(0, -r * 0.62, r * 0.34, r * 0.62, 0, 0, 6.284); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.24, 0, 6.284); ctx.fill();
}

/** 👻 유령 출몰 — 화면 앞으로 불쑥 달려들었다 사라진다. */
function fxHaunting() {
  natRun('hrHaunt', 5, () => (ctx, w, h, t, k) => {
    const a = natFade(k, 0.24, 0.14);
    ctx.globalAlpha = a * 0.62; ctx.fillStyle = '#05040a'; ctx.fillRect(0, 0, w, h);
    // 덮쳐오는 구간을 짧게(0.32→0.22), 가속 곡선도 완만하게(2.4→1.7) 해서
    // 마지막에 몰아서 커지는 대신 훨씬 빠르게 달려든다.
    const lunge = Math.max(0, Math.min(1, (k - 0.55) / 0.22));
    const S = Math.min(w, h) * (0.16 + Math.pow(lunge, 1.7) * 1.5);
    const cx = w * 0.5 + Math.sin(t * 1.4) * w * 0.03;
    const cy = h * 0.46;
    ctx.save(); ctx.translate(cx, cy);
    ctx.globalAlpha = a * (0.4 + lunge * 0.5); ctx.fillStyle = '#dfe8f5';
    ctx.beginPath();
    ctx.arc(0, -S * 0.2, S * 0.7, Math.PI, 0);
    // 아랫단은 흔들지 않고 고정된 지그재그로 둔다.
    for (let i = 0; i <= 6; i++) {
      const px = S * 0.7 - (S * 1.4 * i) / 6;
      ctx.lineTo(px, S * (1 + 0.16 * (i % 2 ? 1 : -1)));
    }
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = a * (0.6 + lunge * 0.4); ctx.fillStyle = '#0d0a14';
    ctx.beginPath(); ctx.ellipse(-S * 0.24, -S * 0.3, S * 0.11, S * 0.16, 0, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.ellipse(S * 0.24, -S * 0.3, S * 0.11, S * 0.16, 0, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, S * 0.08, S * 0.16, S * 0.26, 0, 0, 6.284); ctx.fill();
    ctx.restore();
  });
}

/** 💖 하트 폭발 — 눌러준 자리에서 하트가 톡 터진다. */
function fxHeartBurst() {
  natRun('prHeart', 7, () => {
    const COLORS = ['#ff6b81', '#ff9fb5', '#ffd0dc', '#ff4f6d'];
    let P = null;
    return (ctx, w, h, t, k, f) => {
      const p0 = ptr();
      if (!P) P = Array.from({ length: 46 }, () => {
        // 옆으로 흩어지기보다 위로 솟구치게 — 바로 위(-90°)를 중심으로 한 삼각분포라
        // 가운데일수록 많이 몰린다. 그래야 한참 올라갔다 하트로 다시 떨어진다.
        const ang = -Math.PI / 2 + (Math.random() + Math.random() - 1) * Math.PI * 0.42;
        const sp = NR(6, 13);
        return {
          x: p0.x, y: p0.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          r: NR(7, 18), rot: NR(-0.4, 0.4), spin: NR(-0.05, 0.05), life: 1, dec: NR(0.0018, 0.0034),
          ph: NR(0, 6.28), sw: NR(0.35, 1.0),
          c: COLORS[Math.floor(Math.random() * COLORS.length)],
        };
      });
      const a = natFade(k, 0.08, 0.16);
      P = P.filter((p) => {
        p.vy += 0.17 * f; p.vx *= 0.995;
        // 떨어질 땐 종단속도를 낮게 둬서 곤두박질치지 않고 하늘거리며 내려온다.
        if (p.vy > 3.2) p.vy = 3.2;
        p.ph += 0.06 * f;
        p.x += (p.vx + Math.sin(p.ph) * p.sw) * f;
        p.y += p.vy * f; p.rot += p.spin * f; p.life -= p.dec * f;
        if (p.life <= 0) return false;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = a * Math.min(1, p.life * 1.6);
        drawHeart(ctx, p.r, p.c);
        ctx.restore();
        return true;
      });
    };
  });
}

/** 🌟 별빛 — 화면에 작은 별들이 하나씩 나타난다. */
function fxStarlight() {
  natRun('prStar', 5, () => {
    let P = null;
    return (ctx, w, h, t, k, f) => {
      if (!P) P = Array.from({ length: 90 }, () => ({
        x: NR(0, w), y: NR(0, h), r: NR(5, 14), ph: NR(0, 6.28), sp: NR(0.5, 1.6), d: Math.random() * 0.55,
      }));
      const a = natFade(k, 0.3, 0.24);
      ctx.globalCompositeOperation = 'lighter';
      for (const s of P) {
        const on = Math.max(0, Math.min(1, (k - s.d) / 0.3));
        if (on <= 0) continue;
        s.ph += s.sp * 0.05 * f;
        const tw = 0.45 + 0.55 * Math.sin(s.ph);
        ctx.save(); ctx.translate(s.x, s.y);
        ctx.globalAlpha = a * on * Math.max(0.15, tw);
        drawSpark(ctx, s.r, '#fff8dc');
        ctx.restore();
      }
    };
  });
}

/** 🦋 나비 정원 — 나비들이 저마다 방향을 바꾸며 화면을 돌아다닌다. */
function fxButterflyGarden() {
  natRun('prGarden', 5, () => {
    const COLORS = ['#ffb3d1', '#ffd98a', '#a9dcfb', '#c9b6f7', '#a9f0c8'];
    let P = null;
    return (ctx, w, h, t, k, f) => {
      if (!P) P = Array.from({ length: 18 }, () => ({
        x: NR(0, w), y: NR(0, h), ang: NR(0, 6.28), sp: NR(0.8, 2.2), turn: NR(-0.05, 0.05),
        r: NR(9, 18), flap: NR(0, 6.28), fsp: NR(0.28, 0.46), ph: NR(0, 6.28),
        c: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
      const a = natFade(k, 0.28, 0.22);
      for (const b of P) {
        b.ph += 0.05 * f;
        b.ang += (b.turn + Math.sin(b.ph) * 0.05) * f;
        b.x += Math.cos(b.ang) * b.sp * f;
        b.y += (Math.sin(b.ang) * b.sp + Math.sin(b.ph * 1.6) * 0.5) * f;
        if (b.x < -30) b.x = w + 30; else if (b.x > w + 30) b.x = -30;
        if (b.y < -30) b.y = h + 30; else if (b.y > h + 30) b.y = -30;
        b.flap += b.fsp * f;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.sin(b.ph) * 0.25);
        ctx.globalAlpha = a;
        drawButterfly(ctx, b.r, b.flap, b.c);
        ctx.restore();
      }
    };
  });
}

/** 🌺 꽃 피기 — 화면 곳곳에서 꽃이 피어난다. */
function fxBloom() {
  natRun('prBloom', 5, () => {
    const PALETTE = [['#ffb3c7', '#ffe08a'], ['#f7c8ff', '#fff1a8'], ['#fff0f5', '#ffc46b'], ['#ffd3e0', '#ff9f43']];
    let P = null;
    return (ctx, w, h, t, k) => {
      if (!P) P = Array.from({ length: 26 }, () => {
        const pal = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        return {
          x: NR(w * 0.06, w * 0.94), y: NR(h * 0.08, h * 0.94), r: NR(16, 42),
          rot: NR(0, 6.28), petals: 5 + Math.floor(Math.random() * 3), d: Math.random() * 0.5, c: pal,
        };
      });
      const a = natFade(k, 0.26, 0.22);
      for (const p of P) {
        const gr = Math.max(0, Math.min(1, (k - p.d) / 0.32));
        if (gr <= 0) continue;
        const ease = 1 - Math.pow(1 - gr, 3);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot + (1 - ease) * 0.9);
        ctx.globalAlpha = a * Math.min(1, gr * 2);
        drawFlower(ctx, p.r * ease, p.petals, p.c[0], p.c[1]);
        ctx.restore();
      }
    };
  });
}

/** ✨ 반짝이 폭발 — 눌러준 자리에서 금벽 파티굴이 톡 터진다. */
function fxGlitterBurst() {
  natRun('prGlitter', 5, () => {
    let P = null;
    return (ctx, w, h, t, k, f) => {
      const p0 = ptr();
      if (!P) P = Array.from({ length: 150 }, () => {
        const ang = Math.random() * 6.284, sp = NR(2, 15);
        return {
          x: p0.x, y: p0.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          r: NR(3, 9), rot: NR(0, 6.28), spin: NR(-0.15, 0.15),
          life: 1, dec: NR(0.006, 0.014), hue: NR(36, 56),
        };
      });
      const a = natFade(k, 0.1, 0.3);
      ctx.globalCompositeOperation = 'lighter';
      P = P.filter((p) => {
        p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.07 * f;
        p.x += p.vx * f; p.y += p.vy * f; p.rot += p.spin * f; p.life -= p.dec * f;
        if (p.life <= 0) return false;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = a * p.life;
        drawSpark(ctx, p.r * (0.4 + p.life * 0.7), `hsl(${p.hue},100%,${(72 + p.life * 20).toFixed(0)}%)`);
        ctx.restore();
        return true;
      });
    };
  });
}

/** 🌸 꽃잎 폭풍 — 벚꽃이 엄청난 양으로 훀몰아친다. */
function fxPetalStorm() {
  natRun('prPetalStorm', 5, () => {
    const COLORS = ['#ffe6ef', '#f9d5e0', '#f7c8d8', '#f2b3ca', '#ffd9e6'];
    let P = null;
    return (ctx, w, h, t, k, f) => {
      if (!P) P = Array.from({ length: 220 }, () => ({
        x: NR(-w * 0.3, w), y: NR(-h * 0.2, h), r: NR(4, 11),
        rot: NR(0, 6.28), spin: NR(-0.16, 0.16), vx: NR(6, 16), vy: NR(1, 5),
        ph: NR(0, 6.28), sway: NR(1, 3.4), c: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
      const a = natFade(k, 0.22, 0.2);
      const gust = 1 + Math.sin(t * 1.3) * 0.4;
      for (const p of P) {
        p.ph += 0.09 * f; p.rot += p.spin * f;
        p.x += (p.vx * gust + Math.sin(p.ph) * p.sway) * f;
        p.y += (p.vy + Math.cos(p.ph * 0.8) * 0.8) * f;
        if (p.x > w + 30) { p.x = -30; p.y = NR(-h * 0.2, h); }
        if (p.y > h + 30) { p.y = -30; p.x = NR(-30, w); }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = a; ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.moveTo(0, -p.r);
        ctx.bezierCurveTo(p.r * 1.15, -p.r * 0.5, p.r * 0.95, p.r * 0.65, 0, p.r);
        ctx.bezierCurveTo(-p.r * 0.45, p.r * 0.5, -p.r * 0.7, -p.r * 0.45, 0, -p.r);
        ctx.fill(); ctx.restore();
      }
    };
  });
}
