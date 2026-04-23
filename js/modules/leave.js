/* ============================================
   연차 신청 모듈 (네이티브 통합)
   - 업무관리시스템 users 컬렉션과 통합
   - Firestore: leaveRequests, leaveBalances 컬렉션 사용
   - 달력뷰 + 신청 + 승인/반려 + 취소요청 + 리포트
   ============================================ */

const LeaveModule = {
  container: null,
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  users: [],           // 전체 활성 사용자
  balances: [],        // 올해 잔여연차 기록
  requests: [],        // 연차 신청들
  selectedDate: null,  // 캘린더에서 선택한 날짜
  selectedType: 'full',
  selectedStart: '08:30',
  selectedEnd: '17:30',

  // 한국 공휴일
  holidays: {
    '2026-01-01': '신정', '2026-02-16': '설날연휴', '2026-02-17': '설날', '2026-02-18': '설날연휴',
    '2026-03-01': '삼일절', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날',
    '2026-06-06': '현충일', '2026-08-15': '광복절', '2026-09-24': '추석연휴',
    '2026-09-25': '추석', '2026-09-26': '추석연휴', '2026-10-03': '개천절',
    '2026-10-09': '한글날', '2026-12-25': '크리스마스',
    '2025-01-01': '신정', '2025-01-28': '설날연휴', '2025-01-29': '설날', '2025-01-30': '설날연휴',
    '2025-03-01': '삼일절', '2025-05-05': '어린이날', '2025-05-06': '대체공휴일',
    '2025-06-06': '현충일', '2025-08-15': '광복절', '2025-10-03': '개천절',
    '2025-10-06': '추석연휴', '2025-10-07': '추석', '2025-10-08': '추석연휴',
    '2025-10-09': '한글날', '2025-12-25': '크리스마스'
  },

  userColors: ['#3b82f6','#10b981','#ec4899','#f59e0b','#8b5cf6','#06b6d4','#f97316','#22c55e','#a855f7','#f43f5e','#14b8a6','#6366f1','#eab308','#d946ef','#fb923c'],

  // 사용자별 고정 색상 (displayName 기준)
  userColorMap: {
    '신수진': '#ec4899'  // 핑크
  },

  _colorForUser(user, idx) {
    if (user && this.userColorMap[user.displayName]) return this.userColorMap[user.displayName];
    return this.userColors[(idx >= 0 ? idx : 0) % this.userColors.length];
  },

  leaveTypes: {
    full:       { label: '연차',      hours: 8,   days: 1.0 },
    'half-am':  { label: '오전반차',  hours: 4,   days: 0.5 },
    'half-pm':  { label: '오후반차',  hours: 4,   days: 0.5 },
    half:       { label: '반차',      hours: 4,   days: 0.5 },
    quarter:    { label: '반반차',    hours: 2,   days: 0.25 }
  },

  async init(container) {
    this.container = container;
    await this.loadData();
    this.render();
    // 모달 백드롭 스타일 강제 (캐시된 CSS 방어)
    const bd = document.getElementById('modalBackdrop');
    if (bd) {
      bd.style.position = 'fixed';
      bd.style.inset = '0';
      bd.style.zIndex = '9999';
      bd.style.alignItems = 'center';
      bd.style.justifyContent = 'center';
    }
  },

  async loadData() {
    try {
      const allUsers = await DB.getAll('users');
      const activeUsers = allUsers.filter(u => u.isActive !== false);

      // 최초 1회: leaveEnabled 필드가 전무하면 김영성/신수진만 자동 활성화
      const hasAnyEnabled = activeUsers.some(u => u.leaveEnabled === true);
      const hasAnyField = activeUsers.some(u => typeof u.leaveEnabled !== 'undefined');
      if (!hasAnyField && !hasAnyEnabled) {
        const defaults = ['김영성', '신수진'];
        for (const u of activeUsers) {
          const enable = defaults.includes(u.displayName);
          await DB.update('users', { ...u, leaveEnabled: enable });
          u.leaveEnabled = enable;
        }
      }

      this.allUsers = activeUsers;                         // 전체 활성 사용자 (관리용)
      this.users = activeUsers.filter(u => u.leaveEnabled === true); // 연차 대상만

      // 올해 잔여연차 로드
      const allBalances = await DB.getAll('leaveBalances');
      this.balances = allBalances.filter(b => b.year === this.currentYear);

      // 잔여 기본값 없으면 자동 생성 (연차 대상자만)
      for (const u of this.users) {
        const has = this.balances.find(b => String(b.userId) === String(u.id));
        if (!has) {
          const rec = {
            userId: u.id,
            year: this.currentYear,
            totalLeave: 15,
            bonusLeaves: [],
            unlimited: false
          };
          const id = await DB.add('leaveBalances', rec);
          rec.id = id;
          this.balances.push(rec);
        }
      }

      // 올해 신청 로드
      const allReq = await DB.getAll('leaveRequests');
      this.requests = allReq.filter(r => r.year === this.currentYear);
    } catch (e) {
      console.error('[연차] 데이터 로드 실패:', e);
      Utils.showToast('연차 데이터 로드 실패: ' + e.message, 'error');
    }
  },

  render() {
    const user = Auth.currentUser();
    const isAdmin = Auth.isAdmin();
    const myBalance = this.balances.find(b => String(b.userId) === String(user.id));
    const pendingCount = this.requests.filter(r => r.status === 'pending').length;
    const cancelReqCount = this.requests.filter(r => r.status === 'cancel-requested').length;

    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:var(--sp-4);">

        <!-- 상단 요약 카드 -->
        <div class="card">
          <div class="card-header" style="background:var(--color-primary-50);">
            <div>
              <h3 style="margin:0;">🗓️ ${this.currentYear}년 연차 관리</h3>
              <div class="text-xs text-muted" style="margin-top:4px;">
                ${user.displayName}님 · ${isAdmin ? '관리자' : '직원'}
              </div>
            </div>
            <div class="d-flex gap-2">
              ${isAdmin ? `
                <button class="btn btn-ghost btn-sm" onclick="LeaveModule.openManageUsers()">
                  👥 팀원 연차 관리
                </button>
                <button class="btn btn-ghost btn-sm" onclick="LeaveModule.openPendingList()">
                  ⏳ 승인대기 ${pendingCount + cancelReqCount > 0 ? `<span class="badge badge-warning" style="margin-left:6px;">${pendingCount + cancelReqCount}</span>` : ''}
                </button>
                <button class="btn btn-ghost btn-sm" onclick="LeaveModule.openMigrateModal()" title="기존 연차 시스템에서 데이터 이관">
                  📥 데이터 이관
                </button>
              ` : ''}
              <button class="btn btn-ghost btn-sm" onclick="LeaveModule.openReport()">
                📊 리포트
              </button>
              <button class="btn btn-primary btn-sm" onclick="LeaveModule.refresh()">
                🔄 새로고침
              </button>
            </div>
          </div>

          <div class="card-body">
            ${this._renderBalanceCard(myBalance, user)}
          </div>
        </div>

        <!-- 달력 + 사이드 -->
        <div style="display:grid;grid-template-columns:1fr 320px;gap:var(--sp-4);" id="leaveLayout">
          <!-- 달력 -->
          <div class="card">
            <div class="card-header" style="padding:var(--sp-3) var(--sp-4);">
              <div class="d-flex align-items-center gap-2">
                <button class="btn btn-ghost btn-sm" onclick="LeaveModule.changeMonth(-1)">◀</button>
                <div style="font-size:1.05rem;font-weight:700;min-width:140px;text-align:center;">
                  ${this.currentYear}년 ${this.currentMonth + 1}월
                </div>
                <button class="btn btn-ghost btn-sm" onclick="LeaveModule.changeMonth(1)">▶</button>
                <button class="btn btn-ghost btn-sm" onclick="LeaveModule.goToday()">오늘</button>
              </div>
              <div class="text-xs text-muted" style="display:flex;gap:12px;flex-wrap:wrap;">
                <span><span style="display:inline-block;width:10px;height:10px;background:#85A8F0;border-radius:2px;"></span> 연차</span>
                <span><span style="display:inline-block;width:10px;height:10px;background:#ECC468;border-radius:2px;"></span> 반차</span>
                <span><span style="display:inline-block;width:10px;height:10px;background:#B89AF8;border-radius:2px;"></span> 반반차</span>
                <span><span style="display:inline-block;width:10px;height:10px;background:#f97316;border-radius:2px;opacity:.6;"></span> 대기</span>
              </div>
            </div>
            <div class="card-body" style="padding:0;">
              <div id="leaveCalendar">${this._renderCalendar()}</div>
            </div>
          </div>

          <!-- 사이드 -->
          <div style="display:flex;flex-direction:column;gap:var(--sp-4);">
            <!-- 팀원 현황 -->
            <div class="card">
              <div class="card-header" style="padding:var(--sp-3) var(--sp-4);">
                <div style="font-weight:700;font-size:0.9rem;">👥 팀원 연차 현황</div>
              </div>
              <div class="card-body" style="padding:var(--sp-2);">
                ${this._renderTeamList()}
              </div>
            </div>

            <!-- 내 신청내역 -->
            <div class="card">
              <div class="card-header" style="padding:var(--sp-3) var(--sp-4);">
                <div style="font-weight:700;font-size:0.9rem;">📋 내 신청 내역</div>
              </div>
              <div class="card-body" style="padding:var(--sp-2);max-height:400px;overflow-y:auto;">
                ${this._renderMyRequests()}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>
        .leave-cal { width:100%; border-collapse:collapse; table-layout:fixed; }
        .leave-cal th { padding:10px 0; font-size:0.75rem; color:#94A3B8; border-bottom:1px solid var(--color-border); text-align:center; font-weight:600; }
        .leave-cal th:first-child { color:#EF4444; }
        .leave-cal th:last-child { color:#3B82F6; }
        .leave-cal td { vertical-align:top; height:110px; border:1px solid #F1F5F9; padding:4px; cursor:pointer; transition:background 0.1s; position:relative; }
        .leave-cal td:hover:not(.empty):not(.weekend):not(.holiday) { background:#FAFBFC; }
        .leave-cal td.empty { background:transparent; cursor:default; }
        .leave-cal td.weekend { background:#F8F9FB; }
        .leave-cal td.holiday { background:#FFF5F5; }
        .leave-cal td.today { box-shadow:inset 0 0 0 2px #3B82F6; }
        .leave-day-num { font-size:0.82rem; font-weight:700; color:#475569; }
        .leave-day-num.sun { color:#EF4444; }
        .leave-day-num.sat { color:#3B82F6; }
        .leave-holiday-label { font-size:0.6rem; color:#EF4444; font-weight:500; }
        .leave-entry { font-size:0.6rem; padding:1px 4px; margin-top:2px; border-left:2.5px solid; border-radius:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:500; color:#475569; background:rgba(0,0,0,.02); }
        .leave-entry.pending { opacity:0.6; border-left-style:dashed; }
        .leave-entry.cancel-requested { background:rgba(239,68,68,.06); }
        .team-item { display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid var(--color-border); font-size:0.82rem; }
        .team-item:last-child { border-bottom:none; }
        .team-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .team-name { flex:1; font-weight:600; color:#334155; }
        .team-stat { font-family:'JetBrains Mono',monospace; font-size:0.72rem; color:#64748B; padding:2px 6px; background:#F1F5F9; border-radius:4px; }
        .my-req-item { padding:10px 12px; border-left:3px solid; border-radius:6px; background:#F8FAFC; margin-bottom:6px; font-size:0.82rem; }
        .my-req-item.pending { border-color:#f97316; }
        .my-req-item.approved { border-color:#10b981; }
        .my-req-item.rejected { border-color:#94A3B8; opacity:.7; }
        .my-req-item.cancel-requested { border-color:#ef4444; }
        .my-req-item.cancelled { border-color:#94A3B8; opacity:.5; text-decoration:line-through; }
        @media (max-width: 900px) {
          #leaveLayout { grid-template-columns: 1fr !important; }
          .leave-cal td { height:70px; }
        }
      </style>
    `;
  },

  _renderBalanceCard(balance, user) {
    if (!balance) return '<div class="text-muted">잔여연차 정보 없음</div>';
    const total = (balance.totalLeave || 0) + (balance.bonusLeaves || []).reduce((s, b) => s + (b.days || 0), 0);
    const used = this._calculateUsed(user.id, 'approved');
    const pending = this._calculateUsed(user.id, 'pending');
    const remaining = balance.unlimited ? '∞' : Math.max(0, total - used).toFixed(2);
    const unlimited = balance.unlimited;

    return `
      <div style="display:grid;grid-template-columns:repeat(${unlimited ? 2 : 4},1fr);gap:12px;">
        ${unlimited ? '' : `
          <div style="text-align:center;padding:12px;background:#F0F9FF;border-radius:8px;">
            <div style="font-family:'JetBrains Mono',monospace;font-size:1.4rem;font-weight:700;color:#3b82f6;">${total}</div>
            <div class="text-xs text-muted">총 연차</div>
          </div>
        `}
        <div style="text-align:center;padding:12px;background:#FAF5FF;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:1.4rem;font-weight:700;color:#8b5cf6;">${used.toFixed(2)}</div>
          <div class="text-xs text-muted">사용</div>
        </div>
        ${unlimited ? '' : `
          <div style="text-align:center;padding:12px;background:#ECFDF5;border-radius:8px;">
            <div style="font-family:'JetBrains Mono',monospace;font-size:1.4rem;font-weight:700;color:#10b981;">${remaining}${unlimited ? '' : '일'}</div>
            <div class="text-xs text-muted">잔여</div>
          </div>
        `}
        <div style="text-align:center;padding:12px;background:#FFF7ED;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:1.4rem;font-weight:700;color:#f97316;">${pending.toFixed(2)}</div>
          <div class="text-xs text-muted">대기중</div>
        </div>
        ${unlimited ? `
          <div style="text-align:center;padding:12px;background:rgba(16,185,129,.08);border-radius:8px;grid-column:1/-1;">
            <div style="font-size:0.95rem;font-weight:700;color:#10b981;">♾️ 무제한 연차</div>
          </div>
        ` : ''}
      </div>
    `;
  },

  _renderCalendar() {
    const year = this.currentYear;
    const month = this.currentMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const today = Utils.formatDate(new Date());

    const weekdays = ['일','월','화','수','목','금','토'];
    let html = '<table class="leave-cal"><thead><tr>';
    weekdays.forEach(w => { html += `<th>${w}</th>`; });
    html += '</tr></thead><tbody><tr>';

    // 이전달 빈 칸
    for (let i = 0; i < firstDay; i++) html += '<td class="empty"></td>';

    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = (firstDay + d - 1) % 7;
      const isSun = dow === 0, isSat = dow === 6;
      const isHoliday = !!this.holidays[dateStr];
      const isToday = dateStr === today;

      let cls = '';
      if (isSun || isSat) cls += ' weekend';
      if (isHoliday) cls += ' holiday';
      if (isToday) cls += ' today';

      const dayReqs = this.requests.filter(r => r.date === dateStr && r.status !== 'rejected' && r.status !== 'cancelled');
      const dayEntries = dayReqs.slice(0, 3).map(r => {
        const uIdx = this.users.findIndex(u => String(u.id) === String(r.userId));
        const uObj = uIdx >= 0 ? this.users[uIdx] : { displayName: r.userName };
        const color = this._colorForUser(uObj, uIdx);
        const typeLabel = this.leaveTypes[r.type]?.label || r.type;
        const statusCls = r.status === 'pending' ? ' pending' : (r.status === 'cancel-requested' ? ' cancel-requested' : '');
        return `<div class="leave-entry${statusCls}" style="border-left-color:${color};background:${color}15;" title="${Utils.escapeHtml(r.userName)} - ${typeLabel}">${Utils.escapeHtml(r.userName)} ${typeLabel}</div>`;
      }).join('');
      const more = dayReqs.length > 3 ? `<div style="font-size:0.6rem;color:#94A3B8;margin-top:2px;">+${dayReqs.length - 3}</div>` : '';

      const clickable = !isSun && !isSat && !isHoliday;
      const onclick = clickable ? `onclick="LeaveModule.openApplyModal('${dateStr}')"` : '';

      html += `<td class="${cls}" ${onclick}>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="leave-day-num${isSun ? ' sun' : (isSat ? ' sat' : '')}">${d}</span>
          ${isHoliday ? `<span class="leave-holiday-label">${this.holidays[dateStr]}</span>` : ''}
        </div>
        ${dayEntries}${more}
      </td>`;

      if ((firstDay + d) % 7 === 0 && d < lastDate) html += '</tr><tr>';
    }

    // 이후달 빈 칸
    const totalCells = firstDay + lastDate;
    const remaining = (7 - totalCells % 7) % 7;
    for (let i = 0; i < remaining; i++) html += '<td class="empty"></td>';

    html += '</tr></tbody></table>';
    return html;
  },

  _renderTeamList() {
    if (this.users.length === 0) return '<div class="text-center text-muted" style="padding:20px;">팀원 없음</div>';
    return this.users.map((u, idx) => {
      const bal = this.balances.find(b => String(b.userId) === String(u.id));
      const total = bal ? (bal.totalLeave || 0) + (bal.bonusLeaves || []).reduce((s, b) => s + (b.days || 0), 0) : 15;
      const used = this._calculateUsed(u.id, 'approved');
      const color = this._colorForUser(u, idx);
      const unlimited = bal?.unlimited;
      const stat = unlimited ? '∞' : `${used.toFixed(1)}/${total}`;
      return `
        <div class="team-item">
          <span class="team-dot" style="background:${color};"></span>
          <span class="team-name">${Utils.escapeHtml(u.displayName)}</span>
          <span class="team-stat">${stat}</span>
        </div>
      `;
    }).join('');
  },

  _renderMyRequests() {
    const user = Auth.currentUser();
    const mine = this.requests.filter(r => String(r.userId) === String(user.id))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (mine.length === 0) return '<div class="text-center text-muted" style="padding:20px;">신청 내역 없음</div>';

    return mine.map(r => {
      const statusLabel = {
        pending: '⏳ 승인대기',
        approved: '✅ 승인됨',
        rejected: '❌ 반려됨',
        'cancel-requested': '🔄 취소요청중',
        cancelled: '취소됨'
      }[r.status] || r.status;
      const typeLabel = this.leaveTypes[r.type]?.label || r.type;
      const timeInfo = (r.type !== 'full') ? ` (${r.startTime}~${r.endTime})` : '';

      let actions = '';
      if (r.status === 'pending') {
        actions = `<button class="btn btn-ghost btn-sm" onclick="LeaveModule.cancelPending('${r.id}')">신청 취소</button>`;
      } else if (r.status === 'approved') {
        actions = `<button class="btn btn-ghost btn-sm" onclick="LeaveModule.requestCancel('${r.id}')">취소 요청</button>`;
      }

      return `
        <div class="my-req-item ${r.status}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <div style="font-weight:600;color:#334155;">${r.date} · ${typeLabel}${timeInfo}</div>
              <div class="text-xs text-muted" style="margin-top:2px;">${statusLabel}</div>
              ${r.reason ? `<div class="text-xs" style="margin-top:4px;color:#64748B;">${Utils.escapeHtml(r.reason)}</div>` : ''}
              ${r.cancelReason ? `<div class="text-xs" style="margin-top:4px;color:#ef4444;">취소사유: ${Utils.escapeHtml(r.cancelReason)}</div>` : ''}
            </div>
            ${actions}
          </div>
        </div>
      `;
    }).join('');
  },

  _calculateUsed(userId, status) {
    return this.requests
      .filter(r => String(r.userId) === String(userId) && r.status === status)
      .reduce((s, r) => s + (this.leaveTypes[r.type]?.days || 0), 0);
  },

  changeMonth(delta) {
    this.currentMonth += delta;
    if (this.currentMonth < 0) { this.currentMonth = 11; this.currentYear--; }
    else if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; }
    this.render();
  },

  goToday() {
    const t = new Date();
    this.currentYear = t.getFullYear();
    this.currentMonth = t.getMonth();
    this.render();
  },

  async refresh() {
    await this.loadData();
    this.render();
    Utils.showToast('새로고침 완료', 'success');
  },

  // ===== 신청 모달 =====
  openApplyModal(date) {
    this.selectedDate = date;
    this.selectedType = 'full';
    this.selectedStart = '08:30';
    this.selectedEnd = '17:30';

    const dayReqs = this.requests.filter(r => r.date === date && r.status !== 'rejected' && r.status !== 'cancelled');
    const existingHtml = dayReqs.length > 0 ? `
      <div style="padding:12px;background:#F8FAFC;border-radius:8px;margin-bottom:16px;">
        <div class="text-xs text-muted" style="margin-bottom:6px;font-weight:600;">${date} 신청 현황</div>
        ${dayReqs.map(r => `<div class="text-sm" style="padding:3px 0;">${Utils.escapeHtml(r.userName)} - ${this.leaveTypes[r.type]?.label} ${r.status === 'pending' ? '(대기)' : ''}</div>`).join('')}
      </div>
    ` : '';

    Utils.openModal(`
      <div class="modal-header">
        <h3>연차 신청 - ${date}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
      ${existingHtml}
      <div class="form-group">
        <label class="form-label">연차 종류</label>
        <div style="display:grid;gap:6px;">
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--color-border);border-radius:8px;cursor:pointer;" class="leave-type-opt">
            <input type="radio" name="leaveType" value="full" checked onchange="LeaveModule._onTypeChange()">
            <span style="width:10px;height:10px;background:#85A8F0;border-radius:50%;"></span>
            <div>
              <div style="font-weight:600;">연차</div>
              <div class="text-xs text-muted">1일 차감 (종일)</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--color-border);border-radius:8px;cursor:pointer;" class="leave-type-opt">
            <input type="radio" name="leaveType" value="half" onchange="LeaveModule._onTypeChange()">
            <span style="width:10px;height:10px;background:#ECC468;border-radius:50%;"></span>
            <div>
              <div style="font-weight:600;">반차</div>
              <div class="text-xs text-muted">0.5일 차감</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--color-border);border-radius:8px;cursor:pointer;" class="leave-type-opt">
            <input type="radio" name="leaveType" value="quarter" onchange="LeaveModule._onTypeChange()">
            <span style="width:10px;height:10px;background:#B89AF8;border-radius:50%;"></span>
            <div>
              <div style="font-weight:600;">반반차</div>
              <div class="text-xs text-muted">0.25일 차감</div>
            </div>
          </label>
        </div>
      </div>

      <div id="leaveTimeArea" style="display:none;margin-top:12px;padding:14px;background:#F8FAFC;border:1px solid var(--color-border);border-radius:8px;">
        <div style="font-size:0.85rem;font-weight:700;margin-bottom:10px;">시간 선택</div>
        <div id="leaveTimePresets" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;"></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label style="font-size:0.82rem;color:#64748B;font-weight:600;">시작</label>
          <select id="leaveStartTime" class="form-input" style="flex:1;" onchange="LeaveModule._onTimeChange()"></select>
          <span style="color:#94A3B8;">~</span>
          <label style="font-size:0.82rem;color:#64748B;font-weight:600;">종료</label>
          <select id="leaveEndTime" class="form-input" style="flex:1;" onchange="LeaveModule._onTimeChange()"></select>
        </div>
        <div id="leaveTimeInfo" style="margin-top:8px;font-size:0.78rem;color:#3B82F6;"></div>
      </div>

      <div class="form-group" style="margin-top:14px;">
        <label class="form-label">사유 (선택)</label>
        <textarea id="leaveReason" class="form-input" rows="2" placeholder="연차 사유"></textarea>
      </div>

      <div style="margin-top:12px;font-size:0.78rem;color:#f97316;">※ 신청 후 관리자 승인이 필요합니다.</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
        <button class="btn btn-primary" onclick="LeaveModule.submitRequest()">신청</button>
      </div>
    `);
  },

  _onTypeChange() {
    const type = document.querySelector('input[name="leaveType"]:checked').value;
    this.selectedType = type;
    const area = document.getElementById('leaveTimeArea');
    if (type === 'full') {
      area.style.display = 'none';
      return;
    }
    area.style.display = 'block';
    // 근무시간 08:30~17:30, 점심 12:00~13:00 기준
    const presets = type === 'quarter'
      ? [['08:30','10:30','오전1'], ['10:00','12:00','오전2'], ['13:00','15:00','오후1'], ['15:30','17:30','오후2']]
      : [['08:30','13:00','오전반차'], ['13:00','17:30','오후반차']];
    document.getElementById('leaveTimePresets').innerHTML = presets.map(p =>
      `<button class="btn btn-ghost btn-sm" onclick="LeaveModule._applyPreset('${p[0]}','${p[1]}')">${p[2]} (${p[0]}~${p[1]})</button>`
    ).join('');

    const defaultStart = type === 'quarter' ? '08:30' : '08:30';
    const defaultEnd = type === 'quarter' ? '10:30' : '13:00';
    this._buildTimeSelect('leaveStartTime', defaultStart);
    this._buildTimeSelect('leaveEndTime', defaultEnd);
    this.selectedStart = defaultStart;
    this.selectedEnd = defaultEnd;
    this._updateTimeInfo();
  },

  _buildTimeSelect(id, def) {
    const sel = document.getElementById(id);
    let html = '';
    for (let h = 8; h <= 18; h++) {
      for (let m = (h === 8 ? 30 : 0); m < 60; m += 30) {
        if (h === 18 && m > 0) break;
        const v = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        html += `<option value="${v}" ${v === def ? 'selected' : ''}>${v}</option>`;
      }
    }
    sel.innerHTML = html;
  },

  _applyPreset(s, e) {
    document.getElementById('leaveStartTime').value = s;
    document.getElementById('leaveEndTime').value = e;
    this.selectedStart = s;
    this.selectedEnd = e;
    this._updateTimeInfo();
  },

  _onTimeChange() {
    this.selectedStart = document.getElementById('leaveStartTime').value;
    this.selectedEnd = document.getElementById('leaveEndTime').value;
    this._updateTimeInfo();
  },

  _updateTimeInfo() {
    const info = document.getElementById('leaveTimeInfo');
    if (!info) return;
    const workHours = this._workHours(this.selectedStart, this.selectedEnd);
    const stdHours = this._typeHours(this.selectedType);
    const typeLabel = this.leaveTypes[this.selectedType]?.label || this.selectedType;

    if (stdHours > 0) {
      info.innerHTML = `
        <div>선택: <strong>${this.selectedStart} ~ ${this.selectedEnd}</strong> (실근무 ${workHours.toFixed(1)}시간, 점심 제외)</div>
        <div style="margin-top:4px;">차감 기준: <strong style="color:#8b5cf6;">${typeLabel} = ${stdHours}시간</strong></div>
      `;
    } else {
      info.textContent = `선택 시간: ${workHours.toFixed(1)}시간`;
    }
  },

  // 단순 시간차 (참고용)
  _diffHours(s, e) {
    const [sh, sm] = s.split(':').map(Number);
    const [eh, em] = e.split(':').map(Number);
    return Math.max(0, (eh + em/60) - (sh + sm/60));
  },

  // 실근무시간 (점심시간 12:00~13:00 자동 제외)
  _workHours(s, e) {
    const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const sMin = toMin(s), eMin = toMin(e);
    const lunchStart = 12 * 60, lunchEnd = 13 * 60;
    const lunchOverlap = Math.max(0, Math.min(eMin, lunchEnd) - Math.max(sMin, lunchStart));
    return Math.max(0, (eMin - sMin) - lunchOverlap) / 60;
  },

  // 타입별 고정 차감 시간 (근무 8h 기준)
  _typeHours(type) {
    return { full: 8, half: 4, 'half-am': 4, 'half-pm': 4, quarter: 2 }[type] || 0;
  },

  async submitRequest() {
    const user = Auth.currentUser();
    const date = this.selectedDate;
    let type = document.querySelector('input[name="leaveType"]:checked').value;
    const reason = document.getElementById('leaveReason').value.trim();

    // 반차: am/pm 판별
    if (type === 'half') {
      const s = this.selectedStart;
      if (s >= '13:00') type = 'half-pm';
      else type = 'half-am';
    }

    // 같은 날짜 자신의 기존 신청 체크
    const dup = this.requests.find(r => r.date === date && String(r.userId) === String(user.id) && (r.status === 'pending' || r.status === 'approved'));
    if (dup) {
      Utils.showToast('해당 날짜에 이미 신청한 내역이 있습니다.', 'error');
      return;
    }

    // 잔여연차 체크
    const balance = this.balances.find(b => String(b.userId) === String(user.id));
    if (balance && !balance.unlimited) {
      const total = (balance.totalLeave || 0) + (balance.bonusLeaves || []).reduce((s, b) => s + (b.days || 0), 0);
      const used = this._calculateUsed(user.id, 'approved');
      const pending = this._calculateUsed(user.id, 'pending');
      const need = this.leaveTypes[type]?.days || 0;
      if (used + pending + need > total) {
        if (!confirm(`잔여연차가 부족합니다. (사용${used} + 대기${pending} + 이번신청${need} > 총${total})\n그래도 신청하시겠습니까?`)) return;
      }
    }

    try {
      const req = {
        userId: user.id,
        userName: user.displayName,
        date,
        year: this.currentYear,
        type,
        startTime: type === 'full' ? null : this.selectedStart,
        endTime: type === 'full' ? null : this.selectedEnd,
        hours: this._typeHours(type),
        reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      await DB.add('leaveRequests', req);
      await DB.log('연차신청', 'leaveRequests', null, { date, type });
      Utils.showToast('연차 신청 완료', 'success');
      Utils.closeModal();
      await this.refresh();
    } catch (e) {
      Utils.showToast('신청 실패: ' + e.message, 'error');
    }
  },

  async cancelPending(reqId) {
    if (!confirm('이 신청을 취소하시겠습니까?')) return;
    try {
      await DB.update('leaveRequests', { id: reqId, status: 'cancelled' });
      await DB.log('연차신청취소', 'leaveRequests', reqId);
      Utils.showToast('신청 취소됨', 'success');
      await this.refresh();
    } catch (e) {
      Utils.showToast('취소 실패: ' + e.message, 'error');
    }
  },

  async requestCancel(reqId) {
    const reason = prompt('취소 사유를 입력하세요:');
    if (reason === null) return;
    try {
      await DB.update('leaveRequests', { id: reqId, status: 'cancel-requested', cancelReason: reason });
      await DB.log('연차취소요청', 'leaveRequests', reqId);
      Utils.showToast('취소 요청됨. 관리자 승인 대기.', 'success');
      await this.refresh();
    } catch (e) {
      Utils.showToast('실패: ' + e.message, 'error');
    }
  },

  // ===== 관리자: 승인대기 목록 =====
  openPendingList() {
    if (!Auth.isAdmin()) return;
    const pending = this.requests.filter(r => r.status === 'pending');
    const cancelReqs = this.requests.filter(r => r.status === 'cancel-requested');

    let html = `<h4 style="margin:0 0 12px 0;font-size:0.95rem;">승인 대기 (${pending.length}건)</h4>`;
    if (pending.length === 0) {
      html += '<div class="text-center text-muted" style="padding:20px;">대기중인 신청 없음</div>';
    } else {
      html += pending.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(r => {
        const typeLabel = this.leaveTypes[r.type]?.label || r.type;
        const timeInfo = r.type !== 'full' ? ` (${r.startTime}~${r.endTime})` : '';
        return `
          <div style="padding:12px;background:#F8FAFC;border-radius:8px;margin-bottom:8px;border-left:3px solid #f97316;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
              <div style="flex:1;">
                <div style="font-weight:700;">${Utils.escapeHtml(r.userName)}</div>
                <div class="text-sm" style="color:#64748B;margin-top:2px;">${r.date} · ${typeLabel}${timeInfo}</div>
                ${r.reason ? `<div class="text-xs" style="margin-top:6px;color:#64748B;">사유: ${Utils.escapeHtml(r.reason)}</div>` : ''}
              </div>
              <div class="d-flex gap-1">
                <button class="btn btn-success btn-sm" onclick="LeaveModule.approveRequest('${r.id}')">승인</button>
                <button class="btn btn-danger btn-sm" onclick="LeaveModule.rejectRequest('${r.id}')">반려</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    html += `<h4 style="margin:20px 0 12px 0;font-size:0.95rem;">취소 요청 (${cancelReqs.length}건)</h4>`;
    if (cancelReqs.length === 0) {
      html += '<div class="text-center text-muted" style="padding:20px;">취소 요청 없음</div>';
    } else {
      html += cancelReqs.map(r => {
        const typeLabel = this.leaveTypes[r.type]?.label || r.type;
        return `
          <div style="padding:12px;background:#FEF2F2;border-radius:8px;margin-bottom:8px;border-left:3px solid #ef4444;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
              <div style="flex:1;">
                <div style="font-weight:700;">${Utils.escapeHtml(r.userName)}</div>
                <div class="text-sm" style="color:#64748B;margin-top:2px;">${r.date} · ${typeLabel}</div>
                ${r.cancelReason ? `<div class="text-xs" style="margin-top:6px;color:#ef4444;">사유: ${Utils.escapeHtml(r.cancelReason)}</div>` : ''}
              </div>
              <div class="d-flex gap-1">
                <button class="btn btn-success btn-sm" onclick="LeaveModule.approveCancel('${r.id}')">취소 승인</button>
                <button class="btn btn-secondary btn-sm" onclick="LeaveModule.rejectCancel('${r.id}')">취소 반려</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    Utils.openModal(`
      <div class="modal-header">
        <h3>승인 대기 / 취소 요청</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">${html}</div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
      </div>
    `, { size: 'modal-lg' });
  },

  async approveRequest(id) {
    try {
      const user = Auth.currentUser();
      await DB.update('leaveRequests', { id, status: 'approved', approvedAt: new Date().toISOString(), approvedBy: user.displayName });
      await DB.log('연차승인', 'leaveRequests', id);
      Utils.showToast('승인 완료', 'success');
      await this.refresh();
      this.openPendingList();
    } catch (e) { Utils.showToast('실패: ' + e.message, 'error'); }
  },

  async rejectRequest(id) {
    const reason = prompt('반려 사유 (선택):') || '';
    try {
      await DB.update('leaveRequests', { id, status: 'rejected', rejectedAt: new Date().toISOString(), rejectReason: reason });
      await DB.log('연차반려', 'leaveRequests', id);
      Utils.showToast('반려 처리됨', 'success');
      await this.refresh();
      this.openPendingList();
    } catch (e) { Utils.showToast('실패: ' + e.message, 'error'); }
  },

  async approveCancel(id) {
    try {
      await DB.update('leaveRequests', { id, status: 'cancelled', cancelApprovedAt: new Date().toISOString() });
      await DB.log('연차취소승인', 'leaveRequests', id);
      Utils.showToast('취소 승인됨', 'success');
      await this.refresh();
      this.openPendingList();
    } catch (e) { Utils.showToast('실패: ' + e.message, 'error'); }
  },

  async rejectCancel(id) {
    try {
      await DB.update('leaveRequests', { id, status: 'approved', cancelReason: null });
      await DB.log('연차취소반려', 'leaveRequests', id);
      Utils.showToast('취소 요청 반려됨', 'success');
      await this.refresh();
      this.openPendingList();
    } catch (e) { Utils.showToast('실패: ' + e.message, 'error'); }
  },

  // ===== 관리자: 팀원 연차 관리 =====
  openManageUsers() {
    if (!Auth.isAdmin()) return;

    // 연차 대상자 (편집 가능)
    const enabledHtml = this.users.length === 0
      ? '<div class="text-center text-muted" style="padding:16px;">현재 연차 사용 대상자가 없습니다. 하단에서 추가하세요.</div>'
      : this.users.map(u => {
          const bal = this.balances.find(b => String(b.userId) === String(u.id));
          const total = bal ? (bal.totalLeave || 0) + (bal.bonusLeaves || []).reduce((s, b) => s + (b.days || 0), 0) : 0;
          const used = this._calculateUsed(u.id, 'approved');
          const reqCount = this.requests.filter(r => String(r.userId) === String(u.id)).length;
          return `
            <div style="padding:12px;background:#F8FAFC;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-weight:700;">${Utils.escapeHtml(u.displayName)} <span class="text-xs text-muted">(신청 ${reqCount}건)</span></div>
                <div class="text-xs text-muted" style="margin-top:2px;">
                  ${bal?.unlimited ? '♾️ 무제한' : `기본 ${bal?.totalLeave || 0}일 + 포상 ${(bal?.bonusLeaves || []).reduce((s,b)=>s+(b.days||0),0)}일 = 총 ${total}일 (사용: ${used.toFixed(2)}일)`}
                </div>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-primary btn-sm" onclick="LeaveModule.openEditBalance('${u.id}')">편집</button>
                ${reqCount > 0 ? `<button class="btn btn-ghost btn-sm text-danger" onclick="LeaveModule.clearUserRequests('${u.id}')" title="이 사람의 연차 신청내역 모두 삭제">🗑️ 초기화</button>` : ''}
                <button class="btn btn-ghost btn-sm" onclick="LeaveModule.toggleLeaveEnabled('${u.id}', false)" title="연차 대상 제외">제외</button>
              </div>
            </div>
          `;
        }).join('');

    // 연차 비대상자 (추가 가능)
    const disabled = (this.allUsers || []).filter(u => u.leaveEnabled !== true);
    const disabledHtml = disabled.length === 0
      ? '<div class="text-xs text-muted" style="padding:10px;">추가 가능한 사용자가 없습니다.</div>'
      : disabled.map(u => `
          <div style="padding:10px 12px;background:#fff;border:1px dashed #E2E8F0;border-radius:8px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:600;color:#475569;">${Utils.escapeHtml(u.displayName)}</div>
              <div class="text-xs text-muted">${u.role === 'admin' ? '관리자' : '직원'}</div>
            </div>
            <button class="btn btn-success btn-sm" onclick="LeaveModule.toggleLeaveEnabled('${u.id}', true)">+ 추가</button>
          </div>
        `).join('');

    Utils.openModal(`
      <div class="modal-header">
        <h3>팀원 연차 관리</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:20px;">
          <div style="font-weight:700;margin-bottom:10px;color:#0F172A;">🎯 연차 사용 대상자 (${this.users.length}명)</div>
          ${enabledHtml}
        </div>

        <div style="border-top:1px solid #E2E8F0;padding-top:16px;">
          <div style="font-weight:700;margin-bottom:6px;color:#0F172A;">➕ 연차 사용 대상 추가</div>
          <div class="text-xs text-muted" style="margin-bottom:10px;">필요 시 다른 직원을 연차 대상으로 추가할 수 있습니다.</div>
          ${disabledHtml}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
      </div>
    `, { size: 'modal-lg' });
  },

  async clearUserRequests(userId) {
    const u = (this.allUsers || []).find(x => String(x.id) === String(userId));
    if (!u) return;
    const mine = this.requests.filter(r => String(r.userId) === String(userId));
    if (mine.length === 0) {
      Utils.showToast('삭제할 내역 없음', 'error');
      return;
    }
    const confirmMsg = `${u.displayName}님의 연차 신청내역 ${mine.length}건을 모두 삭제하시겠습니까?\n(되돌릴 수 없음. 잔여연차 설정은 유지)\n\n삭제하려면 "삭제"를 입력하세요:`;
    const answer = prompt(confirmMsg, '');
    if (answer !== '삭제') {
      if (answer !== null) Utils.showToast('입력값이 다릅니다. 취소되었습니다.', 'error');
      return;
    }

    try {
      let deleted = 0;
      for (const r of mine) {
        try {
          await DB.delete('leaveRequests', r.id);
          deleted++;
        } catch (e) { console.error(e); }
      }
      await DB.log('연차내역초기화', 'leaveRequests', null, { userId, deleted });
      Utils.showToast(`${u.displayName}님 연차 내역 ${deleted}건 삭제됨`, 'success');
      await this.refresh();
      this.openManageUsers();
    } catch (e) {
      Utils.showToast('실패: ' + e.message, 'error');
    }
  },

  async toggleLeaveEnabled(userId, enable) {
    try {
      const u = (this.allUsers || []).find(x => String(x.id) === String(userId));
      if (!u) return;

      if (!enable) {
        // 제외 시 승인된 연차 내역이 있으면 경고
        const hasRequests = this.requests.some(r => String(r.userId) === String(userId));
        const msg = hasRequests
          ? `${u.displayName}님을 연차 대상에서 제외합니다.\n(연차 신청 내역은 유지되지만 달력/팀원 현황에서 숨겨집니다)`
          : `${u.displayName}님을 연차 대상에서 제외합니다.`;
        if (!confirm(msg)) return;
      }

      await DB.update('users', { ...u, leaveEnabled: !!enable });
      await DB.log(enable ? '연차대상추가' : '연차대상제외', 'users', userId, { displayName: u.displayName });
      Utils.showToast(enable ? `${u.displayName}님이 연차 대상에 추가됨` : `${u.displayName}님이 연차 대상에서 제외됨`, 'success');

      await this.refresh();
      this.openManageUsers();
    } catch (e) {
      Utils.showToast('처리 실패: ' + e.message, 'error');
    }
  },

  openEditBalance(userId) {
    const u = this.users.find(x => String(x.id) === String(userId));
    const bal = this.balances.find(b => String(b.userId) === String(userId));
    if (!u || !bal) return;

    this._editingBalanceUserId = userId;

    Utils.openModal(`
      <div class="modal-header">
        <h3>${Utils.escapeHtml(u.displayName)}님의 연차</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">기본 연차 개수</label>
          <input type="number" id="editBalTotal" class="form-input" value="${bal.totalLeave || 0}" min="0" step="0.5">
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="editBalUnlimited" ${bal.unlimited ? 'checked' : ''}>
            <span>무제한 연차</span>
          </label>
        </div>

        <div style="padding:12px;background:#F8FAFC;border-radius:8px;margin-top:16px;">
          <div style="font-weight:700;margin-bottom:10px;">포상 연차 내역</div>
          <div id="bonusListEdit">${(bal.bonusLeaves || []).map((b, i) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#fff;border-radius:6px;margin-bottom:4px;">
              <span class="text-sm">${b.days}일 - ${Utils.escapeHtml(b.reason || '')}</span>
              <button class="btn btn-ghost btn-sm" onclick="LeaveModule._removeBonus(${i})">✕</button>
            </div>
          `).join('') || '<div class="text-xs text-muted">포상 내역 없음</div>'}</div>
          <div style="display:flex;gap:6px;margin-top:10px;">
            <input type="number" id="bonusDays" class="form-input" placeholder="일수" style="width:100px;" step="0.5">
            <input type="text" id="bonusReason" class="form-input" placeholder="사유" style="flex:1;">
            <button class="btn btn-success btn-sm" onclick="LeaveModule._addBonus('${userId}')">추가</button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="LeaveModule.openManageUsers()">← 목록</button>
        <button class="btn btn-primary" onclick="LeaveModule.saveBalance('${userId}')">저장</button>
      </div>
    `);
  },

  _addBonus(userId) {
    const days = parseFloat(document.getElementById('bonusDays').value);
    const reason = document.getElementById('bonusReason').value.trim();
    if (!days || days <= 0) { Utils.showToast('일수를 입력하세요', 'error'); return; }
    const bal = this.balances.find(b => String(b.userId) === String(userId));
    if (!bal) return;
    bal.bonusLeaves = bal.bonusLeaves || [];
    bal.bonusLeaves.push({ days, reason, date: new Date().toISOString().slice(0,10) });
    this.openEditBalance(userId);
  },

  _removeBonus(idx) {
    const userId = document.getElementById('editBalTotal')?.dataset?.userId;
    // 현재 편집 중 userId는 openEditBalance 호출로부터 찾자
    // 간단히 현재 모달의 마지막 편집 대상 저장 필요 → 루프를 통해 찾기
    // 여기서는 첫번째 일치 대상 처리
    for (const bal of this.balances) {
      if (bal.bonusLeaves && bal.bonusLeaves[idx]) {
        bal.bonusLeaves.splice(idx, 1);
        this.openEditBalance(bal.userId);
        return;
      }
    }
  },

  async saveBalance(userId) {
    const bal = this.balances.find(b => String(b.userId) === String(userId));
    if (!bal) return;
    const total = parseFloat(document.getElementById('editBalTotal').value) || 0;
    const unlimited = document.getElementById('editBalUnlimited').checked;
    try {
      await DB.update('leaveBalances', { ...bal, totalLeave: total, unlimited });
      await DB.log('연차기본변경', 'leaveBalances', bal.id, { userId, totalLeave: total, unlimited });
      Utils.showToast('저장 완료', 'success');
      await this.refresh();
      this.openManageUsers();
    } catch (e) {
      Utils.showToast('저장 실패: ' + e.message, 'error');
    }
  },

  // ===== 리포트 =====
  openReport() {
    let html = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px;">
        <div style="text-align:center;padding:14px;background:#F0F9FF;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:1.6rem;font-weight:700;color:#3b82f6;">${this.users.length}</div>
          <div class="text-xs text-muted">팀원수</div>
        </div>
        <div style="text-align:center;padding:14px;background:#FAF5FF;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:1.6rem;font-weight:700;color:#8b5cf6;">${this.requests.filter(r=>r.status==='approved').length}</div>
          <div class="text-xs text-muted">승인된 신청</div>
        </div>
        <div style="text-align:center;padding:14px;background:#FFF7ED;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:1.6rem;font-weight:700;color:#f97316;">${this.requests.filter(r=>r.status==='pending').length}</div>
          <div class="text-xs text-muted">대기중</div>
        </div>
      </div>
    `;

    html += `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#F8FAFC;">
            <th style="padding:10px;text-align:left;font-size:0.82rem;color:#64748B;">이름</th>
            <th style="padding:10px;text-align:right;font-size:0.82rem;color:#64748B;">기본</th>
            <th style="padding:10px;text-align:right;font-size:0.82rem;color:#64748B;">포상</th>
            <th style="padding:10px;text-align:right;font-size:0.82rem;color:#64748B;">총</th>
            <th style="padding:10px;text-align:right;font-size:0.82rem;color:#64748B;">사용</th>
            <th style="padding:10px;text-align:right;font-size:0.82rem;color:#64748B;">잔여</th>
            <th style="padding:10px;text-align:right;font-size:0.82rem;color:#64748B;">대기</th>
          </tr>
        </thead>
        <tbody>
          ${this.users.map(u => {
            const bal = this.balances.find(b => String(b.userId) === String(u.id));
            const base = bal?.totalLeave || 0;
            const bonus = (bal?.bonusLeaves || []).reduce((s,b)=>s+(b.days||0), 0);
            const total = base + bonus;
            const used = this._calculateUsed(u.id, 'approved');
            const pending = this._calculateUsed(u.id, 'pending');
            const remaining = bal?.unlimited ? '∞' : (total - used).toFixed(2);
            return `
              <tr style="border-bottom:1px solid #F1F5F9;">
                <td style="padding:10px;font-weight:600;">${Utils.escapeHtml(u.displayName)}</td>
                <td style="padding:10px;text-align:right;font-family:monospace;">${bal?.unlimited ? '∞' : base}</td>
                <td style="padding:10px;text-align:right;font-family:monospace;">${bonus}</td>
                <td style="padding:10px;text-align:right;font-family:monospace;">${bal?.unlimited ? '∞' : total}</td>
                <td style="padding:10px;text-align:right;font-family:monospace;color:#8b5cf6;">${used.toFixed(2)}</td>
                <td style="padding:10px;text-align:right;font-family:monospace;color:#10b981;font-weight:600;">${remaining}</td>
                <td style="padding:10px;text-align:right;font-family:monospace;color:#f97316;">${pending.toFixed(2)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      <div style="margin-top:20px;display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" onclick="LeaveModule.exportXlsx()">📥 엑셀 내보내기 (.xlsx)</button>
      </div>
    `;
    Utils.openModal(`
      <div class="modal-header">
        <h3>${this.currentYear}년 연차 리포트</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">${html}</div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
      </div>
    `, { size: 'modal-lg' });
  },

  // XLSX SDK 동적 로드
  async _ensureXlsxSdk() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('XLSX SDK 로드 실패'));
      document.head.appendChild(s);
    });
  },

  // 날짜 포맷: "2026-01-08" → "2026년 1월 8일"
  _formatKoreanDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return dateStr;
    return `${y}년 ${m}월 ${d}일`;
  },

  _statusLabel(status) {
    return {
      approved: '승인완료',
      pending: '승인대기',
      rejected: '반려',
      'cancel-requested': '취소요청',
      cancelled: '취소됨'
    }[status] || status;
  },

  _typeExcelLabel(type) {
    return { full: '연차', half: '반차', 'half-am': '오전반차', 'half-pm': '오후반차', quarter: '반반차' }[type] || type;
  },

  // 엑셀 리포트 내보내기 (2시트: 연차현황 + 사용일자상세)
  async exportXlsx() {
    try {
      await this._ensureXlsxSdk();
      const XLSX = window.XLSX;
      const wb = XLSX.utils.book_new();

      // ===== 시트 1: 연차현황 =====
      const summaryData = [['이름', '기본연차', '포상연차', '총연차', '사용', '잔여', '대기']];
      this.users.forEach(u => {
        const bal = this.balances.find(b => String(b.userId) === String(u.id));
        const base = bal?.totalLeave || 0;
        const bonus = (bal?.bonusLeaves || []).reduce((s, b) => s + (b.days || 0), 0);
        const total = base + bonus;
        const used = this._calculateUsed(u.id, 'approved');
        const pending = this._calculateUsed(u.id, 'pending');
        const isUnl = bal?.unlimited;
        summaryData.push([
          u.displayName,
          isUnl ? '무제한' : base,
          bonus,
          isUnl ? '무제한' : total,
          Number(used.toFixed(2)),
          isUnl ? '무제한' : Number((total - used).toFixed(2)),
          Number(pending.toFixed(2))
        ]);
      });
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      wsSummary['!cols'] = [
        { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }
      ];
      XLSX.utils.book_append_sheet(wb, wsSummary, '연차현황');

      // ===== 시트 2: 사용일자상세 =====
      const detailData = [['이름', '날짜', '연차유형', '차감일수', '상태']];
      // 상태 필터: 취소/반려 제외 (승인완료 + 대기 + 취소요청)
      const relevantStatuses = ['approved', 'pending', 'cancel-requested'];
      const details = this.requests
        .filter(r => relevantStatuses.includes(r.status))
        .filter(r => this.users.some(u => String(u.id) === String(r.userId))) // 대상자만
        .sort((a, b) => {
          const nameCmp = (a.userName || '').localeCompare(b.userName || '', 'ko');
          if (nameCmp !== 0) return nameCmp;
          return (a.date || '').localeCompare(b.date || '');
        });

      details.forEach(r => {
        detailData.push([
          r.userName,
          this._formatKoreanDate(r.date),
          this._typeExcelLabel(r.type),
          this.leaveTypes[r.type]?.days || 0,
          this._statusLabel(r.status)
        ]);
      });

      if (detailData.length === 1) {
        // 내역이 없을 때 안내행
        detailData.push(['(내역 없음)', '', '', '', '']);
      }

      const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
      wsDetail['!cols'] = [
        { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 12 }
      ];
      XLSX.utils.book_append_sheet(wb, wsDetail, '사용일자상세');

      // 파일명: 스퀘어건축사사무소_YY년_연차_리포트_YYYYMMDD
      const now = new Date();
      const yy = String(this.currentYear).slice(-2);
      const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
      const filename = `스퀘어건축사사무소_${yy}년_연차_리포트_${stamp}.xlsx`;

      XLSX.writeFile(wb, filename);
      Utils.showToast(`${filename} 다운로드 완료`, 'success');
    } catch (e) {
      console.error('[연차] 엑셀 내보내기 실패:', e);
      Utils.showToast('엑셀 내보내기 실패: ' + e.message, 'error');
    }
  },

  // ===== 기존 시스템 데이터 이관 =====
  openMigrateModal() {
    if (!Auth.isAdmin()) return;
    Utils.openModal(`
      <div class="modal-header">
        <h3>기존 연차 데이터 이관</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="padding:14px;background:#FFF7ED;border-radius:8px;margin-bottom:16px;border-left:3px solid #f97316;">
          <div style="font-weight:700;color:#9A3412;margin-bottom:6px;">⚠️ 이관 안내</div>
          <div class="text-sm" style="color:#64748B;line-height:1.6;">
            기존 연차 시스템(<code>index_연차관련.html</code>)의 Firebase Realtime Database에서 데이터를 가져옵니다.<br>
            • 이름 기반으로 현재 시스템 사용자와 매칭합니다 (<code>displayName</code>)<br>
            • 매칭된 사용자만 이관됩니다 (일치 안하면 수동 맞추기)<br>
            • 기본연차/포상연차/무제한 설정이 덮어씌워집니다<br>
            • 모든 연차 신청 내역이 추가됩니다 (기존 데이터는 유지)
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">기존 Firebase Realtime DB URL</label>
          <input type="text" id="migrateDbUrl" class="form-input" value="https://test-168a4-default-rtdb.asia-southeast1.firebasedatabase.app">
        </div>
        <div class="form-group">
          <label class="form-label">기존 API Key</label>
          <input type="text" id="migrateApiKey" class="form-input" value="AIzaSyCzngaCcenhH1tmZ7syugpI3H1wYBVhiJQ">
        </div>
        <div class="form-group">
          <label class="form-label">데이터 경로</label>
          <input type="text" id="migratePath" class="form-input" value="/sq_vc_shared">
        </div>

        <div style="display:flex;gap:8px;margin-top:16px;">
          <button class="btn btn-secondary" onclick="Utils.closeModal()" style="flex:1;">취소</button>
          <button class="btn btn-primary" onclick="LeaveModule._loadOldData()" style="flex:1;">🔍 미리보기</button>
        </div>

        <div id="migratePreview" style="margin-top:20px;"></div>
      </div>
    `, { size: 'modal-lg' });
  },

  async _loadOldData() {
    const dbUrl = document.getElementById('migrateDbUrl').value.trim();
    const apiKey = document.getElementById('migrateApiKey').value.trim();
    const path = document.getElementById('migratePath').value.trim() || '/sq_vc_shared';
    const preview = document.getElementById('migratePreview');

    preview.innerHTML = '<div class="text-center" style="padding:20px;">로드중...</div>';

    try {
      // Firebase Realtime DB SDK 로드 (없으면)
      if (!firebase.database) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://www.gstatic.com/firebasejs/10.7.0/firebase-database-compat.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('Firebase Database SDK 로드 실패'));
          document.head.appendChild(s);
        });
      }

      // 보조 앱으로 초기화 (현재 Firestore와 충돌 방지)
      let oldApp;
      const existingApp = firebase.apps.find(a => a.name === 'leave-migration');
      if (existingApp) {
        oldApp = existingApp;
      } else {
        oldApp = firebase.initializeApp({
          apiKey, databaseURL: dbUrl, projectId: 'leave-migration-temp'
        }, 'leave-migration');
      }

      const oldDb = oldApp.database();
      const snap = await oldDb.ref(path).once('value');
      const data = snap.val();

      if (!data || !data.users || !Array.isArray(data.users)) {
        preview.innerHTML = '<div class="text-center text-muted" style="padding:20px;color:#ef4444;">❌ 데이터를 찾을 수 없습니다.</div>';
        return;
      }

      this._oldData = data;
      this._renderMigratePreview(data);
    } catch (e) {
      console.error(e);
      preview.innerHTML = `<div style="padding:16px;background:#FEE2E2;border-radius:8px;color:#991B1B;">❌ 로드 실패: ${Utils.escapeHtml(e.message)}</div>`;
    }
  },

  _renderMigratePreview(data) {
    const preview = document.getElementById('migratePreview');
    const oldUsers = data.users || [];

    // 이름 기준 매칭
    const mapped = oldUsers.map(ou => {
      const newU = this.users.find(u =>
        u.displayName === ou.name ||
        u.username === ou.name ||
        u.displayName?.replace(/\s/g, '') === ou.name?.replace(/\s/g, '')
      );
      const leaves = ou.leaves || {};
      const leaveCount = Object.keys(leaves).length;
      return { oldUser: ou, newUser: newU, leaveCount };
    });

    const matched = mapped.filter(m => m.newUser);
    const unmatched = mapped.filter(m => !m.newUser);
    const totalLeaves = matched.reduce((s, m) => s + m.leaveCount, 0);

    let html = `
      <div style="padding:14px;background:#F0F9FF;border-radius:8px;margin-bottom:16px;">
        <div style="font-weight:700;margin-bottom:8px;">📊 미리보기</div>
        <div class="text-sm" style="color:#64748B;line-height:1.8;">
          • 기존 사용자: <strong>${oldUsers.length}명</strong><br>
          • 매칭됨: <strong style="color:#10b981;">${matched.length}명</strong><br>
          • 매칭실패: <strong style="color:#ef4444;">${unmatched.length}명</strong><br>
          • 이관될 연차 신청: <strong>${totalLeaves}건</strong>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#F8FAFC;">
            <th style="padding:8px;text-align:left;font-size:0.8rem;color:#64748B;border-bottom:1px solid #E2E8F0;">기존 이름</th>
            <th style="padding:8px;text-align:left;font-size:0.8rem;color:#64748B;border-bottom:1px solid #E2E8F0;">새 시스템 사용자</th>
            <th style="padding:8px;text-align:right;font-size:0.8rem;color:#64748B;border-bottom:1px solid #E2E8F0;">기본연차</th>
            <th style="padding:8px;text-align:right;font-size:0.8rem;color:#64748B;border-bottom:1px solid #E2E8F0;">신청내역</th>
            <th style="padding:8px;text-align:left;font-size:0.8rem;color:#64748B;border-bottom:1px solid #E2E8F0;">상태</th>
          </tr>
        </thead>
        <tbody>
    `;

    mapped.forEach((m, idx) => {
      const bonus = (m.oldUser.bonusLeaves || []).reduce((s, b) => s + (b.days || 0), 0);
      const total = (m.oldUser.totalLeave || 0) + bonus;
      html += `
        <tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:8px;font-weight:600;">${Utils.escapeHtml(m.oldUser.name)}</td>
          <td style="padding:8px;">
            ${m.newUser ? `
              <span style="color:#10b981;">✅ ${Utils.escapeHtml(m.newUser.displayName)}</span>
            ` : `
              <select class="form-input" style="padding:4px 8px;font-size:0.82rem;" onchange="LeaveModule._manualMap(${idx}, this.value)">
                <option value="">-- 선택 --</option>
                ${this.users.map(u => `<option value="${u.id}">${Utils.escapeHtml(u.displayName)}</option>`).join('')}
              </select>
            `}
          </td>
          <td style="padding:8px;text-align:right;font-family:monospace;">${m.oldUser.unlimited ? '∞' : total}</td>
          <td style="padding:8px;text-align:right;">${m.leaveCount}건</td>
          <td style="padding:8px;">${m.newUser ? '<span style="color:#10b981;">이관예정</span>' : '<span style="color:#94A3B8;">-</span>'}</td>
        </tr>
      `;
    });

    // 매칭된 사용자들의 기존 신청 건수 (테스트 데이터 안내용)
    const existingCounts = matched.map(m => {
      const cnt = this.requests.filter(r => String(r.userId) === String(m.newUser.id)).length;
      return { name: m.newUser.displayName, count: cnt };
    });
    const totalExisting = existingCounts.reduce((s, e) => s + e.count, 0);

    html += `
        </tbody>
      </table>

      ${totalExisting > 0 ? `
        <div style="padding:14px;background:#FEF3C7;border-radius:8px;margin-bottom:16px;border-left:3px solid #f59e0b;">
          <div style="font-weight:700;margin-bottom:8px;color:#92400E;">⚠️ 매칭 대상자의 기존 신청 내역 ${totalExisting}건</div>
          <div class="text-xs" style="color:#78350F;line-height:1.6;margin-bottom:10px;">
            ${existingCounts.filter(e => e.count > 0).map(e => `• ${e.name}: ${e.count}건`).join('<br>')}
          </div>
          <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border-radius:6px;cursor:pointer;">
            <input type="checkbox" id="migrateClearFirst">
            <div>
              <div style="font-weight:700;color:#92400E;">🗑️ 이관 전 대상자 기존 신청내역 모두 삭제</div>
              <div class="text-xs" style="color:#78350F;margin-top:2px;">테스트 데이터를 지우고 깨끗하게 이관하려면 체크하세요.</div>
            </div>
          </label>
        </div>
      ` : ''}

      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" onclick="Utils.closeModal()" style="flex:1;">취소</button>
        <button class="btn btn-primary" onclick="LeaveModule._executeMigration()" style="flex:1;" ${matched.length === 0 ? 'disabled' : ''}>
          📥 ${matched.length}명 이관 실행
        </button>
      </div>
    `;

    preview.innerHTML = html;
    this._migrationMapped = mapped;
  },

  _manualMap(idx, userId) {
    if (!this._migrationMapped) return;
    const u = this.users.find(x => String(x.id) === String(userId));
    this._migrationMapped[idx].newUser = u || null;
    this._renderMigratePreview(this._oldData);
  },

  async _executeMigration() {
    if (!this._migrationMapped) return;
    const toMigrate = this._migrationMapped.filter(m => m.newUser);
    if (toMigrate.length === 0) { Utils.showToast('매칭된 사용자 없음', 'error'); return; }

    const clearFirst = document.getElementById('migrateClearFirst')?.checked;

    let confirmMsg = `${toMigrate.length}명의 연차 데이터를 이관합니다. 계속하시겠습니까?\n(기본연차/포상/무제한 설정이 덮어씌워집니다)`;
    if (clearFirst) {
      confirmMsg += '\n\n⚠️ 체크된 옵션: 대상자 기존 신청내역이 모두 삭제된 후 이관됩니다. (되돌릴 수 없음)';
    }
    if (!confirm(confirmMsg)) return;

    const preview = document.getElementById('migratePreview');
    preview.innerHTML = '<div class="text-center" style="padding:20px;">이관중...</div>';

    let balancesUpdated = 0;
    let requestsAdded = 0;
    let requestsDeleted = 0;
    let failed = 0;

    try {
      // 0) 기존 신청내역 삭제 (옵션)
      if (clearFirst) {
        for (const m of toMigrate) {
          const userId = m.newUser.id;
          const existing = this.requests.filter(r => String(r.userId) === String(userId));
          for (const r of existing) {
            try {
              await DB.delete('leaveRequests', r.id);
              requestsDeleted++;
            } catch (e) {
              console.error('기존 내역 삭제 실패:', e);
              failed++;
            }
          }
        }
        // 메모리에서도 삭제 반영 (중복 체크 로직 정상 동작 위해)
        const migratedIds = new Set(toMigrate.map(m => String(m.newUser.id)));
        this.requests = this.requests.filter(r => !migratedIds.has(String(r.userId)));
      }

      for (const m of toMigrate) {
        const ou = m.oldUser;
        const nu = m.newUser;

        // 1) 잔여연차 업데이트
        const bal = this.balances.find(b => String(b.userId) === String(nu.id));
        if (bal) {
          try {
            await DB.update('leaveBalances', {
              ...bal,
              totalLeave: ou.totalLeave || 15,
              bonusLeaves: ou.bonusLeaves || [],
              unlimited: !!ou.unlimited
            });
            balancesUpdated++;
          } catch (e) {
            console.error('잔여연차 업데이트 실패:', e);
            failed++;
          }
        }

        // 2) 연차 신청 이관
        const leaves = ou.leaves || {};
        for (const [date, leave] of Object.entries(leaves)) {
          try {
            // 상태 매핑: 기존 → 새
            let status = 'pending';
            if (leave.status === 'approved') status = 'approved';
            else if (leave.status === 'cancel-requested') status = 'cancel-requested';
            else if (leave.status === 'cancelled') status = 'cancelled';
            else if (leave.status === 'rejected') status = 'rejected';

            // 타입 매핑
            let type = leave.type || 'full';
            if (type === 'half') {
              // 오전/오후 구분
              if (leave.startTime && leave.startTime >= '13:00') type = 'half-pm';
              else type = 'half-am';
            }

            // 같은 날짜 중복 방지
            const existing = this.requests.find(r =>
              String(r.userId) === String(nu.id) && r.date === date
            );
            if (existing) continue;

            // year 추출
            const year = parseInt((date || '').split('-')[0]) || this.currentYear;

            await DB.add('leaveRequests', {
              userId: nu.id,
              userName: nu.displayName,
              date,
              year,
              type,
              startTime: leave.startTime || null,
              endTime: leave.endTime || null,
              hours: leave.hours || (type === 'full' ? 8 : 4),
              reason: leave.reason || '(이관)',
              status,
              cancelReason: leave.cancelReason || null,
              createdAt: leave.createdAt || new Date().toISOString(),
              approvedAt: leave.approvedAt || null,
              approvedBy: leave.approvedBy || null,
              migratedFrom: 'legacy'
            });
            requestsAdded++;
          } catch (e) {
            console.error('연차 이관 실패:', date, e);
            failed++;
          }
        }
      }

      await DB.log('연차데이터이관', 'leaveRequests', null, { balancesUpdated, requestsAdded, requestsDeleted, failed });
      const msgParts = [`잔여 ${balancesUpdated}명`, `신청 ${requestsAdded}건`];
      if (requestsDeleted > 0) msgParts.unshift(`삭제 ${requestsDeleted}건`);
      if (failed > 0) msgParts.push(`실패 ${failed}`);
      Utils.showToast(`이관 완료: ${msgParts.join(' / ')}`, 'success');
      Utils.closeModal();
      await this.refresh();
    } catch (e) {
      preview.innerHTML = `<div style="padding:16px;background:#FEE2E2;border-radius:8px;color:#991B1B;">❌ 이관 중 오류: ${Utils.escapeHtml(e.message)}</div>`;
    }
  },

  destroy() {}
};

window.LeaveModule = LeaveModule;
