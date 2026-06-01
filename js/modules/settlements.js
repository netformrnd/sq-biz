/* ============================================
   발주-외주 정산표 모듈 (이사님 명세서 형식)
   - 건축주별 입금/외주 출금 매칭 관리
   - 자동 합계, 차액 표시
   - 엑셀 양식/리스트 다운로드, PDF 보고서
   - 권한: 관리자 + 'settlements' 권한 보유자
   ============================================ */

const SettlementsModule = {
  container: null,
  searchText: '',
  yearFilter: 'all',
  statusFilter: 'all',

  async init(container) {
    this.container = container;
    await this.render();
  },

  async render() {
    const all = await DB.getAll('settlements');
    let items = all.slice().reverse();

    // 연도 필터
    if (this.yearFilter !== 'all') {
      items = items.filter(s => {
        const y = (s.depositDate || s.withdrawDate || '').slice(0, 4);
        return y === this.yearFilter;
      });
    }

    // 상태 필터
    if (this.statusFilter === 'completed') {
      items = items.filter(s => (s.depositAmount || 0) > 0 && (s.withdrawAmount || 0) > 0);
    } else if (this.statusFilter === 'income_only') {
      items = items.filter(s => (s.depositAmount || 0) > 0 && !(s.withdrawAmount || 0));
    } else if (this.statusFilter === 'expense_only') {
      items = items.filter(s => !(s.depositAmount || 0) && (s.withdrawAmount || 0) > 0);
    }

    // 검색 필터
    let filtered = items;
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      filtered = items.filter(s =>
        (s.clientName || '').toLowerCase().includes(q) ||
        (s.outsourceName || '').toLowerCase().includes(q) ||
        (s.projectName || '').toLowerCase().includes(q) ||
        (s.memo || '').toLowerCase().includes(q) ||
        String(s.depositAmount || '').includes(q) ||
        String(s.withdrawAmount || '').includes(q)
      );
    }

    // 합계
    const totalDeposit = filtered.reduce((s, i) => s + (i.depositAmount || 0), 0);
    const totalWithdraw = filtered.reduce((s, i) => s + (i.withdrawAmount || 0), 0);
    const totalDiff = totalDeposit - totalWithdraw;

    // 연도 옵션 (데이터에서 자동 추출)
    const years = [...new Set(all.map(s => (s.depositDate || s.withdrawDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();

    let tableRows = '';
    if (filtered.length === 0) {
      tableRows = `<tr><td colspan="9" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">📋</div>
        <h3>등록된 정산 내역이 없습니다</h3>
        <p class="text-muted">우측 상단 [+ 신규 등록] 또는 [📥 일괄 등록]으로 추가하세요.</p>
        </div></td></tr>`;
    } else {
      tableRows = filtered.map(s => {
        const diff = (s.depositAmount || 0) - (s.withdrawAmount || 0);
        const diffColor = diff > 0 ? '#10b981' : (diff < 0 ? '#ef4444' : '#6b7280');
        const rowBg = (s.depositAmount > 0 && s.withdrawAmount > 0) ? 'background:rgba(16,185,129,.04);' : '';
        return `
          <tr style="${rowBg}">
            <td class="fw-medium" title="${Utils.escapeHtml(s.clientName || '')}">${Utils.escapeHtml(s.clientName || '-')}</td>
            <td>${s.depositDate ? Utils.formatDate(s.depositDate) : '<span class="text-muted">-</span>'}</td>
            <td class="text-right">${s.depositAmount ? Utils.formatCurrency(s.depositAmount) : '<span class="text-muted">-</span>'}</td>
            <td>${s.withdrawDate ? Utils.formatDate(s.withdrawDate) : '<span class="text-muted">-</span>'}</td>
            <td class="text-right">${s.withdrawAmount ? Utils.formatCurrency(s.withdrawAmount) : '<span class="text-muted">-</span>'}</td>
            <td class="text-right" style="color:${diffColor};font-weight:600;">${Utils.formatCurrency(diff)}</td>
            <td>${Utils.escapeHtml(s.outsourceName || '대림건축')}</td>
            <td class="text-xs text-muted" title="${Utils.escapeHtml(s.memo || '')}">${Utils.escapeHtml((s.memo || '').slice(0, 25))}</td>
            <td>
              <div class="d-flex gap-1">
                <button class="btn btn-ghost btn-sm" onclick="SettlementsModule._openEditModal('${s.id}')" title="수정">✏️</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="SettlementsModule._delete('${s.id}')" title="삭제">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    const isAdmin = Auth.isAdmin();
    this.container.innerHTML = `
      <div class="page-header">
        <h2>📋 발주-외주 정산표 ${!isAdmin ? '<span class="text-xs text-muted" style="font-weight:400;">· 조회 모드</span>' : ''}</h2>
        ${isAdmin ? `
          <div class="page-actions d-flex gap-2">
            <button class="btn btn-ghost btn-sm" onclick="SettlementsModule._showGuide()">💡 도움말</button>
            <button class="btn btn-secondary btn-sm" onclick="SettlementsModule._openBulkModal()">📥 일괄 등록</button>
            <button class="btn btn-secondary btn-sm" onclick="SettlementsModule._exportExcel()">📤 엑셀 다운로드</button>
            <button class="btn btn-secondary btn-sm" onclick="SettlementsModule._exportPDF()">📄 PDF 보고서</button>
            <button class="btn btn-primary btn-sm" onclick="SettlementsModule._openAddModal()">+ 신규 등록</button>
          </div>
        ` : ''}
      </div>

      <div class="grid grid-3 gap-3 mb-4">
        <div class="card" style="border-left:4px solid #3B82F6;">
          <div class="card-body">
            <div class="text-sm text-muted">💰 입금 합계</div>
            <div style="font-size:1.5rem;font-weight:700;color:#3B82F6;">${Utils.formatCurrency(totalDeposit)}</div>
            <div class="text-xs text-muted">${filtered.filter(f => f.depositAmount > 0).length}건</div>
          </div>
        </div>
        <div class="card" style="border-left:4px solid #F59E0B;">
          <div class="card-body">
            <div class="text-sm text-muted">💸 외주 출금 합계</div>
            <div style="font-size:1.5rem;font-weight:700;color:#F59E0B;">${Utils.formatCurrency(totalWithdraw)}</div>
            <div class="text-xs text-muted">${filtered.filter(f => f.withdrawAmount > 0).length}건</div>
          </div>
        </div>
        <div class="card" style="border-left:4px solid ${totalDiff >= 0 ? '#10B981' : '#EF4444'};">
          <div class="card-body">
            <div class="text-sm text-muted">📊 차액 (입금 - 출금)</div>
            <div style="font-size:1.5rem;font-weight:700;color:${totalDiff >= 0 ? '#10B981' : '#EF4444'};">${Utils.formatCurrency(totalDiff)}</div>
            <div class="text-xs text-muted">${totalDiff >= 0 ? '회사 보유' : '초과 지출'}</div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:var(--sp-2);align-items:center;margin-bottom:var(--sp-3);flex-wrap:wrap;">
        <div class="search-input" style="flex:1;min-width:250px;">
          <span class="search-icon">🔍</span>
          <input type="text" id="settlementSearch" class="form-control" placeholder="건축주/외주/프로젝트/메모/금액 검색..." value="${Utils.escapeHtml(this.searchText || '')}">
        </div>
        <select class="form-control" style="max-width:120px;" onchange="SettlementsModule._setYearFilter(this.value)">
          <option value="all" ${this.yearFilter === 'all' ? 'selected' : ''}>전체 연도</option>
          ${years.map(y => `<option value="${y}" ${this.yearFilter === y ? 'selected' : ''}>${y}년</option>`).join('')}
        </select>
        <select class="form-control" style="max-width:140px;" onchange="SettlementsModule._setStatusFilter(this.value)">
          <option value="all" ${this.statusFilter === 'all' ? 'selected' : ''}>전체 상태</option>
          <option value="completed" ${this.statusFilter === 'completed' ? 'selected' : ''}>✅ 완료</option>
          <option value="income_only" ${this.statusFilter === 'income_only' ? 'selected' : ''}>💰 입금만 (외주 미지급)</option>
          <option value="expense_only" ${this.statusFilter === 'expense_only' ? 'selected' : ''}>💸 출금만</option>
        </select>
        <div class="text-sm text-muted">총 ${filtered.length}건</div>
      </div>

      <div class="table-wrapper" style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>건축주(발주처)</th>
              <th>입금일</th>
              <th class="text-right">입금금액</th>
              <th>출금일</th>
              <th class="text-right">출금금액</th>
              <th class="text-right">차액</th>
              <th>외주업체</th>
              <th>메모</th>
              <th style="width:90px;">관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;

    // 검색 이벤트
    Utils.bindSearchInput(document.getElementById('settlementSearch'), (value) => {
      this.searchText = value;
      this.render();
    });
  },

  _setYearFilter(year) {
    this.yearFilter = year;
    this.render();
  },

  _setStatusFilter(status) {
    this.statusFilter = status;
    this.render();
  },

  // ===== 신규/수정 모달 =====
  _openAddModal() {
    this._openEditModalInternal(null);
  },

  async _openEditModal(id) {
    const item = await DB.get('settlements', id);
    if (item) this._openEditModalInternal(item);
  },

  _openEditModalInternal(editData) {
    const isEdit = !!editData;
    Utils.openModal(`
      <div class="modal-header">
        <h3>${isEdit ? '정산 수정' : '+ 신규 정산 등록'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="stClient">건축주(발주처) <span class="required">*</span></label>
          <input type="text" id="stClient" class="form-control" placeholder="예: 청은리싸이클링주식회사"
                 value="${editData ? Utils.escapeHtml(editData.clientName || '') : ''}" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="stDepositDate">입금일</label>
            <input type="date" id="stDepositDate" class="form-control"
                   value="${editData ? (editData.depositDate || '') : ''}">
          </div>
          <div class="form-group">
            <label for="stDepositAmount">입금금액 (원)</label>
            <input type="number" id="stDepositAmount" class="form-control" placeholder="0" min="0"
                   value="${editData ? (editData.depositAmount || '') : ''}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="stWithdrawDate">출금일 (외주 송금)</label>
            <input type="date" id="stWithdrawDate" class="form-control"
                   value="${editData ? (editData.withdrawDate || '') : ''}">
          </div>
          <div class="form-group">
            <label for="stWithdrawAmount">출금금액 (원)</label>
            <input type="number" id="stWithdrawAmount" class="form-control" placeholder="0" min="0"
                   value="${editData ? (editData.withdrawAmount || '') : ''}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="stOutsource">외주업체</label>
            <input type="text" id="stOutsource" class="form-control" placeholder="기본: 대림건축"
                   value="${editData ? Utils.escapeHtml(editData.outsourceName || '대림건축') : '대림건축'}">
          </div>
          <div class="form-group">
            <label for="stProject">프로젝트명</label>
            <input type="text" id="stProject" class="form-control" placeholder="선택"
                   value="${editData ? Utils.escapeHtml(editData.projectName || '') : ''}">
          </div>
        </div>

        <div class="form-group">
          <label for="stMemo">메모</label>
          <textarea id="stMemo" class="form-control" rows="2" placeholder="추가 메모">${editData ? Utils.escapeHtml(editData.memo || '') : ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="SettlementsModule._save(${isEdit ? `'${editData.id}'` : 'null'})">${isEdit ? '수정' : '등록'}</button>
      </div>
    `, { size: 'modal-lg' });
  },

  async _save(editId) {
    const clientName = document.getElementById('stClient').value.trim();
    if (!clientName) {
      Utils.showToast('건축주(발주처)를 입력해 주세요.', 'error');
      return;
    }

    const user = Auth.currentUser();
    const data = {
      clientName,
      depositDate: document.getElementById('stDepositDate').value || null,
      depositAmount: Number(document.getElementById('stDepositAmount').value) || 0,
      withdrawDate: document.getElementById('stWithdrawDate').value || null,
      withdrawAmount: Number(document.getElementById('stWithdrawAmount').value) || 0,
      outsourceName: document.getElementById('stOutsource').value.trim() || '대림건축',
      projectName: document.getElementById('stProject').value.trim(),
      memo: document.getElementById('stMemo').value.trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
      updatedByName: user.displayName
    };

    try {
      if (editId) {
        data.id = editId;
        const existing = await DB.get('settlements', editId);
        data.createdAt = existing.createdAt;
        data.createdBy = existing.createdBy;
        await DB.update('settlements', data);
        await DB.log('UPDATE', 'settlements', editId, `정산 수정: ${clientName}`);
      } else {
        data.createdAt = new Date().toISOString();
        data.createdBy = user.id;
        data.createdByName = user.displayName;
        const id = await DB.add('settlements', data);
        await DB.log('CREATE', 'settlements', id, `정산 등록: ${clientName}`);
      }
      Utils.closeModal();
      Utils.showToast('저장 완료', 'success');
      await this.render();
    } catch (err) {
      Utils.showToast('저장 실패: ' + err.message, 'error');
    }
  },

  async _delete(id) {
    const item = await DB.get('settlements', id);
    if (!item) return;
    const ok = await Utils.confirm(`이 정산 항목을 삭제하시겠습니까?\n\n건축주: ${item.clientName}\n입금: ${Utils.formatCurrency(item.depositAmount || 0)}\n출금: ${Utils.formatCurrency(item.withdrawAmount || 0)}`, '정산 삭제');
    if (!ok) return;

    await DB.delete('settlements', id);
    await DB.log('DELETE', 'settlements', id, `정산 삭제: ${item.clientName}`);
    Utils.showToast('삭제 완료', 'success');
    await this.render();
  },

  // ===== 일괄 등록 (엑셀 붙여넣기) =====
  _openBulkModal() {
    Utils.openModal(`
      <div class="modal-header">
        <h3>📥 발주-외주 정산 일괄 등록</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-4);font-size:var(--font-size-sm);">
          <strong>엑셀 헤더 형식:</strong><br>
          <code>건축주 | 입금일 | 입금금액 | 출금금액 | 출금일</code> (또는 비고 추가)<br>
          헤더를 포함해 복사하면 자동 매핑됩니다. 일자는 YYYY-MM-DD 또는 YY-MM-DD 형식.
        </div>

        <div class="form-group">
          <label>정산 데이터 붙여넣기 <span class="required">*</span></label>
          <textarea id="settlementPasteArea" class="form-control" rows="10"
                    placeholder="이사님 명세서 엑셀에서 복사한 데이터를 여기에 붙여넣기 (Ctrl+V)"
                    style="font-family:monospace;font-size:12px;"></textarea>
        </div>

        <div class="d-flex gap-2 mb-4">
          <button class="btn btn-secondary" onclick="SettlementsModule._parseBulk()">🔍 데이터 분석</button>
        </div>

        <div id="settlementParseResult" class="hidden">
          <div class="card mb-4">
            <div class="card-header" style="background:var(--color-primary-light);">
              <h3>📝 정산 내역 <span id="settlementParsedCount" class="text-sm text-muted"></span></h3>
            </div>
            <div class="card-body" style="padding:0;max-height:350px;overflow-y:auto;">
              <table class="data-table" id="settlementParseTable">
                <thead>
                  <tr>
                    <th style="width:40px;"></th>
                    <th>건축주</th>
                    <th>입금일</th>
                    <th class="text-right">입금금액</th>
                    <th>출금일</th>
                    <th class="text-right">출금금액</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </div>
          <div id="settlementParseSummary" class="text-sm text-muted"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="settlementSaveBtn" onclick="SettlementsModule._saveBulk()" disabled>선택 항목 등록</button>
      </div>
    `, { size: 'modal-xl' });
  },

  _splitCols(line) {
    if (line.includes('\t')) return line.split('\t');
    return line.split(/\s{2,}/);
  },

  _parseDate(raw) {
    const s = (raw || '').trim();
    if (!s) return '';
    const m3 = s.match(/(\d{2,4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
    if (m3) {
      let y = m3[1];
      if (y.length === 2) y = '20' + y;
      return `${y}-${m3[2].padStart(2, '0')}-${m3[3].padStart(2, '0')}`;
    }
    return '';
  },

  _parseNum(raw) {
    const v = String(raw || '').trim().replace(/[,원\s]/g, '');
    if (!v || v === '-') return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  },

  _parseBulk() {
    const raw = document.getElementById('settlementPasteArea').value.trim();
    if (!raw) {
      Utils.showToast('데이터를 붙여넣기 하세요.', 'error');
      return;
    }

    const lines = raw.split('\n').filter(l => l.trim());
    this._parsed = [];

    // 헤더 매핑
    let mapping = { client: -1, depositDate: -1, depositAmount: -1, withdrawDate: -1, withdrawAmount: -1 };
    let startLine = 0;

    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const cols = this._splitCols(lines[i]);
      const tempMap = { ...mapping };
      cols.forEach((c, idx) => {
        const trimmed = (c || '').trim();
        if (/건축주|발주처|클라이언트/.test(trimmed) && tempMap.client < 0) tempMap.client = idx;
        else if (/^입금일$/.test(trimmed) && tempMap.depositDate < 0) tempMap.depositDate = idx;
        else if (/^입금(금액|액)$/.test(trimmed) && tempMap.depositAmount < 0) tempMap.depositAmount = idx;
        else if (/^출금일$/.test(trimmed) && tempMap.withdrawDate < 0) tempMap.withdrawDate = idx;
        else if (/^출금(금액|액)$/.test(trimmed) && tempMap.withdrawAmount < 0) tempMap.withdrawAmount = idx;
      });
      if (tempMap.client >= 0 && (tempMap.depositAmount >= 0 || tempMap.withdrawAmount >= 0)) {
        mapping = tempMap;
        startLine = i + 1;
        break;
      }
    }

    if (mapping.client < 0) {
      Utils.showToast('헤더를 찾을 수 없습니다. [건축주 | 입금일 | 입금금액 | 출금금액 | 출금일] 헤더가 필요합니다.', 'error', 6000);
      return;
    }

    for (let i = startLine; i < lines.length; i++) {
      const cols = this._splitCols(lines[i]);
      if (cols.length < 2) continue;

      const client = (cols[mapping.client] || '').trim();
      if (!client || client === '총계' || client === '차액') continue;

      const depositAmount = mapping.depositAmount >= 0 ? this._parseNum(cols[mapping.depositAmount]) : 0;
      const withdrawAmount = mapping.withdrawAmount >= 0 ? this._parseNum(cols[mapping.withdrawAmount]) : 0;

      if (!depositAmount && !withdrawAmount) continue;

      this._parsed.push({
        clientName: client,
        depositDate: mapping.depositDate >= 0 ? this._parseDate(cols[mapping.depositDate]) : '',
        depositAmount,
        withdrawDate: mapping.withdrawDate >= 0 ? this._parseDate(cols[mapping.withdrawDate]) : '',
        withdrawAmount,
        selected: true
      });
    }

    if (this._parsed.length === 0) {
      Utils.showToast('인식 가능한 데이터가 없습니다.', 'warning', 5000);
      return;
    }

    Utils.showToast(`${this._parsed.length}건 인식됨`, 'success');
    this._renderParseResult();
  },

  _renderParseResult() {
    document.getElementById('settlementParseResult').classList.remove('hidden');
    document.getElementById('settlementParsedCount').textContent = `(${this._parsed.length}건)`;

    const tbody = document.querySelector('#settlementParseTable tbody');
    tbody.innerHTML = this._parsed.map((r, i) => `
      <tr>
        <td><input type="checkbox" data-idx="${i}" ${r.selected ? 'checked' : ''} onchange="SettlementsModule._toggleRow(${i}, this.checked)"></td>
        <td class="fw-medium">${Utils.escapeHtml(r.clientName)}</td>
        <td>${Utils.escapeHtml(r.depositDate || '-')}</td>
        <td class="text-right">${r.depositAmount ? Utils.formatCurrency(r.depositAmount) : '-'}</td>
        <td>${Utils.escapeHtml(r.withdrawDate || '-')}</td>
        <td class="text-right">${r.withdrawAmount ? Utils.formatCurrency(r.withdrawAmount) : '-'}</td>
      </tr>
    `).join('');

    this._updateParseSummary();
    document.getElementById('settlementSaveBtn').disabled = false;
  },

  _toggleRow(idx, checked) {
    this._parsed[idx].selected = checked;
    this._updateParseSummary();
  },

  _updateParseSummary() {
    const sel = this._parsed.filter(r => r.selected);
    const depTotal = sel.reduce((s, r) => s + (r.depositAmount || 0), 0);
    const wdTotal = sel.reduce((s, r) => s + (r.withdrawAmount || 0), 0);
    document.getElementById('settlementParseSummary').innerHTML = `
      ✅ 등록 예정: <strong>${sel.length}건</strong> · 입금 <strong>${Utils.formatCurrency(depTotal)}</strong> · 출금 <strong>${Utils.formatCurrency(wdTotal)}</strong>
    `;
    document.getElementById('settlementSaveBtn').disabled = sel.length === 0;
  },

  async _saveBulk() {
    const sel = this._parsed.filter(r => r.selected);
    if (sel.length === 0) return;

    const user = Auth.currentUser();
    let added = 0;
    for (const row of sel) {
      try {
        await DB.add('settlements', {
          clientName: row.clientName,
          depositDate: row.depositDate || null,
          depositAmount: row.depositAmount || 0,
          withdrawDate: row.withdrawDate || null,
          withdrawAmount: row.withdrawAmount || 0,
          outsourceName: '대림건축',
          projectName: '',
          memo: '',
          createdAt: new Date().toISOString(),
          createdBy: user.id,
          createdByName: user.displayName,
          updatedAt: new Date().toISOString(),
          importedFrom: 'paste'
        });
        added++;
      } catch (e) {
        console.error('정산 등록 실패:', e);
      }
    }

    await DB.log('CREATE', 'settlements', null, `정산 일괄 등록: ${added}건`);
    Utils.closeModal();
    Utils.showToast(`✅ ${added}건 등록 완료`, 'success');
    await this.render();
  },

  // ===== 엑셀 다운로드 (현재 리스트) =====
  async _exportExcel() {
    const all = await DB.getAll('settlements');
    if (all.length === 0) {
      Utils.showToast('내보낼 데이터가 없습니다.', 'warning');
      return;
    }

    const sorted = all.slice().sort((a, b) =>
      (a.depositDate || a.withdrawDate || '').localeCompare(b.depositDate || b.withdrawDate || '')
    );

    const totalDeposit = sorted.reduce((s, r) => s + (r.depositAmount || 0), 0);
    const totalWithdraw = sorted.reduce((s, r) => s + (r.withdrawAmount || 0), 0);

    const wsData = [
      [`📋 발주-외주 정산표 (총 ${sorted.length}건)`],
      [`다운로드: ${new Date().toISOString().slice(0, 10)}`],
      [],
      ['건축주', '입금일', '입금금액', '출금일', '출금금액', '차액', '외주업체', '프로젝트', '메모'],
      ...sorted.map(r => [
        r.clientName,
        r.depositDate || '',
        r.depositAmount || 0,
        r.withdrawDate || '',
        r.withdrawAmount || 0,
        (r.depositAmount || 0) - (r.withdrawAmount || 0),
        r.outsourceName || '대림건축',
        r.projectName || '',
        r.memo || ''
      ]),
      [],
      ['총계', '', totalDeposit, '', totalWithdraw, totalDeposit - totalWithdraw, '', '', '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 25 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 15 }, { wch: 20 }, { wch: 30 }
    ];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }
    ];

    // 금액 셀 천단위 콤마 포맷
    for (let i = 4; i < 4 + sorted.length; i++) {
      for (const col of [2, 4, 5]) {
        const addr = XLSX.utils.encode_cell({ r: i, c: col });
        if (ws[addr]) ws[addr].z = '#,##0';
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '정산표');

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    XLSX.writeFile(wb, `${today}_발주외주정산표.xlsx`);
    Utils.showToast('엑셀 다운로드 완료', 'success');
  },

  // ===== PDF 보고서 (인쇄/PDF 저장) =====
  async _exportPDF() {
    const all = await DB.getAll('settlements');
    if (all.length === 0) {
      Utils.showToast('내보낼 데이터가 없습니다.', 'warning');
      return;
    }

    const sorted = all.slice().sort((a, b) =>
      (a.depositDate || a.withdrawDate || '').localeCompare(b.depositDate || b.withdrawDate || '')
    );

    const totalDeposit = sorted.reduce((s, r) => s + (r.depositAmount || 0), 0);
    const totalWithdraw = sorted.reduce((s, r) => s + (r.withdrawAmount || 0), 0);
    const diff = totalDeposit - totalWithdraw;
    const fmt = n => (n || 0).toLocaleString('ko-KR') + '원';
    const today = new Date().toLocaleDateString('ko-KR');

    const rows = sorted.map(r => `
      <tr>
        <td>${Utils.escapeHtml(r.clientName)}</td>
        <td class="c">${r.depositDate || '-'}</td>
        <td class="num">${r.depositAmount ? fmt(r.depositAmount) : '-'}</td>
        <td class="c">${r.withdrawDate || '-'}</td>
        <td class="num">${r.withdrawAmount ? fmt(r.withdrawAmount) : '-'}</td>
        <td class="num" style="color:${(r.depositAmount - r.withdrawAmount) >= 0 ? '#059669' : '#dc2626'};">
          ${fmt((r.depositAmount || 0) - (r.withdrawAmount || 0))}
        </td>
      </tr>
    `).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>발주-외주 정산표</title>
    <style>
      body{font-family:'Malgun Gothic',sans-serif;padding:20px;}
      h1{font-size:20px;border-bottom:2px solid #333;padding-bottom:8px;}
      .meta{color:#666;font-size:12px;margin-bottom:16px;}
      table{width:100%;border-collapse:collapse;font-size:11px;}
      th,td{border:1px solid #ccc;padding:6px 8px;}
      th{background:#f0f0f0;font-weight:600;}
      td.num{text-align:right;}
      td.c{text-align:center;}
      .summary{margin-top:16px;padding:12px;background:#f8fafc;border-radius:4px;}
      tfoot td{background:#e5e7eb;font-weight:700;}
      @media print { @page { size: A4 landscape; margin: 1cm; } }
    </style></head><body>
      <h1>📋 발주-외주 정산표 현황 보고서</h1>
      <div class="meta">출력일: ${today} · 총 ${sorted.length}건</div>
      <div class="summary">
        <strong>입금 합계:</strong> ${fmt(totalDeposit)}　|
        <strong>출금 합계:</strong> ${fmt(totalWithdraw)}　|
        <strong>차액:</strong> <span style="color:${diff >= 0 ? '#059669' : '#dc2626'};">${fmt(diff)}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>건축주(발주처)</th>
            <th>입금일</th>
            <th>입금금액</th>
            <th>출금일</th>
            <th>출금금액</th>
            <th>차액</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2">총계</td>
            <td class="num">${fmt(totalDeposit)}</td>
            <td></td>
            <td class="num">${fmt(totalWithdraw)}</td>
            <td class="num">${fmt(diff)}</td>
          </tr>
        </tfoot>
      </table>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  },

  _showGuide() {
    Utils.openModal(`
      <div class="modal-header">
        <h3>💡 발주-외주 정산표 사용법</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <h4>📌 이게 뭔가요?</h4>
        <p>이사님이 작성하시던 명세서를 시스템화한 페이지입니다.<br>
        <strong>발주처에서 받은 입금 → 외주에 보낸 출금</strong>을 한 줄로 매칭해 관리합니다.</p>

        <h4 style="margin-top:var(--sp-3);">🔢 컬럼 설명</h4>
        <ul style="line-height:1.8;">
          <li><strong>건축주(발주처)</strong>: 우리에게 입금한 회사/사람</li>
          <li><strong>입금일/입금금액</strong>: 발주처가 우리 통장에 입금한 정보</li>
          <li><strong>출금일/출금금액</strong>: 우리가 외주(대림건축)에 송금한 정보</li>
          <li><strong>차액</strong>: 입금 - 출금 (회사 보유분)</li>
        </ul>

        <h4 style="margin-top:var(--sp-3);">🚀 빠르게 시작하기</h4>
        <ol style="line-height:1.8;">
          <li>이사님 명세서 엑셀에서 데이터 영역 복사</li>
          <li>[📥 일괄 등록] → 붙여넣기 → 데이터 분석 → 선택 항목 등록</li>
          <li>완료! 끝~</li>
        </ol>

        <h4 style="margin-top:var(--sp-3);">📤 보고서 출력</h4>
        <p><strong>[📄 PDF 보고서]</strong> 버튼으로 대표님 보고용 인쇄/PDF 저장 가능.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="Utils.closeModal()">확인</button>
      </div>
    `);
  }
};

window.SettlementsModule = SettlementsModule;
