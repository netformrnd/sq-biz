/* ============================================
   전체 검색 (Ctrl+K)
   - 세금계산서, 입금내역, 송금내역, 문서, 사용자 통합 검색
   ============================================ */

const GlobalSearch = {
  _bound: false,

  init() {
    if (this._bound) return;
    this._bound = true;

    // Ctrl+K / Cmd+K 단축키
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.open();
      }
    });
  },

  async open() {
    Utils.openModal(`
      <div class="modal-header">
        <h3>🔍 전체 검색 <span class="text-xs text-muted">(Ctrl+K)</span></h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="padding:0;">
        <div style="padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--color-border);">
          <input type="text" id="globalSearchInput" class="form-control"
                 placeholder="거래처, 요청번호, 금액, 파일명 등 검색..."
                 style="font-size:var(--font-size-md);" autofocus>
        </div>
        <div id="globalSearchResults" style="max-height:500px;overflow-y:auto;padding:var(--sp-4);">
          <div class="text-sm text-muted text-center" style="padding:var(--sp-6);">검색어를 입력하세요</div>
        </div>
      </div>
    `, { size: 'modal-lg' });

    document.getElementById('globalSearchInput').addEventListener('input',
      Utils.debounce((e) => this._search(e.target.value), 200));
  },

  async _search(query) {
    const resultsEl = document.getElementById('globalSearchResults');
    if (!query || query.trim().length < 1) {
      resultsEl.innerHTML = '<div class="text-sm text-muted text-center" style="padding:var(--sp-6);">검색어를 입력하세요</div>';
      return;
    }

    const q = query.toLowerCase();
    const sections = [];
    const user = Auth.currentUser();
    const isAdmin = Auth.isAdmin();

    // 세금계산서 검색
    const invoices = await DB.getAll('taxInvoiceRequests');
    const matchedInvoices = invoices.filter(i =>
      (i.requestNumber || '').toLowerCase().includes(q) ||
      (i.partnerCompanyName || '').toLowerCase().includes(q) ||
      (i.partnerRegNumber || '').includes(q) ||
      (i.reason || '').toLowerCase().includes(q) ||
      (i.requesterName || '').toLowerCase().includes(q) ||
      String(i.totalAmount).includes(q)
    ).slice(0, 8);

    if (matchedInvoices.length > 0) {
      sections.push(`
        <div class="mb-4">
          <div class="text-xs text-muted fw-semibold mb-2">📝 세금계산서 요청 (${matchedInvoices.length})</div>
          ${matchedInvoices.map(i => `
            <div style="padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--color-border);cursor:pointer;"
                 onmouseover="this.style.background='var(--color-primary-50)'"
                 onmouseout="this.style.background=''"
                 onclick="Utils.closeModal(); Router.navigate('${isAdmin ? '/tax-invoice/admin' : '/tax-invoice/my'}')">
              <div class="d-flex justify-between">
                <span class="fw-medium">${Utils.escapeHtml(i.requestNumber)} · ${Utils.escapeHtml(i.partnerCompanyName || '-')}</span>
                <span>${Utils.formatCurrency(i.totalAmount)}</span>
              </div>
              <div class="text-xs text-muted">${Utils.statusBadge(i.status)} ${Utils.escapeHtml(i.requesterName || '')} · ${Utils.formatDate(i.createdAt)}</div>
            </div>
          `).join('')}
        </div>
      `);
    }

    // 입금내역 검색
    const deposits = await DB.getAll('deposits');
    const matchedDeposits = deposits.filter(d =>
      (d.depositorName || '').toLowerCase().includes(q) ||
      (d.projectName || '').toLowerCase().includes(q) ||
      (d.memo || '').toLowerCase().includes(q) ||
      String(d.amount).includes(q)
    ).slice(0, 8);

    if (matchedDeposits.length > 0) {
      sections.push(`
        <div class="mb-4">
          <div class="text-xs text-muted fw-semibold mb-2">💰 입금내역 (${matchedDeposits.length})</div>
          ${matchedDeposits.map(d => `
            <div style="padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--color-border);cursor:pointer;"
                 onmouseover="this.style.background='var(--color-primary-50)'"
                 onmouseout="this.style.background=''"
                 onclick="Utils.closeModal(); Router.navigate('/deposits')">
              <div class="d-flex justify-between">
                <span class="fw-medium">${Utils.escapeHtml(d.depositorName || '-')}</span>
                <span>${Utils.formatCurrency(d.amount)}</span>
              </div>
              <div class="text-xs text-muted">${Utils.formatDate(d.depositDate)} ${d.projectName ? '· ' + Utils.escapeHtml(d.projectName) : ''}</div>
            </div>
          `).join('')}
        </div>
      `);
    }

    // 송금내역 검색 (권한 있는 사용자만)
    if (isAdmin || (App._userPermissions || []).includes('transfers')) {
      const transfers = await DB.getAll('transferRecords');
      const matchedTransfers = transfers.filter(t =>
        (t.recipientName || '').toLowerCase().includes(q) ||
        (t.purpose || '').toLowerCase().includes(q) ||
        (t.projectName || '').toLowerCase().includes(q) ||
        String(t.amount).includes(q)
      ).slice(0, 8);

      if (matchedTransfers.length > 0) {
        sections.push(`
          <div class="mb-4">
            <div class="text-xs text-muted fw-semibold mb-2">💸 송금내역 (${matchedTransfers.length})</div>
            ${matchedTransfers.map(t => `
              <div style="padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--color-border);cursor:pointer;"
                   onmouseover="this.style.background='var(--color-primary-50)'"
                   onmouseout="this.style.background=''"
                   onclick="Utils.closeModal(); Router.navigate('/transfers/admin')">
                <div class="d-flex justify-between">
                  <span class="fw-medium">${Utils.escapeHtml(t.recipientName || '-')}</span>
                  <span>${Utils.formatCurrency(t.amount)}</span>
                </div>
                <div class="text-xs text-muted">${Utils.formatDate(t.transferDate)} ${t.purpose ? '· ' + Utils.escapeHtml(t.purpose) : ''}</div>
              </div>
            `).join('')}
          </div>
        `);
      }
    }

    // 문서보관 검색
    const docs = await DB.getAll('documents');
    const matchedDocs = docs.filter(d =>
      (d.companyName || '').toLowerCase().includes(q) ||
      (d.fileName || '').toLowerCase().includes(q) ||
      (d.regNumber || '').includes(q)
    ).slice(0, 8);

    if (matchedDocs.length > 0) {
      sections.push(`
        <div class="mb-4">
          <div class="text-xs text-muted fw-semibold mb-2">📁 문서보관 (${matchedDocs.length})</div>
          ${matchedDocs.map(d => `
            <div style="padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--color-border);cursor:pointer;"
                 onmouseover="this.style.background='var(--color-primary-50)'"
                 onmouseout="this.style.background=''"
                 onclick="Utils.closeModal(); Router.navigate('/documents')">
              <div class="fw-medium">${Utils.escapeHtml(d.companyName)} <span class="text-xs text-muted">· ${Utils.escapeHtml(d.fileName)}</span></div>
              <div class="text-xs text-muted">${Utils.escapeHtml(d.category)} · ${Utils.formatDate(d.createdAt)}</div>
            </div>
          `).join('')}
        </div>
      `);
    }

    if (sections.length === 0) {
      resultsEl.innerHTML = `<div class="text-center" style="padding:var(--sp-6);">
        <div style="font-size:32px;margin-bottom:var(--sp-2);">🔍</div>
        <div class="text-sm text-muted">"${Utils.escapeHtml(query)}"에 대한 검색 결과가 없습니다</div>
      </div>`;
    } else {
      resultsEl.innerHTML = sections.join('');
    }
  }
};

window.GlobalSearch = GlobalSearch;
