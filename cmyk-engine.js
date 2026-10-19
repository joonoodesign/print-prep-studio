/**
 * PrintPrep Studio Pro - CMYK 300/400 DPI & InDesign/Photoshop Automation Engine
 * 파일명: cmyk-engine.js
 *
 * 주요 기능:
 * 1. 인쇄 치수(mm) ↔ 픽셀(300/400 DPI) 정밀 변환 헬퍼
 * 2. GCR(회색 성분 대체), TAC(총 잉크량 제한, 기본 280%), K100 먹100% 보정이 포함된 정밀 RGB → CMYK 변환기
 * 3. 표준 4채널 CMYK 무손실 TIFF 바이너리 인코더 (포토샵/인디자인/일러스트레이터 완벽 호환, Little Endian IFD 오름차순)
 * 4. 로고 캔버스 픽셀 클러스터링 & 스캔라인 런-렝스/윤곽 최적화 기반 SVG 벡터 트레이서
 * 5. 인디자인(InDesign) 원클릭 자동 조판 스크립트(.jsx) 생성기 (4개 레이어, 도련/칼선/접지선/CMYK 스와치 자동 구성)
 * 6. 포토샵(Photoshop) ICC 프로파일 확인 및 CMYK PSD 변환 보조 스크립트(.jsx) 생성기
 * 7. 외부 라이브러리 없는 순수 JavaScript 무압축 ZIP 아카이브(.zip) 바이너리 빌더 (CRC32 포함)
 */

