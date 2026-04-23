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
  depositFilter: 'all',      // all | matched | unmatched
  depositCategory: 'all',     // all | 위탁 | 포어 | 자사몰 | 미지정
  depositMonth: 'all',        // all | YYYY-MM
  depositSearch: '',
  hideCompleted: false,
  sortField: 'depositDate',
  sortDir: 'desc',

  CATEGORIES: ['위탁', '포어', '자사몰', '미지정'],
  PAYMENT_METHODS: ['계좌이체', '카드', '현금', '가상계좌', '기타'],
  ACTION_TYPES: ['세금계산서 발행필요', '현금영수증 발급필요', '처리완료(자사몰)', '처리완료(카드사)', '처리완료(선발행매칭)'],

  _categoryBadge(cat) {
    const style = {
      '위탁': 'background:rgba(139,92,246,.12);color:#7c3aed;',
      '포어': 'background:rgba(59,130,246,.12);color:#2563eb;',
      '자사몰': 'background:rgba(16,185,129,.12);color:#059669;',
      '미지정': 'background:rgba(148,163,184,.15);color:#64748b;'
    }[cat || '미지정'];
    return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;${style}">${cat || '미지정'}</span>`;
  },

  _actionBadge(d) {
    let text = d.actionRequired || '';
    if (!text) {
      text = d.matchStatus === '매칭완료' ? '처리완료(선발행매칭)' : '세금계산서 발행필요';
    }
    const done = text.startsWith('처리완료');
    const style = done
      ? 'background:rgba(16,185,129,.12);color:#059669;'
      : 'background:rgba(245,158,11,.15);color:#b45309;';
    return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;${style}">${text}</span>`;
  },

  async init(container) {
    this.container = container;
    this.selectedDepositId = null;
    this.selectedInvoiceId = null;
    await this.render();
  },

  async render() {
    const isAdmin = Auth.isAdmin();
    const allDeposits = await DB.getAll('deposits');

    // 필터
    let filtered = [...allDeposits];
    if (this.depositFilter === 'matched') filtered = filtered.filter(d => d.matchStatus === '매칭완료');
    if (this.depositFilter === 'unmatched') filtered = filtered.filter(d => d.matchStatus !== '매칭완료');
    if (this.depositMonth !== 'all') filtered = filtered.filter(d => (d.depositDate || '').slice(0, 7) === this.depositMonth);
    if (this.hideCompleted) filtered = filtered.filter(d => d.matchStatus !== '매칭완료');
    if (this.depositSearch) {
      const q = this.depositSearch.toLowerCase();
      filtered = filtered.filter(d =>
        (d.depositorName || '').toLowerCase().includes(q) ||
        (d.partnerCompanyName || '').toLowerCase().includes(q) ||
        (d.orderNumber || '').toLowerCase().includes(q) ||
        (d.memo || '').toLowerCase().includes(q) ||
        String(d.amount).includes(q)
      );
    }

    // 정렬
    const dir = this.sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const va = a[this.sortField] || '';
      const vb = b[this.sortField] || '';
      if (this.sortField === 'amount') return (Number(va) - Number(vb)) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });

    // 월 옵션
    const monthsSet = new Set();
    allDeposits.forEach(d => { if (d.depositDate) monthsSet.add(d.depositDate.slice(0, 7)); });
    const months = Array.from(monthsSet).sort().reverse();

    // 월별 요약 (현재 필터링된 결과 기준)
    const monthlySummary = {};
    filtered.forEach(d => {
      const m = (d.depositDate || '').slice(0, 7);
      if (!m) return;
      if (!monthlySummary[m]) monthlySummary[m] = { count: 0, amount: 0 };
      monthlySummary[m].count++;
      monthlySummary[m].amount += (d.amount || 0);
    });
    const monthlyEntries = Object.entries(monthlySummary).sort((a, b) => b[0].localeCompare(a[0]));

    // 요약 통계
    const matchedCount = filtered.filter(d => d.matchStatus === '매칭완료').length;
    const unmatchedCount = filtered.length - matchedCount;
    const totalAmount = filtered.reduce((s, d) => s + (d.amount || 0), 0);
    const matchedAmount = filtered.filter(d => d.matchStatus === '매칭완료').reduce((s, d) => s + (d.amount || 0), 0);

    const sortInd = (f) => this.sortField === f ? (this.sortDir === 'asc' ? '↑' : '↓') : '⇅';

    // 입금 테이블 행
    let tableRows = '';
    if (filtered.length === 0) {
      tableRows = `<tr><td colspan="10" style="padding:var(--sp-8);text-align:center;"><div class="empty-state"><div class="empty-icon">💰</div><h3>해당 입금내역이 없습니다</h3></div></td></tr>`;
    } else {
      tableRows = filtered.map(d => {
        const matched = d.matchStatus === '매칭완료';
        // 처리사항 자동 판별
        let actionText = d.actionRequired || '';
        if (!actionText) actionText = matched ? '처리완료(선발행매칭)' : '세금계산서 발행필요';
        const actionDone = actionText.startsWith('처리완료');
        const actionStyle = actionDone
          ? 'background:rgba(16,185,129,.12);color:#059669;'
          : 'background:rgba(245,158,11,.15);color:#b45309;';

        // 상태 배지
        const statusLabel = matched ? '매칭완료' : (d.matchStatus || '미매칭');
        const statusStyle = matched
          ? 'background:rgba(16,185,129,.15);color:#065F46;'
          : 'background:rgba(148,163,184,.2);color:#475569;';

        return `
          <tr ${matched ? 'style="background:rgba(16,185,129,.04);"' : ''} oncontextmenu="FinanceMatchingModule._showDepositContextMenu(event, '${d.id}')">
            <td>${Utils.formatDate(d.depositDate)}</td>
            <td class="fw-medium">${Utils.escapeHtml(d.depositorName || '-')}</td>
            <td class="text-right amount">${Utils.formatCurrency(d.amount)}</td>
            <td class="text-xs text-muted">${Utils.escapeHtml(d.orderNumber || '-')}</td>
            <td class="text-xs">${Utils.escapeHtml(d.paymentMethod || '계좌이체')}</td>
            <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;${statusStyle}">${statusLabel}</span></td>
            <td class="text-xs">${Utils.escapeHtml(d.partnerCompanyName || '-')}</td>
            <td><span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;${actionStyle}">${Utils.escapeHtml(actionText)}</span></td>
            <td class="text-xs text-muted" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escapeHtml(d.memo || '-')}</td>
            <td>
              <div class="d-flex gap-1">
                <button class="btn btn-ghost btn-sm" onclick="FinanceMatchingModule._openDepositDetail('${d.id}')" title="상세/매칭">👁️</button>
                ${isAdmin ? `
                  <button class="btn btn-ghost btn-sm" onclick="FinanceMatchingModule._editDeposit('${d.id}')" title="수정">✏️</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="FinanceMatchingModule._deleteDeposit('${d.id}')" title="삭제">🗑️</button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>💰 입금내역</h2>
        ${isAdmin ? `
          <div class="page-actions d-flex gap-2">
            <button class="btn btn-ghost btn-sm text-danger" onclick="FinanceMatchingModule._clearAllDepositsAndTransfers()" title="모든 입금/송금 내역 삭제">🗑️ 전체 초기화</button>
            <button class="btn btn-secondary btn-sm" onclick="FinanceMatchingModule._openBankStatementModal()">📊 은행/위하고 붙여넣기</button>
            <button class="btn btn-primary btn-sm" onclick="FinanceMatchingModule._openDepositAdd()">+ 입금내역 개별 등록</button>
          </div>
        ` : ''}
      </div>

      <!-- 요약 카드 -->
      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon cyan">💰</div>
          <div class="card-info">
            <div class="card-label">전체 입금건수</div>
            <div class="card-value">${filtered.length}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon blue">📊</div>
          <div class="card-info">
            <div class="card-label">총 입금액</div>
            <div class="card-value">${Utils.formatCurrency(totalAmount)}</div>
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid var(--color-success);">
          <div class="card-icon green">✅</div>
          <div class="card-info">
            <div class="card-label">매칭완료</div>
            <div class="card-value">${matchedCount}건</div>
            <div class="card-sub">${Utils.formatCurrency(matchedAmount)}</div>
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid var(--color-warning);">
          <div class="card-icon orange">⚠️</div>
          <div class="card-info">
            <div class="card-label">미매칭 (발행 대기)</div>
            <div class="card-value">${unmatchedCount}건</div>
            <div class="card-sub">${Utils.formatCurrency(totalAmount - matchedAmount)}</div>
          </div>
        </div>
      </div>

      <!-- 월별 요약 바 -->
      ${monthlyEntries.length > 0 ? `
        <div style="display:flex;gap:var(--sp-2);overflow-x:auto;padding:var(--sp-3);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);margin-bottom:var(--sp-4);">
          ${monthlyEntries.map(([m, s]) => `
            <div onclick="FinanceMatchingModule._setMonth('${m}')" style="cursor:pointer;padding:var(--sp-2) var(--sp-3);border-radius:var(--radius-sm);background:${this.depositMonth === m ? 'var(--color-primary-light)' : 'var(--color-surface-hover)'};border:1px solid ${this.depositMonth === m ? 'var(--color-primary)' : 'var(--color-border)'};min-width:110px;">
              <div style="font-size:0.72rem;color:var(--color-text-muted);font-weight:600;">${m}</div>
              <div style="font-size:0.9rem;font-weight:700;color:var(--color-text);">${s.count}건</div>
              <div style="font-size:0.7rem;color:var(--color-primary);font-family:monospace;">${Utils.formatCurrency(s.amount)}</div>
            </div>
          `).join('')}
          ${this.depositMonth !== 'all' ? `<button class="btn btn-ghost btn-sm" onclick="FinanceMatchingModule._setMonth('all')" style="align-self:center;">✕ 월 필터 해제</button>` : ''}
        </div>
      ` : ''}

      <!-- 필터바 -->
      <div style="display:flex;gap:var(--sp-2);flex-wrap:wrap;align-items:center;margin-bottom:var(--sp-3);">
        <div class="search-input" style="flex:1;min-width:200px;">
          <span class="search-icon">🔍</span>
          <input type="text" id="depositSearchInput" class="form-control" placeholder="입금자/거래처/주문번호 검색..." value="${Utils.escapeHtml(this.depositSearch)}">
        </div>
        <select class="form-control" style="width:auto;" onchange="FinanceMatchingModule._setDepositFilter(this.value)">
          <option value="all" ${this.depositFilter === 'all' ? 'selected' : ''}>전체 상태</option>
          <option value="unmatched" ${this.depositFilter === 'unmatched' ? 'selected' : ''}>미매칭</option>
          <option value="matched" ${this.depositFilter === 'matched' ? 'selected' : ''}>매칭완료</option>
        </select>
        <select class="form-control" style="width:auto;" onchange="FinanceMatchingModule._setMonth(this.value)">
          <option value="all" ${this.depositMonth === 'all' ? 'selected' : ''}>전체 월</option>
          ${months.map(m => `<option value="${m}" ${this.depositMonth === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer;">
          <input type="checkbox" ${this.hideCompleted ? 'checked' : ''} onchange="FinanceMatchingModule._toggleHideCompleted(this.checked)">
          완료 숨기기
        </label>
      </div>

      <!-- 테이블 -->
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th style="cursor:pointer;user-select:none;" onclick="FinanceMatchingModule._sort('depositDate')">입금일 ${sortInd('depositDate')}</th>
              <th style="cursor:pointer;user-select:none;" onclick="FinanceMatchingModule._sort('depositorName')">입금처 ${sortInd('depositorName')}</th>
              <th class="text-right" style="cursor:pointer;user-select:none;text-align:right !important;padding-right:var(--sp-3);" onclick="FinanceMatchingModule._sort('amount')">금액 ${sortInd('amount')}</th>
              <th>주문번호</th>
              <th>결제방법</th>
              <th class="text-center">상태</th>
              <th>거래처</th>
              <th>처리사항</th>
              <th>비고</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>

    `;

    // 검색 이벤트
    const ds = document.getElementById('depositSearchInput');
    if (ds) ds.addEventListener('input', Utils.debounce((e) => { this.depositSearch = e.target.value; this.render(); }, 300));
  },

  _setDepositFilter(f) { this.depositFilter = f; this.render(); },
  _setDepositCategory(c) { this.depositCategory = c; this.render(); },
  _setMonth(m) { this.depositMonth = m; this.render(); },
  _toggleHideCompleted(v) { this.hideCompleted = v; this.render(); },
  _sort(field) {
    if (this.sortField === field) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDir = 'desc';
    }
    this.render();
  },

  _selectDeposit(id) { this.selectedDepositId = id; this.render(); },
  _selectInvoice(id) { this.selectedInvoiceId = id; this.render(); },

  // 거래처 카탈로그: 모든 소스(세금계산서/입금)에서 거래처 집합 구축
  async _buildPartnerCatalog() {
    const invoices = await DB.getAll('taxInvoiceRequests');
    const deposits = await DB.getAll('deposits');
    const map = new Map();

    const add = (name, regNumber, lastDate) => {
      if (!name) return;
      const key = (regNumber || name).trim();
      if (!key) return;
      const existing = map.get(key);
      if (existing) {
        existing.frequency++;
        if (!existing.lastDate || (lastDate && lastDate > existing.lastDate)) {
          existing.lastDate = lastDate;
        }
        if (!existing.regNumber && regNumber) existing.regNumber = regNumber;
      } else {
        map.set(key, { name, regNumber: regNumber || '', frequency: 1, lastDate: lastDate || '' });
      }
    };

    invoices.forEach(i => add(i.partnerCompanyName, i.partnerRegNumber, i.issueDate || i.createdAt));
    deposits.forEach(d => add(d.partnerCompanyName, '', d.depositDate));

    return Array.from(map.values());
  },

  _normalizePartnerName(s) {
    return (s || '').replace(/[\s()㈜주식회사]/g, '').toLowerCase();
  },

  // 입금처 기반 거래처 추천 (과거 데이터에서 유사도 계산)
  _suggestPartners(depositorName, partnerCatalog, rejected = []) {
    const base = this._normalizePartnerName(depositorName);
    if (!base) return [];
    return partnerCatalog
      .filter(p => !rejected.includes(p.name))
      .map(p => {
        const target = this._normalizePartnerName(p.name);
        let score = 0;
        if (!target) return { ...p, score: 0 };
        if (target === base) score += 70;
        else if (base.includes(target) || target.includes(base)) score += 40;
        else {
          // 문자 공통 비율
          let common = 0;
          for (const ch of base) if (target.includes(ch)) common++;
          const ratio = common / Math.max(base.length, target.length);
          if (ratio >= 0.6) score += Math.round(ratio * 30);
        }
        // 사용 빈도 보너스
        if (p.frequency >= 3) score += 10;
        else if (p.frequency >= 2) score += 5;
        return { ...p, score };
      })
      .filter(p => p.score >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  },

  // 세금계산서의 매칭된 입금 id 목록 (하위호환: matchedDepositId 단일값도 지원)
  _getInvoiceMatchedIds(invoice) {
    if (Array.isArray(invoice.matchedDepositIds) && invoice.matchedDepositIds.length > 0) {
      return invoice.matchedDepositIds.map(String);
    }
    if (invoice.matchedDepositId) return [String(invoice.matchedDepositId)];
    return [];
  },

  // 세금계산서의 매칭 상태 판별 (미매칭/부분입금/완전매칭)
  _getInvoiceMatchStatus(invoice, depositMap) {
    const ids = this._getInvoiceMatchedIds(invoice);
    if (ids.length === 0) return { status: 'unmatched', matchedAmount: 0, count: 0 };
    const deposits = ids.map(id => depositMap ? depositMap[id] : null).filter(Boolean);
    const matchedAmount = deposits.reduce((s, d) => s + (d.amount || 0), 0);
    const diff = Math.abs(matchedAmount - (invoice.totalAmount || 0));
    const status = diff < 10 ? 'full' : (matchedAmount > 0 ? 'partial' : 'unmatched');
    return { status, matchedAmount, count: ids.length, deposits };
  },

  // ===== 입금 상세 모달 (선발행 건 매칭 + 거래처 추천) =====
  async _openDepositDetail(id) {
    const d = await DB.get('deposits', id);
    if (!d) return;
    const invoices = (await DB.getAll('taxInvoiceRequests')).filter(i => i.status === '발행완료');
    const matchedInvoice = d.matchedInvoiceId ? await DB.get('taxInvoiceRequests', d.matchedInvoiceId) : null;

    // 모든 입금내역 맵 (매칭 상태 계산용)
    const allDeposits = await DB.getAll('deposits');
    const depositMap = {};
    allDeposits.forEach(x => { depositMap[String(x.id)] = x; });

    // 매칭 가능 세금계산서: 완전매칭 안된 것 (미매칭 + 부분매칭)
    const unmatchedInvoices = invoices.filter(i => {
      const s = this._getInvoiceMatchStatus(i, depositMap).status;
      return s !== 'full';
    });

    // 거래처 카탈로그 + 추천
    const partnerCatalog = await this._buildPartnerCatalog();
    const rejectedPartners = d.rejectedPartners || [];
    const partnerSuggestions = d.partnerCompanyName ? [] : this._suggestPartners(d.depositorName, partnerCatalog, rejectedPartners);

    // 매칭 추천 (금액 동일/남은금액 동일 + 이름 유사)
    const normalizeName = (s) => (s || '').replace(/[\s()주식회사㈜]/g, '').toLowerCase();
    const suggestions = unmatchedInvoices.map(inv => {
      let score = 0;
      const matchInfo = this._getInvoiceMatchStatus(inv, depositMap);
      const remaining = (inv.totalAmount || 0) - matchInfo.matchedAmount;

      // 전체 금액 매칭
      if (inv.totalAmount === d.amount) score += 50;
      else if (Math.abs(inv.totalAmount - d.amount) < d.amount * 0.01) score += 30;

      // 부분매칭 상태에서 "남은 금액"과 일치하면 가산 (공급가액·부가세 분리 입금 케이스)
      if (matchInfo.status === 'partial' && remaining > 0) {
        if (Math.abs(remaining - d.amount) < 10) score += 60;  // 남은금액 정확히 일치 시 최고 점수
        else if (Math.abs(remaining - d.amount) < d.amount * 0.01) score += 40;
      }

      const a = normalizeName(d.depositorName), b = normalizeName(inv.partnerCompanyName);
      if (a && b) {
        if (a === b) score += 40;
        else if (a.includes(b) || b.includes(a)) score += 20;
      }
      return { inv, score, matchInfo, remaining };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    const matched = d.matchStatus === '매칭완료';

    // 검색용 카탈로그를 모달 내 scope에 저장
    this._currentDepositId = d.id;
    this._partnerCatalog = partnerCatalog;

    Utils.openModal(`
      <div class="modal-header">
        <h3>💰 입금건 상세</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <!-- 상단 요약 -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-3);padding:var(--sp-4);background:var(--color-surface-hover);border-radius:var(--radius-md);margin-bottom:var(--sp-4);">
          <div><div class="text-xs text-muted">입금일</div><div class="fw-semibold">${Utils.formatDate(d.depositDate)}</div></div>
          <div><div class="text-xs text-muted">입금처</div><div class="fw-semibold">${Utils.escapeHtml(d.depositorName || '-')}</div></div>
          <div><div class="text-xs text-muted">금액</div><div class="fw-bold" style="color:var(--color-primary);font-size:1.1rem;">${Utils.formatCurrency(d.amount)}</div></div>
          <div><div class="text-xs text-muted">상태</div><div>${matched ? '<span style="color:var(--color-success);font-weight:600;">✅ 매칭완료</span>' : '<span style="color:var(--color-warning);font-weight:600;">⚠️ 미매칭</span>'}</div></div>
        </div>

        <!-- 세부 정보 -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <div><label class="text-xs text-muted">결제방법</label><div>${Utils.escapeHtml(d.paymentMethod || '계좌이체')}</div></div>
          <div><label class="text-xs text-muted">주문번호</label><div>${Utils.escapeHtml(d.orderNumber || '-')}</div></div>
          <div><label class="text-xs text-muted">거래처</label><div>${Utils.escapeHtml(d.partnerCompanyName || '-')}</div></div>
        </div>
        <div class="mb-4"><label class="text-xs text-muted">비고</label><div style="padding:var(--sp-2);background:var(--color-surface-hover);border-radius:var(--radius-sm);">${Utils.escapeHtml(d.memo || '-')}</div></div>

        <!-- 거래처 추천/선택 영역 -->
        <fieldset style="margin-bottom:var(--sp-4);padding:var(--sp-4);border:1px solid var(--color-border);border-radius:var(--radius-md);">
          <legend style="padding:0 var(--sp-2);font-weight:600;">🏢 거래처</legend>

          ${d.partnerCompanyName ? `
            <div style="display:flex;align-items:center;gap:8px;padding:var(--sp-2) var(--sp-3);background:var(--color-primary-light);border-radius:var(--radius-sm);margin-bottom:var(--sp-2);">
              <span class="fw-semibold">${Utils.escapeHtml(d.partnerCompanyName)}</span>
              <button onclick="FinanceMatchingModule._clearPartner('${d.id}')" class="btn btn-ghost btn-sm" title="제거" style="margin-left:auto;padding:2px 8px;">✕</button>
            </div>
          ` : `
            ${partnerSuggestions.length > 0 ? `
              <div class="mb-3">
                <div class="text-xs text-muted mb-2">💡 입금처 "${Utils.escapeHtml(d.depositorName)}" 기반 추천:</div>
                ${partnerSuggestions.map(p => `
                  <div style="display:flex;align-items:center;gap:8px;padding:var(--sp-2) var(--sp-3);background:var(--color-surface-hover);border-radius:var(--radius-sm);margin-bottom:var(--sp-1);">
                    <span style="display:inline-block;padding:1px 6px;background:rgba(59,130,246,.15);color:#2563eb;border-radius:3px;font-size:10px;font-weight:600;">추천 ${p.score}</span>
                    <span class="fw-medium">${Utils.escapeHtml(p.name)}</span>
                    ${p.regNumber ? `<span class="text-xs text-muted">${Utils.escapeHtml(p.regNumber)}</span>` : ''}
                    ${p.frequency > 1 ? `<span class="text-xs text-muted">· ${p.frequency}회 거래</span>` : ''}
                    <div style="margin-left:auto;display:flex;gap:4px;">
                      <button class="btn btn-success btn-sm" onclick="FinanceMatchingModule._acceptPartner('${d.id}', ${JSON.stringify(p.name).replace(/"/g, '&quot;')})" title="선택">✓</button>
                      <button class="btn btn-ghost btn-sm" onclick="FinanceMatchingModule._rejectPartner('${d.id}', ${JSON.stringify(p.name).replace(/"/g, '&quot;')})" title="이 추천 거절">✕</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : '<div class="text-xs text-muted mb-2">추천할 거래처가 없습니다. 아래에서 직접 검색하세요.</div>'}

            <div class="form-group">
              <label class="text-xs text-muted">거래처 검색:</label>
              <input type="text" id="partnerSearchInput" class="form-control" placeholder="거래처명 검색..." oninput="FinanceMatchingModule._onPartnerSearch(this.value)">
              <div id="partnerSearchResults" style="max-height:200px;overflow-y:auto;margin-top:var(--sp-2);"></div>
            </div>
          `}
        </fieldset>

        <!-- 선발행 건 매칭 영역 -->
        <fieldset style="margin-top:var(--sp-4);padding:var(--sp-4);border:1px solid var(--color-border);border-radius:var(--radius-md);">
          <legend style="padding:0 var(--sp-2);font-weight:600;">🔗 선발행 건 매칭</legend>

          ${matched && matchedInvoice ? `
            <div style="padding:var(--sp-3);background:var(--color-success-light);border-left:3px solid var(--color-success);border-radius:var(--radius-sm);margin-bottom:var(--sp-3);">
              <div class="d-flex justify-between items-center">
                <div>
                  <div class="fw-semibold">✅ 매칭된 세금계산서</div>
                  <div class="text-sm mt-1">
                    ${Utils.escapeHtml(matchedInvoice.requestNumber)} · <strong>${Utils.escapeHtml(matchedInvoice.partnerCompanyName || '')}</strong> · ${Utils.formatCurrency(matchedInvoice.totalAmount)}
                    <br>발행일: ${Utils.formatDate(matchedInvoice.issueDate || matchedInvoice.createdAt)}
                  </div>
                </div>
                <button class="btn btn-danger btn-sm" onclick="FinanceMatchingModule._unmatchFromDetail('${d.id}')">🔗 매칭 해제</button>
              </div>
            </div>
          ` : `
            ${suggestions.length > 0 ? `
              <div class="mb-3">
                <div class="text-xs text-muted mb-2">💡 추천 매칭 (유사도 높은 순) · <strong>부분입금 건 포함</strong>:</div>
                ${suggestions.slice(0, 5).map(s => {
                  const isPartial = s.matchInfo.status === 'partial';
                  const badgeHtml = isPartial
                    ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;background:rgba(245,158,11,.2);color:#b45309;border-radius:3px;font-size:10px;font-weight:600;">부분입금 ${s.matchInfo.count}건</span>`
                    : '';
                  return `
                    <div style="padding:var(--sp-2) var(--sp-3);background:${isPartial ? 'rgba(245,158,11,.06)' : 'var(--color-surface-hover)'};border-radius:var(--radius-sm);margin-bottom:var(--sp-1);display:flex;justify-content:space-between;align-items:center;">
                      <div>
                        <span class="fw-medium">${Utils.escapeHtml(s.inv.partnerCompanyName || '-')}</span>
                        <span class="text-xs text-muted"> · ${Utils.escapeHtml(s.inv.requestNumber)}</span>
                        <span style="display:inline-block;margin-left:6px;padding:1px 6px;background:rgba(59,130,246,.15);color:#2563eb;border-radius:3px;font-size:10px;font-weight:600;">유사도 ${s.score}</span>
                        ${badgeHtml}
                        ${isPartial ? `<div class="text-xs text-muted mt-1">기입금 ${Utils.formatCurrency(s.matchInfo.matchedAmount)} / 남은 <strong style="color:#b45309;">${Utils.formatCurrency(s.remaining)}</strong></div>` : ''}
                      </div>
                      <div class="d-flex gap-2 items-center">
                        <span class="fw-semibold">${Utils.formatCurrency(s.inv.totalAmount)}</span>
                        <button class="btn btn-success btn-sm" onclick="FinanceMatchingModule._matchFromDetail('${d.id}', '${s.inv.id}')">${isPartial ? '추가매칭' : '매칭'}</button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}

            <div class="form-group mt-3">
              <label>세금계산서 선택 (미매칭 + 부분입금):</label>
              <select id="matchInvoiceSelect" class="form-control">
                <option value="">-- 선택 --</option>
                ${unmatchedInvoices.map(i => {
                  const info = this._getInvoiceMatchStatus(i, depositMap);
                  const suffix = info.status === 'partial'
                    ? ` [부분입금 남은금액 ${Utils.formatCurrency((i.totalAmount||0) - info.matchedAmount)}]`
                    : '';
                  return `
                  <option value="${i.id}">
                    ${Utils.escapeHtml(i.partnerCompanyName || '-')} · ${Utils.escapeHtml(i.requestNumber)} · ${Utils.formatCurrency(i.totalAmount)} (${Utils.formatDate(i.issueDate || i.createdAt)})${suffix}
                  </option>
                `;}).join('')}
              </select>
            </div>
            <button class="btn btn-primary" onclick="FinanceMatchingModule._matchFromDetailSelect('${d.id}')">🔗 선택한 세금계산서와 매칭</button>
            ${unmatchedInvoices.length === 0 ? '<div class="text-xs text-muted mt-2">매칭 가능한 발행완료 세금계산서가 없습니다.</div>' : ''}
          `}
        </fieldset>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
      </div>
    `, { size: 'modal-lg' });
  },

  async _matchFromDetail(depositId, invoiceId) {
    const deposit = await DB.get('deposits', depositId);
    const invoice = await DB.get('taxInvoiceRequests', invoiceId);
    if (!deposit || !invoice) return;

    // 기존 매칭 입금 정보 조회
    const existingIds = this._getInvoiceMatchedIds(invoice).filter(id => String(id) !== String(deposit.id));
    let existingTotal = 0;
    const existingDeposits = [];
    for (const eid of existingIds) {
      try {
        const ed = await DB.get('deposits', eid);
        if (ed) { existingDeposits.push(ed); existingTotal += (ed.amount || 0); }
      } catch (e) { /* 무시 */ }
    }
    const newTotal = existingTotal + (deposit.amount || 0);
    const invoiceTotal = invoice.totalAmount || 0;

    let msg = `💰 입금: ${deposit.depositorName} ${Utils.formatCurrency(deposit.amount)}\n📝 세금계산서: ${invoice.partnerCompanyName} ${Utils.formatCurrency(invoiceTotal)}\n`;
    if (existingIds.length > 0) {
      msg += `\n⚠️ 이 세금계산서에 이미 ${existingIds.length}건 매칭 (합계 ${Utils.formatCurrency(existingTotal)})\n추가 후 합계: ${Utils.formatCurrency(newTotal)} / ${Utils.formatCurrency(invoiceTotal)}`;
      if (Math.abs(newTotal - invoiceTotal) < 10) msg += '\n✅ 완전 매칭됩니다';
      else if (newTotal < invoiceTotal) msg += `\n⚠️ 부분 매칭 (남은금액 ${Utils.formatCurrency(invoiceTotal - newTotal)})`;
      else msg += `\n❗ 초과입금 ${Utils.formatCurrency(newTotal - invoiceTotal)}`;
    } else {
      if (Math.abs(newTotal - invoiceTotal) < 10) msg += '\n✅ 완전 매칭됩니다';
      else if (newTotal < invoiceTotal) msg += `\n⚠️ 부분 매칭됩니다 (남은금액 ${Utils.formatCurrency(invoiceTotal - newTotal)})`;
      else msg += `\n❗ 초과입금 ${Utils.formatCurrency(newTotal - invoiceTotal)}`;
    }
    msg += '\n\n매칭하시겠습니까?';

    // 네이티브 confirm (모달 DOM 간섭 방지)
    const ok = window.confirm(msg);
    if (!ok) return;

    const user = Auth.currentUser();

    // 세금계산서: matchedDepositIds 배열에 추가
    const newIds = [...existingIds, deposit.id];
    invoice.matchedDepositIds = newIds.map(String);
    invoice.matchedDepositId = String(newIds[0]); // 하위호환 (첫 번째 id)
    invoice.updatedAt = new Date().toISOString();
    await DB.update('taxInvoiceRequests', invoice);

    // 입금: 단일 invoice 지정
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
      memo: existingIds.length > 0 ? `추가매칭 (총 ${newIds.length}건)` : ''
    });
    await DB.log('MATCH', 'matching', null, `매칭: ${invoice.requestNumber} ↔ ${deposit.depositorName} (${newIds.length}/${invoiceTotal === newTotal ? '완전' : '부분'})`);

    Utils.showToast(existingIds.length > 0 ? `추가매칭 완료 (총 ${newIds.length}건)` : '매칭 완료', 'success');
    Utils.closeModal();
    await this.render();
  },

  async _matchFromDetailSelect(depositId) {
    const invoiceId = document.getElementById('matchInvoiceSelect').value;
    if (!invoiceId) { Utils.showToast('세금계산서를 선택하세요.', 'error'); return; }
    await this._matchFromDetail(depositId, invoiceId);
  },

  async _unmatchFromDetail(depositId) {
    const confirmed = await Utils.confirm('매칭을 해제하시겠습니까?', '매칭 해제');
    if (!confirmed) return;
    await this._unmatch(depositId);
    Utils.closeModal();
  },

  // ===== 거래처 추천/선택 핸들러 =====
  async _acceptPartner(depositId, partnerName) {
    const d = await DB.get('deposits', depositId);
    if (!d) return;
    // 카탈로그에서 사업자번호 찾기
    const catalog = this._partnerCatalog || await this._buildPartnerCatalog();
    const found = catalog.find(p => p.name === partnerName);
    d.partnerCompanyName = partnerName;
    if (found && found.regNumber && !d.partnerRegNumber) d.partnerRegNumber = found.regNumber;
    d.updatedAt = new Date().toISOString();
    await DB.update('deposits', d);
    await DB.log('UPDATE', 'deposit', depositId, `거래처 지정: ${partnerName}`);
    Utils.showToast(`거래처 "${partnerName}" 지정됨`, 'success');
    this._openDepositDetail(depositId);
  },

  async _rejectPartner(depositId, partnerName) {
    const d = await DB.get('deposits', depositId);
    if (!d) return;
    d.rejectedPartners = d.rejectedPartners || [];
    if (!d.rejectedPartners.includes(partnerName)) d.rejectedPartners.push(partnerName);
    d.updatedAt = new Date().toISOString();
    await DB.update('deposits', d);
    this._openDepositDetail(depositId);
  },

  async _clearPartner(depositId) {
    const d = await DB.get('deposits', depositId);
    if (!d) return;
    d.partnerCompanyName = '';
    d.partnerRegNumber = '';
    d.updatedAt = new Date().toISOString();
    await DB.update('deposits', d);
    await DB.log('UPDATE', 'deposit', depositId, `거래처 제거`);
    this._openDepositDetail(depositId);
  },

  _onPartnerSearch(query) {
    const el = document.getElementById('partnerSearchResults');
    if (!el) return;
    const q = (query || '').trim().toLowerCase();
    if (!q) { el.innerHTML = ''; return; }
    const catalog = this._partnerCatalog || [];
    const results = catalog
      .filter(p => (p.name || '').toLowerCase().includes(q) || (p.regNumber || '').includes(q))
      .slice(0, 10);
    if (results.length === 0) {
      el.innerHTML = '<div class="text-xs text-muted" style="padding:8px;">검색 결과가 없습니다.</div>';
      return;
    }
    el.innerHTML = results.map(p => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--color-surface-hover);border-radius:4px;margin-bottom:4px;cursor:pointer;" onclick="FinanceMatchingModule._acceptPartner('${this._currentDepositId}', ${JSON.stringify(p.name).replace(/"/g, '&quot;')})">
        <span class="fw-medium">${Utils.escapeHtml(p.name)}</span>
        ${p.regNumber ? `<span class="text-xs text-muted">${Utils.escapeHtml(p.regNumber)}</span>` : ''}
        ${p.frequency > 1 ? `<span class="text-xs text-muted">· ${p.frequency}회</span>` : ''}
        <button class="btn btn-success btn-sm" style="margin-left:auto;padding:2px 10px;">선택</button>
      </div>
    `).join('');
  },

  async _editDeposit(id) {
    const d = await DB.get('deposits', id);
    if (d && window.DepositModule?._openAddModal) {
      DepositModule._openAddModal(d);
    } else {
      this._openDepositAdd(d);
    }
  },

  _openDepositAdd(editData = null) {
    if (window.DepositModule?._openAddModal) {
      DepositModule._openAddModal(editData);
      return;
    }
    // 폴백: 간단 모달
    Utils.openModal(`
      <div class="modal-header"><h3>입금내역 개별 등록</h3><button class="modal-close" onclick="Utils.closeModal()">&times;</button></div>
      <div class="modal-body"><div class="form-row">
        <div class="form-group"><label>입금일</label><input type="date" id="fmDepDate" class="form-control" value="${Utils.today()}"></div>
        <div class="form-group"><label>입금처</label><input type="text" id="fmDepName" class="form-control"></div>
      </div><div class="form-row">
        <div class="form-group"><label>금액</label><input type="number" id="fmDepAmount" class="form-control" min="0"></div>
        <div class="form-group"><label>결제방법</label><select id="fmDepPayment" class="form-control">${this.PAYMENT_METHODS.map(p => `<option value="${p}">${p}</option>`).join('')}</select></div>
      </div><div class="form-group"><label>비고</label><textarea id="fmDepMemo" class="form-control" rows="2"></textarea></div></div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button><button class="btn btn-primary" onclick="FinanceMatchingModule._saveFallbackDeposit()">등록</button></div>
    `);
  },

  async _saveFallbackDeposit() {
    const date = document.getElementById('fmDepDate').value;
    const name = document.getElementById('fmDepName').value.trim();
    const amount = Number(document.getElementById('fmDepAmount').value) || 0;
    if (!date || !name || amount <= 0) { Utils.showToast('입금일/입금처/금액을 입력하세요', 'error'); return; }
    const user = Auth.currentUser();
    await DB.add('deposits', {
      depositDate: date, depositorName: name, amount,
      memo: document.getElementById('fmDepMemo').value.trim(),
      paymentMethod: document.getElementById('fmDepPayment').value || '계좌이체',
      orderNumber: '', partnerCompanyName: '', actionRequired: '',
      matchStatus: '미매칭', matchedInvoiceId: null,
      registeredBy: user.id, registeredByName: user.displayName,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    Utils.closeModal();
    await this.render();
  },

  // 전체 입금/송금 내역 삭제 (독립 버튼용 - 모달 외부에서 호출)
  async _clearAllDepositsAndTransfers() {
    const deposits = await DB.getAll('deposits');
    const transfers = await DB.getAll('transferRecords');

    if (deposits.length === 0 && transfers.length === 0) {
      Utils.showToast('삭제할 내역이 없습니다.', 'warning');
      return;
    }

    // 네이티브 confirm + 입력 확인 (오삭제 방지)
    const firstOk = window.confirm(
      `⚠️ 입금 ${deposits.length}건, 송금 ${transfers.length}건을 모두 삭제합니다.\n\n되돌릴 수 없습니다. 계속하시겠습니까?`
    );
    if (!firstOk) return;

    const typed = window.prompt('정말 삭제하려면 "삭제" 를 입력하세요:', '');
    if (typed !== '삭제') {
      Utils.showToast('입력값이 다릅니다. 취소되었습니다.', 'error');
      return;
    }

    console.log(`[전체초기화] 시작: 입금 ${deposits.length} / 송금 ${transfers.length}`);
    let delDep = 0, delWd = 0;
    const errors = [];

    for (const d of deposits) {
      try { await DB.delete('deposits', d.id); delDep++; }
      catch (e) { console.error(`입금 삭제 실패 id=${d.id}:`, e); errors.push(String(d.id)); }
    }
    for (const t of transfers) {
      try { await DB.delete('transferRecords', t.id); delWd++; }
      catch (e) { console.error(`송금 삭제 실패 id=${t.id}:`, e); errors.push(String(t.id)); }
    }

    // 세금계산서 매칭 해제
    try {
      const invoices = await DB.getAll('taxInvoiceRequests');
      for (const inv of invoices) {
        if (inv.matchedDepositId) {
          inv.matchedDepositId = null;
          inv.updatedAt = new Date().toISOString();
          await DB.update('taxInvoiceRequests', inv);
        }
      }
    } catch (e) { console.error('세금계산서 매칭 해제 실패:', e); }

    await DB.log('DELETE', 'bank', null, `전체 초기화: 입금 ${delDep}, 송금 ${delWd} 삭제`);
    const msg = errors.length > 0
      ? `초기화 완료: 입금 ${delDep}, 송금 ${delWd} (실패 ${errors.length}건)`
      : `초기화 완료: 입금 ${delDep}건, 송금 ${delWd}건 삭제됨`;
    Utils.showToast(msg, 'success');
    console.log(`[전체초기화] 완료: 입금 ${delDep} / 송금 ${delWd} / 오류 ${errors.length}`);
    await this.render();
  },

  async _deleteDeposit(id) {
    const d = await DB.get('deposits', id);
    if (!d) return;
    const confirmed = await Utils.confirm(`${d.depositorName} ${Utils.formatCurrency(d.amount)} 입금건을 삭제하시겠습니까?`, '입금내역 삭제');
    if (!confirmed) return;
    // 매칭된 경우 세금계산서의 배열에서도 제거
    if (d.matchedInvoiceId) {
      const inv = await DB.get('taxInvoiceRequests', d.matchedInvoiceId);
      if (inv) {
        const ids = this._getInvoiceMatchedIds(inv).filter(x => String(x) !== String(id));
        inv.matchedDepositIds = ids;
        inv.matchedDepositId = ids[0] || null;
        inv.updatedAt = new Date().toISOString();
        await DB.update('taxInvoiceRequests', inv);
      }
    }
    await DB.delete('deposits', id);
    await DB.log('DELETE', 'deposit', id, `입금 삭제: ${d.depositorName}`);
    Utils.showToast('삭제되었습니다.', 'success');
    await this.render();
  },

  _showDepositContextMenu(event, id) {
    const items = [
      { icon: '👁️', label: '상세/매칭', onClick: () => this._openDepositDetail(id) },
      { icon: '✏️', label: '수정', onClick: () => this._editDeposit(id) },
      { divider: true },
      { icon: '🗑️', label: '삭제', danger: true, onClick: () => this._deleteDeposit(id) }
    ];
    if (window.ContextMenu) ContextMenu.show(event, items);
  },

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
        // 배열에서 해당 deposit id 제거
        const ids = this._getInvoiceMatchedIds(invoice).filter(x => String(x) !== String(depositId));
        invoice.matchedDepositIds = ids;
        invoice.matchedDepositId = ids[0] || null;
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
          <strong>✨ 지원 방식:</strong><br>
          <span class="text-muted">
            • <strong>파일 업로드:</strong> .xlsx / .xls 파일을 아래 영역에 드래그 또는 클릭하여 선택<br>
            • <strong>복사 붙여넣기:</strong> 엑셀에서 복사한 데이터를 붙여넣기 (헤더 포함 권장)<br>
            • 지원 형식: <code>위하고</code> / <code>은행 거래내역</code> / <code>기업은행 입출식예금</code> 등 자동 감지
          </span>
        </div>

        <!-- 파일 드래그 & 드롭 영역 -->
        <div id="bankFileDropZone"
             style="border:2px dashed var(--color-primary);background:#F0F9FF;border-radius:var(--radius-md);padding:var(--sp-5);text-align:center;cursor:pointer;margin-bottom:var(--sp-3);transition:all 0.2s;"
             onclick="document.getElementById('bankFileInput').click()">
          <div style="font-size:2rem;margin-bottom:8px;">📂</div>
          <div style="font-weight:600;color:var(--color-primary);margin-bottom:4px;">엑셀 파일 업로드 (.xlsx / .xls)</div>
          <div class="text-xs text-muted">파일을 여기에 드래그 하거나 클릭하여 선택</div>
          <div id="bankFileName" class="text-sm" style="margin-top:8px;color:var(--color-success);font-weight:600;"></div>
          <input type="file" id="bankFileInput" accept=".xlsx,.xls" style="display:none;" onchange="FinanceMatchingModule._onBankFileSelected(this.files[0])">
        </div>

        <div class="form-group">
          <label>또는 엑셀에서 복사 → 여기 붙여넣기</label>
          <textarea id="bankStatementArea" class="form-control" rows="6"
                    placeholder="헤더 포함 데이터를 Ctrl+V 로 붙여넣기 (기업은행 형식은 헤더 없어도 자동 인식)"
                    style="font-family:monospace;font-size:12px;"></textarea>
        </div>

        <div class="d-flex gap-2 mb-4" style="flex-wrap:wrap;align-items:center;">
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
          <label style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:#FEF3C7;border-radius:6px;cursor:pointer;border:1px solid #F59E0B;">
            <input type="checkbox" id="bankClearFirst">
            <span class="text-sm" style="color:#92400E;font-weight:600;">⚠️ 기존 입금/송금내역 모두 삭제 후 업로드</span>
          </label>
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

    // 드래그앤드롭 이벤트 바인딩
    setTimeout(() => {
      const dz = document.getElementById('bankFileDropZone');
      if (!dz) return;
      const highlight = () => { dz.style.background = '#DBEAFE'; };
      const unhighlight = () => { dz.style.background = '#F0F9FF'; };
      ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); highlight(); }));
      ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); unhighlight(); }));
      dz.addEventListener('drop', (e) => {
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) this._onBankFileSelected(files[0]);
      });
    }, 100);
  },

  // XLSX SDK 동적 로드 (leave.js와 공유되지 않으므로 별도 정의, 중복 호출 안전)
  async _ensureBankXlsxSdk() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('XLSX SDK 로드 실패'));
      document.head.appendChild(s);
    });
  },

  // 파일 선택 시 엑셀 파싱 → 텍스트 영역에 탭 구분 데이터로 채움
  async _onBankFileSelected(file) {
    if (!file) return;
    const nameEl = document.getElementById('bankFileName');
    if (nameEl) nameEl.textContent = `⏳ "${file.name}" 로드중...`;

    try {
      await this._ensureBankXlsxSdk();
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

      if (rows.length === 0) {
        Utils.showToast('빈 파일입니다.', 'error');
        return;
      }

      // 각 행을 탭 구분 문자열로 변환 후 textarea에 삽입
      const lines = rows.map(r => r.map(c => String(c ?? '').trim()).join('\t'));
      const textArea = document.getElementById('bankStatementArea');
      if (textArea) textArea.value = lines.join('\n');

      if (nameEl) nameEl.textContent = `✅ "${file.name}" 로드 완료 (${rows.length}행)`;
      Utils.showToast(`"${file.name}" ${rows.length}행 로드됨. 분석중...`, 'success');

      // 자동 분석
      this._parseBankStatement();
    } catch (e) {
      console.error(e);
      if (nameEl) nameEl.textContent = `❌ 파일 로드 실패: ${e.message}`;
      Utils.showToast('파일 로드 실패: ' + e.message, 'error');
    }
  },

  // 기업은행 입출식예금 형식 (헤더 없음) 감지
  // 포맷: [일시, 출금액, 입금액, 잔액, 거래처약식, 계좌번호, 은행명, '', 거래구분, 0, 메모, 거래처전체]
  _detectIbkFormat(cols) {
    if (cols.length < 10) return null;
    const c0 = (cols[0] || '').trim();
    const hasDateTime = /^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2})?/.test(c0);
    if (!hasDateTime) return null;
    const c1Num = this._isNumber(cols[1]);
    const c2Num = this._isNumber(cols[2]);
    const c3Num = this._isNumber(cols[3]);
    if (!(c1Num || c2Num) || !c3Num) return null;
    return {
      dateIdx: 0, withdrawIdx: 1, depositIdx: 2, balanceIdx: 3,
      shortNameIdx: 4, bankIdx: 6, typeIdx: 8, fullNameIdx: 11,
      format: 'ibk'
    };
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

    // 0) 기업은행 입출식예금 형식 (헤더 없음) 감지 - 최우선
    let ibkMapping = null;
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const cols = this._splitCols(lines[i]);
      const m = this._detectIbkFormat(cols);
      if (m) { ibkMapping = m; break; }
    }

    // 1) 헤더 행 자동 감지 (위하고/은행)
    let mapping = null;
    let startLine = 0;
    if (!ibkMapping) {
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const cols = this._splitCols(lines[i]);
        const m = this._parseHeader(cols);
        if (m) {
          mapping = m;
          startLine = i + 1;
          break;
        }
      }
    }

    let detectedFormat = ibkMapping ? '기업은행' : (mapping ? '헤더 기반' : '자동 감지');

    // 2) 데이터 행 파싱
    for (let i = startLine; i < lines.length; i++) {
      const cols = this._splitCols(lines[i]);
      if (cols.length < 4) continue;

      // === 기업은행 형식 전용 파싱 ===
      if (ibkMapping) {
        const c0 = (cols[ibkMapping.dateIdx] || '').trim();
        const dateM = c0.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!dateM) continue;
        const date = `${dateM[1]}-${dateM[2]}-${dateM[3]}`;
        const withdrawAmount = Number((cols[ibkMapping.withdrawIdx] || '').replace(/[,\s]/g, '')) || 0;
        const depositAmount = Number((cols[ibkMapping.depositIdx] || '').replace(/[,\s]/g, '')) || 0;
        const fullName = (cols[ibkMapping.fullNameIdx] || '').trim();
        const shortName = (cols[ibkMapping.shortNameIdx] || '').trim();
        const bank = (cols[ibkMapping.bankIdx] || '').trim();
        const type = (cols[ibkMapping.typeIdx] || '').trim();
        const displayName = fullName || shortName || '-';
        const memo = bank ? `${bank} ${type}`.trim() : type;

        if (depositAmount > 0) {
          this._bankParsed.deposits.push({ date, name: displayName, amount: depositAmount, memo, paymentMethod: type || '계좌이체', selected: true });
        } else if (withdrawAmount > 0) {
          this._bankParsed.withdrawals.push({ date, name: displayName, amount: withdrawAmount, memo, selected: true });
        }
        continue;
      }

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

    const clearFirstEl = document.getElementById('bankClearFirst');
    const clearFirst = clearFirstEl ? clearFirstEl.checked : false;
    console.log('[통장업로드] 초기화 체크박스 상태:', clearFirst);

    // 기존 데이터 삭제 옵션 (네이티브 confirm 사용 - Utils.confirm이 모달 DOM을 덮어쓰는 문제 회피)
    if (clearFirst) {
      const ok = window.confirm(
        '⚠️ 기존 입금내역 + 송금내역 전체를 삭제하고 새로 업로드합니다.\n\n되돌릴 수 없습니다. 계속하시겠습니까?'
      );
      if (!ok) { console.log('[통장업로드] 사용자가 초기화 취소'); return; }
    }

    const user = Auth.currentUser();
    const purpose = document.getElementById('bankDefaultPurpose').value;
    let depCount = 0, wdCount = 0, delDep = 0, delWd = 0;
    const errors = [];

    // 0) 기존 데이터 삭제
    if (clearFirst) {
      console.log('[통장업로드] 기존 데이터 삭제 시작');
      try {
        const allD = await DB.getAll('deposits');
        console.log(`[통장업로드] 삭제 대상 입금: ${allD.length}건`);
        for (const d of allD) {
          try { await DB.delete('deposits', d.id); delDep++; }
          catch (e) { console.error(`입금 삭제 실패 id=${d.id}:`, e); errors.push(`입금 ${d.id}`); }
        }
      } catch (e) { console.error('입금 전체 조회 실패:', e); errors.push('입금 조회'); }

      try {
        const allT = await DB.getAll('transferRecords');
        console.log(`[통장업로드] 삭제 대상 송금: ${allT.length}건`);
        for (const t of allT) {
          try { await DB.delete('transferRecords', t.id); delWd++; }
          catch (e) { console.error(`송금 삭제 실패 id=${t.id}:`, e); errors.push(`송금 ${t.id}`); }
        }
      } catch (e) { console.error('송금 전체 조회 실패:', e); errors.push('송금 조회'); }

      // 매칭된 세금계산서의 matchedDepositId도 해제
      try {
        const invoices = await DB.getAll('taxInvoiceRequests');
        for (const inv of invoices) {
          if (inv.matchedDepositId) {
            inv.matchedDepositId = null;
            inv.updatedAt = new Date().toISOString();
            await DB.update('taxInvoiceRequests', inv);
          }
        }
      } catch (e) { console.error('세금계산서 매칭 해제 실패:', e); errors.push('매칭 해제'); }

      console.log(`[통장업로드] 삭제 완료: 입금 ${delDep} / 송금 ${delWd} / 오류 ${errors.length}`);
      if (errors.length > 0) Utils.showToast(`⚠️ 일부 삭제 실패: ${errors.slice(0,3).join(', ')}`, 'warning', 5000);
    }

    for (const row of depSel) {
      await DB.add('deposits', {
        depositDate: row.date,
        depositorName: row.name,
        amount: row.amount,
        projectName: '',
        memo: row.memo || '',
        paymentMethod: row.paymentMethod || '계좌이체',
        orderNumber: '',
        partnerCompanyName: '',
        actionRequired: '',
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
        memo: row.memo || '',
        registeredBy: user.id,
        registeredByName: user.displayName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      wdCount++;
    }

    await DB.log('CREATE', 'bank', null, `통장내역 일괄 등록: 입금 ${depCount}건, 송금 ${wdCount}건 (초기화: 입금${delDep}/송금${delWd})`);
    this._bankParsed = { deposits: [], withdrawals: [] };

    Utils.closeModal();
    const parts = [`입금 ${depCount}건`, `송금 ${wdCount}건 등록`];
    if (clearFirst) parts.unshift(`기존 입금${delDep}/송금${delWd} 삭제`);
    Utils.showToast(parts.join(' · '), 'success');
    await this.render();
  },

  // ===== 세금계산서 엑셀 붙여넣기 (홈택스/위하고 매출 전자세금계산서 목록) =====
  _invoiceParsed: [],

  _openInvoicePasteModal() {
    this._invoiceParsed = [];
    Utils.openModal(`
      <div class="modal-header">
        <h3>📋 세금계산서 엑셀 붙여넣기</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-4);font-size:var(--font-size-sm);">
          <strong>✨ 헤더 행을 함께 복사해 주세요:</strong><br>
          <span class="text-muted">
            • <strong>홈택스:</strong> <code>작성일자 | 승인번호 | 공급받는자사업자등록번호 | 상호 | 합계금액 | 공급가액 | 세액 | 비고</code><br>
            • <strong>위하고:</strong> <code>일자 | Code | 거래처 | 유형 | 품명 | 공급가액 | 부가세 | 합계 | ...</code><br>
            헤더를 포함하면 컬럼 순서가 달라도 자동 매핑됩니다. 형식(홈택스/위하고) 자동 감지.
          </span>
        </div>

        <div class="form-group">
          <label>세금계산서 목록 붙여넣기 <span class="required">*</span></label>
          <textarea id="invoicePasteArea" class="form-control" rows="8"
                    placeholder="세금계산서 엑셀에서 복사한 데이터(헤더 포함)를 여기에 붙여넣기 (Ctrl+V)"
                    style="font-family:monospace;font-size:12px;"></textarea>
        </div>

        <div class="d-flex gap-2 mb-4">
          <button class="btn btn-secondary" onclick="FinanceMatchingModule._parseInvoicePaste()">🔍 데이터 분석</button>
        </div>

        <div id="invoiceParseResult" class="hidden">
          <div class="card mb-4">
            <div class="card-header" style="background:var(--color-primary-light);">
              <h3>📝 세금계산서 <span id="invoiceParsedCount" class="text-sm text-muted"></span></h3>
              <div class="d-flex gap-2">
                <label class="text-sm d-flex items-center gap-1" style="margin:0;">
                  <input type="checkbox" id="invoiceParsedAll" checked onchange="FinanceMatchingModule._toggleAllInvoices(this.checked)"> 전체 선택
                </label>
              </div>
            </div>
            <div class="card-body" style="padding:0;max-height:350px;overflow-y:auto;">
              <table class="data-table" id="invoiceParseTable">
                <thead>
                  <tr>
                    <th style="width:40px;"></th>
                    <th>작성일자</th>
                    <th>공급받는자</th>
                    <th>사업자번호</th>
                    <th class="text-right">공급가액</th>
                    <th class="text-right">세액</th>
                    <th class="text-right">합계</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </div>
          <div id="invoiceParseSummary" class="text-sm text-muted"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="invoiceSaveBtn" onclick="FinanceMatchingModule._saveInvoicePaste()" disabled>선택 항목 등록</button>
      </div>
    `, { size: 'modal-xl' });
  },

  // 세금계산서 헤더 매핑 (홈택스 + 위하고)
  // 홈택스: 작성일자/공급자상호/공급받는자상호/합계금액/공급가액/세액
  // 위하고: 일자/Code/거래처/유형/품명/공급가액/부가세/합계/차변계정/대변계정/관리/전표상태
  _parseInvoiceHeader(cols) {
    const mapping = {
      issueDate: -1, approvalNo: -1,
      partnerRegNumber: -1, partnerCompany: -1, partnerCeo: -1, partnerAddress: -1,
      supplyAmount: -1, taxAmount: -1, totalAmount: -1,
      memo: -1, format: null
    };

    // 위하고 형식 감지: "거래처" 단독 컬럼 존재 + "사업자등록번호" 없음
    const hasGeorae = cols.some(c => /^거래처\s*$/.test((c || '').trim()));
    const hasBizReg = cols.some(c => /사업자\s*등록번호|사업자번호/.test((c || '').trim()));

    if (hasGeorae && !hasBizReg) {
      // === 위하고 형식 ===
      mapping.format = 'wehago';
      for (let i = 0; i < cols.length; i++) {
        const c = (cols[i] || '').trim();
        if (!c) continue;
        if (/^일자$/.test(c) && mapping.issueDate < 0) { mapping.issueDate = i; continue; }
        if (/^Code$/i.test(c) && mapping.approvalNo < 0) { mapping.approvalNo = i; continue; }
        if (/^거래처$/.test(c) && mapping.partnerCompany < 0) { mapping.partnerCompany = i; continue; }
        if (/^품명$/.test(c) && mapping.memo < 0) { mapping.memo = i; continue; }
        if (/^공급\s*가액$/.test(c) && mapping.supplyAmount < 0) { mapping.supplyAmount = i; continue; }
        if (/^부가세$|^세액$/.test(c) && mapping.taxAmount < 0) { mapping.taxAmount = i; continue; }
        if (/^합계$|^합계\s*금액$/.test(c) && mapping.totalAmount < 0) { mapping.totalAmount = i; continue; }
      }
      // 최소 요건: 일자 + 거래처 + 공급가액
      if (mapping.issueDate >= 0 && mapping.partnerCompany >= 0 && mapping.supplyAmount >= 0) {
        return mapping;
      }
      return null;
    }

    // === 홈택스 형식 ===
    mapping.format = 'hometax';
    // "공급받는자" 영역 시작 index 추정 (두 번째 사업자등록번호 위치)
    let supplierEndIdx = -1;
    let bizRegCount = 0;
    for (let i = 0; i < cols.length; i++) {
      const c = (cols[i] || '').trim();
      if (/사업자\s*등록번호|사업자번호/.test(c)) {
        bizRegCount++;
        if (bizRegCount === 2) {
          mapping.partnerRegNumber = i;
          supplierEndIdx = i;
        }
      }
    }

    for (let i = 0; i < cols.length; i++) {
      const c = (cols[i] || '').trim();
      if (!c) continue;

      if (/^작성일자/.test(c) && mapping.issueDate < 0) { mapping.issueDate = i; continue; }
      if (/^승인번호/.test(c) && mapping.approvalNo < 0) { mapping.approvalNo = i; continue; }

      // 공급받는자 영역 이후의 상호/대표자/주소
      if (i > supplierEndIdx && supplierEndIdx > 0) {
        if (/^상호/.test(c) && mapping.partnerCompany < 0) { mapping.partnerCompany = i; continue; }
        if (/^대표자\s*명/.test(c) && mapping.partnerCeo < 0) { mapping.partnerCeo = i; continue; }
        if (/^주소/.test(c) && mapping.partnerAddress < 0) { mapping.partnerAddress = i; continue; }
      }

      if (/^합계\s*금액/.test(c) && mapping.totalAmount < 0) { mapping.totalAmount = i; continue; }
      if (/^공급\s*가액/.test(c) && mapping.supplyAmount < 0) { mapping.supplyAmount = i; continue; }
      if (/^세액/.test(c) && mapping.taxAmount < 0) { mapping.taxAmount = i; continue; }
      if (/^비고/.test(c) && mapping.memo < 0) { mapping.memo = i; continue; }
    }

    // 최소 요건: 작성일자 + 합계금액 + 공급받는자 상호
    if (mapping.issueDate >= 0 && mapping.totalAmount >= 0 && mapping.partnerCompany >= 0) {
      return mapping;
    }
    return null;
  },

  _parseInvoicePaste() {
    const raw = document.getElementById('invoicePasteArea').value.trim();
    if (!raw) {
      Utils.showToast('데이터를 붙여넣기 하세요.', 'error');
      return;
    }

    const lines = raw.split('\n').filter(l => l.trim());
    this._invoiceParsed = [];

    // 헤더 자동 탐색 (첫 10줄 이내)
    let mapping = null, startLine = 0;
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const cols = this._splitCols(lines[i]);
      const m = this._parseInvoiceHeader(cols);
      if (m) {
        mapping = m;
        startLine = i + 1;
        break;
      }
    }

    if (!mapping) {
      Utils.showToast('헤더 행을 찾을 수 없습니다. [홈택스: 작성일자/공급받는자 상호/합계금액] 또는 [위하고: 일자/거래처/공급가액] 헤더가 필요합니다.', 'error', 6000);
      return;
    }

    const formatLabel = mapping.format === 'wehago' ? '위하고' : '홈택스';
    const currentYear = new Date().getFullYear();

    // 데이터 파싱
    for (let i = startLine; i < lines.length; i++) {
      const cols = this._splitCols(lines[i]);
      if (cols.length < 3) continue;

      const rawDate = (cols[mapping.issueDate] || '').trim();
      // YYYY-MM-DD 또는 MM-DD (위하고) 모두 지원
      let issueDate = '';
      const m3 = rawDate.match(/(\d{2,4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
      const m2 = rawDate.match(/^(\d{1,2})[-.\/](\d{1,2})$/);
      if (m3) {
        let y = m3[1];
        if (y.length === 2) y = '20' + y;
        issueDate = `${y}-${m3[2].padStart(2, '0')}-${m3[3].padStart(2, '0')}`;
      } else if (m2) {
        // MM-DD: 현재 연도 사용
        issueDate = `${currentYear}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
      } else {
        continue;
      }

      const partnerCompany = (cols[mapping.partnerCompany] || '').trim();
      if (!partnerCompany) continue;

      const parseNum = (idx) => {
        if (idx < 0) return 0;
        const v = (cols[idx] || '').trim().replace(/[,\s]/g, '');
        const n = Number(v);
        return isNaN(n) ? 0 : n;
      };

      let supplyAmount = parseNum(mapping.supplyAmount);
      let taxAmount = parseNum(mapping.taxAmount);
      let totalAmount = parseNum(mapping.totalAmount);

      // 누락값 자동 계산
      if (!totalAmount && supplyAmount) totalAmount = supplyAmount + (taxAmount || Math.round(supplyAmount * 0.1));
      if (!supplyAmount && totalAmount) supplyAmount = Math.round(totalAmount / 1.1);
      if (!taxAmount && totalAmount && supplyAmount) taxAmount = totalAmount - supplyAmount;

      // 공급가액이 0이면 스킵 (빈 행)
      if (!supplyAmount && !totalAmount) continue;

      this._invoiceParsed.push({
        issueDate,
        approvalNo: mapping.approvalNo >= 0 ? (cols[mapping.approvalNo] || '').trim() : '',
        partnerRegNumber: mapping.partnerRegNumber >= 0 ? (cols[mapping.partnerRegNumber] || '').trim() : '',
        partnerCompanyName: partnerCompany,
        partnerCeoName: mapping.partnerCeo >= 0 ? (cols[mapping.partnerCeo] || '').trim() : '',
        partnerAddress: mapping.partnerAddress >= 0 ? (cols[mapping.partnerAddress] || '').trim() : '',
        totalAmount,
        supplyAmount,
        taxAmount,
        memo: mapping.memo >= 0 ? (cols[mapping.memo] || '').trim() : '',
        sourceFormat: formatLabel,
        selected: true
      });
    }

    if (this._invoiceParsed.length === 0) {
      Utils.showToast('인식 가능한 세금계산서 내역이 없습니다.', 'warning', 5000);
      return;
    }

    Utils.showToast(`[${formatLabel}] ${this._invoiceParsed.length}건의 세금계산서 인식됨`, 'success');
    this._renderInvoiceParseResult();
  },

  _renderInvoiceParseResult() {
    document.getElementById('invoiceParseResult').classList.remove('hidden');
    document.getElementById('invoiceParsedCount').textContent = `(${this._invoiceParsed.length}건)`;

    const tbody = document.querySelector('#invoiceParseTable tbody');
    tbody.innerHTML = this._invoiceParsed.map((r, i) => `
      <tr>
        <td><input type="checkbox" data-idx="${i}" ${r.selected ? 'checked' : ''} onchange="FinanceMatchingModule._toggleInvoiceRow(${i}, this.checked)"></td>
        <td>${Utils.escapeHtml(r.issueDate)}</td>
        <td class="fw-medium">${Utils.escapeHtml(r.partnerCompanyName)}</td>
        <td class="text-xs">${Utils.escapeHtml(r.partnerRegNumber)}</td>
        <td class="text-right">${Utils.formatCurrency(r.supplyAmount)}</td>
        <td class="text-right">${Utils.formatCurrency(r.taxAmount)}</td>
        <td class="text-right fw-medium">${Utils.formatCurrency(r.totalAmount)}</td>
        <td class="text-xs text-muted">${Utils.escapeHtml((r.memo || '').slice(0, 30))}</td>
      </tr>
    `).join('');

    this._updateInvoiceParseSummary();
    document.getElementById('invoiceSaveBtn').disabled = false;
  },

  _toggleInvoiceRow(idx, checked) {
    this._invoiceParsed[idx].selected = checked;
    this._updateInvoiceParseSummary();
  },

  _toggleAllInvoices(checked) {
    this._invoiceParsed.forEach((r, i) => {
      r.selected = checked;
      const cb = document.querySelector(`#invoiceParseTable input[data-idx="${i}"]`);
      if (cb) cb.checked = checked;
    });
    this._updateInvoiceParseSummary();
  },

  _updateInvoiceParseSummary() {
    const sel = this._invoiceParsed.filter(r => r.selected);
    const total = sel.reduce((s, r) => s + (r.totalAmount || 0), 0);
    document.getElementById('invoiceParseSummary').innerHTML = `
      ✅ 등록 예정: <strong>${sel.length}건</strong> · 합계 <strong>${Utils.formatCurrency(total)}</strong>
    `;
    document.getElementById('invoiceSaveBtn').disabled = sel.length === 0;
  },

  async _saveInvoicePaste() {
    const sel = this._invoiceParsed.filter(r => r.selected);
    if (sel.length === 0) return;

    const user = Auth.currentUser();
    // 같은 승인번호/거래처+금액+일자 조합 중복 체크용 기존 데이터 로드
    const existing = await DB.getAll('taxInvoiceRequests');

    let added = 0, skipped = 0, failed = 0;
    for (const row of sel) {
      try {
        // 중복 체크 (승인번호 있으면 승인번호, 없으면 상호+금액+일자)
        const dup = existing.find(e =>
          (row.approvalNo && e.hometaxApprovalNo === row.approvalNo) ||
          (e.partnerCompanyName === row.partnerCompanyName &&
           e.totalAmount === row.totalAmount &&
           e.issueDate === row.issueDate)
        );
        if (dup) { skipped++; continue; }

        // 요청번호 생성 (INV-YYMMDD-순번)
        const today = new Date();
        const yy = String(today.getFullYear()).slice(-2);
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const prefix = `INV-${yy}${mm}${dd}-`;
        const sameDay = existing.filter(e => (e.requestNumber || '').startsWith(prefix)).length + added;
        const requestNumber = `${prefix}${String(sameDay + 1).padStart(3, '0')}`;

        await DB.add('taxInvoiceRequests', {
          requestNumber,
          hometaxApprovalNo: row.approvalNo || '',
          partnerRegNumber: row.partnerRegNumber,
          partnerCompanyName: row.partnerCompanyName,
          partnerCeoName: row.partnerCeoName,
          partnerAddress: row.partnerAddress,
          partnerContact: '',
          partnerEmail: '',
          supplyAmount: row.supplyAmount,
          taxAmount: row.taxAmount,
          totalAmount: row.totalAmount,
          issueDate: row.issueDate,
          projectName: row.memo || '',
          memo: row.memo || '',
          status: '발행완료',
          matchedDepositId: null,
          requesterId: user.id,
          requesterName: user.displayName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          importedFrom: 'paste'
        });
        added++;
      } catch (e) {
        console.error('세금계산서 등록 실패:', e);
        failed++;
      }
    }

    await DB.log('CREATE', 'taxInvoiceRequests', null, `세금계산서 일괄 등록: ${added}건 (스킵 ${skipped}, 실패 ${failed})`);
    this._invoiceParsed = [];

    Utils.closeModal();
    const parts = [`등록 ${added}건`];
    if (skipped > 0) parts.push(`중복 스킵 ${skipped}건`);
    if (failed > 0) parts.push(`실패 ${failed}건`);
    Utils.showToast(parts.join(' / '), 'success');
    await this.render();
  },

  // ===== 세금계산서 개별 등록 (발행완료 상태) =====
  _openInvoiceAddModal() {
    const today = new Date().toISOString().slice(0, 10);
    Utils.openModal(`
      <div class="modal-header">
        <h3>+ 세금계산서 개별 등록</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label>작성일자 <span class="required">*</span></label>
            <input type="date" id="invIssueDate" class="form-control" value="${today}">
          </div>
          <div class="form-group">
            <label>승인번호 (선택)</label>
            <input type="text" id="invApprovalNo" class="form-control" placeholder="홈택스 승인번호">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>공급받는자 상호 <span class="required">*</span></label>
            <input type="text" id="invPartnerCompany" class="form-control" placeholder="거래처명">
          </div>
          <div class="form-group">
            <label>사업자등록번호</label>
            <input type="text" id="invPartnerReg" class="form-control" placeholder="000-00-00000">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>대표자명</label>
            <input type="text" id="invPartnerCeo" class="form-control">
          </div>
          <div class="form-group">
            <label>공급가액 <span class="required">*</span></label>
            <input type="number" id="invSupplyAmount" class="form-control" placeholder="0" oninput="FinanceMatchingModule._onInvSupplyChange()">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>세액</label>
            <input type="number" id="invTaxAmount" class="form-control" placeholder="0">
          </div>
          <div class="form-group">
            <label>합계금액</label>
            <input type="number" id="invTotalAmount" class="form-control" placeholder="0" readonly style="background:#F8FAFC;">
          </div>
        </div>
        <div class="form-group">
          <label>프로젝트명 / 비고</label>
          <input type="text" id="invProjectName" class="form-control" placeholder="현장명 또는 비고">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="FinanceMatchingModule._saveInvoiceAdd()">등록</button>
      </div>
    `);
  },

  _onInvSupplyChange() {
    const supply = Number(document.getElementById('invSupplyAmount').value) || 0;
    const tax = Math.round(supply * 0.1);
    document.getElementById('invTaxAmount').value = tax;
    document.getElementById('invTotalAmount').value = supply + tax;
  },

  async _saveInvoiceAdd() {
    const issueDate = document.getElementById('invIssueDate').value;
    const approvalNo = document.getElementById('invApprovalNo').value.trim();
    const partnerCompany = document.getElementById('invPartnerCompany').value.trim();
    const partnerReg = document.getElementById('invPartnerReg').value.trim();
    const partnerCeo = document.getElementById('invPartnerCeo').value.trim();
    const supply = Number(document.getElementById('invSupplyAmount').value) || 0;
    const tax = Number(document.getElementById('invTaxAmount').value) || 0;
    let total = Number(document.getElementById('invTotalAmount').value) || 0;
    if (!total) total = supply + tax;
    const projectName = document.getElementById('invProjectName').value.trim();

    if (!issueDate || !partnerCompany || !supply) {
      Utils.showToast('작성일자, 공급받는자 상호, 공급가액을 입력하세요.', 'error');
      return;
    }

    try {
      const user = Auth.currentUser();
      const existing = await DB.getAll('taxInvoiceRequests');
      const today = new Date();
      const yy = String(today.getFullYear()).slice(-2);
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const prefix = `INV-${yy}${mm}${dd}-`;
      const sameDay = existing.filter(e => (e.requestNumber || '').startsWith(prefix)).length;
      const requestNumber = `${prefix}${String(sameDay + 1).padStart(3, '0')}`;

      await DB.add('taxInvoiceRequests', {
        requestNumber,
        hometaxApprovalNo: approvalNo,
        partnerRegNumber: partnerReg,
        partnerCompanyName: partnerCompany,
        partnerCeoName: partnerCeo,
        partnerAddress: '',
        partnerContact: '',
        partnerEmail: '',
        supplyAmount: supply,
        taxAmount: tax,
        totalAmount: total,
        issueDate,
        projectName,
        memo: projectName,
        status: '발행완료',
        matchedDepositId: null,
        requesterId: user.id,
        requesterName: user.displayName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      await DB.log('CREATE', 'taxInvoiceRequests', null, `세금계산서 개별 등록: ${partnerCompany} ${Utils.formatCurrency(total)}`);

      Utils.closeModal();
      Utils.showToast('세금계산서가 등록되었습니다.', 'success');
      await this.render();
    } catch (e) {
      Utils.showToast('등록 실패: ' + e.message, 'error');
    }
  },

  destroy() {}
};

window.FinanceMatchingModule = FinanceMatchingModule;
