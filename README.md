# SoundboardJCG

[![FoundryVTT](https://img.shields.io/badge/FoundryVTT-v12%2B-informational)](https://foundryvtt.com)
[![Latest Release](https://img.shields.io/github/v/release/foredayner/soundboardsjcg)](https://github.com/foredayner/soundboardsjcg/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A soundboard module for [Foundry Virtual Tabletop](https://foundryvtt.com).  
The GM places audio files in the module's `sounds/` folder, and all players can see and play them. Playback is synchronized across all connected clients in real time.

---

## Features

- **Auto-generated buttons** — Audio files in `modules/soundboardsjcg/sounds/` are automatically turned into playback buttons
- **Subfolder navigation** — Switch between subfolders using the ▽ dropdown in the header
- **Search** — Filter buttons by name in real time
- **Synchronized playback** — Anyone pressing a button plays the sound for all connected clients simultaneously
- **Now Playing sidebar** — Shows currently playing sounds with a progress bar, time remaining, and a stop button
- **Global stop** — Stop all sounds at once via the right-click context menu
- **Master volume** — A per-client volume slider at the bottom of the sidebar; does not affect other clients
- **Right-click context menu** — Adjust individual volume (applied instantly), rename buttons (GM only), view file duration, play exclusively, or stop all. Draggable window
- **Scene Note support** — GM can place a Note on the scene; all players can click it to open the soundboard
- **Player support** — File list is cached by the GM and shared with players via World Settings

---

## Installation

### Manual
1. Download the [latest release](https://github.com/foredayner/soundboardsjcg/releases/latest) ZIP
2. Extract and place the `soundboardsjcg/` folder inside your FoundryVTT `Data/modules/` directory
3. Restart FoundryVTT and enable **SoundboardJCG** in **Manage Modules**

### Via Manifest URL
Paste the following URL into FoundryVTT's **Install Module** dialog:
```
https://github.com/foredayner/soundboardsjcg/releases/latest/download/module.json
```

---

## Setup

### Adding sounds
Place audio files inside `modules/soundboardsjcg/sounds/`. Subfolders are supported.

```
soundboardsjcg/
└── sounds/
    ├── gunshot.mp3
    ├── rain.ogg
    └── battle/
        └── explosion.wav
```

Supported formats: `mp3`, `wav`, `ogg`, `oga`, `flac`, `webm`

### Opening the soundboard
Enter a scene → left toolbar → **Ambient Sounds** group → ⊞ icon

### Placing a Scene Note (for players)
1. Create a new macro in FoundryVTT
2. Paste the contents of `macros/create-soundboard-note.js` and run it
3. A 🔊 Note is created at the center of the scene — clicking it opens the soundboard for GM and players alike

---

## Usage

| Action | How |
|---|---|
| Play a sound | Left-click a button |
| Open context menu | Right-click a button or a Now Playing item |
| Stop a specific sound | Click ✕ in the Now Playing sidebar |
| Stop all sounds | Right-click → "Stop All" |
| Adjust master volume | Drag the slider at the bottom of the sidebar |
| Change button name | Right-click → edit name field (GM only) |
| Switch folder | Click ▽ in the header |
| Refresh file list | Click 🔄 in the header |

---

## Compatibility

| FoundryVTT | Status |
|---|---|
| V14 | ✅ Verified |
| V13 | ✅ Compatible |
| V12 | ✅ Compatible |

---

## File Structure

```
soundboardsjcg/
├── module.json
├── scripts/
│   └── soundboard.js
├── styles/
│   └── soundboard.css
├── lang/
│   └── ko.json
├── macros/
│   └── create-soundboard-note.js
├── sounds/              ← Place your audio files here
└── README.md
```

---

## Changelog

### 1.2.0
- Player support via GM file cache (World Settings)
- Scene Note integration for players
- Master volume slider (per-client)
- Draggable right-click context menu
- Socket-based playback and Now Playing sync across all clients
- Stop button propagates to all clients

### 1.1.0
- Right-click context menu (volume, rename, exclusive play)
- Now Playing sidebar with progress bar and time remaining
- Search/filter
- Subfolder navigation

### 1.0.0
- Initial release

---

## License

[MIT](LICENSE)
