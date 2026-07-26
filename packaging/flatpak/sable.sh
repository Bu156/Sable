#!/bin/sh
# zypak lets CEF's sandbox work under Flatpak without a setuid chrome-sandbox.
exec zypak-wrapper /app/sable/sable "$@"
