/* ============================================
   매입 세금계산서 모듈 (외주업체 수령)
   - 위하고/홈택스 매입 엑셀 붙여넣기 → 일괄 등록
   - 개별 등록 / 수정 / 삭제
   - 검색 / 필터링
   - 권한: 관리자 + 'purchaseInvoices' 메뉴 권한 보유자
   ============================================ */

const PurchaseInvoiceModule = {
  container: null,
  searchText: '',
  _parsed: [],

  async init(container) {
    this.container = container;
    await this.render();
  },

  async render() {
    const all = await DB.getAll('purchaseInvoices');
    let items = all.slice().reverse();

    // 날짜 필터 (issueDate 우선, 없으면 createdAt)
    DateFilter.onChange('purchaseInvoices', () => this.render());
    const itemsWithDate = items.map(i => ({ ...i, _filterDate: i.issueDate || i.createdAt }));
    items = DateFilter.filter(itemsWithDate, '_filterDate', 'purchaseInvoices');

    // 검색 필터
    let filtered = items;
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      filtered = items.filter(item =>
        (item.partnerCompanyName || '').toLowerCase().includes(q) ||
        (item.partnerRegNumber || '').toLowerCase().includes(q) ||
        (item.hometaxApprovalNo || '').toLowerCase().includes(q) ||
        (item.memo || '').toLowerCase().includes(q) ||
        String(item.totalAmount || '').includes(q)
      );
    }

    // 합계 통계
    const totalSupply = filtered.reduce((s, i) => s + (i.supplyAmount || 0), 0);
    const totalTax = filtered.reduce((s, i) => s + (i.taxAmount || 0), 0);
    const totalAmt = filtered.reduce((s, i) => s + (i.totalAmount || 0), 0);

    // 테이블 행
    let tableRows = '';
    if (filtered.length === 0) {
      tableRows = `<tr><td colspan="8" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">📥</div>
        <h3>등록된 매입 세금계산서가 없습니다</h3>
        <p class="text-muted">우측 상단 [매입 붙여넣기] 또는 [+ 개별 등록] 버튼으로 추가하세요.</p>
        </div></td></tr>`;
    } else {
      tableRows = filtered.map(item => `
        <tr>
          <td>${Utils.formatDate(item.issueDate)}</td>
          <td class="fw-medium" title="${Utils.escapeHtml(item.partnerCompanyName || '')}">${Utils.escapeHtml(item.partnerCompanyName || '-')}</td>
          <td class="text-xs">${Utils.escapeHtml(item.partnerRegNumber || '-')}</td>
          <td class="text-right">${Utils.formatCurrency(item.supplyAmount || 0)}</td>
          <td class="text-right">${Utils.formatCurrency(item.taxAmount || 0)}</td>
          <td class="text-right fw-medium amount">${Utils.formatCurrency(item.totalAmount || 0)}</td>
          <td class="text-xs text-muted" title="${Utils.escapeHtml(item.memo || '')}">${Utils.escapeHtml((item.memo || '').slice(0, 30))}</td>
          <td>
            <div class="d-flex gap-1">
              <button class="btn btn-ghost btn-sm" onclick="PurchaseInvoiceModule._openDetail('${item.id}')" title="상세/수정">👁️</button>
              <button class="btn btn-ghost btn-sm text-danger" onclick="PurchaseInvoiceModule._delete('${item.id}')" title="삭제">🗑️</button>
            </div>
          </td>
        </tr>
      `).join('');
    }

    const isAdmin = Auth.isAdmin();
    this.container.innerHTML = `
      <div class="page-header">
        <h2>📥 매입 세금계산서 ${!isAdmin ? '<span class="text-xs text-muted" style="font-weight:400;">· 조회 모드</span>' : ''}</h2>
        ${isAdmin ? `
          <div class="page-actions d-flex gap-2">
            <button class="btn btn-secondary btn-sm" onclick="PurchaseInvoiceModule._openPasteModal()">📋 매입 붙여넣기</button>
            <button class="btn btn-primary btn-sm" onclick="PurchaseInvoiceModule._openAddModal()">+ 개별 등록</button>
          </div>
        ` : ''}
      </div>

      <div class="grid grid-3 gap-3 mb-4">
        <div class="card" style="border-left:4px solid #3B82F6;">
          <div class="card-body">
            <div class="text-sm text-muted">📊 매입 건수</div>
            <div style="font-size:1.5rem;font-weight:700;color:#3B82F6;">${filtered.length}건</div>
          </div>
        </div>
        <div class="card" style="border-left:4px solid #10B981;">
          <div class="card-body">
            <div class="text-sm text-muted">💰 공급가액 합계</div>
            <div style="font-size:1.5rem;font-weight:700;color:#10B981;">${Utils.formatCurrency(totalSupply)}</div>
          </div>
        </div>
        <div class="card" style="border-left:4px solid #F59E0B;">
          <div class="card-body">
            <div class="text-sm text-muted">🧾 총액 (VAT 포함)</div>
            <div style="font-size:1.5rem;font-weight:700;color:#F59E0B;">${Utils.formatCurrency(totalAmt)}</div>
          </div>
        </div>
      </div>

      <div class="mb-4">${DateFilter.render('purchaseInvoices')}</div>

      <div style="display:flex;gap:var(--sp-2);align-items:center;margin-bottom:var(--sp-3);flex-wrap:wrap;">
        <div class="search-input" style="flex:1;min-width:250px;">
          <span class="search-icon">🔍</span>
          <input type="text" id="purchaseSearch" class="form-control" placeholder="매입처/사업자번호/승인번호/품목/금액 검색..." value="${Utils.escapeHtml(this.searchText || '')}">
        </div>
        <div class="text-sm text-muted">총 ${filtered.length}건 · 부가세 ${Utils.formatCurrency(totalTax)}</div>
      </div>

      <div class="table-wrapper" style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>작성일</th>
              <th>매입처(공급자)</th>
              <th>사업자번호</th>
              <th class="text-right">공급가액</th>
              <th class="text-right">부가세</th>
              <th class="text-right">합계금액</th>
              <th>품목/비고</th>
              <th style="width:90px;">관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;

    // 검색 이벤트
    const searchEl = document.getElementById('purchaseSearch');
    if (searchEl) {
      searchEl.addEventListener('input', Utils.debounce((e) => {
        this.searchText = e.target.value;
        this.render();
      }, 300));
    }
  },

  // ===== 붙여넣기 모달 =====
  _openPasteModal() {
    this._parsed = [];
    Utils.openModal(`
      <div class="modal-header">
        <h3>📋 매입 세금계산서 엑셀 붙여넣기</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-4);font-size:var(--font-size-sm);">
          <strong>✨ 헤더 행을 함께 복사해 주세요:</strong><br>
          <span class="text-muted">
            • <strong>홈택스 매입:</strong> <code>작성일자 | 승인번호 | 공급자사업자등록번호 | 상호 | 합계금액 | 공급가액 | 세액 | 비고</code><br>
            • <strong>위하고 매입:</strong> <code>일자 | Code | 거래처 | 유형 | 품명 | 공급가액 | 부가세 | 합계 | ...</code><br>
            헤더를 포함하면 컬럼 순서가 달라도 자동 매핑됩니다. 형식(홈택스/위하고) 자동 감지.
          </span>
        </div>

        <div class="form-group">
          <label>매입 세금계산서 목록 붙여넣기 <span class="required">*</span></label>
          <textarea id="purchasePasteArea" class="form-control" rows="8"
                    placeholder="위하고 또는 홈택스에서 복사한 매입 세금계산서 데이터(헤더 포함)를 여기에 붙여넣기 (Ctrl+V)"
                    style="font-family:monospace;font-size:12px;"></textarea>
        </div>

        <div class="d-flex gap-2 mb-4">
          <button class="btn btn-secondary" onclick="PurchaseInvoiceModule._parsePaste()">🔍 데이터 분석</button>
        </div>

        <div id="purchaseParseResult" class="hidden">
          <div class="card mb-4">
            <div class="card-header" style="background:var(--color-primary-light);">
              <h3>📝 매입 세금계산서 <span id="purchaseParsedCount" class="text-sm text-muted"></span></h3>
              <div class="d-flex gap-2">
                <label class="text-sm d-flex items-center gap-1" style="margin:0;">
                  <input type="checkbox" id="purchaseParsedAll" checked onchange="PurchaseInvoiceModule._toggleAllRows(this.checked)"> 전체 선택
                </label>
              </div>
            </div>
            <div class="card-body" style="padding:0;max-height:350px;overflow-y:auto;">
              <table class="data-table" id="purchaseParseTable">
                <thead>
                  <tr>
                    <th style="width:40px;"></th>
                    <th>작성일</th>
                    <th>매입처</th>
                    <th>사업자번호</th>
                    <th class="text-right">공급가액</th>
                    <th class="text-right">세액</th>
                    <th class="text-right">합계</th>
                    <th>품목/비고</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </div>
          <div id="purchaseParseSummary" class="text-sm text-muted"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" id="purchaseSaveBtn" onclick="PurchaseInvoiceModule._savePaste()" disabled>선택 항목 등록</button>
      </div>
    `, { size: 'modal-xl' });
  },

  // ===== 파싱 (매출과 동일한 로직, 위하고/홈택스 자동 감지) =====
  _splitCols(line) {
    // 탭 우선, 없으면 다중 공백
    if (line.includes('\t')) return line.split('\t');
    return line.split(/\s{2,}/);
  },

  _parseHeader(cols) {
    const mapping = {
      issueDate: -1, approvalNo: -1,
      partnerRegNumber: -1, partnerCompany: -1,
      supplyAmount: -1, taxAmount: -1, totalAmount: -1,
      memo: -1, format: null
    };

    const hasGeorae = cols.some(c => /^거래처\s*$/.test((c || '').trim()));
    const hasBizReg = cols.some(c => /사업자\s*등록번호|사업자번호/.test((c || '').trim()));

    if (hasGeorae && !hasBizReg) {
      // 위하고
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
      if (mapping.issueDate >= 0 && mapping.partnerCompany >= 0 && mapping.supplyAmount >= 0) return mapping;
      return null;
    }

    // 홈택스 매입: 공급자(첫번째 사업자등록번호) 영역이 매입처
    mapping.format = 'hometax';
    let bizRegCount = 0;
    let supplierStartIdx = -1;
    for (let i = 0; i < cols.length; i++) {
      const c = (cols[i] || '').trim();
      if (/사업자\s*등록번호|사업자번호/.test(c)) {
        bizRegCount++;
        if (bizRegCount === 1) {
          mapping.partnerRegNumber = i;
          supplierStartIdx = i;
        }
      }
    }

    for (let i = 0; i < cols.length; i++) {
      const c = (cols[i] || '').trim();
      if (!c) continue;
      if (/^작성일자/.test(c) && mapping.issueDate < 0) { mapping.issueDate = i; continue; }
      if (/^승인번호/.test(c) && mapping.approvalNo < 0) { mapping.approvalNo = i; continue; }

      // 공급자 영역(첫 사업자등록번호 직후)의 상호
      if (supplierStartIdx >= 0 && i > supplierStartIdx && mapping.partnerCompany < 0) {
        if (/^상호/.test(c)) { mapping.partnerCompany = i; continue; }
      }

      if (/^합계\s*금액/.test(c) && mapping.totalAmount < 0) { mapping.totalAmount = i; continue; }
      if (/^공급\s*가액/.test(c) && mapping.supplyAmount < 0) { mapping.supplyAmount = i; continue; }
      if (/^세액/.test(c) && mapping.taxAmount < 0) { mapping.taxAmount = i; continue; }
      if (/^비고/.test(c) && mapping.memo < 0) { mapping.memo = i; continue; }
    }

    if (mapping.issueDate >= 0 && mapping.totalAmount >= 0 && mapping.partnerCompany >= 0) return mapping;
    return null;
  },

  _parsePaste() {
    const raw = document.getElementById('purchasePasteArea').value.trim();
    if (!raw) {
      Utils.showToast('데이터를 붙여넣기 하세요.', 'error');
      return;
    }

    const lines = raw.split('\n').filter(l => l.trim());
    this._parsed = [];

    let mapping = null, startLine = 0;
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const cols = this._splitCols(lines[i]);
      const m = this._parseHeader(cols);
      if (m) { mapping = m; startLine = i + 1; break; }
    }

    if (!mapping) {
      Utils.showToast('헤더 행을 찾을 수 없습니다. [홈택스: 작성일자/공급자 상호/합계금액] 또는 [위하고: 일자/거래처/공급가액] 헤더가 필요합니다.', 'error', 6000);
      return;
    }

    const formatLabel = mapping.format === 'wehago' ? '위하고' : '홈택스';
    const currentYear = new Date().getFullYear();

    for (let i = startLine; i < lines.length; i++) {
      const cols = this._splitCols(lines[i]);
      if (cols.length < 3) continue;

      const rawDate = (cols[mapping.issueDate] || '').trim();
      let issueDate = '';
      const m3 = rawDate.match(/(\d{2,4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
      const m2 = rawDate.match(/^(\d{1,2})[-.\/](\d{1,2})$/);
      if (m3) {
        let y = m3[1];
        if (y.length === 2) y = '20' + y;
        issueDate = `${y}-${m3[2].padStart(2, '0')}-${m3[3].padStart(2, '0')}`;
      } else if (m2) {
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

      if (!totalAmount && supplyAmount) totalAmount = supplyAmount + (taxAmount || Math.round(supplyAmount * 0.1));
      if (!supplyAmount && totalAmount) supplyAmount = Math.round(totalAmount / 1.1);
      if (!taxAmount && totalAmount && supplyAmount) taxAmount = totalAmount - supplyAmount;

      if (!supplyAmount && !totalAmount) continue;

      this._parsed.push({
        issueDate,
        approvalNo: mapping.approvalNo >= 0 ? (cols[mapping.approvalNo] || '').trim() : '',
        partnerRegNumber: mapping.partnerRegNumber >= 0 ? (cols[mapping.partnerRegNumber] || '').trim() : '',
        partnerCompanyName: partnerCompany,
        totalAmount,
        supplyAmount,
        taxAmount,
        memo: mapping.memo >= 0 ? (cols[mapping.memo] || '').trim() : '',
        sourceFormat: formatLabel,
        selected: true
      });
    }

    if (this._parsed.length === 0) {
      Utils.showToast('인식 가능한 매입 세금계산서가 없습니다.', 'warning', 5000);
      return;
    }

    Utils.showToast(`[${formatLabel}] ${this._parsed.length}건의 매입 세금계산서 인식됨`, 'success');
    this._renderParseResult();
  },

  _renderParseResult() {
    document.getElementById('purchaseParseResult').classList.remove('hidden');
    document.getElementById('purchaseParsedCount').textContent = `(${this._parsed.length}건)`;

    const tbody = document.querySelector('#purchaseParseTable tbody');
    tbody.innerHTML = this._parsed.map((r, i) => `
      <tr>
        <td><input type="checkbox" data-idx="${i}" ${r.selected ? 'checked' : ''} onchange="PurchaseInvoiceModule._toggleRow(${i}, this.checked)"></td>
        <td>${Utils.escapeHtml(r.issueDate)}</td>
        <td class="fw-medium">${Utils.escapeHtml(r.partnerCompanyName)}</td>
        <td class="text-xs">${Utils.escapeHtml(r.partnerRegNumber)}</td>
        <td class="text-right">${Utils.formatCurrency(r.supplyAmount)}</td>
        <td class="text-right">${Utils.formatCurrency(r.taxAmount)}</td>
        <td class="text-right fw-medium">${Utils.formatCurrency(r.totalAmount)}</td>
        <td class="text-xs text-muted">${Utils.escapeHtml((r.memo || '').slice(0, 30))}</td>
      </tr>
    `).join('');

    this._updateParseSummary();
    document.getElementById('purchaseSaveBtn').disabled = false;
  },

  _toggleRow(idx, checked) {
    this._parsed[idx].selected = checked;
    this._updateParseSummary();
  },

  _toggleAllRows(checked) {
    this._parsed.forEach((r, i) => {
      r.selected = checked;
      const cb = document.querySelector(`#purchaseParseTable input[data-idx="${i}"]`);
      if (cb) cb.checked = checked;
    });
    this._updateParseSummary();
  },

  _updateParseSummary() {
    const sel = this._parsed.filter(r => r.selected);
    const total = sel.reduce((s, r) => s + (r.totalAmount || 0), 0);
    document.getElementById('purchaseParseSummary').innerHTML = `
      ✅ 등록 예정: <strong>${sel.length}건</strong> · 합계 <strong>${Utils.formatCurrency(total)}</strong>
    `;
    document.getElementById('purchaseSaveBtn').disabled = sel.length === 0;
  },

  async _savePaste() {
    const sel = this._parsed.filter(r => r.selected);
    if (sel.length === 0) return;

    const user = Auth.currentUser();
    const existing = await DB.getAll('purchaseInvoices');

    let added = 0, skipped = 0, failed = 0;
    for (const row of sel) {
      try {
        // 중복 체크 (승인번호 우선, 없으면 매입처+금액+일자)
        const dup = existing.find(e =>
          (row.approvalNo && e.hometaxApprovalNo === row.approvalNo) ||
          (e.partnerCompanyName === row.partnerCompanyName &&
           e.totalAmount === row.totalAmount &&
           e.issueDate === row.issueDate)
        );
        if (dup) { skipped++; continue; }

        await DB.add('purchaseInvoices', {
          issueDate: row.issueDate,
          hometaxApprovalNo: row.approvalNo || '',
          partnerCompanyName: row.partnerCompanyName,
          partnerRegNumber: row.partnerRegNumber || '',
          supplyAmount: row.supplyAmount,
          taxAmount: row.taxAmount,
          totalAmount: row.totalAmount,
          memo: row.memo || '',
          paid: false,
          paidDate: null,
          matchedTransferIds: [],
          createdAt: new Date().toISOString(),
          createdBy: user.id,
          createdByName: user.displayName,
          updatedAt: new Date().toISOString(),
          importedFrom: 'paste'
        });
        added++;
      } catch (e) {
        console.error('매입 세금계산서 등록 실패:', e);
        failed++;
      }
    }

    await DB.log('CREATE', 'purchaseInvoices', null, `매입 세금계산서 일괄 등록: ${added}건 (스킵 ${skipped}, 실패 ${failed})`);

    Utils.closeModal();
    Utils.showToast(`✅ ${added}건 등록 완료${skipped ? ` · 중복 ${skipped}건 스킵` : ''}${failed ? ` · 실패 ${failed}건` : ''}`, 'success', 5000);

    try {
      if ((window.location.hash || '').slice(1).split('?')[0] === '/purchase-invoices') {
        await this.render();
      }
    } catch (e) {
      console.warn('등록 후 화면 갱신 실패 (데이터는 정상 저장됨):', e);
    }
  },

  // ===== 개별 등록 모달 =====
  _openAddModal(editData) {
    const isEdit = !!editData;
    Utils.openModal(`
      <div class="modal-header">
        <h3>${isEdit ? '매입 세금계산서 수정' : '+ 매입 세금계산서 개별 등록'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label for="piIssueDate">작성일 <span class="required">*</span></label>
            <input type="date" id="piIssueDate" class="form-control" value="${editData ? (editData.issueDate || '') : ''}" required>
          </div>
          <div class="form-group">
            <label for="piApprovalNo">홈택스 승인번호</label>
            <input type="text" id="piApprovalNo" class="form-control" placeholder="(선택)" value="${editData ? Utils.escapeHtml(editData.hometaxApprovalNo || '') : ''}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="piPartnerName">매입처(공급자) <span class="required">*</span></label>
            <input type="text" id="piPartnerName" class="form-control" placeholder="예: (주)대림건축" value="${editData ? Utils.escapeHtml(editData.partnerCompanyName || '') : ''}" required>
          </div>
          <div class="form-group">
            <label for="piPartnerReg">사업자번호</label>
            <input type="text" id="piPartnerReg" class="form-control" placeholder="000-00-00000" value="${editData ? Utils.escapeHtml(editData.partnerRegNumber || '') : ''}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="piSupply">공급가액 (원)</label>
            <input type="number" id="piSupply" class="form-control" placeholder="0" min="0" value="${editData ? (editData.supplyAmount || '') : ''}" oninput="PurchaseInvoiceModule._autoCalcTotal()">
          </div>
          <div class="form-group">
            <label for="piTax">부가세 (원)</label>
            <input type="number" id="piTax" class="form-control" placeholder="0 (공급가액의 10%)" min="0" value="${editData ? (editData.taxAmount || '') : ''}" oninput="PurchaseInvoiceModule._autoCalcTotal()">
          </div>
          <div class="form-group">
            <label for="piTotal">합계금액 (원) <span class="required">*</span></label>
            <input type="number" id="piTotal" class="form-control" placeholder="0" min="0" value="${editData ? (editData.totalAmount || '') : ''}" required>
          </div>
        </div>

        <div class="form-group">
          <label for="piMemo">품목 / 비고</label>
          <textarea id="piMemo" class="form-control" rows="2" placeholder="예: 외주설계 용역, 인쇄비 등">${editData ? Utils.escapeHtml(editData.memo || '') : ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="PurchaseInvoiceModule._saveAdd(${isEdit ? `'${editData.id}'` : 'null'})">${isEdit ? '수정' : '등록'}</button>
      </div>
    `, { size: 'modal-lg' });
  },

  _autoCalcTotal() {
    const supply = Number(document.getElementById('piSupply').value) || 0;
    let tax = Number(document.getElementById('piTax').value);
    const totalEl = document.getElementById('piTotal');
    if (isNaN(tax) || tax === 0) {
      if (supply > 0) {
        tax = Math.round(supply * 0.1);
        document.getElementById('piTax').value = tax;
      }
    }
    if (supply > 0) totalEl.value = supply + (tax || 0);
  },

  async _saveAdd(editId) {
    const issueDate = document.getElementById('piIssueDate').value;
    const partner = document.getElementById('piPartnerName').value.trim();
    const total = Number(document.getElementById('piTotal').value) || 0;

    if (!issueDate || !partner || total <= 0) {
      Utils.showToast('작성일, 매입처, 합계금액은 필수입니다.', 'error');
      return;
    }

    const user = Auth.currentUser();
    const data = {
      issueDate,
      hometaxApprovalNo: document.getElementById('piApprovalNo').value.trim(),
      partnerCompanyName: partner,
      partnerRegNumber: document.getElementById('piPartnerReg').value.trim(),
      supplyAmount: Number(document.getElementById('piSupply').value) || 0,
      taxAmount: Number(document.getElementById('piTax').value) || 0,
      totalAmount: total,
      memo: document.getElementById('piMemo').value.trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
      updatedByName: user.displayName
    };

    try {
      if (editId) {
        data.id = editId;
        const existing = await DB.get('purchaseInvoices', editId);
        data.createdAt = existing.createdAt;
        data.createdBy = existing.createdBy;
        data.createdByName = existing.createdByName;
        data.paid = existing.paid || false;
        data.paidDate = existing.paidDate || null;
        data.matchedTransferIds = existing.matchedTransferIds || [];
        await DB.update('purchaseInvoices', data);
        await DB.log('UPDATE', 'purchaseInvoices', editId, `매입 수정: ${partner} ${total}원`);
      } else {
        data.createdAt = new Date().toISOString();
        data.createdBy = user.id;
        data.createdByName = user.displayName;
        data.paid = false;
        data.paidDate = null;
        data.matchedTransferIds = [];
        const id = await DB.add('purchaseInvoices', data);
        await DB.log('CREATE', 'purchaseInvoices', id, `매입 등록: ${partner} ${total}원`);
      }
      Utils.closeModal();
      Utils.showToast('저장 완료', 'success');
      await this.render();
    } catch (err) {
      Utils.showToast('저장 실패: ' + err.message, 'error');
    }
  },

  async _openDetail(id) {
    const item = await DB.get('purchaseInvoices', id);
    if (!item) return;
    this._openAddModal(item);
  },

  async _delete(id) {
    const item = await DB.get('purchaseInvoices', id);
    if (!item) return;
    const ok = await Utils.confirm(`이 매입 세금계산서를 삭제하시겠습니까?\n\n매입처: ${item.partnerCompanyName}\n작성일: ${item.issueDate}\n합계: ${Utils.formatCurrency(item.totalAmount)}`, '매입 삭제');
    if (!ok) return;

    await DB.delete('purchaseInvoices', id);
    await DB.log('DELETE', 'purchaseInvoices', id, `매입 삭제: ${item.partnerCompanyName} ${item.totalAmount}원`);
    Utils.showToast('삭제 완료', 'success');
    await this.render();
  }
};

window.PurchaseInvoiceModule = PurchaseInvoiceModule;
