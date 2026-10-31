const MAX_DURATION = 8;
const DEFAULT_DURATION = 3;

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
  cropThumb: document.getElementById("cropThumb"),
  cropTitle: document.getElementById("cropTitle"),
  cropChannel: document.getElementById("cropChannel"),
  startSec: document.getElementById("startSec"),
  durationSec: document.getElementById("durationSec"),
  previewCrop: document.getElementById("previewCrop"),
  saveCrop: document.getElementById("saveCrop"),
  backToList: document.getElementById("backToList"),
  cropSaved: document.getElementById("cropSaved"),
};

let currentTrack = null;
let selectedVideo = null;
let lastVideos = [];

function showError(message) {
  els.state.classList.remove("hidden");
  els.state.classList.add("error");
  els.state.textContent = message;
  els.card.classList.add("hidden");
  els.ytBlock.classList.add("hidden");
  els.cropBlock.classList.add("hidden");
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

function searchQueryFor(track) {
  return [track.artist, track.title].filter(Boolean).join(" ").trim();
}

function setStep(step) {
  if (step === "list") {
    els.badge.textContent = "этап B";
    els.hint.textContent = "Кликни ролик — кроп откроется здесь же.";
    els.ytBlock.classList.remove("hidden");
    els.cropBlock.classList.add("hidden");
  } else if (step === "crop") {
    els.badge.textContent = "этап D";
    els.hint.textContent = "Выставь отрезок. Превью откроет YouTube с нужной секунды.";
    els.ytBlock.classList.add("hidden");
    els.cropBlock.classList.remove("hidden");
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
    `;
    const img = btn.querySelector(".yt-thumb");
    img.src = video.thumbUrl || "";
    btn.querySelector(".yt-title").textContent = video.title || video.videoId;
    btn.querySelector(".yt-channel").textContent = video.channel || "YouTube";
    btn.addEventListener("click", () => selectVideo(video));
    els.ytList.appendChild(btn);
  }
}

function clampRange() {
  let start = Number(els.startSec.value);
  let duration = Number(els.durationSec.value);
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(duration) || duration < 1) duration = DEFAULT_DURATION;
  if (duration > MAX_DURATION) duration = MAX_DURATION;
  els.startSec.value = String(start);
  els.durationSec.value = String(duration);
  return { start, duration, end: start + duration };
}

function showCrop(video) {
  selectedVideo = video;
  els.cropThumb.src = video.thumbUrl || "";
  els.cropTitle.textContent = video.title || video.videoId;
  els.cropChannel.textContent = video.channel || "YouTube";
  els.startSec.value = String(video.crop?.startSec ?? 0);
  els.durationSec.value = String(video.crop?.durationSec ?? DEFAULT_DURATION);
  els.cropSaved.classList.add("hidden");
  if (video.crop) {
    els.cropSaved.classList.remove("hidden");
    els.cropSaved.textContent = `Уже сохранён: ${video.crop.startSec}s → ${video.crop.endSec}s`;
  }
  setStep("crop");
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
  els.ytState.textContent = "Ищу на YouTube… (мигнёт фоновая вкладка — так надо)";

  const query = searchQueryFor(track);
  try {
    const videos = await searchYouTubeVideos(query, 3);
    lastVideos = videos;
    if (!videos.length) {
      els.ytState.classList.add("error");
      els.ytState.textContent = `Ничего не нашли по «${query}».`;
      return;
    }
    els.ytState.textContent = `По запросу «${query}» — ${videos.length} из выдачи:`;
    renderVideos(videos);
  } catch (err) {
    els.ytState.classList.add("error");
    els.ytState.textContent = `YouTube поиск не вышел: ${err?.message || err}`;
  }
}

async function refresh() {
  selectedVideo = null;
  lastVideos = [];
  els.state.classList.remove("hidden", "error");
  els.state.textContent = "Читаю трек с Trigger…";
  els.card.classList.add("hidden");
  els.ytBlock.classList.add("hidden");
  els.cropBlock.classList.add("hidden");
  els.badge.textContent = "этап A";

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

els.previewCrop.addEventListener("click", async () => {
  if (!selectedVideo?.videoId) return;
  const range = clampRange();
  const t = Math.floor(range.start);
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(selectedVideo.videoId)}&t=${t}s`;
  await chrome.tabs.create({ url, active: true });
});

els.saveCrop.addEventListener("click", async () => {
  if (!selectedVideo?.videoId) return;
  const range = clampRange();
  const crop = {
    startSec: range.start,
    durationSec: range.duration,
    endSec: range.end,
    savedAt: Date.now(),
  };
  selectedVideo = { ...selectedVideo, crop };
  await chrome.storage.session.set({ selectedVideo });
  els.cropSaved.classList.remove("hidden");
  els.cropSaved.textContent = `Отрезок сохранён: ${range.start}s → ${range.end}s (${range.duration} сек). Дальше — вырезание файла.`;
});

els.backToList.addEventListener("click", () => {
  els.cropSaved.classList.add("hidden");
  setStep("list");
  if (lastVideos.length) renderVideos(lastVideos);
});

els.refresh.addEventListener("click", () => {
  refresh();
});

["change", "input"].forEach((evt) => {
  els.startSec.addEventListener(evt, () => clampRange());
  els.durationSec.addEventListener(evt, () => clampRange());
});

refresh();
