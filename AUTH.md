# FLD Primary authentication and roles

The Express/PostgreSQL backend owns login, sessions, roles, grade access, homework, calendar events, the shared material library and announcements. Existing calendar dates and records are preserved; audiences and material references extend the original contract. Copying these files does not migrate a live database or create a real account.

## Setup

### One-command Windows local setup

With PostgreSQL 18 binaries installed in `C:\Program Files\PostgreSQL\18`, double-click `Start-FLD.cmd` in the project folder (or run `Start-Local.ps1` in PowerShell). The helper creates a project-contained PostgreSQL cluster in `.local-postgres/data`, using locale `C` and UTF-8, to avoid the Windows `Turkish_Türkiye.1254` initialization failure. It starts the installed `postgres.exe` in the current Windows account and listens only on loopback, uses SCRAM authentication, creates the dedicated `fld_app` database role and `fld_primary` database, writes the generated application connection secret to ignored `backend/.env`, and applies migrations. No change to Windows language or the installer data directory is needed.

On the first run, enter a site admin password twice in the hidden terminal prompts. The local account is `admin@fld.local`. User passwords are stored only as scrypt hashes. On later runs, `Start-Local.ps1` starts the existing database and site without creating another account. The helper refuses occupied ports and unrecognized data directories and never resets an existing cluster. Local data and runtime files are excluded from Git; keep `.local-postgres` and `.env` private and back up your database before moving the project.

The bootstrap database-superuser password is generated temporarily and is not printed or retained. Routine database work uses the dedicated role that owns `fld_primary`. This local helper is for Windows development; use the regular configuration below for a VDS or another existing PostgreSQL server.

### Optional browser setup

If the hidden terminal password prompt is unavailable, run `node backend/scripts/setup-browser.js` from the project folder and open `http://127.0.0.1:3001/`. This temporary loopback-only form asks for the site admin password twice and invokes the same first-admin helper. It checks the exact Host and Origin, JSON content type and a random in-memory CSRF token, permits only one setup attempt at a time, and expires after 20 minutes. Successful setup verifies login, calendar reads and logout, then closes the setup listener. No public signup route is added to Express. Existing admin accounts are never replaced or reset.
### Existing PostgreSQL server or VDS

Use Node.js 22 or newer and your existing PostgreSQL database. From the project folder:

```powershell
cd backend
npm ci
Copy-Item .env.example .env
```

If `backend/.env` already exists, keep it and add the new settings instead of replacing it. Configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, or supply `DATABASE_URL` through the environment. Do not commit connection secrets. Configuration is loaded from `backend/.env` regardless of the working directory. On macOS/Linux, use `cp .env.example .env` for the copy step.

Then run:

```powershell
npm run migrate
npm run create-admin
npm start
```

