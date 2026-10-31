const MAX_DURATION = 6;
const JOB_STALE_MS = 4 * 60 * 1000;
const CATBOX_API = "https://catbox.moe/user/api.php";
const POMF_API = "https://pomf.lain.la/upload.php";
const DEFAULT_DURATION = 3;
// Intros are often logos / black; 30 s in is usually already the song.
const DEFAULT_START = 30;

const els = {
  badge: document.getElementById("badge"),
  hint: document.getElementById("hint"),
  state: document.getElementById("state"),
  card: document.getElementById("card"),
  cover: document.getElementById("cover"),
  title: document.getElementById("title"),
  artist: document.getElementById("artist"),
  source: document.getElementById("source"),
  refresh: document.getElementById("refresh"),
  ytBlock: document.getElementById("ytBlock"),
  ytState: document.getElementById("ytState"),
  ytList: document.getElementById("ytList"),
  cropBlock: document.getElementById("cropBlock"),
  ytPlayer: document.getElementById("ytPlayer"),
  loopBadge: document.getElementById("loopBadge"),
  playerNote: document.getElementById("playerNote"),
  clipSlider: document.getElementById("clipSlider"),
  cropTitle: document.getElementById("cropTitle"),
  cropChannel: document.getElementById("cropChannel"),
  previewCrop: document.getElementById("previewCrop"),
  saveCrop: document.getElementById("saveCrop"),
  backToList: document.getElementById("backToList"),
  cropSaved: document.getElementById("cropSaved"),
  gifBlock: document.getElementById("gifBlock"),
  gifState: document.getElementById("gifState"),
  gifImg: document.getElementById("gifImg"),
  gifInfo: document.getElementById("gifInfo"),
  gifActions: document.getElementById("gifActions"),
  uploadGif: document.getElementById("uploadGif"),
  downloadGif: document.getElementById("downloadGif"),
  redoCrop: document.getElementById("redoCrop"),
  gifLink: document.getElementById("gifLink"),
  newGif: document.getElementById("newGif"),
};

let currentTrack = null;
let selectedVideo = null;
let lastVideos = [];
let gifJob = null;

function showError(message) {
  els.state.classList.remove("hidden");
  els.state.classList.add("error");
  els.state.textContent = message;
  els.card.classList.add("hidden");
  els.ytBlock.classList.add("hidden");
  els.cropBlock.classList.add("hidden");
  els.gifBlock.classList.add("hidden");
}

function showTrack(track) {
  if (!track?.ok) {
    showError(track?.error || "Трек не найден.");
    return;
  }

  currentTrack = track;
  els.state.classList.add("hidden");
  els.card.classList.remove("hidden");
  els.title.textContent = track.title || "—";
  els.artist.textContent = track.artist || "—";
  els.source.textContent = `источник: ${track.source || "?"}`;

  if (track.coverUrl) {
    els.cover.hidden = false;
    els.cover.src = track.coverUrl;
  } else {
    els.cover.removeAttribute("src");
    els.cover.hidden = true;
  }
}

function parseCombined(raw) {
  if (!raw) return { artist: "", title: "" };
  const parts = String(raw).split(/\s[-–—]\s/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim(),
    };
  }
  return { artist: "", title: String(raw).trim() };
}

async function fetchFromApi() {
  const res = await fetch(
    `https://triggerfm.online/api/current_song_details?t=${Date.now()}`,
  );
  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }
  const details = await res.json();
  const lfm = details?.lastfm_info || {};
  let artist = (lfm.artist || "").trim();
  let title = (lfm.title || "").trim();
  if (!artist || !title) {
    const parsed = parseCombined(details?.raw_song_name);
    artist = artist || parsed.artist;
    title = title || parsed.title;
  }
  const coverUrl =
    lfm.image_url_large || lfm.image_url || lfm.album_art_url || "";

  return {
    ok: Boolean(artist || title),
    artist,
    title,
    coverUrl,
    raw: details?.raw_song_name || [artist, title].filter(Boolean).join(" — "),
    source: "api /current_song_details",
    songStatsId: details?.stats?.song_stats_id ?? null,
    updatedAt: Date.now(),
  };
}

