/* ============================================================
   HOMEWORK PAGE
   ============================================================ */


/* ============================================================
   DOM ELEMENTS
   ============================================================ */

const addHomeworkButton =
    document.querySelector("#add-homework-button");

const homeworkModal =
    document.querySelector("#homework-modal");

const homeworkModalClose =
    document.querySelector("#homework-modal-close");

const homeworkCancelButton =
    document.querySelector("#homework-cancel-button");

const homeworkForm =
    document.querySelector("#add-homework-form");


const homeworkTitleInput =
    document.querySelector("#homework-title");

const homeworkDescriptionInput =
    document.querySelector("#homework-description");

const homeworkGradeInput =
    document.querySelector("#homework-grade");

const homeworkClassInput =
    document.querySelector("#homework-class");

const homeworkAssignDateInput =
    document.querySelector("#homework-assign-date");

const homeworkDueDateInput =
    document.querySelector("#homework-due-date");

const homeworkFormMessage =
    document.querySelector("#homework-form-message");


const homeworkModalTitle =
    document.querySelector(".homework-modal-header h2");

const homeworkSaveButton =
    document.querySelector(".homework-save-button");


const assignedHomeworkCard =
    document.querySelector("#assigned-homework-card");

const upcomingHomeworkCard =
    document.querySelector("#upcoming-homework-card");


const assignedViewAllButtons =
    document.querySelectorAll(".assigned-view-all");

const upcomingViewAllButtons =
    document.querySelectorAll(".upcoming-view-all");


/* ============================================================
   STORAGE
   ============================================================ */

const HOMEWORK_STORAGE_KEY =
    "fld-homework-overview-v1";


/* ============================================================
   STATE
   ============================================================ */

let homeworkItems = [];

let showAllAssigned = false;

let showAllUpcoming = false;

let editingHomeworkId = null;


/* ============================================================
   DATE HELPERS
   ============================================================ */

function getToday() {

    const today =
        new Date();


    today.setHours(
        0,
        0,
        0,
        0
    );


    return today;
}


/* ==================== PARSE DATE ==================== */

function parseDate(dateString) {

    if (!dateString) {

        return null;
    }


    const parts =
        dateString
            .split("-")
            .map(Number);


    if (
        parts.length !== 3
    ) {

        return null;
    }


    const date =
        new Date(
            parts[0],
            parts[1] - 1,
            parts[2]
        );


    date.setHours(
        0,
        0,
        0,
        0
    );


    return date;
}


/* ==================== FORMAT DATE FOR INPUT ==================== */

function formatDateForInput(date) {

    const year =
        date.getFullYear();


    const month =
        String(
            date.getMonth() + 1
        ).padStart(
            2,
            "0"
        );


    const day =
        String(
            date.getDate()
        ).padStart(
            2,
            "0"
        );


    return `${year}-${month}-${day}`;
}


/* ==================== DATE OFFSET ==================== */

function getDateWithOffset(days) {

    const date =
        getToday();


    date.setDate(
        date.getDate() + days
    );


    return formatDateForInput(
        date
    );
}


/* ============================================================
   ID
   ============================================================ */

function createHomeworkId() {

    return (
        Date.now().toString(36) +
        Math.random()
            .toString(36)
            .slice(2)
    );
}


/* ============================================================
   DEFAULT HOMEWORK DATA
   ============================================================ */

