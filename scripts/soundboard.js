/**
 * CoC Soundboard v2.0
 * - sounds/ 폴더 자동 감지
 * - 헤더: 새로고침 | 경로 | 폴더선택▽
 * - 진행도 게이지 (좌→우)
 * - 우클릭 상세메뉴
 * - 우측 재생중 리스트
 */

const MODULE_ID = "soundboardsJCG";
const SOCKET_EVENT = "module.soundboardsJCG";
const SOUNDS_PATH = `modules/${MODULE_ID}/sounds`;

let activeSounds = [];
let soundboardAppInstance = null;
let masterVolume = 1.0; // 로컬 마스터 볼륨 (다른 클라이언트에 영향 없음)

// ── 설정 (이름/볼륨 저장) ──────────────────
function getSoundConfig() {
  return game.settings.get(MODULE_ID, "soundConfig") ?? {};
}
async function setSoundConfig(cfg) {
  await game.settings.set(MODULE_ID, "soundConfig", cfg);
}
function getLabelForSrc(src) {
  return getSoundConfig()[src]?.label ?? fileToLabel(src);
}
function getVolumeForSrc(src) {
  return getSoundConfig()[src]?.volume ?? 1.0;
}
async function updateSoundConfig(src, patch) {
  if (!game.user.isGM) return; // 플레이어는 설정 저장 불가
  const cfg = getSoundConfig();
  cfg[src] = Object.assign(cfg[src] ?? {}, patch);
  await setSoundConfig(cfg);
}

// ── 소켓 ──────────────────────────────────
function setupSocket() {
  game.socket.on(SOCKET_EVENT, async (data) => {
    // GM: 캐시 갱신
    if (data.action === "refreshCache" && game.user.isGM) {
      await gmCacheFiles(SOUNDS_PATH);
      const cache = game.settings.get(MODULE_ID, "fileCache");
      for (const dir of (cache.dirs[SOUNDS_PATH] ?? [])) await gmCacheFiles(dir);
    }
    // 다른 클라이언트가 재생 시작 → 나도 재생+추적
    if (data.action === "trackSound") {
      startTracking(data.id, data.src, data.volume, data.label);
    }
    // 다른 클라이언트가 정지 — 실제 오디오도 정지
    if (data.action === "stopSound") {
      const entry = activeSounds.find(e => e.id === data.id);
      if (entry) {
        clearInterval(entry.intervalId);
        try { entry.sound?.stop?.(); } catch(_) {}
      }
      removeEntry(data.id);
    }
    // 전체 정지
    if (data.action === "stopAll") {
      stopAllLocal();
    }
  });
}

// ── 재생 + 추적 ────────────────────────────

function getSoundClass() {
  // V13+: foundry.audio.Sound, 이전: Sound
  return foundry.audio?.Sound ?? globalThis.Sound;
}

// 로컬 재생 + Sound 객체 반환
async function playAudioLocal(src, volume) {
  try {
    const SoundClass = getSoundClass();
    const sound = new SoundClass(src);
    await sound.load();
    await sound.play({ volume: volume * masterVolume, loop: false });
    return sound;
  } catch(e) {
    console.warn("[SB] playAudioLocal 실패:", e.message);
    // 폴백: AudioHelper
    try {
      return foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
    } catch(_) { return null; }
  }
}

// 추적 시작 — 재생 + 사이드바 등록
async function startTracking(id, src, volume, label) {
  if (activeSounds.find(e => e.id === id)) return;

  const entry = {
    id, src,
    label: label ?? getLabelForSrc(src),
    sound: null, startTime: Date.now(), duration: 0, volume
  };
  activeSounds.push(entry);
  soundboardAppInstance?._updateSidebar();

  const sound = await playAudioLocal(src, volume);
  if (!sound) return;

  // Promise 반환이면 resolve 기다림
  const resolvedSound = sound?.then ? await sound : sound;
  if (!resolvedSound) return;

  entry.sound    = resolvedSound;
  entry.duration = resolvedSound.duration ?? 0;
  entry.intervalId = setInterval(() => updateProgress(id), 200);

  const onEnd = () => { clearInterval(entry.intervalId); removeEntry(id); };
  try { resolvedSound.addEventListener("end",  onEnd); } catch(_) {}
  try { resolvedSound.addEventListener("stop", onEnd); } catch(_) {}
}

