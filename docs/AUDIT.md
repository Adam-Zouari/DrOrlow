# Dr Orlow audit and updates

Reviewed on 22 October 2026. Scope includes the original seven pages, shared styling, interactive scripts, Express, SQLite/MySQL persistence, and the new Super Orlow room. No public deployment was made.

## Current behavior

The original image and font files are unchanged. The purple background, black header/footer, cream links, handwriting, octopus characters, bubbles, family story, conversations and playful Policy page remain.

HTML pages retain their original locations and URLs. Stylesheets, browser scripts, images and fonts now live in `public/assets/css/`, `js/`, `images/` and `fonts/`. All HTML, CSS, generated game-image and server error-page references use the new paths. The checker scans nested folders and resolves references from their containing files; tests also verify HTTP serving for each asset type and the memory game's generated image paths.

All CSS dimensions use relative units rather than fixed pixel sizing. Home, Policy, Catch Dr Orlow and the win page use a viewport grid with a bounded content area between the header and footer. Policy images contain themselves within the scene. Extremely short Policy/game viewports permit scrolling to keep enlarged text reachable.

About me is intentionally a longer page. Text and content images reveal once as they enter view using IntersectionObserver; images use an opacity-only fade to preserve mirrored and rotated arrows. Unsupported browsers and reduced-motion settings keep content visible. Bubbles use a clipped fixed background layer across the viewport, with transform/opacity animations and hidden-tab pausing. Their negative stacking layer inside the isolated body stays behind page content and ignores pointer events.

Public visitors fill out a form without signing up. Identifier and password fields were removed. Valid submissions are saved to `form_submissions`, with an in-place success message or native POST redirect. An existing `users` table is preserved.

The Super Orlow entrance is one of the bubbles along Home's left edge. It is a native link outside the decorative aria-hidden layer, stays clear of text, pauses on hover and remains stationary for keyboard focus and reduced motion. The logo is back at the header's right edge. Policy's footer omits its own page link. An owner phrase unlocks the inbox and two games: memory matching and reaction timing. It is read from `SUPER_ORLOW_PASSWORD` when configured, or automatically generated and retained in a private local file.

The locked secret room uses a compact viewport grid with a smaller responsive login card. The unlocked room retains natural scrolling. Short viewports and enlarged text can still scroll to keep controls reachable. Refreshing letters leaves current content in place during the request, preserves the selected form by ID when available, and restores the scroll position captured immediately before rendering the response. New content that is shorter than the current scroll offset is bounded by the browser's normal scroll limit. Authentication expiry and logout still clear all private letters.

## Backend and private data

- Environment-based MySQL credentials; separate INSERT-only submission writer and SELECT-only private reader. SQLite uses a separate read-only inbox connection and private local storage files.
- Server-side type, length, email, real-date and listed-option validation.
- Parameterized SQL; bounded request bodies; safe error responses without submitted personal data.
- Strict CSP, safe static serving, same-origin checks, and per-IP submission/login attempt limits.
- Salted scrypt/timing-safe secret phrase verification.
- Cryptographically random session cookies with HttpOnly and SameSite Strict, 12-hour expiry, session rotation and logout revocation. Cookie Secure is enabled with HTTPS.
- CSRF token checks for logout, no-store private API responses, escaped DOM rendering, no private data in browser storage, and private DOM clearing on logout.
- Sessions and request limits are bounded in memory and local to one server instance.

## Code audit and cleanup

Reviewed the complete server, browser scripts, HTML/CSS, schemas, verification script, tests and dependencies, then reviewed the fixes again. The cleanup preserves existing page URLs, form fields, database selection, artwork and intended interactions.

| Problem found | Fix |
| --- | --- |
| A successful form request could erase edits made while it was pending; late errors could flag values already corrected | Compare submitted and current values, preserve a new draft, and apply errors only to unchanged fields. |
| Malformed responses and stale form requests could reset data or leave controls busy | Validate responses before resetting, identify the active request, recover after a timeout even without AbortController, and invalidate pending work when leaving the page. |
| A form left open overnight could retain an old birthday maximum | Refresh the date bound on focus, submission and page restoration. |
| Secret-room network requests had no time limit, and malformed inbox data could clear valid letters | Add bounded requests, validate the response contract before rendering, and keep existing content on errors. Empty pages jump to the last available page. |
| Login/logout and browser page restoration could race, reopen hidden content, or lose a failed logout retry | Serialize authentication changes, recheck a restored login when needed, cancel queued restores on every departure, and preserve logout retries while clearing private letters. |
| About's percentage observer margin could leave no visible observation region in a wide, short window | Use the native viewport observation defaults; retain text/image fades and support legacy motion-preference listeners. |
| The catch game assumed animation APIs and did not explicitly pause in hidden tabs | Keep native, static catch links as the fallback, support legacy motion listeners, and pause hidden tabs without losing the player's pause choice. Ambient animation also synchronizes page departure/restoration. |
| Unsupported request encodings were reported as server errors; API error formatting disagreed with case-insensitive routing | Preserve safe client error status codes and use consistent JSON errors for API paths. |
| Concurrent runtime cleanup callers could return before storage had closed | Return the same cleanup promise to every caller. |
| A restored owner phrase could have broad file permissions | Bound and validate the retained file through its open handle, check file identity, and tighten broad POSIX permissions without rewriting the phrase. Already-private read-only files remain usable. |
| Repeated and unused implementation code | Remove 25 duplicate/unused CSS declarations and two obsolete input selector branches; share background artwork, clipping and noscript styles, path containment, grouped form-control lookups, and letter naming/clearing/index logic. Remove unused validation options and redundant checks. |

