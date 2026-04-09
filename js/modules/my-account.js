/* ============================================
   내 계정 모듈 (비밀번호 변경 등)
   모든 사용자가 접근 가능
   ============================================ */

const MyAccountModule = {
  container: null,

  async init(container) {
    this.container = container;
    await this.render();
  },

  async render() {
    const session = Auth.currentUser();
    const user = await DB.get('users', session.id);

    this.container.innerHTML = `
      <!-- 내 정보 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>👤 내 정보</h3>
        </div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group">
              <label class="text-xs text-muted">아이디</label>
              <div class="fw-medium" style="padding:var(--sp-2) 0;">${Utils.escapeHtml(user.username)}</div>
            </div>
            <div class="form-group">
              <label class="text-xs text-muted">이름</label>
              <div class="fw-medium" style="padding:var(--sp-2) 0;">${Utils.escapeHtml(user.displayName)}</div>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="text-xs text-muted">역할</label>
              <div style="padding:var(--sp-2) 0;">
                <span class="badge ${user.role === 'admin' ? 'badge-complete' : 'badge-request'}">
                  ${user.role === 'admin' ? '관리자' : '직원'}
                </span>
              </div>
            </div>
            <div class="form-group">
              <label class="text-xs text-muted">부서</label>
              <div style="padding:var(--sp-2) 0;">${Utils.escapeHtml(user.department || '-')}</div>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="text-xs text-muted">계정 생성일</label>
              <div class="text-sm" style="padding:var(--sp-2) 0;">${Utils.formatDateTime(user.createdAt)}</div>
            </div>
            <div class="form-group">
              <label class="text-xs text-muted">마지막 로그인</label>
              <div class="text-sm" style="padding:var(--sp-2) 0;">${user.lastLogin ? Utils.formatDateTime(user.lastLogin) : '-'}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 비밀번호 변경 -->
      <div class="card">
        <div class="card-header">
          <h3>🔑 비밀번호 변경</h3>
        </div>
        <div class="card-body">
          <form id="changePwForm">
            <div class="form-group" style="max-width:400px;">
              <label for="currentPw">현재 비밀번호 <span class="required">*</span></label>
              <input type="password" id="currentPw" class="form-control" placeholder="현재 비밀번호 입력" required>
            </div>
            <div class="form-group" style="max-width:400px;">
              <label for="newPw">새 비밀번호 <span class="required">*</span></label>
              <input type="password" id="newPw" class="form-control" placeholder="4자 이상" required minlength="4">
            </div>
            <div class="form-group" style="max-width:400px;">
              <label for="confirmNewPw">새 비밀번호 확인 <span class="required">*</span></label>
              <input type="password" id="confirmNewPw" class="form-control" placeholder="새 비밀번호 재입력" required>
            </div>
            <div id="pwChangeError" style="color:var(--color-danger);font-size:var(--font-size-sm);min-height:20px;margin-bottom:var(--sp-3);"></div>
            <button type="submit" class="btn btn-primary">비밀번호 변경</button>
          </form>
        </div>
      </div>
    `;

    // 폼 이벤트
    document.getElementById('changePwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this._changePassword();
    });
  },

  async _changePassword() {
    const errorEl = document.getElementById('pwChangeError');
    errorEl.textContent = '';

    const currentPw = document.getElementById('currentPw').value;
    const newPw = document.getElementById('newPw').value;
    const confirmPw = document.getElementById('confirmNewPw').value;

    // 유효성 검사
    if (!currentPw) {
      errorEl.textContent = '현재 비밀번호를 입력해주세요.';
      return;
    }
    if (newPw.length < 4) {
      errorEl.textContent = '새 비밀번호는 4자 이상이어야 합니다.';
      return;
    }
    if (newPw !== confirmPw) {
      errorEl.textContent = '새 비밀번호가 일치하지 않습니다.';
      return;
    }
    if (currentPw === newPw) {
      errorEl.textContent = '현재 비밀번호와 다른 비밀번호를 입력해주세요.';
      return;
    }

    try {
      // 현재 비밀번호 확인
      const session = Auth.currentUser();
      const user = await DB.get('users', session.id);
      const currentHash = await Auth.hashPassword(currentPw);

      if (currentHash !== user.passwordHash) {
        errorEl.textContent = '현재 비밀번호가 일치하지 않습니다.';
        return;
      }

      // 비밀번호 변경
      await Auth.changePassword(session.id, newPw);

      // 폼 초기화
      document.getElementById('changePwForm').reset();
      Utils.showToast('비밀번호가 성공적으로 변경되었습니다.', 'success');
    } catch (err) {
      errorEl.textContent = '비밀번호 변경 실패: ' + err.message;
    }
  },

  destroy() {}
};

window.MyAccountModule = MyAccountModule;
