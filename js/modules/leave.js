/* ============================================
   연차 신청 모듈
   기존 시스템(GitHub Pages)을 iframe으로 연동
   ============================================ */

const LEAVE_URL = 'https://netformrnd.github.io/sq_vc/';

const LeaveModule = {
  container: null,

  async init(container) {
    this.container = container;
    this.render();
  },

  render() {
    this.container.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:var(--sp-3);">
        <button class="btn btn-secondary btn-sm" onclick="window.open('${LEAVE_URL}', '_blank')" title="새 탭에서 열기">
          🔗 새 탭에서 열기
        </button>
      </div>
      <div id="leaveIframeWrap" style="
        background:var(--color-surface);
        border:1px solid var(--color-border);
        border-radius:var(--radius-md);
        overflow:hidden;
        position:relative;
        min-height:600px;
      ">
        <iframe
          id="leaveIframe"
          src="${LEAVE_URL}"
          style="width:100%;height:calc(100vh - 160px);border:none;display:block;"
          allow="clipboard-write"
          loading="lazy"
        ></iframe>
        <!-- iframe 차단 시 안내 -->
        <div id="leaveIframeError" class="hidden" style="
          position:absolute;inset:0;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          background:var(--color-surface);text-align:center;padding:var(--sp-8);
        ">
          <div style="font-size:48px;margin-bottom:var(--sp-4);">🗓️</div>
          <h3 style="margin-bottom:var(--sp-2);">연차 신청 시스템</h3>
          <p class="text-sm text-muted mb-4">브라우저 보안 정책으로 여기에 직접 표시할 수 없습니다.</p>
          <button class="btn btn-primary btn-lg" onclick="window.open('${LEAVE_URL}', '_blank')">
            연차 신청 시스템 열기 →
          </button>
        </div>
      </div>
    `;

    // iframe 로드 실패 감지
    const iframe = document.getElementById('leaveIframe');
    iframe.addEventListener('load', () => {
      try {
        // iframe이 로드되었지만 cross-origin이면 contentDocument 접근 불가
        // 단, 에러가 안 나면 정상 로드된 것
        const test = iframe.contentWindow.location.href;
      } catch (e) {
        // cross-origin은 정상 (접근만 안 되는 것이지 로드는 된 것)
        // 아무것도 안 함 - iframe이 정상 표시됨
      }
    });

    iframe.addEventListener('error', () => {
      document.getElementById('leaveIframeError').classList.remove('hidden');
      iframe.style.display = 'none';
    });

    // 3초 후에도 iframe이 비어있으면 에러 표시
    setTimeout(() => {
      try {
        if (iframe.contentDocument && iframe.contentDocument.body && iframe.contentDocument.body.innerHTML === '') {
          document.getElementById('leaveIframeError').classList.remove('hidden');
          iframe.style.display = 'none';
        }
      } catch (e) {
        // cross-origin이면 접근 불가 → 정상 로드된 것
      }
    }, 3000);
  },

  destroy() {}
};

window.LeaveModule = LeaveModule;
