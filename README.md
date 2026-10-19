# 🖨️ PrintPrep Studio Pro (인쇄·명함·스티커 CMYK 분리 & 인디자인 자동 조판 스튜디오)

**PrintPrep Studio Pro**는 이미지 한 장(시안·참고 이미지·캘리그라피·로고)만 업로드하면 **① 배경 글자 자동 제거(Inpainting)**, **② 로고·캘리그라피 투명 분리 및 벡터(SVG) 추출**, **③ 인쇄소 납품 규격의 무손실 CMYK 300DPI+ TIFF 생성**, **④ Adobe InDesign `.jsx` 4개 레이어 자동 조판 스크립트 생성**까지 원클릭으로 처리하는 올인원 인쇄 프리프레스(Pre-press) 웹 애플리케이션입니다.

아이폰(iOS), 아이패드(iPadOS), 사내 PC 어디서나 컴퓨터를 켜두지 않아도 **365일 24시간 무료 클라우드 환경**에서 대표님과 직원들이 함께 작업 내역을 공유할 수 있으며, 사내 디자인 PC에서는 선택형 **파이썬 인디자인 직통 브릿지(`start_studio.bat`)**를 통해 다운로드·압축해제 없이 1초 만에 인디자인 작업을 이어갈 수 있습니다.

---

## ✨ 핵심 기능 요약

### 1. 인쇄물 종류별 실무 규격 & 재단선(Bleed)·안전선(Safe Zone) 완벽 지원
- **명함 (Business Card)**
  - 일반 명함: `90 × 50 mm` (작업 사이즈 `94 × 54 mm`, 사방 재단 여백 `2 mm`)
  - 신용카드·수입지 규격 명함: `86 × 52 mm` (작업 사이즈 `90 × 56 mm`, 사방 재단 여백 `2 mm`)
  - 가로형 / 세로형 즉시 전환 지원
- **스티커 (Sticker / Label)**
  - **사각 스티커**: 원하는 가로×세로(mm) 자유 입력 및 표준 규격 프리셋 (`50×50`, `70×40`, `90×60 mm` 등)
  - **원형·도무송 스티커**: 지름(`30 mm`, `40 mm`, `50 mm`, `60 mm`, `80 mm` 등) 설정 및 **원형 칼선(Die-cut Magenta Line)** 자동 생성
- **일반 인쇄물 (전단지 / 포스터 / 리플렛 / 엽서)**
  - **A 계열**: `A3 (297×420)`, `A4 (210×297)`, `A5 (148×210)`, `A6 (105×148 mm)`
  - **B 계열 (국전·46판 실무 규격)**: `B4 (257×364)`, `B5 (182×257)`, `B6 (128×182 mm)`
  - **사용자 정의(Custom mm)**: 원하는 가로·세로(mm) 및 재단 여백(`1~5 mm`) 자유 지정

### 2. 무손실 CMYK 300DPI / 600DPI 바이너리 TIFF 생성 엔진 (`cmyk-engine.js`)
- 브라우저의 일반 Canvas(`RGB 72DPI`) 한계를 넘어, 픽셀 단위로 **RGB → CMYK 4채널(Cyan, Magenta, Yellow, Key/Black)** 색분해를 수행합니다.
- **GCR (Gray Component Replacement)** 및 **TAC (총 잉크량 제한, 기본 300%)** 제어 알고리즘이 내장되어 인쇄 시 뒷묻음 현상을 방지하고, 먹(K 100%) 농도를 선명하게 유지합니다.
- TIFF 헤더에 **300 DPI (또는 600 DPI) 물리 해상도 태그(`XResolution`, `YResolution`, `ResolutionUnit=Inch`)**와 `PhotometricInterpretation = 5 (Separated CMYK)` 태그를 직접 기록하여 포토샵·인디자인에서 열었을 때 정확한 mm 치수와 CMYK 모드로 즉시 인식됩니다.

### 3. 배경 글자·로고 스마트 지우개 (텍스처 보존 인페인팅)
- 시안 이미지에서 기존 텍스트나 로고 영역을 마우스로 드래그(박스 또는 브러시)하면 주변 배경의 종이 질감·그라데이션을 자연스럽게 복원하여 **깨끗한 무지 배경 이미지(`background_CMYK_300dpi.tif`)**를 만들어 줍니다.

### 4. 로고·캘리그라피 정밀 배경제거 & 벡터(SVG) 추출
- 배경 색상 자동 감지(Chroma & Luminance Keying)와 가장자리 초정밀 다듬기를 통해 복잡한 붓글씨(캘리그라피)나 엠블럼만 깔끔하게 분리합니다.
- 분리된 로고는 **고해상도 CMYK TIFF(`logo_CMYK_300dpi.tif`)**와 확대해도 깨지지 않는 **베지어 곡선 기반 벡터 파일(`logo_vector.svg`)**로 동시 추출됩니다.