function getDefaultHomework() {

    return [

        /* ==================== ASSIGNED ==================== */

        {
            id:
                createHomeworkId(),

            title:
                "Workbook p.28-29",

            description:
                "Complete Pages 28 and 29.",

            grade:
                "Grade 3",

            className:
                "A",

            assignDate:
                getDateWithOffset(-1),

            dueDate:
                getDateWithOffset(1)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Reading Comprehension",

            description:
                "Read the text and answer the questions.",

            grade:
                "Grade 2",

            className:
                "B",

            assignDate:
                getDateWithOffset(-3),

            dueDate:
                getDateWithOffset(-1)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Grammar Exercise",

            description:
                "Do exercises on Past Simple.",

            grade:
                "Grade 3",

            className:
                "A",

            assignDate:
                getDateWithOffset(-5),

            dueDate:
                getDateWithOffset(-2)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Writing Practice",

            description:
                "Write 5 sentences about your weekend.",

            grade:
                "Grade 2",

            className:
                "A",

            assignDate:
                getDateWithOffset(-7),

            dueDate:
                getDateWithOffset(-4)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Workbook Review",

            description:
                "Review the previous workbook activities.",

            grade:
                "Grade 3",

            className:
                "B",

            assignDate:
                getDateWithOffset(-9),

            dueDate:
                getDateWithOffset(-6)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Sentence Practice",

            description:
                "Write five complete sentences.",

            grade:
                "Grade 2",

            className:
                "C",

            assignDate:
                getDateWithOffset(-12),

            dueDate:
                getDateWithOffset(-10)
        },


        /* ==================== UPCOMING ==================== */

        {
            id:
                createHomeworkId(),

            title:
                "Vocabulary Worksheet",

            description:
                "Complete Unit 4 vocabulary exercises.",

            grade:
                "Grade 3",

            className:
                "A",

            assignDate:
                getDateWithOffset(1),

            dueDate:
                getDateWithOffset(2)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Reading Practice",

            description:
                "Read Unit 4 text and answer the questions.",

            grade:
                "Grade 2",

            className:
                "B",

            assignDate:
                getDateWithOffset(2),

            dueDate:
                getDateWithOffset(4)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Grammar Worksheet",

            description:
                "Complete Past Simple exercises.",

            grade:
                "Grade 3",

            className:
                "B",

            assignDate:
                getDateWithOffset(4),

            dueDate:
                getDateWithOffset(6)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Writing Task",

            description:
                "Write a short paragraph about your weekend.",

            grade:
                "Grade 2",

            className:
                "A",

            assignDate:
                getDateWithOffset(6),

            dueDate:
                getDateWithOffset(8)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Vocabulary Review",

            description:
                "Review the new unit vocabulary.",

            grade:
                "Grade 3",

            className:
                "C",

            assignDate:
                getDateWithOffset(8),

            dueDate:
                getDateWithOffset(10)
        },


        {
            id:
                createHomeworkId(),

            title:
                "Reading Challenge",

            description:
                "Read the short story and answer the questions.",

            grade:
                "Grade 2",

            className:
                "B",

            assignDate:
                getDateWithOffset(10),

            dueDate:
                getDateWithOffset(12)
        }

    ];
}


/* ============================================================
   LOAD HOMEWORK
   ============================================================ */

function loadHomework() {

    const storedData =
        localStorage.getItem(
            HOMEWORK_STORAGE_KEY
        );


    if (storedData) {

        try {

            const parsedData =
                JSON.parse(
                    storedData
                );


            if (
                Array.isArray(
                    parsedData
                )
            ) {

                homeworkItems =
                    parsedData;


                return;
            }

        }

        catch (error) {

            console.error(
                "Homework data could not be loaded.",
                error
            );
        }
    }


    homeworkItems =
        getDefaultHomework();


    saveHomework();
}


/* ============================================================
   SAVE HOMEWORK
   ============================================================ */

function saveHomework() {

    localStorage.setItem(
        HOMEWORK_STORAGE_KEY,
        JSON.stringify(
            homeworkItems
        )
    );
}


/* ============================================================
   HOMEWORK GROUPS
   ============================================================ */