async function fetchFromActiveTabDom() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url || !/triggerfm\.online/i.test(tab.url)) {
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "GET_TRACK" });
  } catch {
    return null;
  }
}

function setStep(step) {
  if (step !== "crop") cropPlayer.stop();
  document.body.dataset.step = step === "list" ? "list" : step;
  els.ytBlock.classList.toggle("hidden", step !== "list");
  els.cropBlock.classList.toggle("hidden", step !== "crop");
  els.gifBlock.classList.toggle("hidden", step !== "gif");
  els.refresh.classList.toggle("hidden", step === "gif");
  if (els.badge) els.badge.textContent = step;
  if (step === "list") {
    els.hint.textContent = "Кликни ролик — кроп откроется здесь же.";
  } else if (step === "crop") {
    els.hint.textContent = "Выставь отрезок. В превью крутится будущая гифка.";
  } else if (step === "gif") {
    els.hint.textContent = "Ок → зальём и вставим ссылку в чат Trigger.";
  }
}

function renderVideos(videos) {
  els.ytList.innerHTML = "";
  for (const video of videos) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "yt-item" +
      (video.videoId === selectedVideo?.videoId ? " selected" : "");
    btn.innerHTML = `
      <img class="yt-thumb" alt="" width="88" height="50" />
      <div class="yt-meta">
        <div class="yt-title"></div>
        <div class="yt-channel"></div>
      </div>
      <span class="yt-reason"></span>
    `;
    const img = btn.querySelector(".yt-thumb");
    img.src = video.thumbUrl || "";
    btn.querySelector(".yt-title").textContent = video.title || video.videoId;
    btn.querySelector(".yt-channel").textContent = video.channel || "YouTube";
    const reasonEl = btn.querySelector(".yt-reason");
    if (video.reason) {
      reasonEl.textContent = video.reason;
    } else {
      reasonEl.remove();
    }
    btn.addEventListener("click", () => selectVideo(video));
    els.ytList.appendChild(btn);
  }
}

/** Live GIF preview: loop exactly the range that will become the GIF. */
function previewRange() {
  const range = clip.get();
  if (!cropPlayer.ready) return;
  cropPlayer.setLoop(range.start, range.end);
  els.loopBadge.classList.remove("hidden");
}

const clip = createClipSlider(els.clipSlider, {
  maxLen: MAX_DURATION,
  onChange: previewRange,
});

const cropPlayer = createCropPlayer(els.ytPlayer, {
  onReady() {
    els.playerNote.classList.add("hidden");
    els.previewCrop.classList.add("hidden");
    previewRange();
  },
  onTime(now, videoLength) {
    clip.setDuration(videoLength);
    clip.setPlayhead(now);
  },
  onFail(reason) {
    els.loopBadge.classList.add("hidden");
    clip.setPlayhead(-1);
    els.previewCrop.classList.remove("hidden");
    els.playerNote.classList.remove("hidden");
    els.playerNote.textContent = `Плеер в окне не завёлся (${reason}). Ползунки работают, превью — на YouTube.`;
  },
});

function showCrop(video) {
  selectedVideo = video;
  els.cropTitle.textContent = video.title || video.videoId;
  els.cropChannel.textContent = video.channel || "YouTube";
  const start = video.crop?.startSec ?? DEFAULT_START;
  clip.set(start, video.crop?.endSec ?? start + DEFAULT_DURATION);
  els.cropSaved.classList.add("hidden");
  setStep("crop");
  els.playerNote.classList.add("hidden");
  els.previewCrop.classList.add("hidden");
  els.loopBadge.classList.add("hidden");
  cropPlayer.load(video.videoId, clip.get().start);
}

