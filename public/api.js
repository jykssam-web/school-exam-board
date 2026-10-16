// ==============================================================
// 서버 통신 전담 파일 (api.js)
// 🔒 교사 세션 토큰 보안 전송 및 권한 검증 지원
// ==============================================================

const api = (() => {
  const socket = io();

  let teacherToken = sessionStorage.getItem('exam_teacher_token') || null;

  async function post(path, body) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { error: '서버와 통신할 수 없습니다. 인터넷 연결을 확인해 주세요.' } };
    }
  }

  return {
    // --- 교사 권한 토큰 관리 ---
    setTeacherToken(token) {
      teacherToken = token;
      if (token) {
        sessionStorage.setItem('exam_teacher_token', token);
      } else {
        sessionStorage.removeItem('exam_teacher_token');
      }
    },
    getTeacherToken() {
      return teacherToken;
    },
    clearTeacherToken() {
      teacherToken = null;
      sessionStorage.removeItem('exam_teacher_token');
    },

    // --- 요청/응답 ---
    async listSchools() {
      try {
        const res = await fetch('/api/schools');
        return res.ok ? await res.json() : [];
      } catch (e) {
        return [];
      }
    },
    authByCode: (code, role, password, token) => post('/api/schools/auth-by-code', { code, role, password, teacherToken: token || teacherToken }),
    authByName: (schoolName, password) => post('/api/schools/auth', { schoolName, password }),
    createSchool: (fields) => post('/api/schools/create', fields),

    // --- 실시간 (교사 토큰 자동 동봉) ---
    joinRoom: (schoolId) => socket.emit('join_school_room', { schoolId }),
    changeDay: (schoolId, dayIndex) => socket.emit('change_school_day', { schoolId, teacherToken, dayIndex }),
    updateSettings: (schoolId, settings) => socket.emit('update_school_settings', { schoolId, teacherToken, ...settings }),
    toggleClock: (schoolId, showClock) => socket.emit('toggle_school_clock', { schoolId, teacherToken, showClock }),
    addNotice: (schoolId, noticeData) => socket.emit('add_school_notice', { schoolId, teacherToken, noticeData }),
    deleteNotice: (schoolId, noticeId) => socket.emit('delete_school_notice', { schoolId, teacherToken, noticeId }),

    // --- 수신 ---
    onRoomState: (handler) => socket.on('room_state_update', handler),
    onNoticeBroadcast: (handler) => socket.on('school_notice_broadcast', handler),
    onAuthError: (handler) => socket.on('auth_error', handler)
  };
})();
