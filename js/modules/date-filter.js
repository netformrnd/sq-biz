/* ============================================
   날짜 기간 필터 공통 컴포넌트
   ============================================ */

const DateFilter = {
  // 현재 활성 필터 저장 (라우트별)
  _filters: {},

  // 필터 HTML 생성
  render(id, onChange) {
    const filter = this._filters[id] || { preset: 'all', start: '', end: '' };
    return `
      <div class="filter-bar" style="background:var(--color-surface);padding:var(--sp-3);border-radius:var(--radius-sm);border:1px solid var(--color-border);">
        <div class="d-flex gap-2" style="flex-wrap:wrap;">
          <button class="btn btn-sm ${filter.preset === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="DateFilter._set('${id}', 'all')">전체</button>
          <button class="btn btn-sm ${filter.preset === 'thisMonth' ? 'btn-primary' : 'btn-secondary'}" onclick="DateFilter._set('${id}', 'thisMonth')">이번달</button>
          <button class="btn btn-sm ${filter.preset === 'lastMonth' ? 'btn-primary' : 'btn-secondary'}" onclick="DateFilter._set('${id}', 'lastMonth')">지난달</button>
          <button class="btn btn-sm ${filter.preset === 'last3' ? 'btn-primary' : 'btn-secondary'}" onclick="DateFilter._set('${id}', 'last3')">최근3개월</button>
          <button class="btn btn-sm ${filter.preset === 'thisYear' ? 'btn-primary' : 'btn-secondary'}" onclick="DateFilter._set('${id}', 'thisYear')">올해</button>
          <button class="btn btn-sm ${filter.preset === 'lastYear' ? 'btn-primary' : 'btn-secondary'}" onclick="DateFilter._set('${id}', 'lastYear')">작년</button>
          <span class="text-xs text-muted" style="align-self:center;">|</span>
          <input type="date" id="${id}_start" class="form-control" style="width:140px;padding:var(--sp-1) var(--sp-2);font-size:var(--font-size-xs);" value="${filter.start}" onchange="DateFilter._setCustom('${id}')">
          <span class="text-xs text-muted" style="align-self:center;">~</span>
          <input type="date" id="${id}_end" class="form-control" style="width:140px;padding:var(--sp-1) var(--sp-2);font-size:var(--font-size-xs);" value="${filter.end}" onchange="DateFilter._setCustom('${id}')">
        </div>
      </div>
    `;
  },

  // 필터 설정 및 콜백 실행
  _set(id, preset) {
    const now = new Date();
    let start = '', end = '';

    if (preset === 'thisMonth') {
      start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else if (preset === 'lastMonth') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else if (preset === 'last3') {
      const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      end = now.toISOString().split('T')[0];
    } else if (preset === 'thisYear') {
      start = `${now.getFullYear()}-01-01`;
      end = `${now.getFullYear()}-12-31`;
    } else if (preset === 'lastYear') {
      start = `${now.getFullYear() - 1}-01-01`;
      end = `${now.getFullYear() - 1}-12-31`;
    }

    this._filters[id] = { preset, start, end };
    // 콜백 실행
    if (this._callbacks[id]) this._callbacks[id]();
  },

  _setCustom(id) {
    const start = document.getElementById(`${id}_start`).value;
    const end = document.getElementById(`${id}_end`).value;
    this._filters[id] = { preset: 'custom', start, end };
    if (this._callbacks[id]) this._callbacks[id]();
  },

  _callbacks: {},

  // 콜백 등록
  onChange(id, callback) {
    this._callbacks[id] = callback;
  },

  // 필터 적용
  filter(items, dateField, id) {
    const filter = this._filters[id];
    if (!filter || filter.preset === 'all' || (!filter.start && !filter.end)) return items;
    return items.filter(item => {
      const date = item[dateField];
      if (!date) return false;
      const dateOnly = date.split('T')[0].split(' ')[0];
      if (filter.start && dateOnly < filter.start) return false;
      if (filter.end && dateOnly > filter.end) return false;
      return true;
    });
  }
};

window.DateFilter = DateFilter;
