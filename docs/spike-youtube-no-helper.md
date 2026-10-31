# Spike: YouTube без native helper (2026-10-31)

Вопрос: можно ли в чистом Chrome extension получить файл ролика для кропа **без** yt-dlp/helper на компе?

## Короткий ответ

**Да, но хрупко и в серой зоне ToS.** Рабочий путь без helper — не «скачать как yt-dlp», а **перехватить уже подписанные URL стримов**, которые сам плеер YouTube запрашивает (`*.googlevideo.com/videoplayback`), и сфетчить их из расширения (offscreen / service worker). Потом mux (H.264+AAC → MP4) в браузере.

Надёжный «всегда работает» путь без серой зоны — только helper или свой сервер (Cobalt и т.п.).

## Что проверено (research, не код)

| Подход | Без helper? | Оценка |
|--------|-------------|--------|
| MediaRecorder с YouTube iframe | да | почти не работает (EME/CORS) |
| YouTube Data API | да | только метаданные/поиск, **не** байты видео |
| Публичный Cobalt API | N/A | public API выключили (2024); нужен **свой** инстанс = сервер, не native |
| Перехват `googlevideo` URL из вкладки/эмбеда | да | реально делают MV3-расширения (напр. подход SK Video Downloader / avi12) |
| Native + yt-dlp | нет | отложено по решению |

## Рекомендуемый план для `trigger-track-gif`

1. **PoC v0:** открыть выбранный ролик (вкладка или скрытый player) → content/background ловит `videoplayback` → сохранить blob во временный OPFS/IndexedDB → trim UI.  
2. Если PoC стабилен на 5 машинах — оставляем без helper.  
3. Если ломается раз в месяц от обновлений YT — план B: native helper или маленький Cobalt.

## Риски

- ToS YouTube / копирайт клипов → только для маленькой дружеской группы, не Store.  
- Подписи URL истекают; нужен «живой» плеер.  
- Часто только progressive / H.264+AAC удобно муксить без тяжёлого re-encode.  
- Chrome Web Store такие расширения банит — нам ок (ручная установка).

## Следующий код-spike

Минимальный MV3: кнопка «fetch streams for this watch URL» + лог пойманных itag/URL (без полного UI Trigger/Giphy).
