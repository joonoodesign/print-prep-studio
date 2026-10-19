/**
 * PrintPrep Studio Pro - Google Drive 24시간 무료 클라우드 DB 연동 스크립트 (Google Apps Script)
 *
 * [설치 및 사용 방법]
 * 1. https://script.google.com 접속 후 [새 프로젝트]를 클릭합니다.
 * 2. 기존 코드를 모두 지우고 이 파일(google_drive_db.gs)의 내용을 붙여넣은 뒤 저장(Ctrl+S)합니다.
 * 3. 우측 상단 [배포] -> [새 배포]를 클릭합니다.
 * 4. 유형 선택(톱니바퀴)에서 [웹 앱(Web App)]을 선택합니다.
 *    - 다음 사용자 인증 정보로 실행: "나 (내 구글 계정)"
 *    - 액세스 권한이 있는 사용자: "모든 사용자 (Anyone)"
 * 5. [배포] 버튼을 누르고 권한 승인 후 생성된 "웹 앱 URL (https://script.google.com/macros/s/.../exec)"을 복사합니다.
 * 6. PrintPrep Studio Pro 상단 [클라우드 동기화 설정] 모달의 "Google Drive 연동 URL" 칸에 붙여넣으면
 *    내 구글 드라이브의 `print_prep_studio_jobs.json` 파일에 대표님과 직원의 모든 인쇄 작업 내역이 24시간 실시간 동기화됩니다!
 */

const DB_FILENAME = 'print_prep_studio_jobs.json';

/**
 * 구글 드라이브에서 `print_prep_studio_jobs.json` 파일을 찾거나 없으면 새로 생성합니다.
 */
function getOrCreateDbFile_() {
  const files = DriveApp.getFilesByName(DB_FILENAME);
  if (files.hasNext()) {
    return files.next();
  }
  const initialData = {
    app: 'PrintPrep Studio Pro',
    updatedAt: new Date().toISOString(),
    jobs: []
  };
  return DriveApp.createFile(
    DB_FILENAME,
    JSON.stringify(initialData, null, 2),
    MimeType.PLAIN_TEXT
  );
}

/**
 * JSON 응답 객체 생성 헬퍼
 */
function createJsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET 요청 처리: 저장된 작업 내역(jobs) 조회 및 상태 확인
 */
function doGet(e) {
  try {
    const file = getOrCreateDbFile_();
    const content = file.getBlob().getDataAsString('UTF-8');
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      parsed = { updatedAt: new Date().toISOString(), jobs: [] };
    }

    const jobs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.jobs) ? parsed.jobs : []);

    return createJsonResponse_({
      ok: true,
      mode: 'google-drive-db',
      fileName: DB_FILENAME,
      fileId: file.getId(),
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      jobs: jobs
    });
  } catch (err) {
    return createJsonResponse_({
      ok: false,
      error: String(err)
    });
  }
}

/**
 * POST 요청 처리: 작업 내역 전체 동기화, 개별 작업 추가/수정, 특정 작업 삭제
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const file = getOrCreateDbFile_();
    let currentData;
    try {
      currentData = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    } catch (err) {
      currentData = { updatedAt: new Date().toISOString(), jobs: [] };
    }

    let jobsList = Array.isArray(currentData.jobs) ? currentData.jobs : [];
    const rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(rawBody);

    if (Array.isArray(body.jobs)) {
      // 전체 작업 리스트 동기화
      jobsList = body.jobs;
    } else if (body.action === 'delete' && body.id) {
      // 특정 작업 삭제
      const targetId = String(body.id);
      jobsList = jobsList.filter(function(item) {
        return String(item.id) !== targetId;
      });
    } else if (body.job && typeof body.job === 'object') {
      // 단일 작업 업서트(추가 또는 갱신)
      const newJob = body.job;
      if (!newJob.id) {
        newJob.id = 'job_' + new Date().getTime();
      }
      let replaced = false;
      for (let i = 0; i < jobsList.length; i++) {
        if (String(jobsList[i].id) === String(newJob.id)) {
          jobsList[i] = newJob;
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        jobsList.unshift(newJob);
      }
    } else if (body.id || body.title) {
      // body 자체가 단일 job 객체인 경우
      if (!body.id) {
        body.id = 'job_' + new Date().getTime();
      }
      let replaced = false;
      for (let i = 0; i < jobsList.length; i++) {
        if (String(jobsList[i].id) === String(body.id)) {
          jobsList[i] = body;
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        jobsList.unshift(body);
      }
    }

    const updatedPayload = {
      app: 'PrintPrep Studio Pro',
      updatedAt: new Date().toISOString(),
      jobs: jobsList
    };

    file.setContent(JSON.stringify(updatedPayload, null, 2));

    return createJsonResponse_({
      ok: true,
      mode: 'google-drive-db',
      fileId: file.getId(),
      updatedAt: updatedPayload.updatedAt,
      jobs: jobsList
    });
  } catch (err) {
    return createJsonResponse_({
      ok: false,
      error: String(err)
    });
  } finally {
    lock.releaseLock();
  }
}
