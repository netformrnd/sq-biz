/* ============================================
   세금계산서 발행 요청 모듈
   ============================================ */

const TaxInvoiceRequestModule = {
  container: null,
  uploadedFile: null,

  async init(container, action) {
    this.container = container;
    this.uploadedFile = null;

    if (action === 'myList') {
      await this.renderMyList();
    } else {
      await this.renderForm();
    }
  },

  // ===== 발행 요청 폼 =====
  async renderForm() {
    this.container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>세금계산서 발행 요청</h3>
        </div>
        <div class="card-body">
          <form id="taxInvoiceForm">
            <!-- 발행 사유 -->
            <div class="form-group">
              <label for="reason">발행 사유 <span class="required">*</span></label>
              <textarea id="reason" class="form-control" rows="3" placeholder="세금계산서 발행 사유를 입력하세요" required></textarea>
            </div>

            <!-- 금액 -->
            <div class="form-row">
              <div class="form-group">
                <label for="amount">공급가액 <span class="required">*</span></label>
                <input type="number" id="amount" class="form-control" placeholder="0" min="0" required>
              </div>
              <div class="form-group">
                <label>세액 (자동계산)</label>
                <input type="text" id="taxAmount" class="form-control" readonly value="₩0">
              </div>
              <div class="form-group">
                <label>합계금액</label>
                <input type="text" id="totalAmount" class="form-control" readonly value="₩0" style="font-weight:700;">
              </div>
            </div>

            <!-- 프로젝트명 -->
            <div class="form-group">
              <label for="projectName">프로젝트명</label>
              <input type="text" id="projectName" class="form-control" placeholder="관련 프로젝트명">
            </div>

            <!-- 사업자등록증 업로드 -->
            <div class="form-group">
              <label>사업자등록증 첨부 <span class="required">*</span></label>
              <div class="upload-area" id="ocrUploadArea">
                <div class="upload-icon">📄</div>
                <div class="upload-text">파일을 드래그하거나 클릭하여 업로드</div>
                <div class="upload-hint">또는 Ctrl+V로 화면캡쳐를 붙여넣기 하세요</div>
                <input type="file" id="ocrFileInput" accept="image/*,.pdf" style="display:none;">
              </div>
              <div id="ocrProgress" class="hidden">
                <div class="progress-bar"><div class="progress-fill" id="ocrProgressFill" style="width:0%"></div></div>
                <div class="progress-text" id="ocrProgressText">OCR 인식 준비중...</div>
              </div>
              <div id="uploadPreview" class="hidden upload-preview"></div>
            </div>

            <!-- 거래처 정보 -->
            <fieldset id="partnerInfo">
              <legend>거래처 정보 (사업자등록증에서 자동 인식)</legend>
              <div id="ocrNotice" class="hidden" style="padding:var(--sp-3);background:var(--color-warning-light);border-radius:var(--radius-sm);margin-bottom:var(--sp-4);font-size:var(--font-size-sm);">
                ⚠️ OCR 자동 인식이 되지 않았습니다. 사업자등록증을 보고 직접 입력해 주세요.
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="partnerRegNumber">사업자등록번호 <span class="required">*</span></label>
                  <input type="text" id="partnerRegNumber" class="form-control" placeholder="000-00-00000" required>
                </div>
                <div class="form-group">
                  <label for="partnerCompanyName">상호 <span class="required">*</span></label>
                  <input type="text" id="partnerCompanyName" class="form-control" placeholder="거래처 상호" required>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="partnerRepName">대표자명 <span class="required">*</span></label>
                  <input type="text" id="partnerRepName" class="form-control" placeholder="대표자 성명" required>
                </div>
                <div class="form-group">
                  <label for="partnerEmail">이메일 <span class="required">*</span></label>
                  <input type="email" id="partnerEmail" class="form-control" placeholder="tax@example.com (홈택스 발행용)" required>
                  <div class="hint">홈택스 세금계산서 발행 시 수신 이메일</div>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="partnerAddress">사업장 주소</label>
                  <input type="text" id="partnerAddress" class="form-control" placeholder="주소">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="partnerBusinessType">업태</label>
                  <input type="text" id="partnerBusinessType" class="form-control" placeholder="업태">
                </div>
                <div class="form-group">
                  <label for="partnerBusinessItem">종목</label>
                  <input type="text" id="partnerBusinessItem" class="form-control" placeholder="종목">
                </div>
              </div>
            </fieldset>

            <!-- 비고 -->
            <div class="form-group">
              <label for="memo">비고</label>
              <textarea id="memo" class="form-control" rows="2" placeholder="기타 참고사항"></textarea>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="Router.navigate('/tax-invoice/my')">취소</button>
              <button type="submit" class="btn btn-primary btn-lg">발행 요청하기</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this._bindFormEvents();
  },

  _bindFormEvents() {
    const form = document.getElementById('taxInvoiceForm');
    const amountInput = document.getElementById('amount');
    const uploadArea = document.getElementById('ocrUploadArea');
    const fileInput = document.getElementById('ocrFileInput');

    // 금액 자동계산
    amountInput.addEventListener('input', () => {
      const amount = Number(amountInput.value) || 0;
      const tax = Math.round(amount * 0.1);
      document.getElementById('taxAmount').value = Utils.formatCurrency(tax);
      document.getElementById('totalAmount').value = Utils.formatCurrency(amount + tax);
    });

    // 파일 업로드
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) this._handleFile(e.target.files[0]);
    });

    // 드래그 앤 드롭
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this._handleFile(e.dataTransfer.files[0]);
    });

    // 클립보드 붙여넣기 (Ctrl+V)
    document.addEventListener('paste', this._pasteHandler = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          this._handleFile(item.getAsFile());
          return;
        }
      }
    });

    // 폼 제출
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this._submitForm();
    });
  },

  async _handleFile(file) {
    if (!file) return;

    this.uploadedFile = file;

    // 미리보기 표시
    const preview = document.getElementById('uploadPreview');
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `
        <img src="${e.target.result}" alt="사업자등록증">
        <span class="remove-btn" onclick="TaxInvoiceRequestModule._removeFile()">&times;</span>
      `;
      preview.classList.remove('hidden');
      document.getElementById('ocrUploadArea').classList.add('hidden');
    };
    reader.readAsDataURL(file);

    // OCR 실행
    await this._runOCR(file);
  },

  _removeFile() {
    this.uploadedFile = null;
    document.getElementById('uploadPreview').classList.add('hidden');
    document.getElementById('uploadPreview').innerHTML = '';
    document.getElementById('ocrUploadArea').classList.remove('hidden');
    document.getElementById('ocrFileInput').value = '';
  },

  async _runOCR(file) {
    const progressEl = document.getElementById('ocrProgress');
    const fillEl = document.getElementById('ocrProgressFill');
    const textEl = document.getElementById('ocrProgressText');

    progressEl.classList.remove('hidden');
    textEl.textContent = 'OCR 엔진 로딩중... (최초 실행 시 시간이 걸릴 수 있습니다)';
    fillEl.style.width = '5%';

    try {
      // 이미지 전처리: File → Image → 캔버스 전처리 → Blob
      let ocrSource = file;
      if (file.type && file.type.startsWith('image/')) {
        try {
          textEl.textContent = '이미지 전처리 중...';
          fillEl.style.width = '8%';
          const img = await this._fileToImage(file);
          ocrSource = await OCREngine.preprocessImage(img);
          console.log('[OCR] 이미지 전처리 완료');
        } catch (e) {
          console.warn('[OCR] 전처리 실패, 원본 이미지 사용:', e);
          ocrSource = file; // 전처리 실패해도 원본으로 계속 진행
        }
      }

      textEl.textContent = 'OCR 엔진 로딩중... (한글 데이터 다운로드 중)';
      fillEl.style.width = '10%';

      const result = await OCREngine.recognizeImage(ocrSource, (progress) => {
        fillEl.style.width = `${10 + progress * 0.85}%`;
        textEl.textContent = `텍스트 인식중... ${progress}%`;
      });

      // 결과 자동 채우기
      if (result.regNumber) document.getElementById('partnerRegNumber').value = result.regNumber;
      if (result.companyName) document.getElementById('partnerCompanyName').value = result.companyName;
      if (result.repName) document.getElementById('partnerRepName').value = result.repName;
      if (result.address) document.getElementById('partnerAddress').value = result.address;
      if (result.businessType) document.getElementById('partnerBusinessType').value = result.businessType;
      if (result.businessItem) document.getElementById('partnerBusinessItem').value = result.businessItem;

      // 채워진 필드 수 확인
      const filledCount = [result.regNumber, result.companyName, result.repName, result.address, result.businessType, result.businessItem]
        .filter(v => v && v.trim()).length;

      if (filledCount === 0) {
        // 인식은 됐지만 파싱된 내용이 없음
        textEl.textContent = 'OCR 인식은 완료되었으나 자동 추출된 항목이 없습니다.';
        fillEl.style.width = '100%';
        fillEl.style.background = 'var(--color-warning)';
        document.getElementById('ocrNotice').classList.remove('hidden');
        Utils.showToast('자동 인식된 항목이 없습니다. 사업자등록증을 보고 직접 입력해 주세요.', 'warning', 5000);
        console.log('[OCR] 원본 인식 텍스트:\n', result.rawText);
      } else {
        // 신뢰도 표시
        for (const [field, level] of Object.entries(result.confidence)) {
          const fieldMap = {
            regNumber: 'partnerRegNumber',
            companyName: 'partnerCompanyName',
            repName: 'partnerRepName',
            address: 'partnerAddress',
            businessType: 'partnerBusinessType',
            businessItem: 'partnerBusinessItem'
          };
          const inputId = fieldMap[field];
          if (inputId) {
            const input = document.getElementById(inputId);
            input.style.borderColor = level === 'high' ? 'var(--color-success)' : 'var(--color-warning)';
          }
        }

        textEl.textContent = `인식 완료! ${filledCount}개 항목 추출. 결과를 확인하고 필요시 수정하세요.`;
        fillEl.style.width = '100%';
        document.getElementById('ocrNotice').classList.add('hidden');
        Utils.showToast(`${filledCount}개 항목이 자동 인식되었습니다. 확인 후 수정해 주세요.`, 'success');
      }

      setTimeout(() => progressEl.classList.add('hidden'), 3000);
    } catch (err) {
      console.error('[OCR] 실패:', err);
      const errMsg = (err && err.message) ? err.message : '알 수 없는 오류';
      textEl.textContent = 'OCR 인식 실패: ' + errMsg;
      fillEl.style.width = '0%';
      fillEl.style.background = 'var(--color-danger)';

      // 로컬 파일 환경 안내
      const isLocal = window.location.protocol === 'file:';
      if (isLocal) {
        Utils.showToast('로컬 파일 환경에서 OCR이 제한될 수 있습니다. 거래처 정보를 직접 입력해 주세요.', 'warning', 5000);
      } else {
        Utils.showToast('OCR 인식에 실패했습니다. 거래처 정보를 직접 입력해 주세요.', 'error');
      }
    }
  },

  // File → Image 엘리먼트 변환 (전처리용)
  _fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('이미지 로드 실패'));
      };
      img.src = url;
    });
  },

  async _submitForm() {
    const user = Auth.currentUser();
    const reason = document.getElementById('reason').value.trim();
    const amount = Number(document.getElementById('amount').value) || 0;

    const partnerRegNumber = document.getElementById('partnerRegNumber').value.trim();
    const partnerCompanyName = document.getElementById('partnerCompanyName').value.trim();
    const partnerRepName = document.getElementById('partnerRepName').value.trim();
    const partnerEmail = document.getElementById('partnerEmail').value.trim();

    if (!reason) {
      Utils.showToast('발행 사유를 입력해 주세요.', 'error');
      return;
    }
    if (amount <= 0) {
      Utils.showToast('공급가액을 입력해 주세요.', 'error');
      return;
    }
    if (!partnerRegNumber) {
      Utils.showToast('사업자등록번호를 입력해 주세요.', 'error');
      document.getElementById('partnerRegNumber').focus();
      return;
    }
    if (!partnerCompanyName) {
      Utils.showToast('상호를 입력해 주세요.', 'error');
      document.getElementById('partnerCompanyName').focus();
      return;
    }
    if (!partnerRepName) {
      Utils.showToast('대표자명을 입력해 주세요.', 'error');
      document.getElementById('partnerRepName').focus();
      return;
    }
    if (!partnerEmail) {
      Utils.showToast('이메일을 입력해 주세요. (홈택스 발행 시 필요)', 'error');
      document.getElementById('partnerEmail').focus();
      return;
    }
    // 이메일 형식 검사
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail)) {
      Utils.showToast('올바른 이메일 형식을 입력해 주세요.', 'error');
      document.getElementById('partnerEmail').focus();
      return;
    }

    const taxAmount = Math.round(amount * 0.1);
    const requestNumber = await DB.generateRequestNumber();

    // 첨부파일 준비
    let attachments = [];
    if (this.uploadedFile) {
      attachments.push({
        fileName: this.uploadedFile.name || 'screenshot.png',
        fileType: this.uploadedFile.type,
        fileData: this.uploadedFile,
        uploadedAt: new Date().toISOString()
      });
    }

    const data = {
      requestNumber,
      requesterId: user.id,
      requesterName: user.displayName,
      status: '요청',
      reason,
      amount,
      taxAmount,
      totalAmount: amount + taxAmount,
      partnerCompanyName,
      partnerRegNumber,
      partnerRepName,
      partnerEmail,
      partnerAddress: document.getElementById('partnerAddress').value.trim(),
      partnerBusinessType: document.getElementById('partnerBusinessType').value.trim(),
      partnerBusinessItem: document.getElementById('partnerBusinessItem').value.trim(),
      attachments,
      projectName: document.getElementById('projectName').value.trim(),
      memo: document.getElementById('memo').value.trim(),
      reviewerId: null,
      reviewerName: null,
      reviewedAt: null,
      issueDate: null,
      rejectReason: null,
      matchedDepositId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      const id = await DB.add('taxInvoiceRequests', data);
      await DB.log('CREATE', 'taxInvoice', id, `세금계산서 발행 요청: ${requestNumber}`);
      App.updateNotificationBadges();
      Utils.showToast(`발행 요청이 등록되었습니다. (${requestNumber})`, 'success');
      Router.navigate('/tax-invoice/my');
    } catch (err) {
      Utils.showToast('요청 등록 실패: ' + err.message, 'error');
    }
  },

  // ===== 나의 요청 현황 =====
  async renderMyList() {
    const user = Auth.currentUser();
    const all = await DB.getAll('taxInvoiceRequests');
    const myItems = all.filter(i => i.requesterId === user.id).reverse();

    let tableRows = '';
    if (myItems.length === 0) {
      tableRows = `<tr><td colspan="7" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">📝</div><h3>아직 요청 내역이 없습니다</h3><p>세금계산서 발행 요청을 해보세요.</p></div>
      </td></tr>`;
    } else {
      tableRows = myItems.map(item => `
        <tr onclick="TaxInvoiceRequestModule._showDetail(${item.id})" style="cursor:pointer;">
          <td class="fw-medium">${Utils.escapeHtml(item.requestNumber)}</td>
          <td>${Utils.escapeHtml(item.partnerCompanyName || '-')}</td>
          <td>${Utils.escapeHtml(item.reason ? (item.reason.length > 30 ? item.reason.slice(0, 30) + '...' : item.reason) : '-')}</td>
          <td class="text-right amount">${Utils.formatCurrency(item.totalAmount)}</td>
          <td class="text-center">${Utils.statusBadge(item.status)}</td>
          <td>${Utils.formatDate(item.createdAt)}</td>
          <td>${item.issueDate ? Utils.formatDate(item.issueDate) : '-'}</td>
        </tr>
      `).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>나의 요청현황</h2>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="Router.navigate('/tax-invoice/new')">+ 새 발행 요청</button>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>요청번호</th>
              <th>거래처</th>
              <th>발행사유</th>
              <th class="text-right">합계금액</th>
              <th class="text-center">상태</th>
              <th>요청일</th>
              <th>발행일</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  },

  async _showDetail(id) {
    const item = await DB.get('taxInvoiceRequests', id);
    if (!item) return;

    let attachmentHtml = '';
    if (item.attachments && item.attachments.length > 0) {
      const att = item.attachments[0];
      if (att.fileData instanceof Blob) {
        const url = URL.createObjectURL(att.fileData);
        attachmentHtml = `<div class="mt-4"><label class="fw-semibold text-sm">첨부 사업자등록증:</label><br><img src="${url}" style="max-width:100%;max-height:300px;border-radius:var(--radius-sm);border:1px solid var(--color-border);margin-top:var(--sp-2);"></div>`;
      }
    }

    let rejectInfo = '';
    if (item.status === '반려' && item.rejectReason) {
      rejectInfo = `<div class="mt-4" style="padding:var(--sp-3);background:var(--color-danger-light);border-radius:var(--radius-sm);">
        <strong class="text-danger">반려 사유:</strong> ${Utils.escapeHtml(item.rejectReason)}
      </div>`;
    }

    Utils.openModal(`
      <div class="modal-header">
        <h3>발행 요청 상세 - ${Utils.escapeHtml(item.requestNumber)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-4);">
          ${Utils.statusBadge(item.status)}
          <span class="text-sm text-muted">요청일: ${Utils.formatDateTime(item.createdAt)}</span>
        </div>

        <div class="form-row mb-4">
          <div><label class="text-xs text-muted">공급가액</label><div class="fw-semibold">${Utils.formatCurrency(item.amount)}</div></div>
          <div><label class="text-xs text-muted">세액</label><div>${Utils.formatCurrency(item.taxAmount)}</div></div>
          <div><label class="text-xs text-muted">합계</label><div class="fw-bold" style="font-size:var(--font-size-lg);">${Utils.formatCurrency(item.totalAmount)}</div></div>
        </div>

        <div class="mb-4">
          <label class="text-xs text-muted">발행 사유</label>
          <div>${Utils.escapeHtml(item.reason)}</div>
        </div>

        <fieldset>
          <legend>거래처 정보</legend>
          <div class="form-row">
            <div><label class="text-xs text-muted">상호</label><div>${Utils.escapeHtml(item.partnerCompanyName || '-')}</div></div>
            <div><label class="text-xs text-muted">사업자등록번호</label><div>${Utils.escapeHtml(item.partnerRegNumber || '-')}</div></div>
          </div>
          <div class="form-row mt-2">
            <div><label class="text-xs text-muted">대표자</label><div>${Utils.escapeHtml(item.partnerRepName || '-')}</div></div>
            <div><label class="text-xs text-muted">이메일</label><div>${Utils.escapeHtml(item.partnerEmail || '-')}</div></div>
          </div>
          <div class="form-row mt-2">
            <div><label class="text-xs text-muted">주소</label><div>${Utils.escapeHtml(item.partnerAddress || '-')}</div></div>
          </div>
          <div class="form-row mt-2">
            <div><label class="text-xs text-muted">업태</label><div>${Utils.escapeHtml(item.partnerBusinessType || '-')}</div></div>
            <div><label class="text-xs text-muted">종목</label><div>${Utils.escapeHtml(item.partnerBusinessItem || '-')}</div></div>
          </div>
        </fieldset>

        ${item.projectName ? `<div class="mt-2"><label class="text-xs text-muted">프로젝트</label><div>${Utils.escapeHtml(item.projectName)}</div></div>` : ''}
        ${item.memo ? `<div class="mt-2"><label class="text-xs text-muted">비고</label><div>${Utils.escapeHtml(item.memo)}</div></div>` : ''}
        ${rejectInfo}
        ${attachmentHtml}
        ${item.issueDate ? `<div class="mt-4 text-sm text-muted">발행일: ${Utils.formatDate(item.issueDate)} · 처리자: ${Utils.escapeHtml(item.reviewerName || '-')}</div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
      </div>
    `, { size: 'modal-lg' });
  },

  destroy() {
    // 클립보드 핸들러 제거
    if (this._pasteHandler) {
      document.removeEventListener('paste', this._pasteHandler);
      this._pasteHandler = null;
    }
  }
};

window.TaxInvoiceRequestModule = TaxInvoiceRequestModule;
