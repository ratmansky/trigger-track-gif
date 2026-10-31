/**
 * Injected (isolated world) into a youtube.com/watch tab together with
 * vendor/gifenc.js. Plays the picked range, grabs frames from the page's own
 * <video> into a canvas (same origin → not tainted) and encodes a GIF.
 * No video file is downloaded.
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
    progress("Реклама на YouTube — жду / пропускаю…");
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

  async function ensurePlaying(video) {
    if (!video.paused) return false;
    try {
      await video.play();
      return false;
    } catch {
      // Autoplay with sound blocked → muted play is always allowed.
      video.muted = true;
      await video.play();
      return true;
    }
  }

  function toDataUrl(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:image/gif;base64,${btoa(binary)}`;
  }

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
    video.currentTime = start;
    await once(video, "seeked", 15000);
    await waitFor(() => video.readyState >= 3, 15000, "буфер видео");

    await new Promise((resolve, reject) => {
      const stall = setTimeout(
        () =>
          reject(
            new Error(
              "Видео встало. Не переключай вкладку YouTube, пока делается гифка.",
            ),
          ),
        (end - start) * 3000 + 15000,
      );

      function grab(_now, meta) {
        const t = meta.mediaTime;
        if (t >= start + frames.length / fps - 0.001) {
          ctx.drawImage(video, 0, 0, width, height);
          frames.push(ctx.getImageData(0, 0, width, height).data);
        }
        if (frames.length >= total || t >= end) {
          clearTimeout(stall);
          video.pause();
          resolve();
          return;
        }
        video.requestVideoFrameCallback(grab);
      }

      video.requestVideoFrameCallback(grab);
      video.play().catch((err) => {
        clearTimeout(stall);
        reject(err);
      });
    });

    return { frames, width, height };
  }

  function encode({ frames, width, height }, fps) {
    const { GIFEncoder, quantize, applyPalette } = self.gifenc;
    const gif = GIFEncoder();
    const delay = Math.round(1000 / fps);
    frames.forEach((rgba, i) => {
      if (i % 10 === 0) progress(`Собираю гифку… ${i}/${frames.length}`);
      const palette = quantize(rgba, 256);
      const index = applyPalette(rgba, palette);
      gif.writeFrame(index, width, height, { palette, delay });
    });
    gif.finish();
    return gif.bytes();
  }

  window.__ttgCapture = async ({ start, duration, fps = 12.5, width = 320 }) => {
    let mutedByUs = false;
    let video = null;
    try {
      progress("Жду плеер YouTube…");
      video = await waitFor(
        () => {
          const v = document.querySelector("video.html5-main-video");
          return v && v.readyState >= 1 && v.videoWidth ? v : null;
        },
        30000,
        "плеер YouTube",
      );
      mutedByUs = await ensurePlaying(video);
      await waitOutAds();

      const end = Math.min(start + duration, video.duration || Infinity);
      if (!(end > start)) {
        throw new Error(`Ролик короче ${start} сек — сдвинь начало.`);
      }

      progress("Снимаю кадры…");
      const captured = await captureFrames(video, { start, end, fps, width });
      const bytes = encode(captured, fps);
      return {
        ok: true,
        dataUrl: toDataUrl(bytes),
        width: captured.width,
        height: captured.height,
        frames: captured.frames.length,
        bytes: bytes.length,
        startSec: start,
        endSec: end,
      };
    } catch (err) {
      const message =
        err?.name === "SecurityError"
          ? "YouTube не отдал кадры (защищённое видео). Выбери другой ролик."
          : err?.message || String(err);
      return { ok: false, error: message };
    } finally {
      if (video) {
        video.pause();
        if (mutedByUs) video.muted = false;
      }
    }
  };
})();
