/* ============================================
   세금계산서 관리 모듈 (관리자)
   흐름: 요청 접수 → 검토(상세보기) → 발행/반려
   ============================================ */

const TaxInvoiceAdminModule = {
  container: null,
  filterStatus: 'all',

  async init(container) {
    this.container = container;
    await this.render();
  },

  async render() {
    const all = await DB.getAll('taxInvoiceRequests');
    let items = all.reverse();

    // 날짜 필터
    DateFilter.onChange('taxInvoices', () => this.render());
    items = DateFilter.filter(items, 'createdAt', 'taxInvoices');

    const counts = { all: items.length };
    ['요청', '검토중', '발행완료', '반려'].forEach(s => {
      counts[s] = items.filter(i => i.status === s).length;
    });

    const filtered = this.filterStatus === 'all' ? items : items.filter(i => i.status === this.filterStatus);

    let tableRows = '';
    if (filtered.length === 0) {
      tableRows = `<tr><td colspan="8" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">📋</div><h3>해당 요청이 없습니다</h3></div>
      </td></tr>`;
    } else {
      tableRows = filtered.map(item => {
        let actionBtns = '';

        if (item.status === '요청') {
          actionBtns = `
            <button class="btn btn-primary btn-sm" onclick="TaxInvoiceAdminModule._reviewRequest('${item.id}')">검토하기</button>
          `;
        } else if (item.status === '검토중') {
          actionBtns = `
            <button class="btn btn-ghost btn-sm" onclick="TaxInvoiceAdminModule._openReviewDetail('${item.id}')" title="상세보기">👁️</button>
            <button class="btn btn-success btn-sm" onclick="TaxInvoiceAdminModule._changeStatus('${item.id}', '발행완료')">발행</button>
            <button class="btn btn-danger btn-sm" onclick="TaxInvoiceAdminModule._reject('${item.id}')">반려</button>
          `;
        } else if (item.status === '발행완료') {
          actionBtns = `
            <button class="btn btn-ghost btn-sm" onclick="TaxInvoiceAdminModule._openReviewDetail('${item.id}')" title="상세보기">👁️</button>
            <button class="btn btn-secondary btn-sm" onclick="TaxInvoiceAdminModule._changeStatus('${item.id}', '요청')">요청으로</button>
            <button class="btn btn-warning btn-sm" onclick="TaxInvoiceAdminModule._changeStatus('${item.id}', '검토중')">검토중으로</button>
          `;
        } else if (item.status === '반려') {
          actionBtns = `
            <button class="btn btn-ghost btn-sm" onclick="TaxInvoiceAdminModule._openReviewDetail('${item.id}')" title="상세보기">👁️</button>
            <button class="btn btn-secondary btn-sm" onclick="TaxInvoiceAdminModule._changeStatus('${item.id}', '요청')">요청으로</button>
            <button class="btn btn-warning btn-sm" onclick="TaxInvoiceAdminModule._changeStatus('${item.id}', '검토중')">검토중으로</button>
          `;
        }
        // 삭제 버튼 (모든 상태에서)
        actionBtns += `<button class="btn btn-ghost btn-sm text-danger" onclick="TaxInvoiceAdminModule._deleteRequest('${item.id}')" title="삭제">🗑️</button>`;

        return `
          <tr oncontextmenu="TaxInvoiceAdminModule._showContextMenu(event, '${item.id}', '${item.status}')">
            <td class="fw-medium">${Utils.escapeHtml(item.requestNumber)}</td>
            <td>${Utils.escapeHtml(item.requesterName || '-')}</td>
            <td>
              <span onclick="TaxInvoiceAdminModule._editPartnerName('${item.id}')" style="cursor:pointer;border-bottom:1px dashed var(--color-text-muted);" title="클릭하여 거래처명 수정">
                ${Utils.escapeHtml(item.partnerCompanyName || '-')}${!item.partnerCompanyName ? ' ✏️' : ''}
              </span>
            </td>
            <td>${Utils.escapeHtml(item.reason ? (item.reason.length > 25 ? item.reason.slice(0, 25) + '...' : item.reason) : '-')}</td>
            <td class="text-right amount">${Utils.formatCurrency(item.totalAmount)}</td>
            <td class="text-center">${Utils.statusBadge(item.status)}</td>
            <td>${Utils.formatDate(item.createdAt)}</td>
            <td>
              <div class="d-flex gap-2">${actionBtns}</div>
            </td>
          </tr>
        `;
      }).join('');
    }

    this.container.innerHTML = `
      <div class="tabs">
        <div class="tab-item ${this.filterStatus === 'all' ? 'active' : ''}" onclick="TaxInvoiceAdminModule._setFilter('all')">
          전체 <span class="text-muted">(${counts.all})</span>
        </div>
        <div class="tab-item ${this.filterStatus === '요청' ? 'active' : ''}" onclick="TaxInvoiceAdminModule._setFilter('요청')">
          요청 <span class="text-muted">(${counts['요청']})</span>
        </div>
        <div class="tab-item ${this.filterStatus === '검토중' ? 'active' : ''}" onclick="TaxInvoiceAdminModule._setFilter('검토중')">
          검토중 <span class="text-muted">(${counts['검토중']})</span>
        </div>
        <div class="tab-item ${this.filterStatus === '발행완료' ? 'active' : ''}" onclick="TaxInvoiceAdminModule._setFilter('발행완료')">
          발행완료 <span class="text-muted">(${counts['발행완료']})</span>
        </div>
        <div class="tab-item ${this.filterStatus === '반려' ? 'active' : ''}" onclick="TaxInvoiceAdminModule._setFilter('반려')">
          반려 <span class="text-muted">(${counts['반려']})</span>
        </div>
      </div>

      <div class="mb-4">${DateFilter.render('taxInvoices')}</div>

      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>요청번호</th>
              <th>요청자</th>
              <th>거래처</th>
              <th>발행사유</th>
              <th class="text-right">합계금액</th>
              <th class="text-center">상태</th>
              <th>요청일</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  },

  // 우클릭 컨텍스트 메뉴
  _showContextMenu(event, id, status) {
    const items = [
      { icon: '👁️', label: '상세보기', onClick: () => this._openReviewDetail(id) },
      { icon: '✏️', label: '거래처 수정', onClick: () => this._editPartnerName(id) },
      { divider: true }
    ];

    if (status !== '요청') items.push({ icon: '🔄', label: '요청으로 되돌리기', onClick: () => this._changeStatus(id, '요청') });
    if (status !== '검토중') items.push({ icon: '🔍', label: '검토중으로', onClick: () => this._changeStatus(id, '검토중') });
    if (status !== '발행완료') items.push({ icon: '✅', label: '발행완료 처리', onClick: () => this._changeStatus(id, '발행완료') });
    if (status !== '반려') items.push({ icon: '❌', label: '반려', onClick: () => this._reject(id) });

    items.push({ divider: true });
    items.push({ icon: '🗑️', label: '삭제', danger: true, onClick: () => this._deleteRequest(id) });

    ContextMenu.show(event, items);
  },

  _setFilter(status) {
    this.filterStatus = status;
    this.render();
  },

  // ===== 검토하기: 상태를 검토중으로 변경 + 상세 팝업 열기 =====
  async _reviewRequest(id) {
    const item = await DB.get('taxInvoiceRequests', id);
    if (!item) return;

    // 상태를 검토중으로 변경
    const user = Auth.currentUser();
    item.status = '검토중';
    item.reviewerId = user.id;
    item.reviewerName = user.displayName;
    item.reviewedAt = new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    await DB.update('taxInvoiceRequests', item);
    await DB.log('UPDATE', 'taxInvoice', id, `상태 변경: 요청 → 검토중`);
    App.updateNotificationBadges();

    // 상세 팝업 열기 (발행/반려 버튼 포함)
    await this._openReviewDetail(id);

    // 목록 갱신
    await this.render();
  },

  // ===== 거래처명 수정 =====
  async _editPartnerName(id) {
    const item = await DB.get('taxInvoiceRequests', id);
    if (!item) return;

    Utils.openModal(`
      <div class="modal-header">
        <h3>거래처명 수정 - ${Utils.escapeHtml(item.requestNumber)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="editPartnerName">거래처명 <span class="required">*</span></label>
          <input type="text" id="editPartnerName" class="form-control" value="${Utils.escapeHtml(item.partnerCompanyName || '')}" placeholder="거래처 상호 입력">
        </div>
        <div class="form-group">
          <label for="editPartnerRegNum">사업자등록번호</label>
          <input type="text" id="editPartnerRegNum" class="form-control" value="${Utils.escapeHtml(item.partnerRegNumber || '')}" placeholder="000-00-00000">
        </div>
        <div class="form-group">
          <label for="editPartnerEmail">이메일</label>
          <input type="email" id="editPartnerEmail" class="form-control" value="${Utils.escapeHtml(item.partnerEmail || '')}" placeholder="tax@example.com">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="TaxInvoiceAdminModule._savePartnerName('${id}')">저장</button>
      </div>
    `);

    setTimeout(() => { const el = document.getElementById('editPartnerName'); if (el) el.focus(); }, 100);
  },

  async _savePartnerName(id) {
    const name = document.getElementById('editPartnerName').value.trim();
    const regNum = document.getElementById('editPartnerRegNum').value.trim();
    const email = document.getElementById('editPartnerEmail').value.trim();

    const item = await DB.get('taxInvoiceRequests', id);
    item.partnerCompanyName = name;
    item.partnerRegNumber = regNum || item.partnerRegNumber;
    item.partnerEmail = email || item.partnerEmail;
    item.updatedAt = new Date().toISOString();
    await DB.update('taxInvoiceRequests', item);
    await DB.log('UPDATE', 'taxInvoice', id, `거래처 수정: ${name}`);

    Utils.closeModal();
    await this.render();
  },

  // ===== 삭제 =====
  async _deleteRequest(id) {
    const item = await DB.get('taxInvoiceRequests', id);
    if (!item) return;

    const confirmed = await Utils.confirm(
      `${item.requestNumber} (${item.partnerCompanyName || '-'}) 발행 요청을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      '발행 요청 삭제'
    );
    if (!confirmed) return;

    await DB.delete('taxInvoiceRequests', id);
    await DB.log('DELETE', 'taxInvoice', id, `발행 요청 삭제: ${item.requestNumber}`);
    App.updateNotificationBadges();
    await this.render();
  },

  // ===== 상세보기 팝업 (검토 + 발행/반려 액션 포함) =====
  async _openReviewDetail(id) {
    const item = await DB.get('taxInvoiceRequests', id);
    if (!item) return;

    // 첨부파일
    let attachmentHtml = '';
    if (item.attachments && item.attachments.length > 0) {
      const att = item.attachments[0];
      if (att.fileData instanceof Blob) {
        const url = URL.createObjectURL(att.fileData);
        attachmentHtml = `
          <div class="mt-4">
            <label class="fw-semibold text-sm">📎 첨부 사업자등록증</label>
            <div style="margin-top:var(--sp-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);overflow:hidden;">
              <img src="${url}" style="max-width:100%;display:block;">
            </div>
          </div>`;
      }
    }

    // 반려 사유
    let rejectInfo = '';
    if (item.status === '반려' && item.rejectReason) {
      rejectInfo = `<div class="mt-4" style="padding:var(--sp-3);background:var(--color-danger-light);border-radius:var(--radius-sm);">
        <strong class="text-danger">반려 사유:</strong> ${Utils.escapeHtml(item.rejectReason)}
      </div>`;
    }

    // 하단 액션 버튼 (상태에 따라)
    let footerBtns = `<button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>`;

    if (item.status === '검토중') {
      footerBtns = `
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
        <button class="btn btn-danger" onclick="Utils.closeModal(); TaxInvoiceAdminModule._reject('${item.id}')">반려</button>
        <button class="btn btn-success btn-lg" onclick="Utils.closeModal(); TaxInvoiceAdminModule._changeStatus('${item.id}', '발행완료')">발행완료 처리</button>
      `;
    } else if (item.status === '요청') {
      footerBtns = `
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
        <button class="btn btn-primary" onclick="Utils.closeModal(); TaxInvoiceAdminModule._reviewRequest('${item.id}')">검토 시작</button>
      `;
    }

    Utils.openModal(`
      <div class="modal-header">
        <div class="d-flex items-center gap-2">
          <h3 style="margin:0;">${Utils.escapeHtml(item.requestNumber)}</h3>
          ${Utils.statusBadge(item.status)}
        </div>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:70vh;overflow-y:auto;">
        <!-- 요청 정보 -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-4);padding-bottom:var(--sp-3);border-bottom:1px solid var(--color-border);">
          <span class="text-sm text-muted">요청자: <strong>${Utils.escapeHtml(item.requesterName || '-')}</strong></span>
          <span class="text-sm text-muted">요청일: ${Utils.formatDateTime(item.createdAt)}</span>
        </div>

        <!-- 금액 -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-4);margin-bottom:var(--sp-5);padding:var(--sp-4);background:var(--color-surface-hover);border-radius:var(--radius-md);">
          <div>
            <div class="text-xs text-muted">공급가액</div>
            <div class="fw-semibold" style="font-size:var(--font-size-md);">${Utils.formatCurrency(item.amount)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">세액</div>
            <div class="fw-semibold" style="font-size:var(--font-size-md);">${Utils.formatCurrency(item.taxAmount)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">합계금액</div>
            <div class="fw-bold" style="font-size:var(--font-size-lg);color:var(--color-primary);">${Utils.formatCurrency(item.totalAmount)}</div>
          </div>
        </div>

        <!-- 발행 사유 -->
        <div class="mb-4">
          <label class="text-xs text-muted fw-semibold">발행 사유</label>
          <div style="padding:var(--sp-3);background:var(--color-surface-hover);border-radius:var(--radius-sm);margin-top:var(--sp-1);">
            ${Utils.escapeHtml(item.reason || '-')}
          </div>
        </div>

        <!-- 거래처 정보 -->
        <fieldset style="margin-bottom:var(--sp-4);">
          <legend>거래처 정보</legend>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3) var(--sp-6);">
            <div><label class="text-xs text-muted">상호</label><div class="fw-medium">${Utils.escapeHtml(item.partnerCompanyName || '-')}</div></div>
            <div><label class="text-xs text-muted">사업자등록번호</label><div class="fw-medium">${Utils.escapeHtml(item.partnerRegNumber || '-')}</div></div>
            <div><label class="text-xs text-muted">대표자</label><div>${Utils.escapeHtml(item.partnerRepName || '-')}</div></div>
            <div><label class="text-xs text-muted">이메일</label><div class="fw-medium">${Utils.escapeHtml(item.partnerEmail || '-')}</div></div>
            <div><label class="text-xs text-muted">주소</label><div>${Utils.escapeHtml(item.partnerAddress || '-')}</div></div>
            <div><label class="text-xs text-muted">업태</label><div>${Utils.escapeHtml(item.partnerBusinessType || '-')}</div></div>
            <div><label class="text-xs text-muted">종목</label><div>${Utils.escapeHtml(item.partnerBusinessItem || '-')}</div></div>
          </div>
        </fieldset>

        ${item.projectName ? `<div class="mb-2"><label class="text-xs text-muted">프로젝트</label><div>${Utils.escapeHtml(item.projectName)}</div></div>` : ''}
        ${item.memo ? `<div class="mb-2"><label class="text-xs text-muted">비고</label><div>${Utils.escapeHtml(item.memo)}</div></div>` : ''}

        <!-- 첨부 사업자등록증 (프로젝트 아래 위치) -->
        ${attachmentHtml}

        ${rejectInfo}

        ${item.issueDate ? `<div class="mt-4 text-sm text-muted" style="padding-top:var(--sp-3);border-top:1px solid var(--color-border);">발행일: ${Utils.formatDate(item.issueDate)} · 처리자: ${Utils.escapeHtml(item.reviewerName || '-')}</div>` : ''}
      </div>
      <div class="modal-footer">
        ${footerBtns}
      </div>
    `, { size: 'modal-lg' });
  },

  // ===== 상태 변경 (팝업 없이) =====
  async _changeStatus(id, newStatus) {
    const item = await DB.get('taxInvoiceRequests', id);
    if (!item) return;

    const user = Auth.currentUser();
    const oldStatus = item.status;

    item.status = newStatus;
    item.reviewerId = user.id;
    item.reviewerName = user.displayName;
    item.reviewedAt = new Date().toISOString();
    item.updatedAt = new Date().toISOString();

    if (newStatus === '발행완료') {
      item.issueDate = new Date().toISOString();
    }
    if (newStatus === '요청') {
      item.issueDate = null;
      item.rejectReason = null;
    }
    if (newStatus === '검토중') {
      item.rejectReason = null;
    }

    await DB.update('taxInvoiceRequests', item);
    await DB.log('UPDATE', 'taxInvoice', id, `상태 변경: ${oldStatus} → ${newStatus}`);
    App.updateNotificationBadges();
    await this.render();
  },

  // ===== 반려 =====
  async _reject(id) {
    const item = await DB.get('taxInvoiceRequests', id);
    if (!item) return;

    Utils.openModal(`
      <div class="modal-header">
        <h3>반려 처리 - ${Utils.escapeHtml(item.requestNumber)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <p class="mb-4">거래처: <strong>${Utils.escapeHtml(item.partnerCompanyName || '-')}</strong> / 금액: <strong>${Utils.formatCurrency(item.totalAmount)}</strong></p>
        <div class="form-group">
          <label for="rejectReason">반려 사유 <span class="required">*</span></label>
          <textarea id="rejectReason" class="form-control" rows="3" placeholder="반려 사유를 입력하세요" required></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-danger" onclick="TaxInvoiceAdminModule._confirmReject('${id}')">반려 처리</button>
      </div>
    `);
  },

  async _confirmReject(id) {
    const reason = document.getElementById('rejectReason').value.trim();
    if (!reason) {
      Utils.showToast('반려 사유를 입력해 주세요.', 'error');
      return;
    }

    const item = await DB.get('taxInvoiceRequests', id);
    const user = Auth.currentUser();
    const oldStatus = item.status;

    item.status = '반려';
    item.rejectReason = reason;
    item.reviewerId = user.id;
    item.reviewerName = user.displayName;
    item.reviewedAt = new Date().toISOString();
    item.updatedAt = new Date().toISOString();

    await DB.update('taxInvoiceRequests', item);
    await DB.log('UPDATE', 'taxInvoice', id, `상태 변경: ${oldStatus} → 반려 (사유: ${reason})`);
    App.updateNotificationBadges();

    Utils.closeModal();
    await this.render();
  },

  destroy() {}
};

window.TaxInvoiceAdminModule = TaxInvoiceAdminModule;
