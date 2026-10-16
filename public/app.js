// ==============================================================
// 전국 학교 실시간 시험상황실 (LifeForTeacher.com 플랫폼 클라이언트)
// ==============================================================

// 전역 상태
let currentSchool = null;
let currentRole = 'classroom'; // 'teacher' | 'classroom'
let registeredSchools = [];

// 테마 설정 (기본: 선명한 화이트 보드 모드)
let currentTheme = localStorage.getItem('exam_board_theme') || 'light';

// 가려진 학년 목록 (각 교실 칠판마다 브라우저 localStorage 저장)
let hiddenGrades = JSON.parse(localStorage.getItem('exam_board_hidden_grades') || '[]');

// 사운드 설정 (기본 ON)
let soundEnabled = localStorage.getItem('exam_board_sound') !== 'false';

// 가상 시각 시뮬레이션용 (null이면 실제 시각)
let simulatedTimeOffsetMs = null;

// 모달 편집용 임시 상태
let settingsEditingDays = [];
let currentSettingsDayIndex = 0;
let settingsDuration = 45;
let day2WarningShown = false;

// ==============================================================
// 1. 초기화 및 테마 설정
// ==============================================================

window.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  fetchSchoolList();
  checkRecentSchool();
  checkUrlParamsForAutoJoin();
  initServerInfoBanner();
  updateSoundUI();
  updateClockAndTimer();
  setInterval(updateClockAndTimer, 1000);

  // 🔒 교사 권한 에러 수신 처리
  if (api.onAuthError) {
    api.onAuthError((err) => {
      alert(err.message || '교사 권한 인증에 실패했습니다.');
    });
  }
});

function applyTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('exam_board_theme', theme);
  const body = document.body;
  const label = document.getElementById('themeLabel');

  if (theme === 'dark') {
    body.classList.remove('light-theme');
    body.classList.add('dark-theme');
    if (label) label.innerText = '다크 모드';
  } else {
    body.classList.remove('dark-theme');
    body.classList.add('light-theme');
    if (label) label.innerText = '화이트 모드';
  }
}

function toggleTheme() {
  applyTheme(currentTheme === 'light' ? 'dark' : 'light');
}

// 학교 목록 조회 및 지역별 필터링
async function fetchSchoolList() {
  try {
    registeredSchools = await api.listSchools();
    filterSchoolsByRegion();
  } catch (err) {
    console.warn('학교 목록 로드 실패:', err);
  }
}

function filterSchoolsByRegion() {
  const filter = document.getElementById('enterRegionFilter')?.value || 'all';
  const datalist = document.getElementById('schoolsDatalist');
  if (!datalist) return;

  const filtered = filter === 'all' 
    ? registeredSchools 
    : registeredSchools.filter(s => s.region === filter || s.name.startsWith(`[${filter}]`));

  datalist.innerHTML = filtered.map(s => `
    <option value="${s.name}">${s.examTitle || ''}</option>
  `).join('');
}

// URL 파라미터 자동 입장 확인 (?code=739214 or ?adminCode=739214)
function checkUrlParamsForAutoJoin() {
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code');
  const adminCodeParam = params.get('adminCode');
  const schoolParam = params.get('school');

  const simTimeParam = params.get('simTime');
  if (simTimeParam) {
    const [hh, mm] = simTimeParam.split(':').map(Number);
    const target = new Date();
    target.setHours(hh, mm, 0, 0);
    simulatedTimeOffsetMs = target.getTime() - Date.now();
  }

  const tabParam = params.get('tab');
  if (tabParam) {
    switchLobbyTab(tabParam);
  }

  const roleParam = params.get('role');
  if (roleParam === 'teacher' || adminCodeParam) {
    const code = adminCodeParam || codeParam;
    if (code) {
      switchLobbyTab('admin');
      const input = document.getElementById('adminRoomCodeInput');
      if (input) input.value = code.trim();
      const passParam = params.get('pass');
      if (passParam) {
        const passInput = document.getElementById('adminPasswordInput');
        if (passInput) passInput.value = passParam.trim();
      }
      handleEnterByCode('teacher');
      return;
    }
  }

  if (codeParam) {
    switchLobbyTab('code');
    const input = document.getElementById('enterRoomCodeInput');
    if (input) {
      input.value = codeParam.trim();
      handleEnterByCode('classroom');
      return;
    }
  }

  if (adminCodeParam) {
    switchLobbyTab('admin');
    const input = document.getElementById('adminRoomCodeInput');
    if (input) {
      input.value = adminCodeParam.trim();
      const passParam = params.get('pass');
      if (passParam) {
        const passInput = document.getElementById('adminPasswordInput');
        if (passInput) passInput.value = passParam.trim();
        handleEnterByCode('teacher');
        return;
      }
      document.getElementById('adminPasswordInput')?.focus();
      return;
    }
  }

  if (schoolParam) {
    const target = registeredSchools.find(s => s.id === schoolParam || s.roomCode === schoolParam);
    if (target && target.roomCode) {
      document.getElementById('enterRoomCodeInput').value = target.roomCode;
      handleEnterByCode('classroom');
    }
  }
}

// 로비 3개 탭 전환: code(교실 코드입장) / admin(교사용 로그인) / create(새 학교 개설)
function switchLobbyTab(tab) {
  const codeTab = document.getElementById('codeTabContent');
  const adminTab = document.getElementById('adminTabContent');
  const createTab = document.getElementById('createTabContent');
  const codeBtn = document.getElementById('tabCodeBtn');
  const adminBtn = document.getElementById('tabAdminBtn');
  const createBtn = document.getElementById('tabCreateBtn');

  if (!codeTab || !adminTab || !createTab) return;

  codeTab.classList.add('hidden');
  adminTab.classList.add('hidden');
  createTab.classList.add('hidden');

  codeBtn.className = "py-2.5 rounded-xl transition text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1";
  adminBtn.className = "py-2.5 rounded-xl transition text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1";
  createBtn.className = "py-2.5 rounded-xl transition text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1";

  if (tab === 'code') {
    codeTab.classList.remove('hidden');
    codeBtn.className = "py-2.5 rounded-xl transition bg-blue-600 text-white shadow-md flex items-center justify-center gap-1";
    setTimeout(() => document.getElementById('enterRoomCodeInput')?.focus(), 50);
  } else if (tab === 'admin') {
    adminTab.classList.remove('hidden');
    adminBtn.className = "py-2.5 rounded-xl transition bg-slate-900 text-white shadow-md flex items-center justify-center gap-1";
    setTimeout(() => document.getElementById('adminRoomCodeInput')?.focus(), 50);
  } else if (tab === 'create') {
    createTab.classList.remove('hidden');
    createBtn.className = "py-2.5 rounded-xl transition bg-emerald-600 text-white shadow-md flex items-center justify-center gap-1";
    setTimeout(() => document.getElementById('createSchoolName')?.focus(), 50);
    const curVal = document.getElementById('createDurationValue')?.value || 45;
    selectCreateDuration(curVal);
  }
  if (window.lucide) lucide.createIcons();
}

// 🏫 학교 개설 시 기본 시험시간 (45분/50분) 선택 및 UI 업데이트
function selectCreateDuration(mins) {
  const dur = Number(mins) === 50 ? 50 : 45;
  const hiddenVal = document.getElementById('createDurationValue');
  const radio45 = document.getElementById('createDur45Radio');
  const radio50 = document.getElementById('createDur50Radio');
  const btn45 = document.getElementById('createDur45Btn');
  const btn50 = document.getElementById('createDur50Btn');
  const badge = document.getElementById('createDurationBadge');

  if (hiddenVal) hiddenVal.value = dur;
  if (radio45) radio45.checked = (dur === 45);
  if (radio50) radio50.checked = (dur === 50);

  const activeClass = "flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition shadow-sm bg-blue-600 text-white border-blue-600 font-extrabold text-xs cursor-pointer";
  const inactiveClass = "flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition shadow-xs bg-white text-slate-700 border-slate-300 hover:border-blue-400 hover:bg-slate-50 font-bold text-xs cursor-pointer";

  if (btn45 && btn50) {
    if (dur === 45) {
      btn45.className = activeClass;
      btn50.className = inactiveClass;
    } else {
      btn45.className = inactiveClass;
      btn50.className = activeClass;
    }
  }

  if (badge) {
    badge.innerText = dur === 45 ? '중학교 45분 시험' : '고등학교 50분 시험';
    badge.className = dur === 45
      ? 'text-[11px] font-extrabold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-200'
      : 'text-[11px] font-extrabold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-md border border-indigo-200';
  }

  if (window.lucide) lucide.createIcons();
}

// 🏫 학교 이름 입력 시 "중학교" / "고등학교" 자동 감지 편의기능
function onSchoolNameInput(val) {
  if (!val) return;
  const t = val.trim();
  if (t.includes('중학') || t.endsWith('중')) {
    selectCreateDuration(45);
  } else if (t.includes('고등') || t.endsWith('고')) {
    selectCreateDuration(50);
  }
}

// 6자리 숫자 입력 시 자동 인증 헬퍼
function onCodeInput(el) {
  el.value = el.value.replace(/[^0-9]/g, '');
  if (el.value.length === 6) {
    handleEnterByCode('classroom');
  }
}

// 6자리 코드로 시험상황실 입장 (교실 칠판: 코드만으로 즉시 입장, 교사: 비밀번호 검증)
async function handleEnterByCode(role) {
  let code = '';
  let password = '';

  if (role === 'classroom') {
    code = (document.getElementById('enterRoomCodeInput')?.value || '').trim();
    if (!code) {
      alert('교실 전자칠판용 6자리 코드를 입력해 주세요.');
      document.getElementById('enterRoomCodeInput')?.focus();
      return;
    }
  } else if (role === 'teacher') {
    code = (document.getElementById('adminRoomCodeInput')?.value || '').trim();
    password = (document.getElementById('adminPasswordInput')?.value || '').trim();
    if (!code) {
      alert('우리 학교 6자리 입장 코드를 입력해 주세요.');
      document.getElementById('adminRoomCodeInput')?.focus();
      return;
    }
    const token = api.getTeacherToken();
    if (!password && !token) {
      alert('교사용(관리자) 비밀번호를 입력해 주세요.');
      document.getElementById('adminPasswordInput')?.focus();
      return;
    }
  }

  try {
    const { ok, data } = await api.authByCode(code, role, password);
    if (!ok) {
      if (role === 'teacher' && !password) {
        switchLobbyTab('admin');
        const passInput = document.getElementById('adminPasswordInput');
        if (passInput) {
          passInput.focus();
          passInput.placeholder = '개설 시 설정한 관리자 비밀번호를 입력해 주세요';
          passInput.classList.add('ring-2', 'ring-blue-500');
          setTimeout(() => passInput.classList.remove('ring-2', 'ring-blue-500'), 2500);
        }
        return;
      }
      alert(data.error || '입장에 실패했습니다.');
      return;
    }

    if (data.role === 'teacher' && data.teacherToken) {
      api.setTeacherToken(data.teacherToken);
    } else {
      api.clearTeacherToken();
    }

    saveRecentSchool(data.school, role);
    enterExamBoard(data.school, data.role || role, { teacherPass: password });
  } catch (err) {
    console.error('코드 입장 에러:', err);
    alert('서버와 통신 중 오류가 발생했습니다.');
  }
}

