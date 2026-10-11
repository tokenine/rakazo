# BUG (FIXED): computer entrypoint crashed when the container uid has no passwd entry

Found live 2026-10-11: on hosts that map their own uid:gid into the container (supervisor
hostComputerUser), dbus-launch fails ("Could not get password database information for UID") and
start.sh's set -u crashed the computer on the unbound DBUS_SESSION_BUS_ADDRESS — every boot on
this docker host died for 6+ hours. Fixed a43ab1b2: dbus-launch failure now degrades to a logged
warning and the computer boots. Image rebuilt; boot verified live (container exits 0 only on
graceful stop).
