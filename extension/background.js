const YT_HOME = "https://www.youtube.com/";
const YT_SEARCH =
  "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";

function waitTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false;

    function done(ok, value) {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearInterval(poll);
      if (ok) resolve(value);
      else reject(value instanceof Error ? value : new Error(String(value)));
    }

    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") done(true);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    const poll = setInterval(async () => {
      if (Date.now() - started > timeoutMs) {
        done(false, new Error("YouTube tab timeout"));
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") done(true);
      } catch (err) {
        done(false, err);
      }
    }, 250);
  });
}

/**
 * One background YouTube tab → several InnerTube searches → merge unique videos.
 * `queries`: [{ query, limit, reason }]
 */
async function searchViaYouTubeTab(queries) {
  const jobs = (Array.isArray(queries) ? queries : [])
    .map((j) => ({
      query: String(j?.query || "").trim(),
      limit: Math.max(1, Number(j?.limit) || 2),
      reason: j?.reason || "",
    }))
    .filter((j) => j.query);
  if (!jobs.length) return [];

  const tab = await chrome.tabs.create({ url: YT_HOME, active: false });
  try {
    await waitTabComplete(tab.id);
    await new Promise((r) => setTimeout(r, 400));

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [jobs, YT_SEARCH],
      func: async (searchJobs, searchUrl) => {
        function walk(node, out) {
          if (!node || out.length >= 16) return;
          if (Array.isArray(node)) {
            for (const item of node) walk(item, out);
            return;
          }
          if (typeof node !== "object") return;
          const v = node.videoRenderer;
          if (v?.videoId) {
            const titleRuns = v.title?.runs;
            const title = titleRuns
              ? titleRuns.map((r) => r.text || "").join("")
              : v.title?.simpleText || "";
            const channelRuns =
              v.ownerText?.runs || v.longBylineText?.runs || [];
            const channel = channelRuns[0]?.text || "";
            const thumbs = v.thumbnail?.thumbnails || [];
            const thumb = thumbs.length ? thumbs[thumbs.length - 1].url : "";
            out.push({
              videoId: v.videoId,
              title: title.trim(),
              channel: channel.trim(),
              thumbUrl: thumb,
              watchUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
            });
          }
          for (const value of Object.values(node)) walk(value, out);
        }

        async function runOne(q, max) {
          const res = await fetch(searchUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              context: {
                client: {
                  clientName: "WEB",
                  clientVersion: "2.20260101.00.00",
                  hl: "en",
                  gl: "US",
                },
              },
              query: q,
            }),
          });
          if (!res.ok) throw new Error(`YouTube search ${res.status}`);
          const data = await res.json();
          const found = [];
          walk(data, found);
          const seen = new Set();
          const unique = [];
          for (const item of found) {
            if (seen.has(item.videoId)) continue;
            seen.add(item.videoId);
            unique.push(item);
            if (unique.length >= max) break;
          }
          return unique;
        }

        const merged = [];
        const globalSeen = new Set();
        for (const job of searchJobs) {
          const batch = await runOne(job.query, job.limit);
          for (const item of batch) {
            if (globalSeen.has(item.videoId)) continue;
            globalSeen.add(item.videoId);
            merged.push({ ...item, reason: job.reason || "", query: job.query });
          }
        }
        return merged;
      },
    });

    if (result == null) {
      throw new Error("Пустой ответ из вкладки YouTube");
    }
    return result;
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* already closed */
    }
  }
}

// --- GIF job: capture frames in a real YouTube tab, keep result in storage.
// The popup closes as soon as the tab opens, so the worker owns the job and
// reopens the popup when it is done.

async function setJob(patch) {
  const { gifJob } = await chrome.storage.local.get("gifJob");
  const next = { ...(gifJob || {}), ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ gifJob: next });
  return next;
}

// GIF is 320px wide → 360p ("medium") is plenty and loads much faster than
// the 720p+ a full-size watch tab picks. setPlaybackQualityRange also saves
// the choice in localStorage for a year, so we put the user's own value back.
const CAPTURE_QUALITY = "medium";
const QUALITY_KEY = "yt-player-quality";

