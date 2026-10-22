# Dr Orlow

A friendly octopus website with encouraging conversations, a catch game, a playful button story, a contact form, and a secret Super Orlow room. The original purple, black and cream colors, handwriting font, artwork and original page URLs are preserved.

The frontend is plain HTML, CSS and JavaScript. Express serves the site. SQLite stores forms automatically for a fresh local copy; MySQL is also supported. There is no frontend build step.

See the [project structure audit and file guide](docs/STRUCTURE.md) for the directory map, code boundaries and where to make changes. The executable entry point is `server/index.js`; `server/app.js` exports the testable Express app factory.

HTML pages stay directly in `public/`. Stylesheets, browser scripts, images and fonts are grouped under `public/assets/css/`, `public/assets/js/`, `public/assets/images/` and `public/assets/fonts/`.

## Run locally

Requires Node.js 22.14 or newer.

```sh
npm install
npm start
```

For a fresh copy, open **http://127.0.0.1:3000**. No `.env`, MySQL installation, account creation or manual database setup is required. Startup creates `data/drorlow.sqlite` and the tables, plus a private `data/super-orlow.secret` file with the owner's secret phrase. Forms and the phrase survive restarts. Keep the `data/` directory to retain saved forms; it is ignored by Git and is not served to browsers.

This checkout's existing ignored `.env` explicitly sets `DB_CLIENT=mysql` and uses **http://127.0.0.1:3002**. Existing MySQL data is preserved. Use `npm run dev` to restart the server when its code changes. Restart after changing `.env` too.

## Public pages

- Home fits its header, welcome, activities and footer to the available viewport. Sizing uses relative units and viewport-aware limits.
- About me reveals its text, family images and arrows gently as they enter view. Reduced-motion preferences keep content immediately visible.
- Policy keeps Orlow and the apology scene inside the available stage. The ending returns home.
- Catch Dr Orlow uses independently drifting octopuses and three winning targets. Keyboard users can focus a target to hold it still and press P within the game to pause.
- Join me is a form, without account creation, identifiers or passwords. Supported fields are saved to `form_submissions`; the enhanced form shows confirmation in place. Native submission returns to `Home.html?submitted=1`.

Bubbles drift across the viewport behind content, within a clipped background layer. Their transforms do not enlarge the document or intercept clicks. They pause in hidden tabs and are disabled with reduced motion.

## Super Orlow

One of the **bubbles rising along Home's left edge** is the secret entrance. It stops while hovered and stays still when focused with the keyboard. With reduced motion it remains a stationary bubble. The direct route is `/super-orlow`.

Unlock it with the phrase from `data/super-orlow.secret`, created automatically on first startup. Startup prints its file path, without printing the phrase. If `SUPER_ORLOW_PASSWORD` is configured in `.env`, that phrase takes precedence and no secret file is generated. The room contains a paginated inbox with complete form details, an octopus memory game and a five-round reaction game.

The login uses a compact viewport layout; the unlocked room scrolls normally for long letters and games. Refresh letters updates the inbox in place, retaining the selected letter when it is still available and preserving the current scroll position as far as the new content height permits. Existing letters remain visible during loading or a temporary connection error; expired sessions still clear private content immediately.

The hidden entrance is a visual easter egg; the inbox is protected by server authentication. Sessions use opaque HttpOnly SameSite Strict cookies, expire after 12 hours, and are invalidated by logout or server restart. Logging out immediately clears private form data from the page. The application does not store submissions, passwords or session tokens in browser storage.

## Database configuration

Visitors to a hosted website need only a browser. The Node server and its database run on the host; submissions from all visitors go to that shared database. A separate local copy uses its own SQLite file automatically, so forms, the inbox and both secret games work without MySQL.

The secret room is already part of the application source, rather than something created on a visitor's computer. Opening its bubble loads the page; the server checks the owner's secret phrase and grants a private session before allowing access to submitted forms.

Storage selection is explicit and predictable:

- No `DB_CLIENT` setting: SQLite, created automatically at `data/drorlow.sqlite`, even when old MySQL settings remain.
- `DB_CLIENT=sqlite`: explicitly use the default SQLite store.
- `DB_CLIENT=mysql`: use the MySQL adapter and require `DB_HOST`, `DB_USER` and `DB_NAME`. A MySQL outage returns an error; it never silently switches to a different store.

Use `SQLITE_PATH` to choose another private file location. Keep it outside `public/`. SQLite uses Node's built-in `node:sqlite` module, which is experimental in Node 22.14; there is no extra database package or installer. See the [Node SQLite documentation](https://nodejs.org/download/release/v22.14.0/docs/api/sqlite.html).

The existing local `DrOrlowDB` uses separate MySQL accounts: the public form's account can INSERT into `form_submissions`, and Super Orlow's reader can SELECT from that table. Their credentials and the configured secret phrase remain in the ignored `.env`.

For an optional MySQL installation:

1. Create a MySQL database and apply `server/schema.sql` using a setup account in Workbench or the MySQL client. Alternatively, configure that setup account temporarily and run `npm run db:setup`.
2. Create a runtime account with INSERT permission on `form_submissions`, and a separate reader account with SELECT permission on that table. The setup account needs CREATE; the application accounts do not.
3. Copy `.env.example` to `.env` and set `DB_CLIENT=mysql`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ADMIN_USER` and `DB_ADMIN_PASSWORD`. Optionally configure a `SUPER_ORLOW_PASSWORD` of 20 to 256 characters; otherwise the owner phrase file is generated automatically.
4. Restart the server. `/health` reports whether submissions are configured; it does not check database connectivity.

`npm run db:setup` also supports SQLite, although normal startup already creates its schema. For either database, setup preserves existing records and tables. Switching engines selects a separate store and does not automatically copy forms between MySQL and SQLite. Public visitors submit forms without creating accounts.

## Verification

```sh
npm run verify
```

This runs `npm run check` followed by `npm test`. The two commands can also be run independently. Server tests live in `tests/server/`; browser-script tests live in `tests/browser/`.

The checker recursively validates local links and exact asset filename case, resolves CSS references relative to each stylesheet, and checks metadata, labels, accessibility references, strict-CSP-compatible markup, relative CSS units and JavaScript syntax. Tests exercise form validation and recovery, private authentication and session lifecycle, escaped form rendering, pagination, conversations, games, reduced motion, scroll reveals and animation lifecycle.

The code audit also covers edits during form submission, malformed and late responses, bounded network requests, browser page restoration, authentication races and animation fallbacks. Unchanged submissions clear the form on success; edits made while sending remain as a new draft. See [the audit and cleanup findings](docs/AUDIT.md#code-audit-and-cleanup).

The suite includes real file-backed SQLite tests: fresh startup without MySQL, form persistence and owner phrase reuse across restarts, inbox authentication, pagination, path protection and failed/corrupt storage behavior. HTTP unit tests also use an injected repository. A separate live MySQL check verified form persistence, protected inbox reading, pagination, wrong-password rejection, logout CSRF checks and session invalidation, then removed the temporary verification row.

Browser rendering still needs review on desktop and mobile because no connected browser was available. See [the audit](docs/AUDIT.md).

## Deployment

Run `npm ci --omit=dev` and `npm start` on a Node host with persistent storage for SQLite or with MySQL configured. Back up the selected database and retain the owner phrase. Use HTTPS, configure `SITE_ORIGIN` to the exact public origin, and set `TRUST_PROXY_HOPS` to the actual trusted reverse proxy hop count when appropriate. Set `HOST=0.0.0.0` only when the host requires it.

Only `public/` is served. Keep `.env` private. The strict content security policy permits local scripts and styles without inline code. HTML, CSS and JavaScript revalidate when fetched so updates are not held behind an hour-long asset cache.

Submission and login attempt limits and private sessions are held in process memory. Multiple server instances need shared limiting and session storage. Restarting the server signs the owner out.