Open [the local login page](http://localhost:3000/login.html). Express serves the existing frontend, so a separate frontend server is unnecessary. `node server.js` remains supported.

The admin command asks for email, full name and a hidden password with confirmation. It accepts neither password command-line arguments nor piped input, saves no credential file, and prints no password/hash. It refuses if any admin already exists, including an inactive admin; it never promotes or replaces an existing account. Use the authenticated admin API for later accounts. There is no default password or public signup endpoint.

## Route permissions

Admins and coordinators can access every grade. Teachers receive an admin-assigned `grades` array containing any combination of `Grade 1` through `Grade 4`. An empty teacher array grants no homework, roster, checks or reports. Calendar events and announcements with an empty audience are **Shared**. Material/Archive records additionally require `review_status=approved` and `visibility=shared` to be available to all authenticated staff. `visibility=grades` requires assigned-grade overlap; `visibility=management` is admin/coordinator only even with an empty grades array. Teacher ownership does not override these restrictions. Filtering applies to API lists, direct IDs, attachments, report downloads and the data used by dashboard search.

| Route | Anonymous | Admin | Coordinator | Teacher |
| --- | --- | --- | --- | --- |
| `POST /api/auth/login` | Login attempt | Login attempt | Login attempt | Login attempt |
| `GET /api/auth/me` | 401 | Own profile | Own profile | Own profile |
| `PATCH /api/auth/profile` | 401 | Own name | Own name | Own name |
| `POST /api/auth/password` | 401 | Own password | Own password | Own password |
| `POST /api/auth/logout` | Idempotent cleanup | End session | End session | End session |
| `GET /api/users` | 401 | List nonremoved users | 403 | 403 |
| `POST /api/users` | 401 | Create user | 403 | 403 |
| `PATCH /api/users/:id` | 401 | Update/reset/disable | 403 | 403 |
| `POST /api/users/:id/remove` | 401 | Remove account | 403 | 403 |
| `GET /api/events` | 401 | Read all | Read all | Assigned grades + Shared |
| `POST /api/events`, `PATCH /api/events/:id` | 401 | Create/edit | Create/edit | 403 |
| `GET /api/materials`, `GET /api/materials/:id` | 401 | Read all | Read all | Assigned grades + Shared |
| `GET /api/materials/:id/download` | 401 | Download stored file | Download stored file | Accessible stored file |
| `POST /api/materials` | 401 | Create any audience | Create any audience | Own assigned, nonempty grades only |
| `PATCH /api/materials/:id` | 401 | Edit/archive | Edit/archive | 403, including own uploads |
| `GET /api/archive`, `GET /api/archive/:id` | 401 | Read all records | Read all records | Approved records within audience |
| `POST /api/archive` | 401 | Add any audience; review queue by default | Add any audience; review queue by default | Approved, own assigned grades only |
| `PATCH /api/archive/:id`, `POST /api/archive/bulk` | 401 | Classify, approve, change access, retire/restore | Same | 403 |
| `GET /api/archive/folders`, `GET /api/archive/folders/:id` | 401 | Browse all folders | Browse all folders | Shared + assigned grade folders |
| `POST /api/archive/folders`, `PATCH /api/archive/folders/:id`, `POST /api/archive/move` | 401 | Organize folders/files | Same | 403 |
| `DELETE /api/archive/:id` | 401 | Permanently delete unlinked records | 403 | 403 |
| `DELETE /api/archive/folders/:id` | 401 | Permanently delete empty folders | 403 | 403 |
| `GET /api/announcements`, `GET /api/announcements/:id` | 401 | Read all active | Read all active | Assigned grades + Shared |
| `POST /api/announcements`, `PATCH /api/announcements/:id` | 401 | Create/edit/remove | 403 | 403 |
| `GET /api/homework` | 401 | Read all | Read all | Assigned grades only |
| `POST /api/homework/check-duplicates` | 401 | Check any class | Check any class | Assigned grades only |
| `POST /api/homework` | 401 | Create | Create | Create in assigned grades |
| `PATCH /api/homework/:id` | 401 | Edit/archive any | Edit/archive any | Own homework in assigned grades |
| `GET /api/homework/:id/checks` | 401 | Read all | Read all | Assigned grades only |
| `PUT /api/homework/:id/checks` | 401 | Grade any assigned work | Grade any assigned work | Own work in assigned grades |
| `GET /api/students` | 401 | Read roster | Read roster | Assigned grades only |
| `POST /api/students`, `PATCH /api/students/:id` | 401 | Manage roster | Manage roster | 403 |
| `GET /api/students/:id/report` | 401 | Read all | Read all | Assigned grades only |
| `GET /api/students/:id/report/export` | 401 | Download all | Download all | Assigned grades only |
| `GET /users.html` | Redirect to login | User management | 403 | 403 |
| `GET /settings.html` | Redirect to login | Own settings | Own settings | Own settings |
| Other portal HTML served by Express | Redirect to login | View | View | View |
| Login HTML and UI assets | Public | Public | Public | Public |

`GET /api/users?limit=50&offset=0` returns `{users, limit, offset}`; the maximum page size is 100, and removed accounts are excluded. Create/patch routes accept only `email`, `full_name`, `password`, `role`, `is_active`, `grades`. Creation requires email/name/password; role defaults to `teacher`, active status to `true`, and grades to `[]`. Grades must be a unique array of the four supported values. A patch requires at least one supported field. Valid roles are exactly `admin`, `coordinator`, `teacher`.

User responses contain only `id`, `email`, `full_name`, `role`, `grades`, `is_active`, `deleted_at`, `created_at`, `updated_at`. Create/patch/remove responses use `{user: {...}}`; login and me use `{authenticated: true, user: {...}}`, matching the login script. No endpoint returns password hashes.

An authenticated admin can send `{"grades":["Grade 1","Grade 3"]}`, `{"role":"coordinator"}` or `{"is_active":false}` to `PATCH /api/users/:id`. To reset a password, provide the new `password` through an HTTPS JSON request; never put it in a URL or a shell command. The admin-only `users.html` page manages individual accounts, assigned grades and optional password resets. Password-reset email delivery is not included.

`POST /api/users/:id/remove` accepts exactly `{}`. It sets `deleted_at`, makes the account inactive, revokes its sessions and hides it from the normal user list. The user row and email remain reserved so foreign-key history keeps its original author. It does not physically delete assignments, checks or files. Patching a removed account returns 404; there is no restore endpoint.

The last active admin cannot be demoted, disabled or removed. Account changes use a transaction and database lock, and recheck the acting admin inside the transaction. Password, role, grade and active-state changes revoke all affected sessions. A database trigger also revokes sessions for direct SQL security changes and removal. Academic and library writes reload the actor's role, grades, active state and session while holding the user row lock, so an old browser view cannot retain withdrawn grade permissions.

## Migration details

`npm run migrate` uses an advisory lock, an atomic transaction and `fld_schema_migrations`. Repeat runs skip applied files. Migration 001 creates or extends users and adds sessions/login limits; 002 creates a missing calendar table; 003 adds homework, students and saved checks; 004 adds user grades and account removal; 005 adds the material library, attachment junctions and event audiences; 006 adds announcements; 007 adds homework pages. Existing calendar rows are retained and initially use the Shared audience. No demonstration assignments, students, materials or announcements are inserted.

New users tables have a generated bigint ID, case-insensitive unique email, `full_name`, `password_hash`, constrained `role` and `grades`, `is_active`, nullable `deleted_at` and timestamps. An update trigger maintains `updated_at`. Removed users must remain inactive. Existing IDs and email spelling are preserved; user foreign keys match an existing integer/bigint/UUID ID type. Existing teachers start with no assigned grades until an admin assigns them.

For an existing users table, `id` must already be a primary/unique key with a default suitable for new inserts, and `email` must exist. Users without hashes receive the non-login marker `!reset-required!` and are disabled until an admin resets their password and activates them. Supported scrypt hashes are retained; other formats require a password reset and cannot authenticate.

The migration rolls back rather than guessing if normalized emails are duplicated, roles/types are incompatible, or a legacy `password`, `plain_password` or `plaintext_password` column exists. Resolve these through a reviewed data migration first. Legacy password columns are never read, printed or silently imported. Migration errors are deliberately generic so database error details do not expose user data.

Auth tables enable RLS without public policies and revoke public/anonymous Data API access. For this initial setup, use the table-owning database role for migration and Express. If separating migration/runtime roles, provide backend-only policies and narrowly scoped grants before switching. Do not grant browser roles access to auth tables.

## Passwords and sessions

Passwords use asynchronous Node scrypt with a random 16-byte salt and `N=32768, r=8, p=3`. New passwords require 12–128 characters and at most 512 UTF-8 bytes. Comparisons use `timingSafeEqual`. Unknown accounts perform a dummy scrypt check and return the same error as wrong passwords. API responses/logs exclude passwords and hashes. Browser storage contains neither passwords nor session tokens; the existing login form optionally remembers only an email.

Sessions use random 256-bit opaque cookies; PostgreSQL stores only SHA-256 digests of these high-entropy tokens. Cookies are `HttpOnly`, `SameSite=Lax`, host-only, with an eight-hour absolute expiry. Production adds `Secure` and the `__Host-` prefix. Login rotates the browser's previous session, logout deletes it, and every request checks current database state. Sessions persist across backend restarts and instances sharing the same database.

Login limits are shared in PostgreSQL: 60 attempts per client IP and 10 per normalized email in 15-minute windows, including successful attempts. Counter keys are hashed. The server cleans expired sessions/counters every 15 minutes; expiry is enforced even before cleanup. For larger deployments, also configure broader traffic limits at the trusted edge proxy.

State-changing API requests require `Content-Type: application/json`. Browser Origins must match `APP_ORIGINS` exactly; credentialed CORS never uses `*`. Cross-site writes without Origin are rejected when Fetch Metadata identifies them. Non-browser clients may omit Origin but still require JSON and a valid cookie. These checks reject cross-site form submissions while preserving the existing JSON login integration.

## Staff account management

Sign in as an admin, then choose **Users → New user**. Enter the staff member's full name, individual email address, role and initial password with confirmation. The default role is **Teacher**; assign one or more grades for access to academic records. A teacher with no grades can sign in and view Shared resources, but has no grade data. Each staff member uses their individual email and password; share initial credentials privately with that person. No real teacher account is seeded automatically and no credential is sent by email.

Use **Edit** to update an account, its assigned grades or role, make it inactive, or reset its password. Leave both password fields empty to retain the existing password. **Remove** asks for confirmation and removes the account from the list while preserving its historical references. Password inputs are masked and cleared after submission/closing; passwords never appear in the account list or browser storage. User lists are paginated in groups of 20. Email uniqueness, last-active-admin protection and session revocation apply to every UI action through the API.

The sidebar exposes the user-management link only to authenticated admins. Express also checks the admin role on the page itself and the user APIs. The shared profile displays the signed-in user's actual name and role after the session is verified.

## Personal settings and sidebar account menu

All three roles can open **Settings**, or click their profile card immediately above **Sign Out**. The card shows the current account name, role and initials. Its links open **Account settings**, **Change password** and **Preferences**. The previous topbar profile is removed. The account menu supports keyboard navigation, Escape and outside-click dismissal, including the compact desktop sidebar and mobile drawer.

**Profile** saves only the signed-in user's full name (1–120 characters). Email, role and grade access remain admin-managed through Users. `PATCH /api/auth/profile` accepts exactly `{full_name}` and returns `{authenticated: true, user}` with public user fields. Extra fields, including another user's ID, role, grades or removal state, are rejected. The sidebar updates immediately after a successful save.

**Security** requires the current password and a different new password with confirmation. `POST /api/auth/password` accepts exactly `{current_password, new_password}`. It shares a database-backed limit of five attempts per user in 15 minutes across sessions and server instances; rejection returns 429 with `Retry-After: 900`. An incorrect current password returns 400 without ending the session. Password changes recheck the active account, original hash and session inside a transaction, save only the new scrypt hash, revoke every session and clear the cookie. Success returns `{authenticated: false}` and the UI redirects to sign in. Password fields are masked and cleared after submission, and credentials are never stored in browser storage or URLs.

**Preferences** offers an expanded or compact desktop sidebar and reduced animations, with **Reset defaults**. These appearance preferences are saved only in this browser; they are not account permissions or settings synced across devices. The default animation setting follows the device's reduced-motion preference. If browser storage is blocked, changes apply to the current page and the UI reports that they were not saved.

Login now offers only email/password sign-in for administrator-created accounts. Google sign-in, request-access and the nonfunctional password-help controls are removed. Forgotten passwords are reset by an authenticated administrator through Users. Signed-in staff can still change their own password in Settings after verifying the current one. No reset email or public reset endpoint is added.

## Material library, calendar and announcements

`GET /api/materials` returns `{materials}` from one database-backed library. `GET /api/materials/:id` provides the record and its accessible usage references. The same material IDs are selected from calendar events and homework; dashboard **Today's plan** links reuse those references rather than copying files into each page. Every list, detail and stored-file download checks the requesting user's current grade audience. Grade-restricted materials cannot be linked to a homework grade or event audience that they do not cover; a Shared event requires Shared materials.

Admins/coordinators create, edit and archive library records. Teachers can upload files or create HTTPS-link materials only for a nonempty selection of their own assigned grades; they cannot publish Shared materials, edit or archive records, even their own uploads. File/link contents are fixed after creation. Archive adds management-controlled classification and audience editing; changes incompatible with existing calendar/homework audiences are rejected. Archiving removes an item from normal selection without breaking existing accessible homework/calendar references. Existing archived attachments may be retained on ordinary edits; newly added attachments must be active and approved. Changing an assignment/event audience revalidates its material references.

Files are limited to **10 MiB** (10,485,760 bytes) each. Supported extensions are `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.txt`, `.mp3`, `.mp4`. The upload route uses JSON with `content_base64`; decoded size and file type/signature are checked. Files use generated storage keys in private `backend/.local-materials` by default, or the directory configured by `MATERIAL_STORAGE_DIR`. This directory is not a public static route. Downloads use `GET /api/materials/:id/download`, authenticated attachment responses, `nosniff` and a restrictive sandbox policy. Storage keys and server filesystem paths are not public material fields.

An external link must use HTTPS without embedded credentials. Saving a link does not upload its destination into this server. A Google Drive link remains governed by the real Drive sharing permissions; portal grade restrictions cannot revoke access to a link already shared outside the portal. Drive folder ingestion and automatic synchronization are deferred until the VDS stage. No Drive folder is scanned or synchronized by the current implementation.

Calendar creation and editing use `POST /api/events` and `PATCH /api/events/:id` for admins/coordinators. Existing camelCase date/time fields remain supported, with `grades` and up to 30 `material_ids` added. Responses retain the existing event structure and add its audience and material summaries. Teachers can read events for assigned grades and Shared events.

Announcements now persist in PostgreSQL. `GET /api/announcements` lists active announcements visible to the caller, and `GET /api/announcements/:id` applies the same audience check. Only admins may create, edit or remove announcements; coordinators are read-only here. `POST /api/announcements` accepts title, description, category, date and grades. `PATCH /api/announcements/:id` updates those fields or uses `{"is_archived":true}` to remove a record from visible lists. Shared announcements use `grades:[]`; otherwise one or more grades define the audience. No physical DELETE route is exposed.

## School Archive API

Migration `008_school_archive.sql` extends the canonical `materials` table. Existing records retain their IDs, audiences, file storage and attachment references, remain approved and stay in Materials. `GET /api/materials` lists the teaching selection (`in_materials=true`); Archive lists all accessible school records regardless of that selection.

`GET /api/archive` returns `{items,total,facets:{years:[]}}`. Supported query fields are `q`, `academic_year`, `term`, `area`, `visibility`, `grade`, `status`, `archived`, `limit` and `offset`. Search and filters run on the server. `status` accepts `all`, `approved`, `needs_review`; `archived` accepts `all`, `true`, `false`; a page contains at most 100 items. Counts and year facets obey the caller's access. Teachers cannot retrieve pending or management records by changing query parameters.

Classification fields are `academic_year` (blank or consecutive `YYYY-YYYY`), `term` (blank, `Full year`, `Term 1`, `Term 2`, `Summer`), `area` (`Teaching & Learning`, `Planning & Curriculum`, `School Events`, `Meetings`, `Reports`, `Administration`, `Other`), `visibility` (`shared`, `grades`, `management`), `review_status` (`approved`, `needs_review`) and boolean `in_materials`. The original resource `category`, `unit`, `grades` and `is_archived` fields remain separate. A management-only record is not Shared merely because its grades array is empty.

`POST /api/archive` uses the existing JSON file/link payload plus the classification fields. Management uploads default to Needs Review and outside Materials; teacher uploads are approved and restricted to the teacher's own nonempty grades. `PATCH /api/archive/:id` updates management-controlled metadata. `POST /api/archive/bulk` accepts `{ids,changes}` for up to 100 distinct IDs, updates only supplied fields and commits all selected changes together. Writes recheck the current actor/session and lock the records. An audience/review change that would invalidate existing event or homework attachments fails without changing the selection.

`GET /api/archive/:id` returns the canonical record and accessible usage references. Stored files download through the existing authenticated `/api/materials/:id/download` endpoint with the same access rules. Management can inspect possible duplicates from new-upload SHA-256 fingerprints or exact normalized HTTPS links. Fingerprints, storage paths and private records are not exposed to teachers, and duplicate records are never automatically merged or deleted. Existing legacy uploads are not automatically fingerprinted.

Archive and Materials file/link responses also include `creator_name`, `last_editor_name`, `last_edited_at` and `edit_history_status`. The existing `created_at` is the upload/addition time. Names are joined from the corresponding staff records in the same list/detail query; private account fields are not included. A known staff name remains available after the account is removed. A blank name is `Not recorded`, or `Former staff member` only when removal is recorded.

Migration `011_material_authorship.sql` adds the last-editor reference with the same data type as `users.id`. Existing records receive `edit_history_status="unknown"` with no invented editor or edit time; original data and timestamps are unchanged. Newly created records use `"not_edited"` with null editor/time. A successful metadata update, retirement, restoration, classification, Materials placement or folder move sets `"edited"`, the current verified actor and a database timestamp in the same transaction. Bulk changes remain atomic. These attribution fields cannot be supplied by clients, and a rejected write leaves them unchanged. This is latest-edit attribution, not a full revision log.

There is no Drive import or sync endpoint in this release. See `ARCHIVE_GUIDE.md` for user-facing organization and review workflows.

### Permanent deletion and private file cleanup

Only admins may permanently delete Archive records or empty folders. `DELETE /api/archive/:id` and `DELETE /api/archive/folders/:id` accept an empty JSON object and retain the exact Origin and authentication requirements. Coordinators keep their existing retirement/restore and folder organization rights; teachers cannot delete or retire files. Record deletion removes its canonical Materials entry too. An external link's destination is never deleted by this server.

A record referenced by any calendar event or homework assignment returns `409` without changing the record, stored bytes or references. A folder containing any records, including retired files, or subfolders also returns `409`. These checks use transaction row locks that conflict with attachment validation and folder/file insertion; foreign keys provide an additional guard. Unknown IDs return `404`, and malformed IDs or deletion bodies return `400`.

Migration `010_material_file_cleanup.sql` adds a private durable cleanup queue. File deletion queues the generated storage key in the same transaction that removes the record. Bytes are removed only after that transaction commits. Cleanup verifies the configured storage root, refuses symlinks/nonregular files and active storage references, and removes the queue entry only after successful removal or confirmed absence within a verified storage root. A missing storage root keeps the job for retry. The API returns `{deleted:true,id,storage_cleanup:"complete"}` on complete cleanup or `"pending"` when the record was deleted but its private bytes await cleanup. Folder deletion returns `{deleted:true,id}`.

After correcting storage access, retry queued jobs with `node backend/scripts/cleanup-material-files.js` from the project directory. The command processes up to 100 jobs per run, reports counts only and exits nonzero if jobs remain; rerun for additional batches. It prints no paths, storage keys or credentials. Jobs survive process restarts, and a retry after an uncertain cleanup commit safely handles already removed bytes. Include the cleanup queue in database backups along with the private file storage.

## Homework pages and repeat warnings

Homework create/patch accepts optional `pages` (trimmed text, maximum 120 characters, default `""`) and up to 30 unique `material_ids`. Public homework responses always include `pages`, `materials` and `material_ids`; material summaries contain `id`, `title`, `grades`, `is_archived`, `kind`. Attached materials are checked against the homework grade in the same transaction as the assignment write.

Before saving, the UI calls `POST /api/homework/check-duplicates` with `{title, pages, grade, class_name, exclude_id?}`. The authenticated response is `{duplicates:[{id,title,pages,assign_date,due_date,is_archived}]}`. It compares the same grade/class across past, upcoming and archived assignments. Titles ignore case and repeated/outer whitespace; pages also normalize spacing and dash variants. Nonempty pages require a matching normalized page value. Blank or omitted pages use a title-only warning. `exclude_id` removes the current edit from the comparison. The endpoint applies grade permissions and rejects unknown fields.

This is an advisory warning: the UI shows matching work and asks for explicit **Save anyway** confirmation. The create/patch endpoint still permits intentional repeats; it does not enforce a unique-title constraint. Reports and saved checks remain attached to each separate assignment.

## Frontend integration and scope

The shared navigation and visual theme are retained, and the interface is English. Homework, calendar, materials and announcements use persistent authenticated APIs; static demonstration material/announcement rows and browser-only mutations are replaced. Dashboard lists, counts, search and notifications consume the same accessible records. The sidebar exposes Users only to admins and shows the authenticated account. Each portal page loads `auth.js` to verify the session, redirect on 401 and connect Sign Out. Teacher calendar editing and material-management controls, and nonadmin announcement controls, are hidden. Server checks apply even if browser controls are modified. User-entered text is escaped when rendered.

For VS Code Live Server on port 5500, use the same hostname on both sides (`localhost` or `127.0.0.1`). Development defaults allow those origins. For another API address, set the same `fld-api-base` meta value in login and protected pages and add the frontend origin to `APP_ORIGINS`. A same-origin reverse proxy is recommended in production. Live Server cannot restrict direct HTML downloads; Express-served portal HTML and backend data have server-side checks.

Homework, class rosters and saved student checks use the authenticated APIs listed above. Teacher assignment edits and grading require both ownership and current grade access; teachers may read another teacher's work only within their assigned grades. Admins/coordinators can manage all assignments and the roster. User/grade management and all announcement writes stay admin-only.

The academic migration adds separate assignment, student and assessment tables. No sample students or assignments are seeded. The calendar and auth tables retain their contracts. Assignment/student archiving preserves report history; saved checks remain attached to their assignment and student. Reports use an inclusive due-date range, distinguish unreviewed work from missing work, and use the school date in Europe/Istanbul for assignment availability. Class changes are restricted after checks exist so historical results cannot move to another class.

Student reports default to weekly periods, support full calendar months and retain a daily option. On-screen charts use authenticated API responses. Download endpoints generate CSV or standalone HTML with a shared formatter, require an authenticated staff session, validate the period and date bounds, and return private attachments with no-store headers. The CSV export protects spreadsheet cells from formula interpretation; the HTML export escapes text and keeps the graph self-contained without external student-data services. See `PORTAL_GUIDE.md` for the account, dashboard, checking and report workflows.

The obsolete direct Supabase calendar test client and CDN script were removed. This does not change that remote project's permissions. If its Data API still exposes calendar data, close that independent access through grants/RLS or disable the Data API; callers otherwise could bypass Express through that separate service. New auth tables explicitly deny anonymous Data API access. No hosted Supabase settings were modified.

## Production

Set `NODE_ENV=production` and exact HTTPS `APP_ORIGINS`. Insecure API requests and invalid origin configuration are rejected. The server binds to `127.0.0.1` by default; set `HOST` explicitly if another binding is needed. Terminate TLS at a trusted reverse proxy and set `TRUST_PROXY` to its actual IP/subnet so forwarded protocol/IP headers are trusted only from that proxy. Database TLS settings may be supplied through the provider's connection string; application code does not disable certificate verification.

Back up **both PostgreSQL and the private material storage directory**. Database backups contain library metadata and attachment references, not uploaded file bytes. Keep the two backups consistent, retain storage keys and restore the files before serving restored records. When moving to a VDS, configure `MATERIAL_STORAGE_DIR` to the restored private directory and restrict filesystem access to the backend account. Keep `.env` and backup credentials private. Downloaded/exported copies and external Drive links remain outside this server's backup and access controls.

## Tests

```powershell
cd backend
npm ci
npm test
```

Tests use PGlite, a local PostgreSQL engine, without connecting to the school's database. They exercise HTTP routes, SQL migrations, password hashing, cookies, role/grade scope, session revocation, account removal, academic history, file/link access, duplicate warnings and calendar data. To additionally test the native `pg` driver and PostgreSQL connections, supply `AUTH_TEST_DATABASE_URL` for a disposable test database. Each test creates a random schema and removes only that schema afterward; the test role needs schema creation permission. The default local engine has a single connection and cannot validate multi-connection database locking behavior.

References: [Node crypto](https://nodejs.org/api/crypto.html), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api), [PGlite](https://pglite.dev/docs/).

