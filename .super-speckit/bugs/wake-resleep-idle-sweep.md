# BUG: manually woken computer is re-slept within one reconciler tick

Found live 2026-10-11 (review stack, docker sandbox). Wake via UI → container starts → within
~6-30s the coding-session idle sweep stops it and marks suspended again: the user watches the
screen die under them.

Path: reconcileIdleCodingSessions (job-reconciler.ts ~373-408, 30s tick in api AND worker) →
checkIdle (coding-session-service.ts ~672-702, per-session idleThresholdMinutes default 30 vs
lastActivityAt) → sleepComputerIfIdle (computer-idle.ts ~186+, guards only state==="running").
No minimum-awake guard; user wake intent is not recorded as activity; SANDBOX_IDLE_MS is a
different, divergent knob (only feeds scheduleComputerSleep).

Fix shape: record wake time on boot; skip computers awake < idle threshold; and/or count explicit
user wake/interaction as activity. Workaround used: raise idleThresholdMinutes on active sessions.
