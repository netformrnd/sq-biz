/* ============================================
   업무 체크리스트 모듈
   - 일별/월별/반기별/연간 업무 목록
   - 체크, 추가, 수정, 삭제 가능 (관리자)
   ============================================ */

const ChecklistModule = {
  container: null,
  currentPeriod: 'daily', // daily | monthly | halfyear | yearly

  // 기본 체크리스트 (일반 회사 업무 기준)
  DEFAULT_ITEMS: {
    daily: [
      { title: '전일 통장 입출금 내역 확인', desc: '주거래은행 거래내역 확인 및 기록' },
      { title: '입금/출금 내역 시스템 입력', desc: '업무관리 시스템에 당일 입출금 등록' },
      { title: '세금계산서 발행 요청 확인', desc: '접수된 발행 요청 검토 및 처리' },
      { title: '일일 자금일보 작성', desc: '당일 자금 현황 마감' },
      { title: '미결재 결재 서류 확인', desc: '결재 대기 중인 서류 처리' },
    ],
    monthly: [
      { title: '급여 지급 (매월 10일경)', desc: '급여 이체 및 명세서 발송' },
      { title: '4대보험 신고/납부 (매월 10일)', desc: '국민연금, 건강보험, 고용보험, 산재보험' },
      { title: '원천세 신고/납부 (매월 10일)', desc: '전월 원천징수 내역 신고' },
      { title: '부가세 예정신고 (1월, 7월)', desc: '분기 부가가치세 신고' },
      { title: '세금계산서 월말 마감', desc: '월별 매출/매입 세금계산서 정리' },
      { title: '법인카드 사용내역 정산', desc: '카드사 명세서 대조 및 정산' },
      { title: '임대료/관리비 납부', desc: '사무실 임대료, 관리비 처리' },
      { title: '거래처 월 정산 및 대사', desc: '주요 거래처 미수금/미지급금 확인' },
      { title: '월별 결산 자료 작성', desc: '월말 가결산 및 경영 보고' },
    ],
    halfyear: [
      { title: '부가세 확정신고 (1월, 7월)', desc: '상반기/하반기 부가세 확정' },
      { title: '반기 결산 및 재무제표 작성', desc: '반기별 경영 성과 정리' },
      { title: '임직원 건강검진 (연 1회, 법정)', desc: '대상자 파악 및 예약' },
      { title: '반기 업무 실적 평가', desc: '부서별/개인별 성과 평가' },
      { title: '근로계약서 갱신/재계약 (해당자)', desc: '계약 만료자 확인 및 갱신' },
    ],
    yearly: [
      { title: '법인세 신고/납부 (3월)', desc: '전년도 법인세 확정신고' },
      { title: '연말정산 (1~2월)', desc: '직원 연말정산 서류 수집 및 처리' },
      { title: '지급명세서 제출 (3월)', desc: '전년도 근로소득 지급명세서' },
      { title: '사업자현황신고 (2월)', desc: '면세사업자 수입금액 신고' },
      { title: '산재보험 개산/확정보험료 (3월)', desc: '전년 확정 + 당해 개산 보험료' },
      { title: '연차휴가 정산 및 부여', desc: '근속에 따른 연차 산정' },
      { title: '4대보험 보수총액신고 (3월)', desc: '전년도 보수총액 신고' },
      { title: '정관 변경 등기 (필요시)', desc: '본사 주소, 임원, 자본금 변경 등' },
      { title: '연간 경영 목표 수립', desc: '연간 사업 계획 및 예산 편성' },
      { title: '사업자등록증 최신화 확인', desc: '주소/대표자 변경사항 반영' },
    ],
  },

  async init(container) {
    this.container = container;
    await this.render();
  },

  async render() {
    const isAdmin = Auth.isAdmin();
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const today = Utils.today();

    // 모든 체크리스트 항목 로드
    let items = await DB.getAll('checklists');

    // 항목이 전혀 없으면 기본값 삽입
    if (items.length === 0 && isAdmin) {
      await this._initDefaults();
      items = await DB.getAll('checklists');
    }

    // 현재 탭 필터
    const filtered = items.filter(i => i.period === this.currentPeriod);

    // 당기 체크 상태 키 (일/월/반기/년별로 다름)
    const periodKey = this._getPeriodKey(this.currentPeriod, year, month);

    // 카운트
    const totalCount = filtered.length;
    const doneCount = filtered.filter(i => (i.completions || {})[periodKey]).length;
    const progress = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;

    let itemsHtml = '';
    if (filtered.length === 0) {
      itemsHtml = `<div class="empty-state" style="padding:var(--sp-10);">
        <div class="empty-icon">✅</div>
        <h3>등록된 체크리스트 항목이 없습니다</h3>
        ${isAdmin ? '<p class="text-sm text-muted">아래 "+ 항목 추가" 버튼으로 업무를 등록하세요.</p>' : ''}
      </div>`;
    } else {
      itemsHtml = filtered
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(item => {
          const checked = (item.completions || {})[periodKey];
          const checkedAt = checked ? (item.completions[periodKey + '_at'] || '') : '';
          const checkedBy = checked ? (item.completions[periodKey + '_by'] || '') : '';
          return `
            <div class="checklist-item" style="display:flex;align-items:flex-start;gap:var(--sp-3);padding:var(--sp-4);border:1px solid var(--color-border);border-radius:var(--radius-sm);margin-bottom:var(--sp-2);background:${checked ? 'var(--color-success-light)' : 'var(--color-surface)'};transition:all 0.2s;">
              <input type="checkbox" ${checked ? 'checked' : ''}
                     style="width:20px;height:20px;cursor:pointer;margin-top:2px;"
                     onchange="ChecklistModule._toggleCheck('${item.id}', ${!checked})">
              <div style="flex:1;">
                <div class="fw-medium ${checked ? 'text-muted' : ''}" style="${checked ? 'text-decoration:line-through;' : ''}">
                  ${Utils.escapeHtml(item.title)}
                </div>
                ${item.desc ? `<div class="text-xs text-muted mt-2">${Utils.escapeHtml(item.desc)}</div>` : ''}
                ${checked && checkedAt ? `<div class="text-xs" style="color:var(--color-success);margin-top:4px;">✓ ${Utils.formatDateTime(checkedAt)} · ${Utils.escapeHtml(checkedBy)}</div>` : ''}
              </div>
              ${isAdmin ? `
                <div class="d-flex gap-2">
                  <button class="btn btn-ghost btn-sm" onclick="ChecklistModule._editItem('${item.id}')" title="수정">✏️</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="ChecklistModule._deleteItem('${item.id}')" title="삭제">🗑️</button>
                </div>
              ` : ''}
            </div>
          `;
        }).join('');
    }

    const periodLabel = {
      daily: `오늘 (${Utils.formatDate(today)})`,
      monthly: `${year}년 ${month}월`,
      halfyear: `${year}년 ${month <= 6 ? '상반기' : '하반기'}`,
      yearly: `${year}년`,
    }[this.currentPeriod];

    this.container.innerHTML = `
      <div class="page-header">
        <h2>업무 체크리스트</h2>
        ${isAdmin ? `
          <div class="page-actions">
            <button class="btn btn-secondary" onclick="ChecklistModule._resetDefaults()" title="기본 항목으로 초기화">🔄 기본값 리셋</button>
            <button class="btn btn-primary" onclick="ChecklistModule._openAddModal()">+ 항목 추가</button>
          </div>
        ` : ''}
      </div>

      <!-- 탭 -->
      <div class="tabs">
        <div class="tab-item ${this.currentPeriod === 'daily' ? 'active' : ''}" onclick="ChecklistModule._setPeriod('daily')">📅 일별</div>
        <div class="tab-item ${this.currentPeriod === 'monthly' ? 'active' : ''}" onclick="ChecklistModule._setPeriod('monthly')">🗓️ 월별</div>
        <div class="tab-item ${this.currentPeriod === 'halfyear' ? 'active' : ''}" onclick="ChecklistModule._setPeriod('halfyear')">📆 반기별</div>
        <div class="tab-item ${this.currentPeriod === 'yearly' ? 'active' : ''}" onclick="ChecklistModule._setPeriod('yearly')">🎯 연간</div>
      </div>

      <!-- 진행률 -->
      <div class="card mb-4">
        <div class="card-body">
          <div class="d-flex justify-between items-center mb-2">
            <div>
              <div class="fw-semibold">${periodLabel}</div>
              <div class="text-sm text-muted">${doneCount} / ${totalCount} 완료</div>
            </div>
            <div class="fw-bold" style="font-size:var(--font-size-xl);color:${progress === 100 ? 'var(--color-success)' : 'var(--color-primary)'};">
              ${progress}%
            </div>
          </div>
          <div class="progress-bar" style="margin:0;">
            <div class="progress-fill" style="width:${progress}%;background:${progress === 100 ? 'var(--color-success)' : 'var(--color-primary)'};"></div>
          </div>
        </div>
      </div>

      <!-- 항목 목록 -->
      <div>${itemsHtml}</div>
    `;
  },

  _setPeriod(period) {
    this.currentPeriod = period;
    this.render();
  },

  // 기간 키 생성 (일/월/반기/년 단위)
  _getPeriodKey(period, year, month) {
    if (period === 'daily') {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (period === 'monthly') return `${year}-${String(month).padStart(2, '0')}`;
    if (period === 'halfyear') return `${year}-H${month <= 6 ? 1 : 2}`;
    if (period === 'yearly') return `${year}`;
    return '';
  },

  // 기본값 초기 삽입
  async _initDefaults() {
    const user = Auth.currentUser();
    let order = 0;
    for (const [period, items] of Object.entries(this.DEFAULT_ITEMS)) {
      for (const item of items) {
        await DB.add('checklists', {
          period,
          title: item.title,
          desc: item.desc,
          order: order++,
          completions: {},
          createdBy: user.id,
          createdByName: user.displayName,
          createdAt: new Date().toISOString()
        });
      }
    }
  },

  async _resetDefaults() {
    const confirmed = await Utils.confirm(
      '⚠️ 모든 체크리스트 항목과 체크 이력이 삭제됩니다.\n기본 업무 목록으로 재설정하시겠습니까?',
      '체크리스트 초기화'
    );
    if (!confirmed) return;

    const all = await DB.getAll('checklists');
    for (const item of all) {
      await DB.delete('checklists', item.id);
    }
    await this._initDefaults();
    Utils.showToast('기본 체크리스트로 초기화되었습니다.', 'success');
    await this.render();
  },

  async _toggleCheck(id, checked) {
    const item = await DB.get('checklists', id);
    if (!item) return;

    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const key = this._getPeriodKey(item.period, year, month);

    if (!item.completions) item.completions = {};

    if (checked) {
      const user = Auth.currentUser();
      item.completions[key] = true;
      item.completions[key + '_at'] = new Date().toISOString();
      item.completions[key + '_by'] = user.displayName;
    } else {
      delete item.completions[key];
      delete item.completions[key + '_at'];
      delete item.completions[key + '_by'];
    }

    await DB.update('checklists', item);
    await this.render();
  },

  _openAddModal(editData = null) {
    const isEdit = !!editData;
    Utils.openModal(`
      <div class="modal-header">
        <h3>${isEdit ? '체크리스트 항목 수정' : '체크리스트 항목 추가'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="clPeriod">주기 <span class="required">*</span></label>
          <select id="clPeriod" class="form-control" required>
            <option value="daily" ${editData && editData.period === 'daily' ? 'selected' : (this.currentPeriod === 'daily' ? 'selected' : '')}>일별</option>
            <option value="monthly" ${editData && editData.period === 'monthly' ? 'selected' : (this.currentPeriod === 'monthly' ? 'selected' : '')}>월별</option>
            <option value="halfyear" ${editData && editData.period === 'halfyear' ? 'selected' : (this.currentPeriod === 'halfyear' ? 'selected' : '')}>반기별</option>
            <option value="yearly" ${editData && editData.period === 'yearly' ? 'selected' : (this.currentPeriod === 'yearly' ? 'selected' : '')}>연간</option>
          </select>
        </div>
        <div class="form-group">
          <label for="clTitle">업무 제목 <span class="required">*</span></label>
          <input type="text" id="clTitle" class="form-control" placeholder="예: 부가세 신고" value="${editData ? Utils.escapeHtml(editData.title) : ''}" required>
        </div>
        <div class="form-group">
          <label for="clDesc">설명</label>
          <textarea id="clDesc" class="form-control" rows="2" placeholder="업무 상세 설명 (선택)">${editData ? Utils.escapeHtml(editData.desc || '') : ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="ChecklistModule._saveItem(${isEdit ? `'${editData.id}'` : 'null'})">${isEdit ? '수정' : '추가'}</button>
      </div>
    `);
  },

  async _saveItem(editId) {
    const period = document.getElementById('clPeriod').value;
    const title = document.getElementById('clTitle').value.trim();
    const desc = document.getElementById('clDesc').value.trim();
    if (!title) { Utils.showToast('업무 제목을 입력하세요.', 'error'); return; }

    const user = Auth.currentUser();
    if (editId) {
      const item = await DB.get('checklists', editId);
      item.period = period;
      item.title = title;
      item.desc = desc;
      item.updatedAt = new Date().toISOString();
      await DB.update('checklists', item);
    } else {
      const existing = await DB.getAll('checklists');
      const maxOrder = Math.max(0, ...existing.map(i => i.order || 0));
      await DB.add('checklists', {
        period, title, desc,
        order: maxOrder + 1,
        completions: {},
        createdBy: user.id,
        createdByName: user.displayName,
        createdAt: new Date().toISOString()
      });
    }
    Utils.closeModal();
    await this.render();
  },

  async _editItem(id) {
    const item = await DB.get('checklists', id);
    if (item) this._openAddModal(item);
  },

  async _deleteItem(id) {
    const confirmed = await Utils.confirm('이 항목을 삭제하시겠습니까?\n체크 이력도 모두 함께 삭제됩니다.', '항목 삭제');
    if (!confirmed) return;
    await DB.delete('checklists', id);
    await this.render();
  },

  destroy() {}
};

window.ChecklistModule = ChecklistModule;