// 최근 방문 학교 브라우저 기억 (7일 보관)
function saveRecentSchool(school, role) {
  try {
    const recentData = {
      id: school.id,
      name: school.name,
      roomCode: school.roomCode || '',
      examTitle: school.examTitle || '',
      role: role || 'classroom',
      savedAt: Date.now()
    };
    localStorage.setItem('exam_board_recent', JSON.stringify(recentData));
    checkRecentSchool();
  } catch (e) {
    console.warn('최근 학교 저장 실패:', e);
  }
}

// 첫 화면 접속 시 최근 학교 배너 표시
function checkRecentSchool() {
  const banner = document.getElementById('recentSchoolBanner');
  if (!banner) return;
  const raw = localStorage.getItem('exam_board_recent');
  if (!raw) {
    banner.classList.add('hidden');
    return;
  }
  try {
    const recent = JSON.parse(raw);
    if (!recent || !recent.id || !recent.name) {
      banner.classList.add('hidden');
      return;
    }
    if (Date.now() - (recent.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem('exam_board_recent');
      banner.classList.add('hidden');
      return;
    }
    const nameEl = document.getElementById('recentSchoolName');
    const infoEl = document.getElementById('recentSchoolInfo');
    if (nameEl) nameEl.innerText = recent.name;
    if (infoEl) {
      infoEl.innerText = `코드: ${recent.roomCode || '------'} · ${recent.role === 'teacher' ? '교사용 모드' : '교실 칠판 열람 모드'}`;
    }
    banner.classList.remove('hidden');
  } catch (e) {
    banner.classList.add('hidden');
  }
}

// 최근 학교 배너에서 [바로 입장] 클릭 시
async function enterRecentSchool() {
  const raw = localStorage.getItem('exam_board_recent');
  if (!raw) return;
  try {
    const recent = JSON.parse(raw);
    if (recent.role === 'teacher') {
      const existingToken = api.getTeacherToken();
      if (existingToken && recent.roomCode) {
        const { ok, data } = await api.authByCode(recent.roomCode, 'teacher', '');
        if (ok) {
          saveRecentSchool(data.school, 'teacher');
          enterExamBoard(data.school, 'teacher');
          return;
        }
      }
      switchLobbyTab('admin');
      const codeInput = document.getElementById('adminRoomCodeInput');
      if (codeInput) codeInput.value = recent.roomCode || '';
      const passInput = document.getElementById('adminPasswordInput');
      if (passInput) {
        passInput.focus();
        passInput.placeholder = '개설 시 설정한 관리자 비밀번호를 입력해 주세요';
        passInput.classList.add('ring-2', 'ring-blue-500');
        setTimeout(() => passInput.classList.remove('ring-2', 'ring-blue-500'), 2500);
      }
    } else {
      switchLobbyTab('code');
      const codeInput = document.getElementById('enterRoomCodeInput');
      if (codeInput) {
        codeInput.value = recent.roomCode || '';
        handleEnterByCode('classroom');
      }
    }
  } catch (e) {
    console.warn(e);
  }
}

// ==============================================================
// 2. 학교 개설 및 학교 입장 API 호출
// ==============================================================

async function handleCreateSchool() {
  const region = document.getElementById('createRegionSelect').value;
  const name = document.getElementById('createSchoolName').value.trim();
  const examTitle = document.getElementById('createExamTitle').value.trim() || '2026학년도 2학기 중간고사';
  const teacherPass = document.getElementById('createTeacherPass').value.trim();
  const defaultDuration = Number(
    document.getElementById('createDurationValue')?.value ||
    document.querySelector('input[name="createDuration"]:checked')?.value ||
    45
  );

  if (!name) {
    alert('학교 이름을 입력해 주세요.');
    return;
  }
  if (!teacherPass) {
    alert('교사용(관리자) 비밀번호를 입력해 주세요.');
    document.getElementById('createTeacherPass').focus();
    return;
  }

  if (teacherPass.length < 4) {
    alert('보안을 위해 교사용 비밀번호는 최소 4자리 이상으로 설정해 주세요.');
    document.getElementById('createTeacherPass').focus();
    return;
  }

  try {
    const { ok, data } = await api.createSchool({ region, name, examTitle, defaultDuration, teacherPass });
    if (!ok) {
      alert(data.error || '개설에 실패했습니다.');
      return;
    }

    if (data.teacherToken) {
      api.setTeacherToken(data.teacherToken);
    }

    saveRecentSchool(data.school, 'teacher');
    enterExamBoard(data.school, 'teacher', { teacherPass });
    showWelcomeGuideModal(data.school, teacherPass, data.wasRenamed);
  } catch (err) {
    console.error('개설 에러:', err);
    alert('서버와 통신 중 오류가 발생했습니다.');
  }
}

// 개설 완료 환영 모달 팝업
function showWelcomeGuideModal(school, teacherPass, wasRenamed) {
  const modal = document.getElementById('welcomeGuideModal');
  const title = document.getElementById('welcomeSchoolTitle');
  const roomCodeEl = document.getElementById('welcomeRoomCode');
  const tPass = document.getElementById('welcomeTeacherPass');

  title.innerText = wasRenamed 
    ? `${school.name} (동명 학교 자동 넘버링 완료)` 
    : `${school.name} 시험상황실 개설 완료!`;

  if (roomCodeEl) {
    const code = String(school.roomCode || '------');
    roomCodeEl.innerText = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
  }

  if (tPass) tPass.innerText = teacherPass;

  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeWelcomeGuideModal() {
  document.getElementById('welcomeGuideModal').classList.add('hidden');
}

function closeWelcomeGuideModalAndOpenSettings() {
  closeWelcomeGuideModal();
  openSettingsModal();
}

async function handleEnterSchool() {
  const schoolName = document.getElementById('enterSchoolInput')?.value.trim();
  const password = document.getElementById('enterPasswordInput')?.value.trim();

  if (!schoolName) {
    alert('학교 이름을 입력하거나 선택해 주세요.');
    return;
  }
  if (!password) {
    alert('비밀번호를 입력해 주세요.');
    return;
  }

  try {
    const { ok, data } = await api.authByName(schoolName, password);
    if (!ok) {
      alert(data.error || '입장에 실패했습니다.');
      return;
    }

    if (data.role === 'teacher' && data.teacherToken) {
      api.setTeacherToken(data.teacherToken);
    } else {
      api.clearTeacherToken();
    }

    saveRecentSchool(data.school, data.role);
    enterExamBoard(data.school, data.role, { classPass: password });
  } catch (err) {
    console.error('입장 에러:', err);
    alert('서버와 통신 중 오류가 발생했습니다.');
  }
}

// ==============================================================
// 3. 시험상황실 뷰 진입 및 소켓 통신
// ==============================================================

let teacherPreviewMode = false;

function enterExamBoard(school, role, passwords = {}) {
  currentSchool = school;
  currentRole = role;
  teacherPreviewMode = false;

  try {
    if (school && school.roomCode) {
      const url = new URL(window.location);
      url.searchParams.set('code', school.roomCode);
      if (role === 'teacher') {
        url.searchParams.set('role', 'teacher');
      } else {
        url.searchParams.delete('role');
      }
      window.history.replaceState({}, '', url);
    }
  } catch (e) {}

  if (new URLSearchParams(window.location.search).get('sampleNotice') === '1') {
    currentSchool.notices = [
      {
        id: 'sample-01',
        period: 1,
        periodName: '1교시',
        grade: '2',
        subject: '수학',
        content: '5번 문항 보기 ③번 오타 수정: x² + 2x + 1 → x² - 2x + 1 로 수정하여 풀어주세요.',
        createdAt: '09:25:10',
        endTime: '10:00',
        teacher: '수학교사'
      }
    ];
  }

  document.getElementById('lobbyView').classList.add('hidden');
  document.getElementById('examBoardView').classList.remove('hidden');

  api.joinRoom(school.id);

  document.getElementById('schoolBadge').innerText = school.name;
  document.getElementById('examTitleDisplay').innerText = school.examTitle || '시험상황실';

  const roomCodeBadge = document.getElementById('headerRoomCodeBadge');
  if (roomCodeBadge) {
    roomCodeBadge.innerText = `코드: ${school.roomCode || '------'}`;
  }
  // 오늘 날짜와 일치하는 시험 일차가 있다면 자동으로 해당 일차 선택
  if (school.days && school.days.length > 0) {
    const now = getNow();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;
    const todayIdx = school.days.findIndex(day => day.date === todayStr);
    if (todayIdx !== -1 && school.currentDayIndex !== todayIdx) {
      school.currentDayIndex = todayIdx;
      if (role === 'teacher') {
        api.changeDay(school.id, todayIdx);
      }
    }
  }

  updateHeaderDaySelector();

  const roleBadge = document.getElementById('roleBadge');
  const teacherControls = document.getElementById('teacherControls');
  const teacherNoticeBar = document.getElementById('teacherNoticeBar');
  const clockSection = document.getElementById('clockSection');
  const teacherTimeBadge = document.getElementById('teacherTimeBadge');
  const teacherDash = document.getElementById('teacherDashboardView');
  const classroomBoard = document.getElementById('classroomBoardView');
  const previewBanner = document.getElementById('teacherPreviewBanner');

  if (previewBanner) previewBanner.classList.add('hidden');

  const headerShareBtn = document.getElementById('headerShareBtn');

  if (role === 'teacher') {
    if (roleBadge) {
      roleBadge.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-900 text-white shadow-xs shrink-0";
      roleBadge.innerHTML = '● 관리 모드';
    }
    if (headerShareBtn) {
      headerShareBtn.classList.remove('hidden');
      headerShareBtn.classList.add('inline-flex');
    }
    if (teacherControls) teacherControls.classList.remove('hidden');
    if (teacherNoticeBar) teacherNoticeBar.classList.remove('hidden');

    // 관리자 모드: 대형 시계 전광판 숨기고 담백한 관리자 콘솔 표시
    if (clockSection) clockSection.classList.add('hidden');
    if (teacherTimeBadge) teacherTimeBadge.classList.remove('hidden');
    if (teacherDash) teacherDash.classList.remove('hidden');
    if (classroomBoard) classroomBoard.classList.add('hidden');

    const shareCodeEl = document.getElementById('shareRoomCode');
    if (shareCodeEl) shareCodeEl.innerText = school.roomCode || '------';

    renderTeacherNotices();
    renderTeacherTodayTimetable();
    updateClockStatusBadge(school.showClock !== false);
  } else {
    if (roleBadge) {
      roleBadge.className = "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-blue-100 text-blue-700 border border-blue-200 shrink-0";
      roleBadge.innerHTML = '● 교실 칠판';
    }
    if (headerShareBtn) {
      headerShareBtn.classList.add('hidden');
      headerShareBtn.classList.remove('inline-flex');
    }
    if (teacherControls) teacherControls.classList.add('hidden');
    if (teacherNoticeBar) teacherNoticeBar.classList.add('hidden');

    // 학생/교실 전용: 교실 칠판 표시 및 설정에 따른 시계 가시성 제어
    if (teacherTimeBadge) teacherTimeBadge.classList.add('hidden');
    if (teacherDash) teacherDash.classList.add('hidden');
    if (classroomBoard) classroomBoard.classList.remove('hidden');

    applyHiddenGradesToUI();
    renderHeroSubjects();
    renderNotices();
  }

  updateClockVisibility();
  updateClockAndTimer();
  if (window.lucide) lucide.createIcons();
}

// 교사용: 관리자 콘솔 <-> 교실 칠판 화면 미리보기 전환
function toggleClassroomPreview() {
  teacherPreviewMode = !teacherPreviewMode;
  const teacherDash = document.getElementById('teacherDashboardView');
  const classroomBoard = document.getElementById('classroomBoardView');
  const teacherTimeBadge = document.getElementById('teacherTimeBadge');
  const previewBanner = document.getElementById('teacherPreviewBanner');

  if (teacherPreviewMode) {
    teacherDash.classList.add('hidden');
    classroomBoard.classList.remove('hidden');
    teacherTimeBadge.classList.add('hidden');
    previewBanner?.classList.remove('hidden');
    applyHiddenGradesToUI();
    renderHeroSubjects();
    renderNotices();
  } else {
    teacherDash.classList.remove('hidden');
    classroomBoard.classList.add('hidden');
    teacherTimeBadge.classList.remove('hidden');
    previewBanner?.classList.add('hidden');
    renderTeacherNotices();
    renderTeacherTodayTimetable();
  }
  updateClockVisibility();
  if (window.lucide) lucide.createIcons();
}

// 교사용 실시간 정정사항 목록 렌더링 (담백 깔끔 스타일)
function renderTeacherNotices() {
  const container = document.getElementById('teacherNoticeList');
  const countBadge = document.getElementById('teacherNoticeCount');
  if (!container || !currentSchool) return;

  const allNotices = currentSchool.notices || [];
  if (countBadge) countBadge.innerText = `${allNotices.length}건`;

  if (allNotices.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center p-8 border border-dashed border-slate-300 rounded-xl bg-slate-50 text-center">
        <i data-lucide="check-circle" class="w-8 h-8 text-emerald-500 mb-2"></i>
        <div class="text-sm font-bold text-slate-700">현재 등록된 문제 정정사항이 없습니다.</div>
        <div class="text-xs text-slate-400 mt-1">시험 중 오류 발생 시 우측 상단 [새 정정사항 등록]을 누르세요.</div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = allNotices.map(notice => {
    const gradeLabel = notice.grade === 'all' ? '전학년' : `${notice.grade}학년`;
    const gradeColor = notice.grade === 'all' ? 'bg-amber-100 text-amber-800 border-amber-300' :
                       notice.grade === '1' ? 'bg-blue-100 text-blue-800 border-blue-300' :
                       notice.grade === '2' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                       'bg-purple-100 text-purple-800 border-purple-300';
    return `
      <div class="p-3 bg-white border border-rose-200 rounded-xl shadow-xs flex flex-col gap-2 transition hover:border-rose-300">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold border ${gradeColor}">${gradeLabel}</span>
            <span class="text-xs font-black text-slate-800">[${notice.periodName || `${notice.period}교시`}]</span>
            ${notice.subject ? `<span class="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">${notice.subject}</span>` : ''}
            <span class="text-[11px] text-slate-400 font-mono">${notice.createdAt}</span>
          </div>
          <button onclick="handleDeleteNotice('${notice.id}')" class="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 transition flex items-center gap-1" title="정정사항 삭제">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> 삭제
          </button>
        </div>
        <div class="text-xs md:text-sm font-bold text-slate-900 bg-rose-50/60 p-2.5 rounded-lg border border-rose-100 leading-relaxed break-keep">
          ${escapeHtml(notice.content)}
        </div>
        ${notice.imageUrl ? `
          <div class="flex items-center gap-2 p-1.5 bg-slate-50 border border-slate-200 rounded-lg">
            <img src="${notice.imageUrl}" alt="첨부 사진" onclick="openImageModal(this.src)" class="w-14 h-14 object-cover rounded border border-slate-300 bg-white cursor-pointer hover:opacity-90 shadow-xs shrink-0" title="클릭하여 크게 보기">
            <div class="text-[11px] text-slate-600">
              <span class="font-bold text-rose-700">📷 문제 사진 첨부됨</span>
              <p class="text-slate-400 text-[10px]">사진을 클릭하면 확대해서 볼 수 있습니다.</p>
            </div>
          </div>
        ` : ''}
        <div class="text-[11px] text-slate-400 flex items-center justify-between">
          <span>${notice.endTime ? `${notice.endTime} 교시 종료 시 자동 삭제` : '교시 종료 시 자동 삭제'}</span>
          <span>등록처: ${notice.teacher || '출제교사'}</span>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

// 교사용 오늘 시험 시간표 요약 렌더링
function renderTeacherTodayTimetable() {
  const container = document.getElementById('teacherTimetableBody');
  const titleEl = document.getElementById('teacherTodayDayTitle');
  if (!container || !currentSchool) return;

  const currentDay = (currentSchool.days && currentSchool.days[currentSchool.currentDayIndex || 0]) || {};
  if (titleEl) {
    titleEl.innerText = `${currentDay.name || '1일차'} (${currentDay.date || ''})`;
  }

  const timetable = getCurrentActiveTimetable();
  if (timetable.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-xs text-slate-400">등록된 시간표가 없습니다. [시간표 세팅]에서 등록해 주세요.</td></tr>`;
    return;
  }

  const now = getNow();
  const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  container.innerHTML = timetable.map((item, idx) => {
    let statusBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-500">대기</span>';
    let rowBg = 'hover:bg-slate-50';

    if (item.startTime && item.endTime) {
      const [sH, sM] = item.startTime.split(':').map(Number);
      const [eH, eM] = item.endTime.split(':').map(Number);
      const startMins = sH * 60 + sM;
      const endMins = eH * 60 + eM;

      if (currentMinutes >= startMins && currentMinutes < endMins) {
        statusBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-black bg-emerald-100 text-emerald-800 animate-pulse">● 진행 중</span>';
        rowBg = 'bg-blue-50/70 border-l-4 border-blue-600 font-bold';
      } else if (currentMinutes >= endMins) {
        statusBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-400">종료</span>';
        rowBg = 'opacity-60 bg-slate-50/40';
      }
    }

    const g1 = (item.grades && item.grades['1']) || '-';
    const g2 = (item.grades && item.grades['2']) || '-';
    const g3 = (item.grades && item.grades['3']) || '-';

    return `
      <tr class="${rowBg} transition border-b border-slate-100">
        <td class="py-2 px-2.5 text-center font-bold text-slate-800">${item.name || `${idx + 1}교시`}</td>
        <td class="py-2 px-2.5 text-center font-mono text-xs text-slate-600">${item.startTime || ''} ~ ${item.endTime || ''}</td>
        <td class="py-2 px-2 text-blue-700 font-bold text-xs">${g1}</td>
        <td class="py-2 px-2 text-emerald-700 font-bold text-xs">${g2}</td>
        <td class="py-2 px-2 text-purple-700 font-bold text-xs">${g3}</td>
        <td class="py-2 px-2 text-center">${statusBadge}</td>
      </tr>
    `;
  }).join('');

  const shareCodeEl = document.getElementById('shareRoomCode');
  if (shareCodeEl && currentSchool.roomCode) {
    shareCodeEl.innerText = currentSchool.roomCode;
  }

  if (window.lucide) lucide.createIcons();
}

function updateHeaderDaySelector() {
  const select = document.getElementById('headerDaySelect');
  if (!select || !currentSchool) return;

  const days = currentSchool.days || [];
  const currentIdx = currentSchool.currentDayIndex || 0;

  select.innerHTML = days.map((d, idx) => `
    <option value="${idx}" ${idx === currentIdx ? 'selected' : ''}>
      ${d.name || `${idx + 1}일차`} (${d.date ? d.date.slice(5) : ''})
    </option>
  `).join('');

  // 교실 모드에서는 드롭다운 비활성화(읽기 전용)
  if (currentRole === 'classroom') {
    select.disabled = true;
    select.classList.remove('cursor-pointer');
  } else {
    select.disabled = false;
    select.classList.add('cursor-pointer');
  }
}

function handleHeaderDayChange(val) {
  const newDayIndex = Number(val);
  if (currentRole === 'teacher') {
    api.changeDay(currentSchool.id, newDayIndex);
  }
}

function leaveRoomToLobby() {
  if (confirm('시험상황실에서 나가 메인 홈(로비)으로 이동하시겠습니까?')) {
    api.clearTeacherToken();
    currentSchool = null;
    teacherPreviewMode = false;
    try {
      const url = new URL(window.location);
      url.searchParams.delete('code');
      url.searchParams.delete('role');
      url.searchParams.delete('adminCode');
      window.history.replaceState({}, '', url);
    } catch (e) {}
    document.getElementById('examBoardView').classList.add('hidden');
    document.getElementById('lobbyView').classList.remove('hidden');
    fetchSchoolList();
    checkRecentSchool();
  }
}

api.onRoomState((schoolData) => {
  if (!currentSchool || currentSchool.id !== schoolData.id) return;
  currentSchool = schoolData;
  document.getElementById('examTitleDisplay').innerText = currentSchool.examTitle || '시험상황실';
  updateHeaderDaySelector();
  updateClockStatusBadge(currentSchool.showClock !== false);
  updateClockVisibility();
  renderHeroSubjects();
  renderNotices();
  renderTeacherNotices();
  renderTeacherTodayTimetable();
  updateClockAndTimer();
});

api.onNoticeBroadcast(({ notice, allNotices }) => {
  if (!currentSchool) return;
  currentSchool.notices = allNotices;

  if (soundEnabled) {
    playSchoolChime();
  }

  renderNotices();
  renderTeacherNotices();

  const card = document.getElementById(`notice-${notice.id}`);
  if (card) {
    card.classList.add('new-notice-highlight');
    setTimeout(() => card.classList.remove('new-notice-highlight'), 6000);
  }
});

// 현재 활성화된 일차의 시간표 가져오기 (오늘 날짜 일차 우선 확인)
function getCurrentActiveTimetable() {
  if (!currentSchool) return [];
  const days = currentSchool.days || [];
  if (days.length === 0) return currentSchool.timetable || [];

  let idx = currentSchool.currentDayIndex || 0;
  const now = getNow();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  const todayIdx = days.findIndex(day => day.date === todayStr);
  if (todayIdx !== -1 && (currentSchool.currentDayIndex === undefined || currentSchool.currentDayIndex === 0)) {
    idx = todayIdx;
  }

  if (days[idx] && days[idx].timetable) {
    return days[idx].timetable;
  }
  return currentSchool.timetable || [];
}

// ==============================================================
// 4. 지금 시험 중인 과목 및 교실 카드 헤더 렌더링 (1학년 : 수학)
// ==============================================================

function renderHeroSubjects() {
  if (!currentSchool) return;
  const timetable = getCurrentActiveTimetable();
  const now = getNow();
  const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  let activePeriod = null;
  let nextPeriod = null;

  for (const item of timetable) {
    if (!item.startTime || !item.endTime) continue;
    const [sH, sM] = item.startTime.split(':').map(Number);
    const [eH, eM] = item.endTime.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const endMins = eH * 60 + eM;

    if (currentMinutes >= startMins && currentMinutes < endMins) {
      activePeriod = item;
      break;
    } else if (currentMinutes < startMins && !nextPeriod) {
      nextPeriod = item;
    }
  }

  [1, 2, 3].forEach(grade => {
    const titleEl = document.getElementById(`grade-title-${grade}`);
    const timeEl = document.getElementById(`grade-time-${grade}`);

    if (activePeriod) {
      const subName = (activePeriod.grades && activePeriod.grades[grade]) || '시험';
      if (titleEl) titleEl.innerText = `${grade}학년 : ${subName}`;
      if (timeEl) timeEl.innerText = `${activePeriod.startTime} ~ ${activePeriod.endTime} (${activePeriod.name || `${activePeriod.period}교시`})`;
    } else if (nextPeriod) {
      const nextSub = (nextPeriod.grades && nextPeriod.grades[grade]) || '시험';
      if (titleEl) titleEl.innerText = `${grade}학년 : 쉬는 시간`;
      if (timeEl) timeEl.innerText = `다음 ${nextPeriod.startTime} (${nextSub})`;
    } else {
      if (titleEl) titleEl.innerText = `${grade}학년 : 시험 종료`;
      if (timeEl) timeEl.innerText = `오늘 모든 시험 종료`;
    }
  });
}

// ==============================================================
// 5. 정정사항 렌더링 (고시인성 및 스크롤 없는 컴팩트 레이아웃)
// ==============================================================

function renderNotices() {
  if (!currentSchool) return;
  if (new URLSearchParams(window.location.search).get('sampleNotice') === '1' && (!currentSchool.notices || currentSchool.notices.length === 0)) {
    currentSchool.notices = [
      {
        id: 'sample-01',
        period: 1,
        periodName: '1교시',
        grade: '2',
        subject: '수학',
        content: '5번 문항 보기 ③번 오타 수정: x² + 2x + 1 → x² - 2x + 1 로 수정하여 풀어주세요.',
        createdAt: '09:25:10',
        endTime: '10:00',
        teacher: '수학교사'
      }
    ];
  }
  const allNotices = currentSchool.notices || [];

  const commonNotice = allNotices.find(n => n.grade === 'all');
  const commonContainer = document.getElementById('allGradeNoticeContainer');
  if (commonContainer) {
    if (commonNotice) {
      commonContainer.classList.remove('hidden');
      const contentEl = document.getElementById('allGradeNoticeContent');
      const timeEl = document.getElementById('allGradeNoticeTime');
      if (contentEl) {
        contentEl.innerHTML = `
          <span>${escapeHtml(commonNotice.content)}</span>
          ${commonNotice.imageUrl ? `
            <button onclick="openImageModal('${commonNotice.imageUrl}')" class="ml-2.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-200 hover:bg-amber-300 text-amber-950 text-xs font-bold transition shadow-xs">
              <i data-lucide="image" class="w-3.5 h-3.5"></i> 사진 보기
            </button>
          ` : ''}
        `;
      }
      if (timeEl) timeEl.innerText = `[${commonNotice.periodName || ''}] ${commonNotice.createdAt} 등록`;
    } else {
      commonContainer.classList.add('hidden');
    }
  }

  [1, 2, 3].forEach(grade => {
    const listEl = document.getElementById(`notices-grade-${grade}`);
    const countEl = document.getElementById(`badge-count-${grade}`);
    if (!listEl) return;

    const gradeNotices = allNotices.filter(n => String(n.grade) === String(grade));
    if (countEl) countEl.innerText = gradeNotices.length;

    if (gradeNotices.length === 0) {
      listEl.innerHTML = `
        <div class="p-3 border border-dashed border-slate-200 rounded-xl text-center bg-slate-50/70 text-slate-500 flex items-center justify-center gap-1.5 shrink-0">
          <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-500"></i>
          <span class="text-xs font-bold text-slate-600">현재 등록된 문제 정정사항이 없습니다.</span>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    listEl.innerHTML = gradeNotices.map(notice => {
      const deleteBtn = currentRole === 'teacher' ? `
        <button onclick="handleDeleteNotice('${notice.id}')" class="text-slate-400 hover:text-red-600 p-1 rounded-md transition" title="정정사항 삭제">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      ` : '';

      return `
        <div id="notice-${notice.id}" class="bg-red-50 border-2 border-red-500 rounded-xl p-3 shadow-xs flex flex-col gap-1.5 transition shrink-0">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="bg-red-600 text-white font-black px-2 py-0.5 rounded text-[11px] shadow-xs">
                🚨 문제 정정
              </span>
              <span class="font-extrabold text-red-950 text-xs">[${notice.periodName || `${notice.period}교시`}]</span>
              ${notice.subject ? `<span class="bg-white border border-red-300 text-red-800 font-extrabold px-1.5 py-0.2 rounded text-[11px]">${notice.subject}</span>` : ''}
              <span class="text-slate-500 font-mono text-[11px]">${notice.createdAt}</span>
            </div>
            ${deleteBtn}
          </div>
          
          <div class="text-base md:text-lg font-black text-slate-900 bg-white p-2.5 rounded-lg border border-red-200 leading-snug break-keep shadow-inner">
            ${escapeHtml(notice.content)}
          </div>

          ${notice.imageUrl ? `
            <div class="mt-1 flex flex-col items-center justify-center p-1.5 bg-white border border-red-200 rounded-lg">
              <img src="${notice.imageUrl}" alt="문제 정정 사진" onclick="openImageModal(this.src)" class="max-h-40 md:max-h-48 w-auto rounded object-contain cursor-pointer hover:opacity-95 shadow-xs transition" title="클릭하여 원본 크기로 확대">
              <span class="text-[10px] text-slate-400 font-bold mt-1">🔍 사진을 터치/클릭하면 크게 볼 수 있습니다.</span>
            </div>
          ` : ''}

          <div class="text-[11px] font-bold text-slate-500 flex items-center justify-between">
            <span class="flex items-center gap-1 text-slate-600">
              <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-600"></i>
              ${notice.endTime ? `${notice.endTime} 교시 종료 시 자동 삭제` : '교시 종료 시 자동 삭제'}
            </span>
            <span class="text-slate-400 font-medium">출제: ${notice.teacher || '해당 교과교사'}</span>
          </div>
        </div>
      `;
    }).join('');
  });

  if (window.lucide) lucide.createIcons();
}

function dismissCommonNotice() {
  document.getElementById('allGradeNoticeContainer').classList.add('hidden');
}

function handleDeleteNotice(id) {
  if (confirm('이 정정사항을 삭제하시겠습니까? 우리 학교 모든 교실 전자칠판에서도 즉시 삭제됩니다.')) {
    api.deleteNotice(currentSchool.id, id);
  }
}

// ==============================================================
// 6. 학년별 가리기 / 보이기
// ==============================================================

function toggleGradeVisibility(grade) {
  grade = Number(grade);
  const index = hiddenGrades.indexOf(grade);
  if (index === -1) {
    hiddenGrades.push(grade);
  } else {
    hiddenGrades.splice(index, 1);
  }
  localStorage.setItem('exam_board_hidden_grades', JSON.stringify(hiddenGrades));
  applyHiddenGradesToUI();
}

function restoreGrade(grade) {
  hiddenGrades = hiddenGrades.filter(g => g !== Number(grade));
  localStorage.setItem('exam_board_hidden_grades', JSON.stringify(hiddenGrades));
  applyHiddenGradesToUI();
}

function restoreAllGrades() {
  hiddenGrades = [];
  localStorage.setItem('exam_board_hidden_grades', JSON.stringify(hiddenGrades));
  applyHiddenGradesToUI();
}

function applyHiddenGradesToUI() {
  let visibleCount = 0;

  [1, 2, 3].forEach(grade => {
    const col = document.getElementById(`column-grade-${grade}`);
    if (!col) return;

    if (hiddenGrades.includes(grade)) {
      col.classList.add('hidden-grade');
    } else {
      col.classList.remove('hidden-grade');
      visibleCount++;
    }
  });

  const bar = document.getElementById('hiddenGradesBar');
  const chips = document.getElementById('hiddenGradesChips');
  const allHiddenPlaceholder = document.getElementById('allHiddenPlaceholder');

  if (hiddenGrades.length > 0) {
    if (bar) {
      bar.classList.remove('hidden');
      bar.classList.add('flex');
    }
    if (chips) {
      chips.innerHTML = hiddenGrades.map(g => `
        <button onclick="restoreGrade(${g})" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white hover:bg-amber-100 text-amber-950 font-black border border-amber-300 transition text-[11px] shadow-2xs">
          <i data-lucide="eye" class="w-3 h-3 text-amber-700"></i>
          <span>${g}학년 보이기</span>
        </button>
      `).join('') + `
        <button onclick="restoreAllGrades()" class="text-[11px] text-amber-800 hover:text-amber-950 underline ml-1 font-bold">모두 복구</button>
      `;
    }
  } else {
    if (bar) {
      bar.classList.add('hidden');
      bar.classList.remove('flex');
    }
    if (chips) chips.innerHTML = '';
  }

  if (visibleCount === 0) {
    allHiddenPlaceholder.classList.remove('hidden');
  } else {
    allHiddenPlaceholder.classList.add('hidden');
  }

  if (window.lucide) lucide.createIcons();
}

// ==============================================================
// 7. 시계 및 타이머 (교시 종료 시 자동 삭제)
// ==============================================================

function getNow() {
  if (simulatedTimeOffsetMs !== null) {
    return new Date(Date.now() + simulatedTimeOffsetMs);
  }
  return new Date();
}

// ⚡ 교실 화면 남은시간 카운트다운 완전 영구 파괴 (브라우저 캐시 등으로 이전 HTML 요소가 잔존해도 즉각 제거)
function destroyCountdownBoxes() {
  document.getElementById('countdownBox')?.remove();
  document.getElementById('countdownLabel')?.remove();
  document.getElementById('countdownValue')?.remove();
  const sep = document.querySelector('#clockSection span.w-px');
  if (sep) sep.remove();
}
destroyCountdownBoxes();

// 🕒 교실 전자칠판 시계 표시 여부 제어 (관리자 체크 해제 옵션)
function handleClockToggle(isChecked) {
  if (!currentSchool) return;
  currentSchool.showClock = isChecked;
  api.toggleClock(currentSchool.id, isChecked);
  updateClockStatusBadge(isChecked);
  updateClockVisibility();
}

function updateClockStatusBadge(isChecked) {
  const badge = document.getElementById('clockStatusBadge');
  const toggle = document.getElementById('teacherClockToggle');
  const settingsCheck = document.getElementById('settingsShowClock');
  if (badge) {
    if (isChecked) {
      badge.className = "text-[10px] px-1.5 py-0.2 rounded font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300";
      badge.innerText = "● 시계 작동 중";
    } else {
      badge.className = "text-[10px] px-1.5 py-0.2 rounded font-extrabold bg-slate-200 text-slate-600 border border-slate-300";
      badge.innerText = "○ 시계 숨김 (타종 기준)";
    }
  }
  if (toggle) toggle.checked = isChecked;
  if (settingsCheck) settingsCheck.checked = isChecked;
}

function updateClockVisibility() {
  const clockSection = document.getElementById('clockSection');
  if (!clockSection) return;
  
  const isClassroomOrPreview = (currentRole === 'classroom') || (currentRole === 'teacher' && teacherPreviewMode);
  if (!isClassroomOrPreview) {
    clockSection.classList.add('hidden');
    return;
  }
  
  const shouldShow = currentSchool ? (currentSchool.showClock !== false) : true;
  if (shouldShow) {
    clockSection.classList.remove('hidden');
  } else {
    clockSection.classList.add('hidden');
  }
}

function updateClockAndTimer() {
  destroyCountdownBoxes();
  const now = getNow();
  
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const clockEl = document.getElementById('digitalClock');
  if (clockEl) clockEl.innerText = `${hours}:${minutes}:${seconds}`;

  const teacherClock = document.getElementById('teacherClockText');
  const teacherPeriod = document.getElementById('teacherPeriodText');
  if (teacherClock) teacherClock.innerText = `${hours}:${minutes}:${seconds}`;

  const dateEl = document.getElementById('currentDateDisplay');
  if (dateEl) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    dateEl.innerText = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;
  }

  if (!currentSchool) return;

  const timetable = getCurrentActiveTimetable();
  let activePeriod = null;
  let nextPeriod = null;
  const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  for (const item of timetable) {
    if (!item.startTime || !item.endTime) continue;
    const [sH, sM] = item.startTime.split(':').map(Number);
    const [eH, eM] = item.endTime.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const endMins = eH * 60 + eM;

    if (currentMinutes >= startMins && currentMinutes < endMins) {
      activePeriod = { ...item, endMins };
      break;
    } else if (currentMinutes < startMins && !nextPeriod) {
      nextPeriod = { ...item, startMins };
    }
  }

  // ⚡ 교실 화면 남은시간 카운트다운 완전 영구 파괴 (어떤 캐시 상태에서도 즉시 DOM에서 제거)
  destroyCountdownBoxes();

  if (activePeriod) {
    if (teacherPeriod) {
      teacherPeriod.className = "text-emerald-700 font-black";
      teacherPeriod.innerText = `${activePeriod.name} 진행 중 (${activePeriod.startTime} ~ ${activePeriod.endTime})`;
    }
  } else if (nextPeriod) {
    if (teacherPeriod) {
      teacherPeriod.className = "text-blue-700 font-bold";
      teacherPeriod.innerText = `쉬는 시간 (다음: ${nextPeriod.name} ${nextPeriod.startTime})`;
    }
  } else {
    if (teacherPeriod) {
      teacherPeriod.className = "text-slate-500 font-medium";
      teacherPeriod.innerText = "오늘 모든 시험 종료";
    }
  }

  if (currentRole === 'teacher' && !teacherPreviewMode) {
    renderTeacherTodayTimetable();
  }

  renderHeroSubjects();
  filterExpiredNoticesLocally(now);
}

function filterExpiredNoticesLocally(now) {
  if (!currentSchool || !currentSchool.notices) return;
  const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  let hasExpired = false;
  const timetable = getCurrentActiveTimetable();

  currentSchool.notices = currentSchool.notices.filter(notice => {
    const periodObj = timetable.find(p => p.period === Number(notice.period));
    const endTime = (periodObj && periodObj.endTime) || notice.endTime;
    if (endTime) {
      const [eH, eM] = endTime.split(':').map(Number);
      // 10:45 종료 시험이면 10시 45분 59초까지 유지되고 10시 46분 00초(eH * 60 + eM + 1)가 되는 순간 삭제
      const expireMinutes = eH * 60 + eM + 1;
      if (currentMinutes >= expireMinutes) {
        hasExpired = true;
        return false;
      }
    }
    return true;
  });

  if (hasExpired) {
    renderNotices();
    renderTeacherNotices();
  }
}

// ==============================================================
// 8. ⭐ 핵심: 날짜별 시간표 & 시작시간 기반 종료시간 자동 계산 로직 ⭐
// ==============================================================

// 시작시간에 분(duration)을 더해 HH:MM 형식으로 반환하는 계산 헬퍼
function calculateEndTime(startTimeStr, durationMinutes) {
  if (!startTimeStr || !startTimeStr.includes(':')) return '';
  const [h, m] = startTimeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return '';

  const totalMinutes = h * 60 + m + Number(durationMinutes);
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;

  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

// 시간표 세팅 모달 오픈
function openSettingsModal() {
  document.getElementById('settingExamTitle').value = currentSchool.examTitle || '2026학년도 2학기 중간고사';
  
  settingsDuration = currentSchool.defaultDuration || 50;
  updateDurationButtonsUI();
  day2WarningShown = false;

  const showClock = currentSchool.showClock !== false;
  const clockCheckbox = document.getElementById('settingsShowClock');
  if (clockCheckbox) clockCheckbox.checked = showClock;

  // 깊은 복사로 편집 데이터 준비
  if (currentSchool.days && currentSchool.days.length > 0) {
    settingsEditingDays = JSON.parse(JSON.stringify(currentSchool.days));
  } else {
    settingsEditingDays = [
      {
        dayIndex: 0,
        name: "1일차",
        date: new Date().toISOString().split('T')[0],
        timetable: currentSchool.timetable || []
      }
    ];
  }

  currentSettingsDayIndex = currentSchool.currentDayIndex || 0;
  if (currentSettingsDayIndex >= settingsEditingDays.length) currentSettingsDayIndex = 0;

  renderSettingsDayTabs();
  loadCurrentSettingsDayTable();

  document.getElementById('settingsModal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

// 시험시간 변경 (45분 / 50분 / 사용자 지정)
function setExamDuration(minutes) {
  settingsDuration = Number(minutes);
  updateDurationButtonsUI();

  // 현재 열려있는 모든 교시의 종료시간을 즉시 새로운 시험시간 기준으로 일괄 자동 재계산!
  const rows = document.querySelectorAll('#periodTableBody tr');
  rows.forEach(row => {
    const startInput = row.querySelector('.period-start-input');
    const endInput = row.querySelector('.period-end-input');
    if (startInput && endInput && startInput.value) {
      endInput.value = calculateEndTime(startInput.value, settingsDuration);
    }
  });

  // 메모리 상의 timetable 데이터도 동기화
  saveCurrentTableToMemory();
}

function promptCustomDuration() {
  const input = prompt('시험시간(분 단위)을 직접 입력하세요 (예: 40, 50, 60):', settingsDuration);
  if (input !== null && !isNaN(Number(input)) && Number(input) > 0) {
    setExamDuration(Number(input));
  }
}

function updateDurationButtonsUI() {
  const btn45 = document.getElementById('btnDur45');
  const btn50 = document.getElementById('btnDur50');
  const btnCustom = document.getElementById('btnDurCustom');
  const tag = document.getElementById('activeDurationTag');
  const guide = document.getElementById('durationGuideSpan');

  if (guide) guide.innerText = String(settingsDuration);
  if (tag) tag.innerText = `${settingsDuration}분`;

  if (btn45 && btn50 && btnCustom) {
    if (settingsDuration === 45) {
      btn45.className = "py-1 px-2.5 rounded-md transition bg-blue-600 text-white font-black shadow-xs";
    } else {
      btn45.className = "py-1 px-2.5 rounded-md transition text-slate-600 hover:text-slate-900 font-bold";
    }

    if (settingsDuration === 50) {
      btn50.className = "py-1 px-2.5 rounded-md transition bg-blue-600 text-white font-black shadow-xs";
    } else {
      btn50.className = "py-1 px-2.5 rounded-md transition text-slate-600 hover:text-slate-900 font-bold";
    }

    if (settingsDuration !== 45 && settingsDuration !== 50) {
      btnCustom.className = "py-1 px-2.5 rounded-md transition bg-blue-600 text-white font-black shadow-xs";
      btnCustom.innerText = `직접(${settingsDuration}분)`;
    } else {
      btnCustom.className = "py-1 px-2.5 rounded-md transition text-slate-600 hover:text-slate-900 font-bold";
      btnCustom.innerText = '직접 설정';
    }
  }
}

// 시작시간 변경 시 해당 교시의 종료시간을 자동으로 변경!
function onPeriodStartInput(rowIndex, inputEl) {
  const row = inputEl.closest('tr');
  const endInput = row.querySelector('.period-end-input');
  if (endInput && inputEl.value) {
    endInput.value = calculateEndTime(inputEl.value, settingsDuration);
  }
}

// 일차 탭 렌더링 (컴팩트 고딕 탭)
function renderSettingsDayTabs() {
  const container = document.getElementById('settingsDayTabs');
  if (!container) return;
  container.innerHTML = settingsEditingDays.map((d, idx) => {
    const isActive = idx === currentSettingsDayIndex;
    const activeClass = isActive 
      ? "bg-blue-600 text-white font-black shadow-xs" 
      : "bg-white text-slate-700 hover:bg-slate-100 font-bold";
    return `
      <button type="button" onclick="switchSettingsDayTab(${idx})" class="px-2.5 py-1 rounded-md text-xs transition border border-slate-300 ${activeClass}">
        ${d.name || `${idx + 1}일차`}
      </button>
    `;
  }).join('');
}

function switchSettingsDayTab(idx) {
  // 현재 작업 중이던 테이블 내용 저장
  saveCurrentTableToMemory();

  // 2일차 세팅으로 넘어갈 때 주말/공휴일 날짜 확인 경고
  if (idx === 1 && !day2WarningShown) {
    alert('간혹 주말이나 공휴일을 끼고 시험을 보는 경우도 있으니, 2일차 시험 날짜가 맞는지 꼭 확인하세요!');
    day2WarningShown = true;
  }

  currentSettingsDayIndex = idx;
  renderSettingsDayTabs();
  loadCurrentSettingsDayTable();
}

function addNewDayTab() {
  saveCurrentTableToMemory();
  const nextIdx = settingsEditingDays.length;
  const prevDate = settingsEditingDays[nextIdx - 1]?.date;
  let nextDateStr = new Date().toISOString().split('T')[0];

  if (prevDate) {
    const parts = prevDate.split('-').map(Number);
    if (parts.length === 3) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      nextDateStr = `${y}-${m}-${day}`;
    }
  }

  // 1일차 구조 복사하여 새 일차 생성 (1일차 시작/종료시간 및 교시 유지)
  const baseTimetable = (settingsEditingDays[0] && settingsEditingDays[0].timetable) || [];
  const templateTable = baseTimetable.length > 0
    ? baseTimetable.map(p => ({
        period: p.period,
        name: p.name,
        startTime: p.startTime,
        endTime: p.endTime,
        grades: { "1": "", "2": "", "3": "" }
      }))
    : [
        { period: 1, name: "1교시", startTime: "09:10", endTime: calculateEndTime("09:10", settingsDuration), grades: { "1": "", "2": "", "3": "" } },
        { period: 2, name: "2교시", startTime: "10:15", endTime: calculateEndTime("10:15", settingsDuration), grades: { "1": "", "2": "", "3": "" } },
        { period: 3, name: "3교시", startTime: "11:20", endTime: calculateEndTime("11:20", settingsDuration), grades: { "1": "", "2": "", "3": "" } }
      ];

  settingsEditingDays.push({
    dayIndex: nextIdx,
    name: `${nextIdx + 1}일차`,
    date: nextDateStr,
    timetable: templateTable
  });

  // 2일차 추가 시 주말/공휴일 확인 경고
  if (nextIdx === 1) {
    alert('간혹 주말이나 공휴일을 끼고 시험을 보는 경우도 있으니, 2일차 시험 날짜가 맞는지 꼭 확인하세요!');
    day2WarningShown = true;
  }

  currentSettingsDayIndex = nextIdx;
  renderSettingsDayTabs();
  loadCurrentSettingsDayTable();
}

function deleteCurrentDayTab() {
  if (settingsEditingDays.length <= 1) {
    alert('최소 1일 이상의 시험 일정이 있어야 합니다.');
    return;
  }
  if (confirm(`'${settingsEditingDays[currentSettingsDayIndex].name}' 시험 일정을 삭제하시겠습니까?`)) {
    settingsEditingDays.splice(currentSettingsDayIndex, 1);
    currentSettingsDayIndex = Math.max(0, currentSettingsDayIndex - 1);
    renderSettingsDayTabs();
    loadCurrentSettingsDayTable();
  }
}

function onCurrentDayMetaChange() {
  const nameInput = document.getElementById('currentDayNameInput');
  const dateInput = document.getElementById('currentDayDateInput');
  if (settingsEditingDays[currentSettingsDayIndex]) {
    settingsEditingDays[currentSettingsDayIndex].name = nameInput.value;
    settingsEditingDays[currentSettingsDayIndex].date = dateInput.value;
    renderSettingsDayTabs();
  }
}

// 스크롤바 없는 컴팩트 고시인성 교시 테이블
function loadCurrentSettingsDayTable() {
  const currentDay = settingsEditingDays[currentSettingsDayIndex];
  if (!currentDay) return;

  document.getElementById('currentDayNameInput').value = currentDay.name || '';
  document.getElementById('currentDayDateInput').value = currentDay.date || '';

  const weekendNotice = document.getElementById('dayWeekendNotice');
  if (weekendNotice) {
    if (currentSettingsDayIndex >= 1) {
      weekendNotice.classList.remove('hidden');
    } else {
      weekendNotice.classList.add('hidden');
    }
  }

  const timetable = currentDay.timetable || [];
  const tbody = document.getElementById('periodTableBody');

  tbody.innerHTML = timetable.map((p, idx) => `
    <tr data-index="${idx}" class="hover:bg-slate-50 transition border-b border-slate-100">
      <td class="py-1.5 px-2 text-center">
        <input type="text" class="period-name-input w-14 bg-slate-50 border border-slate-300 rounded px-1.5 py-0.5 text-center font-bold text-slate-800 text-xs" value="${p.name || `${idx + 1}교시`}">
      </td>
      <td class="py-1.5 px-2 text-center">
        <div class="flex items-center justify-center gap-1">
          <input type="time" oninput="onPeriodStartInput(${idx}, this)" class="period-start-input bg-blue-50/60 border border-blue-300 rounded px-1.5 py-0.5 text-blue-900 font-mono font-bold focus:bg-white text-xs" value="${p.startTime || '09:10'}">
          <span class="text-slate-400 text-xs">➔</span>
          <input type="time" class="period-end-input bg-slate-100 border border-slate-300 rounded px-1.5 py-0.5 text-slate-800 font-mono font-bold text-xs" value="${p.endTime || calculateEndTime(p.startTime || '09:10', settingsDuration)}">
        </div>
      </td>
      <td class="py-1.5 px-2">
        <input type="text" class="grade-subject-1 w-full bg-slate-50 border border-slate-300 rounded px-2 py-0.5 text-blue-700 font-bold text-xs" value="${(p.grades && p.grades['1']) || ''}" placeholder="1학년 과목">
      </td>
      <td class="py-1.5 px-2">
        <input type="text" class="grade-subject-2 w-full bg-slate-50 border border-slate-300 rounded px-2 py-0.5 text-emerald-700 font-bold text-xs" value="${(p.grades && p.grades['2']) || ''}" placeholder="2학년 과목">
      </td>
      <td class="py-1.5 px-2">
        <input type="text" class="grade-subject-3 w-full bg-slate-50 border border-slate-300 rounded px-2 py-0.5 text-purple-700 font-bold text-xs" value="${(p.grades && p.grades['3']) || ''}" placeholder="3학년 과목">
      </td>
      <td class="py-1.5 px-2 text-center">
        <button type="button" onclick="deletePeriodRow(${idx})" class="text-slate-400 hover:text-red-600 p-1 rounded transition" title="이 교시 삭제">
          <i data-lucide="x" class="w-3.5 h-3.5"></i>
        </button>
      </td>
    </tr>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function saveCurrentTableToMemory() {
  const currentDay = settingsEditingDays[currentSettingsDayIndex];
  if (!currentDay) return;

  const rows = document.querySelectorAll('#periodTableBody tr');
  const result = [];

  rows.forEach((row, i) => {
    const name = row.querySelector('.period-name-input').value;
    const startTime = row.querySelector('.period-start-input').value;
    const endTime = row.querySelector('.period-end-input').value;
    const sub1 = row.querySelector('.grade-subject-1').value;
    const sub2 = row.querySelector('.grade-subject-2').value;
    const sub3 = row.querySelector('.grade-subject-3').value;
    result.push({
      period: i + 1,
      name,
      startTime,
      endTime,
      grades: { "1": sub1, "2": sub2, "3": sub3 }
    });
  });

  currentDay.timetable = result;
}

function addPeriodRow() {
  saveCurrentTableToMemory();
  const currentDay = settingsEditingDays[currentSettingsDayIndex];
  const nextNum = (currentDay.timetable.length || 0) + 1;

  // 이전 교시의 종료시간을 참고하여 +20분 쉬는시간 뒤 시작시간 자동 설정
  let nextStart = "13:00";
  if (currentDay.timetable.length > 0) {
    const lastEnd = currentDay.timetable[currentDay.timetable.length - 1].endTime;
    if (lastEnd) {
      nextStart = calculateEndTime(lastEnd, 20); // 쉬는시간 20분
    }
  }

  currentDay.timetable.push({
    period: nextNum,
    name: `${nextNum}교시`,
    startTime: nextStart,
    endTime: calculateEndTime(nextStart, settingsDuration),
    grades: { "1": "", "2": "", "3": "" }
  });

  loadCurrentSettingsDayTable();
}

function deletePeriodRow(idx) {
  saveCurrentTableToMemory();
  const currentDay = settingsEditingDays[currentSettingsDayIndex];
  currentDay.timetable.splice(idx, 1);
  currentDay.timetable.forEach((item, i) => { item.period = i + 1; });
  loadCurrentSettingsDayTable();
}

function saveSettings() {
  saveCurrentTableToMemory();
  const examTitle = document.getElementById('settingExamTitle').value.trim();
  const clockCheckbox = document.getElementById('settingsShowClock');
  const showClock = clockCheckbox ? clockCheckbox.checked : true;

  api.updateSettings(currentSchool.id, {
    examTitle,
    defaultDuration: settingsDuration,
    currentDayIndex: currentSettingsDayIndex,
    days: settingsEditingDays,
    showClock
  });

  currentSchool.showClock = showClock;
  updateClockStatusBadge(showClock);
  updateClockVisibility();

  closeSettingsModal();
  alert('모든 일차의 시험 시간표가 저장되었으며, 전체 교실 전자칠판에 실시간 반영되었습니다!');
}

// ==============================================================
// 9. 정정사항 등록 모달 로직
// ==============================================================

// ==============================================================
// 9. 문제 정정사항 등록 모달 및 사진 첨부 (1장 제한 & 압축)
// ==============================================================

let currentNoticeImageBase64 = null;

function handleNoticeImageSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  processNoticeImageFile(file);
}

function processNoticeImageFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('이미지 파일(JPG, PNG, GIF 등)만 첨부할 수 있습니다.');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.onload = function() {
      // 최대 해상도 1600px로 리사이징 및 압축하여 전송 부담 최소화
      const maxDim = 1600;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      currentNoticeImageBase64 = compressedDataUrl;

      // 미리보기 UI 업데이트
      const uploadArea = document.getElementById('noticeImageUploadArea');
      const previewArea = document.getElementById('noticeImagePreviewArea');
      const previewImg = document.getElementById('noticeImagePreviewImg');
      const nameEl = document.getElementById('noticeImageFileName');
      const sizeEl = document.getElementById('noticeImageFileSize');

      if (uploadArea) uploadArea.classList.add('hidden');
      if (previewArea) previewArea.classList.remove('hidden');
      if (previewImg) previewImg.src = compressedDataUrl;
      if (nameEl) nameEl.innerText = file.name || '캡처사진.jpg';
      const approxKb = Math.round((compressedDataUrl.length * 3 / 4) / 1024);
      if (sizeEl) sizeEl.innerText = `${approxKb} KB`;
      if (window.lucide) lucide.createIcons();
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

function removeNoticeImage() {
  currentNoticeImageBase64 = null;
  const fileInput = document.getElementById('noticeImageFileInput');
  if (fileInput) fileInput.value = '';
  const uploadArea = document.getElementById('noticeImageUploadArea');
  const previewArea = document.getElementById('noticeImagePreviewArea');
  if (uploadArea) uploadArea.classList.remove('hidden');
  if (previewArea) previewArea.classList.add('hidden');
}

// 캡처 후 즉시 붙여넣기(Ctrl+V) 지원
document.addEventListener('paste', (e) => {
  const modal = document.getElementById('noticeModal');
  if (!modal || modal.classList.contains('hidden')) return;

  const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (file) {
        processNoticeImageFile(file);
        e.preventDefault();
        break;
      }
    }
  }
});

// 라이트박스 (사진 확대 보기)
function openImageModal(src) {
  const modal = document.getElementById('imageLightboxModal');
  const img = document.getElementById('lightboxImage');
  const downloadBtn = document.getElementById('lightboxDownloadBtn');
  if (!modal || !img) return;

  img.src = src;
  if (downloadBtn) downloadBtn.href = src;
  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeImageModal() {
  const modal = document.getElementById('imageLightboxModal');
  if (modal) modal.classList.add('hidden');
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeImageModal();
});

function openNoticeModal() {
  populateNoticePeriods();
  selectNoticeGrade('1');
  removeNoticeImage();
  document.getElementById('noticeModal').classList.remove('hidden');
  document.getElementById('noticeContentInput').focus();
  if (window.lucide) lucide.createIcons();
}

function closeNoticeModal() {
  document.getElementById('noticeModal').classList.add('hidden');
  removeNoticeImage();
}

// 현재 시각에 맞춰 진행 중인 교시 또는 다음 교시 자동 탐색
function findCurrentPeriod(timetable) {
  if (!timetable || timetable.length === 0) return null;
  const now = getNow();
  const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  // 1. 현재 진행 중인 교시 탐색 (startMins <= currentMinutes < endMins + 1)
  // 예: 10:00 ~ 10:45 이면 10:45:59까지 2교시 진행 중으로 인정
  for (const item of timetable) {
    if (!item.startTime || !item.endTime) continue;
    const [sH, sM] = item.startTime.split(':').map(Number);
    const [eH, eM] = item.endTime.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const endMins = eH * 60 + eM + 1;
    if (currentMinutes >= startMins && currentMinutes < endMins) {
      return { item, status: 'in_progress' };
    }
  }

  // 2. 쉬는 시간 또는 시험 시작 전: 가장 가까운 다음 교시 탐색
  for (const item of timetable) {
    if (!item.startTime) continue;
    const [sH, sM] = item.startTime.split(':').map(Number);
    const startMins = sH * 60 + sM;
    if (currentMinutes < startMins) {
      return { item, status: 'upcoming' };
    }
  }

  // 3. 당일 모든 시험이 종료된 후: 마지막 교시
  return { item: timetable[timetable.length - 1], status: 'ended' };
}

function populateNoticePeriods() {
  const select = document.getElementById('noticePeriodSelect');
  const autoBadge = document.getElementById('noticeAutoPeriodBadge');
  const expiryBadge = document.getElementById('noticeAutoExpiryBadge');
  const timetable = getCurrentActiveTimetable();

  if (timetable.length === 0) {
    if (select) select.value = '1';
    if (autoBadge) autoBadge.innerText = '1교시';
    if (expiryBadge) expiryBadge.innerText = '시험 종료 시 자동 삭제';
    onNoticeGradeChange();
    return;
  }

  const detected = findCurrentPeriod(timetable);
  const targetPeriod = detected ? detected.item.period : timetable[0].period;
  if (select) select.value = targetPeriod;

  if (detected) {
    const item = detected.item;
    if (autoBadge) {
      if (detected.status === 'in_progress') {
        autoBadge.className = "px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-black text-xs shadow-xs";
        autoBadge.innerText = `⚡ ${item.name} (${item.startTime}~${item.endTime})`;
      } else if (detected.status === 'upcoming') {
        autoBadge.className = "px-2.5 py-1 rounded-lg bg-blue-600 text-white font-black text-xs shadow-xs";
        autoBadge.innerText = `⏳ 다음 ${item.name} (${item.startTime}~${item.endTime})`;
      } else {
        autoBadge.className = "px-2.5 py-1 rounded-lg bg-slate-600 text-white font-black text-xs shadow-xs";
        autoBadge.innerText = `🏁 오늘 시험 종료 (${item.name})`;
      }
    }

    if (expiryBadge && item.endTime) {
      const [eH, eM] = item.endTime.split(':').map(Number);
      const nextMinuteStr = `${String(eH).padStart(2, '0')}:${String(eM + 1).padStart(2, '0')}:00`;
      expiryBadge.innerText = `${nextMinuteStr} 자동 삭제 예정`;
    }
  }

  onNoticeGradeChange();
}

// 대상 학년 (1학년 / 2학년 / 3학년 / 전학년) 선택 및 UI 업데이트
function selectNoticeGrade(grade) {
  const g = String(grade);
  const hiddenVal = document.getElementById('noticeTargetGradeValue');
  if (hiddenVal) hiddenVal.value = g;

  const radios = document.querySelectorAll('input[name="targetGrade"]');
  radios.forEach(r => {
    r.checked = (r.value === g);
  });

  const btn1 = document.getElementById('gradeBtn1');
  const btn2 = document.getElementById('gradeBtn2');
  const btn3 = document.getElementById('gradeBtn3');
  const btnAll = document.getElementById('gradeBtnAll');
  const badge = document.getElementById('targetGradeBadge');

  const inactiveClass = "flex items-center justify-center py-2.5 px-1 rounded-xl border-2 border-slate-200 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50 font-extrabold text-xs cursor-pointer shadow-2xs transition";

  if (btn1) {
    btn1.className = (g === '1')
      ? "flex items-center justify-center py-2.5 px-1 rounded-xl border-2 border-blue-600 bg-blue-600 text-white font-black text-xs cursor-pointer shadow-sm ring-2 ring-blue-300 transition"
      : inactiveClass;
  }
  if (btn2) {
    btn2.className = (g === '2')
      ? "flex items-center justify-center py-2.5 px-1 rounded-xl border-2 border-emerald-600 bg-emerald-600 text-white font-black text-xs cursor-pointer shadow-sm ring-2 ring-emerald-300 transition"
      : inactiveClass;
  }
  if (btn3) {
    btn3.className = (g === '3')
      ? "flex items-center justify-center py-2.5 px-1 rounded-xl border-2 border-purple-600 bg-purple-600 text-white font-black text-xs cursor-pointer shadow-sm ring-2 ring-purple-300 transition"
      : inactiveClass;
  }
  if (btnAll) {
    btnAll.className = (g === 'all')
      ? "flex items-center justify-center py-2.5 px-1 rounded-xl border-2 border-amber-600 bg-amber-600 text-white font-black text-xs cursor-pointer shadow-sm ring-2 ring-amber-300 transition"
      : inactiveClass;
  }

  if (badge) {
    if (g === '1') {
      badge.innerText = '1학년 선택됨';
      badge.className = 'text-[11px] font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200';
    } else if (g === '2') {
      badge.innerText = '2학년 선택됨';
      badge.className = 'text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200';
    } else if (g === '3') {
      badge.innerText = '3학년 선택됨';
      badge.className = 'text-[11px] font-extrabold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200';
    } else {
      badge.innerText = '전학년 공통';
      badge.className = 'text-[11px] font-extrabold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200';
    }
  }

  onNoticeGradeChange();
}

function onNoticeGradeChange() {
  const gradeVal = document.getElementById('noticeTargetGradeValue')?.value ||
                   document.querySelector('input[name="targetGrade"]:checked')?.value || '1';
  const periodVal = Number(document.getElementById('noticePeriodSelect')?.value || 1);
  const subInput = document.getElementById('noticeSubjectInput');

  if (gradeVal === 'all') {
    subInput.value = '전과목 공통';
    return;
  }

  const timetable = getCurrentActiveTimetable();
  const periodObj = timetable.find(p => p.period === periodVal);
  if (periodObj && periodObj.grades && periodObj.grades[gradeVal]) {
    subInput.value = periodObj.grades[gradeVal];
  }
}

function onNoticePeriodChange() {
  onNoticeGradeChange();
  const select = document.getElementById('noticePeriodSelect');
  const badge = document.getElementById('noticePeriodAutoBadge');
  const hint = document.getElementById('noticePeriodHint');
  const timetable = getCurrentActiveTimetable();
  const periodVal = Number(select?.value || 1);
  const periodObj = timetable.find(p => p.period === periodVal);

  if (badge) {
    badge.className = "text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200";
    badge.innerText = `선생님 직접 선택`;
  }
  if (hint && periodObj && periodObj.endTime) {
    const [eH, eM] = periodObj.endTime.split(':').map(Number);
    const nextMinuteStr = `${String(eH).padStart(2, '0')}:${String(eM + 1).padStart(2, '0')}:00`;
    hint.innerHTML = `선택하신 [${periodObj.name}] 시험 종료 후(<span class="font-bold text-red-600">${periodObj.endTime}</span> 직후 <span class="font-bold text-red-600">${nextMinuteStr}</span>) 전 교실 화면에서 자동 삭제됩니다.`;
  }
}

function applyTemplate(type) {
  const contentInput = document.getElementById('noticeContentInput');
  const gradeVal = document.getElementById('noticeTargetGradeValue')?.value ||
                   document.querySelector('input[name="targetGrade"]:checked')?.value || '1';
  const subjectVal = document.getElementById('noticeSubjectInput').value.trim();
  const prefix = gradeVal === 'all' ? `[전학년 공통]` : `[${gradeVal}학년 ${subjectVal}]`;

  let text = '';
  switch (type) {
    case 'fix_item':
      text = `${prefix} 15번 문항: 보기 3번 "OO"을(를) "OO"으로 수정하세요.`;
      break;
    case 'add_condition':
      text = `${prefix} 서술형 2번 문항 조건 추가: "단, 결과값은 자연수로 표기할 것"`;
      break;
    case 'typo':
      text = `${prefix} 시험지 2쪽 8번 문항 3번째 줄 "OO" ➔ "OO" 오탈자 정정`;
      break;
    case 'time_extend':
      text = `${prefix} 시험 종료 시각이 방송 지연으로 인해 5분 연장되었습니다.`;
      break;
  }
  contentInput.value = text;
  contentInput.focus();
}

function handleNoticeSubmit(e) {
  e.preventDefault();
  const grade = document.getElementById('noticeTargetGradeValue')?.value ||
                document.querySelector('input[name="targetGrade"]:checked')?.value || '1';
  const period = document.getElementById('noticePeriodSelect').value;
  const subject = document.getElementById('noticeSubjectInput').value.trim();
  const content = document.getElementById('noticeContentInput').value.trim();

  if (!content) {
    alert('전달할 정정 내용을 입력하세요.');
    return;
  }

  const timetable = getCurrentActiveTimetable();
  const periodObj = timetable.find(p => p.period === Number(period));

  api.addNotice(currentSchool.id, {
    grade,
    period,
    periodName: periodObj ? periodObj.name : `${period}교시`,
    subject,
    content,
    endTime: periodObj ? periodObj.endTime : null,
    imageUrl: currentNoticeImageBase64, // 1장 사진 전송
    teacher: '출제교사'
  });

  closeNoticeModal();
  document.getElementById('noticeContentInput').value = '';
  removeNoticeImage();
}

// ==============================================================
// 10. 사운드 및 공유 클립보드 도구
// ==============================================================

let audioCtx = null;
function initAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}
document.addEventListener('click', initAudioContext, { once: true });

function playSchoolChime() {
  try {
    initAudioContext();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    playTone(783.99, now, 0.45, 0.3);        // G5
    playTone(1046.50, now + 0.35, 0.7, 0.35); // C6
  } catch (err) {
    console.error('오디오 재생 실패:', err);
  }
}

function playTone(freq, startTime, duration, volume = 0.3) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

const soundToggleBtn = document.getElementById('soundToggleBtn');
soundToggleBtn.addEventListener('click', () => {
  initAudioContext();
  soundEnabled = !soundEnabled;
  localStorage.setItem('exam_board_sound', soundEnabled ? 'true' : 'false');
  updateSoundUI();
  if (soundEnabled) playSchoolChime();
});

function updateSoundUI() {
  const soundIcon = document.getElementById('soundIcon');
  const soundLabel = document.getElementById('soundLabel');
  if (!soundIcon) return;
  if (soundEnabled) {
    soundIcon.setAttribute('data-lucide', 'volume-2');
    soundIcon.className = "w-4 h-4 text-blue-600";
    if (soundLabel) soundLabel.innerText = "소리 켬";
  } else {
    soundIcon.setAttribute('data-lucide', 'volume-x');
    soundIcon.className = "w-4 h-4 text-rose-500";
    if (soundLabel) soundLabel.innerText = "소리 끔";
  }
  if (window.lucide) lucide.createIcons();
}

document.getElementById('fullscreenBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => console.warn(err));
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
  }
});

function getBaseUrl() {
  return window.location.origin;
}

function copyDirectClassUrl() {
  if (!currentSchool) return;
  const code = currentSchool.roomCode || '';
  const url = `${getBaseUrl()}?code=${code}`;
  navigator.clipboard.writeText(url).then(() => {
    alert(`우리 학교 교실 칠판 바로가기 주소가 복사되었습니다!\n\n${url}\n\n교실 칠판 브라우저에서 이 주소를 열면 코드 입력 없이 1초 만에 바로 입장됩니다.`);
  }).catch(() => prompt('아래 주소를 복사하세요:', url));
}

function copyAdminBookmarkUrl() {
  if (!currentSchool) return;
  const code = currentSchool.roomCode || '';
  const url = `${getBaseUrl()}?adminCode=${code}`;
  navigator.clipboard.writeText(url).then(() => {
    alert(`교사용 전용 즐겨찾기 URL이 복사되었습니다!\n\n${url}\n\n이 주소를 브라우저 북마크에 등록해두시면 학교 검색 없이 바로 로그인 화면으로 연결됩니다.`);
  }).catch(() => prompt('아래 주소를 복사하여 브라우저 북마크에 추가하세요:', url));
}

function copyMessengerText() {
  if (!currentSchool) return;
  const domain = window.location.hostname === 'localhost' ? 'www.lifeforteacher.com' : window.location.host;
  const code = currentSchool.roomCode || '------';
  const directUrl = `${getBaseUrl()}?code=${code}`;

  const template = `[교무실 시험상황실 알림]
선생님들 수고 많으십니다.
오늘 시험 정정사항은 각 학급 전자칠판으로 실시간 전달됩니다.

■ 교실 전자칠판 초간편 접속 방법:
1) 사이트 접속: ${domain}
2) 우리 학교 6자리 코드 입력: [ ${code} ]
(또는 직통 바로가기 링크: ${directUrl} )

■ 전자칠판 세팅 안내:
- 키보드 [F11] 또는 우측 상단 [전체화면]을 누르세요.
- 우리 학년만 남겨두고 다른 학년은 [가리기]를 누르시면 큼직하게 보입니다.

※ 출제 선생님께서는 시험지 정정사항 발생 시 교무실(연구부)로 메신저 쪽지 주시면 즉시 모든 교실 전자칠판으로 띄워드립니다.`;

  navigator.clipboard.writeText(template).then(() => {
    alert('사내 메신저(쿨메신저/티셀파 등) 공지문이 복사되었습니다!\n메신저 전체 쪽지 창에 [Ctrl + V] 로 붙여넣으세요.');
  }).catch(() => prompt('아래 문구를 복사하여 메신저에 붙여넣으세요:', template));
}

function escapeHtml(string) {
  if (!string) return '';
  // 기존 DB에 저장되어 있을 수 있는 이중 인코딩 엔티티(&quot;, &#39;, &amp; 등) 완벽 복원
  return String(string)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // 악성 스크립트 실행 방지 (XSS 방어)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ==============================================================
// 🏫 [학교 인트라넷/독립형 전용] 서버 정보 감지 및 전자칠판 QR 연동
// ==============================================================
let serverInfoState = null;
let serverQrCodeInstance = null;

async function initServerInfoBanner() {
  try {
    const res = await fetch('/api/server-info', { cache: 'no-store' });
    if (!res.ok) return;
    const info = await res.json();
    if (!info || !info.primaryUrl) return;

    serverInfoState = info;
    const banner = document.getElementById('intranetBanner');
    const display = document.getElementById('intranetIpDisplay');

    if (banner && display) {
      display.innerText = info.primaryUrl;
      banner.classList.remove('hidden');
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    }
  } catch (err) {
    // 외부 웹 클라우드 배포 등 API 미지원 환경에서는 무시
  }
}

function getClassroomDirectUrl() {
  let base = serverInfoState && serverInfoState.primaryUrl ? serverInfoState.primaryUrl : window.location.origin;
  if (currentSchool && currentSchool.roomCode) {
    return `${base}/?code=${currentSchool.roomCode}`;
  }
  return base;
}

function openServerQrModal() {
  const modal = document.getElementById('serverQrModal');
  const canvasContainer = document.getElementById('serverQrCanvas');
  const urlDisplay = document.getElementById('serverQrUrlText');
  if (!modal || !canvasContainer) return;

  const targetUrl = getClassroomDirectUrl();
  if (urlDisplay) urlDisplay.innerText = targetUrl;

  canvasContainer.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    serverQrCodeInstance = new QRCode(canvasContainer, {
      text: targetUrl,
      width: 200,
      height: 200,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } else {
    canvasContainer.innerHTML = `<div class="p-4 text-xs text-slate-500 font-bold">${targetUrl}</div>`;
  }

  modal.classList.remove('hidden');
  if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function closeServerQrModal() {
  const modal = document.getElementById('serverQrModal');
  if (modal) modal.classList.add('hidden');
}

function copyClassroomUrl() {
  const url = getClassroomDirectUrl();
  navigator.clipboard.writeText(url).then(() => {
    alert(`[전자칠판 접속 주소 복사 완료]\n\n${url}\n\n교내 메신저나 전자칠판 브라우저에 붙여넣어 주세요.`);
  }).catch(() => {
    prompt('아래 주소를 복사하세요:', url);
  });
}

function copyClassroomNoticeText() {
  const code = currentSchool ? currentSchool.roomCode : '------';
  const url = getClassroomDirectUrl();
  const schoolName = currentSchool ? currentSchool.name : '우리 학교';

  const text = `[📢 ${schoolName} 정기고사 실시간 시험상황실 알림]
선생님, 오늘 시험 정정사항 및 시간표는 각 교실 전자칠판으로 실시간 동기화됩니다.

■ 교실 전자칠판 접속 안내:
1) 전자칠판 브라우저(크롬, 웨일 등) 실행
2) 주소창에 아래 주소 입력 (또는 연구부 배부 QR 코드 스캔):
   👉 ${url}
3) 시험실 코드: [ ${code} ]

※ 키보드 [F11]을 누르시면 전체화면으로 시원하게 보실 수 있습니다.
※ 문제 정정사항 발생 시 교무실(연구부)로 전달해 주시면 전 교실 전자칠판에 0.1초 만에 자동 전송됩니다.`;

  navigator.clipboard.writeText(text).then(() => {
    alert('교내 메신저(쿨메신저/쪽지) 공지문이 복사되었습니다!\n메신저에 [Ctrl + V] 로 붙여넣으세요.');
  }).catch(() => {
    prompt('아래 문구를 복사하여 메신저에 붙여넣으세요:', text);
  });
}

