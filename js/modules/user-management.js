/* ============================================
   사용자 관리 모듈 (관리자)
   ============================================ */

const UserManagementModule = {
  container: null,

  async init(container) {
    this.container = container;
    await this.render();
  },

  async render() {
    const users = await DB.getAll('users');

    let tableRows = users.map(u => `
      <tr>
        <td class="fw-medium">${Utils.escapeHtml(u.username)}</td>
        <td>${Utils.escapeHtml(u.displayName)}</td>
        <td>
          <span class="badge ${u.role === 'admin' ? 'badge-complete' : 'badge-request'}">
            ${u.role === 'admin' ? '관리자' : '직원'}
          </span>
        </td>
        <td>${Utils.escapeHtml(u.department || '-')}</td>
        <td>
          <span class="badge ${u.isActive ? 'badge-complete' : 'badge-reject'}">
            ${u.isActive ? '활성' : '비활성'}
          </span>
        </td>
        <td>${u.lastLogin ? Utils.formatDateTime(u.lastLogin) : '미접속'}</td>
        <td>
          <div class="d-flex gap-2">
            <button class="btn btn-ghost btn-sm" onclick="UserManagementModule._edit(${u.id})" title="수정">✏️</button>
            <button class="btn btn-ghost btn-sm" onclick="UserManagementModule._resetPassword(${u.id})" title="비밀번호 초기화">🔑</button>
            <button class="btn btn-ghost btn-sm ${u.isActive ? 'text-danger' : 'text-success'}"
                    onclick="UserManagementModule._toggleActive(${u.id})"
                    title="${u.isActive ? '비활성화' : '활성화'}">
              ${u.isActive ? '🚫' : '✅'}
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    this.container.innerHTML = `
      <div class="page-header">
        <h2>사용자 관리</h2>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="UserManagementModule._openAddModal()">+ 사용자 추가</button>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>아이디</th>
              <th>이름</th>
              <th>역할</th>
              <th>부서</th>
              <th>상태</th>
              <th>마지막 접속</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  },

  _openAddModal(editData = null) {
    const isEdit = !!editData;

    Utils.openModal(`
      <div class="modal-header">
        <h3>${isEdit ? '사용자 수정' : '사용자 추가'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="userForm">
          <div class="form-row">
            <div class="form-group">
              <label for="uUsername">아이디 <span class="required">*</span></label>
              <input type="text" id="uUsername" class="form-control" placeholder="아이디"
                     value="${editData ? Utils.escapeHtml(editData.username) : ''}"
                     ${isEdit ? 'readonly' : 'required'}>
            </div>
            <div class="form-group">
              <label for="uDisplayName">이름 <span class="required">*</span></label>
              <input type="text" id="uDisplayName" class="form-control" placeholder="이름"
                     value="${editData ? Utils.escapeHtml(editData.displayName) : ''}" required>
            </div>
          </div>
          ${!isEdit ? `
            <div class="form-group">
              <label for="uPassword">비밀번호 <span class="required">*</span></label>
              <input type="password" id="uPassword" class="form-control" placeholder="4자 이상" required minlength="4">
            </div>
          ` : ''}
          <div class="form-row">
            <div class="form-group">
              <label for="uRole">역할 <span class="required">*</span></label>
              <select id="uRole" class="form-control" required>
                <option value="employee" ${editData && editData.role === 'employee' ? 'selected' : ''}>직원</option>
                <option value="admin" ${editData && editData.role === 'admin' ? 'selected' : ''}>관리자</option>
              </select>
            </div>
            <div class="form-group">
              <label for="uDepartment">부서</label>
              <input type="text" id="uDepartment" class="form-control" placeholder="부서명"
                     value="${editData ? Utils.escapeHtml(editData.department || '') : ''}">
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="UserManagementModule._save(${isEdit ? editData.id : 'null'})">${isEdit ? '수정' : '추가'}</button>
      </div>
    `);
  },

  async _save(editId) {
    const displayName = document.getElementById('uDisplayName').value.trim();
    const role = document.getElementById('uRole').value;
    const department = document.getElementById('uDepartment').value.trim();

    if (!displayName) {
      Utils.showToast('이름을 입력해 주세요.', 'error');
      return;
    }

    try {
      if (editId) {
        const user = await DB.get('users', editId);
        user.displayName = displayName;
        user.role = role;
        user.department = department;
        await DB.update('users', user);
        await DB.log('UPDATE', 'user', editId, `사용자 수정: ${user.username}`);
        Utils.showToast('사용자 정보가 수정되었습니다.', 'success');
      } else {
        const username = document.getElementById('uUsername').value.trim();
        const password = document.getElementById('uPassword').value;

        if (!username || !password) {
          Utils.showToast('아이디와 비밀번호를 입력해 주세요.', 'error');
          return;
        }

        await Auth.createUser({ username, displayName, password, role, department });
        Utils.showToast('사용자가 추가되었습니다.', 'success');
      }
      Utils.closeModal();
      await this.render();
    } catch (err) {
      Utils.showToast('저장 실패: ' + err.message, 'error');
    }
  },

  async _edit(id) {
    const user = await DB.get('users', id);
    if (user) this._openAddModal(user);
  },

  async _resetPassword(id) {
    const user = await DB.get('users', id);
    if (!user) return;

    Utils.openModal(`
      <div class="modal-header">
        <h3>비밀번호 초기화 - ${Utils.escapeHtml(user.displayName)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="newPw">새 비밀번호 <span class="required">*</span></label>
          <input type="password" id="newPw" class="form-control" placeholder="4자 이상" minlength="4">
        </div>
        <div class="form-group">
          <label for="confirmPw">비밀번호 확인</label>
          <input type="password" id="confirmPw" class="form-control" placeholder="비밀번호 재입력">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="UserManagementModule._confirmResetPw(${id})">변경</button>
      </div>
    `);
  },

  async _confirmResetPw(id) {
    const pw = document.getElementById('newPw').value;
    const confirm = document.getElementById('confirmPw').value;

    if (pw.length < 4) {
      Utils.showToast('비밀번호는 4자 이상이어야 합니다.', 'error');
      return;
    }
    if (pw !== confirm) {
      Utils.showToast('비밀번호가 일치하지 않습니다.', 'error');
      return;
    }

    await Auth.changePassword(id, pw);
    Utils.closeModal();
    Utils.showToast('비밀번호가 변경되었습니다.', 'success');
  },

  async _toggleActive(id) {
    const user = await DB.get('users', id);
    if (!user) return;

    const currentUser = Auth.currentUser();
    if (user.id === currentUser.id) {
      Utils.showToast('자신의 계정은 비활성화할 수 없습니다.', 'error');
      return;
    }

    const action = user.isActive ? '비활성화' : '활성화';
    const confirmed = await Utils.confirm(`${user.displayName} 계정을 ${action}하시겠습니까?`);
    if (!confirmed) return;

    user.isActive = !user.isActive;
    await DB.update('users', user);
    await DB.log('UPDATE', 'user', id, `사용자 ${action}: ${user.username}`);
    Utils.showToast(`${user.displayName} 계정이 ${action}되었습니다.`, 'success');
    await this.render();
  },

  destroy() {}
};

window.UserManagementModule = UserManagementModule;
