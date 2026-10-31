/* global searchYouTubeVideos */

const YT_SEARCH_URL =
  "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";

function walkVideoRenderers(node, out) {
  if (!node || out.length >= 12) return;
  if (Array.isArray(node)) {
    for (const item of node) walkVideoRenderers(item, out);
    return;
  }
  if (typeof node !== "object") return;

  const v = node.videoRenderer;
  if (v?.videoId) {
    const titleRuns = v.title?.runs;
    const title = titleRuns
      ? titleRuns.map((r) => r.text || "").join("")
      : v.title?.simpleText || "";
    const channelRuns = v.ownerText?.runs || v.longBylineText?.runs || [];
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

  for (const value of Object.values(node)) {
    walkVideoRenderers(value, out);
  }
}

/**
 * First N organic videos for a query via YouTube InnerTube (no API key).
 */
async function searchYouTubeVideos(query, limit = 3) {
  const q = String(query || "").trim();
  if (!q) return [];

  const res = await fetch(YT_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  walkVideoRenderers(data, found);

  const seen = new Set();
  const unique = [];
  for (const item of found) {
    if (seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}
