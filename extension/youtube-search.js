/**
 * Ask the service worker to search YouTube from a real youtube.com tab.
 * (Direct fetch from the popup gets HTTP 403.)
 *
 * @param {string | Array<{query:string, limit?:number, reason?:string}>} queryOrJobs
 * @param {number} [limit]
 */
async function searchYouTubeVideos(queryOrJobs, limit = 3) {
  const queries = Array.isArray(queryOrJobs)
    ? queryOrJobs
    : [{ query: String(queryOrJobs || "").trim(), limit, reason: "" }];

  const response = await chrome.runtime.sendMessage({
    type: "SEARCH_YOUTUBE",
    queries,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "YouTube search failed");
  }
  return response.videos || [];
}

/**
 * Broader search plan: track match + live + visual/MV + artist alone.
 * Goal: not only “album audio preview”, but something to *look* at.
 */
function buildYouTubeSearchPlan(track) {
  const artist = String(track?.artist || "").trim();
  const title = String(track?.title || "").trim();
  const jobs = [];

  if (artist && title) {
    jobs.push({
      query: `${artist} ${title}`,
      limit: 2,
      reason: "трек",
    });
  }
  if (artist) {
    jobs.push({
      query: `${artist} live performance`,
      limit: 2,
      reason: "live",
    });
    jobs.push({
      query: `${artist} official video`,
      limit: 2,
      reason: "клип",
    });
    jobs.push({
      query: artist,
      limit: 2,
      reason: "артист",
    });
  } else if (title) {
    jobs.push({ query: title, limit: 4, reason: "трек" });
  }

  return jobs;
}
