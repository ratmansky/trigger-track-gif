(() => {
  const SELECTORS = {
    barTitle: "#player-bar-artist-title-display .title-name",
    barArtist: "#player-bar-artist-title-display .artist-name",
    barCover: "#player-bar-cover-art-img",
    sideCombined: "#current-track-artist-title .title-name",
    sideCover: "#current-track-artwork",
    landingArtist: "#landing-track-artist",
    landingTitle: "#landing-track-name",
    landingCombined: "#landing-track-title",
    landingCover: "#landing-cover",
  };

  function text(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function parseCombined(raw) {
    if (!raw) return { artist: "", title: "" };
    const parts = raw.split(/\s[-–—]\s/);
    if (parts.length >= 2) {
      return {
        artist: parts[0].trim(),
        title: parts.slice(1).join(" - ").trim(),
      };
    }
    return { artist: "", title: raw };
  }

  function readTrack() {
    const titleFromBar = text(document.querySelector(SELECTORS.barTitle));
    const artistFromBar = text(document.querySelector(SELECTORS.barArtist));

    let artist = artistFromBar;
    let title = titleFromBar;
    let source = "";

    if (artist && title) {
      source = "player-bar";
    } else {
      const landingArtist = text(document.querySelector(SELECTORS.landingArtist));
      const landingTitle = text(document.querySelector(SELECTORS.landingTitle));
      if (landingArtist || landingTitle) {
        artist = landingArtist;
        title = landingTitle;
        source = "landing";
      }
    }

    if (!artist || !title) {
      const combined = parseCombined(
        text(document.querySelector(SELECTORS.sideCombined)) ||
          text(document.querySelector(SELECTORS.landingCombined)),
      );
      artist = artist || combined.artist;
      title = title || combined.title;
      if (!source && (combined.artist || combined.title)) source = "combined";
    }

    const coverEl =
      document.querySelector(SELECTORS.barCover) ||
      document.querySelector(SELECTORS.sideCover) ||
      document.querySelector(SELECTORS.landingCover);

    return {
      ok: Boolean(artist || title),
      artist,
      title,
      coverUrl: coverEl?.currentSrc || coverEl?.src || "",
      raw: [artist, title].filter(Boolean).join(" — "),
      source: source || "dom",
      updatedAt: Date.now(),
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "GET_TRACK") {
      sendResponse(readTrack());
      return true;
    }
    return false;
  });
})();
