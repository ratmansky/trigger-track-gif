const els = {
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
  picked: document.getElementById("picked"),
};

let currentTrack = null;
let selectedVideoId = null;

function showError(message) {
  els.state.classList.remove("hidden");
  els.state.classList.add("error");
  els.state.textContent = message;
  els.card.classList.add("hidden");
  els.ytBlock.classList.add("hidden");
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

function renderVideos(videos) {
  els.ytList.innerHTML = "";
  for (const video of videos) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "yt-item" + (video.videoId === selectedVideoId ? " selected" : "");
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
    btn.addEventListener("click", () => selectVideo(video, videos));
    els.ytList.appendChild(btn);
  }
}

async function selectVideo(video, videos) {
  selectedVideoId = video.videoId;
  renderVideos(videos);
  els.picked.classList.remove("hidden");
  els.picked.textContent = `Выбрано: ${video.title}`;
  await chrome.storage.session.set({
    selectedVideo: {
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
    },
  });
}

async function loadYouTube(track) {
  els.ytBlock.classList.remove("hidden");
  els.picked.classList.add("hidden");
  els.ytList.innerHTML = "";
  els.ytState.classList.remove("error");
  els.ytState.textContent = "Ищу на YouTube…";

  const query = searchQueryFor(track);
  try {
    const videos = await searchYouTubeVideos(query, 3);
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
  selectedVideoId = null;
  els.state.classList.remove("hidden", "error");
  els.state.textContent = "Читаю трек с Trigger…";
  els.card.classList.add("hidden");
  els.ytBlock.classList.add("hidden");

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

els.refresh.addEventListener("click", () => {
  refresh();
});

refresh();
