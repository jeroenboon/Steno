// Local secret scan — the same gitleaks check CI runs, for validating before a
// push. gitleaks is a standalone Go binary (not an npm dep), so this wrapper
// runs it when present and otherwise prints an install hint and fails loudly.
// It never silently passes: a secret scan that scans nothing is worse than none.
//
// CI still runs gitleaks + GitHub's native secret scanning regardless; this is
// only so a developer can reproduce that gate locally.
import { spawnSync } from 'node:child_process'

function hasGitleaks() {
  const probe = spawnSync('gitleaks', ['version'], { stdio: 'ignore', shell: false })
  return probe.status === 0
}

if (!hasGitleaks()) {
  console.error(
    [
      'gitleaks is not installed — cannot run the local secret scan.',
      '',
      'Install it (pick one):',
      '  winget install gitleaks',
      '  scoop install gitleaks',
      '  choco install gitleaks',
      '',
      'CI runs this scan on every PR regardless, so this only blocks the',
      'optional local `npm run secret-scan`, not your push.',
    ].join('\n'),
  )
  process.exit(1)
}

// Scan the full git history, redacting any match so the finding itself never
// leaks into terminal output or logs.
const result = spawnSync('gitleaks', ['git', '.', '--redact', '-v'], {
  stdio: 'inherit',
  shell: false,
})
process.exit(result.status ?? 1)
