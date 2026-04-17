/* ============================================
   인증 및 권한 관리
   ============================================ */

const Auth = {
  SESSION_KEY: 'sq_session',
  TIMEOUT_MS: 30 * 60 * 1000, // 30분
  LOGIN_ATTEMPTS_KEY: 'sq_login_attempts',
  MAX_ATTEMPTS: 5,
  LOCKOUT_MS: 10 * 60 * 1000, // 10분
  _activityTimer: null,

  // 로그인 시도 기록 조회
  _getAttempts(username) {
    try {
      const data = JSON.parse(localStorage.getItem(this.LOGIN_ATTEMPTS_KEY) || '{}');
      return data[username] || { count: 0, lockedUntil: 0 };
    } catch { return { count: 0, lockedUntil: 0 }; }
  },

  _setAttempts(username, attempts) {
    try {
      const data = JSON.parse(localStorage.getItem(this.LOGIN_ATTEMPTS_KEY) || '{}');
      data[username] = attempts;
      localStorage.setItem(this.LOGIN_ATTEMPTS_KEY, JSON.stringify(data));
    } catch {}
  },

  _clearAttempts(username) {
    try {
      const data = JSON.parse(localStorage.getItem(this.LOGIN_ATTEMPTS_KEY) || '{}');
      delete data[username];
      localStorage.setItem(this.LOGIN_ATTEMPTS_KEY, JSON.stringify(data));
    } catch {}
  },

  // 잠금 시간 확인
  _checkLockout(username) {
    const attempts = this._getAttempts(username);
    if (attempts.lockedUntil > Date.now()) {
      const remainMin = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
      throw new Error(`로그인 시도가 너무 많습니다. ${remainMin}분 후 다시 시도하세요.`);
    }
  },

  // 실패 기록
  _recordFailedAttempt(username) {
    const attempts = this._getAttempts(username);
    attempts.count++;
    if (attempts.count >= this.MAX_ATTEMPTS) {
      attempts.lockedUntil = Date.now() + this.LOCKOUT_MS;
      attempts.count = 0;
    }
    this._setAttempts(username, attempts);
  },

  // SHA-256 해시
  async hashPassword(password) {
    const salt = 'sq_architects_2026';
    const encoder = new TextEncoder();
    const data = encoder.encode(salt + password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // 현재 세션 가져오기
  currentUser() {
    const raw = sessionStorage.getItem(this.SESSION_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      // 만료 확인
      if (Date.now() - session.lastActivity > this.TIMEOUT_MS) {
        this.logout();
        return null;
      }
      return session;
    } catch {
      return null;
    }
  },

  // 관리자 여부
  isAdmin() {
    const user = this.currentUser();
    return user && user.role === 'admin';
  },

  // 로그인
  async login(username, password) {
    // 잠금 확인
    this._checkLockout(username);

    await DB.open();
    const users = await DB.getByIndex('users', 'username', username);
    if (users.length === 0) {
      this._recordFailedAttempt(username);
      throw new Error('아이디가 존재하지 않습니다.');
    }

    const user = users[0];
    if (!user.isActive) {
      throw new Error('비활성화된 계정입니다. 관리자에게 문의하세요.');
    }

    const hash = await this.hashPassword(password);
    if (hash !== user.passwordHash) {
      this._recordFailedAttempt(username);
      const attempts = this._getAttempts(username);
      const remaining = this.MAX_ATTEMPTS - attempts.count;
      if (remaining > 0) {
        throw new Error(`비밀번호가 일치하지 않습니다. (${remaining}회 남음)`);
      }
      throw new Error(`로그인 시도가 ${this.MAX_ATTEMPTS}회 초과되어 10분간 잠금됩니다.`);
    }

    // 로그인 성공 → 시도 기록 초기화
    this._clearAttempts(username);

    // 세션 저장
    const session = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      loginAt: Date.now(),
      lastActivity: Date.now()
    };
    sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(session));

    // 마지막 로그인 시간 갱신
    user.lastLogin = new Date().toISOString();
    await DB.update('users', user);

    // 감사 로그
    await DB.log('LOGIN', 'user', user.id, '로그인');

    // 비활동 타이머 시작
    this._startActivityTimer();

    return session;
  },

  // 로그아웃
  logout() {
    sessionStorage.removeItem(this.SESSION_KEY);
    this._stopActivityTimer();
    window.location.hash = '#/login';
    document.getElementById('appShell').classList.remove('active');
    document.getElementById('loginScreen').style.display = 'flex';
  },

  // 비활동 감지
  _startActivityTimer() {
    this._stopActivityTimer();
    const updateActivity = () => {
      const session = this.currentUser();
      if (session) {
        session.lastActivity = Date.now();
        sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
      }
    };

    ['click', 'keydown', 'mousemove', 'scroll'].forEach(evt => {
      document.addEventListener(evt, Utils.debounce(updateActivity, 5000), { passive: true });
    });

    this._activityTimer = setInterval(() => {
      const session = this.currentUser();
      if (!session) {
        this.logout();
        Utils.showToast('세션이 만료되었습니다. 다시 로그인해주세요.', 'warning');
      }
    }, 60000); // 1분마다 확인
  },

  _stopActivityTimer() {
    if (this._activityTimer) {
      clearInterval(this._activityTimer);
      this._activityTimer = null;
    }
  },

  // 초기 관리자 계정 존재 여부
  async hasAdminAccount() {
    await DB.open();
    const admins = await DB.getByIndex('users', 'role', 'admin');
    return admins.length > 0;
  },

  // 초기 관리자 계정 생성
  async createInitialAdmin(username, displayName, password) {
    const hash = await this.hashPassword(password);
    await DB.add('users', {
      username,
      displayName,
      passwordHash: hash,
      role: 'admin',
      department: '경리',
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLogin: null
    });
    await DB.log('CREATE', 'user', null, '초기 관리자 계정 생성: ' + username);
  },

  // 사용자 생성 (관리자 전용)
  async createUser(userData) {
    if (!this.isAdmin()) throw new Error('권한이 없습니다.');

    const hash = await this.hashPassword(userData.password);
    const id = await DB.add('users', {
      username: userData.username,
      displayName: userData.displayName,
      passwordHash: hash,
      role: userData.role || 'employee',
      department: userData.department || '',
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLogin: null
    });
    await DB.log('CREATE', 'user', id, '사용자 생성: ' + userData.username);
    return id;
  },

  // 비밀번호 변경
  async changePassword(userId, newPassword) {
    const user = await DB.get('users', userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');

    user.passwordHash = await this.hashPassword(newPassword);
    await DB.update('users', user);
    await DB.log('UPDATE', 'user', userId, '비밀번호 변경');
  },

  // 권한 확인
  checkPermission(requiredRole) {
    const user = this.currentUser();
    if (!user) return false;
    if (requiredRole === 'admin') return user.role === 'admin';
    return true; // employee는 기본 권한
  }
};

window.Auth = Auth;
