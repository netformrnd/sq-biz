/* ============================================
   사용가이드 모듈
   - 시스템 내장 운영 매뉴얼 + 보고 체계 안내
   - 사이드바 메뉴 (전체 가이드) + 페이지별 도움말 모달
   - PDF 인쇄(브라우저 인쇄) 지원
   ============================================ */

const UserGuideModule = {
  container: null,

  // 가이드 컨텐츠 정의 (모듈별)
  GUIDES: {
    outsourcing: {
      icon: '📒',
      title: '프로젝트 정산관리',
      sections: [
        {
          heading: '[1] 신규 외주 발생 시 (등록)',
          body: `
            <ol>
              <li>사이드바 → <strong>프로젝트 관리 → 프로젝트 정산관리</strong></li>
              <li>우측 상단 <strong>[+ 프로젝트 등록]</strong> 클릭</li>
              <li>입력 항목:
                <ul>
                  <li><strong>프로젝트명</strong> = 건축주명 + 업무명 (예: "윤태욱 인허가")</li>
                  <li><strong>발주처</strong> = 건축주명</li>
                  <li><strong>외주업체</strong> = 외주받는 업체 (예: 대림건축(홍정란))</li>
                  <li><strong>계약일 / 입금금액</strong> (숫자만, 쉼표 X)</li>
                  <li><strong>진행상태</strong> = 진행중</li>
                </ul>
              </li>
              <li><strong>[등록]</strong> 클릭</li>
            </ol>
            <p class="tip">💡 같은 건축주에서 여러 건이면 구분자 추가 (예: "윤태욱 - 2026-02 #1")</p>
          `
        },
        {
          heading: '[2] 외주 송금 시 (외주업체에 돈 보낼 때)',
          body: `
            <ol>
              <li>사이드바 → <strong>재무 → 송금내역</strong></li>
              <li>우측 상단 <strong>[+ 개별 등록]</strong> 클릭</li>
              <li>입력 항목:
                <ul>
                  <li>송금일 / 수취인 / 금액</li>
                  <li>용도 = <strong>용역비</strong></li>
                  <li><strong>프로젝트</strong> = 프로젝트 정산관리의 프로젝트명과 <strong style="color:#dc2626;">정확히 동일하게</strong> 입력</li>
                </ul>
              </li>
              <li><strong>[등록]</strong> 클릭</li>
            </ol>
            <p class="warn">⚠️ 한 번에 여러 외주 합쳐서 송금한 경우 → 각 프로젝트별로 개별 송금 등록 (분할)</p>
          `
        },
        {
          heading: '[3] 정산 완료 시',
          body: `
            <ol>
              <li>프로젝트 정산관리 → 해당 프로젝트 클릭</li>
              <li>✏️ 수정 → <strong>진행상태: "완료"</strong> 변경</li>
              <li>비고에 정산 완료일 메모</li>
              <li>저장</li>
            </ol>
            <p class="tip">→ 잔액이 0원 또는 의도한 차액과 일치하는지 확인</p>
          `
        },
        {
          heading: '[4] 매월 점검 (월말 루틴)',
          body: `
            <ol>
              <li>프로젝트 정산관리 페이지</li>
              <li>상단 카드 확인: <strong>총 매출금액 / 총 집행금액 / 총 잔액</strong></li>
              <li>카드 클릭 필터 활용:
                <ul>
                  <li>[총 집행금액] → 집행(외주지급) 있는 건만</li>
                  <li>[총 잔액] → 잔액 있는 건 (미정산)</li>
                </ul>
              </li>
              <li>이상 발견 시 → 외주 담당자 협의</li>
            </ol>
          `
        },
        {
          heading: '[5] 자주 발생하는 상황별 대처',
          body: `
            <dl>
              <dt>🔹 "집행금액이 0원으로 나옴"</dt>
              <dd>송금내역과 프로젝트 정산관리의 프로젝트명이 정확히 일치 안 함<br>
              → 프로젝트 정산관리의 프로젝트명 복사 → 송금내역에 붙여넣기</dd>

              <dt>🔹 "같은 날 여러 외주 합쳐서 송금"</dt>
              <dd>송금내역에서 각 프로젝트별로 분할 등록</dd>

              <dt>🔹 "명세서·자료 정보가 모호함"</dt>
              <dd>임시로 등록 후 비고에 "[확인 필요]" 메모 → 담당자와 협의 후 정리</dd>

              <dt>🔹 "엑셀로 한 번에 여러 건 등록"</dt>
              <dd>프로젝트 정산관리 [📥 엑셀 양식 다운로드] → 양식 채워서 [📤 엑셀 일괄 업로드]</dd>
            </dl>
          `
        }
      ]
    },

    contracts: {
      icon: '📋',
      title: '계약 수금 관리',
      sections: [
        {
          heading: '[1] 신규 계약 등록',
          body: `
            <ol>
              <li>사이드바 → <strong>프로젝트 관리 → 계약 수금 관리</strong></li>
              <li>우측 상단 <strong>[+ 계약 등록]</strong> 클릭</li>
              <li>입력 항목:
                <ul>
                  <li><strong>단지명</strong> (예: 인천 송도캐슬해모로아파트)</li>
                  <li><strong>계약건명</strong> (예: 공용계단 누수 보수공사)</li>
                  <li>현장소재지 / 발주처 / 계약일</li>
                  <li><strong>총 계약금액</strong></li>
                  <li><strong>계약금 / 중도금 / 잔금</strong> 각각 금액 입력 (사용 안 하면 0)</li>
                </ul>
              </li>
            </ol>
            <p class="tip">💡 결제단계별로 세금계산서 연결하면 발급일·입금일이 자동 표시됩니다.</p>
          `
        },
        {
          heading: '[2] 세금계산서 발행 시 자동 연동',
          body: `
            <ol>
              <li>사이드바 → <strong>세금계산서 → 발행 요청</strong></li>
              <li>발행 요청 양식 작성 중 <strong>"📋 계약 연결"</strong> 섹션에서:
                <ul>
                  <li><strong>신규 계약</strong> 선택 → 단지명/계약건명/총계약금액/단계 입력</li>
                  <li><strong>기존 계약</strong> 선택 → 드롭다운에서 선택 + 단계 선택</li>
                </ul>
              </li>
              <li>등록 → <strong>계약 수금 관리에 자동 반영</strong></li>
            </ol>
          `
        },
        {
          heading: '[3] 입금 매칭 자동',
          body: `
            <ol>
              <li>통장 데이터 업로드 → 입금내역에 자동 등록</li>
              <li>입금내역에서 해당 입금을 세금계산서와 매칭</li>
              <li>매칭되면 → 계약 수금 관리에 <strong>입금일 자동 표시 ✅</strong></li>
            </ol>
            <p class="tip">→ 계약 → 세금계산서 → 입금내역이 연결되어 진행 상황을 한눈에 확인 가능</p>
          `
        },
        {
          heading: '[4] 미수금 확인',
          body: `
            <ol>
              <li>계약 수금 관리 페이지</li>
              <li>상단 카드 중 <strong>[⚠️ 총 미수금]</strong> 클릭</li>
              <li>→ 미수금 발생 계약만 표시</li>
              <li>각 계약 클릭 → 어느 단계에서 미수금인지 확인</li>
            </ol>
          `
        }
      ]
    },

    transfers: {
      icon: '💸',
      title: '송금내역 (외주지급 등)',
      sections: [
        {
          heading: '[1] 송금 등록',
          body: `
            <ol>
              <li>사이드바 → <strong>재무 → 송금내역</strong></li>
              <li>우측 상단 <strong>[+ 개별 등록]</strong> 클릭</li>
              <li>입력 항목:
                <ul>
                  <li>송금일 / 수취인 / 금액</li>
                  <li>용도 (용역비, 외주비 등)</li>
                  <li><strong>프로젝트명</strong> (프로젝트 정산관리 매칭용 — 정확히 동일하게 입력)</li>
                </ul>
              </li>
            </ol>
          `
        },
        {
          heading: '[2] 프로젝트 정산관리와 자동 매칭',
          body: `
            <p>송금의 <strong>프로젝트명</strong>이 프로젝트 정산관리의 프로젝트명과 정확히 일치하면:</p>
            <ul>
              <li>프로젝트 정산관리의 <strong>"집행금액"</strong>이 자동 합산</li>
              <li>잔액 (입금 - 지급) 자동 계산</li>
            </ul>
            <p class="warn">⚠️ 한 글자라도 다르면 매칭 안 됨. 띄어쓰기·괄호 주의.</p>
          `
        }
      ]
    },

    taxInvoice: {
      icon: '🧾',
      title: '세금계산서 발행 요청',
      sections: [
        {
          heading: '[1] 발행 요청',
          body: `
            <ol>
              <li>사이드바 → <strong>세금계산서 → 발행 요청</strong></li>
              <li>입력 항목:
                <ul>
                  <li>발행 사유 / 공급가액 (자동으로 세액·합계 계산)</li>
                  <li>프로젝트명</li>
                  <li><strong>📋 계약 연결</strong> (선택): 신규/기존 계약 선택 → 자동으로 계약 수금 관리에 반영</li>
                  <li>사업자등록증 첨부 (Ctrl+V로 화면캡쳐 붙여넣기 → OCR 자동 인식)</li>
                  <li>거래처 정보 (OCR이 자동 입력)</li>
                </ul>
              </li>
              <li>[발행 요청하기] → 관리자 검토 → 발행 완료</li>
            </ol>
          `
        },
        {
          heading: '[2] 첨부파일 용량 제한',
          body: `
            <p><strong>한 파일당 최대 700KB</strong>까지 업로드 가능합니다.</p>
            <ul>
              <li>사업자등록증 화면캡쳐: 보통 100~300KB → 안전</li>
              <li>계약서 PDF가 큰 경우 → 압축 후 첨부 (또는 첨부 생략)</li>
            </ul>
          `
        }
      ]
    },

    reporting: {
      icon: '📊',
      title: '관리·보고 체계',
      sections: [
        {
          heading: '[1] 정기 보고',
          body: `
            <h4>▣ 월간 보고 (매월 말일)</h4>
            <ul>
              <li><strong>항목</strong>: 프로젝트 진행 현황, 신규 등록 건, 정산 완료 건, 미수금 발생, 총 매출/집행/잔액</li>
              <li><strong>형식</strong>: 시스템 화면 캡쳐 + 1페이지 요약</li>
              <li><strong>대상</strong>: 대표님 (잔디 또는 대면)</li>
              <li><strong>책임자</strong>: 관리자</li>
              <li><strong>일정</strong>: 매월 말일~다음 달 3일</li>
            </ul>

            <h4>▣ 분기 보고 (3·6·9·12월 말)</h4>
            <ul>
              <li><strong>항목</strong>: 분기별 외주업체별 정산 종합, 신규/완료/장기 진행 현황, 다음 분기 전망</li>
              <li><strong>형식</strong>: 엑셀 또는 PDF 1~2장</li>
              <li><strong>대상</strong>: 대표님 + 외주 담당 이사</li>
            </ul>
          `
        },
        {
          heading: '[2] 수시 보고 (이슈 발생 시)',
          body: `
            <h4>▣ 미수금 임박 알림</h4>
            <ul>
              <li>조건: 정산 예정일 1주 이내 미입금</li>
              <li>형식: 잔디 메시지</li>
              <li>대상: 외주 담당 이사 → (필요 시) 대표님</li>
            </ul>

            <h4>▣ 이상 거래 발생</h4>
            <ul>
              <li>조건: 입금/지급 불일치, 명세서 오류 등</li>
              <li>형식: 즉시 잔디 메시지 + 자료 첨부</li>
            </ul>
          `
        },
        {
          heading: '[3] 책임자 정의',
          body: `
            <table class="guide-table">
              <thead>
                <tr><th>업무</th><th>책임자</th></tr>
              </thead>
              <tbody>
                <tr><td>명세서 받아 시스템 등록</td><td>관리자 (최영옥)</td></tr>
                <tr><td>외주 진행 내용 확인</td><td>외주 담당 이사 (조현식)</td></tr>
                <tr><td>정산 처리</td><td>관리자 (이사 협조)</td></tr>
                <tr><td>월간 보고</td><td>관리자 → 대표님</td></tr>
                <tr><td>분기 보고</td><td>관리자 (이사 협업) → 대표님</td></tr>
                <tr><td>시스템 권한 관리</td><td>관리자</td></tr>
              </tbody>
            </table>
          `
        },
        {
          heading: '[4] 월간 운영 일정 (제안)',
          body: `
            <table class="guide-table">
              <thead>
                <tr><th>일정</th><th>내용</th></tr>
              </thead>
              <tbody>
                <tr><td>매월 1~25일</td><td>신규 외주 발생 시 즉시 시스템 등록</td></tr>
                <tr><td>매월 25일</td><td>그 달 미등록 분 마감 정리</td></tr>
                <tr><td>매월 26~30일</td><td>월간 점검 + 보고 자료 작성</td></tr>
                <tr><td>매월 1~3일</td><td>대표님 월간 보고 발송</td></tr>
                <tr><td>분기 마지막 주</td><td>분기 종합 보고 준비</td></tr>
              </tbody>
            </table>
          `
        }
      ]
    }
  },

  // 사이드바 메뉴 클릭 시 전체 가이드 표시
  async init(container, action) {
    this.container = container;
    // hash 의 ?focus=xxx 파라미터에서 특정 섹션으로 스크롤할 키 추출
    let focusKey = action || null;
    if (!focusKey) {
      const hash = window.location.hash || '';
      const qIdx = hash.indexOf('?');
      if (qIdx > -1) {
        try {
          const params = new URLSearchParams(hash.slice(qIdx + 1));
          focusKey = params.get('focus');
        } catch {}
      }
    }
    this.render(focusKey);
  },

  render(focusKey) {
    const sectionHtml = Object.entries(this.GUIDES).map(([key, g]) => `
      <section id="guide-${key}" class="guide-section">
        <h2 style="display:flex;align-items:center;gap:var(--sp-2);border-bottom:2px solid var(--color-primary);padding-bottom:var(--sp-2);">
          <span style="font-size:24px;">${g.icon}</span>
          <span>${g.title}</span>
        </h2>
        ${g.sections.map(s => `
          <div class="guide-item" style="margin:var(--sp-4) 0;">
            <h3 style="color:var(--color-primary);margin-bottom:var(--sp-2);">${s.heading}</h3>
            <div class="guide-body">${s.body}</div>
          </div>
        `).join('')}
      </section>
    `).join('<hr style="margin:var(--sp-6) 0;border:none;border-top:1px solid var(--color-border);">');

    // 목차: SPA 라우터 충돌 방지를 위해 onclick 으로 직접 스크롤
    const tocHtml = Object.entries(this.GUIDES).map(([key, g]) =>
      `<button type="button" onclick="UserGuideModule._scrollTo('${key}')" style="display:inline-block;padding:var(--sp-2) var(--sp-3);background:var(--color-bg-light);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);margin:2px;cursor:pointer;font:inherit;">${g.icon} ${g.title}</button>`
    ).join('');

    this.container.innerHTML = `
      <style>
        /* 인쇄 시 사이드바·헤더 완전 숨김 + 레이아웃 단일 컬럼 강제 */
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .no-print, .app-sidebar, .app-header, header, nav { display: none !important; }
          .app-shell { display: block !important; grid-template-columns: 1fr !important; grid-template-rows: auto !important; }
          .app-content { padding: 0 !important; margin: 0 !important; grid-column: 1 / -1 !important; grid-row: 1 / -1 !important; }
          .content-wrapper { padding: 0 !important; margin: 0 !important; max-width: none !important; }
          .guide-section { page-break-inside: avoid; }
          .guide-section + .guide-section { page-break-before: auto; }
          .card { box-shadow: none !important; border: none !important; padding: 0 !important; }
          h2, h3 { page-break-after: avoid; }
          a[href], button { text-decoration: none !important; color: inherit !important; }
        }
        .guide-body ul, .guide-body ol { margin: var(--sp-2) 0; padding-left: var(--sp-5); }
        .guide-body li { margin: var(--sp-1) 0; line-height: 1.6; }
        .guide-body dt { font-weight: 600; margin-top: var(--sp-2); }
        .guide-body dd { margin-left: var(--sp-4); margin-bottom: var(--sp-2); color: var(--color-text-muted); }
        .guide-body .tip { background: #EFF6FF; border-left: 3px solid #3B82F6; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); margin: var(--sp-2) 0; font-size: var(--font-size-sm); }
        .guide-body .warn { background: #FEF3C7; border-left: 3px solid #F59E0B; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); margin: var(--sp-2) 0; font-size: var(--font-size-sm); }
        .guide-body h4 { margin-top: var(--sp-3); color: var(--color-text); }
        .guide-table { width: 100%; border-collapse: collapse; margin: var(--sp-2) 0; }
        .guide-table th, .guide-table td { border: 1px solid var(--color-border); padding: var(--sp-2); text-align: left; }
        .guide-table th { background: var(--color-bg-light); font-weight: 600; }
      </style>

      <div class="page-header no-print">
        <h2>📖 사용가이드</h2>
        <div class="page-actions">
          <button class="btn btn-secondary" onclick="window.print()">🖨️ 인쇄/PDF 저장</button>
        </div>
      </div>

      <div class="card no-print" style="padding:var(--sp-3);margin-bottom:var(--sp-4);">
        <div style="font-size:var(--font-size-sm);color:var(--color-text-muted);margin-bottom:var(--sp-2);">📑 목차</div>
        <div>${tocHtml}</div>
      </div>

      <div class="card" style="padding:var(--sp-5);">
        ${sectionHtml}
      </div>

      <div class="no-print" style="margin-top:var(--sp-4);padding:var(--sp-3);background:var(--color-bg-light);border-radius:var(--radius-sm);font-size:var(--font-size-sm);color:var(--color-text-muted);">
        💡 <strong>도움말</strong>: 각 페이지(프로젝트 정산관리, 계약 수금 관리 등)에서 우측 상단 <strong>[📖 도움말]</strong> 버튼을 클릭하면 해당 페이지 전용 가이드만 빠르게 볼 수 있습니다.
      </div>
    `;

    // action에 키가 지정되면 해당 섹션으로 스크롤
    if (focusKey && this.GUIDES[focusKey]) {
      setTimeout(() => {
        const el = document.getElementById(`guide-${focusKey}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  },

  // 목차 클릭 → 해당 섹션 스크롤
  _scrollTo(key) {
    const el = document.getElementById(`guide-${key}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  // 페이지별 도움말 모달 (각 관리대장 페이지의 [📖 도움말] 버튼에서 호출)
  showModal(key) {
    const g = this.GUIDES[key];
    if (!g) return;
    const body = g.sections.map(s => `
      <div style="margin-bottom:var(--sp-4);">
        <h4 style="color:var(--color-primary);margin-bottom:var(--sp-2);">${s.heading}</h4>
        <div class="guide-body">${s.body}</div>
      </div>
    `).join('');

    Utils.openModal(`
      <style>
        .guide-body ul, .guide-body ol { margin: var(--sp-2) 0; padding-left: var(--sp-5); }
        .guide-body li { margin: var(--sp-1) 0; line-height: 1.6; }
        .guide-body dt { font-weight: 600; margin-top: var(--sp-2); }
        .guide-body dd { margin-left: var(--sp-4); margin-bottom: var(--sp-2); color: var(--color-text-muted); }
        .guide-body .tip { background: #EFF6FF; border-left: 3px solid #3B82F6; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); margin: var(--sp-2) 0; font-size: var(--font-size-sm); }
        .guide-body .warn { background: #FEF3C7; border-left: 3px solid #F59E0B; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); margin: var(--sp-2) 0; font-size: var(--font-size-sm); }
        .guide-body h4 { margin-top: var(--sp-3); }
      </style>
      <div class="modal-header">
        <h3>${g.icon} ${g.title} — 사용가이드</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:70vh;overflow-y:auto;">
        ${body}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
        <button class="btn btn-primary" onclick="Utils.closeModal(); Router.navigate('/user-guide?focus=${key}')">📖 전체 가이드 보기</button>
      </div>
    `, { size: 'modal-lg' });
  }
};

window.UserGuideModule = UserGuideModule;
