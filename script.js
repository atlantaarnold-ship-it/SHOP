/* =========================================================================
   NEON SURVIVOR: CYBER ARENA
   -------------------------------------------------------------------------
   เกมเอาชีวิตรอดแนว Cyberpunk — หลบบล็อกที่ตกลงมาจากด้านบน เก็บพลังงาน
   ใช้สกิล และมีระบบหัวใจ 3 ดวง + โล่อัตโนมัติ 3 วินาทีเมื่อเสียหัวใจครั้งแรก
   -------------------------------------------------------------------------
   โครงสร้างไฟล์ (แยกเป็นระบบชัดเจน):
     1) Utils          - ฟังก์ชันช่วยเหลือทั่วไป
     2) Config         - ค่าคงที่ของเกมทั้งหมด
     3) Audio          - เสียง Synth ด้วย Web Audio API (ไม่ต้องใช้ไฟล์เสียง)
     4) Input          - จัดการคีย์บอร์ด/ปุ่มสัมผัส
     5) Particles      - อนุภาค (ระเบิด, ประกาย, ร่องรอย)
     6) Player         - ผู้เล่น (เคลื่อนที่, dash, โล่, บาดเจ็บ)
     7) Orb            - Energy Orb
     8) BlockSystem    - บล็อกอันตราย + warning
     9) Skills         - พลังพิเศษ Q / E / R / Shift + พลังงาน
    10) FX             - เอฟเฟกต์จอ (screen shake, ชื่อข้อความกลางจอ)
    11) UI             - HUD, เมนู, หน้า Game Over
    12) Game           - ตัวหลัก: state, game loop ด้วย requestAnimationFrame
   ========================================================================= */
