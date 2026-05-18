/* ============================================
   외주설계 관리대장 모듈
   - 프로젝트별 입금금액 / 외주지급누계 / 잔액 관리
   - 외주지급누계는 송금내역(transferRecords) 자동 합산
   - 권한: 관리자 + 'outsourcing' 메뉴 권한 보유자
   ============================================ */

const OutsourcingModule = {
  container: null,

  STATUS_OPTIONS: ['진행중', '정산예정', '완료', '보류'],

  async init(container) {
    this.container = container;
    await this.render();
  },

  // 송금내역 합계 계산용 캐시
  _transferTotalsByProject: {},
  async _loadTransferTotals() {
    const all = await DB.getAll('transferRecords');
    const totals = {};
    for (const t of all) {
      const key = (t.projectName || '').trim();
      if (!key) continue;
      totals[key] = (totals[key] || 0) + (Number(t.amount) || 0);
    }
    this._transferTotalsByProject = totals;
  },

  async render() {
    const isAdmin = Auth.isAdmin();
    await this._loadTransferTotals();
    const all = (await DB.getAll('outsourcingProjects')).reverse();

    const totalDeposit = all.reduce((s, p) => s + (Number(p.depositAmount) || 0), 0);
    const totalOutsourcing = all.reduce((s, p) => s + (this._transferTotalsByProject[(p.projectName || '').trim()] || 0), 0);
    const totalBalance = totalDeposit - totalOutsourcing;

    let tableRows = '';
    if (all.length === 0) {
      tableRows = `<tr><td colspan="8" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">📒</div><h3>등록된 외주설계 프로젝트가 없습니다</h3><p>+ 프로젝트 등록 버튼으로 추가하세요.</p></div>
      </td></tr>`;
    } else {
      tableRows = all.map(p => {
        const outsourcingTotal = this._transferTotalsByProject[(p.projectName || '').trim()] || 0;
        const balance = (Number(p.depositAmount) || 0) - outsourcingTotal;
        const balanceColor = balance < 0 ? 'color:var(--color-danger);' : '';
        return `
          <tr style="cursor:pointer;" onclick="OutsourcingModule._showDetail('${p.id}')">
            <td class="fw-medium">${Utils.escapeHtml(p.projectName || '-')}</td>
            <td>${Utils.escapeHtml(p.clientName || '-')}</td>
            <td>${Utils.escapeHtml(p.vendorName || '-')}</td>
            <td class="text-right amount">${Utils.formatCurrency(p.depositAmount || 0)}</td>
            <td class="text-right amount">${Utils.formatCurrency(outsourcingTotal)}</td>
            <td class="text-right amount" style="${balanceColor}">${Utils.formatCurrency(balance)}</td>
            <td class="text-center">${this._statusBadge(p.status)}</td>
            <td onclick="event.stopPropagation();">
              ${isAdmin ? `
                <div class="d-flex gap-2">
                  <button class="btn btn-ghost btn-sm" onclick="OutsourcingModule._edit('${p.id}')" title="수정">✏️</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="OutsourcingModule._delete('${p.id}')" title="삭제">🗑️</button>
                </div>
              ` : ''}
            </td>
          </tr>
        `;
      }).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>외주설계 관리대장</h2>
        <div class="page-actions">
          <button class="btn btn-secondary" onclick="OutsourcingModule._downloadTemplate()">📥 엑셀 양식 다운로드</button>
          ${isAdmin ? `<button class="btn btn-secondary" onclick="OutsourcingModule._openUploadModal()">📤 엑셀 일괄 업로드</button>` : ''}
          ${isAdmin ? `<button class="btn btn-primary" onclick="OutsourcingModule._openAddModal()">+ 프로젝트 등록</button>` : ''}
        </div>
      </div>

      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon cyan">📒</div>
          <div class="card-info">
            <div class="card-label">총 프로젝트</div>
            <div class="card-value">${all.length}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon green">💰</div>
          <div class="card-info">
            <div class="card-label">총 입금금액</div>
            <div class="card-value">${Utils.formatCurrency(totalDeposit)}</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon orange">💸</div>
          <div class="card-info">
            <div class="card-label">총 외주지급누계</div>
            <div class="card-value">${Utils.formatCurrency(totalOutsourcing)}</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon ${totalBalance >= 0 ? 'cyan' : 'red'}">📊</div>
          <div class="card-info">
            <div class="card-label">총 잔액</div>
            <div class="card-value">${Utils.formatCurrency(totalBalance)}</div>
          </div>
        </div>
      </div>

      <div class="card mt-4" style="padding:var(--sp-3);background:var(--color-bg-light);">
        <div class="text-sm text-muted">
          💡 <strong>안내</strong>: <strong>외주지급누계</strong>는 송금내역의 <strong>프로젝트명이 정확히 일치하는</strong> 건들의 합계로 자동 계산됩니다.
          송금내역 등록 시 프로젝트명을 본 대장과 동일하게 입력해주세요.
        </div>
      </div>

      <div class="table-wrapper mt-4">
        <table class="data-table">
          <thead>
            <tr>
              <th>프로젝트명</th>
              <th>발주처</th>
              <th>외주업체</th>
              <th class="text-right">입금금액</th>
              <th class="text-right">외주지급누계</th>
              <th class="text-right">잔액</th>
              <th class="text-center">진행상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
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

  // ===== 상세보기 =====
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
              <div class="card-label">입금금액</div>
              <div class="card-value">${Utils.formatCurrency(p.depositAmount || 0)}</div>
            </div>
          </div>
          <div class="summary-card">
            <div class="card-info">
              <div class="card-label">외주지급누계</div>
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

        <h4 style="margin-bottom:var(--sp-2);">💸 외주지급 내역 (송금내역 자동 연동)</h4>
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
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
        ${isAdmin ? `<button class="btn btn-primary" onclick="Utils.closeModal(); OutsourcingModule._edit('${p.id}')">수정</button>` : ''}
      </div>
    `, { size: 'modal-lg' });
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
            <label for="osDepositAmount">입금금액 (원)</label>
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
    const projectName = document.getElementById('osProjectName').value.trim();
    if (!projectName) {
      Utils.showToast('프로젝트명을 입력해 주세요.', 'error');
      return;
    }

    const user = Auth.currentUser();
    const data = {
      projectName,
      clientName: document.getElementById('osClientName').value.trim(),
      vendorName: document.getElementById('osVendorName').value.trim(),
      contractDate: document.getElementById('osContractDate').value || null,
      depositAmount: Number(document.getElementById('osDepositAmount').value) || 0,
      status: document.getElementById('osStatus').value || '진행중',
      memo: document.getElementById('osMemo').value.trim(),
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
  // 컬럼: 프로젝트명, 발주처, 외주업체, 계약일, 입금금액, 진행상태, 비고
  EXCEL_HEADERS: ['프로젝트명', '발주처', '외주업체', '계약일(YYYY-MM-DD)', '입금금액', '진행상태', '비고'],
  EXCEL_SAMPLE: [
    ['인천 송도캐슬해모로아파트 누수 보수공사', '입주자대표회의', '대림건축(홍정란)', '2025-12-01', 50000000, '진행중', '예시: 비상주 감리용역'],
    ['(예시) 서울 OO상가 설계', '(주)OO개발', 'OO설계사무소', '2026-01-15', 30000000, '정산예정', '(이 예시 행은 삭제하고 사용하세요)']
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
        ['📒 외주설계 관리대장 — 일괄 등록 양식'],
        ['• 필수: 프로젝트명 (송금내역의 프로젝트명과 정확히 동일하게 입력)'],
        ['• 진행상태: 진행중 / 정산예정 / 완료 / 보류 중 하나 (비워두면 "진행중")'],
        ['• 계약일은 YYYY-MM-DD 형식 (예: 2026-01-15). 비워둬도 됩니다.'],
        ['• 입금금액은 숫자만 (예: 50000000). 쉼표·원 단위는 빼주세요.'],
        ['• 예시 행은 모두 지우고 본인 데이터로 채워서 업로드하세요.'],
        [],
        this.EXCEL_HEADERS,
        ...this.EXCEL_SAMPLE
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // 컬럼 폭
      ws['!cols'] = [
        { wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 30 }
      ];

      // 머지 (안내 영역)
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: 6 } },
        { s: { r: 4, c: 0 }, e: { r: 4, c: 6 } },
        { s: { r: 5, c: 0 }, e: { r: 5, c: 6 } }
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

      XLSX.utils.book_append_sheet(wb, ws, '외주설계 관리대장');

      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `외주설계_관리대장_양식_${stamp}.xlsx`;
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
        <h3>📤 외주설계 엑셀 일괄 업로드</h3>
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

      // 헤더 행 탐색 (첫 15줄 이내)
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(15, rows.length); i++) {
        const r = rows[i].map(c => String(c || '').trim());
        if (r.includes('프로젝트명')) { headerRowIdx = i; break; }
      }
      if (headerRowIdx < 0) {
        Utils.showToast('헤더 행(프로젝트명, 발주처 ...)을 찾을 수 없습니다. 양식대로 작성했는지 확인하세요.', 'error', 6000);
        if (nameEl) nameEl.textContent = `❌ 헤더를 찾지 못함`;
        return;
      }
      const headerCols = rows[headerRowIdx].map(c => String(c || '').trim());
      const idx = (name) => headerCols.findIndex(c => c === name || c.startsWith(name));

      const colMap = {
        projectName: idx('프로젝트명'),
        clientName: idx('발주처'),
        vendorName: idx('외주업체'),
        contractDate: idx('계약일'),
        depositAmount: idx('입금금액'),
        status: idx('진행상태'),
        memo: idx('비고')
      };

      const parsed = [];
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(c => !String(c || '').trim())) continue;
        const projectName = colMap.projectName >= 0 ? String(row[colMap.projectName] || '').trim() : '';
        if (!projectName) continue;
        // 예시 행 자동 제외 (시작이 "(예시)")
        if (projectName.startsWith('(예시)')) continue;

        const depAmtRaw = colMap.depositAmount >= 0 ? String(row[colMap.depositAmount] || '').replace(/[,\s원]/g, '') : '';
        const depAmt = Number(depAmtRaw) || 0;
        const status = (colMap.status >= 0 ? String(row[colMap.status] || '').trim() : '') || '진행중';
        const validStatus = this.STATUS_OPTIONS.includes(status) ? status : '진행중';

        parsed.push({
          rowNum: i + 1,
          selected: true,
          projectName,
          clientName: colMap.clientName >= 0 ? String(row[colMap.clientName] || '').trim() : '',
          vendorName: colMap.vendorName >= 0 ? String(row[colMap.vendorName] || '').trim() : '',
          contractDate: colMap.contractDate >= 0 ? this._normDate(row[colMap.contractDate]) : null,
          depositAmount: depAmt,
          status: validStatus,
          memo: colMap.memo >= 0 ? String(row[colMap.memo] || '').trim() : ''
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
        <td>${Utils.escapeHtml(r.vendorName || '-')}</td>
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
              <th>외주업체</th>
              <th>계약일</th>
              <th class="text-right">입금금액</th>
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
    await this.render();
  }
};

window.OutsourcingModule = OutsourcingModule;
