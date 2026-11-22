/*
 * Commando 3 – touch controller
 *
 * What the game really uses (decompiled from commando34.swf):
 *   W / A / S / D  -> jump / move left / crouch / move right
 *   Mouse position -> aim   (the camera also shifts toward the cursor)
 *   Mouse button   -> fire  (held = automatic fire)
 *   Q / E          -> previous / next weapon
 *   P              -> pause
 *
 * Ruffle listens to *Pointer* events (not MouseEvents) and to keyboard events,
 * so this file synthesises PointerEvents + KeyboardEvents from touch sticks.
 */
(() => {
  "use strict";

  const GAME_W = 608;
  const GAME_H = 400;
  const PLAYER_X = GAME_W / 2;     // the camera keeps the hero centred on screen
  const PLAYER_Y = GAME_H / 2;
  const AIM_REACH = 150;           // px (in game space) between hero and the cursor
  const AIM_DEADZONE = 0.28;       // stick travel needed to start firing
  const MOVE_DEADZONE_X = 0.28;
  const MOVE_UP = 0.55;            // jump threshold
  const MOVE_DOWN = 0.55;          // crouch threshold

  const $ = (id) => document.getElementById(id);
  const hostEl = $("player-host");
  let player = null;

  /* ------------------------------------------------------------------ */
  /* Error surface – never leave the user staring at a black screen      */
  /* ------------------------------------------------------------------ */
  function showError(message) {
    try {
      $("error-text").textContent = String(message);
      $("error-box").classList.remove("hidden");
      $("splash").classList.add("done");
    } catch (_) { /* ignore */ }
  }
  $("error-close").addEventListener("click", () => $("error-box").classList.add("hidden"));

  /* ------------------------------------------------------------------ */
  /* Layout: fit a 608x400 game into the screen, centred                 */
  /* ------------------------------------------------------------------ */
  function layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const s = Math.min(W / GAME_W, H / GAME_H);
    const w = Math.floor(GAME_W * s);
    const h = Math.floor(GAME_H * s);
    hostEl.style.width = w + "px";
    hostEl.style.height = h + "px";
    hostEl.style.left = Math.floor((W - w) / 2) + "px";
    hostEl.style.top = Math.floor((H - h) / 2) + "px";
  }
  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", layout);
  layout();

  /* ------------------------------------------------------------------ */
  /* Synthetic input -> Ruffle                                           */
  /* ------------------------------------------------------------------ */
  function canvasEl() {
    const root = player && player.shadowRoot;
    return (root && root.querySelector("canvas")) || player;
  }

  let pointerDown = false;
  function sendPointer(type, sx, sy) {
    const el = canvasEl();
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cx = r.left + (sx / GAME_W) * r.width;
    const cy = r.top + (sy / GAME_H) * r.height;
    const down = type === "pointerdown" || (type === "pointermove" && pointerDown);
    el.dispatchEvent(new PointerEvent(type, {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: type === "pointermove" ? -1 : 0,
      buttons: down ? 1 : 0,
      clientX: cx, clientY: cy,
      screenX: cx, screenY: cy,
      width: 1, height: 1,
      pressure: down ? 0.5 : 0,
      bubbles: true, cancelable: true, composed: true
    }));
  }

  const KEYS = {
    KeyW: { key: "w", keyCode: 87 },
    KeyA: { key: "a", keyCode: 65 },
    KeyS: { key: "s", keyCode: 83 },
    KeyD: { key: "d", keyCode: 68 },
    KeyQ: { key: "q", keyCode: 81 },
    KeyE: { key: "e", keyCode: 69 },
    KeyP: { key: "p", keyCode: 80 }
  };
  const held = new Set();

  function keyTarget() {
    return player || window;
  }

  function dispatchKey(type, code) {
    const k = KEYS[code];
    const ev = new KeyboardEvent(type, {
      key: k.key, code,
      keyCode: k.keyCode, which: k.keyCode, charCode: 0,
      bubbles: true, cancelable: true, composed: true
    });
    keyTarget().dispatchEvent(ev);
  }

  function setKey(code, down) {
    if (down && !held.has(code)) {
      held.add(code);
      dispatchKey("keydown", code);
    } else if (!down && held.has(code)) {
      held.delete(code);
      dispatchKey("keyup", code);
    }
  }

  function tapKey(code, ms = 70) {
    setKey(code, true);
    setTimeout(() => setKey(code, false), ms);
  }

  function haptic(ms) {
    try {
      if (window.AndroidBridge && AndroidBridge.vibrate) AndroidBridge.vibrate(ms);
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (_) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* Virtual sticks                                                      */
  /* ------------------------------------------------------------------ */
  function makeStick(zone, base, knob, handlers) {
    let activeId = null;
    let cx = 0, cy = 0, radius = 1;

    function readCenter() {
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      radius = r.width / 2;
    }

    function update(e) {
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const travel = radius * 0.8;
      const len = Math.hypot(dx, dy);
      if (len > travel) { dx = (dx / len) * travel; dy = (dy / len) * travel; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      handlers.move(dx / travel, dy / travel);
    }

    function end() {
      activeId = null;
      knob.style.transform = "translate(0px, 0px)";
      handlers.end();
    }

    zone.addEventListener("pointerdown", (e) => {
      if (activeId !== null) return;
      e.preventDefault();
      activeId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      readCenter();
      update(e);
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== activeId) return;
      e.preventDefault();
      update(e);
    });
    const up = (e) => { if (e.pointerId === activeId) end(); };
    zone.addEventListener("pointerup", up);
    zone.addEventListener("pointercancel", up);
    zone.addEventListener("lostpointercapture", up);

    return { cancel: () => { if (activeId !== null) end(); } };
  }

  // ---- Move stick (A / D / W / S) ----
  const moveStick = makeStick($("move-zone"), $("move-base"), $("move-knob"), {
    move(nx, ny) {
      setKey("KeyA", nx < -MOVE_DEADZONE_X);
      setKey("KeyD", nx > MOVE_DEADZONE_X);
      setKey("KeyW", ny < -MOVE_UP);
      setKey("KeyS", ny > MOVE_DOWN);
    },
    end() {
      ["KeyA", "KeyD", "KeyW", "KeyS"].forEach((c) => setKey(c, false));
    }
  });

  // ---- Aim stick (cursor + auto fire) ----
  let firing = false;
  let lastAim = { x: PLAYER_X + 40, y: PLAYER_Y };
  const aimKnob = $("aim-knob");

  function aimTo(nx, ny) {
    const len = Math.hypot(nx, ny);
    if (len < 1e-3) return;
    const ux = nx / len;
    const uy = ny / len;
    // The game shifts the camera by (mouseX - centre), so the hero ends up at
    // (centre - offset) while the cursor sits at (centre + offset): the real
    // hero -> cursor vector is 2x horizontally. Halve X to keep the angle true.
    lastAim = {
      x: PLAYER_X + (AIM_REACH * ux) / 2,
      y: PLAYER_Y + AIM_REACH * uy
    };
  }

  const aimStick = makeStick($("aim-zone"), $("aim-base"), aimKnob, {
    move(nx, ny) {
      const len = Math.hypot(nx, ny);
      if (len >= AIM_DEADZONE) {
        aimTo(nx, ny);
        sendPointer("pointermove", lastAim.x, lastAim.y);
        if (!firing) {
          firing = true;
          aimKnob.classList.add("firing");
          sendPointer("pointerdown", lastAim.x, lastAim.y);
          pointerDown = true;
        }
      } else if (firing) {
        stopFiring();
      }
    },
    end() { stopFiring(); }
  });

  function stopFiring() {
    if (!firing) return;
    firing = false;
    pointerDown = false;
    aimKnob.classList.remove("firing");
    sendPointer("pointerup", lastAim.x, lastAim.y);
  }

  /* ------------------------------------------------------------------ */
  /* Buttons                                                             */
  /* ------------------------------------------------------------------ */
  document.querySelectorAll("[data-hold]").forEach((btn) => {
    const code = btn.dataset.hold;
    let id = null;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId;
      try { btn.setPointerCapture(id); } catch (_) { /* ignore */ }
      btn.classList.add("pressed");
      haptic(12);
      setKey(code, true);
    });
    const release = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      btn.classList.remove("pressed");
      setKey(code, false);
    };
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("lostpointercapture", release);
  });

  document.querySelectorAll("[data-tap]").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      btn.classList.add("pressed");
      haptic(12);
      tapKey(btn.dataset.tap);
    });
    const off = () => btn.classList.remove("pressed");
    btn.addEventListener("pointerup", off);
    btn.addEventListener("pointercancel", off);
    btn.addEventListener("pointerleave", off);
  });

  // Controls visibility: full -> dim -> hidden
  const ui = $("touch-ui");
  const VIS = ["full", "dim", "hidden"];
  function setVis(v) {
    ui.dataset.vis = v;
    try { localStorage.setItem("c3.vis", v); } catch (_) { /* ignore */ }
  }
  try {
    const saved = localStorage.getItem("c3.vis");
    if (VIS.includes(saved)) ui.dataset.vis = saved;
  } catch (_) { /* ignore */ }
  $("btn-vis").addEventListener("click", () => {
    setVis(VIS[(VIS.indexOf(ui.dataset.vis) + 1) % VIS.length]);
  });

  /* ------------------------------------------------------------------ */
  /* Safety: never leave keys / fire stuck                               */
  /* ------------------------------------------------------------------ */
  function releaseAll() {
    moveStick.cancel();
    aimStick.cancel();
    stopFiring();
    Array.from(held).forEach((c) => setKey(c, false));
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });
  window.addEventListener("blur", releaseAll);

  /* ------------------------------------------------------------------ */
  /* Android Back button menu                                            */
  /* ------------------------------------------------------------------ */
  const menu = $("menu");
  let menuOpen = false;
  function openMenu() {
    if (menuOpen) return;
    menuOpen = true;
    releaseAll();
    tapKey("KeyP");              // pauses if (and only if) a level is running
    menu.classList.remove("hidden");
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    menu.classList.add("hidden");
    tapKey("KeyP");              // resume
  }
  window.__onBack = () => (menuOpen ? closeMenu() : openMenu());
  $("menu-resume").addEventListener("click", closeMenu);
  $("menu-exit").addEventListener("click", () => {
    if (window.AndroidBridge && AndroidBridge.quit) AndroidBridge.quit();
    else window.close();
  });

  /* ------------------------------------------------------------------ */
  /* Boot Ruffle                                                         */
  /* ------------------------------------------------------------------ */
  function hideSplash() { $("splash").classList.add("done"); }

  function boot() {
    const api = window.RufflePlayer;
    if (!api || typeof api.newest !== "function") {
      showError(
        "The Ruffle engine did not load (ruffle/ruffle.js is missing or blocked).\n\n" +
        "Check that app/src/main/assets/www/ruffle/ contains ruffle.js and the two .wasm files."
      );
      return;
    }
    try {
      const ruffle = api.newest();
      player = ruffle.createPlayer();
      hostEl.appendChild(player);
      player.addEventListener("loadedmetadata", hideSplash);
      player.addEventListener("loadeddata", hideSplash);
      const loading = player.load({ url: "commando34.swf" });
      if (loading && typeof loading.catch === "function") {
        loading.catch((err) => showError("Could not start the game:\n" + (err && (err.stack || err.message) || err)));
      }
      $("splash-msg").textContent = "Loading game…";
      setTimeout(hideSplash, 6000); // never block the screen for long
    } catch (err) {
      showError("Could not create the Flash player:\n" + (err && (err.stack || err.message) || err));
    }
  }

  window.addEventListener("error", (e) => {
    const msg = String(e && e.message || "");
    if (/ruffle|wasm|WebAssembly|out of memory/i.test(msg)) showError(msg);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Handy for debugging from a desktop browser / adb: window.__c3
  window.__c3 = { setKey, tapKey, sendPointer, get player() { return player; }, releaseAll };
})();
