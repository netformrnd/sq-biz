/* ============================================
   사업자등록증 OCR 엔진
   Tesseract.js를 이용한 한글 텍스트 인식

   ※ 로컬(file://) 환경에서는 Web Worker CORS 제한으로
      Tesseract.js가 실패할 수 있음.
      → v4 CDN + workerPath 지정 방식으로 대응
      → 실패 시 수동 입력 안내
   ============================================ */

const OCREngine = {
  isLoaded: false,
  _scriptVersion: null, // 'v4' or 'v5'

  // Tesseract.js CDN 로드 (v4 사용 - 로컬 호환성 우수)
  async loadTesseract() {
    if (this.isLoaded && window.Tesseract) return;

    return new Promise((resolve, reject) => {
      if (window.Tesseract) {
        this.isLoaded = true;
        resolve();
        return;
      }

      // v4를 먼저 시도 (로컬 file:// 호환성 더 좋음)
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';
      script.onload = () => {
        this.isLoaded = true;
        this._scriptVersion = 'v4';
        console.log('[OCR] Tesseract.js v4 로드 완료');
        resolve();
      };
      script.onerror = () => {
        // v4 실패 시 v5 시도
        console.warn('[OCR] v4 로드 실패, v5 시도...');
        const script5 = document.createElement('script');
        script5.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script5.onload = () => {
          this.isLoaded = true;
          this._scriptVersion = 'v5';
          console.log('[OCR] Tesseract.js v5 로드 완료');
          resolve();
        };
        script5.onerror = () => reject(new Error('Tesseract.js 로드 실패. 인터넷 연결을 확인하세요.'));
        document.head.appendChild(script5);
      };
      document.head.appendChild(script);
    });
  },

  // 이미지에서 텍스트 추출
  async recognizeImage(imageSource, onProgress) {
    await this.loadTesseract();

    console.log('[OCR] 인식 시작, 버전:', this._scriptVersion);

    try {
      if (this._scriptVersion === 'v4') {
        return await this._recognizeV4(imageSource, onProgress);
      } else {
        return await this._recognizeV5(imageSource, onProgress);
      }
    } catch (err) {
      console.error('[OCR] 인식 오류:', err);
      // 에러 메시지를 명확하게 전달
      const msg = err && err.message ? err.message : String(err) || 'OCR 처리 중 알 수 없는 오류가 발생했습니다.';
      throw new Error(msg);
    }
  },

  // Tesseract.js v4 방식
  async _recognizeV4(imageSource, onProgress) {
    const worker = await Tesseract.createWorker({
      logger: (m) => {
        console.log('[OCR v4]', m.status, m.progress);
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
        if (m.status === 'loading language traineddata' && onProgress) {
          onProgress(Math.round(m.progress * 30));
        }
      },
      // CDN 경로 명시 (로컬 file:// CORS 우회)
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@4/tesseract-core.wasm.js',
    });

    try {
      await worker.loadLanguage('kor+eng');
      await worker.initialize('kor+eng');

      if (onProgress) onProgress(40);

      const { data } = await worker.recognize(imageSource);
      await worker.terminate();

      console.log('[OCR] 인식 완료, 텍스트 길이:', data.text.length);
      console.log('[OCR] 원본 텍스트:\n', data.text);

      return this.parseBusinessRegistration(data.text);
    } catch (err) {
      try { await worker.terminate(); } catch (e) { /* 무시 */ }
      throw err;
    }
  },

  // Tesseract.js v5 방식
  async _recognizeV5(imageSource, onProgress) {
    const worker = await Tesseract.createWorker('kor+eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      }
    });

    try {
      const { data } = await worker.recognize(imageSource);
      await worker.terminate();
      return this.parseBusinessRegistration(data.text);
    } catch (err) {
      try { await worker.terminate(); } catch (e) { /* 무시 */ }
      throw err;
    }
  },

  // 사업자등록증 텍스트 파싱
  parseBusinessRegistration(text) {
    const result = {
      regNumber: '',
      companyName: '',
      repName: '',
      address: '',
      businessType: '',
      businessItem: '',
      rawText: text,
      confidence: {}
    };

    if (!text || text.trim().length === 0) {
      console.warn('[OCR] 인식된 텍스트가 없습니다.');
      return result;
    }

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const fullText = lines.join(' ');

    // 사업자등록번호 (다양한 형태 대응)
    const regPatterns = [
      /(\d{3})\s*[-–—·.]\s*(\d{2})\s*[-–—·.]\s*(\d{5})/,     // 000-00-00000
      /등록번호\s*[:\s]*(\d{3})\s*[-–—·.]?\s*(\d{2})\s*[-–—·.]?\s*(\d{5})/, // 등록번호: 000-00-00000
      /(\d{10})/   // 연속 10자리
    ];

    for (const pattern of regPatterns) {
      const regMatch = fullText.match(pattern);
      if (regMatch) {
        if (regMatch[3]) {
          // 3그룹 매칭 (000-00-00000)
          result.regNumber = `${regMatch[1]}-${regMatch[2]}-${regMatch[3]}`;
        } else if (regMatch[1] && regMatch[1].length === 10) {
          // 10자리 연속
          const n = regMatch[1];
          result.regNumber = `${n.slice(0,3)}-${n.slice(3,5)}-${n.slice(5)}`;
        }
        result.confidence.regNumber = regMatch[3] ? 'high' : 'medium';
        break;
      }
    }

    // 상호 (법인명) - 다양한 패턴
    const namePatterns = [
      /(?:상\s*호|법\s*인\s*명)\s*[:()\s]+\s*(.+)/,
      /(?:상\s*호|법\s*인\s*명)\s+(.+)/,
      /상호\(법인명\)\s*(.+)/,
    ];
    for (const line of lines) {
      for (const pattern of namePatterns) {
        const match = line.match(pattern);
        if (match) {
          result.companyName = match[1].replace(/[()[\]|]/g, '').replace(/\s{2,}/g, ' ').trim();
          result.confidence.companyName = 'high';
          break;
        }
      }
      if (result.companyName) break;
    }

    // 대표자
    const repPatterns = [
      /(?:대\s*표\s*자|성\s*명)\s*[:()\s]+\s*(.+)/,
      /(?:대\s*표\s*자|성\s*명)\s+(.+)/,
    ];
    for (const line of lines) {
      for (const pattern of repPatterns) {
        const match = line.match(pattern);
        if (match) {
          result.repName = match[1].replace(/[()[\]|]/g, '').replace(/\s{2,}/g, ' ').trim();
          result.confidence.repName = 'high';
          break;
        }
      }
      if (result.repName) break;
    }

    // 사업장 소재지
    const addrPatterns = [
      /(?:사업장\s*소?\s*재\s*지|소\s*재\s*지|사업장\s*주\s*소)\s*[:()\s]+\s*(.+)/,
      /(?:사업장\s*소?\s*재\s*지|소\s*재\s*지)\s+(.+)/,
    ];
    for (const line of lines) {
      for (const pattern of addrPatterns) {
        const match = line.match(pattern);
        if (match) {
          result.address = match[1].replace(/[|]/g, '').trim();
          result.confidence.address = 'high';
          break;
        }
      }
      if (result.address) break;
    }

    // 주소가 여러 줄인 경우 다음 줄 합치기
    if (result.address) {
      const addrIdx = lines.findIndex(l => l.includes(result.address));
      if (addrIdx >= 0 && addrIdx + 1 < lines.length) {
        const nextLine = lines[addrIdx + 1];
        if (nextLine && !nextLine.match(/업\s*태|종\s*목|개업|법인|대표|등록/)) {
          result.address += ' ' + nextLine.replace(/[|]/g, '').trim();
        }
      }
    }

    // 업태 & 종목 (같은 줄에 있는 경우 우선)
    for (const line of lines) {
      const combined = line.match(/업\s*태\s*[:()\s]*\s*(.+?)\s+종\s*목\s*[:()\s]*\s*(.+)/);
      if (combined) {
        result.businessType = combined[1].replace(/[|]/g, '').trim();
        result.businessItem = combined[2].replace(/[|]/g, '').trim();
        result.confidence.businessType = 'medium';
        result.confidence.businessItem = 'medium';
        break;
      }
    }

    // 업태 (단독)
    if (!result.businessType) {
      for (const line of lines) {
        const match = line.match(/업\s*태\s*[:()\s]+\s*(.+?)(?:\s*종\s*목|$)/);
        if (match) {
          result.businessType = match[1].replace(/[|]/g, '').trim();
          result.confidence.businessType = 'medium';
          break;
        }
      }
    }

    // 종목 (단독)
    if (!result.businessItem) {
      for (const line of lines) {
        const match = line.match(/종\s*목\s*[:()\s]+\s*(.+)/);
        if (match) {
          result.businessItem = match[1].replace(/[|]/g, '').trim();
          result.confidence.businessItem = 'medium';
          break;
        }
      }
    }

    console.log('[OCR] 파싱 결과:', JSON.stringify(result, (k, v) => k === 'rawText' ? '(생략)' : v, 2));
    return result;
  },

  // 이미지 전처리 (캔버스) - 인식률 향상
  preprocessImage(imageEl) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const scale = Math.max(1, 1200 / imageEl.naturalWidth);
      canvas.width = imageEl.naturalWidth * scale;
      canvas.height = imageEl.naturalHeight * scale;

      ctx.drawImage(imageEl, 0, 0, canvas.width, canvas.height);

      // 그레이스케일 + 대비 증가
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
        const val = gray > 128 ? 255 : (gray > 80 ? gray * 1.5 : gray * 0.5);
        const clamped = Math.min(255, Math.max(0, val));
        data[i] = data[i+1] = data[i+2] = clamped;
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }
};

window.OCREngine = OCREngine;
