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

      <!-- Firebase 연동 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>☁️ 클라우드 동기화 (Firebase)</h3>
        </div>
        <div class="card-body">
          <div class="mb-4">
            현재 상태:
            ${FirebaseDB.isConfigured()
              ? (FirebaseDB.isUsingEmbedded()
                  ? '<span class="badge badge-complete">✅ 클라우드 자동 연결됨 (앱 내장 설정 사용)</span>'
                  : '<span class="badge badge-complete">✅ 클라우드 연결됨 (사용자 정의 설정)</span>')
              : '<span class="badge badge-reject">❌ 연결 안됨 (각 브라우저 로컬 저장)</span>'}
          </div>
          <p class="text-sm text-muted mb-4">
            ${FirebaseDB.isUsingEmbedded()
              ? '✨ <strong>이 앱은 이미 Firebase에 자동 연결됩니다.</strong> 직원들은 URL만 접속하면 모두 같은 데이터를 공유합니다.<br>다른 Firebase 프로젝트를 사용하려면 아래에 새 설정을 입력하세요.'
              : 'Firebase 설정 시 모든 직원이 같은 데이터를 공유합니다.<br><strong>설정 방법:</strong> <a href="https://console.firebase.google.com" target="_blank" style="color:var(--color-primary);">Firebase Console</a>에서 프로젝트 생성 → Firestore Database 활성화 → 웹 앱 등록 → firebaseConfig 복사'}
          </p>

          <div class="form-group">
            <label for="firebaseConfigInput">Firebase 설정 (firebaseConfig 객체 전체 붙여넣기)</label>
            <textarea id="firebaseConfigInput" class="form-control" rows="10" placeholder='{
  "apiKey": "AIza...",
  "authDomain": "sq-biz.firebaseapp.com",
  "projectId": "sq-biz",
  "storageBucket": "sq-biz.appspot.com",
  "messagingSenderId": "...",
  "appId": "..."
}' style="font-family:monospace;font-size:12px;">${FirebaseDB.isConfigured() ? JSON.stringify(FirebaseDB.getConfig(), null, 2) : ''}</textarea>
          </div>

          <div class="d-flex gap-2" style="flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="SettingsModule._saveFirebaseConfig()">💾 설정 저장</button>
            ${FirebaseDB.isConfigured() ? `
              <button class="btn btn-success" onclick="SettingsModule._migrateToFirebase()">🚀 로컬 데이터를 클라우드로 이관</button>
              <button class="btn btn-danger" onclick="SettingsModule._disconnectFirebase()">🔌 연결 해제</button>
            ` : ''}
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
          <p class="text-sm text-muted mb-4">각 내역별 핵심 컬럼만 추려서 CSV로 다운로드합니다. (엑셀에서 바로 열기 가능)</p>
          <div class="d-flex gap-2" style="flex-wrap:wrap;">
            <button class="btn btn-secondary" onclick="SettingsModule._exportCSV('taxInvoiceRequests')">📝 세금계산서 발행내역</button>
            <button class="btn btn-secondary" onclick="SettingsModule._exportCSV('deposits')">💰 입금내역</button>
            <button class="btn btn-secondary" onclick="SettingsModule._exportCSV('transferRecords')">💸 송금내역</button>
            <button class="btn btn-secondary" onclick="SettingsModule._exportCSV('matchingLog')">🔗 매칭 로그</button>
          </div>
        </div>
      </div>

      <!-- 문서보관 파일 일괄 다운로드 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>📁 문서보관 파일 일괄 다운로드</h3>
        </div>
        <div class="card-body">
          <p class="text-sm text-muted mb-4">
            문서보관에 저장된 모든 파일(사업자등록증, 계약서 등)을 <strong>ZIP 파일로 일괄 다운로드</strong>합니다.<br>
            <span class="text-muted">거래처별로 폴더가 생성되며, 초기화 대비 백업용으로 사용하세요.</span>
          </p>
          <div class="d-flex gap-2" style="flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="SettingsModule._downloadAllDocuments()">📥 전체 문서 ZIP 다운로드</button>
            <button class="btn btn-secondary" onclick="SettingsModule._downloadDocumentsByCategory('사업자등록증')">📄 사업자등록증만</button>
            <button class="btn btn-secondary" onclick="SettingsModule._downloadDocumentsByCategory('계약서')">📑 계약서만</button>
          </div>
          <div id="docDownloadProgress" class="hidden mt-4">
            <div class="progress-bar"><div class="progress-fill" id="docDownloadFill" style="width:0%"></div></div>
            <div class="progress-text" id="docDownloadText"></div>
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

  // ===== Firebase 설정 =====
  async _saveFirebaseConfig() {
    const raw = document.getElementById('firebaseConfigInput').value.trim();
    if (!raw) {
      Utils.showToast('Firebase 설정을 입력하세요.', 'error');
      return;
    }

    try {
      let config = null;
      let text = raw;

      // 1. 전체 JS 코드에서 중괄호 { ... } 부분만 추출
      // 예: "const firebaseConfig = { ... };" → "{ ... }"
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        text = braceMatch[0];
      }

      // 2. 주석 제거
      text = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

      // 3. JSON 파싱 시도
      try {
        config = JSON.parse(text);
      } catch {
        // 4. JS 객체 형태를 JSON으로 변환
        // "key: value" → "\"key\": value"
        // 마지막 콤마 제거 (trailing comma)
        let jsonStr = text
          .replace(/'/g, '"')                    // ' → "
          .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')  // key: → "key":
          .replace(/,(\s*[}\]])/g, '$1');        // 마지막 콤마 제거

        try {
          config = JSON.parse(jsonStr);
        } catch (e2) {
          // 5. eval로 직접 파싱 (마지막 수단)
          try {
            config = Function('"use strict"; return (' + text + ')')();
          } catch (e3) {
            throw new Error('설정 형식을 파싱할 수 없습니다. Firebase 콘솔에서 복사한 내용 그대로 붙여넣어 주세요.');
          }
        }
      }

      if (!config || typeof config !== 'object') {
        throw new Error('유효한 설정이 아닙니다.');
      }

      if (!config.apiKey) {
        throw new Error('apiKey가 없습니다. Firebase 콘솔에서 올바르게 복사했는지 확인하세요.');
      }
      if (!config.projectId) {
        throw new Error('projectId가 없습니다. Firebase 콘솔에서 올바르게 복사했는지 확인하세요.');
      }

      FirebaseDB.setConfig(config);
      Utils.showToast('Firebase 설정 저장 완료. 페이지를 새로고침합니다.', 'success');
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      console.error('[Firebase 설정 오류]', err);
      Utils.showToast('설정 실패: ' + err.message, 'error', 8000);
    }
  },

  async _migrateToFirebase() {
    const confirmed = await Utils.confirm(
      '현재 이 브라우저의 로컬 데이터를 Firebase 클라우드로 이관합니다.\n' +
      '이미 클라우드에 데이터가 있으면 중복될 수 있습니다.\n\n' +
      '계속하시겠습니까?',
      '클라우드로 데이터 이관'
    );
    if (!confirmed) return;

    try {
      Utils.showToast('데이터 이관 중... 잠시만 기다려주세요.', 'warning', 30000);

      // IndexedDB에서 직접 읽어서 Firebase에 쓰기
      const storeNames = ['users', 'taxInvoiceRequests', 'deposits', 'transferRecords', 'matchingLog', 'auditLog', 'documents'];

      // IndexedDB 직접 열기 (useFirebase 우회)
      const idb = await new Promise((resolve, reject) => {
        const req = indexedDB.open('sq_architects_db', 2);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => reject(req.error);
      });

      let totalCount = 0;
      for (const storeName of storeNames) {
        if (!idb.objectStoreNames.contains(storeName)) continue;
        const records = await new Promise((resolve) => {
          const tx = idb.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
        for (const record of records) {
          const { id, ...rest } = record;
          // attachments의 Blob은 별도 처리 필요 - 일단 제거
          if (rest.attachments) {
            rest.attachments = rest.attachments.filter(a => !(a.fileData instanceof Blob));
          }
          if (rest.fileData instanceof Blob) {
            delete rest.fileData;
          }
          await FirebaseDB.add(storeName, rest);
          totalCount++;
        }
      }

      idb.close();
      Utils.showToast(`${totalCount}개 데이터 이관 완료! (첨부파일은 제외됨)`, 'success');
      setTimeout(() => location.reload(), 2000);
    } catch (err) {
      Utils.showToast('이관 실패: ' + err.message, 'error');
    }
  },

  async _disconnectFirebase() {
    const confirmed = await Utils.confirm(
      'Firebase 연결을 해제하면 로컬(IndexedDB)만 사용합니다.\n' +
      '클라우드 데이터는 삭제되지 않고 보존됩니다.\n\n계속하시겠습니까?',
      'Firebase 연결 해제'
    );
    if (!confirmed) return;
    FirebaseDB.setConfig(null);
    Utils.showToast('Firebase 연결이 해제되었습니다. 페이지를 새로고침합니다.', 'success');
    setTimeout(() => location.reload(), 1500);
  },

  // ===== 문서 파일 일괄 다운로드 (ZIP) =====
  async _loadJSZip() {
    if (window.JSZip) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('JSZip 로드 실패'));
      document.head.appendChild(s);
    });
  },

  async _downloadAllDocuments() {
    await this._downloadDocsZip(null);
  },

  async _downloadDocumentsByCategory(category) {
    await this._downloadDocsZip(category);
  },

  async _downloadDocsZip(categoryFilter) {
    const progressEl = document.getElementById('docDownloadProgress');
    const fillEl = document.getElementById('docDownloadFill');
    const textEl = document.getElementById('docDownloadText');

    try {
      progressEl.classList.remove('hidden');
      fillEl.style.background = 'var(--color-primary)';
      fillEl.style.width = '5%';
      textEl.textContent = 'JSZip 로드중...';

      await this._loadJSZip();

      fillEl.style.width = '10%';
      textEl.textContent = '문서 목록 조회중...';

      let docs = await DB.getAll('documents');
      if (categoryFilter) {
        docs = docs.filter(d => d.category === categoryFilter);
      }

      if (docs.length === 0) {
        Utils.showToast('다운로드할 문서가 없습니다.', 'warning');
        progressEl.classList.add('hidden');
        return;
      }

      const zip = new JSZip();
      let processedCount = 0;
      let skippedCount = 0;

      for (const doc of docs) {
        try {
          let blob = null;

          if (doc.fileData instanceof Blob) {
            // IndexedDB 직접 저장된 Blob
            blob = doc.fileData;
          } else if (typeof doc.fileData === 'string' && doc.fileData.startsWith('data:')) {
            // base64 → Blob 변환 (Firebase)
            blob = this._base64ToBlob(doc.fileData, doc.fileType);
          } else if (typeof doc.fileData === 'string' && doc.fileData.length > 0) {
            // data: prefix 없는 base64
            try {
              blob = this._base64ToBlob('data:' + (doc.fileType || 'application/octet-stream') + ';base64,' + doc.fileData, doc.fileType);
            } catch (e) {
              skippedCount++;
              continue;
            }
          } else {
            skippedCount++;
            continue;
          }

          // 폴더 경로: 카테고리/거래처명/파일명
          const safeCompany = (doc.companyName || '미분류').replace(/[\/\\:*?"<>|]/g, '_');
          const safeCategory = (doc.category || '기타').replace(/[\/\\:*?"<>|]/g, '_');
          const safeFileName = (doc.fileName || 'unnamed').replace(/[\/\\:*?"<>|]/g, '_');

          // 중복 파일명 방지: 날짜 prefix 추가
          const datePrefix = doc.createdAt ? doc.createdAt.split('T')[0].replace(/-/g, '') + '_' : '';
          const folderPath = `${safeCategory}/${safeCompany}/`;
          const filePath = folderPath + datePrefix + safeFileName;

          zip.file(filePath, blob);
          processedCount++;

          // 진행률 업데이트
          const progress = 10 + (processedCount / docs.length) * 80;
          fillEl.style.width = `${progress}%`;
          textEl.textContent = `파일 추가중... ${processedCount} / ${docs.length}`;
        } catch (e) {
          console.warn('[문서다운로드] 파일 처리 실패:', doc.fileName, e);
          skippedCount++;
        }
      }

      if (processedCount === 0) {
        Utils.showToast('다운로드 가능한 파일이 없습니다. (Blob 데이터 없음)', 'warning');
        progressEl.classList.add('hidden');
        return;
      }

      textEl.textContent = 'ZIP 압축중... (파일이 많으면 시간이 걸릴 수 있습니다)';
      fillEl.style.width = '95%';

      const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

      const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const suffix = categoryFilter ? `_${categoryFilter}` : '';
      const filename = `sq-biz-documents${suffix}_${date}.zip`;

      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      fillEl.style.width = '100%';
      fillEl.style.background = 'var(--color-success)';
      textEl.textContent = `완료! ${processedCount}개 파일 다운로드${skippedCount > 0 ? ` (${skippedCount}개 스킵)` : ''}`;

      Utils.showToast(`${processedCount}개 파일을 ZIP으로 다운로드했습니다.`, 'success');

      setTimeout(() => progressEl.classList.add('hidden'), 3000);
    } catch (err) {
      console.error('[문서다운로드]', err);
      fillEl.style.background = 'var(--color-danger)';
      textEl.textContent = '실패: ' + err.message;
      Utils.showToast('다운로드 실패: ' + err.message, 'error');
    }
  },

  _base64ToBlob(base64, mimeType) {
    const parts = base64.split(',');
    const byteString = atob(parts[1] || parts[0]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new Blob([ab], { type: mimeType || 'application/octet-stream' });
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
    // 비밀번호 입력 팝업
    Utils.openModal(`
      <div class="modal-header">
        <h3>🔒 백업 파일 암호화</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <p class="mb-4 text-sm">백업 파일을 암호화할 비밀번호를 입력하세요.<br>
        <span class="text-muted">※ 이 비밀번호는 복원 시 필요합니다. 분실 시 복원 불가!</span></p>
        <div class="form-group">
          <label for="backupPw">백업 비밀번호 (8자 이상)</label>
          <input type="password" id="backupPw" class="form-control" minlength="8" autofocus>
        </div>
        <div class="form-group">
          <label for="backupPwConfirm">비밀번호 확인</label>
          <input type="password" id="backupPwConfirm" class="form-control" minlength="8">
        </div>
        <div style="display:flex;align-items:center;gap:var(--sp-2);">
          <input type="checkbox" id="backupNoEncrypt">
          <label for="backupNoEncrypt" class="text-sm text-muted" style="margin:0;cursor:pointer;">암호화 없이 저장 (권장하지 않음)</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="SettingsModule._confirmExport()">백업 다운로드</button>
      </div>
    `);
  },

  async _confirmExport() {
    const noEncrypt = document.getElementById('backupNoEncrypt').checked;
    const pw = document.getElementById('backupPw').value;
    const pwConfirm = document.getElementById('backupPwConfirm').value;

    if (!noEncrypt) {
      if (pw.length < 8) { Utils.showToast('비밀번호는 8자 이상이어야 합니다.', 'error'); return; }
      if (pw !== pwConfirm) { Utils.showToast('비밀번호가 일치하지 않습니다.', 'error'); return; }
    }

    try {
      const backup = await DB.exportAll();
      const json = JSON.stringify(backup);
      const date = new Date().toISOString().split('T')[0].replace(/-/g, '');

      let output, filename;
      if (noEncrypt) {
        output = json;
        filename = `sq_backup_${date}.json`;
      } else {
        const encrypted = await CryptoHelper.encrypt(json, pw);
        output = JSON.stringify({ encrypted: true, data: encrypted, version: 2 });
        filename = `sq_backup_${date}.enc.json`;
      }

      Utils.downloadFile(output, filename, 'application/json');
      localStorage.setItem('sq_lastBackup', new Date().toISOString());
      Utils.closeModal();
      Utils.showToast(noEncrypt ? '백업 파일이 다운로드되었습니다.' : '암호화된 백업 파일이 다운로드되었습니다.', 'success');
      await this.render();
    } catch (err) {
      Utils.showToast('백업 실패: ' + err.message, 'error');
    }
  },

  async _importBackup(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      // 암호화 여부 확인
      if (parsed.encrypted) {
        Utils.openModal(`
          <div class="modal-header">
            <h3>🔒 암호화된 백업 복원</h3>
            <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
          </div>
          <div class="modal-body">
            <p class="mb-4 text-sm">백업 시 설정한 비밀번호를 입력하세요.</p>
            <div class="form-group">
              <label for="restorePw">백업 비밀번호</label>
              <input type="password" id="restorePw" class="form-control" autofocus>
            </div>
            <div id="restoreError" class="text-danger text-sm"></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
            <button class="btn btn-primary" onclick='SettingsModule._confirmImportEncrypted(${JSON.stringify(parsed.data)})'>복원</button>
          </div>
        `);
        return;
      }

      // 평문 백업
      await this._doImport(parsed);
    } catch (err) {
      Utils.showToast('복원 실패: ' + err.message, 'error');
    }
  },

  async _confirmImportEncrypted(encryptedData) {
    const pw = document.getElementById('restorePw').value;
    const errEl = document.getElementById('restoreError');
    if (!pw) { errEl.textContent = '비밀번호를 입력하세요.'; return; }

    try {
      const decrypted = await CryptoHelper.decrypt(encryptedData, pw);
      const backup = JSON.parse(decrypted);
      Utils.closeModal();
      await this._doImport(backup);
    } catch (err) {
      errEl.textContent = '비밀번호가 일치하지 않거나 파일이 손상되었습니다.';
    }
  },

  async _doImport(backup) {
    if (!backup.data || !backup.version) {
      throw new Error('유효하지 않은 백업 파일입니다.');
    }

    const confirmed = await Utils.confirm(
      '기존 데이터를 모두 삭제하고 백업 파일로 복원합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?',
      '⚠️ 데이터 복원'
    );
    if (!confirmed) return;

    await DB.importAll(backup);
    await DB.log('IMPORT', 'system', null, '데이터 복원 완료');
    Utils.showToast('데이터가 성공적으로 복원되었습니다. 페이지를 새로고침합니다.', 'success');
    setTimeout(() => location.reload(), 1500);
  },

  // 데이터별 내보내기 컬럼 정의 (핵심 컬럼만)
  _CSV_EXPORTS: {
    taxInvoiceRequests: {
      filename: '세금계산서발행내역',
      sortKey: 'issueDate',
      columns: [
        { key: 'issueDate',          label: '작성일자' },
        { key: 'requestNumber',      label: '요청번호' },
        { key: 'status',             label: '상태' },
        { key: 'partnerCompanyName', label: '거래처' },
        { key: 'partnerRegNumber',   label: '사업자등록번호' },
        { key: 'partnerCeoName',     label: '대표자명' },
        { key: 'supplyAmount',       label: '공급가액' },
        { key: 'taxAmount',          label: '세액' },
        { key: 'totalAmount',        label: '합계금액' },
        { key: 'projectName',        label: '프로젝트/비고' },
        { key: 'hometaxApprovalNo',  label: '승인번호' },
        { key: '_matched',           label: '입금매칭' },
        { key: 'requesterName',      label: '등록자' },
        { key: '_createdDate',       label: '등록일' }
      ],
      transform: (r) => {
        r._matched = r.matchedDepositId ? 'Y' : '';
        r._createdDate = (r.createdAt || '').split('T')[0];
      }
    },
    deposits: {
      filename: '입금내역',
      sortKey: 'depositDate',
      columns: [
        { key: 'depositDate',    label: '입금일자' },
        { key: 'depositorName',  label: '입금자' },
        { key: 'amount',         label: '금액' },
        { key: 'matchStatus',    label: '매칭상태' },
        { key: '_matchedInvoice', label: '매칭요청번호' },
        { key: 'projectName',    label: '프로젝트' },
        { key: 'memo',           label: '메모' },
        { key: 'registeredByName', label: '등록자' },
        { key: '_createdDate',   label: '등록일' }
      ],
      transform: async (r) => {
        r._createdDate = (r.createdAt || '').split('T')[0];
        if (r.matchedInvoiceId) {
          try {
            const inv = await DB.get('taxInvoiceRequests', r.matchedInvoiceId);
            r._matchedInvoice = inv ? `${inv.requestNumber} (${inv.partnerCompanyName})` : '';
          } catch { r._matchedInvoice = ''; }
        } else {
          r._matchedInvoice = '';
        }
      }
    },
    transferRecords: {
      filename: '송금내역',
      sortKey: 'transferDate',
      columns: [
        { key: 'transferDate',   label: '송금일자' },
        { key: 'recipientName',  label: '수취인' },
        { key: 'amount',         label: '금액' },
        { key: 'purpose',        label: '용도' },
        { key: 'projectName',    label: '프로젝트' },
        { key: 'memo',           label: '메모' },
        { key: 'registeredByName', label: '등록자' },
        { key: '_createdDate',   label: '등록일' }
      ],
      transform: (r) => {
        r._createdDate = (r.createdAt || '').split('T')[0];
      }
    },
    matchingLog: {
      filename: '매칭로그',
      sortKey: 'matchedAt',
      columns: [
        { key: '_matchedDate',  label: '매칭일시' },
        { key: '_invoiceInfo',  label: '세금계산서' },
        { key: '_depositInfo',  label: '입금' },
        { key: 'matchedAmount', label: '매칭금액' },
        { key: 'matchedByName', label: '매칭담당자' },
        { key: 'memo',          label: '메모' }
      ],
      transform: async (r) => {
        r._matchedDate = (r.matchedAt || '').replace('T', ' ').slice(0, 16);
        try {
          if (r.invoiceId) {
            const inv = await DB.get('taxInvoiceRequests', r.invoiceId);
            r._invoiceInfo = inv ? `${inv.requestNumber} ${inv.partnerCompanyName}` : '';
          }
          if (r.depositId) {
            const dep = await DB.get('deposits', r.depositId);
            r._depositInfo = dep ? `${dep.depositDate} ${dep.depositorName}` : '';
          }
        } catch {}
        r._invoiceInfo = r._invoiceInfo || '';
        r._depositInfo = r._depositInfo || '';
      }
    }
  },

  async _exportCSV(storeName) {
    const def = this._CSV_EXPORTS[storeName];
    if (!def) {
      Utils.showToast('내보내기 설정이 정의되지 않았습니다.', 'error');
      return;
    }

    try {
      let records = await DB.getAll(storeName);
      if (records.length === 0) {
        Utils.showToast('내보낼 데이터가 없습니다.', 'warning');
        return;
      }

      // 정렬
      if (def.sortKey) {
        records.sort((a, b) => String(a[def.sortKey] || '').localeCompare(String(b[def.sortKey] || '')));
      }

      // 가공(transform)
      if (def.transform) {
        for (const r of records) {
          const result = def.transform(r);
          if (result instanceof Promise) await result;
        }
      }

      // 헤더 + 데이터
      const headers = def.columns.map(c => c.label);
      const rows = [headers.map(h => Utils.escapeCSV(h)).join(',')];
      for (const r of records) {
        const vals = def.columns.map(c => Utils.escapeCSV(r[c.key]));
        rows.push(vals.join(','));
      }

      const bom = '\uFEFF';
      const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
      Utils.downloadFile(bom + rows.join('\n'), `${def.filename}_${date}.csv`, 'text/csv;charset=utf-8');
      Utils.showToast(`${def.filename} ${records.length}건 다운로드 완료`, 'success');
    } catch (err) {
      console.error(err);
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
