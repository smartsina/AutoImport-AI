#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_EXEC="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
if [ ! -f "$PYTHON_EXEC" ]; then
    PYTHON_EXEC="$(which python3)"
fi
exec "$PYTHON_EXEC" "$DIR/native_launcher.py" "$@"