async function selectVideo(video) {
  const payload = {
    ...video,
    track: currentTrack
      ? {
          artist: currentTrack.artist,
          title: currentTrack.title,
          raw: currentTrack.raw,
          songStatsId: currentTrack.songStatsId,
        }
      : null,
    pickedAt: Date.now(),
  };
  selectedVideo = payload;
  await chrome.storage.session.set({ selectedVideo: payload });
  showCrop(payload);
}

async function loadYouTube(track) {
  setStep("list");
  els.ytBlock.classList.remove("hidden");
  els.ytList.innerHTML = "";
  els.ytState.classList.remove("error");
  els.ytState.textContent =
    "Ищу трек, live, клипы и артиста… (мигнёт фоновая вкладка)";

  const plan = buildYouTubeSearchPlan(track);
  try {
    const videos = await searchYouTubeVideos(plan);
    lastVideos = videos;
    if (!videos.length) {
      els.ytState.classList.add("error");
      els.ytState.textContent = "Ничего не нашли по расширенному поиску.";
      return;
    }
    const bits = plan.map((j) => j.reason).filter(Boolean);
    els.ytState.textContent = `${videos.length} роликов · ${bits.join(" · ")}`;
    renderVideos(videos);
  } catch (err) {
    els.ytState.classList.add("error");
    els.ytState.textContent = `YouTube поиск не вышел: ${err?.message || err}`;
  }
}

async function refresh() {
  selectedVideo = null;
  lastVideos = [];
  document.body.dataset.step = "track";
  els.hint.textContent = "Читаю, что сейчас в эфире на Trigger…";
  els.state.classList.remove("hidden", "error");
  els.state.textContent = "Читаю трек с Trigger…";
  els.card.classList.add("hidden");
  els.ytBlock.classList.add("hidden");
  els.cropBlock.classList.add("hidden");
  els.gifBlock.classList.add("hidden");
  els.refresh.classList.remove("hidden");
  if (els.badge) els.badge.textContent = "трек";

  try {
    const track = await fetchFromApi();
    showTrack(track);

    const dom = await fetchFromActiveTabDom();
    if (dom?.ok && els.source) {
      const same =
        dom.artist === track.artist && dom.title === track.title
          ? "совпадает со страницей"
          : `на странице сейчас: ${dom.artist} — ${dom.title}`;
      els.source.textContent = `${track.source} · ${same}`;
    }

    await loadYouTube(track);
  } catch (err) {
    const dom = await fetchFromActiveTabDom();
    if (dom?.ok) {
      showTrack({ ...dom, source: `${dom.source} (API недоступен)` });
      await loadYouTube(dom);
      return;
    }
    showError(
      `Не удалось прочитать трек (${err?.message || err}). Проверь интернет и нажми «Обновить».`,
    );
  }
}

function fileNameFor(job) {
  const base = [job?.track?.artist, job?.track?.title]
    .filter(Boolean)
    .join(" - ")
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .trim()
    .slice(0, 60);
  return `${base || "trigger"}.gif`;
}

function showGifJob(job) {
  gifJob = job;
  setStep("gif");
  els.state.classList.add("hidden");
  els.gifState.classList.remove("hidden", "error");
  els.gifImg.classList.add("hidden");
  els.gifActions.classList.add("hidden");
  els.gifLink.classList.add("hidden");
  els.newGif.classList.add("hidden");
  els.gifInfo.textContent = "";

  if (job.status === "working") {
    els.gifState.textContent = `${job.progress || "Делаю гифку…"} Откроется вкладка YouTube — не переключайся, окно расширения вернётся само.`;
    return;
  }

  els.newGif.classList.remove("hidden");
  if (job.status === "error") {
    els.gifState.classList.add("error");
    els.gifState.textContent = `Гифка не вышла: ${job.error}`;
    els.gifActions.classList.remove("hidden");
    els.uploadGif.classList.add("hidden");
    els.downloadGif.classList.add("hidden");
    return;
  }

  const r = job.result;
  els.gifState.classList.add("hidden");
  els.gifImg.src = r.dataUrl;
  els.gifImg.classList.remove("hidden");
  els.gifInfo.textContent = `${r.startSec}s → ${Math.round(r.endSec * 10) / 10}s · ${r.width}×${r.height} · ${r.frames} кадров · ${(r.bytes / 1024 / 1024).toFixed(1)} МБ`;
  els.gifActions.classList.remove("hidden");
  els.uploadGif.classList.toggle("hidden", Boolean(job.link));
  els.downloadGif.classList.remove("hidden");
  if (job.link) showLink(job.link, job.linkNote);
}

