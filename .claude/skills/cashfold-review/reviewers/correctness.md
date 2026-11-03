# Correctness and root cause

**Scope:** all changed source, excluding tests.

Follow `_contract.md`.

- **Does it do what was asked, for the realistic inputs?** Walk the changed code with an empty value,
  a very large value, a negative value, a second device editing the same record, an offline start,
  and a reordered or repeated operation. Local-first code is judged by what happens when the network
  and the order of events are not on its side.
- **Root cause, not symptom.** A fix that hides the failure at the screen while the stored data or the
  merge is still wrong is a `blocker`. Ask where the bad value came from.
- **Merge and replay.** A projection is a pure function of the set of operations. Anything that depends
  on arrival order, the wall clock, or randomness inside `apply` or a projection is a `blocker`.
- **Dates and time.** `LocalDate` and a time zone offset are stored separately on purpose. Look for code
  that builds a day from a timestamp in the viewer's zone, and for daylight-saving assumptions.
- **Resource and lifecycle.** Workers, locks, subscriptions and timers are released; a lock or sign-out
  does not leave a decrypted value behind.
- **Errors.** Expected failures in `core` are a `Result` with a stable code; nothing swallows an error
  silently or turns it into a vague message.
- **Dead and half-done code.** Unused exports, commented-out blocks, a TODO with no owner.
