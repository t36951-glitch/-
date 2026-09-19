import './style.css';

const canvas = document.querySelector('#game-canvas');
const ctx = canvas.getContext('2d');
const shell = document.querySelector('#game-shell');

const WORLD = { width: 2400, height: 1600 };
const CHARACTER_PRESETS = {
  swordsman: { label: '검 용사', body: '#5d83d8', hair: '#6d4b43', accent: '#f3c85e', avatar: '검' },
  archer: { label: '활 용사', body: '#65a77b', hair: '#9a633f', accent: '#efb76a', avatar: '활' },
  mage: { label: '마법사', body: '#9a79c8', hair: '#493d73', accent: '#f6cf73', avatar: '법' }
};
const player = { x: 1200, y: 805, radius: 25, speed: 245, facing: 'down', facingVector: { x: 0, y: 1 }, bob: 0, footOffsetY: 46 };
const savedProfile = (() => {
  try { return JSON.parse(localStorage.getItem('letter-kingdom-profile') || 'null'); } catch (error) { return null; }
})();
const profile = {
  name: savedProfile?.name || '다온',
  character: CHARACTER_PRESETS[savedProfile?.character] ? savedProfile.character : 'swordsman'
};
let gameStarted = Boolean(savedProfile?.started);
const camera = { x: 0, y: 0 };
const keys = new Set();
const touchVector = { x: 0, y: 0 };
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let lastTime = performance.now();

const STAGE_STORAGE_KEY = 'letter-kingdom-teacher-stages';
const ACTIVE_STAGE_STORAGE_KEY = 'letter-kingdom-active-stage';
const DEFAULT_STAGE = {
  id: 'stage-1', stageNumber: 1, word: '사과', syllables: ['사', '과'], learningMode: 'syllable',
  hint: '빨갛고 맛있는 과일이에요.', locked: false, active: true, protected: true
};

function splitHangulSyllables(value) {
  return Array.from(String(value || '').replace(/\s+/g, '')).filter((character) => /^[가-힣]$/.test(character));
}

function normalizeStage(raw = {}) {
  const displayWord = String(raw.displayWord ?? raw.word ?? '').trim();
  const syllables = Array.isArray(raw.syllables) && raw.syllables.length
    ? raw.syllables.filter((character) => /^[가-힣]$/.test(character)).slice(0, 6)
    : splitHangulSyllables(displayWord).slice(0, 6);
  const isDefault = raw.id === DEFAULT_STAGE.id || raw.protected === true;
  const safeWord = displayWord || (isDefault ? DEFAULT_STAGE.word : '');
  const safeSyllables = syllables.length ? syllables : (isDefault ? [...DEFAULT_STAGE.syllables] : []);
  const hint = raw.hint === '' ? DEFAULT_STAGE.hint : String(raw.hint ?? DEFAULT_STAGE.hint);
  return {
    ...DEFAULT_STAGE,
    ...raw,
    id: raw.id || `stage-${Number(raw.stageNumber) || 1}`,
    stageNumber: Math.max(1, Number(raw.stageNumber) || 1),
    word: safeWord,
    displayWord: safeWord,
    syllables: safeSyllables,
    learningMode: raw.learningMode === 'jamo' ? 'jamo' : 'syllable',
    hint: hint || DEFAULT_STAGE.hint,
    locked: Boolean(raw.locked),
    active: raw.active === true,
    protected: raw.protected === true
  };
}

function loadTeacherStages() {
  try {
    const saved = JSON.parse(localStorage.getItem(STAGE_STORAGE_KEY) || 'null');
    const stages = Array.isArray(saved) ? saved.map(normalizeStage) : [DEFAULT_STAGE];
    if (!stages.some((stage) => stage.id === DEFAULT_STAGE.id)) stages.unshift(normalizeStage(DEFAULT_STAGE));
    for (let number = 1; number <= 10; number += 1) {
      if (!stages.some((stage) => stage.stageNumber === number)) {
        stages.push(normalizeStage({ id: `stage-${number}`, stageNumber: number, word: '', displayWord: '', syllables: [], hint: '', locked: number !== 1, active: number === 1, protected: number === 1 }));
      }
    }
    let activeFound = false;
    stages.forEach((stage) => {
      if (stage.active && !stage.locked && !activeFound) activeFound = true;
      else if (stage.active) stage.active = false;
    });
    if (!activeFound) {
      const fallback = stages.find((stage) => stage.id === DEFAULT_STAGE.id) || stages[0];
      if (fallback) { fallback.active = true; fallback.locked = false; }
    }
    return stages.sort((a, b) => a.stageNumber - b.stageNumber);
  } catch (error) { return [DEFAULT_STAGE]; }
}

const teacherStages = loadTeacherStages();
let activeStage = normalizeStage((() => {
  try {
    const id = localStorage.getItem(ACTIVE_STAGE_STORAGE_KEY) || DEFAULT_STAGE.id;
    return teacherStages.find((stage) => stage.id === id && stage.active && !stage.locked) || teacherStages.find((stage) => stage.active && !stage.locked) || DEFAULT_STAGE;
  } catch (error) { return DEFAULT_STAGE; }
})());

const LAYOUT_STORAGE_KEY = 'letter-kingdom-stage-layouts';
let stageLayouts = (() => {
  try { return JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}'); } catch (error) { return {}; }
})();

function persistStageLayouts() {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(stageLayouts)); } catch (error) { /* localStorage may be unavailable */ }
}

function createLetterItems(syllables, positions = []) {
  return syllables.map((character, index) => ({
    id: `stage-letter-${index}`,
    character,
    x: positions[index]?.x ?? 720 + index * 120,
    y: positions[index]?.y ?? 430 + index * 80,
    protectedMonsterId: `protected-monster-${index}`,
    unlocked: false,
    collected: false,
    disabled: false,
    wobble: 0
  }));
}

const ARCHER_SKILL_DETECTION_RANGE = 250;
const ARCHER_SKILL_COOLDOWN = 15000;
const ARCHER_SKILL_EFFECT_DURATION = 5000;
const ARCHER_SKILL_ARROW_DURATION = 1500;
const MP_SETTINGS = {
  swordsman: { max: 2, recoverySeconds: 30 },
  archer: { max: 3, recoverySeconds: 60 },
  mage: { max: 5, recoverySeconds: 60 }
};
const SYLLABLE_COLORS = {
  fill: '#fff7c7',
  border: '#e6ac4f',
  text: '#d9795f'
};
let letterItems = [];
const monsterReward = {
  id: 'monster-reward',
  type: 'syllable',
  character: '사',
  x: 1040,
  y: 1050,
  active: false,
  collected: false,
  dropped: false,
  wobble: 0,
  sparkle: 0,
  source: 'monster-reward'
};
const rewardState = { nonSyllableStreak: 0 };

function availableLetterItems() {
  const mapItems = letterItems.filter((item) => !item.disabled);
  return monsterReward.active && !monsterReward.collected && monsterReward.type !== 'none' ? [...mapItems, monsterReward] : mapItems;
}
// Safe open grass near the central path: clear of the current trees, rocks, fence, and river.
const treasureChest = { x: 860, y: 1080, opened: false, sparkle: 0 };
function createLearningMonster(id, x, y, protectedLetterIndex = null) {
  return {
    id, x, y, protectedLetterIndex, isAdditional: protectedLetterIndex === null,
    resolved: false, wobble: 0, hp: 3, maxHp: 3, state: 'idle',
    warningUntil: 0, nextAttackAt: 0, attackActiveUntil: 0, attackToken: 0,
    defeatStartedAt: 0, quizResolved: false, outOfRangeSince: 0, recoveryElapsed: 0
  };
}
let learningMonster = createLearningMonster('learning-monster-0', 1040, 1050);
let learningMonsters = [learningMonster];
const combat = { current: 3, max: 3, inCombat: false, lastDamageAt: 0, recoveryElapsed: 0 };
const BASIC_ATTACK_INTERVAL = 1000;
const MONSTER_ATTACK_INTERVAL = BASIC_ATTACK_INTERVAL / 1.2;
const MONSTER_WARNING_DURATION = 1200;
const MONSTER_DETECTION_RANGE = 260;
const MONSTER_MELEE_RANGE = 155;
const MONSTER_COMBAT_IDLE_DURATION = 5000;
const MONSTER_HP_RECOVERY_INTERVAL = 1000;
const COMBAT_HP_RECOVERY_INTERVAL = 15000;
const attackState = { cooldownUntil: 0, projectiles: [], effects: [], nextId: 1 };
const collectedLetters = [];
const pickupEffects = [];
const MAX_ENERGY = 5;
const energy = { current: MAX_ENERGY };
const mp = { current: MP_SETTINGS[profile.character].max, recoveryElapsed: 0, saveElapsed: 0 };
const wrongContact = { touchingItemId: null, shieldUntil: 0, moveLockUntil: 0 };
const restState = { inside: false, elapsed: 0, recovered: false, noticeShown: false, promptOpen: false, promptDismissed: false };
const automaticRest = { active: false, elapsed: 0, lastSecond: 5, reason: 'energy' };
const challenge = { status: 'collecting', doorOpen: false, doorPassed: false };
const stageTransition = { promptOpen: false, dismissedAtDoor: false, mode: null, nextStage: null };
const collectedLettersEl = document.querySelector('#collected-letters');
const letterCountEl = document.querySelector('#letter-count');
const nextLetterEl = document.querySelector('#next-letter');
const wordStateEl = document.querySelector('#word-state');
const energyPipsEl = document.querySelector('#energy-pips');
const energyCountEl = document.querySelector('#energy-count');
const combatHeartsEl = document.querySelector('#combat-hearts');
const mpCountEl = document.querySelector('#mp-count');
const mpFillEl = document.querySelector('#mp-fill');
const monsterEnergyEl = document.querySelector('#monster-energy');
const restCountdown = document.querySelector('#rest-countdown');
const restCountdownNumber = document.querySelector('#rest-countdown-number');
const restPrompt = document.querySelector('#rest-prompt');
const restYesButton = document.querySelector('#rest-yes');
const restNoButton = document.querySelector('#rest-no');
const hintOverlay = document.querySelector('#hint-overlay');
const hintCloseButton = document.querySelector('#hint-close');
const hintCurrentEl = document.querySelector('#hint-current');
const monsterOverlay = document.querySelector('#monster-overlay');
const monsterChoiceButtons = document.querySelectorAll('.monster-choice');
const monsterFeedback = document.querySelector('#monster-feedback');
const letterNotice = document.querySelector('#letter-notice');
const successOverlay = document.querySelector('#success-overlay');
const restartPrompt = document.querySelector('#restart-prompt');
const restartYesButton = document.querySelector('#restart-yes');
const restartNoButton = document.querySelector('#restart-no');
const successMessageEl = document.querySelector('#success-message');
const nextStagePrompt = document.querySelector('#next-stage-prompt');
const nextStageTitle = document.querySelector('#next-stage-title');
const nextStageMessage = document.querySelector('#next-stage-message');
const nextStageYesButton = document.querySelector('#next-stage-yes');
const nextStageNoButton = document.querySelector('#next-stage-no');
const currentRegionNameEl = document.querySelector('#current-region-name');
const regionToast = document.querySelector('#region-toast');
const regionToastNameEl = document.querySelector('#region-toast-name');
const regionToastMessageEl = document.querySelector('#region-toast-message');
const retryCollectButton = document.querySelector('#retry-collect');
const retryButton = document.querySelector('#retry-button');
const startScreen = document.querySelector('#start-screen');
const welcomeStep = document.querySelector('#welcome-step');
const setupStep = document.querySelector('#setup-step');
const welcomeNextButton = document.querySelector('#welcome-next');
const startGameButton = document.querySelector('#start-game');
const heroNameInput = document.querySelector('#hero-name-input');
const characterChoiceButtons = document.querySelectorAll('.character-choice');
const heroNameEl = document.querySelector('#hero-name');
const heroTitleEl = document.querySelector('#hero-title');
const heroAvatarEl = document.querySelector('#hero-avatar');
const menuButton = document.querySelector('#menu-button');
const menuPanel = document.querySelector('#menu-panel');
const changeCharacterButton = document.querySelector('#change-character-button');
const restartAdventureButton = document.querySelector('#restart-adventure-button');
const resetProfileButton = document.querySelector('#reset-profile-button');
const closeMenuButton = document.querySelector('#close-menu-button');
const letterArchiveButton = document.querySelector('#letter-archive-button');
const wordArchiveButton = document.querySelector('#word-archive-button');
const titleArchiveButton = document.querySelector('#title-archive-button');
const itemStorageButton = document.querySelector('#item-storage-button');
const archivePanel = document.querySelector('#archive-panel');
const archiveTitleEl = document.querySelector('#archive-title');
const archiveContentEl = document.querySelector('#archive-content');
const archiveCloseButton = document.querySelector('#archive-close');
const teacherSettingsButton = document.querySelector('#teacher-settings-button');
const teacherPanel = document.querySelector('#teacher-panel');
const teacherCloseButton = document.querySelector('#teacher-close');
const teacherListView = document.querySelector('#teacher-list-view');
const teacherEditorView = document.querySelector('#teacher-editor-view');
const teacherNewListButton = document.querySelector('#teacher-new-list');
const teacherStageNumber = document.querySelector('#teacher-stage-number');
const teacherWordInput = document.querySelector('#teacher-word');
const teacherLearningMode = document.querySelector('#teacher-learning-mode');
const teacherHintInput = document.querySelector('#teacher-hint');
const teacherStatusInput = document.querySelector('#teacher-status');
const teacherSyllablePreview = document.querySelector('#teacher-syllable-preview');
const teacherFeedback = document.querySelector('#teacher-feedback');
const teacherNewButton = document.querySelector('#teacher-new');
const teacherSaveButton = document.querySelector('#teacher-save');
const teacherStartButton = document.querySelector('#teacher-start');
const teacherCancelButton = document.querySelector('#teacher-cancel');
const teacherStageList = document.querySelector('#teacher-stage-list');
let selectedCharacter = profile.character;
let letterNoticeTimer;
let hintHighlightTimer;
let successAudioContext;
let successEffect = null;
let recoveryEffect = null;
let monsterQuizOpen = false;
let quizTargetMonster = learningMonster;
let monsterAnswerCooldownUntil = 0;
let monsterUnlockTimer;
let combatAudioContext;
const attackButton = document.querySelector('#attack-button');
const skillButton = document.querySelector('#skill-button-0');
const skillNameEl = document.querySelector('#skill-name-0');
const skillCooldownEl = document.querySelector('#skill-cooldown-0');
const skillState = { cooldownUntil: 0, activeUntil: 0, shieldUntil: 0, shieldHitsRemaining: 0, combatShieldHitsRemaining: 0, shieldVisualOn: false, focusItemId: null, focusUntil: 0, arrowUntil: 0, hintUntil: 0 };
const skillChargesEl = document.querySelector('#skill-charges-0');
const inventory = { mpPotion: 0, combatPotion: 0 };
const archiveState = { collectedSyllables: [], completedWords: {} };
const titleState = { earned: [], equippedId: null };
const DEFAULT_TITLE_NAMES = {
  사과: '사과 탐험가',
  나비: '나비 관찰자',
  다리: '튼튼한 다리 탐험가'
};

function loadArchiveState() {
  try {
    const saved = JSON.parse(localStorage.getItem('letter-kingdom-archive') || '{}');
    archiveState.collectedSyllables = Array.isArray(saved.collectedSyllables) ? [...new Set(saved.collectedSyllables)] : [];
    archiveState.completedWords = saved.completedWords && typeof saved.completedWords === 'object' ? saved.completedWords : {};
    titleState.earned = Array.isArray(saved.titles)
      ? saved.titles.filter((title) => title && title.id && title.word && title.name).map((title, index) => ({
        id: String(title.id), name: String(title.name), word: String(title.word),
        earnedAt: String(title.earnedAt || ''), order: Number(title.order) || index + 1
      }))
      : [];
    const savedEquippedId = saved.equippedTitleId ? String(saved.equippedTitleId) : null;
    titleState.equippedId = titleState.earned.some((title) => title.id === savedEquippedId) ? savedEquippedId : null;
    inventory.mpPotion = Math.max(0, Number(saved.mpPotion || 0));
    inventory.combatPotion = Math.max(0, Number(saved.combatPotion || 0));
  } catch (error) { /* localStorage may be unavailable */ }
}