function showLink(url, note) {
  els.gifLink.classList.remove("hidden");
  els.gifLink.textContent = "";
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.textContent = url;
  els.gifLink.append(note ? `${note} ` : "", a);
}

async function gifBlobFromDataUrl(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.type === "image/gif") return blob;
  return new Blob([blob], { type: "image/gif" });
}

async function uploadToCatbox(blob, fileName) {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", blob, fileName);
  const { catboxUserhash } = await chrome.storage.local.get("catboxUserhash");
  if (catboxUserhash) form.append("userhash", String(catboxUserhash));
  const res = await fetch(CATBOX_API, { method: "POST", body: form });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https:\/\//.test(text)) {
    throw new Error(`catbox ${res.status}: ${text.slice(0, 120) || "пустой ответ"}`);
  }
  return text;
}

/** Fallback when catbox blocks anonymous uploads (HTTP 412 Invalid uploader). */
async function uploadToPomf(blob, fileName) {
  const form = new FormData();
  form.append("files[]", blob, fileName);
  const res = await fetch(POMF_API, { method: "POST", body: form });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`pomf ${res.status}: ${text.slice(0, 120) || "не JSON"}`);
  }
  const url = data?.files?.[0]?.url;
  if (!res.ok || !data?.success || !url || !/^https:\/\//.test(url)) {
    throw new Error(`pomf ${res.status}: ${text.slice(0, 120) || "пустой ответ"}`);
  }
  return url;
}

async function uploadGifHost(dataUrl, fileName) {
  const blob = await gifBlobFromDataUrl(dataUrl);
  try {
    return await uploadToCatbox(blob, fileName);
  } catch (err) {
    const msg = String(err?.message || err);
    // Catbox edge often rejects anonymous / VPN with 412 "Invalid uploader".
    if (/catbox 412|Invalid uploader/i.test(msg)) {
      return await uploadToPomf(blob, fileName);
    }
    throw err;
  }
}

async function findTriggerTab() {
  const tabs = await chrome.tabs.query({
    url: ["https://triggerfm.online/*", "https://*.triggerfm.online/*"],
  });
  const current = await chrome.windows.getCurrent();
  return (
    tabs.find((t) => t.active && t.windowId === current.id) ||
    tabs.find((t) => t.active) ||
    tabs[0] ||
    null
  );
}

// Trigger's «Вставить картинку» just sends the image URL as a chat message.
// We put the URL into the chat input; the user presses «Отправить».
async function insertIntoTriggerChat(url) {
  const tab = await findTriggerTab();
  if (!tab) return { ok: false, error: "Вкладка Trigger не открыта" };
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [url],
    func: (text) => {
      const input = document.getElementById("message-input");
      if (!input) return { ok: false, error: "Поле чата не найдено (залогинен?)" };
      const current = input.value.trim();
      input.value = current ? `${current} ${text}` : text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      return { ok: true };
    },
  });
  if (result?.ok) {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  }
  return result || { ok: false, error: "нет ответа от вкладки" };
}

