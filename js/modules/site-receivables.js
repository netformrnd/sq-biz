/* ============================================
   현장 미수 현황 (아파트 등 현장별 미수) — 담당자/타팀 공유용
   - 거래처별 대사(ReceivablesModule) 엔진을 그대로 재사용
       · 차변(발행) − 대변(입금) = 잔액(미수)  → 위하고 거래처원장과 동일
       · 세금계산서/입금만 있으면 자동 계산 (현장마다 계약 등록·연결 불필요)
   - "포함 키워드"에 해당하는 거래처(현장)만 보여줌
       · 예: 아파트, 입주자, 단지, 대표회의
       · 설계 프로젝트(대림 등)는 자동 제외 → 담당자는 아파트 현장만 봄
   - 포함 키워드는 관리자가 수정 가능 → 다른 팀도 자기 키워드로 재사용 가능
   ============================================ */

const SiteReceivablesModule = {
  container: null,
  searchText: '',
  filterMode: 'outstanding',   // outstanding(미수만) | all | prepaid(미발행·선수)
  sortField: null,
  sortDir: 'asc',
  _incKws: [],
  _incRaw: '',

  DEFAULT_INCLUDE: '아파트, 입주자, 단지, 대표회의',

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

  // 포함 키워드: appSettings/siteReceivablesInclude. 없으면 기본값.
  async _loadIncludeKw() {
    let raw = '';
    try {
      const doc = await DB.get('appSettings', 'siteReceivablesInclude');
      if (doc && typeof doc.keywords === 'string') raw = doc.keywords.trim();
    } catch (e) { /* 무시 */ }
    if (!raw) raw = this.DEFAULT_INCLUDE;
    this._incRaw = raw;
    this._incKws = raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    return this._incKws;
  },

  async _saveIncludeKw() {
    const v = (document.getElementById('siteIncludeKw')?.value || '').trim();
    try {
      await DB.update('appSettings', { id: 'siteReceivablesInclude', keywords: v });
      await DB.log('UPDATE', 'appSettings', 'siteReceivablesInclude', `현장 미수 포함 키워드: ${v}`);
      Utils.showToast('현장 포함 키워드를 저장했습니다.', 'success');
      await this.render();
    } catch (e) { Utils.showToast('저장 실패: ' + e.message, 'error'); }
  },

  async render() {
    await this._loadIncludeKw();
    // 대사 엔진 재사용 — 포함 키워드에 해당하는 현장만 집계
    const all = await ReceivablesModule._aggregate(this._incKws);

    // 요약(전체 현장 기준)
    const siteCount = all.length;
    const totDebit = all.reduce((s, r) => s + r.debit, 0);
    const totCredit = all.reduce((s, r) => s + r.credit, 0);
    const outstanding = all.filter(r => r.balance > 0).reduce((s, r) => s + r.balance, 0);
    const outstandingCount = all.filter(r => r.balance > 0).length;

    // 표시용 행 = 필터/검색/정렬 적용
    let rows = all.slice();
    if (this.filterMode === 'outstanding') rows = rows.filter(r => r.balance > 0);
    else if (this.filterMode === 'prepaid') rows = rows.filter(r => r.balance < 0);
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q));
    }
    if (this.sortField) rows = Utils.Sort.apply(rows, this.sortField, this.sortDir);
    else rows = rows.slice().sort((a, b) => b.balance - a.balance);

    const isAdmin = ((Auth.currentUser && Auth.currentUser()) || {}).role === 'admin';

    const statusBadge = (b) => {
      if (b > 0) return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(245,158,11,.18);color:#b45309;">미수</span>`;
      if (b < 0) return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(37,99,235,.15);color:#2563eb;">미발행/선수</span>`;
      return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(16,185,129,.15);color:#059669;">완료</span>`;
    };

    const tableRows = rows.length === 0
      ? `<tr><td colspan="5" class="text-center" style="padding:var(--sp-10);"><div class="empty-state"><div class="empty-icon">🏢</div><h3>해당 현장이 없습니다</h3></div></td></tr>`
      : rows.map(r => `
        <tr>
          <td class="fw-medium">${Utils.escapeHtml(r.name)}</td>
          <td class="text-right">${Utils.formatCurrency(r.debit)}</td>
          <td class="text-right">${Utils.formatCurrency(r.credit)}</td>
          <td class="text-right" style="font-weight:700;color:${r.balance > 0 ? '#b45309' : (r.balance < 0 ? '#2563eb' : '#059669')};">${Utils.formatCurrency(r.balance)}</td>
          <td class="text-center">${statusBadge(r.balance)}</td>
        </tr>
      `).join('');

    const adminBox = isAdmin ? `
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span class="text-xs" style="color:#2563eb;white-space:nowrap;">🏢 현장 포함 키워드:</span>
        <input type="text" id="siteIncludeKw" class="form-control" style="flex:1;min-width:220px;max-width:520px;height:30px;font-size:0.82rem;" placeholder="예: 아파트, 입주자, 단지, 대표회의" value="${Utils.escapeHtml(this._incRaw || '')}">
        <button class="btn btn-sm btn-primary" onclick="SiteReceivablesModule._saveIncludeKw()">저장</button>
        <span class="text-xs text-muted">이 단어가 든 거래처만 "현장"으로 표시돼요 (쉼표로 구분). 설계 프로젝트 등은 자동 제외.</span>
      </div>` : '';

    this.container.innerHTML = `
      <div class="page-header">
        <h2>🏢 현장 미수 현황</h2>
      </div>
      <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-3);font-size:var(--font-size-sm);">
        <strong>발행</strong>−<strong>입금</strong>=<strong>미수</strong> · 위하고 거래처원장과 동일하게 자동 계산돼요.
        <span class="text-muted"> 세금계산서·입금 자료만 있으면 반영됩니다 (금액은 VAT 포함).</span>
        ${adminBox}
      </div>

      <div class="summary-cards">
        <div class="summary-card" onclick="SiteReceivablesModule._setFilter('all')" style="cursor:pointer;${this.filterMode === 'all' ? 'outline:2px solid var(--color-primary);outline-offset:-1px;' : ''}">
          <div class="card-icon cyan">🏢</div>
          <div class="card-info"><div class="card-label">현장 수</div><div class="card-value">${siteCount}곳</div></div>
        </div>
        <div class="summary-card" style="border-left:4px solid var(--color-success);">
          <div class="card-icon green">🧾</div>
          <div class="card-info"><div class="card-label">발행 합계</div><div class="card-value">${Utils.formatCurrency(totDebit)}</div></div>
        </div>
        <div class="summary-card" onclick="SiteReceivablesModule._setFilter('outstanding')" title="미수만 보기" style="border-left:4px solid var(--color-warning);cursor:pointer;${this.filterMode === 'outstanding' ? 'outline:2px solid var(--color-warning);outline-offset:-1px;' : ''}">
          <div class="card-icon orange">⚠️</div>
          <div class="card-info"><div class="card-label">미수 합계 (${outstandingCount}곳)</div><div class="card-value">${Utils.formatCurrency(outstanding)}</div></div>
        </div>
      </div>

      <div class="table-wrapper">
        <div class="table-toolbar" style="flex-wrap:wrap;gap:var(--sp-2);">
          <div class="toolbar-left d-flex gap-2" style="flex-wrap:wrap;align-items:center;">
            <div class="search-input">
              <span class="search-icon">🔍</span>
              <input type="text" class="form-control" id="srSearch" placeholder="현장 검색..." value="${Utils.escapeHtml(this.searchText)}">
            </div>
            <button class="btn btn-ghost btn-sm" onclick="SiteReceivablesModule._setFilter('${this.filterMode === 'all' ? 'outstanding' : 'all'}')">${this.filterMode === 'all' ? '⚠️ 미수만 보기' : '전체 보기'}</button>
            <button class="btn btn-primary btn-sm" onclick="SiteReceivablesModule._openLedger()" title="세금계산서 발행일·입금일을 건별로 펼쳐 확인·공유">📋 건별 명세 (확인요청용)</button>
          </div>
          <div class="toolbar-right text-sm text-muted">${this.filterMode === 'outstanding' ? '미수' : '전체'} ${rows.length}곳</div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              ${Utils.Sort.th('현장(거래처)', 'name', this.sortField, this.sortDir, 'SiteReceivablesModule')}
              ${Utils.Sort.th('발행', 'debit', this.sortField, this.sortDir, 'SiteReceivablesModule', 'text-right')}
              ${Utils.Sort.th('입금', 'credit', this.sortField, this.sortDir, 'SiteReceivablesModule', 'text-right')}
              ${Utils.Sort.th('미수', 'balance', this.sortField, this.sortDir, 'SiteReceivablesModule', 'text-right')}
              <th class="text-center">상태</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;

    Utils.bindSearchInput(document.getElementById('srSearch'), (v) => { this.searchText = v; this.render(); });
  },

  // 건별 명세: 대사 엔진의 모달 재사용 (현장 포함 키워드만 전달)
  _openLedger() {
    ReceivablesModule._openLedger(this._incKws);
  }
};

window.SiteReceivablesModule = SiteReceivablesModule;
