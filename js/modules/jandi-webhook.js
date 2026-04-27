/* ============================================
   잔디(Jandi) 웹훅 알림 모듈
   - 세금계산서 발행 요청 시 잔디로 알림 전송
   - 설정에서 웹훅 URL 등록
   ============================================ */

const JandiWebhook = {
  STORAGE_KEY: 'sq_jandi_webhook_url',

  // 저장된 웹훅 URL 가져오기
  getWebhookUrl() {
    return localStorage.getItem(this.STORAGE_KEY) || '';
  },

  // 웹훅 URL 저장
  setWebhookUrl(url) {
    if (url) {
      localStorage.setItem(this.STORAGE_KEY, url.trim());
    } else {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  },

  // 잔디 웹훅 활성화 여부
  isEnabled() {
    return !!this.getWebhookUrl();
  },

  // 잔디로 알림 전송 (CORS 우회)
  async send(title, body, color = '#2563EB') {
    const url = this.getWebhookUrl();
    if (!url) {
      console.warn('[Jandi] webhook URL 미설정');
      return;
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

    console.log('[Jandi] 전송 시도:', title);

    // ── 1차 시도: corsproxy.io 경유 (정상 응답 확인 가능)
    try {
      const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.tosslab.jandi-v2+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        console.log('[Jandi] ✅ 전송 완료 (proxy):', res.status);
        return;
      }
      console.warn('[Jandi] proxy 응답 오류:', res.status);
    } catch (err) {
      console.warn('[Jandi] proxy 시도 실패:', err.message);
    }

    // ── 2차 시도: no-cors 모드 직접 호출 (응답 확인 불가, 보낸 결과만)
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      console.log('[Jandi] ✅ 전송 완료 (no-cors fallback)');
    } catch (err) {
      console.error('[Jandi] ❌ 최종 전송 실패:', err.message);
      // 실패해도 업무 프로세스에 영향 없음
    }
  },

  // 수동 테스트 발송 (설정 화면에서 호출)
  async testSend() {
    await this.send(
      '🧪 잔디 알림 테스트',
      '업무관리 시스템에서 보낸 테스트 메시지입니다.\n이 메시지가 보이면 정상 연동된 상태입니다.',
      '#2563EB'
    );
    Utils.showToast('잔디 테스트 메시지 발송됨. 잔디 채널 확인하세요.', 'success');
  },

  // 세금계산서 발행 요청 알림
  async notifyNewRequest(item) {
    await this.send(
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
    await this.send(
      `📋 세금계산서 ${newStatus}`,
      `요청번호: ${item.requestNumber}\n` +
      `거래처: ${item.partnerCompanyName || '-'}\n` +
      `금액: ${Utils.formatCurrency(item.totalAmount)}`,
      colorMap[newStatus] || '#2563EB'
    );
  }
};

window.JandiWebhook = JandiWebhook;