// 버튼 클릭 → 전체 브로드캐스트
function broadcastSound(src, volume = 1.0, exclusive = false) {
  if (exclusive) stopAllSounds();
  const id    = foundry.utils.randomID();
  const label = getLabelForSrc(src);
  // 자신은 직접 실행
  startTracking(id, src, volume, label);
  // 다른 클라이언트에게 전송 (FVTT 소켓은 자신에게 오지 않음)
  game.socket.emit(SOCKET_EVENT, { action: "trackSound", id, src, volume, label });
}

function stopAllSounds() {
  stopAllLocal();
  game.socket.emit(SOCKET_EVENT, { action: "stopAll" });
}

function stopAllLocal() {
  [...activeSounds].forEach(e => {
    clearInterval(e.intervalId);
    try { e.sound?.stop?.(); } catch(_) {}
  });
  activeSounds = [];
  soundboardAppInstance?._updateSidebar();
  soundboardAppInstance?._refreshButtonStates();
}

function stopSoundById(id) {
  const entry = activeSounds.find(e => e.id === id);
  if (!entry) return;
  clearInterval(entry.intervalId);
  try { entry.sound?.stop?.(); } catch(_) {}
  removeEntry(id);
  // 모든 클라이언트에게 정지 명령
  game.socket.emit(SOCKET_EVENT, { action: "stopSound", id });
}

function removeEntry(id) {
  clearInterval(activeSounds.find(e => e.id === id)?.intervalId);
  activeSounds = activeSounds.filter(e => e.id !== id);
  soundboardAppInstance?._updateSidebar();
  soundboardAppInstance?._refreshButtonStates();
}

function removeSoundEntry(id) { removeEntry(id); }

function updateProgress(id) {
  const entry = activeSounds.find(e => e.id === id);
  if (!entry) return;
  const elapsed = (Date.now() - entry.startTime) / 1000;
  const dur = entry.duration || 0;
  if (dur > 0 && elapsed >= dur) { removeEntry(id); return; }
  const progress = dur > 0 ? Math.min(elapsed / dur, 1) : 0;
  soundboardAppInstance?._updateButtonProgress(entry.src, progress);
  soundboardAppInstance?._updateSidebarProgress(id, progress);
}

// ── 유틸 ──────────────────────────────────
// GM은 직접 파일 탐색, 플레이어는 GM에게 요청
async function fpBrowse(path) {
  const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
  return FP.browse("data", path, { extensions: [".mp3",".wav",".ogg",".oga",".flac",".webm"] });
}

async function browseAsGM(path) {
  if (game.user.isGM) {
    // GM: 직접 탐색 후 캐시 저장
    const r = await fpBrowse(path);
    const cache = game.settings.get(MODULE_ID, "fileCache");
    cache.files[path] = r.files ?? [];
    cache.dirs[path]  = r.dirs  ?? [];
    await game.settings.set(MODULE_ID, "fileCache", cache);
    return r;
  } else {
    // 플레이어: 캐시에서 읽기
    const cache = game.settings.get(MODULE_ID, "fileCache");
    return {
      files: cache.files[path] ?? [],
      dirs:  cache.dirs[path]  ?? [],
    };
  }
}

async function getSoundFiles(targetPath = SOUNDS_PATH) {
  try {
    const r = await browseAsGM(targetPath);
    return (r.files ?? []).filter(f => /\.(mp3|wav|ogg|oga|flac|webm)$/i.test(f));
  } catch(e) { console.warn("[SB] getSoundFiles:", e.message); return []; }
}

