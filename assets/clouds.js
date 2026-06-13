/*
 * clouds.js — procedural sky background for cranshaw.me
 *
 * Draws domain-warped fBm clouds in a raw-WebGL fullscreen fragment shader.
 * If WebGL is unavailable or fails at any point, the canvas is hidden and a CSS
 * fallback (drifting cloud.png layers over the body gradient) is revealed by
 * adding the .clouds-fallback class to <html>. See assets/new-style.css.
 *
 * No dependencies. Respects prefers-reduced-motion and pauses when the tab is
 * hidden.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("cloudCanvas");
  var prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isCoarse =
    window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  // --- module state -------------------------------------------------------
  var gl = null;
  var program = null;
  var uniforms = {};
  var rafId = 0;
  var running = false;
  var fallbackActive = false;

  // Time bookkeeping so pausing (tab hidden) doesn't make u_time jump.
  var elapsed = 0; // seconds of "live" animation accumulated
  var lastTs = 0; // last rAF timestamp (ms)

  // Mouse parallax, eased toward the raw target each frame.
  var mouseTargetX = 0,
    mouseTargetY = 0;
  var mouseX = 0,
    mouseY = 0;

  // Performance tuning.
  var RENDER_SCALE = isCoarse ? 0.5 : 0.66;
  var DPR_CAP = isCoarse ? 1.0 : 1.5;
  var OCTAVES = isCoarse ? 3 : 5;

  // ------------------------------------------------------------------------
  // Fallback: idempotent. Any failure path funnels here. Hides the canvas and
  // reveals the CSS cloud.png fallback over the body gradient.
  // ------------------------------------------------------------------------
  function enableFallback(reason) {
    if (fallbackActive) return;
    fallbackActive = true;
    running = false;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (canvas) canvas.style.display = "none";
    document.documentElement.classList.add("clouds-fallback");
    if (window.console && console.warn) {
      console.warn("clouds.js: WebGL unavailable, using CSS cloud fallback —", reason);
    }
  }

  // ------------------------------------------------------------------------
  // WebGL helpers
  // ------------------------------------------------------------------------
  function getGL(cv) {
    var opts = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    };
    return (
      cv.getContext("webgl2", opts) ||
      cv.getContext("webgl", opts) ||
      cv.getContext("experimental-webgl", opts)
    );
  }

  function compile(ctx, type, src) {
    var sh = ctx.createShader(type);
    ctx.shaderSource(sh, src);
    ctx.compileShader(sh);
    if (!ctx.getShaderParameter(sh, ctx.COMPILE_STATUS)) {
      if (window.console && console.warn) {
        console.warn("clouds.js: shader compile failed —", ctx.getShaderInfoLog(sh));
      }
      ctx.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function buildProgram(ctx) {
    var vs = compile(ctx, ctx.VERTEX_SHADER, VERT_SRC);
    var fs = compile(ctx, ctx.FRAGMENT_SHADER, fragSource());
    if (!vs || !fs) return null;
    var p = ctx.createProgram();
    ctx.attachShader(p, vs);
    ctx.attachShader(p, fs);
    ctx.linkProgram(p);
    if (!ctx.getProgramParameter(p, ctx.LINK_STATUS)) {
      if (window.console && console.warn) {
        console.warn("clouds.js: program link failed —", ctx.getProgramInfoLog(p));
      }
      return null;
    }
    return p;
  }

  // ------------------------------------------------------------------------
  // Shaders (GLSL ES 1.00 — runs under both webgl and webgl2 contexts)
  // ------------------------------------------------------------------------
  var VERT_SRC =
    "attribute vec2 a_position;" +
    "void main(){ gl_Position = vec4(a_position, 0.0, 1.0); }";

  function fragSource() {
    return [
      "precision highp float;",
      "#define OCTAVES " + OCTAVES,
      "uniform float u_time;",
      "uniform vec2  u_resolution;",
      "uniform vec2  u_mouse;",

      // cheap hash
      "float hash(vec2 p){",
      "  p = fract(p * vec2(123.34, 456.21));",
      "  p += dot(p, p + 45.32);",
      "  return fract(p.x * p.y);",
      "}",

      // value noise with quintic interpolation
      "float noise(vec2 p){",
      "  vec2 i = floor(p);",
      "  vec2 f = fract(p);",
      "  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);",
      "  float a = hash(i);",
      "  float b = hash(i + vec2(1.0,0.0));",
      "  float c = hash(i + vec2(0.0,1.0));",
      "  float d = hash(i + vec2(1.0,1.0));",
      "  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);",
      "}",

      // fBm — rotate each octave to break axis alignment
      "float fbm(vec2 p){",
      "  float sum = 0.0;",
      "  float amp = 0.5;",
      "  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);",
      "  for(int i=0;i<OCTAVES;i++){",
      "    sum += amp * noise(p);",
      "    p = rot * p * 2.0;",
      "    amp *= 0.5;",
      "  }",
      "  return sum;",
      "}",

      // sky palette: t=0 bottom (warm) .. t=1 top (deep blue), 7 stops
      "vec3 skyGradient(float t){",
      "  vec3 s0 = vec3(0.596,0.302,0.224);", // #984D39
      "  vec3 s1 = vec3(0.694,0.541,0.463);", // #B18A76
      "  vec3 s2 = vec3(0.569,0.557,0.561);", // #918E8F
      "  vec3 s3 = vec3(0.510,0.620,0.678);", // #829EAD
      "  vec3 s4 = vec3(0.000,0.463,0.608);", // #00769B
      "  vec3 s5 = vec3(0.000,0.306,0.455);", // #004E74
      "  vec3 s6 = vec3(0.000,0.227,0.365);", // #003A5D
      "  float x = clamp(t,0.0,1.0) * 6.0;",
      "  vec3 c = s0;",
      "  c = mix(c, s1, clamp(x-0.0,0.0,1.0));",
      "  c = mix(c, s2, clamp(x-1.0,0.0,1.0));",
      "  c = mix(c, s3, clamp(x-2.0,0.0,1.0));",
      "  c = mix(c, s4, clamp(x-3.0,0.0,1.0));",
      "  c = mix(c, s5, clamp(x-4.0,0.0,1.0));",
      "  c = mix(c, s6, clamp(x-5.0,0.0,1.0));",
      "  return c;",
      "}",

      // Two fBm layers that advect (drift) horizontally at different speeds,
      // giving natural directional motion + parallax depth. No domain warping
      // (that was the source of the swirly, churning, marble look).
      "void main(){",
      "  vec2 uv = gl_FragCoord.xy / u_resolution.xy;",
      "  float aspect = u_resolution.x / u_resolution.y;",
      "  vec2 p = vec2(uv.x * aspect, uv.y);",   // keep puffs round on wide screens
      "  vec2 par = u_mouse * 0.04;",             // subtle parallax (near shifts more than far)
      "  vec3 sky = skyGradient(uv.y);",
      "  float t = u_time;",
      "  float h = uv.y;",                       // 0 = bottom, 1 = top
      // far layer: smaller, SLOW, fainter
      "  vec2 pf = p * 1.6 + vec2(-t * 0.012, 0.0) + par * 0.4;",
      "  float df = fbm(pf);",
      // near layer: larger, FAST, with a hint of vertical lift
      "  vec2 pn = p * 2.9 + vec2(-t * 0.050, t * 0.004) + par;",
      "  float dn = fbm(pn);",
      // soft coverage: pick the denser tops, feather the edges
      "  float coverFar  = smoothstep(0.52, 0.82, df);",
      "  float coverNear = smoothstep(0.50, 0.80, dn);",
      // weight the fast layer toward the bottom and the slow layer toward the
      // top, so lower clouds appear to drift faster than upper ones (no shear)
      "  float nearW = mix(1.0, 0.35, h);",
      "  float farW  = mix(0.45, 1.0, h);",
      // density-based shading: denser cores brighter; low-contrast and capped so
      // text stays legible where clouds drift behind the card
      "  vec3 cloudFar  = mix(vec3(0.60,0.62,0.68), vec3(0.90,0.89,0.87), df);",
      "  vec3 cloudNear = mix(vec3(0.56,0.58,0.64), vec3(0.96,0.94,0.90), dn);",
      "  vec3 col = sky;",
      "  col = mix(col, cloudFar,  coverFar  * 0.55 * farW);",
      "  col = mix(col, cloudNear, coverNear * 0.88 * nearW);",
      "  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;", // dither -> kill banding
      "  gl_FragColor = vec4(col, 1.0);",
      "}",
    ].join("\n");
  }

  // ------------------------------------------------------------------------
  // Sizing
  // ------------------------------------------------------------------------
  function effectiveDPR() {
    return Math.min(window.devicePixelRatio || 1, DPR_CAP);
  }

  function resize() {
    if (!gl) return;
    var cssW = canvas.clientWidth || window.innerWidth;
    var cssH = canvas.clientHeight || window.innerHeight;
    var scale = effectiveDPR() * RENDER_SCALE;
    var w = Math.max(1, Math.floor(cssW * scale));
    var h = Math.max(1, Math.floor(cssH * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    if (uniforms.resolution) gl.uniform2f(uniforms.resolution, w, h);
  }

  var resizeTimer = 0;
  var lastResizeH = 0;
  function onResize() {
    // On coarse-pointer devices the iOS URL bar fires resize on scroll with
    // only a small height change; ignore those to avoid churn.
    if (isCoarse) {
      var h = window.innerHeight;
      var dw = window.innerWidth;
      if (Math.abs(h - lastResizeH) < 80 && resizeTimer) {
        lastResizeH = h;
        return;
      }
      lastResizeH = h;
      void dw;
    }
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      resizeTimer = 0;
      resize();
    }, 200);
  }

  // ------------------------------------------------------------------------
  // Render loop
  // ------------------------------------------------------------------------
  function drawFrame() {
    if (!gl || !program) return;
    // bound the drift time so highp floats don't degrade over long sessions
    gl.uniform1f(uniforms.time, elapsed % 3600.0);
    gl.uniform2f(uniforms.mouse, mouseX, mouseY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function tick(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    // clamp dt so a long pause / background tab can't lurch the animation
    if (dt > 0.1) dt = 0.1;
    elapsed += dt;
    // frame-rate-independent easing toward the cursor: smooth glide whatever
    // the frame rate, instead of a fixed per-frame step that stutters when fps dips
    var ease = 1.0 - Math.exp(-dt * 3.5);
    mouseX += (mouseTargetX - mouseX) * ease;
    mouseY += (mouseTargetY - mouseY) * ease;
    drawFrame();
    rafId = window.requestAnimationFrame(tick);
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastTs = 0;
    rafId = window.requestAnimationFrame(tick);
  }

  function stopLoop() {
    running = false;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // ------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------
  function onPointerMove(e) {
    mouseTargetX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseTargetY = (e.clientY / window.innerHeight) * 2 - 1;
  }

  function onVisibility() {
    if (document.hidden) {
      stopLoop();
    } else if (!fallbackActive && !prefersReducedMotion) {
      startLoop();
    }
  }

  function onContextLost(e) {
    e.preventDefault();
    stopLoop();
    enableFallback("webglcontextlost");
  }

  // ------------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------------
  function init() {
    if (!canvas) {
      enableFallback("no canvas element");
      return;
    }
    try {
      gl = getGL(canvas);
      if (!gl) {
        enableFallback("no WebGL context");
        return;
      }
      program = buildProgram(gl);
      if (!program) {
        enableFallback("shader build failed");
        return;
      }

      gl.useProgram(program);

      // fullscreen triangle
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW
      );
      var loc = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      uniforms.time = gl.getUniformLocation(program, "u_time");
      uniforms.resolution = gl.getUniformLocation(program, "u_resolution");
      uniforms.mouse = gl.getUniformLocation(program, "u_mouse");

      canvas.addEventListener("webglcontextlost", onContextLost, false);
      window.addEventListener("resize", onResize, false);

      resize();

      // crossfade the canvas in over the gradient once the first frame draws
      drawFrame();
      canvas.classList.add("ready");

      if (prefersReducedMotion) {
        // static single frame; never start the loop
        return;
      }

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("visibilitychange", onVisibility, false);
      startLoop();
    } catch (err) {
      enableFallback(err);
    }
  }

  init();
})();
