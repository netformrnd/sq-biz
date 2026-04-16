/* ============================================
   사업자등록증 OCR 엔진
   - 화면캡쳐(Ctrl+V) 기반 최적화
   - 한글 공백 + 점(.) 정규화
   - 필드 경계 분리 파싱
   ============================================ */

const OCREngine = {
  isLoaded: false,

  async loadTesseract() {
    if (this.isLoaded && window.Tesseract) return;
    return new Promise((resolve, reject) => {
      if (window.Tesseract) { this.isLoaded = true; resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';
      script.onload = () => { this.isLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Tesseract.js 로드 실패'));
      document.head.appendChild(script);
    });
  },

  async recognizeImage(imageSource, onProgress) {
    await this.loadTesseract();
    try {
      return await this._recognize(imageSource, onProgress);
    } catch (err) {
      throw new Error((err && err.message) ? err.message : 'OCR 처리 중 오류');
    }
  },

  async _recognize(imageSource, onProgress) {
    let worker;
    try {
      worker = await Tesseract.createWorker({
        logger: (m) => {
          if (m.status === 'recognizing text' && onProgress) onProgress(50 + Math.round(m.progress * 50));
          if (m.status === 'loading language traineddata' && onProgress) onProgress(Math.round(m.progress * 40));
        },
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@4/tesseract-core.wasm.js',
      });
    } catch (e) {
      throw new Error('OCR Worker 생성 실패: ' + (e.message || e));
    }

    try {
      await worker.loadLanguage('kor+eng');
      await worker.initialize('kor+eng');
      if (onProgress) onProgress(45);
      const { data } = await worker.recognize(imageSource);
      await worker.terminate();
      console.log('[OCR] 원본:\n', data.text);
      return this.parseBusinessRegistration(data.text);
    } catch (err) {
      try { await worker.terminate(); } catch (e) {}
      throw err;
    }
  },

  // ===== 텍스트 정규화 =====
  _normalize(text) {
    let t = text;
    // 1. 점+공백 사이의 한글 합치기: "대 . 표 . 자" → "대표자"
    t = t.replace(/([가-힣])\s*\.\s*([가-힣])/g, '$1$2');
    // 반복 적용
    t = t.replace(/([가-힣])\s*\.\s*([가-힣])/g, '$1$2');
    // 2. 한글 단일 글자 사이 공백 제거: "경 기 도" → "경기도"
    for (let i = 0; i < 10; i++) {
      const prev = t;
      t = t.replace(/([가-힣])\s([가-힣])/g, '$1$2');
      if (t === prev) break;
    }
    return t;
  },

  // ===== 사업자등록증 파싱 =====
  parseBusinessRegistration(rawText) {
    const result = {
      regNumber: '', companyName: '', repName: '',
      address: '', businessType: '', businessItem: '',
      rawText: rawText, confidence: {}
    };

    if (!rawText || rawText.trim().length < 5) return result;

    // 정규화 적용
    const normalized = this._normalize(rawText);
    console.log('[OCR] 정규화:\n', normalized);

    // 전체 텍스트를 하나의 문자열로 (줄바꿈 → 공백)
    const fullText = normalized.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');

    // === 1. 사업자등록번호 ===
    const regMatch = fullText.match(/(\d{3})\s*[-–—·.]\s*(\d{2})\s*[-–—·.]\s*(\d{5})/);
    if (regMatch) {
      result.regNumber = `${regMatch[1]}-${regMatch[2]}-${regMatch[3]}`;
      result.confidence.regNumber = 'high';
    }

    // === 2. 상호 ===
    // "상호(단체명)" 또는 "상호(법인명)" 뒤에서 대표자/성명 전까지
    const companyMatch = fullText.match(
      /(?:상호|단체명|법인명)[^:]*?[:\s]\s*(.+?)(?=대표자|성명|개업|사업장|소재지|\d{3}-\d{2}|$)/
    );
    if (companyMatch) {
      let name = companyMatch[1].trim();
      // 끝에 붙은 불필요한 텍스트 제거
      name = name.replace(/[()（）\[\]|]/g, '').replace(/\s{2,}/g, ' ').trim();
      if (name.length >= 2 && name.length <= 50) {
        result.companyName = name;
        result.confidence.companyName = 'high';
      }
    }

    // === 3. 대표자 ===
    // "대표자" 또는 "성명" 뒤에서 한글 이름(2~5자) 추출
    const repMatch = fullText.match(
      /(?:대표자|성명)[^:]*?[:\s]\s*([가-힣]{2,5})/
    );
    if (repMatch) {
      result.repName = repMatch[1];
      result.confidence.repName = 'high';
    }

    // === 4. 사업장 주소 ===
    // "사업장소재지" 또는 "소재지" 뒤에서 주소 추출
    // 실제 주소는 시/도/구/군/동/로/길 패턴으로 시작
    const addrMatch = fullText.match(
      /(?:사업장소재지|소재지|주소)[^:]*?[:\s]\s*(.+?)(?=업태|종목|개업|교부|사업의|발급|$)/
    );
    if (addrMatch) {
      let addr = addrMatch[1].trim();
      // 레이블 잔해 제거
      addr = addr.replace(/\(?\s*법인사업자\s*:?\s*본점\s*\)?/g, '').trim();
      addr = addr.replace(/본점소재지\s*:?\s*/g, '').trim();
      // 실제 주소 부분만 추출 (시/도로 시작하는 부분)
      const realAddr = addr.match(/(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주).+/);
      if (realAddr) {
        addr = realAddr[0];
      }
      if (addr.length >= 5) {
        result.address = addr;
        result.confidence.address = 'high';
      }
    }

    // 주소를 못 찾았으면 시/도 패턴으로 직접 검색
    if (!result.address) {
      const directAddr = fullText.match(
        /((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|도|특별자치도)?\s*[가-힣0-9\s,.\-()]+?)(?=업태|종목|개업|교부|사업의|대표|$)/
      );
      if (directAddr && directAddr[1].length >= 8) {
        result.address = directAddr[1].trim();
        result.confidence.address = 'medium';
      }
    }

    // === 5. 업태 ===
    const typeMatch = fullText.match(/업태\s*[:\s]\s*(.+?)(?=종목|개업|교부|사업의|$)/);
    if (typeMatch) {
      let val = typeMatch[1].trim().replace(/[|]/g, '');
      if (val.length >= 1 && val.length <= 30) {
        result.businessType = val;
        result.confidence.businessType = 'medium';
      }
    }

    // === 6. 종목 ===
    const itemMatch = fullText.match(/종목\s*[:\s]\s*(.+?)(?=개업|교부|사업의|사업자|발급|$)/);
    if (itemMatch) {
      let val = itemMatch[1].trim().replace(/[|]/g, '');
      if (val.length >= 1 && val.length <= 30) {
        result.businessItem = val;
        result.confidence.businessItem = 'medium';
      }
    }

    console.log('[OCR] 결과:', JSON.stringify(result, (k, v) => k === 'rawText' ? '(생략)' : v, 2));
    return result;
  }
};

window.OCREngine = OCREngine;
