const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // 기본: 같은 주소에서만 접속(CORS 헤더 없음). 다른 주소에서 접속해야 하면 ALLOWED_ORIGINS=https://a.com,https://b.com
  cors: { origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(v => v.trim()) : false },
  maxHttpBufferSize: 1e7
});

const PORT = process.env.PORT || 3019;
const DATA_FILE = path.join(__dirname, 'data', 'schools-database.json');

// ==============================================================
// 🔒 보안 유틸리티: scrypt 비밀번호 해싱 및 타이밍 공격 방지
// ==============================================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password).trim(), salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(inputPassword, storedPassword) {
  if (!storedPassword || !inputPassword) return false;
  const cleanInput = String(inputPassword).trim();

  // scrypt 단방향 암호화 해시인 경우
  if (storedPassword.startsWith('scrypt:')) {
    const parts = storedPassword.split(':');
    if (parts.length !== 3) return false;
    const [, salt, originalHashHex] = parts;
    const derivedKey = crypto.scryptSync(cleanInput, salt, 64);
    const originalBuffer = Buffer.from(originalHashHex, 'hex');
    if (derivedKey.length !== originalBuffer.length) return false;
    return crypto.timingSafeEqual(derivedKey, originalBuffer);
  }

  // 레거시 평문 비밀번호 하위호환 (타이밍 안전 대조)
  const inputBuf = Buffer.from(cleanInput);
  const storedBuf = Buffer.from(String(storedPassword).trim());
  if (inputBuf.length !== storedBuf.length) {
    crypto.timingSafeEqual(inputBuf, inputBuf); // 시간차 누출 방지
    return false;
  }
  return crypto.timingSafeEqual(inputBuf, storedBuf);
}

// ==============================================================
// 🔒 보안 유틸리티: 무차별 대입(Brute-Force) 방지 속도 제한 및 잠금
// ==============================================================
class AuthRateLimiter {
  constructor() {
    this.attempts = new Map(); // key -> { count, firstAttempt, lockedUntil }
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, data] of this.attempts.entries()) {
      if (data.lockedUntil && data.lockedUntil < now) {
        this.attempts.delete(key);
      } else if (!data.lockedUntil && now - data.firstAttempt > 60000) {
        this.attempts.delete(key);
      }
    }
  }

  getLockoutSeconds(key) {
    this._cleanup();
    const data = this.attempts.get(key);
    if (!data || !data.lockedUntil) return 0;
    const remainingMs = data.lockedUntil - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  recordFailure(key) {
    this._cleanup();
    const now = Date.now();
    let data = this.attempts.get(key);
    if (!data) {
      data = { count: 1, firstAttempt: now, lockedUntil: 0 };
      this.attempts.set(key, data);
      return { locked: false, remainingAttempts: 4 };
    }

    if (now - data.firstAttempt > 60000 && !data.lockedUntil) {
      data.count = 1;
      data.firstAttempt = now;
      return { locked: false, remainingAttempts: 4 };
    }

    data.count++;
    if (data.count >= 5) {
      data.lockedUntil = now + 15 * 60 * 1000; // 5회 실패 시 15분 잠금
      return { locked: true, lockoutMinutes: 15 };
    }
    return { locked: false, remainingAttempts: 5 - data.count };
  }

  recordSuccess(key) {
    this.attempts.delete(key);
  }
}

const authLimiter = new AuthRateLimiter();

// 클라이언트 IP 조회 헬퍼
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// ==============================================================
// 🔒 보안 유틸리티: 교사 인가 세션 토큰 (Teacher Token Manager)
// ==============================================================
const teacherTokens = new Map(); // token -> { schoolId, expiresAt }

function generateTeacherToken(schoolId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  teacherTokens.set(token, {
    schoolId,
    createdAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000 // 24시간 유효
  });
  return token;
}

function isValidTeacherToken(schoolId, token) {
  if (!token || typeof token !== 'string') return false;
  const session = teacherTokens.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    teacherTokens.delete(token);
    return false;
  }
  return session.schoolId === schoolId;
}

// 클라이언트로 내보내는 학교 정보에서 비밀번호를 뺀다
function publicSchool(school) {
  const { teacherPass, classPass, ...rest } = school;
  return rest;
}