function getHomeworkGroups() {

    const today =
        getToday();


    /* ==================== ASSIGNED ==================== */

    const assigned =
        homeworkItems
            .filter(
                (homework) => {

                    const assignDate =
                        parseDate(
                            homework.assignDate
                        );


                    return (
                        assignDate &&
                        assignDate <= today
                    );
                }
            )
            .sort(
                (first, second) => {

                    return (
                        parseDate(
                            second.assignDate
                        )
                        -
                        parseDate(
                            first.assignDate
                        )
                    );
                }
            );


    /* ==================== UPCOMING ==================== */

    const upcoming =
        homeworkItems
            .filter(
                (homework) => {

                    const assignDate =
                        parseDate(
                            homework.assignDate
                        );


                    return (
                        assignDate &&
                        assignDate > today
                    );
                }
            )
            .sort(
                (first, second) => {

                    return (
                        parseDate(
                            first.assignDate
                        )
                        -
                        parseDate(
                            second.assignDate
                        )
                    );
                }
            );


    return {

        assigned,
        upcoming

    };
}


/* ============================================================
   REMOVE OLD ROWS
   ============================================================ */

function removeHomeworkRows(card) {

    if (!card) {

        return;
    }


    const rows =
        card.querySelectorAll(
            ".homework-row"
        );


    rows.forEach(
        (row) => {

            row.remove();
        }
    );
}


/* ============================================================
   DATE DISPLAY
   ============================================================ */

function getDateParts(dateString) {

    const date =
        parseDate(
            dateString
        );


    if (!date) {

        return {

            day:
                "--",

            month:
                "---"

        };
    }


    const day =
        String(
            date.getDate()
        ).padStart(
            2,
            "0"
        );


    const month =
        date
            .toLocaleString(
                "en-US",
                {
                    month:
                        "short"
                }
            )
            .toUpperCase();


    return {

        day,
        month

    };
}


/* ============================================================
   DUE DATE TEXT
   ============================================================ */

function getDueDateText(dateString) {

    const dueDate =
        parseDate(
            dateString
        );


    const today =
        getToday();


    if (!dueDate) {

        return "";
    }


    const millisecondsPerDay =
        1000 *
        60 *
        60 *
        24;


    const difference =
        Math.round(
            (
                dueDate -
                today
            )
            /
            millisecondsPerDay
        );


    if (
        difference === 0
    ) {

        return "Today";
    }


    if (
        difference === 1
    ) {

        return "Tomorrow";
    }


    if (
        difference > 1
    ) {

        return `${difference} Days`;
    }


    if (
        difference === -1
    ) {

        return "Yesterday";
    }


    return `${Math.abs(difference)} Days Ago`;
}


/* ============================================================
   ESCAPE HTML
   ============================================================ */

function escapeHtml(value) {

    return String(value)

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );
}


/* ============================================================
   CREATE ASSIGNED ROW
   ============================================================ */

function createAssignedRow(homework) {

    const row =
        document.createElement(
            "div"
        );


    row.className =
        "homework-row";


    row.dataset.homeworkId =
        homework.id;


    const date =
        getDateParts(
            homework.assignDate
        );


    row.innerHTML = `

        <div class="homework-date">

            <strong>
                ${date.day}
            </strong>

            <span>
                ${date.month}
            </span>

        </div>


        <div class="homework-info">

            <h3>
                ${escapeHtml(
                    homework.title
                )}
            </h3>

            <p>
                ${escapeHtml(
                    homework.description
                )}
            </p>

        </div>


        <span class="grade-badge">

            ${escapeHtml(
                homework.grade
            )}

        </span>


        <div class="homework-row-end">


            <span class="status-badge completed">

                <i class="fa-solid fa-check"></i>

                Assigned

            </span>


            <button
                type="button"
                class="homework-more-button"
                data-homework-id="${homework.id}"
                title="Homework Options"
                aria-label="Homework Options"
            >

                <i class="fa-solid fa-ellipsis-vertical"></i>

            </button>


        </div>

    `;


    return row;
}


/* ============================================================
   CREATE UPCOMING ROW
   ============================================================ */

