// เกม "block" - หลบแท่ง block ที่ตกลงมา
(function () {
  "use strict";

  var canvas = document.getElementById("game");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var W = canvas.width;   // 420
  var H = canvas.height;  // 560

  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var messageEl = document.getElementById("message");
  var startBtn = document.getElementById("start");
  var leftBtn = document.getElementById("left");
  var rightBtn = document.getElementById("right");

  // ---------- สถานะเกม ----------
  var STATE = { READY: "ready", PLAYING: "playing", OVER: "over" };
  var state = STATE.READY;

  var player = {
    w: 46,
    h: 46,
    x: W / 2 - 23,
    y: H - 70,
    speed: 6,
    vx: 0
  };

  var blocks = [];
  var score = 0;
  var best = 0;
  var frames = 0;
  var spawnEvery = 55;     // ทุกกี่เฟรมจะปล่อย block ใหม่
  var baseFall = 3.2;      // ความเร็วตกเริ่มต้น
  var fallSpeed = baseFall;
  var spawnTimer = 0;

  // ---------- อ่านสถิติเดิม ----------
  try {
    var saved = localStorage.getItem("blockBest");
    if (saved) best = parseInt(saved, 10) || 0;
  } catch (e) { /* localStorage ใช้ไม่ได้ก็ข้าม */ }
  bestEl.textContent = best;

  // ---------- input ----------
  var keys = { left: false, right: false };

  function keyDown(e) {
    var k = e.key ? e.key.toLowerCase() : "";
    if (k === "a" || e.key === "ArrowLeft") keys.left = true;
    if (k === "d" || e.key === "ArrowRight") keys.right = true;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || k === "a" || k === "d") {
      e.preventDefault();
    }
    // กด Enter/Space เพื่อเริ่มหรือเริ่มใหม่
    if ((e.key === "Enter" || e.key === " ") && state !== STATE.PLAYING) {
      e.preventDefault();
      startGame();
    }
  }
  function keyUp(e) {
    var k = e.key ? e.key.toLowerCase() : "";
    if (k === "a" || e.key === "ArrowLeft") keys.left = false;
    if (k === "d" || e.key === "ArrowRight") keys.right = false;
  }
  document.addEventListener("keydown", keyDown);
  document.addEventListener("keyup", keyUp);

  function holdButton(btn, side) {
    if (!btn) return;
    var start = function (e) { e.preventDefault(); keys[side] = true; };
    var stop = function (e) { e.preventDefault(); keys[side] = false; };
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointerleave", stop);
    btn.addEventListener("pointercancel", stop);
  }
  holdButton(leftBtn, "left");
  holdButton(rightBtn, "right");

  // ลาก/แตะบนจอเพื่อเลื่อน
  var dragging = false;
  function moveTo(clientX) {
    var rect = canvas.getBoundingClientRect();
    var scale = W / rect.width;
    var x = (clientX - rect.left) * scale;
    player.x = Math.max(0, Math.min(W - player.w, x - player.w / 2));
    player.vx = 0;
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (state === STATE.PLAYING) { dragging = true; moveTo(e.clientX); }
  });
  canvas.addEventListener("pointermove", function (e) {
    if (dragging && state === STATE.PLAYING) moveTo(e.clientX);
  });
  function endDrag() { dragging = false; }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointerleave", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  if (startBtn) {
    startBtn.addEventListener("click", function () {
      if (state === STATE.PLAYING) return;
      startGame();
    });
  }

  // ---------- ตรรกะเกม ----------
  function reset() {
    blocks = [];
    score = 0;
    frames = 0;
    fallSpeed = baseFall;
    spawnTimer = 0;
    player.x = W / 2 - player.w / 2;
    player.vx = 0;
    scoreEl.textContent = "0";
  }

  function startGame() {
    reset();
    state = STATE.PLAYING;
    messageEl.textContent = "หลบให้รอด!";
    startBtn.textContent = "กำลังเล่น...";
  }

  function gameOver() {
    state = STATE.OVER;
    if (score > best) {
      best = score;
      try { localStorage.setItem("blockBest", String(best)); } catch (e) {}
      bestEl.textContent = best;
    }
    messageEl.textContent = "ชนแล้ว! คะแนนของคุณ: " + score + " — กดเริ่มเกมเพื่อเล่นใหม่";
    startBtn.textContent = "เล่นอีกครั้ง";
  }

  function spawnBlock() {
    var w = 34 + Math.random() * 70;
    var x = Math.random() * (W - w);
    blocks.push({ x: x, y: -30, w: w, h: 22, hit: false });
  }

  function update() {
    if (state !== STATE.PLAYING) return;

    frames++;

    // ขยับผู้เล่น
    player.vx = 0;
    if (keys.left) player.vx -= player.speed;
    if (keys.right) player.vx += player.speed;
    player.x += player.vx;
    player.x = Math.max(0, Math.min(W - player.w, player.x));

    // ค่อย ๆ เพิ่มความยาก
    fallSpeed = baseFall + frames * 0.0025;
    spawnEvery = Math.max(20, 55 - Math.floor(frames / 90));

    // ปล่อย block ใหม่
    spawnTimer++;
    if (spawnTimer >= spawnEvery) {
      spawnTimer = 0;
      spawnBlock();
    }

    // ขยับ block + ตรวจชน/เก็บแต้ม
    for (var i = blocks.length - 1; i >= 0; i--) {
      var b = blocks[i];
      b.y += fallSpeed;

      // ชนผู้เล่นไหม
      if (
        b.x < player.x + player.w &&
        b.x + b.w > player.x &&
        b.y < player.y + player.h &&
        b.y + b.h > player.y
      ) {
        gameOver();
        return;
      }

      // หลุดจอด้านล่าง = ได้แต้ม
      if (b.y > H) {
        if (!b.hit) {
          score++;
          scoreEl.textContent = score;
        }
        blocks.splice(i, 1);
      }
    }
  }

  function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    // พื้นหลัง
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);

    // เส้นตารางจาง ๆ
    ctx.strokeStyle = "rgba(38,59,104,0.35)";
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= W; gx += 42) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (var gy = 0; gy <= H; gy += 42) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // block ที่ตกลงมา
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      grad.addColorStop(0, "#4d7cff");
      grad.addColorStop(1, "#1b3fb0");
      ctx.fillStyle = grad;
      drawRoundRect(b.x, b.y, b.w, b.h, 6);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.stroke();
    }

    // ผู้เล่น
    var pg = ctx.createLinearGradient(0, player.y, 0, player.y + player.h);
    pg.addColorStop(0, "#ffffff");
    pg.addColorStop(1, "#9fd0ff");
    ctx.fillStyle = pg;
    ctx.shadowColor = "#4d9bff";
    ctx.shadowBlur = 18;
    drawRoundRect(player.x, player.y, player.w, player.h, 10);
    ctx.fill();
    ctx.shadowBlur = 0;

    // ข้อความตอนยังไม่เริ่ม
    if (state === STATE.READY) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "bold 22px Arial";
      ctx.textAlign = "center";
      ctx.fillText("กด 'เริ่มเกม' เพื่อเล่น", W / 2, H / 2);
    }

    // คะแนนลอยบนจอ
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "left";
    ctx.fillText("คะแนน: " + score, 12, 26);
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  // ตั้งค่าเริ่มต้น
  messageEl.textContent = "กด 'เริ่มเกม' แล้วใช้ A / D หลบ block";
  reset();
  loop();
})();
