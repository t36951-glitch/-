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
const player = { x: 1200, y: 805, radius: 25, speed: 245, facing: 'down', bob: 0, footOffsetY: 46 };
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

const TARGET_WORD = ['사', '과'];
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
const letterItems = [
  { id: 'sa', character: '사', x: 720, y: 430, collected: false, wobble: 0 },
  { id: 'gwa', character: '과', x: 1580, y: 1080, collected: false, wobble: 0 }
];
// Safe open grass near the central path: clear of the current trees, rocks, fence, and river.
const treasureChest = { x: 860, y: 1080, opened: false, sparkle: 0 };
const learningMonster = {
  x: 1040,
  y: 1050,
  resolved: false,
  wobble: 0,
  hp: 3,
  maxHp: 3,
  state: 'idle',
  warningUntil: 0,
  nextAttackAt: 0,
  attackActiveUntil: 0,
  attackToken: 0,
  defeatStartedAt: 0,
  quizResolved: false
};
const combat = { current: 3, max: 3, restActive: false, restElapsed: 0 };
const attackState = { cooldownUntil: 0, projectiles: [], effects: [], nextId: 1 };
const collectedLetters = [];
const pickupEffects = [];
const MAX_ENERGY = 5;
const energy = { current: MAX_ENERGY };
const mp = { current: MP_SETTINGS[profile.character].max, recoveryElapsed: 0, saveElapsed: 0 };
const wrongContact = { touchingItemId: null, shieldUntil: 0, moveLockUntil: 0 };
const restState = { inside: false, elapsed: 0, recovered: false, noticeShown: false };
const automaticRest = { active: false, elapsed: 0, lastSecond: 5, reason: 'energy' };
const challenge = { status: 'collecting', doorOpen: false, doorPassed: false };
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
const hintOverlay = document.querySelector('#hint-overlay');
const hintCloseButton = document.querySelector('#hint-close');
const hintCurrentEl = document.querySelector('#hint-current');
const monsterOverlay = document.querySelector('#monster-overlay');
const monsterChoiceButtons = document.querySelectorAll('.monster-choice');
const monsterFeedback = document.querySelector('#monster-feedback');
const letterNotice = document.querySelector('#letter-notice');
const successOverlay = document.querySelector('#success-overlay');
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
const heroAvatarEl = document.querySelector('#hero-avatar');
const menuButton = document.querySelector('#menu-button');
const menuPanel = document.querySelector('#menu-panel');
const changeCharacterButton = document.querySelector('#change-character-button');
const restartAdventureButton = document.querySelector('#restart-adventure-button');
const resetProfileButton = document.querySelector('#reset-profile-button');
const closeMenuButton = document.querySelector('#close-menu-button');
let selectedCharacter = profile.character;
let letterNoticeTimer;
let hintHighlightTimer;
let successAudioContext;
let successEffect = null;
let recoveryEffect = null;
let monsterQuizOpen = false;
let monsterAnswerCooldownUntil = 0;
let monsterUnlockTimer;
let combatAudioContext;
const attackButton = document.querySelector('#attack-button');
const skillButton = document.querySelector('#skill-button-0');
const skillNameEl = document.querySelector('#skill-name-0');
const skillCooldownEl = document.querySelector('#skill-cooldown-0');
const skillState = { cooldownUntil: 0, activeUntil: 0, shieldUntil: 0, shieldHitsRemaining: 0, shieldVisualOn: false, focusItemId: null, focusUntil: 0, arrowUntil: 0, hintUntil: 0 };
const skillChargesEl = document.querySelector('#skill-charges-0');

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
  if (collectedLetters.length === 0) return '첫 번째 글자는 사예요.';
  if (collectedLetters.length === 1) return '다음 글자는 과예요.';
  return '사과 글자를 모두 모았어요!';
}

function resetSkillState() {
  skillState.cooldownUntil = 0;
  skillState.activeUntil = 0;
  skillState.shieldUntil = 0;
  skillState.shieldHitsRemaining = 0;
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
  const target = letterItems.find((item) => item.id === skillState.focusItemId && !item.collected);
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
  const canAttempt = gameStarted && energy.current > 0 && !automaticRest.active && now >= skillState.cooldownUntil;
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
    const attackReady = gameStarted && energy.current > 0 && !automaticRest.active && !monsterQuizOpen && now >= attackState.cooldownUntil;
    attackButton.disabled = !attackReady;
    attackButton.setAttribute('aria-label', '기본 공격');
  }
}

