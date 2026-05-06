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
    const cleaned = await this._toFirestore(data);
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
    const cleaned = await this._toFirestore({ ...data });
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
  // Blob/File 인지 확인 (File은 Blob을 상속하지만 일부 환경에서 차이 있음)
  _isBlobLike(v) {
    return v && (v instanceof Blob || (typeof File !== 'undefined' && v instanceof File));
  },

  // _blobs 컬렉션 단일 문서 1MB 제한. base64 인코딩 후 ~1MB 안에 들어가도록 raw 700KB로 컷.
  // (700KB raw → ~933KB base64, Firestore 오버헤드 포함 ~950KB)
  MAX_BLOB_BYTES: 700 * 1024,

  // Blob → _blobs 컬렉션에 저장 후 참조 객체 반환 ({ __blobRef: id })
  async _encodeBlobToRef(blob) {
    if (blob.size > this.MAX_BLOB_BYTES) {
      const mb = (blob.size / 1024 / 1024).toFixed(2);
      throw new Error(`첨부파일 용량 초과 (${mb}MB). 한 파일당 최대 700KB까지 가능합니다. PDF는 압축 후 다시 시도해 주세요.`);
    }
    const blobId = await this.uploadBlob(blob);
    return { __blobRef: blobId };
  },

  _isBlobRef(v) {
    return v && typeof v === 'object' && typeof v.__blobRef === 'string';
  },

  // 저장 시: Blob/File → 별도 _blobs 컬렉션 업로드 후 부모 문서엔 참조만 저장
  // (Firestore 단일 문서 1MB 제한 회피)
  async _toFirestore(data) {
    const result = { ...data };

    // 1) 모든 Blob 의 사이즈 사전 검증 (한도 초과 시 업로드 시작 전에 에러)
    const blobsToCheck = [];
    if (Array.isArray(result.attachments)) {
      for (const att of result.attachments) {
        if (this._isBlobLike(att.fileData)) blobsToCheck.push({ blob: att.fileData, name: att.fileName });
      }
    }
    if (this._isBlobLike(result.fileData)) {
      blobsToCheck.push({ blob: result.fileData, name: result.fileName });
    }
    for (const { blob, name } of blobsToCheck) {
      if (blob.size > this.MAX_BLOB_BYTES) {
        const mb = (blob.size / 1024 / 1024).toFixed(2);
        throw new Error(`첨부파일 용량 초과: ${name || '파일'} (${mb}MB). 한 파일당 최대 700KB까지 가능합니다. PDF는 압축 후 다시 시도해 주세요.`);
      }
    }

    // 2) attachments 배열 처리 (각 첨부의 fileData → _blobs 업로드)
    if (Array.isArray(result.attachments)) {
      result.attachments = await Promise.all(result.attachments.map(async att => {
        if (this._isBlobLike(att.fileData)) {
          const blob = att.fileData;
          const ref = await this._encodeBlobToRef(blob);
          return {
            ...att,
            fileData: ref,
            fileType: att.fileType || blob.type || '',
            fileName: att.fileName || blob.name || '',
            fileSize: blob.size || 0
          };
        }
        return att;
      }));
    }

    // 3) 단일 fileData 처리 (documents 컬렉션 등)
    if (this._isBlobLike(result.fileData)) {
      const blob = result.fileData;
      result.fileData = await this._encodeBlobToRef(blob);
      result.fileType = result.fileType || blob.type || '';
      if (!result.fileName && blob.name) result.fileName = blob.name;
      result.fileSize = blob.size || 0;
    }

    return result;
  },

  // 조회 시: 레거시 base64 → Blob 으로 복원 (구 데이터 호환).
  // 새 데이터의 { __blobRef } 는 그대로 두고 사용 시점에 resolveBlob 호출.
  _fromFirestore(data) {
    if (!data) return data;

    if (Array.isArray(data.attachments)) {
      data.attachments = data.attachments.map(att => {
        if (typeof att.fileData === 'string' && att.fileData.startsWith('data:')) {
          return { ...att, fileData: this._base64ToBlob(att.fileData, att.fileType) };
        }
        return att;
      });
    }

    if (typeof data.fileData === 'string' && data.fileData.startsWith('data:')) {
      data.fileData = this._base64ToBlob(data.fileData, data.fileType);
    }

    return data;
  },

  // 첨부 fileData 값을 Blob 으로 통일해서 반환.
  // - Blob/File: 그대로 반환
  // - { __blobRef }: _blobs 에서 다운로드해서 Blob 생성
  // - 레거시 base64 문자열: Blob 변환
  async resolveBlob(refOrBlob, mimeType) {
    if (!refOrBlob) return null;
    if (this._isBlobLike(refOrBlob)) return refOrBlob;
    if (this._isBlobRef(refOrBlob)) {
      return await this.downloadBlob(refOrBlob.__blobRef);
    }
    if (typeof refOrBlob === 'string' && refOrBlob.startsWith('data:')) {
      return this._base64ToBlob(refOrBlob, mimeType);
    }
    return null;
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