function createUpcomingRow(homework) {

    const row =
        document.createElement(
            "div"
        );


    row.className =
        "homework-row";


    row.dataset.homeworkId =
        homework.id;


    const date =
        getDateParts(
            homework.assignDate
        );


    const dueDateText =
        getDueDateText(
            homework.dueDate
        );


    row.innerHTML = `

        <div class="homework-date">

            <strong>
                ${date.day}
            </strong>

            <span>
                ${date.month}
            </span>

        </div>


        <div class="homework-info">

            <h3>
                ${escapeHtml(
                    homework.title
                )}
            </h3>

            <p>
                ${escapeHtml(
                    homework.description
                )}
            </p>

        </div>


        <span class="grade-badge">

            ${escapeHtml(
                homework.grade
            )}

        </span>


        <div class="homework-row-end">


            <span class="due-date-badge">

                <i class="fa-regular fa-calendar"></i>

                ${dueDateText}

            </span>


            <button
                type="button"
                class="homework-more-button"
                data-homework-id="${homework.id}"
                title="Homework Options"
                aria-label="Homework Options"
            >

                <i class="fa-solid fa-ellipsis-vertical"></i>

            </button>


        </div>

    `;


    return row;
}


/* ============================================================
   RENDER ASSIGNED
   ============================================================ */

function renderAssigned(homeworkList) {

    if (!assignedHomeworkCard) {

        return;
    }


    removeHomeworkRows(
        assignedHomeworkCard
    );


    const bottomButton =
        assignedHomeworkCard
            .querySelector(
                ".homework-view-all"
            );


    const visibleHomework =
        showAllAssigned
            ? homeworkList
            : homeworkList.slice(
                0,
                4
            );


    visibleHomework.forEach(
        (homework) => {

            const row =
                createAssignedRow(
                    homework
                );


            assignedHomeworkCard
                .insertBefore(
                    row,
                    bottomButton
                );
        }
    );
}


/* ============================================================
   RENDER UPCOMING
   ============================================================ */

function renderUpcoming(homeworkList) {

    if (!upcomingHomeworkCard) {

        return;
    }


    removeHomeworkRows(
        upcomingHomeworkCard
    );


    const bottomButton =
        upcomingHomeworkCard
            .querySelector(
                ".homework-view-all"
            );


    const visibleHomework =
        showAllUpcoming
            ? homeworkList
            : homeworkList.slice(
                0,
                4
            );


    visibleHomework.forEach(
        (homework) => {

            const row =
                createUpcomingRow(
                    homework
                );


            upcomingHomeworkCard
                .insertBefore(
                    row,
                    bottomButton
                );
        }
    );
}


/* ============================================================
   UPDATE VIEW ALL BUTTONS
   ============================================================ */

function updateViewAllButtons(groups) {


    /* ==================== ASSIGNED ==================== */

    assignedViewAllButtons.forEach(
        (button) => {

            button.style.display =
                groups.assigned.length > 4
                    ? ""
                    : "none";


            const span =
                button.querySelector(
                    "span"
                );


            if (span) {

                span.textContent =
                    showAllAssigned
                        ? "Show Less"
                        : "View All Assigned";

            }

            else {

                button.textContent =
                    showAllAssigned
                        ? "Show Less"
                        : "View All";
            }
        }
    );


    /* ==================== UPCOMING ==================== */

    upcomingViewAllButtons.forEach(
        (button) => {

            button.style.display =
                groups.upcoming.length > 4
                    ? ""
                    : "none";


            const span =
                button.querySelector(
                    "span"
                );


            if (span) {

                span.textContent =
                    showAllUpcoming
                        ? "Show Less"
                        : "View All Upcoming";

            }

            else {

                button.textContent =
                    showAllUpcoming
                        ? "Show Less"
                        : "View All";
            }
        }
    );
}


/* ============================================================
   RENDER ALL
   ============================================================ */

function renderHomework() {

    closeHomeworkMenus();


    const groups =
        getHomeworkGroups();


    renderAssigned(
        groups.assigned
    );


    renderUpcoming(
        groups.upcoming
    );


    updateViewAllButtons(
        groups
    );
}


/* ============================================================
   VIEW ALL EVENTS
   ============================================================ */

assignedViewAllButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            (event) => {

                event.preventDefault();


                showAllAssigned =
                    !showAllAssigned;


                renderHomework();
            }
        );
    }
);


upcomingViewAllButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            (event) => {

                event.preventDefault();


                showAllUpcoming =
                    !showAllUpcoming;


                renderHomework();
            }
        );
    }
);


/* ============================================================
   OPEN ADD HOMEWORK MODAL
   ============================================================ */

function openAddHomeworkModal() {

    if (!homeworkModal) {

        return;
    }


    closeHomeworkMenus();


    editingHomeworkId =
        null;


    homeworkForm?.reset();


    const today =
        getToday();


    const tomorrow =
        new Date(
            today
        );


    tomorrow.setDate(
        tomorrow.getDate() + 1
    );


    homeworkAssignDateInput.value =
        formatDateForInput(
            today
        );


    homeworkDueDateInput.value =
        formatDateForInput(
            tomorrow
        );


    homeworkDueDateInput.min =
        homeworkAssignDateInput.value;


    if (homeworkFormMessage) {

        homeworkFormMessage.textContent =
            "";
    }


    if (homeworkModalTitle) {

        homeworkModalTitle.textContent =
            "Add Homework";
    }


    if (homeworkSaveButton) {

        homeworkSaveButton.innerHTML = `

            <i class="fa-solid fa-plus"></i>

            Add Homework

        `;
    }


    homeworkModal.hidden =
        false;


    homeworkModal.classList.add(
        "active"
    );


    document.body.classList.add(
        "homework-modal-open"
    );


    setTimeout(
        () => {

            homeworkTitleInput
                ?.focus();

        },
        50
    );
}


/* ============================================================
   OPEN EDIT HOMEWORK MODAL
   ============================================================ */

function openEditHomeworkModal(homeworkId) {

    const homework =
        homeworkItems.find(
            (item) =>
                item.id === homeworkId
        );


    if (!homework) {

        return;
    }


    closeHomeworkMenus();


    editingHomeworkId =
        homework.id;


    homeworkTitleInput.value =
        homework.title;


    homeworkDescriptionInput.value =
        homework.description;


    homeworkGradeInput.value =
        homework.grade;


    homeworkClassInput.value =
        homework.className;


    homeworkAssignDateInput.value =
        homework.assignDate;


    homeworkDueDateInput.value =
        homework.dueDate;


    homeworkDueDateInput.min =
        homework.assignDate;


    if (homeworkFormMessage) {

        homeworkFormMessage.textContent =
            "";
    }


    if (homeworkModalTitle) {

        homeworkModalTitle.textContent =
            "Edit Homework";
    }


    if (homeworkSaveButton) {

        homeworkSaveButton.innerHTML = `

            <i class="fa-solid fa-floppy-disk"></i>

            Save Changes

        `;
    }


    homeworkModal.hidden =
        false;


    homeworkModal.classList.add(
        "active"
    );


    document.body.classList.add(
        "homework-modal-open"
    );


    setTimeout(
        () => {

            homeworkTitleInput
                ?.focus();

        },
        50
    );
}


/* ============================================================
   CLOSE HOMEWORK MODAL
   ============================================================ */

function closeHomeworkModal() {

    if (!homeworkModal) {

        return;
    }


    homeworkModal.classList.remove(
        "active"
    );


    homeworkModal.hidden =
        true;


    document.body.classList.remove(
        "homework-modal-open"
    );


    homeworkForm?.reset();


    if (homeworkFormMessage) {

        homeworkFormMessage.textContent =
            "";
    }


    editingHomeworkId =
        null;
}


/* ============================================================
   MODAL EVENTS
   ============================================================ */

addHomeworkButton
    ?.addEventListener(
        "click",
        openAddHomeworkModal
    );


homeworkModalClose
    ?.addEventListener(
        "click",
        closeHomeworkModal
    );


homeworkCancelButton
    ?.addEventListener(
        "click",
        closeHomeworkModal
    );


