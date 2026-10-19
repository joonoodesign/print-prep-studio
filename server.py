#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PrintPrep Studio Pro - 로컬 & 사내 공유 파이썬 부스터 서버 (포트 8090)
- 정적 웹 서버 및 사내 LAN 공유 지원
- Adobe InDesign / Photoshop 작업 패키지 로컬 즉시 생성 및 탐색기/스크립트 자동 실행 브릿지
- 사내 네트워크 작업 내역 공유 DB (local_jobs_db.json)
- Pillow / OpenCV 선택적 감지 (미설치 환경에서도 100% 정상 작동)
"""

import os
import sys
import json
import time
import base64
import socket
import re
import subprocess
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# 선택적 라이브러리 감지 (Graceful Fallback)
HAS_PILLOW = False
HAS_OPENCV = False

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

PORT = 8090
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORTS_DIR = os.path.join(BASE_DIR, "exports")
DB_FILE = os.path.join(BASE_DIR, "local_jobs_db.json")

os.makedirs(EXPORTS_DIR, exist_ok=True)


def get_lan_ip():
    """사내 네트워크(LAN) IP 주소를 감지합니다."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


def sanitize_filename(name):
    """폴더 및 파일명에 사용할 수 없는 문자를 안전하게 치환합니다."""
    if not name:
        return "PrintPrep_Job"
    cleaned = re.sub(r'[\\/:*?"<>|]+', '_', str(name).strip())
    cleaned = re.sub(r'\s+', '_', cleaned)
    return cleaned[:60] or "PrintPrep_Job"


def decode_base64_payload(data_str):
    """Data URL 또는 순수 Base64 문자열을 바이트로 디코딩합니다."""
    if not data_str:
        return b""
    if "," in data_str and data_str.strip().startswith("data:"):
        data_str = data_str.split(",", 1)[1]
    return base64.b64decode(data_str)