// 기본 1일치 시간표 템플릿 (45분 기준)
function getDefaultTimetable45() {
  return [
    { period: 1, name: "1교시", startTime: "09:10", endTime: "09:55", grades: { "1": "국어", "2": "수학", "3": "영어" } },
    { period: 2, name: "2교시", startTime: "10:15", endTime: "11:00", grades: { "1": "과학", "2": "사회", "3": "한국사" } },
    { period: 3, name: "3교시", startTime: "11:20", endTime: "12:05", grades: { "1": "영어", "2": "과학", "3": "수학" } },
    { period: 4, name: "4교시", startTime: "13:00", endTime: "13:45", grades: { "1": "자율학습", "2": "기술가정", "3": "선택과목" } }
  ];
}

// 기본 다일차(3일간) 시험 일정 템플릿
function getDefaultExamDays() {
  const today = new Date();
  const formatDate = (d) => d.toISOString().split('T')[0];

  const d1 = new Date(today);
  const d2 = new Date(today); d2.setDate(d2.getDate() + 1);
  const d3 = new Date(today); d3.setDate(d3.getDate() + 2);

  return [
    {
      dayIndex: 0,
      name: "1일차",
      date: formatDate(d1),
      timetable: getDefaultTimetable45()
    },
    {
      dayIndex: 1,
      name: "2일차",
      date: formatDate(d2),
      timetable: [
        { period: 1, name: "1교시", startTime: "09:10", endTime: "09:55", grades: { "1": "수학", "2": "국어", "3": "과학" } },
        { period: 2, name: "2교시", startTime: "10:15", endTime: "11:00", grades: { "1": "사회", "2": "영어", "3": "도덕" } },
        { period: 3, name: "3교시", startTime: "11:20", endTime: "12:05", grades: { "1": "역사", "2": "한문", "3": "중국어" } }
      ]
    },
    {
      dayIndex: 2,
      name: "3일차",
      date: formatDate(d3),
      timetable: [
        { period: 1, name: "1교시", startTime: "09:10", endTime: "09:55", grades: { "1": "영어", "2": "과학", "3": "수학" } },
        { period: 2, name: "2교시", startTime: "10:15", endTime: "11:00", grades: { "1": "미술", "2": "음악", "3": "체육" } }
      ]
    }
  ];
}

let db = {
  schools: {}
};

// 6자리 고유 입장 코드 생성기 (100000 ~ 999999 중복 없는 난수)
function generateUniqueRoomCode() {
  const existingCodes = Object.values(db.schools).map(s => s.roomCode).filter(Boolean);
  let code = '';
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (existingCodes.includes(code));
  return code;
}

function loadDatabase() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      db = JSON.parse(raw);
      if (!db.schools) db.schools = {};

      // 기존 학교 데이터들에 6자리 roomCode가 없으면 부여 & 평문 비밀번호 자동 암호화 마이그레이션
      let migratedPassCount = 0;
      Object.values(db.schools).forEach(school => {
        if (!school.roomCode) {
          school.roomCode = generateUniqueRoomCode();
        }
        if (school.teacherPass && !school.teacherPass.startsWith('scrypt:')) {
          school.teacherPass = hashPassword(school.teacherPass);
          migratedPassCount++;
        }
        if (school.classPass && !school.classPass.startsWith('scrypt:')) {
          school.classPass = hashPassword(school.classPass);
          migratedPassCount++;
        }
        if (!school.days || school.days.length === 0) {
          school.defaultDuration = school.defaultDuration || 50;
          school.currentDayIndex = school.currentDayIndex || 0;
          school.days = [
            {
              dayIndex: 0,
              name: "1일차",
              date: new Date().toISOString().split('T')[0],
              timetable: school.timetable || getDefaultTimetable45()
            }
          ];
        }
      });
      saveDatabase();
      if (migratedPassCount > 0) {
        console.log(`[보안 마이그레이션] 총 ${migratedPassCount}개의 기존 평문 비밀번호를 scrypt 단방향 암호화로 안전하게 변환했습니다.`);
      }
      console.log(`[DB 로드 완료] 총 ${Object.keys(db.schools).length}개 학교 데이터 준비 완료`);
    } else {
      db = { schools: {} };
      saveDatabase();
    }
  } catch (err) {
    console.error('데이터베이스 로드 에러:', err.message);
    db = { schools: {} };
  }
}

