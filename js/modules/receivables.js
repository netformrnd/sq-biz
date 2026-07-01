/* ============================================
   거래처별 대사 (외상매출금 원장)
   - 차변(발행) = 세금계산서 발행완료 합계 (거래처별)
   - 대변(입금) = 그 세금계산서에 매칭된 입금 + 미매칭 입금(입금처별)
   - 잔액 = 차변 - 대변  (양수=미수 / 음수=미발행·선수 / 0=완료)
   - 열 때마다 현재 데이터로 자동 계산 (위하고 자료 업데이트 시 함께 반영)
   ============================================ */

const ReceivablesModule = {
  container: null,
  searchText: '',
  filterMode: 'all',   // all | outstanding(미수) | prepaid(미발행·선수)
  sortField: null,
  sortDir: 'asc',

  async init(container) {
    this.container = container;
    this.searchText = '';
    await this.render();
  },

  _sort(field) {
    if (this.sortField === field) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortField = field; this.sortDir = 'asc'; }
    this.render();
  },
  _setFilter(m) { this.filterMode = m; this.render(); },

  _matchedIds(inv) {
    if (Array.isArray(inv.matchedDepositIds) && inv.matchedDepositIds.length) return inv.matchedDepositIds.map(String);
    if (inv.matchedDepositId) return [String(inv.matchedDepositId)];
    return [];
  },

  async render() {
    const invoices = (await DB.getAll('taxInvoiceRequests')).filter(i => i.status === '발행완료');
    const deposits = await DB.getAll('deposits');
    const depositMap = {};
    deposits.forEach(d => { depositMap[String(d.id)] = d; });

    // 거래처별 집계
    const map = {};
    const rowOf = (name) => {
      const k = (name || '').trim() || '(거래처 미상)';
      if (!map[k]) map[k] = { name: k, debit: 0, credit: 0 };
      return map[k];
    };
    const counted = new Set();

    // 1) 세금계산서(발행완료) → 차변 + 매칭된 입금(대변)
    for (const inv of invoices) {
      const r = rowOf(inv.partnerCompanyName);
      r.debit += Number(inv.totalAmount) || 0;
      for (const did of this._matchedIds(inv)) {
        const dep = depositMap[did];
        if (dep) { r.credit += Number(dep.amount) || 0; counted.add(did); }
      }
    }
    // 2) 미매칭 입금(세금계산서 안 붙음, 처리완료/현금영수증 제외) → 대변 (거래처=입금처)
    for (const dep of deposits) {
      if (counted.has(String(dep.id))) continue;
      if (dep.matchStatus === '매칭완료') continue;
      if ((dep.actionRequired || '').startsWith('처리완료')) continue;
      const r = rowOf(dep.depositorName);
      r.credit += Number(dep.amount) || 0;
    }

    let rows = Object.values(map)
      .map(r => ({ ...r, balance: r.debit - r.credit }))
      .filter(r => r.debit !== 0 || r.credit !== 0);

    // 필터
    if (this.filterMode === 'outstanding') rows = rows.filter(r => r.balance > 0);
    else if (this.filterMode === 'prepaid') rows = rows.filter(r => r.balance < 0);
    // 검색
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q));
    }
    // 정렬 (미지정 시 잔액 큰 순)
    if (this.sortField) rows = Utils.Sort.apply(rows, this.sortField, this.sortDir);
    else rows = rows.slice().sort((a, b) => b.balance - a.balance);

    // 합계
    const totDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totCredit = rows.reduce((s, r) => s + r.credit, 0);
    const totBal = totDebit - totCredit;
    const outstanding = rows.filter(r => r.balance > 0).reduce((s, r) => s + r.balance, 0);
    const prepaid = rows.filter(r => r.balance < 0).reduce((s, r) => s + Math.abs(r.balance), 0);

    const statusBadge = (b) => {
      if (b > 0) return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(245,158,11,.18);color:#b45309;">미수</span>`;
      if (b < 0) return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(37,99,235,.15);color:#2563eb;">미발행/선수</span>`;
      return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(16,185,129,.15);color:#059669;">완료</span>`;
    };

    const tableRows = rows.length === 0
      ? `<tr><td colspan="5" class="text-center" style="padding:var(--sp-10);"><div class="empty-state"><div class="empty-icon">📒</div><h3>해당 내역이 없습니다</h3></div></td></tr>`
      : rows.map(r => `
        <tr>
          <td class="fw-medium">${Utils.escapeHtml(r.name)}</td>
          <td class="text-right">${Utils.formatCurrency(r.debit)}</td>
          <td class="text-right">${Utils.formatCurrency(r.credit)}</td>
          <td class="text-right" style="font-weight:700;color:${r.balance > 0 ? '#b45309' : (r.balance < 0 ? '#2563eb' : '#059669')};">${Utils.formatCurrency(r.balance)}</td>
          <td class="text-center">${statusBadge(r.balance)}</td>
        </tr>
      `).join('');

    this.container.innerHTML = `
      <div class="page-header">
        <h2>📒 거래처별 대사</h2>
      </div>
      <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-3);font-size:var(--font-size-sm);">
        <strong>차변</strong>=세금계산서 발행 · <strong>대변</strong>=입금 · <strong>잔액</strong>=차변−대변
        <span class="text-muted"> (양수=미수 / 음수=미발행·선수). 세금계산서·입금·매칭 데이터로 자동 계산됩니다.</span>
      </div>

      <div class="summary-cards">
        <div class="summary-card" onclick="ReceivablesModule._setFilter('all')" style="cursor:pointer;${this.filterMode === 'all' ? 'outline:2px solid var(--color-primary);outline-offset:-1px;' : ''}">
          <div class="card-icon cyan">📒</div>
          <div class="card-info"><div class="card-label">거래처 수</div><div class="card-value">${rows.length}곳</div></div>
        </div>
        <div class="summary-card" style="border-left:4px solid var(--color-success);">
          <div class="card-icon green">🧾</div>
          <div class="card-info"><div class="card-label">발행 합계(차변)</div><div class="card-value">${Utils.formatCurrency(totDebit)}</div></div>
        </div>
        <div class="summary-card" onclick="ReceivablesModule._setFilter('outstanding')" title="미수만 보기" style="border-left:4px solid var(--color-warning);cursor:pointer;${this.filterMode === 'outstanding' ? 'outline:2px solid var(--color-warning);outline-offset:-1px;' : ''}">
          <div class="card-icon orange">⚠️</div>
          <div class="card-info"><div class="card-label">미수 합계 (못 받은 돈)</div><div class="card-value">${Utils.formatCurrency(outstanding)}</div></div>
        </div>
        <div class="summary-card" onclick="ReceivablesModule._setFilter('prepaid')" title="미발행/선수만 보기" style="border-left:4px solid var(--color-primary);cursor:pointer;${this.filterMode === 'prepaid' ? 'outline:2px solid var(--color-primary);outline-offset:-1px;' : ''}">
          <div class="card-icon blue">📥</div>
          <div class="card-info"><div class="card-label">미발행/선수 (입금만)</div><div class="card-value">${Utils.formatCurrency(prepaid)}</div></div>
        </div>
      </div>

      <div class="table-wrapper">
        <div class="table-toolbar" style="flex-wrap:wrap;gap:var(--sp-2);">
          <div class="toolbar-left d-flex gap-2" style="flex-wrap:wrap;align-items:center;">
            <div class="search-input">
              <span class="search-icon">🔍</span>
              <input type="text" class="form-control" id="arSearch" placeholder="거래처 검색..." value="${Utils.escapeHtml(this.searchText)}">
            </div>
            ${this.filterMode !== 'all' ? `<button class="btn btn-ghost btn-sm" onclick="ReceivablesModule._setFilter('all')">✕ 필터 해제</button>` : ''}
          </div>
          <div class="toolbar-right text-sm text-muted">총 ${rows.length}곳 · 잔액합계 ${Utils.formatCurrency(totBal)}</div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              ${Utils.Sort.th('거래처', 'name', this.sortField, this.sortDir, 'ReceivablesModule')}
              ${Utils.Sort.th('발행(차변)', 'debit', this.sortField, this.sortDir, 'ReceivablesModule', 'text-right')}
              ${Utils.Sort.th('입금(대변)', 'credit', this.sortField, this.sortDir, 'ReceivablesModule', 'text-right')}
              ${Utils.Sort.th('잔액', 'balance', this.sortField, this.sortDir, 'ReceivablesModule', 'text-right')}
              <th class="text-center">상태</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
          <tfoot>
            <tr style="font-weight:800;background:var(--color-surface-hover);border-top:2px solid var(--color-border);">
              <td>합계</td>
              <td class="text-right">${Utils.formatCurrency(totDebit)}</td>
              <td class="text-right">${Utils.formatCurrency(totCredit)}</td>
              <td class="text-right" style="color:${totBal > 0 ? '#b45309' : (totBal < 0 ? '#2563eb' : '#059669')};">${Utils.formatCurrency(totBal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;

    Utils.bindSearchInput(document.getElementById('arSearch'), (v) => { this.searchText = v; this.render(); });
  }
};

window.ReceivablesModule = ReceivablesModule;