### 5. Adobe InDesign 4개 레이어 자동 조판 스크립트 (`.jsx`) 생성
인디자인에서 `InDesign_자동조판_실행.jsx` 파일을 실행하면 아래와 같이 **실무 표준 4개 레이어**로 완벽히 분리된 새 문서가 1초 만에 생성됩니다:
1. **`04_칼선_가이드 (비인쇄)`**: 재단선(Trim), 도련(Bleed), 안전여백(Safe Zone), 원형 스티커 도무송 칼선 (인쇄 시 출력되지 않도록 `nonprinting` 속성 자동 부여)
2. **`03_편집_텍스트`**: 상호명, 직함, 성명, 연락처, 주소 등 디자이너가 인디자인에서 폰트·자간·크기를 즉시 수정할 수 있는 편집 가능 텍스트 프레임 (K=100% 먹색 기본 적용)
3. **`02_로고_캘리그라피`**: 추출된 로고·캘리그라피 이미지 및 벡터 배치 레이어
4. **`01_배경_디자인`**: 글자가 제거된 깨끗한 CMYK 300DPI 배경 이미지가 도련(Bleed) 끝까지 자동 맞춤 배치된 레이어

---

## 🌐 24시간 무료 직원 공유 & 클라우드 DB 사용 방법 (내 PC를 꺼놔도 작동!)

### 방법 A. GitHub Pages + 원클릭 자동 연결 링크 (`#ghSync=...`) — 기본 추천
1. 웹사이트(`https://joonoodesign.github.io/print-prep-studio/`)에 접속하면 내 컴퓨터가 꺼져 있어도 **365일 24시간** 아이폰·아이패드·사내 PC 어디서든 즉시 접속됩니다.
2. 상단 **[클라우드 동기화]** 버튼에서 **원클릭 직원 공유 링크 복사**를 눌러 카카오톡이나 사내 메신저로 직원에게 전달하세요.
3. 직원이 해당 링크를 클릭하기만 하면 복잡한 설정 없이 `db-store` 브랜치의 클라우드 DB와 실시간으로 연결되어 대표님이 등록한 작업 지시서·프리셋·인쇄 규격을 즉시 불러오고 함께 관리할 수 있습니다.

### 방법 B. 내 구글 드라이브(Google Drive) 무료 연동 (`google_drive_db.gs`)
1. [Google Apps Script](https://script.google.com)에서 새 프로젝트를 만들고 프로젝트 폴더의 [`google_drive_db.gs`](file:///d:/antigravity/print-prep-studio/google_drive_db.gs) 코드를 붙여넣습니다.
2. **[배포] → [새 배포] → [웹 앱]** (실행 주체: `나`, 액세스 권한: `모든 사용자`)으로 배포한 뒤 생성된 URL을 복사합니다.
3. 앱 상단 **[클라우드 동기화]** 설정창에 웹 앱 URL을 입력하면 내 구글 드라이브의 `print_prep_studio_jobs.json` 파일에 모든 작업 내역이 영구 보관·동기화됩니다.

---

## 🚀 파이썬 인디자인 직통 브릿지 사용법 (선택 사항, 사내 디자인 PC용)

웹 브라우저만으로도 모든 파일(CMYK TIFF, SVG, InDesign JSX)을 다운로드할 수 있지만, 인디자인이 설치된 디자인 PC에서 [`start_studio.bat`](file:///d:/antigravity/print-prep-studio/start_studio.bat)를 실행하면 **다운로드 및 압축 해제 과정조차 생략**됩니다.

1. [`start_studio.bat`](file:///d:/antigravity/print-prep-studio/start_studio.bat) 파일을 더블클릭합니다.
2. 자동으로 포트 `8090`에서 로컬 부스터 서버([`server.py`](file:///d:/antigravity/print-prep-studio/server.py))가 켜지고 `http://localhost:8090` 브라우저 창이 열립니다.
3. 웹 화면에서 **[⚡ 인디자인으로 즉시 열기 (파이썬 브릿지)]** 버튼을 클릭하면:
   - `d:\antigravity\print-prep-studio\exports\<작업명_타임스탬프>\` 폴더에
     - `background_CMYK_300dpi.tif`
     - `logo_CMYK_300dpi.tif`
     - `logo_vector.svg`
     - `InDesign_자동조판_실행.jsx`
     - `Photoshop_CMYK변환.jsx`
     파일이 즉시 생성됩니다.
   - 동시에 **Windows 탐색기로 해당 폴더가 열리고 Adobe InDesign이 자동 실행**되어 1초 만에 실무 조판 작업을 이어갈 수 있습니다.
4. 또한 콘솔 창에 표시되는 `http://<사내_IP>:8090` 주소를 사내 다른 직원 PC에서 열면 사내 LAN 공유 작업장으로도 즉시 활용할 수 있습니다.

---

## 📂 폴더 및 파일 구조

```text
d:\antigravity\print-prep-studio\
├── index.html           # 메인 UI (반응형 워크스페이스 + 튜토리얼 모달 + PWA 지원)
├── styles.css           # 다크 프리프레스 스튜디오 테마 스타일시트
├── cmyk-engine.js       # RGB→CMYK 300DPI+ 무손실 TIFF 인코더, 인페인팅, SVG 벡터 트레이서
├── app.js               # 메인 애플리케이션 로직, JSX 생성기, GitHub/GDrive/Python 동기화 매니저
├── server.py            # [선택형] 인디자인 직통 실행 브릿지 & 사내 LAN 공유 서버 (포트 8090)
├── start_studio.bat     # [선택형] 원클릭 파이썬 부스터 서버 실행기
├── google_drive_db.gs   # [선택형] 구글 드라이브 24시간 무료 DB 연동 Apps Script 코드
├── manifest.json        # 아이폰·아이패드·PC 앱 설치(PWA) 매니페스트
└── README.md            # 프로젝트 사용 설명서
```
