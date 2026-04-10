/* ============================================
   앱 초기화 및 메인 컨트롤러
   ============================================ */

const App = {
  async init() {
    try {
      await DB.open();

      // 초기 관리자 계정 확인
      const hasAdmin = await Auth.hasAdminAccount();
      if (!hasAdmin) {
        this.showSetupScreen();
        return;
      }

      // 세션 확인
      const user = Auth.currentUser();
      if (user) {
        this.showApp(user);
      } else {
        this.showLoginScreen();
      }
    } catch (err) {
      console.error('앱 초기화 오류:', err);
      document.body.innerHTML = `
        <div style="padding:40px;text-align:center;color:#DC2626;">
          <h2>앱 초기화 오류</h2>
          <p>${Utils.escapeHtml(err.message)}</p>
          <p style="margin-top:16px;color:#64748B;">브라우저를 새로고침하거나 다른 브라우저를 사용해 보세요.</p>
        </div>
      `;
    }
  },

  // 초기 설정 화면
  showSetupScreen() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appShell').classList.remove('active');
    document.getElementById('setupScreen').classList.add('active');

    const form = document.getElementById('setupForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const username = form.querySelector('#setupUsername').value.trim();
      const displayName = form.querySelector('#setupDisplayName').value.trim();
      const password = form.querySelector('#setupPassword').value;
      const confirmPw = form.querySelector('#setupConfirmPassword').value;

      if (password !== confirmPw) {
        Utils.showToast('비밀번호가 일치하지 않습니다.', 'error');
        return;
      }
      if (password.length < 4) {
        Utils.showToast('비밀번호는 4자 이상이어야 합니다.', 'error');
        return;
      }

      try {
        await Auth.createInitialAdmin(username, displayName, password);
        Utils.showToast('관리자 계정이 생성되었습니다. 로그인해 주세요.', 'success');
        document.getElementById('setupScreen').classList.remove('active');
        this.showLoginScreen();
      } catch (err) {
        Utils.showToast('계정 생성 실패: ' + err.message, 'error');
      }
    };
  },

  // 로그인 화면
  showLoginScreen() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appShell').classList.remove('active');
    document.getElementById('setupScreen').classList.remove('active');

    const form = document.getElementById('loginForm');
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';

    form.onsubmit = async (e) => {
      e.preventDefault();
      errorEl.textContent = '';

      const username = form.querySelector('#loginUsername').value.trim();
      const password = form.querySelector('#loginPassword').value;

      if (!username || !password) {
        errorEl.textContent = '아이디와 비밀번호를 입력해주세요.';
        return;
      }

      try {
        const session = await Auth.login(username, password);
        this.showApp(session);
      } catch (err) {
        errorEl.textContent = err.message;
      }
    };
  },

  // 메인 앱 표시
  async showApp(user) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('setupScreen').classList.remove('active');
    document.getElementById('appShell').classList.add('active');

    // DB에서 사용자 권한 정보 로드
    const fullUser = await DB.get('users', user.id);
    this._userPermissions = (fullUser && fullUser.menuPermissions) || [];

    // 사용자 정보 표시
    document.getElementById('userName').textContent = user.displayName;
    document.getElementById('userRole').textContent = user.role === 'admin' ? '관리자' : '직원';

    // 사이드바 구성 (역할에 따라)
    this.buildSidebar(user);

    // 라우트 등록
    this.registerRoutes();

    // 라우터 시작
    Router.init();

    // 대시보드로 알림 뱃지 업데이트
    this.updateNotificationBadges();
  },

  // 메뉴 권한 체크 (관리자=전체, 직원=할당된 것만)
  hasMenuPermission(menuKey) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    const perms = this._userPermissions || [];
    return perms.includes(menuKey);
  },

  // 사이드바 구성 (권한 기반)
  buildSidebar(user) {
    const nav = document.getElementById('sidebarNav');
    const isAdmin = user.role === 'admin';
    const hasPerm = (key) => isAdmin || (this._userPermissions || []).includes(key);

    let html = `
      <div class="nav-section">
        <div class="nav-section-title">메인</div>
        <div class="nav-item" data-path="/dashboard" onclick="Router.navigate('/dashboard')">
          <span class="nav-icon">📊</span>
          <span>대시보드</span>
        </div>
      </div>
    `;

    // 세금계산서 (tax-invoice 권한)
    if (hasPerm('tax-invoice')) {
      html += `
        <div class="nav-section">
          <div class="nav-section-title">세금계산서</div>
          <div class="nav-item" data-path="/tax-invoice/new" onclick="Router.navigate('/tax-invoice/new')">
            <span class="nav-icon">📝</span>
            <span>발행 요청</span>
          </div>
          <div class="nav-item" data-path="/tax-invoice/my" onclick="Router.navigate('/tax-invoice/my')">
            <span class="nav-icon">📋</span>
            <span>나의 요청현황</span>
          </div>
      `;
      if (isAdmin) {
        html += `
          <div class="nav-item" data-path="/tax-invoice/admin" onclick="Router.navigate('/tax-invoice/admin')">
            <span class="nav-icon">✅</span>
            <span>요청 관리</span>
            <span class="nav-badge hidden" id="badgePending">0</span>
          </div>
        `;
      }
      html += `</div>`;
    }

    // 재무 섹션
    const showDeposits = hasPerm('deposits');
    const showMatching = isAdmin && hasPerm('matching');
    const showTransfers = hasPerm('transfers');

    if (showDeposits || showMatching || showTransfers) {
      html += `<div class="nav-section"><div class="nav-section-title">재무</div>`;

      if (showDeposits) {
        html += `
          <div class="nav-item" data-path="/deposits" onclick="Router.navigate('/deposits')">
            <span class="nav-icon">💰</span>
            <span>입금내역</span>
          </div>
        `;
      }
      if (showMatching) {
        html += `
          <div class="nav-item" data-path="/matching" onclick="Router.navigate('/matching')">
            <span class="nav-icon">🔗</span>
            <span>매칭 관리</span>
          </div>
        `;
      }
      if (showTransfers) {
        html += `
          <div class="nav-item" data-path="/transfers/my" onclick="Router.navigate('/transfers/my')">
            <span class="nav-icon">💸</span>
            <span>나의 송금내역</span>
          </div>
        `;
        if (isAdmin) {
          html += `
            <div class="nav-item" data-path="/transfers/admin" onclick="Router.navigate('/transfers/admin')">
              <span class="nav-icon">📑</span>
              <span>송금내역 관리</span>
            </div>
          `;
        }
      }
      html += `</div>`;
    }

    // 연차 신청 (leave 권한)
    if (hasPerm('leave')) {
      html += `
        <div class="nav-section">
          <div class="nav-section-title">근태</div>
          <div class="nav-item" data-path="/leave" onclick="Router.navigate('/leave')">
            <span class="nav-icon">🗓️</span>
            <span>연차 신청</span>
          </div>
        </div>
      `;
    }

    // 내 정보 (전체 사용자)
    html += `
      <div class="nav-divider"></div>
      <div class="nav-section">
        <div class="nav-section-title">내 계정</div>
        <div class="nav-item" data-path="/my-account" onclick="Router.navigate('/my-account')">
          <span class="nav-icon">👤</span>
          <span>내 정보 / 비밀번호</span>
        </div>
      </div>
    `;

    if (isAdmin) {
      html += `
        <div class="nav-section">
          <div class="nav-section-title">관리</div>
          <div class="nav-item" data-path="/users" onclick="Router.navigate('/users')">
            <span class="nav-icon">👥</span>
            <span>사용자 관리</span>
          </div>
          <div class="nav-item" data-path="/settings" onclick="Router.navigate('/settings')">
            <span class="nav-icon">⚙️</span>
            <span>설정 / 백업</span>
          </div>
        </div>
      `;
    }

    nav.innerHTML = html;
  },

  // 라우트 등록
  registerRoutes() {
    Router.register('/dashboard', {
      module: 'DashboardModule',
      title: '대시보드',
      roles: ['admin', 'employee']
    });
    Router.register('/tax-invoice/new', {
      module: 'TaxInvoiceRequestModule',
      title: '세금계산서 발행 요청',
      roles: ['admin', 'employee']
    });
    Router.register('/tax-invoice/my', {
      module: 'TaxInvoiceRequestModule',
      title: '나의 요청현황',
      roles: ['admin', 'employee'],
      action: 'myList'
    });
    Router.register('/tax-invoice/admin', {
      module: 'TaxInvoiceAdminModule',
      title: '세금계산서 요청 관리',
      roles: ['admin']
    });
    Router.register('/deposits', {
      module: 'DepositModule',
      title: '입금내역',
      roles: ['admin', 'employee']
    });
    Router.register('/matching', {
      module: 'MatchingModule',
      title: '매칭 관리',
      roles: ['admin']
    });
    Router.register('/transfers/my', {
      module: 'TransferModule',
      title: '나의 송금내역',
      roles: ['admin', 'employee'],
      action: 'my'
    });
    Router.register('/transfers/admin', {
      module: 'TransferModule',
      title: '송금내역 관리',
      roles: ['admin'],
      action: 'admin'
    });
    Router.register('/leave', {
      module: 'LeaveModule',
      title: '연차 신청',
      roles: ['admin', 'employee']
    });
    Router.register('/my-account', {
      module: 'MyAccountModule',
      title: '내 정보 / 비밀번호 변경',
      roles: ['admin', 'employee']
    });
    Router.register('/users', {
      module: 'UserManagementModule',
      title: '사용자 관리',
      roles: ['admin']
    });
    Router.register('/settings', {
      module: 'SettingsModule',
      title: '설정 / 백업',
      roles: ['admin']
    });
  },

  // 알림 뱃지 업데이트
  async updateNotificationBadges() {
    if (!Auth.isAdmin()) return;

    try {
      const pendingCount = (await DB.getByIndex('taxInvoiceRequests', 'status', '요청')).length;
      const badge = document.getElementById('badgePending');
      if (badge) {
        if (pendingCount > 0) {
          badge.textContent = pendingCount;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
    } catch (e) {
      // 무시
    }
  }
};

// 모바일 사이드바 토글
function toggleSidebar() {
  document.querySelector('.app-sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('active');
}

function closeSidebar() {
  document.querySelector('.app-sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

// 앱 시작
document.addEventListener('DOMContentLoaded', () => App.init());
