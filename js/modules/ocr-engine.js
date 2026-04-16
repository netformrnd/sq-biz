/* ============================================
   사업자등록증 OCR 엔진
   Tesseract.js v4 + 향상된 파싱
   ============================================ */

const OCREngine = {
  isLoaded: false,
  _scriptVersion: null,

  async loadTesseract() {
    if (this.isLoaded && window.Tesseract) return;
    return new Promise((resolve, reject) => {
      if (window.Tesseract) { this.isLoaded = true; resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';
      script.onload = () => { this.isLoaded = true; this._scriptVersion = 'v4'; resolve(); };
      script.onerror = () => reject(new Error('Tesseract.js 로드 실패. 인터넷 연결을 확인하세요.'));
      document.head.appendChild(script);
    });
  },

  async recognizeImage(imageSource, onProgress) {
    await this.loadTesseract();
    try {
      return await this._recognizeV4(imageSource, onProgress);
    } catch (err) {
      console.error('[OCR] 인식 오류:', err);
      throw new Error((err && err.message) ? err.message : 'OCR 처리 중 오류');
    }
  },

  async _recognizeV4(imageSource, onProgress) {
    const worker = await Tesseract.createWorker({
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100));
        if (m.status === 'loading language traineddata' && onProgress) onProgress(Math.round(m.progress * 30));
      },
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@4/tesseract-core.wasm.js',
    });

    try {
      await worker.loadLanguage('kor+eng');
      await worker.initialize('kor+eng');
      // 사업자등록증 인식에 최적화된 설정
      await worker.setParameters({
        tessedit_pageseg_mode: '6', // 단일 텍스트 블록
      });

      if (onProgress) onProgress(40);
      const { data } = await worker.recognize(imageSource);
      await worker.terminate();

      console.log('[OCR] 인식 완료, 텍스트:\n', data.text);
      return this.parseBusinessRegistration(data.text);
    } catch (err) {
      try { await worker.terminate(); } catch (e) {}
      throw err;
    }
  },

  // ===== 향상된 파싱 =====
  parseBusinessRegistration(text) {
    const result = {
      regNumber: '', companyName: '', repName: '',
      address: '', businessType: '', businessItem: '',
      rawText: text, confidence: {}
    };

    if (!text || text.trim().length < 5) return result;

    // 공백/특수문자 정리
    const cleaned = text.replace(/\r/g, '');
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    const fullText = lines.join(' ');

    // === 사업자등록번호 (최우선) ===
    // 다양한 형태: 000-00-00000, 000 00 00000, 000.00.00000
    const regPatterns = [
      /(\d{3})\s*[-–—·.\s]\s*(\d{2})\s*[-–—·.\s]\s*(\d{5})/,
      /등록\s*번호[:\s]*(\d{3})\s*[-–—·.\s]?\s*(\d{2})\s*[-–—·.\s]?\s*(\d{5})/,
      /(\d{3})(\d{2})(\d{5})/, // 붙어있는 10자리
    ];
    for (const p of regPatterns) {
      const m = fullText.match(p);
      if (m) {
        result.regNumber = `${m[1]}-${m[2]}-${m[3]}`;
        result.confidence.regNumber = m[0].includes('-') ? 'high' : 'medium';
        break;
      }
    }

    // === 상호 ===
    const namePatterns = [
      /(?:상\s*호|법\s*인\s*명)[^가-힣a-zA-Z0-9]*([가-힣a-zA-Z0-9()（）\s]{2,})/,
      /상호\s*\(?법인명\)?\s*[:\s]*([가-힣a-zA-Z0-9()（）\s]{2,})/,
    ];
    for (const line of lines) {
      for (const p of namePatterns) {
        const m = line.match(p);
        if (m) {
          result.companyName = m[1].replace(/[()（）\[\]|]/g, '').replace(/\s{2,}/g, ' ').trim();
          if (result.companyName.length >= 2) {
            result.confidence.companyName = 'high';
            break;
          }
        }
      }
      if (result.companyName) break;
    }

    // === 대표자 ===
    const repPatterns = [
      /(?:대\s*표\s*자|성\s*명)[^가-힣a-zA-Z]*([가-힣a-zA-Z]{2,10})/,
    ];
    for (const line of lines) {
      for (const p of repPatterns) {
        const m = line.match(p);
        if (m) {
          result.repName = m[1].trim();
          result.confidence.repName = 'high';
          break;
        }
      }
      if (result.repName) break;
    }

    // === 주소 ===
    const addrPatterns = [
      /(?:사업장\s*소?\s*재\s*지|소\s*재\s*지|주\s*소)[^가-힣]*([가-힣0-9,.\-\s()]{5,})/,
    ];
    for (const line of lines) {
      for (const p of addrPatterns) {
        const m = line.match(p);
        if (m) {
          result.address = m[1].replace(/[|]/g, '').trim();
          result.confidence.address = 'high';
          break;
        }
      }
      if (result.address) break;
    }
    // 주소 다음 줄 합치기
    if (result.address) {
      const idx = lines.findIndex(l => l.includes(result.address));
      if (idx >= 0 && idx + 1 < lines.length) {
        const next = lines[idx + 1];
        if (next && !next.match(/업\s*태|종\s*목|개업|대표|등록|사업자/) && next.length > 3) {
          result.address += ' ' + next.replace(/[|]/g, '').trim();
        }
      }
    }

    // === 업태 & 종목 ===
    for (const line of lines) {
      const combined = line.match(/업\s*태[^가-힣a-zA-Z]*([가-힣a-zA-Z,\s]{1,30})\s*종\s*목[^가-힣a-zA-Z]*([가-힣a-zA-Z,\s]{1,30})/);
      if (combined) {
        result.businessType = combined[1].trim();
        result.businessItem = combined[2].trim();
        result.confidence.businessType = 'medium';
        result.confidence.businessItem = 'medium';
        break;
      }
    }
    if (!result.businessType) {
      for (const line of lines) {
        const m = line.match(/업\s*태[^가-힣a-zA-Z]*([가-힣a-zA-Z,\s]{1,30})/);
        if (m) { result.businessType = m[1].trim(); result.confidence.businessType = 'medium'; break; }
      }
    }
    if (!result.businessItem) {
      for (const line of lines) {
        const m = line.match(/종\s*목[^가-힣a-zA-Z]*([가-힣a-zA-Z,\s]{1,30})/);
        if (m) { result.businessItem = m[1].trim(); result.confidence.businessItem = 'medium'; break; }
      }
    }

    console.log('[OCR] 파싱 결과:', JSON.stringify(result, (k, v) => k === 'rawText' ? '(생략)' : v, 2));
    return result;
  },

  // 이미지 전처리 - 인식률 향상
  preprocessImage(imageEl) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 최소 1500px 너비 (해상도 높일수록 인식률 향상)
      const scale = Math.max(1, 1500 / imageEl.naturalWidth);
      canvas.width = imageEl.naturalWidth * scale;
      canvas.height = imageEl.naturalHeight * scale;

      // 배경 흰색
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imageEl, 0, 0, canvas.width, canvas.height);

      // 그레이스케일 + 이진화 (Otsu 방식 근사)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // 히스토그램으로 임계값 계산
      const histogram = new Array(256).fill(0);
      for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
        histogram[gray]++;
      }

      // Otsu 임계값
      const totalPixels = data.length / 4;
      let sum = 0, sumB = 0, wB = 0, wF = 0, maxVariance = 0, threshold = 128;
      for (let i = 0; i < 256; i++) sum += i * histogram[i];
      for (let i = 0; i < 256; i++) {
        wB += histogram[i]; if (wB === 0) continue;
        wF = totalPixels - wB; if (wF === 0) break;
        sumB += i * histogram[i];
        const mB = sumB / wB, mF = (sum - sumB) / wF;
        const variance = wB * wF * (mB - mF) * (mB - mF);
        if (variance > maxVariance) { maxVariance = variance; threshold = i; }
      }

      // 이진화 적용
      for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
        const val = gray > threshold ? 255 : 0;
        data[i] = data[i+1] = data[i+2] = val;
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }
};

window.OCREngine = OCREngine;
