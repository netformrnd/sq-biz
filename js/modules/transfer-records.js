/* ============================================
   송금내역 모듈 (용역비용 매입처리)
   - 엑셀 붙여넣기 일괄 등록 지원
   ============================================ */

const TransferModule = {
  container: null,
  mode: 'my',

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
      records = allRecords.filter(r => r.assignedToUserId === user.id).reverse();
    }

    const totalAmount = records.reduce((s, r) => s + (r.amount || 0), 0);

    let tableRows = '';
    if (records.length === 0) {
      tableRows = `<tr><td colspan="8" class="text-center" style="padding:var(--sp-10);">
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
          <td>${Utils.escapeHtml(r.assignedToUserName || '-')}</td>
          <td>
            ${isAdmin ? `
              <div class="d-flex gap-2">
                <button class="btn btn-ghost btn-sm" onclick="TransferModule._edit(${r.id})" title="수정">✏️</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="TransferModule._delete(${r.id})" title="삭제">🗑️</button>
              </div>
            ` : ''}
          </td>
        </tr>
      `).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>송금내역</h2>
        ${isAdmin ? `
          <div class="page-actions">
            <button class="btn btn-secondary" onclick="TransferModule._openPasteModal()">📋 엑셀 붙여넣기 등록</button>
            <button class="btn btn-primary" onclick="TransferModule._openAddModal()">+ 개별 등록</button>
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
              <th>담당직원</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  },

  // ===== 엑셀 붙여넣기 일괄 등록 =====
  _parsedRows: [],

  async _openPasteModal() {
    this._parsedRows = [];
    const users = await DB.getAll('users');
    const activeUsers = users.filter(u => u.isActive);
    const userOptions = activeUsers.map(u =>
      `<option value="${u.id}">${Utils.escapeHtml(u.displayName)} (${u.username})</option>`
    ).join('');

    Utils.openModal(`
      <div class="modal-header">
        <h3>📋 엑셀 붙여넣기 송금내역 등록</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-4);font-size:var(--font-size-sm);">
          <strong>사용법:</strong> 은행 송금내역 엑셀에서 행을 복사(Ctrl+C)한 후 붙여넣기(Ctrl+V) 하세요.<br>
          <span class="text-muted">컬럼: 거래일시 | 출금액 | 입금액 | 잔액 | 거래처명 | ... (출금 내역만 추출)</span>
        </div>

        <div class="form-row mb-4">
          <div class="form-group">
            <label for="pasteAssignee">담당 직원 <span class="required">*</span></label>
            <select id="pasteAssignee" class="form-control" required>
              <option value="">-- 직원 선택 --</option>
              ${userOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="pastePurpose">용도</label>
            <select id="pastePurpose" class="form-control">
              <option value="용역비">용역비</option>
              <option value="외주비">외주비</option>
              <option value="매입비">매입비</option>
              <option value="기타">기타</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label>엑셀 데이터 붙여넣기 <span class="required">*</span></label>
          <textarea id="trPasteArea" class="form-control" rows="8"
                    placeholder="엑셀에서 복사한 데이터를 여기에 붙여넣기 (Ctrl+V)"
                    style="font-family:monospace;font-size:12px;"></textarea>
        </div>

        <button class="btn btn-secondary mb-4" onclick="TransferModule._parsePastedData()">데이터 확인</button>

        <div id="trPastePreview" class="hidden">
          <div class="table-wrapper" style="max-height:300px;overflow-y:auto;">
            <table class="data-table" id="trPasteTable">
              <thead>
                <tr>
                  <th style="width:40px;"><input type="checkbox" id="trSelectAll" checked onchange="TransferModule._toggleSelectAll(this.checked)"></th>
                  <th>송금일</th>
                  <th>수취인</th>
                  <th class="text-right">금액</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div id="trPasteCount" class="text-sm text-muted mt-2"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="trPasteSaveBtn" onclick="TransferModule._savePastedData()" disabled>선택 항목 등록</button>
      </div>
    `, { size: 'modal-lg' });
  },

  _parsePastedData() {
    const raw = document.getElementById('trPasteArea').value.trim();
    if (!raw) { Utils.showToast('데이터를 붙여넣기 하세요.', 'error'); return; }

    const lines = raw.split('\n').filter(l => l.trim());
    this._parsedRows = [];

    for (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 5) continue;

      const dateStr = (cols[0] || '').trim();
      const withdrawStr = (cols[1] || '').trim();
      const nameStr = (cols[4] || '').trim();

      // 출금액 추출 (콤마 제거)
      const withdrawAmount = Number(withdrawStr.replace(/[,\s]/g, '')) || 0;

      // 출금액이 0이면 건너뜀 (입금 내역)
      if (withdrawAmount <= 0) continue;

      // 날짜 파싱
      let date = '';
      const dateMatch = dateStr.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
      if (dateMatch) {
        date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
      }

      this._parsedRows.push({ date, name: nameStr, amount: withdrawAmount, selected: true });
    }

    const preview = document.getElementById('trPastePreview');
    const tbody = document.querySelector('#trPasteTable tbody');
    const saveBtn = document.getElementById('trPasteSaveBtn');

    if (this._parsedRows.length === 0) {
      preview.classList.add('hidden');
      saveBtn.disabled = true;
      Utils.showToast('출금(송금) 데이터를 찾을 수 없습니다.', 'warning');
      return;
    }

    preview.classList.remove('hidden');
    saveBtn.disabled = false;

    tbody.innerHTML = this._parsedRows.map((row, i) => `
      <tr>
        <td><input type="checkbox" data-idx="${i}" ${row.selected ? 'checked' : ''} onchange="TransferModule._toggleRow(${i}, this.checked)"></td>
        <td>${Utils.escapeHtml(row.date)}</td>
        <td class="fw-medium">${Utils.escapeHtml(row.name)}</td>
        <td class="text-right amount">${Utils.formatCurrency(row.amount)}</td>
      </tr>
    `).join('');

    this._updatePasteCount();
  },

  _toggleRow(idx, checked) {
    this._parsedRows[idx].selected = checked;
    this._updatePasteCount();
  },

  _toggleSelectAll(checked) {
    this._parsedRows.forEach((r, i) => {
      r.selected = checked;
      const cb = document.querySelector(`#trPasteTable input[data-idx="${i}"]`);
      if (cb) cb.checked = checked;
    });
    this._updatePasteCount();
  },

  _updatePasteCount() {
    const sel = this._parsedRows.filter(r => r.selected);
    const total = sel.reduce((s, r) => s + r.amount, 0);
    document.getElementById('trPasteCount').textContent =
      `선택 ${sel.length}건 / ${this._parsedRows.length}건 / 합계 ${Utils.formatCurrency(total)}`;
    document.getElementById('trPasteSaveBtn').disabled = sel.length === 0;
  },

  async _savePastedData() {
    const assigneeId = Number(document.getElementById('pasteAssignee').value);
    if (!assigneeId) {
      Utils.showToast('담당 직원을 선택해 주세요.', 'error');
      return;
    }

    const selected = this._parsedRows.filter(r => r.selected);
    if (selected.length === 0) return;

    const assignee = await DB.get('users', assigneeId);
    const user = Auth.currentUser();
    const purpose = document.getElementById('pastePurpose').value;
    let count = 0;

    for (const row of selected) {
      await DB.add('transferRecords', {
        transferDate: row.date,
        recipientName: row.name,
        amount: row.amount,
        purpose,
        projectName: '',
        memo: '',
        assignedToUserId: assigneeId,
        assignedToUserName: assignee ? assignee.displayName : '',
        registeredBy: user.id,
        registeredByName: user.displayName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      count++;
    }

    await DB.log('CREATE', 'transfer', null, `송금내역 일괄 등록: ${count}건`);
    this._parsedRows = [];

    Utils.closeModal();
    Utils.showToast(`${count}건의 송금내역이 등록되었습니다.`, 'success');
    await this.render();
  },

  // ===== 개별 등록 =====
  async _openAddModal(editData = null) {
    const isEdit = !!editData;
    const users = await DB.getAll('users');
    const activeUsers = users.filter(u => u.isActive);

    const userOptions = activeUsers.map(u =>
      `<option value="${u.id}" ${editData && editData.assignedToUserId === u.id ? 'selected' : ''}>${Utils.escapeHtml(u.displayName)} (${u.username})</option>`
    ).join('');

    Utils.openModal(`
      <div class="modal-header">
        <h3>${isEdit ? '송금내역 수정' : '송금내역 개별 등록'}</h3>
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
      } else {
        data.createdAt = new Date().toISOString();
        const id = await DB.add('transferRecords', data);
        await DB.log('CREATE', 'transfer', id, `송금내역 등록: ${recipient} ${Utils.formatCurrency(amount)}`);
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
    await this.render();
  },

  destroy() {}
};

window.TransferModule = TransferModule;
