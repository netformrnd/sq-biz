/* ============================================
   입금내역 모듈 (포어스토어·위탁 참고 구조 적용)
   - 풍부한 컬럼: 구분·결제방법·처리사항·비고
   - 정렬: 입금일/입금처/금액 클릭 토글
   - 필터: 구분·상태·월·완료숨기기
   ============================================ */

const DepositModule = {
  container: null,
  searchText: '',
  filterCategory: 'all',  // all/위탁/포어/자사몰/미지정
  filterStatus: 'all',     // all/미매칭/매칭완료/확인중
  filterMonth: 'all',      // all/YYYY-MM
  hideCompleted: false,
  sortField: 'depositDate',
  sortDir: 'desc',

  CATEGORIES: ['위탁', '포어', '자사몰', '미지정'],
  PAYMENT_METHODS: ['계좌이체', '카드', '현금', '가상계좌', '기타'],
  ACTION_TYPES: ['세금계산서 발행필요', '현금영수증 발급필요', '처리완료(자사몰)', '처리완료(카드사)', '처리완료(선발행매칭)'],

  async init(container) {
    this.container = container;
    this.searchText = '';
    await this.render();
  },

  async render() {
    const isAdmin = Auth.isAdmin();
    const sessionUser = Auth.currentUser();
    let deposits = await DB.getAll('deposits');

    // ===== 직원 권한: 본인 등록건 + 입금필터 키워드 일치만 보이게 =====
    // (관리자는 전체 보임)
    let restrictionInfo = null;
    if (!isAdmin && sessionUser) {
      // DB에서 최신 user 정보 (관리자가 depositFilter 변경 즉시 반영)
      let user = sessionUser;
      try {
        const freshUser = await DB.get('users', sessionUser.id);
        if (freshUser) user = freshUser;
      } catch (e) {
        console.warn('user fresh load 실패, 세션 정보 사용:', e);
      }
      const includeRaw = (user.depositFilter || '').trim();
      const excludeRaw = (user.depositExcludeFilter || '').trim();
      const includeKeywords = includeRaw
        ? includeRaw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
        : [];
      const excludeKeywords = excludeRaw
        ? excludeRaw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
        : [];
      const beforeCount = deposits.length;
      deposits = deposits.filter(d => {
        // 1) 본인 등록건은 항상 보임
        if (d.registeredBy === user.id) return true;

        const depName = (d.depositorName || '').toLowerCase();

        // 2) 제외 키워드가 입금자명에 포함되면 숨김 (잡수입 제외)
        if (excludeKeywords.length > 0 && excludeKeywords.some(k => depName.includes(k))) {
          return false;
        }

        // 3) 포함 키워드 설정된 경우 → 그 키워드 있어야 보임
        if (includeKeywords.length > 0) {
          return includeKeywords.some(k => depName.includes(k));
        }

        // 4) 포함 키워드 없으면 제외 키워드 통과한 모든 입금 보임
        return excludeKeywords.length > 0;
      });
      restrictionInfo = {
        include: includeRaw,
        exclude: excludeRaw,
        before: beforeCount,
        after: deposits.length
      };
    }

    // 날짜 필터
    DateFilter.onChange('deposits', () => this.render());
    let filtered = DateFilter.filter(deposits, 'depositDate', 'deposits');

    // 검색 필터
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      filtered = filtered.filter(d =>
        (d.depositorName || '').toLowerCase().includes(q) ||
        (d.projectName || '').toLowerCase().includes(q) ||
        (d.memo || '').toLowerCase().includes(q) ||
        (d.partnerCompanyName || '').toLowerCase().includes(q) ||
        String(d.amount).includes(q)
      );
    }

    // 구분 필터
    if (this.filterCategory !== 'all') {
      filtered = filtered.filter(d => (d.category || '미지정') === this.filterCategory);
    }
    // 상태 필터
    if (this.filterStatus !== 'all') {
      filtered = filtered.filter(d => (d.matchStatus || '미매칭') === this.filterStatus);
    }
    // 월 필터
    if (this.filterMonth !== 'all') {
      filtered = filtered.filter(d => (d.depositDate || '').slice(0, 7) === this.filterMonth);
    }
    // 완료 숨기기
    if (this.hideCompleted) {
      filtered = filtered.filter(d => (d.matchStatus || '미매칭') !== '매칭완료');
    }

    // 정렬
    const dir = this.sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const va = a[this.sortField] || '';
      const vb = b[this.sortField] || '';
      if (this.sortField === 'amount') return (Number(va) - Number(vb)) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });

    // 합계
    const totalAmount = filtered.reduce((s, d) => s + (d.amount || 0), 0);
    const matchedCount = filtered.filter(d => d.matchStatus === '매칭완료').length;
    const unmatchedCount = filtered.length - matchedCount;

    // 월 옵션 생성
    const monthsSet = new Set();
    deposits.forEach(d => { if (d.depositDate) monthsSet.add(d.depositDate.slice(0, 7)); });
    const months = Array.from(monthsSet).sort().reverse();

    const sortIndicator = (field) => this.sortField === field ? (this.sortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅';

    let tableRows = '';
    if (filtered.length === 0) {
      tableRows = `<tr><td colspan="10" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">💰</div><h3>입금내역이 없습니다</h3></div>
      </td></tr>`;
    } else {
      tableRows = filtered.map(d => {
        const matched = d.matchStatus === '매칭완료';
        const category = d.category || '미지정';
        const catBadge = {
          '위탁': 'background:rgba(139,92,246,.12);color:#7c3aed;',
          '포어': 'background:rgba(59,130,246,.12);color:#2563eb;',
          '자사몰': 'background:rgba(16,185,129,.12);color:#059669;',
          '미지정': 'background:rgba(148,163,184,.15);color:#64748b;'
        }[category];

        // 처리사항 텍스트 (자동 유추)
        let actionText = d.actionRequired || '';
        if (!actionText) {
          if (matched) actionText = '처리완료(선발행매칭)';
          else actionText = '세금계산서 발행필요';
        }
        const actionDone = actionText.startsWith('처리완료');

        return `
          <tr oncontextmenu="DepositModule._showContextMenu(event, '${d.id}')" ${matched ? 'style="background:rgba(16,185,129,.04);"' : ''}>
            <td>${Utils.formatDate(d.depositDate)}</td>
            <td class="fw-medium">${Utils.escapeHtml(d.depositorName || '-')}</td>
            <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;${catBadge}">${Utils.escapeHtml(category)}</span></td>
            <td class="text-right amount">${Utils.formatCurrency(d.amount)}</td>
            <td class="text-xs text-muted">${Utils.escapeHtml(d.orderNumber || '-')}</td>
            <td class="text-xs">${Utils.escapeHtml(d.paymentMethod || '계좌이체')}</td>
            <td class="text-center">${Utils.statusBadge(d.matchStatus || '미매칭')}</td>
            <td class="text-xs">${Utils.escapeHtml(d.partnerCompanyName || d.projectName || '-')}</td>
            <td>
              <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;${actionDone ? 'background:rgba(16,185,129,.12);color:#059669;' : 'background:rgba(245,158,11,.15);color:#b45309;'}">
                ${Utils.escapeHtml(actionText)}
              </span>
            </td>
            <td>
              ${isAdmin ? `
                <div class="d-flex gap-1">
                  <button class="btn btn-ghost btn-sm" onclick="DepositModule._edit('${d.id}')" title="수정">✏️</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="DepositModule._delete('${d.id}')" title="삭제">🗑️</button>
                </div>
              ` : ''}
            </td>
          </tr>
        `;
      }).join('');
    }

    // 직원 권한 안내 배너
    let restrictionMsg = '';
    if (restrictionInfo) {
      const parts = [];
      if (restrictionInfo.include) parts.push(`포함 키워드 <strong>"${Utils.escapeHtml(restrictionInfo.include)}"</strong>`);
      if (restrictionInfo.exclude) parts.push(`제외 키워드 <strong>"${Utils.escapeHtml(restrictionInfo.exclude)}"</strong>`);
      if (parts.length > 0) {
        restrictionMsg = `본인 등록건 + ${parts.join(' / ')} 적용`;
      } else {
        restrictionMsg = '본인이 직접 등록한 입금만 보입니다. (필터 미설정)';
      }
    }
    const restrictionBanner = (!isAdmin && restrictionInfo) ? `
      <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-3);font-size:var(--font-size-sm);">
        ℹ️ <strong>제한된 화면입니다.</strong>
        ${restrictionMsg}
        <span class="text-muted">(전체 ${restrictionInfo.before}건 중 ${restrictionInfo.after}건 표시)</span>
      </div>
    ` : '';

    this.container.innerHTML = `
      <div class="page-header">
        <h2>입금내역</h2>
        ${isAdmin ? `
          <div class="page-actions">
            <button class="btn btn-secondary" onclick="DepositModule._openPasteModal()">📋 엑셀 붙여넣기 등록</button>
            <button class="btn btn-primary" onclick="DepositModule._openAddModal()">+ 개별 등록</button>
          </div>
        ` : ''}
      </div>
      ${restrictionBanner}

      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon cyan">💰</div>
          <div class="card-info">
            <div class="card-label">전체 입금건수</div>
            <div class="card-value">${filtered.length}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon green">📊</div>
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
          </div>
        </div>
        <div class="summary-card" style="border-left:4px solid var(--color-warning);">
          <div class="card-icon orange">⚠️</div>
          <div class="card-info">
            <div class="card-label">미매칭</div>
            <div class="card-value">${unmatchedCount}건</div>
          </div>
        </div>
      </div>

      <div class="mb-4">${DateFilter.render('deposits')}</div>

      <div class="table-wrapper">
        <div class="table-toolbar" style="flex-wrap:wrap;gap:var(--sp-2);">
          <div class="toolbar-left d-flex gap-2" style="flex-wrap:wrap;align-items:center;">
            <div class="search-input">
              <span class="search-icon">🔍</span>
              <input type="text" class="form-control" id="depositSearch" placeholder="입금자/거래처/프로젝트 검색..." value="${Utils.escapeHtml(this.searchText)}">
            </div>
            <select class="form-control" style="width:auto;" onchange="DepositModule._setCategory(this.value)">
              <option value="all" ${this.filterCategory === 'all' ? 'selected' : ''}>전체 구분</option>
              ${this.CATEGORIES.map(c => `<option value="${c}" ${this.filterCategory === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
            <select class="form-control" style="width:auto;" onchange="DepositModule._setStatus(this.value)">
              <option value="all" ${this.filterStatus === 'all' ? 'selected' : ''}>전체 상태</option>
              <option value="미매칭" ${this.filterStatus === '미매칭' ? 'selected' : ''}>미매칭</option>
              <option value="매칭완료" ${this.filterStatus === '매칭완료' ? 'selected' : ''}>매칭완료</option>
              <option value="확인중" ${this.filterStatus === '확인중' ? 'selected' : ''}>확인중</option>
            </select>
            <select class="form-control" style="width:auto;" onchange="DepositModule._setMonth(this.value)">
              <option value="all" ${this.filterMonth === 'all' ? 'selected' : ''}>전체 월</option>
              ${months.map(m => `<option value="${m}" ${this.filterMonth === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
            <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer;">
              <input type="checkbox" ${this.hideCompleted ? 'checked' : ''} onchange="DepositModule._toggleHideCompleted(this.checked)">
              완료 숨기기
            </label>
          </div>
          <div class="toolbar-right text-sm text-muted">
            총 ${filtered.length}건 · ${Utils.formatCurrency(totalAmount)}
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th style="cursor:pointer;user-select:none;" onclick="DepositModule._sort('depositDate')">입금일${sortIndicator('depositDate')}</th>
              <th style="cursor:pointer;user-select:none;" onclick="DepositModule._sort('depositorName')">입금처${sortIndicator('depositorName')}</th>
              <th>구분</th>
              <th class="text-right" style="cursor:pointer;user-select:none;" onclick="DepositModule._sort('amount')">금액${sortIndicator('amount')}</th>
              <th>주문번호</th>
              <th>결제방법</th>
              <th class="text-center">상태</th>
              <th>거래처</th>
              <th>처리사항</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;

    // 검색 이벤트 (한글 IME 조합 처리 + debounce)
    Utils.bindSearchInput(document.getElementById('depositSearch'), (value) => {
      this.searchText = value;
      this.render();
    });
  },

  _setCategory(v) { this.filterCategory = v; this.render(); },
  _setStatus(v) { this.filterStatus = v; this.render(); },
  _setMonth(v) { this.filterMonth = v; this.render(); },
  _toggleHideCompleted(checked) { this.hideCompleted = checked; this.render(); },
  _sort(field) {
    if (this.sortField === field) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDir = 'desc';
    }
    this.render();
  },

  // ===== 엑셀 붙여넣기 일괄 등록 =====
  _openPasteModal() {
    Utils.openModal(`
      <div class="modal-header">
        <h3>📋 엑셀 붙여넣기 입금내역 등록</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-4);font-size:var(--font-size-sm);">
          <strong>사용법:</strong> 은행 거래내역 엑셀에서 입금 행들을 복사(Ctrl+C)한 후 아래 영역에 붙여넣기(Ctrl+V) 하세요.<br>
          <span class="text-muted">컬럼 순서: 거래일시 | 출금 | 입금 | 잔액 | 거래처명 | ... (은행 기본 형식)</span>
        </div>

        <div class="form-group">
          <label>엑셀 데이터 붙여넣기 <span class="required">*</span></label>
          <textarea id="pasteArea" class="form-control" rows="8"
                    placeholder="엑셀에서 복사한 데이터를 여기에 붙여넣기 하세요 (Ctrl+V)"
                    style="font-family:monospace;font-size:12px;"></textarea>
        </div>

        <button class="btn btn-secondary mb-4" onclick="DepositModule._parsePastedData()">데이터 확인</button>

        <!-- 파싱 결과 미리보기 -->
        <div id="pastePreview" class="hidden">
          <div class="form-group">
            <label class="fw-semibold">입금 내역 미리보기</label>
            <div class="text-xs text-muted mb-2">입금액이 0이거나 빈 행은 자동으로 제외됩니다 (출금 내역 제외)</div>
          </div>
          <div class="table-wrapper" style="max-height:300px;overflow-y:auto;">
            <table class="data-table" id="pastePreviewTable">
              <thead>
                <tr>
                  <th style="width:40px;">
                    <input type="checkbox" id="pasteSelectAll" checked onchange="DepositModule._toggleSelectAll(this.checked)">
                  </th>
                  <th>입금일</th>
                  <th>입금자명</th>
                  <th class="text-right">입금액</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div id="pasteCount" class="text-sm text-muted mt-2"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="pasteSaveBtn" onclick="DepositModule._savePastedData()" disabled>선택 항목 등록</button>
      </div>
    `, { size: 'modal-lg' });
  },

  // 엑셀 데이터 파싱 (탭 구분)
  _parsedRows: [],

  _parsePastedData() {
    const raw = document.getElementById('pasteArea').value.trim();
    if (!raw) {
      Utils.showToast('붙여넣기 데이터가 없습니다.', 'error');
      return;
    }

    const lines = raw.split('\n').filter(l => l.trim());
    this._parsedRows = [];

    for (const line of lines) {
      // 탭 또는 여러 공백으로 분리
      const cols = line.split('\t');

      if (cols.length < 5) continue; // 최소 5컬럼 필요

      const dateStr = (cols[0] || '').trim();
      const withdrawStr = (cols[1] || '').trim();
      const depositStr = (cols[2] || '').trim();
      const balanceStr = (cols[3] || '').trim();

      // 입금액 추출 (콤마 제거)
      const depositAmount = Number(depositStr.replace(/[,\s]/g, '')) || 0;

      // 입금액이 0이면 건너뜀 (출금 내역)
      if (depositAmount <= 0) continue;

      // 잔액 (거래 후 잔액) — 비어있으면 null
      let balanceAfter = null;
      if (balanceStr) {
        const bn = Number(balanceStr.replace(/[,\s]/g, ''));
        if (Number.isFinite(bn)) balanceAfter = Math.trunc(bn);
      }

      // 입금자명: 은행마다 컬럼 위치가 다르므로 cols[3]부터 탐색
      let accountNo = '';
      let depositorName = '';
      for (let i = 3; i < cols.length; i++) {
        const val = (cols[i] || '').trim();
        if (!val) continue;
        if (/^\d{5,}$/.test(val.replace(/[-\s]/g, '')) && !accountNo) accountNo = val;
        if (/[가-힣]/.test(val) && !depositorName) depositorName = val;
      }
      if (!depositorName) depositorName = (cols[4] || '').trim();
      const nameStr = accountNo && depositorName ? `${depositorName} (${accountNo})` : depositorName || accountNo;

      // 날짜 파싱
      let date = '';
      if (dateStr) {
        const dateMatch = dateStr.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
        if (dateMatch) {
          date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
        }
      }

      this._parsedRows.push({
        date: date,
        name: nameStr,
        amount: depositAmount,
        balanceAfter,
        selected: true
      });
    }

    // 미리보기 표시
    const preview = document.getElementById('pastePreview');
    const tbody = document.querySelector('#pastePreviewTable tbody');
    const saveBtn = document.getElementById('pasteSaveBtn');

    if (this._parsedRows.length === 0) {
      preview.classList.add('hidden');
      saveBtn.disabled = true;
      Utils.showToast('입금 데이터를 찾을 수 없습니다. 엑셀에서 올바르게 복사했는지 확인하세요.', 'warning');
      return;
    }

    preview.classList.remove('hidden');
    saveBtn.disabled = false;

    tbody.innerHTML = this._parsedRows.map((row, i) => `
      <tr>
        <td><input type="checkbox" data-idx="${i}" ${row.selected ? 'checked' : ''} onchange="DepositModule._toggleRow(${i}, this.checked)"></td>
        <td>${Utils.escapeHtml(row.date)}</td>
        <td class="fw-medium">${Utils.escapeHtml(row.name)}</td>
        <td class="text-right amount">${Utils.formatCurrency(row.amount)}</td>
      </tr>
    `).join('');

    const totalAmt = this._parsedRows.filter(r => r.selected).reduce((s, r) => s + r.amount, 0);
    document.getElementById('pasteCount').textContent =
      `총 ${this._parsedRows.length}건 / 합계 ${Utils.formatCurrency(totalAmt)}`;
  },

  _toggleRow(idx, checked) {
    this._parsedRows[idx].selected = checked;
    const selectedCount = this._parsedRows.filter(r => r.selected).length;
    const totalAmt = this._parsedRows.filter(r => r.selected).reduce((s, r) => s + r.amount, 0);
    document.getElementById('pasteCount').textContent =
      `선택 ${selectedCount}건 / ${this._parsedRows.length}건 / 합계 ${Utils.formatCurrency(totalAmt)}`;
    document.getElementById('pasteSaveBtn').disabled = selectedCount === 0;
  },

  _toggleSelectAll(checked) {
    this._parsedRows.forEach((r, i) => {
      r.selected = checked;
      const cb = document.querySelector(`input[data-idx="${i}"]`);
      if (cb) cb.checked = checked;
    });
    const totalAmt = checked ? this._parsedRows.reduce((s, r) => s + r.amount, 0) : 0;
    const cnt = checked ? this._parsedRows.length : 0;
    document.getElementById('pasteCount').textContent =
      `선택 ${cnt}건 / ${this._parsedRows.length}건 / 합계 ${Utils.formatCurrency(totalAmt)}`;
    document.getElementById('pasteSaveBtn').disabled = !checked;
  },

  async _savePastedData() {
    const selected = this._parsedRows.filter(r => r.selected);
    if (selected.length === 0) return;

    const user = Auth.currentUser();
    let savedCount = 0;

    for (const row of selected) {
      await DB.add('deposits', {
        depositDate: row.date,
        depositorName: row.name,
        amount: row.amount,
        balanceAfter: row.balanceAfter ?? null,
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
      savedCount++;
    }

    await DB.log('CREATE', 'deposit', null, `입금내역 일괄 등록: ${savedCount}건`);
    this._parsedRows = [];

    Utils.closeModal();
    Utils.showToast(`${savedCount}건의 입금내역이 등록되었습니다.`, 'success');
    await this.render();
  },

  // ===== 개별 등록 =====
  _openAddModal(editData = null) {
    const isEdit = !!editData;
    const title = isEdit ? '입금내역 수정' : '입금내역 개별 등록';
    const cats = this.CATEGORIES;
    const pays = this.PAYMENT_METHODS;
    const acts = this.ACTION_TYPES;
    const editCat = editData?.category || '미지정';
    const editPay = editData?.paymentMethod || '계좌이체';
    const editAct = editData?.actionRequired || '';

    Utils.openModal(`
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="depositForm">
          <div class="form-row">
            <div class="form-group">
              <label for="depDate">입금일 <span class="required">*</span></label>
              <input type="date" id="depDate" class="form-control" value="${editData ? editData.depositDate : Utils.today()}" required>
            </div>
            <div class="form-group">
              <label for="depName">입금처 <span class="required">*</span></label>
              <input type="text" id="depName" class="form-control" placeholder="입금자명/입금처" value="${editData ? Utils.escapeHtml(editData.depositorName) : ''}" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="depAmount">금액 <span class="required">*</span></label>
              <input type="number" id="depAmount" class="form-control" placeholder="0" min="0" value="${editData ? editData.amount : ''}" required>
            </div>
            <div class="form-group">
              <label for="depCategory">구분</label>
              <select id="depCategory" class="form-control">
                ${cats.map(c => `<option value="${c}" ${editCat === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="depPayment">결제방법</label>
              <select id="depPayment" class="form-control">
                ${pays.map(p => `<option value="${p}" ${editPay === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="depOrderNo">주문번호</label>
              <input type="text" id="depOrderNo" class="form-control" placeholder="주문번호 또는 거래 식별자" value="${editData ? Utils.escapeHtml(editData.orderNumber || '') : ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="depPartner">거래처</label>
              <input type="text" id="depPartner" class="form-control" placeholder="관련 거래처 상호" value="${editData ? Utils.escapeHtml(editData.partnerCompanyName || editData.projectName || '') : ''}">
            </div>
            <div class="form-group">
              <label for="depAction">처리사항</label>
              <select id="depAction" class="form-control">
                <option value="" ${!editAct ? 'selected' : ''}>(자동 판별)</option>
                ${acts.map(a => `<option value="${a}" ${editAct === a ? 'selected' : ''}>${a}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="depMemo">비고 / 메모</label>
            <textarea id="depMemo" class="form-control" rows="2" placeholder="비고 또는 메모">${editData ? Utils.escapeHtml(editData.memo || '') : ''}</textarea>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="DepositModule._saveDeposit(${isEdit ? `'${editData.id}'` : 'null'})">${isEdit ? '수정' : '등록'}</button>
      </div>
    `);
  },

  async _saveDeposit(editId) {
    const date = document.getElementById('depDate').value;
    const name = document.getElementById('depName').value.trim();
    const amount = Number(document.getElementById('depAmount').value) || 0;

    if (!date || !name || amount <= 0) {
      Utils.showToast('입금일, 입금처, 금액을 입력해 주세요.', 'error');
      return;
    }

    const user = Auth.currentUser();
    const data = {
      depositDate: date,
      depositorName: name,
      amount,
      category: document.getElementById('depCategory').value,
      paymentMethod: document.getElementById('depPayment').value,
      orderNumber: document.getElementById('depOrderNo').value.trim(),
      partnerCompanyName: document.getElementById('depPartner').value.trim(),
      actionRequired: document.getElementById('depAction').value,
      projectName: document.getElementById('depPartner').value.trim(),
      memo: document.getElementById('depMemo').value.trim(),
      bankAccount: '',
      matchStatus: '미매칭',
      matchedInvoiceId: null,
      registeredBy: user.id,
      registeredByName: user.displayName,
      updatedAt: new Date().toISOString()
    };

    // 1) 데이터 저장
    let saved = false;
    try {
      if (editId) {
        const existing = await DB.get('deposits', editId);
        data.id = editId;
        data.matchStatus = existing.matchStatus;
        data.matchedInvoiceId = existing.matchedInvoiceId;
        data.createdAt = existing.createdAt;
        await DB.update('deposits', data);
        await DB.log('UPDATE', 'deposit', editId, '입금내역 수정');
      } else {
        data.createdAt = new Date().toISOString();
        const id = await DB.add('deposits', data);
        await DB.log('CREATE', 'deposit', id, `입금내역 등록: ${name} ${Utils.formatCurrency(amount)}`);
      }
      saved = true;
      Utils.closeModal();
      Utils.showToast(editId ? '수정 완료' : '등록 완료', 'success');
    } catch (err) {
      Utils.showToast('저장 실패: ' + err.message, 'error');
      return;
    }

    // 2) 화면 갱신은 별도 try (실패해도 저장은 OK)
    try {
      // 컨테이너가 살아있고 현재 페이지가 입금내역일 때만 렌더
      const path = (window.location.hash || '').slice(1).split('?')[0];
      if (path === '/finance' || path === '/deposits') {
        if (!this.container || !document.body.contains(this.container)) {
          this.container = document.getElementById('pageContent') || document.getElementById('contentArea');
        }
        if (this.container) await this.render();
      }
    } catch (renderErr) {
      console.warn('화면 갱신 실패 (데이터는 정상 저장됨):', renderErr);
    }
  },

  async _edit(id) {
    const item = await DB.get('deposits', id);
    if (item) this._openAddModal(item);
  },

  async _delete(id) {
    const confirmed = await Utils.confirm('이 입금내역을 삭제하시겠습니까?', '입금내역 삭제');
    if (!confirmed) return;

    await DB.delete('deposits', id);
    await DB.log('DELETE', 'deposit', id, '입금내역 삭제');
    await this.render();
  },

  // 우클릭 컨텍스트 메뉴
  _showContextMenu(event, id) {
    const isAdmin = Auth.isAdmin();
    const items = [];

    if (isAdmin) {
      items.push({ icon: '✏️', label: '수정', onClick: () => this._edit(id) });
      items.push({ divider: true });
      items.push({ icon: '🗑️', label: '삭제', danger: true, onClick: () => this._delete(id) });
    } else {
      items.push({ icon: 'ℹ️', label: '관리자만 수정/삭제 가능', onClick: () => {} });
    }

    ContextMenu.show(event, items);
  },

  destroy() {}
};

window.DepositModule = DepositModule;