function persistArchiveState() {
  try {
    localStorage.setItem('letter-kingdom-archive', JSON.stringify({
      collectedSyllables: archiveState.collectedSyllables,
      completedWords: archiveState.completedWords,
      titles: titleState.earned,
      equippedTitleId: titleState.equippedId,
      mpPotion: inventory.mpPotion,
      combatPotion: inventory.combatPotion
    }));
  } catch (error) { /* localStorage may be unavailable */ }
}

loadArchiveState();

function titleNameForWord(word) {
  return DEFAULT_TITLE_NAMES[word] || `${word} 탐험가`;
}

function titleForWord(word) {
  return titleState.earned.find((title) => title.word === word) || null;
}

function awardTitleForWord(word) {
  const existing = titleForWord(word);
  if (existing) return { title: existing, isNew: false };
  const title = {
    id: `title-${encodeURIComponent(word)}`,
    name: titleNameForWord(word),
    word,
    earnedAt: new Date().toLocaleDateString('ko-KR'),
    order: titleState.earned.length + 1
  };
  titleState.earned.push(title);
  persistArchiveState();
  return { title, isNew: true };
}

function updateTitleHud() {
  const equipped = titleState.earned.find((title) => title.id === titleState.equippedId);
  heroTitleEl.textContent = equipped ? `✦ ${equipped.name}` : '';
  heroTitleEl.hidden = !equipped;
}

function equipTitle(titleId) {
  const title = titleState.earned.find((candidate) => candidate.id === titleId);
  if (!title) return;
  titleState.equippedId = title.id;
  persistArchiveState();
  updateTitleHud();
  if (activeArchive === 'titles') renderArchive('titles');
}

function unequipTitle(titleId) {
  if (titleState.equippedId !== titleId) return;
  titleState.equippedId = null;
  persistArchiveState();
  updateTitleHud();
  if (activeArchive === 'titles') renderArchive('titles');
}

function currentMPSettings() {
  return MP_SETTINGS[profile.character];
}

function readPersistedMPStates() {
  try { return JSON.parse(localStorage.getItem('letter-kingdom-mp-states') || '{}'); } catch (error) { return {}; }
}

function persistMPState(character = profile.character) {
  try {
    const states = readPersistedMPStates();
    states[character] = { current: mp.current, recoveryElapsed: mp.recoveryElapsed };
    localStorage.setItem('letter-kingdom-mp-states', JSON.stringify(states));
  } catch (error) { /* localStorage may be unavailable */ }
}

function loadMPState(character = profile.character) {
  const settings = MP_SETTINGS[character];
  const states = readPersistedMPStates();
  const saved = states[character];
  mp.current = Math.min(settings.max, Math.max(0, Number(saved?.current ?? settings.max)));
  mp.recoveryElapsed = Math.max(0, Number(saved?.recoveryElapsed ?? 0));
  mp.saveElapsed = 0;
}

loadMPState();
window.addEventListener('beforeunload', () => persistMPState());

function currentSkillName() {
  return { swordsman: '글자 방패', archer: '글자 찾기', mage: '낱말 힌트' }[profile.character];
}

function currentSkillHintMessage() {
  const next = activeStage.syllables[collectedLetters.length];
  if (!next) return `${activeStageWord()} 글자를 모두 모았어요!`;
  return collectedLetters.length === 0 ? `첫 번째 글자는 ${next}예요.` : `다음 글자는 ${next}예요.`;
}

function resetSkillState() {
  skillState.cooldownUntil = 0;
  skillState.activeUntil = 0;
  skillState.shieldUntil = 0;
  skillState.shieldHitsRemaining = 0;
  skillState.combatShieldHitsRemaining = 0;
  skillState.shieldVisualOn = false;
  skillState.focusItemId = null;
  skillState.focusUntil = 0;
  skillState.arrowUntil = 0;
  skillState.hintUntil = 0;
  hintOverlay.hidden = true;
  updateSkillHud();
}

function clearArcherSkillFocusIfOutOfRange(now = performance.now()) {
  if (profile.character !== 'archer' || !skillState.focusItemId) return;
  const target = availableLetterItems().find((item) => item.id === skillState.focusItemId && !item.collected);
  const distance = target
    ? Math.hypot(player.x - target.x, player.y + player.footOffsetY - target.y)
    : Infinity;
  if (!target || now >= skillState.focusUntil || distance > ARCHER_SKILL_DETECTION_RANGE) {
    skillState.focusItemId = null;
    skillState.focusUntil = 0;
    skillState.arrowUntil = 0;
    skillState.activeUntil = Math.min(skillState.activeUntil, now);
  }
}

function updateSkillHud(now = performance.now()) {
  clearArcherSkillFocusIfOutOfRange(now);
  const canAttempt = gameStarted && energy.current > 0 && !automaticRest.active && !restState.promptOpen && now >= skillState.cooldownUntil;
  const ready = canAttempt && mp.current > 0;
  const cooldown = Math.max(0, Math.ceil((skillState.cooldownUntil - now) / 1000));
  skillNameEl.textContent = currentSkillName();
  skillCooldownEl.textContent = cooldown > 0 ? `${cooldown}s` : '';
  skillButton.disabled = !canAttempt;
  skillButton.setAttribute('aria-disabled', String(!ready));
  skillButton.classList.toggle('is-ready', ready);
  skillButton.classList.toggle('is-mana-empty', canAttempt && !ready);
  skillButton.classList.toggle('is-cooldown', cooldown > 0);
  skillButton.classList.toggle('is-active', now < skillState.activeUntil);
  if (skillState.shieldVisualOn && now >= skillState.shieldUntil) {
    skillState.shieldVisualOn = false;
    skillState.shieldHitsRemaining = 0;
    skillState.combatShieldHitsRemaining = 0;
    skillState.shieldUntil = 0;
    skillState.activeUntil = Math.min(skillState.activeUntil, now);
    showNotice('글자 방패가 사라졌어요.', 1100);
  }
  if (skillChargesEl) {
    skillChargesEl.textContent = profile.character === 'swordsman' && skillState.shieldVisualOn
      ? `${skillState.shieldHitsRemaining}회`
      : '';
  }
  skillButton.setAttribute('aria-label', `${currentSkillName()}${cooldown > 0 ? ` ${cooldown}초 후 사용 가능` : ''}${canAttempt && !ready ? ' 마나가 부족해요' : ''}`);
  if (attackButton) {
    const attackReady = gameStarted && energy.current > 0 && !automaticRest.active && !restState.promptOpen && !monsterQuizOpen && now >= attackState.cooldownUntil;
    attackButton.disabled = !attackReady;
    attackButton.setAttribute('aria-label', '기본 공격');
  }
}

function applyProfileToHud() {
  const preset = CHARACTER_PRESETS[profile.character];
  heroNameEl.textContent = profile.name;
  updateTitleHud();
  heroAvatarEl.textContent = preset.avatar;
  heroAvatarEl.style.background = preset.body;
  updateSkillHud();
}

function persistProfile() {
  try { localStorage.setItem('letter-kingdom-profile', JSON.stringify({ ...profile, started: true })); } catch (error) { /* localStorage may be unavailable */ }
}

