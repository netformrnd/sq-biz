/* ============================================
   대시보드 모듈
   ============================================ */

const DashboardModule = {
  container: null,

  async init(container) {
    this.container = container;
    await this.render();
  },

  async render() {
    const user = Auth.currentUser();
    const isAdmin = user.role === 'admin';

    // 데이터 수집
    const invoices = await DB.getAll('taxInvoiceRequests');
    const deposits = await DB.getAll('deposits');
    const transfers = await DB.getAll('transferRecords');

    const pending = invoices.filter(i => i.status === '요청').length;
    const reviewing = invoices.filter(i => i.status === '검토중').length;
    const completed = invoices.filter(i => i.status === '발행완료').length;
    const totalInvoiceAmount = invoices.filter(i => i.status === '발행완료').reduce((s, i) => s + (i.totalAmount || 0), 0);

    const totalDepositAmount = deposits.reduce((s, d) => s + (d.amount || 0), 0);
    const matchedDeposits = deposits.filter(d => d.matchStatus === '매칭완료').length;
    const unmatchedDeposits = deposits.filter(d => d.matchStatus !== '매칭완료').length;

    // ── 관리자 "할 일 / 확인할 것" 계산 ──
    const depositMap = {};
    deposits.forEach(d => { depositMap[String(d.id)] = d; });
    const _invMatched = (inv) => {
      const ids = Array.isArray(inv.matchedDepositIds) && inv.matchedDepositIds.length ? inv.matchedDepositIds.map(String) : (inv.matchedDepositId ? [String(inv.matchedDepositId)] : []);
      const alloc = inv.matchedAllocations || {};
      let amt = 0;
      ids.forEach(id => { if (alloc[id] != null) amt += Number(alloc[id]) || 0; else { const dd = depositMap[id]; if (dd) amt += dd.amount || 0; } });
      return amt;
    };
    const unpaidInvs = invoices.filter(i => i.status === '발행완료' && (i.totalAmount || 0) - _invMatched(i) >= 10);
    const unpaidAmt = unpaidInvs.reduce((s, i) => s + ((i.totalAmount || 0) - _invMatched(i)), 0);
    const needInvoiceDeps = deposits.filter(d => d.matchStatus !== '매칭완료' && !((d.actionRequired || '').startsWith('처리완료')));
    const needInvoiceAmt = needInvoiceDeps.reduce((s, d) => s + (d.amount || 0), 0);
    const reissueCount = invoices.filter(i => i.needsReissue).length;
    let leavePending = 0;
    try { const _lv = await DB.getAll('leaveRequests'); leavePending = _lv.filter(r => r.status === 'pending' || r.status === 'cancel-requested').length; } catch (e) { /* 무시 */ }

    let html = '';

    if (isAdmin) {
      // 관리자 "할 일 / 확인할 것" — 건수 있는 것만, 클릭하면 해당 화면(필터 적용)으로 이동
      const todos = [];
      if (pending + reviewing > 0) todos.push({ icon: '📝', cls: 'blue', label: '세금계산서 요청 처리', val: `${pending + reviewing}건`, sub: `요청 ${pending} · 검토중 ${reviewing}`, onclick: `TaxInvoiceAdminModule.filterStatus='all';Router.navigate('/tax-invoice/admin')` });
      if (needInvoiceDeps.length > 0) todos.push({ icon: '💰', cls: 'orange', label: '입금됐는데 발행 안 됨', val: `${needInvoiceDeps.length}건`, sub: Utils.formatCurrency(needInvoiceAmt), onclick: `FinanceMatchingModule.depositFilter='unmatched';Router.navigate('/finance')` });
      if (unpaidInvs.length > 0) todos.push({ icon: '🧾', cls: 'orange', label: '발행했는데 미입금(미수)', val: `${unpaidInvs.length}건`, sub: Utils.formatCurrency(unpaidAmt), onclick: `TaxInvoiceAdminModule.filterStatus='all';TaxInvoiceAdminModule.filterUnpaid=true;Router.navigate('/tax-invoice/admin')` });
      if (reissueCount > 0) todos.push({ icon: '🔧', cls: 'orange', label: '수정발행 필요', val: `${reissueCount}건`, sub: '발행 후 수정됨', onclick: `TaxInvoiceAdminModule.filterStatus='발행완료';Router.navigate('/tax-invoice/admin')` });
      if (leavePending > 0) todos.push({ icon: '🌴', cls: 'cyan', label: '연차 승인대기', val: `${leavePending}건`, sub: '', onclick: `Router.navigate('/leave')` });

      const todoHtml = `
        <div class="card mb-4" style="border-left:4px solid var(--color-primary);">
          <div class="card-header"><h3>📌 할 일 / 확인할 것</h3></div>
          <div class="card-body">
            ${todos.length === 0
              ? '<div class="text-muted" style="padding:var(--sp-2);">✅ 지금 바로 처리할 일이 없어요.</div>'
              : `<div class="summary-cards">
                  ${todos.map(t => `
                    <div class="summary-card" style="cursor:pointer;" onclick="${t.onclick}" title="${Utils.escapeHtml(t.label)}">
                      <div class="card-icon ${t.cls}">${t.icon}</div>
                      <div class="card-info">
                        <div class="card-label">${t.label}</div>
                        <div class="card-value">${t.val}</div>
                        ${t.sub ? `<div class="card-sub">${t.sub}</div>` : ''}
                      </div>
                    </div>`).join('')}
                </div>`}
          </div>
        </div>`;

      // 관리자 대시보드
      html = todoHtml + `
        <div class="summary-cards">
          <div class="summary-card" style="cursor:pointer;" onclick="Router.navigate('/tax-invoice/admin')" title="요청 관리로 이동">
            <div class="card-icon blue">📝</div>
            <div class="card-info">
              <div class="card-label">발행 대기</div>
              <div class="card-value">${pending}건</div>
              <div class="card-sub">검토중 ${reviewing}건</div>
            </div>
          </div>
          <div class="summary-card" style="cursor:pointer;" onclick="Router.navigate('/tax-invoice/admin')" title="요청 관리로 이동">
            <div class="card-icon green">✅</div>
            <div class="card-info">
              <div class="card-label">발행 완료</div>
              <div class="card-value">${completed}건</div>
              <div class="card-sub">${Utils.formatCurrency(totalInvoiceAmount)}</div>
            </div>
          </div>
          <div class="summary-card" style="cursor:pointer;" onclick="Router.navigate('/deposits')" title="입금내역으로 이동">
            <div class="card-icon cyan">💰</div>
            <div class="card-info">
              <div class="card-label">입금 내역</div>
              <div class="card-value">${deposits.length}건</div>
              <div class="card-sub">${Utils.formatCurrency(totalDepositAmount)}</div>
            </div>
          </div>
          <div class="summary-card" style="cursor:pointer;" onclick="Router.navigate('/matching')" title="매칭 관리로 이동">
            <div class="card-icon orange">🔗</div>
            <div class="card-info">
              <div class="card-label">매칭 현황</div>
              <div class="card-value">${matchedDeposits}/${deposits.length}</div>
              <div class="card-sub">미매칭 ${unmatchedDeposits}건</div>
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-4);">
          <!-- 최근 발행 요청 -->
          <div class="card">
            <div class="card-header">
              <h3>최근 발행 요청</h3>
              <button class="btn btn-ghost btn-sm" onclick="Router.navigate('/tax-invoice/admin')">전체보기 →</button>
            </div>
            <div class="card-body" style="padding:0;">
              ${this._renderRecentInvoices(invoices.slice(-5).reverse())}
            </div>
          </div>

          <!-- 최근 입금 내역 -->
          <div class="card">
            <div class="card-header">
              <h3>최근 입금내역</h3>
              <button class="btn btn-ghost btn-sm" onclick="Router.navigate('/deposits')">전체보기 →</button>
            </div>
            <div class="card-body" style="padding:0;">
              ${this._renderRecentDeposits(deposits.slice(-5).reverse())}
            </div>
          </div>
        </div>
      `;

    } else {
      // 직원 대시보드
      const myInvoices = invoices.filter(i => i.requesterId === user.id);
      const myPending = myInvoices.filter(i => i.status === '요청' || i.status === '검토중').length;
      const myCompleted = myInvoices.filter(i => i.status === '발행완료').length;
      const myTransfers = transfers.filter(t => t.assignedToUserId === user.id);

      html = `
        <div class="summary-cards">
          <div class="summary-card" style="cursor:pointer;" onclick="Router.navigate('/tax-invoice/my')" title="나의 요청현황으로 이동">
            <div class="card-icon blue">📝</div>
            <div class="card-info">
              <div class="card-label">나의 요청</div>
              <div class="card-value">${myInvoices.length}건</div>
              <div class="card-sub">진행중 ${myPending}건</div>
            </div>
          </div>
          <div class="summary-card" style="cursor:pointer;" onclick="Router.navigate('/tax-invoice/my')" title="나의 요청현황으로 이동">
            <div class="card-icon green">✅</div>
            <div class="card-info">
              <div class="card-label">발행 완료</div>
              <div class="card-value">${myCompleted}건</div>
            </div>
          </div>
          <div class="summary-card" style="cursor:pointer;" onclick="Router.navigate('/deposits')" title="입금내역으로 이동">
            <div class="card-icon cyan">💰</div>
            <div class="card-info">
              <div class="card-label">총 입금내역</div>
              <div class="card-value">${deposits.length}건</div>
              <div class="card-sub">${Utils.formatCurrency(totalDepositAmount)}</div>
            </div>
          </div>
          <div class="summary-card" style="cursor:pointer;" onclick="Router.navigate(Auth.isAdmin() ? '/transfers/admin' : '/transfers/my')" title="송금내역으로 이동">
            <div class="card-icon orange">💸</div>
            <div class="card-info">
              <div class="card-label">나의 송금내역</div>
              <div class="card-value">${myTransfers.length}건</div>
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-4);">
          <div class="card">
            <div class="card-header">
              <h3>나의 최근 요청</h3>
              <button class="btn btn-ghost btn-sm" onclick="Router.navigate('/tax-invoice/my')">전체보기 →</button>
            </div>
            <div class="card-body" style="padding:0;">
              ${this._renderRecentInvoices(myInvoices.slice(-5).reverse())}
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <h3>나의 최근 송금내역</h3>
              <button class="btn btn-ghost btn-sm" onclick="Router.navigate('/transfers/my')">전체보기 →</button>
            </div>
            <div class="card-body" style="padding:0;">
              ${this._renderRecentTransfers(myTransfers.slice(-5).reverse())}
            </div>
          </div>
        </div>
      `;
    }

    this.container.innerHTML = html;
  },

  _renderRecentInvoices(items) {
    if (items.length === 0) {
      return '<div class="empty-state" style="padding:var(--sp-6);"><p>최근 요청이 없습니다</p></div>';
    }
    let rows = items.map(i => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--color-border);">
        <div>
          <div class="text-sm fw-medium">${Utils.escapeHtml(i.partnerCompanyName || i.reason || '-')}</div>
          <div class="text-xs text-muted">${Utils.formatDate(i.createdAt)} · ${Utils.escapeHtml(i.requesterName || '')}</div>
        </div>
        <div style="text-align:right;">
          <div class="text-sm fw-semibold">${Utils.formatCurrency(i.totalAmount)}</div>
          ${Utils.statusBadge(i.status)}
        </div>
      </div>
    `).join('');
    return rows;
  },

  _renderRecentDeposits(items) {
    if (items.length === 0) {
      return '<div class="empty-state" style="padding:var(--sp-6);"><p>최근 입금내역이 없습니다</p></div>';
    }
    return items.map(d => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--color-border);">
        <div>
          <div class="text-sm fw-medium">${Utils.escapeHtml(d.depositorName || '-')}</div>
          <div class="text-xs text-muted">${Utils.formatDate(d.depositDate)} · ${Utils.escapeHtml(d.projectName || '')}</div>
        </div>
        <div style="text-align:right;">
          <div class="text-sm fw-semibold">${Utils.formatCurrency(d.amount)}</div>
          ${Utils.statusBadge(d.matchStatus || '미매칭')}
        </div>
      </div>
    `).join('');
  },

  _renderRecentTransfers(items) {
    if (items.length === 0) {
      return '<div class="empty-state" style="padding:var(--sp-6);"><p>최근 송금내역이 없습니다</p></div>';
    }
    return items.map(t => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--color-border);">
        <div>
          <div class="text-sm fw-medium">${Utils.escapeHtml(t.recipientName || '-')}</div>
          <div class="text-xs text-muted">${Utils.formatDate(t.transferDate)} · ${Utils.escapeHtml(t.purpose || '')}</div>
        </div>
        <div class="text-sm fw-semibold">${Utils.formatCurrency(t.amount)}</div>
      </div>
    `).join('');
  },

  destroy() {}
};

window.DashboardModule = DashboardModule;
