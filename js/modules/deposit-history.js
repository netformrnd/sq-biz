/* ============================================
   입금내역 모듈
   - 엑셀 복사 붙여넣기 일괄 등록 지원
   ============================================ */

const DepositModule = {
  container: null,
  searchText: '',

  async init(container) {
    this.container = container;
    this.searchText = '';
    await this.render();
  },

  async render() {
    const isAdmin = Auth.isAdmin();
    const deposits = await DB.getAll('deposits');
    const items = deposits.reverse();

    // 날짜 필터
    DateFilter.onChange('deposits', () => this.render());
    let filtered = DateFilter.filter(items, 'depositDate', 'deposits');

    // 검색 필터
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      filtered = filtered.filter(d =>
        (d.depositorName || '').toLowerCase().includes(q) ||
        (d.projectName || '').toLowerCase().includes(q) ||
        (d.memo || '').toLowerCase().includes(q) ||
        String(d.amount).includes(q)
      );
    }

    // 합계
    const totalAmount = filtered.reduce((s, d) => s + (d.amount || 0), 0);

    let tableRows = '';
    if (filtered.length === 0) {
      tableRows = `<tr><td colspan="7" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">💰</div><h3>입금내역이 없습니다</h3></div>
      </td></tr>`;
    } else {
      tableRows = filtered.map(d => `
        <tr oncontextmenu="DepositModule._showContextMenu(event, '${d.id}')">
          <td>${Utils.formatDate(d.depositDate)}</td>
          <td class="fw-medium">${Utils.escapeHtml(d.depositorName || '-')}</td>
          <td class="text-right amount">${Utils.formatCurrency(d.amount)}</td>
          <td>${Utils.escapeHtml(d.projectName || '-')}</td>
          <td>${Utils.escapeHtml(d.memo || '-')}</td>
          <td class="text-center">${Utils.statusBadge(d.matchStatus || '미매칭')}</td>
          <td>
            ${isAdmin ? `
              <div class="d-flex gap-2">
                <button class="btn btn-ghost btn-sm" onclick="DepositModule._edit('${d.id}')" title="수정">✏️</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="DepositModule._delete('${d.id}')" title="삭제">🗑️</button>
              </div>
            ` : ''}
          </td>
        </tr>
      `).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>입금내역</h2>
        ${isAdmin ? `
          <div class="page-actions">
            <button class="btn btn-secondary" onclick="DepositModule._openPasteModal()">📋 엑셀 붙여넣기 등록</button>
            <button class="btn btn-primary" onclick="DepositModule._openAddModal()">+ 개별 등록</button>
          </div>
        ` : ''}
      </div>

      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon cyan">💰</div>
          <div class="card-info">
            <div class="card-label">총 입금건수</div>
            <div class="card-value">${filtered.length}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon green">📊</div>
          <div class="card-info">
            <div class="card-label">총 입금액</div>
            <div class="card-value">${Utils.formatCurrency(totalAmount)}</div>
          </div>
        </div>
      </div>

      <div class="mb-4">${DateFilter.render('deposits')}</div>

      <div class="table-wrapper">
        <div class="table-toolbar">
          <div class="toolbar-left">
            <div class="search-input">
              <span class="search-icon">🔍</span>
              <input type="text" class="form-control" id="depositSearch" placeholder="입금자명, 프로젝트, 적요 검색..." value="${Utils.escapeHtml(this.searchText)}">
            </div>
          </div>
          <div class="toolbar-right text-sm text-muted">
            총 ${filtered.length}건
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>입금일</th>
              <th>입금자명</th>
              <th class="text-right">입금액</th>
              <th>프로젝트</th>
              <th>적요</th>
              <th class="text-center">매칭상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;

    // 검색 이벤트
    document.getElementById('depositSearch').addEventListener('input', Utils.debounce((e) => {
      this.searchText = e.target.value;
      this.render();
    }, 300));
  },

  // ===== 엑셀 붙여넣기 일괄 등록 =====
  _openPasteModal() {
    Utils.openModal(`
      <div class="modal-header">
        <h3>📋 엑셀 붙여넣기 입금내역 등록</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-4);font-size:var(--font-size-sm);">
          <strong>사용법:</strong> 은행 거래내역 엑셀에서 입금 행들을 복사(Ctrl+C)한 후 아래 영역에 붙여넣기(Ctrl+V) 하세요.<br>
          <span class="text-muted">컬럼 순서: 거래일시 | 출금 | 입금 | 잔액 | 거래처명 | ... (은행 기본 형식)</span>
        </div>

        <div class="form-group">
          <label>엑셀 데이터 붙여넣기 <span class="required">*</span></label>
          <textarea id="pasteArea" class="form-control" rows="8"
                    placeholder="엑셀에서 복사한 데이터를 여기에 붙여넣기 하세요 (Ctrl+V)"
                    style="font-family:monospace;font-size:12px;"></textarea>
        </div>

        <button class="btn btn-secondary mb-4" onclick="DepositModule._parsePastedData()">데이터 확인</button>

        <!-- 파싱 결과 미리보기 -->
        <div id="pastePreview" class="hidden">
          <div class="form-group">
            <label class="fw-semibold">입금 내역 미리보기</label>
            <div class="text-xs text-muted mb-2">입금액이 0이거나 빈 행은 자동으로 제외됩니다 (출금 내역 제외)</div>
          </div>
          <div class="table-wrapper" style="max-height:300px;overflow-y:auto;">
            <table class="data-table" id="pastePreviewTable">
              <thead>
                <tr>
                  <th style="width:40px;">
                    <input type="checkbox" id="pasteSelectAll" checked onchange="DepositModule._toggleSelectAll(this.checked)">
                  </th>
                  <th>입금일</th>
                  <th>입금자명</th>
                  <th class="text-right">입금액</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div id="pasteCount" class="text-sm text-muted mt-2"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="pasteSaveBtn" onclick="DepositModule._savePastedData()" disabled>선택 항목 등록</button>
      </div>
    `, { size: 'modal-lg' });
  },

  // 엑셀 데이터 파싱 (탭 구분)
  _parsedRows: [],

  _parsePastedData() {
    const raw = document.getElementById('pasteArea').value.trim();
    if (!raw) {
      Utils.showToast('붙여넣기 데이터가 없습니다.', 'error');
      return;
    }

    const lines = raw.split('\n').filter(l => l.trim());
    this._parsedRows = [];

    for (const line of lines) {
      // 탭 또는 여러 공백으로 분리
      const cols = line.split('\t');

      if (cols.length < 5) continue; // 최소 5컬럼 필요

      const dateStr = (cols[0] || '').trim();
      const withdrawStr = (cols[1] || '').trim();
      const depositStr = (cols[2] || '').trim();

      // 입금액 추출 (콤마 제거)
      const depositAmount = Number(depositStr.replace(/[,\s]/g, '')) || 0;

      // 입금액이 0이면 건너뜀 (출금 내역)
      if (depositAmount <= 0) continue;

      // 입금자명: 은행마다 컬럼 위치가 다르므로 cols[3]부터 탐색
      let accountNo = '';
      let depositorName = '';
      for (let i = 3; i < cols.length; i++) {
        const val = (cols[i] || '').trim();
        if (!val) continue;
        if (/^\d{5,}$/.test(val.replace(/[-\s]/g, '')) && !accountNo) accountNo = val;
        if (/[가-힣]/.test(val) && !depositorName) depositorName = val;
      }
      if (!depositorName) depositorName = (cols[4] || '').trim();
      const nameStr = accountNo && depositorName ? `${depositorName} (${accountNo})` : depositorName || accountNo;

      // 날짜 파싱
      let date = '';
      if (dateStr) {
        const dateMatch = dateStr.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
        if (dateMatch) {
          date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
        }
      }

      this._parsedRows.push({
        date: date,
        name: nameStr,
        amount: depositAmount,
        selected: true
      });
    }

    // 미리보기 표시
    const preview = document.getElementById('pastePreview');
    const tbody = document.querySelector('#pastePreviewTable tbody');
    const saveBtn = document.getElementById('pasteSaveBtn');

    if (this._parsedRows.length === 0) {
      preview.classList.add('hidden');
      saveBtn.disabled = true;
      Utils.showToast('입금 데이터를 찾을 수 없습니다. 엑셀에서 올바르게 복사했는지 확인하세요.', 'warning');
      return;
    }

    preview.classList.remove('hidden');
    saveBtn.disabled = false;

    tbody.innerHTML = this._parsedRows.map((row, i) => `
      <tr>
        <td><input type="checkbox" data-idx="${i}" ${row.selected ? 'checked' : ''} onchange="DepositModule._toggleRow(${i}, this.checked)"></td>
        <td>${Utils.escapeHtml(row.date)}</td>
        <td class="fw-medium">${Utils.escapeHtml(row.name)}</td>
        <td class="text-right amount">${Utils.formatCurrency(row.amount)}</td>
      </tr>
    `).join('');

    const totalAmt = this._parsedRows.filter(r => r.selected).reduce((s, r) => s + r.amount, 0);
    document.getElementById('pasteCount').textContent =
      `총 ${this._parsedRows.length}건 / 합계 ${Utils.formatCurrency(totalAmt)}`;
  },

  _toggleRow(idx, checked) {
    this._parsedRows[idx].selected = checked;
    const selectedCount = this._parsedRows.filter(r => r.selected).length;
    const totalAmt = this._parsedRows.filter(r => r.selected).reduce((s, r) => s + r.amount, 0);
    document.getElementById('pasteCount').textContent =
      `선택 ${selectedCount}건 / ${this._parsedRows.length}건 / 합계 ${Utils.formatCurrency(totalAmt)}`;
    document.getElementById('pasteSaveBtn').disabled = selectedCount === 0;
  },

  _toggleSelectAll(checked) {
    this._parsedRows.forEach((r, i) => {
      r.selected = checked;
      const cb = document.querySelector(`input[data-idx="${i}"]`);
      if (cb) cb.checked = checked;
    });
    const totalAmt = checked ? this._parsedRows.reduce((s, r) => s + r.amount, 0) : 0;
    const cnt = checked ? this._parsedRows.length : 0;
    document.getElementById('pasteCount').textContent =
      `선택 ${cnt}건 / ${this._parsedRows.length}건 / 합계 ${Utils.formatCurrency(totalAmt)}`;
    document.getElementById('pasteSaveBtn').disabled = !checked;
  },

  async _savePastedData() {
    const selected = this._parsedRows.filter(r => r.selected);
    if (selected.length === 0) return;

    const user = Auth.currentUser();
    let savedCount = 0;

    for (const row of selected) {
      await DB.add('deposits', {
        depositDate: row.date,
        depositorName: row.name,
        amount: row.amount,
        projectName: '',
        memo: '',
        bankAccount: '',
        matchStatus: '미매칭',
        matchedInvoiceId: null,
        registeredBy: user.id,
        registeredByName: user.displayName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      savedCount++;
    }

    await DB.log('CREATE', 'deposit', null, `입금내역 일괄 등록: ${savedCount}건`);
    this._parsedRows = [];

    Utils.closeModal();
    Utils.showToast(`${savedCount}건의 입금내역이 등록되었습니다.`, 'success');
    await this.render();
  },

  // ===== 개별 등록 =====
  _openAddModal(editData = null) {
    const isEdit = !!editData;
    const title = isEdit ? '입금내역 수정' : '입금내역 개별 등록';

    Utils.openModal(`
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="depositForm">
          <div class="form-row">
            <div class="form-group">
              <label for="depDate">입금일 <span class="required">*</span></label>
              <input type="date" id="depDate" class="form-control" value="${editData ? editData.depositDate : Utils.today()}" required>
            </div>
            <div class="form-group">
              <label for="depName">입금자명 <span class="required">*</span></label>
              <input type="text" id="depName" class="form-control" placeholder="입금자명" value="${editData ? Utils.escapeHtml(editData.depositorName) : ''}" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="depAmount">입금액 <span class="required">*</span></label>
              <input type="number" id="depAmount" class="form-control" placeholder="0" min="0" value="${editData ? editData.amount : ''}" required>
            </div>
            <div class="form-group">
              <label for="depProject">프로젝트</label>
              <input type="text" id="depProject" class="form-control" placeholder="프로젝트명" value="${editData ? Utils.escapeHtml(editData.projectName || '') : ''}">
            </div>
          </div>
          <div class="form-group">
            <label for="depMemo">적요 / 메모</label>
            <textarea id="depMemo" class="form-control" rows="2" placeholder="적요 또는 메모">${editData ? Utils.escapeHtml(editData.memo || '') : ''}</textarea>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="DepositModule._saveDeposit(${isEdit ? `'${editData.id}'` : 'null'})">${isEdit ? '수정' : '등록'}</button>
      </div>
    `);
  },

  async _saveDeposit(editId) {
    const date = document.getElementById('depDate').value;
    const name = document.getElementById('depName').value.trim();
    const amount = Number(document.getElementById('depAmount').value) || 0;

    if (!date || !name || amount <= 0) {
      Utils.showToast('입금일, 입금자명, 입금액을 입력해 주세요.', 'error');
      return;
    }

    const user = Auth.currentUser();
    const data = {
      depositDate: date,
      depositorName: name,
      amount,
      projectName: document.getElementById('depProject').value.trim(),
      memo: document.getElementById('depMemo').value.trim(),
      bankAccount: '',
      matchStatus: '미매칭',
      matchedInvoiceId: null,
      registeredBy: user.id,
      registeredByName: user.displayName,
      updatedAt: new Date().toISOString()
    };

    try {
      if (editId) {
        const existing = await DB.get('deposits', editId);
        data.id = editId;
        data.matchStatus = existing.matchStatus;
        data.matchedInvoiceId = existing.matchedInvoiceId;
        data.createdAt = existing.createdAt;
        await DB.update('deposits', data);
        await DB.log('UPDATE', 'deposit', editId, '입금내역 수정');
      } else {
        data.createdAt = new Date().toISOString();
        const id = await DB.add('deposits', data);
        await DB.log('CREATE', 'deposit', id, `입금내역 등록: ${name} ${Utils.formatCurrency(amount)}`);
      }
      Utils.closeModal();
      await this.render();
    } catch (err) {
      Utils.showToast('저장 실패: ' + err.message, 'error');
    }
  },

  async _edit(id) {
    const item = await DB.get('deposits', id);
    if (item) this._openAddModal(item);
  },

  async _delete(id) {
    const confirmed = await Utils.confirm('이 입금내역을 삭제하시겠습니까?', '입금내역 삭제');
    if (!confirmed) return;

    await DB.delete('deposits', id);
    await DB.log('DELETE', 'deposit', id, '입금내역 삭제');
    await this.render();
  },

  // 우클릭 컨텍스트 메뉴
  _showContextMenu(event, id) {
    const isAdmin = Auth.isAdmin();
    const items = [];

    if (isAdmin) {
      items.push({ icon: '✏️', label: '수정', onClick: () => this._edit(id) });
      items.push({ divider: true });
      items.push({ icon: '🗑️', label: '삭제', danger: true, onClick: () => this._delete(id) });
    } else {
      items.push({ icon: 'ℹ️', label: '관리자만 수정/삭제 가능', onClick: () => {} });
    }

    ContextMenu.show(event, items);
  },

  destroy() {}
};

window.DepositModule = DepositModule;