function showSetupStep() {
  welcomeStep.hidden = true;
  setupStep.hidden = false;
  heroNameInput.value = profile.name === '다온' ? '' : profile.name;
  selectedCharacter = profile.character;
  characterChoiceButtons.forEach((button) => {
    const selected = button.dataset.character === selectedCharacter;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  heroNameInput.focus();
}

function startAdventure() {
  const typedName = heroNameInput.value.trim();
  persistMPState(profile.character);
  profile.name = typedName || '다온';
  profile.character = selectedCharacter;
  loadMPState(profile.character);
  resetSkillState();
  gameStarted = true;
  persistProfile();
  applyProfileToHud();
  startScreen.hidden = true;
  player.x = 1200; player.y = 805;
}

function closeMenu() {
  menuPanel.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
}

function openMenu() {
  if (!gameStarted || automaticRest.active) return;
  menuPanel.hidden = false;
  menuButton.setAttribute('aria-expanded', 'true');
}

let activeArchive = null;
let currentRegionId = null;
let regionToastTimer;

function renderArchive(kind) {
  activeArchive = kind;
  archivePanel.hidden = false;
  closeMenu();
  archiveTitleEl.textContent = kind === 'letters' ? '글자 보관함' : kind === 'words' ? '단어 창고' : kind === 'titles' ? '칭호 목록' : '아이템 창고';
  if (kind === 'letters') {
    const collected = collectedLetters.length ? collectedLetters.join(' + ') : '아직 없어요';
    const remaining = activeStage.syllables.filter((character, index) => collectedLetters[index] !== character).join(' + ') || '없음';
    const progress = Math.round(collectedLetters.length / activeStage.syllables.length * 100);
    archiveContentEl.innerHTML = `<div class="archive-summary"><div>목표 단어: <strong>${activeStageWord()}</strong></div><div>수집한 음절: <strong>${collected}</strong></div><div>남은 음절: <strong>${remaining}</strong></div><div>진행률: <strong>${collectedLetters.length}/${activeStage.syllables.length}</strong></div><div class="archive-progress"><i style="width:${progress}%"></i></div></div>`;
    return;
  }
  if (kind === 'words') {
    const wordEntries = new Map(teacherStages.filter((stage) => stage.displayWord && stage.syllables.length).map((stage) => [stage.displayWord, stage.syllables]));
    Object.keys(archiveState.completedWords).forEach((word) => { if (!wordEntries.has(word)) wordEntries.set(word, splitHangulSyllables(word)); });
    archiveContentEl.innerHTML = `<div class="archive-list">${[...wordEntries].map(([word, syllables]) => {
      const completedAt = archiveState.completedWords[word];
      const title = titleForWord(word);
      return `<div class="archive-item word-archive-item"><div class="archive-icon">✦</div><div><strong>${escapeHtml(word)}</strong><small>음절: ${escapeHtml(syllables.join(' → '))}</small><small>칭호: ${escapeHtml(title?.name || titleNameForWord(word))}</small></div><span class="archive-status ${completedAt ? '' : 'is-locked'}">${completedAt ? `완성 · ${escapeHtml(completedAt)}` : '잠겨 있어요'}</span></div>`;
    }).join('') || '<p class="archive-empty">아직 준비된 단어가 없어요.</p>'}</div>`;
    return;
  }
  if (kind === 'titles') {
    const titleWords = teacherStages.filter((stage) => stage.displayWord && stage.syllables.length).map((stage) => stage.displayWord);
    const allTitles = [...new Map([...titleWords.map((word) => ({ id: `title-${encodeURIComponent(word)}`, name: titleNameForWord(word), word })), ...titleState.earned].map((title) => [title.id, title])).values()];
    archiveContentEl.innerHTML = `<div class="title-archive-list">${allTitles.map((title) => {
      const earned = titleState.earned.some((candidate) => candidate.id === title.id);
      const equipped = titleState.equippedId === title.id;
      const action = earned ? equipped
        ? `<span class="title-equipped-label">현재 장착</span><button class="title-action is-equipped" data-title-action="unequip" data-title-id="${escapeHtml(title.id)}">해제</button>`
        : `<button class="title-action" data-title-action="equip" data-title-id="${escapeHtml(title.id)}">장착</button>`
        : '<span class="title-locked-label">잠겨 있어요</span>';
      return `<article class="title-archive-item ${earned ? 'is-earned' : 'is-locked'} ${equipped ? 'is-equipped' : ''}"><div class="title-archive-icon">${earned ? '✦' : '🔒'}</div><div class="title-archive-copy"><strong>${escapeHtml(title.name)}</strong><small>연결된 단어: ${escapeHtml(title.word)}</small><small>${earned ? `획득 ${escapeHtml(title.earnedAt)} · ${title.order}번째` : '잠겨 있어요'}</small></div><div class="title-archive-action">${action}</div></article>`;
    }).join('') || '<p class="archive-empty">아직 획득할 칭호가 없어요.</p>'}</div>`;
    return;
  }
  archiveContentEl.innerHTML = `<div class="archive-list"><div class="archive-item"><div class="archive-icon">💧</div><div><strong>MP 회복 물약</strong><small>MP 1 회복</small></div><span class="storage-count">${inventory.mpPotion}개</span><button class="storage-use" data-use-item="mpPotion" ${inventory.mpPotion <= 0 || mp.current >= currentMPSettings().max ? 'disabled' : ''}>사용</button></div><div class="archive-item"><div class="archive-icon">♥</div><div><strong>전투 체력 회복 물약</strong><small>전투 체력 1칸 회복</small></div><span class="storage-count">${inventory.combatPotion}개</span><button class="storage-use" data-use-item="combatPotion" ${inventory.combatPotion <= 0 || combat.current >= combat.max ? 'disabled' : ''}>사용</button></div></div>`;
}

function closeArchive() {
  archivePanel.hidden = true;
  activeArchive = null;
}

function useStoredItem(type) {
  if (automaticRest.active) return;
  if (type === 'mpPotion') {
    if (inventory.mpPotion <= 0 || mp.current >= currentMPSettings().max) return showNotice('MP가 이미 가득 차 있어요.', 1400);
    inventory.mpPotion -= 1;
    mp.current = Math.min(currentMPSettings().max, mp.current + 1);
    mp.recoveryElapsed = 0;
    persistMPState(); updateMPHud();
  } else {
    if (inventory.combatPotion <= 0 || combat.current >= combat.max) return showNotice('전투 체력이 이미 가득 차 있어요.', 1400);
    inventory.combatPotion -= 1;
    combat.current = Math.min(combat.max, combat.current + 1);
    updateCombatHud();
  }
  persistArchiveState();
  renderArchive('items');
}

function beginCharacterChange() {
  closeMenu();
  gameStarted = false;
  successOverlay.hidden = true;
  hintOverlay.hidden = true;
  startScreen.hidden = false;
  showSetupStep();
}

function closeRestartPrompt() {
  restartPrompt.hidden = true;
}

function restartAdventure() {
  closeMenu();
  restartPrompt.hidden = false;
  restartYesButton.focus();
}

function confirmRestartAdventure() {
  const firstStage = teacherStages.find((stage) => stage.stageNumber === 1 && stage.displayWord && stage.syllables.length) || normalizeStage(DEFAULT_STAGE);
  firstStage.locked = false;
  teacherStages.forEach((stage) => {
    stage.active = stage.id === firstStage.id;
    stage.completed = false;
  });
  persistTeacherStages();
  closeRestartPrompt();
  applyStage(firstStage, { regenerateLayout: true });
  gameStarted = true;
  startScreen.hidden = true;
  persistProfile();
}

function declineRestartAdventure() {
  closeRestartPrompt();
}

function resetProfile() {
  if (!window.confirm('프로필을 초기화할까요? 이름과 캐릭터 선택이 지워집니다.')) return;
  try {
    localStorage.removeItem('letter-kingdom-profile');
    localStorage.removeItem('letter-kingdom-mp-states');
    localStorage.removeItem('letter-kingdom-archive');
  } catch (error) { /* localStorage may be unavailable */ }
  profile.name = '다온';
  profile.character = 'swordsman';
  archiveState.collectedSyllables = [];
  archiveState.completedWords = {};
  titleState.earned = [];
  titleState.equippedId = null;
  inventory.mpPotion = 0;
  inventory.combatPotion = 0;
  persistArchiveState();
  selectedCharacter = 'swordsman';
  gameStarted = false;
  applyProfileToHud();
  resetChallenge();
  closeMenu();
  startScreen.hidden = false;
  welcomeStep.hidden = true;
  setupStep.hidden = false;
  heroNameInput.value = '';
  characterChoiceButtons.forEach((button) => {
    const selected = button.dataset.character === selectedCharacter;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  heroNameInput.focus();
}

let editingTeacherStageId = activeStage.id;

function persistTeacherStages() {
  try { localStorage.setItem(STAGE_STORAGE_KEY, JSON.stringify(teacherStages)); } catch (error) { /* localStorage may be unavailable */ }
}

function saveActiveStageId() {
  try { localStorage.setItem(ACTIVE_STAGE_STORAGE_KEY, activeStage.id); } catch (error) { /* localStorage may be unavailable */ }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function updateTeacherPreview() {
  const word = teacherWordInput.value.trim();
  const syllables = splitHangulSyllables(word).slice(0, 6);
  teacherSyllablePreview.innerHTML = `<strong>학습 미리보기</strong><div>목표 단어: ${escapeHtml(word || '입력 필요')}</div><div>수집 순서: ${syllables.length ? syllables.join(' → ') : '—'}</div><div>진행률: 0/${syllables.length}</div><div class="teacher-preview-hint">힌트: ${escapeHtml(teacherHintInput.value || DEFAULT_STAGE.hint)}</div>`;
}

function fillTeacherForm(stage) {
  const normalized = normalizeStage(stage);
  editingTeacherStageId = normalized.id;
  teacherStageNumber.value = normalized.stageNumber;
  teacherWordInput.value = normalized.displayWord || normalized.word;
  teacherLearningMode.value = normalized.learningMode;
  teacherHintInput.value = normalized.hint;
  teacherStatusInput.value = normalized.active ? 'current' : normalized.locked ? 'locked' : 'playable';
  updateTeacherPreview();
}

function showTeacherList() {
  teacherListView.hidden = false;
  teacherEditorView.hidden = true;
  renderTeacherStageList();
}

function showTeacherEditor(stage) {
  fillTeacherForm(stage);
  teacherListView.hidden = true;
  teacherEditorView.hidden = false;
}

function stageStatusLabel(stage) {
  if (!stage.word) return '내용 없음';
  if (stage.active) return '현재 플레이 중';
  if (stage.locked) return '잠김';
  return '플레이 가능';
}

function renderTeacherStageList() {
  const ordered = Array.from({ length: 10 }, (_, index) => teacherStages.find((stage) => stage.stageNumber === index + 1) || normalizeStage({ id: `stage-${index + 1}`, stageNumber: index + 1, word: '', displayWord: '', syllables: [], locked: index > 0, active: index === 0, protected: index === 0 }));
  teacherStageList.innerHTML = `<div class="teacher-stage-table"><div class="teacher-stage-row teacher-stage-head"><strong>단계</strong><strong>목표 단어</strong><strong>힌트 문장</strong><strong>학습 방식</strong><strong>상태</strong><strong>기능</strong></div>${ordered.map((stage) => `<div class="teacher-stage-row"><strong>${stage.stageNumber}</strong><span>${escapeHtml(stage.displayWord || stage.word || '—')}</span><span class="teacher-hint-cell">${escapeHtml(stage.hint || '—')}</span><span>${stage.learningMode === 'jamo' ? '자음·모음 모드' : '음절 모드'}</span><span class="teacher-status-badge ${stage.active ? 'is-current' : stage.locked ? 'is-locked' : stage.word ? 'is-playable' : 'is-empty'}">${stageStatusLabel(stage)}</span><span class="teacher-stage-actions"><button data-teacher-load="${stage.id}" type="button">편집</button>${stage.protected ? '<small>기본</small>' : `<button data-teacher-delete="${stage.id}" type="button">삭제</button>`}</span></div>`).join('')}</div>`;
}

function openTeacherSettings() {
  closeMenu();
  teacherPanel.hidden = false;
  showTeacherList();
  teacherFeedback.textContent = '';
}

function closeTeacherSettings() {
  teacherPanel.hidden = true;
}

function saveTeacherStage() {
  const displayWord = teacherWordInput.value.trim();
  if (!displayWord) {
    teacherFeedback.textContent = '목표 단어를 입력해 주세요.';
    return;
  }
  const syllables = splitHangulSyllables(displayWord);
  if (syllables.length > 6) teacherFeedback.textContent = '목표 단어가 길어요. 앞의 6개 음절까지 사용합니다.';
  else if (!syllables.length) teacherFeedback.textContent = '한글 음절을 입력해 주세요.';
  else teacherFeedback.textContent = `${syllables.slice(0, 6).join(' → ')} 음절이 생성되었어요.`;
  const id = editingTeacherStageId || `stage-${Date.now()}`;
  const status = teacherStatusInput.value;
  const stage = normalizeStage({
    id,
    stageNumber: teacherStageNumber.value,
    displayWord: displayWord || DEFAULT_STAGE.word,
    word: displayWord || DEFAULT_STAGE.word,
    syllables: syllables.slice(0, 6),
    learningMode: teacherLearningMode.value,
    hint: teacherHintInput.value,
    locked: status === 'locked',
    active: status === 'current',
    protected: id === DEFAULT_STAGE.id
  });
  const index = teacherStages.findIndex((item) => item.id === id);
  if (index >= 0) teacherStages[index] = stage;
  else teacherStages.push(stage);
  if (stage.active) teacherStages.forEach((item) => { if (item.id !== stage.id) item.active = false; });
  if (!teacherStages.some((item) => item.active && !item.locked)) {
    const fallback = teacherStages.find((item) => item.id === DEFAULT_STAGE.id) || teacherStages[0];
    if (fallback) { fallback.active = true; fallback.locked = false; }
  }
  persistTeacherStages();
  if (stage.active && !stage.locked) applyStage(stage);
  teacherFeedback.textContent = `스테이지 ${stage.stageNumber}가 저장되었어요.`;
  renderTeacherStageList();
  fillTeacherForm(stage);
  showTeacherList();
}

function applyStage(stage, { regenerateLayout = true } = {}) {
  activeStage = normalizeStage(stage);
  initializeStageEntities(activeStage, regenerateLayout);
  saveActiveStageId();
  applyStageUi();
  resetChallenge({ regenerateLayout: false });
}

function applyStageUi() {
  const word = activeStageWord();
  document.querySelector('#goal-word').textContent = word;
  document.querySelector('#hint-title').textContent = `${word} 힌트`;
  document.querySelector('#hint-description').textContent = activeStage.hint;
  document.querySelector('#hint-goal-word').textContent = word;
  document.querySelector('#success-title').textContent = `${word} 낱말 미션 성공!`;
  successMessageEl.textContent = '글자를 모아 문을 통과했어요.';
  document.querySelector('#monster-question').textContent = `${word}의 첫 번째 음절은 무엇일까요?`;
  const choices = [activeStage.syllables[0], activeStage.syllables[1] || '나', activeStage.syllables[2] || '다'];
  monsterChoiceButtons.forEach((button, index) => {
    button.dataset.answer = choices[index];
    button.textContent = choices[index];
  });
  updateCollectionHud();
}

function startTeacherStage() {
  const stage = teacherStages.find((item) => item.id === editingTeacherStageId) || activeStage;
  if (stage.locked || !stage.active) {
    teacherFeedback.textContent = '잠긴 스테이지는 먼저 해제해 주세요.';
    return;
  }
  stage.active = true;
  teacherStages.forEach((item) => { if (item.id !== stage.id) item.active = false; });
  persistTeacherStages();
  applyStage(stage);
  closeTeacherSettings();
  gameStarted = true;
  startScreen.hidden = true;
  persistProfile();
}

teacherSettingsButton.addEventListener('click', openTeacherSettings);
teacherCloseButton.addEventListener('click', closeTeacherSettings);
teacherNewListButton.addEventListener('click', () => {
  const usedNumbers = new Set(teacherStages.map((stage) => stage.stageNumber));
  const stageNumber = Array.from({ length: 10 }, (_, index) => index + 1).find((number) => !usedNumbers.has(number));
  if (!stageNumber) return;
  showTeacherEditor(normalizeStage({ id: `stage-${Date.now()}`, stageNumber, displayWord: '', word: '', syllables: [], active: false, locked: false, hint: '' }));
  teacherWordInput.value = '';
  teacherHintInput.value = '';
  teacherStatusInput.value = 'playable';
  teacherFeedback.textContent = '새 스테이지 내용을 입력해 주세요.';
  updateTeacherPreview();
});
teacherNewButton.addEventListener('click', () => teacherNewListButton.click());
teacherSaveButton.addEventListener('click', saveTeacherStage);
teacherStartButton.addEventListener('click', startTeacherStage);
teacherCancelButton.addEventListener('click', showTeacherList);
teacherWordInput.addEventListener('input', updateTeacherPreview);
teacherHintInput.addEventListener('input', updateTeacherPreview);
teacherStageList.addEventListener('click', (event) => {
  const loadButton = event.target.closest('[data-teacher-load]');
  const deleteButton = event.target.closest('[data-teacher-delete]');
  if (loadButton) {
    const stage = teacherStages.find((item) => item.id === loadButton.dataset.teacherLoad);
    if (stage) showTeacherEditor(stage);
  }
  if (deleteButton) {
    const stage = teacherStages.find((item) => item.id === deleteButton.dataset.teacherDelete);
    if (!stage || stage.protected) return;
    if (!window.confirm(`${stage.word} 스테이지를 삭제할까요?`)) return;
    const index = teacherStages.indexOf(stage);
    teacherStages.splice(index, 1);
    persistTeacherStages();
    if (editingTeacherStageId === stage.id) fillTeacherForm(activeStage);
    renderTeacherStageList();
  }
});

menuButton.addEventListener('click', () => (menuPanel.hidden ? openMenu() : closeMenu()));
changeCharacterButton.addEventListener('click', beginCharacterChange);
restartAdventureButton.addEventListener('click', restartAdventure);
restartYesButton.addEventListener('click', confirmRestartAdventure);
restartNoButton.addEventListener('click', declineRestartAdventure);
resetProfileButton.addEventListener('click', resetProfile);
closeMenuButton.addEventListener('click', closeMenu);
letterArchiveButton.addEventListener('click', () => renderArchive('letters'));
wordArchiveButton.addEventListener('click', () => renderArchive('words'));
titleArchiveButton.addEventListener('click', () => renderArchive('titles'));
itemStorageButton.addEventListener('click', () => renderArchive('items'));
archiveCloseButton.addEventListener('click', closeArchive);
archiveContentEl.addEventListener('click', (event) => {
  const itemButton = event.target.closest('[data-use-item]');
  if (itemButton) {
    useStoredItem(itemButton.dataset.useItem);
    return;
  }
  const titleButton = event.target.closest('[data-title-action]');
  if (!titleButton) return;
  if (titleButton.dataset.titleAction === 'equip') equipTitle(titleButton.dataset.titleId);
  else unequipTitle(titleButton.dataset.titleId);
});
welcomeNextButton.addEventListener('click', showSetupStep);
characterChoiceButtons.forEach((button) => button.addEventListener('click', () => {
  selectedCharacter = button.dataset.character;
  characterChoiceButtons.forEach((choice) => {
    const selected = choice === button;
    choice.classList.toggle('is-selected', selected);
    choice.setAttribute('aria-checked', String(selected));
  });
}));
startGameButton.addEventListener('click', startAdventure);
heroNameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') startAdventure(); });
applyProfileToHud();
applyStageUi();
if (gameStarted) startScreen.hidden = true;

function updateMPHud() {
  const maximum = currentMPSettings().max;
  mpCountEl.textContent = `${mp.current}/${maximum}`;
  if (mpFillEl) {
    const ratio = maximum > 0 ? mp.current / maximum : 0;
    mpFillEl.style.width = `${ratio * 100}%`;
    mpFillEl.parentElement?.setAttribute('aria-valuemax', String(maximum));
    mpFillEl.parentElement?.setAttribute('aria-valuenow', String(mp.current));
  }
}

function updateCombatHud() {
  if (!combatHeartsEl) return;
  combatHeartsEl.querySelectorAll('span').forEach((heart, index) => {
    heart.classList.toggle('is-empty', index >= combat.current);
    heart.setAttribute('aria-hidden', index >= combat.current ? 'true' : 'false');
  });
  combatHeartsEl.setAttribute('aria-label', `전투 체력 ${combat.current}/${combat.max}`);
}

function updateEnergyHud() {
  energyCountEl.textContent = `${energy.current}/${MAX_ENERGY}`;
  energyPipsEl.querySelectorAll('i').forEach((pip, index) => pip.classList.toggle('is-active', index < energy.current));
  energyPipsEl.classList.toggle('is-empty', energy.current === 0);
  if (monsterEnergyEl) monsterEnergyEl.textContent = `에너지 ${energy.current}/${MAX_ENERGY}`;
  updateCombatHud();
  updateMPHud();
  updateSkillHud();
}

function activeStageWord() {
  return activeStage.displayWord || activeStage.word || activeStage.syllables.join('');
}

function currentHintMessage() {
  const next = activeStage.syllables[collectedLetters.length];
  if (!next) return `${activeStageWord()} 글자를 모두 모았어요!`;
  return collectedLetters.length === 0 ? `첫 번째 글자는 ‘${next}’예요.` : `다음 글자는 ‘${next}’예요.`;
}

function updateCollectionHud() {
  collectedLettersEl.textContent = collectedLetters.length ? collectedLetters.join(', ') : '아직 없어요';
  letterCountEl.textContent = `${collectedLetters.length}/${activeStage.syllables.length}`;
  nextLetterEl.textContent = challenge.status === 'complete' ? '없음' : (activeStage.syllables[collectedLetters.length] || '없음');
  wordStateEl.textContent = challenge.status === 'complete' ? `${activeStageWord()} 완성!` : '글자를 모아 보세요!';
  wordStateEl.classList.toggle('is-complete', challenge.status === 'complete');
  wordStateEl.classList.remove('is-wrong');
  updateEnergyHud();
}

function showNotice(message, duration = 1800) {
  letterNotice.textContent = message;
  letterNotice.classList.add('is-visible');
  window.clearTimeout(letterNoticeTimer);
  letterNoticeTimer = window.setTimeout(() => letterNotice.classList.remove('is-visible'), duration);
}

function showLetterNotice(character) {
  showNotice(`${character} 글자를 찾았어요!`);
}

function openHint() {
  if (automaticRest.active || energy.current === 0) return;
  hintCurrentEl.textContent = currentHintMessage();
  hintOverlay.hidden = false;
  nextLetterEl.classList.add('is-highlighted');
  window.clearTimeout(hintHighlightTimer);
  hintHighlightTimer = window.setTimeout(() => nextLetterEl.classList.remove('is-highlighted'), 1800);
}

function checkTreasureChest() {
  if (treasureChest.opened || automaticRest.active || energy.current === 0) return;
  const footY = player.y + player.footOffsetY;
  if (Math.hypot(player.x - treasureChest.x, footY - treasureChest.y) > player.radius + 30) return;
  treasureChest.opened = true;
  showNotice(`${activeStageWord()} 힌트를 찾았어요!`, 1500);
  openHint();
}

function setMonsterChoicesDisabled(disabled) {
  monsterChoiceButtons.forEach((button) => { button.disabled = disabled; });
}

function openMonsterQuiz(monster = learningMonster) {
  if (monster.resolved || automaticRest.active || energy.current === 0 || monsterQuizOpen) return;
  quizTargetMonster = monster;
  monsterQuizOpen = true;
  monsterAnswerCooldownUntil = 0;
  monsterFeedback.textContent = '';
  monsterChoiceButtons.forEach((button) => button.classList.remove('is-wrong'));
  setMonsterChoicesDisabled(false);
  updateEnergyHud();
  monsterOverlay.hidden = false;
  showNotice('글자 몬스터가 길을 막고 있어요.', 1800);
}

function checkMonsterProximity() {
  if (automaticRest.active || restState.promptOpen || !restartPrompt.hidden || energy.current === 0 || monsterQuizOpen) return;
  const footY = player.y + player.footOffsetY;
  const nearby = learningMonsters.find((monster) => !monster.resolved && !monster.quizResolved && Math.hypot(player.x - monster.x, footY - monster.y) <= player.radius + 75);
  if (nearby) openMonsterQuiz(nearby);
}

function answerMonster(answer) {
  const now = performance.now();
  if (!monsterQuizOpen || automaticRest.active || energy.current === 0 || now < monsterAnswerCooldownUntil) return;
  if (answer === activeStage.syllables[0]) {
    quizTargetMonster.quizResolved = true;
    monsterQuizOpen = false;
    monsterOverlay.hidden = true;
    setMonsterChoicesDisabled(false);
    monsterChoiceButtons.forEach((button) => button.classList.remove('is-wrong'));
    showNotice('잘했어요! 정답이에요.', 2200);
    return;
  }
  const selectedButton = [...monsterChoiceButtons].find((button) => button.dataset.answer === answer);
  monsterAnswerCooldownUntil = now + 1000;
  if (selectedButton) selectedButton.classList.add('is-wrong');
  if (consumeLearningShield()) {
    monsterFeedback.textContent = '방패가 오답 피해를 막아줬어요. 다시 생각해 볼까요?';
    setMonsterChoicesDisabled(true);
    window.clearTimeout(monsterUnlockTimer);
    monsterUnlockTimer = window.setTimeout(() => {
      monsterAnswerCooldownUntil = 0;
      setMonsterChoicesDisabled(false);
      monsterChoiceButtons.forEach((button) => button.classList.remove('is-wrong'));
    }, 1000);
    return;
  }
  energy.current = Math.max(0, energy.current - 1);
  updateEnergyHud();
  monsterFeedback.textContent = '괜찮아요. 다시 생각해 볼까요?';
  setMonsterChoicesDisabled(true);
  if (energy.current === 0) {
    monsterQuizOpen = false;
    monsterOverlay.hidden = true;
    startAutomaticRest();
    return;
  }
  window.clearTimeout(monsterUnlockTimer);
  monsterUnlockTimer = window.setTimeout(() => {
    monsterAnswerCooldownUntil = 0;
    setMonsterChoicesDisabled(false);
    monsterChoiceButtons.forEach((button) => button.classList.remove('is-wrong'));
  }, 1000);
}

hintCloseButton.addEventListener('click', () => { hintOverlay.hidden = true; });
monsterChoiceButtons.forEach((button) => button.addEventListener('click', () => answerMonster(button.dataset.answer)));

function useLearningSkill() {
  const now = performance.now();
  if (!gameStarted || energy.current === 0 || automaticRest.active || now < skillState.cooldownUntil) return;
  if (mp.current < 1) {
    showNotice('마나가 없어서 스킬을 사용할 수 없습니다.', 2200);
    updateSkillHud(now);
    return;
  }
  if (profile.character === 'archer') {
    const target = availableLetterItems().find((item) => !item.collected && item.character === activeStage.syllables[collectedLetters.length]);
    const footY = player.y + player.footOffsetY;
    const distance = target ? Math.hypot(player.x - target.x, footY - target.y) : Infinity;
    mp.current = Math.max(0, mp.current - 1);
    mp.recoveryElapsed = 0;
    persistMPState();
    skillState.cooldownUntil = now + ARCHER_SKILL_COOLDOWN;
    skillState.focusItemId = null;
    skillState.focusUntil = 0;
    skillState.arrowUntil = 0;
    skillState.activeUntil = now;
    updateMPHud(); updateSkillHud(now);
    if (!target || distance > ARCHER_SKILL_DETECTION_RANGE) {
      showNotice('글자 감지에 실패했습니다.', 2200);
      return;
    }
    skillState.focusItemId = target.id;
    skillState.focusUntil = now + ARCHER_SKILL_EFFECT_DURATION;
    skillState.arrowUntil = now + ARCHER_SKILL_ARROW_DURATION;
    skillState.activeUntil = skillState.focusUntil;
    updateSkillHud(now);
    showNotice('글자 찾기가 켜졌어요!', 1500);
    playSkillSound();
    return;
  }
  mp.current = Math.max(0, mp.current - 1);
  mp.recoveryElapsed = 0;
  persistMPState();
  skillState.cooldownUntil = now + 10000;
  skillState.activeUntil = now + 5000;
  if (profile.character === 'swordsman') {
    skillState.shieldUntil = now + 5000;
    skillState.shieldHitsRemaining = 2;
    skillState.combatShieldHitsRemaining = 1;
    skillState.shieldVisualOn = true;
    showNotice('글자 방패가 켜졌어요!', 1200);
  } else {
    skillState.hintUntil = now + 5000;
    hintCurrentEl.textContent = currentSkillHintMessage();
    hintOverlay.hidden = false;
    showNotice('낱말 힌트를 열었어요!', 1500);
  }
  updateMPHud(); updateSkillHud(now);
}

skillButton.addEventListener('click', useLearningSkill);
attackButton?.addEventListener('click', useBasicAttack);

function playSuccessSound() {
  try {
    successAudioContext ??= new AudioContext();
    const now = successAudioContext.currentTime;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = successAudioContext.createOscillator();
      const gain = successAudioContext.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.12, now + index * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.25);
      oscillator.connect(gain); gain.connect(successAudioContext.destination);
      oscillator.start(now + index * 0.08); oscillator.stop(now + index * 0.08 + 0.27);
    });
  } catch (error) {
    // Browsers that block Web Audio still receive the visual success feedback.
  }
}

function playCombatSound(kind = 'hit') {
  try {
    combatAudioContext ??= new AudioContext();
    const now = combatAudioContext.currentTime;
    const frequencies = kind === 'warning' ? [392, 523.25] : [659.25, 783.99];
    frequencies.forEach((frequency, index) => {
      const oscillator = combatAudioContext.createOscillator();
      const gain = combatAudioContext.createGain();
      oscillator.type = kind === 'warning' ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * .09);
      gain.gain.exponentialRampToValueAtTime(.07, now + index * .09 + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, now + index * .09 + .16);
      oscillator.connect(gain); gain.connect(combatAudioContext.destination);
      oscillator.start(now + index * .09); oscillator.stop(now + index * .09 + .18);
    });
  } catch (error) {
    // Visual combat feedback remains available when Web Audio is blocked.
  }
}

function playSkillSound() {
  try {
    successAudioContext ??= new AudioContext();
    const now = successAudioContext.currentTime;
    [659.25, 783.99, 987.77].forEach((frequency, index) => {
      const oscillator = successAudioContext.createOscillator();
      const gain = successAudioContext.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.08, now + index * 0.1 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.1 + 0.22);
      oscillator.connect(gain); gain.connect(successAudioContext.destination);
      oscillator.start(now + index * 0.1); oscillator.stop(now + index * 0.1 + 0.24);
    });
  } catch (error) {
    // Visual guidance remains available when Web Audio is blocked.
  }
}

