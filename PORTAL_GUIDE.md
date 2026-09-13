# Using FLD Primary

## Accounts and grade access

Only an administrator can create sign-in accounts. There is no Google sign-in, self-registration or public password-reset form. Each staff member uses an individual email and password.

Admins and coordinators can access all grades. An admin assigns each teacher one or more of **Grade 1–Grade 4** in **Users**. Teachers see homework, students, checks and reports only for those grades. A teacher with no assigned grades can sign in and view **Shared** materials, calendar events and announcements, but cannot access grade records. Shared resources are explicitly available to all signed-in staff.

In **Users**, admins can create accounts or edit their names, emails, roles, assigned grades and active status. Changing a password, role, grade assignment or active status ends that person's existing sessions. To reset a forgotten password, choose **Edit** and enter a new password in both fields, then share it privately with that staff member. Leave both password fields empty when keeping the current password. Signed-in staff can change their own password in **Settings → Security** by entering the current one.

**Remove** asks for confirmation, hides the account from the user list and prevents further sign-in. Its past assignments, checks and other authored records keep their original owner. The email remains reserved; removing an account does not erase its history. There is no restore action. The last active admin cannot be disabled, demoted or removed.

## School Archive and one material library

**Archive** organizes school records across past and current academic years, including curriculum plans, meetings, events, reports and administration. Search and filters use year, term and area independently of grade. Admins and coordinators can classify records together, approve **Needs Review** items and select **All staff**, **Selected grades** or **Management only** access. Teachers see only approved records within their audience. See **ARCHIVE_GUIDE.md** for the complete workflow.

Use **Materials** to organize reusable files and HTTPS links by title, category, unit and grade audience. Calendar events, homework and the dashboard use this same library, so a file is uploaded once and selected wherever it is needed. Open a material to see its details and accessible usage references.

Admins and coordinators can add, edit and archive materials for any grades or mark them **Shared**. Teachers can upload a file or add a link only for one or more of their assigned grades. Teachers cannot make a material Shared, edit it or archive it, including their own uploads. File/link contents are fixed after creation. Management can edit classification and access through Archive; changes that conflict with existing calendar or homework audiences are rejected.

Archive and Materials use the same records. Management can place an approved Archive record in **Materials** for classroom use without copying the file. School records can stay solely in Archive; management-only or unreviewed documents cannot become classroom attachments. **Needs Review** is a publication status, while archiving retires a record from normal lists and new selections and preserves its accessible history.

Files can be up to **10 MiB** each. Supported types are PDF, DOCX, PPTX, XLSX, PNG, JPG/JPEG, WEBP, TXT, MP3 and MP4. Stored-file downloads require a signed-in account with access to the material. An external HTTPS link opens the original source and is still subject to that source's permissions.

Archiving hides a material from new selections while preserving existing accessible calendar and homework attachments. New attachments must be active and available to every intended grade. If you change an event or homework audience, its attachments are checked again.

Google Drive folder ingestion and automatic synchronization are deferred until the VDS stage. A Drive link can be saved as an ordinary HTTPS link, but the folder is not imported or synchronized. Access to the destination still follows its actual Drive sharing settings.

## Dashboard and calendar

The dashboard lists saved content available to the signed-in account. **View All** opens the relevant section, and **Today's plan** links to the same calendar/homework material records. Search uses accessible portal content. The bell opens notifications; read status is remembered in this browser for the current account. No email or push notification permission is required.

Admins and coordinators create and edit calendar events. Choose **Shared** or the intended grades, set the dates and times, and select materials from the library. A Shared event can use only Shared materials. Teachers see events for their assigned grades plus Shared events and cannot edit the calendar. Existing calendar records are retained as Shared events.

## Assign and check homework

1. An admin or coordinator adds students to the correct grade and class in **Homework Check**.
2. In **Homework → Overview**, choose **New homework**. Enter a title, optional description and pages, the grade/class, assignment date and due date. Select any reusable materials from the library.
3. Before saving, the portal checks for matching work in the same grade and class. The comparison includes previous, upcoming and archived assignments. Titles ignore case and repeated spaces; page ranges also ignore spacing and dash variations. Different explicit pages do not match. With no pages entered, matching titles are shown regardless of their page details. When editing, the current assignment is excluded.
4. Review any matching assignments. Choose **Save anyway** only when the repeat is intentional. This warning allows deliberate repeats; it does not merge or overwrite an earlier assignment.
5. Open **Homework Check**, choose the grade/class and assignment, then record each student's status and optional note. Save the checks before opening a report. Grading is available from the assignment date, including completion before the deadline.

Admins and coordinators can manage all assignments and the roster. Teachers can create homework in assigned grades and edit or grade only their own assignments within those grades. Other teachers' assignments in accessible grades can be read. **Unreviewed** means no assessment has been saved and is not counted as **Not done**; setting a student back to Unreviewed clears that saved check and note.

Pages are optional text of up to 120 characters. Each homework or calendar event can attach up to 30 materials. Assignments, students, checks and attachment references are stored in PostgreSQL and survive refreshing or signing in from another device connected to the same server. Archived assignments and students retain report history. A checked assignment cannot move to another class. Older homework from the previous browser-only version remains in its original browser storage until explicitly imported; the import review preserves the original records.

## Student reports

Click a student's name in **Homework Check**. **Weekly** is the default; choose **Monthly** for a complete calendar month or **Daily** for one day. Weeks run Monday through Sunday, and the exact date range is shown. Reports include already-assigned homework due in that period, including archived homework. Dates follow the school calendar in Europe/Istanbul.

Two summary cards show total assignments and completed assignments. The chart separates completed, partially done, not done, late, absent and unreviewed counts. An unchecked assignment is not automatically treated as missed. Teachers can open or download reports only for their assigned grades, including reports for archived students in those grades.

Download **CSV** for a spreadsheet or the **HTML report** to keep its chart and assignment details in one file. Open the HTML report in a browser to print or save it as a PDF. Downloads use authenticated server attachments; no student data is sent to an external reporting service.

## Announcements

Announcements are saved in the database and use the same **Shared** or selected-grade audience rules. Only an admin can create, edit or remove an announcement. Coordinators and teachers can read accessible announcements but cannot change them. Removing an announcement archives it and hides it from visible lists; it is not a browser-only deletion.

## Local files, backup and moving to a server

The development site runs on this computer at `http://localhost:3000`. Another device's localhost address does not point here; access from other devices requires the appropriate server setup.

Uploaded material files are private backend files, stored by default in `backend/.local-materials`. An administrator can configure another private directory using `MATERIAL_STORAGE_DIR`. Back up **both the PostgreSQL database and that file directory**: the database contains names and references, while the directory contains the actual file bytes. Restore both together when moving to a VDS. External HTTPS/Drive destinations are not copied into these backups. Keep configuration secrets and backups private.

