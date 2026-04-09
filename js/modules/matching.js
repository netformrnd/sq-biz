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
                     onclick="MatchingModule._selectInvoice(${inv.id})">
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
                     onclick="MatchingModule._selectDeposit(${dep.id})">
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

  destroy() {}
};

window.MatchingModule = MatchingModule;
