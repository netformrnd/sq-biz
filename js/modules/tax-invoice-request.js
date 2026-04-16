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
                <div class="upload-text"><strong>Ctrl+V</strong>로 사업자등록증 화면캡쳐 붙여넣기 <span class="text-xs text-muted">(자동 인식)</span></div>
                <div class="upload-hint">또는 클릭하여 파일 업로드 (파일은 보관용, 수동 입력 필요)</div>
                <input type="file" id="ocrFileInput" accept="image/*,.pdf" style="display:none;">
              </div>
              <div id="ocrProgress" class="hidden">
                <div class="progress-bar"><div class="progress-fill" id="ocrProgressFill" style="width:0%"></div></div>
                <div class="progress-text" id="ocrProgressText">OCR 인식 준비중...</div>
              </div>
              <div id="uploadPreview" class="hidden upload-preview"></div>
              <!-- OCR 인식 원문 보기 -->
              <div id="ocrRawTextArea" class="hidden mt-2">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('ocrRawText').classList.toggle('hidden')">🔍 OCR 인식 원문 보기/닫기</button>
                <pre id="ocrRawText" class="hidden" style="margin-top:var(--sp-2);padding:var(--sp-3);background:#F1F5F9;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:11px;max-height:150px;overflow-y:auto;white-space:pre-wrap;"></pre>
              </div>
            </div>

            <!-- 계약서 첨부 (선택) -->
            <div class="form-group">
              <label>계약서 첨부 <span class="text-muted text-xs">(선택)</span></label>
              <div class="upload-area" id="contractUploadArea" style="padding:var(--sp-4);">
                <div class="upload-icon" style="font-size:24px;">📑</div>
                <div class="upload-text">계약서 파일을 드래그하거나 클릭하여 업로드</div>
                <div class="upload-hint">여러 파일 첨부 가능 (이미지, PDF)</div>
                <input type="file" id="contractFileInput" accept="image/*,.pdf" multiple style="display:none;">
              </div>
              <div id="contractPreviewList" style="margin-top:var(--sp-2);"></div>
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

    // 계약서 업로드
    const contractArea = document.getElementById('contractUploadArea');
    const contractInput = document.getElementById('contractFileInput');
    this.contractFiles = [];

    contractArea.addEventListener('click', () => contractInput.click());
    contractInput.addEventListener('change', (e) => {
      for (const f of e.target.files) this._addContractFile(f);
    });
    contractArea.addEventListener('dragover', (e) => { e.preventDefault(); contractArea.classList.add('dragover'); });
    contractArea.addEventListener('dragleave', () => contractArea.classList.remove('dragover'));
    contractArea.addEventListener('drop', (e) => {
      e.preventDefault(); contractArea.classList.remove('dragover');
      for (const f of e.dataTransfer.files) this._addContractFile(f);
    });

    // 클립보드 붙여넣기 (Ctrl+V) - 화면캡쳐 → OCR 자동 실행
    document.addEventListener('paste', this._pasteHandler = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          this._handleFile(item.getAsFile(), true); // isFromClipboard = true
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

  _addContractFile(file) {
    if (!file) return;
    this.contractFiles.push(file);
    this._renderContractPreviews();
  },

  _removeContractFile(idx) {
    this.contractFiles.splice(idx, 1);
    this._renderContractPreviews();
  },

  _renderContractPreviews() {
    const list = document.getElementById('contractPreviewList');
    if (!list) return;
    if (this.contractFiles.length === 0) { list.innerHTML = ''; return; }
    list.innerHTML = this.contractFiles.map((f, i) => `
      <div style="display:inline-flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);background:var(--color-surface-hover);border:1px solid var(--color-border);border-radius:var(--radius-sm);margin:2px;font-size:var(--font-size-sm);">
        📑 ${Utils.escapeHtml(f.name || 'file')}
        <span style="cursor:pointer;color:var(--color-danger);" onclick="TaxInvoiceRequestModule._removeContractFile(${i})">&times;</span>
      </div>
    `).join('');
  },

  // isFromClipboard: 화면캡쳐(Ctrl+V)인지 파일 업로드인지 구분
  async _handleFile(file, isFromClipboard = false) {
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

    // OCR 실행 (화면캡쳐만 실행, 파일 업로드는 건너뜀)
    if (isFromClipboard || (file.type && file.type.startsWith('image/'))) {
      await this._runOCR(file);
    } else {
      // 파일(PDF 등)은 OCR 생략, 안내 표시
      document.getElementById('ocrNotice').classList.remove('hidden');
      document.getElementById('ocrNotice').innerHTML =
        '📎 파일이 첨부되었습니다. 거래처 정보는 아래에 직접 입력하거나,<br>' +
        '<strong>Ctrl+V로 사업자등록증 화면캡쳐를 붙여넣기</strong>하면 자동 인식됩니다.';
    }
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
    const rawArea = document.getElementById('ocrRawTextArea');
    const rawText = document.getElementById('ocrRawText');

    progressEl.classList.remove('hidden');
    fillEl.style.background = 'var(--color-primary)';

    let step = '준비';
    try {
      // STEP 1: Tesseract.js 로드
      step = 'OCR 엔진 로드';
      textEl.textContent = '1/3 OCR 엔진 로딩중... (최초 1회 시간 소요)';
      fillEl.style.width = '10%';
      await OCREngine.loadTesseract();
      console.log('[OCR] 엔진 로드 완료');

      // STEP 2: 원본 이미지로 바로 인식 (전처리 생략 - 원본이 더 정확)
      step = '텍스트 인식';
      textEl.textContent = '2/3 한글 데이터 다운로드 및 텍스트 인식중...';
      fillEl.style.width = '20%';

      const result = await OCREngine.recognizeImage(file, (progress) => {
        fillEl.style.width = `${20 + progress * 0.7}%`;
        if (progress < 50) {
          textEl.textContent = `2/3 한글 학습 데이터 다운로드중... ${progress}%`;
        } else {
          textEl.textContent = `2/3 텍스트 인식중... ${progress}%`;
        }
      });

      // STEP 3: 결과 처리
      step = '결과 처리';
      fillEl.style.width = '95%';
      textEl.textContent = '3/3 결과 분석중...';

      // 원문 항상 표시
      if (result.rawText && result.rawText.trim()) {
        rawArea.classList.remove('hidden');
        rawText.textContent = result.rawText;
        console.log('[OCR] 인식 원문:\n', result.rawText);
      }

      // 결과 자동 채우기
      if (result.regNumber) document.getElementById('partnerRegNumber').value = result.regNumber;
      if (result.companyName) document.getElementById('partnerCompanyName').value = result.companyName;
      if (result.repName) document.getElementById('partnerRepName').value = result.repName;
      if (result.address) document.getElementById('partnerAddress').value = result.address;
      if (result.businessType) document.getElementById('partnerBusinessType').value = result.businessType;
      if (result.businessItem) document.getElementById('partnerBusinessItem').value = result.businessItem;

      const filledCount = [result.regNumber, result.companyName, result.repName, result.address, result.businessType, result.businessItem]
        .filter(v => v && v.trim()).length;

      fillEl.style.width = '100%';

      if (filledCount === 0) {
        fillEl.style.background = 'var(--color-warning)';
        textEl.textContent = '텍스트는 인식했으나 자동 추출 항목 없음. 아래 원문을 참고하여 직접 입력하세요.';
        document.getElementById('ocrNotice').classList.remove('hidden');
      } else {
        fillEl.style.background = 'var(--color-success)';
        textEl.textContent = `${filledCount}개 항목 자동 추출 완료. 결과를 확인하고 수정하세요.`;
        document.getElementById('ocrNotice').classList.add('hidden');

        for (const [field, level] of Object.entries(result.confidence)) {
          const fieldMap = { regNumber:'partnerRegNumber', companyName:'partnerCompanyName', repName:'partnerRepName', address:'partnerAddress', businessType:'partnerBusinessType', businessItem:'partnerBusinessItem' };
          const el = document.getElementById(fieldMap[field]);
          if (el) el.style.borderColor = level === 'high' ? 'var(--color-success)' : 'var(--color-warning)';
        }
      }

      setTimeout(() => progressEl.classList.add('hidden'), 5000);

    } catch (err) {
      console.error(`[OCR] ${step} 단계 실패:`, err);
      const errMsg = (err && err.message) ? err.message : String(err);
      fillEl.style.width = '100%';
      fillEl.style.background = 'var(--color-danger)';
      textEl.textContent = `OCR 실패 (${step}): ${errMsg}`;
      document.getElementById('ocrNotice').classList.remove('hidden');

      // 에러 상세를 원문 영역에 표시
      rawArea.classList.remove('hidden');
      rawText.textContent = `[오류 상세]\n단계: ${step}\n메시지: ${errMsg}\n\n브라우저: ${navigator.userAgent}\nURL: ${location.href}\n\n※ 사업자등록증을 보고 거래처 정보를 직접 입력해 주세요.`;
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

    // 첨부파일 준비 (사업자등록증)
    let attachments = [];
    if (this.uploadedFile) {
      attachments.push({
        fileName: this.uploadedFile.name || 'screenshot.png',
        fileType: this.uploadedFile.type,
        fileData: this.uploadedFile,
        category: 'bizCert',
        uploadedAt: new Date().toISOString()
      });
    }
    // 계약서 첨부
    if (this.contractFiles && this.contractFiles.length > 0) {
      for (const cf of this.contractFiles) {
        attachments.push({
          fileName: cf.name || 'contract.pdf',
          fileType: cf.type,
          fileData: cf,
          category: 'contract',
          uploadedAt: new Date().toISOString()
        });
      }
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

      // 문서보관에 자동 저장 (사업자등록증 + 계약서)
      if (attachments.length > 0) {
        for (const att of attachments) {
          await DB.add('documents', {
            companyName: partnerCompanyName,
            regNumber: partnerRegNumber,
            fileName: att.fileName,
            fileType: att.fileType,
            fileData: att.fileData,
            category: att.category === 'contract' ? '계약서' : '사업자등록증',
            relatedInvoiceId: id,
            relatedRequestNumber: requestNumber,
            registeredBy: user.id,
            registeredByName: user.displayName,
            createdAt: new Date().toISOString()
          });
        }
      }

      // 잔디 알림 전송
      JandiWebhook.notifyNewRequest(data);

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
