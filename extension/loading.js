/**
 * Text loader with cycling ellipsis: "текст." → "текст.." → "текст..."
 */
function createDotsLoader(el) {
  let base = "";
  let tick = 0;
  let timer = null;
  let running = false;

  function paint() {
    if (!el) return;
    const dots = ".".repeat((tick % 3) + 1);
    el.textContent = `${base}${dots}`;
    tick += 1;
  }

  return {
    start(text) {
      if (!el) return;
      base = String(text || "").replace(/\.+$/, "");
      tick = 0;
      running = true;
      el.classList.add("is-loading");
      el.classList.remove("error", "hidden");
      paint();
      clearInterval(timer);
      timer = setInterval(paint, 420);
    },
    setText(text) {
      base = String(text || "").replace(/\.+$/, "");
      if (running) paint();
      else if (el) el.textContent = `${base}…`;
    },
    stop(finalText) {
      running = false;
      clearInterval(timer);
      timer = null;
      if (!el) return;
      el.classList.remove("is-loading");
      if (finalText != null) el.textContent = finalText;
    },
    get active() {
      return running;
    },
  };
}
