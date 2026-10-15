# 🚀 www.lifeforteacher.com 배포 가이드 (클로드 전달용)

이 문서는 **Claude(클로드)** 또는 서버 관리자가 `www.lifeforteacher.com` 서버에 **전국 학교 실시간 시험상황실 시스템**을 배포할 때 그대로 복사해서 사용할 수 있도록 정리된 안내서입니다.

---

## 📦 1. 배포할 파일 목록

프로젝트 폴더 내 다음 파일들을 서버의 작업 디렉토리(예: `/var/www/school-exam-board`)에 업로드합니다:

```
school-exam-board/
├── server.js              # 백엔드 서버 (Express + Socket.io 룸 격리 + 7일 경과 자동 삭제 + 중복 자동 넘버링)
├── package.json           # 의존성 설정 (express, socket.io)
├── Dockerfile             # 도커 컨테이너 빌드 파일
├── docker-compose.yml     # 도커 컴포즈 원클릭 실행 파일
├── data/                  # 학교별 시험 데이터 영속성 폴더 (자동 생성됨)
│   └── (비워서 올린다: schools-database.json은 올리지 않는다. 서버가 처음 실행될 때 새로 만든다)
└── public/                # 프론트엔드 정적 웹 리소스
    ├── index.html         # 메인 포털 (고시인성 화이트/다크 + 45/50분 자동계산 + 단일 과목 Hero 뷰)
    ├── api.js             # 서버 통신 전담 (통신 방식을 바꿀 때 이 파일만 교체)
    ├── styles.css         # UI 스타일 및 번쩍임 펄스 애니메이션
    └── app.js             # 클라이언트 실시간 통신 및 다일차 시간표 로직
```

---

## 🛠️ 2. 서버 실행 방법 (3가지 옵션 중 택 1)

### 방법 A: PM2 + Node.js (가장 권장)

서버 터미널에서 다음 명령어를 실행합니다:

```bash
# 1. 프로젝트 폴더로 이동
cd /var/www/school-exam-board

# 2. 의존성 패키지 설치
npm install --production

# 3. PM2로 무중단 백그라운드 구동 (포트 3019)
pm2 start server.js --name "school-exam-board"

# 4. 서버 재부팅 시 자동 실행 등록
pm2 save
pm2 startup
```

---

### 방법 B: Docker Compose (원클릭 컨테이너 배포)

```bash
cd /var/www/school-exam-board
docker-compose up -d --build
```

---

## 🌐 3. Nginx 웹서버 연동 설정 (WebSocket 필수)

`www.lifeforteacher.com`의 Nginx 설정 파일에 아래 블록을 추가합니다.

### 옵션 1: 서브도메인으로 연결할 때 (`exam.lifeforteacher.com`)
```nginx
server {
    listen 80;
    server_name exam.lifeforteacher.com;

    location / {
        proxy_pass http://127.0.0.1:3019;
        proxy_http_version 1.1;

        # WebSocket 실시간 통신을 위한 필수 헤더
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 옵션 2: 기존 홈페이지의 특정 주소로 연결할 때 (`www.lifeforteacher.com/exam/`)
```nginx
location /exam/ {
    proxy_pass http://127.0.0.1:3019/;
    proxy_http_version 1.1;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

# Socket.io 경로 라우팅
location /socket.io/ {
    proxy_pass http://127.0.0.1:3019/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

---

## 💬 4. 클로드(Claude)에게 그대로 전달할 프롬프트

아래 내용을 복사해서 클로드에게 보내시면 클로드가 즉시 알아듣고 배포를 진행합니다:

> **"클로드야, `www.lifeforteacher.com`에 올릴 [전국 학교 실시간 시험상황실] Node.js 웹 프로젝트를 만들었어.  
> Express와 Socket.io 기반으로 동작하고 기본 포트는 3019번이야.  
> 첨부된 파일들(`server.js`, `package.json`, `public/`, `Dockerfile` 등)을 내 서버에 올리고, PM2로 실행한 다음 Nginx에서 WebSocket 리버스 프록시로 연결해줘."**


---

## 🛡️ 2026-10-15 완벽 보안 강화 완료 내역

- **비밀번호 단방향 암호화 (scrypt + Salt)**: 모든 비밀번호는 `scrypt` 알고리즘과 16바이트 솔트 난수를 사용해 해시 암호화되어 저장됩니다. 서버 관리자나 해커가 데이터베이스 파일을 열어보더라도 원본 비밀번호를 절대 알아낼 수 없습니다. (기존 평문 데이터는 서버 구동 시 자동 암호화 마이그레이션)
- **무차별 대입(Brute-Force) 공격 차단 및 15분 잠금**:
  - 6자리 룸 코드 및 비밀번호를 자동화 스크립트로 무작위 대입할 수 없도록 속도 제한(Rate Limiting)이 적용되었습니다.
  - 5회 연속 인증 실패 시 해당 IP 및 대상 학교에 대해 **15분간 즉시 접속이 차단**됩니다.
- **교사 권한 일회용 세션 토큰 (`teacherToken`) 검증**:
  - 교사 비밀번호 인증에 성공한 교사에게만 64바이트 암호학적 난수 세션 토큰이 발급됩니다.
  - 교실(학생) 모드 접속자나 외부 공격자는 이 토큰을 가질 수 없으며, 시간표 수정/일차 변경/정정사항 등록 및 삭제 소켓 요청 시 토큰이 없으면 서버에서 즉각 차단됩니다.
- **타이밍 공격(Timing Attack) 방지**: 비밀번호 대조 시 `crypto.timingSafeEqual`을 적용하여 연산 시간차를 이용한 비밀번호 유추 공격을 원천 차단했습니다.
- **XSS 악성 스크립트 정제 (Sanitization)**: 정정사항 본문, 교사명 등에 악성 `<script>` 태그가 삽입되지 않도록 안전하게 이스케이프 처리됩니다.
- **보안 HTTP 응답 헤더 탑재**: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection` 헤더가 자동 적용됩니다.
- **CORS 및 민감정보 보호**: 학교 목록(`/api/schools`) 및 소켓 브로드캐스트에서 비밀번호와 내부 식별자가 완전히 배제되었습니다.
