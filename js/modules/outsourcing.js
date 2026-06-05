/* ============================================
   대림프로젝트 정산관리 모듈 (구 외주설계 관리대장)
   - 프로젝트별 입금금액 / 외주지급누계 / 잔액 관리
   - 외주지급누계는 송금내역(transferRecords) 자동 합산
   - 권한: 관리자 + 'outsourcing' 메뉴 권한 보유자
   ============================================ */

const OutsourcingModule = {
  container: null,

  STATUS_OPTIONS: ['진행중', '정산예정', '완료', '보류'],

  // v2 재설계: 4단계 흐름 탭 구조
  // 탭: overview(종합) / sales(매출) / purchase(매입) / transfer(송금) / profit(이익+결의서)
  _activeTab: 'overview',
  _expandedProjectId: null, // 종합 탭에서 펼친 프로젝트

  // 종합 데이터 캐시 (한 번에 로드해서 모든 탭이 공유)
  _data: { projects: [], deposits: [], transfers: [], purchases: [], settlements: [], expenses: [] },

  // 지출결의서 작업 중 (탭 5 내 업로드 화면)
  _expenseDraft: null,

  // pdf.js 로드 캐시
  _pdfjsLoaded: false,
  _pdfjsLoadPromise: null,

  async init(container, action) {
    this.container = container;
    // 레거시 라우트 호환: /outsourcing/detail?id=xxx → 종합 탭에서 해당 프로젝트 펼치기
    if (action === 'detail') {
      const { id } = Router.getQuery();
      this._expandedProjectId = id || null;
      this._activeTab = 'overview';
    } else {
      this._activeTab = 'overview';
      this._expandedProjectId = null;
    }
    await this._loadAllData();
    this._render();
  },

  // 모든 컬렉션 한 번에 로드 (탭 전환 시 재로드 X — 상태 변경 액션 후만 재로드)
  async _loadAllData() {
    const [projects, deposits, transfers, purchases, settlements, expenses] = await Promise.all([
      DB.getAll('outsourcingProjects'),
      DB.getAll('deposits'),
      DB.getAll('transferRecords'),
      DB.getAll('purchaseInvoices'),
      DB.getAll('settlements'),
      DB.getAll('expenseReports')
    ]);
    this._data = { projects, deposits, transfers, purchases, settlements, expenses };
    // 기존 캐시도 같이 채워 줘서 기존 메서드들이 동작하도록
    this._buildLegacyCaches();
  },

  // 기존 _loadTransferTotals 가 채우던 캐시들을 새 _data 로부터 채움
  _buildLegacyCaches() {
    const { projects, deposits, transfers, purchases, settlements } = this._data;
    const settlementsByKey = {};
    for (const s of settlements) {
      const name = (s.clientName || '').trim();
      if (!name) continue;
      const cleanName = name.replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s/g, '');
      if (cleanName.length < 2) continue;
      if (!settlementsByKey[cleanName]) settlementsByKey[cleanName] = [];
      settlementsByKey[cleanName].push(s);
    }
    this._settlementsByMatchKey = settlementsByKey;

    const totals = {};
    const transferDates = {};
    const purchaseInfo = {};
    const depositInfo = {};

    for (const t of transfers) {
      const key = (t.projectName || '').trim();
      if (!key) continue;
      totals[key] = (totals[key] || 0) + (Number(t.amount) || 0);
      if (!transferDates[key]) transferDates[key] = [];
      transferDates[key].push({ date: t.transferDate, amount: t.amount, purchaseId: t.matchedPurchaseId });
    }

    const purchaseToProjects = {};
    for (const t of transfers) {
      if (!t.matchedPurchaseId) continue;
      const projKey = (t.projectName || '').trim();
      if (!projKey) continue;
      const pid = String(t.matchedPurchaseId);
      if (!purchaseToProjects[pid]) purchaseToProjects[pid] = new Set();
      purchaseToProjects[pid].add(projKey);
    }

    for (const key of Object.keys(transferDates)) {
      const items = transferDates[key]
        .filter(t => t.purchaseId)
        .map(t => {
          const purchase = purchases.find(p => String(p.id) === String(t.purchaseId));
          if (!purchase) return null;
          const groupProjects = Array.from(purchaseToProjects[String(t.purchaseId)] || []);
          return {
            purchaseId: t.purchaseId, issueDate: purchase.issueDate, totalAmount: purchase.totalAmount,
            partnerCompanyName: purchase.partnerCompanyName, groupSize: groupProjects.length, groupNames: groupProjects
          };
        }).filter(Boolean);
      const seen = new Set();
      purchaseInfo[key] = items.filter(p => { if (seen.has(p.purchaseId)) return false; seen.add(p.purchaseId); return true; });
    }

    for (const p of projects) {
      const projName = (p.projectName || '').trim();
      if (!projName) continue;
      const cleanName = projName.split(' - ')[0].trim();
      const keywords = cleanName.replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s/g, '').match(/.{2,}/g) || [cleanName];
      const matches = deposits.filter(d => {
        const depName = (d.depositorName || '').replace(/\s/g, '');
        return keywords.some(k => depName.includes(k));
      });
      if (matches.length > 0) {
        depositInfo[projName] = matches.map(d => ({ date: d.depositDate, amount: d.amount, name: d.depositorName }));
      }
    }

    this._transferTotalsByProject = totals;
    this._transferDatesByProject = transferDates;
    this._purchaseInfoByProject = purchaseInfo;
    this._depositInfoByProject = depositInfo;
  },

  // 탭 전환
  async _setTab(tab) {
    this._activeTab = tab;
    this._expandedProjectId = null;
    this._render();
  },

  // 프로젝트 카드 펼침/접힘
  _toggleExpand(id) {
    this._expandedProjectId = (String(this._expandedProjectId) === String(id)) ? null : id;
    this._render();
  },

  // 액션 후 데이터 갱신 (CRUD/업로드 성공 시 호출)
  async _reload() {
    await this._loadAllData();
    this._render();
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
  _settlementsByMatchKey: {},      // 발주-외주 정산표 매칭용 (이사님 명세서)

  async _loadTransferTotals() {
    const allTransfers = await DB.getAll('transferRecords');
    const allDeposits = await DB.getAll('deposits');
    const allPurchases = await DB.getAll('purchaseInvoices');
    const allSettlements = await DB.getAll('settlements');

    // 0) 발주-외주 정산표 인덱싱 (매출처명 키워드로 매칭)
    const settlementsByKey = {};
    for (const s of allSettlements) {
      const name = (s.clientName || '').trim();
      if (!name) continue;
      // 키워드 추출 (매출처명 정리)
      const cleanName = name.replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s/g, '');
      if (cleanName.length < 2) continue;
      if (!settlementsByKey[cleanName]) settlementsByKey[cleanName] = [];
      settlementsByKey[cleanName].push(s);
    }
    this._settlementsByMatchKey = settlementsByKey;

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
    // ⚠️ projectName에 "여태성 - 2026-04-13" 같은 식별자 형식이면 첫 " - " 이전만 사용
    const projects = await DB.getAll('outsourcingProjects');
    for (const p of projects) {
      const projName = (p.projectName || '').trim();
      if (!projName) continue;
      // 매출처명만 추출 (첫 " - " 이전)
      const cleanName = projName.split(' - ')[0].trim();
      // 키워드 추출 (회사 접미사 제거)
      const keywords = cleanName
        .replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s/g, '')
        .match(/.{2,}/g) || [cleanName];
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

  // ============================================
  // 메인 렌더: 헤더 + 4단계 합계카드 + 탭 + 탭 컨텐츠
  // ============================================
  // 호환: 외부/내부에서 OutsourcingModule.render() 호출 시 데이터 재로드 후 렌더
  // (기존 _save / _delete / _bulkSave 등 다수 메서드가 this.render() 호출함)
  async render() { return this._reload(); },

  _render() {
    const isAdmin = Auth.isAdmin();
    const s = this._computeSummary();
    this.container.innerHTML = `
      <div class="page-header">
        <h2>📒 대림프로젝트 정산관리</h2>
        <div class="page-actions">
          <button class="btn btn-ghost" onclick="UserGuideModule && UserGuideModule.showModal && UserGuideModule.showModal('outsourcing')" title="사용가이드">📖 도움말</button>
          <button class="btn btn-secondary" onclick="OutsourcingModule._openCombinedUpload()" title="매입 세금계산서(위하고 엑셀) + 지출결의서(PDF) 함께 업로드 → 자동 매칭">📥 매입세금+결의서 등록</button>
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadReportPDF()">📄 전체 PDF</button>
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadListExcel()">📊 리스트 엑셀</button>
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadTemplate()">📥 양식</button>
          ${isAdmin ? `<button class="btn btn-secondary" onclick="OutsourcingModule._openUploadModal()">📤 일괄 업로드</button>` : ''}
          ${isAdmin ? `<button class="btn btn-primary" onclick="OutsourcingModule._openAddModal()">+ 프로젝트 등록</button>` : ''}
        </div>
      </div>

      <!-- 4단계 흐름 합계 카드 -->
      <div class="summary-cards">
        <div class="summary-card" style="border-left:4px solid #16A34A;">
          <div class="card-icon green">💰</div>
          <div class="card-info">
            <div class="card-label">① 매출 발생</div>
            <div class="card-value">${Utils.formatCurrency(s.totalSales)}</div>
            <div class="text-xs text-muted">${s.projectCount}개 프로젝트</div>
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid #2563EB;">
          <div class="card-icon cyan">📥</div>
          <div class="card-info">
            <div class="card-label">② 매입 세금계산서</div>
            <div class="card-value">${Utils.formatCurrency(s.totalPurchases)}</div>
            <div class="text-xs text-muted">${s.purchaseCount}건</div>
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid #F97316;">
          <div class="card-icon orange">💸</div>
          <div class="card-info">
            <div class="card-label">③ 외주 송금</div>
            <div class="card-value">${Utils.formatCurrency(s.totalTransfers)}</div>
            <div class="text-xs text-muted">${s.transferCount}건</div>
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid ${s.totalProfit < 0 ? '#DC2626' : '#16A34A'};">
          <div class="card-icon ${s.totalProfit < 0 ? 'red' : 'green'}">📊</div>
          <div class="card-info">
            <div class="card-label">④ 순이익 (① − ③)</div>
            <div class="card-value" style="${s.totalProfit < 0 ? 'color:var(--color-danger);' : 'color:var(--color-success);'}">${Utils.formatCurrency(s.totalProfit)}</div>
            <div class="text-xs text-muted">${s.totalProfit >= 0 ? '흑자' : '적자'}</div>
          </div>
        </div>
      </div>

      <!-- 종합 테이블 (탭 제거 — 행 클릭 시 흐름 모달로 상세 확인) -->
      <div class="card mt-4" style="padding:var(--sp-4);">
        ${this._renderTabOverview()}
      </div>
    `;
  },

  // (v2 g 이후 사용 안 함 — 호환용 보존) 탭 전환 호출이 남아있어도 안전
  _renderTabButton(tab, label, tooltip) { return ''; },
  _renderTabContent() { return this._renderTabOverview(); },

  // ============================================
  // 합계 계산
  // ============================================
  _computeSummary() {
    const { projects, deposits, transfers, purchases, expenses } = this._data;
    const totalSales = projects.reduce((s, p) => s + (Number(p.depositAmount) || 0), 0);
    const daerimTransfers = transfers.filter(t => this._isDaerimTransfer(t));
    const totalTransfers = daerimTransfers.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const daerimPurchases = purchases.filter(p => this._isDaerimPurchase(p));
    const totalPurchases = daerimPurchases.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);
    const daerimDeposits = deposits.filter(d => this._isDaerimDeposit(d));
    return {
      totalSales, totalPurchases, totalTransfers,
      totalProfit: totalSales - totalTransfers,
      projectCount: projects.length,
      depositCount: daerimDeposits.length,
      transferCount: daerimTransfers.length,
      purchaseCount: daerimPurchases.length,
      expenseCount: expenses.length
    };
  },

  // ============================================
  // 대림 관련 레코드 판별
  // ============================================
  _isDaerimTransfer(t) {
    const projectKeys = new Set(this._data.projects.map(p => (p.projectName || '').trim()).filter(Boolean));
    if (projectKeys.has((t.projectName || '').trim())) return true;
    const recipient = (t.recipientName || '').replace(/\s/g, '');
    return /대림건축|대림ENG|홍정란/.test(recipient);
  },
  _isDaerimPurchase(p) {
    const partner = (p.partnerCompanyName || '').replace(/\s/g, '');
    return /대림건축|대림ENG/.test(partner);
  },
  _isDaerimDeposit(d) {
    const depName = (d.depositorName || '').replace(/\s/g, '');
    for (const p of this._data.projects) {
      const cleanProj = (p.projectName || '').split(' - ')[0].replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s/g, '');
      if (cleanProj.length >= 2 && depName.includes(cleanProj.slice(0, 2))) return true;
    }
    return false;
  },

  // ============================================
  // 탭 1: 종합 — 프로젝트 카드 + 인라인 펼침
  // ============================================
  // ============================================
  // 탭 1 (종합): 돈 중심 간결 테이블 — 행 클릭 시 흐름 모달 팝업
  // ============================================
  _renderTabOverview() {
    const projects = this._data.projects.slice().reverse();
    if (projects.length === 0) {
      return `<div class="empty-state"><div class="empty-icon">📒</div>
        <h3>등록된 프로젝트가 없습니다</h3>
        <p>상단 [+ 프로젝트 등록] 버튼으로 시작하세요.</p></div>`;
    }

    // 합계
    const totals = projects.reduce((acc, p) => {
      const st = this._computeProjectStats(p);
      acc.sales += st.depositAmount;
      acc.outsource += st.transferTotal;
      acc.profit += st.profit;
      return acc;
    }, { sales: 0, outsource: 0, profit: 0 });

    const rows = projects.map(p => {
      const st = this._computeProjectStats(p);
      const fullName = p.projectName || '-';
      const dashIdx = fullName.indexOf(' - ');
      const displayName = dashIdx > 0 ? fullName.slice(0, dashIdx) : fullName;
      const identifier = dashIdx > 0 ? fullName.slice(dashIdx + 3).trim() : '';
      const profitColor = st.profit < 0 ? 'color:#DC2626;' : (st.profit > 0 ? 'color:#16A34A;' : 'color:#64748B;');

      return `
        <tr style="cursor:pointer;" onclick="OutsourcingModule._openProjectModal('${p.id}')"
            onmouseover="this.style.background='#F0F9FF';" onmouseout="this.style.background='';">
          <td>
            <div class="fw-medium">${Utils.escapeHtml(displayName)}</div>
            ${identifier ? `<div class="text-xs text-muted" title="프로젝트 식별자 (같은 매출처 중복 구분용)">${Utils.escapeHtml(identifier)}</div>` : ''}
          </td>
          <td class="text-right amount fw-medium">${Utils.formatCurrency(st.depositAmount)}</td>
          <td class="text-right amount" style="color:#64748B;">${Utils.formatCurrency(st.transferTotal)}</td>
          <td class="text-right amount fw-medium" style="${profitColor}font-size:1rem;">${Utils.formatCurrency(st.profit)}</td>
          <td class="text-center">${this._statusBadge(p.status)}</td>
        </tr>`;
    }).join('');

    return `
      <div class="text-sm text-muted mb-3">💡 행 클릭 시 매출→매입→송금→순이익 흐름(날짜 포함)을 팝업으로 확인할 수 있습니다.</div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:36%;">매출처</th>
              <th class="text-right" style="width:18%;">💰 매출액</th>
              <th class="text-right" style="width:18%;">💸 용역비 (외주송금)</th>
              <th class="text-right" style="width:18%;">📊 순이익</th>
              <th class="text-center" style="width:10%;">진행상태</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:#F8FAFC;font-weight:700;">
              <td class="text-right">합계 (${projects.length}건)</td>
              <td class="text-right amount">${Utils.formatCurrency(totals.sales)}</td>
              <td class="text-right amount" style="color:#64748B;">${Utils.formatCurrency(totals.outsource)}</td>
              <td class="text-right amount" style="color:${totals.profit >= 0 ? '#16A34A' : '#DC2626'};font-size:1.05rem;">${Utils.formatCurrency(totals.profit)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  },

  // ============================================
  // 프로젝트 흐름 모달 (행 클릭 시) — 매출→매입→송금→순이익 세로 흐름
  // ============================================
  async _openProjectModal(projectId) {
    const p = await DB.get('outsourcingProjects', projectId);
    if (!p) { Utils.showToast('프로젝트 없음', 'error'); return; }

    const stats = this._computeProjectStats(p);
    const isAdmin = Auth.isAdmin();
    const fullName = p.projectName || '-';
    const dashIdx = fullName.indexOf(' - ');
    const displayName = dashIdx > 0 ? fullName.slice(0, dashIdx) : fullName;
    const identifier = dashIdx > 0 ? fullName.slice(dashIdx + 3).trim() : '';
    const profitRate = stats.depositAmount > 0 ? ((stats.profit / stats.depositAmount) * 100).toFixed(2) : '0.00';
    const profitColor = stats.profit < 0 ? '#DC2626' : '#16A34A';

    // 각 단계 박스 내용 (여러 건이면 줄바꿈으로 표시)
    const fmtRow = (label1, val1, label2, val2, label3, val3) => `
      <div style="display:grid;grid-template-columns:1.2fr 1.2fr 1fr;gap:var(--sp-3);padding:var(--sp-2) var(--sp-3);align-items:center;">
        <div><span class="text-xs text-muted">${label1}</span><br><span class="fw-medium">${val1}</span></div>
        <div><span class="text-xs text-muted">${label2}</span><br><span class="fw-medium">${val2}</span></div>
        <div class="text-right"><span class="text-xs text-muted">${label3}</span><br><span class="fw-medium" style="font-size:1rem;">${val3}</span></div>
      </div>`;

    const salesContent = stats.depositList.length === 0
      ? `<div class="text-center text-muted" style="padding:var(--sp-3);">아직 매출(입금) 데이터가 없습니다</div>`
      : stats.depositList.map(d => fmtRow('매출일', Utils.formatDate(d.date), '입금자', Utils.escapeHtml(d.name || '-'), '금액', Utils.formatCurrency(d.amount))).join('<hr style="margin:0;border:0;border-top:1px solid #E2E8F0;">');

    const purchaseContent = stats.linkedPurchases.length === 0
      ? `<div class="text-center text-muted" style="padding:var(--sp-3);">매입 세금계산서가 아직 연결되지 않았습니다<br><span class="text-xs">(외주업체로부터 받은 계산서를 송금에 연결하면 여기 표시)</span></div>`
      : stats.linkedPurchases.map(pi => fmtRow('발행일', Utils.formatDate(pi.issueDate), '매입처', Utils.escapeHtml(pi.partnerCompanyName || '-'), '금액', Utils.formatCurrency(pi.totalAmount))).join('<hr style="margin:0;border:0;border-top:1px solid #E2E8F0;">');

    const transferContent = stats.transfers.length === 0
      ? `<div class="text-center text-muted" style="padding:var(--sp-3);">외주 송금 내역이 아직 없습니다</div>`
      : stats.transfers.map(t => fmtRow('송금일', Utils.formatDate(t.transferDate), '수취인', Utils.escapeHtml(t.recipientName || '-'), '금액', Utils.formatCurrency(t.amount))).join('<hr style="margin:0;border:0;border-top:1px solid #E2E8F0;">');

    const arrow = `<div style="text-align:center;color:#CBD5E1;font-size:1.6rem;line-height:1;margin:8px 0;">↓</div>`;
    const stepHeader = (n, label, color) => `
      <div style="display:flex;align-items:center;gap:var(--sp-2);margin:var(--sp-2) 0 6px 0;">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${color};color:white;font-weight:700;font-size:0.85rem;">${n}</span>
        <h4 style="margin:0;color:${color};font-size:1rem;">${label}</h4>
      </div>`;

    Utils.openModal(`
      <div class="modal-header">
        <h3 style="display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;">
          ${Utils.escapeHtml(displayName)}
          ${identifier ? `<span class="text-sm text-muted" style="font-weight:normal;">${Utils.escapeHtml(identifier)}</span>` : ''}
          ${this._statusBadge(p.status)}
        </h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:78vh;overflow-y:auto;background:#FAFBFC;">

        <!-- 기본 정보 -->
        <div class="card mb-3">
          <div class="card-body" style="padding:var(--sp-3);">
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-3);font-size:0.92rem;">
              <div><span class="text-xs text-muted">발주처</span><br><strong>${Utils.escapeHtml(p.clientName || '-')}</strong></div>
              <div><span class="text-xs text-muted">외주업체</span><br><strong>${Utils.escapeHtml(p.vendorName || '-')}</strong></div>
              <div><span class="text-xs text-muted">계약일</span><br><strong>${p.contractDate ? Utils.formatDate(p.contractDate) : '-'}</strong></div>
            </div>
            ${p.memo ? `<div style="margin-top:var(--sp-2);padding:var(--sp-2) var(--sp-3);background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:4px;white-space:pre-wrap;font-size:0.85rem;">📝 ${Utils.escapeHtml(p.memo)}</div>` : ''}
          </div>
        </div>

        <!-- ① 매출 -->
        ${stepHeader(1, '매출 발생', '#16A34A')}
        <div class="card" style="border-left:4px solid #16A34A;">
          <div class="card-body" style="padding:0;">${salesContent}</div>
        </div>

        ${arrow}

        <!-- ② 매입 세금계산서 -->
        ${stepHeader(2, '매입 세금계산서 (외주업체 발행)', '#2563EB')}
        <div class="card" style="border-left:4px solid #2563EB;">
          <div class="card-body" style="padding:0;">${purchaseContent}</div>
        </div>

        ${arrow}

        <!-- ③ 외주 송금 -->
        ${stepHeader(3, '외주 송금 (용역비 지출)', '#F97316')}
        <div class="card" style="border-left:4px solid #F97316;">
          <div class="card-body" style="padding:0;">${transferContent}</div>
        </div>

        ${arrow}

        <!-- ④ 최종 정산 -->
        ${stepHeader(4, '최종 정산 (순이익)', profitColor)}
        <div class="card" style="background:linear-gradient(135deg, ${stats.profit >= 0 ? '#10B981' : '#DC2626'} 0%, ${stats.profit >= 0 ? '#059669' : '#991B1B'} 100%);color:white;border:none;">
          <div class="card-body" style="padding:var(--sp-4);">
            <div style="font-size:0.95rem;line-height:1.9;">
              <div style="display:flex;justify-content:space-between;"><span>매출액</span><strong>${Utils.formatCurrency(stats.depositAmount)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>− 용역비 (외주 송금)</span><strong>${Utils.formatCurrency(stats.transferTotal)}</strong></div>
              <div style="border-top:1px solid rgba(255,255,255,0.35);margin:var(--sp-2) 0;"></div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;">
                <span style="font-size:1.05rem;">순이익</span>
                <span style="font-size:1.5rem;font-weight:700;">${Utils.formatCurrency(stats.profit)} <span style="font-size:0.85rem;opacity:0.9;font-weight:400;">(수익률 ${profitRate}%)</span></span>
              </div>
            </div>
          </div>
        </div>

      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        <div>
          ${isAdmin ? `<button class="btn btn-ghost text-danger" onclick="OutsourcingModule._deleteFromModal('${p.id}')">🗑️ 삭제</button>` : ''}
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadSinglePDF('${p.id}')">📄 PDF</button>
          <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
          ${isAdmin ? `<button class="btn btn-primary" onclick="Utils.closeModal();OutsourcingModule._edit('${p.id}')">✏️ 수정</button>` : ''}
        </div>
      </div>
    `, { size: 'modal-lg' });
  },

  // 모달에서 삭제 → 모달 닫기 + 데이터 갱신
  async _deleteFromModal(id) {
    if (!window.confirm('이 프로젝트를 삭제하시겠습니까? (되돌릴 수 없음)')) return;
    try {
      await DB.delete('outsourcingProjects', id);
      await DB.log('DELETE', 'outsourcingProjects', id, '프로젝트 삭제 (흐름 모달)');
      Utils.showToast('프로젝트가 삭제되었습니다.', 'success');
      Utils.closeModal();
      await this._reload();
    } catch (e) {
      console.error('[Outsourcing] 모달 삭제 실패:', e);
      Utils.showToast('삭제 실패: ' + e.message, 'error');
    }
  },

  // 한 프로젝트의 4단계 통계 계산
  _computeProjectStats(p) {
    const projectKey = (p.projectName || '').trim();
    const { transfers, purchases, deposits, settlements, expenses } = this._data;

    const projTransfers = transfers.filter(t => (t.projectName || '').trim() === projectKey)
      .sort((a, b) => (a.transferDate || '').localeCompare(b.transferDate || ''));
    const transferTotal = projTransfers.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    const linkedPurchaseIds = new Set(projTransfers.map(t => t.matchedPurchaseId).filter(Boolean).map(String));
    const linkedPurchases = purchases.filter(pi => linkedPurchaseIds.has(String(pi.id)))
      .sort((a, b) => (a.issueDate || '').localeCompare(b.issueDate || ''));
    const purchaseTotal = linkedPurchases.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);

    // 매출 입금 (정산표 우선)
    const fullName = projectKey;
    const dashIdx = fullName.indexOf(' - ');
    const displayName = dashIdx > 0 ? fullName.slice(0, dashIdx) : fullName;
    const cleanName = displayName.replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s/g, '');
    const matchedSettlements = this._settlementsByMatchKey[cleanName] || [];

    let depositList = [];
    if (matchedSettlements.length > 0) {
      for (const s of matchedSettlements) {
        if (s.depositDate && s.depositAmount) depositList.push({ date: s.depositDate, amount: s.depositAmount, name: s.clientName });
      }
    } else {
      depositList = (this._depositInfoByProject[projectKey] || []);
    }
    const depositAmount = Number(p.depositAmount) || 0;
    const profit = depositAmount - transferTotal;

    // 결의서
    const transferIdSet = new Set(projTransfers.map(t => String(t.id)));
    const projectDepositIds = new Set();
    for (const li of depositList) {
      const m = deposits.find(d => d.depositorName && li.name &&
        d.depositorName.includes(li.name.slice(0, 2)) &&
        Number(d.amount) === Number(li.amount) && d.depositDate === li.date);
      if (m) projectDepositIds.add(String(m.id));
    }
    const linkedExpenses = expenses.filter(er => {
      const trIds = (er.matchedTransferIds || []).map(String);
      const depIds = (er.matchedDepositIds || []).map(String);
      return trIds.some(id => transferIdSet.has(id)) || depIds.some(id => projectDepositIds.has(id));
    }).sort((a, b) => (a.reportDate || '').localeCompare(b.reportDate || ''));

    return {
      depositList, depositAmount,
      transfers: projTransfers, transferTotal,
      linkedPurchases, purchaseTotal,
      linkedExpenses,
      profit,
      hasStage1: depositList.length > 0 || depositAmount > 0,
      hasStage2: linkedPurchases.length > 0,
      hasStage3: projTransfers.length > 0,
      hasStage4: linkedExpenses.length > 0
    };
  },

  // ============================================
  // 탭 2: ① 매출 (대림 관련 입금)
  // ============================================
  _renderTabSales() {
    const list = this._data.deposits.filter(d => this._isDaerimDeposit(d))
      .sort((a, b) => (b.depositDate || '').localeCompare(a.depositDate || ''));
    if (list.length === 0) return `<div class="text-center text-muted" style="padding:var(--sp-6);">대림 관련 입금내역 없음 (프로젝트명 키워드 매칭 기준)</div>`;
    const total = list.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    return `
      <div class="text-sm text-muted mb-3">대림 프로젝트 매출처 키워드와 일치하는 입금내역만 표시됨 · 총 ${list.length}건 · 합계 ${Utils.formatCurrency(total)}</div>
      <div class="table-wrapper"><table class="data-table">
        <thead><tr><th>입금일</th><th>입금처</th><th class="text-right">금액</th><th>주문번호</th><th>결제방법</th><th>처리사항</th></tr></thead>
        <tbody>${list.map(d => `<tr>
          <td>${Utils.formatDate(d.depositDate)}</td>
          <td class="fw-medium">${Utils.escapeHtml(d.depositorName || '-')}</td>
          <td class="text-right amount">${Utils.formatCurrency(d.amount)}</td>
          <td class="text-xs text-muted">${Utils.escapeHtml(d.orderNumber || '-')}</td>
          <td class="text-xs">${Utils.escapeHtml(d.paymentMethod || '계좌이체')}</td>
          <td class="text-xs">${Utils.escapeHtml(d.actionRequired || '-')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    `;
  },

  // ============================================
  // 탭 3: ② 매입 세금계산서 (대림 관련)
  // ============================================
  _renderTabPurchase() {
    const list = this._data.purchases.filter(p => this._isDaerimPurchase(p))
      .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
    if (list.length === 0) return `
      <div class="text-center text-muted" style="padding:var(--sp-6);">
        대림 관련 매입 세금계산서 없음<br>
        <button class="btn btn-primary mt-3" onclick="Router.navigate('/purchase-invoices')">매입 세금계산서 페이지로 이동 →</button>
      </div>`;
    const total = list.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);
    return `
      <div class="d-flex" style="justify-content:space-between;align-items:center;margin-bottom:var(--sp-3);">
        <div class="text-sm text-muted">대림건축 매입 세금계산서 · 총 ${list.length}건 · 합계 ${Utils.formatCurrency(total)}</div>
        <button class="btn btn-secondary btn-sm" onclick="Router.navigate('/purchase-invoices')">매입 세금계산서 전체 페이지 →</button>
      </div>
      <div class="table-wrapper"><table class="data-table">
        <thead><tr><th>발행일</th><th>매입처</th><th>승인번호</th><th class="text-right">공급가</th><th class="text-right">세액</th><th class="text-right">합계</th></tr></thead>
        <tbody>${list.map(p => `<tr>
          <td>${Utils.formatDate(p.issueDate)}</td>
          <td class="fw-medium">${Utils.escapeHtml(p.partnerCompanyName || '-')}</td>
          <td class="text-xs">${Utils.escapeHtml(p.hometaxApprovalNo || '-')}</td>
          <td class="text-right amount">${Utils.formatCurrency(p.supplyAmount)}</td>
          <td class="text-right amount">${Utils.formatCurrency(p.taxAmount)}</td>
          <td class="text-right amount fw-medium">${Utils.formatCurrency(p.totalAmount)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    `;
  },

  // ============================================
  // 탭 4: ③ 외주 송금 (대림 관련)
  // ============================================
  _renderTabTransfer() {
    const list = this._data.transfers.filter(t => this._isDaerimTransfer(t))
      .sort((a, b) => (b.transferDate || '').localeCompare(a.transferDate || ''));
    if (list.length === 0) return `<div class="text-center text-muted" style="padding:var(--sp-6);">대림 관련 외주 송금내역 없음</div>`;
    const total = list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    return `
      <div class="text-sm text-muted mb-3">대림 관련 송금내역 · 총 ${list.length}건 · 합계 ${Utils.formatCurrency(total)}<br>
        💡 <strong>분할 매칭</strong>: 1건의 큰 송금이 여러 매출 현장 외주비를 통으로 보낸 경우, [⚙ 분할매칭] 버튼으로 매출별로 쪼개서 매칭하세요.</div>
      <div class="table-wrapper"><table class="data-table">
        <thead><tr><th>송금일</th><th>수취인</th><th class="text-right">금액</th><th>프로젝트</th><th>매칭 상태</th><th>관리</th></tr></thead>
        <tbody>${list.map(t => {
          const splits = Array.isArray(t.splits) ? t.splits : [];
          const splitTotal = splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
          const matchPct = Number(t.amount) > 0 ? Math.round(splitTotal / Number(t.amount) * 100) : 0;
          const status = splits.length === 0
            ? (t.matchedPurchaseId ? '<span class="badge badge-review">매입연결</span>' : '<span class="badge badge-request">미매칭</span>')
            : (matchPct === 100 ? `<span class="badge badge-complete">완전분할 (${splits.length}건)</span>`
              : `<span class="badge badge-review">부분분할 ${matchPct}% (${splits.length}건)</span>`);
          return `<tr>
            <td>${Utils.formatDate(t.transferDate)}</td>
            <td class="fw-medium">${Utils.escapeHtml(t.recipientName || '-')}</td>
            <td class="text-right amount">${Utils.formatCurrency(t.amount)}</td>
            <td>${Utils.escapeHtml(t.projectName || '-')}</td>
            <td class="text-center">${status}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="OutsourcingModule._openSplitMatch('${t.id}')">⚙ 분할매칭</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    `;
  },

  // ============================================
  // 송금 분할 매칭 모달 (1송금 → N매출)
  // ============================================
  async _openSplitMatch(transferId) {
    const t = await DB.get('transferRecords', transferId);
    if (!t) { Utils.showToast('송금 없음', 'error'); return; }

    // 기존 splits 로드 (수정 모드)
    const existingSplits = Array.isArray(t.splits) ? t.splits.slice() : [];

    // 후보 매출: 대림 관련 deposits + 정산표 데이터
    // 우선 대림 키워드 일치하는 deposits 만 후보로 (전체는 너무 많음)
    const allDeposits = this._data.deposits.filter(d => this._isDaerimDeposit(d) || this._isPotentialDeposit(d, t))
      .sort((a, b) => (b.depositDate || '').localeCompare(a.depositDate || ''))
      .slice(0, 50);

    // 모달 띄우기
    this._splitDraft = { transferId, transferAmount: Number(t.amount) || 0, splits: existingSplits };

    Utils.openModal(`
      <div class="modal-header">
        <h3>⚙ 송금 분할 매칭</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:80vh;overflow-y:auto;">
        <div class="card mb-3" style="background:#F0F9FF;border-left:4px solid #2563EB;">
          <div class="card-body">
            <div><strong>송금 정보</strong></div>
            <div class="text-sm">
              ${Utils.formatDate(t.transferDate)} · <strong>${Utils.escapeHtml(t.recipientName || '-')}</strong> ·
              <strong style="color:#2563EB;font-size:1.1rem;">${Utils.formatCurrency(t.amount)}</strong>
              ${t.memo ? `<br>비고: ${Utils.escapeHtml(t.memo)}` : ''}
            </div>
          </div>
        </div>

        <h4 style="margin-top:var(--sp-3);">현재 분할 매칭 (<span id="splitCount">${existingSplits.length}</span>건)</h4>
        <div id="splitsContainer"></div>
        <div class="text-center mt-2">
          <button class="btn btn-secondary btn-sm" onclick="OutsourcingModule._addSplitRow()">+ 분할 행 추가</button>
        </div>

        <div id="splitSummary" class="card mt-3" style="background:#F8FAFC;">
          <div class="card-body" style="padding:var(--sp-3);">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-3);font-size:0.95rem;">
              <div>송금 총액: <strong>${Utils.formatCurrency(t.amount)}</strong></div>
              <div>분할 합계: <strong id="splitTotal">₩0</strong></div>
              <div>잔여: <strong id="splitRemain">${Utils.formatCurrency(t.amount)}</strong></div>
            </div>
          </div>
        </div>

        <h4 style="margin-top:var(--sp-4);">매출(deposits) 후보 — 클릭하여 분할 행 추가</h4>
        <div class="text-sm text-muted mb-2">대림 키워드 일치 매출 ${allDeposits.length}건. 매출 선택 → 자동 분할 행 추가 → 금액 조정</div>
        <div style="max-height:240px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:4px;">
          ${allDeposits.length === 0 ? '<div class="text-muted text-center" style="padding:var(--sp-3);">후보 매출 없음</div>'
            : allDeposits.map(d => `
              <div onclick="OutsourcingModule._addSplitFromDeposit('${d.id}')"
                style="padding:8px 12px;border-bottom:1px solid #F1F5F9;cursor:pointer;display:flex;justify-content:space-between;align-items:center;"
                onmouseover="this.style.background='#F0F9FF';" onmouseout="this.style.background='#fff';">
                <div>
                  <div class="fw-medium text-sm">${Utils.escapeHtml(d.depositorName || '-')}</div>
                  <div class="text-xs text-muted">${Utils.formatDate(d.depositDate)}</div>
                </div>
                <div class="text-right">
                  <div class="fw-medium">${Utils.formatCurrency(d.amount)}</div>
                </div>
              </div>`).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="OutsourcingModule._saveSplitMatch()">💾 분할 매칭 저장</button>
      </div>
    `, { size: 'modal-xl' });

    this._renderSplits();
  },

  // 잠정적으로 송금 금액과 같은 매출 후보를 찾는 helper (위 _isDaerimDeposit 보강용)
  _isPotentialDeposit(d, transfer) {
    // 같은 달 ± 1개월 + 금액이 송금의 90~110% 사이
    if (!d.depositDate || !transfer.transferDate) return false;
    const td = new Date(transfer.transferDate);
    const dd = new Date(d.depositDate);
    const diffMonths = Math.abs((td - dd) / (1000 * 60 * 60 * 24 * 30));
    if (diffMonths > 2) return false;
    return true;
  },

  _renderSplits() {
    const container = document.getElementById('splitsContainer');
    if (!container) return;
    const draft = this._splitDraft;
    if (!draft) return;

    if (draft.splits.length === 0) {
      container.innerHTML = '<div class="text-muted text-center" style="padding:var(--sp-3);background:#F8FAFC;border-radius:4px;">분할 행이 없습니다. 아래 매출 후보를 클릭하거나 [+ 분할 행 추가]를 누르세요.</div>';
    } else {
      container.innerHTML = draft.splits.map((s, i) => {
        // depositId 로 deposit 정보 가져오기
        const d = this._data.deposits.find(x => String(x.id) === String(s.depositId));
        const depName = d ? d.depositorName : (s.clientName || '(미지정)');
        const depDate = d ? d.depositDate : (s.depositDate || '');
        const depAmt = d ? d.amount : null;
        return `
          <div style="display:grid;grid-template-columns:auto 1fr 140px 30px;gap:var(--sp-2);align-items:center;padding:var(--sp-2) var(--sp-3);background:#fff;border:1px solid #E2E8F0;border-radius:4px;margin-bottom:6px;">
            <div style="font-size:0.85rem;color:#64748B;">#${i + 1}</div>
            <div>
              <div class="fw-medium text-sm">${Utils.escapeHtml(depName)}</div>
              <div class="text-xs text-muted">${depDate ? Utils.formatDate(depDate) : '-'} ${depAmt ? `· 매출 ${Utils.formatCurrency(depAmt)}` : ''}</div>
            </div>
            <input type="number" class="form-control" value="${s.amount}" min="0" step="1"
              oninput="OutsourcingModule._updateSplitAmount(${i}, this.value)"
              style="text-align:right;">
            <button class="btn btn-ghost btn-sm text-danger" onclick="OutsourcingModule._removeSplit(${i})" title="삭제">🗑️</button>
          </div>`;
      }).join('');
    }
    this._updateSplitSummary();
  },

  _updateSplitSummary() {
    const draft = this._splitDraft;
    if (!draft) return;
    const total = draft.splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const remain = draft.transferAmount - total;
    const totalEl = document.getElementById('splitTotal');
    const remainEl = document.getElementById('splitRemain');
    const countEl = document.getElementById('splitCount');
    if (totalEl) totalEl.textContent = Utils.formatCurrency(total);
    if (remainEl) {
      remainEl.textContent = Utils.formatCurrency(remain);
      remainEl.style.color = remain === 0 ? '#16A34A' : (remain < 0 ? '#DC2626' : '#F59E0B');
    }
    if (countEl) countEl.textContent = draft.splits.length;
  },

  _addSplitRow() {
    this._splitDraft.splits.push({ depositId: null, amount: 0 });
    this._renderSplits();
  },

  _addSplitFromDeposit(depId) {
    const d = this._data.deposits.find(x => String(x.id) === String(depId));
    if (!d) return;
    // 이미 같은 depositId 추가됐으면 무시
    if (this._splitDraft.splits.some(s => String(s.depositId) === String(depId))) {
      Utils.showToast('이미 추가된 매출입니다.', 'warning');
      return;
    }
    // 분할 금액 자동 제안: 송금 잔여 vs 매출 금액 중 작은 값
    const used = this._splitDraft.splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const remain = this._splitDraft.transferAmount - used;
    const suggested = Math.min(remain > 0 ? remain : 0, Number(d.amount) || 0);
    this._splitDraft.splits.push({
      depositId: String(d.id),
      amount: suggested,
      clientName: d.depositorName,
      depositDate: d.depositDate
    });
    this._renderSplits();
  },

  _updateSplitAmount(idx, value) {
    if (!this._splitDraft.splits[idx]) return;
    this._splitDraft.splits[idx].amount = Number(value) || 0;
    this._updateSplitSummary();
  },

  _removeSplit(idx) {
    this._splitDraft.splits.splice(idx, 1);
    this._renderSplits();
  },

  async _saveSplitMatch() {
    const draft = this._splitDraft;
    if (!draft) { Utils.showToast('작업 중인 분할 없음', 'error'); return; }

    const splitTotal = draft.splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    if (splitTotal > draft.transferAmount) {
      const ok = window.confirm(`분할 합계(${Utils.formatCurrency(splitTotal)})가 송금 총액(${Utils.formatCurrency(draft.transferAmount)})을 초과합니다.\n그래도 저장하시겠습니까?`);
      if (!ok) return;
    }

    try {
      const t = await DB.get('transferRecords', draft.transferId);
      if (!t) throw new Error('송금 레코드 없음');

      // 기존 splits 가 매칭했던 deposits 에서 역참조 해제
      const oldSplits = Array.isArray(t.splits) ? t.splits : [];
      for (const os of oldSplits) {
        if (!os.depositId) continue;
        try {
          const d = await DB.get('deposits', os.depositId);
          if (d) {
            const updated = (d.matchedTransferSplits || []).filter(x => String(x.transferId) !== String(draft.transferId));
            await DB.update('deposits', { ...d, id: d.id, matchedTransferSplits: updated });
          }
        } catch (e) { console.warn('[Split] 옛 역참조 해제 실패:', e); }
      }

      // 새 splits 저장
      const cleanSplits = draft.splits.filter(s => s.depositId && Number(s.amount) > 0);
      await DB.update('transferRecords', { ...t, id: t.id, splits: cleanSplits });

      // 새 splits 의 deposits 에 역참조 추가
      for (const s of cleanSplits) {
        try {
          const d = await DB.get('deposits', s.depositId);
          if (d) {
            const existing = (d.matchedTransferSplits || []).filter(x => String(x.transferId) !== String(draft.transferId));
            existing.push({ transferId: String(draft.transferId), amount: Number(s.amount) });
            await DB.update('deposits', { ...d, id: d.id, matchedTransferSplits: existing });
          }
        } catch (e) { console.warn('[Split] 역참조 저장 실패:', e); }
      }

      await DB.log('UPDATE', 'transferRecord', draft.transferId, `송금 분할 매칭 ${cleanSplits.length}건`);
      Utils.showToast(`분할 매칭 저장 완료 (${cleanSplits.length}건)`, 'success');
      this._splitDraft = null;
      Utils.closeModal();
      await this._reload();
    } catch (e) {
      console.error('[Split] 저장 실패:', e);
      Utils.showToast('저장 실패: ' + e.message, 'error', 6000);
    }
  },

  // ============================================
  // 탭 5: ④ 순이익 + 지출결의서 (expense-reports 흡수)
  // ============================================
  _renderTabProfit() {
    const projects = this._data.projects.slice().reverse();
    const summary = this._computeSummary();

    const profitRows = projects.length === 0
      ? `<tr><td colspan="4" class="text-center text-muted" style="padding:var(--sp-4);">등록된 프로젝트 없음</td></tr>`
      : projects.map(p => {
          const stats = this._computeProjectStats(p);
          const color = stats.profit < 0 ? 'color:var(--color-danger);' : (stats.profit > 0 ? 'color:var(--color-success);' : '');
          return `<tr>
            <td class="fw-medium">${Utils.escapeHtml(p.projectName || '-')}</td>
            <td class="text-right amount">${Utils.formatCurrency(stats.depositAmount)}</td>
            <td class="text-right amount">${Utils.formatCurrency(stats.transferTotal)}</td>
            <td class="text-right amount fw-medium" style="${color}">${Utils.formatCurrency(stats.profit)}</td>
          </tr>`;
        }).join('');

    const expenses = this._data.expenses.slice().reverse();
    const exRows = expenses.length === 0
      ? `<tr><td colspan="6" class="text-center text-muted" style="padding:var(--sp-4);">등록된 지출결의서 없음 — 우측 [+ PDF 업로드] 버튼으로 시작</td></tr>`
      : expenses.map(r => {
          const status = { completed: '<span class="badge badge-complete">완료</span>', partial: '<span class="badge badge-review">부분</span>', pending: '<span class="badge badge-request">미매칭</span>' }[r.matchStatus || 'pending'];
          return `<tr style="cursor:pointer;" onclick="OutsourcingModule._openExpenseDetail('${r.id}')">
            <td>${Utils.formatDate(r.reportDate)}</td>
            <td class="fw-medium">${Utils.escapeHtml(r.title || r.fileName || '-')}</td>
            <td>${Utils.escapeHtml(r.vendorName || '-')}</td>
            <td class="text-center">${(r.lineItems || []).length}건</td>
            <td class="text-right amount">${Utils.formatCurrency(r.totalAmount || 0)}</td>
            <td class="text-center">${status}</td>
          </tr>`;
        }).join('');

    return `
      <!-- 순이익 요약 -->
      <div style="padding:var(--sp-4);background:linear-gradient(135deg, ${summary.totalProfit >= 0 ? '#10B981' : '#DC2626'} 0%, ${summary.totalProfit >= 0 ? '#059669' : '#991B1B'} 100%);color:white;border-radius:8px;margin-bottom:var(--sp-4);">
        <h3 style="margin:0 0 var(--sp-2) 0;color:white;">④ 전체 순이익</h3>
        <div style="font-size:1.1rem;">
          매출 <strong>${Utils.formatCurrency(summary.totalSales)}</strong> − 외주 송금 <strong>${Utils.formatCurrency(summary.totalTransfers)}</strong> = <strong style="font-size:1.6rem;">${Utils.formatCurrency(summary.totalProfit)}</strong>
        </div>
      </div>

      <h4 style="margin-top:var(--sp-4);">프로젝트별 순이익</h4>
      <div class="table-wrapper"><table class="data-table">
        <thead><tr><th>프로젝트</th><th class="text-right">매출</th><th class="text-right">송금</th><th class="text-right">순이익</th></tr></thead>
        <tbody>${profitRows}</tbody>
      </table></div>

      <!-- 지출결의서 -->
      <div class="d-flex" style="justify-content:space-between;align-items:center;margin-top:var(--sp-5);margin-bottom:var(--sp-2);">
        <h4 style="margin:0;">📄 지출결의서 (대림 외주 비용 결의)</h4>
        <button class="btn btn-primary btn-sm" onclick="OutsourcingModule._openExpenseUpload()">+ PDF 업로드 + 자동 매칭</button>
      </div>
      <div class="text-sm text-muted mb-2">PDF 업로드 시 시스템이 자동 파싱 → 매출/송금 후보 제시 → 확인 → 저장</div>
      <div class="table-wrapper"><table class="data-table">
        <thead><tr><th>지출일자</th><th>지출건명</th><th>외주업체</th><th class="text-center">라인</th><th class="text-right">총금액</th><th class="text-center">매칭</th></tr></thead>
        <tbody>${exRows}</tbody>
      </table></div>
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

  // ===== v2: 상세 페이지 (별도 라우트 /outsourcing/detail?id=xxx) =====
  // 매출 → 매입세금계산서 → 송금 → 순이익 4단계 흐름을 한 페이지로
  async _renderDetailPage(id) {
    const p = await DB.get('outsourcingProjects', id);
    if (!p) {
      this.container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <h3>프로젝트를 찾을 수 없습니다</h3>
          <button class="btn btn-primary mt-3" onclick="Router.navigate('/outsourcing')">목록으로</button>
        </div>`;
      return;
    }

    const isAdmin = Auth.isAdmin();
    const projectKey = (p.projectName || '').trim();

    // 1) 종합 데이터 로드 (정산표 매칭 캐시 갱신)
    await this._loadTransferTotals();

    // 2) 매출 흐름 (① 매출) — 정산표 우선, 없으면 자동 매칭된 deposits
    const fullName = projectKey;
    const dashIdx = fullName.indexOf(' - ');
    const displayName = dashIdx > 0 ? fullName.slice(0, dashIdx) : fullName;
    const cleanName = displayName.replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s/g, '');
    const matchedSettlements = this._settlementsByMatchKey[cleanName] || [];

    let depositList = [];
    let usingSettlement = false;
    if (matchedSettlements.length > 0) {
      usingSettlement = true;
      for (const s of matchedSettlements) {
        if (s.depositDate && s.depositAmount) {
          depositList.push({ date: s.depositDate, amount: s.depositAmount, name: s.clientName });
        }
      }
    } else {
      depositList = (this._depositInfoByProject[projectKey] || []);
    }
    const depositAmount = Number(p.depositAmount) || 0; // 프로젝트 등록 매출액 (기준)

    // 3) 외주 송금 (③)
    const allTransfersAll = await DB.getAll('transferRecords');
    const transfers = allTransfersAll
      .filter(t => (t.projectName || '').trim() === projectKey)
      .sort((a, b) => (a.transferDate || '').localeCompare(b.transferDate || ''));
    const outsourcingTotal = transfers.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    // 4) 외주 세금계산서 (②) — 송금에 연결된 purchaseInvoices
    const allPurchases = await DB.getAll('purchaseInvoices');
    const linkedPurchaseIds = new Set(transfers.map(t => t.matchedPurchaseId).filter(Boolean).map(String));
    const linkedPurchases = allPurchases
      .filter(pi => linkedPurchaseIds.has(String(pi.id)))
      .sort((a, b) => (a.issueDate || '').localeCompare(b.issueDate || ''));
    const purchaseTotal = linkedPurchases.reduce((s, pi) => s + (Number(pi.totalAmount) || 0), 0);

    // 4-b) 지출결의서 — 이 프로젝트의 송금 또는 매출(deposit)이 매칭된 결의서
    const allExpenseReports = await DB.getAll('expenseReports');
    const transferIdSet = new Set(transfers.map(t => String(t.id)));
    const projectDepositIds = new Set(); // 정산표/자동매칭으로 식별된 deposit ID
    // depositList 에는 settlements/depositInfo 가 들어있어 id 가 없을 수 있음 — 이름·금액·날짜로 deposits 조회
    const allDeposits = await DB.getAll('deposits');
    for (const li of depositList) {
      const match = allDeposits.find(d =>
        d.depositorName && li.name && d.depositorName.includes(li.name.slice(0, 2)) &&
        Number(d.amount) === Number(li.amount) &&
        d.depositDate === li.date
      );
      if (match) projectDepositIds.add(String(match.id));
    }
    const linkedExpenseReports = allExpenseReports.filter(er => {
      const trIds = (er.matchedTransferIds || []).map(String);
      const depIds = (er.matchedDepositIds || []).map(String);
      return trIds.some(id => transferIdSet.has(id)) || depIds.some(id => projectDepositIds.has(id));
    }).sort((a, b) => (a.reportDate || '').localeCompare(b.reportDate || ''));

    // 5) ④ 순이익
    const profit = depositAmount - outsourcingTotal;
    const profitColor = profit < 0 ? 'color:var(--color-danger);' : (profit > 0 ? 'color:var(--color-success);' : '');

    const sourceBadge = usingSettlement
      ? '<span style="display:inline-flex;align-items:center;padding:4px 10px;background:#DBEAFE;color:#1E40AF;border-radius:12px;font-size:0.8rem;font-weight:600;">📋 정산표 데이터 사용</span>'
      : '';

    const depositRows = depositList.length === 0
      ? `<tr><td colspan="3" class="text-center text-muted" style="padding:var(--sp-4);">매칭된 입금내역 없음 (프로젝트 매출액만 표시)</td></tr>`
      : depositList.map(d => `
        <tr>
          <td>${Utils.formatDate(d.date)}</td>
          <td>${Utils.escapeHtml(d.name || '-')}</td>
          <td class="text-right amount">${Utils.formatCurrency(d.amount || 0)}</td>
        </tr>`).join('');

    const purchaseRows = linkedPurchases.length === 0
      ? `<tr><td colspan="4" class="text-center text-muted" style="padding:var(--sp-4);">연결된 매입 세금계산서 없음 — 송금내역에 매입계산서를 연결하면 표시됩니다</td></tr>`
      : linkedPurchases.map(pi => `
        <tr>
          <td>${Utils.formatDate(pi.issueDate)}</td>
          <td>${Utils.escapeHtml(pi.partnerCompanyName || '-')}</td>
          <td class="text-xs">${Utils.escapeHtml(pi.hometaxApprovalNo || '-')}</td>
          <td class="text-right amount">${Utils.formatCurrency(pi.totalAmount || 0)}</td>
        </tr>`).join('');

    const transferRows = transfers.length === 0
      ? `<tr><td colspan="4" class="text-center text-muted" style="padding:var(--sp-4);">매칭된 송금내역 없음</td></tr>`
      : transfers.map(t => `
        <tr>
          <td>${Utils.formatDate(t.transferDate)}</td>
          <td>${Utils.escapeHtml(t.recipientName || '-')}</td>
          <td class="text-right amount">${Utils.formatCurrency(t.amount || 0)}</td>
          <td>${Utils.escapeHtml(t.memo || '-')}</td>
        </tr>`).join('');

    const expenseReportRows = linkedExpenseReports.length === 0
      ? `<tr><td colspan="5" class="text-center text-muted" style="padding:var(--sp-4);">연결된 지출결의서 없음 — [📄 지출결의서 관리]에서 PDF 업로드 후 매칭하면 표시됩니다</td></tr>`
      : linkedExpenseReports.map(er => `
        <tr style="cursor:pointer;" onclick="Router.navigate('/expense-reports/detail?id=${er.id}')">
          <td>${Utils.formatDate(er.reportDate)}</td>
          <td>${Utils.escapeHtml(er.title || er.fileName || '-')}</td>
          <td>${Utils.escapeHtml(er.authorName || '-')}</td>
          <td class="text-center">${(er.lineItems || []).length}건</td>
          <td class="text-right amount">${Utils.formatCurrency(er.totalAmount || 0)}</td>
        </tr>`).join('');

    this.container.innerHTML = `
      <div class="page-header" style="align-items:flex-start;">
        <div>
          <button class="btn btn-ghost" onclick="Router.navigate('/outsourcing')" style="margin-bottom:var(--sp-2);">← 목록으로</button>
          <h2 style="margin:0;">${Utils.escapeHtml(displayName)}</h2>
          ${dashIdx > 0 ? `<div class="text-sm text-muted">${Utils.escapeHtml(fullName.slice(dashIdx + 3).trim())}</div>` : ''}
        </div>
        <div class="page-actions" style="flex-wrap:wrap;">
          ${sourceBadge}
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadSinglePDF('${p.id}')">📄 이 프로젝트 PDF</button>
          ${isAdmin ? `<button class="btn btn-primary" onclick="OutsourcingModule._edit('${p.id}')">✏️ 수정</button>` : ''}
          ${isAdmin ? `<button class="btn btn-ghost text-danger" onclick="OutsourcingModule._deleteFromDetailPage('${p.id}')">🗑️ 삭제</button>` : ''}
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-3);">
            <div><strong>발주처:</strong> ${Utils.escapeHtml(p.clientName || '-')}</div>
            <div><strong>외주업체:</strong> ${Utils.escapeHtml(p.vendorName || '-')}</div>
            <div><strong>계약일:</strong> ${p.contractDate ? Utils.formatDate(p.contractDate) : '-'}</div>
            <div><strong>진행상태:</strong> ${this._statusBadge(p.status)}</div>
          </div>
          ${p.memo ? `<div style="margin-top:var(--sp-3);padding:var(--sp-3);background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:var(--radius-sm);white-space:pre-wrap;"><strong>📝 비고:</strong> ${Utils.escapeHtml(p.memo)}</div>` : ''}
        </div>
      </div>

      <!-- 4단계 흐름 카드 -->
      <div class="summary-cards" style="margin-bottom:var(--sp-4);">
        <div class="summary-card" style="border-left:4px solid #16A34A;">
          <div class="card-icon green">💰</div>
          <div class="card-info">
            <div class="card-label">① 매출 발생</div>
            <div class="card-value">${Utils.formatCurrency(depositAmount)}</div>
            ${depositList.length > 0 ? `<div class="text-xs text-muted">입금 ${depositList.length}건</div>` : ''}
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid #2563EB;">
          <div class="card-icon cyan">📥</div>
          <div class="card-info">
            <div class="card-label">② 매입 세금계산서</div>
            <div class="card-value">${Utils.formatCurrency(purchaseTotal)}</div>
            <div class="text-xs text-muted">${linkedPurchases.length}건 연결</div>
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid #F97316;">
          <div class="card-icon orange">💸</div>
          <div class="card-info">
            <div class="card-label">③ 외주 송금</div>
            <div class="card-value">${Utils.formatCurrency(outsourcingTotal)}</div>
            <div class="text-xs text-muted">${transfers.length}건 집행</div>
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid ${profit < 0 ? '#DC2626' : '#16A34A'};">
          <div class="card-icon ${profit < 0 ? 'red' : 'green'}">📊</div>
          <div class="card-info">
            <div class="card-label">④ 순이익 (① − ③)</div>
            <div class="card-value" style="${profitColor}">${Utils.formatCurrency(profit)}</div>
            <div class="text-xs text-muted">${profit >= 0 ? '흑자' : '적자'}</div>
          </div>
        </div>
      </div>

      <h3 style="margin-top:var(--sp-5);">① 매출 (입금 내역)</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>입금일</th><th>입금처</th><th class="text-right">금액</th></tr></thead>
          <tbody>${depositRows}</tbody>
        </table>
      </div>

      <h3 style="margin-top:var(--sp-5);">② 매입 세금계산서 (외주업체 발행)</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>발행일</th><th>매입처(외주업체)</th><th>홈택스 승인번호</th><th class="text-right">금액</th></tr></thead>
          <tbody>${purchaseRows}</tbody>
        </table>
      </div>

      <h3 style="margin-top:var(--sp-5);">③ 외주 송금 내역</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>송금일</th><th>수취인</th><th class="text-right">금액</th><th>비고</th></tr></thead>
          <tbody>${transferRows}</tbody>
        </table>
      </div>

      <h3 style="margin-top:var(--sp-5);">📄 지출결의서 (이 프로젝트 송금/매출이 매칭된 결의서)</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>지출일자</th><th>지출건명</th><th>작성자</th><th class="text-center">라인수</th><th class="text-right">총금액</th></tr></thead>
          <tbody>${expenseReportRows}</tbody>
        </table>
      </div>

      <div class="card mt-5" style="background:linear-gradient(135deg, ${profit >= 0 ? '#10B981' : '#DC2626'} 0%, ${profit >= 0 ? '#059669' : '#991B1B'} 100%); color:white;">
        <div class="card-body" style="padding:var(--sp-5);">
          <h3 style="margin:0 0 var(--sp-3) 0; color:white;">④ 순이익 요약</h3>
          <div style="font-size:1.1rem;line-height:1.8;">
            매출 <strong>${Utils.formatCurrency(depositAmount)}</strong>
            − 외주 송금 <strong>${Utils.formatCurrency(outsourcingTotal)}</strong>
            = <strong style="font-size:1.6rem;">${Utils.formatCurrency(profit)}</strong>
          </div>
          ${linkedPurchases.length > 0 ? `<div style="margin-top:var(--sp-2);opacity:0.92;font-size:0.9rem;">※ 외주업체로부터 매입 세금계산서 ${linkedPurchases.length}건 (총 ${Utils.formatCurrency(purchaseTotal)}) 수령 완료</div>` : `<div style="margin-top:var(--sp-2);opacity:0.92;font-size:0.9rem;">※ 외주 매입 세금계산서 미연결 — 송금에 매입계산서를 연결하여 흐름을 완성하세요</div>`}
        </div>
      </div>
    `;
  },

  // 상세 페이지에서 삭제 → 목록 복귀
  async _deleteFromDetailPage(id) {
    const ok = window.confirm('정말 이 프로젝트를 삭제하시겠습니까? (되돌릴 수 없음)');
    if (!ok) return;
    try {
      await DB.delete('outsourcingProjects', id);
      await DB.log('DELETE', 'outsourcingProjects', id, '프로젝트 삭제 (상세페이지)');
      Utils.showToast('프로젝트가 삭제되었습니다.', 'success');
      Router.navigate('/outsourcing');
    } catch (e) {
      console.error('[외주설계] 삭제 실패:', e);
      Utils.showToast('삭제 실패: ' + e.message, 'error');
    }
  },

  // ===== (legacy) 모달 상세보기 — v2부터 _renderDetailPage 로 대체. 호환용 보존 =====
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

      // v2: 매입 세금계산서 (외주업체 발행) — 송금에 연결된 것들
      const allPurchases = await DB.getAll('purchaseInvoices');
      const linkedPurchaseIds = new Set(allTransfers.map(t => t.matchedPurchaseId).filter(Boolean).map(String));
      const linkedPurchases = allPurchases
        .filter(pi => linkedPurchaseIds.has(String(pi.id)))
        .sort((a, b) => (a.issueDate || '').localeCompare(b.issueDate || ''));
      const purchaseTotal = linkedPurchases.reduce((s, pi) => s + (Number(pi.totalAmount) || 0), 0);

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

      const purchaseRowsHtml = linkedPurchases.length === 0
        ? `<tr><td colspan="4" style="text-align:center;padding:16px;color:#94A3B8;">연결된 매입 세금계산서 없음 (송금내역에 매입계산서를 연결하면 표시됨)</td></tr>`
        : linkedPurchases.map(pi => `<tr>
            <td>${pi.issueDate || '-'}</td>
            <td>${esc(pi.partnerCompanyName || '-')}</td>
            <td>${esc(pi.hometaxApprovalNo || '-')}</td>
            <td class="num">${fmt(pi.totalAmount)}</td>
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
  .summary { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin: 10px 0 20px; }
  .summary .card { background: #F8FAFC; border-left: 4px solid #2563EB; padding: 10px 12px; border-radius: 4px; }
  .summary .card .lbl { font-size: 8.5pt; color: #64748B; margin-bottom: 4px; }
  .summary .card .val { font-size: 12pt; font-weight: 700; color: #0F172A; }
  .summary .card.s1 { border-color: #16A34A; }
  .summary .card.s2 { border-color: #2563EB; }
  .summary .card.s3 { border-color: #F97316; }
  .summary .card.balance { border-color: ${balance < 0 ? '#DC2626' : '#16A34A'}; }
  .summary .card.balance .val { color: ${balance < 0 ? '#DC2626' : '#16A34A'}; }
  .flow-summary { background: linear-gradient(135deg, ${balance >= 0 ? '#10B981' : '#DC2626'} 0%, ${balance >= 0 ? '#059669' : '#991B1B'} 100%); color: #fff; padding: 14px 18px; border-radius: 8px; margin: 12px 0 18px; font-size: 11pt; line-height: 1.7; }
  .flow-summary .calc { font-size: 14pt; font-weight: 700; }
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

  <h3>💰 정산 흐름 요약 (4단계)</h3>
  <div class="summary">
    <div class="card s1"><div class="lbl">① 매출 발생</div><div class="val">${fmt(depositAmount)}</div></div>
    <div class="card s2"><div class="lbl">② 매입 세금계산서 (${linkedPurchases.length}건)</div><div class="val">${fmt(purchaseTotal)}</div></div>
    <div class="card s3"><div class="lbl">③ 외주 송금 (${allTransfers.length}건)</div><div class="val">${fmt(outsourcingTotal)}</div></div>
    <div class="card balance"><div class="lbl">④ 순이익 (① − ③)</div><div class="val">${fmt(balance)}</div></div>
  </div>

  <div class="flow-summary">
    <div>매출 발생 → 외주업체 세금계산서 → 외주 비용 송금 → 순이익 확인</div>
    <div class="calc" style="margin-top:6px;">
      ${fmt(depositAmount)} − ${fmt(outsourcingTotal)} = ${fmt(balance)} (${balance >= 0 ? '흑자' : '적자'})
    </div>
  </div>

  <h3>② 외주업체 매입 세금계산서 (${linkedPurchases.length}건)</h3>
  <table class="list">
    <thead><tr>
      <th style="width:16%;">발행일</th>
      <th style="width:30%;">매입처(외주업체)</th>
      <th style="width:24%;">홈택스 승인번호</th>
      <th class="num">금액</th>
    </tr></thead>
    <tbody>${purchaseRowsHtml}</tbody>
  </table>

  <h3>③ 외주 송금 내역 (${allTransfers.length}건)</h3>
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
    await this._reload();
  },

  // ============================================
  // 지출결의서 (탭 5 통합) — 옛 ExpenseReportsModule 흡수
  // ============================================
  EXPENSE_COLLECTION: 'expenseReports',

  // ============================================
  // v2 4단계: 매입세금계산서(위하고 엑셀) + 지출결의서(PDF) 통합 업로드
  // - 위하고 매입세금 양식: 일자|Code|거래처|유형|품명|공급가액|부가세|합계|차변계정|대변계정
  // - 매입 식별: 대변계정에 '미지급금' 또는 차변계정에 '지급수수료/외주비/용역비'
  // - 대림 식별: 거래처에 '대림건축' 또는 '대림ENG' 포함
  // ============================================
  _openCombinedUpload() {
    this._expenseDraft = null;
    this._purchaseDraft = null;
    Utils.openModal(`
      <div class="modal-header">
        <h3>📥 매입세금계산서 + 지출결의서 통합 업로드</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:80vh;overflow-y:auto;">
        <div class="text-sm text-muted mb-3">
          💡 둘 중 하나만 올려도 OK. 매입세금 엑셀(위하고)이면 자동으로 대림건축 매입만 식별 / 결의서 PDF면 라인별 매출·송금 매칭 후보 제시.
        </div>

        <!-- ① 위하고 매입세금 엑셀 -->
        <div class="card mb-3">
          <div class="card-body">
            <h4 style="margin-top:0;color:#2563EB;">① 매입세금계산서 (위하고 엑셀)</h4>
            <div id="pxDropZone" style="border:2px dashed #94A3B8;border-radius:8px;padding:var(--sp-4);text-align:center;background:#F8FAFC;">
              <div style="font-size:36px;">📊</div>
              <p style="margin:6px 0;">위하고에서 다운로드한 매입세금계산서 .xlsx 선택/드래그</p>
              <input type="file" id="pxFileInput" accept=".xlsx,.xls" style="display:none;" onchange="OutsourcingModule._onPurchaseExcelSelected(this.files[0])">
              <button class="btn btn-secondary btn-sm" onclick="document.getElementById('pxFileInput').click()">엑셀 파일 선택</button>
              <div id="pxFileName" class="text-sm text-muted mt-2"></div>
            </div>
            <div id="pxParseSection" class="hidden mt-3"></div>
          </div>
        </div>

        <!-- ② 지출결의서 PDF -->
        <div class="card mb-3">
          <div class="card-body">
            <h4 style="margin-top:0;color:#8B5CF6;">② 지출결의서 (PDF)</h4>
            <div id="erDropZone" style="border:2px dashed #94A3B8;border-radius:8px;padding:var(--sp-4);text-align:center;background:#F8FAFC;">
              <div style="font-size:36px;">📄</div>
              <p style="margin:6px 0;">지출결의서 PDF 선택/드래그</p>
              <input type="file" id="erFileInput" accept="application/pdf" style="display:none;" onchange="OutsourcingModule._onExpenseFileSelected(this.files[0])">
              <button class="btn btn-secondary btn-sm" onclick="document.getElementById('erFileInput').click()">PDF 파일 선택</button>
              <div id="erFileName" class="text-sm text-muted mt-2"></div>
            </div>
            <div id="erParseSection" class="hidden mt-3"><h5>파싱 결과</h5><div id="erParseContent"></div></div>
          </div>
        </div>

        <!-- ③ 매출/송금 매칭 후보 (결의서가 있을 때만) -->
        <div id="erMatchSection" class="card mb-3 hidden">
          <div class="card-body">
            <h4 style="margin-top:0;color:#16A34A;">③ 매출 / 송금 자동 매칭 후보</h4>
            <div id="erMatchContent"></div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary hidden" id="combinedSaveBtn" onclick="OutsourcingModule._saveCombined()">💾 통합 저장 (매입세금 + 결의서 + 매칭)</button>
      </div>
    `, { size: 'modal-xl' });

    // 드래그앤드롭 바인딩
    setTimeout(() => {
      const bind = (zoneId, handler) => {
        const dz = document.getElementById(zoneId);
        if (!dz) return;
        ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.style.background = '#DBEAFE'; }));
        ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.style.background = '#F8FAFC'; }));
        dz.addEventListener('drop', (e) => {
          const f = e.dataTransfer?.files?.[0];
          if (f) handler(f);
        });
      };
      bind('pxDropZone', (f) => this._onPurchaseExcelSelected(f));
      bind('erDropZone', (f) => this._onExpenseFileSelected(f));
    }, 0);
  },

  // 위하고 매입세금 엑셀 처리
  async _onPurchaseExcelSelected(file) {
    if (!file) return;
    const nameEl = document.getElementById('pxFileName');
    if (nameEl) nameEl.textContent = `⏳ "${file.name}" 파싱 중...`;
    try {
      await this._ensureXlsx();
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      const parsed = this._parseWehagoPurchaseExcel(rows);
      this._purchaseDraft = { file, fileName: file.name, items: parsed.items, allCount: parsed.allCount, daerimCount: parsed.items.length };
      if (nameEl) nameEl.textContent = `✅ "${file.name}" — 전체 ${parsed.allCount}건 / 대림 매입 ${parsed.items.length}건 식별`;
      this._renderPurchaseExcelPreview();
      document.getElementById('combinedSaveBtn').classList.remove('hidden');
    } catch (e) {
      console.error('[Purchase] 엑셀 파싱 실패:', e);
      if (nameEl) nameEl.textContent = `❌ 파싱 실패: ${e.message}`;
      Utils.showToast('엑셀 파싱 실패: ' + e.message, 'error', 6000);
    }
  },

  // 위하고 매입세금 엑셀 파서
  // 헤더: 일자 | Code | 거래처 | 유형 | 품명 | 공급가액 | 부가세 | 합계 | 차변계정 | 대변계정 | 관리 | 전표상태
  // 대림 식별: 거래처에 '대림건축'|'대림ENG' 포함
  _parseWehagoPurchaseExcel(rows) {
    const items = [];
    if (!rows || rows.length < 2) return { items, allCount: 0 };

    // 헤더 행 찾기 (보통 0번)
    let headerIdx = -1;
    let dateCol = -1, codeCol = -1, partnerCol = -1, typeCol = -1, itemCol = -1, supplyCol = -1, taxCol = -1, totalCol = -1, debitCol = -1, creditCol = -1, stateCol = -1;
    for (let r = 0; r < Math.min(3, rows.length); r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const v = String(row[c] || '').trim();
        if (v === '일자') dateCol = c;
        else if (v === 'Code') codeCol = c;
        else if (v === '거래처') partnerCol = c;
        else if (v === '유형') typeCol = c;
        else if (v === '품명') itemCol = c;
        else if (v === '공급가액') supplyCol = c;
        else if (v === '부가세') taxCol = c;
        else if (v === '합계') totalCol = c;
        else if (v === '차변계정') debitCol = c;
        else if (v === '대변계정') creditCol = c;
        else if (v === '전표상태') stateCol = c;
      }
      if (dateCol >= 0 && partnerCol >= 0 && totalCol >= 0) { headerIdx = r; break; }
    }
    if (headerIdx < 0) throw new Error('헤더 행을 찾을 수 없음 (일자/거래처/합계 컬럼 필요)');

    const year = new Date().getFullYear();
    let allCount = 0;
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const dateStr = String(row[dateCol] || '').trim();
      const partner = String(row[partnerCol] || '').trim();
      const total = Number(String(row[totalCol] || '').replace(/[,\s]/g, '')) || 0;
      // 합계 행 / 빈 행 / 일자 없는 행 스킵
      if (!dateStr || !partner || total <= 0) continue;
      if (/합계|총계/.test(partner)) continue;

      allCount++;

      // 대림 식별
      const partnerNorm = partner.replace(/\s/g, '');
      const isDaerim = /대림건축|대림ENG/.test(partnerNorm);
      if (!isDaerim) continue;

      // 날짜 정규화: '05-13' 또는 '2026-05-13'
      let issueDate = '';
      const dm = dateStr.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
      const dm2 = dateStr.match(/^(\d{1,2})[-./](\d{1,2})$/);
      if (dm) {
        issueDate = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
      } else if (dm2) {
        issueDate = `${year}-${dm2[1].padStart(2, '0')}-${dm2[2].padStart(2, '0')}`;
      } else {
        issueDate = dateStr;
      }

      items.push({
        issueDate,
        partnerCompanyName: partner,
        partnerCode: codeCol >= 0 ? String(row[codeCol] || '').trim() : '',
        type: typeCol >= 0 ? String(row[typeCol] || '').trim() : '',
        itemName: itemCol >= 0 ? String(row[itemCol] || '').trim() : '',
        supplyAmount: Number(String(row[supplyCol] || '').replace(/[,\s]/g, '')) || 0,
        taxAmount: Number(String(row[taxCol] || '').replace(/[,\s]/g, '')) || 0,
        totalAmount: total,
        debitAccount: debitCol >= 0 ? String(row[debitCol] || '').trim() : '',
        creditAccount: creditCol >= 0 ? String(row[creditCol] || '').trim() : '',
        state: stateCol >= 0 ? String(row[stateCol] || '').trim() : '',
        selected: true
      });
    }
    return { items, allCount };
  },

  // _ensureXlsx 는 1598줄에 이미 정의되어 있어 그대로 재사용

  _renderPurchaseExcelPreview() {
    const sec = document.getElementById('pxParseSection');
    if (!sec || !this._purchaseDraft) return;
    sec.classList.remove('hidden');
    const items = this._purchaseDraft.items;
    if (items.length === 0) {
      sec.innerHTML = `<div class="text-muted text-center" style="padding:var(--sp-3);">대림 매입세금계산서가 식별되지 않음 (전체 ${this._purchaseDraft.allCount}건 중)</div>`;
      return;
    }
    const total = items.filter(i => i.selected).reduce((s, i) => s + i.totalAmount, 0);
    sec.innerHTML = `
      <div class="text-sm mb-2">대림 매입 <strong>${items.length}건</strong> · 합계 <strong>${Utils.formatCurrency(total)}</strong></div>
      <div class="table-wrapper" style="max-height:200px;overflow-y:auto;">
        <table class="data-table">
          <thead><tr><th style="width:40px;"></th><th>일자</th><th>거래처</th><th>품명</th><th class="text-right">합계</th></tr></thead>
          <tbody>${items.map((it, i) => `<tr>
            <td><input type="checkbox" ${it.selected ? 'checked' : ''} onchange="OutsourcingModule._togglePurchaseItem(${i}, this.checked)"></td>
            <td>${it.issueDate}</td>
            <td class="fw-medium">${Utils.escapeHtml(it.partnerCompanyName)}</td>
            <td class="text-xs">${Utils.escapeHtml(it.itemName || '-')}</td>
            <td class="text-right amount">${Utils.formatCurrency(it.totalAmount)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `;
  },

  _togglePurchaseItem(idx, checked) {
    if (this._purchaseDraft && this._purchaseDraft.items[idx]) {
      this._purchaseDraft.items[idx].selected = checked;
      this._renderPurchaseExcelPreview();
    }
  },

  // 통합 저장: 매입세금 등록 + 결의서 등록 + 매칭
  async _saveCombined() {
    const hasPurchases = this._purchaseDraft && this._purchaseDraft.items.some(i => i.selected);
    const hasExpense = !!this._expenseDraft;
    if (!hasPurchases && !hasExpense) {
      Utils.showToast('매입세금계산서 또는 결의서 중 하나는 업로드해야 합니다.', 'error');
      return;
    }

    const user = Auth.currentUser();
    const savedPurchaseIds = [];
    let savedExpenseId = null;
    let purchaseSavedCount = 0;
    let purchaseDupCount = 0;

    try {
      // 1) 매입세금계산서 저장 (선택된 것만)
      if (hasPurchases) {
        // 중복 체크용 기존 purchaseInvoices
        const existingPurchases = await DB.getAll('purchaseInvoices');
        const isDup = (it) => existingPurchases.some(e =>
          e.partnerCompanyName === it.partnerCompanyName &&
          Number(e.totalAmount) === it.totalAmount &&
          e.issueDate === it.issueDate
        );
        for (const it of this._purchaseDraft.items) {
          if (!it.selected) continue;
          if (isDup(it)) { purchaseDupCount++; continue; }
          const id = await DB.add('purchaseInvoices', {
            issueDate: it.issueDate,
            partnerCompanyName: it.partnerCompanyName,
            partnerCode: it.partnerCode || '',
            itemName: it.itemName || '',
            supplyAmount: it.supplyAmount || 0,
            taxAmount: it.taxAmount || 0,
            totalAmount: it.totalAmount || 0,
            hometaxApprovalNo: '',
            memo: `위하고 매입세금 일괄 등록 (대림 자동 식별)`,
            registeredBy: user.id,
            registeredByName: user.displayName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          savedPurchaseIds.push(id);
          purchaseSavedCount++;
        }
      }

      // 2) 결의서 저장 + 매입세금 연결
      if (hasExpense) {
        const d = this._expenseDraft;
        const matchedDepIds = d.lineItems.map(li => li.matchedDepositId).filter(Boolean);
        const matchedTrIds = d.lineItems.map(li => li.matchedTransferId).filter(Boolean);
        const totalMatched = d.lineItems.filter(li => li.matchedDepositId && li.matchedTransferId).length;
        const matchStatus = totalMatched === d.lineItems.length && d.lineItems.length > 0 ? 'completed' : (totalMatched > 0 ? 'partial' : 'pending');

        savedExpenseId = await DB.add(this.EXPENSE_COLLECTION, {
          fileName: d.fileName, fileSize: d.fileSize, fileData: d.file, fileType: 'application/pdf',
          reportDate: d.reportDate, reportNumber: d.reportNumber || '', authorName: d.authorName,
          title: d.title, vendorName: d.vendorName, vendorRepName: d.vendorRepName, vendorAccount: d.vendorAccount,
          totalAmount: d.totalAmount, lineItems: d.lineItems,
          matchedDepositIds: matchedDepIds, matchedTransferIds: matchedTrIds,
          linkedPurchaseInvoiceIds: savedPurchaseIds, // v2 4단계: 매입세금 연결
          matchStatus,
          rawText: (d.rawText || '').slice(0, 5000),
          registeredBy: user.id, registeredByName: user.displayName,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });

        // deposits / transferRecords 역참조
        for (const depId of matchedDepIds) {
          try {
            const ex = await DB.get('deposits', depId);
            if (ex) await DB.update('deposits', { ...ex, id: depId, matchedExpenseReportId: savedExpenseId });
          } catch (e) { console.warn('[Combined] deposit 역참조 실패:', depId, e); }
        }
        for (const trId of matchedTrIds) {
          try {
            const ex = await DB.get('transferRecords', trId);
            if (ex) await DB.update('transferRecords', { ...ex, id: trId, matchedExpenseReportId: savedExpenseId });
          } catch (e) { console.warn('[Combined] transfer 역참조 실패:', trId, e); }
        }

        // 매입세금 → 결의서 역참조
        for (const pid of savedPurchaseIds) {
          try {
            const ex = await DB.get('purchaseInvoices', pid);
            if (ex) await DB.update('purchaseInvoices', { ...ex, id: pid, linkedExpenseReportId: savedExpenseId });
          } catch (e) { console.warn('[Combined] purchase 역참조 실패:', pid, e); }
        }
      }

      // 3) 감사 로그
      await DB.log('CREATE', 'combined', null, `통합 등록: 매입세금 ${purchaseSavedCount}건${purchaseDupCount > 0 ? ` (중복스킵 ${purchaseDupCount})` : ''}${savedExpenseId ? `, 결의서 1건` : ''}`);

      // 4) 결과 토스트
      const parts = [];
      if (purchaseSavedCount > 0) parts.push(`매입세금 ${purchaseSavedCount}건 등록`);
      if (purchaseDupCount > 0) parts.push(`중복 ${purchaseDupCount}건 스킵`);
      if (savedExpenseId) parts.push(`결의서 1건 + 매입연결 ${savedPurchaseIds.length}건`);
      Utils.showToast(parts.join(' · '), 'success', 6000);

      this._expenseDraft = null;
      this._purchaseDraft = null;
      Utils.closeModal();
      await this._reload();
    } catch (e) {
      console.error('[Combined] 저장 실패:', e);
      Utils.showToast('저장 실패: ' + e.message, 'error', 6000);
    }
  },

  // 기존 _openExpenseUpload (PDF 단독 업로드 — 호환용 보존)
  _openExpenseUpload() {
    this._expenseDraft = null;
    Utils.openModal(`
      <div class="modal-header">
        <h3>📄 지출결의서 PDF 업로드</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:80vh;overflow-y:auto;">
        <div id="erDropZone" style="border:2px dashed #94A3B8;border-radius:8px;padding:var(--sp-5);text-align:center;background:#F8FAFC;margin-bottom:var(--sp-3);">
          <div style="font-size:48px;margin-bottom:8px;">📄</div>
          <p style="margin:0 0 12px 0;">PDF를 선택하거나 드래그</p>
          <input type="file" id="erFileInput" accept="application/pdf" style="display:none;" onchange="OutsourcingModule._onExpenseFileSelected(this.files[0])">
          <button class="btn btn-primary" onclick="document.getElementById('erFileInput').click()">파일 선택</button>
          <div id="erFileName" class="text-sm text-muted mt-2"></div>
        </div>
        <div id="erParseSection" class="hidden"><h4>2️⃣ 파싱 결과</h4><div id="erParseContent"></div></div>
        <div id="erMatchSection" class="hidden"><h4>3️⃣ 매출/송금 매칭 후보</h4><div id="erMatchContent"></div></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary hidden" id="erSaveBtn" onclick="OutsourcingModule._saveExpense()">💾 결의서 + 매칭 저장</button>
      </div>
    `, { size: 'modal-xl' });

    setTimeout(() => {
      const dz = document.getElementById('erDropZone');
      if (!dz) return;
      ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.style.background = '#DBEAFE'; }));
      ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.style.background = '#F8FAFC'; }));
      dz.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) this._onExpenseFileSelected(f);
      });
    }, 0);
  },

  async _onExpenseFileSelected(file) {
    if (!file) return;
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      Utils.showToast('PDF 파일만 업로드 가능합니다.', 'error'); return;
    }
    const nameEl = document.getElementById('erFileName');
    if (nameEl) nameEl.textContent = `⏳ "${file.name}" 파싱 중...`;
    try {
      await this._ensurePdfJs();
      const text = await this._extractPdfText(file);
      const parsed = this._parseExpenseReport(text);
      this._expenseDraft = { file, fileName: file.name, fileSize: file.size, rawText: text, ...parsed };
      if (nameEl) nameEl.textContent = `✅ "${file.name}" 파싱 완료 (${parsed.lineItems.length} 라인)`;
      this._renderExpenseParseSection();
      await this._renderExpenseMatchSection();
      // 단독 모달과 통합 모달 모두 호환
      const erBtn = document.getElementById('erSaveBtn');
      if (erBtn) erBtn.classList.remove('hidden');
      const cBtn = document.getElementById('combinedSaveBtn');
      if (cBtn) cBtn.classList.remove('hidden');
    } catch (e) {
      console.error('[ExpenseReports] PDF 파싱 실패:', e);
      if (nameEl) nameEl.textContent = `❌ 파싱 실패: ${e.message}`;
      Utils.showToast('PDF 파싱 실패: ' + e.message, 'error', 6000);
    }
  },

  async _ensurePdfJs() {
    if (this._pdfjsLoaded && window.pdfjsLib) return;
    if (this._pdfjsLoadPromise) return this._pdfjsLoadPromise;
    this._pdfjsLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          this._pdfjsLoaded = true;
          resolve();
        } else reject(new Error('pdfjsLib 글로벌 없음'));
      };
      s.onerror = () => reject(new Error('pdf.js CDN 로드 실패'));
      document.head.appendChild(s);
    });
    return this._pdfjsLoadPromise;
  },

  async _extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let allText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      allText += content.items.map(it => it.str).join(' ') + '\n';
    }
    return allText;
  },

  _parseExpenseReport(text) {
    const result = { reportDate: '', reportNumber: '', authorName: '', title: '', vendorName: '', vendorRepName: '', vendorAccount: '', totalAmount: 0, lineItems: [] };
    const norm = text.replace(/\s+/g, ' ').replace(/\u00A0/g, ' ');

    const dateM = norm.match(/지출일자[:\s]*(\d{4})[년\-./\s]*(\d{1,2})[월\-./\s]*(\d{1,2})/);
    if (dateM) result.reportDate = `${dateM[1]}-${dateM[2].padStart(2,'0')}-${dateM[3].padStart(2,'0')}`;
    const authorM = norm.match(/작성자[:\s]*([가-힣]{2,5})/);
    if (authorM) result.authorName = authorM[1];
    const titleM = norm.match(/지출건명[:\s]*([^\n합계계좌]+?)(?=\s+합계|\s+계좌|\s+적요|$)/);
    if (titleM) result.title = titleM[1].trim().slice(0,100);
    const sumM = norm.match(/합계[:\s]*([\d,]+)\s*원?/);
    if (sumM) result.totalAmount = Number(sumM[1].replace(/,/g,'')) || 0;
    const vendorM = norm.match(/(?:외주\s*업체|외부\s*업체|업체명?)[:\s]*([가-힣A-Za-z0-9㈜()ENGIInc.,\s]+?)(?=\s+(?:홍|박|김|이|최|정|조|윤|강|장|임|한|오|서|신|권|황|안|송|류|전|홍정란|대표|계좌)|$)/);
    if (vendorM) result.vendorName = vendorM[1].trim().slice(0,40);
    else {
      const v2 = norm.match(/(대림건축\s*ENG|[가-힣]+건축\s*ENG|[가-힣A-Za-z]+(?:Inc|건축|설계|엔지니어링|건설))/);
      if (v2) result.vendorName = v2[1].trim();
    }
    const repM = norm.match(/(?:대표자?|담당자?)[:\s]*([가-힣]{2,5})/);
    if (repM) result.vendorRepName = repM[1];
    const acctM = norm.match(/(?:계좌\s*번?호?|계좌)[:\s]*([가-힣]+\s*[\d\-\s]{8,})/);
    if (acctM) result.vendorAccount = acctM[1].trim();

    const lineRe = /([가-힣A-Za-z()㈜\s]+?)\s+([\d,]+)\s*원?\s*입금\s*\(?\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2})\s*\)?\s+([\d,]+)/g;
    let m;
    while ((m = lineRe.exec(norm)) !== null) {
      const clientName = m[1].trim().replace(/\s+/g, ' ').slice(0, 50);
      const depositAmount = Number(m[2].replace(/,/g,'')) || 0;
      const depDateStr = m[3].replace(/[./]/g, '-').split('-');
      const depositDate = `${depDateStr[0]}-${depDateStr[1].padStart(2,'0')}-${depDateStr[2].padStart(2,'0')}`;
      const transferAmount = Number(m[4].replace(/,/g,'')) || 0;
      if (depositAmount > 0 && transferAmount > 0 && clientName.length >= 2) {
        result.lineItems.push({ clientName, depositAmount, depositDate, transferAmount, matchedDepositId: null, matchedTransferId: null });
      }
    }
    return result;
  },

  _renderExpenseParseSection() {
    const d = this._expenseDraft;
    if (!d) return;
    document.getElementById('erParseSection').classList.remove('hidden');
    const body = document.getElementById('erParseContent');
    body.innerHTML = `
      <div class="form-row">
        <div class="form-group"><label>지출일자</label><input type="date" class="form-control" value="${d.reportDate}" oninput="OutsourcingModule._expenseDraft.reportDate = this.value"></div>
        <div class="form-group"><label>작성자</label><input type="text" class="form-control" value="${Utils.escapeHtml(d.authorName)}" oninput="OutsourcingModule._expenseDraft.authorName = this.value"></div>
      </div>
      <div class="form-row"><div class="form-group" style="grid-column:span 2;"><label>지출건명</label><input type="text" class="form-control" value="${Utils.escapeHtml(d.title)}" oninput="OutsourcingModule._expenseDraft.title = this.value"></div></div>
      <div class="form-row">
        <div class="form-group"><label>외주업체</label><input type="text" class="form-control" value="${Utils.escapeHtml(d.vendorName)}" oninput="OutsourcingModule._expenseDraft.vendorName = this.value"></div>
        <div class="form-group"><label>합계</label><input type="text" class="form-control" value="${Utils.formatCurrency(d.totalAmount)}" readonly style="background:#F1F5F9;"></div>
      </div>
      <h5 style="margin-top:var(--sp-3);">라인 ${d.lineItems.length}건</h5>
      ${d.lineItems.length === 0 ? '<div class="text-muted">⚠️ 라인 추출 실패</div>' : `<div class="table-wrapper"><table class="data-table">
        <thead><tr><th>#</th><th>매출처</th><th class="text-right">매출</th><th>입금일</th><th class="text-right">외주송금</th></tr></thead>
        <tbody>${d.lineItems.map((li,i) => `<tr><td>${i+1}</td><td>${Utils.escapeHtml(li.clientName)}</td><td class="text-right amount">${Utils.formatCurrency(li.depositAmount)}</td><td>${li.depositDate}</td><td class="text-right amount">${Utils.formatCurrency(li.transferAmount)}</td></tr>`).join('')}</tbody>
      </table></div>`}
    `;
  },

  async _renderExpenseMatchSection() {
    const d = this._expenseDraft;
    if (!d || d.lineItems.length === 0) return;
    document.getElementById('erMatchSection').classList.remove('hidden');
    const body = document.getElementById('erMatchContent');

    const [allDeposits, allTransfers] = await Promise.all([DB.getAll('deposits'), DB.getAll('transferRecords')]);

    body.innerHTML = d.lineItems.map((li, idx) => {
      const depCand = this._findExpenseDepositCandidates(li, allDeposits);
      const trCand = this._findExpenseTransferCandidates(li, allTransfers, d.vendorName);
      if (depCand.length === 1 && !li.matchedDepositId) li.matchedDepositId = depCand[0].id;
      if (trCand.length === 1 && !li.matchedTransferId) li.matchedTransferId = trCand[0].id;

      return `<div class="card mb-2" style="border-left:3px solid #2563EB;"><div class="card-body">
        <strong>라인 ${idx + 1}: ${Utils.escapeHtml(li.clientName)} → ${Utils.formatCurrency(li.transferAmount)}</strong>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);margin-top:var(--sp-2);">
          <div><div class="text-xs fw-medium">💰 매출 매칭</div>
            ${depCand.length === 0 ? '<div class="text-xs text-muted mt-1">일치 없음</div>' : depCand.map(c => `<div onclick="OutsourcingModule._toggleExpenseMatch(${idx},'deposit','${c.id}')" style="cursor:pointer;padding:6px;margin-top:3px;border-radius:4px;background:${li.matchedDepositId === c.id ? '#DBEAFE' : '#F8FAFC'};border:1px solid ${li.matchedDepositId === c.id ? '#2563EB' : '#E2E8F0'};font-size:0.85rem;"><div>${li.matchedDepositId === c.id ? '✓ ' : ''}${Utils.escapeHtml(c.depositorName)}</div><div class="text-xs text-muted">${Utils.formatDate(c.depositDate)} · ${Utils.formatCurrency(c.amount)}</div></div>`).join('')}
          </div>
          <div><div class="text-xs fw-medium">💸 송금 매칭</div>
            ${trCand.length === 0 ? '<div class="text-xs text-muted mt-1">일치 없음</div>' : trCand.map(c => `<div onclick="OutsourcingModule._toggleExpenseMatch(${idx},'transfer','${c.id}')" style="cursor:pointer;padding:6px;margin-top:3px;border-radius:4px;background:${li.matchedTransferId === c.id ? '#DBEAFE' : '#F8FAFC'};border:1px solid ${li.matchedTransferId === c.id ? '#2563EB' : '#E2E8F0'};font-size:0.85rem;"><div>${li.matchedTransferId === c.id ? '✓ ' : ''}${Utils.escapeHtml(c.recipientName)}</div><div class="text-xs text-muted">${Utils.formatDate(c.transferDate)} · ${Utils.formatCurrency(c.amount)}</div></div>`).join('')}
          </div>
        </div>
      </div></div>`;
    }).join('');
  },

  _toggleExpenseMatch(idx, type, candId) {
    const li = this._expenseDraft.lineItems[idx];
    if (!li) return;
    const k = type === 'deposit' ? 'matchedDepositId' : 'matchedTransferId';
    li[k] = (li[k] === candId) ? null : candId;
    this._renderExpenseMatchSection();
  },

  _findExpenseDepositCandidates(line, allDeposits) {
    const lineDate = new Date(line.depositDate);
    const cleanName = line.clientName.replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s|\(|\)/g, '');
    return allDeposits.filter(d => {
      if (Number(d.amount) !== line.depositAmount) return false;
      if (d.depositDate) {
        const diff = Math.abs((new Date(d.depositDate) - lineDate) / 86400000);
        if (diff > 3) return false;
      }
      return true;
    }).slice(0, 5);
  },

  _findExpenseTransferCandidates(line, allTransfers, vendorName) {
    return allTransfers.filter(t => Number(t.amount) === line.transferAmount).slice(0, 5);
  },

  async _saveExpense() {
    const d = this._expenseDraft;
    if (!d) { Utils.showToast('업로드된 결의서 없음', 'error'); return; }
    if (!d.reportDate) { Utils.showToast('지출일자 확인 필요', 'error'); return; }

    const user = Auth.currentUser();
    const matchedDepIds = d.lineItems.map(li => li.matchedDepositId).filter(Boolean);
    const matchedTrIds = d.lineItems.map(li => li.matchedTransferId).filter(Boolean);
    const totalMatched = d.lineItems.filter(li => li.matchedDepositId && li.matchedTransferId).length;
    const matchStatus = totalMatched === d.lineItems.length && d.lineItems.length > 0 ? 'completed' : (totalMatched > 0 ? 'partial' : 'pending');

    try {
      const reportId = await DB.add(this.EXPENSE_COLLECTION, {
        fileName: d.fileName, fileSize: d.fileSize, fileData: d.file, fileType: 'application/pdf',
        reportDate: d.reportDate, reportNumber: d.reportNumber || '', authorName: d.authorName,
        title: d.title, vendorName: d.vendorName, vendorRepName: d.vendorRepName, vendorAccount: d.vendorAccount,
        totalAmount: d.totalAmount, lineItems: d.lineItems,
        matchedDepositIds: matchedDepIds, matchedTransferIds: matchedTrIds, matchStatus,
        rawText: (d.rawText || '').slice(0, 5000),
        registeredBy: user.id, registeredByName: user.displayName,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });

      for (const depId of matchedDepIds) {
        try {
          const ex = await DB.get('deposits', depId);
          if (ex) await DB.update('deposits', { ...ex, id: depId, matchedExpenseReportId: reportId });
        } catch (e) { console.warn('[ER] deposit 역참조 실패:', depId, e); }
      }
      for (const trId of matchedTrIds) {
        try {
          const ex = await DB.get('transferRecords', trId);
          if (ex) await DB.update('transferRecords', { ...ex, id: trId, matchedExpenseReportId: reportId });
        } catch (e) { console.warn('[ER] transfer 역참조 실패:', trId, e); }
      }

      await DB.log('CREATE', 'expenseReport', reportId, `지출결의서: ${d.title || d.fileName}`);
      Utils.showToast(`저장 완료 (${matchStatus === 'completed' ? '완료' : matchStatus === 'partial' ? '부분' : '미매칭'})`, 'success');
      this._expenseDraft = null;
      Utils.closeModal();
      this._activeTab = 'profit';
      await this._reload();
    } catch (e) {
      console.error('[ER] 저장 실패:', e);
      Utils.showToast('저장 실패: ' + e.message, 'error', 6000);
    }
  },

  async _openExpenseDetail(id) {
    const r = await DB.get(this.EXPENSE_COLLECTION, id);
    if (!r) { Utils.showToast('결의서 없음', 'error'); return; }
    const status = { completed: '<span class="badge badge-complete">완료</span>', partial: '<span class="badge badge-review">부분</span>', pending: '<span class="badge badge-request">미매칭</span>' }[r.matchStatus || 'pending'];
    const lines = (r.lineItems || []).length === 0
      ? '<div class="text-muted">라인 없음</div>'
      : `<div class="table-wrapper"><table class="data-table">
          <thead><tr><th>#</th><th>매출처</th><th class="text-right">매출</th><th>입금일</th><th class="text-right">송금</th><th class="text-center">매출매칭</th><th class="text-center">송금매칭</th></tr></thead>
          <tbody>${(r.lineItems||[]).map((li,i) => `<tr><td>${i+1}</td><td>${Utils.escapeHtml(li.clientName)}</td><td class="text-right amount">${Utils.formatCurrency(li.depositAmount)}</td><td>${li.depositDate}</td><td class="text-right amount">${Utils.formatCurrency(li.transferAmount)}</td><td class="text-center">${li.matchedDepositId ? '✅' : '❌'}</td><td class="text-center">${li.matchedTransferId ? '✅' : '❌'}</td></tr>`).join('')}</tbody>
        </table></div>`;

    Utils.openModal(`
      <div class="modal-header"><h3>📄 ${Utils.escapeHtml(r.title || r.fileName)} ${status}</h3><button class="modal-close" onclick="Utils.closeModal()">&times;</button></div>
      <div class="modal-body" style="max-height:75vh;overflow-y:auto;">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-3);margin-bottom:var(--sp-3);">
          <div><strong>지출일자:</strong> ${r.reportDate}</div>
          <div><strong>작성자:</strong> ${Utils.escapeHtml(r.authorName || '-')}</div>
          <div><strong>총금액:</strong> ${Utils.formatCurrency(r.totalAmount)}</div>
          <div><strong>외주업체:</strong> ${Utils.escapeHtml(r.vendorName || '-')}</div>
          <div><strong>대표자:</strong> ${Utils.escapeHtml(r.vendorRepName || '-')}</div>
          <div><strong>계좌:</strong> ${Utils.escapeHtml(r.vendorAccount || '-')}</div>
        </div>
        <h4>라인 ${(r.lineItems||[]).length}건</h4>
        ${lines}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="OutsourcingModule._downloadExpensePdf('${id}')">📥 원본 PDF 다운로드</button>
        ${Auth.isAdmin() ? `<button class="btn btn-ghost text-danger" onclick="OutsourcingModule._deleteExpense('${id}')">🗑️ 삭제</button>` : ''}
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
      </div>
    `, { size: 'modal-lg' });
  },

  async _downloadExpensePdf(id) {
    try {
      const r = await DB.get(this.EXPENSE_COLLECTION, id);
      if (!r) return;
      const blob = await FirebaseDB.resolveBlob(r.fileData, 'application/pdf');
      if (!blob) { Utils.showToast('파일 데이터 없음', 'error'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = r.fileName || `expense-${id}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { Utils.showToast('다운로드 실패: ' + e.message, 'error'); }
  },

  async _deleteExpense(id) {
    if (!window.confirm('이 결의서를 삭제하시겠습니까? 매칭된 입금/송금의 역참조도 함께 해제됩니다.')) return;
    try {
      const r = await DB.get(this.EXPENSE_COLLECTION, id);
      if (r) {
        for (const depId of (r.matchedDepositIds || [])) {
          try { const ex = await DB.get('deposits', depId); if (ex && ex.matchedExpenseReportId === id) await DB.update('deposits', { ...ex, id: depId, matchedExpenseReportId: null }); } catch {}
        }
        for (const trId of (r.matchedTransferIds || [])) {
          try { const ex = await DB.get('transferRecords', trId); if (ex && ex.matchedExpenseReportId === id) await DB.update('transferRecords', { ...ex, id: trId, matchedExpenseReportId: null }); } catch {}
        }
      }
      await DB.delete(this.EXPENSE_COLLECTION, id);
      await DB.log('DELETE', 'expenseReport', id, '지출결의서 삭제');
      Utils.showToast('삭제 완료', 'success');
      Utils.closeModal();
      await this._reload();
    } catch (e) { Utils.showToast('삭제 실패: ' + e.message, 'error'); }
  },

  destroy() {
    this._expenseDraft = null;
    this._expandedProjectId = null;
  }
};

window.OutsourcingModule = OutsourcingModule;
