# TODO

## VM-Based Sandboxing

Run the Claude agent inside an isolated VM so it can only access the target project files — not the host filesystem, secrets, or other repos.

- [ ] **VM provider selection** — evaluate Firecracker microVMs, Docker containers, or WSL2 isolated instances for Windows host compatibility
- [ ] **Per-project VM provisioning** — spin up a lightweight VM on `/fix` or `/feat`, clone only the target repo into it, tear it down after
- [ ] **Shared volume / mount strategy** — mount the project directory read-write into the VM, keep everything else inaccessible
- [ ] **Network isolation** — VM should only reach GitHub API and npm registry, nothing else on the local network
- [ ] **Agent SDK in-VM execution** — run `query()` inside the VM process so all file edits are sandboxed; orchestrator stays on host
- [ ] **Resource limits** — cap CPU, memory, and disk per VM to prevent runaway agents from impacting the host
- [ ] **Cleanup on abort** — `/cancel` should destroy the VM, not just abort the agent process

## Git Identity Separation

Configure commits to appear as a dedicated bot account rather than your personal GitHub identity, so PRs clearly show automated vs human authorship.

- [ ] **Per-project git author config** — set `user.name` and `user.email` to the bot account before committing (e.g. `bot-caden-miller`)
- [ ] **Forking and PR's** — fork off project from origin (may need to provide link), then make a PR, tokens do not work on repos owned by another individual
- [ ] **Co-authored-by trailer** — add `Co-authored-by: Claude <noreply@anthropic.com>` to commit messages for transparency
- [ ] **Branch protection compatibility** — ensure the bot account has push access and PR creation permissions on target repos
- [ ] **Signature verification** — optionally set up GPG signing for the bot account so commits show as "Verified"

## Future Ideas

- [ ] **Multi-VM concurrency** — run agents for different projects simultaneously in separate VMs
- [ ] **Snapshot & restore** — snapshot a VM after dependency install so subsequent runs skip `npm install`
- [ ] **Audit log** — log every agent session (prompt, files changed, cost, duration) to a local SQLite DB
- [ ] **PR review feedback loop** — watch for PR review comments and auto-spawn a follow-up agent session to address them
