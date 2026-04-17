/* ============================================
   재무 통합 매칭 모듈
   - 좌: 입금내역 / 우: 발행 세금계산서
   - 양방향 매칭/해제
   - 미매칭 상태 명확히 구분
   ============================================ */

const FinanceMatchingModule = {
  container: null,
  selectedDepositId: null,
  selectedInvoiceId: null,
  depositFilter: 'all', // all | matched | unmatched
  invoiceFilter: 'all',
  depositSearch: '',
  invoiceSearch: '',

  async init(container) {
    this.container = container;
    this.selectedDepositId = null;
    this.selectedInvoiceId = null;
    await this.render();
  },

  async render() {
    const isAdmin = Auth.isAdmin();
    const allDeposits = await DB.getAll('deposits');
    const allInvoices = (await DB.getAll('taxInvoiceRequests')).filter(i => i.status === '발행완료');

    // 입금일자 오름차순
    const depositsAsc = [...allDeposits].sort((a, b) => {
      return (a.depositDate || '').localeCompare(b.depositDate || '');
    });
    // 발행일자 오름차순
    const invoicesAsc = [...allInvoices].sort((a, b) => {
      const aD = a.issueDate || a.createdAt || '';
      const bD = b.issueDate || b.createdAt || '';
      return aD.localeCompare(bD);
    });

    // 필터
    const filterDeposits = depositsAsc.filter(d => {
      const matched = d.matchStatus === '매칭완료';
      if (this.depositFilter === 'matched' && !matched) return false;
      if (this.depositFilter === 'unmatched' && matched) return false;
      if (this.depositSearch) {
        const q = this.depositSearch.toLowerCase();
        if (!(d.depositorName || '').toLowerCase().includes(q) &&
            !String(d.amount).includes(q) &&
            !(d.projectName || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const filterInvoices = invoicesAsc.filter(i => {
      const matched = !!i.matchedDepositId;
      if (this.invoiceFilter === 'matched' && !matched) return false;
      if (this.invoiceFilter === 'unmatched' && matched) return false;
      if (this.invoiceSearch) {
        const q = this.invoiceSearch.toLowerCase();
        if (!(i.partnerCompanyName || '').toLowerCase().includes(q) &&
            !(i.requestNumber || '').toLowerCase().includes(q) &&
            !String(i.totalAmount).includes(q)) return false;
      }
      return true;
    });

    // 요약 통계
    const matchedDeposits = allDeposits.filter(d => d.matchStatus === '매칭완료').length;
    const unmatchedDeposits = allDeposits.length - matchedDeposits;
    const matchedInvoices = allInvoices.filter(i => !!i.matchedDepositId).length;
    const unmatchedInvoices = allInvoices.length - matchedInvoices;

    const unmatchedDepositAmount = allDeposits.filter(d => d.matchStatus !== '매칭완료').reduce((s, d) => s + (d.amount || 0), 0);
    const unmatchedInvoiceAmount = allInvoices.filter(i => !i.matchedDepositId).reduce((s, i) => s + (i.totalAmount || 0), 0);

    this.container.innerHTML = `
      <div class="page-header">
        <h2>💰 재무 (입금내역 · 매칭관리)</h2>
        ${isAdmin ? `
          <div class="page-actions">
            <button class="btn btn-primary" onclick="FinanceMatchingModule._openBankStatementModal()">📊 통장내역 일괄 업로드</button>
          </div>
        ` : ''}
      </div>

      <!-- 요약 -->
      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon cyan">💰</div>
          <div class="card-info">
            <div class="card-label">총 입금</div>
            <div class="card-value">${allDeposits.length}건</div>
            <div class="card-sub">매칭 ${matchedDeposits} · 미매칭 ${unmatchedDeposits}</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon blue">📝</div>
          <div class="card-info">
            <div class="card-label">총 발행</div>
            <div class="card-value">${allInvoices.length}건</div>
            <div class="card-sub">매칭 ${matchedInvoices} · 미매칭 ${unmatchedInvoices}</div>
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid var(--color-warning);">
          <div class="card-icon orange">⚠️</div>
          <div class="card-info">
            <div class="card-label">미매칭 입금 <span class="text-xs text-muted">(세금계산서 미발행 가능성)</span></div>
            <div class="card-value">${unmatchedDeposits}건</div>
            <div class="card-sub">${Utils.formatCurrency(unmatchedDepositAmount)}</div>
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid var(--color-danger);">
          <div class="card-icon red">⚠️</div>
          <div class="card-info">
            <div class="card-label">미매칭 발행 <span class="text-xs text-muted">(입금 대기)</span></div>
            <div class="card-value">${unmatchedInvoices}건</div>
            <div class="card-sub">${Utils.formatCurrency(unmatchedInvoiceAmount)}</div>
          </div>
        </div>
      </div>

      <!-- 좌우 패널 -->
      <div class="matching-container" style="grid-template-columns: 1fr 60px 1fr;">
        <!-- 좌: 입금내역 -->
        <div class="matching-panel">
          <div class="panel-header" style="background:var(--color-info-light);">
            💰 입금내역 (${filterDeposits.length}건 / 입금일 ↑)
          </div>
          <div style="padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--color-border);">
            <div class="d-flex gap-1 mb-2" style="flex-wrap:wrap;">
              <button class="btn btn-sm ${this.depositFilter === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="FinanceMatchingModule._setDepositFilter('all')">전체</button>
              <button class="btn btn-sm ${this.depositFilter === 'matched' ? 'btn-success' : 'btn-secondary'}" onclick="FinanceMatchingModule._setDepositFilter('matched')">✅ 매칭</button>
              <button class="btn btn-sm ${this.depositFilter === 'unmatched' ? 'btn-warning' : 'btn-secondary'}" onclick="FinanceMatchingModule._setDepositFilter('unmatched')">⚠️ 미매칭</button>
            </div>
            <input type="text" id="depositSearchInput" class="form-control" placeholder="입금자 검색..." value="${Utils.escapeHtml(this.depositSearch)}" style="font-size:var(--font-size-xs);">
          </div>
          <div class="panel-body" style="max-height:600px;">
            ${filterDeposits.length === 0 ?
              '<div class="empty-state" style="padding:var(--sp-6);"><p>해당 내역이 없습니다</p></div>' :
              filterDeposits.map(d => {
                const matched = d.matchStatus === '매칭완료';
                return `
                  <div class="matching-item ${this.selectedDepositId === d.id ? 'selected' : ''}"
                       style="${matched ? 'background:var(--color-success-light);border-left:3px solid var(--color-success);' : ''}"
                       onclick="FinanceMatchingModule._selectDeposit('${d.id}')">
                    <div class="item-info" style="width:100%;">
                      <div class="d-flex justify-between items-center mb-2">
                        <span class="fw-medium">${Utils.escapeHtml(d.depositorName || '-')}</span>
                        ${matched ? '<span class="badge badge-matched" style="font-size:10px;">매칭완료</span>' : '<span class="badge badge-unmatched" style="font-size:10px;">미매칭</span>'}
                      </div>
                      <div class="text-xs text-muted">${Utils.formatDate(d.depositDate)}</div>
                      <div class="item-amount mt-2" style="color:var(--color-info);">${Utils.formatCurrency(d.amount)}</div>
                      ${matched ? `<button class="btn btn-ghost btn-sm text-danger mt-2" style="font-size:10px;padding:2px 8px;" onclick="event.stopPropagation(); FinanceMatchingModule._unmatch('${d.id}')">🔗 매칭 해제</button>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
          </div>
        </div>

        <!-- 중앙 매칭 버튼 -->
        <div class="matching-actions">
          <button class="btn btn-primary btn-lg" id="matchBtn"
                  onclick="FinanceMatchingModule._performMatch()"
                  ${(!this.selectedDepositId || !this.selectedInvoiceId) ? 'disabled' : ''}
                  style="padding:var(--sp-3) var(--sp-2);writing-mode:vertical-lr;">
            🔗 매칭
          </button>
          <button class="btn btn-ghost btn-sm mt-4" onclick="FinanceMatchingModule._autoSuggest()" style="writing-mode:vertical-lr;padding:var(--sp-2);">자동</button>
        </div>

        <!-- 우: 세금계산서 -->
        <div class="matching-panel">
          <div class="panel-header" style="background:var(--color-primary-light);">
            📝 발행 세금계산서 (${filterInvoices.length}건 / 발행일 ↑)
          </div>
          <div style="padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--color-border);">
            <div class="d-flex gap-1 mb-2" style="flex-wrap:wrap;">
              <button class="btn btn-sm ${this.invoiceFilter === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="FinanceMatchingModule._setInvoiceFilter('all')">전체</button>
              <button class="btn btn-sm ${this.invoiceFilter === 'matched' ? 'btn-success' : 'btn-secondary'}" onclick="FinanceMatchingModule._setInvoiceFilter('matched')">✅ 매칭</button>
              <button class="btn btn-sm ${this.invoiceFilter === 'unmatched' ? 'btn-danger' : 'btn-secondary'}" onclick="FinanceMatchingModule._setInvoiceFilter('unmatched')">⚠️ 미매칭</button>
            </div>
            <input type="text" id="invoiceSearchInput" class="form-control" placeholder="거래처 검색..." value="${Utils.escapeHtml(this.invoiceSearch)}" style="font-size:var(--font-size-xs);">
          </div>
          <div class="panel-body" style="max-height:600px;">
            ${filterInvoices.length === 0 ?
              '<div class="empty-state" style="padding:var(--sp-6);"><p>해당 내역이 없습니다</p></div>' :
              filterInvoices.map(i => {
                const matched = !!i.matchedDepositId;
                return `
                  <div class="matching-item ${this.selectedInvoiceId === i.id ? 'selected' : ''}"
                       style="${matched ? 'background:var(--color-success-light);border-left:3px solid var(--color-success);' : ''}"
                       onclick="FinanceMatchingModule._selectInvoice('${i.id}')">
                    <div class="item-info" style="width:100%;">
                      <div class="d-flex justify-between items-center mb-2">
                        <span class="fw-medium">${Utils.escapeHtml(i.partnerCompanyName || '-')}</span>
                        ${matched ? '<span class="badge badge-matched" style="font-size:10px;">매칭완료</span>' : '<span class="badge badge-reject" style="font-size:10px;">미매칭</span>'}
                      </div>
                      <div class="text-xs text-muted">${Utils.escapeHtml(i.requestNumber)} · ${Utils.formatDate(i.issueDate || i.createdAt)}</div>
                      <div class="item-amount mt-2" style="color:var(--color-primary);">${Utils.formatCurrency(i.totalAmount)}</div>
                      ${matched ? `<button class="btn btn-ghost btn-sm text-danger mt-2" style="font-size:10px;padding:2px 8px;" onclick="event.stopPropagation(); FinanceMatchingModule._unmatchByInvoice('${i.id}')">🔗 매칭 해제</button>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
          </div>
        </div>
      </div>

      <!-- 입금내역 등록 버튼 -->
      ${isAdmin ? `
        <div class="d-flex gap-2 mt-4 justify-end">
          <button class="btn btn-secondary" onclick="DepositModule._openPasteModal ? DepositModule._openPasteModal() : Utils.showToast('입금내역 메뉴에서 사용하세요', 'warning')">📋 입금내역 엑셀 붙여넣기</button>
          <button class="btn btn-primary" onclick="DepositModule._openAddModal ? DepositModule._openAddModal() : Utils.showToast('입금내역 메뉴에서 사용하세요', 'warning')">+ 입금내역 개별 등록</button>
        </div>
      ` : ''}
    `;

    // 검색 이벤트
    const ds = document.getElementById('depositSearchInput');
    if (ds) ds.addEventListener('input', Utils.debounce((e) => { this.depositSearch = e.target.value; this.render(); }, 300));
    const is_ = document.getElementById('invoiceSearchInput');
    if (is_) is_.addEventListener('input', Utils.debounce((e) => { this.invoiceSearch = e.target.value; this.render(); }, 300));
  },

  _setDepositFilter(f) { this.depositFilter = f; this.render(); },
  _setInvoiceFilter(f) { this.invoiceFilter = f; this.render(); },

  _selectDeposit(id) { this.selectedDepositId = id; this.render(); },
  _selectInvoice(id) { this.selectedInvoiceId = id; this.render(); },

  async _performMatch() {
    if (!this.selectedDepositId || !this.selectedInvoiceId) return;
    const deposit = await DB.get('deposits', this.selectedDepositId);
    const invoice = await DB.get('taxInvoiceRequests', this.selectedInvoiceId);
    if (!deposit || !invoice) return;

    const confirmed = await Utils.confirm(
      `입금 [${deposit.depositorName}] ${Utils.formatCurrency(deposit.amount)}\n세금계산서 [${invoice.requestNumber} · ${invoice.partnerCompanyName}] ${Utils.formatCurrency(invoice.totalAmount)}\n\n매칭하시겠습니까?`,
      '매칭 확인'
    );
    if (!confirmed) return;

    const user = Auth.currentUser();
    invoice.matchedDepositId = deposit.id;
    invoice.updatedAt = new Date().toISOString();
    await DB.update('taxInvoiceRequests', invoice);

    deposit.matchedInvoiceId = invoice.id;
    deposit.matchStatus = '매칭완료';
    deposit.updatedAt = new Date().toISOString();
    await DB.update('deposits', deposit);

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
    this.selectedDepositId = null;
    this.selectedInvoiceId = null;
    Utils.showToast('매칭 완료', 'success');
    await this.render();
  },

  async _unmatch(depositId) {
    const deposit = await DB.get('deposits', depositId);
    if (!deposit) return;
    const confirmed = await Utils.confirm('이 매칭을 해제하시겠습니까?', '매칭 해제');
    if (!confirmed) return;

    const invoiceId = deposit.matchedInvoiceId;
    if (invoiceId) {
      const invoice = await DB.get('taxInvoiceRequests', invoiceId);
      if (invoice) {
        invoice.matchedDepositId = null;
        invoice.updatedAt = new Date().toISOString();
        await DB.update('taxInvoiceRequests', invoice);
      }
    }
    deposit.matchStatus = '미매칭';
    deposit.matchedInvoiceId = null;
    deposit.updatedAt = new Date().toISOString();
    await DB.update('deposits', deposit);

    await DB.log('UPDATE', 'matching', null, `매칭 해제: ${deposit.depositorName}`);
    Utils.showToast('매칭이 해제되었습니다.', 'success');
    await this.render();
  },

  async _unmatchByInvoice(invoiceId) {
    const invoice = await DB.get('taxInvoiceRequests', invoiceId);
    if (!invoice || !invoice.matchedDepositId) return;
    await this._unmatch(invoice.matchedDepositId);
  },

  async _autoSuggest() {
    const deposits = (await DB.getAll('deposits')).filter(d => d.matchStatus !== '매칭완료');
    const invoices = (await DB.getAll('taxInvoiceRequests')).filter(i => i.status === '발행완료' && !i.matchedDepositId);

    let best = null, bestScore = 0;
    for (const inv of invoices) {
      for (const dep of deposits) {
        let score = 0;
        if (inv.totalAmount === dep.amount) score += 50;
        else if (Math.abs(inv.totalAmount - dep.amount) < inv.totalAmount * 0.01) score += 30;
        const invName = Utils.normalizeCompanyName(inv.partnerCompanyName);
        const depName = Utils.normalizeCompanyName(dep.depositorName);
        if (invName && depName) {
          if (invName === depName) score += 40;
          else if (invName.includes(depName) || depName.includes(invName)) score += 25;
        }
        if (score > bestScore) { bestScore = score; best = { inv, dep }; }
      }
    }

    if (best && bestScore >= 50) {
      this.selectedDepositId = best.dep.id;
      this.selectedInvoiceId = best.inv.id;
      await this.render();
      Utils.showToast(`자동 추천 (유사도 ${bestScore}점). 확인 후 매칭 버튼을 누르세요.`, 'success');
    } else {
      Utils.showToast('자동 추천할 항목이 없습니다.', 'warning');
    }
  },

  // ===== 통장내역 일괄 업로드 (입금/송금 자동 분리) =====
  _bankParsed: { deposits: [], withdrawals: [] },

  _openBankStatementModal() {
    this._bankParsed = { deposits: [], withdrawals: [] };
    Utils.openModal(`
      <div class="modal-header">
        <h3>📊 통장내역 일괄 업로드</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-4);font-size:var(--font-size-sm);">
          <strong>✨ 정확한 인식을 위해 헤더 행을 함께 복사해 주세요:</strong><br>
          <span class="text-muted">
            • <strong>위하고:</strong> <code>월/일 | 적요 | 입금액 | 출금액 | 잔액</code> 헤더 + 데이터 행<br>
            • <strong>은행:</strong> <code>거래일시 | 출금 | 입금 | 잔액 | 거래처명</code> 헤더 + 데이터 행<br>
            헤더를 포함하면 컬럼 순서가 달라도 자동 인식됩니다.
          </span>
        </div>

        <div class="form-group">
          <label>통장내역 붙여넣기 <span class="required">*</span></label>
          <textarea id="bankStatementArea" class="form-control" rows="8"
                    placeholder="통장내역 엑셀에서 복사한 데이터를 여기에 붙여넣기 (Ctrl+V)"
                    style="font-family:monospace;font-size:12px;"></textarea>
        </div>

        <div class="d-flex gap-2 mb-4">
          <button class="btn btn-secondary" onclick="FinanceMatchingModule._parseBankStatement()">🔍 데이터 분석</button>
          <div class="form-group d-flex items-center gap-2" style="margin:0;">
            <label class="text-sm" style="margin:0;white-space:nowrap;">송금 용도 기본값:</label>
            <select id="bankDefaultPurpose" class="form-control" style="width:140px;">
              <option value="용역비">용역비</option>
              <option value="외주비">외주비</option>
              <option value="매입비">매입비</option>
              <option value="기타">기타</option>
            </select>
          </div>
        </div>

        <div id="bankParseResult" class="hidden">
          <!-- 입금내역 -->
          <div class="card mb-4">
            <div class="card-header" style="background:var(--color-info-light);">
              <h3>💰 입금내역 <span id="bankDepositCount" class="text-sm text-muted"></span></h3>
              <div class="d-flex gap-2">
                <label class="text-sm d-flex items-center gap-1" style="margin:0;">
                  <input type="checkbox" id="bankDepositAll" checked onchange="FinanceMatchingModule._toggleAllDeposits(this.checked)"> 전체 선택
                </label>
              </div>
            </div>
            <div class="card-body" style="padding:0;max-height:250px;overflow-y:auto;">
              <table class="data-table" id="bankDepositTable">
                <thead>
                  <tr>
                    <th style="width:40px;"></th>
                    <th>날짜</th>
                    <th>입금자</th>
                    <th class="text-right">금액</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </div>

          <!-- 송금(출금) 내역 -->
          <div class="card mb-4">
            <div class="card-header" style="background:var(--color-warning-light);">
              <h3>💸 송금(출금)내역 <span id="bankWithdrawCount" class="text-sm text-muted"></span></h3>
              <div class="d-flex gap-2">
                <label class="text-sm d-flex items-center gap-1" style="margin:0;">
                  <input type="checkbox" id="bankWithdrawAll" checked onchange="FinanceMatchingModule._toggleAllWithdrawals(this.checked)"> 전체 선택
                </label>
              </div>
            </div>
            <div class="card-body" style="padding:0;max-height:250px;overflow-y:auto;">
              <table class="data-table" id="bankWithdrawTable">
                <thead>
                  <tr>
                    <th style="width:40px;"></th>
                    <th>날짜</th>
                    <th>수취인</th>
                    <th class="text-right">금액</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </div>

          <div id="bankSummary" class="text-sm text-muted"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="bankSaveBtn" onclick="FinanceMatchingModule._saveBankStatement()" disabled>선택 항목 등록</button>
      </div>
    `, { size: 'modal-xl' });
  },

  // 텍스트를 라인 → 탭/공백으로 분리
  _splitCols(line) {
    if (line.includes('\t')) return line.split('\t').map(c => c.trim());
    return line.split(/\s{2,}|\t/).map(c => c.trim()).filter(c => c);
  },

  _isNumber(s) {
    if (!s) return false;
    const n = Number(s.replace(/[,\s]/g, ''));
    return !isNaN(n) && s.replace(/[,\s\d]/g, '') === '';
  },

  // 헤더 행에서 컬럼 매핑 추출
  // 예: ["월/일", "적요", "입금액", "출금액", "잔액"] → {dateIdx:0, nameIdx:1, depositIdx:2, withdrawIdx:3}
  _parseHeader(cols) {
    const mapping = { dateIdx: -1, nameIdx: -1, depositIdx: -1, withdrawIdx: -1 };

    for (let i = 0; i < cols.length; i++) {
      const c = (cols[i] || '').trim();
      if (!c) continue;
      // 날짜 컬럼
      if (/날짜|월\/일|월일|거래일자|거래일시/.test(c) && mapping.dateIdx < 0) {
        mapping.dateIdx = i; continue;
      }
      // 이름 컬럼
      if (/적요|거래내용|거래처|수취인|입금자|내용/.test(c) && mapping.nameIdx < 0) {
        mapping.nameIdx = i; continue;
      }
      // 입금액
      if (/^입금/.test(c) && mapping.depositIdx < 0) {
        mapping.depositIdx = i; continue;
      }
      // 출금액 (송금)
      if (/^출금|^송금/.test(c) && mapping.withdrawIdx < 0) {
        mapping.withdrawIdx = i; continue;
      }
    }

    // 필수 컬럼이 다 찾아졌는지 확인
    if (mapping.dateIdx >= 0 && mapping.depositIdx >= 0 && mapping.withdrawIdx >= 0) {
      return mapping;
    }
    return null;
  },

  // 헤더 없을 때 자동 감지 (폴백)
  _detectFormat(cols) {
    if (cols.length < 4) return null;

    const c1HasKorean = /[가-힣]/.test(cols[1] || '');
    const c1IsNumber = this._isNumber(cols[1] || '');

    if (c1HasKorean || (!c1IsNumber && (cols[1] || '').length > 0)) {
      // 위하고 형식 (cols[1]=이름, cols[2]=입금, cols[3]=출금)
      return { dateIdx: 0, nameIdx: 1, depositIdx: 2, withdrawIdx: 3, format: 'wehago' };
    }
    // 은행 형식 (cols[1]=출금, cols[2]=입금)
    return { dateIdx: 0, nameIdx: 4, withdrawIdx: 1, depositIdx: 2, format: 'bank' };
  },

  _parseBankStatement() {
    const raw = document.getElementById('bankStatementArea').value.trim();
    if (!raw) {
      Utils.showToast('데이터를 붙여넣기 하세요.', 'error');
      return;
    }

    const lines = raw.split('\n').filter(l => l.trim());
    this._bankParsed = { deposits: [], withdrawals: [] };

    // 1) 헤더 행 자동 감지 (첫 5줄 중 찾기)
    let mapping = null;
    let startLine = 0;
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const cols = this._splitCols(lines[i]);
      const m = this._parseHeader(cols);
      if (m) {
        mapping = m;
        startLine = i + 1;
        break;
      }
    }

    let detectedFormat = mapping ? '헤더 기반' : '자동 감지';

    // 2) 데이터 행 파싱
    for (let i = startLine; i < lines.length; i++) {
      const cols = this._splitCols(lines[i]);
      if (cols.length < 4) continue;

      // 매핑이 없으면 자동 감지
      let map = mapping;
      if (!map) {
        const fmt = this._detectFormat(cols);
        if (!fmt) continue;
        map = fmt;
        if (!detectedFormat || detectedFormat === '자동 감지') detectedFormat = fmt.format === 'wehago' ? '위하고' : '은행';
      }

      const dateStr = (cols[map.dateIdx] || '').trim();
      const dateMatch = dateStr.match(/(\d{2,4})[-.\/](\d{1,2})(?:[-.\/](\d{1,2}))?/);
      if (!dateMatch) continue;

      const withdrawStr = (cols[map.withdrawIdx] || '').trim();
      const depositStr = (cols[map.depositIdx] || '').trim();
      const withdrawAmount = Number(withdrawStr.replace(/[,\s]/g, '')) || 0;
      const depositAmount = Number(depositStr.replace(/[,\s]/g, '')) || 0;

      // 이름
      let name = (cols[map.nameIdx] || '').trim();
      let accountNo = '';

      // 은행 형식이면 cols[3+]부터 추가 탐색
      if (!name || /^\d+$/.test(name)) {
        for (let j = 3; j < cols.length; j++) {
          const val = (cols[j] || '').trim();
          if (!val) continue;
          if (/^\d{5,}$/.test(val.replace(/[-\s]/g, '')) && !accountNo) accountNo = val;
          if (/[가-힣]/.test(val) && !name) name = val;
        }
      }

      // 괄호 안 계좌번호 추출
      if (!accountNo && name) {
        const m = name.match(/\(([^)]+)\)/);
        if (m && /\d{4,}/.test(m[1])) accountNo = m[1].trim();
      }

      const displayName = accountNo && name && !name.includes(accountNo)
        ? `${name} (${accountNo})`
        : name || accountNo || '-';

      // 날짜
      let date = '';
      if (dateMatch[3]) {
        // YYYY-MM-DD 또는 YY-MM-DD
        let y = dateMatch[1];
        if (y.length === 2) y = '20' + y;
        date = `${y}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
      } else {
        // MM-DD (연도 없음) → 올해 연도
        const year = new Date().getFullYear();
        date = `${year}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
      }

      if (depositAmount > 0) {
        this._bankParsed.deposits.push({ date, name: displayName, amount: depositAmount, selected: true });
      } else if (withdrawAmount > 0) {
        this._bankParsed.withdrawals.push({ date, name: displayName, amount: withdrawAmount, selected: true });
      }
    }

    const { deposits, withdrawals } = this._bankParsed;
    if (deposits.length === 0 && withdrawals.length === 0) {
      Utils.showToast('인식 가능한 내역이 없습니다. 헤더(월/일, 적요, 입금액, 출금액)를 함께 복사해 보세요.', 'warning', 5000);
      return;
    }

    this._detectedFormat = detectedFormat;
    Utils.showToast(`[${detectedFormat}] 입금 ${deposits.length}건, 송금 ${withdrawals.length}건 인식`, 'success');
    this._renderBankParseResult();
  },

  _renderBankParseResult() {
    const { deposits, withdrawals } = this._bankParsed;
    document.getElementById('bankParseResult').classList.remove('hidden');
    document.getElementById('bankDepositCount').textContent = `(${deposits.length}건)`;
    document.getElementById('bankWithdrawCount').textContent = `(${withdrawals.length}건)`;

    const depTbody = document.querySelector('#bankDepositTable tbody');
    depTbody.innerHTML = deposits.length === 0
      ? '<tr><td colspan="4" class="text-center" style="padding:var(--sp-4);color:var(--color-text-muted);">입금 내역 없음</td></tr>'
      : deposits.map((r, i) => `
          <tr>
            <td><input type="checkbox" data-type="dep" data-idx="${i}" ${r.selected ? 'checked' : ''} onchange="FinanceMatchingModule._toggleBankRow('dep', ${i}, this.checked)"></td>
            <td>${Utils.escapeHtml(r.date)}</td>
            <td class="fw-medium">${Utils.escapeHtml(r.name)}</td>
            <td class="text-right amount">${Utils.formatCurrency(r.amount)}</td>
          </tr>
        `).join('');

    const wdTbody = document.querySelector('#bankWithdrawTable tbody');
    wdTbody.innerHTML = withdrawals.length === 0
      ? '<tr><td colspan="4" class="text-center" style="padding:var(--sp-4);color:var(--color-text-muted);">송금 내역 없음</td></tr>'
      : withdrawals.map((r, i) => `
          <tr>
            <td><input type="checkbox" data-type="wd" data-idx="${i}" ${r.selected ? 'checked' : ''} onchange="FinanceMatchingModule._toggleBankRow('wd', ${i}, this.checked)"></td>
            <td>${Utils.escapeHtml(r.date)}</td>
            <td class="fw-medium">${Utils.escapeHtml(r.name)}</td>
            <td class="text-right amount">${Utils.formatCurrency(r.amount)}</td>
          </tr>
        `).join('');

    this._updateBankSummary();
    document.getElementById('bankSaveBtn').disabled = false;
  },

  _toggleBankRow(type, idx, checked) {
    const arr = type === 'dep' ? this._bankParsed.deposits : this._bankParsed.withdrawals;
    arr[idx].selected = checked;
    this._updateBankSummary();
  },

  _toggleAllDeposits(checked) {
    this._bankParsed.deposits.forEach((r, i) => {
      r.selected = checked;
      const cb = document.querySelector(`#bankDepositTable input[data-idx="${i}"]`);
      if (cb) cb.checked = checked;
    });
    this._updateBankSummary();
  },

  _toggleAllWithdrawals(checked) {
    this._bankParsed.withdrawals.forEach((r, i) => {
      r.selected = checked;
      const cb = document.querySelector(`#bankWithdrawTable input[data-idx="${i}"]`);
      if (cb) cb.checked = checked;
    });
    this._updateBankSummary();
  },

  _updateBankSummary() {
    const depSel = this._bankParsed.deposits.filter(r => r.selected);
    const wdSel = this._bankParsed.withdrawals.filter(r => r.selected);
    const depAmt = depSel.reduce((s, r) => s + r.amount, 0);
    const wdAmt = wdSel.reduce((s, r) => s + r.amount, 0);
    document.getElementById('bankSummary').innerHTML = `
      ✅ 등록 예정: <strong>입금 ${depSel.length}건 (${Utils.formatCurrency(depAmt)})</strong>
      · <strong>송금 ${wdSel.length}건 (${Utils.formatCurrency(wdAmt)})</strong>
    `;
    document.getElementById('bankSaveBtn').disabled = depSel.length === 0 && wdSel.length === 0;
  },

  async _saveBankStatement() {
    const depSel = this._bankParsed.deposits.filter(r => r.selected);
    const wdSel = this._bankParsed.withdrawals.filter(r => r.selected);
    if (depSel.length === 0 && wdSel.length === 0) return;

    const user = Auth.currentUser();
    const purpose = document.getElementById('bankDefaultPurpose').value;
    let depCount = 0, wdCount = 0;

    for (const row of depSel) {
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
      depCount++;
    }

    for (const row of wdSel) {
      await DB.add('transferRecords', {
        transferDate: row.date,
        recipientName: row.name,
        amount: row.amount,
        purpose,
        projectName: '',
        memo: '',
        registeredBy: user.id,
        registeredByName: user.displayName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      wdCount++;
    }

    await DB.log('CREATE', 'bank', null, `통장내역 일괄 등록: 입금 ${depCount}건, 송금 ${wdCount}건`);
    this._bankParsed = { deposits: [], withdrawals: [] };

    Utils.closeModal();
    Utils.showToast(`입금 ${depCount}건, 송금 ${wdCount}건 등록 완료`, 'success');
    await this.render();
  },

  destroy() {}
};

window.FinanceMatchingModule = FinanceMatchingModule;