homeworkModal
    ?.addEventListener(
        "click",
        (event) => {

            if (
                event.target ===
                homeworkModal
            ) {

                closeHomeworkModal();
            }
        }
    );


document.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key === "Escape"
        ) {

            closeHomeworkMenus();


            if (
                homeworkModal &&
                !homeworkModal.hidden
            ) {

                closeHomeworkModal();
            }
        }
    }
);


/* ============================================================
   ASSIGN DATE CHANGE
   ============================================================ */

homeworkAssignDateInput
    ?.addEventListener(
        "change",
        () => {

            const assignDate =
                homeworkAssignDateInput.value;


            homeworkDueDateInput.min =
                assignDate;


            if (
                homeworkDueDateInput.value &&
                homeworkDueDateInput.value <
                    assignDate
            ) {

                homeworkDueDateInput.value =
                    assignDate;
            }
        }
    );


/* ============================================================
   ADD / EDIT SUBMIT
   ============================================================ */

homeworkForm
    ?.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();


            const title =
                homeworkTitleInput
                    .value
                    .trim();


            const description =
                homeworkDescriptionInput
                    .value
                    .trim();


            const grade =
                homeworkGradeInput.value;


            const className =
                homeworkClassInput.value;


            const assignDate =
                homeworkAssignDateInput.value;


            const dueDate =
                homeworkDueDateInput.value;


            /* ==================== VALIDATION ==================== */

            if (
                !title ||
                !description ||
                !grade ||
                !className ||
                !assignDate ||
                !dueDate
            ) {

                homeworkFormMessage.textContent =
                    "Please complete all fields.";


                return;
            }


            if (
                parseDate(dueDate) <
                parseDate(assignDate)
            ) {

                homeworkFormMessage.textContent =
                    "Due date cannot be before the assign date.";


                return;
            }


            /* ==================== EDIT EXISTING ==================== */

            if (editingHomeworkId) {

                const homework =
                    homeworkItems.find(
                        (item) =>
                            item.id ===
                            editingHomeworkId
                    );


                if (!homework) {

                    return;
                }


                homework.title =
                    title;


                homework.description =
                    description;


                homework.grade =
                    grade;


                homework.className =
                    className;


                homework.assignDate =
                    assignDate;


                homework.dueDate =
                    dueDate;

            }


            /* ==================== ADD NEW ==================== */

            else {

                const newHomework = {

                    id:
                        createHomeworkId(),

                    title:
                        title,

                    description:
                        description,

                    grade:
                        grade,

                    className:
                        className,

                    assignDate:
                        assignDate,

                    dueDate:
                        dueDate

                };


                homeworkItems.push(
                    newHomework
                );
            }


            /* ==================== SAVE ==================== */

            saveHomework();


            /* ==================== MAKE ITEM VISIBLE ==================== */

            const selectedAssignDate =
                parseDate(
                    assignDate
                );


            if (
                selectedAssignDate <=
                getToday()
            ) {

                showAllAssigned =
                    true;

            }

            else {

                showAllUpcoming =
                    true;
            }


            renderHomework();


            closeHomeworkModal();
        }
    );


/* ============================================================
   HOMEWORK ACTION MENU
   ============================================================ */


/* ==================== CLOSE MENU ==================== */

function closeHomeworkMenus() {

    document
        .querySelectorAll(
            ".homework-actions-menu"
        )
        .forEach(
            (menu) => {

                menu.remove();
            }
        );
}


/* ==================== CREATE MENU ==================== */

