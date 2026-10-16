/* ============================================
   거래처별 대사 (외상매출금 원장)
   - 차변(발행) = 세금계산서 발행완료 합계 (거래처별)
   - 대변(입금) = 그 세금계산서에 매칭된 입금 + 미매칭 입금(입금처별)
   - 잔액 = 차변 - 대변  (양수=미수 / 음수=미발행·선수 / 0=완료)
   - 열 때마다 현재 데이터로 자동 계산 (위하고 자료 업데이트 시 함께 반영)
   ============================================ */

const ReceivablesModule = {
  container: null,
  searchText: '',
  filterMode: 'all',   // all | outstanding(미수) | prepaid(미발행·선수)
  sortField: null,
  sortDir: 'asc',

  async init(container) {
    this.container = container;
    this.searchText = '';
    await this.render();
  },

  _sort(field) {
    if (this.sortField === field) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortField = field; this.sortDir = 'asc'; }
    this.render();
  },
  _setFilter(m) { this.filterMode = m; this.render(); },

  _matchedIds(inv) {
    if (Array.isArray(inv.matchedDepositIds) && inv.matchedDepositIds.length) return inv.matchedDepositIds.map(String);
    if (inv.matchedDepositId) return [String(inv.matchedDepositId)];
    return [];
  },

  // 입금내역 제외 키워드(비매출: 석민·환급·수수료·결산 등)를 대사에서도 제외
  _excludeKw() {
    const u = (window.Auth && Auth.currentUser) ? Auth.currentUser() : null;
    const raw = ((u && u.depositExcludeFilter) || '').trim();
    return raw ? raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [];
  },
  _excluded(name, kws) {
    if (!kws || !kws.length) return false;
    const n = (name || '').toLowerCase();
    return kws.some(k => k && n.includes(k));
  },

  async render() {
    const kws = this._excludeKw();
    const invoices = (await DB.getAll('taxInvoiceRequests')).filter(i => i.status === '발행완료' && !this._excluded(i.partnerCompanyName, kws));
    const deposits = (await DB.getAll('deposits')).filter(d => !this._excluded(d.depositorName, kws));
    const depositMap = {};
    deposits.forEach(d => { depositMap[String(d.id)] = d; });

    // 거래처별 집계
    // 이름 정규화 키: 괄호(전각/반각)·주식회사·유한회사·공백·기호 제거
    //  → 표기만 다른 같은 거래처를 하나로 합침 (예: '주식회사 커널시스텍' = '（주）커널시스텍' = '커널시스텍')
    const _key = (s) => (s || '').toString()
      .replace(/[(（]\s*[주유]\s*[)）]/g, '')   // (주) (유) 전각/반각 통째 제거
      .replace(/주식회사|유한회사/g, '')
      .replace(/[（）()㈜\s&·.,\-_/]/g, '')
      .toLowerCase().trim();
    const map = {};
    const rowOf = (name) => {
      const k = _key(name) || '(거래처 미상)';
      // 표시 이름은 먼저 등록된 것(세금계산서 상호 우선) 사용
      if (!map[k]) map[k] = { name: (name || '').trim() || '(거래처 미상)', debit: 0, credit: 0 };
      return map[k];
    };
    const counted = new Set();

    // 1) 세금계산서(발행완료) → 차변 + 매칭된 입금(대변)
    for (const inv of invoices) {
      const r = rowOf(inv.partnerCompanyName);
      r.debit += Number(inv.totalAmount) || 0;
      for (const did of this._matchedIds(inv)) {
        const dep = depositMap[did];
        if (dep) { r.credit += Number(dep.amount) || 0; counted.add(did); }
      }
    }
    // 2) 미매칭 입금(세금계산서 안 붙음, 처리완료/현금영수증 제외) → 대변 (거래처=입금처)
    for (const dep of deposits) {
      if (counted.has(String(dep.id))) continue;
      if (dep.matchStatus === '매칭완료') continue;
      if ((dep.actionRequired || '').startsWith('처리완료')) continue;
      const r = rowOf(dep.depositorName);
      r.credit += Number(dep.amount) || 0;
    }

    let rows = Object.values(map)
      .map(r => ({ ...r, balance: r.debit - r.credit }))
      .filter(r => r.debit !== 0 || r.credit !== 0);

    // 필터
    if (this.filterMode === 'outstanding') rows = rows.filter(r => r.balance > 0);
    else if (this.filterMode === 'prepaid') rows = rows.filter(r => r.balance < 0);
    // 검색
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q));
    }
    // 정렬 (미지정 시 잔액 큰 순)
    if (this.sortField) rows = Utils.Sort.apply(rows, this.sortField, this.sortDir);
    else rows = rows.slice().sort((a, b) => b.balance - a.balance);

    // 합계
    const totDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totCredit = rows.reduce((s, r) => s + r.credit, 0);
    const totBal = totDebit - totCredit;
    const outstanding = rows.filter(r => r.balance > 0).reduce((s, r) => s + r.balance, 0);
    const prepaid = rows.filter(r => r.balance < 0).reduce((s, r) => s + Math.abs(r.balance), 0);

    const statusBadge = (b) => {
      if (b > 0) return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(245,158,11,.18);color:#b45309;">미수</span>`;
      if (b < 0) return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(37,99,235,.15);color:#2563eb;">미발행/선수</span>`;
      return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(16,185,129,.15);color:#059669;">완료</span>`;
    };

    const tableRows = rows.length === 0
      ? `<tr><td colspan="5" class="text-center" style="padding:var(--sp-10);"><div class="empty-state"><div class="empty-icon">📒</div><h3>해당 내역이 없습니다</h3></div></td></tr>`
      : rows.map(r => `
        <tr>
          <td class="fw-medium">${Utils.escapeHtml(r.name)}</td>
          <td class="text-right">${Utils.formatCurrency(r.debit)}</td>
          <td class="text-right">${Utils.formatCurrency(r.credit)}</td>
          <td class="text-right" style="font-weight:700;color:${r.balance > 0 ? '#b45309' : (r.balance < 0 ? '#2563eb' : '#059669')};">${Utils.formatCurrency(r.balance)}</td>
          <td class="text-center">${statusBadge(r.balance)}</td>
        </tr>
      `).join('');

    this.container.innerHTML = `
      <div class="page-header">
        <h2>📒 거래처별 대사</h2>
      </div>
      <div style="background:var(--color-info-light);padding:var(--sp-3) var(--sp-4);border-radius:var(--radius-sm);margin-bottom:var(--sp-3);font-size:var(--font-size-sm);">
        <strong>차변</strong>=세금계산서 발행 · <strong>대변</strong>=입금 · <strong>잔액</strong>=차변−대변
        <span class="text-muted"> (양수=미수 / 음수=미발행·선수). 세금계산서·입금·매칭 데이터로 자동 계산됩니다.</span>
        ${kws.length ? `<div class="text-xs" style="margin-top:4px;color:#b45309;">🚫 제외(비매출): ${Utils.escapeHtml(kws.join(', '))} — 입금내역 제외 키워드가 대사에서도 빠집니다. (수정: 사용자 관리 → 본인 편집 → 입금내역 제외 키워드)</div>` : ''}
      </div>

      <div class="summary-cards">
        <div class="summary-card" onclick="ReceivablesModule._setFilter('all')" style="cursor:pointer;${this.filterMode === 'all' ? 'outline:2px solid var(--color-primary);outline-offset:-1px;' : ''}">
          <div class="card-icon cyan">📒</div>
          <div class="card-info"><div class="card-label">거래처 수</div><div class="card-value">${rows.length}곳</div></div>
        </div>
        <div class="summary-card" style="border-left:4px solid var(--color-success);">
          <div class="card-icon green">🧾</div>
          <div class="card-info"><div class="card-label">발행 합계(차변)</div><div class="card-value">${Utils.formatCurrency(totDebit)}</div></div>
        </div>
        <div class="summary-card" onclick="ReceivablesModule._setFilter('outstanding')" title="미수만 보기" style="border-left:4px solid var(--color-warning);cursor:pointer;${this.filterMode === 'outstanding' ? 'outline:2px solid var(--color-warning);outline-offset:-1px;' : ''}">
          <div class="card-icon orange">⚠️</div>
          <div class="card-info"><div class="card-label">미수 합계 (못 받은 돈)</div><div class="card-value">${Utils.formatCurrency(outstanding)}</div></div>
        </div>
        <div class="summary-card" onclick="ReceivablesModule._setFilter('prepaid')" title="미발행/선수만 보기" style="border-left:4px solid var(--color-primary);cursor:pointer;${this.filterMode === 'prepaid' ? 'outline:2px solid var(--color-primary);outline-offset:-1px;' : ''}">
          <div class="card-icon blue">📥</div>
          <div class="card-info"><div class="card-label">미발행/선수 (입금만)</div><div class="card-value">${Utils.formatCurrency(prepaid)}</div></div>
        </div>
      </div>

      <div class="table-wrapper">
        <div class="table-toolbar" style="flex-wrap:wrap;gap:var(--sp-2);">
          <div class="toolbar-left d-flex gap-2" style="flex-wrap:wrap;align-items:center;">
            <div class="search-input">
              <span class="search-icon">🔍</span>
              <input type="text" class="form-control" id="arSearch" placeholder="거래처 검색..." value="${Utils.escapeHtml(this.searchText)}">
            </div>
            ${this.filterMode !== 'all' ? `<button class="btn btn-ghost btn-sm" onclick="ReceivablesModule._setFilter('all')">✕ 필터 해제</button>` : ''}
            <button class="btn btn-primary btn-sm" onclick="ReceivablesModule._openLedger()" title="세금계산서 발행일·입금일을 건별로 펼쳐 상대방에게 보낼 명세">📋 건별 명세 (확인요청용)</button>
          </div>
          <div class="toolbar-right text-sm text-muted">총 ${rows.length}곳 · 잔액합계 ${Utils.formatCurrency(totBal)}</div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              ${Utils.Sort.th('거래처', 'name', this.sortField, this.sortDir, 'ReceivablesModule')}
              ${Utils.Sort.th('발행(차변)', 'debit', this.sortField, this.sortDir, 'ReceivablesModule', 'text-right')}
              ${Utils.Sort.th('입금(대변)', 'credit', this.sortField, this.sortDir, 'ReceivablesModule', 'text-right')}
              ${Utils.Sort.th('잔액', 'balance', this.sortField, this.sortDir, 'ReceivablesModule', 'text-right')}
              <th class="text-center">상태</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
          <tfoot>
            <tr style="font-weight:800;background:var(--color-surface-hover);border-top:2px solid var(--color-border);">
              <td>합계</td>
              <td class="text-right">${Utils.formatCurrency(totDebit)}</td>
              <td class="text-right">${Utils.formatCurrency(totCredit)}</td>
              <td class="text-right" style="color:${totBal > 0 ? '#b45309' : (totBal < 0 ? '#2563eb' : '#059669')};">${Utils.formatCurrency(totBal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;

    Utils.bindSearchInput(document.getElementById('arSearch'), (v) => { this.searchText = v; this.render(); });
  },

  // ===== 건별 명세 (확인요청용): 세금계산서 발행일·입금일을 한 줄씩 펼침 =====
  _ledgerKey(s) {
    return (s || '').toString()
      .replace(/[(（]\s*[주유]\s*[)）]/g, '')
      .replace(/주식회사|유한회사/g, '')
      .replace(/[（）()㈜\s&·.,\-_/]/g, '')
      .toLowerCase().trim();
  },

  async _buildLedger() {
    const kws = this._excludeKw();
    const invoices = (await DB.getAll('taxInvoiceRequests')).filter(i => i.status === '발행완료' && !this._excluded(i.partnerCompanyName, kws));
    const deposits = (await DB.getAll('deposits')).filter(d => !this._excluded(d.depositorName, kws));
    const depositMap = {};
    deposits.forEach(d => { depositMap[String(d.id)] = d; });

    const groups = {};
    const g = (name) => {
      const k = this._ledgerKey(name) || '(거래처 미상)';
      if (!groups[k]) groups[k] = { name: (name || '').trim() || '(거래처 미상)', txns: [] };
      return groups[k];
    };
    const counted = new Set();

    for (const inv of invoices) {
      const r = g(inv.partnerCompanyName);
      r.txns.push({ type: '세금계산서', date: (inv.issueDate || inv.createdAt || '').slice(0, 10), debit: Number(inv.totalAmount) || 0, credit: 0, ref: inv.requestNumber || '' });
      for (const did of this._matchedIds(inv)) {
        const dep = depositMap[did];
        if (dep) { counted.add(did); r.txns.push({ type: '입금', date: (dep.depositDate || '').slice(0, 10), debit: 0, credit: Number(dep.amount) || 0, ref: dep.depositorName || '' }); }
      }
    }
    for (const dep of deposits) {
      if (counted.has(String(dep.id))) continue;
      if (dep.matchStatus === '매칭완료') continue;
      if ((dep.actionRequired || '').startsWith('처리완료')) continue;
      const r = g(dep.depositorName);
      r.txns.push({ type: '입금', date: (dep.depositDate || '').slice(0, 10), debit: 0, credit: Number(dep.amount) || 0, ref: dep.depositorName || '' });
    }

    const out = Object.values(groups).map(grp => {
      grp.txns.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      let bal = 0;
      grp.txns.forEach(t => { bal += t.debit - t.credit; t.balance = bal; });
      grp.debit = grp.txns.reduce((s, t) => s + t.debit, 0);
      grp.credit = grp.txns.reduce((s, t) => s + t.credit, 0);
      grp.balance = grp.debit - grp.credit;
      return grp;
    }).filter(grp => grp.debit !== 0 || grp.credit !== 0)
      .sort((a, b) => b.balance - a.balance);
    return out;
  },

  async _openLedger() {
    const groups = await this._buildLedger();
    this._lastLedger = groups;
    const fmt = (n) => n ? Utils.formatCurrency(n) : '';
    const blocks = groups.map(grp => {
      const rows = grp.txns.map(t => `
        <tr>
          <td>${Utils.escapeHtml(t.date || '-')}</td>
          <td style="text-align:center;"><span style="padding:1px 7px;border-radius:4px;font-size:11px;font-weight:700;background:${t.type === '세금계산서' ? 'rgba(16,185,129,.15);color:#059669' : 'rgba(37,99,235,.12);color:#2563eb'};">${t.type}</span></td>
          <td style="text-align:right;font-family:monospace;">${fmt(t.debit)}</td>
          <td style="text-align:right;font-family:monospace;">${fmt(t.credit)}</td>
          <td style="text-align:right;font-family:monospace;font-weight:700;color:${t.balance > 0 ? '#b45309' : (t.balance < 0 ? '#2563eb' : '#059669')};">${Utils.formatCurrency(t.balance)}</td>
          <td class="text-xs text-muted">${Utils.escapeHtml(t.ref || '')}</td>
        </tr>`).join('');
      const badge = grp.balance > 0 ? '미수' : (grp.balance < 0 ? '미발행/선수' : '완료');
      return `
        <div style="margin-bottom:16px;border:1px solid var(--color-border);border-radius:8px;overflow:hidden;">
          <div style="padding:8px 12px;background:#f8fafc;font-weight:700;display:flex;justify-content:space-between;">
            <span>${Utils.escapeHtml(grp.name)}</span>
            <span>발행 ${Utils.formatCurrency(grp.debit)} · 입금 ${Utils.formatCurrency(grp.credit)} · 잔액 <span style="color:${grp.balance > 0 ? '#b45309' : (grp.balance < 0 ? '#2563eb' : '#059669')};">${Utils.formatCurrency(grp.balance)}</span> (${badge})</span>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:0.86rem;">
            <thead><tr style="background:#fff;border-bottom:1px solid var(--color-border);">
              <th style="padding:6px 8px;text-align:left;color:#64748b;font-size:0.8rem;">날짜</th>
              <th style="padding:6px 8px;text-align:center;color:#64748b;font-size:0.8rem;">구분</th>
              <th style="padding:6px 8px;text-align:right;color:#64748b;font-size:0.8rem;">세금계산서 발행액</th>
              <th style="padding:6px 8px;text-align:right;color:#64748b;font-size:0.8rem;">입금액</th>
              <th style="padding:6px 8px;text-align:right;color:#64748b;font-size:0.8rem;">잔액</th>
              <th style="padding:6px 8px;text-align:left;color:#64748b;font-size:0.8rem;">비고</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join('');

    Utils.openModal(`
      <div class="modal-header">
        <h3>📋 거래처별 건별 명세 <span class="text-xs text-muted" style="font-weight:400;">세금계산서 발행일·입금일 포함 · 확인요청용</span></h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="max-height:72vh;overflow-y:auto;">
        <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="text-sm text-muted">거래처별로 세금계산서(발행일)와 입금(입금일)을 날짜순으로 펼쳤습니다. 상대방이 날짜로 대사할 수 있어요.</div>
          <button class="btn btn-success btn-sm" onclick="ReceivablesModule._exportLedger()">📥 엑셀(CSV) 내보내기</button>
        </div>
        ${groups.length === 0 ? '<div class="text-center text-muted" style="padding:30px;">내역 없음</div>' : blocks}
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button></div>
    `, { size: 'modal-lg' });
  },

  _exportLedger() {
    const groups = this._lastLedger || [];
    const header = ['거래처', '날짜', '구분', '세금계산서 발행액', '입금액', '잔액', '비고'];
    const lines = [header];
    groups.forEach(grp => {
      grp.txns.forEach(t => lines.push([grp.name, t.date, t.type, t.debit || '', t.credit || '', t.balance, t.ref || '']));
      lines.push([grp.name + ' 소계', '', '', grp.debit, grp.credit, grp.balance, grp.balance > 0 ? '미수' : (grp.balance < 0 ? '미발행/선수' : '완료')]);
    });
    const esc = (c) => { const s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = lines.map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `거래처별_건별명세_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    Utils.showToast('엑셀(CSV) 파일을 내려받았습니다.', 'success');
  }
};

window.ReceivablesModule = ReceivablesModule;
