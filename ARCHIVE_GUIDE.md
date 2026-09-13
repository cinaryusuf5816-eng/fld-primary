# School Archive

Archive keeps the school's records together across academic years. It includes teaching resources, curriculum plans, school events, meeting notes, reports and administrative documents. A record does not need a grade: its year, subject area and access are separate choices.

## Find a record

Open **Archive** in the sidebar. Search by title, description, original filename or unit, then narrow the results by academic year and area. Use the additional filters for term and access. On phones, open **Filters** when needed; the category shortcuts stay in one scrollable row so the file list remains easy to reach. Results are paginated so a large archive does not have to load all at once. Open a record for its description, file or external link and any calendar/homework references you can access.

| Area | Typical records |
| --- | --- |
| Teaching & Learning | Worksheets, lesson resources and assessments |
| Planning & Curriculum | Annual plans, term plans and curriculum documents |
| School Events | Event programmes, activity documents and school projects |
| Meetings | Agendas, minutes and department notes |
| Reports | Term reviews, evaluations and historical reports |
| Administration | Internal school procedures and operational documents |
| Other | Records that need another classification |

Academic years use a consecutive range such as **2023-2024**. Choose **Full year**, **Term 1**, **Term 2** or **Summer** when appropriate. An unknown year or term can be left blank; uploading an old record does not assign it to the current academic year automatically.

## Choose who can access it

| Access | Who can view and download |
| --- | --- |
| All staff | Every signed-in staff account, including teachers without assigned grades |
| Selected grades | Admins, coordinators and teachers assigned at least one selected grade |
| Management only | Admins and coordinators |

**Needs Review** records are visible only to admins and coordinators, regardless of the access selection. Approval makes the selected access effective. These rules apply to search, direct links, file downloads and attachments, not just the screen's filters. An external link still follows the external provider's own sharing permissions.

Admins and coordinators organize all records and choose their access. Teachers can add records only to their assigned grades and can view approved records within their access. They cannot edit, archive or delete records, including their own uploads. Teacher uploads keep the existing material-upload behavior and are approved when created.

## Add and organize files

Admins and coordinators can use **New folder** to group records by school year, project or topic, then open a folder to add subfolders and upload its files. The breadcrumb trail returns to any parent folder. Select existing records and use **Move** to place them in a folder without creating copies. Search finds accessible files across folders and shows their locations.

Choose a root folder's access when creating it; subfolders inherit that access. Each file keeps its own access when moved. A destination cannot contain a file whose readers cannot access the folder, so incompatible moves are rejected together. Teachers can browse folders available to them, download approved files and upload records for their assigned grades; they cannot rename folders or move records.

Use **Add files or link** to upload up to 20 files with the same initial year, term, area and access. The result lists each saved or failed file; retrying failed uploads does not upload successful files again. If a response is uncertain, check Archive before retrying. Supported files are PDF, DOCX, PPTX, XLSX, PNG, JPG/JPEG, WEBP, TXT, MP3 and MP4, up to **10 MiB per file**. An HTTPS link can also be saved as a record. The original file contents remain unchanged.

New records added by management start in **Needs Review** by default. Select several records, open the bulk editor, assign the missing information and approve them together. Only fields chosen in the bulk editor change. A failed bulk update leaves every selected record unchanged.

The detail view can flag matching uploaded contents or matching external links as possible duplicates for management. Names alone are not proof that two records are identical. No record is merged, overwritten or deleted automatically. Duplicate matching covers new uploads whose fingerprint is stored; older uploads are not silently read and reprocessed.

File details show **Added by** and **Added on**, followed by the latest editor and edit time. The same information appears in Materials. New records show **Not edited yet** until their first saved change. Older records whose editor history was not recorded show **Not recorded**; their uploader is not assumed to have made later edits. Moving, classifying, retiring or restoring a record updates its latest-edit information too. Names remain available after staff accounts are removed when the original staff name is still recorded.

## Archive and Materials work together

Every file or link has one canonical record. **Archive** can hold all school records. **Materials** is the selected teaching library used while planning lessons, calendar entries and homework. Management can add an approved, suitable Archive record to Materials; this does not upload a second copy or create a second record. Management-only and unreviewed records cannot be attached to classroom homework or calendar entries.

Open **Used in** references to see the connected calendar event or homework. A record can be removed from Materials while keeping its existing references. **Retire record** hides it from normal lists and new selections; it is separate from both the Archive page and Needs Review. Retired records and their accessible historical references remain available through the retired filter. Restore a record to make it available again.

Access changes that would make an existing attachment unavailable to its event or homework audience are rejected. Review those references before changing the record's audience. File/link contents are fixed after creation so changing metadata cannot silently replace an attached worksheet or document.

## Permanently delete records

Only admins can permanently delete files, saved links and empty folders. The confirmation identifies the selected record before deletion. Deleting an Archive record also removes its Materials entry. Deleting a saved external link removes the portal record; it does not delete the document at its external source.

A file used by calendar events or homework cannot be deleted until those references are removed. A folder must contain no files, retired records or subfolders before deletion. **Retire record** remains available to admins and coordinators when the record and its historical links should be retained.

If the portal reports that stored file cleanup is pending, the record has already been deleted and can no longer be downloaded. Its private file removal remains queued for retry; see **AUTH.md** for the cleanup command.

## Google Drive comes later

Drive folder import and synchronization are deferred until the VDS stage. The present system stores uploaded files locally and can save ordinary HTTPS links. It does not scan, clean up, move or synchronize a Drive folder.

When Drive is connected later, the intended workflow is to import into Needs Review, preserve the source file identity, classify in batches and approve for the intended staff audience. Filename/folder suggestions and provider revision tracking are future work, not active features. Drive folder structure does not need to become the portal's navigation.

## Backups

Back up PostgreSQL and the private material storage directory together. The database stores the classification, access and references; the private directory stores uploaded file contents. See **PORTAL_GUIDE.md** and **AUTH.md** for local setup and deployment details. The source ZIP deliberately excludes credentials, uploads, database data and private backups.


