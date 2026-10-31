/**
 * YouTube player inside the popup for the crop screen.
 *
 * Error 153 = the embed request came without a Referer (extension pages send
 * none). A session DNR rule adds one — only for embed frames that are not in a
 * tab, i.e. our popup; normal browsing is untouched.
 *
 * Remote scripts are not allowed in MV3 pages, so instead of iframe_api.js we
 * speak its postMessage protocol directly (enablejsapi=1).
 */
const EMBED_RULE_ID = 153;
const YT_ORIGIN = "https://www.youtube.com";
const EMBED_REFERER = "https://triggerfm.online/";
const READY_TIMEOUT_MS = 12000;

async function allowYouTubeEmbed() {
  if (!chrome.declarativeNetRequest) {
    throw new Error(
      "нет разрешения declarativeNetRequest — нажми Reload у расширения в chrome://extensions",
    );
  }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [EMBED_RULE_ID],
    addRules: [
      {
        id: EMBED_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            // youtube.com itself as the embedder → error 152-4.
            { header: "referer", operation: "set", value: EMBED_REFERER },
          ],
        },
        condition: {
          urlFilter: "||youtube.com/embed/",
          resourceTypes: ["sub_frame"],
          tabIds: [chrome.tabs.TAB_ID_NONE],
        },
      },
    ],
  });
}

function createCropPlayer(iframe, { onReady, onTime, onFail } = {}) {
  let duration = 0;
  let knownTime = 0;
  let knownAt = 0;
  let playing = false;
  let loop = null;
  let ready = false;
  let listenTimer = null;
  let failTimer = null;
  let loopTimer = null;

  function post(message) {
    iframe.contentWindow?.postMessage(
      JSON.stringify({ ...message, id: 1, channel: "widget" }),
      YT_ORIGIN,
    );
  }

  function command(func, args = []) {
    post({ event: "command", func, args });
  }

  function currentTime() {
    if (!playing) return knownTime;
    return knownTime + (performance.now() - knownAt) / 1000;
  }

  function seek(t) {
    command("seekTo", [t, true]);
    knownTime = t;
    knownAt = performance.now();
  }

  function fail(reason) {
    clearTimers();
    ready = false;
    onFail?.(reason);
  }

  function clearTimers() {
    clearInterval(listenTimer);
    clearTimeout(failTimer);
    clearInterval(loopTimer);
    listenTimer = failTimer = loopTimer = null;
  }

  function onMessage(e) {
    if (e.source !== iframe.contentWindow) return;
    let data;
    try {
      data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (!data?.event) return;

    if (data.event === "onReady" && !ready) {
      ready = true;
      clearInterval(listenTimer);
      clearTimeout(failTimer);
      command("mute");
      onReady?.();
    } else if (data.event === "onError") {
      fail(`YouTube error ${data.info}`);
    } else if (
      (data.event === "infoDelivery" || data.event === "initialDelivery") &&
      data.info
    ) {
      const info = data.info;
      if (typeof info.duration === "number" && info.duration > 0) {
        duration = info.duration;
      }
      if (typeof info.playerState === "number") {
        playing = info.playerState === 1;
      }
      if (typeof info.currentTime === "number") {
        knownTime = info.currentTime;
        knownAt = performance.now();
      }
      onTime?.(currentTime(), duration);
    }
  }

  window.addEventListener("message", onMessage);

  function tickLoop() {
    if (!loop || !ready) return;
    const t = currentTime();
    if (t >= loop.end || t < loop.start - 0.3) {
      seek(loop.start);
      command("playVideo");
    }
    onTime?.(t, duration);
  }

  return {
    async load(videoId, startSec = 0) {
      clearTimers();
      ready = false;
      duration = 0;
      loop = null;
      try {
        await allowYouTubeEmbed();
      } catch (err) {
        fail(`DNR: ${err?.message || err}`);
        return;
      }
      const params = new URLSearchParams({
        enablejsapi: "1",
        autoplay: "1",
        mute: "1",
        playsinline: "1",
        rel: "0",
        // Look like a GIF; scrubbing is our own slider.
        controls: "0",
        iv_load_policy: "3",
        fs: "0",
        start: String(Math.floor(startSec)),
      });
      iframe.src = `${YT_ORIGIN}/embed/${encodeURIComponent(videoId)}?${params}`;
      iframe.onload = () => {
        // The widget only reports back after it hears "listening".
        let tries = 0;
        clearInterval(listenTimer);
        listenTimer = setInterval(() => {
          if (ready || ++tries > 40) return clearInterval(listenTimer);
          post({ event: "listening" });
        }, 250);
      };
      failTimer = setTimeout(
        () => fail("плеер не ответил"),
        READY_TIMEOUT_MS,
      );
    },

    /** Loop [start, end) forever — the live GIF preview. */
    setLoop(start, end) {
      loop = { start, end };
      if (!ready) return;
      seek(start);
      command("playVideo");
      if (!loopTimer) loopTimer = setInterval(tickLoop, 50);
    },

    stop() {
      clearTimers();
      loop = null;
      ready = false;
      iframe.onload = null;
      iframe.src = "about:blank";
    },

    get ready() {
      return ready;
    },
    get looping() {
      return Boolean(loop);
    },
    get duration() {
      return duration;
    },
    currentTime,
  };
}
