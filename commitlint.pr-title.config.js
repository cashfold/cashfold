// The rules for the title of a pull request, which becomes the commit on `main` when it is squash-merged (.github/workflows/pr-title.yml).
// They are the same as the commit hook's (commitlint.config.js), except for the length of the first line, which is a warning here and an error
// there: what release-please reads is the type, the scope and the `!`, not the length, and titles that people and Dependabot write do run past 100
// characters ("chore(deps): bump postcss from 8.5.30 to 8.5.32 in /apps/web in the tailwind group across 1 directory" is 101).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: { 'header-max-length': [1, 'always', 120] },
};
