/* ============================================
   거래처 별칭 학습 (입금자명 ↔ 거래처명)
   - 통장 입금자명과 세금계산서 거래처명이 달라도,
     한 번 수동 매칭하면 "이 이름 = 이 거래처"를 기억해서
     다음부터 자동매칭이 이름으로도 인식하게 함.
   - 저장소: partnerAliases (Firebase 컬렉션 / IndexedDB 스토어)
   ============================================ */

const PartnerAlias = {
  _map: null,      // { 입금이름키: Set(거래처키) }
  _loaded: false,

  // 이름 정규화 (Utils.Dedup 재사용)
  _key(s) {
    if (window.Utils && Utils.Dedup) return Utils.Dedup.coreName(s);
    return (s || '').replace(/[\s()]/g, '').toLowerCase();
  },

  async load(force) {
    if (this._loaded && !force) return;
    this._map = {};
    try {
      const rows = await DB.getAll('partnerAliases');
      (rows || []).forEach(r => {
        const dk = r.depositKey, ck = r.companyKey;
        if (!dk || !ck) return;
        (this._map[dk] = this._map[dk] || new Set()).add(ck);
      });
    } catch (e) { console.warn('[별칭] 로드 실패:', e); }
    this._loaded = true;
  },

  // 학습: 입금자명 ↔ 거래처명을 별칭으로 기억 (수동 매칭 시 호출)
  async learn(depositName, companyName) {
    const dk = this._key(depositName), ck = this._key(companyName);
    if (!dk || !ck || dk === ck) return;   // 이름이 같으면 별칭 불필요
    await this.load();
    if (this._map[dk] && this._map[dk].has(ck)) return;   // 이미 학습됨
    try {
      const user = (window.Auth && Auth.currentUser) ? Auth.currentUser() : null;
      await DB.add('partnerAliases', {
        depositKey: dk, companyKey: ck,
        depositName: (depositName || '').trim(),
        companyName: (companyName || '').trim(),
        createdBy: user ? user.id : null,
        createdByName: user ? user.displayName : null,
        createdAt: new Date().toISOString()
      });
      (this._map[dk] = this._map[dk] || new Set()).add(ck);
      if (window.DB && DB.log) DB.log('LEARN', 'partnerAlias', null, `별칭 학습: ${depositName} = ${companyName}`);
    } catch (e) { console.warn('[별칭] 저장 실패:', e); }
  },

  // 판정: 이 입금자명과 이 거래처명이 별칭으로 연결돼 있나 (동기 — 캐시 사용, load() 선행 필요)
  matches(depositName, companyName) {
    if (!this._map) return false;
    const dk = this._key(depositName), ck = this._key(companyName);
    if (!dk || !ck) return false;
    return !!(this._map[dk] && this._map[dk].has(ck));
  }
};

window.PartnerAlias = PartnerAlias;
