const MAX_DURATION = 8;
const DEFAULT_DURATION = 3;

const els = {
  state: document.getElementById("state"),
  stage: document.getElementById("stage"),
  trackLine: document.getElementById("trackLine"),
  videoLine: document.getElementById("videoLine"),
  player: document.getElementById("player"),
  startSec: document.getElementById("startSec"),
  durationSec: document.getElementById("durationSec"),
  preview: document.getElementById("preview"),
  save: document.getElementById("save"),
  saved: document.getElementById("saved"),
  back: document.getElementById("back"),
};

let selected = null;

function showError(message) {
  els.state.classList.remove("hidden");
  els.state.classList.add("error");
  els.state.textContent = message;
  els.stage.classList.add("hidden");
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

function embedUrl({ videoId, start, end, autoplay }) {
  const params = new URLSearchParams({
    start: String(Math.floor(start)),
    end: String(Math.ceil(end)),
    rel: "0",
    modestbranding: "1",
    autoplay: autoplay ? "1" : "0",
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
}

function loadPlayer(autoplay) {
  const range = clampRange();
  els.player.src = embedUrl({
    videoId: selected.videoId,
    start: range.start,
    end: range.end,
    autoplay,
  });
}

els.back.addEventListener("click", () => {
  window.close();
});

async function init() {
  const { selectedVideo } = await chrome.storage.session.get("selectedVideo");
  if (!selectedVideo?.videoId) {
    showError("Ролик не выбран. Вернись в popup расширения и кликни один из YouTube-результатов.");
    return;
  }

  selected = selectedVideo;
  const track = selected.track;
  els.trackLine.textContent = track
    ? `Трек Trigger: ${track.artist || "?"} — ${track.title || "?"}`
    : "Трек Trigger: —";
  els.videoLine.textContent = `YouTube: ${selected.title || selected.videoId}`;

  els.state.classList.add("hidden");
  els.stage.classList.remove("hidden");
  loadPlayer(false);

  const existing = selected.crop;
  if (existing) {
    els.startSec.value = String(existing.startSec ?? 0);
    els.durationSec.value = String(existing.durationSec ?? DEFAULT_DURATION);
    els.saved.classList.remove("hidden");
    els.saved.textContent = `Уже сохранён отрезок ${existing.startSec}s → ${existing.endSec}s. Можно поправить.`;
    loadPlayer(false);
  }
}

els.preview.addEventListener("click", () => {
  loadPlayer(true);
});

els.save.addEventListener("click", async () => {
  const range = clampRange();
  const crop = {
    startSec: range.start,
    durationSec: range.duration,
    endSec: range.end,
    savedAt: Date.now(),
  };

  const next = { ...selected, crop };
  await chrome.storage.session.set({ selectedVideo: next });
  selected = next;

  els.saved.classList.remove("hidden");
  els.saved.textContent = `Отрезок сохранён: ${range.start}s → ${range.end}s (${range.duration} сек).`;
  loadPlayer(true);
});

["change", "input"].forEach((evt) => {
  els.startSec.addEventListener(evt, () => clampRange());
  els.durationSec.addEventListener(evt, () => clampRange());
});

init();
