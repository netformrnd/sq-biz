/* ============================================
   계약 관리대장 모듈
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

  async init(container) {
    this.container = container;
    await this.render();
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

  async render() {
    const isAdmin = Auth.isAdmin();
    await this._loadCaches();
    const all = (await DB.getAll('contracts')).reverse();

    const totalContract = all.reduce((s, c) => s + (Number(c.totalAmount) || 0), 0);

    let tableRows = '';
    if (all.length === 0) {
      tableRows = `<tr><td colspan="9" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">📋</div><h3>등록된 계약이 없습니다</h3><p>+ 계약 등록 버튼으로 추가하세요.</p></div>
      </td></tr>`;
    } else {
      tableRows = all.map(c => {
        const down = this._phaseStatus(c.downPayment);
        const interim = this._phaseStatus(c.interimPayment);
        const fin = this._phaseStatus(c.finalPayment);
        const progress = this._progress(c);
        return `
          <tr style="cursor:pointer;" onclick="ContractsModule._showDetail('${c.id}')">
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
            <td onclick="event.stopPropagation();">
              ${isAdmin ? `
                <div class="d-flex gap-2">
                  <button class="btn btn-ghost btn-sm" onclick="ContractsModule._edit('${c.id}')" title="수정">✏️</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="ContractsModule._delete('${c.id}')" title="삭제">🗑️</button>
                </div>
              ` : ''}
            </td>
          </tr>
        `;
      }).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>계약 관리대장</h2>
        <div class="page-actions">
          <button class="btn btn-secondary" onclick="ContractsModule._downloadTemplate()">📥 엑셀 양식 다운로드</button>
          ${isAdmin ? `<button class="btn btn-secondary" onclick="ContractsModule._openUploadModal()">📤 엑셀 일괄 업로드</button>` : ''}
          ${isAdmin ? `<button class="btn btn-primary" onclick="ContractsModule._openAddModal()">+ 계약 등록</button>` : ''}
        </div>
      </div>

      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon cyan">📋</div>
          <div class="card-info">
            <div class="card-label">총 계약</div>
            <div class="card-value">${all.length}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon green">💰</div>
          <div class="card-info">
            <div class="card-label">총 계약금액</div>
            <div class="card-value">${Utils.formatCurrency(totalContract)}</div>
          </div>
        </div>
      </div>

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
              <th>단지명</th>
              <th>계약건명</th>
              <th>발주처</th>
              <th class="text-right">계약금액</th>
              <th>계약금</th>
              <th>중도금</th>
              <th>잔금</th>
              <th class="text-center">상태</th>
              <th>관리</th>
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
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
        ${isAdmin ? `<button class="btn btn-primary" onclick="Utils.closeModal(); ContractsModule._edit('${c.id}')">수정</button>` : ''}
      </div>
    `, { size: 'modal-lg' });
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
    const complexName = document.getElementById('ctComplexName').value.trim();
    const contractName = document.getElementById('ctContractName').value.trim();
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
      siteAddress: document.getElementById('ctSiteAddress').value.trim(),
      clientName: document.getElementById('ctClientName').value.trim(),
      contractDate: document.getElementById('ctContractDate').value || null,
      totalAmount,
      downPayment: phases.downPayment,
      interimPayment: phases.interimPayment,
      finalPayment: phases.finalPayment,
      status: document.getElementById('ctStatus').value || '진행중',
      memo: document.getElementById('ctMemo').value.trim(),
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
        ['📋 계약 관리대장 — 일괄 등록 양식'],
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

      XLSX.utils.book_append_sheet(wb, ws, '계약 관리대장');

      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `계약_관리대장_양식_${stamp}.xlsx`;
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
      const headerCols = rows[headerRowIdx].map(c => String(c || '').trim());
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
      const num = (v) => Number(String(v || '').replace(/[,\s원]/g, '')) || 0;
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(c => !String(c || '').trim())) continue;
        const complexName = colMap.complexName >= 0 ? String(row[colMap.complexName] || '').trim() : '';
        const contractName = colMap.contractName >= 0 ? String(row[colMap.contractName] || '').trim() : '';
        if (!complexName || !contractName) continue;
        if (complexName.startsWith('(예시)')) continue;

        const totalAmount = colMap.totalAmount >= 0 ? num(row[colMap.totalAmount]) : 0;
        if (totalAmount <= 0) continue;

        const status = (colMap.status >= 0 ? String(row[colMap.status] || '').trim() : '') || '진행중';
        const validStatus = this.STATUS_OPTIONS.includes(status) ? status : '진행중';

        parsed.push({
          rowNum: i + 1,
          selected: true,
          complexName,
          contractName,
          siteAddress: colMap.siteAddress >= 0 ? String(row[colMap.siteAddress] || '').trim() : '',
          clientName: colMap.clientName >= 0 ? String(row[colMap.clientName] || '').trim() : '',
          contractDate: colMap.contractDate >= 0 ? this._normDate(row[colMap.contractDate]) : null,
          totalAmount,
          downPaymentAmount: colMap.downPayment >= 0 ? num(row[colMap.downPayment]) : 0,
          interimPaymentAmount: colMap.interimPayment >= 0 ? num(row[colMap.interimPayment]) : 0,
          finalPaymentAmount: colMap.finalPayment >= 0 ? num(row[colMap.finalPayment]) : 0,
          status: validStatus,
          memo: colMap.memo >= 0 ? String(row[colMap.memo] || '').trim() : ''
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
