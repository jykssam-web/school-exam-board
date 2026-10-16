const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage, clipboard } = require('electron');
const path = require('path');
const { startServer, getLocalIpAddresses, getCurrentPort } = require('../server');

let mainWindow = null;
let tray = null;
let serverInstance = null;
let serverPort = 3019;
let isQuitting = false;

// 단일 인스턴스 락 (프로그램이 중복 실행되어 포트 충돌 나는 현상 원천 차단)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      // 1. 내장 Express + Socket.io 서버 시작
      console.log('🚀 Electron 내장 시험상황실 서버 구동 시작...');
      const result = await startServer(3019);
      serverPort = result.port;
      serverInstance = result.server;

      // 2. 메인 윈도우 생성
      createMainWindow();

      // 3. 시스템 트레이 생성
      createTray();
    } catch (err) {
      dialog.showErrorBox('서버 구동 오류', `시험상황실 로컬 서버 시작 중 오류가 발생했습니다:\n${err.message}`);
      app.quit();
    }
  });
}

function createMainWindow() {
  const iconPath = path.join(__dirname, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: '전국 학교 실시간 시험상황실 (오프라인/인트라넷 독립형)',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // 외부 링크 클릭 시 기본 웹 브라우저로 열기
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 닫기(X) 버튼 클릭 시 완전 종료 대신 트레이로 최소화 (시험 중 실수 종료 방지 보호막)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      if (tray) {
        tray.displayBalloon({
          title: '학교 시험상황실 실행 중',
          content: '창이 최소화되었지만 교실 전자칠판 실시간 연동 서버는 백그라운드에서 안전하게 계속 유지됩니다.'
        });
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 16x16 기본 아이콘 생성 헬퍼 (icon.png가 없을 때 대비)
function createDefaultTrayIcon() {
  const iconPath = path.join(__dirname, 'icon.png');
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  } catch (e) {
    // ignore
  }

  // 16x16 파란색 기본 네이티브 아이콘 생성
  const img = nativeImage.createFromBuffer(
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAExJREFUOE9jZKAQMFKon2HUAAYGhn8g/g/E/1EwA5BlGMAGoLuDEWqANAMw/IccDYwhg4EB0o2gKRhGGnAQD3gYqBhQj0f0sACfAwBhyAoR6hF/wwAAAABJRU5ErkJggg==', 'base64')
  );
  return img;
}

function createTray() {
  const icon = createDefaultTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(`학교 실시간 시험상황실 (포트: ${serverPort})`);

  const updateMenu = () => {
    const ips = getLocalIpAddresses();
    const primaryUrl = ips.length > 0 ? `http://${ips[0].address}:${serverPort}` : `http://localhost:${serverPort}`;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '🏫 시험상황실 창 열기',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: `📢 교실 접속 주소: ${primaryUrl}`,
        enabled: false
      },
      {
        label: '📋 교실 접속 주소 복사',
        click: () => {
          clipboard.writeText(primaryUrl);
          dialog.showMessageBox({
            type: 'info',
            title: '주소 복사 완료',
            message: `교실 전자칠판 접속 주소가 클립보드에 복사되었습니다!\n\n${primaryUrl}\n\n교내 메신저에 붙여넣어 공유하세요.`
          });
        }
      },
      {
        label: '🌐 기본 브라우저(Edge/Chrome)로 열기',
        click: () => {
          shell.openExternal(`http://localhost:${serverPort}`);
        }
      },
      { type: 'separator' },
      {
        label: '❌ 프로그램 완전 종료',
        click: () => {
          const choice = dialog.showMessageBoxSync({
            type: 'warning',
            buttons: ['계속 유지(취소)', '완전 종료'],
            defaultId: 0,
            cancelId: 0,
            title: '시험상황실 종료 확인',
            message: '정말로 시험상황실 프로그램을 종료하시겠습니까?',
            detail: '프로그램을 종료하면 각 교실 전자칠판과의 실시간 통신 및 정정사항 전송이 즉시 중단됩니다.'
          });

          if (choice === 1) {
            isQuitting = true;
            app.quit();
          }
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
  };

  updateMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // 트레이에서 백그라운드 유지되므로 종료하지 않음
});
