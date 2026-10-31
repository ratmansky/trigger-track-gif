/**
 * Injected (isolated world) into a youtube.com/watch tab together with
 * vendor/gifenc.js. Grabs frames from the page's own <video> into a canvas
 * (same origin → not tainted) and encodes a GIF.
 *
 * Frame grab is seek-based (not live playback): Chrome often stalls
 * requestVideoFrameCallback / playback when the tab flickers or decodes slowly,
 * which used to throw «Видео встало».
 */
(() => {
  if (window.__ttgCapture) return;

  const SKIP_AD =
    ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function progress(text) {
    try {
      chrome.runtime.sendMessage({ type: "GIF_PROGRESS", text });
    } catch {
      /* popup/background gone — not fatal */
    }
  }

  async function waitFor(check, timeoutMs, what) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = check();
      if (value) return value;
      await sleep(200);
    }
    throw new Error(`Не дождался: ${what}`);
  }

  function adShowing() {
    return document
      .querySelector(".html5-video-player")
      ?.classList.contains("ad-showing");
  }

  async function waitOutAds() {
    if (!adShowing()) return;
    progress("Реклама на YouTube — жду / пропускаю");
    await waitFor(
      () => {
        document.querySelector(SKIP_AD)?.click();
        return !adShowing();
      },
      120000,
      "конец рекламы",
    );
    await sleep(500);
  }

  function once(target, event, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        target.removeEventListener(event, onEvent);
        reject(new Error(`timeout: ${event}`));
      }, timeoutMs);
      function onEvent() {
        clearTimeout(timer);
        resolve();
      }
      target.addEventListener(event, onEvent, { once: true });
    });
  }

  async function ensureMutedReady(video) {
    video.muted = true;
    video.pause();
    try {
      // Prime the element; stay paused for seek capture.
      await video.play();
      video.pause();
    } catch {
      /* ignore — seek still works muted */
    }
  }

  async function seekTo(video, t) {
    const target = Math.min(
      Math.max(0, t),
      Number.isFinite(video.duration) ? video.duration - 0.05 : t,
    );
    if (Math.abs(video.currentTime - target) < 0.02 && video.readyState >= 2) {
      return;
    }
    const seeked = once(video, "seeked", 12000);
    video.currentTime = target;
    await seeked;
    await waitFor(() => video.readyState >= 2, 8000, "кадр после seek");
  }

  function toDataUrl(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:image/gif;base64,${btoa(binary)}`;
  }

  /**
   * Reliable path: pause → seek to each timestamp → draw.
   * Does not depend on continuous playback / rVFC.
   */
  async function captureFrames(video, { start, end, fps, width }) {
    const height = Math.max(
      2,
      Math.round((width * video.videoHeight) / video.videoWidth / 2) * 2,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const total = Math.max(1, Math.round((end - start) * fps));
    const frames = [];

    video.pause();
    for (let i = 0; i < total; i++) {
      const t = start + i / fps;
      if (t >= end) break;
      if (i === 0 || i % 5 === 0) {
        progress(`Снимаю кадры ${i + 1}/${total}`);
      }
      await seekTo(video, t);
      // One paint tick after seek helps some decoders flush the frame.
      await new Promise((r) => requestAnimationFrame(() => r()));
      ctx.drawImage(video, 0, 0, width, height);
      frames.push(ctx.getImageData(0, 0, width, height).data);
    }

    if (!frames.length) {
      throw new Error("Не удалось снять ни одного кадра.");
    }
    return { frames, width, height };
  }

  function encode({ frames, width, height }, fps) {
    const { GIFEncoder, quantize, applyPalette } = self.gifenc;
    if (!GIFEncoder) {
      throw new Error("gifenc не загрузился — Reload расширения.");
    }
    const gif = GIFEncoder();
    const delay = Math.round(1000 / fps);
    frames.forEach((rgba, i) => {
      if (i % 10 === 0) progress(`Собираю гифку ${i}/${frames.length}`);
      const palette = quantize(rgba, 256);
      const index = applyPalette(rgba, palette);
      gif.writeFrame(index, width, height, { palette, delay });
    });
    gif.finish();
    return gif.bytes();
  }

  window.__ttgCapture = async ({ start, duration, fps = 10, width = 320 }) => {
    let video = null;
    try {
      progress("Жду плеер YouTube");
      video = await waitFor(
        () => {
          const v = document.querySelector("video.html5-main-video");
          return v && v.readyState >= 1 && v.videoWidth ? v : null;
        },
        45000,
        "плеер YouTube",
      );
      await ensureMutedReady(video);
      await waitOutAds();

      // Ads / quality switch can replace the <video> node.
      video = await waitFor(
        () => {
          const v = document.querySelector("video.html5-main-video");
          return v && v.readyState >= 1 && v.videoWidth ? v : null;
        },
        20000,
        "плеер после рекламы",
      );
      await ensureMutedReady(video);

      const end = Math.min(start + duration, video.duration || Infinity);
      if (!(end > start)) {
        throw new Error(`Ролик короче ${start} сек — сдвинь начало.`);
      }

      progress("Снимаю кадры");
      const captured = await captureFrames(video, { start, end, fps, width });
      progress("Кодирую GIF");
      const bytes = encode(captured, fps);

      // Avoid returning a huge dataUrl through executeScript (can fail silently).
      const result = {
        ok: true,
        dataUrl: toDataUrl(bytes),
        width: captured.width,
        height: captured.height,
        frames: captured.frames.length,
        bytes: bytes.length,
        startSec: start,
        endSec: end,
      };
      await chrome.storage.local.set({ gifCaptureResult: result });
      return { ok: true, stored: true, frames: result.frames, bytes: result.bytes };
    } catch (err) {
      const message =
        err?.name === "SecurityError"
          ? "YouTube не отдал кадры (защищённое видео). Выбери другой ролик."
          : err?.message || String(err);
      try {
        await chrome.storage.local.set({
          gifCaptureResult: { ok: false, error: message },
        });
      } catch {
        /* ignore */
      }
      return { ok: false, error: message };
    } finally {
      if (video) {
        try {
          video.pause();
        } catch {
          /* ignore */
        }
      }
    }
  };
})();