function openHomeworkMenu(
    moreButton
) {

    const homeworkId =
        moreButton.dataset.homeworkId;


    if (!homeworkId) {

        return;
    }


    const existingMenu =
        document.querySelector(
            `.homework-actions-menu[data-homework-id="${homeworkId}"]`
        );


    if (existingMenu) {

        closeHomeworkMenus();

        return;
    }


    closeHomeworkMenus();


    const menu =
        document.createElement(
            "div"
        );


    menu.className =
        "homework-actions-menu";


    menu.dataset.homeworkId =
        homeworkId;


    menu.innerHTML = `

        <button
            type="button"
            class="homework-menu-edit"
            data-homework-id="${homeworkId}"
        >

            <i class="fa-solid fa-pen"></i>

            <span>
                Edit
            </span>

        </button>


        <button
            type="button"
            class="homework-menu-delete"
            data-homework-id="${homeworkId}"
        >

            <i class="fa-regular fa-trash-can"></i>

            <span>
                Delete
            </span>

        </button>

    `;


    /*
        Menu is appended to BODY instead of the homework card.

        This prevents .homework-card { overflow: hidden; }
        from cutting off the dropdown.
    */

    document.body.appendChild(
        menu
    );


    /* ==================== POSITION ==================== */

    const buttonRect =
        moreButton.getBoundingClientRect();


    const menuWidth =
        menu.offsetWidth;


    const menuHeight =
        menu.offsetHeight;


    const gap =
        6;


    let left =
        buttonRect.right -
        menuWidth;


    let top =
        buttonRect.bottom +
        gap;


    /* ==================== RIGHT EDGE ==================== */

    if (
        left < 8
    ) {

        left =
            8;
    }


    /* ==================== OPEN UP IF NEEDED ==================== */

    if (
        top +
        menuHeight >
        window.innerHeight -
        8
    ) {

        top =
            buttonRect.top -
            menuHeight -
            gap;
    }


    /* ==================== TOP EDGE ==================== */

    if (
        top < 8
    ) {

        top =
            8;
    }


    /*
        Inline positioning intentionally overrides
        the absolute position values in CSS.
    */

    menu.style.position =
        "fixed";


    menu.style.left =
        `${left}px`;


    menu.style.top =
        `${top}px`;


    menu.style.right =
        "auto";


    menu.style.bottom =
        "auto";


    menu.style.zIndex =
        "9999";
}


/* ============================================================
   ACTION MENU EVENTS
   ============================================================ */

document.addEventListener(
    "click",
    (event) => {


        /* ==================== EDIT ==================== */

        const editButton =
            event.target.closest(
                ".homework-menu-edit"
            );


        if (editButton) {

            event.preventDefault();

            event.stopPropagation();


            const homeworkId =
                editButton.dataset.homeworkId;


            openEditHomeworkModal(
                homeworkId
            );


            return;
        }


        /* ==================== DELETE ==================== */

        const deleteButton =
            event.target.closest(
                ".homework-menu-delete"
            );


        if (deleteButton) {

            event.preventDefault();

            event.stopPropagation();


            const homeworkId =
                deleteButton.dataset.homeworkId;


            const homework =
                homeworkItems.find(
                    (item) =>
                        item.id === homeworkId
                );


            if (!homework) {

                closeHomeworkMenus();

                return;
            }


            closeHomeworkMenus();


            const confirmed =
                window.confirm(
                    `Delete "${homework.title}"?`
                );


            if (!confirmed) {

                return;
            }


            homeworkItems =
                homeworkItems.filter(
                    (item) =>
                        item.id !== homeworkId
                );


            saveHomework();


            renderHomework();


            return;
        }


        /* ==================== MORE BUTTON ==================== */

        const moreButton =
            event.target.closest(
                ".homework-more-button"
            );


        if (moreButton) {

            event.preventDefault();

            event.stopPropagation();


            openHomeworkMenu(
                moreButton
            );


            return;
        }


        /* ==================== CLICK OUTSIDE ==================== */

        if (
            !event.target.closest(
                ".homework-actions-menu"
            )
        ) {

            closeHomeworkMenus();
        }

    }
);


/* ============================================================
   CLOSE MENU WHEN PAGE MOVES
   ============================================================ */

window.addEventListener(
    "resize",
    closeHomeworkMenus
);


document.addEventListener(
    "scroll",
    closeHomeworkMenus,
    true
);


/* ============================================================
   INITIALIZE
   ============================================================ */

loadHomework();

renderHomework();