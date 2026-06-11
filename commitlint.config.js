// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

// commitlint.config.js — Conventional Commits enforcement
// https://commitlint.js.org/

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // Nová funkcionalita
        'fix', // Oprava chyby
        'docs', // Zmeny v dokumentácii
        'style', // Formátovanie, bodkočiarky, atď. (žiadna zmena kódu)
        'refactor', // Refaktoring (žiadna nová funkcia, žiadna oprava)
        'perf', // Vylepšenie výkonu
        'test', // Pridanie/úprava testov
        'build', // Build system, externé závislosti
        'ci', // CI/CD konfigurácia
        'chore', // Údržba, ostatné
        'revert', // Revert predchádzajúceho commitu
      ],
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    // Zvýšené z default 100 na 200 lebo dependabot generuje commit body
    // s release notes URL-ami ktoré bývajú dlhšie ako 100 znakov,
    // napr.: "Bumps [eslint-config-prettier](https://github.com/prettier/...".
    // 200 znakov je dost na bežné človekom písané body riadky
    // a zároveň akceptuje strojovo generované dependabot URL paste.
    'body-max-line-length': [2, 'always', 200],
  },
};
