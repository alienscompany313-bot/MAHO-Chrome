/* Equirectangular sphere viewer. The camera sits inside the sphere.
   Dragging changes yaw and pitch. No external library. */
(function () {
  const VERT = [
    "attribute vec2 aPos;",
    "varying vec2 vUv;",
    "void main(){",
    "  vUv = aPos * 0.5 + 0.5;",
    "  gl_Position = vec4(aPos, 0.0, 1.0);",
    "}"
  ].join("\n");
  const FRAG = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform sampler2D uTex;",
    "uniform vec2 uRot;",
    "uniform float uFovTan;",
    "void main(){",
    "  vec2 p = vUv * 2.0 - 1.0;",
    "  vec3 ray = normalize(vec3(p.x * uFovTan, p.y * uFovTan, 1.0));",
    "  float cy = cos(uRot.x); float sy = sin(uRot.x);",
    "  vec3 yawed = vec3(cy * ray.x + sy * ray.z, ray.y, -sy * ray.x + cy * ray.z);",
    "  float cp = cos(uRot.y); float sp = sin(uRot.y);",
    "  vec3 dir = vec3(yawed.x, cp * yawed.y - sp * yawed.z, sp * yawed.y + cp * yawed.z);",
    "  float lon = atan(dir.x, dir.z);",
    "  float lat = asin(clamp(dir.y, -1.0, 1.0));",
    "  vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265);",
    "  gl_FragColor = texture2D(uTex, uv);",
    "}"
  ].join("\n");

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(log || "shader");
    }
    return shader;
  }

  function mount(canvas, url, options) {
    const opts = options || {};
    const note = opts.note || null;
    let gl = null;
    let program = null;
    let texture = null;
    let buffer = null;
    let raf = 0;
    let dead = false;
    let dirty = true;
    let yaw = 0;
    let pitch = 0;
    const pointers = new Map();
    const image = new Image();
    image.decoding = "async";

    function setNote(text) { if (note) note.textContent = text || ""; }
    function fail(text) {
      setNote(text);
      if (typeof opts.onError === "function") opts.onError(text);
      if (opts.fallback) {
        opts.fallback.hidden = false;
        opts.fallback.src = url;
      }
      canvas.hidden = true;
    }
    function resize() {
      const parent = canvas.parentElement;
      const w = Math.max(2, (parent && parent.clientWidth) || canvas.clientWidth || 320);
      const h = Math.max(2, (parent && parent.clientHeight) || canvas.clientHeight || 220);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
      dirty = true;
    }
    function draw() {
      if (dead || !gl || !texture) return;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const pos = gl.getAttribLocation(program, "aPos");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(gl.getUniformLocation(program, "uRot"), yaw, pitch);
      gl.uniform1f(gl.getUniformLocation(program, "uFovTan"), Math.tan(0.72));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(program, "uTex"), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function loop() {
      raf = 0;
      if (dirty) { draw(); dirty = false; }
    }
    function requestDraw() {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(loop);
    }
    function onDown(e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      canvas.focus();
    }
    function onMove(e) {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      yaw -= dx * 0.005;
      pitch = Math.max(-1.25, Math.min(1.25, pitch + dy * 0.005));
      requestDraw();
    }
    function onUp(e) { pointers.delete(e.pointerId); }
    function onKey(e) {
      const step = 0.12;
      if (e.key === "ArrowLeft") yaw -= step;
      else if (e.key === "ArrowRight") yaw += step;
      else if (e.key === "ArrowUp") pitch = Math.max(-1.25, pitch - step);
      else if (e.key === "ArrowDown") pitch = Math.min(1.25, pitch + step);
      else return;
      e.preventDefault();
      requestDraw();
    }
    function onResize() { resize(); requestDraw(); }

    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);

    image.onload = function () {
      if (dead) return;
      try {
        gl = canvas.getContext("webgl", { antialias: true, preserveDrawingBuffer: true });
        if (!gl) throw new Error("webgl");
        const vs = compile(gl, gl.VERTEX_SHADER, VERT);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        resize();
        const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
        const equirect = ratio > 1.7 && ratio < 2.3;
        setNote(opts.readyText || (equirect ? "" : (opts.stretchText || "")));
        if (typeof opts.onReady === "function") opts.onReady({ equirect: equirect, width: image.naturalWidth, height: image.naturalHeight });
        requestDraw();
      } catch (err) {
        fail(opts.errorText || "The spherical view could not start.");
      }
    };
    image.onerror = function () { fail(opts.errorText || "The panorama image could not be loaded."); };
    setNote(opts.loadingText || "");
    image.src = url;

    return {
      resize: function () { resize(); requestDraw(); },
      fullscreen: function (target) {
        const node = target || canvas.parentElement;
        if (!node) return;
        if (document.fullscreenElement) document.exitFullscreen();
        else if (node.requestFullscreen) node.requestFullscreen();
      },
      destroy: function () {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", onResize);
        image.onload = null;
        image.onerror = null;
        if (gl) {
          if (texture) gl.deleteTexture(texture);
          if (buffer) gl.deleteBuffer(buffer);
          if (program) gl.deleteProgram(program);
          const lose = gl.getExtension("WEBGL_lose_context");
          if (lose) lose.loseContext();
        }
        gl = null;
      }
    };
  }

  window.MAHOPanorama = { mount: mount };
})();
