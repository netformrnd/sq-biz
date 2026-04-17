/* ============================================
   세금계산서 - 입금 매칭 모듈
   ============================================ */

const MatchingModule = {
  container: null,
  selectedInvoiceId: null,
  selectedDepositId: null,

  async init(container) {
    this.container = container;
    this.selectedInvoiceId = null;
    this.selectedDepositId = null;
    await this.render();
  },

  async render() {
    const invoices = (await DB.getAll('taxInvoiceRequests'))
      .filter(i => i.status === '발행완료' && !i.matchedDepositId);
    const deposits = (await DB.getAll('deposits'))
      .filter(d => d.matchStatus !== '매칭완료');

    // 전체 통계
    const allInvoices = await DB.getAll('taxInvoiceRequests');
    const allDeposits = await DB.getAll('deposits');
    const matchedCount = allDeposits.filter(d => d.matchStatus === '매칭완료').length;
    const totalInvoiceCompleted = allInvoices.filter(i => i.status === '발행완료').length;

    this.container.innerHTML = `
      <!-- 기발행 세금계산서 등록 버튼 -->
      <div class="d-flex justify-between items-center mb-4">
        <div></div>
        <div class="d-flex gap-2">
          <button class="btn btn-secondary" onclick="MatchingModule._openIssuedPasteModal()">📋 기발행 세금계산서 붙여넣기</button>
          <button class="btn btn-secondary" onclick="MatchingModule._openIssuedAddModal()">+ 기발행 개별 등록</button>
        </div>
      </div>

      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon green">✅</div>
          <div class="card-info">
            <div class="card-label">매칭 완료</div>
            <div class="card-value">${matchedCount}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon orange">🔗</div>
          <div class="card-info">
            <div class="card-label">미매칭 세금계산서</div>
            <div class="card-value">${invoices.length}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon red">💰</div>
          <div class="card-info">
            <div class="card-label">미매칭 입금</div>
            <div class="card-value">${deposits.length}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon blue">📊</div>
          <div class="card-info">
            <div class="card-label">매칭률</div>
            <div class="card-value">${totalInvoiceCompleted > 0 ? Math.round(matchedCount / allDeposits.length * 100) || 0 : 0}%</div>
          </div>
        </div>
      </div>

      <div class="matching-container">
        <!-- 좌: 세금계산서 -->
        <div class="matching-panel">
          <div class="panel-header">
            📝 발행완료 세금계산서 (미매칭: ${invoices.length}건)
          </div>
          <div class="panel-body" id="invoicePanel">
            ${invoices.length === 0 ?
              '<div class="empty-state" style="padding:var(--sp-6);"><p>미매칭 세금계산서가 없습니다</p></div>' :
              invoices.map(inv => `
                <div class="matching-item ${this.selectedInvoiceId === inv.id ? 'selected' : ''}"
                     onclick="MatchingModule._selectInvoice('${inv.id}')">
                  <input type="radio" name="invoice" class="item-checkbox"
                         ${this.selectedInvoiceId === inv.id ? 'checked' : ''}>
                  <div class="item-info">
                    <div class="fw-medium">${Utils.escapeHtml(inv.partnerCompanyName || inv.requestNumber)}</div>
                    <div class="text-xs text-muted">${Utils.formatDate(inv.issueDate)} · ${Utils.escapeHtml(inv.requesterName || '')}</div>
                  </div>
                  <div class="item-amount">${Utils.formatCurrency(inv.totalAmount)}</div>
                </div>
              `).join('')}
          </div>
        </div>

        <!-- 중앙: 매칭 버튼 -->
        <div class="matching-actions">
          <button class="btn btn-primary btn-lg" id="matchBtn"
                  onclick="MatchingModule._performMatch()"
                  ${(!this.selectedInvoiceId || !this.selectedDepositId) ? 'disabled' : ''}>
            🔗 매칭
          </button>
          <button class="btn btn-ghost btn-sm" onclick="MatchingModule._autoSuggest()">
            자동추천
          </button>
        </div>

        <!-- 우: 입금내역 -->
        <div class="matching-panel">
          <div class="panel-header">
            💰 입금내역 (미매칭: ${deposits.length}건)
          </div>
          <div class="panel-body" id="depositPanel">
            ${deposits.length === 0 ?
              '<div class="empty-state" style="padding:var(--sp-6);"><p>미매칭 입금내역이 없습니다</p></div>' :
              deposits.map(dep => `
                <div class="matching-item ${this.selectedDepositId === dep.id ? 'selected' : ''}"
                     onclick="MatchingModule._selectDeposit('${dep.id}')">
                  <input type="radio" name="deposit" class="item-checkbox"
                         ${this.selectedDepositId === dep.id ? 'checked' : ''}>
                  <div class="item-info">
                    <div class="fw-medium">${Utils.escapeHtml(dep.depositorName || '-')}</div>
                    <div class="text-xs text-muted">${Utils.formatDate(dep.depositDate)} · ${Utils.escapeHtml(dep.projectName || '')}</div>
                  </div>
                  <div class="item-amount">${Utils.formatCurrency(dep.amount)}</div>
                </div>
              `).join('')}
          </div>
        </div>
      </div>

      <!-- 매칭 이력 -->
      <div class="card mt-6">
        <div class="card-header">
          <h3>최근 매칭 이력</h3>
        </div>
        <div class="card-body" style="padding:0;" id="matchingHistory"></div>
      </div>
    `;

    await this._renderMatchingHistory();
  },

  _selectInvoice(id) {
    this.selectedInvoiceId = id;
    this.render();
  },

  _selectDeposit(id) {
    this.selectedDepositId = id;
    this.render();
  },

  async _performMatch() {
    if (!this.selectedInvoiceId || !this.selectedDepositId) return;

    const invoice = await DB.get('taxInvoiceRequests', this.selectedInvoiceId);
    const deposit = await DB.get('deposits', this.selectedDepositId);

    if (!invoice || !deposit) return;

    const confirmed = await Utils.confirm(
      `세금계산서 [${invoice.requestNumber}] (${Utils.formatCurrency(invoice.totalAmount)})와\n입금내역 [${deposit.depositorName}] (${Utils.formatCurrency(deposit.amount)})를 매칭하시겠습니까?`,
      '매칭 확인'
    );
    if (!confirmed) return;

    const user = Auth.currentUser();

    // 매칭 처리
    invoice.matchedDepositId = deposit.id;
    invoice.updatedAt = new Date().toISOString();
    await DB.update('taxInvoiceRequests', invoice);

    deposit.matchedInvoiceId = invoice.id;
    deposit.matchStatus = '매칭완료';
    deposit.updatedAt = new Date().toISOString();
    await DB.update('deposits', deposit);

    // 매칭 로그
    await DB.add('matchingLog', {
      invoiceId: invoice.id,
      depositId: deposit.id,
      matchedAmount: deposit.amount,
      matchedBy: user.id,
      matchedByName: user.displayName,
      matchedAt: new Date().toISOString(),
      memo: ''
    });

    await DB.log('MATCH', 'matching', null, `매칭: ${invoice.requestNumber} ↔ ${deposit.depositorName}`);

    this.selectedInvoiceId = null;
    this.selectedDepositId = null;

    Utils.showToast('매칭이 완료되었습니다.', 'success');
    await this.render();
  },

  async _autoSuggest() {
    const invoices = (await DB.getAll('taxInvoiceRequests'))
      .filter(i => i.status === '발행완료' && !i.matchedDepositId);
    const deposits = (await DB.getAll('deposits'))
      .filter(d => d.matchStatus !== '매칭완료');

    // 금액 일치 + 이름 유사도로 추천
    let bestMatch = null;
    let bestScore = 0;

    for (const inv of invoices) {
      for (const dep of deposits) {
        let score = 0;

        // 금액 일치
        if (inv.totalAmount === dep.amount) score += 50;
        else if (Math.abs(inv.totalAmount - dep.amount) < inv.totalAmount * 0.01) score += 30;

        // 이름 유사도
        const invName = Utils.normalizeCompanyName(inv.partnerCompanyName);
        const depName = Utils.normalizeCompanyName(dep.depositorName);
        if (invName && depName) {
          if (invName === depName) score += 40;
          else if (invName.includes(depName) || depName.includes(invName)) score += 25;
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = { invoiceId: inv.id, depositId: dep.id, score };
        }
      }
    }

    if (bestMatch && bestMatch.score >= 50) {
      this.selectedInvoiceId = bestMatch.invoiceId;
      this.selectedDepositId = bestMatch.depositId;
      await this.render();
      Utils.showToast(`자동 추천 매칭을 찾았습니다. (유사도: ${bestMatch.score}점) 확인 후 매칭 버튼을 눌러주세요.`, 'success');
    } else {
      Utils.showToast('자동으로 추천할 매칭을 찾지 못했습니다. 수동으로 매칭해 주세요.', 'warning');
    }
  },

  async _renderMatchingHistory() {
    const logs = (await DB.getAll('matchingLog')).reverse().slice(0, 10);
    const el = document.getElementById('matchingHistory');
    if (!el) return;

    if (logs.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:var(--sp-6);"><p>매칭 이력이 없습니다</p></div>';
      return;
    }

    let html = '';
    for (const log of logs) {
      const inv = await DB.get('taxInvoiceRequests', log.invoiceId);
      const dep = await DB.get('deposits', log.depositId);
      html += `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--color-border);">
          <div>
            <span class="fw-medium text-sm">${inv ? Utils.escapeHtml(inv.requestNumber) : '?'}</span>
            <span class="text-muted mx-2">↔</span>
            <span class="fw-medium text-sm">${dep ? Utils.escapeHtml(dep.depositorName) : '?'}</span>
          </div>
          <div class="text-right">
            <div class="text-sm fw-semibold">${Utils.formatCurrency(log.matchedAmount)}</div>
            <div class="text-xs text-muted">${Utils.formatDateTime(log.matchedAt)} · ${Utils.escapeHtml(log.matchedByName || '')}</div>
          </div>
        </div>
      `;
    }
    el.innerHTML = html;
  },

  // ===== 기발행 세금계산서 엑셀 붙여넣기 등록 =====
  _issuedParsedRows: [],

  _openIssuedPasteModal() {
    this._issuedParsedRows = [];
    Utils.openModal(`
      <div class="modal-header">
        <h3>📋 기발행 세금계산서 붙여넣기 등록</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-4);font-size:var(--font-size-sm);">
          <strong>사용법:</strong> 홈택스 매출전자세금계산서 목록 엑셀에서 <strong>데이터 행만</strong> 복사(Ctrl+C)한 후 붙여넣기(Ctrl+V) 하세요.<br>
          <span class="text-muted">컬럼: 작성일자 | 승인번호 | 발급일자 | ... | 공급받는자 상호 | 대표자명 | ... | 합계금액 | 공급가액 | 세액 | ...</span>
        </div>

        <div class="form-group">
          <label>엑셀 데이터 붙여넣기 <span class="required">*</span></label>
          <textarea id="issuedPasteArea" class="form-control" rows="8"
                    placeholder="홈택스 엑셀에서 복사한 데이터를 여기에 붙여넣기 하세요 (Ctrl+V)"
                    style="font-family:monospace;font-size:12px;"></textarea>
        </div>

        <button class="btn btn-secondary mb-4" onclick="MatchingModule._parseIssuedData()">데이터 확인</button>

        <div id="issuedPreview" class="hidden">
          <div class="table-wrapper" style="max-height:300px;overflow-y:auto;">
            <table class="data-table" id="issuedPreviewTable">
              <thead>
                <tr>
                  <th style="width:40px;"><input type="checkbox" id="issuedSelectAll" checked onchange="MatchingModule._toggleIssuedSelectAll(this.checked)"></th>
                  <th>발급일자</th>
                  <th>거래처(공급받는자)</th>
                  <th>대표자</th>
                  <th class="text-right">공급가액</th>
                  <th class="text-right">세액</th>
                  <th class="text-right">합계</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div id="issuedCount" class="text-sm text-muted mt-2"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="issuedSaveBtn" onclick="MatchingModule._saveIssuedData()" disabled>선택 항목 등록</button>
      </div>
    `, { size: 'modal-xl' });
  },

  _parseIssuedData() {
    const raw = document.getElementById('issuedPasteArea').value.trim();
    if (!raw) { Utils.showToast('데이터를 붙여넣기 하세요.', 'error'); return; }

    const lines = raw.split('\n').filter(l => l.trim());
    this._issuedParsedRows = [];

    for (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 17) continue;

      // 홈택스 형식: [0]작성일자 [1]승인번호 [2]발급일자 [3]전송일자
      // [4]공급자사업자번호 [5]종사업장 [6]공급자상호 [7]공급자대표자 [8]공급자주소
      // [9]공급받는자사업자번호 [10]종사업장 [11]공급받는자상호 [12]공급받는자대표자 [13]공급받는자주소
      // [14]합계금액 [15]공급가액 [16]세액
      // [17]분류 [18]종류 [19]발급유형 [20]비고 [21]영수/청구 [22]공급자이메일 [23]공급받는자이메일

      const issueDate = (cols[2] || cols[0] || '').trim();
      const partnerRegNum = (cols[9] || '').trim();
      const partnerName = (cols[11] || '').trim();
      const partnerRep = (cols[12] || '').trim();
      const partnerAddr = (cols[13] || '').trim();
      const totalAmount = Number((cols[14] || '').replace(/[,\s]/g, '')) || 0;
      const supplyAmount = Number((cols[15] || '').replace(/[,\s]/g, '')) || 0;
      const taxAmount = Number((cols[16] || '').replace(/[,\s]/g, '')) || 0;
      const partnerEmail = (cols[23] || '').trim();
      const approvalNum = (cols[1] || '').trim();

      // 금액이 0이거나 마이너스면 수정세금계산서일 수 있으나 포함
      if (!partnerName && totalAmount === 0) continue;

      // 날짜 파싱
      let date = '';
      const dateMatch = issueDate.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
      if (dateMatch) {
        date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
      }

      this._issuedParsedRows.push({
        date,
        approvalNum,
        partnerRegNum,
        partnerName,
        partnerRep,
        partnerAddr,
        partnerEmail,
        supplyAmount,
        taxAmount,
        totalAmount,
        selected: true
      });
    }

    const preview = document.getElementById('issuedPreview');
    const tbody = document.querySelector('#issuedPreviewTable tbody');
    const saveBtn = document.getElementById('issuedSaveBtn');

    if (this._issuedParsedRows.length === 0) {
      preview.classList.add('hidden');
      saveBtn.disabled = true;
      Utils.showToast('세금계산서 데이터를 찾을 수 없습니다. 헤더 행을 제외하고 데이터만 복사하세요.', 'warning');
      return;
    }

    preview.classList.remove('hidden');
    saveBtn.disabled = false;

    tbody.innerHTML = this._issuedParsedRows.map((row, i) => `
      <tr>
        <td><input type="checkbox" data-idx="${i}" ${row.selected ? 'checked' : ''} onchange="MatchingModule._toggleIssuedRow(${i}, this.checked)"></td>
        <td>${Utils.escapeHtml(row.date)}</td>
        <td class="fw-medium">${Utils.escapeHtml(row.partnerName)}</td>
        <td>${Utils.escapeHtml(row.partnerRep)}</td>
        <td class="text-right">${Utils.formatCurrency(row.supplyAmount)}</td>
        <td class="text-right">${Utils.formatCurrency(row.taxAmount)}</td>
        <td class="text-right fw-semibold">${Utils.formatCurrency(row.totalAmount)}</td>
      </tr>
    `).join('');

    const total = this._issuedParsedRows.filter(r => r.selected).reduce((s, r) => s + r.totalAmount, 0);
    document.getElementById('issuedCount').textContent =
      `총 ${this._issuedParsedRows.length}건 / 합계 ${Utils.formatCurrency(total)}`;
  },

  _toggleIssuedRow(idx, checked) {
    this._issuedParsedRows[idx].selected = checked;
    const sel = this._issuedParsedRows.filter(r => r.selected);
    document.getElementById('issuedCount').textContent =
      `선택 ${sel.length}건 / ${this._issuedParsedRows.length}건 / 합계 ${Utils.formatCurrency(sel.reduce((s, r) => s + r.totalAmount, 0))}`;
    document.getElementById('issuedSaveBtn').disabled = sel.length === 0;
  },

  _toggleIssuedSelectAll(checked) {
    this._issuedParsedRows.forEach((r, i) => {
      r.selected = checked;
      const cb = document.querySelector(`#issuedPreviewTable input[data-idx="${i}"]`);
      if (cb) cb.checked = checked;
    });
    this._toggleIssuedRow(0, checked); // 카운트 갱신
  },

  async _saveIssuedData() {
    const selected = this._issuedParsedRows.filter(r => r.selected);
    if (selected.length === 0) return;

    const user = Auth.currentUser();
    let count = 0;

    for (const row of selected) {
      const reqNum = await DB.generateRequestNumber();
      await DB.add('taxInvoiceRequests', {
        requestNumber: reqNum,
        requesterId: user.id,
        requesterName: user.displayName,
        status: '발행완료',
        reason: '기발행 세금계산서 등록',
        amount: row.supplyAmount,
        taxAmount: row.taxAmount,
        totalAmount: row.totalAmount,
        partnerCompanyName: row.partnerName,
        partnerRegNumber: row.partnerRegNum,
        partnerRepName: row.partnerRep,
        partnerEmail: row.partnerEmail,
        partnerAddress: row.partnerAddr,
        partnerBusinessType: '',
        partnerBusinessItem: '',
        attachments: [],
        projectName: '',
        memo: row.approvalNum ? `승인번호: ${row.approvalNum}` : '',
        reviewerId: user.id,
        reviewerName: user.displayName,
        reviewedAt: new Date().toISOString(),
        issueDate: row.date || new Date().toISOString(),
        rejectReason: null,
        matchedDepositId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      count++;
    }

    await DB.log('CREATE', 'taxInvoice', null, `기발행 세금계산서 일괄 등록: ${count}건`);
    this._issuedParsedRows = [];

    Utils.closeModal();
    Utils.showToast(`${count}건의 기발행 세금계산서가 등록되었습니다.`, 'success');
    await this.render();
  },

  // ===== 기발행 세금계산서 개별 등록 =====
  _openIssuedAddModal() {
    Utils.openModal(`
      <div class="modal-header">
        <h3>기발행 세금계산서 개별 등록</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label for="isDate">발급일자 <span class="required">*</span></label>
            <input type="date" id="isDate" class="form-control" value="${Utils.today()}" required>
          </div>
          <div class="form-group">
            <label for="isPartnerName">거래처(공급받는자) <span class="required">*</span></label>
            <input type="text" id="isPartnerName" class="form-control" placeholder="거래처 상호" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="isPartnerReg">사업자등록번호</label>
            <input type="text" id="isPartnerReg" class="form-control" placeholder="000-00-00000">
          </div>
          <div class="form-group">
            <label for="isPartnerEmail">이메일</label>
            <input type="email" id="isPartnerEmail" class="form-control" placeholder="email@example.com">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="isAmount">공급가액 <span class="required">*</span></label>
            <input type="number" id="isAmount" class="form-control" placeholder="0" required>
          </div>
          <div class="form-group">
            <label for="isTax">세액</label>
            <input type="number" id="isTax" class="form-control" placeholder="자동계산">
          </div>
          <div class="form-group">
            <label>합계</label>
            <input type="text" id="isTotal" class="form-control" readonly>
          </div>
        </div>
        <div class="form-group">
          <label for="isMemo">비고</label>
          <input type="text" id="isMemo" class="form-control" placeholder="승인번호 등">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="MatchingModule._saveIssuedSingle()">등록</button>
      </div>
    `);

    // 공급가액 입력 시 세액/합계 자동계산
    document.getElementById('isAmount').addEventListener('input', () => {
      const amt = Number(document.getElementById('isAmount').value) || 0;
      const tax = document.getElementById('isTax').value ? Number(document.getElementById('isTax').value) : Math.round(amt * 0.1);
      if (!document.getElementById('isTax').value) document.getElementById('isTax').value = tax;
      document.getElementById('isTotal').value = Utils.formatCurrency(amt + tax);
    });
    document.getElementById('isTax').addEventListener('input', () => {
      const amt = Number(document.getElementById('isAmount').value) || 0;
      const tax = Number(document.getElementById('isTax').value) || 0;
      document.getElementById('isTotal').value = Utils.formatCurrency(amt + tax);
    });
  },

  async _saveIssuedSingle() {
    const date = document.getElementById('isDate').value;
    const name = document.getElementById('isPartnerName').value.trim();
    const amount = Number(document.getElementById('isAmount').value) || 0;

    if (!date || !name || amount === 0) {
      Utils.showToast('발급일자, 거래처, 공급가액을 입력하세요.', 'error');
      return;
    }

    const tax = Number(document.getElementById('isTax').value) || Math.round(amount * 0.1);
    const user = Auth.currentUser();
    const reqNum = await DB.generateRequestNumber();

    await DB.add('taxInvoiceRequests', {
      requestNumber: reqNum,
      requesterId: user.id,
      requesterName: user.displayName,
      status: '발행완료',
      reason: '기발행 세금계산서 등록',
      amount: amount,
      taxAmount: tax,
      totalAmount: amount + tax,
      partnerCompanyName: name,
      partnerRegNumber: document.getElementById('isPartnerReg').value.trim(),
      partnerRepName: '',
      partnerEmail: document.getElementById('isPartnerEmail').value.trim(),
      partnerAddress: '',
      partnerBusinessType: '',
      partnerBusinessItem: '',
      attachments: [],
      projectName: '',
      memo: document.getElementById('isMemo').value.trim(),
      reviewerId: user.id,
      reviewerName: user.displayName,
      reviewedAt: new Date().toISOString(),
      issueDate: date,
      rejectReason: null,
      matchedDepositId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await DB.log('CREATE', 'taxInvoice', null, `기발행 세금계산서 개별 등록: ${name}`);
    Utils.closeModal();
    Utils.showToast('기발행 세금계산서가 등록되었습니다.', 'success');
    await this.render();
  },

  destroy() {}
};


window.MatchingModule = MatchingModule;