function completeWord() {
  challenge.status = 'complete';
  const completedWord = activeStageWord();
  const completedAt = archiveState.completedWords[completedWord] || new Date().toLocaleDateString('ko-KR');
  archiveState.completedWords[completedWord] = completedAt;
  const titleReward = awardTitleForWord(completedWord);
  const savedStage = teacherStages.find((stage) => stage.id === activeStage.id);
  if (savedStage) {
    savedStage.completed = true;
    persistTeacherStages();
  }
  persistArchiveState();
  challenge.doorOpen = true;
  successEffect = { x: stageDoor.xCenter, y: stageDoor.y, life: 2.4 };
  updateCollectionHud();
  showNotice(titleReward.isNew
    ? `${completedWord} 단어를 완성했어요!\n새 칭호를 획득했어요: ${titleReward.title.name}`
    : `${completedWord} 단어를 완성했어요!\n이미 획득한 칭호가 있어요: ${titleReward.title.name}`, 3200);
  playSuccessSound();
}

function knockBackFromLetter(item) {
  const dx = player.x - item.x;
  const dy = player.y + player.footOffsetY - item.y;
  const length = Math.hypot(dx, dy) || 1;
  const push = 18;
  const nextX = player.x + (dx / length) * push;
  const nextY = player.y + (dy / length) * push;
  if (canMoveTo(nextX, player.y)) player.x = nextX;
  if (canMoveTo(player.x, nextY)) player.y = nextY;
}

function disengageTrainingMonster(monster = learningMonster) {
  if (monster.resolved) return;
  monster.state = 'idle';
  monster.warningUntil = 0;
  monster.attackActiveUntil = 0;
  monster.nextAttackAt = 0;
  monster.outOfRangeSince ||= performance.now();
  combat.inCombat = false;
  combat.lastDamageAt = 0;
  combat.recoveryElapsed = 0;
}

function startAutomaticRest(reason = 'energy') {
  if (automaticRest.active) return;
  learningMonsters.forEach((monster) => disengageTrainingMonster(monster));
  closeRestPrompt();
  restState.promptDismissed = true;
  resetSkillState();
  automaticRest.reason = reason;
  automaticRest.active = true;
  automaticRest.elapsed = 0;
  automaticRest.lastSecond = 5;
  wrongContact.touchingItemId = null;
  wrongContact.shieldUntil = 0;
  wrongContact.moveLockUntil = 0;
  monsterQuizOpen = false;
  monsterOverlay.hidden = true;
  setMonsterChoicesDisabled(true);
  window.clearTimeout(monsterUnlockTimer);
  monsterAnswerCooldownUntil = 0;
  restState.inside = true;
  restState.elapsed = 0;
  restState.recovered = false;
  restState.noticeShown = true;
  player.x = restArea.xCenter;
  player.y = restArea.yCenter - player.footOffsetY;
  restCountdownNumber.textContent = '5';
  restCountdown.hidden = false;
  showNotice(
    reason === 'combat'
      ? '전투 체력이 부족해요. 집으로 돌아가 쉴게요.'
      : reason === 'manual'
        ? '휴식을 시작할게요.'
        : '에너지가 부족해요. 집으로 돌아가 쉴게요.',
    3200
  );
}

function updateAutomaticRest(delta) {
  if (!automaticRest.active) return;
  automaticRest.elapsed += delta;
  const remaining = Math.max(1, 5 - Math.floor(automaticRest.elapsed));
  if (remaining !== automaticRest.lastSecond && automaticRest.elapsed < 5) {
    automaticRest.lastSecond = remaining;
    restCountdownNumber.textContent = String(remaining);
  }
  if (automaticRest.elapsed < 5) return;
  automaticRest.active = false;
  automaticRest.elapsed = 0;
  restCountdown.hidden = true;
  energy.current = MAX_ENERGY;
  learningMonsters.forEach((monster) => {
    monster.hp = Math.ceil(monster.maxHp / 2);
    monster.recoveryElapsed = 0;
    monster.outOfRangeSince = 0;
    monster.state = 'idle';
    monster.warningUntil = 0;
    monster.attackActiveUntil = 0;
    monster.nextAttackAt = 0;
  });
  learningMonster = learningMonsters[0] || learningMonster;
  combat.current = combat.max;
  combat.inCombat = false;
  combat.lastDamageAt = 0;
  combat.recoveryElapsed = 0;
  mp.current = currentMPSettings().max;
  mp.recoveryElapsed = 0;
  mp.saveElapsed = 0;
  persistMPState();
  updateMPHud();
  monsterAnswerCooldownUntil = 0;
  setMonsterChoicesDisabled(false);
  restState.inside = true;
  restState.elapsed = 0;
  restState.recovered = true;
  restState.noticeShown = true;
  recoveryEffect = { x: restArea.xCenter, y: restArea.yCenter, life: 2 };
  updateEnergyHud();
  showNotice(
    automaticRest.reason === 'manual'
      ? '푹 쉬었어요! 체력과 마나가 모두 회복되었어요.'
      : '푹 쉬었어요! 전투 체력과 에너지가 모두 회복되었어요.',
    2600
  );
}

function getFacingVector() {
  return player.facingVector;
}

function isTargetInAttackDirection(monster = learningMonster) {
  const dx = monster.x - player.x;
  const dy = monster.y - (player.y + player.footOffsetY);
  const distance = Math.hypot(dx, dy);
  if (!distance) return true;
  const targetX = dx / distance;
  const targetY = dy / distance;
  const facing = getFacingVector();
  return targetX * facing.x + targetY * facing.y >= Math.cos(Math.PI / 4);
}

function addCombatEffect(x, y, type = 'hit', direction = getFacingVector()) {
  attackState.effects.push({ x, y, type, direction: { ...direction }, life: type === 'defeat' ? 1.8 : .55, maxLife: type === 'defeat' ? 1.8 : .55 });
}

function dropMonsterReward(monster = learningMonster) {
  if (monsterReward.active && !monsterReward.collected) return;
  const neededCharacter = activeStage.syllables[collectedLetters.length];
  const targetItem = letterItems.find((item) => item.character === neededCharacter);
  const targetProtector = targetItem?.protectedMonsterId ? learningMonsters.find((candidate) => candidate.id === targetItem.protectedMonsterId) : null;
  const needsSyllable = Boolean(neededCharacter && !collectedLetters.includes(neededCharacter) && targetItem?.unlocked && targetProtector?.resolved);
  let type;
  if (monster.isAdditional) {
    const roll = Math.floor(Math.random() * 10);
    type = roll < 3 ? 'mpPotion' : roll < 6 ? 'combatPotion' : 'none';
  } else {
    const roll = Math.random();
    type = needsSyllable && (rewardState.nonSyllableStreak >= 2 || roll < .5)
      ? 'syllable'
      : roll < .75 ? 'mpPotion' : 'combatPotion';
  }
  if (type === 'none') {
    monsterReward.type = 'none';
    monsterReward.character = '';
    monsterReward.active = false;
    monsterReward.collected = true;
    monsterReward.dropped = false;
    showNotice('이번에는 보상이 없어요. 다른 몬스터도 살펴볼까요?', 2400);
    return;
  }
  monsterReward.type = type;
  monsterReward.character = type === 'syllable' ? neededCharacter : '';
  if (type === 'syllable') {
    rewardState.nonSyllableStreak = 0;
    const mapItem = letterItems.find((item) => item.character === neededCharacter);
    if (mapItem) { mapItem.disabled = true; mapItem.collected = false; }
  } else {
    rewardState.nonSyllableStreak += 1;
  }
  monsterReward.x = monster.x + 38;
  monsterReward.y = monster.y + 24;
  monsterReward.active = true;
  monsterReward.collected = false;
  monsterReward.dropped = true;
  monsterReward.wobble = 0;
  monsterReward.sparkle = 0;
  const message = type === 'syllable'
    ? `몬스터가 ‘${monsterReward.character}’ 음절을 떨어뜨렸어요!`
    : type === 'mpPotion' ? '몬스터가 MP 회복 물약을 떨어뜨렸어요!' : '몬스터가 전투 체력 회복 물약을 떨어뜨렸어요!';
  showNotice(message, 2400);
}

function damageTrainingMonster(monster = learningMonster, amount = 1) {
  if (monster.resolved || monster.hp <= 0) return false;
  monster.hp = Math.max(0, monster.hp - amount);
  monster.wobble = 1;
  addCombatEffect(monster.x, monster.y, 'hit');
  if (monster.hp === 0) {
    monster.resolved = true;
    monster.state = 'friend';
    const protectedItem = monster.protectedLetterIndex === null ? null : letterItems[monster.protectedLetterIndex];
    if (protectedItem) {
      protectedItem.unlocked = true;
      showNotice('몬스터가 정화되었어요! 이제 글자를 찾아보세요.', 2400);
    }
    combat.inCombat = false;
    combat.recoveryElapsed = 0;
    monster.defeatStartedAt = performance.now();
    monster.warningUntil = 0;
    monster.attackActiveUntil = 0;
    attackState.projectiles.length = 0;
    addCombatEffect(monster.x, monster.y, 'defeat');
    if (!protectedItem) showNotice('훈련 몬스터가 빛의 친구가 되었어요!', 2200);
    dropMonsterReward(monster);
  }
  return true;
}

function queueProjectile(type) {
  const direction = getFacingVector();
  attackState.projectiles.push({
    id: attackState.nextId++,
    type,
    x: player.x + direction.x * 30,
    y: player.y + direction.y * 30,
    vx: direction.x * (type === 'arrow' ? 520 : 400),
    vy: direction.y * (type === 'arrow' ? 520 : 400),
    life: type === 'arrow' ? .85 : 1.15,
    maxLife: type === 'arrow' ? .85 : 1.15,
    hit: false
  });
}

function useBasicAttack() {
  const now = performance.now();
  if (!gameStarted || automaticRest.active || restState.promptOpen || monsterQuizOpen || energy.current === 0 || now < attackState.cooldownUntil) return;
  attackState.cooldownUntil = now + BASIC_ATTACK_INTERVAL;
  if (profile.character === 'swordsman') {
    const target = learningMonsters.find((monster) => !monster.resolved && Math.hypot(player.x - monster.x, player.y + player.footOffsetY - monster.y) <= 125 && isTargetInAttackDirection(monster));
    if (target) damageTrainingMonster(target, 1);
    addCombatEffect(player.x, player.y - 12, 'slash', getFacingVector());
  } else if (profile.character === 'archer') {
    queueProjectile('arrow');
    addCombatEffect(player.x, player.y, 'shot');
  } else {
    queueProjectile('orb');
    addCombatEffect(player.x, player.y, 'cast');
  }
}