The HTML/CSS cleanup compared 28 computed properties on 32 affected elements across eight pages with no differences in the supported jsdom results. Runtime-generated classes, media rules, animations and the secret entrance were reviewed separately in source. No original assets, database records or private settings were removed. Dependency auditing reported zero known vulnerabilities.

## Local database verification

SQLite is now the default unless `DB_CLIENT=mysql` explicitly selects the retained MySQL adapter. Startup creates the private directory, database and schema without `.env`, MySQL credentials or manual database setup. Retained MySQL fields are ignored in SQLite mode. The existing local `.env` was marked `DB_CLIENT=mysql` to preserve access to its current forms. A configured MySQL outage never silently switches stores.

The SQLite database defaults to `data/drorlow.sqlite`. The generated owner phrase defaults to `data/super-orlow.secret`, with atomic publication, no overwrite on restart, restrictive file permissions where supported, and no secret contents in startup output. Explicit owner phrases are used without copying them into generated files. Invalid retained secrets and corrupt databases fail without resetting stored data. Storage and secret paths inside `public/` are rejected, including resolved directory links.

A fresh CLI startup from an isolated directory with no `.env` selected SQLite, generated the owner phrase, accepted a real form and returned it through the authenticated inbox. The submitted row remained after CLI shutdown and reopening the file. The isolated verification database and phrase were then removed. HTTP checks denied access to the private secret file. A separate runtime check confirmed that the existing MySQL configuration and owner phrase still open the protected inbox, without modifying saved forms.

The local MySQL 8.0.46 server hosts `DrOrlowDB`. The earlier `users` table was left intact. The new `form_submissions` table was created; the application's writer was restricted to INSERT on that table. A separate local reader has SELECT permission on submissions. Generated credentials and the owner secret phrase are in the Git-ignored `.env` and were not printed in logs.

A real HTTP form submission, without identifier or password, returned 201. An unauthenticated inbox request returned 401. Correct owner authentication returned a session cookie and exposed the submitted form through the paginated inbox; the stored text and interests matched the submitted values. Wrong-password authentication returned 401. Logout without CSRF returned 403, correct logout succeeded, and replaying the old session returned 401. The temporary verification row was removed.

## Automated verification

The completed suite passed all 98 tests. Coverage includes form edits during requests, malformed/stale responses, timeouts, page restoration, authentication races, logout retries, observer and animation fallbacks, image reveals, arrow transforms, in-place letter refresh, explicit database selection, real SQLite persistence and pagination, runtime startup/shutdown, owner phrase reuse and public-path rejection. The site checker passed eight pages and 144 local link/asset references after duplicate background references were consolidated, including relative-unit CSS checks and the secret room route. Earlier live HTTP checks confirmed that the bubble entrance is outside any aria-hidden container and opens Super Orlow.

`npm run check` validates the page structure, local links/assets, labels and accessibility references, absence of inline handlers/styles, scalable CSS units and JavaScript syntax.

`npm test` covers backend HTTP/security and validation, public form recovery, private login/session/logout behavior, inbox pagination and safe rendering, conversation branches, policy ending, catching and secret games, reduced-motion behavior, scroll reveals and hidden-tab lifecycle.

## Verification limits

No connected browser was available. Responsive geometry and scroll containment were reviewed from code, but actual desktop/mobile rendering, visual similarity, keyboard behavior in a browser and screen-reader output still need browser review. DOM tests do not perform layout.

This audit ran on Windows. Tests exercised real local SQLite and server lifecycle behavior; POSIX permission assertions require a POSIX host and were conditional here. The existing live MySQL database was not modified or rechecked during this cleanup; its earlier verification is described above.

The previous account schema is preserved and no real existing-account migration was attempted. Switching between SQLite and MySQL selects separate stores; existing forms are not copied automatically. SQLite is intended for a local or single-host installation with persistent storage. Multiple instances need shared sessions and rate limiting; restarting this local server invalidates owner sessions.

## References

- [Express production security guidance](https://expressjs.com/advanced/best-practice-security/).
- [Node.js 22 crypto documentation](https://nodejs.org/download/release/v22.14.0/docs/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
- [Node.js 22 SQLite documentation](https://nodejs.org/download/release/v22.14.0/docs/api/sqlite.html).
- [MySQL 8 account and privilege management](https://dev.mysql.com/doc/refman/8.0/en/creating-accounts.html).
