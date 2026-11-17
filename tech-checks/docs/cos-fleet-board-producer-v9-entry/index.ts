// Dedicated worker for the durable Fleet board batch. Same recorded handler and
// the same caller authorization as cos-operations-pages; it only ever serves
// POST /api/fleet-saved-board/produce for a claimed lease.
// Merged PR #374: a declined source is asked once, not three times.
import "https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/b5b188229346182d9a4e29da42415a1b9d3b9d53/tech-checks/docs/vision-native-preview-20261107/source/serve.ts";
