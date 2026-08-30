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
            if is_server_running():
                send_message({'status': 'already_running', 'running': True, 'message': 'سرور OCR محلی هم‌اکنون فعال است.'})
                return

            script_dir = os.path.dirname(os.path.abspath(__file__))
            server_py = os.path.join(script_dir, 'server.py')
            python_bin = sys.executable or 'python3'

            # راه‌اندازی server.py در پس‌زمینه سیستم
            if os.name == 'nt':
                subprocess.Popen([python_bin, server_py], cwd=script_dir, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS)
            else:
                subprocess.Popen([python_bin, server_py], cwd=script_dir, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            send_message({'status': 'started', 'running': True, 'message': 'سرور OCR محلی با موفقیت روی لپ‌تاپ روشن شد.'})

        else:
            send_message({'error': f'دستور نامشخص: {action}'})

    except Exception as e:
        send_message({'error': str(e)})

if __name__ == '__main__':
    main()
