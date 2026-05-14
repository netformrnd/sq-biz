/* ============================================
   잔디(Jandi) 웹훅 알림 모듈
   - 세금계산서 발행 요청 시 잔디로 알림 전송
   - 설정에서 웹훅 URL 등록
   ============================================ */

const JandiWebhook = {
  STORAGE_KEY: 'sq_jandi_webhook_url',
  SETTINGS_COLLECTION: 'appSettings',
  SETTINGS_DOC_ID: 'jandi',
  _cachedUrl: null,
  _loadedFromCloud: false,
  _loadPromise: null,

  // Firestore에서 웹훅 URL 로드 (앱 시작 시 + send() 호출 시 보장)
  // localStorage는 단순 캐시. 진실의 원천(source of truth)은 Firestore.
  async loadFromCloud() {
    if (this._loadedFromCloud) return this._cachedUrl;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      try {
        const doc = await DB.get(this.SETTINGS_COLLECTION, this.SETTINGS_DOC_ID);
        if (doc && doc.webhookUrl) {
          this._cachedUrl = doc.webhookUrl;
          localStorage.setItem(this.STORAGE_KEY, doc.webhookUrl);
          console.log('[Jandi] 웹훅 URL 로드 완료 (Firestore)');
        } else {
          // Firestore에 없으면 localStorage(이전 버전 호환) 사용
          const lsUrl = localStorage.getItem(this.STORAGE_KEY) || '';
          this._cachedUrl = lsUrl;
          if (lsUrl) console.log('[Jandi] 웹훅 URL 로드 완료 (localStorage fallback)');
        }
        this._loadedFromCloud = true;
      } catch (e) {
        console.warn('[Jandi] Firestore 설정 로드 실패, localStorage 사용:', e.message);
        this._cachedUrl = localStorage.getItem(this.STORAGE_KEY) || '';
      }
      return this._cachedUrl;
    })();

    return this._loadPromise;
  },

  // 저장된 웹훅 URL 가져오기 (동기, 캐시 기반)
  getWebhookUrl() {
    if (this._cachedUrl !== null) return this._cachedUrl;
    return localStorage.getItem(this.STORAGE_KEY) || '';
  },

  // 웹훅 URL 저장 (Firestore에 영구 저장 + localStorage 캐시) - async
  async setWebhookUrl(url) {
    const trimmed = (url || '').trim();

    // 1) Firestore 영구 저장 (모든 사용자 공유)
    await DB.update(this.SETTINGS_COLLECTION, {
      id: this.SETTINGS_DOC_ID,
      webhookUrl: trimmed
    });

    // 2) localStorage 캐시 + 메모리 캐시
    if (trimmed) {
      localStorage.setItem(this.STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(this.STORAGE_KEY);
    }
    this._cachedUrl = trimmed;
    this._loadedFromCloud = true;
  },

  // 잔디 웹훅 활성화 여부
  isEnabled() {
    return !!this.getWebhookUrl();
  },

  // 잔디로 알림 전송 (CORS 우회 - 다중 프록시 폴백)
  // 반환: { ok: boolean, via?: string, status?: number, error?: string }
  async send(title, body, color = '#2563EB') {
    // 캐시가 비어있으면 Firestore에서 자동 로드 (다른 PC에서 등록한 URL도 사용 가능)
    if (!this._loadedFromCloud) {
      await this.loadFromCloud();
    }

    const url = this.getWebhookUrl();
    if (!url) {
      console.warn('[Jandi] webhook URL 미설정 (Firestore appSettings/jandi 문서를 확인하세요)');
      return { ok: false, error: 'no-url' };
    }

    // 잔디 Incoming Webhook 형식
    const payload = {
      body: title,
      connectColor: color,
      connectInfo: [{
        title: '상세 내용',
        description: body
      }]
    };
    const payloadStr = JSON.stringify(payload);

    console.log('[Jandi] 전송 시도:', title);

    // CORS 우회 프록시 후보 (순차 시도)
    const proxies = [
      { name: 'corsproxy.io',  build: (u) => 'https://corsproxy.io/?' + encodeURIComponent(u) },
      { name: 'allorigins',    build: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
      { name: 'thingproxy',    build: (u) => 'https://thingproxy.freeboard.io/fetch/' + u },
      { name: 'cors.sh',       build: (u) => 'https://proxy.cors.sh/' + u }
    ];

    for (const p of proxies) {
      const proxyUrl = p.build(url);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/vnd.tosslab.jandi-v2+json',
            'Content-Type': 'application/json'
          },
          body: payloadStr,
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (res.ok) {
          console.log(`[Jandi] ✅ 전송 완료 (${p.name}):`, res.status);
          return { ok: true, via: p.name, status: res.status };
        }
        console.warn(`[Jandi] ${p.name} 응답 오류:`, res.status);
      } catch (err) {
        clearTimeout(t);
        console.warn(`[Jandi] ${p.name} 시도 실패:`, err.name === 'AbortError' ? 'timeout' : err.message);
      }
    }

    console.error('[Jandi] ❌ 모든 프록시 전송 실패');
    return { ok: false, error: 'all-proxies-failed' };
  },

  // 수동 테스트 발송 (설정 화면에서 호출)
  async testSend() {
    const r = await this.send(
      '🧪 잔디 알림 테스트',
      '업무관리 시스템에서 보낸 테스트 메시지입니다.\n이 메시지가 보이면 정상 연동된 상태입니다.',
      '#2563EB'
    );
    if (r && r.ok) {
      Utils.showToast(`잔디 테스트 메시지 발송됨 (${r.via}). 채널을 확인하세요.`, 'success');
    } else {
      Utils.showToast('잔디 전송 실패: 모든 CORS 프록시 실패. 콘솔 로그를 확인하세요.', 'error', 5000);
    }
    return r;
  },

  // 세금계산서 발행 요청 알림
  async notifyNewRequest(item) {
    return await this.send(
      '📝 세금계산서 발행 요청',
      `요청번호: ${item.requestNumber}\n` +
      `요청자: ${item.requesterName}\n` +
      `거래처: ${item.partnerCompanyName || '-'}\n` +
      `금액: ${Utils.formatCurrency(item.totalAmount)}\n` +
      `사유: ${item.reason || '-'}`,
      '#2563EB'
    );
  },

  // 상태 변경 알림
  async notifyStatusChange(item, newStatus) {
    const colorMap = {
      '검토중': '#D97706',
      '발행완료': '#16A34A',
      '반려': '#DC2626'
    };
    return await this.send(
      `📋 세금계산서 ${newStatus}`,
      `요청번호: ${item.requestNumber}\n` +
      `거래처: ${item.partnerCompanyName || '-'}\n` +
      `금액: ${Utils.formatCurrency(item.totalAmount)}`,
      colorMap[newStatus] || '#2563EB'
    );
  }
};

window.JandiWebhook = JandiWebhook;