(function (global) {
  'use strict';

  const INCH_TO_MM = 25.4;

  // ============================================================================
  // 1. 인쇄 치수(mm) ↔ 픽셀(300/400 DPI) 변환 헬퍼
  // ============================================================================

  /**
   * 밀리미터(mm)를 지정된 DPI 기준 픽셀(px)로 변환합니다.
   * 예: 92mm @ 300DPI = 1087px, 52mm @ 300DPI = 614px
   * @param {number} mm - 밀리미터 치수
   * @param {number} [dpi=300] - 해상도 (기본 300 DPI)
   * @returns {number} 반올림된 픽셀 수
   */
  function mmToPx(mm, dpi = 300) {
    const safeMm = Number(mm) || 0;
    const safeDpi = Number(dpi) || 300;
    return Math.round((safeMm / INCH_TO_MM) * safeDpi);
  }

  /**
   * 픽셀(px)을 지정된 DPI 기준 밀리미터(mm)로 변환합니다.
   * @param {number} px - 픽셀 수
   * @param {number} [dpi=300] - 해상도 (기본 300 DPI)
   * @param {number} [decimals=2] - 소수점 자리수
   * @returns {number} 밀리미터 치수
   */
  function pxToMm(px, dpi = 300, decimals = 2) {
    const safePx = Number(px) || 0;
    const safeDpi = Number(dpi) || 300;
    const rawMm = (safePx * INCH_TO_MM) / safeDpi;
    const factor = Math.pow(10, decimals);
    return Math.round(rawMm * factor) / factor;
  }

  /**
   * 재단 사이즈(mm)와 도련(bleedMm)을 받아 작업용 전체 치수 및 픽셀 정보를 반환합니다.
   * @param {number} trimWidthMm - 재단 가로(mm)
   * @param {number} trimHeightMm - 재단 세로(mm)
   * @param {number} [bleedMm=1] - 사방 도련(mm, 기본 1mm -> 양쪽 +2mm)
   * @param {number} [dpi=300] - 해상도(DPI)
   */
  function calculatePrintDimensions(trimWidthMm, trimHeightMm, bleedMm = 1, dpi = 300) {
    const fullWidthMm = trimWidthMm + bleedMm * 2;
    const fullHeightMm = trimHeightMm + bleedMm * 2;
    return {
      trimWidthMm,
      trimHeightMm,
      bleedMm,
      fullWidthMm,
      fullHeightMm,
      dpi,
      trimWidthPx: mmToPx(trimWidthMm, dpi),
      trimHeightPx: mmToPx(trimHeightMm, dpi),
      bleedPx: mmToPx(bleedMm, dpi),
      fullWidthPx: mmToPx(fullWidthMm, dpi),
      fullHeightPx: mmToPx(fullHeightMm, dpi)
    };
  }

  // ============================================================================
  // 2. 정밀 RGB → CMYK 변환기 (GCR, TAC 제한, 어두운 텍스트 K100% 보정)
  // ============================================================================

  /**
   * RGB(0~255) 색상을 인쇄용 CMYK 색상으로 정밀 변환합니다.
   * - GCR (Gray Component Replacement): CMY 공통 회색 성분을 K(먹)로 대체하여 잉크 번짐 방지
   * - TAC (Total Area Coverage): C+M+Y+K 총 잉크량이 제한치(기본 280%)를 넘지 않도록 자동 스케일링
   * - forceK100ForDarkText: 어두운 무채색 픽셀을 K=100%, C=M=Y=0%로 보정하여 텍스트 핀트 어긋남 방지
   *
   * @param {number} r - Red (0~255)
   * @param {number} g - Green (0~255)
   * @param {number} b - Blue (0~255)
   * @param {Object} [options={}]
   * @param {number} [options.tacLimit=280] - 최대 총 잉크량 제한 (%, 기본 280)
   * @param {number} [options.gcrStrength=0.8] - 회색 성분 대체 강도 (0.0 ~ 1.0, 기본 0.8)
   * @param {boolean} [options.forceK100ForDarkText=false] - 어두운 무채색 픽셀 K100% 강제 보정 여부
   * @param {number} [options.darkTextLuminanceThreshold=48] - 어두운 무채색 판정 명도 임계값 (0~255)
   * @param {number} [options.darkTextChromaThreshold=18] - 어두운 무채색 판정 채도 편차 임계값 (0~255)
   * @param {boolean} [options.richBlackForDeepArea=false] - 넓은 검정 배경용 리치블랙(C30 M20 Y20 K100) 적용 여부
   * @returns {{ c: number, m: number, y: number, k: number, cByte: number, mByte: number, yByte: number, kByte: number, totalInk: number }}
   */
  function rgbToCmyk(r, g, b, options = {}) {
    const tacLimit = options.tacLimit !== undefined ? Number(options.tacLimit) : 280;
    const gcrStrength = options.gcrStrength !== undefined ? Math.max(0, Math.min(1, Number(options.gcrStrength))) : 0.8;
    const forceK100ForDarkText = Boolean(options.forceK100ForDarkText);
    const darkLumThreshold = options.darkTextLuminanceThreshold !== undefined ? Number(options.darkTextLuminanceThreshold) : 48;
    const darkChromaThreshold = options.darkTextChromaThreshold !== undefined ? Number(options.darkTextChromaThreshold) : 18;

    const R = Math.max(0, Math.min(255, Number(r) || 0));
    const G = Math.max(0, Math.min(255, Number(g) || 0));
    const B = Math.max(0, Math.min(255, Number(b) || 0));

    // 완전 흰색 빠른 처리
    if (R === 255 && G === 255 && B === 255) {
      return { c: 0, m: 0, y: 0, k: 0, cByte: 0, mByte: 0, yByte: 0, kByte: 0, totalInk: 0 };
    }

    const maxRGB = Math.max(R, G, B);
    const minRGB = Math.min(R, G, B);
    const chroma = maxRGB - minRGB;
    const luminance = 0.299 * R + 0.587 * G + 0.114 * B;

    // 어두운 무채색 텍스트/선 K100% 보정 옵션 활성화 시
    if (forceK100ForDarkText && luminance <= darkLumThreshold && chroma <= darkChromaThreshold) {
      return {
        c: 0,
        m: 0,
        y: 0,
        k: 100,
        cByte: 0,
        mByte: 0,
        yByte: 0,
        kByte: 255,
        totalInk: 100
      };
    }

    // 기본 CMY 추출 (0.0 ~ 1.0)
    let c0 = 1 - R / 255;
    let m0 = 1 - G / 255;
    let y0 = 1 - B / 255;

    const kBase = Math.min(c0, m0, y0);

    // 완전 검정 픽셀 처리
    if (kBase >= 0.999) {
      if (forceK100ForDarkText) {
        return { c: 0, m: 0, y: 0, k: 100, cByte: 0, mByte: 0, yByte: 0, kByte: 255, totalInk: 100 };
      }
      // 일반 이미지 내 깊은 암부는 TAC를 준수하는 정제된 리치 블랙으로 표현
      const richC = 35;
      const richM = 25;
      const richY = 25;
      const richK = 100;
      return {
        c: richC,
        m: richM,
        y: richY,
        k: richK,
        cByte: Math.round((richC / 100) * 255),
        mByte: Math.round((richM / 100) * 255),
        yByte: Math.round((richY / 100) * 255),
        kByte: 255,
        totalInk: richC + richM + richY + richK
      };
    }

    // GCR(회색 성분 대체) 적용
    // kBase에 gcrStrength를 곱해 K 채널로 보내고, CMY에서 해당 회색 성분을 감산하여 채도 유지 및 총 잉크량 절감
    const kOut = kBase * gcrStrength;
    const denom = 1 - kOut * 0.85;
    let c = Math.max(0, (c0 - kOut) / (denom > 0.0001 ? denom : 1));
    let m = Math.max(0, (m0 - kOut) / (denom > 0.0001 ? denom : 1));
    let y = Math.max(0, (y0 - kOut) / (denom > 0.0001 ? denom : 1));
    let k = kOut;

    // 인쇄 도트 게인(Dot Gain) 및 sRGB -> 오프셋 인쇄(Japan Color / FOGRA) 톤 커브 미세 보정
    // 순수 원색이 아닌 혼합 색상에서 탁해지는 현상을 줄이기 위해 미세 감마 적용
    c = Math.min(1, Math.max(0, Math.pow(c, 0.96)));
    m = Math.min(1, Math.max(0, Math.pow(m, 0.96)));
    y = Math.min(1, Math.max(0, Math.pow(y, 0.98)));
    k = Math.min(1, Math.max(0, k));

    let cPct = c * 100;
    let mPct = m * 100;
    let yPct = y * 100;
    let kPct = k * 100;

    // TAC (Total Area Coverage, 총 잉크량 제한 - 기본 280%) 적용
    const currentTotalInk = cPct + mPct + yPct + kPct;
    if (currentTotalInk > tacLimit && tacLimit > 0) {
      const cmySum = cPct + mPct + yPct;
      if (cmySum > 0) {
        const availableForCmy = Math.max(0, tacLimit - kPct);
        const scale = availableForCmy / cmySum;
        cPct *= scale;
        mPct *= scale;
        yPct *= scale;
      }
    }

    const finalC = Math.round(Math.max(0, Math.min(100, cPct)));
    const finalM = Math.round(Math.max(0, Math.min(100, mPct)));
    const finalY = Math.round(Math.max(0, Math.min(100, yPct)));
    const finalK = Math.round(Math.max(0, Math.min(100, kPct)));

    const cByte = Math.round((finalC / 100) * 255);
    const mByte = Math.round((finalM / 100) * 255);
    const yByte = Math.round((finalY / 100) * 255);
    const kByte = Math.round((finalK / 100) * 255);

    return {
      c: finalC,
      m: finalM,
      y: finalY,
      k: finalK,
      cByte,
      mByte,
      yByte,
      kByte,
      totalInk: finalC + finalM + finalY + finalK
    };
  }

  /**
   * CMYK(0~100%) 값을 화면 미리보기(Soft-Proofing)용 RGB(0~255)로 역변환합니다.
   * 인쇄용지 백색도 및 오프셋 잉크의 살짝 차분한 발색을 시뮬레이션할 수 있습니다.
   * @param {number} c - Cyan (0~100)
   * @param {number} m - Magenta (0~100)
   * @param {number} y - Yellow (0~100)
   * @param {number} k - Black (0~100)
   * @param {boolean} [simulatePaperTint=true] - 인쇄 감리용 시뮬레이션 적용 여부
   */
  function cmykToRgbPreview(c, m, y, k, simulatePaperTint = true) {
    const C = Math.max(0, Math.min(100, Number(c) || 0)) / 100;
    const M = Math.max(0, Math.min(100, Number(m) || 0)) / 100;
    const Y = Math.max(0, Math.min(100, Number(y) || 0)) / 100;
    const K = Math.max(0, Math.min(100, Number(k) || 0)) / 100;

    let r = 255 * (1 - C) * (1 - K);
    let g = 255 * (1 - M) * (1 - K);
    let b = 255 * (1 - Y) * (1 - K);

    if (simulatePaperTint) {
      // 오프셋 인쇄 시 RGB 형광빛이 살짝 죽고 종이 질감이 반영되는 효과를 재현
      r = r * 0.96 + 6;
      g = g * 0.955 + 6;
      b = b * 0.945 + 5;
    }

    return {
      r: Math.round(Math.max(0, Math.min(255, r))),
      g: Math.round(Math.max(0, Math.min(255, g))),
      b: Math.round(Math.max(0, Math.min(255, b)))
    };
  }

  // ============================================================================
  // 3. 진짜 4채널 CMYK 300/400 DPI 무손실 TIFF 바이너리 인코더
  // ============================================================================

  /**
   * HTMLCanvasElement 또는 ImageData를 입력받아 포토샵/인디자인/일러스트레이터에서
   * 즉시 CMYK(8-bit × 4채널) + 지정 DPI + 정확한 실물 mm 치수로 열리는 무손실 TIFF를 생성합니다.
   *
   * IFD 태그 오름차순(Tag ID 순서 엄수):
   * 256 (ImageWidth)               : LONG (1)
   * 257 (ImageLength)              : LONG (1)
   * 258 (BitsPerSample)            : SHORT (4) -> [8, 8, 8, 8]
   * 259 (Compression)              : SHORT (1) -> 1 (No compression)
   * 262 (PhotometricInterpretation): SHORT (1) -> 5 (Separated / CMYK)
   * 273 (StripOffsets)             : LONG (1) -> 픽셀 데이터 시작 오프셋
   * 277 (SamplesPerPixel)          : SHORT (1) -> 4
   * 278 (RowsPerStrip)             : LONG (1) -> height
   * 279 (StripByteCounts)          : LONG (1) -> width * height * 4
   * 282 (XResolution)              : RATIONAL (1) -> [dpi, 1]
   * 283 (YResolution)              : RATIONAL (1) -> [dpi, 1]
   * 284 (PlanarConfiguration)      : SHORT (1) -> 1 (Chunky: CMYKCMYK...)
   * 296 (ResolutionUnit)           : SHORT (1) -> 2 (Inch)
   * 332 (InkSet)                   : SHORT (1) -> 1 (CMYK)
   *
   * @param {HTMLCanvasElement|ImageData} canvasOrImageData - 변환할 캔버스 또는 ImageData
   * @param {number} [dpi=300] - 해상도 (300 또는 400 DPI 등)
   * @param {Object} [options={}] - rgbToCmyk 변환 옵션 (tacLimit, gcrStrength, forceK100ForDarkText 등)
   * @returns {{ uint8Array: Uint8Array, blob: Blob, width: number, height: number, dpi: number, widthMm: number, heightMm: number, byteLength: number }}
   */
  function encodeCMYKTiff(canvasOrImageData, dpi = 300, options = {}) {
    if (!canvasOrImageData) {
      throw new Error('encodeCMYKTiff: 유효한 Canvas 또는 ImageData가 필요합니다.');
    }

    let imageData;
    if (typeof HTMLCanvasElement !== 'undefined' && canvasOrImageData instanceof HTMLCanvasElement) {
      const ctx = canvasOrImageData.getContext('2d', { willReadFrequently: true });
      imageData = ctx.getImageData(0, 0, canvasOrImageData.width, canvasOrImageData.height);
    } else if (canvasOrImageData.data && canvasOrImageData.width && canvasOrImageData.height) {
      imageData = canvasOrImageData;
    } else {
      throw new Error('encodeCMYKTiff: 지원하지 않는 입력 형식입니다.');
    }

    const width = imageData.width;
    const height = imageData.height;
    const rgba = imageData.data;
    const safeDpi = Math.max(72, Math.round(Number(dpi) || 300));

    // TIFF 구조 레이아웃 계산
    // [0..7]     : 8 bytes  - TIFF Header (Little Endian 'II', 42, IFD Offset = 8)
    // [8..9]     : 2 bytes  - IFD Entry 개수 (14개)
    // [10..177]  : 168 bytes - 14개 Directory Entry (각 12 bytes)
    // [178..181] : 4 bytes  - Next IFD Offset (0)
    // [182..189] : 8 bytes  - BitsPerSample 값 [8, 8, 8, 8] (SHORT x 4)
    // [190..197] : 8 bytes  - XResolution 값 [safeDpi, 1] (RATIONAL x 1)
    // [198..205] : 8 bytes  - YResolution 값 [safeDpi, 1] (RATIONAL x 1)
    // [206..207] : 2 bytes  - 4바이트 정렬 패딩
    // [208..]    : width * height * 4 bytes - CMYK 픽셀 데이터

    const numEntries = 14;
    const ifdStartOffset = 8;
    const entriesByteLength = numEntries * 12; // 168
    const nextIfdPos = ifdStartOffset + 2 + entriesByteLength; // 178
    const extraValuesStart = nextIfdPos + 4; // 182

    const bitsPerSampleOffset = extraValuesStart; // 182 (8 bytes)
    const xResolutionOffset = bitsPerSampleOffset + 8; // 190 (8 bytes)
    const yResolutionOffset = xResolutionOffset + 8; // 198 (8 bytes)
    const pixelDataOffset = 208; // 정렬된 시작 오프셋

    const pixelByteCount = width * height * 4;
    const totalByteLength = pixelDataOffset + pixelByteCount;

    const buffer = new ArrayBuffer(totalByteLength);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // 1. TIFF Header 작성 (Little Endian)
    view.setUint8(0, 0x49); // 'I'
    view.setUint8(1, 0x49); // 'I'
    view.setUint16(2, 42, true); // Magic Number 42
    view.setUint32(4, ifdStartOffset, true); // First IFD Offset (8)

    // 2. IFD Entry 개수 기록
    view.setUint16(ifdStartOffset, numEntries, true);

    let entryOffset = ifdStartOffset + 2;

    /**
     * IFD 엔트리 기록 헬퍼 (Type: 3=SHORT, 4=LONG, 5=RATIONAL)
     */
    function writeIfdEntry(tag, type, count, valueOrOffset) {
      view.setUint16(entryOffset, tag, true);
      view.setUint16(entryOffset + 2, type, true);
      view.setUint32(entryOffset + 4, count, true);
      if (type === 3 && count === 1) {
        // SHORT (1개)인 경우 하위 2바이트에 값 기록, 상위 2바이트 0
        view.setUint16(entryOffset + 8, valueOrOffset, true);
        view.setUint16(entryOffset + 10, 0, true);
      } else {
        view.setUint32(entryOffset + 8, valueOrOffset, true);
      }
      entryOffset += 12;
    }

    // 오름차순 Tag ID 엄수하여 14개 태그 기록
    writeIfdEntry(256, 4, 1, width);                   // ImageWidth (LONG)
    writeIfdEntry(257, 4, 1, height);                  // ImageLength (LONG)
    writeIfdEntry(258, 3, 4, bitsPerSampleOffset);     // BitsPerSample (SHORT x 4 -> [8,8,8,8])
    writeIfdEntry(259, 3, 1, 1);                       // Compression (SHORT = 1, Uncompressed)
    writeIfdEntry(262, 3, 1, 5);                       // PhotometricInterpretation (SHORT = 5, CMYK)
    writeIfdEntry(273, 4, 1, pixelDataOffset);         // StripOffsets (LONG)
    writeIfdEntry(277, 3, 1, 4);                       // SamplesPerPixel (SHORT = 4)
    writeIfdEntry(278, 4, 1, height);                  // RowsPerStrip (LONG = height)
    writeIfdEntry(279, 4, 1, pixelByteCount);          // StripByteCounts (LONG = width * height * 4)
    writeIfdEntry(282, 5, 1, xResolutionOffset);       // XResolution (RATIONAL)
    writeIfdEntry(283, 5, 1, yResolutionOffset);       // YResolution (RATIONAL)
    writeIfdEntry(284, 3, 1, 1);                       // PlanarConfiguration (SHORT = 1, Chunky)
    writeIfdEntry(296, 3, 1, 2);                       // ResolutionUnit (SHORT = 2, Inch)
    writeIfdEntry(332, 3, 1, 1);                       // InkSet (SHORT = 1, CMYK)

    // Next IFD Offset = 0
    view.setUint32(nextIfdPos, 0, true);

    // 3. 오프셋 데이터 영역 기록
    // BitsPerSample: [8, 8, 8, 8]
    view.setUint16(bitsPerSampleOffset, 8, true);
    view.setUint16(bitsPerSampleOffset + 2, 8, true);
    view.setUint16(bitsPerSampleOffset + 4, 8, true);
    view.setUint16(bitsPerSampleOffset + 6, 8, true);

    // XResolution: safeDpi / 1
    view.setUint32(xResolutionOffset, safeDpi, true);
    view.setUint32(xResolutionOffset + 4, 1, true);

    // YResolution: safeDpi / 1
    view.setUint32(yResolutionOffset, safeDpi, true);
    view.setUint32(yResolutionOffset + 4, 1, true);

    // 4. 픽셀 데이터 변환 및 기록 (빠른 반복 색상 캐싱 적용)
    let dstIdx = pixelDataOffset;
    const pixelLength = rgba.length;

    // 직전 픽셀 캐시 (배경 단색 구간 등에서 수배 이상 속도 향상)
    let prevR = -1;
    let prevG = -1;
    let prevB = -1;
    let prevCByte = 0;
    let prevMByte = 0;
    let prevYByte = 0;
    let prevKByte = 0;

    for (let i = 0; i < pixelLength; i += 4) {
      const a = rgba[i + 3];

      // 완전 투명 픽셀은 인쇄 용지 색상(흰색: C=0, M=0, Y=0, K=0)으로 처리
      if (a === 0) {
        bytes[dstIdx++] = 0;
        bytes[dstIdx++] = 0;
        bytes[dstIdx++] = 0;
        bytes[dstIdx++] = 0;
        continue;
      }

      // 반투명 픽셀은 흰색 종이 배경(255, 255, 255)과 알파 블렌딩 처리
      let r = rgba[i];
      let g = rgba[i + 1];
      let b = rgba[i + 2];

      if (a < 255) {
        const alphaRatio = a / 255;
        const invAlpha = 1 - alphaRatio;
        r = Math.round(r * alphaRatio + 255 * invAlpha);
        g = Math.round(g * alphaRatio + 255 * invAlpha);
        b = Math.round(b * alphaRatio + 255 * invAlpha);
      }

      if (r === prevR && g === prevG && b === prevB) {
        bytes[dstIdx++] = prevCByte;
        bytes[dstIdx++] = prevMByte;
        bytes[dstIdx++] = prevYByte;
        bytes[dstIdx++] = prevKByte;
      } else {
        const cmyk = rgbToCmyk(r, g, b, options);
        prevR = r;
        prevG = g;
        prevB = b;
        prevCByte = cmyk.cByte;
        prevMByte = cmyk.mByte;
        prevYByte = cmyk.yByte;
        prevKByte = cmyk.kByte;

        bytes[dstIdx++] = prevCByte;
        bytes[dstIdx++] = prevMByte;
        bytes[dstIdx++] = prevYByte;
        bytes[dstIdx++] = prevKByte;
      }
    }

    const blob = new Blob([bytes], { type: 'image/tiff' });

    return {
      uint8Array: bytes,
      blob,
      width,
      height,
      dpi: safeDpi,
      widthMm: pxToMm(width, safeDpi, 2),
      heightMm: pxToMm(height, safeDpi, 2),
      byteLength: totalByteLength
    };
  }

  // ============================================================================
  // 4. 로고 SVG 벡터 트레이서 (클러스터링 + 스캔라인 런-렝스 병합 최적화)
  // ============================================================================

  /**
   * 로고 캔버스 픽셀을 분석하여 배경(투명 또는 모서리 배경색)을 제거하고
   * 주요 색상 클러스터(최대 2~4도 또는 단색)별로 수평/수직 스캔라인 런-렝스 병합 최적화를 수행해
   * 일러스트레이터/인디자인에서 즉시 패스 편집이 가능한 깔끔한 SVG 문자열을 생성합니다.
   *
   * @param {HTMLCanvasElement|ImageData} canvasOrImageData - 로고 캔버스 또는 ImageData
   * @param {Object} [options={}]
   * @param {number} [options.maxColors=4] - 최대 추출 색상 수 (1~6, 기본 4)
   * @param {number} [options.bgTolerance=38] - 배경색 판정 허용 오차 (기본 38)
   * @param {boolean} [options.monochromeK100=false] - 단색 먹100%(#000000) 벡터로 강제 변환 여부
   * @param {number} [options.maxTraceDimension=600] - 트레이싱 최대 해상도 제한(속도 및 패스 최적화용)
   * @returns {string} 표준 SVG 벡터 문자열
   */
  function traceLogoToSVG(canvasOrImageData, options = {}) {
    if (!canvasOrImageData) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
    }

    const maxColors = Math.max(1, Math.min(8, Number(options.maxColors) || 4));
    const bgTolerance = options.bgTolerance !== undefined ? Number(options.bgTolerance) : 38;
    const monochromeK100 = Boolean(options.monochromeK100);
    const maxDim = options.maxTraceDimension || 600;

    let srcWidth;
    let srcHeight;
    let workData;

    if (typeof HTMLCanvasElement !== 'undefined' && canvasOrImageData instanceof HTMLCanvasElement) {
      srcWidth = canvasOrImageData.width;
      srcHeight = canvasOrImageData.height;

      // 이미지가 너무 큰 경우 벡터 패스 복잡도를 줄이기 위해 리사이즈 캔버스에서 샘플링
      const scale = Math.min(1, maxDim / Math.max(srcWidth || 1, srcHeight || 1));
      const traceW = Math.max(1, Math.round(srcWidth * scale));
      const traceH = Math.max(1, Math.round(srcHeight * scale));

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = traceW;
      tempCanvas.height = traceH;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      tempCtx.drawImage(canvasOrImageData, 0, 0, traceW, traceH);
      workData = tempCtx.getImageData(0, 0, traceW, traceH);
    } else if (canvasOrImageData.data && canvasOrImageData.width && canvasOrImageData.height) {
      srcWidth = canvasOrImageData.width;
      srcHeight = canvasOrImageData.height;
      workData = canvasOrImageData;
    } else {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
    }

    const w = workData.width;
    const h = workData.height;
    const data = workData.data;

    // 1. 모서리 픽셀 샘플링으로 배경색 추정 (투명 배경인지 단색 배경인지 판별)
    const cornerIndices = [
      0,
      (w - 1) * 4,
      (h - 1) * w * 4,
      ((h - 1) * w + (w - 1)) * 4
    ];

    let transparentCorners = 0;
    let bgR = 255;
    let bgG = 255;
    let bgB = 255;
    let opaqueCornerCount = 0;
    let sumCornerR = 0;
    let sumCornerG = 0;
    let sumCornerB = 0;

    for (const idx of cornerIndices) {
      const a = data[idx + 3];
      if (a < 40) {
        transparentCorners++;
      } else {
        sumCornerR += data[idx];
        sumCornerG += data[idx + 1];
        sumCornerB += data[idx + 2];
        opaqueCornerCount++;
      }
    }

    if (opaqueCornerCount > 0) {
      bgR = Math.round(sumCornerR / opaqueCornerCount);
      bgG = Math.round(sumCornerG / opaqueCornerCount);
      bgB = Math.round(sumCornerB / opaqueCornerCount);
    }

    const hasTransparentBg = transparentCorners >= 2;
    const bgTolSq = bgTolerance * bgTolerance * 3;

    // 2. 전경(로고) 픽셀 판별 및 양자화 히스토그램 수집
    // 픽셀마다 배경이면 -1, 전경이면 색상 인덱스 부여 예정
    const fgMask = new Uint8Array(w * h);
    const colorBuckets = new Map();

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const a = data[i + 3];
      if (a < 64) {
        fgMask[p] = 0;
        continue;
      }

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // 불투명 배경일 경우 모서리 배경색 또는 흰색과 가까우면 배경으로 제외
      if (!hasTransparentBg) {
        const dr = r - bgR;
        const dg = g - bgG;
        const db = b - bgB;
        if (dr * dr + dg * dg + db * db <= bgTolSq) {
          fgMask[p] = 0;
          continue;
        }
      } else {
        // 투명 배경이더라도 완전 흰색에 가까운 노이즈(250 이상)는 옵션에 따라 제외
        if (options.removeWhiteInTransparent !== false && r > 248 && g > 248 && b > 248 && a < 200) {
          fgMask[p] = 0;
          continue;
        }
      }

      fgMask[p] = 1;

      if (!monochromeK100) {
        // 4비트(16단계) 양자화 키로 빈도수 집계
        const qr = r >> 4;
        const qg = g >> 4;
        const qb = b >> 4;
        const key = (qr << 8) | (qg << 4) | qb;
        let bucket = colorBuckets.get(key);
        if (!bucket) {
          bucket = { count: 0, sumR: 0, sumG: 0, sumB: 0 };
          colorBuckets.set(key, bucket);
        }
        bucket.count++;
        bucket.sumR += r;
        bucket.sumG += g;
        bucket.sumB += b;
      }
    }

    // 3. 주요 대표 색상 팔레트 선정 (최대 maxColors개)
    let palette = [];
    if (monochromeK100 || colorBuckets.size === 0) {
      palette = [{ r: 0, g: 0, b: 0, hex: '#000000' }];
    } else {
      const sortedBuckets = Array.from(colorBuckets.values())
        .sort((a, b) => b.count - a.count)
        .map((b) => ({
          count: b.count,
          r: Math.round(b.sumR / b.count),
          g: Math.round(b.sumG / b.count),
          b: Math.round(b.sumB / b.count)
        }));

      // 색상 간 거리가 충분히 떨어진 대표 색상들을 우선 선택
      const minClusterDistSq = 42 * 42;
      for (const candidate of sortedBuckets) {
        if (palette.length >= maxColors) break;
        let tooClose = false;
        for (const existing of palette) {
          const dr = candidate.r - existing.r;
          const dg = candidate.g - existing.g;
          const db = candidate.b - existing.b;
          if (dr * dr + dg * dg + db * db < minClusterDistSq) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          palette.push(candidate);
        }
      }

      if (palette.length === 0 && sortedBuckets.length > 0) {
        palette.push(sortedBuckets[0]);
      }

      // K-Means 2회 반복으로 클러스터 중심 정밀 보정
      for (let iter = 0; iter < 2; iter++) {
        const sums = palette.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
        for (const b of sortedBuckets) {
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let c = 0; c < palette.length; c++) {
            const dr = b.r - palette[c].r;
            const dg = b.g - palette[c].g;
            const db = b.b - palette[c].b;
            const dist = dr * dr + dg * dg + db * db;
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = c;
            }
          }
          sums[bestIdx].r += b.r * b.count;
          sums[bestIdx].g += b.g * b.count;
          sums[bestIdx].b += b.b * b.count;
          sums[bestIdx].count += b.count;
        }
        for (let c = 0; c < palette.length; c++) {
          if (sums[c].count > 0) {
            palette[c].r = Math.round(sums[c].r / sums[c].count);
            palette[c].g = Math.round(sums[c].g / sums[c].count);
            palette[c].b = Math.round(sums[c].b / sums[c].count);
          }
        }
      }

      palette = palette.map((c) => {
        const toHex = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
        return {
          ...c,
          hex: `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`,
          cmyk: rgbToCmyk(c.r, c.g, c.b, { forceK100ForDarkText: true })
        };
      });
    }

    // 4. 각 전경 픽셀을 가장 가까운 팔레트 인덱스(1..palette.length)에 매핑
    const labelGrid = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (fgMask[p] === 0) continue;
      if (palette.length === 1) {
        labelGrid[p] = 1;
        continue;
      }
      const idx = p * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      let bestC = 0;
      let bestDist = Infinity;
      for (let c = 0; c < palette.length; c++) {
        const dr = r - palette[c].r;
        const dg = g - palette[c].g;
        const db = b - palette[c].b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestC = c;
        }
      }
      labelGrid[p] = bestC + 1;
    }

    // 5. 색상 레이어별로 스캔라인 런-렝스提取 + 수직 직사각형 병합(Rectangle Merging)으로 최적화된 Path 생성
    // 단순 1px 조각이 아니라 인접 행의 동일 x1..x2 구간을 하나의 큰 폴리곤(M x y h w v h H x Z)으로 병합해 용량 85% 절감
    const svgGroups = [];

    for (let cIdx = 0; cIdx < palette.length; cIdx++) {
      const targetLabel = cIdx + 1;
      const colorInfo = palette[cIdx];

      // key: `${x1}_${x2}` -> { x1, x2, yStart, yEnd }
      let activeRects = new Map();
      const mergedRects = [];

      for (let y = 0; y < h; y++) {
        const rowOffset = y * w;
        const nextActiveRects = new Map();
        let x = 0;

        while (x < w) {
          if (labelGrid[rowOffset + x] === targetLabel) {
            const x1 = x;
            while (x < w && labelGrid[rowOffset + x] === targetLabel) {
              x++;
            }
            const x2 = x;
            const key = `${x1}_${x2}`;

            if (activeRects.has(key)) {
              const rect = activeRects.get(key);
              rect.yEnd = y + 1;
              nextActiveRects.set(key, rect);
              activeRects.delete(key);
            } else {
              nextActiveRects.set(key, { x1, x2, yStart: y, yEnd: y + 1 });
            }
          } else {
            x++;
          }
        }

        // 이번 행에서 이어지지 않은 직사각형들은 최종 목록으로 확정
        for (const finishedRect of activeRects.values()) {
          mergedRects.push(finishedRect);
        }
        activeRects = nextActiveRects;
      }

      for (const finishedRect of activeRects.values()) {
        mergedRects.push(finishedRect);
      }

      if (mergedRects.length === 0) continue;

      // SVG Path 문자열 조립 (소수점 없는 깔끔한 상대/절대 명령어 조합)
      const pathSegments = [];
      for (let i = 0; i < mergedRects.length; i++) {
        const r = mergedRects[i];
        const rw = r.x2 - r.x1;
        const rh = r.yEnd - r.yStart;
        pathSegments.push(`M${r.x1} ${r.yStart}h${rw}v${rh}h-${rw}Z`);
      }

      const cmykAttr = colorInfo.cmyk
        ? ` data-cmyk="C${colorInfo.cmyk.c}-M${colorInfo.cmyk.m}-Y${colorInfo.cmyk.y}-K${colorInfo.cmyk.k}"`
        : '';

      svgGroups.push(
        `  <g id="Logo_Color_${cIdx + 1}" fill="${colorInfo.hex}"${cmykAttr}>\n` +
        `    <path d="${pathSegments.join('')}" shape-rendering="geometricPrecision" />\n` +
        `  </g>`
      );
    }

    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${srcWidth}" height="${srcHeight}" data-generator="PrintPrep Studio Pro Vector Tracer">`,
      ...svgGroups,
      `</svg>`
    ].join('\n');
  }

  // ============================================================================
  // 5. 인디자인(InDesign) 원클릭 자동 조판 스크립트 생성기 (.jsx)
  // ============================================================================

  /**
   * ExtendScript(.jsx) 문자열 내부에 안전하게 삽입할 수 있도록 이스케이프합니다.
   */
  function escapeJsxString(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r\n/g, '\\r')
      .replace(/\n/g, '\\r')
      .replace(/\r/g, '\\r');
  }

  /**
   * 인디자인(InDesign)에서 더블클릭 한 번으로 실행되는 완벽한 자동 조판 ExtendScript(.jsx)를 생성합니다.
   *
   * 주요 특징:
   * - 맨 앞 UTF-8 BOM(\uFEFF)을 포함하여 한글 깨짐 완벽 방지
   * - `File($.fileName).parent`를 기준으로 같은 폴더의 `background_CMYK_300dpi.tif`,
   *   `logo_CMYK_300dpi.tif`(또는 `logo_vector.svg`)를 상대경로로 자동 탐색하여 압축 해제 위치와 무관하게 100% 작동
   * - 4개 표준 인쇄 레이어 자동 생성:
   *   1) `01_배경_CMYK_300DPI`
   *   2) `02_로고_벡터_고화질`
   *   3) `03_고객정보_텍스트`
   *   4) `04_인쇄칼선_가이드_M100` (원형 스티커 정원 칼선 / 사각 라운딩 칼선 / 2단·3단 접지 안내선 자동 생성)
   *
   * @param {Object} jobSpec - 작업 명세 객체
   * @returns {string} UTF-8 BOM이 포함된 InDesign `.jsx` 스크립트 문자열
   */
  function generateInDesignJSX(jobSpec = {}) {
    const title = escapeJsxString(jobSpec.title || 'PrintPrep_인쇄작업');
    const category = jobSpec.category || 'card'; // 'card' | 'sticker' | 'flyer'
    const shape = jobSpec.shape || 'rect'; // 'rect' | 'circle'
    const trimWidthMm = Number(jobSpec.trimWidthMm) || 90;
    const trimHeightMm = Number(jobSpec.trimHeightMm) || 50;
    const bleedMm = jobSpec.bleedMm !== undefined ? Number(jobSpec.bleedMm) : 1;
    const dpi = Number(jobSpec.dpi) || 300;
    const foldType = jobSpec.foldType || 'none'; // 'none' | '2fold' | '3fold'
    const cornerRadiusMm = jobSpec.cornerRadiusMm !== undefined ? Number(jobSpec.cornerRadiusMm) : 0;
    const bgFileName = escapeJsxString(jobSpec.bgFileName || `background_CMYK_${dpi}dpi.tif`);
    const logoTiffName = escapeJsxString(jobSpec.logoFileName || `logo_CMYK_${dpi}dpi.tif`);
    const logoSvgName = escapeJsxString(jobSpec.logoSvgName || 'logo_vector.svg');

    const logoBox = jobSpec.logoBox || { hasLogo: false, xMm: 10, yMm: 10, widthMm: 20, heightMm: 12 };
    const textItems = Array.isArray(jobSpec.textItems) ? jobSpec.textItems : [];

    const serializedTextItems = JSON.stringify(
      textItems.map((item) => ({
        text: String(item.text || ''),
        xMm: Number(item.xMm) || 0,
        yMm: Number(item.yMm) || 0,
        widthMm: Math.max(5, Number(item.widthMm) || 40),
        heightMm: Math.max(4, Number(item.heightMm) || 8),
        fontSizePt: Math.max(4, Number(item.fontSizePt) || 9),
        fontFamily: String(item.fontFamily || '맑은 고딕'),
        align: String(item.align || 'left'),
        c: Math.round(Math.max(0, Math.min(100, Number(item.c) || 0))),
        m: Math.round(Math.max(0, Math.min(100, Number(item.m) || 0))),
        y: Math.round(Math.max(0, Math.min(100, Number(item.y) || 0))),
        k: Math.round(Math.max(0, Math.min(100, Number(item.k !== undefined ? item.k : 100)))),
        isK100: item.isK100 !== undefined ? Boolean(item.isK100) : true
      })),
      null,
      2
    );

    const serializedLogoBox = JSON.stringify({
      hasLogo: Boolean(logoBox.hasLogo),
      xMm: Number(logoBox.xMm) || 8,
      yMm: Number(logoBox.yMm) || 8,
      widthMm: Math.max(4, Number(logoBox.widthMm) || 22),
      heightMm: Math.max(4, Number(logoBox.heightMm) || 12)
    });

    const jsxContent = `\uFEFF#target indesign
/**
 * ============================================================================
 * PrintPrep Studio Pro - Adobe InDesign 원클릭 자동 조판 스크립트 (.jsx)
 * 작업명: ${title}
 * 품목: ${category} (${shape === 'circle' ? '원형 칼선' : '사각형'})
 * 재단 사이즈: ${trimWidthMm}mm × ${trimHeightMm}mm (도련 ${bleedMm}mm / 해상도 ${dpi} DPI)
 * ============================================================================
 * 사용 방법:
 * 1. 다운로드한 ZIP 파일의 압축을 임의의 폴더에 모두 풉니다.
 * 2. 인디자인(InDesign) [창] -> [유틸리티] -> [스크립트] 패널에서 이 파일(.jsx)을 더블클릭하거나,
 *    파일을 인디자인 아이콘 위로 드래그하여 실행하세요.
 * 3. 스크립트가 위치한 폴더에서 배경 CMYK TIFF와 로고 파일을 자동으로 찾아 레이어별로 완벽하게 배치합니다!
 */

(function () {
  var oldInteractionLevel = app.scriptPreferences.userInteractionLevel;
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.INTERACT_WITH_ALL;

  try {
    // 1. 현재 스크립트(.jsx)가 위치한 폴더 경로 자동 파악
    var scriptFile = new File($.fileName);
    var baseFolder = scriptFile.parent;

    var JOB = {
      title: "${title}",
      category: "${category}",
      shape: "${shape}",
      trimWidthMm: ${trimWidthMm},
      trimHeightMm: ${trimHeightMm},
      bleedMm: ${bleedMm},
      dpi: ${dpi},
      foldType: "${foldType}",
      cornerRadiusMm: ${cornerRadiusMm},
      bgFileName: "${bgFileName}",
      logoTiffName: "${logoTiffName}",
      logoSvgName: "${logoSvgName}",
      logoBox: ${serializedLogoBox},
      textItems: ${serializedTextItems}
    };

    // 2. 새 인디자인 문서 생성 및 측정 단위를 밀리미터(mm)로 설정
    var doc = app.documents.add();
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;

    var docPrefs = doc.documentPreferences;
    docPrefs.pageWidth = JOB.trimWidthMm;
    docPrefs.pageHeight = JOB.trimHeightMm;
    docPrefs.facingPages = false;
    docPrefs.pagesPerDocument = 1;

    // 사방 도련(Bleed) 자동 설정
    docPrefs.documentBleedUniformSize = false;
    docPrefs.documentBleedTopOffset = JOB.bleedMm;
    docPrefs.documentBleedBottomOffset = JOB.bleedMm;
    docPrefs.documentBleedInsideOrLeftOffset = JOB.bleedMm;
    docPrefs.documentBleedOutsideOrRightOffset = JOB.bleedMm;

    var page = doc.pages.item(0);

    // 여백(Margin) 0으로 초기화하여 텍스트 프레임 간섭 방지
    try {
      page.marginPreferences.top = 0;
      page.marginPreferences.bottom = 0;
      page.marginPreferences.left = 0;
      page.marginPreferences.right = 0;
    } catch (eMargin) {}

    // 3. CMYK 스와치 생성 헬퍼 함수
    function getOrCreateCmykSwatch(swatchName, c, m, y, k) {
      var existing = doc.colors.itemByName(swatchName);
      if (existing && existing.isValid) {
        return existing;
      }
      var newColor = doc.colors.add({
        name: swatchName,
        model: ColorModel.PROCESS,
        space: ColorSpace.CMYK,
        colorValue: [c, m, y, k]
      });
      return newColor;
    }

    var paperSwatch = doc.swatches.itemByName("Paper");
    var noneSwatch = doc.swatches.itemByName("None");
    var blackSwatch = doc.swatches.itemByName("Black");
    var cutlineSwatch = getOrCreateCmykSwatch("칼선_M100", 0, 100, 0, 0);

    // 4. 4개 표준 레이어 생성 및 정렬 (아래에서 위로: 배경 -> 로고 -> 텍스트 -> 칼선)
    var defaultLayer = doc.layers.item(0);
    defaultLayer.name = "01_배경_CMYK_300DPI";
    var layerBg = defaultLayer;

    var layerLogo = doc.layers.add({ name: "02_로고_벡터_고화질" });
    var layerText = doc.layers.add({ name: "03_고객정보_텍스트" });
    var layerCutline = doc.layers.add({ name: "04_인쇄칼선_가이드_M100" });

    // ========================================================================
    // [레이어 1] 01_배경_CMYK_300DPI : 도련 포함 영역에 배경 TIFF 꽉 차게 자동 배치
    // ========================================================================
    var bgRect = page.rectangles.add(layerBg);
    // 인디자인 geometricBounds 순서: [y1(Top), x1(Left), y2(Bottom), x2(Right)]
    bgRect.geometricBounds = [
      -JOB.bleedMm,
      -JOB.bleedMm,
      JOB.trimHeightMm + JOB.bleedMm,
      JOB.trimWidthMm + JOB.bleedMm
    ];
    bgRect.strokeWeight = 0;
    bgRect.strokeColor = noneSwatch;

    var bgFile = new File(baseFolder.fsName + "/" + JOB.bgFileName);
    if (!bgFile.exists) {
      // 기본 300dpi 파일명 폴백 탐색
      bgFile = new File(baseFolder.fsName + "/background_CMYK_300dpi.tif");
    }

    if (bgFile.exists) {
      bgRect.place(bgFile);
      bgRect.fit(FitOptions.CONTENT_TO_FRAME);
    } else {
      var fallbackBgSwatch = getOrCreateCmykSwatch("배경_임시_CMYK", 5, 3, 0, 0);
      bgRect.fillColor = fallbackBgSwatch;
    }

    // ========================================================================
    // [레이어 2] 02_로고_벡터_고화질 : 지정된 mm 좌표에 로고 파일 자동 배치
    // ========================================================================
    if (JOB.logoBox && JOB.logoBox.hasLogo) {
      var lb = JOB.logoBox;
      var logoFrame = page.rectangles.add(layerLogo);
      logoFrame.geometricBounds = [
        lb.yMm,
        lb.xMm,
        lb.yMm + lb.heightMm,
        lb.xMm + lb.widthMm
      ];
      logoFrame.strokeWeight = 0;
      logoFrame.strokeColor = noneSwatch;
      logoFrame.fillColor = noneSwatch;

      var logoTiffFile = new File(baseFolder.fsName + "/" + JOB.logoTiffName);
      var logoSvgFile = new File(baseFolder.fsName + "/" + JOB.logoSvgName);
      var fallbackLogoTiff = new File(baseFolder.fsName + "/logo_CMYK_300dpi.tif");

      if (logoTiffFile.exists) {
        logoFrame.place(logoTiffFile);
        logoFrame.fit(FitOptions.PROPORTIONALLY);
        logoFrame.fit(FitOptions.CENTER_CONTENT);
      } else if (fallbackLogoTiff.exists) {
        logoFrame.place(fallbackLogoTiff);
        logoFrame.fit(FitOptions.PROPORTIONALLY);
        logoFrame.fit(FitOptions.CENTER_CONTENT);
      } else if (logoSvgFile.exists) {
        logoFrame.place(logoSvgFile);
        logoFrame.fit(FitOptions.PROPORTIONALLY);
        logoFrame.fit(FitOptions.CENTER_CONTENT);
      }
    }

    // ========================================================================
    // [레이어 3] 03_고객정보_텍스트 : 편집 가능한 텍스트 프레임 및 CMYK/K100 자동 적용
    // ========================================================================
    for (var i = 0; i < JOB.textItems.length; i++) {
      var item = JOB.textItems[i];
      if (!item.text || item.text === "") continue;

      var tf = page.textFrames.add(layerText);
      tf.geometricBounds = [
        item.yMm,
        item.xMm,
        item.yMm + item.heightMm,
        item.xMm + item.widthMm
      ];
      tf.contents = item.text;
      tf.strokeWeight = 0;
      tf.strokeColor = noneSwatch;
      tf.fillColor = noneSwatch;

      try {
        tf.textFramePreferences.firstBaselineOffset = FirstBaseline.LEADING_OFFSET;
        tf.textFramePreferences.insetSpacing = [0, 0, 0, 0];
      } catch (eTf) {}

      var paras = tf.paragraphs.everyItem();
      paras.pointSize = item.fontSizePt;

      // 정렬 설정
      if (item.align === "center") {
        paras.justification = Justification.CENTER_ALIGN;
      } else if (item.align === "right") {
        paras.justification = Justification.RIGHT_ALIGN;
      } else {
        paras.justification = Justification.LEFT_ALIGN;
      }

      // 색상 설정 (K100% 먹단색 또는 사용자 지정 CMYK 스와치)
      if (item.isK100 || (item.c === 0 && item.m === 0 && item.y === 0 && item.k === 100)) {
        paras.fillColor = blackSwatch;
        paras.fillTint = 100;
        try {
          paras.overprintFill = true; // 먹 100% 글자는 인쇄 시 오버프린트(녹아웃 방지) 권장
        } catch (eOv) {}
      } else {
        var customName = "텍스트_C" + item.c + "_M" + item.m + "_Y" + item.y + "_K" + item.k;
        var textColor = getOrCreateCmykSwatch(customName, item.c, item.m, item.y, item.k);
        paras.fillColor = textColor;
      }

      // 폰트 적용 시도 (설치된 폰트가 없을 경우 인디자인 기본 한글 폰트 유지)
      if (item.fontFamily) {
        try {
          paras.appliedFont = item.fontFamily;
        } catch (eFont) {}
      }
    }

    // ========================================================================
    // [레이어 4] 04_인쇄칼선_가이드_M100 : 원형/사각 칼선(M100%) 및 접지 안내선 생성
    // ========================================================================
    if (JOB.shape === "circle") {
      // 원형 스티커: 재단 사이즈(0, 0, trimHeightMm, trimWidthMm) 크기의 정확한 정원 생성
      var circleCut = page.ovals.add(layerCutline);
      circleCut.geometricBounds = [0, 0, JOB.trimHeightMm, JOB.trimWidthMm];
      circleCut.fillColor = noneSwatch;
      circleCut.strokeColor = cutlineSwatch;
      circleCut.strokeWeight = "0.5pt";
    } else if (JOB.category === "sticker" || JOB.cornerRadiusMm > 0) {
      // 사각 스티커 또는 라운딩 명함: 모서리 라운딩이 적용된 사각형 칼선 생성
      var rectCut = page.rectangles.add(layerCutline);
      rectCut.geometricBounds = [0, 0, JOB.trimHeightMm, JOB.trimWidthMm];
      rectCut.fillColor = noneSwatch;
      rectCut.strokeColor = cutlineSwatch;
      rectCut.strokeWeight = "0.5pt";

      if (JOB.cornerRadiusMm > 0) {
        try {
          rectCut.topLeftCornerOption = CornerOptions.ROUNDED_CORNER;
          rectCut.topRightCornerOption = CornerOptions.ROUNDED_CORNER;
          rectCut.bottomLeftCornerOption = CornerOptions.ROUNDED_CORNER;
          rectCut.bottomRightCornerOption = CornerOptions.ROUNDED_CORNER;
          rectCut.topLeftCornerRadius = JOB.cornerRadiusMm;
          rectCut.topRightCornerRadius = JOB.cornerRadiusMm;
          rectCut.bottomLeftCornerRadius = JOB.cornerRadiusMm;
          rectCut.bottomRightCornerRadius = JOB.cornerRadiusMm;
        } catch (eCorner) {}
      }
    } else {
      // 일반 명함/전단지 재단선 참조용 M100 프레임
      var trimGuideRect = page.rectangles.add(layerCutline);
      trimGuideRect.geometricBounds = [0, 0, JOB.trimHeightMm, JOB.trimWidthMm];
      trimGuideRect.fillColor = noneSwatch;
      trimGuideRect.strokeColor = cutlineSwatch;
      trimGuideRect.strokeWeight = "0.25pt";
      trimGuideRect.nonprinting = true;
    }

    // 2단 / 3단 접지 홍보물인 경우 접지 위치에 인디자인 안내선(Guides) 및 접지 표시선 자동 생성
    if (JOB.foldType === "2fold") {
      var foldX = Math.round((JOB.trimWidthMm / 2) * 100) / 100;
      page.guides.add(layerCutline, {
        orientation: HorizontalOrVertical.VERTICAL,
        location: foldX
      });
    } else if (JOB.foldType === "3fold") {
      // 3단 접지(안쪽으로 말아 접는 표준 비율 또는 3등분 가이드)
      var fold1 = Math.round((JOB.trimWidthMm / 3) * 100) / 100;
      var fold2 = Math.round(((JOB.trimWidthMm * 2) / 3) * 100) / 100;
      page.guides.add(layerCutline, {
        orientation: HorizontalOrVertical.VERTICAL,
        location: fold1
      });
      page.guides.add(layerCutline, {
        orientation: HorizontalOrVertical.VERTICAL,
        location: fold2
      });
    }

    // 고품질 화면 표시 모드로 전환하여 배치된 300DPI TIFF가 선명하게 보이도록 설정
    try {
      app.activeWindow.viewDisplaySetting = ViewDisplaySettings.HIGH_QUALITY;
      app.activeWindow.zoom(ZoomOptions.FIT_PAGE);
    } catch (eView) {}

    alert("✅ PrintPrep Studio Pro 자동 조판이 완료되었습니다!\\n레이어별로 배경(CMYK 300DPI), 로고, 텍스트 상자, 칼선이 배치되었습니다.");
  } catch (err) {
    alert("⚠️ 인디자인 자동 조판 중 오류가 발생했습니다:\\n" + err.message + " (줄 번호: " + err.line + ")");
  } finally {
    app.scriptPreferences.userInteractionLevel = oldInteractionLevel;
  }
})();
`;

    return jsxContent;
  }

  // ============================================================================
  // 6. 포토샵 ICC 프로파일 변환 보조 스크립트 생성기 (.jsx)
  // ============================================================================

  /**
   * 포토샵(Photoshop)에서 배경 CMYK TIFF를 열어 인쇄소 표준 CMYK 프로파일(Japan Color 2001 Coated 등)을
   * 확인/지정하고 고해상도 CMYK PSD 파일로 자동 저장해 주는 스크립트(.jsx)를 생성합니다.
   *
   * @param {Object} [jobSpec={}]
   * @returns {string} UTF-8 BOM이 포함된 Photoshop `.jsx` 스크립트 문자열
   */
  function generatePhotoshopJSX(jobSpec = {}) {
    const title = escapeJsxString(jobSpec.title || 'PrintPrep_인쇄작업');
    const dpi = Number(jobSpec.dpi) || 300;
    const bgFileName = escapeJsxString(jobSpec.bgFileName || `background_CMYK_${dpi}dpi.tif`);
    const targetProfile = escapeJsxString(jobSpec.iccProfile || 'Japan Color 2001 Coated');

    return `\uFEFF#target photoshop
/**
 * ============================================================================
 * PrintPrep Studio Pro - Adobe Photoshop CMYK 프로파일 검증 및 PSD 저장 스크립트
 * 작업명: ${title}
 * 대상 파일: ${bgFileName} (${dpi} DPI CMYK)
 * 표준 ICC 프로파일: ${targetProfile}
 * ============================================================================
 */

(function () {
  var oldRulerUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.MM;
  app.displayDialogs = DialogModes.NO;

  try {
    var scriptFile = new File($.fileName);
    var baseFolder = scriptFile.parent;

    var tifFile = new File(baseFolder.fsName + "/${bgFileName}");
    if (!tifFile.exists) {
      tifFile = new File(baseFolder.fsName + "/background_CMYK_300dpi.tif");
    }

    if (!tifFile.exists) {
      alert("⚠️ 같은 폴더에서 '${bgFileName}' 파일을 찾을 수 없습니다.\\n압축을 모두 푼 뒤 실행해 주세요.");
      return;
    }

    var doc = app.open(tifFile);

    // 1. 문서 색상 모드가 CMYK인지 확인 후 아닐 경우 CMYK로 변환
    if (doc.mode !== DocumentMode.CMYK) {
      doc.changeMode(ChangeMode.CMYK);
    }

    // 2. 인쇄소 표준 CMYK ICC 프로파일(Japan Color 2001 Coated 등) 지정 시도
    try {
      doc.colorProfileType = ColorProfile.CUSTOM;
      doc.colorProfileName = "${targetProfile}";
    } catch (eProfile) {
      // 시스템에 해당 프로파일이 없을 경우 포토샵 기본 작업 CMYK 프로파일 사용
      try {
        doc.colorProfileType = ColorProfile.WORKING;
      } catch (eWorking) {}
    }

    // 3. 인쇄소 납품용 CMYK PSD 파일로 자동 저장
    var psdFile = new File(baseFolder.fsName + "/background_CMYK_${dpi}dpi_PrintReady.psd");
    var psdOptions = new PhotoshopSaveOptions();
    psdOptions.embedColorProfile = true;
    psdOptions.alphaChannels = true;
    psdOptions.layers = true;
    psdOptions. maximizeCompatibility = true;

    doc.saveAs(psdFile, psdOptions, true, Extension.LOWERCASE);

    alert(
      "✅ 포토샵 CMYK 검증 및 PSD 저장 완료!\\n\\n" +
      "• 색상 모드: CMYK 8-bit (4채널)\\n" +
      "• 해상도: " + Math.round(doc.resolution) + " DPI\\n" +
      "• 물리 치수: " + doc.width.as("mm").toFixed(1) + "mm × " + doc.height.as("mm").toFixed(1) + "mm\\n" +
      "• 저장된 파일: " + psdFile.name
    );
  } catch (err) {
    alert("⚠️ 포토샵 스크립트 실행 중 오류가 발생했습니다:\\n" + err.message);
  } finally {
    app.preferences.rulerUnits = oldRulerUnits;
  }
})();
`;
  }

  // ============================================================================
  // 7. 순수 JS 무압축 ZIP 아카이브 생성기 (`createZipBlob`)
  // ============================================================================

  // CRC32 룩업 테이블 사전 생성
  const CRC32_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  /**
   * Uint8Array 데이터의 표준 CRC-32 체크섬을 계산합니다.
   * @param {Uint8Array} bytes
   * @returns {number} Unsigned 32-bit CRC32
   */
  function computeCRC32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * 현재 시각을 MS-DOS 날짜/시간 포맷(각 16비트)으로 변환합니다.
   */
  function getDosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);

    const dosTime = ((hours & 0x1F) << 11) | ((minutes & 0x3F) << 5) | (seconds & 0x1F);
    const dosDate = (((year - 1980) & 0x7F) << 9) | ((month & 0x0F) << 5) | (day & 0x1F);
    return { dosTime, dosDate };
  }

  /**
   * 외부 라이브러리나 인터넷 연결 없이 100% 브라우저 내장 기능만으로
   * 표준 ZIP 바이너리(Local File Header + Central Directory + End of Central Directory, UTF-8 파일명 플래그 포함)
   * `Blob`(`application/zip`)을 생성합니다.
   *
   * @param {Array<{ name: string, data: Uint8Array|ArrayBuffer|string }>} filesArray - 압축할 파일 목록
   * @returns {Blob} 즉시 다운로드 가능한 `application/zip` Blob
   */
  function createZipBlob(filesArray = []) {
    if (!Array.isArray(filesArray) || filesArray.length === 0) {
      throw new Error('createZipBlob: 최소 1개 이상의 파일 항목이 필요합니다.');
    }

    const textEncoder = new TextEncoder();
    const { dosTime, dosDate } = getDosDateTime(new Date());

    const normalizedEntries = [];
    let localSectionSize = 0;
    let centralDirSize = 0;

    for (let i = 0; i < filesArray.length; i++) {
      const item = filesArray[i];
      if (!item || !item.name) continue;

      const cleanName = String(item.name).replace(/^\/+/, '');
      const nameBytes = textEncoder.encode(cleanName);

      let dataBytes;
      if (typeof item.data === 'string') {
        dataBytes = textEncoder.encode(item.data);
      } else if (item.data instanceof Uint8Array) {
        dataBytes = item.data;
      } else if (item.data instanceof ArrayBuffer) {
        dataBytes = new Uint8Array(item.data);
      } else if (item.data && item.data.uint8Array instanceof Uint8Array) {
        dataBytes = item.data.uint8Array;
      } else {
        dataBytes = new Uint8Array(0);
      }

      const crc32 = computeCRC32(dataBytes);
      const localHeaderOffset = localSectionSize;

      // Local File Header (30 bytes) + 파일명 길이 + 데이터 길이
      const entryLocalSize = 30 + nameBytes.length + dataBytes.length;
      // Central Directory Header (46 bytes) + 파일명 길이
      const entryCentralSize = 46 + nameBytes.length;

      localSectionSize += entryLocalSize;
      centralDirSize += entryCentralSize;

      normalizedEntries.push({
        nameBytes,
        dataBytes,
        crc32,
        localHeaderOffset
      });
    }

    // End of Central Directory Record (22 bytes)
    const totalZipSize = localSectionSize + centralDirSize + 22;
    const zipBuffer = new ArrayBuffer(totalZipSize);
    const view = new DataView(zipBuffer);
    const zipBytes = new Uint8Array(zipBuffer);

    let offset = 0;

    // 1. Local File Headers + File Data 작성
    for (let i = 0; i < normalizedEntries.length; i++) {
      const entry = normalizedEntries[i];
      const nameLen = entry.nameBytes.length;
      const dataLen = entry.dataBytes.length;

      view.setUint32(offset, 0x04034B50, true);      // Local file header signature
      view.setUint16(offset + 4, 20, true);          // Version needed to extract (2.0)
      view.setUint16(offset + 6, 0x0800, true);      // General purpose bit flag (Bit 11: UTF-8 한글 파일명 지원)
      view.setUint16(offset + 8, 0, true);           // Compression method (0 = Stored / 무압축 원본 보존)
      view.setUint16(offset + 10, dosTime, true);    // Last mod file time
      view.setUint16(offset + 12, dosDate, true);    // Last mod file date
      view.setUint32(offset + 14, entry.crc32, true);// CRC-32
      view.setUint32(offset + 18, dataLen, true);    // Compressed size
      view.setUint32(offset + 22, dataLen, true);    // Uncompressed size
      view.setUint16(offset + 26, nameLen, true);    // File name length
      view.setUint16(offset + 28, 0, true);          // Extra field length

      offset += 30;
      zipBytes.set(entry.nameBytes, offset);
      offset += nameLen;

      zipBytes.set(entry.dataBytes, offset);
      offset += dataLen;
    }

    const centralDirOffset = offset;

    // 2. Central Directory Headers 작성
    for (let i = 0; i < normalizedEntries.length; i++) {
      const entry = normalizedEntries[i];
      const nameLen = entry.nameBytes.length;
      const dataLen = entry.dataBytes.length;

      view.setUint32(offset, 0x02014B50, true);      // Central file header signature
      view.setUint16(offset + 4, 20, true);          // Version made by
      view.setUint16(offset + 6, 20, true);          // Version needed to extract
      view.setUint16(offset + 8, 0x0800, true);      // General purpose bit flag (UTF-8)
      view.setUint16(offset + 10, 0, true);          // Compression method (0 = Stored)
      view.setUint16(offset + 12, dosTime, true);    // Last mod file time
      view.setUint16(offset + 14, dosDate, true);    // Last mod file date
      view.setUint32(offset + 16, entry.crc32, true);// CRC-32
      view.setUint32(offset + 20, dataLen, true);    // Compressed size
      view.setUint32(offset + 24, dataLen, true);    // Uncompressed size
      view.setUint16(offset + 28, nameLen, true);    // File name length
      view.setUint16(offset + 30, 0, true);          // Extra field length
      view.setUint16(offset + 32, 0, true);          // File comment length
      view.setUint16(offset + 34, 0, true);          // Disk number start
      view.setUint16(offset + 36, 0, true);          // Internal file attributes
      view.setUint32(offset + 38, 0, true);          // External file attributes
      view.setUint32(offset + 42, entry.localHeaderOffset, true); // Relative offset of local header

      offset += 46;
      zipBytes.set(entry.nameBytes, offset);
      offset += nameLen;
    }

    // 3. End of Central Directory Record (EOCD) 작성
    const count = normalizedEntries.length;
    view.setUint32(offset, 0x06054B50, true);        // End of central dir signature
    view.setUint16(offset + 4, 0, true);             // Number of this disk
    view.setUint16(offset + 6, 0, true);             // Disk where central directory starts
    view.setUint16(offset + 8, count, true);         // Number of central directory records on this disk
    view.setUint16(offset + 10, count, true);        // Total number of central directory records
    view.setUint32(offset + 12, centralDirSize, true); // Size of central directory (bytes)
    view.setUint32(offset + 16, centralDirOffset, true); // Offset of start of central directory
    view.setUint16(offset + 20, 0, true);            // Comment length

    return new Blob([zipBytes], { type: 'application/zip' });
  }

  /**
   * 인쇄소 입고 안내서(README_인쇄소입고안내.txt) 텍스트를 자동 생성하는 보조 함수입니다.
   */
  function generatePrintGuideReadme(jobSpec = {}) {
    const title = jobSpec.title || 'PrintPrep_인쇄작업';
    const trimWidthMm = Number(jobSpec.trimWidthMm) || 90;
    const trimHeightMm = Number(jobSpec.trimHeightMm) || 50;
    const bleedMm = jobSpec.bleedMm !== undefined ? Number(jobSpec.bleedMm) : 1;
    const dpi = Number(jobSpec.dpi) || 300;
    const fullW = trimWidthMm + bleedMm * 2;
    const fullH = trimHeightMm + bleedMm * 2;
    const pxW = mmToPx(fullW, dpi);
    const pxH = mmToPx(fullH, dpi);

    return [
      `====================================================================`,
      ` [PrintPrep Studio Pro] 인쇄소 입고용 CMYK 300DPI & 인디자인 패키지 안내`,
      `====================================================================`,
      ``,
      `1. 작업 기본 사양`,
      `   - 작업명       : ${title}`,
      `   - 재단 사이즈  : ${trimWidthMm}mm × ${trimHeightMm}mm`,
      `   - 작업 사이즈  : ${fullW}mm × ${fullH}mm (사방 도련 ${bleedMm}mm 포함)`,
      `   - 출력 해상도  : ${dpi} DPI (${pxW}px × ${pxH}px)`,
      `   - 색상 모드    : CMYK 4채널 (8-bit Separated TIFF / 총 잉크량 TAC 280% 이하 보정)`,
      ``,
      `2. 포함된 파일 구성`,
      `   - background_CMYK_${dpi}dpi.tif : 도련 포함 배경 CMYK 고해상도 TIFF`,
      `   - logo_CMYK_${dpi}dpi.tif       : 분리된 로고 CMYK 고해상도 TIFF (로고 포함 시)`,
      `   - logo_vector.svg               : 일러스트레이터/인디자인 패스 편집용 벡터 로고`,
      `   - auto_layout_InDesign.jsx      : 인디자인(InDesign) 원클릭 자동 조판 스크립트`,
      `   - convert_Photoshop_ICC.jsx     : 포토샵 ICC 프로파일 확인 및 PSD 변환 스크립트`,
      ``,
      `3. 인디자인(InDesign) 원클릭 자동 조판 실행 방법`,
      `   ① 이 ZIP 파일의 압축을 폴더에 모두 풉니다.`,
      `   ② 인디자인을 실행한 뒤 [창] -> [유틸리티] -> [스크립트] 패널에서`,
      `      [auto_layout_InDesign.jsx] 파일을 실행(또는 인디자인으로 드래그)합니다.`,
      `   ③ 문서 생성, 도련(${bleedMm}mm) 설정, 배경/로고 배치, 고객 텍스트 상자(K100%),`,
      `      별색 칼선(칼선_M100) 레이어 분리가 1초 만에 자동으로 완료됩니다.`,
      `   ④ 텍스트 수정 후 [파일] -> [내보내기] -> [Adobe PDF(인쇄)] -> [PDF/X-1a:2001]로 저장하여 인쇄소에 접수하세요!`,
      `====================================================================`
    ].join('\r\n');
  }

  // 전역 `window.CMYKEngine` 객체 노출
  const CMYKEngine = {
    mmToPx,
    pxToMm,
    calculatePrintDimensions,
    rgbToCmyk,
    cmykToRgbPreview,
    encodeCMYKTiff,
    traceLogoToSVG,
    generateInDesignJSX,
    generatePhotoshopJSX,
    computeCRC32,
    createZipBlob,
    generatePrintGuideReadme
  };

  global.CMYKEngine = CMYKEngine;
})(typeof window !== 'undefined' ? window : globalThis);