async function getSubFolders() {
  try {
    const r = await browseAsGM(SOUNDS_PATH);
    const subs = (r.dirs ?? []).map(d => ({
      path: d,
      label: "sounds/" + d.replace(SOUNDS_PATH, "").replace(/^\//, "")
    }));
    return [{ path: SOUNDS_PATH, label: "sounds/" }, ...subs];
  } catch(e) { return [{ path: SOUNDS_PATH, label: "sounds/" }]; }
}

function fileToLabel(path) {
  return path.split("/").pop().replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
}

async function getAudioDuration(src) {
  return new Promise(resolve => {
    const a = new Audio(src);
    a.addEventListener("loadedmetadata", () => resolve(a.duration));
    a.addEventListener("error", () => resolve(0));
    setTimeout(() => resolve(0), 3000);
  });
}

function formatTime(s) {
  if (!s || isNaN(s)) return "--:--";
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
}

// ── Application ────────────────────────────
class SoundboardApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "coc-soundboard",
      title: "사운드보드",
      width: 580, height: 500,
      resizable: true,
      classes: ["coc-soundboard-app"],
    });
  }

  // 빈 래퍼 반환 — 실제 내용은 activateListeners에서 구성
  async _renderInner(_data) {
    const wrap = document.createElement("div");
    wrap.className = "sb-wrapper";
    return $(wrap);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._buildUI(html[0]);
  }

  async _buildUI(container) {
    if (!this._currentPath) this._currentPath = SOUNDS_PATH;
    container.innerHTML = "";

    // GM이면 직접 캐시 갱신, 플레이어면 GM에게 갱신 요청 후 잠깐 대기
    if (game.user.isGM) {
      await gmCacheFiles(SOUNDS_PATH);
    } else {
      game.socket.emit(SOCKET_EVENT, { action: "refreshCache" });
      await new Promise(r => setTimeout(r, 600)); // GM이 저장할 시간
    }

    const [files, folders] = await Promise.all([
      getSoundFiles(this._currentPath),
      getSubFolders(),
    ]);

    // ── 전체 레이아웃 ──
    const layout = mk("div", "sb-layout");
    const main   = mk("div", "sb-main");
    const sidebar = mk("div", "sb-sidebar");
    layout.appendChild(main);
    layout.appendChild(sidebar);
    container.appendChild(layout);

    // ── 헤더 ──
    const header = mk("div", "sb-header");

    // 새로고침 (정사각형)
    const refreshBtn = mkBtn("sb-refresh", '<i class="fas fa-sync"></i>');
    refreshBtn.title = "새로고침";
    refreshBtn.addEventListener("click", () => this._buildUI(container));
    header.appendChild(refreshBtn);

    // 경로 표시 (flex:1)
    const currentLabel = folders.find(f => f.path === this._currentPath)?.label ?? "sounds/";
    const pathLabel = mk("span", "sb-path-label");
    pathLabel.textContent = currentLabel;
    header.appendChild(pathLabel);

    // 폴더 선택 ▽ (정사각형)
    const folderWrap = mk("div", "sb-folder-wrap");
    const folderBtn  = mkBtn("sb-folder-btn", '<i class="fas fa-chevron-down"></i>');
    folderBtn.title = "폴더 변경";
    const folderMenu = mk("div", "sb-folder-menu");
    folderMenu.style.display = "none";
    folders.forEach(f => {
      const item = mk("div", "sb-folder-item" + (f.path === this._currentPath ? " active" : ""));
      item.textContent = f.label;
      item.addEventListener("click", e => {
        e.stopPropagation();
        this._currentPath = f.path;
        folderMenu.style.display = "none";
        this._buildUI(container);
      });
      folderMenu.appendChild(item);
    });
    folderBtn.addEventListener("click", e => {
      e.stopPropagation();
      folderMenu.style.display = folderMenu.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", () => { folderMenu.style.display = "none"; });
    folderWrap.appendChild(folderBtn);
    folderWrap.appendChild(folderMenu);
    header.appendChild(folderWrap);
    main.appendChild(header);

    // ── 검색 ──
    const searchRow  = mk("div", "sb-search-row");
    const searchIcon = mk("i",   "fas fa-search sb-search-icon");
    const searchInput = document.createElement("input");
    searchInput.type = "text"; searchInput.className = "sb-search"; searchInput.placeholder = "검색...";
    const searchClear = mkBtn("sb-search-clear", "✕");
    searchClear.style.display = "none";
    searchRow.appendChild(searchIcon);
    searchRow.appendChild(searchInput);
    searchRow.appendChild(searchClear);
    main.appendChild(searchRow);

    // ── 그리드 ──
    const scrollDiv = mk("div", "sb-scroll");
    if (files.length === 0) {
      const empty = mk("p", "sb-empty");
      empty.textContent = "이 폴더에 오디오 파일이 없습니다.";
      scrollDiv.appendChild(empty);
    } else {
      const grid = mk("div", "sb-grid");
      files.forEach(src => {
        const btn  = document.createElement("button");
        btn.className = "sb-play-btn"; btn.dataset.src = src;
        const fill = mk("div", "sb-progress-fill");
        const icon = mk("i",   "fas fa-volume-up");
        const lbl  = mk("span","sb-btn-label");
        lbl.textContent = getLabelForSrc(src);
        btn.appendChild(fill); btn.appendChild(icon); btn.appendChild(lbl);
        btn.addEventListener("click",       e => { e.preventDefault(); broadcastSound(src, getVolumeForSrc(src), false); });
        btn.addEventListener("contextmenu", e => { e.preventDefault(); this._openContextMenu(e, src); });
        grid.appendChild(btn);
      });
      scrollDiv.appendChild(grid);
    }
    main.appendChild(scrollDiv);

    // 검색 이벤트
    const filter = q => {
      scrollDiv.querySelectorAll(".sb-play-btn").forEach(b => {
        const t = b.querySelector(".sb-btn-label")?.textContent.toLowerCase() ?? "";
        b.style.display = (!q || t.includes(q.toLowerCase())) ? "" : "none";
      });
      searchClear.style.display = q ? "" : "none";
    };
    searchInput.addEventListener("input", e => filter(e.target.value));
    searchClear.addEventListener("click", () => { searchInput.value = ""; filter(""); });

    // ── 사이드바 ──
    const sideTitle = mk("div", "sb-sidebar-title");
    sideTitle.textContent = "재생 중";
    const activeList = mk("div", "sb-active-list");
    sidebar.appendChild(sideTitle);
    sidebar.appendChild(activeList);

    // 마스터 볼륨 슬라이더
    const volWrap = mk("div", "sb-master-vol-wrap");
    const volLabel = mk("div", "sb-master-vol-label");
    volLabel.textContent = `전체 볼륨: ${Math.round(masterVolume * 100)}%`;
    const volSlider = document.createElement("input");
    volSlider.type = "range";
    volSlider.className = "sb-master-vol-slider";
    volSlider.min = "0"; volSlider.max = "100"; volSlider.step = "1";
    volSlider.value = Math.round(masterVolume * 100);
    volSlider.addEventListener("input", (e) => {
      masterVolume = parseInt(e.target.value) / 100;
      volLabel.textContent = `전체 볼륨: ${Math.round(masterVolume * 100)}%`;
      // 현재 재생 중인 사운드에 즉시 적용
      activeSounds.forEach(entry => {
        try {
          const s = entry.sound;
          if (!s) return;
          const targetVol = entry.volume * masterVolume;
          if (s.gain) s.gain.value = targetVol;
          else if (typeof s.volume !== "undefined") s.volume = targetVol;
          else if (s.fade) s.fade(targetVol, { duration: 100 });
        } catch(_) {}
      });
    });
    volWrap.appendChild(volLabel);
    volWrap.appendChild(volSlider);
    sidebar.appendChild(volWrap);

    // 진행도 복원
    activeSounds.forEach(e => {
      const elapsed = (Date.now() - e.startTime) / 1000;
      if (e.duration > 0) this._updateButtonProgress(e.src, Math.min(elapsed / e.duration, 1));
    });
    this._updateSidebar();
  }

  // ── DOM 업데이트 ───────────────────────────
  _root() {
    const el = this.element?.[0];
    if (!el) return null;
    return el.querySelector(".sb-layout") ?? el.querySelector(".sb-wrapper") ?? el;
  }

  _updateButtonProgress(src, progress) {
    const root = this._root(); if (!root) return;
    root.querySelectorAll(`.sb-play-btn`).forEach(btn => {
      if (btn.dataset.src !== src) return;
      const fill = btn.querySelector(".sb-progress-fill");
      if (fill) fill.style.width = `${progress * 100}%`;
      btn.classList.add("is-playing");
    });
  }

  _refreshButtonStates() {
    const root = this._root(); if (!root) return;
    root.querySelectorAll(".sb-play-btn").forEach(btn => {
      if (!activeSounds.some(e => e.src === btn.dataset.src)) {
        const fill = btn.querySelector(".sb-progress-fill");
        if (fill) fill.style.width = "0%";
        btn.classList.remove("is-playing");
      }
    });
  }

  _updateSidebar() {
    const root = this._root(); if (!root) return;
    const list = root.querySelector(".sb-active-list"); if (!list) return;
    list.innerHTML = "";

    if (activeSounds.length === 0) {
      const p = mk("p", "sb-sidebar-empty"); p.textContent = "없음";
      list.appendChild(p); return;
    }

    activeSounds.forEach(entry => {
      const item = mk("div", "sb-active-item"); item.dataset.id = entry.id;

      const bar  = mk("div", "sb-active-progress");
      const info = mk("div", "sb-active-info");
      const lbl  = mk("span", "sb-active-label"); lbl.textContent = entry.label;
      const time = mk("span", "sb-active-time");  time.textContent = "--:--";
      info.appendChild(lbl); info.appendChild(time);

      const stop = mkBtn("sb-active-stop", "✕"); stop.title = "정지";
      stop.addEventListener("click", e => { e.stopPropagation(); stopSoundById(entry.id); });

      // 우클릭: 컨텍스트 메뉴
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this._openContextMenu(e, entry.src);
      });

      item.appendChild(bar); item.appendChild(info); item.appendChild(stop);
      list.appendChild(item);
    });
  }

  _updateSidebarProgress(id, progress) {
    const root = this._root(); if (!root) return;
    const item = root.querySelector(`.sb-active-item[data-id="${id}"]`); if (!item) return;
    const bar = item.querySelector(".sb-active-progress");
    if (bar) bar.style.width = `${progress * 100}%`;
    const entry = activeSounds.find(e => e.id === id);
    if (entry?.duration) {
      const remain = Math.max(0, entry.duration - (Date.now() - entry.startTime) / 1000);
      const time = item.querySelector(".sb-active-time");
      if (time) time.textContent = formatTime(remain);
    }
  }

  // ── 우클릭 메뉴 ──────────────────────────
  async _openContextMenu(e, src) {
    $(".sb-context-menu").remove();
    const label    = getLabelForSrc(src);
    const volume   = getVolumeForSrc(src);
    const volPct   = Math.round(volume * 100);
    const duration = await getAudioDuration(src);

    const closeMenu = () => {
      menu.remove();
      $(document).off("keydown.sb-ctx");
    };

    const menu = document.createElement("div");
    menu.className = "sb-context-menu";
    menu.innerHTML = `
      <div class="sb-ctx-header">
        <span><i class="fas fa-music"></i> <span class="sb-ctx-title">${label}</span></span>
        <button class="sb-ctx-close">✕</button>
      </div>
      <div class="sb-ctx-row">
        <span class="sb-ctx-label">길이</span>
        <span class="sb-ctx-value">${formatTime(duration)}</span>
      </div>
      <div class="sb-ctx-row">
        <span class="sb-ctx-label">볼륨</span>
        <input type="range" class="sb-ctx-volume" min="0" max="100" step="1" value="${volPct}"/>
        <span class="sb-ctx-vol-val">${volPct}%</span>
      </div>
      <div class="sb-ctx-row">
        <span class="sb-ctx-label">이름</span>
        <input type="text" class="sb-ctx-name-input" value="${label}" placeholder="버튼 이름"/>
        <button class="sb-ctx-name-save"><i class="fas fa-check"></i></button>
      </div>
      <div class="sb-ctx-divider"></div>
      <button class="sb-ctx-btn sb-ctx-play"><i class="fas fa-play"></i> 재생</button>
      <button class="sb-ctx-btn sb-ctx-exclusive"><i class="fas fa-ban"></i> 다른 사운드 끄고 재생</button>
      <button class="sb-ctx-btn sb-ctx-stop-all"><i class="fas fa-stop"></i> 전체 정지</button>
    `;

    menu.addEventListener("mousedown", e => e.stopPropagation());
    menu.addEventListener("click",     e => e.stopPropagation());

    menu.querySelector(".sb-ctx-close").addEventListener("click", closeMenu);
    $(document).on("keydown.sb-ctx", e => { if (e.key === "Escape") closeMenu(); });

    // 볼륨 즉시 적용
    menu.querySelector(".sb-ctx-volume").addEventListener("input", ev => {
      const pct = parseInt(ev.target.value);
      const vol = pct / 100;
      menu.querySelector(".sb-ctx-vol-val").textContent = `${pct}%`;
      updateSoundConfig(src, { volume: vol });
      activeSounds.filter(x => x.src === src).forEach(x => {
        x.volume = vol;
        try { if (x.sound?.gain) x.sound.gain.value = vol; } catch(_) {}
      });
    });

    // 이름 저장
    const saveName = async () => {
      const newLabel = menu.querySelector(".sb-ctx-name-input").value.trim();
      if (!newLabel) return;
      await updateSoundConfig(src, { label: newLabel });
      menu.querySelector(".sb-ctx-title").textContent = newLabel;
      this._root()?.querySelectorAll(`.sb-play-btn`).forEach(btn => {
        if (btn.dataset.src === src) btn.querySelector(".sb-btn-label").textContent = newLabel;
      });
      activeSounds.filter(x => x.src === src).forEach(x => {
        x.label = newLabel;
        this._root()?.querySelector(`.sb-active-item[data-id="${x.id}"] .sb-active-label`)
          && (this._root().querySelector(`.sb-active-item[data-id="${x.id}"] .sb-active-label`).textContent = newLabel);
      });
    };
    menu.querySelector(".sb-ctx-name-save").addEventListener("click", e => { e.stopPropagation(); saveName(); });
    menu.querySelector(".sb-ctx-name-input").addEventListener("keydown", e => { if (e.key === "Enter") { e.stopPropagation(); saveName(); } });

    menu.querySelector(".sb-ctx-play").addEventListener("click", e => {
      e.stopPropagation();
      broadcastSound(src, parseInt(menu.querySelector(".sb-ctx-volume").value) / 100, false);
    });
    menu.querySelector(".sb-ctx-exclusive").addEventListener("click", e => {
      e.stopPropagation();
      broadcastSound(src, parseInt(menu.querySelector(".sb-ctx-volume").value) / 100, true);
    });
    menu.querySelector(".sb-ctx-stop-all").addEventListener("click", e => { e.stopPropagation(); stopAllSounds(); });

    document.body.appendChild(menu);
    menu.style.left = Math.min(e.clientX, window.innerWidth  - 240) + "px";
    menu.style.top  = Math.min(e.clientY, window.innerHeight - 300) + "px";

    // 앞으로 가져오기 - FVTT 최상위 z-index보다 높게
    const topZ = Math.max(...[...document.querySelectorAll(".app, .window-app")]
      .map(el => parseInt(getComputedStyle(el).zIndex) || 0)) + 10;
    menu.style.zIndex = Math.max(topZ, 10000);

    // 헤더 드래그로 이동
    const header = menu.querySelector(".sb-ctx-header");
    if (header) {
      header.style.cursor = "move";
      header.addEventListener("mousedown", (ev) => {
        if (ev.target.classList.contains("sb-ctx-close")) return;
        ev.preventDefault();
        const startX = ev.clientX - menu.offsetLeft;
        const startY = ev.clientY - menu.offsetTop;
        const onMove = (mv) => {
          menu.style.left = Math.max(0, Math.min(mv.clientX - startX, window.innerWidth  - menu.offsetWidth))  + "px";
          menu.style.top  = Math.max(0, Math.min(mv.clientY - startY, window.innerHeight - menu.offsetHeight)) + "px";
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup",   onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup",   onUp);
      });
    }
  }

  close(...args) {
    soundboardAppInstance = null;
    $(document).off("click.sb-folder keydown.sb-ctx");
    return super.close(...args);
  }
}

