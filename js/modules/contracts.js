/* ============================================
   아파트 스퀘어 수금 관리 모듈 (구 계약 관리대장)
   - 단지별 계약 등록 (계약금/중도금/잔금)
   - 각 결제단계 → 세금계산서 매칭 → 발급일/입금일 자동 표시
   - 권한: 관리자 + 'contracts' 메뉴 권한 보유자
   ============================================ */

const ContractsModule = {
  container: null,

  STATUS_OPTIONS: ['진행중', '완료', '보류'],
  PHASE_KEYS: ['downPayment', 'interimPayment', 'finalPayment'],
  PHASE_LABELS: { downPayment: '계약금', interimPayment: '중도금', finalPayment: '잔금' },

  // 캐시: 세금계산서 + 입금내역
  _invoiceMap: {},
  _depositMap: {},

  // 카드 클릭 필터 상태
  // 'all' | 'active' | 'paid' | 'unpaid'
  _filter: 'all',

  async init(container) {
    this.container = container;
    this._filter = 'all';
    await this.render();
  },

  _setFilter(mode) {
    this._filter = (this._filter === mode && mode !== 'all') ? 'all' : mode;
    this.render();
  },

  _filterLabel() {
    return {
      all: '전체',
      active: '진행중 계약',
      paid: '입금완료 계약',
      unpaid: '미수금 있는 계약'
    }[this._filter] || '전체';
  },

  // 클릭 가능한 합계 카드. 활성 시 강조 테두리.
  _renderCard(mode, color, icon, label, value, sub) {
    const isActive = this._filter === mode;
    const activeStyle = isActive
      ? 'border:2px solid var(--color-primary);box-shadow:0 0 0 3px rgba(37,99,235,0.15);'
      : 'border:2px solid transparent;';
    return `
      <div class="summary-card" style="cursor:pointer;transition:all 0.15s;${activeStyle}"
           onclick="ContractsModule._setFilter('${mode}')"
           title="클릭하여 ${label} 기준 필터링">
        <div class="card-icon ${color}">${icon}</div>
        <div class="card-info">
          <div class="card-label">${label}${isActive ? ' ✓' : ''}</div>
          <div class="card-value">${value}</div>
          ${sub ? `<div class="card-sub text-xs text-muted">${sub}</div>` : ''}
        </div>
      </div>
    `;
  },

  // 계약별 입금 합계 / 미수금 계산
  // 입금 = 결제단계 중 세금계산서가 입금내역과 매칭된 단계의 금액 합
  // 미수금 = 계약금액 - 입금
  _contractFinance(c) {
    let paid = 0;
    for (const key of this.PHASE_KEYS) {
      const phase = this._normalizePhase(c[key]);
      if (phase.amount <= 0 || !phase.invoiceId) continue;
      const inv = this._invoiceMap[String(phase.invoiceId)];
      if (inv && inv.matchedDepositId && this._depositMap[String(inv.matchedDepositId)]) {
        paid += phase.amount;
      }
    }
    const totalAmount = Number(c.totalAmount) || 0;
    return { paid, unpaid: Math.max(0, totalAmount - paid), totalAmount };
  },

  _matchFilter(c) {
    const fin = this._contractFinance(c);
    switch (this._filter) {
      case 'active': return c.status === '진행중' || (c.status !== '완료' && c.status !== '보류');
      case 'paid':   return fin.totalAmount > 0 && fin.paid >= fin.totalAmount;
      case 'unpaid': return fin.unpaid > 0;
      case 'all':
      default:       return true;
    }
  },

  async _loadCaches() {
    const invoices = await DB.getAll('taxInvoiceRequests');
    const deposits = await DB.getAll('deposits');
    this._invoiceMap = {};
    this._depositMap = {};
    for (const inv of invoices) this._invoiceMap[String(inv.id)] = inv;
    for (const dep of deposits) this._depositMap[String(dep.id)] = dep;
  },

  // 결제단계 객체 정규화 (구버전 호환)
  _normalizePhase(phase) {
    if (!phase) return { amount: 0, invoiceId: null };
    return { amount: Number(phase.amount) || 0, invoiceId: phase.invoiceId || null };
  },

  // 결제단계의 세금계산서 발급일 + 입금일 조회
  _phaseStatus(phase) {
    const p = this._normalizePhase(phase);
    if (!p.invoiceId) return { issueDate: null, depositDate: null, invoice: null };
    const inv = this._invoiceMap[String(p.invoiceId)];
    if (!inv) return { issueDate: null, depositDate: null, invoice: null };
    let depositDate = null;
    if (inv.matchedDepositId) {
      const dep = this._depositMap[String(inv.matchedDepositId)];
      if (dep) depositDate = dep.depositDate;
    }
    return { issueDate: inv.issueDate || null, depositDate, invoice: inv };
  },

  // 진행률 계산: 결제단계 중 발급일 있는 단계 비율
  _progress(contract) {
    let total = 0, done = 0;
    for (const key of this.PHASE_KEYS) {
      const p = this._normalizePhase(contract[key]);
      if (p.amount > 0) {
        total++;
        if (p.invoiceId) done++;
      }
    }
    if (total === 0) return 0;
    return Math.round((done / total) * 100);
  },

  _sort(field) {
    if (this.sortField === field) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortField = field; this.sortDir = 'asc'; }
    this.render();
  },

  async render() {
    const isAdmin = Auth.isAdmin();
    await this._loadCaches();
    const allRaw = (await DB.getAll('contracts')).reverse();

    // 합계 (전체 기준)
    const totalContract = allRaw.reduce((s, c) => s + (Number(c.totalAmount) || 0), 0);
    let totalPaid = 0, totalUnpaid = 0;
    for (const c of allRaw) {
      const f = this._contractFinance(c);
      totalPaid += f.paid;
      totalUnpaid += f.unpaid;
    }

    // 필터별 건수
    const countActive = allRaw.filter(c => c.status === '진행중' || (c.status !== '완료' && c.status !== '보류')).length;
    const countPaid = allRaw.filter(c => {
      const f = this._contractFinance(c);
      return f.totalAmount > 0 && f.paid >= f.totalAmount;
    }).length;
    const countUnpaid = allRaw.filter(c => this._contractFinance(c).unpaid > 0).length;

    // 필터 적용
    const all = allRaw.filter(c => this._matchFilter(c));

    let tableRows = '';
    if (all.length === 0) {
      const emptyMsg = this._filter === 'all'
        ? '<div class="empty-state"><div class="empty-icon">📋</div><h3>등록된 계약이 없습니다</h3><p>+ 계약 등록 버튼으로 추가하세요.</p></div>'
        : '<div class="empty-state"><div class="empty-icon">🔍</div><h3>이 조건에 해당하는 계약이 없습니다</h3><p>다른 카드를 클릭하거나 [전체 계약]을 누르세요.</p></div>';
      tableRows = `<tr><td colspan="8" class="text-center" style="padding:var(--sp-10);">${emptyMsg}</td></tr>`;
    } else {
      tableRows = Utils.Sort.apply(all, this.sortField, this.sortDir).map(c => {
        const down = this._phaseStatus(c.downPayment);
        const interim = this._phaseStatus(c.interimPayment);
        const fin = this._phaseStatus(c.finalPayment);
        const progress = this._progress(c);
        return `
          <tr style="cursor:pointer;" onclick="ContractsModule._showDetail('${c.id}')" title="클릭하면 상세보기 (상세에서 수정·삭제 가능)">
            <td class="fw-medium">${Utils.escapeHtml(c.complexName || '-')}</td>
            <td>${Utils.escapeHtml(c.contractName || '-')}</td>
            <td>${Utils.escapeHtml(c.clientName || '-')}</td>
            <td class="text-right amount">${Utils.formatCurrency(c.totalAmount || 0)}</td>
            <td>${this._phaseCell(c.downPayment, down)}</td>
            <td>${this._phaseCell(c.interimPayment, interim)}</td>
            <td>${this._phaseCell(c.finalPayment, fin)}</td>
            <td class="text-center">
              <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                ${this._statusBadge(c.status)}
                <span class="text-xs text-muted">${progress}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>아파트 스퀘어 수금 관리</h2>
        <div class="page-actions">
          <button class="btn btn-ghost" onclick="UserGuideModule.showModal('contracts')" title="사용가이드">📖 도움말</button>
          <button class="btn btn-secondary" onclick="ContractsModule._downloadReportPDF()">📄 보고서 PDF</button>
          <button class="btn btn-secondary" onclick="ContractsModule._downloadListExcel()">📊 리스트 엑셀</button>
          <button class="btn btn-secondary" onclick="ContractsModule._downloadTemplate()">📥 엑셀 양식 다운로드</button>
          ${isAdmin ? `<button class="btn btn-secondary" onclick="ContractsModule._openUploadModal()">📤 엑셀 일괄 업로드</button>` : ''}
          ${isAdmin ? `<button class="btn btn-primary" onclick="ContractsModule._openAddModal()">+ 계약 등록</button>` : ''}
        </div>
      </div>

      <div class="summary-cards">
        ${this._renderCard('all',    'cyan',   '📋', '전체 계약',     `${allRaw.length}건`,                                         `총 계약금액 ${Utils.formatCurrency(totalContract)}`)}
        ${this._renderCard('active', 'orange', '🔄', '진행중 계약',   `${countActive}건`,                                           '클릭: 진행중만 보기')}
        ${this._renderCard('paid',   'green',  '✅', '입금완료',       `${countPaid}건`,                                             `입금합 ${Utils.formatCurrency(totalPaid)}`)}
        ${this._renderCard('unpaid', 'red',    '⚠️', '총 미수금',     Utils.formatCurrency(totalUnpaid),                            `${countUnpaid}건 미수금 발생`)}
      </div>

      ${this._filter !== 'all' ? `
        <div style="padding:var(--sp-2) var(--sp-3);background:var(--color-warning-light);border-radius:var(--radius-sm);margin-top:var(--sp-3);font-size:var(--font-size-sm);">
          🔍 <strong>${this._filterLabel()}</strong> 필터 적용 중 — 카드를 다시 클릭하거나 [전체 계약]을 누르면 해제됩니다.
        </div>
      ` : ''}

      <div class="card mt-4" style="padding:var(--sp-3);background:var(--color-bg-light);">
        <div class="text-sm text-muted">
          💡 <strong>안내</strong>: 각 결제단계(계약금/중도금/잔금)에서 발급된 <strong>세금계산서를 연결</strong>하면 발급일이 자동으로 표시됩니다.
          세금계산서가 <strong>입금내역과 매칭</strong>되면 입금일도 자동 표시됩니다.
        </div>
      </div>

      <div class="table-wrapper mt-4">
        <table class="data-table">
          <thead>
            <tr>
              ${Utils.Sort.th('단지명', 'complexName', this.sortField, this.sortDir, 'ContractsModule')}
              ${Utils.Sort.th('계약건명', 'contractName', this.sortField, this.sortDir, 'ContractsModule')}
              ${Utils.Sort.th('발주처', 'clientName', this.sortField, this.sortDir, 'ContractsModule')}
              ${Utils.Sort.th('계약금액', 'totalAmount', this.sortField, this.sortDir, 'ContractsModule', 'text-right')}
              <th>계약금</th>
              <th>중도금</th>
              <th>잔금</th>
              ${Utils.Sort.th('상태', 'status', this.sortField, this.sortDir, 'ContractsModule', 'text-center')}
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  },

  _phaseCell(phase, status) {
    const p = this._normalizePhase(phase);
    if (p.amount === 0) return '<span class="text-muted">-</span>';

    const amount = Utils.formatCurrency(p.amount);
    if (!status.invoice) {
      return `<div style="font-size:var(--font-size-xs);">
        <div class="fw-medium">${amount}</div>
        <div class="text-muted">⏳ 발급대기</div>
      </div>`;
    }
    const issueStr = status.issueDate ? Utils.formatDate(status.issueDate) : '-';
    const depStr = status.depositDate ? `<div style="color:var(--color-success);">✅ 입금 ${Utils.formatDate(status.depositDate)}</div>` : `<div class="text-muted">⏳ 입금대기</div>`;
    return `<div style="font-size:var(--font-size-xs);">
      <div class="fw-medium">${amount}</div>
      <div>📄 ${issueStr}</div>
      ${depStr}
    </div>`;
  },

  _statusBadge(status) {
    const map = {
      '진행중': 'badge-request',
      '완료': 'badge-complete',
      '보류': 'badge-reject'
    };
    const cls = map[status] || 'badge-request';
    return `<span class="badge ${cls}">${Utils.escapeHtml(status || '진행중')}</span>`;
  },

  // ===== 상세보기 =====
  async _showDetail(id) {
    const c = await DB.get('contracts', id);
    if (!c) return;
    const isAdmin = Auth.isAdmin();

    const phaseHtml = this.PHASE_KEYS.map(key => {
      const phase = this._normalizePhase(c[key]);
      const status = this._phaseStatus(phase);
      const label = this.PHASE_LABELS[key];
      if (phase.amount === 0) {
        return `<div class="mb-3" style="padding:var(--sp-3);background:var(--color-bg-light);border-radius:var(--radius-sm);">
          <strong>${label}</strong> <span class="text-muted">(미설정)</span>
        </div>`;
      }
      const invInfo = status.invoice ? `
        <div style="margin-left:var(--sp-4);font-size:var(--font-size-sm);">
          📄 <strong>세금계산서</strong>: ${Utils.escapeHtml(status.invoice.requestNumber || '-')}
          ${status.issueDate ? ` (발급일 ${Utils.formatDate(status.issueDate)})` : ''}
          ${status.depositDate ? `<br>💰 <strong>입금일</strong>: <span style="color:var(--color-success);">${Utils.formatDate(status.depositDate)}</span>` : '<br>💰 <strong>입금</strong>: 대기 중'}
        </div>
      ` : `<div style="margin-left:var(--sp-4);font-size:var(--font-size-sm);" class="text-muted">⏳ 세금계산서 미연결</div>`;
      return `<div class="mb-3" style="padding:var(--sp-3);background:var(--color-bg-light);border-radius:var(--radius-sm);">
        <strong>${label}</strong>: ${Utils.formatCurrency(phase.amount)}
        ${invInfo}
      </div>`;
    }).join('');

    Utils.openModal(`
      <div class="modal-header">
        <h3>${Utils.escapeHtml(c.complexName)} - ${Utils.escapeHtml(c.contractName)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:75vh;overflow-y:auto;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <div><strong>단지명:</strong> ${Utils.escapeHtml(c.complexName || '-')}</div>
          <div><strong>발주처:</strong> ${Utils.escapeHtml(c.clientName || '-')}</div>
          <div><strong>계약일:</strong> ${c.contractDate ? Utils.formatDate(c.contractDate) : '-'}</div>
          <div><strong>진행상태:</strong> ${this._statusBadge(c.status)}</div>
          ${c.siteAddress ? `<div style="grid-column:1/-1;"><strong>현장소재지:</strong> ${Utils.escapeHtml(c.siteAddress)}</div>` : ''}
        </div>

        <div class="summary-cards" style="margin-bottom:var(--sp-4);">
          <div class="summary-card">
            <div class="card-info">
              <div class="card-label">계약금액</div>
              <div class="card-value">${Utils.formatCurrency(c.totalAmount || 0)}</div>
            </div>
          </div>
          <div class="summary-card">
            <div class="card-info">
              <div class="card-label">진행률</div>
              <div class="card-value">${this._progress(c)}%</div>
            </div>
          </div>
        </div>

        <h4 style="margin-bottom:var(--sp-2);">📊 결제 진행</h4>
        ${phaseHtml}

        ${c.memo ? `
          <div class="mt-4" style="padding:var(--sp-3);background:var(--color-bg-light);border-radius:var(--radius-sm);">
            <strong>비고:</strong><br>
            <div style="white-space:pre-wrap;margin-top:var(--sp-2);">${Utils.escapeHtml(c.memo)}</div>
          </div>
        ` : ''}
      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        <div>
          ${isAdmin ? `<button class="btn btn-ghost text-danger" onclick="ContractsModule._deleteFromDetail('${c.id}')">🗑️ 삭제</button>` : ''}
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-secondary" onclick="ContractsModule._downloadSinglePDF('${c.id}')">📄 이 계약 보고서 PDF</button>
          <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
          ${isAdmin ? `<button class="btn btn-primary" onclick="Utils.closeModal(); ContractsModule._edit('${c.id}')">✏️ 수정</button>` : ''}
        </div>
      </div>
    `, { size: 'modal-lg' });
  },

  async _deleteFromDetail(id) {
    Utils.closeModal();
    setTimeout(() => this._delete(id), 100);
  },

  // ===== 등록/수정 모달 =====
  async _openAddModal(editData = null) {
    const isEdit = !!editData;
    // 발급완료 세금계산서 목록 (드롭다운용)
    const allInvoices = (await DB.getAll('taxInvoiceRequests')).filter(i => i.status === '발행완료');
    allInvoices.sort((a, b) => (b.issueDate || b.createdAt || '').localeCompare(a.issueDate || a.createdAt || ''));

    const phaseFields = this.PHASE_KEYS.map(key => {
      const phase = editData ? this._normalizePhase(editData[key]) : { amount: 0, invoiceId: null };
      const label = this.PHASE_LABELS[key];
      const options = allInvoices.map(i =>
        `<option value="${i.id}" ${phase.invoiceId === i.id || String(phase.invoiceId) === String(i.id) ? 'selected' : ''}>
          ${Utils.escapeHtml(i.requestNumber || '')} / ${Utils.escapeHtml(i.partnerCompanyName || '-')} / ${Utils.formatCurrency(i.totalAmount || 0)} / ${i.issueDate ? Utils.formatDate(i.issueDate) : '-'}
        </option>`
      ).join('');
      return `
        <div class="form-row">
          <div class="form-group">
            <label>${label} 금액</label>
            <input type="number" id="contract_${key}_amount" class="form-control" placeholder="0" min="0" value="${phase.amount || ''}">
          </div>
          <div class="form-group">
            <label>${label} 세금계산서 (선택)</label>
            <select id="contract_${key}_invoice" class="form-control">
              <option value="">-- 선택 안함 --</option>
              ${options}
            </select>
          </div>
        </div>
      `;
    }).join('');

    Utils.openModal(`
      <div class="modal-header">
        <h3>${isEdit ? '계약 수정' : '계약 등록'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:75vh;overflow-y:auto;">
        <div class="form-row">
          <div class="form-group">
            <label for="ctComplexName">단지명 <span class="required">*</span></label>
            <input type="text" id="ctComplexName" class="form-control" placeholder="예: 인천 송도캐슬해모로아파트" value="${editData ? Utils.escapeHtml(editData.complexName) : ''}" required>
          </div>
          <div class="form-group">
            <label for="ctContractName">계약건명 <span class="required">*</span></label>
            <input type="text" id="ctContractName" class="form-control" placeholder="예: 공용계단 누수 보수공사" value="${editData ? Utils.escapeHtml(editData.contractName) : ''}" required>
          </div>
        </div>
        <div class="form-group">
          <label for="ctSiteAddress">현장소재지 (대지위치)</label>
          <input type="text" id="ctSiteAddress" class="form-control" placeholder="예: 인천광역시 연수구 송도과학로51번길 136(송도동 161)" value="${editData ? Utils.escapeHtml(editData.siteAddress || '') : ''}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="ctClientName">발주처</label>
            <input type="text" id="ctClientName" class="form-control" placeholder="예: 입주자대표회의" value="${editData ? Utils.escapeHtml(editData.clientName || '') : ''}">
          </div>
          <div class="form-group">
            <label for="ctContractDate">계약일</label>
            <input type="date" id="ctContractDate" class="form-control" value="${editData ? (editData.contractDate || '') : ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="ctTotalAmount">계약금액 (원) <span class="required">*</span></label>
            <input type="number" id="ctTotalAmount" class="form-control" placeholder="0" min="0" value="${editData ? (editData.totalAmount || '') : ''}" required>
          </div>
          <div class="form-group">
            <label for="ctStatus">진행상태</label>
            <select id="ctStatus" class="form-control">
              ${this.STATUS_OPTIONS.map(s => `<option value="${s}" ${editData && editData.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>

        <h4 style="margin-top:var(--sp-4);margin-bottom:var(--sp-2);">📊 결제 단계</h4>
        <div class="text-xs text-muted mb-2">사용하지 않는 단계는 금액을 0(또는 비워두기)으로 두세요.</div>
        ${phaseFields}

        <div class="form-group">
          <label for="ctMemo">비고</label>
          <textarea id="ctMemo" class="form-control" rows="3" placeholder="추가 메모">${editData ? Utils.escapeHtml(editData.memo || '') : ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="ContractsModule._save(${isEdit ? `'${editData.id}'` : 'null'})">${isEdit ? '수정' : '등록'}</button>
      </div>
    `, { size: 'modal-lg' });
  },

  async _save(editId) {
    // NBSP 정규화 (입력 시 비표시 공백 차단)
    const norm = (s) => String(s || '').replace(/[   ]/g, ' ').trim();
    const complexName = norm(document.getElementById('ctComplexName').value);
    const contractName = norm(document.getElementById('ctContractName').value);
    const totalAmount = Number(document.getElementById('ctTotalAmount').value) || 0;
    if (!complexName || !contractName || totalAmount <= 0) {
      Utils.showToast('단지명, 계약건명, 계약금액을 입력해 주세요.', 'error');
      return;
    }

    const phases = {};
    for (const key of this.PHASE_KEYS) {
      phases[key] = {
        amount: Number(document.getElementById(`contract_${key}_amount`).value) || 0,
        invoiceId: document.getElementById(`contract_${key}_invoice`).value || null
      };
    }

    const user = Auth.currentUser();
    const data = {
      complexName,
      contractName,
      siteAddress: norm(document.getElementById('ctSiteAddress').value),
      clientName: norm(document.getElementById('ctClientName').value),
      contractDate: document.getElementById('ctContractDate').value || null,
      totalAmount,
      downPayment: phases.downPayment,
      interimPayment: phases.interimPayment,
      finalPayment: phases.finalPayment,
      status: document.getElementById('ctStatus').value || '진행중',
      memo: norm(document.getElementById('ctMemo').value),
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
      updatedByName: user.displayName
    };

    try {
      if (editId) {
        data.id = editId;
        const existing = await DB.get('contracts', editId);
        data.createdAt = existing.createdAt;
        data.createdBy = existing.createdBy;
        await DB.update('contracts', data);
        await DB.log('UPDATE', 'contracts', editId, `계약 수정: ${complexName} ${contractName}`);
      } else {
        data.createdAt = new Date().toISOString();
        data.createdBy = user.id;
        const id = await DB.add('contracts', data);
        await DB.log('CREATE', 'contracts', id, `계약 등록: ${complexName} ${contractName}`);
      }
      Utils.closeModal();
      Utils.showToast('저장 완료', 'success');
      await this.render();
    } catch (err) {
      Utils.showToast('저장 실패: ' + err.message, 'error');
    }
  },

  async _edit(id) {
    const item = await DB.get('contracts', id);
    if (item) await this._openAddModal(item);
  },

  async _delete(id) {
    const item = await DB.get('contracts', id);
    if (!item) return;
    const confirmed = await Utils.confirm(`이 계약(${item.complexName} - ${item.contractName})을 삭제하시겠습니까?\n(연결된 세금계산서·입금내역은 삭제되지 않습니다)`, '계약 삭제');
    if (!confirmed) return;
    await DB.delete('contracts', id);
    await DB.log('DELETE', 'contracts', id, `계약 삭제: ${item.complexName} ${item.contractName}`);
    Utils.showToast('삭제 완료', 'success');
    await this.render();
  },

  // ========== 엑셀 양식 다운로드 ==========
  EXCEL_HEADERS: ['단지명', '계약건명', '현장소재지', '발주처', '계약일(YYYY-MM-DD)', '계약금액', '계약금', '중도금', '잔금', '진행상태', '비고'],
  EXCEL_SAMPLE: [
    ['인천 송도캐슬해모로아파트', '공용계단 누수 보수공사 (비상주 감리용역)', '인천광역시 연수구 송도과학로51번길 136', '입주자대표회의', '2025-12-01', 50000000, 15000000, 20000000, 15000000, '진행중', '예시: 3단계 결제'],
    ['(예시) 서울 OO상가', 'OO 인허가 설계', '서울시 강남구 OO', '(주)OO개발', '2026-01-15', 30000000, 15000000, 0, 15000000, '진행중', '(이 예시 행은 삭제하고 사용하세요)']
  ],

  async _ensureXlsx() {
    if (window.XLSX && window.XLSX.utils && window.XLSX.write) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('엑셀 라이브러리 로드 실패. 네트워크 확인 후 다시 시도하세요.'));
      document.head.appendChild(s);
    });
  },

  _styleHeader: {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: '맑은 고딕' },
    fill: { patternType: 'solid', fgColor: { rgb: '0EA5E9' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: '94A3B8' } },
      bottom: { style: 'thin', color: { rgb: '94A3B8' } },
      left: { style: 'thin', color: { rgb: '94A3B8' } },
      right: { style: 'thin', color: { rgb: '94A3B8' } }
    }
  },
  _styleSample: {
    font: { italic: true, color: { rgb: '94A3B8' }, sz: 10, name: '맑은 고딕' },
    alignment: { vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'E2E8F0' } },
      bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
      left: { style: 'thin', color: { rgb: 'E2E8F0' } },
      right: { style: 'thin', color: { rgb: 'E2E8F0' } }
    }
  },
  _styleGuide: {
    font: { bold: true, color: { rgb: 'B45309' }, sz: 11, name: '맑은 고딕' },
    fill: { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true }
  },

  async _downloadTemplate() {
    try {
      await this._ensureXlsx();
      const XLSX = window.XLSX;
      const wb = XLSX.utils.book_new();

      const aoa = [
        ['📋 아파트 스퀘어 수금 관리 — 일괄 등록 양식'],
        ['• 필수: 단지명, 계약건명, 계약금액'],
        ['• 진행상태: 진행중 / 완료 / 보류 중 하나 (비워두면 "진행중")'],
        ['• 계약일은 YYYY-MM-DD 형식. 계약금/중도금/잔금은 숫자만 (쉼표·원 단위 제외).'],
        ['• 사용하지 않는 결제단계는 0 또는 비워두세요.'],
        ['• 세금계산서 연결은 등록 후 각 계약 상세 화면에서 설정합니다.'],
        ['• 예시 행은 모두 지우고 본인 데이터로 채워서 업로드하세요.'],
        [],
        this.EXCEL_HEADERS,
        ...this.EXCEL_SAMPLE
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      ws['!cols'] = [
        { wch: 24 }, { wch: 32 }, { wch: 40 }, { wch: 20 }, { wch: 16 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 30 }
      ];

      ws['!merges'] = [];
      for (let r = 0; r <= 6; r++) {
        ws['!merges'].push({ s: { r, c: 0 }, e: { r, c: 10 } });
      }

      ws['!rows'] = [
        { hpt: 28 }, { hpt: 18 }, { hpt: 18 }, { hpt: 18 }, { hpt: 18 }, { hpt: 18 }, { hpt: 18 },
        { hpt: 8 },
        { hpt: 32 },
        { hpt: 28 }, { hpt: 28 }
      ];

      // 제목 스타일
      const titleAddr = XLSX.utils.encode_cell({ r: 0, c: 0 });
      ws[titleAddr].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: '0F172A' } },
        alignment: { horizontal: 'center', vertical: 'center' }
      };
      for (let r = 1; r <= 6; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: 0 });
        if (ws[addr]) ws[addr].s = this._styleGuide;
      }
      for (let c = 0; c < this.EXCEL_HEADERS.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 8, c });
        if (ws[addr]) ws[addr].s = this._styleHeader;
      }
      for (let r = 9; r <= 10; r++) {
        for (let c = 0; c < this.EXCEL_HEADERS.length; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws[addr]) ws[addr].s = this._styleSample;
        }
      }

      ws['!freeze'] = { xSplit: 0, ySplit: 9 };

      XLSX.utils.book_append_sheet(wb, ws, '아파트 스퀘어 수금 관리');

      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `계약_수금관리_양식_${stamp}.xlsx`;
      XLSX.writeFile(wb, filename);
      Utils.showToast(`${filename} 다운로드 완료`, 'success');
    } catch (e) {
      console.error('[계약] 양식 다운로드 실패:', e);
      Utils.showToast('양식 다운로드 실패: ' + e.message, 'error');
    }
  },

  // ========== 엑셀 일괄 업로드 ==========
  _uploadParsed: [],

  _openUploadModal() {
    this._uploadParsed = [];
    Utils.openModal(`
      <div class="modal-header">
        <h3>📤 계약 엑셀 일괄 업로드</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="padding:var(--sp-3);background:var(--color-bg-light);border-radius:var(--radius-sm);margin-bottom:var(--sp-3);font-size:var(--font-size-sm);">
          <strong>📌 사용법</strong><br>
          1. <strong>"엑셀 양식 다운로드"</strong>로 양식을 받습니다.<br>
          2. 양식의 예시 행을 지우고 본인 데이터로 채웁니다.<br>
          3. 저장한 파일을 아래에 드래그하거나 클릭하여 업로드합니다.<br>
          4. 미리보기 확인 후 [등록] 버튼을 누르세요.<br>
          5. 세금계산서 매칭은 등록 후 각 계약 상세 화면에서 설정합니다.
        </div>

        <div id="ctUploadArea" class="upload-area" style="cursor:pointer;text-align:center;padding:var(--sp-6);border:2px dashed var(--color-border);border-radius:var(--radius-md);">
          <div style="font-size:32px;">📊</div>
          <div class="fw-medium">엑셀 파일 업로드 (.xlsx / .xls)</div>
          <div class="text-sm text-muted" id="ctUploadFileName">파일을 여기에 드래그하거나 클릭하여 선택</div>
          <input type="file" id="ctUploadFileInput" accept=".xlsx,.xls" style="display:none;">
        </div>

        <div id="ctUploadPreview" style="margin-top:var(--sp-4);"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="ctUploadSaveBtn" onclick="ContractsModule._bulkSave()" disabled>등록</button>
      </div>
    `, { size: 'modal-lg' });

    setTimeout(() => {
      const area = document.getElementById('ctUploadArea');
      const input = document.getElementById('ctUploadFileInput');
      if (!area || !input) return;
      area.onclick = () => input.click();
      input.onchange = (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) this._onUploadFile(f);
      };
      area.ondragover = (e) => { e.preventDefault(); area.style.background = 'var(--color-bg-light)'; };
      area.ondragleave = () => { area.style.background = ''; };
      area.ondrop = (e) => {
        e.preventDefault();
        area.style.background = '';
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._onUploadFile(f);
      };
    }, 100);
  },

  _normDate(v) {
    if (!v) return null;
    const s = String(v).trim();
    const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const n = Number(s);
    if (!isNaN(n) && n > 30000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  },

  async _onUploadFile(file) {
    const nameEl = document.getElementById('ctUploadFileName');
    if (nameEl) nameEl.textContent = `⏳ "${file.name}" 분석중...`;

    try {
      await this._ensureXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(15, rows.length); i++) {
        const r = rows[i].map(c => String(c || '').trim());
        if (r.includes('단지명') && r.includes('계약건명')) { headerRowIdx = i; break; }
      }
      if (headerRowIdx < 0) {
        Utils.showToast('헤더 행(단지명, 계약건명, 계약금액 ...)을 찾을 수 없습니다.', 'error', 6000);
        if (nameEl) nameEl.textContent = `❌ 헤더를 찾지 못함`;
        return;
      }
      // NBSP(U+00A0) 등 비표시 공백 → 일반 공백으로 정규화 (매칭 실패 방지)
      const norm = (v) => String(v || '').replace(/[   ]/g, ' ').trim();

      const headerCols = rows[headerRowIdx].map(c => norm(c));
      const idx = (name) => headerCols.findIndex(c => c === name || c.startsWith(name));

      const colMap = {
        complexName: idx('단지명'),
        contractName: idx('계약건명'),
        siteAddress: idx('현장소재지'),
        clientName: idx('발주처'),
        contractDate: idx('계약일'),
        totalAmount: idx('계약금액'),
        downPayment: idx('계약금'),
        interimPayment: idx('중도금'),
        finalPayment: idx('잔금'),
        status: idx('진행상태'),
        memo: idx('비고')
      };

      const parsed = [];
      const num = (v) => Number(String(v || '').replace(/[,\s 원]/g, '')) || 0;
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(c => !norm(c))) continue;
        const complexName = colMap.complexName >= 0 ? norm(row[colMap.complexName]) : '';
        const contractName = colMap.contractName >= 0 ? norm(row[colMap.contractName]) : '';
        if (!complexName || !contractName) continue;
        if (complexName.startsWith('(예시)')) continue;

        const totalAmount = colMap.totalAmount >= 0 ? num(row[colMap.totalAmount]) : 0;
        if (totalAmount <= 0) continue;

        const status = (colMap.status >= 0 ? norm(row[colMap.status]) : '') || '진행중';
        const validStatus = this.STATUS_OPTIONS.includes(status) ? status : '진행중';

        parsed.push({
          rowNum: i + 1,
          selected: true,
          complexName,
          contractName,
          siteAddress: colMap.siteAddress >= 0 ? norm(row[colMap.siteAddress]) : '',
          clientName: colMap.clientName >= 0 ? norm(row[colMap.clientName]) : '',
          contractDate: colMap.contractDate >= 0 ? this._normDate(row[colMap.contractDate]) : null,
          totalAmount,
          downPaymentAmount: colMap.downPayment >= 0 ? num(row[colMap.downPayment]) : 0,
          interimPaymentAmount: colMap.interimPayment >= 0 ? num(row[colMap.interimPayment]) : 0,
          finalPaymentAmount: colMap.finalPayment >= 0 ? num(row[colMap.finalPayment]) : 0,
          status: validStatus,
          memo: colMap.memo >= 0 ? norm(row[colMap.memo]) : ''
        });
      }

      this._uploadParsed = parsed;
      if (nameEl) nameEl.textContent = `✅ "${file.name}" 로드 완료 (${parsed.length}건)`;
      this._renderUploadPreview();
      const btn = document.getElementById('ctUploadSaveBtn');
      if (btn) btn.disabled = parsed.length === 0;
    } catch (e) {
      console.error('[계약] 파일 로드 실패:', e);
      Utils.showToast('파일 로드 실패: ' + e.message, 'error');
      if (nameEl) nameEl.textContent = `❌ 파일 로드 실패`;
    }
  },

  _renderUploadPreview() {
    const el = document.getElementById('ctUploadPreview');
    if (!el) return;
    if (this._uploadParsed.length === 0) {
      el.innerHTML = `<div class="text-muted text-center" style="padding:var(--sp-4);">파일을 업로드하면 미리보기가 표시됩니다.</div>`;
      return;
    }
    const rows = this._uploadParsed.map((r, i) => `
      <tr>
        <td class="text-center"><input type="checkbox" ${r.selected ? 'checked' : ''} onchange="ContractsModule._toggleUpload(${i}, this.checked)"></td>
        <td class="text-center text-xs text-muted">${r.rowNum}</td>
        <td>${Utils.escapeHtml(r.complexName)}</td>
        <td>${Utils.escapeHtml(r.contractName)}</td>
        <td>${Utils.escapeHtml(r.clientName || '-')}</td>
        <td class="text-right amount">${Utils.formatCurrency(r.totalAmount)}</td>
        <td class="text-right text-xs">${Utils.formatCurrency(r.downPaymentAmount)}</td>
        <td class="text-right text-xs">${Utils.formatCurrency(r.interimPaymentAmount)}</td>
        <td class="text-right text-xs">${Utils.formatCurrency(r.finalPaymentAmount)}</td>
        <td class="text-center">${Utils.escapeHtml(r.status)}</td>
      </tr>
    `).join('');
    el.innerHTML = `
      <div class="d-flex items-center justify-between mb-2">
        <strong>📋 미리보기 (${this._uploadParsed.length}건)</strong>
        <div class="text-xs text-muted">체크 해제한 행은 등록되지 않습니다.</div>
      </div>
      <div class="table-wrapper" style="max-height:400px;overflow-y:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th class="text-center" style="width:40px;"><input type="checkbox" checked onchange="ContractsModule._toggleAllUpload(this.checked)"></th>
              <th class="text-center">행</th>
              <th>단지명</th>
              <th>계약건명</th>
              <th>발주처</th>
              <th class="text-right">계약금액</th>
              <th class="text-right">계약금</th>
              <th class="text-right">중도금</th>
              <th class="text-right">잔금</th>
              <th class="text-center">상태</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  _toggleUpload(i, checked) {
    if (this._uploadParsed[i]) this._uploadParsed[i].selected = checked;
  },
  _toggleAllUpload(checked) {
    this._uploadParsed.forEach(r => r.selected = checked);
    this._renderUploadPreview();
  },

  // ========== 단일 계약 보고서 PDF ==========
  // 특정 계약 1건만 담긴 보고서. 결재 시 대표님께 어느 계약인지 명확히 보여줌
  async _downloadSinglePDF(id) {
    try {
      const c = await DB.get('contracts', id);
      if (!c) { Utils.showToast('계약을 찾을 수 없습니다.', 'error'); return; }

      await this._loadCaches();
      const fin = this._contractFinance(c);
      const progress = this._progress(c);

      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const user = Auth.currentUser();

      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
      const fmt = (n) => `₩${(Number(n) || 0).toLocaleString('ko-KR')}`;

      const phaseLabels = { downPayment: '계약금', interimPayment: '중도금', finalPayment: '잔금' };

      const phaseRows = this.PHASE_KEYS.map(k => {
        const p = this._normalizePhase(c[k]);
        if (p.amount === 0) return `<tr><td>${phaseLabels[k]}</td><td colspan="3" class="muted">미설정</td></tr>`;
        const st = this._phaseStatus(p);
        const inv = st.invoice ? `${esc(st.invoice.requestNumber || '')} (${st.issueDate ? '발급 ' + st.issueDate : '미발급'})` : '<span class="muted">미연결</span>';
        const dep = st.depositDate ? `<span class="ok">✅ ${st.depositDate}</span>` : '<span class="muted">대기</span>';
        return `<tr>
          <td>${phaseLabels[k]}</td>
          <td class="num">${fmt(p.amount)}</td>
          <td>${inv}</td>
          <td>${dep}</td>
        </tr>`;
      }).join('');

      const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>계약 수금 보고서 - ${esc(c.complexName)} ${esc(c.contractName)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif; color: #1e293b; font-size: 10pt; margin: 18mm 16mm; background: #fff; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0F172A; padding-bottom: 8px; margin-bottom: 18px; }
  h1 { font-size: 18pt; margin: 0; color: #0F172A; font-weight: 800; }
  .doc-type { font-size: 10pt; color: #64748b; margin-top: 4px; }
  .meta { font-size: 9pt; color: #64748b; text-align: right; line-height: 1.5; }
  .project-title { background: linear-gradient(135deg, #0EA5E9 0%, #0369A1 100%); color: #fff; padding: 16px 20px; border-radius: 8px; margin-bottom: 16px; }
  .project-title h2 { margin: 0; font-size: 16pt; font-weight: 700; }
  .project-title .sub { font-size: 10pt; opacity: 0.9; margin-top: 4px; }
  h3 { font-size: 12pt; margin-top: 18px; color: #0EA5E9; border-bottom: 1px solid #E2E8F0; padding-bottom: 4px; }
  .info { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  .info td { padding: 8px 12px; border: 1px solid #E2E8F0; }
  .info td:nth-child(odd) { background: #F8FAFC; font-weight: 600; width: 22%; }
  .summary { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin: 10px 0 20px; }
  .summary .card { background: #F8FAFC; border-left: 4px solid #0EA5E9; padding: 12px 14px; border-radius: 4px; }
  .summary .card .lbl { font-size: 9pt; color: #64748B; margin-bottom: 4px; }
  .summary .card .val { font-size: 13pt; font-weight: 700; color: #0F172A; }
  .summary .card.unpaid { border-color: #DC2626; }
  .summary .card.unpaid .val { color: #DC2626; }
  .summary .card.paid { border-color: #16A34A; }
  .summary .card.paid .val { color: #16A34A; }
  table.list { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 6px; }
  table.list th { background: #0F172A; color: #fff; padding: 7px; text-align: left; font-weight: 600; }
  table.list td { padding: 6px 7px; border-bottom: 1px solid #E2E8F0; }
  table.list .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.list .muted { color: #94A3B8; }
  table.list .ok { color: #16A34A; font-weight: 600; }
  .memo-box { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px 14px; border-radius: 4px; margin-top: 12px; font-size: 10pt; white-space: pre-wrap; }
  .toolbar { margin: 10px 0 16px; }
  .btn-print { padding: 8px 16px; background: #2563EB; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-weight: 600; }
  .btn-close { padding: 8px 16px; background: #94A3B8; color: #fff; border: 0; border-radius: 6px; cursor: pointer; margin-left: 6px; }
  .footer { margin-top: 24px; font-size: 8pt; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 8px; text-align: center; }
  .status-badge { display: inline-block; padding: 3px 12px; border-radius: 12px; font-size: 9pt; font-weight: 600; }
  .status-진행중 { background: #DBEAFE; color: #1E40AF; }
  .status-완료 { background: #D1FAE5; color: #065F46; }
  .status-보류 { background: #FEE2E2; color: #991B1B; }
  @media print { .toolbar { display: none; } body { margin: 0; } }
</style></head>
<body>
  <div class="toolbar">
    <button class="btn-print" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
    <button class="btn-close" onclick="window.close()">닫기</button>
  </div>
  <div class="hdr">
    <div>
      <h1>📋 계약 수금 보고서</h1>
      <div class="doc-type">개별 계약 결재용</div>
    </div>
    <div class="meta">작성일: ${dateStr}<br>작성자: ${esc(user ? user.displayName : '-')}<br>스퀘어건축사사무소 업무관리 시스템</div>
  </div>

  <div class="project-title">
    <h2>${esc(c.complexName)} / ${esc(c.contractName)}</h2>
    <div class="sub">발주처: ${esc(c.clientName || '-')} · 진행률: ${progress}% · 진행상태: ${esc(c.status || '진행중')}</div>
  </div>

  <h3>📋 계약 정보</h3>
  <table class="info">
    <tr>
      <td>단지명</td><td>${esc(c.complexName)}</td>
      <td>계약건명</td><td>${esc(c.contractName)}</td>
    </tr>
    ${c.siteAddress ? `<tr><td>현장소재지</td><td colspan="3">${esc(c.siteAddress)}</td></tr>` : ''}
    <tr>
      <td>발주처</td><td>${esc(c.clientName || '-')}</td>
      <td>계약일</td><td>${c.contractDate || '-'}</td>
    </tr>
    <tr>
      <td>진행상태</td><td><span class="status-badge status-${esc(c.status || '진행중')}">${esc(c.status || '진행중')}</span></td>
      <td>진행률</td><td>${progress}%</td>
    </tr>
  </table>

  <h3>💰 수금 요약</h3>
  <div class="summary">
    <div class="card"><div class="lbl">총 계약금액</div><div class="val">${fmt(c.totalAmount)}</div></div>
    <div class="card paid"><div class="lbl">입금 완료</div><div class="val">${fmt(fin.paid)}</div></div>
    <div class="card unpaid"><div class="lbl">미수금</div><div class="val">${fmt(fin.unpaid)}</div></div>
    <div class="card"><div class="lbl">진행률</div><div class="val">${progress}%</div></div>
  </div>

  <h3>📊 결제 단계별 상세</h3>
  <table class="list">
    <thead><tr>
      <th style="width:15%;">단계</th>
      <th class="num" style="width:18%;">금액</th>
      <th style="width:35%;">세금계산서</th>
      <th>입금일</th>
    </tr></thead>
    <tbody>${phaseRows}</tbody>
  </table>

  ${c.memo ? `<h3>📝 비고</h3><div class="memo-box">${esc(c.memo)}</div>` : ''}

  <div class="footer">본 보고서는 스퀘어건축사사무소 업무관리 시스템에서 자동 생성되었습니다.</div>
</body></html>`;

      const win = window.open('', '_blank', 'width=900,height=900');
      if (!win) {
        Utils.showToast('팝업 차단으로 보고서 창을 열 수 없습니다.', 'error', 5000);
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (e) {
      console.error('[계약] 단일 PDF 실패:', e);
      Utils.showToast('보고서 PDF 생성 실패: ' + e.message, 'error');
    }
  },

  // ========== 리스트 엑셀 다운로드 (스타일 적용) ==========
  // 현재 아파트 스퀘어 수금 관리에 등록된 모든 계약을 엑셀 파일로 출력
  // 컬럼: 단지명, 계약건명, 현장소재지, 발주처, 계약일, 총계약금액,
  //       계약금/계약금발급일/계약금입금일, 중도금/.../중도금입금일, 잔금/.../잔금입금일,
  //       총입금, 미수금, 진행상태, 진행률, 비고
  async _downloadListExcel() {
    try {
      await this._ensureXlsx();
      const XLSX = window.XLSX;

      await this._loadCaches();
      const all = (await DB.getAll('contracts')).reverse();

      const totalContract = all.reduce((s, c) => s + (Number(c.totalAmount) || 0), 0);
      let totalPaid = 0, totalUnpaid = 0;
      for (const c of all) {
        const f = this._contractFinance(c);
        totalPaid += f.paid;
        totalUnpaid += f.unpaid;
      }

      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

      const HEADERS = [
        '단지명', '계약건명', '현장소재지', '발주처', '계약일', '총계약금액',
        '계약금', '계약금 발급일', '계약금 입금일',
        '중도금', '중도금 발급일', '중도금 입금일',
        '잔금', '잔금 발급일', '잔금 입금일',
        '총입금', '미수금', '진행상태', '진행률', '비고'
      ];
      const COL_COUNT = HEADERS.length;
      // 금액 컬럼: 5(총계약금액), 6(계약금), 9(중도금), 12(잔금), 15(총입금), 16(미수금)
      const AMOUNT_COLS = new Set([5, 6, 9, 12, 15, 16]);

      const aoa = [
        [`📋 아파트 스퀘어 수금 관리 (총 ${all.length}건)`],
        [`작성일: ${dateStr}`],
        [],
        HEADERS,
        ...all.map(c => {
          const fin = this._contractFinance(c);
          const dp = this._normalizePhase(c.downPayment);
          const ip = this._normalizePhase(c.interimPayment);
          const fp = this._normalizePhase(c.finalPayment);
          const dpS = this._phaseStatus(dp);
          const ipS = this._phaseStatus(ip);
          const fpS = this._phaseStatus(fp);
          return [
            c.complexName || '',
            c.contractName || '',
            c.siteAddress || '',
            c.clientName || '',
            c.contractDate || '',
            Number(c.totalAmount) || 0,
            dp.amount || 0, dpS.issueDate || '', dpS.depositDate || '',
            ip.amount || 0, ipS.issueDate || '', ipS.depositDate || '',
            fp.amount || 0, fpS.issueDate || '', fpS.depositDate || '',
            fin.paid,
            fin.unpaid,
            c.status || '진행중',
            `${this._progress(c)}%`,
            c.memo || ''
          ];
        }),
        [],
        ['합계', '', '', '', '', totalContract,
         '', '', '', '', '', '', '', '', '',
         totalPaid, totalUnpaid, '', '', '']
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // 컬럼 폭
      ws['!cols'] = [
        { wch: 25 }, { wch: 30 }, { wch: 35 }, { wch: 18 }, { wch: 13 }, { wch: 16 },
        { wch: 14 }, { wch: 13 }, { wch: 13 },
        { wch: 14 }, { wch: 13 }, { wch: 13 },
        { wch: 14 }, { wch: 13 }, { wch: 13 },
        { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 28 }
      ];

      // 행 높이
      ws['!rows'] = [
        { hpt: 32 }, { hpt: 18 }, { hpt: 8 }, { hpt: 36 }
      ];
      for (let i = 0; i < all.length; i++) ws['!rows'].push({ hpt: 22 });
      ws['!rows'].push({ hpt: 8 });
      ws['!rows'].push({ hpt: 28 });

      // 머지 (타이틀, 작성일)
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: COL_COUNT - 1 } }
      ];

      // 스타일
      const styleTitle = {
        font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: '0F172A' } },
        alignment: { horizontal: 'center', vertical: 'center' }
      };
      const styleDate = {
        font: { italic: true, sz: 10, color: { rgb: '64748B' }, name: '맑은 고딕' },
        alignment: { horizontal: 'right', vertical: 'center' }
      };
      const styleHeader = (col) => ({
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10.5, name: '맑은 고딕' },
        // 결제단계별 색상 구분: 계약금=하늘, 중도금=주황, 잔금=보라
        fill: { patternType: 'solid', fgColor: { rgb:
          (col >= 6 && col <= 8) ? '0EA5E9' :
          (col >= 9 && col <= 11) ? 'F97316' :
          (col >= 12 && col <= 14) ? '8B5CF6' :
          '2563EB'
        } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: '94A3B8' } },
          bottom: { style: 'thin', color: { rgb: '94A3B8' } },
          left: { style: 'thin', color: { rgb: '94A3B8' } },
          right: { style: 'thin', color: { rgb: '94A3B8' } }
        }
      });
      const styleBody = (isOdd, col) => ({
        font: { sz: 9.5, color: { rgb: '1E293B' }, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: isOdd ? 'F8FAFC' : 'FFFFFF' } },
        alignment: {
          horizontal: AMOUNT_COLS.has(col) ? 'right' : ((col === 17 || col === 18 || col === 4 || col === 7 || col === 8 || col === 10 || col === 11 || col === 13 || col === 14) ? 'center' : 'left'),
          vertical: 'center',
          wrapText: (col === 0 || col === 1 || col === 2 || col === 19)
        },
        border: {
          top: { style: 'thin', color: { rgb: 'E2E8F0' } },
          bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
          left: { style: 'thin', color: { rgb: 'E2E8F0' } },
          right: { style: 'thin', color: { rgb: 'E2E8F0' } }
        }
      });
      const styleTotal = (col) => ({
        font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: '0F172A' } },
        alignment: {
          horizontal: AMOUNT_COLS.has(col) ? 'right' : (col === 0 ? 'center' : 'left'),
          vertical: 'center'
        },
        border: {
          top: { style: 'medium', color: { rgb: '0F172A' } },
          bottom: { style: 'medium', color: { rgb: '0F172A' } },
          left: { style: 'thin', color: { rgb: '94A3B8' } },
          right: { style: 'thin', color: { rgb: '94A3B8' } }
        }
      });

      // 적용
      ws[XLSX.utils.encode_cell({ r: 0, c: 0 })].s = styleTitle;
      ws[XLSX.utils.encode_cell({ r: 1, c: 0 })].s = styleDate;

      // 헤더 (row 3)
      for (let c = 0; c < COL_COUNT; c++) {
        const addr = XLSX.utils.encode_cell({ r: 3, c });
        if (ws[addr]) ws[addr].s = styleHeader(c);
      }

      // 데이터 (row 4부터)
      const dataStart = 4;
      for (let i = 0; i < all.length; i++) {
        const row = dataStart + i;
        const isOdd = i % 2 === 1;
        for (let c = 0; c < COL_COUNT; c++) {
          const addr = XLSX.utils.encode_cell({ r: row, c });
          if (!ws[addr]) ws[addr] = { v: '', t: 's' };
          ws[addr].s = styleBody(isOdd, c);
          if (AMOUNT_COLS.has(c)) {
            ws[addr].t = 'n';
            ws[addr].z = '#,##0';
          }
        }
      }

      // 합계 행
      const totalsRow = dataStart + all.length + 1;
      for (let c = 0; c < COL_COUNT; c++) {
        const addr = XLSX.utils.encode_cell({ r: totalsRow, c });
        if (!ws[addr]) ws[addr] = { v: '', t: 's' };
        ws[addr].s = styleTotal(c);
        if (AMOUNT_COLS.has(c)) {
          ws[addr].t = 'n';
          ws[addr].z = '#,##0';
        }
      }

      // 헤더 고정
      ws['!freeze'] = { xSplit: 0, ySplit: 4 };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '아파트 스퀘어 수금 관리');

      const stamp = dateStr.replace(/-/g, '');
      const filename = `계약_수금관리_${stamp}.xlsx`;
      XLSX.writeFile(wb, filename);
      Utils.showToast(`${filename} 다운로드 완료 (${all.length}건)`, 'success');
    } catch (e) {
      console.error('[계약] 리스트 엑셀 다운로드 실패:', e);
      Utils.showToast('엑셀 다운로드 실패: ' + e.message, 'error');
    }
  },

  // ========== 보고서 PDF 다운로드 ==========
  async _downloadReportPDF() {
    await this._loadCaches();
    const all = (await DB.getAll('contracts')).reverse();

    const totalContract = all.reduce((s, c) => s + (Number(c.totalAmount) || 0), 0);
    let totalPaid = 0, totalUnpaid = 0;
    for (const c of all) {
      const f = this._contractFinance(c);
      totalPaid += f.paid;
      totalUnpaid += f.unpaid;
    }

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const user = Auth.currentUser();

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const fmt = (n) => `₩${(Number(n) || 0).toLocaleString('ko-KR')}`;
    const fmtDate = (d) => d ? d : '-';

    const phaseLabel = { downPayment: '계약금', interimPayment: '중도금', finalPayment: '잔금' };

    const rowsHtml = all.map(c => {
      const fin = this._contractFinance(c);
      const phases = ['downPayment', 'interimPayment', 'finalPayment'].map(k => {
        const p = this._normalizePhase(c[k]);
        if (p.amount === 0) return `<div class="phase-empty">-</div>`;
        const st = this._phaseStatus(p);
        const dep = st.depositDate ? `<div class="phase-done">✅ 입금 ${fmtDate(st.depositDate)}</div>` : '<div class="phase-wait">⏳ 입금대기</div>';
        return `<div class="phase">
          <div class="phase-amt">${fmt(p.amount)}</div>
          ${st.issueDate ? `<div class="phase-meta">📄 발급 ${fmtDate(st.issueDate)}</div>` : '<div class="phase-meta-wait">⏳ 발급대기</div>'}
          ${dep}
        </div>`;
      });
      const progress = this._progress(c);
      return `<tr>
        <td><div class="proj-name">${esc(c.complexName)}</div><div class="proj-sub">${esc(c.contractName)}</div></td>
        <td>${esc(c.clientName || '-')}</td>
        <td class="num">${fmt(c.totalAmount)}</td>
        <td>${phases[0]}</td>
        <td>${phases[1]}</td>
        <td>${phases[2]}</td>
        <td class="text-center">
          <span class="st st-${esc(c.status || '진행중')}">${esc(c.status || '진행중')}</span>
          <div class="prog">${progress}%</div>
        </td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>계약 관리 현황 보고서 - ${dateStr}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  @page { size: A4 landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif; color: #1e293b; font-size: 9.5pt; margin: 14mm 12mm; background: #fff; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0F172A; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 17pt; margin: 0; color: #0F172A; font-weight: 800; }
  .meta { font-size: 9pt; color: #64748b; text-align: right; line-height: 1.5; }
  h2 { font-size: 12pt; margin-top: 18px; color: #2563EB; border-bottom: 1px solid #E2E8F0; padding-bottom: 4px; }
  .summary { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
  .summary td { padding: 8px 10px; border: 1px solid #E2E8F0; }
  .summary td:nth-child(odd) { background: #F8FAFC; font-weight: 600; width: 20%; }
  .summary td:nth-child(even) { text-align: right; font-size: 11pt; font-weight: 700; }
  table.list { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  table.list th { background: #0F172A; color: #fff; padding: 6px; text-align: left; font-weight: 600; }
  table.list td { padding: 5px 6px; border-bottom: 1px solid #E2E8F0; vertical-align: top; }
  table.list .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.list .text-center { text-align: center; }
  .proj-name { font-weight: 600; }
  .proj-sub { color: #64748b; font-size: 8pt; margin-top: 2px; }
  .phase { font-size: 8pt; }
  .phase-amt { font-weight: 600; font-size: 9pt; }
  .phase-meta { color: #64748b; margin-top: 2px; }
  .phase-meta-wait { color: #94A3B8; margin-top: 2px; }
  .phase-done { color: #16A34A; margin-top: 2px; font-weight: 600; }
  .phase-wait { color: #94A3B8; margin-top: 2px; }
  .phase-empty { color: #CBD5E1; text-align: center; }
  .st { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 8pt; font-weight: 600; }
  .st-진행중 { background: #DBEAFE; color: #1E40AF; }
  .st-완료 { background: #D1FAE5; color: #065F46; }
  .st-보류 { background: #FEE2E2; color: #991B1B; }
  .prog { color: #64748b; font-size: 8pt; margin-top: 2px; }
  .toolbar { margin: 10px 0; }
  .btn-print { padding: 8px 16px; background: #2563EB; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-weight: 600; }
  .btn-close { padding: 8px 16px; background: #94A3B8; color: #fff; border: 0; border-radius: 6px; cursor: pointer; margin-left: 6px; }
  .footer { margin-top: 20px; font-size: 8pt; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 6px; text-align: center; }
  @media print { .toolbar { display: none; } body { margin: 0; } }
</style></head>
<body>
  <div class="toolbar">
    <button class="btn-print" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
    <button class="btn-close" onclick="window.close()">닫기</button>
  </div>
  <div class="hdr">
    <h1>📋 계약 관리 현황 보고서</h1>
    <div class="meta">작성일: ${dateStr}<br>작성자: ${esc(user ? user.displayName : '-')}<br>스퀘어건축사사무소 업무관리 시스템</div>
  </div>

  <h2>📊 합계 요약</h2>
  <table class="summary">
    <tr><td>총 계약</td><td>${all.length}건</td><td>총 계약금액</td><td>${fmt(totalContract)}</td></tr>
    <tr><td>총 입금</td><td>${fmt(totalPaid)}</td><td>총 미수금</td><td>${fmt(totalUnpaid)}</td></tr>
  </table>

  <h2>📋 계약 상세 (${all.length}건)</h2>
  <table class="list">
    <thead><tr>
      <th style="width:22%;">단지명 / 계약건명</th>
      <th style="width:12%;">발주처</th>
      <th class="num" style="width:11%;">계약금액</th>
      <th style="width:14%;">계약금</th>
      <th style="width:14%;">중도금</th>
      <th style="width:14%;">잔금</th>
      <th class="text-center" style="width:13%;">상태</th>
    </tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94A3B8;">등록된 계약이 없습니다.</td></tr>'}</tbody>
  </table>

  <div class="footer">본 보고서는 스퀘어건축사사무소 업무관리 시스템에서 자동 생성되었습니다.</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=1400,height=900');
    if (!win) {
      Utils.showToast('팝업 차단으로 보고서 창을 열 수 없습니다. 팝업 허용 후 다시 시도하세요.', 'error', 5000);
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  },

  async _bulkSave() {
    const sel = this._uploadParsed.filter(r => r.selected);
    if (sel.length === 0) {
      Utils.showToast('등록할 행을 선택해 주세요.', 'error');
      return;
    }

    // 중복 체크: 단지명 + 계약건명 일치
    const existing = await DB.getAll('contracts');
    const existingKeys = new Set(existing.map(c => `${(c.complexName || '').trim()}|${(c.contractName || '').trim()}`));

    const user = Auth.currentUser();
    let added = 0, skipped = 0, failed = 0;
    for (const row of sel) {
      try {
        const key = `${row.complexName.trim()}|${row.contractName.trim()}`;
        if (existingKeys.has(key)) { skipped++; continue; }
        existingKeys.add(key);

        await DB.add('contracts', {
          complexName: row.complexName,
          contractName: row.contractName,
          siteAddress: row.siteAddress,
          clientName: row.clientName,
          contractDate: row.contractDate,
          totalAmount: row.totalAmount,
          downPayment: { amount: row.downPaymentAmount, invoiceId: null },
          interimPayment: { amount: row.interimPaymentAmount, invoiceId: null },
          finalPayment: { amount: row.finalPaymentAmount, invoiceId: null },
          status: row.status,
          memo: row.memo,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: user.id,
          updatedBy: user.id,
          updatedByName: user.displayName,
          importedFrom: 'excel'
        });
        added++;
      } catch (e) {
        console.error('계약 일괄 등록 실패:', e);
        failed++;
      }
    }
    await DB.log('CREATE', 'contracts', null, `계약 일괄 등록: ${added}건 (중복스킵 ${skipped}, 실패 ${failed})`);

    Utils.closeModal();
    const parts = [`등록 ${added}건`];
    if (skipped > 0) parts.push(`중복 스킵 ${skipped}건`);
    if (failed > 0) parts.push(`실패 ${failed}건`);
    Utils.showToast(parts.join(' / '), 'success');
    await this.render();
  }
};

window.ContractsModule = ContractsModule;
