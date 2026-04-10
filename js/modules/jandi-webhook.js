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

  // 잔디로 알림 전송
  async send(title, body, color = '#2563EB') {
    const url = this.getWebhookUrl();
    if (!url) return;

    // 잔디 Incoming Webhook 형식
    const payload = {
      body: title,
      connectColor: color,
      connectInfo: [{
        title: '상세 내용',
        description: body
      }]
    };

    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.tosslab.jandi-v2+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      console.log('[Jandi] 알림 전송 완료');
    } catch (err) {
      console.warn('[Jandi] 알림 전송 실패:', err.message);
      // 실패해도 업무 프로세스에 영향 없음
    }
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
