/* ============================================
   지출결의서 모듈 (v2)
   - PDF 업로드 → pdf.js 파싱 → 라인 추출 → 매칭 후보 제시 → 사용자 확인 → 저장
   - 매출(deposits) ↔ 외주송금(transferRecords) 사이의 정산 기록을 결의서 1장에 묶음
   - 권한: 관리자 + 'expenseReports' 권한 보유자 (없으면 관리자만)
   ============================================ */

const ExpenseReportsModule = {
  container: null,
  COLLECTION: 'expenseReports',

  // pdf.js 워커 SDK (CDN, 한 번 로드 후 캐시)
  _pdfjsLoaded: false,
  _pdfjsLoadPromise: null,

  async init(container, action) {
    this.container = container;
    if (action === 'new') {
      await this._renderUploadPage();
      return;
    }
    if (action === 'detail') {
      const { id } = Router.getQuery();
      if (!id) { Router.navigate('/expense-reports'); return; }
      await this._renderDetailPage(id);
      return;
    }
    await this._renderListPage();
  },

  // ============================================
  // 1) 목록 페이지
  // ============================================
  async _renderListPage() {
    const all = (await DB.getAll(this.COLLECTION)).reverse();

    const totalAmount = all.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
    const matched = all.filter(r => (r.matchStatus || 'pending') === 'completed').length;
    const pending = all.length - matched;

    let rows = '';
    if (all.length === 0) {
      rows = `<tr><td colspan="7" class="text-center" style="padding:var(--sp-10);">
        <div class="empty-state"><div class="empty-icon">📄</div>
          <h3>등록된 지출결의서가 없습니다</h3>
          <p>+ 신규 결의서 업로드 버튼으로 PDF를 추가하세요.</p>
        </div>
      </td></tr>`;
    } else {
      rows = all.map(r => {
        const statusBadge = {
          completed: '<span class="badge badge-complete">매칭완료</span>',
          partial: '<span class="badge badge-review">부분매칭</span>',
          pending: '<span class="badge badge-request">미매칭</span>'
        }[r.matchStatus || 'pending'];
        return `
          <tr style="cursor:pointer;" onclick="Router.navigate('/expense-reports/detail?id=${r.id}')">
            <td>${Utils.formatDate(r.reportDate)}</td>
            <td class="fw-medium">${Utils.escapeHtml(r.title || '-')}</td>
            <td>${Utils.escapeHtml(r.vendorName || '-')}</td>
            <td>${Utils.escapeHtml(r.authorName || '-')}</td>
            <td class="text-right amount">${Utils.formatCurrency(r.totalAmount || 0)}</td>
            <td class="text-center">${(r.lineItems || []).length}건</td>
            <td class="text-center">${statusBadge}</td>
          </tr>`;
      }).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>
          <button class="btn btn-ghost" onclick="Router.navigate('/outsourcing')" style="font-size:0.9rem;">← 정산관리</button>
          📄 지출결의서 관리
        </h2>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="Router.navigate('/expense-reports/new')">+ 신규 결의서 업로드</button>
        </div>
      </div>

      <div class="summary-cards">
        <div class="summary-card"><div class="card-icon cyan">📄</div><div class="card-info"><div class="card-label">전체 결의서</div><div class="card-value">${all.length}건</div></div></div>
        <div class="summary-card"><div class="card-icon green">✅</div><div class="card-info"><div class="card-label">매칭 완료</div><div class="card-value">${matched}건</div></div></div>
        <div class="summary-card"><div class="card-icon orange">⏳</div><div class="card-info"><div class="card-label">미/부분 매칭</div><div class="card-value">${pending}건</div></div></div>
        <div class="summary-card"><div class="card-icon red">💰</div><div class="card-info"><div class="card-label">총 결의 금액</div><div class="card-value">${Utils.formatCurrency(totalAmount)}</div></div></div>
      </div>

      <div class="card mt-4" style="padding:var(--sp-3);background:var(--color-bg-light);">
        <div class="text-sm text-muted">
          💡 <strong>흐름</strong>: PDF 업로드 → 자동 파싱 → 매출/송금 후보 제시 → 1클릭 확인 → 저장 ·
          저장 시 입금내역(deposits)·송금내역(transferRecords)에 자동 연결됩니다.
        </div>
      </div>

      <div class="table-wrapper mt-4">
        <table class="data-table">
          <thead><tr>
            <th>지출일자</th><th>지출건명</th><th>외주업체</th><th>작성자</th>
            <th class="text-right">총금액</th><th class="text-center">라인수</th><th class="text-center">매칭상태</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  // ============================================
  // 2) 업로드 + 파싱 + 매칭 페이지 (한 페이지에서 다 처리)
  // ============================================
  async _renderUploadPage() {
    this.container.innerHTML = `
      <div class="page-header">
        <h2>
          <button class="btn btn-ghost" onclick="Router.navigate('/expense-reports')" style="font-size:0.9rem;">← 목록</button>
          신규 지출결의서 업로드
        </h2>
      </div>

      <!-- 1단계: 파일 선택 -->
      <div class="card mb-4">
        <div class="card-body">
          <h3 style="margin-top:0;">1️⃣ PDF 파일 선택</h3>
          <div style="border:2px dashed #94A3B8;border-radius:8px;padding:var(--sp-5);text-align:center;background:#F8FAFC;" id="exDropZone">
            <div style="font-size:48px;margin-bottom:8px;">📄</div>
            <p style="margin:0 0 12px 0;">지출결의서 PDF를 선택하거나 여기에 드래그</p>
            <input type="file" id="exFileInput" accept="application/pdf" style="display:none;" onchange="ExpenseReportsModule._onFileSelected(this.files[0])">
            <button class="btn btn-primary" onclick="document.getElementById('exFileInput').click()">파일 선택</button>
            <div id="exFileName" class="text-sm text-muted mt-2"></div>
          </div>
        </div>
      </div>

      <!-- 2단계: 파싱 결과 (편집 가능) -->
      <div id="exParseSection" class="card mb-4 hidden">
        <div class="card-body">
          <h3 style="margin-top:0;">2️⃣ 파싱 결과 확인 / 편집</h3>
          <div id="exParseContent"></div>
        </div>
      </div>

      <!-- 3단계: 매칭 후보 -->
      <div id="exMatchSection" class="card mb-4 hidden">
        <div class="card-body">
          <h3 style="margin-top:0;">3️⃣ 매출 / 송금 매칭 후보</h3>
          <div class="text-sm text-muted mb-3">시스템이 금액·날짜·이름 유사도로 후보를 찾았습니다. 잘못된 매칭은 [해제] 클릭.</div>
          <div id="exMatchContent"></div>
        </div>
      </div>

      <!-- 4단계: 저장 -->
      <div id="exSaveSection" class="hidden text-center mt-5">
        <button class="btn btn-primary btn-lg" onclick="ExpenseReportsModule._save()">💾 결의서 + 매칭 저장</button>
        <div class="text-xs text-muted mt-2">저장 시 매칭된 입금/송금 레코드에 결의서 ID가 자동 기록됩니다.</div>
      </div>
    `;

    // 드래그앤드롭
    setTimeout(() => {
      const dz = document.getElementById('exDropZone');
      if (!dz) return;
      ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.style.background = '#DBEAFE'; }));
      ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.style.background = '#F8FAFC'; }));
      dz.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) this._onFileSelected(f);
      });
    }, 0);
  },

  // 작업 중인 결의서 (저장 전까지 메모리에 보관)
  _draft: null,

  async _onFileSelected(file) {
    if (!file) return;
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      Utils.showToast('PDF 파일만 업로드 가능합니다.', 'error');
      return;
    }
    const nameEl = document.getElementById('exFileName');
    if (nameEl) nameEl.textContent = `⏳ "${file.name}" 파싱 중...`;
    try {
      await this._ensurePdfJs();
      const text = await this._extractPdfText(file);
      const parsed = this._parseExpenseReport(text);
      this._draft = {
        file,
        fileName: file.name,
        fileSize: file.size,
        rawText: text,
        ...parsed
      };
      if (nameEl) nameEl.textContent = `✅ "${file.name}" 파싱 완료 (${parsed.lineItems.length} 라인 추출)`;
      this._renderParseSection();
      await this._renderMatchSection();
      document.getElementById('exSaveSection').classList.remove('hidden');
    } catch (e) {
      console.error('[ExpenseReports] PDF 파싱 실패:', e);
      if (nameEl) nameEl.textContent = `❌ 파싱 실패: ${e.message}`;
      Utils.showToast('PDF 파싱 실패: ' + e.message, 'error', 6000);
    }
  },

  // pdf.js 동적 로드
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
      const pageText = content.items.map(it => it.str).join(' ');
      allText += pageText + '\n';
    }
    return allText;
  },

  // ============================================
  // 3) 텍스트 → 구조화 데이터 파싱
  // ============================================
  // 양식: "지출일자 2026년 4월 10일", "지출건명 ...", "합계 15,675,000원"
  //       "박기순(광명중공업) 6,600,000원 입금(2026-02-10) 6,270,000"
  _parseExpenseReport(text) {
    const result = {
      reportDate: '',
      reportNumber: '',
      authorName: '',
      title: '',
      vendorName: '',
      vendorRepName: '',
      vendorAccount: '',
      totalAmount: 0,
      lineItems: []
    };

    // 정규화: 공백 통합
    const norm = text.replace(/\s+/g, ' ').replace(/\u00A0/g, ' ');

    // 지출일자: "2026년 4월 10일" or "지출일자 2026-04-10"
    const dateM = norm.match(/지출일자[:\s]*(\d{4})[년\-./\s]*(\d{1,2})[월\-./\s]*(\d{1,2})/);
    if (dateM) {
      result.reportDate = `${dateM[1]}-${dateM[2].padStart(2, '0')}-${dateM[3].padStart(2, '0')}`;
    }

    // 작성자: "작성자 조현식" or "조현식"
    const authorM = norm.match(/작성자[:\s]*([가-힣]{2,5})/);
    if (authorM) result.authorName = authorM[1];

    // 지출건명
    const titleM = norm.match(/지출건명[:\s]*([^\n합계계좌]+?)(?=\s+합계|\s+계좌|\s+적요|$)/);
    if (titleM) result.title = titleM[1].trim().slice(0, 100);

    // 합계 금액
    const sumM = norm.match(/합계[:\s]*([\d,]+)\s*원?/);
    if (sumM) result.totalAmount = Number(sumM[1].replace(/,/g, '')) || 0;

    // 외주업체명 (대림건축ENG 같은 패턴)
    const vendorM = norm.match(/(?:외주\s*업체|외부\s*업체|업체명?)[:\s]*([가-힣A-Za-z0-9㈜()ENGIInc.,\s]+?)(?=\s+(?:홍|박|김|이|최|정|조|윤|강|장|임|한|오|서|신|권|황|안|송|류|전|홍정란|대표|계좌)|$)/);
    if (vendorM) result.vendorName = vendorM[1].trim().slice(0, 40);
    else {
      // fallback: 흔한 외주업체 패턴
      const v2 = norm.match(/(대림건축\s*ENG|[가-힣]+건축\s*ENG|[가-힣A-Za-z]+(?:Inc|건축|설계|엔지니어링|건설))/);
      if (v2) result.vendorName = v2[1].trim();
    }

    // 외주 대표자
    const repM = norm.match(/(?:대표자?|담당자?)[:\s]*([가-힣]{2,5})/);
    if (repM) result.vendorRepName = repM[1];

    // 계좌
    const acctM = norm.match(/(?:계좌\s*번?호?|계좌)[:\s]*([가-힣]+\s*[\d\-\s]{8,})/);
    if (acctM) result.vendorAccount = acctM[1].trim();

    // ===== 라인 아이템 =====
    // 패턴: "{매출처} {금액}원 입금({날짜}) {외주금액}"
    // 예: "박기순(광명중공업) 6,600,000원 입금(2026-02-10) 6,270,000"
    const lineRe = /([가-힣A-Za-z()㈜\s]+?)\s+([\d,]+)\s*원?\s*입금\s*\(?\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2})\s*\)?\s+([\d,]+)/g;
    let m;
    while ((m = lineRe.exec(norm)) !== null) {
      const clientName = m[1].trim().replace(/\s+/g, ' ').slice(0, 50);
      const depositAmount = Number(m[2].replace(/,/g, '')) || 0;
      const depDate = m[3].replace(/[./]/g, '-');
      const depDateParts = depDate.split('-');
      const depositDate = `${depDateParts[0]}-${depDateParts[1].padStart(2, '0')}-${depDateParts[2].padStart(2, '0')}`;
      const transferAmount = Number(m[4].replace(/,/g, '')) || 0;
      if (depositAmount > 0 && transferAmount > 0 && clientName.length >= 2) {
        result.lineItems.push({
          clientName,
          depositAmount,
          depositDate,
          transferAmount,
          matchedDepositId: null,
          matchedTransferId: null
        });
      }
    }

    return result;
  },

  // ============================================
  // 4) 파싱 결과 편집 UI
  // ============================================
  _renderParseSection() {
    const d = this._draft;
    if (!d) return;
    const sec = document.getElementById('exParseSection');
    const body = document.getElementById('exParseContent');
    sec.classList.remove('hidden');

    body.innerHTML = `
      <div class="form-row">
        <div class="form-group">
          <label>지출일자</label>
          <input type="date" class="form-control" value="${d.reportDate}" oninput="ExpenseReportsModule._draft.reportDate = this.value">
        </div>
        <div class="form-group">
          <label>작성자</label>
          <input type="text" class="form-control" value="${Utils.escapeHtml(d.authorName)}" oninput="ExpenseReportsModule._draft.authorName = this.value">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="grid-column:span 2;">
          <label>지출건명</label>
          <input type="text" class="form-control" value="${Utils.escapeHtml(d.title)}" oninput="ExpenseReportsModule._draft.title = this.value">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>외주업체명</label>
          <input type="text" class="form-control" value="${Utils.escapeHtml(d.vendorName)}" oninput="ExpenseReportsModule._draft.vendorName = this.value">
        </div>
        <div class="form-group">
          <label>대표자</label>
          <input type="text" class="form-control" value="${Utils.escapeHtml(d.vendorRepName)}" oninput="ExpenseReportsModule._draft.vendorRepName = this.value">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>외주 계좌</label>
          <input type="text" class="form-control" value="${Utils.escapeHtml(d.vendorAccount)}" oninput="ExpenseReportsModule._draft.vendorAccount = this.value">
        </div>
        <div class="form-group">
          <label>합계</label>
          <input type="text" class="form-control" value="${Utils.formatCurrency(d.totalAmount)}" readonly style="background:#F1F5F9;">
        </div>
      </div>

      <h4 style="margin-top:var(--sp-4);">📋 라인 아이템 (${d.lineItems.length}건)</h4>
      ${d.lineItems.length === 0
        ? '<div class="text-muted text-center" style="padding:var(--sp-3);">⚠️ 라인 아이템을 추출하지 못했습니다. PDF 양식을 확인하거나 수동 매칭으로 진행하세요.</div>'
        : `<div class="table-wrapper">
            <table class="data-table">
              <thead><tr>
                <th>#</th><th>매출처</th><th class="text-right">매출금액</th><th>입금일자</th><th class="text-right">외주송금액</th>
              </tr></thead>
              <tbody>${d.lineItems.map((li, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${Utils.escapeHtml(li.clientName)}</td>
                  <td class="text-right amount">${Utils.formatCurrency(li.depositAmount)}</td>
                  <td>${li.depositDate}</td>
                  <td class="text-right amount">${Utils.formatCurrency(li.transferAmount)}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>`}
    `;
  },

  // ============================================
  // 5) 매칭 후보 찾기 + UI
  // ============================================
  async _renderMatchSection() {
    const d = this._draft;
    if (!d || d.lineItems.length === 0) return;

    const sec = document.getElementById('exMatchSection');
    const body = document.getElementById('exMatchContent');
    sec.classList.remove('hidden');

    const [allDeposits, allTransfers] = await Promise.all([
      DB.getAll('deposits'),
      DB.getAll('transferRecords')
    ]);

    body.innerHTML = d.lineItems.map((li, idx) => {
      // 매출 후보: 금액 일치 + 날짜 ±3일 + 이름 키워드 일치
      const depCandidates = this._findDepositCandidates(li, allDeposits);
      // 송금 후보: 금액 일치 + 수취인이 vendor 이름 포함
      const trCandidates = this._findTransferCandidates(li, allTransfers, d.vendorName);

      // 자동 선택: 후보가 1개면 자동 매칭 (사용자 해제 가능)
      if (depCandidates.length === 1 && !li.matchedDepositId) {
        li.matchedDepositId = depCandidates[0].id;
      }
      if (trCandidates.length === 1 && !li.matchedTransferId) {
        li.matchedTransferId = trCandidates[0].id;
      }

      return `
        <div class="card mb-3" style="border-left:4px solid #2563EB;">
          <div class="card-body">
            <h4 style="margin-top:0;">라인 ${idx + 1}: ${Utils.escapeHtml(li.clientName)} ${Utils.formatCurrency(li.depositAmount)} → 외주 ${Utils.formatCurrency(li.transferAmount)}</h4>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);">
              <!-- 매출(입금) 후보 -->
              <div>
                <strong>💰 매출(입금) 매칭</strong>
                ${depCandidates.length === 0
                  ? '<div class="text-sm text-muted mt-2">⚠️ 일치하는 입금내역 없음 — 입금이 아직 안 들어왔거나 등록 전</div>'
                  : depCandidates.map(c => `
                      <div style="padding:8px;margin-top:4px;border-radius:4px;background:${li.matchedDepositId === c.id ? '#DBEAFE' : '#F8FAFC'};cursor:pointer;border:1px solid ${li.matchedDepositId === c.id ? '#2563EB' : '#E2E8F0'};"
                           onclick="ExpenseReportsModule._toggleMatch(${idx}, 'deposit', '${c.id}')">
                        <div class="text-sm fw-medium">${li.matchedDepositId === c.id ? '✓ ' : ''}${Utils.escapeHtml(c.depositorName || '-')}</div>
                        <div class="text-xs text-muted">${Utils.formatDate(c.depositDate)} · ${Utils.formatCurrency(c.amount)}</div>
                      </div>`).join('')}
              </div>

              <!-- 외주 송금 후보 -->
              <div>
                <strong>💸 외주 송금 매칭</strong>
                ${trCandidates.length === 0
                  ? '<div class="text-sm text-muted mt-2">⚠️ 일치하는 송금내역 없음 — 송금이 아직 안 됐거나 등록 전</div>'
                  : trCandidates.map(c => `
                      <div style="padding:8px;margin-top:4px;border-radius:4px;background:${li.matchedTransferId === c.id ? '#DBEAFE' : '#F8FAFC'};cursor:pointer;border:1px solid ${li.matchedTransferId === c.id ? '#2563EB' : '#E2E8F0'};"
                           onclick="ExpenseReportsModule._toggleMatch(${idx}, 'transfer', '${c.id}')">
                        <div class="text-sm fw-medium">${li.matchedTransferId === c.id ? '✓ ' : ''}${Utils.escapeHtml(c.recipientName || '-')}</div>
                        <div class="text-xs text-muted">${Utils.formatDate(c.transferDate)} · ${Utils.formatCurrency(c.amount)}</div>
                      </div>`).join('')}
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  _toggleMatch(lineIdx, type, candidateId) {
    const li = this._draft.lineItems[lineIdx];
    if (!li) return;
    const key = type === 'deposit' ? 'matchedDepositId' : 'matchedTransferId';
    li[key] = (li[key] === candidateId) ? null : candidateId;
    this._renderMatchSection(); // 재렌더로 ✓ 표시 갱신
  },

  _findDepositCandidates(line, allDeposits) {
    const lineDate = new Date(line.depositDate);
    const cleanName = line.clientName.replace(/주식회사|\(주\)|㈜|입주자대표회의|아파트|회사|시청|\s|\(|\)/g, '');
    return allDeposits.filter(d => {
      // 1) 금액 정확히 일치
      if (Number(d.amount) !== line.depositAmount) return false;
      // 2) 날짜 ±3일
      if (d.depositDate) {
        const diff = Math.abs((new Date(d.depositDate) - lineDate) / 86400000);
        if (diff > 3) return false;
      }
      // 3) 이름 키워드 매칭 (있으면 가산점)
      const depName = (d.depositorName || '').replace(/\s/g, '');
      if (cleanName.length >= 2 && depName.includes(cleanName.slice(0, 2))) return true;
      // 이름 불일치여도 금액+날짜만 맞으면 후보로
      return true;
    }).slice(0, 5);
  },

  _findTransferCandidates(line, allTransfers, vendorName) {
    const cleanVendor = (vendorName || '').replace(/\s|ENG|inc\.?|Inc\.?/gi, '');
    return allTransfers.filter(t => {
      // 1) 금액 정확 일치
      if (Number(t.amount) !== line.transferAmount) return false;
      // 2) 수취인이 vendor 포함 (있으면 가산점)
      const recipient = (t.recipientName || '').replace(/\s/g, '');
      if (cleanVendor.length >= 2 && recipient.includes(cleanVendor.slice(0, 2))) return true;
      return true;
    }).slice(0, 5);
  },

  // ============================================
  // 6) 저장
  // ============================================
  async _save() {
    const d = this._draft;
    if (!d) { Utils.showToast('업로드된 결의서가 없습니다.', 'error'); return; }
    if (!d.reportDate) { Utils.showToast('지출일자를 확인해주세요.', 'error'); return; }

    const user = Auth.currentUser();
    const matchedDepIds = d.lineItems.map(li => li.matchedDepositId).filter(Boolean);
    const matchedTrIds = d.lineItems.map(li => li.matchedTransferId).filter(Boolean);
    const totalMatched = d.lineItems.filter(li => li.matchedDepositId && li.matchedTransferId).length;
    const matchStatus = totalMatched === d.lineItems.length && d.lineItems.length > 0
      ? 'completed'
      : (totalMatched > 0 ? 'partial' : 'pending');

    try {
      // 1) 결의서 본체 저장 (파일 포함 — _toFirestore가 자동으로 _blobs로 분리 저장)
      const reportId = await DB.add(this.COLLECTION, {
        fileName: d.fileName,
        fileSize: d.fileSize,
        fileData: d.file, // Blob — FirebaseDB._toFirestore가 _blobs 로 업로드
        fileType: 'application/pdf',
        reportDate: d.reportDate,
        reportNumber: d.reportNumber || '',
        authorName: d.authorName,
        title: d.title,
        vendorName: d.vendorName,
        vendorRepName: d.vendorRepName,
        vendorAccount: d.vendorAccount,
        totalAmount: d.totalAmount,
        lineItems: d.lineItems,
        matchedDepositIds: matchedDepIds,
        matchedTransferIds: matchedTrIds,
        matchStatus,
        rawText: (d.rawText || '').slice(0, 5000), // 디버깅용 첫 5000자만
        registeredBy: user.id,
        registeredByName: user.displayName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // 2) 매칭된 deposits / transferRecords 에 역참조 저장
      for (const depId of matchedDepIds) {
        try {
          const existing = await DB.get('deposits', depId);
          if (existing) {
            await DB.update('deposits', { ...existing, id: depId, matchedExpenseReportId: reportId });
          }
        } catch (e) { console.warn('[ExpenseReports] deposit 역참조 저장 실패:', depId, e); }
      }
      for (const trId of matchedTrIds) {
        try {
          const existing = await DB.get('transferRecords', trId);
          if (existing) {
            await DB.update('transferRecords', { ...existing, id: trId, matchedExpenseReportId: reportId });
          }
        } catch (e) { console.warn('[ExpenseReports] transfer 역참조 저장 실패:', trId, e); }
      }

      await DB.log('CREATE', 'expenseReport', reportId, `지출결의서: ${d.title || d.fileName}`);

      Utils.showToast(`결의서 저장 완료 (매칭 ${matchStatus === 'completed' ? '완료' : matchStatus === 'partial' ? '부분' : '미완료'})`, 'success', 5000);
      this._draft = null;
      Router.navigate('/expense-reports');
    } catch (e) {
      console.error('[ExpenseReports] 저장 실패:', e);
      Utils.showToast('저장 실패: ' + e.message, 'error', 6000);
    }
  },

  // ============================================
  // 7) 상세 페이지 (저장된 결의서 보기 + PDF 다운로드)
  // ============================================
  async _renderDetailPage(id) {
    const r = await DB.get(this.COLLECTION, id);
    if (!r) {
      this.container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>결의서를 찾을 수 없습니다</h3>
        <button class="btn btn-primary mt-3" onclick="Router.navigate('/expense-reports')">목록으로</button></div>`;
      return;
    }

    const isAdmin = Auth.isAdmin();
    const statusBadge = {
      completed: '<span class="badge badge-complete">매칭완료</span>',
      partial: '<span class="badge badge-review">부분매칭</span>',
      pending: '<span class="badge badge-request">미매칭</span>'
    }[r.matchStatus || 'pending'];

    const linesHtml = (r.lineItems || []).length === 0
      ? '<div class="text-muted text-center" style="padding:var(--sp-3);">라인 아이템 없음</div>'
      : (r.lineItems || []).map((li, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${Utils.escapeHtml(li.clientName)}</td>
            <td class="text-right amount">${Utils.formatCurrency(li.depositAmount)}</td>
            <td>${li.depositDate}</td>
            <td class="text-right amount">${Utils.formatCurrency(li.transferAmount)}</td>
            <td class="text-center">${li.matchedDepositId ? '✅' : '❌'}</td>
            <td class="text-center">${li.matchedTransferId ? '✅' : '❌'}</td>
          </tr>`).join('');

    this.container.innerHTML = `
      <div class="page-header">
        <h2>
          <button class="btn btn-ghost" onclick="Router.navigate('/expense-reports')" style="font-size:0.9rem;">← 목록</button>
          ${Utils.escapeHtml(r.title || r.fileName)} ${statusBadge}
        </h2>
        <div class="page-actions">
          <button class="btn btn-secondary" onclick="ExpenseReportsModule._downloadPdf('${r.id}')">📄 PDF 다운로드</button>
          ${isAdmin ? `<button class="btn btn-ghost text-danger" onclick="ExpenseReportsModule._delete('${r.id}')">🗑️ 삭제</button>` : ''}
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-3);">
            <div><strong>지출일자:</strong> ${r.reportDate}</div>
            <div><strong>작성자:</strong> ${Utils.escapeHtml(r.authorName || '-')}</div>
            <div><strong>총금액:</strong> ${Utils.formatCurrency(r.totalAmount)}</div>
            <div><strong>외주업체:</strong> ${Utils.escapeHtml(r.vendorName || '-')}</div>
            <div><strong>대표자:</strong> ${Utils.escapeHtml(r.vendorRepName || '-')}</div>
            <div><strong>계좌:</strong> ${Utils.escapeHtml(r.vendorAccount || '-')}</div>
          </div>
        </div>
      </div>

      <h3>라인 아이템 (${(r.lineItems || []).length}건)</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr>
            <th>#</th><th>매출처</th><th class="text-right">매출</th><th>입금일</th>
            <th class="text-right">외주송금</th><th class="text-center">매출매칭</th><th class="text-center">송금매칭</th>
          </tr></thead>
          <tbody>${linesHtml}</tbody>
        </table>
      </div>
    `;
  },

  async _downloadPdf(id) {
    try {
      const r = await DB.get(this.COLLECTION, id);
      if (!r) { Utils.showToast('결의서 없음', 'error'); return; }
      const blob = await FirebaseDB.resolveBlob(r.fileData, 'application/pdf');
      if (!blob) { Utils.showToast('파일 데이터 없음', 'error'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.fileName || `expense-report-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('[ExpenseReports] PDF 다운로드 실패:', e);
      Utils.showToast('다운로드 실패: ' + e.message, 'error');
    }
  },

  async _delete(id) {
    if (!window.confirm('이 결의서를 삭제하시겠습니까? 매칭된 입금/송금의 역참조도 함께 해제됩니다.')) return;
    try {
      const r = await DB.get(this.COLLECTION, id);
      if (r) {
        for (const depId of (r.matchedDepositIds || [])) {
          try {
            const ex = await DB.get('deposits', depId);
            if (ex && ex.matchedExpenseReportId === id) {
              await DB.update('deposits', { ...ex, id: depId, matchedExpenseReportId: null });
            }
          } catch {}
        }
        for (const trId of (r.matchedTransferIds || [])) {
          try {
            const ex = await DB.get('transferRecords', trId);
            if (ex && ex.matchedExpenseReportId === id) {
              await DB.update('transferRecords', { ...ex, id: trId, matchedExpenseReportId: null });
            }
          } catch {}
        }
      }
      await DB.delete(this.COLLECTION, id);
      await DB.log('DELETE', 'expenseReport', id, '지출결의서 삭제');
      Utils.showToast('삭제 완료', 'success');
      Router.navigate('/expense-reports');
    } catch (e) {
      console.error('[ExpenseReports] 삭제 실패:', e);
      Utils.showToast('삭제 실패: ' + e.message, 'error');
    }
  },

  destroy() { this._draft = null; }
};

window.ExpenseReportsModule = ExpenseReportsModule;
