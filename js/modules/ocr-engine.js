/* ============================================
   사업자등록증 OCR 엔진
   - 화면캡쳐(Ctrl+V) 기반 최적화
   - 한글 공백 정규화 처리
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
      script.onerror = () => reject(new Error('Tesseract.js 로드 실패. 인터넷 연결을 확인하세요.'));
      document.head.appendChild(script);
    });
  },

  async recognizeImage(imageSource, onProgress) {
    await this.loadTesseract();
    try {
      return await this._recognize(imageSource, onProgress);
    } catch (err) {
      console.error('[OCR] 인식 오류:', err);
      throw new Error((err && err.message) ? err.message : 'OCR 처리 중 오류');
    }
  },

  async _recognize(imageSource, onProgress) {
    console.log('[OCR] Worker 생성...');
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

      console.log('[OCR] 원본 텍스트:\n', data.text);
      return this.parseBusinessRegistration(data.text);
    } catch (err) {
      try { await worker.terminate(); } catch (e) {}
      throw err;
    }
  },

  // ===== 한글 공백 정규화 =====
  // Tesseract가 "경 기 도 여 주 시" 처럼 글자 사이에 공백을 넣는 문제 해결
  _collapseKoreanSpaces(text) {
    let result = text;
    // 한글 단일 글자 사이의 공백 제거 (반복 적용)
    for (let i = 0; i < 5; i++) {
      const prev = result;
      result = result.replace(/([가-힣])\s([가-힣])/g, '$1$2');
      if (result === prev) break;
    }
    return result;
  },

  // ===== 사업자등록증 파싱 =====
  parseBusinessRegistration(rawText) {
    const result = {
      regNumber: '', companyName: '', repName: '',
      address: '', businessType: '', businessItem: '',
      rawText: rawText, confidence: {}
    };

    if (!rawText || rawText.trim().length < 5) return result;

    // 원본 + 공백 정규화 버전 모두 준비
    const normalized = this._collapseKoreanSpaces(rawText);
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
    const fullText = lines.join(' ');

    console.log('[OCR] 정규화 텍스트:\n', normalized);

    // === 1. 사업자등록번호 ===
    const regPatterns = [
      /(\d{3})\s*[-–—·.]\s*(\d{2})\s*[-–—·.]\s*(\d{5})/,
      /등록번호\s*[:\s]*(\d{3})\s*[-–—·.]?\s*(\d{2})\s*[-–—·.]?\s*(\d{5})/,
    ];
    for (const p of regPatterns) {
      const m = fullText.match(p);
      if (m) {
        result.regNumber = `${m[1]}-${m[2]}-${m[3]}`;
        result.confidence.regNumber = 'high';
        break;
      }
    }

    // === 2. 상호 (법인명/단체명) ===
    // "상호(단체명)" 또는 "상호(법인명)" 레이블 뒤의 실제 회사명 추출
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // "상호" 또는 "단체명" 또는 "법인명" 레이블이 있는 줄 찾기
      if (line.match(/상호|단체명|법인명/)) {
        // 같은 줄에서 레이블 뒤의 값 추출
        let name = line
          .replace(/.*(?:상호|법인명|단체명)\s*[\(\)단체명법인]*\s*[:\s]*/i, '')
          .replace(/^[\s:()（）]+/, '')
          .trim();

        // 추출된 값이 너무 짧거나 레이블만이면 다음 줄 확인
        if (name.length < 2 || name.match(/^(단체명|법인명|상호)$/)) {
          // 다음 줄에 실제 이름이 있을 수 있음
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            if (nextLine.length >= 2 && !nextLine.match(/대표자|성명|사업장|등록|주소/)) {
              name = nextLine;
            }
          }
        }

        if (name.length >= 2) {
          result.companyName = name.replace(/[|[\]]/g, '').trim();
          result.confidence.companyName = 'high';
          break;
        }
      }
    }

    // === 3. 대표자 ===
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/대표자|성명/)) {
        let rep = line
          .replace(/.*(?:대표자|성명)\s*[\(\)성명]*\s*[:\s]*/i, '')
          .replace(/^[\s:()（）]+/, '')
          .trim();

        // 너무 짧으면 다음 줄
        if (rep.length < 2 || rep.match(/^(성명|대표자)$/)) {
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            if (nextLine.length >= 2 && nextLine.length <= 10 && !nextLine.match(/사업장|주소|업태|개업/)) {
              rep = nextLine;
            }
          }
        }

        if (rep.length >= 2 && rep.length <= 20) {
          result.repName = rep.replace(/[|[\]]/g, '').trim();
          result.confidence.repName = 'high';
          break;
        }
      }
    }

    // === 4. 사업장 주소 ===
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/사업장|소재지|본점/)) {
        let addr = line
          .replace(/.*(?:사업장소재지|사업장주소|소재지|본점소재지)\s*[:\s]*/i, '')
          .replace(/^[\s:]+/, '')
          .trim();

        // 다음 줄도 주소일 수 있음
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.length > 3 && !nextLine.match(/업태|종목|개업|대표|등록|사업자|상호/)) {
            // "본점소재지:" 같은 중복 레이블 제거
            const cleanNext = nextLine.replace(/.*(?:본점소재지|소재지)\s*[:\s]*/i, '').trim();
            if (cleanNext.length > 3 && !addr.includes(cleanNext)) {
              addr += ' ' + cleanNext;
            }
          }
        }

        // "본점소재지:" 레이블이 주소 안에 포함된 경우 제거
        addr = addr.replace(/본점소재지\s*[:]\s*/g, '').trim();

        if (addr.length >= 5) {
          result.address = addr;
          result.confidence.address = 'high';
          break;
        }
      }
    }

    // === 5. 업태 & 종목 ===
    for (const line of lines) {
      // 같은 줄에 업태와 종목이 있는 경우
      const combined = line.match(/업태\s*[:\s]*(.+?)\s+종목\s*[:\s]*(.+)/);
      if (combined) {
        result.businessType = combined[1].replace(/[|]/g, '').trim();
        result.businessItem = combined[2].replace(/[|]/g, '').trim();
        result.confidence.businessType = 'medium';
        result.confidence.businessItem = 'medium';
        break;
      }
    }

    if (!result.businessType) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/업태/) && !lines[i].match(/종목/)) {
          let val = lines[i].replace(/.*업태\s*[:\s]*/i, '').trim();
          if (val.length < 1 && i + 1 < lines.length) val = lines[i + 1].trim();
          if (val.length >= 1) {
            result.businessType = val.replace(/[|]/g, '').trim();
            result.confidence.businessType = 'medium';
            break;
          }
        }
      }
    }

    if (!result.businessItem) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/종목/)) {
          let val = lines[i].replace(/.*종목\s*[:\s]*/i, '').trim();
          if (val.length < 1 && i + 1 < lines.length) val = lines[i + 1].trim();
          if (val.length >= 1) {
            result.businessItem = val.replace(/[|]/g, '').trim();
            result.confidence.businessItem = 'medium';
            break;
          }
        }
      }
    }

    console.log('[OCR] 파싱 결과:', JSON.stringify(result, (k, v) => k === 'rawText' ? '(생략)' : v, 2));
    return result;
  }
};

window.OCREngine = OCREngine;
