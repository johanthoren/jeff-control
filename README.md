# jeff-control

A Rust projection daemon for [jeff](https://github.com/johanthoren/jeff).
It watches registered projects and serves task snapshots and live updates over
a local Unix socket. The repository also contains graph layout and viewport
libraries. The interactive graph client was not shipped.

## Status

Development is paused indefinitely. I built this alongside Jeff, which served
me exceptionally well as part of the tooling I used to make software. With
[pstack](https://github.com/cursor/plugins/tree/main/pstack), that part of my
setup is good enough for me to leave it alone and focus on making things.

The daemon, libraries, and design record remain available for use and study.
There is no commitment to compatibility updates or to finishing the client.
The [Jeff README](https://github.com/johanthoren/jeff#status) records the broader
lineage and why I moved on.

## What is implemented

- **`jeffd`** watches projects, invokes their installed `cook snapshot --json`,
  and serves JSON requests and subscription events over a Unix socket.
  `jeffd start` runs in the foreground; `jeffd status` checks the running
  daemon; `jeffd stop` requests shutdown.
  [Daemon contracts](jeffd/tests/daemon.rs) exercise real sockets,
  filesystem events, process lifecycle, and resource limits.
- **`jeff-project`** defines the project registry and per-project configuration.
  Its [contracts](jeff-project/tests/contracts.rs) cover snapshot compatibility
  and protocol messages.
- **`jeff-graph`** contains graph topology, cached layout, viewport math, and a
  canvas widget. Its [contracts](jeff-graph/tests/contracts.rs) exercise those
  components without an interactive application.
- **`jeff`** prints help and exits. There is no working `jeff graph` command.
  The planned zoom, pan, selection, completed-task toggle, and claim-badge
  interactions are not connected to a client.

## Build and check

Use the Rust toolchain pinned in [`rust-toolchain.toml`](rust-toolchain.toml).
The daemon targets Unix systems. This snapshot was verified on Linux x86_64
with Rust 1.98.0 and Node.js 24.20.0; other Unix platforms were not reverified.
The demonstration also needs Git. The CI workflow repeats the build, serial
suite, and demonstration on Linux.

```sh
cargo build --workspace --locked
cargo test --workspace --locked -- --test-threads=1
```

The serial test command is the reference invocation for the daemon's real
socket and filesystem tests. Keep the resource-limit and backpressure contracts
in the run; they are part of what the daemon promises.

## Run the daemon example

The example uses the real Jeff 6.7.0 projection command. From this repository,
obtain that version in a sibling checkout if you do not already have it:

```sh
git clone --branch 6.7.0 --depth 1 https://github.com/johanthoren/jeff.git ../jeff-6.7.0
node scripts/demo.mjs ../jeff-6.7.0/src/cli/cook.js
```

You can pass another checkout's `src/cli/cook.js` path instead. The checked
projection command uses Node's standard library and does not require an npm
install or an agent account.

The example creates a synthetic task in a temporary project, starts the daemon
with an isolated home directory and socket, reads a snapshot, and subscribes
to updates. It changes the example task and checks that the replacement
snapshot contains the change. It then stops the daemon and checks shutdown
and cleanup. The example does not register or modify your projects.

[`scripts/demo.mjs`](scripts/demo.mjs) is also run by
[CI](.github/workflows/ci.yml), against a pinned Jeff commit. It demonstrates
the daemon protocol, not the unfinished TUI or a full agent workflow.

## Why it lives apart

Jeff ships as a Node plugin for coding agents. Its package never carried this
Rust workspace. The two communicate through a versioned projection protocol.
`jeffd` asks each project's installed `cook snapshot --json` to read the ledger;
it does not parse `.jeff` task files itself.

This keeps ledger-schema knowledge in Jeff. Projects can use different Jeff
versions while their snapshot schemas remain within the daemon's supported
range. The daemon supports snapshot schema version 1 and socket protocol
version 1. It does not promise compatibility with future schema changes.

The Unix socket is local and owner-only. Filesystem permissions control access;
the daemon does not expose a browser-facing HTTP API. This is a local tool for
a trusted operator, not a sandbox for hostile agents.

## Design record

These documents preserve the decisions and implementation plans from the
control-plane track. They include work that was never built. Their phase names,
future tense, and original repository paths describe that historical plan;
they are not an active roadmap. Use the implemented behavior above and the
executable contracts to determine what this checkout provides.

- [`docs/control-plane-vision.md`](docs/control-plane-vision.md) records the
  product vision, terminal-client feasibility survey, runtime boundaries,
  phases, and architecture review.
- [`docs/jeff-graph-p1a.md`](docs/jeff-graph-p1a.md) specifies the daemon protocol,
  projection and cache behavior, and the unshipped standalone graph client.
- [`docs/control-plane-handoff.md`](docs/control-plane-handoff.md) preserves
  the implementation handoff and its original constraints.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
