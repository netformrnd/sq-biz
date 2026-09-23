/* ============================================
   넷폼 라운지 로그인으로 들어오기 (2026-09-23)

   · 이 앱은 자체 아이디/비밀번호를 쓰지 않는다. 접속 권한은 넷폼 라운지에서 관리한다.
     - 관리자      : 라운지에서 관리자인 사람
     - 일반 접속   : 라운지 권한 관리의 'sq-biz' 목록에 지정된 사람
   · 라운지(mgmtny)를 기본 앱으로 초기화하면 같은 도메인의 라운지 로그인 세션을 그대로 쓸 수 있다.
   · 서버 함수(appToken)가 라운지 계정·권한을 확인한 뒤 이 프로젝트용 입장권을 발급한다.
     권한이 없으면 입장권 자체가 나오지 않으므로 화면만이 아니라 데이터 접근도 막힌다.
   ============================================ */

const LoungeAuth = {
  LOUNGE_URL: 'https://netformrnd.github.io/nf_lounge/',
  CONFIG_URL: 'https://netformrnd.github.io/nf_lounge/nf-config.js',
  SDK: 'https://www.gstatic.com/firebasejs/10.7.0/',
  REGION: 'asia-northeast3',
  APP_ID: 'sq-biz',
  me: null,

  _load(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('불러오기 실패: ' + src));
      document.head.appendChild(s);
    });
  },

  async _sdk() {
    if (!window.firebase) await this._load(this.SDK + 'firebase-app-compat.js');
    if (!firebase.firestore) await this._load(this.SDK + 'firebase-firestore-compat.js');
    if (!firebase.auth) await this._load(this.SDK + 'firebase-auth-compat.js');
    if (!firebase.functions) await this._load(this.SDK + 'firebase-functions-compat.js');
  },

  /* 이 앱(sq-biz)의 Firebase 앱 — firebase-db.js와 같은 인스턴스를 쓴다 */
  async _sqApp() {
    try { return firebase.app('sqbiz'); } catch (e) {}
    if (!window.EMBEDDED_FIREBASE_CONFIG) await this._load('js/firebase-config.js');
    return firebase.initializeApp(window.EMBEDDED_FIREBASE_CONFIG, 'sqbiz');
  },

  /* 라운지 로그인 확인 → 입장권 발급 → 이 앱에 로그인. 성공하면 true */
  async boot() {
    try {
      await this._sdk();

      if (!window.NF_LOUNGE_CONFIG) await this._load(this.CONFIG_URL);
      if (!window.NF_LOUNGE_CONFIG) throw new Error('라운지 설정을 불러오지 못했습니다.');
      try { firebase.app(); } catch (e) { firebase.initializeApp(window.NF_LOUNGE_CONFIG); }

      /* 익명 로그인은 절대 부르지 않는다 — 라운지 메일 세션을 덮어쓰기 때문 */
      const user = await new Promise((resolve) => {
        let done = false;
        firebase.auth().onAuthStateChanged((u) => { if (!done) { done = true; resolve(u); } });
        setTimeout(() => { if (!done) { done = true; resolve(null); } }, 8000);
      });
      if (!user || user.isAnonymous || !user.email) { this.gate('login'); return false; }

      let res;
      try {
        res = await firebase.app().functions(this.REGION).httpsCallable('appToken')({ app: this.APP_ID });
      } catch (e) {
        const denied = e && (e.code === 'functions/permission-denied' || e.code === 'functions/unauthenticated');
        this.gate(denied ? 'denied' : 'error', e && e.message);
        return false;
      }

      const sqApp = await this._sqApp();
      await firebase.auth(sqApp).signInWithCustomToken(res.data.token);
      this.me = res.data;
      return true;
    } catch (e) {
      console.error('[라운지 로그인]', e);
      this.gate('error', e && e.message);
      return false;
    }
  },

  /* 라운지 계정으로 이 앱의 세션을 만든다.
     메뉴 권한·필터는 기존 사용자 정보(이름 일치)를 그대로 쓰고, 관리자 여부만 라운지 기준으로 정한다. */
  async applySession() {
    if (!this.me) return null;
    let mine = null;
    try {
      const users = await DB.getAll('users');
      const name = (this.me.name || '').replace(/\s/g, '');
      mine = (users || []).find(u => ((u.displayName || '').replace(/\s/g, '') === name)) || null;
    } catch (e) { console.warn('[라운지 로그인] 사용자 대조 실패', e); }

    const session = {
      id: mine ? mine.id : ('nf-' + this.me.uid),
      username: mine ? mine.username : this.me.uid,
      displayName: this.me.name || (mine && mine.displayName) || '사용자',
      role: this.me.admin ? 'admin' : 'employee',      /* 관리자 여부는 라운지 기준 */
      transferFilter: (mine && mine.transferFilter) || '',
      depositFilter: (mine && mine.depositFilter) || '',
      depositExcludeFilter: (mine && mine.depositExcludeFilter) || '',
      department: (mine && mine.department) || '',
      viaLounge: true,
      loginAt: Date.now(),
      lastActivity: Date.now()
    };
    sessionStorage.setItem(Auth.SESSION_KEY, JSON.stringify(session));
    return session;
  },

  /* 자리를 비워 세션이 만료됐을 때 — 라운지 로그인이 살아 있으면 조용히 다시 만든다 */
  async reauth() {
    if (!this.me) return null;
    return await this.applySession();
  },

  /* 라운지를 거치지 않고 들어왔을 때 보여주는 안내 화면 */
  gate(reason, detail) {
    document.body.style.visibility = 'hidden';
    const old = document.getElementById('nfLoungeGate');
    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.id = 'nfLoungeGate';
    wrap.setAttribute('style', 'position:fixed;inset:0;visibility:visible;display:flex;align-items:center;justify-content:center;background:#F1F5F9;z-index:99999;font-family:Pretendard,system-ui,sans-serif;padding:20px;');

    const box = document.createElement('div');
    box.setAttribute('style', 'background:#fff;border-radius:16px;padding:40px 32px;text-align:center;max-width:400px;box-shadow:0 10px 30px rgba(15,23,42,.08);');

    const add = (tag, style, text) => {
      const n = document.createElement(tag);
      if (style) n.setAttribute('style', style);
      if (text) n.textContent = text;
      box.appendChild(n);
      return n;
    };

    add('div', 'font-size:36px;margin-bottom:14px;', '🔒');
    add('div', 'font-size:17px;font-weight:700;color:#0F172A;margin-bottom:10px;word-break:keep-all;',
      reason === 'denied' ? '접근 권한이 없습니다' : '넷폼 라운지에서 로그인해 주세요');
    add('div', 'font-size:13px;color:#64748B;line-height:1.7;margin-bottom:22px;word-break:keep-all;',
      reason === 'denied'
        ? '열람 권한이 없는 계정입니다.\n경영관리팀에 요청해 주세요.'
        : '스퀘어건축 업무관리는\n넷폼 라운지를 통해서만 이용할 수 있습니다.').style.whiteSpace = 'pre-line';

    if (reason !== 'denied') {
      const a = document.createElement('a');
      a.href = this.LOUNGE_URL;
      a.textContent = '넷폼 라운지로 이동 →';
      a.setAttribute('style', 'display:inline-block;padding:12px 22px;border-radius:9px;background:linear-gradient(135deg,#0F172A,#334155);color:#fff;text-decoration:none;font-size:14px;font-weight:600;');
      box.appendChild(a);
    }

    if (reason === 'error' && detail) {
      add('div', 'margin-top:18px;font-size:11px;color:#94A3B8;word-break:break-all;', String(detail).slice(0, 200));
    }

    wrap.appendChild(box);
    document.documentElement.appendChild(wrap);
  }
};

window.LoungeAuth = LoungeAuth;
