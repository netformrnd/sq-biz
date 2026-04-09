/* ============================================
   유틸리티 함수
   ============================================ */

const Utils = {
  // 통화 포맷 (한국 원화)
  formatCurrency(amount) {
    if (amount == null || isNaN(amount)) return '₩0';
    return '₩' + Number(amount).toLocaleString('ko-KR');
  },

  // 날짜 포맷
  formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  },

  // 오늘 날짜 (input[type=date] 용)
  today() {
    return new Date().toISOString().split('T')[0];
  },

  // 사업자등록번호 포맷 (000-00-00000)
  formatRegNumber(num) {
    if (!num) return '';
    const clean = num.replace(/[^0-9]/g, '');
    if (clean.length === 10) {
      return `${clean.slice(0,3)}-${clean.slice(3,5)}-${clean.slice(5)}`;
    }
    return num;
  },

  // 사업자등록번호 유효성 검사
  validateRegNumber(num) {
    const clean = num.replace(/[^0-9]/g, '');
    if (clean.length !== 10) return false;
    const weights = [1,3,7,1,3,7,1,3,5];
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(clean[i]) * weights[i];
    }
    sum += Math.floor((parseInt(clean[8]) * 5) / 10);
    const checkDigit = (10 - (sum % 10)) % 10;
    return checkDigit === parseInt(clean[9]);
  },

  // HTML 이스케이프
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // 상태 뱃지 HTML
  statusBadge(status) {
    const map = {
      '요청': 'badge-request',
      '검토중': 'badge-review',
      '발행완료': 'badge-complete',
      '반려': 'badge-reject',
      '매칭완료': 'badge-matched',
      '미매칭': 'badge-unmatched',
      '부분매칭': 'badge-partial'
    };
    const cls = map[status] || 'badge-request';
    return `<span class="badge ${cls}">${this.escapeHtml(status)}</span>`;
  },

  // 토스트 메시지
  showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${this.escapeHtml(message)}</span>
      <span class="toast-close" onclick="this.parentElement.remove()">&times;</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // 확인 다이얼로그
  confirm(message, title = '확인') {
    return new Promise((resolve) => {
      const backdrop = document.getElementById('modalBackdrop');
      const modal = document.getElementById('globalModal');

      modal.innerHTML = `
        <div class="modal-header">
          <h3>${this.escapeHtml(title)}</h3>
          <button class="modal-close" data-action="cancel">&times;</button>
        </div>
        <div class="modal-body confirm-dialog">
          <p class="confirm-message">${this.escapeHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="cancel">취소</button>
          <button class="btn btn-primary" data-action="confirm">확인</button>
        </div>
      `;

      backdrop.classList.add('active');

      const handleClick = (e) => {
        const action = e.target.dataset.action;
        if (action === 'confirm' || action === 'cancel') {
          backdrop.classList.remove('active');
          modal.innerHTML = '';
          backdrop.removeEventListener('click', handleClick);
          resolve(action === 'confirm');
        }
      };

      backdrop.addEventListener('click', handleClick);
    });
  },

  // 모달 열기
  openModal(content, options = {}) {
    const backdrop = document.getElementById('modalBackdrop');
    const modal = document.getElementById('globalModal');
    if (options.size) modal.className = `modal ${options.size}`;
    else modal.className = 'modal';
    modal.innerHTML = content;
    backdrop.classList.add('active');

    // ESC로 닫기
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);

    // 배경 클릭으로 닫기
    backdrop.onclick = (e) => {
      if (e.target === backdrop) this.closeModal();
    };
  },

  closeModal() {
    const backdrop = document.getElementById('modalBackdrop');
    const modal = document.getElementById('globalModal');
    backdrop.classList.remove('active');
    modal.innerHTML = '';
    modal.className = 'modal';
  },

  // 파일 다운로드
  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // CSV 이스케이프
  escapeCSV(value) {
    if (value == null) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  },

  // 디바운스
  debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  // 문자열 유사도 (간단한 포함 검사)
  normalizeCompanyName(name) {
    if (!name) return '';
    return name
      .replace(/\(주\)/g, '')
      .replace(/주식회사/g, '')
      .replace(/\(유\)/g, '')
      .replace(/유한회사/g, '')
      .replace(/\s+/g, '')
      .trim();
  }
};

window.Utils = Utils;