function saveDatabase() {
  try {
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('데이터베이스 저장 실패:', err.message);
  }
}

function isExpired(endTimeStr) {
  if (!endTimeStr) return false;
  const now = new Date();
  const [endH, endM] = endTimeStr.split(':').map(Number);
  const endDateTime = new Date();
  endDateTime.setHours(endH, endM, 0, 0);
  return now.getTime() >= endDateTime.getTime();
}

// 전체 학교의 만료된 정정사항 주기적 자동 정리
function cleanupAllSchoolsExpiredNotices() {
  let changed = false;

  Object.values(db.schools).forEach(school => {
    const beforeCount = school.notices.length;
    // 현재 진행 중인 일차의 시간표 조회
    const currentDay = school.days ? school.days[school.currentDayIndex || 0] : null;
    const timetable = currentDay ? currentDay.timetable : (school.timetable || []);

    school.notices = school.notices.filter(notice => {
      const periodObj = timetable.find(p => p.period === Number(notice.period));
      if (periodObj && periodObj.endTime) {
        if (isExpired(periodObj.endTime)) {
          console.log(`[${school.name} 자동삭제] ${notice.period}교시(${periodObj.endTime}) 종료 경과: ${notice.content}`);
          return false;
        }
      }
      return true;
    });

    if (school.notices.length !== beforeCount) {
      changed = true;
      io.to(school.id).emit('room_state_update', publicSchool(school));
    }
  });

  if (changed) {
    saveDatabase();
  }
}

setInterval(cleanupAllSchoolsExpiredNotices, 10000);

// 시험일로부터 7일 경과한 학교 시험상황실 자동 파기 루틴
function cleanupOldSchools() {
  const now = new Date();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  Object.keys(db.schools).forEach(schoolId => {
    const school = db.schools[schoolId];
    // 마지막 시험일 찾기 (days 배열 중 가장 늦은 날짜, 없으면 생성일 기준)
    let lastDateStr = null;
    if (school.days && school.days.length > 0) {
      const dates = school.days.map(d => d.date).filter(Boolean).sort();
      if (dates.length > 0) {
        lastDateStr = dates[dates.length - 1]; // 가장 마지막 날
      }
    }

    const baseDate = lastDateStr ? new Date(lastDateStr + 'T23:59:59') : new Date(school.createdAt || now);
    const expireTime = baseDate.getTime() + SEVEN_DAYS_MS;

    if (now.getTime() >= expireTime) {
      console.log(`[7일 경과 자동삭제] '${school.name}'의 마지막 시험일(${lastDateStr || '생성일'})로부터 7일이 경과하여 자동 영구 삭제되었습니다.`);
      delete db.schools[schoolId];
      deletedCount++;
    }
  });

  if (deletedCount > 0) {
    saveDatabase();
  }
}

// 1시간마다 7일 경과한 학교 자동 정리 검사
setInterval(cleanupOldSchools, 60 * 60 * 1000);
// 서버 구동 시에도 1회 검사
cleanupOldSchools();

// 🔒 보안 HTTP 응답 헤더 미들웨어
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// API: 학교 목록 (민감한 ID나 비밀번호 절대 노출 안 함)
app.get('/api/schools', (req, res) => {
  const list = Object.values(db.schools).map(s => ({
    name: s.name,
    region: s.region || "기타",
    examTitle: s.examTitle
  }));
  res.json(list);
});

// 중복 학교명 자동 넘버링 헬퍼 (예: [경기] 서진중학교 ➔ [경기] 서진중학교 (2))
function generateUniqueSchoolName(baseName) {
  const cleanBase = baseName.trim();
  const existingNames = Object.values(db.schools).map(s => s.name.trim().toLowerCase());

  if (!existingNames.includes(cleanBase.toLowerCase())) {
    return cleanBase;
  }

  let counter = 2;
  while (existingNames.includes(`${cleanBase} (${counter})`.toLowerCase())) {
    counter++;
  }
  return `${cleanBase} (${counter})`;
}

