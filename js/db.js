/* ============================================
   IndexedDB 래퍼 - 데이터베이스 관리
   ============================================ */

const DB_NAME = 'sq_architects_db';
const DB_VERSION = 4;

const DB = {
  db: null,

  // Firebase 사용 여부 (설정이 있으면 자동으로 true)
  get useFirebase() {
    return window.FirebaseDB && window.FirebaseDB.isConfigured();
  },

  async open() {
    // Firebase 모드: FirebaseDB로 위임
    if (this.useFirebase) {
      return FirebaseDB.open();
    }

    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // users
        if (!db.objectStoreNames.contains('users')) {
          const store = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
          store.createIndex('username', 'username', { unique: true });
          store.createIndex('role', 'role', { unique: false });
          store.createIndex('isActive', 'isActive', { unique: false });
        }

        // taxInvoiceRequests
        if (!db.objectStoreNames.contains('taxInvoiceRequests')) {
          const store = db.createObjectStore('taxInvoiceRequests', { keyPath: 'id', autoIncrement: true });
          store.createIndex('requestNumber', 'requestNumber', { unique: true });
          store.createIndex('requesterId', 'requesterId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('partnerRegNumber', 'partnerRegNumber', { unique: false });
        }

        // deposits
        if (!db.objectStoreNames.contains('deposits')) {
          const store = db.createObjectStore('deposits', { keyPath: 'id', autoIncrement: true });
          store.createIndex('depositDate', 'depositDate', { unique: false });
          store.createIndex('depositorName', 'depositorName', { unique: false });
          store.createIndex('amount', 'amount', { unique: false });
          store.createIndex('projectName', 'projectName', { unique: false });
          store.createIndex('matchStatus', 'matchStatus', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // transferRecords
        if (!db.objectStoreNames.contains('transferRecords')) {
          const store = db.createObjectStore('transferRecords', { keyPath: 'id', autoIncrement: true });
          store.createIndex('assignedToUserId', 'assignedToUserId', { unique: false });
          store.createIndex('transferDate', 'transferDate', { unique: false });
          store.createIndex('projectName', 'projectName', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // matchingLog
        if (!db.objectStoreNames.contains('matchingLog')) {
          const store = db.createObjectStore('matchingLog', { keyPath: 'id', autoIncrement: true });
          store.createIndex('invoiceId', 'invoiceId', { unique: false });
          store.createIndex('depositId', 'depositId', { unique: false });
          store.createIndex('matchedAt', 'matchedAt', { unique: false });
        }

        // auditLog
        if (!db.objectStoreNames.contains('auditLog')) {
          const store = db.createObjectStore('auditLog', { keyPath: 'id', autoIncrement: true });
          store.createIndex('action', 'action', { unique: false });
          store.createIndex('entityType', 'entityType', { unique: false });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // documents (문서보관)
        if (!db.objectStoreNames.contains('documents')) {
          const store = db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
          store.createIndex('companyName', 'companyName', { unique: false });
          store.createIndex('regNumber', 'regNumber', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // checklists (업무 체크리스트)
        if (!db.objectStoreNames.contains('checklists')) {
          const store = db.createObjectStore('checklists', { keyPath: 'id', autoIncrement: true });
          store.createIndex('period', 'period', { unique: false });
          store.createIndex('order', 'order', { unique: false });
        }

        // leaveRequests (연차 신청)
        if (!db.objectStoreNames.contains('leaveRequests')) {
          const store = db.createObjectStore('leaveRequests', { keyPath: 'id', autoIncrement: true });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('year', 'year', { unique: false });
        }

        // leaveBalances (연차 잔여)
        if (!db.objectStoreNames.contains('leaveBalances')) {
          const store = db.createObjectStore('leaveBalances', { keyPath: 'id', autoIncrement: true });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('year', 'year', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        reject(new Error('DB 열기 실패: ' + e.target.error));
      };
    });
  },

  _getStore(storeName, mode = 'readonly') {
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  },

  async add(storeName, data) {
    if (this.useFirebase) return FirebaseDB.add(storeName, data);
    await this.open();
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readwrite');
      const request = store.add(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async get(storeName, id) {
    if (this.useFirebase) return FirebaseDB.get(storeName, String(id));
    await this.open();
    // IndexedDB: 숫자 문자열이면 Number로 변환
    const localId = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName);
      const request = store.get(localId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getAll(storeName) {
    if (this.useFirebase) return FirebaseDB.getAll(storeName);
    await this.open();
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async getByIndex(storeName, indexName, value) {
    if (this.useFirebase) return FirebaseDB.getByIndex(storeName, indexName, value);
    await this.open();
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async update(storeName, data) {
    if (this.useFirebase) return FirebaseDB.update(storeName, data);
    await this.open();
    // IndexedDB: id가 숫자 문자열이면 Number로 변환
    const record = { ...data };
    if (typeof record.id === 'string' && /^\d+$/.test(record.id)) {
      record.id = Number(record.id);
    }
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readwrite');
      const request = store.put(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async delete(storeName, id) {
    if (this.useFirebase) return FirebaseDB.delete(storeName, String(id));
    await this.open();
    // IndexedDB: 숫자 문자열이면 Number로 변환
    const localId = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readwrite');
      const request = store.delete(localId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async count(storeName, indexName, value) {
    if (this.useFirebase) return FirebaseDB.count(storeName, indexName, value);
    await this.open();
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName);
      let request;
      if (indexName && value !== undefined) {
        request = store.index(indexName).count(value);
      } else {
        request = store.count();
      }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async clear(storeName) {
    if (this.useFirebase) return FirebaseDB.clear(storeName);
    await this.open();
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readwrite');
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async exportAll() {
    if (this.useFirebase) return FirebaseDB.exportAll();
    await this.open();
    const storeNames = ['users', 'taxInvoiceRequests', 'deposits', 'transferRecords', 'matchingLog', 'auditLog', 'documents', 'checklists'];
    const data = {};
    for (const name of storeNames) {
      data[name] = await this.getAll(name);
    }
    // Convert Blob attachments to base64
    for (const inv of data.taxInvoiceRequests) {
      if (inv.attachments) {
        for (const att of inv.attachments) {
          if (att.fileData instanceof Blob) {
            att.fileData = await this._blobToBase64(att.fileData);
            att._isBase64 = true;
          }
        }
      }
    }
    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      data
    };
  },

  async importAll(backup) {
    if (this.useFirebase) return FirebaseDB.importAll(backup);
    await this.open();
    const storeNames = ['users', 'taxInvoiceRequests', 'deposits', 'transferRecords', 'matchingLog', 'auditLog', 'documents', 'checklists'];
    for (const name of storeNames) {
      await this.clear(name);
      if (backup.data[name]) {
        for (const record of backup.data[name]) {
          // Restore base64 to Blob
          if (name === 'taxInvoiceRequests' && record.attachments) {
            for (const att of record.attachments) {
              if (att._isBase64 && typeof att.fileData === 'string') {
                att.fileData = this._base64ToBlob(att.fileData, att.fileType);
                delete att._isBase64;
              }
            }
          }
          await this.add(name, { ...record, id: undefined });
        }
      }
    }
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
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeType || 'application/octet-stream' });
  },

  // 감사 로그 기록
  async log(action, entityType, entityId, details) {
    const user = Auth.currentUser();
    await this.add('auditLog', {
      action,
      entityType,
      entityId,
      userId: user ? user.id : null,
      userName: user ? user.displayName : 'System',
      details: typeof details === 'object' ? JSON.stringify(details) : details,
      timestamp: new Date().toISOString()
    });
  },

  // 요청번호 자동생성
  async generateRequestNumber() {
    const year = new Date().getFullYear().toString().slice(2);
    const all = await this.getAll('taxInvoiceRequests');
    const thisYear = all.filter(r => r.requestNumber && r.requestNumber.startsWith(`TIR-${year}`));
    const num = (thisYear.length + 1).toString().padStart(4, '0');
    return `TIR-${year}-${num}`;
  }
};

// 전역으로 내보내기
window.DB = DB;
