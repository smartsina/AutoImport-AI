import urllib.request, json
try:
    health = urllib.request.urlopen("http://127.0.0.1:5151/health").read()
    print("Health:", health.decode('utf-8'))
except Exception as e:
    print("Server not running:", e)
