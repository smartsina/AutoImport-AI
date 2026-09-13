#!/usr/bin/env python3
import sys
import os
import json
import struct
import subprocess
import urllib.request

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        return None
    message_length = struct.unpack('@I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

def send_message(message):
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def is_server_running():
    try:
        req = urllib.request.Request('http://127.0.0.1:5151/health')
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False

def is_mlx_running():
    try:
        req = urllib.request.Request('http://localhost:8111/v1/models')
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False

def ensure_mlx_vlm_running():
    if is_mlx_running():
        return
    mlx_venv_python = os.path.expanduser('~/.mlx_venv/bin/python3')
    mlx_server_bin = os.path.expanduser('~/.mlx_venv/bin/mlx_vlm.server')

    if os.path.exists(mlx_server_bin):
        cmd = [mlx_venv_python, mlx_server_bin, '--model', 'PaddlePaddle/PaddleOCR-VL-1.6', '--port', '8111']
        if os.name == 'nt':
            subprocess.Popen(cmd, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS)
        else:
            subprocess.Popen(cmd, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def stop_server():
    if os.name == 'nt':
        try:
            subprocess.run('for /f "tokens=5" %a in (\'netstat -aon ^| findstr :5151\') do taskkill /f /pid %a', shell=True, stderr=subprocess.DEVNULL)
        except Exception: pass
        try:
            subprocess.run('for /f "tokens=5" %a in (\'netstat -aon ^| findstr :8111\') do taskkill /f /pid %a', shell=True, stderr=subprocess.DEVNULL)
        except Exception: pass
    else:
        try:
            subprocess.run('docker stop vv_ocr 2>/dev/null', shell=True)
        except Exception: pass
        try:
            subprocess.run('lsof -ti:5151 | xargs kill -9 2>/dev/null', shell=True)
        except Exception: pass
        try:
            subprocess.run('lsof -ti:8111 | xargs kill -9 2>/dev/null', shell=True)
        except Exception: pass

def main():
    try:
        msg = read_message()
        if not msg:
            return

        action = msg.get('action')
        if action == 'ping' or action == 'status':
            running = is_server_running()
            send_message({'status': 'running' if running else 'stopped', 'running': running})

        elif action == 'start':
            # توقف کانتینر داکر قدیمی در صورت وجود برای جلوگیری از تصاحب پورت 5151
            try:
                subprocess.run('docker stop vv_ocr 2>/dev/null', shell=True)
            except Exception: pass

            # ⚡ بررسی و روشن کردن مدل MLX-VLM (PaddleOCR-VL-1.6) در صورت خاموش بودن
            ensure_mlx_vlm_running()

            if is_server_running():
                send_message({'status': 'already_running', 'running': True, 'message': 'سرور OCR محلی و MLX-VLM هم‌اکنون فعال است.'})
                return

            script_dir = os.path.dirname(os.path.abspath(__file__))
            server_py = os.path.join(script_dir, 'server.py')
            python_bin = sys.executable or 'python3'

            # راه‌اندازی server.py در پس‌زمینه سیستم
            if os.name == 'nt':
                subprocess.Popen([python_bin, server_py], cwd=script_dir, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS)
            else:
                subprocess.Popen([python_bin, server_py], cwd=script_dir, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            send_message({'status': 'started', 'running': True, 'message': 'سرور OCR محلی و MLX-VLM (PaddleOCR-VL-1.6) با موفقیت روی لپ‌تاپ روشن شدند.'})

        elif action == 'stop':
            stop_server()
            send_message({'status': 'stopped', 'running': False, 'message': 'سرور OCR محلی و MLX-VLM با موفقیت خاموش شدند.'})

        else:
            send_message({'error': f'دستور نامشخص: {action}'})

    except Exception as e:
        send_message({'error': str(e)})

if __name__ == '__main__':
    main()
