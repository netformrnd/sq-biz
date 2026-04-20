/* ============================================
   Firebase Firestore 기반 DB 래퍼
   - 기존 IndexedDB DB 인터페이스와 동일하게 동작
   - 모든 사용자가 실시간으로 공유
   ============================================ */

const FirebaseDB = {
  app: null,
  db: null,
  initialized: false,
  _listeners: {},

  // Firebase 설정 저장 (localStorage)
  CONFIG_KEY: 'sq_firebase_config',

  getConfig() {
    // 1순위: localStorage에 저장된 사용자 설정 (관리자가 직접 변경한 경우)
    try {
      const raw = localStorage.getItem(this.CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.apiKey && parsed.projectId) return parsed;
      }
    } catch {}
    // 2순위: 앱에 내장된 기본 설정 (직원들은 자동으로 이 설정 사용)
    if (window.EMBEDDED_FIREBASE_CONFIG && window.EMBEDDED_FIREBASE_CONFIG.apiKey) {
      return window.EMBEDDED_FIREBASE_CONFIG;
    }
    return null;
  },

  setConfig(config) {
    if (config) {
      localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config));
    } else {
      localStorage.removeItem(this.CONFIG_KEY);
    }
  },

  isConfigured() {
    const cfg = this.getConfig();
    return !!(cfg && cfg.apiKey && cfg.projectId);
  },

  // 내장 설정 사용 중인지 확인
  isUsingEmbedded() {
    const stored = localStorage.getItem(this.CONFIG_KEY);
    return !stored && !!(window.EMBEDDED_FIREBASE_CONFIG && window.EMBEDDED_FIREBASE_CONFIG.apiKey);
  },

  // Firebase SDK 로드 + 초기화
  async init() {
    if (this.initialized) return;
    const config = this.getConfig();
    if (!config) throw new Error('Firebase 설정이 없습니다.');

    // SDK 로드 (CDN)
    if (!window.firebase) {
      await this._loadScript('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
      await this._loadScript('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js');
    }

    this.app = firebase.initializeApp(config);
    this.db = firebase.firestore();
    this.initialized = true;
    console.log('[Firebase] 초기화 완료');
  },

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Firebase SDK 로드 실패: ' + src));
      document.head.appendChild(s);
    });
  },

  async open() {
    if (!this.initialized) await this.init();
    return this.db;
  },

  // ===== CRUD 인터페이스 (IndexedDB DB와 호환) =====
  async add(collection, data) {
    await this.open();
    const cleaned = this._toFirestore(data);
    const ref = await this.db.collection(collection).add({
      ...cleaned,
      _createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  },

  async get(collection, id) {
    await this.open();
    const doc = await this.db.collection(collection).doc(String(id)).get();
    if (!doc.exists) return null;
    return this._fromFirestore({ ...doc.data(), id: doc.id });
  },

  async getAll(collection) {
    await this.open();
    const snap = await this.db.collection(collection).get();
    return snap.docs.map(d => this._fromFirestore({ ...d.data(), id: d.id }));
  },

  async getByIndex(collection, indexName, value) {
    await this.open();
    const snap = await this.db.collection(collection).where(indexName, '==', value).get();
    return snap.docs.map(d => this._fromFirestore({ ...d.data(), id: d.id }));
  },

  async update(collection, data) {
    await this.open();
    if (!data.id) throw new Error('update: id 필요');
    const id = String(data.id);
    const cleaned = this._toFirestore({ ...data });
    delete cleaned.id;
    await this.db.collection(collection).doc(id).set({
      ...cleaned,
      _updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return id;
  },

  async delete(collection, id) {
    await this.open();
    await this.db.collection(collection).doc(String(id)).delete();
  },

  async count(collection, indexName, value) {
    await this.open();
    let query = this.db.collection(collection);
    if (indexName && value !== undefined) {
      query = query.where(indexName, '==', value);
    }
    const snap = await query.get();
    return snap.size;
  },

  async clear(collection) {
    await this.open();
    const snap = await this.db.collection(collection).get();
    const batch = this.db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  },

  // ===== Firestore <-> 앱 데이터 변환 =====
  _toFirestore(data) {
    const result = { ...data };
    // Blob → base64 문자열
    if (result.attachments && Array.isArray(result.attachments)) {
      result.attachments = result.attachments.map(att => {
        if (att.fileData instanceof Blob) {
          return { ...att, fileData: null, _pendingBlob: true };
        }
        return att;
      });
    }
    if (result.fileData instanceof Blob) {
      // documents 스토어: fileData는 blob → base64
      result._hasBlob = true;
    }
    return result;
  },

  _fromFirestore(data) {
    return data;
  },

  // ===== 파일 업로드 (base64로 별도 컬렉션) =====
  async uploadBlob(blob) {
    await this.open();
    const base64 = await this._blobToBase64(blob);
    const ref = await this.db.collection('_blobs').add({
      data: base64,
      type: blob.type,
      size: blob.size,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  },

  async downloadBlob(blobId) {
    await this.open();
    const doc = await this.db.collection('_blobs').doc(blobId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return this._base64ToBlob(data.data, data.type);
  },

  _blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  },

  _base64ToBlob(base64, mimeType) {
    const parts = base64.split(',');
    const byteString = atob(parts[1] || parts[0]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new Blob([ab], { type: mimeType || 'application/octet-stream' });
  },

  // 감사 로그
  async log(action, entityType, entityId, details) {
    const user = Auth.currentUser();
    await this.add('auditLog', {
      action, entityType, entityId,
      userId: user ? user.id : null,
      userName: user ? user.displayName : 'System',
      details: typeof details === 'object' ? JSON.stringify(details) : details,
      timestamp: new Date().toISOString()
    });
  },

  // 요청번호 생성
  async generateRequestNumber() {
    const year = new Date().getFullYear().toString().slice(2);
    const all = await this.getAll('taxInvoiceRequests');
    const thisYear = all.filter(r => r.requestNumber && r.requestNumber.startsWith(`TIR-${year}`));
    const num = (thisYear.length + 1).toString().padStart(4, '0');
    return `TIR-${year}-${num}`;
  },

  async exportAll() {
    const storeNames = ['users', 'taxInvoiceRequests', 'deposits', 'transferRecords', 'matchingLog', 'auditLog', 'documents', 'checklists', 'leaveRequests', 'leaveBalances'];
    const data = {};
    for (const name of storeNames) {
      data[name] = await this.getAll(name);
    }
    return { version: 2, exportedAt: new Date().toISOString(), data };
  },

  async importAll(backup) {
    const storeNames = ['users', 'taxInvoiceRequests', 'deposits', 'transferRecords', 'matchingLog', 'auditLog', 'documents', 'checklists', 'leaveRequests', 'leaveBalances'];
    for (const name of storeNames) {
      await this.clear(name);
      if (backup.data[name]) {
        for (const record of backup.data[name]) {
          const { id, ...rest } = record;
          await this.add(name, rest);
        }
      }
    }
  }
};

window.FirebaseDB = FirebaseDB;
