## Summary

<!-- What does this change, and why? One or two sentences. -->

## Related issues and specs

<!-- "Closes #123". For work from a spec, name the task and requirement, for example T123 and FR-045
     from specs/<feature>/tasks.md. -->

## How it was tested

<!-- Which checks you ran (see CONTRIBUTING.md, "Check your change") and anything you tried by hand. -->

- [ ] `pnpm verify` passes (type-check, lint, unit and property tests)
- [ ] For domain, crypto and sync code: the failing test was committed before the implementation
- [ ] For user interface changes: checked with the keyboard, in a right-to-left layout and for accessibility

## Documentation

- [ ] User-facing behaviour changed, and the docs are updated (or there is nothing to update)
- [ ] Generated files are regenerated (`docs/protocol.md`, `THIRD_PARTY_NOTICES.md`, migrations), if affected

## Threat-model note

<!-- MANDATORY for changes to cryptography, authentication, sync or sharing: append a note to
     docs/threat-model.md and say here what new asset, trust boundary or attacker capability this
     touches. Changes to cryptography, the protocol or a wire format also need an ADR and an update to
     docs/ARCHITECTURE.md. Write "n/a" otherwise. -->

## Release impact

<!-- The title of this pull request is the commit that lands on main, and it decides the next version
     (CONTRIBUTING.md, "How a change becomes a release"): feat = minor, fix and perf = patch, ! or
     BREAKING CHANGE = major; docs, chore, test, ci, build, style and refactor make no release.
     Is the title right for what this changes for the people who run the app? -->

## Checklist

- [ ] The title follows Conventional Commits and has no AI-tool attribution
- [ ] The change is small and has one purpose
