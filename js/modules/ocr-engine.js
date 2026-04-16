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
    const companyMatch = fullText.match(
      /(?:상호|단체명|법인명)[^:：]*?[:\s：]\s*(.+?)(?=대표자|성명|개업|사업장|소재지|\d{3}-\d{2}|$)/
    );
    if (companyMatch) {
      let name = companyMatch[1].trim();
      // 앞뒤 콜론(반각/전각), 괄호, 특수문자 모두 제거
      name = name.replace(/^[:：\s.·,;]+/, '').replace(/[()（）\[\]|]/g, '').replace(/\s{2,}/g, ' ').trim();
      if (name.length >= 2 && name.length <= 50) {
        result.companyName = name;
        result.confidence.companyName = 'high';
      }
    }

    // === 3. 대표자 ===
    // 한글 이름 2~4자, "개업/연월/사업" 등 키워드 전에서 끊기
    const repMatch = fullText.match(
      /(?:대표자|성명)[^가-힣]*([가-힣]{2,4}?)(?=개업|연월|사업|주소|소재|\d|$)/
    );
    if (repMatch) {
      result.repName = repMatch[1];
      result.confidence.repName = 'high';
    }

    // === 4. 사업장 주소 ===
    // 시/도 이름으로 시작하는 실제 주소 패턴을 직접 찾기
    const SIDO = '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주';
    const addrRegex = new RegExp(`((?:${SIDO})(?:특별시|광역시|특별자치시|도|특별자치도)?\\s*[가-힣0-9\\s,.\\-()]+?)(?=업태|종목|개업|교부|사업의|발급|본점|법인|${SIDO}|$)`);
    const addrMatch = fullText.match(addrRegex);
    if (addrMatch && addrMatch[1].length >= 8) {
      let addr = addrMatch[1].trim();
      // 끝에 붙은 불필요한 문자 제거
      addr = addr.replace(/\s+$/, '').replace(/[,.\s]+$/, '').trim();
      result.address = addr;
      result.confidence.address = 'high';
    }

    // 주소를 못 찾았으면 "소재지" 레이블 기반
    if (!result.address) {
      const labelAddr = fullText.match(/(?:소재지|주소)\s*[:\s]\s*((?:${SIDO}).+?)(?=업태|종목|개업|본점|법인|$)/);
      if (labelAddr && labelAddr[1].length >= 8) {
        result.address = labelAddr[1].trim();
        result.confidence.address = 'medium';
      }
    }

    // === 5. 업태 ===
    // "업태" 뒤 콜론/공백 유무 상관없이, "종목" 전까지 추출
    const typePatterns = [
      /업태\s*[:\s]\s*(.+?)(?=종목|개업|교부|사업의|사업자|$)/,
      /업태\s*(.+?)(?=종목|개업|교부|$)/,
    ];
    for (const p of typePatterns) {
      const m = fullText.match(p);
      if (m) {
        let val = m[1].trim().replace(/^[:\s]+/, '').replace(/[|]/g, '').trim();
        if (val.length >= 1 && val.length <= 30) {
          result.businessType = val;
          result.confidence.businessType = 'medium';
          break;
        }
      }
    }

    // === 6. 종목 ===
    const itemPatterns = [
      /종목\s*[:\s]\s*(.+?)(?=개업|교부|사업의|사업자|발급|사업|$)/,
      /종목\s*(.+?)(?=개업|교부|사업|발급|$)/,
    ];
    for (const p of itemPatterns) {
      const m = fullText.match(p);
      if (m) {
        let val = m[1].trim().replace(/^[:\s]+/, '').replace(/[|]/g, '').trim();
        if (val.length >= 1 && val.length <= 30) {
          result.businessItem = val;
          result.confidence.businessItem = 'medium';
          break;
        }
      }
    }

    // === 주소 중복 제거 ===
    if (result.address && result.address.length > 15) {
      const half = Math.floor(result.address.length / 2);
      // 앞뒤 절반이 거의 같으면 앞 절반만 사용
      const first = result.address.substring(0, half).trim();
      const second = result.address.substring(half).trim();
      if (first === second) {
        result.address = first;
      } else {
        // 공백 기준 반복 체크
        const words = result.address.split(/\s+/);
        const halfW = Math.floor(words.length / 2);
        if (halfW >= 2) {
          const firstHalf = words.slice(0, halfW).join(' ');
          const secondHalf = words.slice(halfW).join(' ');
          if (firstHalf === secondHalf) {
            result.address = firstHalf;
          }
        }
      }
    }

    console.log('[OCR] 결과:', JSON.stringify(result, (k, v) => k === 'rawText' ? '(생략)' : v, 2));
    return result;
  }
};

window.OCREngine = OCREngine;
