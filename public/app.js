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

// ==============================================================
// 1. 초기화 및 테마 설정
// ==============================================================

window.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  fetchSchoolList();
  checkRecentSchool();
  checkUrlParamsForAutoJoin();
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

// 로비 3개 탭 전환: code(교실 코드입장) / admin(연구부장 로그인) / create(새 학교 개설)
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
  }
  if (window.lucide) lucide.createIcons();
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
    if (!password) {
      alert('교사용(관리자) 비밀번호를 입력해 주세요.');
      document.getElementById('adminPasswordInput')?.focus();
      return;
    }
  }

  try {
    const { ok, data } = await api.authByCode(code, role, password);
    if (!ok) {
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
      infoEl.innerText = `코드: ${recent.roomCode || '------'} · ${recent.role === 'teacher' ? '연구부장 관리자 모드' : '교실 칠판 열람 모드'}`;
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
      switchLobbyTab('admin');
      const codeInput = document.getElementById('adminRoomCodeInput');
      if (codeInput) codeInput.value = recent.roomCode || '';
      document.getElementById('adminPasswordInput')?.focus();
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
  const classPass = document.getElementById('createClassPass').value.trim();
  const defaultDuration = Number(document.querySelector('input[name="createDuration"]:checked')?.value || 50);

  if (!name) {
    alert('학교 이름을 입력해 주세요.');
    return;
  }
  if (!teacherPass || !classPass) {
    alert('교사용 비밀번호와 학생(교실)용 비밀번호를 모두 입력해 주세요.');
    return;
  }

  if (teacherPass.length < 4) {
    alert('보안을 위해 교사용 비밀번호는 최소 4자리 이상으로 설정해 주세요.');
    document.getElementById('createTeacherPass').focus();
    return;
  }

  if (teacherPass === classPass) {
    alert('교사용 비밀번호와 학생(교실)용 비밀번호는 서로 다르게 입력해야 합니다!\n\n(동일하게 설정하면 학생과 교사 권한을 구분할 수 없습니다.)');
    document.getElementById('createClassPass').focus();
    return;
  }

  try {
    const { ok, data } = await api.createSchool({ region, name, examTitle, defaultDuration, teacherPass, classPass });
    if (!ok) {
      alert(data.error || '개설에 실패했습니다.');
      return;
    }

    if (data.teacherToken) {
      api.setTeacherToken(data.teacherToken);
    }

    saveRecentSchool(data.school, 'teacher');
    enterExamBoard(data.school, 'teacher', { classPass, teacherPass });
    showWelcomeGuideModal(data.school, teacherPass, classPass, data.wasRenamed);
  } catch (err) {
    console.error('개설 에러:', err);
    alert('서버와 통신 중 오류가 발생했습니다.');
  }
}

// 개설 완료 환영 모달 팝업
function showWelcomeGuideModal(school, teacherPass, classPass, wasRenamed) {
  const modal = document.getElementById('welcomeGuideModal');
  const title = document.getElementById('welcomeSchoolTitle');
  const roomCodeEl = document.getElementById('welcomeRoomCode');
  const tPass = document.getElementById('welcomeTeacherPass');
  const cPass = document.getElementById('welcomeClassPass');

  title.innerText = wasRenamed 
    ? `${school.name} (동명 학교 자동 넘버링 완료)` 
    : `${school.name} 시험상황실 개설 완료!`;

  if (roomCodeEl) {
    const code = String(school.roomCode || '------');
    roomCodeEl.innerText = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
  }

  tPass.innerText = teacherPass;
  cPass.innerText = classPass;

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

function checkPasswordMismatch() {
  const teacherPass = document.getElementById('createTeacherPass').value.trim();
  const classPass = document.getElementById('createClassPass').value.trim();
  const warning = document.getElementById('passwordMismatchWarning');

  if (teacherPass && classPass && teacherPass === classPass) {
    warning.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  } else {
    warning.classList.add('hidden');
  }
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

  document.getElementById('lobbyView').classList.add('hidden');
  document.getElementById('examBoardView').classList.remove('hidden');

  api.joinRoom(school.id);

  document.getElementById('schoolBadge').innerText = school.name;
  document.getElementById('examTitleDisplay').innerText = school.examTitle || '시험상황실';

  const roomCodeBadge = document.getElementById('headerRoomCodeBadge');
  if (roomCodeBadge) {
    roomCodeBadge.innerText = `코드: ${school.roomCode || '------'}`;
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

  if (role === 'teacher') {
    if (roleBadge) {
      roleBadge.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-900 text-white shadow-xs shrink-0";
      roleBadge.innerHTML = '● 관리 모드';
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
  } else {
    if (roleBadge) {
      roleBadge.className = "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-blue-100 text-blue-700 border border-blue-200 shrink-0";
      roleBadge.innerHTML = '● 교실 칠판';
    }
    if (teacherControls) teacherControls.classList.add('hidden');
    if (teacherNoticeBar) teacherNoticeBar.classList.add('hidden');

    // 학생/교실 전용: 한 줄 시계 전광판 및 칠판 표시
    if (clockSection) clockSection.classList.remove('hidden');
    if (teacherTimeBadge) teacherTimeBadge.classList.add('hidden');
    if (teacherDash) teacherDash.classList.add('hidden');
    if (classroomBoard) classroomBoard.classList.remove('hidden');

    applyHiddenGradesToUI();
    renderHeroSubjects();
    renderNotices();
  }

  updateClockAndTimer();
  if (window.lucide) lucide.createIcons();
}

// 교사용: 관리자 콘솔 <-> 교실 칠판 화면 미리보기 전환
function toggleClassroomPreview() {
  teacherPreviewMode = !teacherPreviewMode;
  const teacherDash = document.getElementById('teacherDashboardView');
  const classroomBoard = document.getElementById('classroomBoardView');
  const clockSection = document.getElementById('clockSection');
  const teacherTimeBadge = document.getElementById('teacherTimeBadge');
  const previewBanner = document.getElementById('teacherPreviewBanner');

  if (teacherPreviewMode) {
    teacherDash.classList.add('hidden');
    classroomBoard.classList.remove('hidden');
    clockSection.classList.remove('hidden');
    teacherTimeBadge.classList.add('hidden');
    previewBanner?.classList.remove('hidden');
    applyHiddenGradesToUI();
    renderHeroSubjects();
    renderNotices();
  } else {
    teacherDash.classList.remove('hidden');
    classroomBoard.classList.add('hidden');
    clockSection.classList.add('hidden');
    teacherTimeBadge.classList.remove('hidden');
    previewBanner?.classList.add('hidden');
    renderTeacherNotices();
    renderTeacherTodayTimetable();
  }
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

// 현재 활성화된 일차의 시간표 가져오기
function getCurrentActiveTimetable() {
  if (!currentSchool) return [];
  const days = currentSchool.days || [];
  const idx = currentSchool.currentDayIndex || 0;
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

function updateClockAndTimer() {
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

  const periodStatusEl = document.getElementById('currentPeriodStatus');
  const countdownLabelEl = document.getElementById('countdownLabel');
  const countdownValueEl = document.getElementById('countdownValue');

  if (activePeriod) {
    if (periodStatusEl) {
      periodStatusEl.className = "font-black text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded animate-pulse";
      periodStatusEl.innerText = `● ${activePeriod.name} 시험 진행 중`;
    }

    if (teacherPeriod) {
      teacherPeriod.className = "text-emerald-700 font-black";
      teacherPeriod.innerText = `${activePeriod.name} 진행 중 (${activePeriod.startTime} ~ ${activePeriod.endTime})`;
    }

    const diffSeconds = Math.max(0, Math.floor((activePeriod.endMins - currentMinutes) * 60));
    const remM = Math.floor(diffSeconds / 60);
    const remS = diffSeconds % 60;
    
    if (countdownLabelEl) countdownLabelEl.innerText = "종료까지";
    if (countdownValueEl) {
      countdownValueEl.innerText = `${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
      countdownValueEl.className = diffSeconds <= 300 
        ? "text-base md:text-lg font-black font-mono tracking-tight text-rose-400 animate-ping" 
        : "text-base md:text-lg font-black font-mono tracking-tight text-amber-300";
    }
  } else if (nextPeriod) {
    if (periodStatusEl) {
      periodStatusEl.className = "font-black text-blue-700 bg-blue-100 px-2.5 py-0.5 rounded";
      periodStatusEl.innerText = `⏳ 쉬는 시간 (${nextPeriod.name} ${nextPeriod.startTime} 시작)`;
    }

    if (teacherPeriod) {
      teacherPeriod.className = "text-blue-700 font-bold";
      teacherPeriod.innerText = `쉬는 시간 (다음: ${nextPeriod.name} ${nextPeriod.startTime})`;
    }

    const diffSeconds = Math.max(0, Math.floor((nextPeriod.startMins - currentMinutes) * 60));
    const remM = Math.floor(diffSeconds / 60);
    const remS = diffSeconds % 60;

    if (countdownLabelEl) countdownLabelEl.innerText = `${nextPeriod.name || '다음'} 시작까지`;
    if (countdownValueEl) {
      countdownValueEl.innerText = `${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
      countdownValueEl.className = "text-base md:text-lg font-black font-mono tracking-tight text-slate-300";
    }
  } else {
    if (periodStatusEl) {
      periodStatusEl.className = "font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded";
      periodStatusEl.innerText = "오늘 시험 일정 종료";
    }

    if (teacherPeriod) {
      teacherPeriod.className = "text-slate-500 font-medium";
      teacherPeriod.innerText = "오늘 모든 시험 종료";
    }

    if (countdownLabelEl) countdownLabelEl.innerText = "상태";
    if (countdownValueEl) {
      countdownValueEl.innerText = "종료";
      countdownValueEl.className = "text-base md:text-lg font-black font-mono tracking-tight text-slate-400";
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
    if (periodObj && periodObj.endTime) {
      const [eH, eM] = periodObj.endTime.split(':').map(Number);
      if (currentMinutes >= (eH * 60 + eM)) {
        hasExpired = true;
        return false;
      }
    }
    return true;
  });

  if (hasExpired) {
    renderNotices();
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
    const d = new Date(prevDate);
    d.setDate(d.getDate() + 1);
    nextDateStr = d.toISOString().split('T')[0];
  }

  // 1일차 구조 복사하여 새 일차 생성
  const templateTable = [
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

  api.updateSettings(currentSchool.id, {
    examTitle,
    defaultDuration: settingsDuration,
    currentDayIndex: currentSettingsDayIndex,
    days: settingsEditingDays
  });

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
  onNoticeGradeChange();
  removeNoticeImage();
  document.getElementById('noticeModal').classList.remove('hidden');
  document.getElementById('noticeContentInput').focus();
  if (window.lucide) lucide.createIcons();
}

function closeNoticeModal() {
  document.getElementById('noticeModal').classList.add('hidden');
  removeNoticeImage();
}

function populateNoticePeriods() {
  const select = document.getElementById('noticePeriodSelect');
  const timetable = getCurrentActiveTimetable();
  if (timetable.length === 0) {
    select.innerHTML = '<option value="1">1교시</option>';
    return;
  }
  select.innerHTML = timetable.map(item => `
    <option value="${item.period}">${item.name} (${item.startTime} ~ ${item.endTime})</option>
  `).join('');
}

function onNoticeGradeChange() {
  const gradeVal = document.querySelector('input[name="targetGrade"]:checked')?.value || '1';
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
}

function applyTemplate(type) {
  const contentInput = document.getElementById('noticeContentInput');
  const gradeVal = document.querySelector('input[name="targetGrade"]:checked')?.value || '1';
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
  const grade = document.querySelector('input[name="targetGrade"]:checked')?.value || '1';
  const period = document.getElementById('noticePeriodSelect').value;
  const subject = document.getElementById('noticeSubjectInput').value.trim();
  const content = document.getElementById('noticeContentInput').value.trim();

  if (!content) {
    alert('전달할 정정 내용을 입력하세요.');
    return;
  }

  api.addNotice(currentSchool.id, {
    grade,
    period,
    subject,
    content,
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
    alert(`연구부장(관리자) 전용 즐겨찾기 URL이 복사되었습니다!\n\n${url}\n\n이 주소를 브라우저 북마크에 등록해두시면 학교 검색 없이 바로 관리자 로그인 화면으로 연결됩니다.`);
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
  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(string).replace(/[&<>"']/g, s => entityMap[s]);
}
