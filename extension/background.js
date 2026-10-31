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

async function searchViaYouTubeTab(query, limit) {
  const tab = await chrome.tabs.create({ url: YT_HOME, active: false });
  try {
    await waitTabComplete(tab.id);
    // Give the page a beat to settle cookies / boot.
    await new Promise((r) => setTimeout(r, 400));

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [query, limit, YT_SEARCH],
      func: async (q, max, searchUrl) => {
        function walk(node, out) {
          if (!node || out.length >= 12) return;
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
        if (!res.ok) {
          throw new Error(`YouTube search ${res.status}`);
        }
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "SEARCH_YOUTUBE") return false;
  searchViaYouTubeTab(msg.query || "", msg.limit || 3)
    .then((videos) => sendResponse({ ok: true, videos }))
    .catch((err) =>
      sendResponse({ ok: false, error: err?.message || String(err) }),
    );
  return true;
});
