/* ============================================
   암호화 유틸리티 (Web Crypto API - AES-GCM)
   - 백업 파일 암호화
   - 민감 필드 암호화 (사업자번호 등)
   ============================================ */

const CryptoHelper = {
  // 비밀번호에서 키 파생 (PBKDF2)
  async deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  // 문자열 암호화 → base64
  async encrypt(plaintext, password) {
    if (!plaintext) return '';
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, enc.encode(plaintext)
    );
    // salt + iv + ciphertext을 base64로 결합
    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
    return btoa(String.fromCharCode(...combined));
  },

  // base64 → 복호화 문자열
  async decrypt(encryptedBase64, password) {
    if (!encryptedBase64) return '';
    const combined = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)));
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const ciphertext = combined.slice(28);
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const key = await this.deriveKey(password, saltHex);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, ciphertext
    );
    return new TextDecoder().decode(plaintext);
  },

  // 간단한 필드 난독화용 (사업자번호 등)
  // 앱 전용 고정 키 사용 (DevTools 캐주얼 조회 방지)
  async fieldObfuscate(text) {
    if (!text) return '';
    return this.encrypt(text, 'sq_biz_field_2026');
  },

  async fieldDeobfuscate(encrypted) {
    if (!encrypted) return '';
    try {
      return await this.decrypt(encrypted, 'sq_biz_field_2026');
    } catch {
      return encrypted; // 이미 평문이면 그대로
    }
  }
};

window.CryptoHelper = CryptoHelper;
