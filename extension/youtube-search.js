/**
 * Ask the service worker to search YouTube from a real youtube.com tab.
 * (Direct fetch from the popup gets HTTP 403.)
 */
async function searchYouTubeVideos(query, limit = 3) {
  const q = String(query || "").trim();
  if (!q) return [];

  const response = await chrome.runtime.sendMessage({
    type: "SEARCH_YOUTUBE",
    query: q,
    limit,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "YouTube search failed");
  }
  return response.videos || [];
}