function applyProfileToHud() {
  const preset = CHARACTER_PRESETS[profile.character];
  heroNameEl.textContent = profile.name;
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

function beginCharacterChange() {
  closeMenu();
  gameStarted = false;
  successOverlay.hidden = true;
  hintOverlay.hidden = true;
  startScreen.hidden = false;
  showSetupStep();
}

function restartAdventure() {
  closeMenu();
  resetChallenge();
}

function resetProfile() {
  if (!window.confirm('프로필을 초기화할까요? 이름과 캐릭터 선택이 지워집니다.')) return;
  try {
    localStorage.removeItem('letter-kingdom-profile');
    localStorage.removeItem('letter-kingdom-mp-states');
  } catch (error) { /* localStorage may be unavailable */ }
  profile.name = '다온';
  profile.character = 'swordsman';
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

menuButton.addEventListener('click', () => (menuPanel.hidden ? openMenu() : closeMenu()));
changeCharacterButton.addEventListener('click', beginCharacterChange);
restartAdventureButton.addEventListener('click', restartAdventure);
resetProfileButton.addEventListener('click', resetProfile);
closeMenuButton.addEventListener('click', closeMenu);
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

function currentHintMessage() {
  if (collectedLetters.length === 0) return '첫 번째 글자는 ‘사’예요.';
  if (collectedLetters.length === 1) return '다음 글자는 ‘과’예요.';
  return '사과 글자를 모두 모았어요!';
}

function updateCollectionHud() {
  collectedLettersEl.textContent = collectedLetters.length ? collectedLetters.join(', ') : '아직 없어요';
  letterCountEl.textContent = `${collectedLetters.length}/${TARGET_WORD.length}`;
  nextLetterEl.textContent = challenge.status === 'complete' ? '없음' : (TARGET_WORD[collectedLetters.length] || '없음');
  wordStateEl.textContent = challenge.status === 'complete' ? '사과 완성!' : '글자를 모아 보세요!';
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
  showNotice('사과 힌트를 찾았어요!', 1500);
  openHint();
}

function setMonsterChoicesDisabled(disabled) {
  monsterChoiceButtons.forEach((button) => { button.disabled = disabled; });
}

function openMonsterQuiz() {
  if (learningMonster.resolved || automaticRest.active || energy.current === 0 || monsterQuizOpen) return;
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
  if (learningMonster.resolved || learningMonster.quizResolved || automaticRest.active || energy.current === 0 || monsterQuizOpen) return;
  const footY = player.y + player.footOffsetY;
  if (Math.hypot(player.x - learningMonster.x, footY - learningMonster.y) <= player.radius + 75) openMonsterQuiz();
}

function answerMonster(answer) {
  const now = performance.now();
  if (!monsterQuizOpen || automaticRest.active || energy.current === 0 || now < monsterAnswerCooldownUntil) return;
  if (answer === '사') {
    learningMonster.quizResolved = true;
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
    const target = letterItems.find((item) => !item.collected && item.character === TARGET_WORD[collectedLetters.length]);
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
  challenge.doorOpen = true;
  successEffect = { x: stageDoor.xCenter, y: stageDoor.y, life: 2.4 };
  updateCollectionHud();
  showNotice('사과 완성! 문이 열렸어요.', 3000);
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

function startAutomaticRest(reason = 'energy') {
  if (automaticRest.active) return;
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
  combat.current = combat.max;
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
  showNotice('푹 쉬었어요! 전투 체력과 에너지가 모두 회복되었어요.', 2600);
}

function getFacingVector() {
  return {
    x: player.facing === 'right' ? 1 : player.facing === 'left' ? -1 : 0,
    y: player.facing === 'down' ? 1 : player.facing === 'up' ? -1 : 0
  };
}

function addCombatEffect(x, y, type = 'hit') {
  attackState.effects.push({ x, y, type, life: type === 'defeat' ? 1.8 : .55, maxLife: type === 'defeat' ? 1.8 : .55 });
}

function damageTrainingMonster(amount = 1) {
  if (learningMonster.resolved || learningMonster.hp <= 0) return false;
  learningMonster.hp = Math.max(0, learningMonster.hp - amount);
  learningMonster.wobble = 1;
  addCombatEffect(learningMonster.x, learningMonster.y, 'hit');
  if (learningMonster.hp === 0) {
    learningMonster.resolved = true;
    learningMonster.state = 'friend';
    learningMonster.defeatStartedAt = performance.now();
    learningMonster.warningUntil = 0;
    learningMonster.attackActiveUntil = 0;
    attackState.projectiles.length = 0;
    addCombatEffect(learningMonster.x, learningMonster.y, 'defeat');
    showNotice('훈련 몬스터가 빛의 친구가 되었어요!', 2200);
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
  if (!gameStarted || automaticRest.active || monsterQuizOpen || energy.current === 0 || now < attackState.cooldownUntil) return;
  attackState.cooldownUntil = now + 420;
  if (profile.character === 'swordsman') {
    const distance = Math.hypot(player.x - learningMonster.x, player.y + player.footOffsetY - learningMonster.y);
    if (!learningMonster.resolved && distance <= 125) damageTrainingMonster(1);
    addCombatEffect(player.x, player.y - 12, 'slash');
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
    if (!projectile.hit && !learningMonster.resolved && Math.hypot(projectile.x - learningMonster.x, projectile.y - learningMonster.y) <= 38) {
      projectile.hit = true;
      projectile.life = 0;
      damageTrainingMonster(1);
    }
  });
  attackState.projectiles = attackState.projectiles.filter((projectile) => projectile.life > 0);
}

function consumeLearningShield() {
  const now = performance.now();
  if (now >= skillState.shieldUntil || skillState.shieldHitsRemaining <= 0) return false;
  skillState.shieldHitsRemaining -= 1;
  if (skillState.shieldHitsRemaining === 0) {
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
  if (automaticRest.active || energy.current === 0) return;
  const footY = player.y + player.footOffsetY;
  const neededCharacter = TARGET_WORD[collectedLetters.length];
  const item = letterItems.find((candidate) => !candidate.collected && Math.hypot(player.x - candidate.x, footY - candidate.y) <= player.radius + 24);
  if (!item) {
    wrongContact.touchingItemId = null;
    return;
  }
  if (item.character !== neededCharacter) {
    handleWrongLetterContact(item);
    return;
  }
  item.collected = true;
  collectedLetters.push(item.character);
  pickupEffects.push({ x: item.x, y: item.y, character: item.character, life: 1 });
  wrongContact.touchingItemId = null;
  updateCollectionHud();
  if (item.character === '사') showNotice('잘했어요! 이제 ‘과’를 찾아보세요.', 2200);
  else showLetterNotice(item.character);
  if (collectedLetters.length === TARGET_WORD.length) completeWord();
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

function updateRestZone(delta) {
  const footY = player.y + player.footOffsetY;
  const inside = circleIntersectsRect(player.x, footY, player.radius, restArea);
  if (!inside) {
    restState.inside = false;
    restState.elapsed = 0;
    restState.recovered = false;
    restState.noticeShown = false;
    return;
  }
  if (!restState.inside) {
    restState.inside = true;
    restState.elapsed = 0;
    restState.recovered = false;
    restState.noticeShown = false;
  }
  if (!restState.noticeShown) {
    showNotice('집에서 잠시 쉬어볼까요?', 1600);
    restState.noticeShown = true;
  }
  restState.elapsed += delta;
  if (restState.elapsed >= 1 && !restState.recovered) {
    restState.recovered = true;
    energy.current = MAX_ENERGY;
    recoveryEffect = { x: restArea.xCenter, y: restArea.yCenter, life: 2 };
    updateEnergyHud();
    showNotice('푹 쉬었어요! 에너지가 모두 회복되었어요.', 2600);
  }
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
const learningMonsterCollision = { x: 1000, y: 1000, w: 80, h: 70 };
const DEBUG_COLLISIONS = false;

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

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
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
  const hitsLearningMonster = !learningMonster.resolved && circleIntersectsRect(x, footY, player.radius, learningMonsterCollision);
  return !hitsNaturalObstacle && !hitsStaticObstacle && !hitsClosedDoor && !hitsLearningMonster && !isBlockedByRiver(x, y);
}

function applyTrainingMonsterAttack() {
  if (learningMonster.resolved || automaticRest.active) return;
  const distance = Math.hypot(player.x - learningMonster.x, player.y + player.footOffsetY - learningMonster.y);
  if (distance > 155) return;
  if (consumeLearningShield()) return;
  combat.current = Math.max(0, combat.current - 1);
  updateCombatHud();
  if (combat.current === 0) startAutomaticRest('combat');
  else showNotice('몬스터의 공격을 피했어요? 전투 체력이 줄었어요.', 1600);
}

function updateTrainingMonster() {
  if (learningMonster.resolved || automaticRest.active || monsterQuizOpen) return;
  const now = performance.now();
  const distance = Math.hypot(player.x - learningMonster.x, player.y + player.footOffsetY - learningMonster.y);
  if (learningMonster.state === 'idle' && distance <= 260 && now >= learningMonster.nextAttackAt) {
    learningMonster.state = 'warning';
    learningMonster.warningUntil = now + 1200;
    learningMonster.nextAttackAt = learningMonster.warningUntil;
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
    learningMonster.nextAttackAt = now + 1700;
  }
  if (learningMonster.state === 'idle' && learningMonster.nextAttackAt && now < learningMonster.nextAttackAt) return;
}

function drawLearningMonster() {
  const now = performance.now();
  const wobble = learningMonster.resolved ? 0 : Math.sin(now / 420) * 2;
  const x = learningMonster.x; const y = learningMonster.y + wobble;
  const near = Math.hypot(player.x - learningMonster.x, player.y + player.footOffsetY - learningMonster.y) < 260;
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

function drawLetterItem(item) {
  const now = performance.now();
  const footY = player.y + player.footOffsetY;
  const distance = Math.hypot(player.x - item.x, footY - item.y);
  const isNeeded = item.character === TARGET_WORD[collectedLetters.length];
  const isNeededNear = isNeeded && distance < 125;
  const isSkillFocused = item.id === skillState.focusItemId && now < skillState.focusUntil;
  const wobbleOffset = item.wobble ? Math.sin(now / 38) * item.wobble * 7 : 0;
  const pulse = 1 + Math.sin(now / 240 + item.x) * 0.06;
  ctx.save();
  ctx.translate(item.x + wobbleOffset, item.y);
  if (isNeededNear || isSkillFocused) {
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
  ctx.fillStyle = SYLLABLE_COLORS.fill;
  ctx.strokeStyle = SYLLABLE_COLORS.border;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, 29, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = SYLLABLE_COLORS.text;
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
    ctx.fillText('사과 완성!', successEffect.x, successEffect.y - 48 - progress * 28);
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
      ctx.strokeStyle = '#fff0a0'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(effect.x, effect.y, 43 + progress * 20, -1.4, 1.2); ctx.stroke();
    } else {
      ctx.fillStyle = effect.type === 'cast' ? '#f4d9ff' : '#fff1a2';
      ctx.beginPath(); ctx.arc(effect.x, effect.y, 12 + progress * 16, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  });
  if (learningMonster.state === 'attack' && now < learningMonster.attackActiveUntil) {
    ctx.save(); ctx.strokeStyle = 'rgba(244, 111, 104, .72)'; ctx.lineWidth = 5; ctx.setLineDash([8, 7]);
    ctx.beginPath(); ctx.moveTo(learningMonster.x, learningMonster.y); ctx.lineTo(player.x, player.y + player.footOffsetY); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  }
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

function checkDoorPassage() {
  if (!challenge.doorOpen || challenge.doorPassed) return;
  const footY = player.y + player.footOffsetY;
  const crossedDoor = circleIntersectsRect(player.x, footY, player.radius, stageDoor) && footY < stageDoor.y + stageDoor.h / 2;
  if (!crossedDoor) return;
  challenge.doorPassed = true;
  successOverlay.hidden = false;
}

function resetChallenge() {
  letterItems.forEach((item) => { item.collected = false; item.wobble = 0; });
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
  restCountdown.hidden = true;
  restCountdownNumber.textContent = '5';
  treasureChest.opened = false;
  treasureChest.sparkle = 0;
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
  const now = performance.now();
  updateSkillHud(now);
  updateTrainingMonster();
  const movementLocked = monsterQuizOpen || automaticRest.active || energy.current === 0 || now < wrongContact.moveLockUntil;
  const dir = movementLocked ? { x: 0, y: 0 } : direction();
  if (dir.x || dir.y) {
    const nextX = player.x + dir.x * player.speed * delta;
    const nextY = player.y + dir.y * player.speed * delta;
    if (canMoveTo(nextX, player.y)) player.x = nextX;
    if (canMoveTo(player.x, nextY)) player.y = nextY;
    player.bob += delta * 9;
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
  drawHouse(1260, 480); drawHouse(430, 760); drawRestArea(); drawSign(1090, 720); drawStageDoor(); drawLearningMonster();
  flowers.forEach(([x, y], i) => drawFlower(x, y, i % 2 ? '#fff4a8' : '#f39c9e'));
  fences.forEach(([x, y]) => drawFence(x, y));
  trees.forEach(([x, y]) => drawTree(x, y)); rocks.forEach(([x, y]) => drawRock(x, y));
  drawTreasureChest();
  letterItems.filter((item) => !item.collected).forEach(drawLetterItem);
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
  const target = letterItems.find((item) => item.id === skillState.focusItemId && !item.collected);
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
updateCollectionHud();
requestAnimationFrame(frame);
