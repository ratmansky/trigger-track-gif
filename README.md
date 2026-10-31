# trigger-track-gif

Chrome extension for ~5 Trigger FM friends: GIF from the **current track** → chat.

## Idea

1. Read now-playing on Trigger  
2. Show matching YouTube videos  
3. User picks one → sets start + length (≤ 8 s)  
4. Frames are captured from a YouTube tab → GIF → preview in the popup  
5. Upload to catbox.moe → link goes into the Trigger chat input  

Install: zip / Load unpacked (no Chrome Web Store for v1).

## Decisions

See [`docs/decisions.md`](docs/decisions.md).  
Spike YouTube without helper: [`docs/spike-youtube-no-helper.md`](docs/spike-youtube-no-helper.md).

## Status

v0.4: full flow works end to end (track → YouTube → crop → GIF → catbox → chat input).

## Install / update

1. `chrome://extensions` → Developer mode on  
2. Load unpacked → `extension/` (or Reload on the card after `git pull`)  
3. Pin the icon, open triggerfm.online, click the icon