function updateBasicAttacks(delta) {
  attackState.effects.forEach((effect) => { effect.life -= delta; });
  attackState.effects = attackState.effects.filter((effect) => effect.life > 0);
  attackState.projectiles.forEach((projectile) => {
    projectile.x += projectile.vx * delta;
    projectile.y += projectile.vy * delta;
    projectile.life -= delta;
    const target = learningMonsters.find((monster) => !monster.resolved && Math.hypot(projectile.x - monster.x, projectile.y - monster.y) <= 38);
    if (!projectile.hit && target) {
      projectile.hit = true;
      projectile.life = 0;
      damageTrainingMonster(target, 1);
    }
  });
  attackState.projectiles = attackState.projectiles.filter((projectile) => projectile.life > 0);
}

function consumeLearningShield() {
  const now = performance.now();
  if (now >= skillState.shieldUntil || skillState.shieldHitsRemaining <= 0) return false;
  skillState.shieldHitsRemaining -= 1;
  if (skillState.shieldHitsRemaining === 0 && skillState.combatShieldHitsRemaining === 0) {
    skillState.shieldUntil = 0;
    skillState.shieldVisualOn = false;
    skillState.activeUntil = now;
  }
  updateSkillHud(now);
  showNotice('방어 성공!', 1200);
  return true;
}

function consumeCombatShield() {
  const now = performance.now();
  if (now >= skillState.shieldUntil || skillState.combatShieldHitsRemaining <= 0) return false;
  skillState.combatShieldHitsRemaining = 0;
  if (skillState.shieldHitsRemaining <= 0) {
    skillState.shieldUntil = 0;
    skillState.shieldVisualOn = false;
    skillState.activeUntil = now;
  }
  updateSkillHud(now);
  showNotice('방어 성공!', 1200);
  return true;
}

function handleWrongLetterContact(item) {
  const now = performance.now();
  item.wobble = 1;
  if (wrongContact.touchingItemId === item.id || now < wrongContact.shieldUntil) return;
  wrongContact.touchingItemId = item.id;
  wrongContact.shieldUntil = now + 1000;
  wrongContact.moveLockUntil = now + 500;
  if (consumeLearningShield()) return;
  energy.current = Math.max(0, energy.current - 1);
  knockBackFromLetter(item);
  updateEnergyHud();
  if (energy.current === 0) startAutomaticRest();
  else showNotice('먼저 다른 음절을 찾아볼까요?', 1800);
}

function collectNearbyLetter() {
  if (automaticRest.active || restState.promptOpen || energy.current === 0) return;
  const footY = player.y + player.footOffsetY;
  const neededCharacter = activeStage.syllables[collectedLetters.length];
  const item = availableLetterItems().find((candidate) => !candidate.collected && Math.hypot(player.x - candidate.x, footY - candidate.y) <= player.radius + 24);
  if (!item) {
    wrongContact.touchingItemId = null;
    return;
  }
  const isMonsterReward = item.source === 'monster-reward';
  if (!isMonsterReward && item.protectedMonsterId) {
    const protector = learningMonsters.find((monster) => monster.id === item.protectedMonsterId);
    if (protector && !protector.resolved) {
      showNotice('몬스터를 먼저 정화해야 이 글자를 얻을 수 있어요.', 2200);
      return;
    }
  }
  if ((!isMonsterReward || monsterReward.type === 'syllable') && item.character !== neededCharacter) {
    handleWrongLetterContact(item);
    return;
  }
  item.collected = true;
  if (isMonsterReward) {
    monsterReward.active = false;
    monsterReward.collected = true;
    monsterReward.dropped = false;
    if (monsterReward.type === 'syllable') {
      collectedLetters.push(item.character);
      if (!archiveState.collectedSyllables.includes(item.character)) archiveState.collectedSyllables.push(item.character);
      pickupEffects.push({ x: item.x, y: item.y, character: item.character, life: 1 });
      showNotice(`‘${item.character}’ 음절을 획득했어요!`, 2200);
    } else if (monsterReward.type === 'mpPotion') {
      inventory.mpPotion += 1;
      showNotice('MP 회복 물약을 창고에 보관했어요!', 1800);
    } else {
      inventory.combatPotion += 1;
      showNotice('전투 체력 회복 물약을 창고에 보관했어요!', 1800);
    }
    persistArchiveState();
  } else {
    collectedLetters.push(item.character);
    if (!archiveState.collectedSyllables.includes(item.character)) archiveState.collectedSyllables.push(item.character);
    pickupEffects.push({ x: item.x, y: item.y, character: item.character, life: 1 });
    persistArchiveState();
    if (item.character === '사') showNotice('잘했어요! 이제 ‘과’를 찾아보세요.', 2200);
    else showLetterNotice(item.character);
  }
  wrongContact.touchingItemId = null;
  updateCollectionHud();
  if (collectedLetters.length === activeStage.syllables.length) completeWord();
}

function updatePickupEffects(delta) {
  pickupEffects.forEach((effect) => { effect.life -= delta; });
  letterItems.forEach((item) => { item.wobble = Math.max(0, item.wobble - delta * 2.6); });
  while (pickupEffects.length && pickupEffects[0].life <= 0) pickupEffects.shift();
  if (successEffect) {
    successEffect.life -= delta;
    if (successEffect.life <= 0) successEffect = null;
  }
  treasureChest.sparkle += delta;
  if (recoveryEffect) {
    recoveryEffect.life -= delta;
    if (recoveryEffect.life <= 0) recoveryEffect = null;
  }
}

function updateMPRecovery(delta) {
  const settings = currentMPSettings();
  if (mp.current >= settings.max) {
    mp.recoveryElapsed = 0;
    mp.saveElapsed = 0;
    return;
  }
  mp.recoveryElapsed += delta;
  mp.saveElapsed += delta;
  if (mp.recoveryElapsed >= settings.recoverySeconds) {
    mp.current = Math.min(settings.max, mp.current + 1);
    mp.recoveryElapsed = 0;
    persistMPState();
    updateMPHud();
  } else if (mp.saveElapsed >= 1) {
    mp.saveElapsed = 0;
    persistMPState();
  }
}

function closeRestPrompt() {
  restState.promptOpen = false;
  restPrompt.hidden = true;
}

function openRestPrompt() {
  if (automaticRest.active || restState.promptOpen || restState.promptDismissed) return;
  restState.promptOpen = true;
  restPrompt.hidden = false;
}

function beginRestFromPrompt() {
  if (!restState.promptOpen) return;
  closeRestPrompt();
  restState.promptDismissed = true;
  startAutomaticRest('manual');
}

function declineRestPrompt() {
  closeRestPrompt();
  restState.promptDismissed = true;
}

restYesButton.addEventListener('click', beginRestFromPrompt);
restNoButton.addEventListener('click', declineRestPrompt);

function updateRestZone() {
  const footY = player.y + player.footOffsetY;
  const inside = circleIntersectsRect(player.x, footY, player.radius, restArea);
  if (!inside) {
    restState.inside = false;
    restState.elapsed = 0;
    restState.recovered = false;
    restState.noticeShown = false;
    restState.promptDismissed = false;
    closeRestPrompt();
    return;
  }
  if (!restState.inside) {
    restState.inside = true;
    restState.elapsed = 0;
    restState.recovered = false;
    restState.noticeShown = false;
    restState.promptDismissed = false;
  }
  if (!automaticRest.active && !restState.promptDismissed) openRestPrompt();
}

const trees = [
  [260, 210], [430, 310], [720, 175], [1040, 230], [1440, 180], [1780, 245], [2110, 185], [2280, 430],
  [230, 920], [410, 1120], [690, 1320], [1030, 1210], [1530, 1325], [1860, 1180], [2180, 1260], [2290, 900],
  [760, 540], [1780, 680], [520, 720], [2030, 740]
];
const rocks = [[350, 570], [620, 1010], [890, 380], [1120, 1260], [1480, 480], [1710, 1030], [2050, 520], [2150, 1020], [980, 930]];
const flowers = [[520, 460], [570, 470], [650, 480], [1550, 760], [1600, 780], [680, 1180], [1900, 580], [1950, 595], [300, 1280], [2010, 1370], [1320, 300]];
const fences = [[820, 620], [860, 620], [900, 620], [940, 620], [980, 620]];
const collisions = [
  ...trees.map(([x, y]) => ({ x, y, r: 39 })),
  ...rocks.map(([x, y]) => ({ x, y, r: 30 }))
];

// Static map barriers. House walls keep a doorway-sized opening on the south side.
const staticRects = [
  { x: 816, y: 586, w: 208, h: 54, name: 'fence' },
  ...houseCollisionRects(1260, 480),
  ...houseCollisionRects(430, 760)
];

// Sampled points follow the same two Bézier curves used by the visible river.
const riverCenterline = [
  [1830, -50], [1818, 135], [1819, 300], [1835, 465], [1862, 620], [1883, 770], [1810, 920],
  [1784, 1055], [1758, 1190], [1753, 1325], [1781, 1460], [1810, 1590], [1780, 1700]
];
const RIVER_WATER_HALF_WIDTH = 22;
// This is the horizontal path crossing over the stream; only this rectangle bypasses river collision.
const bridgePassage = { x: 1808, y: 760, w: 112, h: 80 };
const stageDoor = { x: 1090, y: 760, w: 80, h: 24, xCenter: 1130, yCenter: 748 };
// The right-hand house is the nearby rest place. This area is outside the doorway; no interior map is added.
const restArea = { x: 1218, y: 560, w: 84, h: 70, xCenter: 1260, yCenter: 595 };
const DEBUG_COLLISIONS = false;
const DEBUG_REGIONS = false;
const VILLAGE_CENTER = { x: 1140, y: 650, radiusX: 300, radiusY: 270 };
const FIELD_REGIONS = [
  {
    id: 'village', name: '반짝숲 마을', message: '반짝숲 마을에 도착했어요!', color: 'rgba(255, 239, 178, .18)',
    areas: [{ x: 790, y: 430, w: 560, h: 500 }]
  },
  {
    id: 'forest', name: '글자 숲', message: '글자 숲에 도착했어요!', color: 'rgba(107, 191, 123, .14)',
    areas: [{ x: 90, y: 80, w: 700, h: 600 }, { x: 80, y: 860, w: 710, h: 620 }, { x: 1320, y: 100, w: 500, h: 560 }]
  },
  {
    id: 'playground', name: '음절 놀이터', message: '음절 놀이터에 도착했어요!', color: 'rgba(244, 180, 101, .15)',
    areas: [{ x: 790, y: 970, w: 610, h: 520 }, { x: 1320, y: 650, w: 470, h: 820 }, { x: 1950, y: 240, w: 330, h: 1230 }]
  }
];
const STAGE_ZONES = [
  { x: 140, y: 120, w: 460, h: 390 },
  { x: 680, y: 110, w: 110, h: 390 },
  { x: 1320, y: 120, w: 390, h: 360 },
  { x: 120, y: 900, w: 520, h: 480 },
  { x: 720, y: 1080, w: 560, h: 390 },
  { x: 1320, y: 960, w: 400, h: 420 },
  { x: 1980, y: 300, w: 300, h: 420 },
  { x: 1960, y: 900, w: 300, h: 440 },
  { x: 1320, y: 650, w: 390, h: 260 }
];

function riverXAtY(y) {
  for (let index = 0; index < riverCenterline.length - 1; index += 1) {
    const [x1, y1] = riverCenterline[index];
    const [x2, y2] = riverCenterline[index + 1];
    if (y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) {
      const ratio = (y - y1) / (y2 - y1 || 1);
      return x1 + (x2 - x1) * ratio;
    }
  }
  return y < riverCenterline[0][1] ? riverCenterline[0][0] : riverCenterline.at(-1)[0];
}

function isInsideVillage(x, y) {
  const dx = (x - VILLAGE_CENTER.x) / VILLAGE_CENTER.radiusX;
  const dy = (y - VILLAGE_CENTER.y) / VILLAGE_CENTER.radiusY;
  return dx * dx + dy * dy <= 1;
}

function fieldRegionAt(x, y) {
  if (isInsideVillage(x, y)) return FIELD_REGIONS.find((region) => region.id === 'village');
  // The river is a continuous curved boundary. Crossing it (normally via the bridge)
  // changes between the two field regions instead of falling back to the village.
  return x < riverXAtY(y)
    ? FIELD_REGIONS.find((region) => region.id === 'forest')
    : FIELD_REGIONS.find((region) => region.id === 'playground');
}

function updateFieldRegion() {
  const region = fieldRegionAt(player.x, player.y + player.footOffsetY);
  if (!region || region.id === currentRegionId) return;
  currentRegionId = region.id;
  currentRegionNameEl.textContent = region.name;
  regionToastNameEl.textContent = region.name;
  regionToastMessageEl.textContent = region.message;
  regionToast.hidden = false;
  regionToast.classList.add('is-visible');
  window.clearTimeout(regionToastTimer);
  regionToastTimer = window.setTimeout(() => {
    regionToast.classList.remove('is-visible');
    regionToast.hidden = true;
  }, 2600);
}

