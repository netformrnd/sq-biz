/* ============================================
   설정 / 백업 모듈
   ============================================ */

const SettingsModule = {
  container: null,

  async init(container) {
    this.container = container;
    await this.render();
  },

  async render() {
    // 데이터 통계
    const counts = {
      users: await DB.count('users'),
      invoices: await DB.count('taxInvoiceRequests'),
      deposits: await DB.count('deposits'),
      transfers: await DB.count('transferRecords'),
      matchingLog: await DB.count('matchingLog'),
      auditLog: await DB.count('auditLog')
    };

    const lastBackup = localStorage.getItem('sq_lastBackup');

    this.container.innerHTML = `
      <!-- 데이터 현황 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>📊 데이터 현황</h3>
        </div>
        <div class="card-body">
          <div class="form-row" style="grid-template-columns:repeat(3,1fr);">
            <div style="text-align:center;padding:var(--sp-4);background:var(--color-surface-hover);border-radius:var(--radius-sm);">
              <div class="text-xs text-muted">사용자</div>
              <div class="fw-bold" style="font-size:var(--font-size-xl);">${counts.users}</div>
            </div>
            <div style="text-align:center;padding:var(--sp-4);background:var(--color-surface-hover);border-radius:var(--radius-sm);">
              <div class="text-xs text-muted">세금계산서 요청</div>
              <div class="fw-bold" style="font-size:var(--font-size-xl);">${counts.invoices}</div>
            </div>
            <div style="text-align:center;padding:var(--sp-4);background:var(--color-surface-hover);border-radius:var(--radius-sm);">
              <div class="text-xs text-muted">입금내역</div>
              <div class="fw-bold" style="font-size:var(--font-size-xl);">${counts.deposits}</div>
            </div>
            <div style="text-align:center;padding:var(--sp-4);background:var(--color-surface-hover);border-radius:var(--radius-sm);">
              <div class="text-xs text-muted">송금내역</div>
              <div class="fw-bold" style="font-size:var(--font-size-xl);">${counts.transfers}</div>
            </div>
            <div style="text-align:center;padding:var(--sp-4);background:var(--color-surface-hover);border-radius:var(--radius-sm);">
              <div class="text-xs text-muted">매칭 로그</div>
              <div class="fw-bold" style="font-size:var(--font-size-xl);">${counts.matchingLog}</div>
            </div>
            <div style="text-align:center;padding:var(--sp-4);background:var(--color-surface-hover);border-radius:var(--radius-sm);">
              <div class="text-xs text-muted">감사 로그</div>
              <div class="fw-bold" style="font-size:var(--font-size-xl);">${counts.auditLog}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 백업/복원 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>💾 데이터 백업 / 복원</h3>
        </div>
        <div class="card-body">
          <p class="text-sm text-muted mb-4">
            데이터를 JSON 파일로 백업하고 복원할 수 있습니다. 정기적으로 백업하는 것을 권장합니다.
            ${lastBackup ? `<br>마지막 백업: <strong>${Utils.formatDateTime(lastBackup)}</strong>` : '<br><span class="text-danger">아직 백업한 적이 없습니다.</span>'}
          </p>

          <div class="d-flex gap-4" style="flex-wrap:wrap;">
            <button class="btn btn-primary btn-lg" onclick="SettingsModule._exportBackup()">
              📥 전체 백업 다운로드
            </button>

            <div>
              <button class="btn btn-secondary btn-lg" onclick="document.getElementById('restoreFile').click()">
                📤 백업 복원
              </button>
              <input type="file" id="restoreFile" accept=".json" style="display:none"
                     onchange="SettingsModule._importBackup(this.files[0])">
            </div>
          </div>
        </div>
      </div>

      <!-- CSV 내보내기 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>📄 CSV 내보내기</h3>
        </div>
        <div class="card-body">
          <p class="text-sm text-muted mb-4">개별 데이터를 CSV 파일로 내보내 엑셀에서 확인할 수 있습니다.</p>
          <div class="d-flex gap-2" style="flex-wrap:wrap;">
            <button class="btn btn-secondary" onclick="SettingsModule._exportCSV('taxInvoiceRequests', '세금계산서요청')">세금계산서 요청</button>
            <button class="btn btn-secondary" onclick="SettingsModule._exportCSV('deposits', '입금내역')">입금내역</button>
            <button class="btn btn-secondary" onclick="SettingsModule._exportCSV('transferRecords', '송금내역')">송금내역</button>
            <button class="btn btn-secondary" onclick="SettingsModule._exportCSV('matchingLog', '매칭로그')">매칭 로그</button>
          </div>
        </div>
      </div>

      <!-- 잔디 웹훅 설정 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>💬 잔디(Jandi) 알림 설정</h3>
        </div>
        <div class="card-body">
          <p class="text-sm text-muted mb-4">
            세금계산서 발행 요청이 등록되면 잔디 토픽으로 알림을 보냅니다.<br>
            잔디 토픽 설정 → 서비스 연동 → Incoming Webhook 추가 → 웹훅 URL을 아래에 입력하세요.
          </p>
          <div class="form-group" style="max-width:600px;">
            <label for="jandiUrl">잔디 웹훅 URL</label>
            <div class="d-flex gap-2">
              <input type="url" id="jandiUrl" class="form-control" placeholder="https://wh.jandi.com/connect-api/webhook/..." value="${Utils.escapeHtml(JandiWebhook.getWebhookUrl())}">
              <button class="btn btn-primary" onclick="SettingsModule._saveJandiUrl()">저장</button>
              <button class="btn btn-secondary" onclick="SettingsModule._testJandi()">테스트</button>
            </div>
          </div>
          <div class="text-sm mt-2">
            상태: ${JandiWebhook.isEnabled()
              ? '<span class="badge badge-complete">활성</span>'
              : '<span class="badge badge-reject">비활성</span> (URL을 입력하면 활성화됩니다)'}
          </div>
        </div>
      </div>

      <!-- 감사 로그 -->
      <div class="card">
        <div class="card-header">
          <h3>📝 최근 활동 로그</h3>
        </div>
        <div class="card-body" style="padding:0;" id="auditLogList"></div>
      </div>
    `;

    await this._renderAuditLog();
  },

  _saveJandiUrl() {
    const url = document.getElementById('jandiUrl').value.trim();
    JandiWebhook.setWebhookUrl(url);
    this.render();
    Utils.showToast(url ? '잔디 웹훅 URL이 저장되었습니다.' : '잔디 알림이 비활성화되었습니다.', 'success');
  },

  async _testJandi() {
    if (!JandiWebhook.isEnabled()) {
      Utils.showToast('먼저 웹훅 URL을 입력하고 저장하세요.', 'error');
      return;
    }
    await JandiWebhook.send('🔔 테스트 알림', '스퀘어건축사사무소 업무관리 시스템에서 보낸 테스트 알림입니다.', '#2563EB');
    Utils.showToast('테스트 알림을 전송했습니다. 잔디에서 확인하세요.', 'success');
  },

  async _exportBackup() {
    try {
      const backup = await DB.exportAll();
      const json = JSON.stringify(backup, null, 2);
      const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
      Utils.downloadFile(json, `sq_backup_${date}.json`, 'application/json');
      localStorage.setItem('sq_lastBackup', new Date().toISOString());
      Utils.showToast('백업 파일이 다운로드되었습니다.', 'success');
      await this.render(); // 마지막 백업 날짜 갱신
    } catch (err) {
      Utils.showToast('백업 실패: ' + err.message, 'error');
    }
  },

  async _importBackup(file) {
    if (!file) return;

    const confirmed = await Utils.confirm(
      '기존 데이터를 모두 삭제하고 백업 파일로 복원합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?',
      '⚠️ 데이터 복원'
    );
    if (!confirmed) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup.data || !backup.version) {
        throw new Error('유효하지 않은 백업 파일입니다.');
      }

      await DB.importAll(backup);
      await DB.log('IMPORT', 'system', null, '데이터 복원 완료');
      Utils.showToast('데이터가 성공적으로 복원되었습니다. 페이지를 새로고침합니다.', 'success');

      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      Utils.showToast('복원 실패: ' + err.message, 'error');
    }
  },

  async _exportCSV(storeName, label) {
    try {
      const records = await DB.getAll(storeName);
      if (records.length === 0) {
        Utils.showToast('내보낼 데이터가 없습니다.', 'warning');
        return;
      }

      // 컬럼 선정 (Blob 제외)
      const skipKeys = ['attachments', 'passwordHash'];
      const headers = Object.keys(records[0]).filter(k => !skipKeys.includes(k));

      const rows = [headers.join(',')];
      for (const r of records) {
        const vals = headers.map(h => Utils.escapeCSV(r[h]));
        rows.push(vals.join(','));
      }

      const bom = '\uFEFF';
      const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
      Utils.downloadFile(bom + rows.join('\n'), `${label}_${date}.csv`, 'text/csv;charset=utf-8');
      Utils.showToast(`${label} CSV 파일이 다운로드되었습니다.`, 'success');
    } catch (err) {
      Utils.showToast('CSV 내보내기 실패: ' + err.message, 'error');
    }
  },

  async _renderAuditLog() {
    const logs = (await DB.getAll('auditLog')).reverse().slice(0, 20);
    const el = document.getElementById('auditLogList');
    if (!el) return;

    if (logs.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:var(--sp-6);"><p>활동 로그가 없습니다</p></div>';
      return;
    }

    const actionIcons = {
      CREATE: '➕', UPDATE: '✏️', DELETE: '🗑️', LOGIN: '🔑', MATCH: '🔗', IMPORT: '📤'
    };

    el.innerHTML = logs.map(log => `
      <div style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--color-border);">
        <span style="font-size:16px;">${actionIcons[log.action] || '📌'}</span>
        <div style="flex:1;">
          <div class="text-sm">
            <span class="fw-medium">${Utils.escapeHtml(log.userName || '-')}</span>
            <span class="text-muted"> · ${Utils.escapeHtml(log.details || '')}</span>
          </div>
          <div class="text-xs text-muted">${Utils.formatDateTime(log.timestamp)}</div>
        </div>
      </div>
    `).join('');
  },

  destroy() {}
};

window.SettingsModule = SettingsModule;
