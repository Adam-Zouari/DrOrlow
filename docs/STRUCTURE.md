# Project structure audit

Reviewed on 22 October 2026. This is a small, server-rendered static site: plain HTML, CSS and browser JavaScript, served by Express. It does not need a frontend build step.

## Findings and changes

| Finding | Assessment | Resolution |
| --- | --- | --- |
| `app.js` both constructed the app and started it through `runtime.js`, which imported `app.js` again | An avoidable circular startup dependency made the entry point harder to follow | Added `server/index.js` as the executable entry point. `app.js` now only exports the app factory; `runtime.js` handles composition and lifecycle. |
| Backend tests lived in `server/test/`, while browser tests lived directly in `tests/` | The test suite had two different locations and naming conventions | Grouped them under `tests/server/` and `tests/browser/`. Renamed `signup.test.js` to `join.test.js` to match the current submission form. |
| Verification required remembering two commands | Easier to omit one of the checks | Added `npm run verify`, which runs the site checker followed by the full test suite. Both individual commands remain available. |
| Public files, server code, configuration and saved data | The main boundaries are sound | Kept `public/` as the only static directory. `.env`, database files and the owner phrase remain outside it and ignored by Git. |
| Pages and all asset types shared one folder | The flat folder made related files harder to find | Kept HTML pages in `public/` and grouped assets under `public/assets/css/`, `js/`, `images/` and `fonts/`. Updated page, stylesheet and game references. The checker now walks nested folders and resolves each reference relative to its source file. |
| Mixed case and spaces in public filenames | These names are part of the original page URLs | Retained them. The site checker validates exact filename case for Linux hosting. New server and test filenames use lowercase names with hyphens. |
| Unreferenced original files | `public/assets/fonts/Beautiful.otf` and `public/assets/images/larrow.png` have no current references | Retained the original assets. The active font is `Beautiful.ttf`; About uses `rarrow.png` with CSS mirroring. |

No design or page URL changes were needed for these structural fixes.

## Directory map

```text
DrOrlow/
├── public/                  Original HTML pages and their unchanged page URLs
│   ├── Home.html
│   ├── About me.html
│   ├── …other pages
│   └── assets/
│       ├── css/             Shared and page-specific stylesheets
│       ├── js/              Browser scripts
│       ├── images/          Original artwork, backgrounds and icons
│       └── fonts/           Original font files
├── server/
│   ├── index.js             Executable entry point used by npm start and npm run dev
│   ├── runtime.js           Storage, owner secret, app construction and server lifecycle
│   ├── app.js               Express app factory, HTTP routes and middleware
│   ├── config.js            Environment parsing and configuration validation
│   ├── database.js          Storage selection and MySQL repositories
│   ├── sqlite.js            SQLite repositories and automatic local initialization
│   ├── schema.sql           MySQL schema
│   ├── sqlite-schema.sql    SQLite schema
│   ├── setup-db.js          Optional database setup command
│   ├── validation.js        Submitted form validation and normalization
│   ├── super-auth.js        Private sessions, cookies and logout CSRF checks
│   ├── password.js          Secret phrase hashing and verification
│   └── owner-secret.js      First-run phrase generation and private-file handling
├── tests/
│   ├── server/              HTTP, configuration, storage and startup tests
│   └── browser/             Browser-script tests using jsdom
├── scripts/
│   └── check-site.js        Static markup, link, CSS and JavaScript checks
├── docs/                    Audit results and this maintenance guide
├── data/                    Generated private database/phrase files; ignored by Git
├── .env                     Optional private local settings; ignored by Git
├── .env.example             Safe configuration template
├── package.json             Dependencies and supported commands
└── package-lock.json        Reproducible dependency versions
```

`node_modules/` is installed by npm and ignored by Git. The `data/` directory is created when needed. With MySQL selected and an explicit owner phrase, neither a local SQLite file nor a generated phrase file is required.

## Code boundaries

The startup flow is `index.js` → `runtime.js` → `app.js`. Importing `app.js` builds no listener, opens no database and generates no secret. This lets HTTP tests inject repositories without depending on either database engine.

`runtime.js` selects storage through `database.js`, resolves the owner phrase, and passes those dependencies to the app. It also owns shutdown and closes storage. The app handles HTTP; it does not open database connections.

Both database adapters expose a submission writer, an inbox reader and a close operation. SQLite is the default. MySQL requires `DB_CLIENT=mysql` and its connection settings. A database change selects a separate store; it does not migrate existing forms.

Only `public/` is sent through Express static middleware. The Super Orlow HTML and JavaScript are public client code; authentication protects the inbox API and its data. The secret phrase and saved forms belong in private storage.

HTML and game-generated images use root-relative `/assets/...` URLs so assets also load through the `/super-orlow` route, including its trailing-slash form. CSS references use `../images/` and `../fonts/`, relative to the stylesheet's own location. Asset filenames and binary contents are preserved.

## Where to make changes

| Feature | Main files |
| --- | --- |
| Shared theme, layout, bubbles and typography | `public/assets/css/common.css`, `public/assets/js/ambient.js` |
| Home and the secret bubble | `public/Home.html`, `public/assets/css/Home.css`, `public/assets/js/home.js` |
| About and scroll reveals | `public/About me.html`, `public/assets/css/About me.css`, `public/assets/js/about.js` |
| Policy story | `public/policy.html`, `public/assets/css/policy.css`, `public/assets/js/policy.js` |
| Conversation | `public/let_s talk.html`, `public/assets/css/let_s talk.css`, `public/assets/js/talk.js` |
| Catch game and win page | `public/let_s play.html`, `public/assets/css/let_s play.css`, `public/assets/js/play.js`, `public/Congrats.html`, `public/assets/css/Congrats.css` |
| Submission form | `public/join me.html`, `public/assets/css/Join me.css`, `public/assets/js/join.js`, `server/validation.js` |
| Private inbox and games | `public/Super Orlow.html`, `public/assets/css/super-orlow.css`, `public/assets/js/super-orlow.js`, `server/super-auth.js` |
| HTTP/API behavior | `server/app.js`, corresponding tests in `tests/server/` |
| Persistent form fields | Both SQL schemas, both database adapters, validation and the form/inbox UI |

Run `npm run verify` after a change. Use `npm start` to run the application, or `npm run dev` for automatic restarts when server code changes. See [the README](../README.md) for configuration and [the functional audit](AUDIT.md) for security and verification details.

## Future considerations

- The checker follows HTML and CSS references recursively. The memory game's artwork paths are created in `public/assets/js/super-orlow.js`; browser-script tests verify that these generated paths point to real files in `assets/images/`. These tests do not perform layout.
- `database.js` contains both storage selection and the MySQL adapter. At its current size this is readable; a dedicated adapters directory would become useful if more engines or substantially larger repositories are added.
- Headers and footers are repeated across the eight HTML pages. Keep them synchronized when changing navigation. A shared template would become useful if page count or navigation complexity grows.
- SQLite schema initialization is additive and preserves existing records. Future changes to existing columns will need an explicit, versioned migration plan for both engines.

The browser tests simulate DOM behavior. Actual desktop/mobile rendering remains a separate review, as recorded in the functional audit.
