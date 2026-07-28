# Legacy: Windows desktop installer

This directory builds `ComponentDocSpecStudio-Setup.exe`, the installer for the
old single-user Windows desktop build of this app.

The current deployment path is hosted (see [`../Dockerfile`](../Dockerfile)
and the root [`README.md`](../README.md)), which supports multiple
signed-in users against per-session workspaces instead of one local
checkout. This installer/exe pipeline is kept working only in case a
desktop build is still wanted - it is not how the app is deployed today.