function drawFieldRegions() {
  const village = FIELD_REGIONS.find((region) => region.id === 'village');
  ctx.save();
  ctx.fillStyle = village.color;
  ctx.beginPath();
  ctx.ellipse(VILLAGE_CENTER.x, VILLAGE_CENTER.y, VILLAGE_CENTER.radiusX, VILLAGE_CENTER.radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const labels = [
    { name: '반짝숲 마을', x: 1140, y: 545, color: '#bd8742' },
    { name: '글자 숲', x: 430, y: 180, color: '#4f8c5e' },
    { name: '글자 놀이터', x: 2140, y: 540, color: '#4c7fa9' }
  ];
  labels.forEach(({ name, x, y, color }) => {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    roundedRect(x - 86, y - 27, 172, 45, 14); ctx.fill();
    ctx.fillStyle = color;
    ctx.font = 'bold 22px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, x, y - 4);
    ctx.restore();
  });
  if (DEBUG_REGIONS) drawRegionDebug();
}

function drawRegionDebug() {
  ctx.save();
  ctx.strokeStyle = 'rgba(239, 145, 67, .9)';
  ctx.lineWidth = 5;
  ctx.setLineDash([14, 8]);
  ctx.beginPath();
  ctx.ellipse(VILLAGE_CENTER.x, VILLAGE_CENTER.y, VILLAGE_CENTER.radiusX, VILLAGE_CENTER.radiusY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(67, 157, 224, .86)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(riverCenterline[0][0], riverCenterline[0][1]);
  riverCenterline.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.stroke();
  ctx.fillStyle = '#e65757';
  ctx.beginPath(); ctx.arc(player.x, player.y + player.footOffsetY, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function seededRandom(seed) {
  let value = Math.abs(Number(seed) || 1) % 2147483647;
  return () => {
    value = value * 16807 % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function stageSeed(stage, nonce = 0) {
  return Array.from(`${stage.id}:${stage.stageNumber}:${nonce}`).reduce((sum, character) => ((sum * 31) + character.charCodeAt(0)) % 2147483647, 17);
}

function isValidSpawnPosition(x, y, reserved = [], radius = 34) {
  const footY = y + player.footOffsetY;
  if (x < 70 || y < 70 || x > WORLD.width - 70 || y > WORLD.height - 70) return false;
  if (Math.hypot(x - 1200, y - 805) < 190) return false;
  if (Math.hypot(x - restArea.xCenter, footY - restArea.yCenter) < 170) return false;
  if (Math.hypot(x - stageDoor.xCenter, footY - stageDoor.y) < 150) return false;
  if (isBlockedByRiver(x, y)) return false;
  if (x >= bridgePassage.x - radius && x <= bridgePassage.x + bridgePassage.w + radius && footY >= bridgePassage.y - radius && footY <= bridgePassage.y + bridgePassage.h + radius) return false;
  if (collisions.some((item) => Math.hypot(x - item.x, y - item.y) < item.r + radius)) return false;
  if (staticRects.some((rect) => circleIntersectsRect(x, rect.name.startsWith('house') ? footY : y, radius, rect))) return false;
  return reserved.every((item) => Math.hypot(x - item.x, y - item.y) >= item.minDistance);
}

function createStageLayout(stage, regenerate = false) {
  const key = stage.id;
  const previous = stageLayouts[key];
  const nonce = regenerate ? Number(previous?.nonce || 0) + 1 : Number(previous?.nonce || 0);
  if (!regenerate && previous?.letters?.length === stage.syllables.length && previous?.monsters?.length === stage.syllables.length + 3) return previous;
  const random = seededRandom(stageSeed(stage, nonce));
  const reserved = [];
  const letters = [];
  const monsters = [];
  const candidates = STAGE_ZONES.flatMap((zone) => {
    const points = [];
    for (let index = 0; index < 18; index += 1) {
      points.push({ x: zone.x + random() * zone.w, y: zone.y + random() * zone.h });
    }
    return points;
  });
  const takePosition = (minDistance, extraReserved = []) => {
    for (let attempt = 0; attempt < candidates.length * 2; attempt += 1) {
      const candidate = candidates[Math.floor(random() * candidates.length)];
      const allReserved = [...reserved, ...extraReserved];
      if (isValidSpawnPosition(candidate.x, candidate.y, allReserved, 34)) {
        reserved.push({ x: candidate.x, y: candidate.y, minDistance });
        return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
      }
    }
    const fallbacks = [[560, 420], [740, 320], [1480, 330], [420, 1070], [850, 1270], [1450, 1160], [2140, 530], [2140, 1150]];
    const fallback = fallbacks.find((point) => isValidSpawnPosition(point[0], point[1], [...reserved, ...extraReserved], 34)) || [560, 420];
    reserved.push({ x: fallback[0], y: fallback[1], minDistance });
    return { x: fallback[0], y: fallback[1] };
  };
  const takeNearbyPosition = (anchor) => {
    const nearbyReserved = [...reserved.slice(0, -1), { x: anchor.x, y: anchor.y, minDistance: 72 }];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = 78 + random() * 38;
      const x = anchor.x + Math.cos(angle) * distance;
      const y = anchor.y + Math.sin(angle) * distance;
      if (isValidSpawnPosition(x, y, nearbyReserved, 34)) {
        reserved.push({ x, y, minDistance: 150 });
        return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return takePosition(150, [{ x: anchor.x, y: anchor.y, minDistance: 72 }]);
  };
  stage.syllables.forEach((character, index) => {
    const letter = takePosition(190);
    letters.push({ x: letter.x, y: letter.y });
    const monster = takeNearbyPosition(letter);
    monsters.push({ id: `protected-monster-${index}`, x: monster.x, y: monster.y, protectedLetterIndex: index });
  });
  for (let index = 0; index < 3; index += 1) {
    const extra = takePosition(170);
    monsters.push({ id: `additional-monster-${index}`, x: extra.x, y: extra.y, protectedLetterIndex: null });
  }
  const layout = { nonce, letters, monsters };
  stageLayouts[key] = layout;
  persistStageLayouts();
  return layout;
}

function initializeStageEntities(stage, regenerate = false) {
  const layout = createStageLayout(stage, regenerate);
  letterItems = createLetterItems(stage.syllables, layout.letters);
  learningMonsters = layout.monsters.map((monster) => createLearningMonster(monster.id, monster.x, monster.y, monster.protectedLetterIndex));
  learningMonster = learningMonsters[0] || createLearningMonster('learning-monster-0', 1040, 1050);
}

function houseCollisionRects(x, y) {
  const doorGapLeft = x - 41;
  const doorGapRight = x + 41;
  return [
    // The roof is blocked as a single footprint above the body.
    { x: x - 100, y: y - 75, w: 200, h: 80, name: 'house roof' },
    // Side walls stay solid from the roof line to the bottom of the body.
    { x: x - 80, y, w: 14, h: 80, name: 'house left wall' },
    { x: x + 66, y, w: 14, h: 80, name: 'house right wall' },
    // Bottom wall is split around the visual 28px-wide door. The wider gap
    // accounts for the player's radius while keeping the door centered.
    { x: x - 80, y: y + 66, w: doorGapLeft - (x - 80), h: 14, name: 'house door wall left' },
    { x: doorGapRight, y: y + 66, w: (x + 80) - doorGapRight, h: 14, name: 'house door wall right' }
  ];
}

const houseLayouts = [
  { x: 1260, y: 480, name: 'right house' },
  { x: 430, y: 760, name: 'left house' }
];
const houseDoors = houseLayouts.map(({ x, y, name }) => ({ x, y: y + 55, name }));
const doorPassages = houseLayouts.map(({ x, y, name }) => ({
  x: x - 41, y: y + 28, w: 82, h: 64, name: `${name} door passage`
}));
const doorNotice = document.querySelector('#door-notice');
function updateDoorNotice() {
  const atDoor = houseDoors.some((door) => Math.hypot(player.x - door.x, player.y - door.y) < 52);
  doorNotice?.classList.toggle('is-visible', atDoor);
}

function resize() {
  const rect = shell.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function isEditableTarget(target) {
  return target instanceof HTMLElement && (target.matches('input, textarea, select, button') || target.isContentEditable);
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (isEditableTarget(event.target)) {
    keys.delete(key);
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) useBasicAttack();
    return;
  }
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) {
    event.preventDefault();
    keys.add(key);
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));

function setTouchFromEvent(event) {
  const rect = document.querySelector('#joystick').getBoundingClientRect();
  const touch = event.touches?.[0] || event;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const max = rect.width * 0.27;
  let dx = touch.clientX - cx; let dy = touch.clientY - cy;
  const length = Math.hypot(dx, dy);
  if (length > max) { dx = dx / length * max; dy = dy / length * max; }
  touchVector.x = dx / max; touchVector.y = dy / max;
  document.querySelector('.joy-stick').style.transform = `translate(${dx}px, ${dy}px)`;
}
const joystick = document.querySelector('#joystick');
joystick.addEventListener('pointerdown', (event) => { joystick.setPointerCapture(event.pointerId); setTouchFromEvent(event); });
joystick.addEventListener('pointermove', (event) => { if (event.buttons) setTouchFromEvent(event); });
joystick.addEventListener('pointerup', resetTouch);
joystick.addEventListener('pointercancel', resetTouch);
function resetTouch() { touchVector.x = 0; touchVector.y = 0; document.querySelector('.joy-stick').style.transform = ''; }

function direction() {
  let x = touchVector.x; let y = touchVector.y;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  const len = Math.hypot(x, y);
  return len ? { x: x / Math.max(1, len), y: y / Math.max(1, len) } : { x: 0, y: 0 };
}

function quantizeDirection(x, y) {
  if (!x && !y) return player.facingVector;
  const angle = Math.atan2(y, x);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return { x: Math.abs(Math.cos(snapped)) < .01 ? 0 : Math.sign(Math.cos(snapped)), y: Math.abs(Math.sin(snapped)) < .01 ? 0 : Math.sign(Math.sin(snapped)) };
}

function circleIntersectsRect(cx, cy, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return Math.hypot(cx - closestX, cy - closestY) <= radius;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function isBlockedByRiver(x, y) {
  const footY = y + player.footOffsetY;
  const onBridge = x >= bridgePassage.x && x <= bridgePassage.x + bridgePassage.w && footY >= bridgePassage.y && footY <= bridgePassage.y + bridgePassage.h;
  if (onBridge) return false;
  const riverCollisionRadius = RIVER_WATER_HALF_WIDTH + player.radius;
  return riverCenterline.slice(0, -1).some(([ax, ay], index) => {
    const [bx, by] = riverCenterline[index + 1];
    return distanceToSegment(x, footY, ax, ay, bx, by) <= riverCollisionRadius;
  });
}

function canMoveTo(x, y) {
  if (x < 45 || y < 45 || x > WORLD.width - 45 || y > WORLD.height - 45) return false;
  const footY = y + player.footOffsetY;
  const hitsNaturalObstacle = collisions.some((item) => Math.hypot(x - item.x, y - item.y) <= item.r + player.radius - 5);
  const hitsStaticObstacle = staticRects.some((rect) => {
    const testY = rect.name.startsWith('house') ? footY : y;
    return circleIntersectsRect(x, testY, player.radius, rect);
  });
  const hitsClosedDoor = !challenge.doorOpen && circleIntersectsRect(x, footY, player.radius, stageDoor);
  const hitsLearningMonster = learningMonsters.some((monster) => !monster.resolved && circleIntersectsRect(x, footY, player.radius, { x: monster.x - 40, y: monster.y - 35, w: 80, h: 70 }));
  return !hitsNaturalObstacle && !hitsStaticObstacle && !hitsClosedDoor && !hitsLearningMonster && !isBlockedByRiver(x, y);
}

function applyTrainingMonsterAttack() {
  if (learningMonster.resolved || automaticRest.active) return;
  const distance = Math.hypot(player.x - learningMonster.x, player.y + player.footOffsetY - learningMonster.y);
  if (distance > MONSTER_MELEE_RANGE) return;
  combat.lastDamageAt = performance.now();
  combat.recoveryElapsed = 0;
  if (consumeCombatShield()) return;
  combat.current = Math.max(0, combat.current - 1);
  updateCombatHud();
  if (combat.current === 0) startAutomaticRest('combat');
  else showNotice('몬스터의 공격을 피했어요? 전투 체력이 줄었어요.', 1600);
}

function updateCombatRecovery(delta) {
  if (combat.current >= combat.max) {
    combat.recoveryElapsed = 0;
    return;
  }
  const now = performance.now();
  if (!combat.inCombat || now - combat.lastDamageAt >= MONSTER_COMBAT_IDLE_DURATION) {
    combat.inCombat = false;
    combat.recoveryElapsed += delta;
    if (combat.recoveryElapsed >= COMBAT_HP_RECOVERY_INTERVAL) {
      combat.current = Math.min(combat.max, combat.current + 1);
      combat.recoveryElapsed = 0;
      updateCombatHud();
      showNotice('전투 체력이 1칸 회복되었어요.', 1400);
    }
  } else {
    combat.recoveryElapsed = 0;
  }
}

function updateTrainingMonster() {
  if (learningMonster.resolved || automaticRest.active || restState.promptOpen || !restartPrompt.hidden || monsterQuizOpen) return;
  const now = performance.now();
  const distance = Math.hypot(player.x - learningMonster.x, player.y + player.footOffsetY - learningMonster.y);
  if (distance > MONSTER_DETECTION_RANGE) {
    learningMonster.outOfRangeSince ||= now;
    if (now - learningMonster.outOfRangeSince >= MONSTER_COMBAT_IDLE_DURATION) disengageTrainingMonster();
    return;
  }
  learningMonster.outOfRangeSince = 0;
  learningMonster.recoveryElapsed = 0;
  if (learningMonster.state === 'idle' && distance <= MONSTER_DETECTION_RANGE && now >= learningMonster.nextAttackAt) {
    learningMonster.state = 'warning';
    learningMonster.warningUntil = now + MONSTER_WARNING_DURATION;
    learningMonster.nextAttackAt = learningMonster.warningUntil;
    combat.inCombat = true;
    combat.lastDamageAt = now;
    playCombatSound('warning');
    showNotice('느낌표! 훈련 몬스터가 공격을 준비해요.', 1500);
  }
  if (learningMonster.state === 'warning' && now >= learningMonster.warningUntil) {
    learningMonster.state = 'attack';
    learningMonster.attackActiveUntil = now + 320;
    learningMonster.attackToken += 1;
    applyTrainingMonsterAttack();
  }
  if (learningMonster.state === 'attack' && now >= learningMonster.attackActiveUntil) {
    learningMonster.state = 'idle';
    learningMonster.nextAttackAt = now + MONSTER_ATTACK_INTERVAL;
  }
  if (learningMonster.state === 'idle' && learningMonster.nextAttackAt && now < learningMonster.nextAttackAt) return;
}

function updateTrainingMonsterRecovery(delta) {
  if (learningMonster.resolved || learningMonster.hp >= learningMonster.maxHp) {
    learningMonster.recoveryElapsed = 0;
    return;
  }
  const now = performance.now();
  const resting = automaticRest.active;
  const outOfRange = learningMonster.outOfRangeSince && now - learningMonster.outOfRangeSince >= MONSTER_COMBAT_IDLE_DURATION;
  if (!resting && !outOfRange) {
    learningMonster.recoveryElapsed = 0;
    return;
  }
  learningMonster.state = 'idle';
  learningMonster.warningUntil = 0;
  learningMonster.attackActiveUntil = 0;
  learningMonster.recoveryElapsed += delta;
  while (learningMonster.recoveryElapsed >= MONSTER_HP_RECOVERY_INTERVAL && learningMonster.hp < learningMonster.maxHp) {
    learningMonster.hp = Math.min(learningMonster.maxHp, learningMonster.hp + 1);
    learningMonster.recoveryElapsed -= MONSTER_HP_RECOVERY_INTERVAL;
  }
}

function drawLearningMonster() {
  const now = performance.now();
  const wobble = learningMonster.resolved ? 0 : Math.sin(now / 420) * 2;
  const x = learningMonster.x; const y = learningMonster.y + wobble;
  const near = Math.hypot(player.x - learningMonster.x, player.y + player.footOffsetY - learningMonster.y) < MONSTER_DETECTION_RANGE;
  ctx.save();
  if (learningMonster.resolved) {
    ctx.globalAlpha = .65 + Math.sin(now / 160) * .2;
    ctx.fillStyle = '#fff2a1';
    ctx.beginPath(); ctx.arc(x, y, 38 + Math.sin(now / 180) * 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffbe1';
    ctx.beginPath(); ctx.arc(x, y - 4, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d29b55';
    ctx.font = 'bold 15px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('빛의 친구', x, y + 59);
    ctx.restore();
    return;
  }
  if (near && energy.current > 0 && !automaticRest.active) {
    ctx.fillStyle = learningMonster.state === 'warning' || learningMonster.state === 'attack'
      ? 'rgba(255, 111, 98, .26)' : 'rgba(255, 222, 104, .24)';
    ctx.beginPath(); ctx.arc(x, y, 55 + Math.sin(now / 180) * 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(61, 98, 73, .18)';
  ctx.beginPath(); ctx.ellipse(x, y + 38, 42, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = learningMonster.state === 'attack' ? '#e79b8f' : '#91c5a0';
  ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c9e8b9';
  ctx.beginPath(); ctx.arc(x, y - 4, 27, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4f775b';
  ctx.beginPath(); ctx.arc(x - 10, y - 5, 4, 0, Math.PI * 2); ctx.arc(x + 10, y - 5, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4f775b'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y + 5, 10, 0, Math.PI); ctx.stroke();
  ctx.strokeStyle = '#6d9b74'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x - 15, y - 29); ctx.lineTo(x - 23, y - 48); ctx.moveTo(x + 15, y - 29); ctx.lineTo(x + 23, y - 48); ctx.stroke();
  ctx.fillStyle = '#f0bd62';
  ctx.beginPath(); ctx.arc(x - 24, y - 51, 6, 0, Math.PI * 2); ctx.arc(x + 24, y - 51, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5b8562';
  ctx.font = 'bold 15px Jua, "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'center'; ctx.fillText('훈련 몬스터', x, y + 59);
  const hpWidth = 86;
  for (let index = 0; index < learningMonster.maxHp; index += 1) {
    ctx.fillStyle = index < learningMonster.hp ? '#e96f72' : '#e5d9d2';
    ctx.fillRect(x - hpWidth / 2 + index * 30, y - 75, 24, 7);
  }
  if (learningMonster.state === 'warning') {
    ctx.fillStyle = '#f36f68';
    ctx.font = 'bold 28px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.fillText('!', x, y - 88 - Math.sin(now / 100) * 5);
  }
  ctx.restore();
}

function drawTreasureChest() {
  const footY = player.y + player.footOffsetY;
  const distance = Math.hypot(player.x - treasureChest.x, footY - treasureChest.y);
  const near = distance < 125 && !treasureChest.opened && energy.current > 0 && !automaticRest.active;
  ctx.save();
  if (near) {
    ctx.fillStyle = 'rgba(255, 222, 104, .3)';
    ctx.beginPath(); ctx.arc(treasureChest.x, treasureChest.y - 3, 52 + Math.sin(treasureChest.sparkle * 5) * 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(61, 98, 73, .2)';
  ctx.beginPath(); ctx.ellipse(treasureChest.x, treasureChest.y + 28, 42, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(treasureChest.x, treasureChest.y);
  ctx.fillStyle = '#a96d3e';
  roundedRect(-34, -2, 68, 35, 8); ctx.fill();
  ctx.strokeStyle = '#70482f'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#d79048';
  if (treasureChest.opened) {
    ctx.save(); ctx.rotate(-.18); roundedRect(-34, -34, 68, 23, 8); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#ffe48c'; ctx.beginPath(); ctx.arc(0, 8, 22, 0, Math.PI * 2); ctx.fill();
  } else {
    roundedRect(-34, -24, 68, 27, 8); ctx.fill();
    ctx.fillStyle = '#f2c75b'; roundedRect(-7, 3, 14, 14, 4); ctx.fill();
  }
  ctx.fillStyle = '#fff4b0';
  ctx.font = 'bold 14px Jua, "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(treasureChest.opened ? '열림' : '보물', 0, 54);
  ctx.restore();
}

function drawMonsterReward(item) {
  if (!item.active || item.collected) return;
  const now = performance.now();
  item.sparkle += .016;
  const pulse = 1 + Math.sin(now / 180) * .08;
  const isSyllable = item.type === 'syllable';
  const isMpPotion = item.type === 'mpPotion';
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = isSyllable ? 'rgba(255, 221, 91, .28)' : isMpPotion ? 'rgba(91, 166, 239, .28)' : 'rgba(240, 113, 102, .28)';
  ctx.beginPath(); ctx.arc(0, 0, 48 + Math.sin(now / 150) * 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = isSyllable ? '#fff4a2' : isMpPotion ? '#bde4ff' : '#ffd0c2';
  for (let index = 0; index < 6; index += 1) {
    const angle = index * Math.PI / 3 + now / 450;
    const radius = 37 + Math.sin(now / 130 + index) * 4;
    ctx.beginPath(); ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = isSyllable ? '#fff8c7' : isMpPotion ? '#d8f0ff' : '#ffe2d7';
  ctx.strokeStyle = isSyllable ? '#e3a841' : isMpPotion ? '#4d8dcc' : '#df775e';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(0, 0, 35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = isSyllable ? '#d56f59' : isMpPotion ? '#397bb7' : '#d85f63';
  ctx.font = `bold ${isSyllable ? 40 : 27}px Jua, "Apple SD Gothic Neo", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(isSyllable ? item.character : isMpPotion ? 'MP' : '♥', 0, 2);
  ctx.fillStyle = '#c47b45';
  ctx.font = 'bold 14px Jua, "Apple SD Gothic Neo", sans-serif';
  ctx.fillText(isSyllable ? '보상 음절' : isMpPotion ? 'MP 물약' : '체력 물약', 0, 61);
  ctx.restore();
}

function drawLetterItem(item) {
  const now = performance.now();
  const footY = player.y + player.footOffsetY;
  const distance = Math.hypot(player.x - item.x, footY - item.y);
  const isNeeded = item.character === activeStage.syllables[collectedLetters.length];
  const isLocked = Boolean(item.protectedMonsterId && !item.unlocked);
  const isNeededNear = isNeeded && !isLocked && distance < 125;
  const isSkillFocused = item.id === skillState.focusItemId && now < skillState.focusUntil;
  const wobbleOffset = item.wobble ? Math.sin(now / 38) * item.wobble * 7 : 0;
  const pulse = 1 + Math.sin(now / 240 + item.x) * 0.06;
  ctx.save();
  ctx.translate(item.x + wobbleOffset, item.y);
  if (isLocked) {
    ctx.fillStyle = 'rgba(161, 186, 211, .28)';
    ctx.beginPath(); ctx.arc(0, 0, 43 + Math.sin(now / 180) * 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6d8da6';
    ctx.font = 'bold 15px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('잠김', 0, -48);
  } else if (isNeededNear || isSkillFocused) {
    ctx.fillStyle = isSkillFocused ? 'rgba(255, 219, 91, .5)' : isNeededNear ? 'rgba(255, 223, 103, .34)' : 'rgba(194, 208, 238, .24)';
    ctx.beginPath(); ctx.arc(0, 0, 43 + Math.sin(now / 180) * 5, 0, Math.PI * 2); ctx.fill();
  }
  if (isSkillFocused) {
    const shimmer = 0.22 + Math.sin(now / 110) * 0.08;
    const pillar = ctx.createLinearGradient(0, -170, 0, 8);
    pillar.addColorStop(0, 'rgba(255, 239, 133, 0)');
    pillar.addColorStop(.5, `rgba(255, 224, 91, ${shimmer})`);
    pillar.addColorStop(1, 'rgba(255, 239, 133, 0)');
    ctx.fillStyle = pillar;
    ctx.fillRect(-24, -170, 48, 178);
    ctx.fillStyle = '#efb44f';
    ctx.font = 'bold 17px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('여기예요!', 0, -52 - Math.sin(now / 170) * 5);
    ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(-7, -45); ctx.lineTo(7, -45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff1a2';
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4 + now / 500;
      const radius = 34 + (index % 2) * 10 + Math.sin(now / 140 + index) * 4;
      ctx.beginPath(); ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius - 10, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.scale(pulse, pulse);
  ctx.fillStyle = 'rgba(61, 98, 73, .18)';
  ctx.beginPath(); ctx.ellipse(0, 29, 31, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = isLocked ? '#dce7ed' : SYLLABLE_COLORS.fill;
  ctx.strokeStyle = isLocked ? '#9db9c9' : SYLLABLE_COLORS.border;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, 29, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = isLocked ? '#6d8da6' : SYLLABLE_COLORS.text;
  ctx.font = 'bold 34px Jua, "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(item.character, 0, 2);
  ctx.restore();
}

function drawPickupEffects() {
  pickupEffects.forEach((effect) => {
    const progress = 1 - effect.life;
    ctx.save();
    ctx.globalAlpha = Math.max(0, effect.life);
    ctx.fillStyle = '#fff4a5';
    ctx.font = 'bold 25px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`+ ${effect.character}`, effect.x, effect.y - 35 - progress * 38);
    for (let i = 0; i < 4; i += 1) {
      const angle = i * Math.PI / 2 + progress;
      ctx.beginPath();
      ctx.arc(effect.x + Math.cos(angle) * (20 + progress * 22), effect.y - 8 - progress * 28 + Math.sin(angle) * (12 + progress * 12), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
  if (successEffect) {
    const progress = 1 - successEffect.life / 2.4;
    ctx.save();
    ctx.globalAlpha = Math.max(0, successEffect.life / 2.4);
    ctx.fillStyle = '#fff1a2';
    ctx.font = 'bold 30px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${activeStageWord()} 완성!`, successEffect.x, successEffect.y - 48 - progress * 28);
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4 + progress;
      ctx.beginPath();
      ctx.arc(successEffect.x + Math.cos(angle) * (26 + progress * 35), successEffect.y - 20 + Math.sin(angle) * (18 + progress * 26), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  if (recoveryEffect) {
    const progress = 1 - recoveryEffect.life / 2;
    ctx.save();
    ctx.globalAlpha = Math.max(0, recoveryEffect.life / 2);
    ctx.fillStyle = '#fff2a6';
    ctx.font = 'bold 25px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('회복!', recoveryEffect.x, recoveryEffect.y - 28 - progress * 24);
    for (let i = 0; i < 6; i += 1) {
      const angle = i * Math.PI / 3 + progress;
      ctx.beginPath();
      ctx.arc(recoveryEffect.x + Math.cos(angle) * (22 + progress * 28), recoveryEffect.y - 2 + Math.sin(angle) * (14 + progress * 18), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawCombatAttacks() {
  const now = performance.now();
  attackState.projectiles.forEach((projectile) => {
    const angle = Math.atan2(projectile.vy, projectile.vx);
    ctx.save();
    ctx.translate(projectile.x, projectile.y);
    ctx.rotate(angle);
    ctx.globalAlpha = Math.max(0, projectile.life / projectile.maxLife);
    if (projectile.type === 'arrow') {
      ctx.strokeStyle = '#ffe38a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(16, 0); ctx.stroke();
      ctx.fillStyle = '#fff6bc'; ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(10, -7); ctx.lineTo(10, 7); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = '#e9c9ff';
      ctx.shadowColor = '#fff1a6'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff9db'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  });
  attackState.effects.forEach((effect) => {
    const progress = 1 - effect.life / effect.maxLife;
    const alpha = Math.max(0, effect.life / effect.maxLife);
    ctx.save(); ctx.globalAlpha = alpha;
    if (effect.type === 'defeat') {
      ctx.fillStyle = '#fff2a1'; ctx.strokeStyle = '#fff9d7'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(effect.x, effect.y, 20 + progress * 80, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (effect.type === 'slash') {
      ctx.translate(effect.x, effect.y);
      ctx.rotate(Math.atan2(effect.direction.y, effect.direction.x));
      ctx.strokeStyle = '#fff0a0'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(0, 0, 43 + progress * 20, -.65, .65); ctx.stroke();
    } else {
      ctx.fillStyle = effect.type === 'cast' ? '#f4d9ff' : '#fff1a2';
      ctx.beginPath(); ctx.arc(effect.x, effect.y, 12 + progress * 16, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  });
  learningMonsters.forEach((monster) => {
    if (monster.state !== 'attack' || now >= monster.attackActiveUntil) return;
    ctx.save(); ctx.strokeStyle = 'rgba(244, 111, 104, .72)'; ctx.lineWidth = 5; ctx.setLineDash([8, 7]);
    ctx.beginPath(); ctx.moveTo(monster.x, monster.y); ctx.lineTo(player.x, player.y + player.footOffsetY); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  });
}

function drawRestArea() {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, .26)';
  ctx.beginPath(); ctx.ellipse(restArea.xCenter, restArea.yCenter + 14, 54, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f3c7d0';
  ctx.font = 'bold 22px Jua, "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'center'; ctx.fillText('♥', restArea.xCenter, restArea.yCenter + 7);
  ctx.fillStyle = '#6a8d75';
  ctx.font = 'bold 14px Jua, "Apple SD Gothic Neo", sans-serif';
  ctx.fillText('휴식', restArea.xCenter, restArea.yCenter + 35);
  ctx.restore();
}

function drawStageDoor() {
  ctx.save();
  ctx.fillStyle = 'rgba(61, 98, 73, .2)';
  ctx.beginPath(); ctx.ellipse(stageDoor.xCenter, stageDoor.y + 34, 76, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8b654b';
  roundedRect(stageDoor.x - 9, stageDoor.y - 21, 18, 62, 8); ctx.fill();
  roundedRect(stageDoor.x + stageDoor.w - 9, stageDoor.y - 21, 18, 62, 8); ctx.fill();
  if (challenge.doorOpen) {
    ctx.fillStyle = 'rgba(247, 201, 91, .24)';
    ctx.beginPath(); ctx.arc(stageDoor.xCenter, stageDoor.y + 2, 44, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e9bb58';
    ctx.font = 'bold 18px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('열림', stageDoor.xCenter, stageDoor.y - 30);
  } else {
    ctx.fillStyle = '#d98569';
    roundedRect(stageDoor.x, stageDoor.y, stageDoor.w, stageDoor.h, 7); ctx.fill();
    ctx.fillStyle = '#fff1c1';
    ctx.font = 'bold 17px Jua, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('닫힌 문', stageDoor.xCenter, stageDoor.y + 20);
  }
  ctx.restore();
}

function closeNextStagePrompt() {
  stageTransition.promptOpen = false;
  stageTransition.mode = null;
  stageTransition.nextStage = null;
  nextStagePrompt.hidden = true;
  nextStageYesButton.hidden = false;
  nextStageNoButton.textContent = '아니요';
}

function openNextStagePrompt() {
  const nextStageNumber = activeStage.stageNumber + 1;
  const nextStage = teacherStages.find((stage) => stage.stageNumber === nextStageNumber);
  const isReady = nextStage && !nextStage.locked && nextStage.displayWord && nextStage.syllables.length;
  if (!isReady) {
    stageTransition.mode = 'unprepared';
    stageTransition.nextStage = null;
    stageTransition.promptOpen = true;
    nextStageTitle.textContent = '다음 스테이지 안내';
    nextStageMessage.textContent = '다음 스테이지가 아직 준비되지 않았어요.';
    nextStageYesButton.hidden = true;
    nextStageNoButton.textContent = '확인';
  } else {
    stageTransition.mode = 'confirm';
    stageTransition.nextStage = nextStage;
    stageTransition.promptOpen = true;
    nextStageTitle.textContent = `${nextStageNumber}스테이지로 넘어가시겠습니까?`;
    nextStageMessage.textContent = `${nextStage.displayWord} 스테이지를 시작하면 현재 스테이지의 진행은 완료 상태로 저장돼요.`;
    nextStageYesButton.hidden = false;
    nextStageNoButton.textContent = '아니요';
  }
  nextStagePrompt.hidden = false;
  (stageTransition.mode === 'confirm' ? nextStageYesButton : nextStageNoButton).focus();
}

function showFinalCompletion() {
  challenge.doorPassed = true;
  successOverlay.hidden = false;
  document.querySelector('#success-title').textContent = '모든 스테이지를 완료했어요!';
  successMessageEl.textContent = '모든 스테이지를 완료했어요!';
}

function confirmNextStage() {
  if (!stageTransition.promptOpen || stageTransition.mode !== 'confirm' || !stageTransition.nextStage) return;
  const nextStage = stageTransition.nextStage;
  const nextStageRecord = teacherStages.find((stage) => stage.id === nextStage.id);
  if (!nextStageRecord || nextStageRecord.locked || !nextStageRecord.displayWord || !nextStageRecord.syllables.length) {
    closeNextStagePrompt();
    stageTransition.dismissedAtDoor = true;
    openNextStagePrompt();
    return;
  }
  teacherStages.forEach((stage) => { stage.active = stage.id === nextStageRecord.id; });
  nextStageRecord.locked = false;
  persistTeacherStages();
  closeNextStagePrompt();
  stageTransition.dismissedAtDoor = false;
  applyStage(nextStageRecord);
}

function declineNextStage() {
  if (!stageTransition.promptOpen) return;
  closeNextStagePrompt();
  challenge.doorPassed = false;
  stageTransition.dismissedAtDoor = true;
}

function checkDoorPassage() {
  if (!challenge.doorOpen || challenge.doorPassed || stageTransition.promptOpen) return;
  const footY = player.y + player.footOffsetY;
  const crossedDoor = circleIntersectsRect(player.x, footY, player.radius, stageDoor) && footY < stageDoor.y + stageDoor.h / 2;
  if (!crossedDoor) {
    stageTransition.dismissedAtDoor = false;
    return;
  }
  if (stageTransition.dismissedAtDoor) return;
  const nextStage = teacherStages.find((stage) => stage.stageNumber === activeStage.stageNumber + 1);
  if (!nextStage) {
    showFinalCompletion();
    return;
  }
  challenge.doorPassed = true;
  openNextStagePrompt();
}

function resetChallenge({ regenerateLayout = true } = {}) {
  if (regenerateLayout) initializeStageEntities(activeStage, true);
  const savedStage = teacherStages.find((stage) => stage.id === activeStage.id);
  if (savedStage?.completed) {
    savedStage.completed = false;
    persistTeacherStages();
  }
  letterItems.forEach((item) => { item.collected = false; item.disabled = false; item.unlocked = false; item.wobble = 0; });
  monsterReward.active = false;
  monsterReward.collected = false;
  monsterReward.dropped = false;
  monsterReward.wobble = 0;
  monsterReward.sparkle = 0;
  monsterReward.type = 'syllable';
  monsterReward.character = '사';
  rewardState.nonSyllableStreak = 0;
  collectedLetters.length = 0;
  pickupEffects.length = 0;
  wrongContact.touchingItemId = null;
  wrongContact.shieldUntil = 0;
  wrongContact.moveLockUntil = 0;
  window.clearTimeout(monsterUnlockTimer);
  monsterAnswerCooldownUntil = 0;
  setMonsterChoicesDisabled(false);
  monsterQuizOpen = false;
  monsterOverlay.hidden = true;
  automaticRest.active = false;
  automaticRest.elapsed = 0;
  automaticRest.lastSecond = 5;
  automaticRest.reason = 'energy';
  closeRestPrompt();
  restState.promptDismissed = false;
  restCountdown.hidden = true;
  restCountdownNumber.textContent = '5';
  treasureChest.opened = false;
  treasureChest.sparkle = 0;
  learningMonsters.forEach((monster) => {
    learningMonster = monster;
    learningMonster.resolved = false;
    learningMonster.wobble = 0;
    learningMonster.hp = learningMonster.maxHp;
    learningMonster.state = 'idle';
    learningMonster.warningUntil = 0;
    learningMonster.nextAttackAt = 0;
    learningMonster.attackActiveUntil = 0;
    learningMonster.attackToken = 0;
    learningMonster.defeatStartedAt = 0;
    learningMonster.quizResolved = false;
    learningMonster.outOfRangeSince = 0;
    learningMonster.recoveryElapsed = 0;
  });
  learningMonster = learningMonsters[0] || learningMonster;
  attackState.cooldownUntil = 0;
  attackState.projectiles.length = 0;
  attackState.effects.length = 0;
  combat.current = combat.max;
  automaticRest.reason = 'energy';
  monsterQuizOpen = false;
  monsterOverlay.hidden = true;
  monsterFeedback.textContent = '';
  hintOverlay.hidden = true;
  hintCurrentEl.textContent = currentHintMessage();
  nextLetterEl.classList.remove('is-highlighted');
  resetSkillState();
  energy.current = MAX_ENERGY;
  combat.current = combat.max;
  combat.inCombat = false;
  combat.lastDamageAt = 0;
  combat.recoveryElapsed = 0;
  mp.current = currentMPSettings().max;
  mp.recoveryElapsed = 0;
  mp.saveElapsed = 0;
  persistMPState();
  updateMPHud();
  recoveryEffect = null;
  restState.inside = false;
  restState.elapsed = 0;
  restState.recovered = false;
  restState.noticeShown = false;
  successEffect = null;
  closeNextStagePrompt();
  stageTransition.dismissedAtDoor = false;
  challenge.status = 'collecting';
  challenge.doorOpen = false;
  challenge.doorPassed = false;
  player.x = 1200; player.y = 805;
  camera.x = 0; camera.y = 0;
  successOverlay.hidden = true;
  letterNotice.classList.remove('is-visible');
  updateCollectionHud();
}

retryCollectButton.addEventListener('click', resetChallenge);
retryButton.addEventListener('click', resetChallenge);
nextStageYesButton.addEventListener('click', confirmNextStage);
nextStageNoButton.addEventListener('click', declineNextStage);

function drawCollisionDebug() {
  if (!DEBUG_COLLISIONS) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(riverCenterline[0][0], riverCenterline[0][1]);
  riverCenterline.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.strokeStyle = 'rgba(232, 76, 76, .28)';
  ctx.lineWidth = (RIVER_WATER_HALF_WIDTH + player.radius) * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = 'rgba(69, 196, 108, .34)';
  ctx.strokeStyle = 'rgba(31, 133, 69, .9)';
  ctx.lineWidth = 2;
  ctx.fillRect(bridgePassage.x, bridgePassage.y, bridgePassage.w, bridgePassage.h);
  ctx.strokeRect(bridgePassage.x, bridgePassage.y, bridgePassage.w, bridgePassage.h);
  staticRects.filter((rect) => rect.name.startsWith('house')).forEach((rect) => {
    ctx.fillStyle = 'rgba(232, 76, 76, .28)';
    ctx.strokeStyle = 'rgba(183, 35, 35, .8)';
    ctx.lineWidth = 2;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  });
  doorPassages.forEach((door) => {
    ctx.fillStyle = 'rgba(69, 196, 108, .34)';
    ctx.strokeStyle = 'rgba(31, 133, 69, .9)';
    ctx.fillRect(door.x, door.y, door.w, door.h);
    ctx.strokeRect(door.x, door.y, door.w, door.h);
  });
  const rightDoor = houseDoors.find((door) => door.name === 'right house');
  ctx.fillStyle = '#1d6f3b';
  ctx.beginPath(); ctx.arc(rightDoor.x, rightDoor.y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#253b30';
  ctx.beginPath(); ctx.arc(player.x, player.y + player.footOffsetY, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function update(delta) {
  if (!gameStarted) return;
  if (energy.current === 0 && !automaticRest.active) startAutomaticRest();
  updateAutomaticRest(delta);
  updateMPRecovery(delta);
  updateCombatRecovery(delta);
  const now = performance.now();
  updateSkillHud(now);
  learningMonsters.forEach((monster) => {
    learningMonster = monster;
    updateTrainingMonster();
    updateTrainingMonsterRecovery(delta);
  });
  learningMonster = learningMonsters[0] || learningMonster;
  const movementLocked = monsterQuizOpen || automaticRest.active || stageTransition.promptOpen || !restartPrompt.hidden || energy.current === 0 || now < wrongContact.moveLockUntil;
  const dir = movementLocked ? { x: 0, y: 0 } : direction();
  if (dir.x || dir.y) {
    const nextX = player.x + dir.x * player.speed * delta;
    const nextY = player.y + dir.y * player.speed * delta;
    if (canMoveTo(nextX, player.y)) player.x = nextX;
    if (canMoveTo(player.x, nextY)) player.y = nextY;
    player.bob += delta * 9;
    player.facingVector = quantizeDirection(dir.x, dir.y);
    if (Math.abs(dir.x) > Math.abs(dir.y)) player.facing = dir.x > 0 ? 'right' : 'left';
    else player.facing = dir.y > 0 ? 'down' : 'up';
  } else player.bob *= 0.85;
  if (!automaticRest.active && energy.current > 0) collectNearbyLetter();
  checkTreasureChest();
  if (challenge.status === 'complete' && !challenge.doorOpen) completeWord();
  checkMonsterProximity();
  if (!automaticRest.active && energy.current > 0) updateRestZone(delta);
  updatePickupEffects(delta);
  updateBasicAttacks(delta);
  checkDoorPassage();
  updateDoorNotice();
  updateFieldRegion();
  const viewW = shell.clientWidth; const viewH = shell.clientHeight;
  camera.x += (player.x - viewW / 2 - camera.x) * Math.min(1, delta * 7);
  camera.y += (player.y - viewH / 2 - camera.y) * Math.min(1, delta * 7);
  camera.x = Math.max(0, Math.min(WORLD.width - viewW, camera.x));
  camera.y = Math.max(0, Math.min(WORLD.height - viewH, camera.y));
}

function roundedRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function drawWorld() {
  const w = shell.clientWidth; const h = shell.clientHeight;
  clearArcherSkillFocusIfOutOfRange(performance.now());
  ctx.clearRect(0, 0, w, h);
  ctx.save(); ctx.translate(-camera.x, -camera.y);
  ctx.fillStyle = '#bde6b7'; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  // gentle grass tiles
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  for (let x = 0; x < WORLD.width; x += 80) for (let y = 0; y < WORLD.height; y += 80) {
    if ((x / 80 + y / 80) % 3 === 0) ctx.fillRect(x + 13, y + 17, 3, 3);
  }
  // winding paths and central plaza
  ctx.strokeStyle = '#ead9a3'; ctx.lineCap = 'round'; ctx.lineWidth = 112;
  ctx.beginPath(); ctx.moveTo(-100, 780); ctx.bezierCurveTo(520, 740, 760, 840, 1180, 790); ctx.bezierCurveTo(1560, 745, 1840, 820, 2500, 700); ctx.stroke();
  ctx.lineWidth = 86; ctx.beginPath(); ctx.moveTo(1200, -100); ctx.bezierCurveTo(1190, 380, 1240, 580, 1200, 790); ctx.bezierCurveTo(1140, 1060, 1300, 1240, 1350, 1700); ctx.stroke();
  ctx.fillStyle = '#f6e8b9'; ctx.beginPath(); ctx.ellipse(1200, 790, 220, 150, 0, 0, Math.PI * 2); ctx.fill();
  // bridge stream
  ctx.strokeStyle = '#83cfe0'; ctx.lineWidth = 44; ctx.beginPath(); ctx.moveTo(1830, -50); ctx.bezierCurveTo(1810, 350, 1900, 610, 1810, 920); ctx.bezierCurveTo(1730, 1160, 1840, 1430, 1780, 1700); ctx.stroke();
  ctx.strokeStyle = '#c6ebec'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(1815, -50); ctx.bezierCurveTo(1795, 350, 1885, 610, 1795, 920); ctx.bezierCurveTo(1715, 1160, 1825, 1430, 1765, 1700); ctx.stroke();
  drawFieldRegions();
  drawHouse(1260, 480); drawHouse(430, 760); drawRestArea(); drawSign(1090, 720); drawStageDoor();
  learningMonsters.forEach((monster) => { learningMonster = monster; drawLearningMonster(); });
  learningMonster = learningMonsters[0] || learningMonster;
  flowers.forEach(([x, y], i) => drawFlower(x, y, i % 2 ? '#fff4a8' : '#f39c9e'));
  fences.forEach(([x, y]) => drawFence(x, y));
  trees.forEach(([x, y]) => drawTree(x, y)); rocks.forEach(([x, y]) => drawRock(x, y));
  drawTreasureChest();
  availableLetterItems().filter((item) => item.source !== 'monster-reward' && !item.collected).forEach(drawLetterItem);
  drawMonsterReward(monsterReward);
  drawCombatAttacks();
  drawPickupEffects();
  drawPlayer();
  drawCollisionDebug();
  ctx.restore();
  drawArcherSkillOverlay();
}

function drawArcherSkillOverlay() {
  const now = performance.now();
  clearArcherSkillFocusIfOutOfRange(now);
  if (profile.character !== 'archer' || now >= skillState.arrowUntil || !skillState.focusItemId) return;
  const target = availableLetterItems().find((item) => item.id === skillState.focusItemId && !item.collected);
  if (!target) return;
  const w = shell.clientWidth; const h = shell.clientHeight;
  const startX = player.x - camera.x; const startY = player.y - camera.y;
  const rawX = target.x - camera.x; const rawY = target.y - camera.y;
  const margin = 34;
  const targetX = Math.max(margin, Math.min(w - margin, rawX));
  const targetY = Math.max(margin, Math.min(h - margin, rawY));
  ctx.save();
  ctx.strokeStyle = 'rgba(239, 180, 79, .85)';
  ctx.lineWidth = 4; ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(targetX, targetY); ctx.stroke();
  ctx.setLineDash([]);
  const angle = Math.atan2(targetY - startY, targetX - startX);
  ctx.fillStyle = '#efb44f';
  ctx.beginPath();
  ctx.moveTo(targetX, targetY);
  ctx.lineTo(targetX - Math.cos(angle - .5) * 18, targetY - Math.sin(angle - .5) * 18);
  ctx.lineTo(targetX - Math.cos(angle + .5) * 18, targetY - Math.sin(angle + .5) * 18);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 227, 107, .95)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(targetX, targetY, 23 + Math.sin(performance.now() / 120) * 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
function drawTree(x, y) {
  ctx.fillStyle = 'rgba(55,100,62,.18)'; ctx.beginPath(); ctx.ellipse(x, y + 32, 49, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#936746'; roundedRect(x - 9, y + 2, 18, 45, 7); ctx.fill();
  ctx.fillStyle = '#4c9c64'; ctx.beginPath(); ctx.arc(x - 22, y - 5, 29, 0, Math.PI * 2); ctx.arc(x + 18, y - 4, 32, 0, Math.PI * 2); ctx.arc(x, y - 28, 36, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7acb7b'; ctx.beginPath(); ctx.arc(x - 11, y - 34, 13, 0, Math.PI * 2); ctx.arc(x + 20, y - 12, 10, 0, Math.PI * 2); ctx.fill();
}
function drawRock(x, y) { ctx.fillStyle = 'rgba(55,100,62,.16)'; ctx.beginPath(); ctx.ellipse(x, y + 15, 30, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#9aa9a6'; ctx.beginPath(); ctx.moveTo(x - 27, y + 12); ctx.lineTo(x - 18, y - 13); ctx.lineTo(x + 5, y - 24); ctx.lineTo(x + 28, y - 4); ctx.lineTo(x + 23, y + 15); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#c7d2cc'; ctx.beginPath(); ctx.moveTo(x - 13, y - 12); ctx.lineTo(x + 4, y - 18); ctx.lineTo(x + 13, y - 5); ctx.lineTo(x - 6, y - 2); ctx.closePath(); ctx.fill(); }
function drawFlower(x, y, color) { ctx.strokeStyle = '#4d9a5c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x, y - 2); ctx.stroke(); ctx.fillStyle = color; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 6, y - 4 + Math.sin(a) * 6, 5, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = '#f5c84c'; ctx.beginPath(); ctx.arc(x, y - 4, 3, 0, Math.PI * 2); ctx.fill(); }
function drawFence(x, y) { ctx.strokeStyle = '#b57c4a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x, y - 23); ctx.lineTo(x, y + 20); ctx.moveTo(x + 36, y - 23); ctx.lineTo(x + 36, y + 20); ctx.moveTo(x - 4, y - 8); ctx.lineTo(x + 40, y - 8); ctx.moveTo(x - 4, y + 9); ctx.lineTo(x + 40, y + 9); ctx.stroke(); }
function drawHouse(x, y) { ctx.fillStyle = 'rgba(55,100,62,.18)'; ctx.beginPath(); ctx.ellipse(x + 8, y + 75, 100, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff8d9'; roundedRect(x - 80, y, 160, 80, 14); ctx.fill(); ctx.fillStyle = '#e9876e'; ctx.beginPath(); ctx.moveTo(x - 100, y + 5); ctx.lineTo(x, y - 75); ctx.lineTo(x + 100, y + 5); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#8cc7d5'; roundedRect(x - 55, y + 22, 32, 28, 6); ctx.fill(); roundedRect(x + 23, y + 22, 32, 28, 6); ctx.fill(); ctx.fillStyle = '#9a6b55'; roundedRect(x - 14, y + 30, 28, 50, 6); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('작은 집', x, y + 108); }
function drawSign(x, y) { ctx.fillStyle = '#8f603f'; ctx.fillRect(x - 5, y, 10, 70); ctx.fillStyle = '#f6c86e'; roundedRect(x - 70, y - 40, 140, 50, 12); ctx.fill(); ctx.fillStyle = '#694d3e'; ctx.font = 'bold 19px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('반짝숲 마을', x, y - 8); }
function drawPlayer() {
  const preset = CHARACTER_PRESETS[profile.character];
  const bounce = Math.sin(player.bob) * (direction().x || direction().y ? 3 : 0);
  const x = player.x; const y = player.y + bounce;
  ctx.fillStyle = 'rgba(50,80,60,.2)'; ctx.beginPath(); ctx.ellipse(x, y + 30, 29, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = preset.body; roundedRect(x - 22, y - 2, 44, 48, 15); ctx.fill();
  ctx.fillStyle = '#f6c69f'; ctx.beginPath(); ctx.arc(x, y - 22, 25, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = preset.hair; ctx.beginPath(); ctx.arc(x, y - 29, 25, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#283b63'; ctx.beginPath(); ctx.arc(x - 8, y - 20, 3, 0, Math.PI * 2); ctx.arc(x + 8, y - 20, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f08a76'; ctx.beginPath(); ctx.arc(x, y - 12, 5, 0, Math.PI); ctx.stroke();
  ctx.fillStyle = preset.accent; ctx.beginPath(); ctx.arc(x + 19, y + 8, 8, 0, Math.PI * 2); ctx.fill();
  const shieldUntil = Math.max(wrongContact.shieldUntil, skillState.shieldUntil);
  if (performance.now() < shieldUntil) {
    const remaining = (shieldUntil - performance.now()) / 1000;
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 90) * 0.16;
    ctx.strokeStyle = '#ffe78d'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y + 10, 40 + Math.sin(performance.now() / 130) * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff4b0';
    for (let i = 0; i < 4; i += 1) {
      const angle = i * Math.PI / 2 + remaining * 2;
      ctx.beginPath(); ctx.arc(x + Math.cos(angle) * 38, y + 10 + Math.sin(angle) * 38, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function frame(now) { const delta = Math.min((now - lastTime) / 1000, 0.05); lastTime = now; update(delta); drawWorld(); requestAnimationFrame(frame); }
initializeStageEntities(activeStage, false);
updateCollectionHud();
requestAnimationFrame(frame);