async function forceLowQuality(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CAPTURE_QUALITY, QUALITY_KEY],
      func: async (quality, key) => {
        const saved = localStorage.getItem(key);
        for (let i = 0; i < 50; i++) {
          const player = document.getElementById("movie_player");
          if (player?.setPlaybackQualityRange) {
            player.setPlaybackQualityRange(quality, quality);
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return { saved };
      },
    });
    return result;
  } catch {
    // Not fatal — capture still works at whatever quality YouTube picks.
    return null;
  }
}

async function restoreQualityPref(tabId, pref) {
  if (!pref) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [QUALITY_KEY, pref.saved],
      func: (key, saved) => {
        if (saved == null) localStorage.removeItem(key);
        else localStorage.setItem(key, saved);
      },
    });
  } catch {
    /* tab already gone */
  }
}

async function readCaptureResult() {
  const { gifCaptureResult } = await chrome.storage.local.get("gifCaptureResult");
  await chrome.storage.local.remove("gifCaptureResult");
  return gifCaptureResult || null;
}

async function makeGif({ video, crop, track }) {
  await chrome.storage.local.remove("gifCaptureResult");
  await chrome.storage.local.set({
    gifJob: {
      status: "working",
      progress: "Открываю YouTube",
      video,
      crop,
      track,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    },
  });

  // Keep the service worker awake while we wait on the tab.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 15000);
  let tab = null;
  let qualityPref = null;
  try {
    const t = Math.floor(crop.startSec);
    tab = await chrome.tabs.create({
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}&t=${t}s`,
      active: true,
    });
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { muted: true, active: true });
    await waitTabComplete(tab.id, 45000);
    // Let the player boot before we poke it.
    await new Promise((r) => setTimeout(r, 1200));
    qualityPref = await forceLowQuality(tab.id);

    // Stay on the YouTube tab for the whole capture (no popup mid-flight).
    const focusPulse = setInterval(() => {
      chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    }, 4000);

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["vendor/gifenc.js", "capture.js"],
      });
      await setJob({ progress: "Снимаю кадры (можно не трогать вкладку)" });
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [{ start: crop.startSec, duration: crop.durationSec }],
        func: (opts) => window.__ttgCapture(opts),
      });

      const stored = await readCaptureResult();
      const payload = stored || result;
      if (!payload?.ok) {
        throw new Error(
          payload?.error || result?.error || "Пустой ответ из вкладки YouTube",
        );
      }
      // Prefer storage payload (has dataUrl); result may only be a stub.
      const gifResult = stored?.ok
        ? stored
        : result?.dataUrl
          ? result
          : null;
      if (!gifResult?.dataUrl) {
        throw new Error(
          "Гифка собралась, но не сохранилась. Попробуй ещё раз / Reload расширения.",
        );
      }
      await setJob({ status: "done", progress: "", result: gifResult });
    } finally {
      clearInterval(focusPulse);
    }
  } catch (err) {
    await setJob({ status: "error", error: err?.message || String(err) });
  } finally {
    clearInterval(keepAlive);
    if (tab) {
      await restoreQualityPref(tab.id, qualityPref);
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        /* user closed it */
      }
    }
    try {
      await chrome.action.openPopup();
    } catch {
      /* no focused window — user opens the popup by hand */
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "MAKE_GIF") {
    // Keep the worker alive for the async job (MV3).
    makeGif(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || String(err) }),
      );
    return true;
  }
  if (msg?.type === "GIF_PROGRESS") {
    setJob({ progress: msg.text });
    return false;
  }
  if (msg?.type !== "SEARCH_YOUTUBE") return false;
  const queries = Array.isArray(msg.queries)
    ? msg.queries
    : [{ query: msg.query || "", limit: msg.limit || 3, reason: "" }];
  searchViaYouTubeTab(queries)
    .then((videos) => sendResponse({ ok: true, videos }))
    .catch((err) =>
      sendResponse({ ok: false, error: err?.message || String(err) }),
    );
  return true;
});
