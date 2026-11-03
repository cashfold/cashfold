## Summary

<!-- What does this change, and why? Link the issue it closes (Closes #123) if there is one. -->

## Problem

<!-- What goes wrong, or what is missing, today? Skip for a small docs or chore change. -->

## Fix

<!-- How does this change solve it? Say what you chose not to do, and any twin you left alone (see CLAUDE.md "Find the twin"). -->

## Screenshots

<!-- For a change people can see. Show light and dark, and a narrow screen. Delete the table if nothing visible changed. -->

| Before | After |
| ------ | ----- |
|        |       |

## How it was tested

<!-- Which checks you ran (see CONTRIBUTING.md) and anything you tried by hand. -->

## Checklist

Tick what applies and leave a short note for anything you skipped. The title must be a
[Conventional Commit](https://www.conventionalcommits.org/): it becomes the commit on `main` and decides the release.

- [ ] The pull request has one purpose
- [ ] `pnpm verify` passes, and I ran the checks that fit the change (browser tests, `pnpm test:e2e`, `pnpm build`)
- [ ] Nothing readable leaves the device: no content, key or secret in a log, URL, error or request
- [ ] Money is `bigint` in minor units; no `number` or floating point
- [ ] Text comes from the message catalogues in English, Ukrainian and Polish
- [ ] Works with the keyboard, in right-to-left layout and with long text
- [ ] The related places that must change together are updated, or listed above
- [ ] Generated files are regenerated (`CLAUDE.md` lists them) and the documentation is updated
- [ ] A change to an operation or payload schema has an upcaster and a replay test
