# Archive folders

Folders organize the shared Archive and Materials records. Apply migrations before starting an updated installation.

Folders group canonical material records. A move updates only `materials.folder_id`; file IDs, bytes, approval state, audience, downloads and calendar/homework attachments stay the same. Records without a folder remain at the Archive root.

## Staff access

| Action | Admin | Coordinator | Teacher |
| --- | --- | --- | --- |
| Browse folders and download accessible files | All | All | Shared and assigned grades; approved files only |
| Add files or resource links | Yes | Yes | Approved records for assigned grades |
| Create a folder or subfolder | Yes | Yes | No |
| Rename folders or move existing files | Yes | Yes | No |
| Delete folders | Not provided | Not provided | No |

A root folder has Shared, Selected grades or Management access. Subfolders inherit the parent audience. A folder's parent and audience are fixed in this version; names can change. Up to eight nesting levels are supported, and sibling names must be unique ignoring case. Folders are organizational containers, not filesystem paths.

A file must fit the destination folder's audience. Shared folders accept every record scope; grade folders accept records restricted to those grades and management records; management folders accept management records. Existing file-level checks always apply. The server rejects incompatible uploads, moves, or later metadata changes instead of silently changing access. Counts and paths exclude content unavailable to the caller.

## API

Every route requires the existing authenticated session. Mutations use existing Origin, JSON and transaction-level actor/session checks.

| Route | Purpose | Permission |
| --- | --- | --- |
| `GET /api/archive?folder=root` | Root files, child folders and breadcrumbs | Authenticated, scoped |
| `GET /api/archive?folder=ID` | Direct contents of one folder | Authenticated, scoped |
| `GET /api/archive?q=TEXT` | Search files across accessible folders, with `folder_path` | Authenticated, scoped |
| `GET /api/archive/folders?parent=root` or `parent=ID` | Browse folder destinations | Authenticated, scoped |
| `GET /api/archive/folders/:id` | Folder and breadcrumbs | Authenticated, scoped |
| `POST /api/archive/folders` | Create root `{name,parent_id:null,visibility,grades}` or child `{name,parent_id}` | Admin/coordinator |
| `PATCH /api/archive/folders/:id` | Rename with `{name}` | Admin/coordinator |
| `DELETE /api/archive/folders/:id` | Delete an empty folder with `{}` | Admin only |
| `DELETE /api/archive/:id` | Permanently delete an unlinked file or saved link with `{}` | Admin only |
| `POST /api/archive/move` | Atomic move `{ids,folder_id}`; null means root, up to 100 IDs | Admin/coordinator |
| `POST /api/archive` | Existing upload/link endpoint also accepts `folder_id` | Existing creation rules |

Omitting `folder` preserves the prior flat Archive API. Text search spans all accessible folders. Folder IDs are strings throughout the API so PostgreSQL BIGINT precision is retained. Existing download URLs remain `/api/materials/:id/download`.

The interface supports selecting up to 20 files for an upload batch, 10 MB each. Select the destination folder before opening Add files or link. Uploading a local directory tree or ZIP extraction is not implemented. Google Drive import remains deferred.

## Storage and rollout

Migration `009_archive_folders.sql` adds folders, a nullable material foreign key, listing indexes, scope/depth guards and access restrictions consistent with existing tables. It adapts the creator reference to legacy user ID types. Existing records remain unfiled; no existing record is copied or deleted. Migration `010_material_file_cleanup.sql` adds a private cleanup queue so failed file removal can be retried after the record deletion commits.

Back up the application and database before updating source, applying migrations and restarting the application. Never deploy `work/design-preview.cjs`: its automatic sample-account sessions belong only to the isolated loopback preview.

File deletion refuses records referenced by calendar events or homework, including historical assignments. Folder deletion refuses all files (including retired records) and subfolders. Remove or move these contents first. Every destructive interface action requires an English confirmation; Cancel or Escape performs no write. Retirement remains available to admins and coordinators and preserves files and existing links. A saved external link can be deleted without deleting the external resource itself.

Deletion queues private bytes for removal in the same database transaction, then processes the queue immediately. If storage is unavailable, the record stays deleted and the durable job remains for `node scripts/cleanup-material-files.js`. Run that command from the backend directory to retry; it does not display credentials or storage keys.

Validation covers folder permissions, nesting, duplicate names, atomic move failures, scoped uploads, global paths, full BIGINT precision, metadata compatibility, and attachment/download preservation. The broader backend tests cover existing authentication, calendar, homework, material and announcement behavior.
