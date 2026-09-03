# jeff-control

A local projection daemon and terminal graph client for
[jeff](https://github.com/johanthoren/jeff), a quality control plane for
agentic software work.

Jeff records task state as plain files in a project's `.jeff/` ledger. This
repository holds the Rust that reads those projections and draws them: a
long-lived daemon that watches registered projects, and the layout and
viewport code for a task-DAG view of what each one is doing.

## Why it lives apart

Jeff ships as a Node plugin for coding agents and never carried this Rust in
its published package. The two are related by protocol, not by build: `jeffd`
never parses a ledger itself. Every read goes through the project's own
installed `cook snapshot --json`. That constraint keeps schema knowledge in
one place and makes the daemon immune to per-project version skew, which is
also what makes the split clean.

## State

The daemon is finished. The client is not.

| Crate | Lines (src / tests) | State |
|---|---|---|
| `jeffd` | 3,851 / 6,744 | Complete. Unix socket server, JSON request and event protocol, project registry, filesystem watch with debounce, snapshot invocation, lifecycle management. |
| `jeff-graph` | 792 / 489 | Library complete. Viewport math, layout pipeline with caching, canvas widget, topology model with selection and degradation handling. |
| `jeff-project` | 344 / 424 | Complete. Registry and per-project configuration types. |
| `jeff` | 21 / 75 | Stub. Prints help and exits. |

The gap is deliberate about where it stopped, not hidden: `jeff-graph` has
the components a task-DAG TUI needs, and nothing drives them. The `jeff`
binary was specified to stay help-only until the client shipped, and the
client never did. Zoom, pan, mouse and keyboard selection, the completed-task
toggle, and claim badges were all specified and never built.

What works today is `jeffd start`, `jeffd status`, and `jeffd stop`, serving
live graph projections over a Unix domain socket to any client that speaks
the protocol.

## Build

```sh
cargo test --locked -- --test-threads=1
```

The daemon suite runs single-threaded because it binds real sockets and
watches real directories. Two backpressure tests
(`task_236_council_contract_*`) are sensitive to host socket buffer limits
and can fail outside CI.

## Design record

The specs are the reason to read this repository. They were written as
cold-context contracts, meaning any implementer with the repository and the
document needs no conversation history to continue.

- [`docs/control-plane-vision.md`](docs/control-plane-vision.md): the product
  vision, locked decisions, TUI feasibility survey, runtime and coexistence,
  invariants, phases, and an architecture review.
- [`docs/jeff-graph-p1a.md`](docs/jeff-graph-p1a.md): the phase design for the
  standalone graph client, including socket protocol, invocation contract,
  projection and cache behavior, viewport math, and mechanical acceptance
  checks.
- [`docs/control-plane-handoff.md`](docs/control-plane-handoff.md): the
  implementation brief handing the work from one model to another.

Two decisions in there carry most of the weight. The client is a terminal
application rather than a browser one, because a localhost HTTP API is a
forged-grant surface while a Unix socket reduces authorization to file
permissions. And the daemon delegates all ledger access to `cook`, which is
what allows one daemon to watch projects running different versions of jeff.

## Status

Not under active development. Jeff itself is stable and no longer being
extended, and this client stopped when that did. The code builds, the daemon
works, and the specs describe what a finished client would do.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
