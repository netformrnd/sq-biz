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
  }
};

window.ContractsModule = ContractsModule;
