/* ============================================
   송금내역 모듈 (개별 용역비용 매입처리)
   ============================================ */

const TransferModule = {
  container: null,
  mode: 'my', // 'my' or 'admin'

  async init(container, action) {
    this.container = container;
    this.mode = action || 'my';
    await this.render();
  },

  async render() {
    const user = Auth.currentUser();
    const isAdmin = user.role === 'admin';
    const allRecords = await DB.getAll('transferRecords');

    let records;
    if (this.mode === 'admin' && isAdmin) {
      records = allRecords.reverse();
    } else {
      // 본인에게 할당된 내역만
      records = allRecords.filter(r => r.assignedToUserId === user.id).reverse();
    }

    const totalAmount = records.reduce((s, r) => s + (r.amount || 0), 0);

    let tableRows = '';
    if (records.length === 0) {
      tableRows = `<tr><td colspan="${this.mode === 'admin' ? 8 : 7}" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">💸</div><h3>송금내역이 없습니다</h3></div>
      </td></tr>`;
    } else {
      tableRows = records.map(r => `
        <tr>
          <td>${Utils.formatDate(r.transferDate)}</td>
          <td class="fw-medium">${Utils.escapeHtml(r.recipientName || '-')}</td>
          <td class="text-right amount">${Utils.formatCurrency(r.amount)}</td>
          <td>${Utils.escapeHtml(r.purpose || '-')}</td>
          <td>${Utils.escapeHtml(r.projectName || '-')}</td>
          <td>${Utils.escapeHtml(r.memo || '-')}</td>
          ${this.mode === 'admin' ? `<td>${Utils.escapeHtml(r.assignedToUserName || '-')}</td>` : ''}
          <td>
            ${this.mode === 'admin' && isAdmin ? `
              <div class="d-flex gap-2">
                <button class="btn btn-ghost btn-sm" onclick="TransferModule._edit(${r.id})" title="수정">✏️</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="TransferModule._delete(${r.id})" title="삭제">🗑️</button>
              </div>
            ` : ''}
          </td>
        </tr>
      `).join('');
    }

    const title = this.mode === 'admin' ? '송금내역 관리' : '나의 송금내역';

    this.container.innerHTML = `
      <div class="page-header">
        <h2>${title}</h2>
        ${this.mode === 'admin' && isAdmin ? `
          <div class="page-actions">
            <button class="btn btn-primary" onclick="TransferModule._openAddModal()">+ 송금내역 등록</button>
          </div>
        ` : ''}
      </div>

      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon orange">💸</div>
          <div class="card-info">
            <div class="card-label">총 송금건수</div>
            <div class="card-value">${records.length}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon red">📊</div>
          <div class="card-info">
            <div class="card-label">총 송금액</div>
            <div class="card-value">${Utils.formatCurrency(totalAmount)}</div>
          </div>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>송금일</th>
              <th>수취인</th>
              <th class="text-right">금액</th>
              <th>용도</th>
              <th>프로젝트</th>
              <th>비고</th>
              ${this.mode === 'admin' ? '<th>담당직원</th>' : ''}
              <th>관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  },

  async _openAddModal(editData = null) {
    const isEdit = !!editData;
    const users = await DB.getAll('users');
    const activeUsers = users.filter(u => u.isActive);

    const userOptions = activeUsers.map(u =>
      `<option value="${u.id}" ${editData && editData.assignedToUserId === u.id ? 'selected' : ''}>${Utils.escapeHtml(u.displayName)} (${u.username})</option>`
    ).join('');

    Utils.openModal(`
      <div class="modal-header">
        <h3>${isEdit ? '송금내역 수정' : '송금내역 등록'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="transferForm">
          <div class="form-row">
            <div class="form-group">
              <label for="trDate">송금일 <span class="required">*</span></label>
              <input type="date" id="trDate" class="form-control" value="${editData ? editData.transferDate : Utils.today()}" required>
            </div>
            <div class="form-group">
              <label for="trRecipient">수취인 <span class="required">*</span></label>
              <input type="text" id="trRecipient" class="form-control" placeholder="수취인명" value="${editData ? Utils.escapeHtml(editData.recipientName) : ''}" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="trAmount">금액 <span class="required">*</span></label>
              <input type="number" id="trAmount" class="form-control" placeholder="0" min="0" value="${editData ? editData.amount : ''}" required>
            </div>
            <div class="form-group">
              <label for="trPurpose">용도</label>
              <select id="trPurpose" class="form-control">
                <option value="">선택</option>
                <option value="용역비" ${editData && editData.purpose === '용역비' ? 'selected' : ''}>용역비</option>
                <option value="외주비" ${editData && editData.purpose === '외주비' ? 'selected' : ''}>외주비</option>
                <option value="매입비" ${editData && editData.purpose === '매입비' ? 'selected' : ''}>매입비</option>
                <option value="기타" ${editData && editData.purpose === '기타' ? 'selected' : ''}>기타</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="trProject">프로젝트</label>
              <input type="text" id="trProject" class="form-control" placeholder="관련 프로젝트" value="${editData ? Utils.escapeHtml(editData.projectName || '') : ''}">
            </div>
            <div class="form-group">
              <label for="trAssignee">담당 직원 <span class="required">*</span></label>
              <select id="trAssignee" class="form-control" required>
                <option value="">-- 직원 선택 --</option>
                ${userOptions}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="trMemo">비고</label>
            <textarea id="trMemo" class="form-control" rows="2">${editData ? Utils.escapeHtml(editData.memo || '') : ''}</textarea>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="TransferModule._save(${isEdit ? editData.id : 'null'})">${isEdit ? '수정' : '등록'}</button>
      </div>
    `);
  },

  async _save(editId) {
    const date = document.getElementById('trDate').value;
    const recipient = document.getElementById('trRecipient').value.trim();
    const amount = Number(document.getElementById('trAmount').value) || 0;
    const assigneeId = Number(document.getElementById('trAssignee').value);

    if (!date || !recipient || amount <= 0 || !assigneeId) {
      Utils.showToast('송금일, 수취인, 금액, 담당 직원을 입력해 주세요.', 'error');
      return;
    }

    const assignee = await DB.get('users', assigneeId);
    const user = Auth.currentUser();

    const data = {
      transferDate: date,
      recipientName: recipient,
      amount,
      purpose: document.getElementById('trPurpose').value,
      projectName: document.getElementById('trProject').value.trim(),
      memo: document.getElementById('trMemo').value.trim(),
      assignedToUserId: assigneeId,
      assignedToUserName: assignee ? assignee.displayName : '',
      registeredBy: user.id,
      registeredByName: user.displayName,
      updatedAt: new Date().toISOString()
    };

    try {
      if (editId) {
        data.id = editId;
        const existing = await DB.get('transferRecords', editId);
        data.createdAt = existing.createdAt;
        await DB.update('transferRecords', data);
        await DB.log('UPDATE', 'transfer', editId, '송금내역 수정');
        Utils.showToast('송금내역이 수정되었습니다.', 'success');
      } else {
        data.createdAt = new Date().toISOString();
        const id = await DB.add('transferRecords', data);
        await DB.log('CREATE', 'transfer', id, `송금내역 등록: ${recipient} ${Utils.formatCurrency(amount)}`);
        Utils.showToast('송금내역이 등록되었습니다.', 'success');
      }
      Utils.closeModal();
      await this.render();
    } catch (err) {
      Utils.showToast('저장 실패: ' + err.message, 'error');
    }
  },

  async _edit(id) {
    const item = await DB.get('transferRecords', id);
    if (item) this._openAddModal(item);
  },

  async _delete(id) {
    const confirmed = await Utils.confirm('이 송금내역을 삭제하시겠습니까?', '송금내역 삭제');
    if (!confirmed) return;

    await DB.delete('transferRecords', id);
    await DB.log('DELETE', 'transfer', id, '송금내역 삭제');
    Utils.showToast('송금내역이 삭제되었습니다.', 'success');
    await this.render();
  },

  destroy() {}
};

window.TransferModule = TransferModule;