def load_local_jobs():
    """로컬 공유 작업 DB(local_jobs_db.json)를 로드합니다."""
    if not os.path.exists(DB_FILE):
        default_data = {
            "updatedAt": datetime.now().isoformat(),
            "jobs": []
        }
        save_local_jobs(default_data)
        return default_data
    try:
        with open(DB_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return {"updatedAt": datetime.now().isoformat(), "jobs": data}
            if "jobs" not in data or not isinstance(data["jobs"], list):
                data["jobs"] = []
            return data
    except Exception:
        return {"updatedAt": datetime.now().isoformat(), "jobs": []}


def save_local_jobs(data):
    """로컬 공유 작업 DB(local_jobs_db.json)를 저장합니다."""
    if isinstance(data, list):
        payload = {"updatedAt": datetime.now().isoformat(), "jobs": data}
    elif isinstance(data, dict):
        payload = {
            "updatedAt": datetime.now().isoformat(),
            "jobs": data.get("jobs", [])
        }
        for k, v in data.items():
            if k not in ("updatedAt", "jobs"):
                payload[k] = v
    else:
        payload = {"updatedAt": datetime.now().isoformat(), "jobs": []}

    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return payload


def find_indesign_executable():
    """Windows 환경에서 설치된 Adobe InDesign 실행 파일을 탐색합니다."""
    if os.name != "nt":
        return None
    program_files = [
        os.environ.get("ProgramFiles", r"C:\Program Files"),
        os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    ]
    for pf in program_files:
        adobe_dir = os.path.join(pf, "Adobe")
        if os.path.isdir(adobe_dir):
            try:
                folders = sorted(os.listdir(adobe_dir), reverse=True)
                for folder in folders:
                    if "indesign" in folder.lower():
                        exe_path = os.path.join(adobe_dir, folder, "InDesign.exe")
                        if os.path.isfile(exe_path):
                            return exe_path
            except Exception:
                pass
    return None


class PrintPrepRequestHandler(SimpleHTTPRequestHandler):
    """PrintPrep Studio Pro 전용 HTTP 요청 핸들러"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # CORS 헤더 기본 적용 (클라우드 GitHub Pages 및 사내 LAN 어디서나 호출 가능)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path

        if route == "/api/status":
            lan_ip = get_lan_ip()
            self.send_json(200, {
                "ok": True,
                "mode": "python-booster",
                "lanIp": lan_ip,
                "port": PORT,
                "url": f"http://{lan_ip}:{PORT}",
                "hasPillow": HAS_PILLOW,
                "hasOpenCV": HAS_OPENCV,
                "exportsDir": EXPORTS_DIR,
                "indesignFound": bool(find_indesign_executable()),
                "serverTime": datetime.now().isoformat()
            })
            return

        if route == "/api/jobs":
            db_data = load_local_jobs()
            self.send_json(200, {
                "ok": True,
                "updatedAt": db_data.get("updatedAt"),
                "jobs": db_data.get("jobs", [])
            })
            return

        # 그 외 요청은 정적 파일(index.html 등) 서빙
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        route = parsed.path

        if route == "/api/jobs":
            try:
                body = self.read_json_body()
                current_db = load_local_jobs()
                jobs_list = current_db.get("jobs", [])

                # 전체 목록 덮어쓰기(sync) 또는 단일 작업 추가/업데이트 모두 지원
                if "jobs" in body and isinstance(body["jobs"], list):
                    saved = save_local_jobs({"jobs": body["jobs"]})
                elif "action" in body and body["action"] == "delete" and "id" in body:
                    target_id = str(body["id"])
                    jobs_list = [j for j in jobs_list if str(j.get("id")) != target_id]
                    saved = save_local_jobs({"jobs": jobs_list})
                elif "job" in body and isinstance(body["job"], dict):
                    new_job = body["job"]
                    job_id = str(new_job.get("id", f"job_{int(time.time() * 1000)}"))
                    new_job["id"] = job_id
                    replaced = False
                    for idx, existing in enumerate(jobs_list):
                        if str(existing.get("id")) == job_id:
                            jobs_list[idx] = new_job
                            replaced = True
                            break
                    if not replaced:
                        jobs_list.insert(0, new_job)
                    saved = save_local_jobs({"jobs": jobs_list})
                else:
                    # body 자체가 단일 job 객체인 경우
                    job_id = str(body.get("id", f"job_{int(time.time() * 1000)}"))
                    body["id"] = job_id
                    replaced = False
                    for idx, existing in enumerate(jobs_list):
                        if str(existing.get("id")) == job_id:
                            jobs_list[idx] = body
                            replaced = True
                            break
                    if not replaced:
                        jobs_list.insert(0, body)
                    saved = save_local_jobs({"jobs": jobs_list})

                self.send_json(200, {
                    "ok": True,
                    "updatedAt": saved.get("updatedAt"),
                    "jobs": saved.get("jobs", [])
                })
            except Exception as e:
                self.send_json(500, {"ok": False, "error": str(e)})
            return

        if route == "/api/launch-indesign":
            try:
                body = self.read_json_body()
                title = sanitize_filename(body.get("title") or "PrintPrep_Job")
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                folder_name = f"{title}_{timestamp}"
                export_dir = os.path.join(EXPORTS_DIR, folder_name)
                os.makedirs(export_dir, exist_ok=True)

                saved_files = []

                # 1. 배경 CMYK 300DPI TIFF 저장
                bg_tiff_b64 = body.get("bgTiffBase64")
                bg_tiff_path = os.path.join(export_dir, "background_CMYK_300dpi.tif")
                if bg_tiff_b64:
                    with open(bg_tiff_path, "wb") as f:
                        f.write(decode_base64_payload(bg_tiff_b64))
                    saved_files.append("background_CMYK_300dpi.tif")

                # 2. 로고 CMYK 300DPI TIFF 저장
                logo_tiff_b64 = body.get("logoTiffBase64")
                logo_tiff_path = os.path.join(export_dir, "logo_CMYK_300dpi.tif")
                if logo_tiff_b64:
                    with open(logo_tiff_path, "wb") as f:
                        f.write(decode_base64_payload(logo_tiff_b64))
                    saved_files.append("logo_CMYK_300dpi.tif")

                # 3. 로고 벡터 SVG 저장
                logo_svg = body.get("logoSvgContent")
                logo_svg_path = os.path.join(export_dir, "logo_vector.svg")
                if logo_svg:
                    with open(logo_svg_path, "w", encoding="utf-8") as f:
                        f.write(logo_svg)
                    saved_files.append("logo_vector.svg")

                # 4. InDesign 자동 조판 JSX 저장 (UTF-8 with BOM으로 저장하여 한글/인디자인 호환성 보장)
                jsx_content = body.get("jsxContent") or ""
                jsx_path = os.path.join(export_dir, "InDesign_자동조판_실행.jsx")
                if jsx_content:
                    with open(jsx_path, "w", encoding="utf-8-sig") as f:
                        f.write(jsx_content)
                    saved_files.append("InDesign_자동조판_실행.jsx")

                # 5. Photoshop CMYK 변환 JSX 저장
                ps_jsx_content = body.get("psJsxContent") or ""
                ps_jsx_path = os.path.join(export_dir, "Photoshop_CMYK변환.jsx")
                if ps_jsx_content:
                    with open(ps_jsx_path, "w", encoding="utf-8-sig") as f:
                        f.write(ps_jsx_content)
                    saved_files.append("Photoshop_CMYK변환.jsx")

                # Windows에서 출력 폴더 즉시 열기 및 InDesign 자동 실행 시도
                launched_indesign = False
                opened_folder = False
                launch_message = "패키지 파일이 로컬 폴더에 저장되었습니다."

                if os.name == "nt":
                    try:
                        os.startfile(export_dir)
                        opened_folder = True
                    except Exception:
                        pass

                    indesign_exe = find_indesign_executable()
                    auto_run_jsx = body.get("autoRunJsx", True)
                    if jsx_content and auto_run_jsx:
                        try:
                            if indesign_exe:
                                subprocess.Popen([indesign_exe, jsx_path], close_fds=True)
                                launched_indesign = True
                                launch_message = "InDesign 자동 조판 스크립트(.jsx)와 작업 폴더를 동시에 실행했습니다."
                            else:
                                # InDesign 경로를 직접 못 찾은 경우에도 .jsx 연결 프로그램이 있으면 실행 시도
                                os.startfile(jsx_path)
                                launched_indesign = True
                                launch_message = "기본 연결 프로그램으로 InDesign 스크립트(.jsx) 및 작업 폴더를 열었습니다."
                        except Exception:
                            launch_message = "작업 폴더를 탐색기에서 즉시 열었습니다. InDesign에서 JSX 파일을 더블클릭하세요."

                self.send_json(200, {
                    "ok": True,
                    "exportDir": export_dir,
                    "folderName": folder_name,
                    "savedFiles": saved_files,
                    "launchedInDesign": launched_indesign,
                    "openedFolder": opened_folder,
                    "message": launch_message
                })
            except Exception as e:
                self.send_json(500, {"ok": False, "error": str(e)})
            return

        self.send_json(404, {"ok": False, "error": f"지원하지 않는 API 경로입니다: {route}"})


def main():
    lan_ip = get_lan_ip()
    print("=" * 68)
    print("  PrintPrep Studio Pro - 로컬 & 사내 공유 파이썬 부스터 서버")
    print("=" * 68)
    print(f"  * 내 PC 접속 주소     : http://localhost:{PORT}")
    print(f"  * 사내 직원 공유 주소 : http://{lan_ip}:{PORT}")
    print(f"  * 인디자인 출력 폴더  : {EXPORTS_DIR}")
    print(f"  * Pillow 설치 여부    : {'설치됨 (고속 이미지 처리 활성)' if HAS_PILLOW else '미설치 (표준 내장 엔진으로 100% 작동)'}")
    print(f"  * OpenCV 설치 여부    : {'설치됨 (고급 비전 처리 활성)' if HAS_OPENCV else '미설치 (표준 내장 엔진으로 100% 작동)'}")
    print("=" * 68)
    print("  [안내] 이 창을 켜두면 사내 직원이 위 공유 주소로 접속하여")
    print("         작업 내역을 공유하고 인디자인 직통 브릿지를 사용할 수 있습니다.")
    print("         종료하려면 Ctrl+C 를 누르거나 창을 닫으세요.")
    print("=" * 68)

    server = HTTPServer(("0.0.0.0", PORT), PrintPrepRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[서버 종료] PrintPrep Studio Pro 부스터 서버를 안전하게 종료합니다.")
        server.server_close()


if __name__ == "__main__":
    main()
