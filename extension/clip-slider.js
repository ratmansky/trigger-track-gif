/**
 * Start/end picker for the GIF clip.
 *
 * A 300px slider over a 3–4 min song moves ~0.7 s per pixel — too coarse.
 * So two levels:
 *   - overview: thin slider over the whole video, drags the clip around;
 *   - fine: two thumbs (start, end) over a ~30 s window around the clip.
 * The clip is always between minLen and maxLen seconds long: pulling one
 * thumb past the limit drags the other one along.
 */
function formatClock(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${rest}`;
}

function createClipSlider(
  root,
  { maxLen = 6, minLen = 1, windowLen = 30, onChange } = {},
) {
  const round = (x) => Math.round(x * 10) / 10;
  const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

  root.classList.add("clip-slider");
  root.innerHTML = `
    <div class="clip-section">
      <div class="clip-section-label">Где в ролике</div>
      <div class="clip-overview" title="Перетащи отрезок по ролику">
        <input class="clip-ov" type="range" step="0.1" />
      </div>
    </div>
    <div class="clip-section">
      <div class="clip-section-label">Точный кроп · макс ${maxLen} сек</div>
      <div class="clip-fine">
        <div class="clip-track">
          <div class="clip-dim clip-dim-l"></div>
          <div class="clip-fill"></div>
          <div class="clip-dim clip-dim-r"></div>
          <div class="clip-playhead hidden"></div>
        </div>
        <input class="clip-thumb clip-start" type="range" step="0.1" aria-label="Начало" />
        <input class="clip-thumb clip-end" type="range" step="0.1" aria-label="Конец" />
      </div>
      <div class="clip-labels">
        <span class="clip-chip clip-l-start"></span>
        <span class="clip-chip clip-chip-accent clip-l-len"></span>
        <span class="clip-chip clip-l-end"></span>
      </div>
    </div>
  `;
  const ov = root.querySelector(".clip-ov");
  const startIn = root.querySelector(".clip-start");
  const endIn = root.querySelector(".clip-end");
  const fill = root.querySelector(".clip-fill");
  const dimL = root.querySelector(".clip-dim-l");
  const dimR = root.querySelector(".clip-dim-r");
  const playhead = root.querySelector(".clip-playhead");
  const lStart = root.querySelector(".clip-l-start");
  const lLen = root.querySelector(".clip-l-len");
  const lEnd = root.querySelector(".clip-l-end");

  // Until the player reports the real length, assume a long-ish video.
  let duration = 600;
  let start = 0;
  let end = 3;
  let winStart = 0;

  const win = () => Math.min(windowLen, duration);
  const pct = (t) => ((t - winStart) / win()) * 100;

  function recenter() {
    winStart = clamp(
      (start + end) / 2 - win() / 2,
      0,
      Math.max(0, duration - win()),
    );
    winStart = Math.floor(winStart);
  }

  function render() {
    const lo = winStart;
    const hi = winStart + win();
    for (const input of [startIn, endIn]) {
      input.min = String(lo);
      input.max = String(hi);
    }
    startIn.value = String(start);
    endIn.value = String(end);
    ov.min = "0";
    ov.max = String(Math.max(0, duration - (end - start)));
    ov.value = String(start);

    const left = pct(start);
    const right = pct(end);
    fill.style.left = `${left}%`;
    fill.style.width = `${Math.max(0, right - left)}%`;
    dimL.style.width = `${Math.max(0, left)}%`;
    dimR.style.left = `${right}%`;
    dimR.style.width = `${Math.max(0, 100 - right)}%`;

    lStart.textContent = formatClock(start);
    lEnd.textContent = formatClock(end);
    lLen.textContent = `${(end - start).toFixed(1)} сек`;
  }

  function emit() {
    render();
    onChange?.(start, end);
  }

  function setFromStart(value) {
    start = round(clamp(value, 0, duration - minLen));
    if (end - start > maxLen) end = round(start + maxLen);
    if (end - start < minLen) end = round(start + minLen);
    end = Math.min(end, duration);
  }

  function setFromEnd(value) {
    end = round(clamp(value, minLen, duration));
    if (end - start > maxLen) start = round(end - maxLen);
    if (end - start < minLen) start = round(end - minLen);
    start = Math.max(start, 0);
  }

  startIn.addEventListener("input", () => {
    setFromStart(Number(startIn.value));
    emit();
  });
  endIn.addEventListener("input", () => {
    setFromEnd(Number(endIn.value));
    emit();
  });

  function maybeRecenter() {
    const edge = win() * 0.1;
    if (start < winStart + edge || end > winStart + win() - edge) {
      recenter();
      render();
    }
  }
  startIn.addEventListener("change", maybeRecenter);
  endIn.addEventListener("change", maybeRecenter);

  ov.addEventListener("input", () => {
    const len = end - start;
    start = round(clamp(Number(ov.value), 0, Math.max(0, duration - len)));
    end = round(start + len);
    recenter();
    emit();
  });

  return {
    set(newStart, newEnd) {
      start = round(Math.max(0, newStart));
      end = round(newEnd);
      setFromStart(start);
      setFromEnd(end);
      recenter();
      render();
    },
    setDuration(sec) {
      if (!(sec > 0) || Math.abs(sec - duration) < 0.5) return;
      duration = sec;
      if (end > duration) {
        end = round(duration);
        start = round(Math.max(0, end - Math.min(maxLen, end - start)));
      }
      recenter();
      render();
    },
    setPlayhead(t) {
      const inWindow = t >= winStart && t <= winStart + win();
      playhead.classList.toggle("hidden", !inWindow);
      if (inWindow) playhead.style.left = `${pct(t)}%`;
    },
    get() {
      return { start, end, duration: round(end - start) };
    },
  };
}