(function () {
  "use strict";

  /* ===================== 1) UTILS ===================== */
  var Utils = {
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    aabb: function (a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    },
    formatTime: function (sec) {
      var s = Math.floor(sec);
      var m = Math.floor(s / 60);
      var r = s % 60;
      return m + ":" + (r < 10 ? "0" + r : r);
    },
    // สี่เหลี่ยมมุมโค้ง
    roundRect: function (ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  };

  /* ===================== 2) CONFIG ===================== */
  var CFG = {
    W: 480,
    H: 720,

    PLAYER: {
      w: 40,
      h: 40,
      speed: 330,          // px / วินาที
      dashSpeed: 1250,
      dashTime: 0.20,
      dashInvuln: 0.25,
      hurtInvuln: 0.5      // ช่วงกันโดนซ้ำหลังโล่หมด/หลังบาดเจ็บ
    },

    HEARTS_START: 3,

    AUTO_SHIELD: 3.0,      // โล่อัตโนมัติหลังเสียหัวใจครั้งแรก (วินาที)

    ENERGY: {
      max: 100,
      start: 50,
      orbGain: 18
    },

    SKILLS: {
      shield: { cd: 10, dur: 3.0 },
      freeze: { cd: 15, dur: 2.5 },
      nova: { cd: 12, radius: 165, cost: 30 },
      dash: { cd: 3 }
    },

    BLOCK: {
      baseSpeed: 115,      // px / วินาที
      speedGrowth: 3.4,    // เพิ่มต่อวินาทีที่เล่น
      maxSpeed: 640,
      smallChance: 0.62,   // โอกาสเกิดคอลัมน์ย่อย
      megaEvery: 6         // ทุกกี่วินาทีจะเตือน mega block
    },

    DIFFICULTY_STEP: 30,   // ทุก 30 วินาที = เพิ่มระดับอันตราย

    SCORE: {
      perSecond: 12,
      dodge: 5,
      orb: 25
    }
  };

  /* ===================== 3) AUDIO (Web Audio API) ===================== */
  var Audio2 = (function () {
    var ctx = null, master = null, ambGain = null, ambNodes = null;
    var enabled = false;      // ไม่เล่นเสียงจนกว่าผู้เล่นจะสั่งเปิด
    var unlocked = false;

    function initCtx() {
      if (ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (e) { ctx = null; return; }
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }

    // ต้องเรียกหลัง gesture แรกของผู้ใช้ (autoplay policy)
    function unlock() {
      initCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      unlocked = true;
    }

    function tone(freq, dur, type, vol, slideTo, delay) {
      if (!enabled || !ctx) return;
      var t0 = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }

    function noise(dur, vol, filterFreq, delay) {
      if (!enabled || !ctx) return;
      var t0 = ctx.currentTime + (delay || 0);
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filterFreq || 1200;
      var g = ctx.createGain(); g.gain.value = vol || 0.3;
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t0);
    }

    // เสียงบรรยากาศ Sci-fi (drone) — loop ตลอดเวลา
    function startAmbience() {
      if (!enabled || !ctx || ambNodes) return;
      ambGain = ctx.createGain();
      ambGain.gain.value = 0.0001;
      ambGain.connect(master);
      ambGain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 2.5);

      var o1 = ctx.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 55;
      var o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = 82.4;
      var lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.12;
      var lfoGain = ctx.createGain(); lfoGain.gain.value = 6;
      lfo.connect(lfoGain); lfoGain.connect(o2.frequency);

      var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
      o1.connect(f); o2.connect(f); f.connect(ambGain);
      o1.start(); o2.start(); lfo.start();
      ambNodes = { o1: o1, o2: o2, lfo: lfo, gain: ambGain };
    }

    function stopAmbience() {
      if (!ambNodes) return;
      try {
        ambNodes.gain.gain.cancelScheduledValues(ctx.currentTime);
        ambNodes.gain.gain.setValueAtTime(ambNodes.gain.gain.value, ctx.currentTime);
        ambNodes.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        ambNodes.o1.stop(ctx.currentTime + 0.7);
        ambNodes.o2.stop(ctx.currentTime + 0.7);
        ambNodes.lfo.stop(ctx.currentTime + 0.7);
      } catch (e) { }
      ambNodes = null;
    }

    return {
      unlock: unlock,
      setEnabled: function (v) {
        enabled = !!v;
        if (enabled) { unlock(); startAmbience(); }
        else { stopAmbience(); }
      },
      isEnabled: function () { return enabled; },
      isUnlocked: function () { return unlocked; },

      orb: function () { tone(880, 0.12, "triangle", 0.28, 1500); tone(1320, 0.16, "sine", 0.18, 1800, 0.05); },
      shield: function () { tone(220, 0.5, "sawtooth", 0.22, 660); tone(440, 0.6, "sine", 0.16, 880, 0.05); },
      shieldEnd: function () { tone(600, 0.35, "sine", 0.16, 180); },
      freeze: function () { tone(1400, 0.5, "sine", 0.2, 300); tone(900, 0.6, "triangle", 0.14, 200, 0.06); },
      nova: function () { noise(0.5, 0.42, 900); tone(90, 0.55, "square", 0.28, 45); },
      dash: function () { noise(0.16, 0.22, 2600); tone(520, 0.14, "sawtooth", 0.14, 1200); },
      hurt: function () { noise(0.3, 0.5, 500); tone(160, 0.35, "square", 0.3, 60); },
      point: function () { tone(1046, 0.07, "square", 0.12, 1318); },
      levelUp: function () { tone(330, 0.18, "square", 0.22, 660); tone(660, 0.28, "square", 0.18, 990, 0.14); },
      over: function () { tone(300, 0.9, "sawtooth", 0.3, 60); noise(0.9, 0.4, 380, 0.05); tone(150, 1.1, "square", 0.2, 40, 0.1); },
      ui: function () { tone(700, 0.08, "square", 0.14, 1100); }
    };
  })();

  /* ===================== 4) INPUT ===================== */
  var Input = (function () {
    // สถานะปุ่มที่กดค้าง
    var held = { left: false, right: false, up: false, down: false };

    // คิวการกด "ครั้งเดียว" — ใช้สำหรับสกิล กันเหตุการณ์ซ้ำเวลากดค้าง
    var pressQueue = [];

    // callback เมื่อมีการกดปุ่มลัด (ใช้ map ปุ่มจริง -> ชื่อ action)
    var keyMap = {
      "a": "left", "arrowleft": "left",
      "d": "right", "arrowright": "right",
      "w": "up", "arrowup": "up",
      "s": "down", "arrowdown": "down"
    };

    var actionKeyMap = {
      "q": "shieldQ",
      "e": "freezeE",
      "r": "novaR",
      "shift": "dashShift"
    };

    // ปุ่มที่ไม่อยากให้ browser ทำ default (scroll ฯลฯ)
    var preventKeys = {
      "arrowleft": 1, "arrowright": 1, "arrowup": 1, "arrowdown": 1,
      " ": 1, "spacebar": 1
    };

    var onAction = null;   // fn(actionName)
    var onMenuKey = null;  // fn(key)

    function norm(e) {
      var k = e.key ? String(e.key).toLowerCase() : "";
      return k;
    }

    function handleDown(e) {
      var k = norm(e);

      if (preventKeys[k]) e.preventDefault();

      // ปุ่มเมนู (Esc / Enter / Space)
      if (onMenuKey) onMenuKey(k, e);

      // ทิศทาง (กดค้างได้ + รองรับหลายปุ่มพร้อมกัน)
      if (keyMap[k]) {
        held[keyMap[k]] = true;
        return;
      }

      // สกิล: ใช้ e.repeat กันเหตุการณ์ซ้ำจากการกดค้าง
      if (actionKeyMap[k]) {
        if (!e.repeat && onAction) onAction(actionKeyMap[k]);
        return;
      }
    }

    function handleUp(e) {
      var k = norm(e);
      if (keyMap[k]) held[keyMap[k]] = false;
    }

    function bind(onActionCb, onMenuCb) {
      onAction = onActionCb;
      onMenuKey = onMenuCb;

      window.addEventListener("keydown", handleDown, { passive: false });
      window.addEventListener("keyup", handleUp);

      // กันปุ่มค้างค้างอยู่เมื่อสลับหน้าต่าง
      window.addEventListener("blur", function () {
        held.left = held.right = held.up = held.down = false;
      });
    }

    // ---- ปุ่มสัมผัสบนจอ ----
    function bindTouchMove(el, dir) {
      if (!el) return;
      function down(ev) { ev.preventDefault(); held[dir] = true; el.classList.add("held"); }
      function up(ev) { ev.preventDefault(); held[dir] = false; el.classList.remove("held"); }
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointerleave", up);
      el.addEventListener("pointercancel", up);
    }

    // ผูกปุ่มสกิลบนจอ — ใช้ "pointerdown" ครั้งเดียวต่อการแตะ (ไม่เกิดเหตุการณ์ซ้ำ)
    function bindTouchSkill(el, action) {
      if (!el) return;
      var handler = function (ev) {
        ev.preventDefault();
        if (onAction) onAction(action);
      };
      el.addEventListener("pointerdown", handler);
      // fallback สำหรับอุปกรณ์/เบราว์เซอร์ที่ไม่รองรับ Pointer Events
      if (window.PointerEvent === undefined) {
        el.addEventListener("touchstart", function (ev) {
          ev.preventDefault();
          if (onAction) onAction(action);
        }, { passive: false });
      }
    }

    // เรียก action แบบครั้งเดียวจากภายนอก (เช่น ปุ่ม)
    function trigger(action) { if (onAction) onAction(action); }

    return {
      held: held,
      bind: bind,
      bindTouchMove: bindTouchMove,
      bindTouchSkill: bindTouchSkill,
      trigger: trigger
    };
  })();

  /* ===================== 5) PARTICLES ===================== */
  var Particles = (function () {
    var list = [];
    var MAX = 900;

    function add(p) {
      if (list.length >= MAX) list.shift();
      list.push(p);
    }

    function burst(x, y, color, count, speed, size, life) {
      for (var i = 0; i < count; i++) {
        var a = Math.random() * Math.PI * 2;
        var sp = Utils.rand(speed * 0.35, speed);
        add({
          kind: "spark",
          x: x, y: y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          r: Utils.rand(1.4, size || 4),
          life: 0,
          ttl: Utils.rand((life || 0.6) * 0.6, life || 0.6),
          color: color
        });
      }
    }

    function trail(x, y, color) {
      add({
        kind: "trail",
        x: x, y: y, vx: Utils.rand(-24, 24), vy: Utils.rand(-24, 24),
        r: Utils.rand(1.5, 3.5), life: 0, ttl: Utils.rand(0.25, 0.5), color: color
      });
    }

    function ring(x, y, color, maxR, life) {
      add({
        kind: "ring", x: x, y: y, vx: 0, vy: 0,
        r: 6, maxR: maxR, life: 0, ttl: life || 0.5, color: color, lw: 4
      });
    }

    // อัปเดตด้วย delta time เพื่อให้ความเร็วคงที่ทุก FPS
    function update(dt) {
      for (var i = list.length - 1; i >= 0; i--) {
        var p = list[i];
        p.life += dt;
        if (p.life >= p.ttl) { list.splice(i, 1); continue; }
        if (p.kind === "spark") {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.96;
          p.vy = p.vy * 0.96 + 120 * dt; // แรงโน้มถ่วงเบา ๆ
        } else if (p.kind === "trail") {
          p.x += p.vx * dt; p.y += p.vy * dt;
        } else if (p.kind === "ring") {
          var t = p.life / p.ttl;
          p.r = Utils.lerp(6, p.maxR, t * (2 - t)); // ขยายแบบ ease-out
        }
      }
    }

    function draw(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var t = p.life / p.ttl;
        var alpha = 1 - t;
        if (p.kind === "ring") {
          ctx.globalAlpha = alpha * 0.9;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.lw * (1 - t * 0.6);
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    function clear() { list.length = 0; }
    function count() { return list.length; }

    return { add: add, burst: burst, trail: trail, ring: ring, update: update, draw: draw, clear: clear, count: count };
  })();

  /* ===================== 6) PLAYER ===================== */
  var Player = (function () {
    var p = {
      x: 0, y: 0, w: CFG.PLAYER.w, h: CFG.PLAYER.h,
      facing: 1,
      shieldT: 0,       // โล่ที่ใช้งาน (ทั้งอัตโนมัติและกด Q)
      shieldSource: "", // "auto" | "skill"
      invulnT: 0,       // ช่วงอมตะสั้น ๆ
      dashT: 0,
      dashDir: 1,
      hearts: CFG.HEARTS_START,
      hurtFlash: 0,
      alive: true
    };

    function reset() {
      p.w = CFG.PLAYER.w; p.h = CFG.PLAYER.h;
      p.x = CFG.W / 2 - p.w / 2;
      p.y = CFG.H - 74;
      p.facing = 1;
      p.shieldT = 0; p.shieldSource = "";
      p.invulnT = 0; p.dashT = 0; p.dashDir = 1;
      p.hearts = CFG.HEARTS_START;
      p.hurtFlash = 0;
      p.alive = true;
    }

    function invulnerable() {
      return p.shieldT > 0 || p.invulnT > 0 || p.dashT > 0;
    }

    function update(dt, energyFreezeActive) {
      // ลดเวลาเอฟเฟกต์ลงตามเวลาจริง
      if (p.shieldT > 0) {
        p.shieldT -= dt;
        if (p.shieldT <= 0) {
          p.shieldT = 0;
          // หลังโล่หมด ให้มีช่วงกันโดนซ้ำสั้น ๆ
          p.invulnT = Math.max(p.invulnT, CFG.PLAYER.hurtInvuln);
          return "shieldEnd";
        }
      }
      if (p.invulnT > 0) p.invulnT -= dt;
      if (p.hurtFlash > 0) p.hurtFlash -= dt;

      var moving = false;

      // ---- Dash ทำงานก่อน (ล็อกทิศทางตอนเริ่ม) ----
      if (p.dashT > 0) {
        p.dashT -= dt;
        p.x += p.dashDir * CFG.PLAYER.dashSpeed * dt;
        // ร่องรอยแสง
        Particles.trail(p.x + p.w / 2, p.y + p.h / 2, "#00e5ff");
        Particles.trail(p.x + p.w / 2 - p.dashDir * 14, p.y + p.h / 2 + Utils.rand(-8, 8), "#a44dff");
      } else {
        // ---- เคลื่อนที่ปกติ ----
        var vx = 0, vy = 0;
        if (Input.held.left) { vx -= 1; }
        if (Input.held.right) { vx += 1; }
        if (Input.held.up) { vy -= 1; }
        if (Input.held.down) { vy += 1; }

        if (vx !== 0) p.facing = vx > 0 ? 1 : -1;
        if (vx !== 0 || vy !== 0) moving = true;

        // ปรับความเร็วแนวทแยงให้เท่ากัน
        var len = Math.sqrt(vx * vx + vy * vy) || 1;
        var sp = CFG.PLAYER.speed * dt;
        p.x += (vx / len) * sp;
        p.y += (vy / len) * sp;

        if (moving) {
          // อนุภาคร่องรอยการเคลื่อนที่
          if (Math.random() < 0.85) {
            Particles.trail(
              p.x + p.w / 2 - p.facing * 12,
              p.y + p.h - 4,
              Math.random() < 0.5 ? "#2f6bff" : "#00e5ff"
            );
          }
        }
      }

      // ขอบเขตสนาม: คุมในกรอบ
      p.x = Utils.clamp(p.x, 0, CFG.W - p.w);
      p.y = Utils.clamp(p.y, 60, CFG.H - p.h - 6);
    }

    // ใช้สกิล Dash — คืน true ถ้าใช้ได้
    function startDash() {
      var dirX = 0;
      if (Input.held.left) dirX -= 1;
      if (Input.held.right) dirX += 1;
      if (dirX === 0) dirX = 1;           // ไม่ได้กดทิศทาง -> พุ่งไปทางขวา
      p.dashDir = dirX;
      p.facing = dirX;
      p.dashT = CFG.PLAYER.dashTime;
      p.invulnT = Math.max(p.invulnT, CFG.PLAYER.dashInvuln);
      Particles.burst(p.x + p.w / 2, p.y + p.h / 2, "#00e5ff", 18, 260, 3, 0.45);
      return true;
    }

    function activateShield(seconds, source) {
      p.shieldT = Math.max(p.shieldT, seconds);
      p.shieldSource = source || "skill";
    }

    function takeDamage() {
      if (!p.alive || invulnerable()) return false;
      p.hearts -= 1;
      p.hurtFlash = 0.5;
      if (p.hearts <= 0) { p.hearts = 0; p.alive = false; }
      else {
        // กันโดนซ้ำทันทีหลังบาดเจ็บ
        p.invulnT = CFG.PLAYER.hurtInvuln;
      }
      return true;
    }

    function draw(ctx) {
      var cx = p.x + p.w / 2;
      var cy = p.y + p.h / 2;

      // กระพริบเมื่อบาดเจ็บ (แต่ยังไม่ตาย) : อมตะ/บาดเจ็บ -> วูบไปมา
      var blink = false;
      if (!p.alive) blink = true;
      else if (p.invulnT > 0 && p.shieldT <= 0) blink = (Math.floor(p.invulnT * 14) % 2 === 0);

      ctx.save();

      // ---- เงาเรืองแสงใต้ตัว ----
      ctx.globalCompositeOperation = "lighter";
      var g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 46);
      g.addColorStop(0, "rgba(0,229,255,0.35)");
      g.addColorStop(1, "rgba(0,229,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      if (!blink) {
        // ---- ตัวละคร: หกเหลี่ยมเรืองแสง ----
        ctx.save();
        ctx.translate(cx, cy);
        ctx.shadowColor = "#00e5ff";
        ctx.shadowBlur = 22;
        var bodyGrad = ctx.createLinearGradient(0, -p.h / 2, 0, p.h / 2);
        bodyGrad.addColorStop(0, "#ffffff");
        bodyGrad.addColorStop(0.45, "#7ce8ff");
        bodyGrad.addColorStop(1, "#2f6bff");
        ctx.fillStyle = bodyGrad;

        var r = p.w / 2;
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
          var ang = (Math.PI / 3) * i - Math.PI / 2;
          var px = Math.cos(ang) * r, py = Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // แกนกลางเรืองแสง
        ctx.shadowBlur = 30;
        ctx.fillStyle = p.hurtFlash > 0 ? "#ff2b47" : "#eaffff";
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();

        // ทิศทางการหัน
        ctx.shadowBlur = 12;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.moveTo(p.facing * 6, -4);
        ctx.lineTo(p.facing * 15, 0);
        ctx.lineTo(p.facing * 6, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // ---- วงแหวนโล่พลังงาน + นับถอยหลัง ----
      if (p.shieldT > 0) {
        var autoShield = (p.shieldSource === "auto");
        var color = autoShield ? "#a44dff" : "#2bff88";
        var pulse = 1 + Math.sin(performance.now() / 90) * 0.06;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 24;
        ctx.beginPath(); ctx.arc(cx, cy, 34 * pulse, 0, Math.PI * 2); ctx.stroke();

        // arc บอกเวลาที่เหลือ
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        var frac = Utils.clamp(p.shieldT / (autoShield ? CFG.AUTO_SHIELD : CFG.SKILLS.shield.dur), 0, 1);
        ctx.beginPath();
        ctx.arc(cx, cy, 40 * pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();
        ctx.restore();

        // ตัวเลขนับถอยหลังกลางจอ (3..2..1)
        var secs = Math.ceil(p.shieldT);
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "bold 15px Segoe UI, Arial";
        ctx.textAlign = "center";
        ctx.shadowColor = color; ctx.shadowBlur = 10;
        ctx.fillText(secs + "s", cx, cy - 44);
        ctx.restore();
      }

      ctx.restore();
    }

    return {
      state: p,
      reset: reset,
      update: update,
      draw: draw,
      invulnerable: invulnerable,
      startDash: startDash,
      activateShield: activateShield,
      takeDamage: takeDamage
    };
  })();

  /* ===================== 7) ENERGY ORB ===================== */
  var OrbSystem = (function () {
    var orbs = [];
    var timer = 4;
    var INTERVAL = 4.2;

    function reset() { orbs.length = 0; timer = 4; }

    function spawn() {
      var r = 13;
      orbs.push({
        x: Utils.rand(24, CFG.W - 24),
        y: -20,
        r: r,
        vy: Utils.rand(80, 130),
        phase: Math.random() * Math.PI * 2,
        bob: 0
      });
    }

    function update(dt, onCollect) {
      timer -= dt;
      if (timer <= 0) { timer = INTERVAL; spawn(); }

      var px = Player.state.x + Player.state.w / 2;
      var py = Player.state.y + Player.state.h / 2;

      for (var i = orbs.length - 1; i >= 0; i--) {
        var o = orbs[i];
        o.y += o.vy * dt;
        o.phase += dt * 3.2;
        o.bob = Math.sin(o.phase) * 5;

        // เก็บได้เมื่อถึงระดับผู้เล่นขึ้นไป (ไม่ต้องวิ่งไปรับ = ไม่ถูกบังคับให้เสี่ยงเกินไป)
        if (o.y > Player.state.y + Player.state.h + 40) {
          // ยังไม่เก็บ -> ลอยเลยจอ = หายไป
          if (o.y > CFG.H + 30) orbs.splice(i, 1);
          continue;
        }

        // ตรวจชนกับผู้เล่น
        var dx = o.x - px, dy = (o.y + o.bob) - py;
        var rr = o.r + Player.state.w / 2;
        if (dx * dx + dy * dy <= rr * rr) {
          Particles.burst(o.x, o.y + o.bob, "#2bff88", 22, 240, 3.4, 0.6);
          Particles.ring(o.x, o.y + o.bob, "#2bff88", 60, 0.45);
          orbs.splice(i, 1);
          if (onCollect) onCollect();
        }
      }
    }

    function draw(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (var i = 0; i < orbs.length; i++) {
        var o = orbs[i];
        var y = o.y + o.bob;

        // รัศมี
        var g = ctx.createRadialGradient(o.x, y, 1, o.x, y, o.r * 3);
        g.addColorStop(0, "rgba(43,255,136,0.95)");
        g.addColorStop(0.4, "rgba(43,255,136,0.35)");
        g.addColorStop(1, "rgba(43,255,136,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(o.x, y, o.r * 3, 0, Math.PI * 2); ctx.fill();

        // แกนพลังงาน
        ctx.shadowColor = "#2bff88";
        ctx.shadowBlur = 16;
        ctx.fillStyle = "#eafff4";
        ctx.beginPath(); ctx.arc(o.x, y, o.r * 0.62, 0, Math.PI * 2); ctx.fill();

        // วงแหวนหมุน
        ctx.strokeStyle = "rgba(43,255,136,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(o.x, y, o.r, o.phase, o.phase + Math.PI * 1.4);
        ctx.stroke();
      }
      ctx.restore();
    }

    return { reset: reset, update: update, draw: draw, list: orbs };
  })();

/* ===================== 8) BLOCK SYSTEM ===================== */
/*
   รูปแบบบล็อก:
     - "crusher" : บล็อกพื้นฐาน ตกลงมาตรง ๆ
     - "drift"   : บล็อกที่เคลื่อนที่ด้านข้าง (vx)
     - "breaker" : บล็อกที่ "แตกรับคะแนน" ได้ด้วย Nova Blast
     - "mega"    : บล็อกขนาดใหญ่ มี Warning Indicator ก่อนตก
*/
var BlockSystem = (function () {
  var blocks = [];
  var spawnTimer = 0;
  var megaTimer = 0;
  var spawnInterval = 1.35;   // วินาที
  var baseSpeed = CFG.BLOCK.baseSpeed;
  var warned = 0;             // วินาทีที่แจ้งเตือน mega

  function reset() {
    blocks.length = 0;
    spawnTimer = 0.6;
    megaTimer = CFG.BLOCK.megaEvery;
    spawnInterval = 1.35;
    baseSpeed = CFG.BLOCK.baseSpeed;
    warned = 0;
  }

  function currentSpeed() {
    return Math.min(CFG.BLOCK.maxSpeed, baseSpeed);
  }

  function setDifficulty(elapsed) {
    baseSpeed = CFG.BLOCK.baseSpeed + elapsed * CFG.BLOCK.speedGrowth;
    // ออกถี่ขึ้นเมื่อเวลาผ่านไป (แต่ไม่ถี่เกินไปจนหลบไม่ได้)
    spawnInterval = Math.max(0.42, 1.35 - elapsed * 0.016);
  }

  // สร้างบล็อกแถวเดียว: สุ่ม "ช่องว่าง" ให้ผู้เล่นหลบได้เสมอ
  function spawnRow(kind, opts) {
    opts = opts || {};
    var cols = Utils.randInt(2, 4);          // จำนวนบล็อกในแถว
    var minGapCols = 1;                      // ต้องเหลือช่องว่างอย่างน้อย 1 ช่อง
    var maxStart = Math.max(0, cols - minGapCols);
    var gapCol = Utils.randInt(0, maxStart);

    var pad = 8;
    var usableW = CFG.W - pad * 2;
    var colW = usableW / cols;

    for (var i = 0; i < cols; i++) {
      if (i === gapCol) continue;            // ช่องว่างที่ผู้เล่นใช้หลบ

      var w = colW - 10;
      var h = kind === "mega" ? 34 : 20;
      var x = pad + i * colW + 5;

      var b = {
        x: x,
        y: -(opts.yOffset || 0) - h - Utils.rand(0, 20),
        w: w,
        h: h,
        vx: 0,
        kind: kind || "crusher",
        speedMul: 1,
        hit: false,
        id: Math.random()
      };

      if (kind === "drift") {
        b.vx = Utils.rand(-90, 90);
        if (Math.abs(b.vx) < 30) b.vx = 60 * (Math.random() < 0.5 ? -1 : 1);
        b.speedMul = 0.85;
      }
      if (kind === "mega") {
        b.speedMul = 1.15;
        b.h = 34;
      }
      if (kind === "breaker") {
        b.speedMul = 0.95;
      }

      blocks.push(b);
    }
  }

  function pickKind(elapsed, level) {
    var r = Math.random();
    // เริ่มมี drift/breaker หลังผ่านไปพักหนึ่ง
    if (elapsed > 12 && r < 0.22) return "drift";
    if (elapsed > 8 && r < 0.40) return "breaker";
    return "crusher";
  }

  function update(dt, elapsed, level, onDodge, onCollide) {
    setDifficulty(elapsed);

    // ---- mega block + warning ----
    megaTimer -= dt;
    if (megaTimer <= 0) {
      megaTimer = CFG.BLOCK.megaEvery + Utils.rand(-1.5, 2.5);
      if (megaTimer < 3) megaTimer = 3;

      // เตือนล่วงหน้า: ให้ warning ก่อน แล้วค่อยปล่อย mega
      warned = 1.1;
      spawnRow("mega");
      if (onDodge === null) { /* ไม่ทำอะไร: กัน lint */ }
    }
    if (warned > 0) warned -= dt;

    // ---- spawn ปกติ ----
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = spawnInterval * Utils.rand(0.82, 1.18);
      spawnRow(pickKind(elapsed, level));
    }

    // ---- อัปเดตบล็อก ----
    var speed = currentSpeed();
    for (var i = blocks.length - 1; i >= 0; i--) {
      var b = blocks[i];
      b.y += speed * b.speedMul * dt;

      // drift: เคลื่อนที่ด้านข้างและสะท้อนขอบ
      if (b.kind === "drift") {
        b.x += b.vx * dt;
        if (b.x < 4) { b.x = 4; b.vx *= -1; }
        if (b.x + b.w > CFG.W - 4) { b.x = CFG.W - 4 - b.w; b.vx *= -1; }
      }

      // ชนผู้เล่น
      if (!b.hit && Utils.aabb(b, Player.state)) {
        b.hit = true;
        if (onCollide) onCollide(b);
        // หลังชน ให้ลบบล็อกนั้นออกทันทีเพื่อกันชนซ้ำในเฟรมถัดไป
        blocks.splice(i, 1);
        continue;
      }

      // หลุดจอด้านล่าง = หลบสำเร็จ
      if (b.y > CFG.H + 10) {
        blocks.splice(i, 1);
        if (onDodge) onDodge(b);
      }
    }
  }

  // Nova Blast: ทำลายบล็อกในรัศมี
  function destroyInRadius(cx, cy, radius) {
    var destroyed = 0;
    for (var i = blocks.length - 1; i >= 0; i--) {
      var b = blocks[i];
      var bx = b.x + b.w / 2, by = b.y + b.h / 2;
      var dx = bx - cx, dy = by - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        Particles.burst(bx, by, b.kind === "mega" ? "#ffa62b" : "#ff2b47", 16, 260, 4, 0.6);
        blocks.splice(i, 1);
        destroyed++;
      }
    }
    return destroyed;
  }

  function draw(ctx, frozen) {
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];

      var c1 = "#ff2b47", c2 = "#7a0016";
      if (b.kind === "drift")   { c1 = "#ffa62b"; c2 = "#7a3b00"; }
      if (b.kind === "breaker") { c1 = "#a44dff"; c2 = "#2a0a52"; }
      if (b.kind === "mega")    { c1 = "#ff5a2b"; c2 = "#5c0f0f"; }

      // แสงเรือง
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = c1;
      ctx.shadowBlur = b.kind === "mega" ? 26 : 14;
      ctx.globalAlpha = frozen ? 0.45 : 0.8;
      var grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      Utils.roundRect(ctx, b.x, b.y, b.w, b.h, 6);
      ctx.fill();
      ctx.restore();

      // ขอบใน
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255," + (frozen ? 0.25 : 0.45) + ")";
      ctx.lineWidth = 1.5;
      Utils.roundRect(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 5);
      ctx.stroke();

      // ลายวงจรไฟฟ้าในบล็อก
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x + 6, b.y + b.h / 2);
      ctx.lineTo(b.x + b.w - 6, b.y + b.h / 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // วาด Warning Indicator สำหรับ mega block
  function drawWarnings(ctx) {
    if (warned <= 0) return;
    var alpha = 0.25 + Math.abs(Math.sin(performance.now() / 110)) * 0.6;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#ff2b47";
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 9]);
    ctx.strokeRect(4, 4, CFG.W - 8, CFG.H - 8);
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ff2b47";
    ctx.font = "bold 14px Segoe UI, Arial";
    ctx.textAlign = "center";
    ctx.shadowColor = "#ff2b47"; ctx.shadowBlur = 14;
    ctx.fillText("⚠ WARNING — MEGA BLOCK INCOMING ⚠", CFG.W / 2, 34);
    ctx.restore();
  }

  function clear() { blocks.length = 0; }
  function count() { return blocks.length; }
  function isWarning() { return warned > 0; }

  return {
    reset: reset, update: update, draw: draw, drawWarnings: drawWarnings,
    destroyInRadius: destroyInRadius, clear: clear, count: count,
    isWarning: isWarning, list: blocks
  };
})();

/* ===================== 9) SKILLS (Q / E / R / Shift) ===================== */
var Skills = (function () {
  var defs = {
    shieldQ:    { cd: CFG.SKILLS.shield.cd, label: "SHIELD",    cost: 0 },
    freezeE:    { cd: CFG.SKILLS.freeze.cd, label: "FREEZE",    cost: 0 },
    novaR:      { cd: CFG.SKILLS.nova.cd,   label: "NOVA",      cost: CFG.SKILLS.nova.cost },
    dashShift:  { cd: CFG.SKILLS.dash.cd,   label: "DASH",      cost: 0 }
  };

  var cd = { shieldQ: 0, freezeE: 0, novaR: 0, dashShift: 0 };
  var active = { shieldQ: 0, freezeE: 0, dashShift: 0 };  // เวลาที่สกิลยังทำงานอยู่

  var energy = CFG.ENERGY.start;
  var freezeVisualT = 0;

  function reset() {
    cd.shieldQ = cd.freezeE = cd.novaR = cd.dashShift = 0;
    active.shieldQ = active.freezeE = active.dashShift = 0;
    energy = CFG.ENERGY.start;
    freezeVisualT = 0;
  }

  function addEnergy(v) {
    energy = Utils.clamp(energy + v, 0, CFG.ENERGY.max);
  }

  function update(dt) {
    for (var k in cd) if (cd[k] > 0) cd[k] = Math.max(0, cd[k] - dt);
    for (var a in active) if (active[a] > 0) active[a] = Math.max(0, active[a] - dt);
    if (freezeVisualT > 0) freezeVisualT -= dt;
  }

  function isFrozen() { return active.freezeE > 0; }
  function freezeVisual() { return freezeVisualT; }

  // ใช้สกิล — คืนค่าเป็น object { ok, reason }
  function use(name) {
    var d = defs[name];
    if (!d) return { ok: false, reason: "unknown" };
    if (cd[name] > 0) return { ok: false, reason: "cooldown" };
    if (d.cost > 0 && energy < d.cost) return { ok: false, reason: "energy" };
    if (!Player.state.alive) return { ok: false, reason: "dead" };

    if (name === "shieldQ") {
      Player.activateShield(CFG.SKILLS.shield.dur, "skill");
      active.shieldQ = CFG.SKILLS.shield.dur;
      cd.shieldQ = d.cd;
      Audio2.shield();
      Particles.ring(Player.state.x + Player.state.w / 2, Player.state.y + Player.state.h / 2, "#2bff88", 90, 0.55);
      FX.message("SHIELD ACTIVATED", "good");
    }

    if (name === "freezeE") {
      active.freezeE = CFG.SKILLS.freeze.dur;
      freezeVisualT = CFG.SKILLS.freeze.dur;
      cd.freezeE = d.cd;
      Audio2.freeze();
      FX.message("TIME FROZEN", "");
    }

    if (name === "novaR") {
      energy -= d.cost;
      cd.novaR = d.cd;
      var cx = Player.state.x + Player.state.w / 2;
      var cy = Player.state.y + Player.state.h / 2;
      var n = BlockSystem.destroyInRadius(cx, cy, CFG.SKILLS.nova.radius);
      Particles.ring(cx, cy, "#a44dff", CFG.SKILLS.nova.radius, 0.6);
      Particles.ring(cx, cy, "#00e5ff", CFG.SKILLS.nova.radius * 0.7, 0.45);
      Particles.burst(cx, cy, "#a44dff", 40, 420, 4.5, 0.8);
      Audio2.nova();
      FX.shake(9, 0.35);
      FX.message(n > 0 ? "NOVA BLAST — " + n + " DESTROYED" : "NOVA BLAST", "");
    }

    if (name === "dashShift") {
      Player.startDash();
      active.dashShift = CFG.PLAYER.dashTime;
      cd.dashShift = d.cd;
      Audio2.dash();
    }

    return { ok: true };
  }

  function cdFrac(name) {
    var d = defs[name];
    if (!d || d.cd <= 0) return 0;
    return Utils.clamp(cd[name] / d.cd, 0, 1);
  }

  function isReady(name) { return cd[name] <= 0; }

  return {
    defs: defs, reset: reset, update: update, use: use,
    addEnergy: addEnergy, cdFrac: cdFrac, isReady: isReady,
    isFrozen: isFrozen, freezeVisual: freezeVisual,
    getEnergy: function () { return energy; },
    getCd: function (n) { return cd[n]; },
    isActive: function (n) { return active[n] > 0; }
  };
})();

/* ===================== 10) FX (screen shake + ข้อความกลางจอ) ===================== */
var FX = (function () {
  var shakeT = 0, shakeDur = 0, shakeMag = 0;
  var msgEl = null, comboEl = null;
  var msgTimer = null;

  function bind() {
    msgEl = document.getElementById("centerMsg");
    comboEl = document.getElementById("comboLabel");
  }

  function shake(mag, dur) {
    // ใช้ค่าที่แรงกว่า ถ้ามาซ้อนกัน
    if (mag >= shakeMag || shakeT <= 0) {
      shakeMag = mag;
      shakeDur = dur;
      shakeT = dur;
    }
  }

  function update(dt) {
    if (shakeT > 0) {
      shakeT -= dt;
      if (shakeT <= 0) { shakeT = 0; shakeMag = 0; }
    }
  }

  // ออฟเซ็ตให้กล้องสั่น
  function offset() {
    if (shakeT <= 0) return { x: 0, y: 0 };
    var k = shakeT / shakeDur;
    var m = shakeMag * k;
    return { x: Utils.rand(-m, m), y: Utils.rand(-m, m) };
  }

  function message(text, cls) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.className = "";
    if (cls) msgEl.className = cls;
    // รีสตาร์ทอนิเมชัน
    void msgEl.offsetWidth;
    msgEl.classList.add("show");
  }

  function combo(text) {
    if (!comboEl) return;
    comboEl.textContent = text;
    comboEl.classList.add("show");
    comboEl.classList.add("bump");
    setTimeout(function () { comboEl.classList.remove("bump"); }, 130);
  }

  function comboHide() {
    if (comboEl) comboEl.classList.remove("show");
  }

  return { bind: bind, shake: shake, update: update, offset: offset, message: message, combo: combo, comboHide: comboHide };
})();

/* ===================== 11) UI ===================== */
var UI = (function () {
  var el = {};

  function bind() {
    el.score = document.getElementById("score");
    el.best = document.getElementById("best");
    el.time = document.getElementById("time");
    el.energyFill = document.getElementById("energyFill");
    el.energyText = document.getElementById("energyText");
    el.hearts = document.querySelectorAll("#hearts .heart");
    el.skills = document.querySelectorAll("#skillBar .skill");
    el.startScreen = document.getElementById("startScreen");
    el.pauseScreen = document.getElementById("pauseScreen");
    el.gameOverScreen = document.getElementById("gameOverScreen");
    el.playBtn = document.getElementById("playBtn");
    el.resumeBtn = document.getElementById("resumeBtn");
    el.restartBtnPause = document.getElementById("restartBtnPause");
    el.playAgainBtn = document.getElementById("playAgainBtn");
    el.menuBtn = document.getElementById("menuBtn");
    el.soundBtn = document.getElementById("soundBtn");
    el.pauseBtn = document.getElementById("pauseBtn");
    el.finalScore = document.getElementById("finalScore");
    el.finalBest = document.getElementById("finalBest");
    el.finalTime = document.getElementById("finalTime");
    el.finalLevel = document.getElementById("finalLevel");
    el.newRecord = document.getElementById("newRecord");
  }

  function show(screen) {
    [el.startScreen, el.pauseScreen, el.gameOverScreen].forEach(function (s) {
      if (s) s.classList.toggle("show", s === screen);
    });
  }
  function hideAll() { show(null); }

  function setScore(v) { if (el.score) el.score.textContent = v; }
  function setBest(v) { if (el.best) el.best.textContent = v; }
  function setTime(sec) { if (el.time) el.time.textContent = Utils.formatTime(sec); }

  function setEnergy(v, max) {
    if (!el.energyFill) return;
    var f = Utils.clamp(v / max, 0, 1);
    el.energyFill.style.width = (f * 100).toFixed(1) + "%";
    el.energyFill.classList.toggle("low", f < 0.3);
    el.energyFill.classList.toggle("full", f >= 0.999);
    if (el.energyText) el.energyText.textContent = Math.floor(v) + " / " + max;
  }

  function setHearts(n, max) {
    if (!el.hearts) return;
    for (var i = 0; i < el.hearts.length; i++) {
      var h = el.hearts[i];
      if (!h) continue;
      var dead = i >= n;
      if (dead && !h.classList.contains("dead")) h.classList.add("dead");
      if (!dead) h.classList.remove("dead");
    }
  }

  function setSkillCd(name, frac) {
    if (!el.skills) return;
    for (var i = 0; i < el.skills.length; i++) {
      var s = el.skills[i];
      if (s.getAttribute("data-skill") !== name) continue;
      var cdEl = s.querySelector(".cd");
      if (cdEl) cdEl.style.height = (frac * 100).toFixed(1) + "%";
      s.classList.toggle("cooling", frac > 0);
      s.classList.toggle("ready", frac <= 0);
      return;
    }
  }

  function setSkillActive(name, on) {
    if (!el.skills) return;
    for (var i = 0; i < el.skills.length; i++) {
      var s = el.skills[i];
      if (s.getAttribute("data-skill") !== name) continue;
      s.classList.toggle("active", !!on);
      return;
    }
  }

  function setSoundLabel(on) {
    if (el.soundBtn) el.soundBtn.textContent = on ? "🔊 SOUND" : "🔇 MUTED";
  }

  function showGameOver(data) {
    if (el.finalScore) el.finalScore.textContent = data.score;
    if (el.finalBest) el.finalBest.textContent = data.best;
    if (el.finalTime) el.finalTime.textContent = Utils.formatTime(data.time);
    if (el.finalLevel) el.finalLevel.textContent = data.level;
    if (el.newRecord) el.newRecord.textContent = data.newRecord ? "★ NEW HIGH SCORE ★" : "";
    show(el.gameOverScreen);
  }

  return {
    bind: bind, show: show, hideAll: hideAll, el: el,
    setScore: setScore, setBest: setBest, setTime: setTime,
    setEnergy: setEnergy, setHearts: setHearts,
    setSkillCd: setSkillCd, setSkillActive: setSkillActive,
    setSoundLabel: setSoundLabel, showGameOver: showGameOver
  };
})();

/* ===================== 12) GAME ===================== */
var Game = (function () {
  var canvas, ctx;
  var running = false;
  var paused = false;
  var state = "menu";          // menu | playing | paused | over
  var lastTime = 0;
  var rafId = null;
  var destroyed = false;       // true = หยุด game loop แล้ว

  var score = 0;
  var elapsed = 0;
  var level = 1;
  var nextLevelAt = CFG.DIFFICULTY_STEP;
  var best = 0;

  var combo = 0;
  var comboTimer = 0;
  var COMBO_WINDOW = 2.0;

  var autoShieldUsed = false;

  var bgParticles = [];   // อนุภาคพื้นหลัง
  var stars = [];         // จุดแสงพื้นหลัง

  /* ---------- setup ---------- */
  function init() {
    canvas = document.getElementById("game");
    if (!canvas) { console.error("ไม่พบ canvas #game"); return; }
    ctx = canvas.getContext("2d");

    UI.bind();
    FX.bind();

    // โหลด Best Score
    try {
      var b = localStorage.getItem("neonSurvivorBest");
      best = b ? (parseInt(b, 10) || 0) : 0;
    } catch (e) { best = 0; }
    UI.setBest(best);

    // ---- ผูกปุ่มเมนู ----
    if (UI.el.playBtn) UI.el.playBtn.addEventListener("click", function () { Audio2.unlock(); Audio2.ui(); startGame(); });
    if (UI.el.playAgainBtn) UI.el.playAgainBtn.addEventListener("click", function () { Audio2.ui(); startGame(); });
    if (UI.el.menuBtn) UI.el.menuBtn.addEventListener("click", function () { Audio2.ui(); toMenu(); });
    if (UI.el.resumeBtn) UI.el.resumeBtn.addEventListener("click", function () { Audio2.ui(); resume(); });
    if (UI.el.restartBtnPause) UI.el.restartBtnPause.addEventListener("click", function () { Audio2.ui(); startGame(); });
    if (UI.el.pauseBtn) UI.el.pauseBtn.addEventListener("click", function () { togglePause(); });

    // ---- ปุ่มเสียง ----
    if (UI.el.soundBtn) UI.el.soundBtn.addEventListener("click", function () {
      var on = !Audio2.isEnabled();
      Audio2.setEnabled(on);
      UI.setSoundLabel(on);
    });
    UI.setSoundLabel(false);   // เริ่มต้น = ปิดเสียง (ไม่ดังอัตโนมัติ)

    // ---- Input ----
    Input.bind(onAction, onMenuKey);
    Input.bindTouchMove(document.querySelector('[data-move="left"]'), "left");
    Input.bindTouchMove(document.querySelector('[data-move="right"]'), "right");
    // สำคัญ: ต้องเจาะจงปุ่มใน #touchControls เท่านั้น
    // เพราะ [data-skill] มีอยู่ทั้งแถบ HUD (#skillBar) และปุ่มบนจอ
    // ถ้าใช้ selector กว้าง ๆ จะไปผูกผิด element ทำให้ปุ่มบนจอกดไม่ติด
    var tc = document.getElementById("touchControls");
    var q = function (name) {
      return tc ? tc.querySelector('[data-skill="' + name + '"]') : null;
    };
    Input.bindTouchSkill(q("shieldQ"), "shieldQ");
    Input.bindTouchSkill(q("freezeE"), "freezeE");
    Input.bindTouchSkill(q("novaR"), "novaR");
    Input.bindTouchSkill(q("dashShift"), "dashShift");

    // ---- ลากนิ้ว/เมาส์บน canvas เพื่อเลื่อนตัวละคร ----
    bindCanvasDrag();

    // ---- ปรับขนาด canvas ตาม DPR ----
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    initBackground();

    Player.reset();
    drawStatic();

    // เริ่ม loop หลัก
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- ปรับความละเอียด canvas ---------- */
  function resizeCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    var cssW = rect.width || CFG.W;
    // คงสัดส่วนภาพ 480x720
    var ratio = CFG.H / CFG.W;
    var cssH = cssW * ratio;

    canvas.width = Math.round(CFG.W * dpr);
    canvas.height = Math.round(CFG.H * dpr);
    canvas.style.height = cssH + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- ลากบน canvas ---------- */
  function bindCanvasDrag() {
    var dragging = false;
    function toWorld(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      return {
        x: (clientX - r.left) * (CFG.W / r.width),
        y: (clientY - r.top) * (CFG.H / r.height)
      };
    }
    canvas.addEventListener("pointerdown", function (e) {
      if (state !== "playing" || paused) return;
      dragging = true;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!dragging || state !== "playing" || paused) return;
      var p = toWorld(e.clientX, e.clientY);
      var s = Player.state;
      s.x = Utils.clamp(p.x - s.w / 2, 0, CFG.W - s.w);
      s.y = Utils.clamp(p.y - s.h / 2, 60, CFG.H - s.h - 6);
    });
    function end() { dragging = false; }
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointerleave", end);
    canvas.addEventListener("pointercancel", end);
  }

  /* ---------- พื้นหลัง: ดาว + อนุภาคแสง ---------- */
  function initBackground() {
    stars.length = 0;
    for (var i = 0; i < 60; i++) {
      stars.push({
        x: Utils.rand(0, CFG.W),
        y: Utils.rand(0, CFG.H),
        r: Utils.rand(0.6, 1.8),
        v: Utils.rand(8, 34),
        a: Utils.rand(0.25, 0.9)
      });
    }
    bgParticles.length = 0;
    for (var j = 0; j < 26; j++) {
      bgParticles.push({
        x: Utils.rand(0, CFG.W),
        y: Utils.rand(0, CFG.H),
        r: Utils.rand(1, 3),
        v: Utils.rand(14, 46),
        color: Utils.pick(["#00e5ff", "#a44dff", "#2f6bff"])
      });
    }
  }

  /* ---------- เริ่ม / รีเซ็ต ---------- */
  function startGame() {
    // รีเซ็ตทุกอย่างครบถ้วน (ไม่มีบล็อกเก่าหลงเหลือ)
    BlockSystem.reset();
    OrbSystem.reset();
    Skills.reset();
    Particles.clear();
    Player.reset();
    initBackground();

    score = 0;
    elapsed = 0;
    level = 1;
    nextLevelAt = CFG.DIFFICULTY_STEP;
    combo = 0;
    comboTimer = 0;
    autoShieldUsed = false;

    UI.setScore(0);
    UI.setTime(0);
    UI.setHearts(Player.state.hearts, CFG.HEARTS_START);
    UI.setEnergy(Skills.getEnergy(), CFG.ENERGY.max);
    FX.comboHide();

    paused = false;
    state = "playing";
    running = true;
    UI.hideAll();

    FX.message("SURVIVE!", "good");

    lastTime = performance.now();
  }

  function toMenu() {
    state = "menu";
    paused = false;
    running = false;
    BlockSystem.clear();
    Particles.clear();
    Player.reset();
    drawStatic();
    UI.show(UI.el.startScreen);
    UI.setHearts(CFG.HEARTS_START, CFG.HEARTS_START);
    UI.setScore(0);
    UI.setTime(0);
    UI.setBest(best);
  }

  function gameOver() {
    if (state === "over") return;
    state = "over";
    running = false;

    // ปัดคะแนนเป็นจำนวนเต็มก่อนเทียบ/บันทึกสถิติ
    score = Math.floor(score);

    // ตรึงค่า HUD ให้ตรงกับสถานะสุดท้าย (กัน HUD ค้างค่าก่อนหน้า)
    // เพราะ gameOver() อาจถูกเรียกกลางเฟรมจาก onCollide ก่อนถึงบรรทัด updateHud()
    updateHud();

    var newRecord = score > best;
    if (newRecord) {
      best = score;
      try { localStorage.setItem("neonSurvivorBest", String(best)); } catch (e) {}
      UI.setBest(best);
    }

    Particles.burst(Player.state.x + Player.state.w / 2, Player.state.y + Player.state.h / 2, "#ff2b47", 60, 460, 5, 1.0);
    Particles.ring(Player.state.x + Player.state.w / 2, Player.state.y + Player.state.h / 2, "#ff2b47", 180, 0.8);
    FX.shake(16, 0.5);
    Audio2.over();

    UI.showGameOver({
      score: Math.floor(score),
      best: best,
      time: elapsed,
      level: level,
      newRecord: newRecord
    });
  }

  function togglePause() {
    if (state === "playing" && !paused) pause();
    else if (state === "paused") resume();
  }
  function pause() {
    if (state !== "playing") return;
    paused = true;
    state = "paused";
    UI.show(UI.el.pauseScreen);
    Audio2.ui();
  }
  function resume() {
    if (state !== "paused") return;
    paused = false;
    state = "playing";
    UI.hideAll();
    lastTime = performance.now();
    Audio2.ui();
  }

  /* ---------- ปุ่มกด ---------- */
  // จุดเดียวที่เรียกใช้สกิลทั้งหมด (คีย์บอร์ด + ปุ่มบนจอ)
  // ถ้าไม่กำลังเล่นอยู่จะไม่ทำอะไร -> กดแล้วไม่เกิดเหตุการณ์ซ้ำ/บั๊ก
  function onAction(name) {
    if (state !== "playing" || paused) return;
    var res = Skills.use(name);
    if (!res.ok) {
      if (res.reason === "energy") FX.message("NOT ENOUGH ENERGY", "danger");
      else if (res.reason === "cooldown") { /* เงียบ ไม่รบกวน */ }
    } else {
      // อัปเดต HUD ทันทีเพื่อให้ Energy/Cooldown ตรงกับที่เพิ่งใช้ไป
      updateHud();
    }
  }

  function onMenuKey(key) {
    if (key === "escape") { togglePause(); return; }
    if (state === "menu" && (key === "enter" || key === " " || key === "spacebar")) {
      audioUnlockThen(startGame);
    } else if (state === "over" && (key === "enter" || key === " " || key === "spacebar")) {
      audioUnlockThen(startGame);
    } else if (state === "paused" && (key === "enter" || key === " ")) {
      resume();
    }
  }

  function audioUnlockThen(fn) {
    Audio2.unlock();
    fn();
  }

  /* ---------- เหตุการณ์ในเกม ---------- */
  function onDodge(block) {
    // หลบบล็อกสำเร็จ
    score += CFG.SCORE.dodge;
    combo++;
    comboTimer = COMBO_WINDOW;

    if (combo > 0 && combo % 10 === 0) {
      var bonus = combo * 2;
      score += bonus;
      FX.combo("COMBO x" + combo + "  +" + bonus);
      Audio2.point();
    } else if (combo >= 3) {
      FX.combo("x" + combo);
    }
  }

  function onCollide(block) {
    // ถ้าไม่ถึงตายจริง (มีโล่/อมตะ) takeDamage จะคืน false
    var damaged = Player.takeDamage();

    Particles.burst(
      block.x + block.w / 2, block.y + block.h / 2,
      "#ffa62b", 26, 340, 4, 0.6
    );

    if (!damaged) {
      // ชนแต่ไม่เสียหัวใจ (โล่/อมตะ) — แค่เอฟเฟกต์เบา ๆ
      FX.shake(4, 0.15);
      return;
    }

    // เสียหัวใจจริง
    Audio2.hurt();
    FX.shake(12, 0.4);
    combo = 0;
    FX.comboHide();
    Particles.burst(Player.state.x + Player.state.w / 2, Player.state.y + Player.state.h / 2, "#ff2b47", 34, 380, 4.6, 0.7);

    // หัวใจหมด -> Game Over
    if (!Player.state.alive) {
      UI.setHearts(0, CFG.HEARTS_START);
      gameOver();
      return;
    }

    UI.setHearts(Player.state.hearts, CFG.HEARTS_START);

    // เปิดโล่อัตโนมัติ "ครั้งแรก" ที่เสียหัวใจ
    if (!autoShieldUsed) {
      autoShieldUsed = true;
      Player.activateShield(CFG.AUTO_SHIELD, "auto");
      Audio2.shield();
      FX.message("SHIELD ACTIVATED", "good");
      Particles.ring(Player.state.x + Player.state.w / 2, Player.state.y + Player.state.h / 2, "#a44dff", 120, 0.7);
    } else {
      // เสียหัวใจครั้งถัดไป -> กระพริบแสดงสถานะบาดเจ็บ
      FX.message("DAMAGE!", "danger");
    }
  }

  function onOrbCollect() {
    Skills.addEnergy(CFG.ENERGY.orbGain);
    score += CFG.SCORE.orb;
    Audio2.orb();
    FX.message("+" + CFG.ENERGY.orbGain + " ENERGY", "good");
  }

  function onShieldEnd() {
    Audio2.shieldEnd();
    FX.message("SHIELD EXPIRED", "danger");
    Particles.burst(Player.state.x + Player.state.w / 2, Player.state.y + Player.state.h / 2, "#a44dff", 26, 300, 4, 0.6);
    Particles.ring(Player.state.x + Player.state.w / 2, Player.state.y + Player.state.h / 2, "#a44dff", 110, 0.5);
  }

  /* ---------- อัปเดต HUD (แยกออกมาให้เรียกได้จากทุกสถานะ) ---------- */
  function updateHud() {
    UI.setScore(Math.floor(score));
    UI.setTime(elapsed);
    UI.setEnergy(Skills.getEnergy(), CFG.ENERGY.max);

    UI.setSkillCd("shieldQ", Skills.cdFrac("shieldQ"));
    UI.setSkillCd("freezeE", Skills.cdFrac("freezeE"));
    UI.setSkillCd("novaR", Skills.cdFrac("novaR"));
    UI.setSkillCd("dashShift", Skills.cdFrac("dashShift"));

    UI.setSkillActive("shieldQ", Skills.isActive("shieldQ"));
    UI.setSkillActive("freezeE", Skills.isActive("freezeE"));
    UI.setSkillActive("dashShift", Skills.isActive("dashShift"));
  }

  /* ---------- อัปเดต ---------- */
  function update(dt) {
    if (state !== "playing" || paused) return;

    elapsed += dt;

    // ---- คะแนนตามเวลา (ปัดเป็นจำนวนเต็ม) ----
    score += CFG.SCORE.perSecond * dt;

    // ---- เพิ่มระดับความยากทุก 30 วินาที ----
    if (elapsed >= nextLevelAt) {
      nextLevelAt += CFG.DIFFICULTY_STEP;
      level++;
      FX.message("DANGER LEVEL UP", "danger");
      FX.shake(10, 0.45);
      Audio2.levelUp();
    }

    // ---- สกิล / player ----
    Skills.update(dt);
    var ev = Player.update(dt, Skills.isFrozen());
    if (ev === "shieldEnd") onShieldEnd();

    // ---- บล็อก (หยุดเมื่อ Time Freeze) ----
    if (!Skills.isFrozen()) {
      BlockSystem.update(dt, elapsed, level, onDodge, onCollide);
    } else {
      // ระหว่าง freeze: บล็อกหยุดนิ่ง แต่ยังต้องเช็คการชนที่เกิดขึ้นก่อน freeze
      // (ไม่ขยับ = ไม่เกิดการชนใหม่)
    }

    // ---- orb ----
    OrbSystem.update(dt, onOrbCollect);

    // ---- combo timer ----
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) { combo = 0; FX.comboHide(); }
    }

    // ---- particles / fx ----
    Particles.update(dt);
    FX.update(dt);

    // ---- พื้นหลัง ----
    updateBackground(dt);

    // ---- อัปเดต HUD ----
    updateHud();
  }

  function updateBackground(dt) {
    var i;
    for (i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y += s.v * dt;
      if (s.y > CFG.H) { s.y = -2; s.x = Utils.rand(0, CFG.W); }
    }
    for (i = 0; i < bgParticles.length; i++) {
      var p = bgParticles[i];
      p.y += p.v * dt;
      if (p.y > CFG.H) { p.y = -4; p.x = Utils.rand(0, CFG.W); }
    }
  }

  /* ---------- วาด ---------- */
  function drawBackground() {
    // พื้นหลังไล่สี
    var g = ctx.createLinearGradient(0, 0, 0, CFG.H);
    g.addColorStop(0, "#060b1c");
    g.addColorStop(0.55, "#04070f");
    g.addColorStop(1, "#080312");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CFG.W, CFG.H);

    // เส้น grid เคลื่อนไหว
    var t = performance.now() / 1000;
    var gridSize = 48;
    var offY = (t * 26) % gridSize;
    ctx.save();
    ctx.strokeStyle = "rgba(0,229,255,0.10)";
    ctx.lineWidth = 1;
    for (var x = 0; x <= CFG.W; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CFG.H); ctx.stroke();
    }
    for (var y = -gridSize; y <= CFG.H + gridSize; y += gridSize) {
      var yy = y + offY;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(CFG.W, yy); ctx.stroke();
    }

    // เส้นขอบสนามเรืองแสง
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "rgba(47,107,255,0.35)";
    ctx.strokeRect(1, 1, CFG.W - 2, CFG.H - 2);
    ctx.restore();

    // ดาว/อนุภาคพื้นหลัง
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = s.a;
      ctx.fillStyle = "#cfefff";
      ctx.fillRect(s.x, s.y, s.r, s.r * 3);
    }
    for (var j = 0; j < bgParticles.length; j++) {
      var p = bgParticles[j];
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawFreezeOverlay() {
    var v = Skills.freezeVisual();
    if (v <= 0) return;
    var max = CFG.SKILLS.freeze.dur;
    var alpha = 0.16 * (v / max) + 0.05;
    ctx.save();
    ctx.fillStyle = "rgba(90,200,255," + alpha.toFixed(3) + ")";
    ctx.fillRect(0, 0, CFG.W, CFG.H);

    // เกล็ดน้ำแข็งที่ขอบ
    ctx.strokeStyle = "rgba(180,240,255," + (0.5 * (v / max) + 0.15).toFixed(3) + ")";
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, CFG.W - 6, CFG.H - 6);
    ctx.restore();
  }

  function drawStatic() {
    // ภาพนิ่งตอนอยู่เมนู
    drawBackground();
    ctx.save();
    ctx.fillStyle = "rgba(127,146,182,0.55)";
    ctx.font = "bold 14px Segoe UI, Arial";
    ctx.textAlign = "center";
    ctx.fillText("READY FOR DEPLOYMENT", CFG.W / 2, CFG.H / 2);
    ctx.restore();
  }

  function draw() {
    var off = FX.offset();
    ctx.setTransform(currentDPR(), 0, 0, currentDPR(), 0, 0);

    drawBackground();

    ctx.save();
    ctx.translate(off.x, off.y);

    // ลำดับการวาด: บล็อก -> orb -> player -> particles
    BlockSystem.draw(ctx, Skills.isFrozen());
    OrbSystem.draw(ctx);
    if (state === "playing" || state === "paused") Player.draw(ctx);
    Particles.draw(ctx);

    // warning ของ mega block
    if (state === "playing") BlockSystem.drawWarnings(ctx);

    ctx.restore();

    // overlay freeze ทับทุกอย่าง
    if (Skills.freezeVisual() > 0) drawFreezeOverlay();

    // ถ้าอยู่เมนู ให้วาดข้อความแนะนำทับ
    if (state === "menu") {
      ctx.save();
      ctx.fillStyle = "rgba(0,229,255,0.75)";
      ctx.font = "bold 13px Segoe UI, Arial";
      ctx.textAlign = "center";
      ctx.fillText("เกมพร้อมเล่น — กด PLAY เพื่อเริ่ม", CFG.W / 2, CFG.H - 30);
      ctx.restore();
    }
  }

  function currentDPR() {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  /* ---------- GAME LOOP ---------- */
  // ใช้ requestAnimationFrame แบบ delta time -> ความเร็วคงที่ทุก FPS
  // หยุด schedule เมื่อออกจากหน้า/ทำลายเกม
  var MAX_DT = 0.1;      // จำกัด delta สูงสุดต่อเฟรม (กันสลับแท็บแล้วเกมกระโดด)
  var STEP = 1 / 60;     // ขนาดก้าวตรรกะคงที่ (fixed timestep)
  var acc = 0;           // เวลาสะสมที่ยังไม่ถูกประมวลผล

  function loop(now) {
    if (destroyed) return;
    rafId = requestAnimationFrame(loop);

    var dt = (now - lastTime) / 1000;
    lastTime = now;

    // กันค่าเพี้ยน (tab switch / clock เพี้ยน) — แต่ไม่ตัดจนเวลาหาย
    // ใช้ accumulator: เวลาที่เกินจะถูกเก็บไว้ในเฟรมถัดไป ไม่หายไป
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;   // เพดานกันเกมกระโดดหลังสลับแท็บ

    acc += dt;

    // ประมวลผลตรรกะแบบก้าวคงที่ -> ความเร็วเท่ากันทุก FPS
    var steps = 0;
    while (acc >= STEP && steps < 5) {
      update(STEP);
      acc -= STEP;
      steps++;
      if (state !== "playing" || paused) break;  // ออกเมื่อเกมหยุด/ตาย
    }
    // ถ้าหยุดเล่น ให้ล้างเวลาที่ค้างอยู่ ไม่ให้ไหลไปเฟรมหน้า
    if (state !== "playing" || paused) acc = 0;

    draw();
  }

  function destroy() {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  return {
    init: init, startGame: startGame, toMenu: toMenu,
    getState: function () { return state; }, destroy: destroy
  };
})();

/* ===================== BOOT ===================== */
// ตัวนับ instance: กันการรันสคริปต์ซ้ำ (จะทำให้มี game loop ซ้อนกัน 2 ตัว)
var __INSTANCE = (window.__NEON_INSTANCE__ = (window.__NEON_INSTANCE__ || 0) + 1);

if (__INSTANCE > 1) {
  // ถูกรันซ้ำ — ไม่ต้อง boot ใหม่และไม่ต้องเขียนทับ NeonSurvivor
  return;
}

// ตรวจสอบ readyState ด้วย: ถ้า DOM พร้อมแล้ว (สคริปต์ถูกโหลดทีหลัง/รันจาก cache)
// event DOMContentLoaded จะไม่ยิงอีก จึงต้องเรียก init เองทันที
function boot() {
  if (boot.done) return;
  boot.done = true;
  Game.init();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
// เผื่อกรณีพิเศษ: DOM ยังไม่พร้อมแต่ event ถูกยิงไปแล้ว
window.addEventListener("load", boot);

// เปิดเผยบางส่วนไว้ debug (ไม่กระทบการเล่น)
window.NeonSurvivor = {
  config: CFG,
  player: Player,
  skills: Skills,
  blocks: BlockSystem,
  game: Game
};

})();