// ── 헬퍼 ──────────────────────────────────
function mk(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}
function mkBtn(cls, html) {
  const btn = document.createElement("button");
  btn.className = cls; btn.innerHTML = html; return btn;
}

// ── 초기화 ────────────────────────────────
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "soundConfig", {
    name: "사운드 설정", scope: "world", config: false, type: Object, default: {},
  });
  // GM이 저장한 파일 목록 — 플레이어도 읽기 가능
  game.settings.register(MODULE_ID, "fileCache", {
    name: "파일 캐시", scope: "world", config: false, type: Object,
    default: { files: {}, dirs: {} },
  });
});

// GM 전용: 파일 목록을 캐시에 저장
async function gmCacheFiles(path) {
  if (!game.user.isGM) return;
  try {
    const r = await fpBrowse(path);
    const cache = game.settings.get(MODULE_ID, "fileCache");
    cache.files[path] = r.files ?? [];
    cache.dirs[path]  = r.dirs  ?? [];
    await game.settings.set(MODULE_ID, "fileCache", cache);
  } catch(e) { console.warn("[SB] gmCacheFiles 실패:", e.message); }
}

Hooks.once("ready", () => {
  setupSocket();
  // GM이면 시작 시 미리 캐시 저장
  if (game.user.isGM) {
    gmCacheFiles(SOUNDS_PATH).catch(() => {});
  }
});

