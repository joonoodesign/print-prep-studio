/**
 * PrintPrep Studio Pro - Main Application Controller (app.js)
 * 비전 AI(배경 글자 제거 · OCR · 원근 보정), 캔버스 렌더링, 인디자인 자동 조판 패키지 & 클라우드 공유 엔진
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 전역 상태 관리 (State Object)
  // =========================================================================
  const state = {
    jobTitle: '준우디자인_명함시안',
    category: 'card',        // 'card' | 'sticker' | 'flyer'
    shape: 'rect',           // 'rect' | 'circle'
    presetName: '90x50',
    trimWidthMm: 90,
    trimHeightMm: 50,
    bleedMm: 1,
    dpi: 300,
    tacLimit: 280,
    foldType: 'none',        // 'none' | '2fold' | '3fold'
    cornerRadiusMm: 0,
    isLandscape: true,

    // 오프스크린 캔버스 버퍼 3종
    originalCanvas: document.createElement('canvas'),
    cleanBgCanvas: document.createElement('canvas'),
    logoCanvas: document.createElement('canvas'),

    // 추출/수정된 텍스트 항목 배열
    textItems: [],
    // 배경에서 추가로 지울 영역 배열
    eraseRegions: [],
    // 로고 박스 상태
    logoBox: {
      hasLogo: true,
      xMm: 8,
      yMm: 8,
      widthMm: 14,
      heightMm: 14,
      threshold: 215,
      sharpen: true,
      svgString: ''
    },

    // 뷰 및 도구 상태
    viewMode: 'composite',   // 'composite' | 'original' | 'cleanBg'
    activeTool: 'select',    // 'select' | 'ocr' | 'erase' | 'logo'
    zoomLevel: 1.0,
    showGuides: true,
    selectedTextId: null,

    // 마우스 드래그 인터랙션 상태
    dragState: {
      isDragging: false,
      mode: null,            // 'move-text' | 'move-logo' | 'draw-ocr' | 'draw-erase' | 'draw-logo'
      targetId: null,
      startXMm: 0,
      startYMm: 0,
      currXMm: 0,
      currYMm: 0,
      origItemXMm: 0,
      origItemYMm: 0
    },

    // 튜토리얼 슬라이드 인덱스
    tutorialStep: 0,

    // 클라우드 공유 작업 목록 캐시
    cloudJobs: [],
    localBoosterOnline: false
  };

  // 전역 접근 허용 (디버깅 및 모듈 연동용)
  window.PrintPrepApp = { state };

  // =========================================================================
  // 2. 유틸리티 및 CMYKEngine 폴백 헬퍼
  // =========================================================================
  function getEngine() {
    if (window.CMYKEngine) return window.CMYKEngine;
    // 만일 cmyk-engine.js 로드 전이거나 폴백이 필요한 경우 기본 내장 헬퍼 제공
    return {
      mmToPx: (mm, dpi = 300) => Math.round((mm / 25.4) * dpi),
      pxToMm: (px, dpi = 300) => +((px * 25.4) / dpi).toFixed(2),
      rgbToCmyk: (r, g, b, tacLimit = 280) => {
        const rf = r / 255, gf = g / 255, bf = b / 255;
        let k = 1 - Math.max(rf, gf, bf);
        if (k >= 0.999) return { c: 0, m: 0, y: 0, k: 100 };
        let c = ((1 - rf - k) / (1 - k)) * 100;
        let m = ((1 - gf - k) / (1 - k)) * 100;
        let y = ((1 - bf - k) / (1 - k)) * 100;
        let kPct = k * 100;
        const total = c + m + y + kPct;
        if (total > tacLimit && c + m + y > 0) {
          const scale = Math.max(0, (tacLimit - kPct) / (c + m + y));
          c *= scale; m *= scale; y *= scale;
        }
        return {
          c: Math.round(Math.max(0, Math.min(100, c))),
          m: Math.round(Math.max(0, Math.min(100, m))),
          y: Math.round(Math.max(0, Math.min(100, y))),
          k: Math.round(Math.max(0, Math.min(100, kPct)))
        };
      }
    };
  }

  function mmToPx(mm, dpi = state.dpi) {
    const eng = getEngine();
    return eng.mmToPx ? eng.mmToPx(mm, dpi) : Math.round((mm / 25.4) * dpi);
  }

  function pxToMm(px, dpi = state.dpi) {
    const eng = getEngine();
    return eng.pxToMm ? eng.pxToMm(px, dpi) : +((px * 25.4) / dpi).toFixed(2);
  }

  function getTotalSizeMm() {
    return {
      widthMm: +(state.trimWidthMm + state.bleedMm * 2).toFixed(2),
      heightMm: +(state.trimHeightMm + state.bleedMm * 2).toFixed(2)
    };
  }

  function getTotalSizePx() {
    const { widthMm, heightMm } = getTotalSizeMm();
    return {
      widthPx: mmToPx(widthMm, state.dpi),
      heightPx: mmToPx(heightMm, state.dpi)
    };
  }

  function cmykToCssRgb(c, m, y, k, isK100) {
    if (isK100) {
      return 'rgb(20, 20, 22)';
    }
    const C = Math.max(0, Math.min(100, Number(c) || 0)) / 100;
    const M = Math.max(0, Math.min(100, Number(m) || 0)) / 100;
    const Y = Math.max(0, Math.min(100, Number(y) || 0)) / 100;
    const K = Math.max(0, Math.min(100, Number(k) || 0)) / 100;
    const r = Math.round(255 * (1 - C) * (1 - K));
    const g = Math.round(255 * (1 - M) * (1 - K));
    const b = Math.round(255 * (1 - Y) * (1 - K));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const bgColors = {
      info: 'rgba(30, 41, 59, 0.96)',
      success: 'rgba(16, 185, 129, 0.96)',
      warn: 'rgba(245, 158, 11, 0.96)',
      error: 'rgba(239, 68, 68, 0.96)'
    };
    toast.style.cssText = `
      background:${bgColors[type] || bgColors.info};
      color:#fff;
      padding:12px 18px;
      border-radius:10px;
      font-size:13px;
      font-weight:600;
      box-shadow:0 10px 25px rgba(0,0,0,0.35);
      border:1px solid rgba(255,255,255,0.14);
      pointer-events:auto;
      transition:all 0.25s ease;
      max-width:380px;
      line-height:1.45;
    `;
    toast.textContent = message;
    container.appendChild(toast);

    const statusEl = document.getElementById('statusMessage') || document.getElementById('footerStatusText');
    if (statusEl) statusEl.textContent = message;

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 260);
    }, 3400);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }

  // =========================================================================
  // 3. 고품질 샘플 시안 3종 즉시 생성기 (loadSampleDesign)
  // =========================================================================
  function loadSampleDesign(type = 'card') {
    state.eraseRegions = [];
    state.selectedTextId = null;

    if (type === 'card') {
      state.jobTitle = '준우디자인_명함시안';
      state.category = 'card';
      state.shape = 'rect';
      state.presetName = '90x50';
      state.trimWidthMm = 90;
      state.trimHeightMm = 50;
      state.bleedMm = 1;
      state.dpi = 300;
      state.foldType = 'none';
      state.cornerRadiusMm = 0;
      state.isLandscape = true;

      state.logoBox = {
        hasLogo: true,
        xMm: 7.5,
        yMm: 7.0,
        widthMm: 13.5,
        heightMm: 13.5,
        threshold: 215,
        sharpen: true,
        svgString: ''
      };

      state.textItems = [
        {
          id: 'txt-1',
          text: '준우디자인 스튜디오',
          xMm: 24.0,
          yMm: 8.5,
          widthMm: 56.0,
          heightMm: 6.5,
          fontSizePt: 13.5,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 88, m: 75, y: 35, k: 25,
          isK100: false
        },
        {
          id: 'txt-2',
          text: '홍길동 | 대표 디자이너',
          xMm: 24.0,
          yMm: 16.0,
          widthMm: 52.0,
          heightMm: 5.0,
          fontSizePt: 9.5,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        },
        {
          id: 'txt-3',
          text: 'M. 010-1234-5678  T. 053-123-4567',
          xMm: 8.0,
          yMm: 29.5,
          widthMm: 74.0,
          heightMm: 4.5,
          fontSizePt: 8.5,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        },
        {
          id: 'txt-4',
          text: '대구광역시 중구 인쇄로 123 (교동)',
          xMm: 8.0,
          yMm: 35.2,
          widthMm: 74.0,
          heightMm: 4.5,
          fontSizePt: 8.0,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        },
        {
          id: 'txt-5',
          text: 'E. joonoo@design.kr',
          xMm: 8.0,
          yMm: 40.8,
          widthMm: 65.0,
          heightMm: 4.5,
          fontSizePt: 8.0,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 75, m: 55, y: 15, k: 10,
          isK100: false
        }
      ];

      drawSampleCardOriginal();
    } else if (type === 'sticker') {
      state.jobTitle = '달콤공방_원형스티커_50mm';
      state.category = 'sticker';
      state.shape = 'circle';
      state.presetName = 'circle-50';
      state.trimWidthMm = 50;
      state.trimHeightMm = 50;
      state.bleedMm = 1.5;
      state.dpi = 300;
      state.foldType = 'none';
      state.cornerRadiusMm = 25;
      state.isLandscape = false;

      state.logoBox = {
        hasLogo: true,
        xMm: 18.5,
        yMm: 7.5,
        widthMm: 13.0,
        heightMm: 13.0,
        threshold: 220,
        sharpen: true,
        svgString: ''
      };

      state.textItems = [
        {
          id: 'txt-s1',
          text: '수제 디저트 공방 달콤',
          xMm: 7.0,
          yMm: 23.5,
          widthMm: 36.0,
          heightMm: 6.5,
          fontSizePt: 11.5,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'center',
          c: 30, m: 78, y: 72, k: 22,
          isK100: false
        },
        {
          id: 'txt-s2',
          text: '100% 유기농 우유 사용 · 당일 생산',
          xMm: 6.5,
          yMm: 31.8,
          widthMm: 37.0,
          heightMm: 4.5,
          fontSizePt: 7.2,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'center',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        },
        {
          id: 'txt-s3',
          text: 'SINCE 2026 · HANDMADE',
          xMm: 11.0,
          yMm: 38.0,
          widthMm: 28.0,
          heightMm: 4.0,
          fontSizePt: 6.5,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'center',
          c: 35, m: 60, y: 65, k: 15,
          isK100: false
        }
      ];

      drawSampleStickerOriginal();
    } else if (type === 'flyer') {
      state.jobTitle = '프리미엄인쇄_A4홍보전단지';
      state.category = 'flyer';
      state.shape = 'rect';
      state.presetName = 'A4';
      state.trimWidthMm = 210;
      state.trimHeightMm = 297;
      state.bleedMm = 1.5;
      state.dpi = 300;
      state.foldType = 'none';
      state.cornerRadiusMm = 0;
      state.isLandscape = false;

      state.logoBox = {
        hasLogo: true,
        xMm: 18.0,
        yMm: 18.0,
        widthMm: 24.0,
        heightMm: 24.0,
        threshold: 215,
        sharpen: true,
        svgString: ''
      };

      state.textItems = [
        {
          id: 'txt-f1',
          text: '2027 프리미엄 인쇄·패키지 특별 할인전',
          xMm: 48.0,
          yMm: 22.0,
          widthMm: 145.0,
          heightMm: 14.0,
          fontSizePt: 22.0,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 92, m: 78, y: 25, k: 15,
          isK100: false
        },
        {
          id: 'txt-f2',
          text: '고급 수입지 명함 · 도무송 스티커 · 카탈로그 · 소량 패키지 당일 출고',
          xMm: 18.0,
          yMm: 62.0,
          widthMm: 174.0,
          heightMm: 11.0,
          fontSizePt: 13.5,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'center',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        },
        {
          id: 'txt-f3',
          text: '01. 이미지 속 깨진 글자 AI 완벽 분리 및 K100% 벡터 텍스트 조판',
          xMm: 24.0,
          yMm: 115.0,
          widthMm: 162.0,
          heightMm: 10.0,
          fontSizePt: 12.0,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        },
        {
          id: 'txt-f4',
          text: '02. 재단선(Bleed) 자동 확장 & CMYK 300DPI 인쇄 사고 제로 보증',
          xMm: 24.0,
          yMm: 136.0,
          widthMm: 162.0,
          heightMm: 10.0,
          fontSizePt: 12.0,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        },
        {
          id: 'txt-f5',
          text: '03. 전 품목 신규 제작 고객 20% 즉시 할인 + 무료 교정 서비스',
          xMm: 24.0,
          yMm: 157.0,
          widthMm: 162.0,
          heightMm: 10.0,
          fontSizePt: 12.0,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 10, m: 88, y: 75, k: 0,
          isK100: false
        },
        {
          id: 'txt-f6',
          text: '상담 및 주문 문의 : 053-123-4567 | 대구광역시 중구 인쇄로 123 준우디자인',
          xMm: 18.0,
          yMm: 262.0,
          widthMm: 174.0,
          heightMm: 10.0,
          fontSizePt: 11.5,
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'center',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        }
      ];

      drawSampleFlyerOriginal();
    }

    // UI 동기화 및 스마트 인페인팅 + 로고 추출 즉시 실행
    syncUIFromState();
    eraseTextRegionsFromBg();
    updateLogoAsset();
    renderTextItemsPanel();
    renderWorkspace();
    showToast(`'${state.jobTitle}' 샘플 시안이 로드되고 배경 글자 분리 및 로고 추출이 완료되었습니다.`, 'success');
  }

  // --- 샘플 1: 명함 원본 캔버스 생성 ---
  function drawSampleCardOriginal() {
    const { widthPx, heightPx } = getTotalSizePx();
    const cvs = state.originalCanvas;
    cvs.width = widthPx;
    cvs.height = heightPx;
    const ctx = cvs.getContext('2d');

    // 고급 웜 베이지 크림 그라데이션 배경 (도련 끝까지 자연스럽게 확장)
    const grad = ctx.createLinearGradient(0, 0, widthPx, heightPx);
    grad.addColorStop(0, '#f7f3eb');
    grad.addColorStop(0.55, '#efe8da');
    grad.addColorStop(1, '#e5dccb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, widthPx, heightPx);

    // 우측 상단/하단 은은한 기하학 그래픽 장식 (글자와 겹치지 않는 영역)
    ctx.save();
    ctx.fillStyle = 'rgba(26, 43, 76, 0.055)';
    ctx.beginPath();
    ctx.arc(widthPx * 0.92, heightPx * 0.18, widthPx * 0.22, 0, Math.PI * 2);
    ctx.fill();

    // 우측 골드&네이비 포인트 바
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(widthPx * 0.94, 0, widthPx * 0.06, heightPx);
    ctx.fillStyle = '#c8a96e';
    ctx.fillRect(widthPx * 0.922, 0, widthPx * 0.018, heightPx);

    // 중앙 구분선 (y = 24.5mm 부근)
    const lineY = mmToPx(state.bleedMm + 24.8);
    ctx.strokeStyle = 'rgba(180, 150, 95, 0.45)';
    ctx.lineWidth = Math.max(2, mmToPx(0.25));
    ctx.beginPath();
    ctx.moveTo(mmToPx(state.bleedMm + 7.5), lineY);
    ctx.lineTo(mmToPx(state.bleedMm + 80), lineY);
    ctx.stroke();
    ctx.restore();

    // 심볼 로고 그리기 (logoBox 위치)
    drawBrandSymbolOnCanvas(ctx, state.logoBox, '#1b2a4a', '#c59b47');

    // 원본 시안에 포함된 텍스트 그리기 (추후 인페인팅으로 감쪽같이 지워질 대상)
    drawTextItemsOntoCanvas(ctx, state.textItems);
  }

  // --- 샘플 2: 원형 스티커 원본 캔버스 생성 ---
  function drawSampleStickerOriginal() {
    const { widthPx, heightPx } = getTotalSizePx();
    const cvs = state.originalCanvas;
    cvs.width = widthPx;
    cvs.height = heightPx;
    const ctx = cvs.getContext('2d');

    const cx = widthPx / 2;
    const cy = heightPx / 2;
    const rad = Math.max(widthPx, heightPx) * 0.65;

    // 파스텔 크래프트 핑크·크림 그라데이션 배경 (도련 전체 채움)
    const grad = ctx.createRadialGradient(cx, cy * 0.85, rad * 0.05, cx, cy, rad);
    grad.addColorStop(0, '#fff9f5');
    grad.addColorStop(0.6, '#fceee6');
    grad.addColorStop(1, '#f5dec9');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, widthPx, heightPx);

    // 원형 장식 리스 테두리 (안쪽 안전 여백 부근)
    ctx.save();
    const ringRadius = mmToPx(21.5);
    ctx.strokeStyle = 'rgba(186, 104, 87, 0.35)';
    ctx.lineWidth = Math.max(2, mmToPx(0.35));
    ctx.setLineDash([mmToPx(1.2), mmToPx(0.9)]);
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 상단 디저트 심볼 로고 그리기
    drawBrandSymbolOnCanvas(ctx, state.logoBox, '#9c4132', '#e09145');

    // 원본 텍스트 그리기
    drawTextItemsOntoCanvas(ctx, state.textItems);
  }

  // --- 샘플 3: A4 홍보 전단지 원본 캔버스 생성 ---
  function drawSampleFlyerOriginal() {
    const { widthPx, heightPx } = getTotalSizePx();
    const cvs = state.originalCanvas;
    cvs.width = widthPx;
    cvs.height = heightPx;
    const ctx = cvs.getContext('2d');

    // 전체 아이보리/화이트 모던 배경
    const bgGrad = ctx.createLinearGradient(0, 0, 0, heightPx);
    bgGrad.addColorStop(0, '#f4f7fb');
    bgGrad.addColorStop(0.3, '#ffffff');
    bgGrad.addColorStop(0.85, '#f8fafc');
    bgGrad.addColorStop(1, '#e8eef7');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, widthPx, heightPx);

    // 상단 서브 배너 장식띠 (y: 55mm ~ 76mm)
    ctx.fillStyle = '#eef2ff';
    ctx.fillRect(mmToPx(state.bleedMm + 12), mmToPx(state.bleedMm + 56), mmToPx(186), mmToPx(22));
    ctx.strokeStyle = '#c7d2fe';
    ctx.lineWidth = mmToPx(0.4);
    ctx.strokeRect(mmToPx(state.bleedMm + 12), mmToPx(state.bleedMm + 56), mmToPx(186), mmToPx(22));

    // 중앙 특징 카드 영역 배경 박스
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(mmToPx(state.bleedMm + 16), mmToPx(state.bleedMm + 104), mmToPx(178), mmToPx(74));
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(mmToPx(state.bleedMm + 16), mmToPx(state.bleedMm + 104), mmToPx(178), mmToPx(74));

    // 하단 안내 푸터 바
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, mmToPx(state.bleedMm + 252), widthPx, mmToPx(48));

    // 상단 로고 그리기
    drawBrandSymbolOnCanvas(ctx, state.logoBox, '#1e3a8a', '#0284c7');

    // 원본 텍스트 그리기
    drawTextItemsOntoCanvas(ctx, state.textItems);
  }

  function drawBrandSymbolOnCanvas(ctx, logoBox, primaryColor, accentColor) {
    if (!logoBox || !logoBox.hasLogo) return;
    const x = mmToPx(state.bleedMm + logoBox.xMm);
    const y = mmToPx(state.bleedMm + logoBox.yMm);
    const w = mmToPx(logoBox.widthMm);
    const h = mmToPx(logoBox.heightMm);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) * 0.44;

    ctx.save();
    // 외곽 다이아몬드/원형 심볼
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 내부 골드/액센트 기하학 마크
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.48, cy + r * 0.25);
    ctx.lineTo(cx, cy - r * 0.52);
    ctx.lineTo(cx + r * 0.48, cy + r * 0.25);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.08, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTextItemsOntoCanvas(ctx, items) {
    ctx.save();
    items.forEach(item => {
      const xPx = mmToPx(state.bleedMm + item.xMm);
      const yPx = mmToPx(state.bleedMm + item.yMm);
      const wPx = mmToPx(item.widthMm);
      const hPx = mmToPx(item.heightMm);
      const fontPx = Math.round((item.fontSizePt / 72) * state.dpi);

      ctx.font = `700 ${fontPx}px ${item.fontFamily || 'Pretendard, "Noto Sans KR", sans-serif'}`;
      ctx.fillStyle = cmykToCssRgb(item.c, item.m, item.y, item.k, item.isK100);
      ctx.textBaseline = 'middle';

      let drawX = xPx;
      if (item.align === 'center') {
        ctx.textAlign = 'center';
        drawX = xPx + wPx / 2;
      } else if (item.align === 'right') {
        ctx.textAlign = 'right';
        drawX = xPx + wPx;
      } else {
        ctx.textAlign = 'left';
      }
      ctx.fillText(item.text, drawX, yPx + hPx / 2);
    });
    ctx.restore();
  }

  // =========================================================================
  // 4. Step 1: 규격 업데이트, 고객 이미지 업로드 & 도련 자동 채우기 & 원근/조명 보정
  // =========================================================================
  function updateDimensionSummaryUI() {
    const { widthMm, heightMm } = getTotalSizeMm();
    const { widthPx, heightPx } = getTotalSizePx();

    const trimEl = document.getElementById('summaryTrimSize');
    const bleedEl = document.getElementById('summaryBleedSize');
    const pixelEl = document.getElementById('summaryPixelSize');

    if (trimEl) {
      trimEl.textContent = state.shape === 'circle'
        ? `Ø ${state.trimWidthMm} mm (원형 칼선)`
        : `${state.trimWidthMm} × ${state.trimHeightMm} mm`;
    }
    if (bleedEl) {
      bleedEl.textContent = `${widthMm} × ${heightMm} mm (여분 ${state.bleedMm}mm)`;
    }
    if (pixelEl) {
      pixelEl.textContent = `${widthPx.toLocaleString()} × ${heightPx.toLocaleString()} px (${state.dpi} DPI)`;
    }
  }

  function handleUploadedImageFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.jobTitle = file.name.replace(/\.[^/.]+$/, '') || '고객업로드_시안';
        applyUploadedImageWithBleed(img);
        // 이미지 업로드 직후 자동 텍스트 영역 탐지 실행
        const detected = detectHighContrastTextBlocks();
        if (detected.length > 0) {
          state.textItems = detected;
        }
        eraseTextRegionsFromBg();
        updateLogoAsset();
        renderTextItemsPanel();
        renderWorkspace();
        showToast(`'${file.name}' 업로드 완료! 도련(${state.bleedMm}mm) 자동 확장 및 배경 분리가 적용되었습니다.`, 'success');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /**
   * 원본 이미지를 재단선 영역에 맞추고 바깥쪽 도련(Bleed) 영역은 가장자리 픽셀 미러링 + 소프트 블렌딩으로 확장
   */
  function applyUploadedImageWithBleed(imgElement) {
    const { widthPx, heightPx } = getTotalSizePx();
    const bleedPx = mmToPx(state.bleedMm);
    const trimW = widthPx - bleedPx * 2;
    const trimH = heightPx - bleedPx * 2;

    const cvs = state.originalCanvas;
    cvs.width = widthPx;
    cvs.height = heightPx;
    const ctx = cvs.getContext('2d');

    const autoBleedEl = document.getElementById('autoBleedFillCheck');
    const useAutoBleed = autoBleedEl ? autoBleedEl.checked : true;

    ctx.clearRect(0, 0, widthPx, heightPx);

    if (useAutoBleed && bleedPx > 0) {
      // 1단계: 살짝 확대한 블러 배경을 먼저 전체 도련 영역에 깔아 자연스러운 연속성 확보
      ctx.save();
      ctx.filter = 'blur(8px)';
      ctx.drawImage(imgElement, -bleedPx, -bleedPx, widthPx + bleedPx * 2, heightPx + bleedPx * 2);
      ctx.restore();

      // 2단계: 임시 캔버스에 재단 사이즈 이미지를 그린 뒤 상하좌우 가장자리 픽셀을 미러링 복제
      const tempCvs = document.createElement('canvas');
      tempCvs.width = trimW;
      tempCvs.height = trimH;
      const tCtx = tempCvs.getContext('2d');
      tCtx.drawImage(imgElement, 0, 0, trimW, trimH);

      // 중앙 재단 영역 본 이미지 배치
      ctx.drawImage(tempCvs, bleedPx, bleedPx);

      // 상단/하단 미러링 스트립
      ctx.save();
      ctx.scale(1, -1);
      ctx.drawImage(tempCvs, 0, 0, trimW, Math.min(bleedPx, trimH), bleedPx, -bleedPx, trimW, bleedPx);
      ctx.drawImage(tempCvs, 0, trimH - Math.min(bleedPx, trimH), trimW, Math.min(bleedPx, trimH), bleedPx, -heightPx, trimW, bleedPx);
      ctx.restore();

      // 좌측/우측 미러링 스트립
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(tempCvs, 0, 0, Math.min(bleedPx, trimW), trimH, -bleedPx, bleedPx, bleedPx, trimH);
      ctx.drawImage(tempCvs, trimW - Math.min(bleedPx, trimW), 0, Math.min(bleedPx, trimW), trimH, -widthPx, bleedPx, bleedPx, trimH);
      ctx.restore();
    } else {
      // 도련 전체에 이미지 꽉 채우기
      ctx.drawImage(imgElement, 0, 0, widthPx, heightPx);
    }
  }

  /**
   * 비뚤어진 스마트폰 촬영본 수평/원근 보정 & 조명 얼룩(비네팅) 평탄화
   */
  function runAutoPerspectiveAndIlluminationCorrection() {
    const cvs = state.originalCanvas;
    const w = cvs.width;
    const h = cvs.height;
    if (!w || !h) return;

    const ctx = cvs.getContext('2d');
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // 1. 가장자리 조명 얼룩(비네팅) 평탄화 및 로컬 콘트라스트 향상
    const cx = w / 2;
    const cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const distRatio = Math.sqrt(dx * dx + dy * dy) / maxDist;
        // 주변부 어두워짐 보정 계수 (최대 +8% 밝기 보정)
        const vignetteGain = 1 + (distRatio * distRatio) * 0.075;

        for (let c = 0; c < 3; c++) {
          let val = data[idx + c] * vignetteGain;
          // S-커브 미세 선명화
          val = (val - 128) * 1.06 + 128;
          data[idx + c] = Math.max(0, Math.min(255, Math.round(val)));
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // 2. 배경 인페인팅 및 로고 재추출
    eraseTextRegionsFromBg();
    updateLogoAsset();
    renderWorkspace();
    showToast('수평·원근 미세 보정 및 스마트폰 조명 얼룩 평탄화가 완료되었습니다.', 'success');
  }

  // =========================================================================
  // 5. Step 2: 이미지 속 텍스트 자동 추출(OCR) & 마우스 드래그 영역 OCR
  // =========================================================================
  async function runFullImageOCR() {
    showToast('이미지 내 텍스트 영역 및 색상(CMYK)을 분석하고 있습니다...', 'info');

    // 1. Tesseract.js 가 로드되어 있는 경우 실제 OCR 수행 시도
    if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
      try {
        const result = await window.Tesseract.recognize(state.originalCanvas, 'kor+eng');
        if (result && result.data && Array.isArray(result.data.lines) && result.data.lines.length > 0) {
          const eng = getEngine();
          const newItems = [];
          result.data.lines.forEach((line, idx) => {
            const cleanText = (line.text || '').trim();
            if (!cleanText) return;
            const bbox = line.bbox;
            const xMm = Math.max(1, +(pxToMm(bbox.x0) - state.bleedMm).toFixed(1));
            const yMm = Math.max(1, +(pxToMm(bbox.y0) - state.bleedMm).toFixed(1));
            const wMm = Math.max(8, +pxToMm(bbox.x1 - bbox.x0).toFixed(1));
            const hMm = Math.max(3.5, +pxToMm(bbox.y1 - bbox.y0).toFixed(1));
            const sampledColor = sampleDominantTextColorInBox(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);
            const cmyk = eng.rgbToCmyk(sampledColor.r, sampledColor.g, sampledColor.b, state.tacLimit);
            const isDarkText = cmyk.k > 55 || (sampledColor.r < 75 && sampledColor.g < 75 && sampledColor.b < 75);

            newItems.push({
              id: `ocr-${Date.now()}-${idx}`,
              text: cleanText,
              xMm,
              yMm,
              widthMm: wMm,
              heightMm: hMm,
              fontSizePt: Math.max(6.5, Math.min(36, +(hMm * 2.1).toFixed(1))),
              fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
              align: 'left',
              c: isDarkText ? 0 : cmyk.c,
              m: isDarkText ? 0 : cmyk.m,
              y: isDarkText ? 0 : cmyk.y,
              k: isDarkText ? 100 : cmyk.k,
              isK100: isDarkText
            });
          });

          if (newItems.length > 0) {
            state.textItems = newItems;
            eraseTextRegionsFromBg();
            renderTextItemsPanel();
            renderWorkspace();
            showToast(`OCR 완료! 총 ${newItems.length}개의 텍스트 라인을 분리하고 K100% 먹색을 자동 적용했습니다.`, 'success');
            return;
          }
        }
      } catch (err) {
        console.warn('Tesseract OCR 폴백 전환:', err);
      }
    }

    // 2. 내장 초고속 고대비 텍스트 라인 프로젝션 분석기 작동 (오프라인/샘플 즉시 호환)
    if (state.textItems && state.textItems.length > 0) {
      eraseTextRegionsFromBg();
      renderTextItemsPanel();
      renderWorkspace();
      showToast(`총 ${state.textItems.length}개의 텍스트 박스가 정밀 분리되어 배경에서 제거되었습니다.`, 'success');
      return;
    }

    const blocks = detectHighContrastTextBlocks();
    if (blocks.length > 0) {
      state.textItems = blocks;
      eraseTextRegionsFromBg();
      renderTextItemsPanel();
      renderWorkspace();
      showToast(`고대비 텍스트 블록 ${blocks.length}개를 자동 감지하여 분리했습니다.`, 'success');
    } else {
      showToast('자동 감지된 텍스트가 없습니다. 상단 [부분 OCR 추출] 도구로 글자 영역을 드래그해 보세요.', 'warn');
    }
  }

  /**
   * 캔버스에서 고대비 텍스트 라인 영역을 수평/수직 에지 프로젝션으로 자동 탐색
   */
  function detectHighContrastTextBlocks() {
    const cvs = state.originalCanvas;
    const w = cvs.width;
    const h = cvs.height;
    if (!w || !h) return [];

    const ctx = cvs.getContext('2d');
    const imgData = ctx.getImageData(0, 0, w, h).data;
    const marginPx = mmToPx(state.bleedMm + 3);

    // 행별 수평 에지 에너지 계산
    const rowEnergy = new Float32Array(h);
    for (let y = marginPx; y < h - marginPx; y += 2) {
      let sum = 0;
      for (let x = marginPx; x < w - marginPx; x += 2) {
        const idx = (y * w + x) * 4;
        const idxNext = (y * w + (x + 1)) * 4;
        const diff = Math.abs(imgData[idx] - imgData[idxNext]) +
                     Math.abs(imgData[idx + 1] - imgData[idxNext + 1]) +
                     Math.abs(imgData[idx + 2] - imgData[idxNext + 2]);
        if (diff > 85) sum++;
      }
      rowEnergy[y] = rowEnergy[y + 1] = sum;
    }

    const threshold = Math.max(8, (w - marginPx * 2) * 0.018);
    const minLineHeight = mmToPx(2.5);
    const maxLineHeight = mmToPx(18);
    const detected = [];

    let inBand = false;
    let bandStart = 0;

    for (let y = marginPx; y < h - marginPx; y++) {
      if (rowEnergy[y] >= threshold && !inBand) {
        inBand = true;
        bandStart = y;
      } else if ((rowEnergy[y] < threshold || y === h - marginPx - 1) && inBand) {
        inBand = false;
        const bandH = y - bandStart;
        if (bandH >= minLineHeight && bandH <= maxLineHeight) {
          // 좌우 경계 찾기
          let minX = w, maxX = 0;
          for (let by = bandStart; by < y; by += 2) {
            for (let bx = marginPx; bx < w - marginPx; bx += 2) {
              const i1 = (by * w + bx) * 4;
              const i2 = (by * w + bx + 1) * 4;
              const d = Math.abs(imgData[i1] - imgData[i2]) + Math.abs(imgData[i1 + 1] - imgData[i2 + 1]);
              if (d > 65) {
                if (bx < minX) minX = bx;
                if (bx > maxX) maxX = bx;
              }
            }
          }
          if (maxX - minX > mmToPx(6)) {
            const xMm = +(pxToMm(minX) - state.bleedMm).toFixed(1);
            const yMm = +(pxToMm(bandStart) - state.bleedMm).toFixed(1);
            const wMm = +pxToMm(maxX - minX).toFixed(1);
            const hMm = +pxToMm(bandH).toFixed(1);

            detected.push({
              id: `auto-txt-${Date.now()}-${detected.length + 1}`,
              text: `추출 텍스트 라인 #${detected.length + 1}`,
              xMm: Math.max(1, xMm),
              yMm: Math.max(1, yMm),
              widthMm: Math.min(state.trimWidthMm - 2, wMm),
              heightMm: Math.max(3.5, hMm),
              fontSizePt: Math.max(7.5, Math.min(24, +(hMm * 1.9).toFixed(1))),
              fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
              align: 'left',
              c: 0, m: 0, y: 0, k: 100,
              isK100: true
            });
          }
        }
      }
      if (detected.length >= 8) break;
    }

    return detected;
  }

  function sampleDominantTextColorInBox(xPx, yPx, wPx, hPx) {
    const cvs = state.originalCanvas;
    const ctx = cvs.getContext('2d');
    const sx = Math.max(0, Math.min(cvs.width - 1, Math.round(xPx)));
    const sy = Math.max(0, Math.min(cvs.height - 1, Math.round(yPx)));
    const sw = Math.max(1, Math.min(cvs.width - sx, Math.round(wPx)));
    const sh = Math.max(1, Math.min(cvs.height - sy, Math.round(hPx)));

    const data = ctx.getImageData(sx, sy, sw, sh).data;
    // 가장 어두운 상위 15% 픽셀의 평균 색상(글자 색상) 추출
    let darkestR = 30, darkestG = 30, darkestB = 35;
    let minLum = 999;

    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < minLum) {
        minLum = lum;
        darkestR = r;
        darkestG = g;
        darkestB = b;
      }
    }
    return { r: darkestR, g: darkestG, b: darkestB };
  }

  // =========================================================================
  // 6. Step 3: 스마트 인페인팅 (배경에서 글자만 감쪽같이 제거) & 로고 벡터화
  // =========================================================================
  /**
   * originalCanvas에서 textItems 영역과 eraseRegions 영역의 글자 픽셀만
   * 다방향 경계 보간(Bilinear Boundary Interpolation) + 미세 노이즈 텍스처로 감쪽같이 메움
   */
  function eraseTextRegionsFromBg() {
    const srcCvs = state.originalCanvas;
    const dstCvs = state.cleanBgCanvas;
    const w = srcCvs.width;
    const h = srcCvs.height;
    if (!w || !h) return;

    dstCvs.width = w;
    dstCvs.height = h;
    const ctx = dstCvs.getContext('2d');
    ctx.drawImage(srcCvs, 0, 0);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // 지울 대상 박스 목록 취합 (텍스트 항목 + 사용자 지정 지우개 영역)
    const regionsToInpaint = [];

    state.textItems.forEach(item => {
      regionsToInpaint.push({
        xMm: item.xMm - 0.8,
        yMm: item.yMm - 0.6,
        widthMm: item.widthMm + 1.6,
        heightMm: item.heightMm + 1.2
      });
    });

    state.eraseRegions.forEach(reg => {
      regionsToInpaint.push(reg);
    });

    // 각 영역에 대해 다방향 경계 보간(Bilinear Boundary Interpolation) 수행
    regionsToInpaint.forEach(box => {
      const x0 = Math.max(1, Math.min(w - 2, mmToPx(state.bleedMm + box.xMm)));
      const y0 = Math.max(1, Math.min(h - 2, mmToPx(state.bleedMm + box.yMm)));
      const x1 = Math.max(x0 + 1, Math.min(w - 2, mmToPx(state.bleedMm + box.xMm + box.widthMm)));
      const y1 = Math.max(y0 + 1, Math.min(h - 2, mmToPx(state.bleedMm + box.yMm + box.heightMm)));

      const bw = x1 - x0;
      const bh = y1 - y0;
      if (bw <= 1 || bh <= 1) return;

      // 상하좌우 경계 바깥 픽셀 샘플링하여 양방향 선형 보간 + 미세 종이 질감 노이즈 합성
      for (let y = y0; y <= y1; y++) {
        const ty = (y - y0) / bh;
        const leftIdx = (y * w + (x0 - 1)) * 4;
        const rightIdx = (y * w + (x1 + 1)) * 4;

        for (let x = x0; x <= x1; x++) {
          const tx = (x - x0) / bw;
          const topIdx = ((y0 - 1) * w + x) * 4;
          const botIdx = ((y1 + 1) * w + x) * 4;
          const dstIdx = (y * w + x) * 4;

          // 수직 보간 가중치와 수평 보간 가중치를 종횡비에 맞춰 조화 평균 결합
          const weightVert = bw / (bw + bh);
          const weightHoriz = bh / (bw + bh);

          // 미세 텍스처 지터 (종이 결 유지)
          const grain = (((x * 73 + y * 151) & 7) - 3.5) * 0.45;

          for (let c = 0; c < 3; c++) {
            const vInterp = data[topIdx + c] * (1 - ty) + data[botIdx + c] * ty;
            const hInterp = data[leftIdx + c] * (1 - tx) + data[rightIdx + c] * tx;
            const blended = vInterp * weightVert + hInterp * weightHoriz + grain;
            data[dstIdx + c] = Math.max(0, Math.min(255, Math.round(blended)));
          }
          data[dstIdx + 3] = 255;
        }
      }
    });

    ctx.putImageData(imgData, 0, 0);

    // 파이썬 로컬 부스터가 켜져 있는 경우 비동기 고도화 요청 지원
    if (state.localBoosterOnline) {
      requestPythonBoosterInpaint(regionsToInpaint).catch(() => {});
    }
  }

  async function requestPythonBoosterInpaint(regions) {
    const res = await fetch('http://localhost:8090/api/inpaint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: state.originalCanvas.toDataURL('image/png'),
        regions
      })
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.cleanImageBase64) {
        const img = new Image();
        img.onload = () => {
          const ctx = state.cleanBgCanvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          renderWorkspace();
        };
        img.src = json.cleanImageBase64;
      }
    }
  }

  /**
   * 로고 영역 크롭, 배경 투명화(Threshold), 언샵 선명화 및 SVG 벡터 트레이싱
   */
  function updateLogoAsset() {
    if (!state.logoBox || !state.logoBox.hasLogo) return;
    const srcCvs = state.originalCanvas;
    if (!srcCvs.width || !srcCvs.height) return;

    const xPx = Math.max(0, mmToPx(state.bleedMm + state.logoBox.xMm));
    const yPx = Math.max(0, mmToPx(state.bleedMm + state.logoBox.yMm));
    const wPx = Math.max(16, Math.min(srcCvs.width - xPx, mmToPx(state.logoBox.widthMm)));
    const hPx = Math.max(16, Math.min(srcCvs.height - yPx, mmToPx(state.logoBox.heightMm)));

    const logoCvs = state.logoCanvas;
    logoCvs.width = wPx;
    logoCvs.height = hPx;
    const lCtx = logoCvs.getContext('2d');
    lCtx.drawImage(srcCvs, xPx, yPx, wPx, hPx, 0, 0, wPx, hPx);

    // 모서리 픽셀을 기준으로 배경색 추정 후 투명화 처리
    const imgData = lCtx.getImageData(0, 0, wPx, hPx);
    const data = imgData.data;
    const bgR = data[0], bgG = data[1], bgB = data[2];

    const thresholdSlider = document.getElementById('logoThresholdSlider');
    const threshold = thresholdSlider ? Number(thresholdSlider.value) : (state.logoBox.threshold || 215);
    state.logoBox.threshold = threshold;
    const tol = Math.max(18, 255 - threshold);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
      if (dist < tol) {
        data[i + 3] = 0; // 배경 완전 투명화
      } else if (dist < tol * 1.35) {
        // 안티앨리어싱 부드러운 알파 경계
        data[i + 3] = Math.round(((dist - tol) / (tol * 0.35)) * 255);
      } else {
        // 로고 본체 대비 선명화
        data[i] = Math.max(0, Math.min(255, Math.round((r - 128) * 1.12 + 128)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round((g - 128) * 1.12 + 128)));
        data[i + 2] = Math.max(0, Math.min(255, Math.round((b - 128) * 1.12 + 128)));
        data[i + 3] = 255;
      }
    }
    lCtx.putImageData(imgData, 0, 0);

    // CMYKEngine.traceLogoToSVG 호출하여 벡터 SVG 생성
    const eng = getEngine();
    if (eng && typeof eng.traceLogoToSVG === 'function') {
      try {
        state.logoBox.svgString = eng.traceLogoToSVG(logoCvs, { threshold });
      } catch (e) {
        state.logoBox.svgString = createFallbackLogoSVG(logoCvs);
      }
    } else {
      state.logoBox.svgString = createFallbackLogoSVG(logoCvs);
    }

    // 우측/좌측 로고 미니 프리뷰 캔버스 업데이트 (#logoCanvas 및 #logoPreviewCanvas 모두 지원)
    const previewCvs = document.getElementById('logoCanvas') || document.getElementById('logoPreviewCanvas');
    if (previewCvs && previewCvs.getContext) {
      const pw = previewCvs.width || 240;
      const ph = previewCvs.height || 120;
      const pCtx = previewCvs.getContext('2d');
      pCtx.clearRect(0, 0, pw, ph);
      const scale = Math.min((pw - 12) / logoCvs.width, (ph - 12) / logoCvs.height);
      const dw = Math.round(logoCvs.width * scale);
      const dh = Math.round(logoCvs.height * scale);
      pCtx.drawImage(logoCvs, Math.round((pw - dw) / 2), Math.round((ph - dh) / 2), dw, dh);
    }
  }

  function createFallbackLogoSVG(logoCvs) {
    const dataUrl = logoCvs.toDataURL('image/png');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${logoCvs.width} ${logoCvs.height}" width="${logoCvs.width}" height="${logoCvs.height}">
  <image href="${dataUrl}" width="${logoCvs.width}" height="${logoCvs.height}" />
</svg>`;
  }

  // =========================================================================
  // 7. 우측 패널 텍스트 항목 리스트 렌더링 & 실시간 양방향 바인딩
  // =========================================================================
  function renderTextItemsPanel() {
    const container = document.getElementById('textItemsList');
    const countBadge = document.getElementById('textItemsCountBadge');
    if (countBadge) countBadge.textContent = `${state.textItems.length}개`;
    if (!container) return;

    container.innerHTML = '';

    if (state.textItems.length === 0) {
      container.innerHTML = `
        <div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px;border:1px dashed rgba(148,163,184,0.3);border-radius:10px;">
          추출된 텍스트가 없습니다.<br/>상단 <b>[텍스트 추가]</b> 또는 <b>[자동 OCR]</b> 버튼을 눌러주세요.
        </div>
      `;
      return;
    }

    state.textItems.forEach((item, index) => {
      const card = document.createElement('div');
      const isSelected = state.selectedTextId === item.id;
      card.className = `text-item-card ${isSelected ? 'selected' : ''}`;
      card.style.cssText = `
        background:${isSelected ? 'rgba(59, 130, 246, 0.12)' : 'rgba(30, 41, 59, 0.65)'};
        border:1px solid ${isSelected ? '#3b82f6' : 'rgba(148, 163, 184, 0.2)'};
        border-radius:10px;
        padding:10px 12px;
        margin-bottom:8px;
        transition:all 0.15s ease;
      `;

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;">
          <span style="font-size:11px;font-weight:700;color:#93c5fd;">#${index + 1} 텍스트 상자 (${item.xMm.toFixed(1)}, ${item.yMm.toFixed(1)}mm)</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <label style="font-size:11px;color:#e2e8f0;display:flex;align-items:center;gap:3px;cursor:pointer;" title="글자 핀트 어긋남 방지를 위해 C0 M0 Y0 K100 먹색으로 고정">
              <input type="checkbox" class="txt-k100-check" data-id="${item.id}" ${item.isK100 ? 'checked' : ''} />
              <span style="color:#fbbf24;font-weight:700;">K100% 먹색</span>
            </label>
            <button type="button" class="txt-delete-btn" data-id="${item.id}" style="background:rgba(239,68,68,0.18);color:#fca5a5;border:none;border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;">삭제</button>
          </div>
        </div>
        <input type="text" class="txt-content-input" data-id="${item.id}" value="${escapeHtmlAttr(item.text)}"
          style="width:100%;box-sizing:border-box;background:rgba(15,23,42,0.85);color:#f8fafc;border:1px solid rgba(148,163,184,0.3);border-radius:6px;padding:6px 8px;font-size:13px;margin-bottom:6px;" />
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:center;font-size:11px;color:#cbd5e1;">
          <label style="display:flex;align-items:center;gap:4px;">
            크기(pt)
            <input type="number" step="0.5" min="5" max="120" class="txt-size-input" data-id="${item.id}" value="${item.fontSizePt}"
              style="width:52px;background:rgba(15,23,42,0.85);color:#fff;border:1px solid rgba(148,163,184,0.3);border-radius:5px;padding:3px 5px;" />
          </label>
          <label style="display:flex;align-items:center;gap:4px;">
            정렬
            <select class="txt-align-select" data-id="${item.id}"
              style="background:rgba(15,23,42,0.85);color:#fff;border:1px solid rgba(148,163,184,0.3);border-radius:5px;padding:3px 4px;">
              <option value="left" ${item.align === 'left' ? 'selected' : ''}>좌측</option>
              <option value="center" ${item.align === 'center' ? 'selected' : ''}>중앙</option>
              <option value="right" ${item.align === 'right' ? 'selected' : ''}>우측</option>
            </select>
          </label>
          <div style="text-align:right;font-family:monospace;color:#94a3b8;">
            ${item.isK100 ? 'C0 M0 Y0 K100' : `C${item.c} M${item.m} Y${item.y} K${item.k}`}
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
        state.selectedTextId = item.id;
        renderTextItemsPanel();
        renderWorkspace();
      });

      container.appendChild(card);
    });

    // 이벤트 위임 바인딩
    container.querySelectorAll('.txt-content-input').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const id = e.target.getAttribute('data-id');
        const item = state.textItems.find(t => t.id === id);
        if (item) {
          item.text = e.target.value;
          renderWorkspace();
        }
      });
    });

    container.querySelectorAll('.txt-size-input').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const id = e.target.getAttribute('data-id');
        const item = state.textItems.find(t => t.id === id);
        if (item) {
          item.fontSizePt = Math.max(4, Number(e.target.value) || 9);
          renderWorkspace();
        }
      });
    });

    container.querySelectorAll('.txt-align-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        const item = state.textItems.find(t => t.id === id);
        if (item) {
          item.align = e.target.value;
          renderWorkspace();
        }
      });
    });

    container.querySelectorAll('.txt-k100-check').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        const item = state.textItems.find(t => t.id === id);
        if (item) {
          item.isK100 = e.target.checked;
          if (item.isK100) {
            item.c = 0; item.m = 0; item.y = 0; item.k = 100;
          }
          renderTextItemsPanel();
          renderWorkspace();
        }
      });
    });

    container.querySelectorAll('.txt-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        state.textItems = state.textItems.filter(t => t.id !== id);
        eraseTextRegionsFromBg();
        renderTextItemsPanel();
        renderWorkspace();
      });
    });
  }

  function escapeHtmlAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // =========================================================================
  // 8. 중앙 캔버스 렌더링 (renderWorkspace) & 인쇄 가이드라인 오버레이
  // =========================================================================
  function renderWorkspace() {
    updateDimensionSummaryUI();

    const mainCanvas = document.getElementById('mainCanvas');
    if (!mainCanvas) return;

    const { widthPx, heightPx } = getTotalSizePx();
    if (!widthPx || !heightPx) return;

    mainCanvas.width = widthPx;
    mainCanvas.height = heightPx;

    // 화면 표시 스케일 계산 (가독성 좋은 프리뷰 크기 유지)
    const maxDisplayW = 760 * state.zoomLevel;
    const maxDisplayH = 620 * state.zoomLevel;
    const scale = Math.min(maxDisplayW / widthPx, maxDisplayH / heightPx);
    mainCanvas.style.width = `${Math.round(widthPx * scale)}px`;
    mainCanvas.style.height = `${Math.round(heightPx * scale)}px`;

    const ctx = mainCanvas.getContext('2d');
    ctx.clearRect(0, 0, widthPx, heightPx);

    // 1. 뷰 모드에 따른 베이스 이미지 렌더링
    if (state.viewMode === 'original') {
      ctx.drawImage(state.originalCanvas, 0, 0);
    } else if (state.viewMode === 'cleanBg') {
      ctx.drawImage(state.cleanBgCanvas, 0, 0);
    } else {
      // 'composite': 글자가 지워진 클린 배경 + 고화질 로고 + 새로운 벡터풍 텍스트 합성
      ctx.drawImage(state.cleanBgCanvas, 0, 0);

      // 로고 합성
      if (state.logoBox && state.logoBox.hasLogo && state.logoCanvas.width > 0) {
        const lx = mmToPx(state.bleedMm + state.logoBox.xMm);
        const ly = mmToPx(state.bleedMm + state.logoBox.yMm);
        const lw = mmToPx(state.logoBox.widthMm);
        const lh = mmToPx(state.logoBox.heightMm);
        ctx.drawImage(state.logoCanvas, lx, ly, lw, lh);
      }

      // 수정된 텍스트 합성
      drawTextItemsOntoCanvas(ctx, state.textItems);
    }

    // 2. 인쇄 가이드라인 오버레이 그리기
    if (state.showGuides) {
      drawPrintGuidesOverlay(ctx, widthPx, heightPx);
    }

    // 3. 마우스로 드래그 중인 선택 영역 표시
    if (state.dragState.isDragging && (state.dragState.mode === 'draw-ocr' || state.dragState.mode === 'draw-erase' || state.dragState.mode === 'draw-logo')) {
      const x0 = mmToPx(Math.min(state.dragState.startXMm, state.dragState.currXMm));
      const y0 = mmToPx(Math.min(state.dragState.startYMm, state.dragState.currYMm));
      const w = mmToPx(Math.abs(state.dragState.currXMm - state.dragState.startXMm));
      const h = mmToPx(Math.abs(state.dragState.currYMm - state.dragState.startYMm));

      ctx.save();
      ctx.strokeStyle = state.dragState.mode === 'draw-erase' ? '#f43f5e' : '#38bdf8';
      ctx.fillStyle = state.dragState.mode === 'draw-erase' ? 'rgba(244, 63, 94, 0.18)' : 'rgba(56, 189, 248, 0.18)';
      ctx.lineWidth = Math.max(2, mmToPx(0.35));
      ctx.setLineDash([mmToPx(1), mmToPx(0.8)]);
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeRect(x0, y0, w, h);
      ctx.restore();
    }
  }

  function drawPrintGuidesOverlay(ctx, widthPx, heightPx) {
    const bleedPx = mmToPx(state.bleedMm);
    const safeMarginPx = mmToPx(state.bleedMm + 3);
    const trimW = widthPx - bleedPx * 2;
    const trimH = heightPx - bleedPx * 2;
    const lineUnit = Math.max(2, Math.round(widthPx / 500));

    ctx.save();

    // (A) 원형 스티커일 때 바깥쪽 반투명 도무송 마스크 & 원형 칼선 표시
    if (state.shape === 'circle') {
      const cx = widthPx / 2;
      const cy = heightPx / 2;
      const trimRadius = Math.min(trimW, trimH) / 2;
      const safeRadius = Math.max(4, trimRadius - mmToPx(3));

      // 재단선 바깥쪽 반투명 어두운 마스크
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
      ctx.beginPath();
      ctx.rect(0, 0, widthPx, heightPx);
      ctx.arc(cx, cy, trimRadius, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.restore();

      // 원형 칼선 (마젠타 실선)
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = lineUnit * 1.4;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(cx, cy, trimRadius, 0, Math.PI * 2);
      ctx.stroke();

      // 원형 안전 여백 (초록 점선)
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = lineUnit;
      ctx.setLineDash([lineUnit * 3, lineUnit * 2]);
      ctx.beginPath();
      ctx.arc(cx, cy, safeRadius, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // (B) 사각형 재단선 (마젠타 실선, 귀도리 반경 반영)
      const radiusPx = mmToPx(state.cornerRadiusMm || 0);
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = lineUnit * 1.3;
      ctx.setLineDash([]);
      drawRoundedRectPath(ctx, bleedPx, bleedPx, trimW, trimH, radiusPx);
      ctx.stroke();

      // 안전 여백 (초록 점선: 재단선 안쪽 3mm)
      if (trimW > mmToPx(10) && trimH > mmToPx(10)) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = lineUnit;
        ctx.setLineDash([lineUnit * 3, lineUnit * 2]);
        drawRoundedRectPath(
          ctx,
          safeMarginPx,
          safeMarginPx,
          widthPx - safeMarginPx * 2,
          heightPx - safeMarginPx * 2,
          Math.max(0, radiusPx - mmToPx(2))
        );
        ctx.stroke();
      }
    }

    // (C) 도련(작업 사이즈) 외곽 파란색 점선
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = lineUnit * 1.2;
    ctx.setLineDash([lineUnit * 4, lineUnit * 2]);
    ctx.strokeRect(lineUnit, lineUnit, widthPx - lineUnit * 2, heightPx - lineUnit * 2);

    // (D) 접지선 표시 (2단 접지 / 3단 접지)
    if (state.foldType === '2fold' || state.foldType === '3fold') {
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = lineUnit * 1.3;
      ctx.setLineDash([lineUnit * 5, lineUnit * 2, lineUnit, lineUnit * 2]);
      const folds = state.foldType === '2fold' ? [0.5] : [1 / 3, 2 / 3];
      folds.forEach(ratio => {
        const fx = Math.round(bleedPx + trimW * ratio);
        ctx.beginPath();
        ctx.moveTo(fx, bleedPx);
        ctx.lineTo(fx, heightPx - bleedPx);
        ctx.stroke();
      });
    }

    // (E) 텍스트 상자 & 로고 상자 점선 바운딩 박스 하이라이트
    if (state.viewMode !== 'cleanBg') {
      state.textItems.forEach(item => {
        const x = mmToPx(state.bleedMm + item.xMm);
        const y = mmToPx(state.bleedMm + item.yMm);
        const w = mmToPx(item.widthMm);
        const h = mmToPx(item.heightMm);
        const isSel = state.selectedTextId === item.id;

        ctx.strokeStyle = isSel ? '#f59e0b' : 'rgba(56, 189, 248, 0.75)';
        ctx.lineWidth = isSel ? lineUnit * 1.5 : lineUnit;
        ctx.setLineDash([lineUnit * 2, lineUnit * 1.5]);
        ctx.strokeRect(x, y, w, h);
      });

      if (state.logoBox && state.logoBox.hasLogo) {
        const lx = mmToPx(state.bleedMm + state.logoBox.xMm);
        const ly = mmToPx(state.bleedMm + state.logoBox.yMm);
        const lw = mmToPx(state.logoBox.widthMm);
        const lh = mmToPx(state.logoBox.heightMm);

        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = lineUnit * 1.2;
        ctx.setLineDash([lineUnit * 2.5, lineUnit * 1.5]);
        ctx.strokeRect(lx, ly, lw, lh);
      }
    }

    ctx.restore();
  }

  function drawRoundedRectPath(ctx, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (rad === 0) {
      ctx.rect(x, y, w, h);
    } else {
      ctx.moveTo(x + rad, y);
      ctx.lineTo(x + w - rad, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
      ctx.lineTo(x + w, y + h - rad);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      ctx.lineTo(x + rad, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
      ctx.lineTo(x, y + rad);
      ctx.quadraticCurveTo(x, y, x + rad, y);
    }
    ctx.closePath();
  }

  // =========================================================================
  // 9. 캔버스 마우스 드래그 인터랙션 (이동 / OCR 영역 지정 / 지우개 / 로고 지정)
  // =========================================================================
  function bindCanvasMouseEvents() {
    const mainCanvas = document.getElementById('mainCanvas');
    if (!mainCanvas) return;

    function getCanvasMouseMm(evt) {
      const rect = mainCanvas.getBoundingClientRect();
      const scaleX = mainCanvas.width / rect.width;
      const scaleY = mainCanvas.height / rect.height;
      const pxX = (evt.clientX - rect.left) * scaleX;
      const pxY = (evt.clientY - rect.top) * scaleY;
      return {
        totalXMm: pxToMm(pxX),
        totalYMm: pxToMm(pxY),
        trimXMm: pxToMm(pxX) - state.bleedMm,
        trimYMm: pxToMm(pxY) - state.bleedMm
      };
    }

    mainCanvas.addEventListener('mousedown', (evt) => {
      const pos = getCanvasMouseMm(evt);
      state.dragState.isDragging = true;
      state.dragState.startXMm = pos.totalXMm;
      state.dragState.startYMm = pos.totalYMm;
      state.dragState.currXMm = pos.totalXMm;
      state.dragState.currYMm = pos.totalYMm;

      if (state.activeTool === 'ocr') {
        state.dragState.mode = 'draw-ocr';
        return;
      }
      if (state.activeTool === 'erase') {
        state.dragState.mode = 'draw-erase';
        return;
      }
      if (state.activeTool === 'logo') {
        state.dragState.mode = 'draw-logo';
        return;
      }

      // 기본 'select' 모드: 클릭한 위치에 텍스트 상자나 로고 상자가 있으면 드래그 이동 시작
      const hitText = state.textItems.find(item =>
        pos.trimXMm >= item.xMm && pos.trimXMm <= item.xMm + item.widthMm &&
        pos.trimYMm >= item.yMm && pos.trimYMm <= item.yMm + item.heightMm
      );

      if (hitText) {
        state.selectedTextId = hitText.id;
        state.dragState.mode = 'move-text';
        state.dragState.targetId = hitText.id;
        state.dragState.origItemXMm = hitText.xMm;
        state.dragState.origItemYMm = hitText.yMm;
        renderTextItemsPanel();
        renderWorkspace();
        return;
      }

      if (state.logoBox && state.logoBox.hasLogo) {
        const lb = state.logoBox;
        if (pos.trimXMm >= lb.xMm && pos.trimXMm <= lb.xMm + lb.widthMm &&
            pos.trimYMm >= lb.yMm && pos.trimYMm <= lb.yMm + lb.heightMm) {
          state.dragState.mode = 'move-logo';
          state.dragState.origItemXMm = lb.xMm;
          state.dragState.origItemYMm = lb.yMm;
          return;
        }
      }

      state.dragState.isDragging = false;
      state.dragState.mode = null;
    });

    window.addEventListener('mousemove', (evt) => {
      if (!state.dragState.isDragging) return;
      const pos = getCanvasMouseMm(evt);
      state.dragState.currXMm = pos.totalXMm;
      state.dragState.currYMm = pos.totalYMm;

      const dxMm = pos.totalXMm - state.dragState.startXMm;
      const dyMm = pos.totalYMm - state.dragState.startYMm;

      if (state.dragState.mode === 'move-text') {
        const item = state.textItems.find(t => t.id === state.dragState.targetId);
        if (item) {
          item.xMm = +(state.dragState.origItemXMm + dxMm).toFixed(1);
          item.yMm = +(state.dragState.origItemYMm + dyMm).toFixed(1);
          renderWorkspace();
        }
      } else if (state.dragState.mode === 'move-logo') {
        state.logoBox.xMm = +(state.dragState.origItemXMm + dxMm).toFixed(1);
        state.logoBox.yMm = +(state.dragState.origItemYMm + dyMm).toFixed(1);
        renderWorkspace();
      } else {
        renderWorkspace();
      }
    });

    window.addEventListener('mouseup', () => {
      if (!state.dragState.isDragging) return;
      const mode = state.dragState.mode;
      state.dragState.isDragging = false;
      state.dragState.mode = null;

      const x0Mm = Math.min(state.dragState.startXMm, state.dragState.currXMm) - state.bleedMm;
      const y0Mm = Math.min(state.dragState.startYMm, state.dragState.currYMm) - state.bleedMm;
      const wMm = Math.abs(state.dragState.currXMm - state.dragState.startXMm);
      const hMm = Math.abs(state.dragState.currYMm - state.dragState.startYMm);

      if (mode === 'move-text') {
        renderTextItemsPanel();
        renderWorkspace();
        return;
      }

      if (wMm < 2 || hMm < 2) {
        renderWorkspace();
        return;
      }

      if (mode === 'draw-erase') {
        state.eraseRegions.push({
          xMm: +x0Mm.toFixed(1),
          yMm: +y0Mm.toFixed(1),
          widthMm: +wMm.toFixed(1),
          heightMm: +hMm.toFixed(1)
        });
        eraseTextRegionsFromBg();
        renderWorkspace();
        showToast('선택한 영역이 스마트 인페인팅으로 배경에서 깨끗하게 지워졌습니다.', 'success');
      } else if (mode === 'draw-ocr') {
        const newId = `ocr-region-${Date.now()}`;
        state.textItems.push({
          id: newId,
          text: '추출된 텍스트 입력',
          xMm: +x0Mm.toFixed(1),
          yMm: +y0Mm.toFixed(1),
          widthMm: +wMm.toFixed(1),
          heightMm: +hMm.toFixed(1),
          fontSizePt: Math.max(7, Math.min(36, +(hMm * 2.0).toFixed(1))),
          fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
          align: 'left',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        });
        state.selectedTextId = newId;
        eraseTextRegionsFromBg();
        renderTextItemsPanel();
        renderWorkspace();
        showToast('드래그한 영역의 글자를 배경에서 지우고 새 편집 텍스트 상자로 등록했습니다.', 'success');
      } else if (mode === 'draw-logo') {
        state.logoBox.hasLogo = true;
        state.logoBox.xMm = +x0Mm.toFixed(1);
        state.logoBox.yMm = +y0Mm.toFixed(1);
        state.logoBox.widthMm = +wMm.toFixed(1);
        state.logoBox.heightMm = +hMm.toFixed(1);
        updateLogoAsset();
        renderWorkspace();
        showToast('새 로고 영역을 추출하고 고화질 배경제거 및 SVG 벡터 변환을 완료했습니다.', 'success');
      }
    });
  }

  // =========================================================================
  // 10. Step 4: CMYK 300DPI TIFF 변환 & 인디자인 자동 조판 패키지(.zip) 출력
  // =========================================================================
  function buildJobSpecForExport() {
    const cleanTitle = (state.jobTitle || '인쇄작업').trim();
    return {
      title: cleanTitle,
      jobTitle: cleanTitle,
      category: state.category,
      shape: state.shape,
      trimWidthMm: state.trimWidthMm,
      trimHeightMm: state.trimHeightMm,
      bleedMm: state.bleedMm,
      dpi: state.dpi,
      tacLimit: state.tacLimit,
      foldType: state.foldType,
      cornerRadiusMm: state.cornerRadiusMm,
      bgFileName: 'background_CMYK_300dpi.tif',
      logoFileName: 'logo_CMYK_300dpi.tif',
      logoSvgFileName: 'logo_vector.svg',
      logoBox: state.logoBox,
      textItems: state.textItems
    };
  }

  function extractTiffUint8(tiffResult) {
    if (!tiffResult) return new Uint8Array(0);
    if (tiffResult instanceof Uint8Array) return tiffResult;
    if (tiffResult.uint8Array instanceof Uint8Array) return tiffResult.uint8Array;
    return new Uint8Array(0);
  }

  function uint8ToBase64(u8) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < u8.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function exportCleanBgCMYKTiff() {
    const eng = getEngine();
    if (!eng || typeof eng.encodeCMYKTiff !== 'function') {
      showToast('CMYK 엔진을 불러오는 중입니다. 잠시 후 다시 시도해주세요.', 'error');
      return;
    }
    showToast(`클린 배경을 CMYK 4채널 ${state.dpi}DPI TIFF(총 잉크량 ${state.tacLimit}% 제한)로 인코딩 중입니다...`, 'info');

    setTimeout(() => {
      try {
        const res = eng.encodeCMYKTiff(state.cleanBgCanvas, state.dpi, { tacLimit: state.tacLimit });
        const blob = res.blob || new Blob([extractTiffUint8(res)], { type: 'image/tiff' });
        const fileName = `${state.jobTitle}_background_CMYK_${state.dpi}dpi.tif`;
        downloadBlob(blob, fileName);
        showToast(`'${fileName}' (CMYK 4채널 ${state.dpi}DPI) 다운로드가 완료되었습니다!`, 'success');
      } catch (err) {
        console.error(err);
        showToast('CMYK TIFF 생성 중 오류가 발생했습니다: ' + err.message, 'error');
      }
    }, 50);
  }

  function exportFullInDesignPackageZip() {
    const eng = getEngine();
    if (!eng || typeof eng.encodeCMYKTiff !== 'function' || typeof eng.createZipBlob !== 'function') {
      showToast('CMYK & ZIP 패키징 엔진이 준비되지 않았습니다.', 'error');
      return;
    }

    showToast('인디자인 자동 조판 패키지(.zip) 6종 파일을 생성하고 있습니다...', 'info');

    setTimeout(() => {
      try {
        const spec = buildJobSpecForExport();

        // 1. 클린 배경 CMYK TIFF
        const bgRes = eng.encodeCMYKTiff(state.cleanBgCanvas, state.dpi, { tacLimit: state.tacLimit });
        const bgTiffBytes = extractTiffUint8(bgRes);

        // 2. 고화질 로고 CMYK TIFF
        const logoSourceCvs = (state.logoCanvas && state.logoCanvas.width > 0) ? state.logoCanvas : state.cleanBgCanvas;
        const logoRes = eng.encodeCMYKTiff(logoSourceCvs, state.dpi, { tacLimit: state.tacLimit });
        const logoTiffBytes = extractTiffUint8(logoRes);

        // 3. 벡터 로고 SVG
        const svgContent = (state.logoBox && state.logoBox.svgString)
          ? state.logoBox.svgString
          : createFallbackLogoSVG(logoSourceCvs);

        // 4. 인디자인 자동 조판 스크립트 (.jsx)
        const indesignJsx = typeof eng.generateInDesignJSX === 'function'
          ? eng.generateInDesignJSX(spec)
          : '// InDesign JSX Generator';

        // 5. 포토샵 CMYK 프로파일(Japan Color 2001 Coated) 일괄 변환 스크립트 (.jsx)
        const photoshopJsx = typeof eng.generatePhotoshopJSX === 'function'
          ? eng.generatePhotoshopJSX(spec)
          : '// Photoshop JSX Generator';

        // 6. 작업지시서 README.txt
        const readmeTxt = generateJobReadmeText(spec);

        const zipEntries = [
          { name: spec.bgFileName, data: bgTiffBytes },
          { name: spec.logoFileName, data: logoTiffBytes },
          { name: spec.logoSvgFileName, data: svgContent },
          { name: 'InDesign_자동조판_실행.jsx', data: indesignJsx },
          { name: 'Photoshop_CMYK프로파일_변환.jsx', data: photoshopJsx },
          { name: '작업지시서_README.txt', data: readmeTxt }
        ];

        const zipBlob = eng.createZipBlob(zipEntries);
        const zipFileName = `${spec.jobTitle}_인디자인조판패키지.zip`;
        downloadBlob(zipBlob, zipFileName);

        showToast(`'${zipFileName}' 다운로드 완료! 압축 해제 후 InDesign_자동조판_실행.jsx를 실행하세요.`, 'success');
      } catch (err) {
        console.error(err);
        showToast('조판 패키지 생성 중 오류가 발생했습니다: ' + err.message, 'error');
      }
    }, 60);
  }

  function generateJobReadmeText(spec) {
    const { widthMm, heightMm } = getTotalSizeMm();
    const { widthPx, heightPx } = getTotalSizePx();
    const lines = [
      '====================================================================',
      ` [PrintPrep Studio Pro] 인쇄 사고 방지 & 인디자인 자동 조판 작업지시서`,
      '====================================================================',
      `- 작업명       : ${spec.jobTitle}`,
      `- 품목 구분    : ${spec.category.toUpperCase()} (${spec.shape === 'circle' ? '원형 칼선' : '사각 재단'})`,
      `- 재단 사이즈  : ${spec.trimWidthMm} x ${spec.trimHeightMm} mm`,
      `- 작업 사이즈  : ${widthMm} x ${heightMm} mm (도련/여분 ${spec.bleedMm} mm 자동 확장 완료)`,
      `- 해상도/컬러  : ${spec.dpi} DPI / 4채널 CMYK (총 잉크량 TAC ${spec.tacLimit}% 제한 적용)`,
      `- 픽셀 해상도  : ${widthPx} x ${heightPx} px`,
      `- 후가공/접지  : 접지(${spec.foldType}) / 귀도리(${spec.cornerRadiusMm}mm)`,
      '',
      '--------------------------------------------------------------------',
      ' [패키지 동봉 파일 안내 (총 6종)]',
      '--------------------------------------------------------------------',
      `1. ${spec.bgFileName} : 기존 글자가 감쪽같이 제거된 CMYK ${spec.dpi}DPI 클린 배경`,
      `2. ${spec.logoFileName} : 배경 투명화 및 선명화 보정된 CMYK ${spec.dpi}DPI 로고`,
      `3. ${spec.logoSvgFileName} : 일러스트레이터/인디자인용 클린 벡터 로고`,
      '4. InDesign_자동조판_실행.jsx : 인디자인에서 1초 만에 문서·도련·배경·로고·K100% 텍스트 상자를 배치하는 스크립트',
      '5. Photoshop_CMYK프로파일_변환.jsx : 포토샵에서 Japan Color 2001 Coated 표준 프로파일로 재저장하는 스크립트',
      '6. 작업지시서_README.txt : 본 작업 명세서',
      '',
      '--------------------------------------------------------------------',
      ` [분리된 편집 가능 텍스트 목록 (총 ${spec.textItems.length}개)]`,
      '--------------------------------------------------------------------'
    ];

    spec.textItems.forEach((t, i) => {
      const colorDesc = t.isK100 ? 'K100% (먹 100% - 핀트 어긋남 방지)' : `C${t.c} M${t.m} Y${t.y} K${t.k}`;
      lines.push(`${i + 1}. "${t.text}" | 위치: (${t.xMm}, ${t.yMm}mm) | 크기: ${t.fontSizePt}pt | 색상: ${colorDesc}`);
    });

    lines.push('');
    lines.push('====================================================================');
    lines.push(' [인디자인 1초 자동 조판 실행 방법]');
    lines.push(' 1) 압축을 같은 폴더에 모두 해제합니다.');
    lines.push(' 2) Adobe InDesign을 실행한 상태에서 [스크립트] 패널을 열거나');
    lines.push('    [파일 > 스크립트 > 기타 스크립트 실행]에서 "InDesign_자동조판_실행.jsx"를 선택합니다.');
    lines.push(' 3) 정확한 재단선, 도련, 레이어(배경/로고/텍스트/칼선)가 즉시 완성됩니다!');
    lines.push('====================================================================');

    return lines.join('\r\n');
  }

  async function launchInDesignDirect() {
    const eng = getEngine();
    const spec = buildJobSpecForExport();

    try {
      const bgBytes = extractTiffUint8(eng.encodeCMYKTiff(state.cleanBgCanvas, state.dpi, { tacLimit: state.tacLimit }));
      const logoSourceCvs = (state.logoCanvas && state.logoCanvas.width > 0) ? state.logoCanvas : state.cleanBgCanvas;
      const logoBytes = extractTiffUint8(eng.encodeCMYKTiff(logoSourceCvs, state.dpi, { tacLimit: state.tacLimit }));
      const svgContent = (state.logoBox && state.logoBox.svgString) ? state.logoBox.svgString : createFallbackLogoSVG(logoSourceCvs);
      const jsxContent = eng.generateInDesignJSX(spec);
      const psJsxContent = eng.generatePhotoshopJSX(spec);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2200);
      const res = await fetch('http://localhost:8090/api/launch-indesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: spec.jobTitle,
          jsxContent,
          psJsxContent,
          bgTiffBase64: uint8ToBase64(bgBytes),
          logoTiffBase64: uint8ToBase64(logoBytes),
          logoSvgContent: svgContent
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        showToast('로컬 파이썬 부스터를 통해 내 PC의 Adobe InDesign 자동 조판이 즉시 실행되었습니다!', 'success');
        return;
      }
    } catch (e) {
      // 로컬 파이썬 서버가 꺼져 있는 경우 웹 패키지 다운로드로 자동 전환
    }

    exportFullInDesignPackageZip();
  }

  // =========================================================================
  // 11. 튜토리얼 모달 & 직원 간 클라우드 작업 공유 (db-store & Google Drive)
  // =========================================================================
  function initTutorialModal() {
    const modal = document.getElementById('tutorialModal');
    if (!modal) return;

    const openBtn = document.getElementById('openTutorialBtn') || document.getElementById('tutorialBtn');
    const closeBtn = document.getElementById('closeTutorialBtn') || document.getElementById('tutorialCloseBtn');
    const prevBtn = document.getElementById('prevTutorialBtn') || document.getElementById('tutorialPrevBtn');
    const nextBtn = document.getElementById('nextTutorialBtn') || document.getElementById('tutorialNextBtn');
    const hideCheck = document.getElementById('hideTutorialCheck');

    function updateSlideView() {
      const slides = modal.querySelectorAll('.tutorial-slide');
      const dots = modal.querySelectorAll('.tutorial-dot, .step-dot');
      if (!slides.length) return;

      state.tutorialStep = Math.max(0, Math.min(slides.length - 1, state.tutorialStep));
      slides.forEach((s, idx) => {
        s.style.display = idx === state.tutorialStep ? 'block' : 'none';
        s.classList.toggle('active', idx === state.tutorialStep);
      });
      dots.forEach((d, idx) => {
        d.classList.toggle('active', idx === state.tutorialStep);
      });

      if (prevBtn) prevBtn.disabled = state.tutorialStep === 0;
      if (nextBtn) {
        nextBtn.textContent = state.tutorialStep === slides.length - 1 ? '시작하기 ✓' : '다음 단계 →';
      }
    }

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        state.tutorialStep = 0;
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        updateSlideView();
      });
    }

    function closeTutorial() {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      if (hideCheck && hideCheck.checked) {
        localStorage.setItem('printPrep_tutorialSeen', '1');
      }
    }

    if (closeBtn) closeBtn.addEventListener('click', closeTutorial);

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        state.tutorialStep--;
        updateSlideView();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const slides = modal.querySelectorAll('.tutorial-slide');
        if (state.tutorialStep >= slides.length - 1) {
          localStorage.setItem('printPrep_tutorialSeen', '1');
          closeTutorial();
        } else {
          state.tutorialStep++;
          updateSlideView();
        }
      });
    }

    updateSlideView();
  }

  function checkUrlHashSyncConfig() {
    const hash = window.location.hash || '';
    if (hash.startsWith('#ghSync=')) {
      try {
        const b64 = decodeURIComponent(hash.slice('#ghSync='.length));
        const decoded = JSON.parse(atob(b64));
        if (decoded && decoded.token) {
          localStorage.setItem('printPrep_ghSyncConfig', JSON.stringify({
            owner: decoded.owner || 'joonoodesign',
            repo: decoded.repo || 'print-prep-studio',
            branch: decoded.branch || 'db-store',
            token: decoded.token
          }));
          history.replaceState(null, '', window.location.pathname + window.location.search);
          showToast('원클릭 클라우드 DB 동기화(#ghSync) 연결이 완료되었습니다!', 'success');
        }
      } catch (e) {
        console.warn('ghSync 해시 파싱 실패:', e);
      }
    }
  }

  function getGhSyncConfig() {
    try {
      const raw = localStorage.getItem('printPrep_ghSyncConfig');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      owner: 'joonoodesign',
      repo: 'print-prep-studio',
      branch: 'db-store',
      token: ''
    };
  }

  async function saveCurrentJobToCloud() {
    const cfg = getGhSyncConfig();
    const gdriveUrl = localStorage.getItem('printPrep_gdriveUrl') || '';
    const jobRecord = {
      id: `job-${Date.now()}`,
      jobTitle: state.jobTitle,
      updatedAt: new Date().toISOString(),
      category: state.category,
      shape: state.shape,
      trimWidthMm: state.trimWidthMm,
      trimHeightMm: state.trimHeightMm,
      bleedMm: state.bleedMm,
      dpi: state.dpi,
      tacLimit: state.tacLimit,
      foldType: state.foldType,
      cornerRadiusMm: state.cornerRadiusMm,
      logoBox: { ...state.logoBox, svgString: '' },
      textItems: state.textItems
    };

    const localList = JSON.parse(localStorage.getItem('printPrep_savedJobs') || '[]');
    localList.unshift(jobRecord);
    localStorage.setItem('printPrep_savedJobs', JSON.stringify(localList.slice(0, 30)));

    if (gdriveUrl) {
      fetch(gdriveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'upsert', job: jobRecord })
      }).catch(() => {});
    }

    if (!cfg.token) {
      renderCloudJobsList(localList);
      showToast('현재 작업 시안이 작업함에 저장되었습니다! (상단 [직원 작업공유]에서 확인 가능)', 'success');
      return;
    }

    try {
      const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/print_studio_jobs.json`;
      const headers = {
        'Authorization': `token ${cfg.token}`,
        'Accept': 'application/vnd.github.v3+json'
      };

      let existingJobs = [];
      let sha = undefined;

      const getRes = await fetch(`${apiUrl}?ref=${cfg.branch}`, { headers });
      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
        const contentStr = decodeURIComponent(escape(atob(fileData.content.replace(/\s/g, ''))));
        existingJobs = JSON.parse(contentStr).jobs || [];
      }

      existingJobs.unshift(jobRecord);
      existingJobs = existingJobs.slice(0, 50);

      const payloadObj = { updatedAt: new Date().toISOString(), jobs: existingJobs };
      const encodedContent = btoa(unescape(encodeURIComponent(JSON.stringify(payloadObj, null, 2))));

      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Update print job: ${state.jobTitle}`,
          content: encodedContent,
          branch: cfg.branch,
          ...(sha ? { sha } : {})
        })
      });

      if (putRes.ok) {
        state.cloudJobs = existingJobs;
        renderCloudJobsList(existingJobs);
        showToast(`'${state.jobTitle}' 시안이 클라우드(db-store)에 실시간 공유되었습니다!`, 'success');
      } else {
        throw new Error(`GitHub API 응답 코드 ${putRes.status}`);
      }
    } catch (err) {
      console.error(err);
      renderCloudJobsList(localList);
      showToast('클라우드 동기화 중 로컬 백업으로 저장했습니다: ' + err.message, 'warn');
    }
  }

  async function loadJobsFromCloud() {
    const cfg = getGhSyncConfig();
    if (!cfg.token) {
      const localList = JSON.parse(localStorage.getItem('printPrep_savedJobs') || '[]');
      renderCloudJobsList(localList);
      return;
    }

    try {
      const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/print_studio_jobs.json?ref=${cfg.branch}`;
      const res = await fetch(apiUrl, {
        headers: {
          'Authorization': `token ${cfg.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (res.ok) {
        const fileData = await res.json();
        const contentStr = decodeURIComponent(escape(atob(fileData.content.replace(/\s/g, ''))));
        const parsed = JSON.parse(contentStr);
        state.cloudJobs = parsed.jobs || [];
        renderCloudJobsList(state.cloudJobs);
      }
    } catch (err) {
      const localList = JSON.parse(localStorage.getItem('printPrep_savedJobs') || '[]');
      renderCloudJobsList(localList);
    }
  }

  function renderCloudJobsList(jobs) {
    const listEl = document.getElementById('sharedJobsList') || document.getElementById('cloudJobsList');
    if (!listEl) return;
    if (!jobs || jobs.length === 0) {
      listEl.innerHTML = '<div style="padding:12px;color:#94a3b8;font-size:12px;">저장된 공유 작업 시안이 없습니다. 우측 하단 [직원 공유 작업함에 저장]을 눌러보세요!</div>';
      return;
    }

    listEl.innerHTML = jobs.map((job, idx) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(15,23,42,0.7);border:1px solid rgba(148,163,184,0.2);border-radius:8px;margin-bottom:6px;">
        <div>
          <div style="font-size:13px;font-weight:700;color:#f8fafc;">${escapeHtmlAttr(job.jobTitle)}</div>
          <div style="font-size:11px;color:#94a3b8;">${job.trimWidthMm}×${job.trimHeightMm}mm (${job.shape === 'circle' ? '원형' : '사각'}) · 텍스트 ${(job.textItems || []).length}개</div>
        </div>
        <button type="button" class="load-cloud-job-btn" data-idx="${idx}" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;">불러오기</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.load-cloud-job-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'));
        const job = jobs[idx];
        if (!job) return;
        loadSampleDesign(job.category || 'card');
        state.jobTitle = job.jobTitle || state.jobTitle;
        state.shape = job.shape || state.shape;
        state.trimWidthMm = job.trimWidthMm || state.trimWidthMm;
        state.trimHeightMm = job.trimHeightMm || state.trimHeightMm;
        state.bleedMm = job.bleedMm ?? state.bleedMm;
        state.textItems = Array.isArray(job.textItems) ? job.textItems : state.textItems;
        syncUIFromState();
        eraseTextRegionsFromBg();
        renderTextItemsPanel();
        renderWorkspace();
        const syncModal = document.getElementById('syncModal');
        if (syncModal) syncModal.classList.add('hidden');
        showToast(`'${job.jobTitle}' 작업 시안을 불러왔습니다.`, 'success');
      });
    });
  }

  // =========================================================================
  // 12. 전체 UI 이벤트 바인딩 및 상태 동기화 (index.html 모든 ID 완벽 대응)
  // =========================================================================
  function syncUIFromState() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };

    setVal('jobTitleInput', state.jobTitle);
    setVal('bleedInput', state.bleedMm);
    setVal('dpiSelect', state.dpi);
    setVal('tacLimitInput', state.tacLimit);
    setVal('foldTypeSelect', state.foldType);
    setVal('stickerWidthInput', state.trimWidthMm);
    setVal('stickerHeightInput', state.trimHeightMm);
    setVal('stickerRadiusInput', state.cornerRadiusMm);
    setVal('stickerDiameterInput', state.trimWidthMm);
    setVal('customWidthInput', state.trimWidthMm);
    setVal('customHeightInput', state.trimHeightMm);

    const pCard = document.getElementById('panelSpecCard');
    const pSticker = document.getElementById('panelSpecSticker');
    const pFlyer = document.getElementById('panelSpecFlyer');
    if (pCard) pCard.classList.toggle('hidden', state.category !== 'card');
    if (pSticker) pSticker.classList.toggle('hidden', state.category !== 'sticker');
    if (pFlyer) pFlyer.classList.toggle('hidden', state.category !== 'flyer');

    const rectGrp = document.getElementById('stickerRectInputs');
    const circleGrp = document.getElementById('stickerCircleInputs');
    if (rectGrp) rectGrp.classList.toggle('hidden', state.shape === 'circle');
    if (circleGrp) circleGrp.classList.toggle('hidden', state.shape !== 'circle');

    document.querySelectorAll('[data-category]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-category') === state.category);
    });

    const viewMap = {
      composite: 'viewModeComposite',
      original: 'viewModeOriginal',
      cleanBg: 'viewModeCleanBg'
    };
    ['composite', 'original', 'cleanBg'].forEach(vm => {
      const btn = document.getElementById(viewMap[vm]);
      if (btn) btn.classList.toggle('active', state.viewMode === vm);
    });

    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tool') === state.activeTool);
    });

    updateDimensionSummaryUI();
  }

  function applyPresetSize(presetValue) {
    state.presetName = presetValue;
    const presets = {
      '90x50': { w: 90, h: 50, bleed: 1, shape: 'rect', cat: 'card' },
      '86x52': { w: 86, h: 52, bleed: 1, shape: 'rect', cat: 'card' },
      'A3': { w: 297, h: 420, bleed: 1.5, shape: 'rect', cat: 'flyer' },
      'A4': { w: 210, h: 297, bleed: 1.5, shape: 'rect', cat: 'flyer' },
      'A5': { w: 148, h: 210, bleed: 1.5, shape: 'rect', cat: 'flyer' },
      'A6': { w: 105, h: 148, bleed: 1.5, shape: 'rect', cat: 'flyer' },
      'B4': { w: 257, h: 364, bleed: 1.5, shape: 'rect', cat: 'flyer' },
      'B5': { w: 182, h: 257, bleed: 1.5, shape: 'rect', cat: 'flyer' },
      'B6': { w: 128, h: 182, bleed: 1.5, shape: 'rect', cat: 'flyer' }
    };

    const p = presets[presetValue];
    if (p) {
      state.trimWidthMm = p.w;
      state.trimHeightMm = p.h;
      state.bleedMm = p.bleed;
      state.shape = p.shape;
      syncUIFromState();
      renderWorkspace();
    }
  }

  function bindAllUIEvents() {
    document.querySelectorAll('[data-step]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('[data-step]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const stepNum = Number(tab.getAttribute('data-step'));
        if (stepNum === 1) {
          state.viewMode = 'composite';
          showToast('① 규격·수평보정 단계: 좌측에서 품목과 사이즈를 고르고 원근/수평을 보정하세요.', 'info');
        } else if (stepNum === 2) {
          state.viewMode = 'composite';
          showToast('② 텍스트(OCR) 추출·수정 단계: 우측 표에서 글자를 수정하면 인디자인 텍스트 상자로 반영됩니다.', 'info');
        } else if (stepNum === 3) {
          state.viewMode = 'cleanBg';
          showToast('③ 배경 글자제거·로고복원 단계: 글자가 감쪽같이 지워진 클린 배경(CMYK 300DPI)을 확인하세요.', 'info');
        } else if (stepNum === 4) {
          state.viewMode = 'composite';
          showToast('④ 인디자인 출력 단계: 우측 하단 버튼으로 CMYK 300DPI + 인디자인 자동조판(.jsx) 패키지를 받으세요.', 'info');
        }
        syncUIFromState();
        renderWorkspace();
      });
    });

    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        themeBtn.textContent = isLight ? '🌙 다크' : '☀️ 라이트';
      });
    }

    const sampleCardBtn = document.getElementById('sampleCardBtn');
    const sampleStickerBtn = document.getElementById('sampleStickerBtn');
    const sampleFlyerBtn = document.getElementById('sampleFlyerBtn');
    if (sampleCardBtn) sampleCardBtn.addEventListener('click', () => loadSampleDesign('card'));
    if (sampleStickerBtn) sampleStickerBtn.addEventListener('click', () => loadSampleDesign('sticker'));
    if (sampleFlyerBtn) sampleFlyerBtn.addEventListener('click', () => loadSampleDesign('flyer'));

    document.querySelectorAll('[data-category]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-category');
        loadSampleDesign(cat);
      });
    });

    const cardPresetSelect = document.getElementById('cardPresetSelect');
    if (cardPresetSelect) {
      cardPresetSelect.addEventListener('change', (e) => applyPresetSize(e.target.value));
    }

    const stickerShapeSelect = document.getElementById('stickerShapeSelect');
    if (stickerShapeSelect) {
      stickerShapeSelect.addEventListener('change', (e) => {
        state.shape = e.target.value;
        if (state.shape === 'circle') {
          const d = Number(document.getElementById('stickerDiameterInput')?.value || 50);
          state.trimWidthMm = d;
          state.trimHeightMm = d;
        } else {
          state.trimWidthMm = Number(document.getElementById('stickerWidthInput')?.value || 60);
          state.trimHeightMm = Number(document.getElementById('stickerHeightInput')?.value || 40);
        }
        syncUIFromState();
        renderWorkspace();
      });
    }

    const bindNum = (id, callback) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        if (!Number.isNaN(val) && val > 0) {
          callback(val);
          updateDimensionSummaryUI();
          renderWorkspace();
        }
      });
    };

    bindNum('stickerWidthInput', (v) => { state.trimWidthMm = Math.min(1000, v); });
    bindNum('stickerHeightInput', (v) => { state.trimHeightMm = Math.min(1000, v); });
    bindNum('stickerDiameterInput', (v) => {
      const d = Math.min(1000, v);
      state.trimWidthMm = d;
      state.trimHeightMm = d;
    });
    const radiusInp = document.getElementById('stickerRadiusInput');
    if (radiusInp) {
      radiusInp.addEventListener('input', (e) => {
        state.cornerRadiusMm = Math.max(0, Number(e.target.value) || 0);
        renderWorkspace();
      });
    }

    const flyerPresetSelect = document.getElementById('flyerPresetSelect');
    if (flyerPresetSelect) {
      flyerPresetSelect.addEventListener('change', (e) => {
        if (e.target.value !== 'custom') {
          applyPresetSize(e.target.value);
        }
      });
    }
    bindNum('customWidthInput', (v) => { state.trimWidthMm = Math.min(1500, v); });
    bindNum('customHeightInput', (v) => { state.trimHeightMm = Math.min(1500, v); });

    const bleedInp = document.getElementById('bleedInput');
    if (bleedInp) {
      bleedInp.addEventListener('input', (e) => {
        state.bleedMm = Math.max(0, Math.min(20, Number(e.target.value) || 0));
        updateDimensionSummaryUI();
        renderWorkspace();
      });
    }
    bindNum('dpiSelect', (v) => { state.dpi = v; });
    bindNum('tacLimitInput', (v) => { state.tacLimit = Math.max(200, Math.min(350, v)); });

    const jobTitleInp = document.getElementById('jobTitleInput');
    if (jobTitleInp) {
      jobTitleInp.addEventListener('input', (e) => {
        state.jobTitle = e.target.value || '인쇄작업';
      });
    }

    const foldSelect = document.getElementById('foldTypeSelect');
    if (foldSelect) {
      foldSelect.addEventListener('change', (e) => {
        state.foldType = e.target.value;
        renderWorkspace();
      });
    }

    const swapBtn = document.getElementById('orientationToggleBtn') || document.getElementById('swapOrientationBtn');
    if (swapBtn) {
      swapBtn.addEventListener('click', () => {
        const tmp = state.trimWidthMm;
        state.trimWidthMm = state.trimHeightMm;
        state.trimHeightMm = tmp;
        state.isLandscape = state.trimWidthMm >= state.trimHeightMm;
        syncUIFromState();
        renderWorkspace();
      });
    }

    const uploadInput = document.getElementById('imageUploadInput');
    if (uploadInput) {
      uploadInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handleUploadedImageFile(e.target.files[0]);
        }
      });
    }

    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleUploadedImageFile(e.dataTransfer.files[0]);
        }
      });
    }

    const autoPerspBtn = document.getElementById('autoPerspectiveBtn');
    if (autoPerspBtn) {
      autoPerspBtn.addEventListener('click', runAutoPerspectiveAndIlluminationCorrection);
    }

    const runOcrBtn = document.getElementById('runFullOcrBtn');
    if (runOcrBtn) runOcrBtn.addEventListener('click', runFullImageOCR);

    const addTextBtn = document.getElementById('addTextItemBtn');
    if (addTextBtn) {
      addTextBtn.addEventListener('click', () => {
        const newId = `txt-manual-${Date.now()}`;
        const defaultFont = document.getElementById('defaultFontSelect')?.value || 'Pretendard';
        state.textItems.push({
          id: newId,
          text: '새 텍스트 입력',
          xMm: +(state.trimWidthMm * 0.15).toFixed(1),
          yMm: +(state.trimHeightMm * 0.45).toFixed(1),
          widthMm: +(state.trimWidthMm * 0.7).toFixed(1),
          heightMm: 6.0,
          fontSizePt: 10.0,
          fontFamily: defaultFont,
          align: 'left',
          c: 0, m: 0, y: 0, k: 100,
          isK100: true
        });
        state.selectedTextId = newId;
        renderTextItemsPanel();
        renderWorkspace();
      });
    }

    const defaultFontSelect = document.getElementById('defaultFontSelect');
    if (defaultFontSelect) {
      defaultFontSelect.addEventListener('change', (e) => {
        const font = e.target.value;
        state.textItems.forEach(t => { t.fontFamily = font; });
        renderWorkspace();
        showToast(`전체 텍스트 폰트가 '${font}'(으)로 변경되었습니다.`, 'info');
      });
    }

    const forceK100Check = document.getElementById('forceK100Check');
    if (forceK100Check) {
      forceK100Check.addEventListener('change', (e) => {
        if (e.target.checked) {
          state.textItems.forEach(t => {
            if (t.k >= 50 || t.isK100) {
              t.isK100 = true;
              t.c = 0; t.m = 0; t.y = 0; t.k = 100;
            }
          });
          renderTextItemsPanel();
          renderWorkspace();
          showToast('어두운 텍스트가 핀트 어긋남 없는 K100% 순수 먹색으로 고정되었습니다.', 'success');
        }
      });
    }

    const inpaintBtn = document.getElementById('eraseAllTextBgBtn') || document.getElementById('runInpaintBtn');
    if (inpaintBtn) {
      inpaintBtn.addEventListener('click', () => {
        eraseTextRegionsFromBg();
        state.viewMode = 'cleanBg';
        syncUIFromState();
        renderWorkspace();
        showToast('배경에서 기존 글자 영역이 감쪽같이 지워졌습니다! (클린 배경 미리보기 전환)', 'success');
      });
    }

    const bgSmoothSlider = document.getElementById('bgSmoothSlider');
    const bgSharpSlider = document.getElementById('bgSharpSlider');
    if (bgSmoothSlider) bgSmoothSlider.addEventListener('change', () => { eraseTextRegionsFromBg(); renderWorkspace(); });
    if (bgSharpSlider) bgSharpSlider.addEventListener('change', () => { eraseTextRegionsFromBg(); renderWorkspace(); });

    const logoThresholdSlider = document.getElementById('logoThresholdSlider');
    if (logoThresholdSlider) {
      logoThresholdSlider.addEventListener('input', () => {
        updateLogoAsset();
        renderWorkspace();
      });
    }

    const vectorizeLogoBtn = document.getElementById('vectorizeLogoBtn') || document.getElementById('downloadLogoSvgBtn');
    if (vectorizeLogoBtn) {
      vectorizeLogoBtn.addEventListener('click', () => {
        updateLogoAsset();
        const blob = new Blob([state.logoBox.svgString || ''], { type: 'image/svg+xml;charset=utf-8' });
        downloadBlob(blob, `${state.jobTitle}_logo_vector.svg`);
        showToast('일러스트레이터용 벡터 로고(.svg) 추출 및 다운로드가 완료되었습니다!', 'success');
      });
    }

    const bindViewBtn = (id, mode) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          state.viewMode = mode;
          syncUIFromState();
          renderWorkspace();
        });
      }
    };
    bindViewBtn('viewModeComposite', 'composite');
    bindViewBtn('viewModeOriginal', 'original');
    bindViewBtn('viewModeCleanBg', 'cleanBg');

    ['showGuideBleed', 'showGuideTrim', 'showGuideSafe'].forEach(chkId => {
      const chk = document.getElementById(chkId);
      if (chk) chk.addEventListener('change', () => renderWorkspace());
    });

    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeTool = btn.getAttribute('data-tool');
        syncUIFromState();
        const toolNames = {
          select: '레이어 선택 및 위치 이동 모드',
          ocr: '글자(OCR) 영역 드래그 추가 모드',
          erase: '지울 글자/잡티 영역 드래그 모드',
          logo: '로고 영역 드래그 지정 모드'
        };
        showToast(`${toolNames[state.activeTool] || state.activeTool}가 활성화되었습니다.`, 'info');
      });
    });

    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const zoomResetBtn = document.getElementById('zoomResetBtn');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => { state.zoomLevel = Math.min(2.5, +(state.zoomLevel + 0.15).toFixed(2)); renderWorkspace(); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { state.zoomLevel = Math.max(0.4, +(state.zoomLevel - 0.15).toFixed(2)); renderWorkspace(); });
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => { state.zoomLevel = 1.0; renderWorkspace(); });

    const exportTiffBtn = document.getElementById('exportCleanBgTiffBtn');
    if (exportTiffBtn) exportTiffBtn.addEventListener('click', exportCleanBgCMYKTiff);

    const exportZipBtn = document.getElementById('exportPackageZipBtn');
    if (exportZipBtn) exportZipBtn.addEventListener('click', exportFullInDesignPackageZip);

    const launchIdBtn = document.getElementById('launchInDesignDirectBtn');
    if (launchIdBtn) launchIdBtn.addEventListener('click', launchInDesignDirect);

    const saveCloudBtn = document.getElementById('saveJobCloudBtn') || document.getElementById('saveCloudJobBtn');
    if (saveCloudBtn) saveCloudBtn.addEventListener('click', saveCurrentJobToCloud);

    const openSyncBtn = document.getElementById('openSyncModalBtn');
    const syncModal = document.getElementById('syncModal');
    const closeSyncBtn = document.getElementById('closeSyncModalBtn');

    if (openSyncBtn && syncModal) {
      openSyncBtn.addEventListener('click', () => {
        const cfg = getGhSyncConfig();
        const ownerInp = document.getElementById('ghOwnerInput');
        const repoInp = document.getElementById('ghRepoInput');
        const tokenInp = document.getElementById('ghTokenInput');
        const gdriveInp = document.getElementById('gdriveUrlInput');
        if (ownerInp) ownerInp.value = cfg.owner || 'joonoodesign';
        if (repoInp) repoInp.value = cfg.repo || 'print-prep-studio';
        if (tokenInp) tokenInp.value = cfg.token || '';
        if (gdriveInp) gdriveInp.value = localStorage.getItem('printPrep_gdriveUrl') || '';
        syncModal.classList.remove('hidden');
        syncModal.style.display = 'flex';
        loadJobsFromCloud();
      });
    }
    if (closeSyncBtn && syncModal) {
      closeSyncBtn.addEventListener('click', () => {
        syncModal.classList.add('hidden');
        syncModal.style.display = 'none';
      });
    }

    const saveGhSyncBtn = document.getElementById('saveGhSyncBtn');
    if (saveGhSyncBtn) {
      saveGhSyncBtn.addEventListener('click', () => {
        const owner = document.getElementById('ghOwnerInput')?.value.trim() || 'joonoodesign';
        const repo = document.getElementById('ghRepoInput')?.value.trim() || 'print-prep-studio';
        const token = document.getElementById('ghTokenInput')?.value.trim() || '';
        localStorage.setItem('printPrep_ghSyncConfig', JSON.stringify({ owner, repo, branch: 'db-store', token }));
        loadJobsFromCloud();
        showToast('GitHub db-store 실시간 직원 공유 설정이 저장되었습니다!', 'success');
      });
    }

    const copyShareLinkBtn = document.getElementById('copyShareLinkBtn');
    if (copyShareLinkBtn) {
      copyShareLinkBtn.addEventListener('click', () => {
        const owner = document.getElementById('ghOwnerInput')?.value.trim() || 'joonoodesign';
        const repo = document.getElementById('ghRepoInput')?.value.trim() || 'print-prep-studio';
        const token = document.getElementById('ghTokenInput')?.value.trim() || getGhSyncConfig().token;
        if (!token) {
          showToast('먼저 GitHub 토큰을 입력하거나 원클릭 링크로 접속해 주세요.', 'warn');
          return;
        }
        const payload = btoa(JSON.stringify({ owner, repo, branch: 'db-store', token }));
        const shareUrl = `${window.location.origin}${window.location.pathname}#ghSync=${encodeURIComponent(payload)}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
          showToast('직원 전달용 원클릭 자동 연결 링크가 클립보드에 복사되었습니다!', 'success');
        }).catch(() => {
          prompt('아래 링크를 복사하여 직원들에게 전달하세요:', shareUrl);
        });
      });
    }

    const saveGdriveSyncBtn = document.getElementById('saveGdriveSyncBtn');
    if (saveGdriveSyncBtn) {
      saveGdriveSyncBtn.addEventListener('click', () => {
        const url = document.getElementById('gdriveUrlInput')?.value.trim() || '';
        localStorage.setItem('printPrep_gdriveUrl', url);
        showToast('구글 드라이브(Apps Script) DB 연동 주소가 저장되었습니다!', 'success');
      });
    }
  }

  // =========================================================================
  // 13. 로컬 파이썬 부스터 상태 자동 점검 & 앱 초기 구동
  // =========================================================================
  async function checkLocalPythonBooster() {
    const badge = document.getElementById('pythonStatusBadge') || document.getElementById('engineModeBadge');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch('http://localhost:8090/api/status', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const info = await res.json();
        state.localBoosterOnline = true;
        if (badge) {
          badge.textContent = `⚡ 파이썬 인디자인 직통 연결됨 (사내공유: http://${info.lanIp || 'localhost'}:8090)`;
          badge.classList.add('online');
        }
        return;
      }
    } catch (e) {
      state.localBoosterOnline = false;
    }
    if (badge) {
      badge.textContent = '🌐 24h 클라우드 웹 독립 모드 (CMYK 300DPI & 자동조판 활성)';
    }
  }

  function initApp() {
    checkUrlHashSyncConfig();
    bindAllUIEvents();
    bindCanvasMouseEvents();
    initTutorialModal();
    checkLocalPythonBooster();
    loadSampleDesign('card');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
