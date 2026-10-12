# BUG: omp auto-launch (T41/R13/V23) does not reach the docker sandbox terminal

Found live 2026-10-11. codingSessions.terminalUrl passes launchCommand:"omp", but only
ProcessSandboxProvider's node-pty spawner seam applies it. The docker provider's terminal is a
supervisor-proxied PTY (novnc/session/control path) — launchCommand is ignored there, and omp is
not installed in rakazo/computer:local at all (`which omp` → exit 1 in a real bash).

Fix shape: (1) install the omp engine binary into the computer image (or provision it per
workspace at session start); (2) plumb the launch command through the supervisor terminal
handshake (or have the api send a bootstrap command as the first authorized input on attach).
Until then V23 stays blocked on docker; process-provider path is unit-tested.