// ── 사운드보드 열기 공통 함수 ──────────────
function openSoundboard() {
  const ex = foundry.applications.instances.get("coc-soundboard");
  if (ex) { ex.close(); soundboardAppInstance = null; }
  else { soundboardAppInstance = new SoundboardApp(); soundboardAppInstance.render({ force: true }); }
}

// ── GM용 툴바 버튼 (sounds 그룹) ────────────
Hooks.on("getSceneControlButtons", controls => {
  if (controls.sounds) {
    controls.sounds.tools["open-soundboard"] = {
      name: "open-soundboard", title: "사운드보드 열기",
      icon: "fa-solid fa-table-cells", button: true, visible: true, order: 99,
      onChange: openSoundboard,
    };
  }
});

// ── Note 클릭 시 사운드보드 열기 ─────────────
Hooks.on("activateNote", (note, options) => {
  const flag = note.document?.getFlag(MODULE_ID, "soundboard");
  if (!flag) return;
  openSoundboard();
  return false; // 기본 저널 열기 동작 취소
});

// Note 더블클릭도 처리 (V14)
Hooks.on("noteDoubleclick", (note) => {
  const flag = note.document?.getFlag(MODULE_ID, "soundboard");
  if (!flag) return false;
  openSoundboard();
  return false;
});
