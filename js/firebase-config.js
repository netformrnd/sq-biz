/* ============================================
   Firebase 기본 설정 (내장)
   - 이 파일에 설정이 있으면 자동으로 Firebase 연결
   - 직원들은 URL 접속만으로 바로 사용 가능
   - localStorage에 저장된 config가 있으면 그것을 우선 사용

   ※ Firebase apiKey는 웹 앱에서 공개되도록 설계된 값입니다
     실제 보안은 Firestore 보안 규칙(console.firebase.google.com)으로 이루어집니다
   ============================================ */

window.EMBEDDED_FIREBASE_CONFIG = {
  "apiKey": "AIzaSyDIGtoAD7m56XE-Zb2Ld5CmeGUsm_4vmls",
  "authDomain": "sq-biz.firebaseapp.com",
  "projectId": "sq-biz",
  "storageBucket": "sq-biz.firebasestorage.app",
  "messagingSenderId": "109722429748",
  "appId": "1:109722429748:web:7ecb2081a2f8e5338c5d61"
};
