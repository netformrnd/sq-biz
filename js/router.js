/* ============================================
   해시 기반 SPA 라우터
   ============================================ */

const Router = {
  routes: {},
  currentModule: null,

  // 라우트 등록
  register(path, config) {
    this.routes[path] = config;
  },

  // 초기화
  init() {
    window.addEventListener('hashchange', () => this._handleRoute());
    // 초기 라우팅
    if (!window.location.hash || window.location.hash === '#/') {
      window.location.hash = '#/dashboard';
    } else {
      this._handleRoute();
    }
  },

  // 라우트 처리
  async _handleRoute() {
    const hash = window.location.hash.slice(1) || '/dashboard';
    const path = hash.split('?')[0];

    // 로그인 체크
    const user = Auth.currentUser();
    if (!user) {
      document.getElementById('appShell').classList.remove('active');
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }

    const route = this.routes[path];
    if (!route) {
      this.navigate('/dashboard');
      return;
    }

    // 권한 체크
    if (route.roles && !route.roles.includes(user.role)) {
      Utils.showToast('접근 권한이 없습니다.', 'error');
      this.navigate('/dashboard');
      return;
    }

    // 이전 모듈 정리
    if (this.currentModule && this.currentModule.destroy) {
      this.currentModule.destroy();
    }

    // 사이드바 활성화 업데이트
    this._updateSidebar(path);

    // 페이지 제목 업데이트
    if (route.title) {
      document.getElementById('pageTitle').textContent = route.title;
    }

    // 콘텐츠 영역에 모듈 렌더링
    const content = document.getElementById('contentArea');
    content.innerHTML = '<div class="content-wrapper" id="pageContent"></div>';

    const pageContent = document.getElementById('pageContent');

    // 모듈 초기화
    if (route.module && window[route.module]) {
      this.currentModule = window[route.module];
      try {
        await this.currentModule.init(pageContent, route.action || null);
      } catch (err) {
        console.error('모듈 로드 오류:', err);
        pageContent.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <h3>페이지 로드 오류</h3>
            <p>${Utils.escapeHtml(err.message)}</p>
          </div>
        `;
      }
    }
  },

  // 사이드바 활성 상태 업데이트
  _updateSidebar(path) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.path === path);
    });
  },

  // 네비게이션
  navigate(path) {
    window.location.hash = '#' + path;
  },

  // 뒤로가기
  back() {
    window.history.back();
  }
};

window.Router = Router;
