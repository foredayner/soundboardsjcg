/**
 * 사운드보드 Note 생성 매크로
 */

if (!game.user.isGM) {
  ui.notifications.warn("GM만 사운드보드 Note를 생성할 수 있습니다.");
  return;
}

const scene = canvas.scene;
if (!scene) { ui.notifications.warn("씬이 없습니다."); return; }

const x = scene.width  / 2;
const y = scene.height / 2;

// 저널 엔트리 생성 + 모든 플레이어에게 Observer 권한
const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
const journal = await JournalEntry.create({
  name: "사운드보드",
  ownership,
});

// Note 생성 — global:true 로 항상 표시
await scene.createEmbeddedDocuments("Note", [{
  entryId: journal.id,
  x, y,
  iconSize: 40,
  icon: "icons/svg/sound.svg",
  text: "사운드보드",
  fontSize: 24,
  textColor: "#FFFFFF",
  global: true,          // 시야/안개 무관하게 항상 표시
  flags: {
    "soundboardsJCG": { soundboard: true }
  }
}]);

ui.notifications.info("사운드보드 Note 생성 완료!");