// API: 새 학교 개설 (비밀번호 scrypt 솔트 해싱 저장 및 최소 4자리 검증)
app.post('/api/schools/create', (req, res) => {
  const { region, name, teacherPass, classPass, examTitle, defaultDuration } = req.body;
  if (!name || !teacherPass || !classPass) {
    return res.status(400).json({ error: '학교명과 비밀번호는 필수입니다.' });
  }

  const strTeacherPass = String(teacherPass).trim();
  const strClassPass = String(classPass).trim();

  if (strTeacherPass.length < 4) {
    return res.status(400).json({ error: '보안을 위해 교사용 비밀번호는 최소 4자리 이상으로 설정해 주세요.' });
  }

  if (strTeacherPass === strClassPass) {
    return res.status(400).json({ error: '교사용 비밀번호와 학생(교실)용 비밀번호는 서로 다르게 입력해야 합니다.' });
  }

  const selectedRegion = region ? region.trim() : "경기";
  // [지역] 학교이름 형태로 결합
  const baseFullName = `[${selectedRegion}] ${name.trim()}`;
  const finalSchoolName = generateUniqueSchoolName(baseFullName);
  const wasRenamed = finalSchoolName !== baseFullName;

  const durationNum = Number(defaultDuration) || 50;
  const id = 'sch-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const roomCode = generateUniqueRoomCode();

  const newSchool = {
    id,
    roomCode,
    region: selectedRegion,
    name: finalSchoolName,
    rawName: name.trim(),
    teacherPass: hashPassword(strTeacherPass), // 🔒 scrypt 단방향 암호화
    classPass: hashPassword(strClassPass),     // 🔒 scrypt 단방향 암호화
    examTitle: examTitle ? String(examTitle).trim().slice(0, 50) : "2026학년도 2학기 중간고사",
    defaultDuration: durationNum,
    currentDayIndex: 0,
    days: getDefaultExamDays(),
    notices: [],
    createdAt: new Date().toISOString()
  };

  db.schools[id] = newSchool;
  saveDatabase();

  const teacherToken = generateTeacherToken(id);

  console.log(`[새 학교 개설] ${newSchool.name} (코드: ${roomCode}, ID: ${id})`);
  res.json({
    success: true,
    schoolId: id,
    roomCode,
    teacherToken, // 개설자 즉시 교사 토큰 발급
    school: publicSchool(newSchool),
    wasRenamed,
    allocatedName: finalSchoolName
  });
});

// API: 6자리 코드로 초간편 입장 (무차별 대입 방지 잠금 + 교사 토큰 발급)
app.post('/api/schools/auth-by-code', (req, res) => {
  const ip = getClientIp(req);
  const { code, role, password } = req.body;
  if (!code) {
    return res.status(400).json({ error: '6자리 입장 코드를 입력해 주세요.' });
  }

  const cleanCode = String(code).trim().replace(/-/g, '');
  const rateKey = `code:${cleanCode}:${ip}`;

  // 🔒 연속 실패 잠금 검사
  const lockoutSec = authLimiter.getLockoutSeconds(rateKey);
  if (lockoutSec > 0) {
    const min = Math.ceil(lockoutSec / 60);
    return res.status(429).json({
      error: `비밀번호/코드 입력 오류 횟수를 초과했습니다. 보안을 위해 약 ${min}분 동안 접속이 일시 차단됩니다.`
    });
  }

  const school = Object.values(db.schools).find(s => s.roomCode === cleanCode);

  if (!school) {
    const fail = authLimiter.recordFailure(rateKey);
    const msg = fail.locked
      ? '인증 시도 5회 실패로 15분간 접속이 차단됩니다.'
      : `입력하신 6자리 코드와 일치하는 시험상황실이 없습니다. (남은 시도: ${fail.remainingAttempts}회)`;
    return res.status(404).json({ error: msg });
  }

  // 1) 교실/학생 입장: 코드 6자리 일치 시 입장 허용
  if (role === 'classroom') {
    authLimiter.recordSuccess(rateKey);
    return res.json({
      success: true,
      role: 'classroom',
      school: publicSchool(school)
    });
  }

  // 2) 교사/관리자 입장: 교사용 비밀번호 검증 필요
  if (role === 'teacher') {
    if (!password) {
      return res.status(400).json({ error: '교사용 비밀번호를 입력해 주세요.' });
    }

    const isMatch = verifyPassword(String(password).trim(), school.teacherPass);
    if (!isMatch) {
      const fail = authLimiter.recordFailure(rateKey);
      const msg = fail.locked
        ? '비밀번호 5회 연속 오류로 15분간 접속이 차단됩니다.'
        : `교사용 비밀번호가 일치하지 않습니다. (남은 시도: ${fail.remainingAttempts}회)`;
      return res.status(401).json({ error: msg });
    }

    authLimiter.recordSuccess(rateKey);
    const teacherToken = generateTeacherToken(school.id);
    return res.json({
      success: true,
      role: 'teacher',
      teacherToken, // 🔒 서명된 교사 토큰 발급
      school: publicSchool(school)
    });
  }

  // 기본값: 교실 모드
  authLimiter.recordSuccess(rateKey);
  res.json({ success: true, role: 'classroom', school: publicSchool(school) });
});

