/* ============================================
   대림프로젝트 정산관리 모듈 (구 외주설계 관리대장)
   - 프로젝트별 입금금액 / 외주지급누계 / 잔액 관리
   - 외주지급누계는 송금내역(transferRecords) 자동 합산
   - 권한: 관리자 + 'outsourcing' 메뉴 권한 보유자
   ============================================ */

const OutsourcingModule = {
  container: null,

  STATUS_OPTIONS: ['진행중', '정산예정', '완료', '보류'],

  // 카드 클릭 필터 상태
  // 'all' | 'deposit' | 'paid' | 'remaining' | 'overpaid'
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
      deposit: '매출 있는 프로젝트',
      paid: '집행 있는 프로젝트',
      remaining: '잔액 있는 프로젝트',
      overpaid: '초과집행 프로젝트'
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
           onclick="OutsourcingModule._setFilter('${mode}')"
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

  _matchFilter(p, outsourcingTotal) {
    const dep = Number(p.depositAmount) || 0;
    const balance = dep - outsourcingTotal;
    switch (this._filter) {
      case 'deposit':   return dep > 0;
      case 'paid':      return outsourcingTotal > 0;
      case 'remaining': return balance > 0;  // 아직 정산 안된 잔액 있음
      case 'overpaid':  return balance < 0;  // 입금보다 외주가 더 나감
      case 'all':
      default:          return true;
    }
  },

  // 송금내역 합계 계산용 캐시
  _transferTotalsByProject: {},
  _transferDatesByProject: {},     // 프로젝트별 출금일자(들)
  _purchaseInfoByProject: {},      // 프로젝트별 매입계산서 정보 (묶음 포함)
  _depositInfoByProject: {},       // 프로젝트별 입금일자(들)

  async _loadTransferTotals() {
    const allTransfers = await DB.getAll('transferRecords');
    const allDeposits = await DB.getAll('deposits');
    const allPurchases = await DB.getAll('purchaseInvoices');

    const totals = {};
    const transferDates = {};        // {projectName: [{date, amount, purchaseId}, ...]}
    const purchaseInfo = {};         // {projectName: [{purchaseId, issueDate, groupSize, groupNames}, ...]}
    const depositInfo = {};          // {projectName: [{date, amount, name}, ...]}

    // 1) 송금 데이터 정리
    for (const t of allTransfers) {
      const key = (t.projectName || '').trim();
      if (!key) continue;
      totals[key] = (totals[key] || 0) + (Number(t.amount) || 0);
      if (!transferDates[key]) transferDates[key] = [];
      transferDates[key].push({
        date: t.transferDate,
        amount: t.amount,
        purchaseId: t.matchedPurchaseId
      });
    }

    // 2) 매입 세금계산서 ↔ 프로젝트 매칭 (묶음 정보 계산)
    // 매입 세금계산서별로 어떤 프로젝트들이 묶여 있는지 파악
    const purchaseToProjects = {};   // {purchaseId: [projectName1, projectName2, ...]}
    for (const t of allTransfers) {
      if (!t.matchedPurchaseId) continue;
      const projKey = (t.projectName || '').trim();
      if (!projKey) continue;
      const pid = String(t.matchedPurchaseId);
      if (!purchaseToProjects[pid]) purchaseToProjects[pid] = new Set();
      purchaseToProjects[pid].add(projKey);
    }

    // 3) 프로젝트별 매입계산서 정보
    for (const key of Object.keys(transferDates)) {
      const purchases = transferDates[key]
        .filter(t => t.purchaseId)
        .map(t => {
          const purchase = allPurchases.find(p => String(p.id) === String(t.purchaseId));
          if (!purchase) return null;
          const groupProjects = Array.from(purchaseToProjects[String(t.purchaseId)] || []);
          return {
            purchaseId: t.purchaseId,
            issueDate: purchase.issueDate,
            totalAmount: purchase.totalAmount,
            partnerCompanyName: purchase.partnerCompanyName,
            groupSize: groupProjects.length,
            groupNames: groupProjects
          };
        })
        .filter(Boolean);
      // 중복 제거 (같은 purchaseId)
      const seen = new Set();
      purchaseInfo[key] = purchases.filter(p => {
        if (seen.has(p.purchaseId)) return false;
        seen.add(p.purchaseId);
        return true;
      });
    }

    // 4) 입금일자 자동 매칭 — 매출처명(projectName) 키워드로 입금 찾기
    const projects = await DB.getAll('outsourcingProjects');
    for (const p of projects) {
      const projName = (p.projectName || '').trim();
      if (!projName) continue;
      // 키워드 추출 (회사 접미사 제거)
      const keywords = projName
        .replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s/g, '')
        .match(/.{2,}/g) || [projName];
      const matches = allDeposits.filter(d => {
        const depName = (d.depositorName || '').replace(/\s/g, '');
        return keywords.some(k => depName.includes(k));
      });
      if (matches.length > 0) {
        depositInfo[projName] = matches.map(d => ({
          date: d.depositDate,
          amount: d.amount,
          name: d.depositorName
        }));
      }
    }

    this._transferTotalsByProject = totals;
    this._transferDatesByProject = transferDates;
    this._purchaseInfoByProject = purchaseInfo;
    this._depositInfoByProject = depositInfo;
  },

  // 날짜 배열을 표시용 문자열로 변환
  _formatDateList(dates, fieldName = 'date') {
    if (!dates || dates.length === 0) return '<span class="text-muted">-</span>';
    const sorted = dates.slice().sort((a, b) => (a[fieldName] || '').localeCompare(b[fieldName] || ''));
    if (sorted.length === 1) {
      return Utils.formatDate(sorted[0][fieldName]);
    }
    // 여러 건이면 첫번째 + 외 N건, 호버 시 상세
    const tooltip = sorted.map(d =>
      `${d[fieldName]} ${Number(d.amount || 0).toLocaleString()}원` + (d.name ? ` (${d.name})` : '')
    ).join('\n');
    return `<span title="${Utils.escapeHtml(tooltip)}" style="cursor:help;border-bottom:1px dotted #999;">${Utils.formatDate(sorted[0][fieldName])} <span class="text-xs text-muted">외 ${sorted.length - 1}건</span></span>`;
  },

  // 매입계산서일 표시 (묶음 정보 호버)
  _formatPurchaseList(purchases) {
    if (!purchases || purchases.length === 0) return '<span class="text-muted">-</span>';
    const sorted = purchases.slice().sort((a, b) => (a.issueDate || '').localeCompare(b.issueDate || ''));
    return sorted.map(p => {
      const dateStr = Utils.formatDate(p.issueDate);
      if (p.groupSize <= 1) {
        return dateStr;
      }
      // 묶음 발행 - 호버 시 상세
      const tooltip = `📋 묶음 ${p.groupSize}건 (1건의 세금계산서)\n` +
        `합계: ${Number(p.totalAmount || 0).toLocaleString()}원\n` +
        `매입처: ${p.partnerCompanyName || ''}\n──────────\n` +
        p.groupNames.map(n => `• ${n}`).join('\n');
      return `<span title="${Utils.escapeHtml(tooltip)}" style="cursor:help;border-bottom:1px dotted #999;">${dateStr} <span class="text-xs" style="color:#3b82f6;">(묶음 ${p.groupSize})</span></span>`;
    }).join('<br>');
  },

  async render() {
    const isAdmin = Auth.isAdmin();
    await this._loadTransferTotals();
    const allRaw = (await DB.getAll('outsourcingProjects')).reverse();

    // 합계는 전체 기준
    const totalDeposit = allRaw.reduce((s, p) => s + (Number(p.depositAmount) || 0), 0);
    const totalOutsourcing = allRaw.reduce((s, p) => s + (this._transferTotalsByProject[(p.projectName || '').trim()] || 0), 0);
    const totalBalance = totalDeposit - totalOutsourcing;

    // 필터별 건수 계산 (카드 표시용)
    const countDeposit = allRaw.filter(p => (Number(p.depositAmount) || 0) > 0).length;
    const countPaid = allRaw.filter(p => (this._transferTotalsByProject[(p.projectName || '').trim()] || 0) > 0).length;
    const countRemaining = allRaw.filter(p => {
      const out = this._transferTotalsByProject[(p.projectName || '').trim()] || 0;
      return (Number(p.depositAmount) || 0) - out > 0;
    }).length;

    // 필터 적용
    const all = allRaw.filter(p => {
      const out = this._transferTotalsByProject[(p.projectName || '').trim()] || 0;
      return this._matchFilter(p, out);
    });

    let tableRows = '';
    if (all.length === 0) {
      const emptyMsg = this._filter === 'all'
        ? '<div class="empty-state"><div class="empty-icon">📒</div><h3>등록된 프로젝트가 없습니다</h3><p>+ 프로젝트 등록 버튼으로 추가하세요.</p></div>'
        : `<div class="empty-state"><div class="empty-icon">🔍</div><h3>이 조건에 해당하는 프로젝트가 없습니다</h3><p>다른 카드를 클릭하거나 [전체 프로젝트]를 누르세요.</p></div>`;
      tableRows = `<tr><td colspan="7" class="text-center" style="padding:var(--sp-10);">${emptyMsg}</td></tr>`;
    } else {
      tableRows = all.map(p => {
        const projKey = (p.projectName || '').trim();
        const outsourcingTotal = this._transferTotalsByProject[projKey] || 0;
        const balance = (Number(p.depositAmount) || 0) - outsourcingTotal;
        const balanceColor = balance < 0 ? 'color:var(--color-danger);' : (balance > 0 ? 'color:var(--color-success);' : '');
        const depositList = this._depositInfoByProject[projKey] || [];
        const transferList = this._transferDatesByProject[projKey] || [];
        const purchaseList = this._purchaseInfoByProject[projKey] || [];
        return `
          <tr style="cursor:pointer;" onclick="OutsourcingModule._showDetail('${p.id}')" title="클릭하면 상세보기 (상세에서 수정·삭제 가능)">
            <td class="fw-medium">${Utils.escapeHtml(p.projectName || '-')}</td>
            <td>${this._formatDateList(depositList, 'date')}</td>
            <td class="text-right amount">${Utils.formatCurrency(p.depositAmount || 0)}</td>
            <td>${this._formatDateList(transferList, 'date')}</td>
            <td class="text-right amount">${Utils.formatCurrency(outsourcingTotal)}</td>
            <td>${this._formatPurchaseList(purchaseList)}</td>
            <td class="text-right amount fw-medium" style="${balanceColor}">${Utils.formatCurrency(balance)}</td>
          </tr>
        `;
      }).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>대림프로젝트 정산관리</h2>
        <div class="page-actions">
          <button class="btn btn-ghost" onclick="UserGuideModule.showModal('outsourcing')" title="사용가이드">📖 도움말</button>
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadReportPDF()">📄 보고서 PDF</button>
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadListExcel()">📊 리스트 엑셀</button>
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadTemplate()">📥 엑셀 양식 다운로드</button>
          ${isAdmin ? `<button class="btn btn-secondary" onclick="OutsourcingModule._openUploadModal()">📤 엑셀 일괄 업로드</button>` : ''}
          ${isAdmin ? `<button class="btn btn-primary" onclick="OutsourcingModule._openAddModal()">+ 프로젝트 등록</button>` : ''}
        </div>
      </div>

      <div class="summary-cards">
        ${this._renderCard('all',       'cyan',   '📒', '전체 프로젝트',  `${allRaw.length}건`,                                  '클릭: 전체 보기')}
        ${this._renderCard('deposit',   'green',  '💰', '총 매출금액',     Utils.formatCurrency(totalDeposit),                    `${countDeposit}건 (매출 있음)`)}
        ${this._renderCard('paid',      'orange', '💸', '총 출금금액',     Utils.formatCurrency(totalOutsourcing),                `${countPaid}건 (출금 있음)`)}
        ${this._renderCard('remaining', totalBalance >= 0 ? 'cyan' : 'red', '📊', '총 순이익', Utils.formatCurrency(totalBalance), `${countRemaining}건 (순이익 있음)`)}
      </div>

      ${this._filter !== 'all' ? `
        <div style="padding:var(--sp-2) var(--sp-3);background:var(--color-warning-light);border-radius:var(--radius-sm);margin-top:var(--sp-3);font-size:var(--font-size-sm);">
          🔍 <strong>${this._filterLabel()}</strong> 필터 적용 중 — 카드를 다시 클릭하거나 [전체 프로젝트]를 누르면 해제됩니다.
        </div>
      ` : ''}

      <div class="card mt-4" style="padding:var(--sp-3);background:var(--color-bg-light);">
        <div class="text-sm text-muted">
          💡 <strong>안내</strong>:<br>
          • <strong>입금일자</strong>: 입금내역에서 매출처명과 일치하는 입금 자동 표시<br>
          • <strong>출금일자/출금금액</strong>: 송금내역에서 매출처명과 일치하는 송금 자동 합산<br>
          • <strong>매입계산서일</strong>: 송금에 매칭된 매입 세금계산서의 발행일 표시<br>
          &nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#3b82f6;">(묶음 N)</span> 표시: 1건의 매입계산서로 여러 매출처가 묶여 발행됨 — 마우스 올려서 묶음 상세 확인<br>
          • <strong>순이익</strong>: 매출금액 - 출금금액
        </div>
      </div>

      <div class="table-wrapper mt-4">
        <table class="data-table">
          <thead>
            <tr>
              <th>매출처명</th>
              <th>입금일자</th>
              <th class="text-right">매출금액</th>
              <th>출금일자</th>
              <th class="text-right">출금금액</th>
              <th>매입계산서일</th>
              <th class="text-right">순이익</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  },

  _statusBadge(status) {
    const map = {
      '진행중': 'badge-request',
      '정산예정': 'badge-review',
      '완료': 'badge-complete',
      '보류': 'badge-reject'
    };
    const cls = map[status] || 'badge-request';
    return `<span class="badge ${cls}">${Utils.escapeHtml(status || '진행중')}</span>`;
  },

  // ===== 상세보기 =====
  async _showDetail(id) {
    const p = await DB.get('outsourcingProjects', id);
    if (!p) return;

    const isAdmin = Auth.isAdmin();
    const projectKey = (p.projectName || '').trim();

    // 송금내역 매칭
    const allTransfers = (await DB.getAll('transferRecords'))
      .filter(t => (t.projectName || '').trim() === projectKey)
      .sort((a, b) => (b.transferDate || '').localeCompare(a.transferDate || ''));

    const outsourcingTotal = allTransfers.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const balance = (Number(p.depositAmount) || 0) - outsourcingTotal;

    let transferRows = '';
    if (allTransfers.length === 0) {
      transferRows = `<tr><td colspan="4" class="text-center text-muted" style="padding:var(--sp-4);">매칭된 송금내역이 없습니다</td></tr>`;
    } else {
      transferRows = allTransfers.map(t => `
        <tr>
          <td>${Utils.formatDate(t.transferDate)}</td>
          <td>${Utils.escapeHtml(t.recipientName || '-')}</td>
          <td class="text-right amount">${Utils.formatCurrency(t.amount || 0)}</td>
          <td>${Utils.escapeHtml(t.memo || '-')}</td>
        </tr>
      `).join('');
    }

    Utils.openModal(`
      <div class="modal-header">
        <h3>${Utils.escapeHtml(p.projectName)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:75vh;overflow-y:auto;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <div><strong>발주처:</strong> ${Utils.escapeHtml(p.clientName || '-')}</div>
          <div><strong>외주업체:</strong> ${Utils.escapeHtml(p.vendorName || '-')}</div>
          <div><strong>계약일:</strong> ${p.contractDate ? Utils.formatDate(p.contractDate) : '-'}</div>
          <div><strong>진행상태:</strong> ${this._statusBadge(p.status)}</div>
        </div>

        <div class="summary-cards" style="margin-bottom:var(--sp-4);">
          <div class="summary-card">
            <div class="card-info">
              <div class="card-label">매출금액</div>
              <div class="card-value">${Utils.formatCurrency(p.depositAmount || 0)}</div>
            </div>
          </div>
          <div class="summary-card">
            <div class="card-info">
              <div class="card-label">집행금액</div>
              <div class="card-value">${Utils.formatCurrency(outsourcingTotal)}</div>
            </div>
          </div>
          <div class="summary-card">
            <div class="card-info">
              <div class="card-label">잔액</div>
              <div class="card-value" style="${balance < 0 ? 'color:var(--color-danger);' : ''}">${Utils.formatCurrency(balance)}</div>
            </div>
          </div>
        </div>

        <h4 style="margin-bottom:var(--sp-2);">💸 집행 내역 (송금내역 자동 연동)</h4>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>송금일</th>
                <th>수취인</th>
                <th class="text-right">금액</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>${transferRows}</tbody>
          </table>
        </div>

        ${p.memo ? `
          <div class="mt-4" style="padding:var(--sp-3);background:var(--color-bg-light);border-radius:var(--radius-sm);">
            <strong>비고:</strong><br>
            <div style="white-space:pre-wrap;margin-top:var(--sp-2);">${Utils.escapeHtml(p.memo)}</div>
          </div>
        ` : ''}
      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        <div>
          ${isAdmin ? `<button class="btn btn-ghost text-danger" onclick="OutsourcingModule._deleteFromDetail('${p.id}')">🗑️ 삭제</button>` : ''}
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadSinglePDF('${p.id}')">📄 이 프로젝트 보고서 PDF</button>
          <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
          ${isAdmin ? `<button class="btn btn-primary" onclick="Utils.closeModal(); OutsourcingModule._edit('${p.id}')">✏️ 수정</button>` : ''}
        </div>
      </div>
    `, { size: 'modal-lg' });
  },

  // 상세 모달에서 삭제 (모달 닫고 기존 _delete 호출)
  async _deleteFromDetail(id) {
    Utils.closeModal();
    // 약간 지연 후 삭제 confirm (모달 전환 안정성)
    setTimeout(() => this._delete(id), 100);
  },

  // ===== 등록/수정 모달 =====
  _openAddModal(editData = null) {
    const isEdit = !!editData;
    Utils.openModal(`
      <div class="modal-header">
        <h3>${isEdit ? '외주설계 프로젝트 수정' : '외주설계 프로젝트 등록'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="osProjectName">프로젝트명 <span class="required">*</span></label>
          <input type="text" id="osProjectName" class="form-control" placeholder="예: 인천 송도캐슬해모로아파트 누수 보수공사" value="${editData ? Utils.escapeHtml(editData.projectName) : ''}" required>
          <div class="text-xs text-muted mt-1">⚠️ 송금내역의 프로젝트명과 정확히 동일하게 입력해야 자동 누계 매칭됩니다.</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="osClientName">발주처</label>
            <input type="text" id="osClientName" class="form-control" placeholder="예: 입주자대표회의" value="${editData ? Utils.escapeHtml(editData.clientName || '') : ''}">
          </div>
          <div class="form-group">
            <label for="osVendorName">외주업체</label>
            <input type="text" id="osVendorName" class="form-control" placeholder="예: 대림건축(홍정란)" value="${editData ? Utils.escapeHtml(editData.vendorName || '') : ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="osContractDate">계약일</label>
            <input type="date" id="osContractDate" class="form-control" value="${editData ? (editData.contractDate || '') : ''}">
          </div>
          <div class="form-group">
            <label for="osDepositAmount">매출금액 (원)</label>
            <input type="number" id="osDepositAmount" class="form-control" placeholder="0" min="0" value="${editData ? (editData.depositAmount || '') : ''}">
          </div>
        </div>
        <div class="form-group">
          <label for="osStatus">진행상태</label>
          <select id="osStatus" class="form-control">
            ${this.STATUS_OPTIONS.map(s => `<option value="${s}" ${editData && editData.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="osMemo">비고</label>
          <textarea id="osMemo" class="form-control" rows="3" placeholder="추가 메모">${editData ? Utils.escapeHtml(editData.memo || '') : ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="OutsourcingModule._save(${isEdit ? `'${editData.id}'` : 'null'})">${isEdit ? '수정' : '등록'}</button>
      </div>
    `);
  },

  async _save(editId) {
    // NBSP 정규화 (입력 시 비표시 공백 차단)
    const norm = (s) => String(s || '').replace(/[   ]/g, ' ').trim();
    const projectName = norm(document.getElementById('osProjectName').value);
    if (!projectName) {
      Utils.showToast('프로젝트명을 입력해 주세요.', 'error');
      return;
    }

    const user = Auth.currentUser();
    const data = {
      projectName,
      clientName: norm(document.getElementById('osClientName').value),
      vendorName: norm(document.getElementById('osVendorName').value),
      contractDate: document.getElementById('osContractDate').value || null,
      depositAmount: Number(document.getElementById('osDepositAmount').value) || 0,
      status: document.getElementById('osStatus').value || '진행중',
      memo: norm(document.getElementById('osMemo').value),
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
      updatedByName: user.displayName
    };

    try {
      if (editId) {
        data.id = editId;
        const existing = await DB.get('outsourcingProjects', editId);
        data.createdAt = existing.createdAt;
        data.createdBy = existing.createdBy;
        await DB.update('outsourcingProjects', data);
        await DB.log('UPDATE', 'outsourcing', editId, `외주프로젝트 수정: ${projectName}`);
      } else {
        data.createdAt = new Date().toISOString();
        data.createdBy = user.id;
        const id = await DB.add('outsourcingProjects', data);
        await DB.log('CREATE', 'outsourcing', id, `외주프로젝트 등록: ${projectName}`);
      }
      Utils.closeModal();
      Utils.showToast('저장 완료', 'success');
      await this.render();
    } catch (err) {
      Utils.showToast('저장 실패: ' + err.message, 'error');
    }
  },

  async _edit(id) {
    const item = await DB.get('outsourcingProjects', id);
    if (item) this._openAddModal(item);
  },

  async _delete(id) {
    const item = await DB.get('outsourcingProjects', id);
    if (!item) return;
    const confirmed = await Utils.confirm(`이 외주설계 프로젝트(${item.projectName})를 삭제하시겠습니까?\n(송금내역은 삭제되지 않습니다)`, '외주프로젝트 삭제');
    if (!confirmed) return;
    await DB.delete('outsourcingProjects', id);
    await DB.log('DELETE', 'outsourcing', id, `외주프로젝트 삭제: ${item.projectName}`);
    Utils.showToast('삭제 완료', 'success');
    await this.render();
  },

  // ========== 엑셀 양식 다운로드 ==========
  // 컬럼: 프로젝트명, 발주처, 계약일, 매출금액, 진행상태, 비고
  EXCEL_HEADERS: ['프로젝트명', '발주처', '계약일(YYYY-MM-DD)', '매출금액', '진행상태', '비고'],
  EXCEL_SAMPLE: [
    ['인천 송도캐슬해모로아파트 누수 보수공사', '입주자대표회의', '2025-12-01', 50000000, '진행중', '예시: 비상주 감리용역'],
    ['(예시) 서울 OO상가 설계', '(주)OO개발', '2026-01-15', 30000000, '정산예정', '(이 예시 행은 삭제하고 사용하세요)']
  ],

  async _ensureXlsx() {
    if (window.XLSX && window.XLSX.utils && window.XLSX.write) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      // xlsx-js-style: 스타일링 지원 + 기본 XLSX API 호환
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('엑셀 라이브러리 로드 실패. 네트워크 확인 후 다시 시도하세요.'));
      document.head.appendChild(s);
    });
  },

  // 셀 스타일 헬퍼
  _styleHeader: {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: '맑은 고딕' },
    fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } },
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

      // 안내 행 + 헤더 + 예시 행
      const aoa = [
        ['📒 대림프로젝트 정산관리 — 일괄 등록 양식'],
        ['• 필수: 프로젝트명 (송금내역의 프로젝트명과 정확히 동일하게 입력)'],
        ['• 진행상태: 진행중 / 정산예정 / 완료 / 보류 중 하나 (비워두면 "진행중")'],
        ['• 계약일은 YYYY-MM-DD 형식 (예: 2026-01-15). 비워둬도 됩니다.'],
        ['• 매출금액은 숫자만 (예: 50000000). 쉼표·원 단위는 빼주세요.'],
        ['• 예시 행은 모두 지우고 본인 데이터로 채워서 업로드하세요.'],
        [],
        this.EXCEL_HEADERS,
        ...this.EXCEL_SAMPLE
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // 컬럼 폭 (6컬럼)
      ws['!cols'] = [
        { wch: 40 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 30 }
      ];

      // 머지 (안내 영역) - 6컬럼으로 변경
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } },
        { s: { r: 4, c: 0 }, e: { r: 4, c: 5 } },
        { s: { r: 5, c: 0 }, e: { r: 5, c: 5 } }
      ];

      // 행 높이
      ws['!rows'] = [
        { hpt: 28 }, { hpt: 18 }, { hpt: 18 }, { hpt: 18 }, { hpt: 18 }, { hpt: 18 },
        { hpt: 8 },  // 빈 줄
        { hpt: 32 }, // 헤더
        { hpt: 24 }, { hpt: 24 } // 예시 2행
      ];

      // 안내 행 스타일 (제목)
      const titleAddr = XLSX.utils.encode_cell({ r: 0, c: 0 });
      ws[titleAddr].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: '0F172A' } },
        alignment: { horizontal: 'center', vertical: 'center' }
      };
      // 안내 문구 스타일
      for (let r = 1; r <= 5; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: 0 });
        if (ws[addr]) ws[addr].s = this._styleGuide;
      }
      // 헤더 스타일
      for (let c = 0; c < this.EXCEL_HEADERS.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 7, c });
        if (ws[addr]) ws[addr].s = this._styleHeader;
      }
      // 예시 행 스타일
      for (let r = 8; r <= 9; r++) {
        for (let c = 0; c < this.EXCEL_HEADERS.length; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws[addr]) ws[addr].s = this._styleSample;
        }
      }

      // 헤더 행 고정
      ws['!freeze'] = { xSplit: 0, ySplit: 8 };

      XLSX.utils.book_append_sheet(wb, ws, '대림프로젝트 정산관리');

      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `프로젝트_정산관리_양식_${stamp}.xlsx`;
      XLSX.writeFile(wb, filename);
      Utils.showToast(`${filename} 다운로드 완료`, 'success');
    } catch (e) {
      console.error('[외주설계] 양식 다운로드 실패:', e);
      Utils.showToast('양식 다운로드 실패: ' + e.message, 'error');
    }
  },

  // ========== 엑셀 일괄 업로드 ==========
  _uploadParsed: [],

  _openUploadModal() {
    this._uploadParsed = [];
    Utils.openModal(`
      <div class="modal-header">
        <h3>📤 대림프로젝트 정산관리 엑셀 일괄 업로드</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="padding:var(--sp-3);background:var(--color-bg-light);border-radius:var(--radius-sm);margin-bottom:var(--sp-3);font-size:var(--font-size-sm);">
          <strong>📌 사용법</strong><br>
          1. 먼저 <strong>"엑셀 양식 다운로드"</strong>로 양식을 받습니다.<br>
          2. 양식의 예시 행을 지우고 본인 데이터로 채웁니다.<br>
          3. 저장한 파일을 아래에 드래그하거나 클릭하여 업로드합니다.<br>
          4. 미리보기 확인 후 [등록] 버튼을 누르세요.
        </div>

        <div id="osUploadArea" class="upload-area" style="cursor:pointer;text-align:center;padding:var(--sp-6);border:2px dashed var(--color-border);border-radius:var(--radius-md);">
          <div style="font-size:32px;">📊</div>
          <div class="fw-medium">엑셀 파일 업로드 (.xlsx / .xls)</div>
          <div class="text-sm text-muted" id="osUploadFileName">파일을 여기에 드래그하거나 클릭하여 선택</div>
          <input type="file" id="osUploadFileInput" accept=".xlsx,.xls" style="display:none;">
        </div>

        <div id="osUploadPreview" style="margin-top:var(--sp-4);"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="osUploadSaveBtn" onclick="OutsourcingModule._bulkSave()" disabled>등록</button>
      </div>
    `, { size: 'modal-lg' });

    setTimeout(() => {
      const area = document.getElementById('osUploadArea');
      const input = document.getElementById('osUploadFileInput');
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

  async _onUploadFile(file) {
    const nameEl = document.getElementById('osUploadFileName');
    if (nameEl) nameEl.textContent = `⏳ "${file.name}" 분석중...`;

    try {
      await this._ensureXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

      // 문자열 정규화: NBSP(U+00A0) 등 비표시 공백 → 일반 공백으로 변환 후 trim
      // (엑셀/웹 텍스트 복사 시 NBSP 가 섞여들어 매칭 실패하는 문제 방지)
      const norm = (v) => String(v || '').replace(/[   ]/g, ' ').trim();

      // 헤더 행 탐색 (첫 15줄 이내)
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(15, rows.length); i++) {
        const r = rows[i].map(c => norm(c));
        if (r.includes('프로젝트명')) { headerRowIdx = i; break; }
      }
      if (headerRowIdx < 0) {
        Utils.showToast('헤더 행(프로젝트명, 발주처 ...)을 찾을 수 없습니다. 양식대로 작성했는지 확인하세요.', 'error', 6000);
        if (nameEl) nameEl.textContent = `❌ 헤더를 찾지 못함`;
        return;
      }
      const headerCols = rows[headerRowIdx].map(c => norm(c));
      const idx = (name) => headerCols.findIndex(c => c === name || c.startsWith(name));

      // 매출금액(신) / 입금금액(구 양식) 둘 다 지원
      const depAmtIdx = idx('매출금액') >= 0 ? idx('매출금액') : idx('입금금액');
      const colMap = {
        projectName: idx('프로젝트명'),
        clientName: idx('발주처'),
        vendorName: idx('외주업체'),  // 구 양식 호환 (있으면 등록, 신 양식엔 없음)
        contractDate: idx('계약일'),
        depositAmount: depAmtIdx,
        status: idx('진행상태'),
        memo: idx('비고')
      };

      const parsed = [];
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(c => !norm(c))) continue;
        const projectName = colMap.projectName >= 0 ? norm(row[colMap.projectName]) : '';
        if (!projectName) continue;
        // 예시 행 자동 제외 (시작이 "(예시)")
        if (projectName.startsWith('(예시)')) continue;

        const depAmtRaw = colMap.depositAmount >= 0 ? String(row[colMap.depositAmount] || '').replace(/[,\s 원]/g, '') : '';
        const depAmt = Number(depAmtRaw) || 0;
        const status = (colMap.status >= 0 ? norm(row[colMap.status]) : '') || '진행중';
        const validStatus = this.STATUS_OPTIONS.includes(status) ? status : '진행중';

        parsed.push({
          rowNum: i + 1,
          selected: true,
          projectName,
          clientName: colMap.clientName >= 0 ? norm(row[colMap.clientName]) : '',
          vendorName: colMap.vendorName >= 0 ? norm(row[colMap.vendorName]) : '',
          contractDate: colMap.contractDate >= 0 ? this._normDate(row[colMap.contractDate]) : null,
          depositAmount: depAmt,
          status: validStatus,
          memo: colMap.memo >= 0 ? norm(row[colMap.memo]) : ''
        });
      }

      this._uploadParsed = parsed;
      if (nameEl) nameEl.textContent = `✅ "${file.name}" 로드 완료 (${parsed.length}건)`;
      this._renderUploadPreview();

      const btn = document.getElementById('osUploadSaveBtn');
      if (btn) btn.disabled = parsed.length === 0;
    } catch (e) {
      console.error('[외주설계] 파일 로드 실패:', e);
      Utils.showToast('파일 로드 실패: ' + e.message, 'error');
      if (nameEl) nameEl.textContent = `❌ 파일 로드 실패`;
    }
  },

  _normDate(v) {
    if (!v) return null;
    const s = String(v).trim();
    // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
    const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    // 엑셀 시리얼 숫자
    const n = Number(s);
    if (!isNaN(n) && n > 30000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  },

  _renderUploadPreview() {
    const el = document.getElementById('osUploadPreview');
    if (!el) return;
    if (this._uploadParsed.length === 0) {
      el.innerHTML = `<div class="text-muted text-center" style="padding:var(--sp-4);">파일을 업로드하면 미리보기가 표시됩니다.</div>`;
      return;
    }
    const rows = this._uploadParsed.map((r, i) => `
      <tr>
        <td class="text-center"><input type="checkbox" ${r.selected ? 'checked' : ''} onchange="OutsourcingModule._toggleUpload(${i}, this.checked)"></td>
        <td class="text-center text-xs text-muted">${r.rowNum}</td>
        <td>${Utils.escapeHtml(r.projectName)}</td>
        <td>${Utils.escapeHtml(r.clientName || '-')}</td>
        <td>${r.contractDate || '-'}</td>
        <td class="text-right amount">${Utils.formatCurrency(r.depositAmount)}</td>
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
              <th class="text-center" style="width:40px;"><input type="checkbox" checked onchange="OutsourcingModule._toggleAllUpload(this.checked)"></th>
              <th class="text-center">행</th>
              <th>프로젝트명</th>
              <th>발주처</th>
              <th>계약일</th>
              <th class="text-right">매출금액</th>
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

  // ========== 단일 프로젝트 보고서 PDF ==========
  // 특정 프로젝트 1건만 담긴 보고서. 결재 시 대표님께 어느 프로젝트인지 명확히 보여줌
  async _downloadSinglePDF(id) {
    try {
      const p = await DB.get('outsourcingProjects', id);
      if (!p) { Utils.showToast('프로젝트를 찾을 수 없습니다.', 'error'); return; }

      await this._loadTransferTotals();
      const projectKey = (p.projectName || '').trim();

      // 해당 프로젝트의 송금내역
      const allTransfers = (await DB.getAll('transferRecords'))
        .filter(t => (t.projectName || '').trim() === projectKey)
        .sort((a, b) => (a.transferDate || '').localeCompare(b.transferDate || ''));

      const outsourcingTotal = allTransfers.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const depositAmount = Number(p.depositAmount) || 0;
      const balance = depositAmount - outsourcingTotal;

      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const user = Auth.currentUser();

      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
      const fmt = (n) => `₩${(Number(n) || 0).toLocaleString('ko-KR')}`;

      const transferRows = allTransfers.length === 0
        ? `<tr><td colspan="4" style="text-align:center;padding:16px;color:#94A3B8;">매칭된 송금내역이 없습니다.</td></tr>`
        : allTransfers.map(t => `<tr>
            <td>${t.transferDate || '-'}</td>
            <td>${esc(t.recipientName || '-')}</td>
            <td class="num">${fmt(t.amount)}</td>
            <td>${esc(t.memo || '-')}</td>
          </tr>`).join('');

      const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>프로젝트 정산 보고서 - ${esc(p.projectName)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif; color: #1e293b; font-size: 10pt; margin: 18mm 16mm; background: #fff; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0F172A; padding-bottom: 8px; margin-bottom: 18px; }
  h1 { font-size: 18pt; margin: 0; color: #0F172A; font-weight: 800; }
  .doc-type { font-size: 10pt; color: #64748b; margin-top: 4px; }
  .meta { font-size: 9pt; color: #64748b; text-align: right; line-height: 1.5; }
  .project-title { background: linear-gradient(135deg, #2563EB 0%, #1E40AF 100%); color: #fff; padding: 16px 20px; border-radius: 8px; margin-bottom: 16px; }
  .project-title h2 { margin: 0; font-size: 16pt; font-weight: 700; }
  .project-title .sub { font-size: 10pt; opacity: 0.9; margin-top: 4px; }
  h3 { font-size: 12pt; margin-top: 18px; color: #2563EB; border-bottom: 1px solid #E2E8F0; padding-bottom: 4px; }
  .info { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  .info td { padding: 8px 12px; border: 1px solid #E2E8F0; }
  .info td:nth-child(odd) { background: #F8FAFC; font-weight: 600; width: 25%; }
  .summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 10px 0 20px; }
  .summary .card { background: #F8FAFC; border-left: 4px solid #2563EB; padding: 12px 16px; border-radius: 4px; }
  .summary .card .lbl { font-size: 9pt; color: #64748B; margin-bottom: 4px; }
  .summary .card .val { font-size: 14pt; font-weight: 700; color: #0F172A; }
  .summary .card.balance { border-color: ${balance < 0 ? '#DC2626' : '#16A34A'}; }
  .summary .card.balance .val { color: ${balance < 0 ? '#DC2626' : '#16A34A'}; }
  table.list { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 6px; }
  table.list th { background: #0F172A; color: #fff; padding: 7px; text-align: left; font-weight: 600; }
  table.list td { padding: 6px 7px; border-bottom: 1px solid #E2E8F0; }
  table.list .num { text-align: right; font-variant-numeric: tabular-nums; }
  .memo-box { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px 14px; border-radius: 4px; margin-top: 12px; font-size: 10pt; white-space: pre-wrap; }
  .toolbar { margin: 10px 0 16px; }
  .btn-print { padding: 8px 16px; background: #2563EB; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-weight: 600; }
  .btn-close { padding: 8px 16px; background: #94A3B8; color: #fff; border: 0; border-radius: 6px; cursor: pointer; margin-left: 6px; }
  .footer { margin-top: 24px; font-size: 8pt; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 8px; text-align: center; }
  .status-badge { display: inline-block; padding: 3px 12px; border-radius: 12px; font-size: 9pt; font-weight: 600; }
  .status-진행중 { background: #DBEAFE; color: #1E40AF; }
  .status-정산예정 { background: #FEF3C7; color: #B45309; }
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
      <h1>📒 프로젝트 정산 보고서</h1>
      <div class="doc-type">개별 프로젝트 결재용</div>
    </div>
    <div class="meta">작성일: ${dateStr}<br>작성자: ${esc(user ? user.displayName : '-')}<br>스퀘어건축사사무소 업무관리 시스템</div>
  </div>

  <div class="project-title">
    <h2>${esc(p.projectName)}</h2>
    <div class="sub">발주처: ${esc(p.clientName || '-')} · 진행상태: ${esc(p.status || '진행중')}</div>
  </div>

  <h3>📋 프로젝트 정보</h3>
  <table class="info">
    <tr>
      <td>프로젝트명</td><td>${esc(p.projectName)}</td>
      <td>발주처</td><td>${esc(p.clientName || '-')}</td>
    </tr>
    <tr>
      <td>외주업체</td><td>${esc(p.vendorName || '-')}</td>
      <td>계약일</td><td>${p.contractDate || '-'}</td>
    </tr>
    <tr>
      <td>진행상태</td><td><span class="status-badge status-${esc(p.status || '진행중')}">${esc(p.status || '진행중')}</span></td>
      <td>등록일</td><td>${p.createdAt ? new Date(p.createdAt).toLocaleDateString('ko-KR') : '-'}</td>
    </tr>
  </table>

  <h3>💰 정산 요약</h3>
  <div class="summary">
    <div class="card"><div class="lbl">매출금액</div><div class="val">${fmt(depositAmount)}</div></div>
    <div class="card"><div class="lbl">집행금액 (외주지급)</div><div class="val">${fmt(outsourcingTotal)}</div></div>
    <div class="card balance"><div class="lbl">잔액</div><div class="val">${fmt(balance)}</div></div>
  </div>

  <h3>💸 외주지급 내역 (${allTransfers.length}건)</h3>
  <table class="list">
    <thead><tr>
      <th style="width:16%;">송금일</th>
      <th style="width:22%;">수취인</th>
      <th class="num" style="width:18%;">금액</th>
      <th>비고</th>
    </tr></thead>
    <tbody>${transferRows}</tbody>
  </table>

  ${p.memo ? `<h3>📝 비고</h3><div class="memo-box">${esc(p.memo)}</div>` : ''}

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
      console.error('[외주설계] 단일 PDF 실패:', e);
      Utils.showToast('보고서 PDF 생성 실패: ' + e.message, 'error');
    }
  },

  // ========== 리스트 엑셀 다운로드 (스타일 적용) ==========
  // 현재 대림프로젝트 정산관리에 등록된 모든 프로젝트를 엑셀 파일로 출력
  async _downloadListExcel() {
    try {
      await this._ensureXlsx();
      const XLSX = window.XLSX;

      await this._loadTransferTotals();
      const all = (await DB.getAll('outsourcingProjects')).reverse();

      const totalDeposit = all.reduce((s, p) => s + (Number(p.depositAmount) || 0), 0);
      const totalOutsourcing = all.reduce((s, p) => s + (this._transferTotalsByProject[(p.projectName || '').trim()] || 0), 0);
      const totalBalance = totalDeposit - totalOutsourcing;

      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

      // 데이터 시트 구성 (AOA) - 외주업체 컬럼 제외, 매출금액/집행금액 라벨
      const HEADERS = ['프로젝트명', '발주처', '계약일', '매출금액', '집행금액', '잔액', '진행상태', '비고'];
      const aoa = [
        [`📒 대림프로젝트 정산관리 (총 ${all.length}건)`],
        [`작성일: ${dateStr}`],
        [],
        HEADERS,
        ...all.map(p => {
          const out = this._transferTotalsByProject[(p.projectName || '').trim()] || 0;
          const bal = (Number(p.depositAmount) || 0) - out;
          return [
            p.projectName || '',
            p.clientName || '',
            p.contractDate || '',
            Number(p.depositAmount) || 0,
            out,
            bal,
            p.status || '진행중',
            p.memo || ''
          ];
        }),
        [],
        ['합계', '', '', totalDeposit, totalOutsourcing, totalBalance, '', '']
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // 컬럼 폭 (8컬럼)
      ws['!cols'] = [
        { wch: 40 }, { wch: 20 }, { wch: 13 },
        { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 30 }
      ];

      // 행 높이
      ws['!rows'] = [
        { hpt: 32 }, { hpt: 18 }, { hpt: 8 }, { hpt: 30 }
      ];
      for (let i = 0; i < all.length; i++) ws['!rows'].push({ hpt: 22 });
      ws['!rows'].push({ hpt: 8 });
      ws['!rows'].push({ hpt: 28 });

      const COL_COUNT = HEADERS.length;  // 8

      // 머지 (타이틀, 작성일) - COL_COUNT-1 까지
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: COL_COUNT - 1 } }
      ];

      // 금액 컬럼: 매출금액(3), 집행금액(4), 잔액(5) / 상태(6) 가운데 / 비고(7) wrap
      const AMOUNT_COLS = new Set([3, 4, 5]);
      const CENTER_COLS = new Set([6]);
      const WRAP_COLS = new Set([0, 7]);

      // 스타일 헬퍼
      const styleTitle = {
        font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: '0F172A' } },
        alignment: { horizontal: 'center', vertical: 'center' }
      };
      const styleDate = {
        font: { italic: true, sz: 10, color: { rgb: '64748B' }, name: '맑은 고딕' },
        alignment: { horizontal: 'right', vertical: 'center' }
      };
      const styleHeader = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: '94A3B8' } },
          bottom: { style: 'thin', color: { rgb: '94A3B8' } },
          left: { style: 'thin', color: { rgb: '94A3B8' } },
          right: { style: 'thin', color: { rgb: '94A3B8' } }
        }
      };
      const styleBody = (isOdd, col) => ({
        font: { sz: 10, color: { rgb: '1E293B' }, name: '맑은 고딕' },
        fill: { patternType: 'solid', fgColor: { rgb: isOdd ? 'F8FAFC' : 'FFFFFF' } },
        alignment: {
          horizontal: AMOUNT_COLS.has(col) ? 'right' : (CENTER_COLS.has(col) ? 'center' : 'left'),
          vertical: 'center',
          wrapText: WRAP_COLS.has(col)
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

      // 타이틀
      ws[XLSX.utils.encode_cell({ r: 0, c: 0 })].s = styleTitle;
      // 작성일
      ws[XLSX.utils.encode_cell({ r: 1, c: 0 })].s = styleDate;

      // 헤더
      for (let c = 0; c < COL_COUNT; c++) {
        const addr = XLSX.utils.encode_cell({ r: 3, c });
        if (ws[addr]) ws[addr].s = styleHeader;
      }

      // 데이터 행 (행 4부터 시작)
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

      // 헤더 고정 (행 4까지: 타이틀/작성일/공백/헤더)
      ws['!freeze'] = { xSplit: 0, ySplit: 4 };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '대림프로젝트 정산관리');

      const stamp = dateStr.replace(/-/g, '');
      const filename = `프로젝트_정산관리_${stamp}.xlsx`;
      XLSX.writeFile(wb, filename);
      Utils.showToast(`${filename} 다운로드 완료 (${all.length}건)`, 'success');
    } catch (e) {
      console.error('[외주설계] 리스트 엑셀 다운로드 실패:', e);
      Utils.showToast('엑셀 다운로드 실패: ' + e.message, 'error');
    }
  },

  // ========== 보고서 PDF 다운로드 ==========
  // 현재 대림프로젝트 정산관리 데이터를 보고서 형태의 새 창으로 열어 인쇄/PDF 저장
  async _downloadReportPDF() {
    await this._loadTransferTotals();
    const all = (await DB.getAll('outsourcingProjects')).reverse();

    const totalDeposit = all.reduce((s, p) => s + (Number(p.depositAmount) || 0), 0);
    const totalOutsourcing = all.reduce((s, p) => s + (this._transferTotalsByProject[(p.projectName || '').trim()] || 0), 0);
    const totalBalance = totalDeposit - totalOutsourcing;

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const user = Auth.currentUser();

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const fmt = (n) => `₩${(Number(n) || 0).toLocaleString('ko-KR')}`;

    const rowsHtml = all.map(p => {
      const out = this._transferTotalsByProject[(p.projectName || '').trim()] || 0;
      const bal = (Number(p.depositAmount) || 0) - out;
      const status = p.status || '진행중';
      return `<tr>
        <td>${esc(p.projectName)}</td>
        <td>${esc(p.clientName || '-')}</td>
        <td class="num">${fmt(p.depositAmount || 0)}</td>
        <td class="num">${fmt(out)}</td>
        <td class="num ${bal < 0 ? 'neg' : ''}">${fmt(bal)}</td>
        <td><span class="st st-${esc(status)}">${esc(status)}</span></td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>외주설계 관리 현황 보고서 - ${dateStr}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif; color: #1e293b; font-size: 10pt; margin: 16mm 14mm; background: #fff; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0F172A; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 18pt; margin: 0; color: #0F172A; font-weight: 800; }
  .meta { font-size: 9pt; color: #64748b; text-align: right; line-height: 1.5; }
  h2 { font-size: 13pt; margin-top: 20px; color: #2563EB; border-bottom: 1px solid #E2E8F0; padding-bottom: 4px; }
  .summary { width: 100%; border-collapse: collapse; margin: 10px 0 16px; }
  .summary td { padding: 8px 10px; border: 1px solid #E2E8F0; }
  .summary td:nth-child(odd) { background: #F8FAFC; font-weight: 600; width: 20%; }
  .summary td:nth-child(even) { text-align: right; font-size: 11pt; font-weight: 700; width: 30%; }
  table.list { width: 100%; border-collapse: collapse; font-size: 9pt; }
  table.list th { background: #0F172A; color: #fff; padding: 6px; text-align: left; font-weight: 600; }
  table.list td { padding: 5px 6px; border-bottom: 1px solid #E2E8F0; vertical-align: top; }
  table.list .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.list .neg { color: #DC2626; }
  .st { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 8pt; font-weight: 600; }
  .st-진행중 { background: #DBEAFE; color: #1E40AF; }
  .st-정산예정 { background: #FEF3C7; color: #B45309; }
  .st-완료 { background: #D1FAE5; color: #065F46; }
  .st-보류 { background: #FEE2E2; color: #991B1B; }
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
    <h1>📒 대림프로젝트 정산관리 현황 보고서</h1>
    <div class="meta">작성일: ${dateStr}<br>작성자: ${esc(user ? user.displayName : '-')}<br>스퀘어건축사사무소 업무관리 시스템</div>
  </div>

  <h2>📊 합계 요약</h2>
  <table class="summary">
    <tr><td>총 프로젝트</td><td>${all.length}건</td><td>총 매출금액</td><td>${fmt(totalDeposit)}</td></tr>
    <tr><td>총 집행금액</td><td>${fmt(totalOutsourcing)}</td><td>총 잔액</td><td class="${totalBalance < 0 ? 'neg' : ''}">${fmt(totalBalance)}</td></tr>
  </table>

  <h2>📋 프로젝트 상세 (${all.length}건)</h2>
  <table class="list">
    <thead><tr>
      <th>프로젝트명</th><th>발주처</th>
      <th class="num">매출금액</th><th class="num">집행금액</th><th class="num">잔액</th>
      <th>상태</th>
    </tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94A3B8;">등록된 프로젝트가 없습니다.</td></tr>'}</tbody>
  </table>

  <div class="footer">본 보고서는 스퀘어건축사사무소 업무관리 시스템에서 자동 생성되었습니다.</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=1100,height=800');
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

    // 중복 체크 (프로젝트명 일치)
    const existing = await DB.getAll('outsourcingProjects');
    const existingNames = new Set(existing.map(p => (p.projectName || '').trim()));

    const user = Auth.currentUser();
    let added = 0, skipped = 0, failed = 0;
    for (const row of sel) {
      try {
        if (existingNames.has(row.projectName.trim())) { skipped++; continue; }
        existingNames.add(row.projectName.trim());

        await DB.add('outsourcingProjects', {
          projectName: row.projectName,
          clientName: row.clientName,
          vendorName: row.vendorName,
          contractDate: row.contractDate,
          depositAmount: row.depositAmount,
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
        console.error('외주설계 일괄 등록 실패:', e);
        failed++;
      }
    }
    await DB.log('CREATE', 'outsourcing', null, `외주설계 일괄 등록: ${added}건 (중복스킵 ${skipped}, 실패 ${failed})`);

    Utils.closeModal();
    const parts = [`등록 ${added}건`];
    if (skipped > 0) parts.push(`중복 스킵 ${skipped}건`);
    if (failed > 0) parts.push(`실패 ${failed}건`);
    Utils.showToast(parts.join(' / '), 'success');
    await this.render();
  }
};

window.OutsourcingModule = OutsourcingModule;
