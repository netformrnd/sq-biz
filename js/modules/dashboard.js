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

    let html = '';

    if (isAdmin) {
      // 관리자 대시보드
      html = `
        <div class="summary-cards">
          <div class="summary-card">
            <div class="card-icon blue">📝</div>
            <div class="card-info">
              <div class="card-label">발행 대기</div>
              <div class="card-value">${pending}건</div>
              <div class="card-sub">검토중 ${reviewing}건</div>
            </div>
          </div>
          <div class="summary-card">
            <div class="card-icon green">✅</div>
            <div class="card-info">
              <div class="card-label">발행 완료</div>
              <div class="card-value">${completed}건</div>
              <div class="card-sub">${Utils.formatCurrency(totalInvoiceAmount)}</div>
            </div>
          </div>
          <div class="summary-card">
            <div class="card-icon cyan">💰</div>
            <div class="card-info">
              <div class="card-label">입금 내역</div>
              <div class="card-value">${deposits.length}건</div>
              <div class="card-sub">${Utils.formatCurrency(totalDepositAmount)}</div>
            </div>
          </div>
          <div class="summary-card">
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

      // 대기 중인 요청이 있으면 알림
      if (pending > 0) {
        html = `
          <div class="card mb-4" style="border-left:4px solid var(--color-warning);background:var(--color-warning-light);">
            <div class="card-body d-flex items-center justify-between">
              <div>
                <strong>⚠️ 처리 대기 중인 세금계산서 발행 요청이 ${pending}건 있습니다.</strong>
                <p class="text-sm text-muted mt-2">요청 관리에서 확인하고 처리해 주세요.</p>
              </div>
              <button class="btn btn-warning btn-sm" onclick="Router.navigate('/tax-invoice/admin')">요청 관리</button>
            </div>
          </div>
        ` + html;
      }
    } else {
      // 직원 대시보드
      const myInvoices = invoices.filter(i => i.requesterId === user.id);
      const myPending = myInvoices.filter(i => i.status === '요청' || i.status === '검토중').length;
      const myCompleted = myInvoices.filter(i => i.status === '발행완료').length;
      const myTransfers = transfers.filter(t => t.assignedToUserId === user.id);

      html = `
        <div class="summary-cards">
          <div class="summary-card">
            <div class="card-icon blue">📝</div>
            <div class="card-info">
              <div class="card-label">나의 요청</div>
              <div class="card-value">${myInvoices.length}건</div>
              <div class="card-sub">진행중 ${myPending}건</div>
            </div>
          </div>
          <div class="summary-card">
            <div class="card-icon green">✅</div>
            <div class="card-info">
              <div class="card-label">발행 완료</div>
              <div class="card-value">${myCompleted}건</div>
            </div>
          </div>
          <div class="summary-card">
            <div class="card-icon cyan">💰</div>
            <div class="card-info">
              <div class="card-label">총 입금내역</div>
              <div class="card-value">${deposits.length}건</div>
              <div class="card-sub">${Utils.formatCurrency(totalDepositAmount)}</div>
            </div>
          </div>
          <div class="summary-card">
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