// API: 학교 입장 인증 (기존 학교명/ID 검색 방식 호환)
app.post('/api/schools/auth', (req, res) => {
  const ip = getClientIp(req);
  const { schoolId, schoolName, password } = req.body;
  let school = null;
  if (schoolId) school = db.schools[schoolId];
  else if (schoolName) school = Object.values(db.schools).find(s => s.name.trim().toLowerCase() === schoolName.trim().toLowerCase());

  if (!school) {
    return res.status(404).json({ error: '해당 학교 시험상황실을 찾을 수 없습니다.' });
  }

  const rateKey = `auth:${school.id}:${ip}`;
  const lockoutSec = authLimiter.getLockoutSeconds(rateKey);
  if (lockoutSec > 0) {
    const min = Math.ceil(lockoutSec / 60);
    return res.status(429).json({
      error: `비밀번호 입력 오류 횟수를 초과했습니다. 보안을 위해 약 ${min}분 동안 접속이 일시 차단됩니다.`
    });
  }

  const inputPass = String(password).trim();
  let role = null;
  let teacherToken = null;

  if (verifyPassword(inputPass, school.teacherPass)) {
    role = 'teacher';
    teacherToken = generateTeacherToken(school.id);
  } else if (verifyPassword(inputPass, school.classPass)) {
    role = 'classroom';
  } else {
    const fail = authLimiter.recordFailure(rateKey);
    const msg = fail.locked
      ? '비밀번호 5회 연속 오류로 15분간 접속이 차단됩니다.'
      : `비밀번호가 일치하지 않습니다. (남은 시도: ${fail.remainingAttempts}회)`;
    return res.status(401).json({ error: msg });
  }

  authLimiter.recordSuccess(rateKey);
  res.json({
    success: true,
    role,
    teacherToken,
    school: publicSchool(school)
  });
});

