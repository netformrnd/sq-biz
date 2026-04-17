/* ============================================
   문서보관 모듈
   - 사업자등록증, 계약서를 사업자명별로 보관
   - 가나다순 정렬, 검색 기능
   ============================================ */

const DocumentsModule = {
  container: null,
  searchText: '',
  filterCategory: 'all',

  async init(container) {
    this.container = container;
    this.searchText = '';
    this.filterCategory = 'all';
    await this.render();
  },

  async render() {
    const allDocs = await DB.getAll('documents');

    // 날짜 필터
    DateFilter.onChange('documents', () => this.render());
    let filtered = DateFilter.filter(allDocs, 'createdAt', 'documents');

    // 검색 필터
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      filtered = filtered.filter(d =>
        (d.companyName || '').toLowerCase().includes(q) ||
        (d.regNumber || '').includes(q) ||
        (d.fileName || '').toLowerCase().includes(q) ||
        (d.relatedRequestNumber || '').toLowerCase().includes(q)
      );
    }
    if (this.filterCategory !== 'all') {
      filtered = filtered.filter(d => d.category === this.filterCategory);
    }

    // 사업자명별 그룹핑
    const grouped = {};
    for (const doc of filtered) {
      const key = doc.companyName || '미분류';
      if (!grouped[key]) grouped[key] = { companyName: key, regNumber: doc.regNumber || '', docs: [] };
      grouped[key].docs.push(doc);
    }

    // 가나다순 정렬
    const sortedGroups = Object.values(grouped).sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));

    // 카테고리 카운트
    const catCounts = { all: allDocs.length };
    allDocs.forEach(d => {
      catCounts[d.category] = (catCounts[d.category] || 0) + 1;
    });

    // 그룹별 HTML
    let groupsHtml = '';
    if (sortedGroups.length === 0) {
      groupsHtml = `
        <div class="empty-state" style="padding:var(--sp-10);">
          <div class="empty-icon">📁</div>
          <h3>보관된 문서가 없습니다</h3>
          <p class="text-sm text-muted">세금계산서 발행 요청 시 첨부한 사업자등록증과 계약서가 자동으로 보관됩니다.</p>
        </div>
      `;
    } else {
      groupsHtml = sortedGroups.map(group => {
        const docsHtml = group.docs.map(doc => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--sp-2) var(--sp-4);border-bottom:1px solid var(--color-border);">
            <div class="d-flex items-center gap-3">
              <span>${doc.category === '계약서' ? '📑' : '📄'}</span>
              <div>
                <div class="text-sm fw-medium">${Utils.escapeHtml(doc.fileName)}</div>
                <div class="text-xs text-muted">
                  <span class="badge ${doc.category === '계약서' ? 'badge-review' : 'badge-request'}" style="font-size:10px;">${Utils.escapeHtml(doc.category)}</span>
                  ${doc.relatedRequestNumber ? `· ${Utils.escapeHtml(doc.relatedRequestNumber)}` : ''}
                  · ${Utils.formatDate(doc.createdAt)}
                </div>
              </div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-ghost btn-sm" onclick="DocumentsModule._renameDoc(${doc.id})" title="이름변경">✏️</button>
              <button class="btn btn-ghost btn-sm" onclick="DocumentsModule._viewDoc(${doc.id})" title="보기">👁️</button>
              <button class="btn btn-ghost btn-sm" onclick="DocumentsModule._downloadDoc(${doc.id})" title="다운로드">💾</button>
              ${Auth.isAdmin() ? `<button class="btn btn-ghost btn-sm text-danger" onclick="DocumentsModule._deleteDoc(${doc.id})" title="삭제">🗑️</button>` : ''}
            </div>
          </div>
        `).join('');

        return `
          <div class="card mb-4">
            <div class="card-header" style="cursor:pointer;" onclick="this.nextElementSibling.classList.toggle('hidden')">
              <div>
                <h3 style="font-size:var(--font-size-md);">${Utils.escapeHtml(group.companyName)}</h3>
                ${group.regNumber ? `<span class="text-xs text-muted">${Utils.escapeHtml(group.regNumber)}</span>` : ''}
              </div>
              <span class="text-sm text-muted">${group.docs.length}개 문서</span>
            </div>
            <div class="card-body" style="padding:0;">
              ${docsHtml}
            </div>
          </div>
        `;
      }).join('');
    }

    this.container.innerHTML = `
      <div class="page-header">
        <h2>문서보관</h2>
        ${Auth.isAdmin() ? `
          <div class="page-actions">
            <button class="btn btn-primary" onclick="DocumentsModule._openUploadModal()">+ 문서 업로드</button>
          </div>
        ` : ''}
      </div>

      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon blue">📁</div>
          <div class="card-info">
            <div class="card-label">전체 문서</div>
            <div class="card-value">${allDocs.length}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon cyan">📄</div>
          <div class="card-info">
            <div class="card-label">사업자등록증</div>
            <div class="card-value">${catCounts['사업자등록증'] || 0}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon orange">📑</div>
          <div class="card-info">
            <div class="card-label">계약서</div>
            <div class="card-value">${catCounts['계약서'] || 0}건</div>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon green">🏢</div>
          <div class="card-info">
            <div class="card-label">거래처 수</div>
            <div class="card-value">${sortedGroups.length}곳</div>
          </div>
        </div>
      </div>

      <!-- 날짜 필터 -->
      <div class="mb-4">${DateFilter.render('documents')}</div>

      <!-- 검색 + 필터 -->
      <div class="filter-bar mb-4">
        <div class="search-input" style="flex:1;">
          <span class="search-icon">🔍</span>
          <input type="text" class="form-control" id="docSearch" placeholder="사업자명, 사업자번호, 파일명 검색..." value="${Utils.escapeHtml(this.searchText)}">
        </div>
        <div class="d-flex gap-2">
          <button class="btn ${this.filterCategory === 'all' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="DocumentsModule._setFilter('all')">전체</button>
          <button class="btn ${this.filterCategory === '사업자등록증' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="DocumentsModule._setFilter('사업자등록증')">사업자등록증</button>
          <button class="btn ${this.filterCategory === '계약서' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="DocumentsModule._setFilter('계약서')">계약서</button>
        </div>
      </div>

      <!-- 문서 목록 (사업자명별 가나다순) -->
      ${groupsHtml}
    `;

    document.getElementById('docSearch').addEventListener('input', Utils.debounce((e) => {
      this.searchText = e.target.value;
      this.render();
    }, 300));
  },

  _setFilter(cat) {
    this.filterCategory = cat;
    this.render();
  },

  async _renameDoc(id) {
    const doc = await DB.get('documents', id);
    if (!doc) return;

    // 확장자 분리
    const lastDot = doc.fileName.lastIndexOf('.');
    const nameOnly = lastDot > 0 ? doc.fileName.substring(0, lastDot) : doc.fileName;
    const ext = lastDot > 0 ? doc.fileName.substring(lastDot) : '';

    Utils.openModal(`
      <div class="modal-header">
        <h3>파일명 변경</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="text-sm text-muted mb-4">현재: <strong>${Utils.escapeHtml(doc.fileName)}</strong></div>
        <div class="form-group">
          <label for="renameInput">새 파일명</label>
          <div class="d-flex gap-2 items-center">
            <input type="text" id="renameInput" class="form-control" value="${Utils.escapeHtml(nameOnly)}" style="flex:1;">
            <span class="text-sm text-muted fw-medium">${Utils.escapeHtml(ext)}</span>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="DocumentsModule._confirmRename(${id}, '${Utils.escapeHtml(ext)}')">저장</button>
      </div>
    `);

    // 입력란 포커스 + 전체 선택
    setTimeout(() => {
      const input = document.getElementById('renameInput');
      if (input) { input.focus(); input.select(); }
    }, 100);
  },

  async _confirmRename(id, ext) {
    const newName = document.getElementById('renameInput').value.trim();
    if (!newName) {
      Utils.showToast('파일명을 입력해 주세요.', 'error');
      return;
    }

    const doc = await DB.get('documents', id);
    doc.fileName = newName + ext;
    await DB.update('documents', doc);
    await DB.log('UPDATE', 'document', id, `파일명 변경: ${doc.fileName}`);

    Utils.closeModal();
    await this.render();
  },

  async _viewDoc(id) {
    const doc = await DB.get('documents', id);
    if (!doc || !doc.fileData) return;

    let contentHtml = '';
    if (doc.fileData instanceof Blob) {
      const url = URL.createObjectURL(doc.fileData);
      if (doc.fileType && doc.fileType.startsWith('image/')) {
        contentHtml = `<img src="${url}" style="max-width:100%;border-radius:var(--radius-sm);">`;
      } else {
        contentHtml = `<iframe src="${url}" style="width:100%;height:500px;border:none;border-radius:var(--radius-sm);"></iframe>`;
      }
    }

    Utils.openModal(`
      <div class="modal-header">
        <h3>${Utils.escapeHtml(doc.fileName)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="mb-4 text-sm text-muted">
          거래처: <strong>${Utils.escapeHtml(doc.companyName)}</strong>
          · 구분: ${Utils.escapeHtml(doc.category)}
          · 등록일: ${Utils.formatDate(doc.createdAt)}
        </div>
        ${contentHtml}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">닫기</button>
        <button class="btn btn-primary" onclick="DocumentsModule._downloadDoc(${id}); Utils.closeModal();">💾 다운로드</button>
      </div>
    `, { size: 'modal-lg' });
  },

  async _downloadDoc(id) {
    const doc = await DB.get('documents', id);
    if (!doc || !doc.fileData) return;

    const blob = doc.fileData instanceof Blob ? doc.fileData : new Blob([doc.fileData]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  async _deleteDoc(id) {
    const confirmed = await Utils.confirm('이 문서를 삭제하시겠습니까?', '문서 삭제');
    if (!confirmed) return;
    await DB.delete('documents', id);
    await DB.log('DELETE', 'document', id, '문서 삭제');
    await this.render();
  },

  // 수동 문서 업로드
  _openUploadModal() {
    Utils.openModal(`
      <div class="modal-header">
        <h3>문서 업로드</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label for="docCompany">사업자명 <span class="required">*</span></label>
            <input type="text" id="docCompany" class="form-control" placeholder="거래처 상호" required>
          </div>
          <div class="form-group">
            <label for="docRegNum">사업자등록번호</label>
            <input type="text" id="docRegNum" class="form-control" placeholder="000-00-00000">
          </div>
        </div>
        <div class="form-group">
          <label for="docCategory">문서 구분 <span class="required">*</span></label>
          <select id="docCategory" class="form-control" required>
            <option value="사업자등록증">사업자등록증</option>
            <option value="계약서">계약서</option>
            <option value="기타">기타</option>
          </select>
        </div>
        <div class="form-group">
          <label>파일 첨부 <span class="required">*</span></label>
          <input type="file" id="docFile" class="form-control" accept="image/*,.pdf" multiple required>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="DocumentsModule._saveUpload()">업로드</button>
      </div>
    `);
  },

  async _saveUpload() {
    const company = document.getElementById('docCompany').value.trim();
    const regNum = document.getElementById('docRegNum').value.trim();
    const category = document.getElementById('docCategory').value;
    const files = document.getElementById('docFile').files;

    if (!company || files.length === 0) {
      Utils.showToast('사업자명과 파일을 입력해 주세요.', 'error');
      return;
    }

    const user = Auth.currentUser();
    for (const file of files) {
      await DB.add('documents', {
        companyName: company,
        regNumber: regNum,
        fileName: file.name,
        fileType: file.type,
        fileData: file,
        category,
        relatedInvoiceId: null,
        relatedRequestNumber: null,
        registeredBy: user.id,
        registeredByName: user.displayName,
        createdAt: new Date().toISOString()
      });
    }

    await DB.log('CREATE', 'document', null, `문서 업로드: ${company} (${files.length}건)`);
    Utils.closeModal();
    Utils.showToast(`${files.length}건의 문서가 업로드되었습니다.`, 'success');
    await this.render();
  },

  destroy() {}
};

window.DocumentsModule = DocumentsModule;
