// camera-health-sweep miss guard. Loads the guarded sweep pinned below.
// One retry, a 5 second cellular connect timeout, a 60 second shard deadline,
// an overlap lock, and a mass-failure guard. Do not deploy until the 3-miss
// readers are live and this patch has been reviewed.
// Rollback: pin camera-health-sweep back to v101.
import "https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/d08dd4a9c03da76e251cc9da3b50750c75331f56/tech-checks/docs/camera-health-sweep-endpoint-retry-20261110/source/index.ts";