// Socket.io 통신 (🔒 교사 권한 토큰 검증 필수)
io.on('connection', (socket) => {
  let currentSchoolId = null;

  socket.on('join_school_room', ({ schoolId }) => {
    const school = db.schools[schoolId];
    if (!school) return;

    currentSchoolId = schoolId;
    socket.join(schoolId);
    socket.emit('room_state_update', publicSchool(school));
  });

  // [교사용] 날짜별 시간표 및 시험 정보 전체 갱신 (🔒 교사 토큰 검증)
  socket.on('update_school_settings', ({ schoolId, teacherToken, examTitle, defaultDuration, currentDayIndex, days }) => {
    if (!isValidTeacherToken(schoolId, teacherToken)) {
      console.warn(`[보안 경고] 학교 ${schoolId} 시간표 변경 거부: 교사 토큰 없음 또는 불일치`);
      socket.emit('auth_error', { message: '교사 권한 인증에 실패했습니다. 다시 로그인해 주세요.' });
      return;
    }

    const school = db.schools[schoolId];
    if (!school) return;

    if (examTitle) school.examTitle = String(examTitle).slice(0, 50);
    if (defaultDuration) school.defaultDuration = Number(defaultDuration);
    if (typeof currentDayIndex === 'number') school.currentDayIndex = currentDayIndex;
    if (days && Array.isArray(days)) school.days = days;

    saveDatabase();
    io.to(schoolId).emit('room_state_update', publicSchool(school));
    console.log(`[${school.name}] 날짜별 시간표 설정 갱신 완료 (현재: ${currentDayIndex + 1}일차)`);
  });

  // [교사용] 현재 시험 일차 변경 (🔒 교사 토큰 검증)
  socket.on('change_school_day', ({ schoolId, teacherToken, dayIndex }) => {
    if (!isValidTeacherToken(schoolId, teacherToken)) {
      console.warn(`[보안 경고] 학교 ${schoolId} 시험 일차 변경 거부: 교사 토큰 없음 또는 불일치`);
      socket.emit('auth_error', { message: '교사 권한 인증에 실패했습니다. 다시 로그인해 주세요.' });
      return;
    }

    const school = db.schools[schoolId];
    if (!school) return;

    school.currentDayIndex = Number(dayIndex) || 0;
    saveDatabase();
    io.to(schoolId).emit('room_state_update', publicSchool(school));
    console.log(`[${school.name}] 시험 일차 전환 ➔ ${school.currentDayIndex + 1}일차`);
  });

  // [교사용] 정정사항 추가 (🔒 교사 토큰 검증 + XSS 방지 정제)
  socket.on('add_school_notice', ({ schoolId, teacherToken, noticeData }) => {
    if (!isValidTeacherToken(schoolId, teacherToken)) {
      console.warn(`[보안 경고] 학교 ${schoolId} 정정사항 등록 거부: 교사 토큰 없음 또는 불일치`);
      socket.emit('auth_error', { message: '교사 권한 인증에 실패했습니다. 다시 로그인해 주세요.' });
      return;
    }

    const school = db.schools[schoolId];
    if (!school || !noticeData) return;

    const currentDay = school.days ? school.days[school.currentDayIndex || 0] : null;
    const timetable = currentDay ? currentDay.timetable : (school.timetable || []);
    const periodObj = timetable.find(p => p.period === Number(noticeData.period));

    // 악성 스크립트(XSS) 방지 및 길이 정제
    const sanitizedContent = String(noticeData.content || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .slice(0, 1000);

    const sanitizedSubject = String(noticeData.subject || '').replace(/[<>]/g, '').slice(0, 50);
    const sanitizedTeacher = String(noticeData.teacher || '출제교사').replace(/[<>]/g, '').slice(0, 30);

    const newNotice = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      period: Number(noticeData.period),
      periodName: periodObj ? periodObj.name : `${noticeData.period}교시`,
      grade: noticeData.grade,
      subject: sanitizedSubject,
      content: sanitizedContent,
      imageUrl: (noticeData.imageUrl && typeof noticeData.imageUrl === 'string' && noticeData.imageUrl.startsWith('data:image/')) ? noticeData.imageUrl : null,
      createdAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      endTime: periodObj ? periodObj.endTime : null,
      teacher: sanitizedTeacher
    };

    school.notices.unshift(newNotice);
    saveDatabase();

    io.to(schoolId).emit('school_notice_broadcast', {
      notice: newNotice,
      allNotices: school.notices
    });
  });

  // [교사용] 정정사항 삭제 (🔒 교사 토큰 검증)
  socket.on('delete_school_notice', ({ schoolId, teacherToken, noticeId }) => {
    if (!isValidTeacherToken(schoolId, teacherToken)) {
      console.warn(`[보안 경고] 학교 ${schoolId} 정정사항 삭제 거부: 교사 토큰 없음 또는 불일치`);
      socket.emit('auth_error', { message: '교사 권한 인증에 실패했습니다. 다시 로그인해 주세요.' });
      return;
    }

    const school = db.schools[schoolId];
    if (!school) return;

    school.notices = school.notices.filter(n => n.id !== noticeId);
    saveDatabase();
    io.to(schoolId).emit('room_state_update', publicSchool(school));
  });

  socket.on('disconnect', () => {
    if (currentSchoolId) socket.leave(currentSchoolId);
  });
});

const net = require('net');
function findAvailablePort(startPort, callback) {
  const tester = net.createServer();
  tester.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      findAvailablePort(startPort + 1, callback);
    } else callback(err);
  });
  tester.once('listening', () => {
    tester.close(() => callback(null, startPort));
  });
  tester.listen(startPort, '0.0.0.0');
}

loadDatabase();

const preferredPort = Number(process.env.PORT) || 3019;
findAvailablePort(preferredPort, (err, availablePort) => {
  if (err) return console.error(err);
  server.listen(availablePort, '0.0.0.0', () => {
    console.log(`🌐 [날짜별 시간표 & 자동 연산 지원] 서버 실행: http://localhost:${availablePort}`);
  });
});