els.uploadGif.addEventListener("click", async () => {
  if (!gifJob?.result) return;
  els.uploadGif.disabled = true;
  els.uploadGif.textContent = "Заливаю…";
  try {
    const link = await uploadGifHost(gifJob.result.dataUrl, fileNameFor(gifJob));
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* clipboard is a bonus */
    }
    // Save first: activating the Trigger tab closes this popup.
    gifJob = {
      ...gifJob,
      link,
      linkNote: "В поле чата Trigger — жми «Отправить». Ссылка:",
    };
    await chrome.storage.local.set({ gifJob });
    const inserted = await insertIntoTriggerChat(link).catch((err) => ({
      ok: false,
      error: err?.message || String(err),
    }));
    if (!inserted.ok) {
      gifJob = {
        ...gifJob,
        linkNote: `${inserted.error}. Ссылка скопирована — вставь в чат:`,
      };
      await chrome.storage.local.set({ gifJob });
    }
    showGifJob(gifJob);
  } catch (err) {
    els.gifLink.classList.remove("hidden");
    els.gifLink.textContent = `Не залилось: ${err?.message || err}`;
  } finally {
    els.uploadGif.disabled = false;
    els.uploadGif.textContent = "Залить и вставить в чат";
  }
});

els.downloadGif.addEventListener("click", () => {
  if (!gifJob?.result) return;
  const a = document.createElement("a");
  a.href = gifJob.result.dataUrl;
  a.download = fileNameFor(gifJob);
  a.click();
});

els.redoCrop.addEventListener("click", () => {
  if (!gifJob?.video) return;
  if (gifJob.track) showTrack(gifJob.track);
  showCrop({ ...gifJob.video, track: gifJob.track, crop: gifJob.crop });
});

els.newGif.addEventListener("click", async () => {
  gifJob = null;
  await chrome.storage.local.remove("gifJob");
  refresh();
});

els.previewCrop.addEventListener("click", async () => {
  if (!selectedVideo?.videoId) return;
  const range = clip.get();
  const t = Math.floor(range.start);
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(selectedVideo.videoId)}&t=${t}s`;
  await chrome.tabs.create({ url, active: true });
});

els.saveCrop.addEventListener("click", async () => {
  if (!selectedVideo?.videoId) return;
  const range = clip.get();
  const crop = {
    startSec: range.start,
    durationSec: range.duration,
    endSec: range.end,
    savedAt: Date.now(),
  };
  selectedVideo = { ...selectedVideo, crop };
  await chrome.storage.session.set({ selectedVideo });
  showGifJob({ status: "working", progress: "Открываю YouTube…" });
  // The YouTube tab steals focus and closes this popup; the worker reopens it.
  await chrome.runtime.sendMessage({
    type: "MAKE_GIF",
    video: {
      videoId: selectedVideo.videoId,
      title: selectedVideo.title,
      channel: selectedVideo.channel,
      thumbUrl: selectedVideo.thumbUrl,
    },
    crop,
    track: currentTrack,
  });
});

els.backToList.addEventListener("click", () => {
  els.cropSaved.classList.add("hidden");
  if (lastVideos.length) {
    setStep("list");
    renderVideos(lastVideos);
  } else if (currentTrack) {
    loadYouTube(currentTrack);
  }
});

els.refresh.addEventListener("click", () => {
  refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.gifJob?.newValue) return;
  if (els.gifBlock.classList.contains("hidden")) return;
  showGifJob(changes.gifJob.newValue);
});

document.getElementById("version").textContent =
  `v${chrome.runtime.getManifest().version}`;

async function init() {
  const { gifJob: job } = await chrome.storage.local.get("gifJob");
  const fresh = job && Date.now() - (job.updatedAt || 0) < JOB_STALE_MS;
  if (job && (job.status !== "working" || fresh)) {
    if (job.track) showTrack(job.track);
    selectedVideo = job.video ? { ...job.video, crop: job.crop } : null;
    showGifJob(job);
    return;
  }
  refresh();
}

init();
