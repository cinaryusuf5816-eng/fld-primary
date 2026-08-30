/* ============================================================
   MATERIALS PAGE
   ============================================================ */


/* ==================== MATERIAL ELEMENTS ==================== */

const materialsSearch =
    document.querySelector(".materials-search input");

const gradeFilter =
    document.querySelector("#material-grade");

const classFilter =
    document.querySelector("#material-class");

const typeFilter =
    document.querySelector("#material-type");

const quickDateButtons =
    document.querySelectorAll(".materials-date-buttons button");

const clearFiltersButton =
    document.querySelector(".clear-material-filters");

const viewButtons =
    document.querySelectorAll(".material-view-button");

const sortFilter =
    document.querySelector(".materials-table-actions select");

const materialsTableHeader =
    document.querySelector(".materials-table-header");

const materialsTable =
    document.querySelector(".materials-table");

const materialsCount =
    document.querySelector(".materials-table-title span");

const materialsFooter =
    document.querySelector(".materials-table-footer");

const materialsFooterText =
    document.querySelector(".materials-footer-text");

const paginationContainer =
    document.querySelector(".materials-pagination");

const uploadArea =
    document.querySelector(".material-upload-area");

const uploadInput =
    document.querySelector("#material-upload-input");

const viewAllRecentUploads =
    document.querySelector(".view-all-recent-uploads");

const dateFilterButton =
    document.querySelector(".materials-date-filter");


/* ==================== MATERIAL ROWS ==================== */

function getMaterialRows() {

    return Array.from(
        document.querySelectorAll(".material-row")
    );

}


/* ==================== MATERIAL CONTAINER ==================== */

const firstMaterialRow =
    document.querySelector(".material-row");

const materialsContainer =
    firstMaterialRow
        ? firstMaterialRow.parentElement
        : null;


/* ==================== PAGE STATE ==================== */

let selectedDateFilter = "all";

let customStartDate = null;

let customEndDate = null;

let currentView = "list";

let currentPage = 1;

const materialsPerPage = 8;


/* ============================================================
   EMPTY STATE
   ============================================================ */

const emptyState =
    document.createElement("div");

emptyState.className =
    "materials-empty-state";

emptyState.innerHTML = `

    <i class="fa-regular fa-folder-open"></i>

    <h3>
        No materials found
    </h3>

    <p>
        Try changing your search or filters.
    </p>

`;

emptyState.style.display =
    "none";


if (
    materialsContainer &&
    materialsFooter
) {

    materialsContainer.insertBefore(
        emptyState,
        materialsFooter
    );

}


/* ============================================================
   DATE RANGE PANEL
   ============================================================ */

let dateRangePanel =
    null;


if (dateFilterButton) {

    dateRangePanel =
        document.createElement("div");

    dateRangePanel.className =
        "materials-date-range-panel";


    dateRangePanel.innerHTML = `

        <div class="materials-date-field">

            <label for="materials-start-date">
                From
            </label>

            <input
                type="date"
                id="materials-start-date"
            >

        </div>


        <div class="materials-date-field">

            <label for="materials-end-date">
                To
            </label>

            <input
                type="date"
                id="materials-end-date"
            >

        </div>


        <div class="materials-date-actions">

            <button
                type="button"
                class="materials-date-clear"
            >
                Clear
            </button>


            <button
                type="button"
                class="materials-date-apply"
            >
                Apply
            </button>

        </div>

    `;


    document.body.appendChild(
        dateRangePanel
    );

}


/* ============================================================
   DATE HELPER
   ============================================================ */

function parseMaterialDate(dateString) {

    if (!dateString) {
        return null;
    }


    const parts =
        dateString
            .split("-")
            .map(Number);


    if (parts.length !== 3) {
        return null;
    }


    const year =
        parts[0];

    const month =
        parts[1];

    const day =
        parts[2];


    const date =
        new Date(
            year,
            month - 1,
            day
        );


    date.setHours(
        0,
        0,
        0,
        0
    );


    return date;

}


/* ============================================================
   MATERIAL DATA HELPER
   ============================================================ */

function getMaterialData(row) {

    /* ==================== FULL TEXT ==================== */

    const materialText =
        row
            .textContent
            .toLowerCase();


    /* ==================== TYPE ==================== */

    const typeBadge =
        row.querySelector(
            ".material-type-badge"
        );


    let materialType =
        "";


    if (typeBadge) {

        if (
            typeBadge.classList.contains("pdf")
        ) {

            materialType =
                "PDF";

        }


        else if (
            typeBadge.classList.contains("docx")
        ) {

            materialType =
                "Word";

        }


        else if (
            typeBadge.classList.contains("pptx")
        ) {

            materialType =
                "PowerPoint";

        }


        else if (
            typeBadge.classList.contains("xlsx")
        ) {

            materialType =
                "Excel";

        }


        else if (
            typeBadge.classList.contains("image")
        ) {

            materialType =
                "Image";

        }

    }


    /* ==================== GRADE / CLASS ==================== */

    const gradeClassSpans =
        row.querySelectorAll(
            ".material-grade-class span"
        );


    const materialGrade =
        gradeClassSpans[0]
            ?.textContent
            .trim() || "";


    const materialClass =
        gradeClassSpans[1]
            ?.textContent
            .trim() || "";


    /* ==================== DATE ==================== */

    const materialDate =
        parseMaterialDate(
            row.dataset.date
        );


    /* ==================== MATERIAL TITLE ==================== */

    const materialName =
        row
            .querySelector(".material-title")
            ?.textContent
            .trim() || "";


    /* ==================== FILE NAME ==================== */

    const fileName =
        row
            .querySelector(
                ".material-name-info p"
            )
            ?.textContent
            .trim() || "";


    return {

        materialText,
        materialType,
        materialGrade,
        materialClass,
        materialDate,
        materialName,
        fileName

    };

}


/* ============================================================
   START OF WEEK
   ============================================================ */

function getStartOfWeek(date) {

    const start =
        new Date(date);


    const day =
        start.getDay();


    const difference =
        day === 0
            ? -6
            : 1 - day;


    start.setDate(
        start.getDate() +
        difference
    );


    start.setHours(
        0,
        0,
        0,
        0
    );


    return start;

}


/* ============================================================
   FILTER MATERIALS
   ============================================================ */

function getFilteredMaterials() {

    const rows =
        getMaterialRows();


    /* ==================== FILTER VALUES ==================== */

    const searchValue =
        materialsSearch
            ?.value
            .toLowerCase()
            .trim() || "";


    const selectedGrade =
        gradeFilter?.value ||
        "All Grades";


    const selectedClass =
        classFilter?.value ||
        "All Classes";


    const selectedType =
        typeFilter?.value ||
        "All Types";


    /* ==================== TODAY ==================== */

    const today =
        new Date();


    today.setHours(
        0,
        0,
        0,
        0
    );


    /* ==================== FILTER ==================== */

    return rows.filter((row) => {

        const data =
            getMaterialData(row);


        /* ==================== SEARCH MATCH ==================== */

        const matchesSearch =
            data.materialText.includes(
                searchValue
            );


        /* ==================== GRADE MATCH ==================== */

        const matchesGrade =
            selectedGrade === "All Grades" ||
            data.materialGrade === selectedGrade;


        /* ==================== CLASS MATCH ==================== */

        const selectedClassLetter =
            selectedClass.replace(
                "Class ",
                ""
            );


        const matchesClass =
            selectedClass === "All Classes" ||
            data.materialClass.endsWith(
                selectedClassLetter
            );


        /* ==================== TYPE MATCH ==================== */

        const matchesType =
            selectedType === "All Types" ||
            data.materialType === selectedType;


        /* ==================== DATE MATCH ==================== */

        let matchesDate =
            true;


        /* ---------- INVALID DATE ---------- */

        if (!data.materialDate) {

            matchesDate =
                selectedDateFilter ===
                "all";

        }


        /* ---------- TODAY ---------- */

        if (
            data.materialDate &&
            selectedDateFilter === "today"
        ) {

            matchesDate =
                data.materialDate.getTime() ===
                today.getTime();

        }


        /* ---------- THIS WEEK ---------- */

        if (
            data.materialDate &&
            selectedDateFilter === "week"
        ) {

            const startOfWeek =
                getStartOfWeek(
                    today
                );


            const endOfWeek =
                new Date(
                    startOfWeek
                );


            endOfWeek.setDate(
                endOfWeek.getDate() +
                6
            );


            matchesDate =
                data.materialDate >= startOfWeek &&
                data.materialDate <= endOfWeek;

        }


        /* ---------- THIS MONTH ---------- */

        if (
            data.materialDate &&
            selectedDateFilter === "month"
        ) {

            matchesDate =

                data.materialDate.getMonth() ===
                    today.getMonth() &&

                data.materialDate.getFullYear() ===
                    today.getFullYear();

        }


        /* ---------- THIS YEAR ---------- */

        if (
            data.materialDate &&
            selectedDateFilter === "year"
        ) {

            matchesDate =

                data.materialDate.getFullYear() ===
                today.getFullYear();

        }


        /* ---------- CUSTOM RANGE ---------- */

        if (
            data.materialDate &&
            selectedDateFilter === "custom" &&
            customStartDate &&
            customEndDate
        ) {

            matchesDate =

                data.materialDate >=
                    customStartDate &&

                data.materialDate <=
                    customEndDate;

        }


        /* ==================== FINAL MATCH ==================== */

        return (

            matchesSearch &&
            matchesGrade &&
            matchesClass &&
            matchesType &&
            matchesDate

        );

    });

}


/* ============================================================
   SORT MATERIALS
   ============================================================ */

function getSortedMaterials(rows) {

    const sortValue =
        sortFilter?.value ||
        "Newest";


    return [...rows].sort(
        (firstRow, secondRow) => {

            const first =
                getMaterialData(
                    firstRow
                );


            const second =
                getMaterialData(
                    secondRow
                );


            /* ==================== NEWEST ==================== */

            if (
                sortValue === "Newest"
            ) {

                return (

                    (
                        second.materialDate
                            ?.getTime() || 0
                    )

                    -

                    (
                        first.materialDate
                            ?.getTime() || 0
                    )

                );

            }


            /* ==================== OLDEST ==================== */

            if (
                sortValue === "Oldest"
            ) {

                return (

                    (
                        first.materialDate
                            ?.getTime() || 0
                    )

                    -

                    (
                        second.materialDate
                            ?.getTime() || 0
                    )

                );

            }


            /* ==================== NAME A-Z ==================== */

            if (
                sortValue === "Name A-Z"
            ) {

                return first.materialName
                    .localeCompare(
                        second.materialName
                    );

            }


            /* ==================== NAME Z-A ==================== */

            if (
                sortValue === "Name Z-A"
            ) {

                return second.materialName
                    .localeCompare(
                        first.materialName
                    );

            }


            return 0;

        }
    );

}


/* ============================================================
   RENDER MATERIALS
   ============================================================ */

function renderMaterials() {

    const allRows =
        getMaterialRows();


    /* ==================== FILTER ==================== */

    const filteredRows =
        getFilteredMaterials();


    /* ==================== SORT ==================== */

    const sortedRows =
        getSortedMaterials(
            filteredRows
        );


    /* ==================== TOTAL PAGES ==================== */

    const totalPages =
        Math.ceil(
            sortedRows.length /
            materialsPerPage
        );


    if (
        totalPages > 0 &&
        currentPage > totalPages
    ) {

        currentPage =
            totalPages;

    }


    if (
        totalPages === 0
    ) {

        currentPage =
            1;

    }


    /* ==================== PAGE RANGE ==================== */

    const startIndex =
        (
            currentPage - 1
        ) *
        materialsPerPage;


    const endIndex =
        startIndex +
        materialsPerPage;


    const pageRows =
        sortedRows.slice(
            startIndex,
            endIndex
        );


    /* ==================== HIDE ALL MATERIALS ==================== */

    allRows.forEach((row) => {

        row.style.display =
            "none";

    });


    /* ==================== REORDER ==================== */

    sortedRows.forEach((row) => {

        if (
            materialsContainer &&
            materialsFooter
        ) {

            materialsContainer.insertBefore(
                row,
                materialsFooter
            );

        }

    });


    /* ==================== SHOW PAGE ROWS ==================== */

    pageRows.forEach((row) => {

        row.style.display =
            currentView === "list"
                ? "grid"
                : "block";

    });


    /* ==================== EMPTY STATE ==================== */

    if (
        filteredRows.length === 0
    ) {

        emptyState.style.display =
            "flex";

    }

    else {

        emptyState.style.display =
            "none";

    }


    /* ==================== MATERIAL COUNT ==================== */

    if (materialsCount) {

        materialsCount.textContent =
            `(${filteredRows.length})`;

    }


    /* ==================== FOOTER ==================== */

    updateFooter(
        filteredRows.length,
        startIndex,
        pageRows.length
    );


    /* ==================== PAGINATION ==================== */

    renderPagination(
        totalPages
    );


    /* ==================== OVERVIEW ==================== */

    updateMaterialOverview();

}


/* ============================================================
   FOOTER
   ============================================================ */

function updateFooter(
    total,
    startIndex,
    pageLength
) {

    if (!materialsFooterText) {

        return;

    }


    /* ==================== NO RESULTS ==================== */

    if (
        total === 0
    ) {

        /*
            No second empty message.

            The big empty state already says:
            "No materials found"
        */

        materialsFooterText.textContent =
            "";

        materialsFooterText.style.display =
            "none";

        return;

    }


    /* ==================== SHOW FOOTER ==================== */

    materialsFooterText.style.display =
        "block";


    const first =
        startIndex + 1;


    const last =
        startIndex +
        pageLength;


    materialsFooterText.textContent =
        `Showing ${first} to ${last} of ${total} materials`;

}


/* ============================================================
   PAGINATION
   ============================================================ */

function renderPagination(totalPages) {

    if (!paginationContainer) {

        return;

    }


    paginationContainer.innerHTML =
        "";


    /* ==================== ONE PAGE ONLY ==================== */

    if (
        totalPages <= 1
    ) {

        return;

    }


    /* ==================== PREVIOUS ==================== */

    const previous =
        document.createElement(
            "button"
        );


    previous.type =
        "button";


    previous.innerHTML =
        `<i class="fa-solid fa-chevron-left"></i>`;


    previous.disabled =
        currentPage === 1;


    previous.addEventListener(
        "click",
        () => {

            if (
                currentPage > 1
            ) {

                currentPage--;

                renderMaterials();

            }

        }
    );


    paginationContainer.appendChild(
        previous
    );


    /* ==================== PAGE NUMBERS ==================== */

    for (
        let page = 1;
        page <= totalPages;
        page++
    ) {

        const button =
            document.createElement(
                "button"
            );


        button.type =
            "button";


        button.textContent =
            page;


        if (
            page === currentPage
        ) {

            button.classList.add(
                "active"
            );

        }


        button.addEventListener(
            "click",
            () => {

                currentPage =
                    page;


                renderMaterials();

            }
        );


        paginationContainer.appendChild(
            button
        );

    }


    /* ==================== NEXT ==================== */

    const next =
        document.createElement(
            "button"
        );


    next.type =
        "button";


    next.innerHTML =
        `<i class="fa-solid fa-chevron-right"></i>`;


    next.disabled =
        currentPage === totalPages;


    next.addEventListener(
        "click",
        () => {

            if (
                currentPage < totalPages
            ) {

                currentPage++;

                renderMaterials();

            }

        }
    );


    paginationContainer.appendChild(
        next
    );

}


/* ============================================================
   SEARCH EVENT
   ============================================================ */

materialsSearch?.addEventListener(
    "input",
    () => {

        currentPage =
            1;


        renderMaterials();

    }
);


/* ============================================================
   GRADE FILTER EVENT
   ============================================================ */

gradeFilter?.addEventListener(
    "change",
    () => {

        currentPage =
            1;


        renderMaterials();

    }
);


/* ============================================================
   CLASS FILTER EVENT
   ============================================================ */

classFilter?.addEventListener(
    "change",
    () => {

        currentPage =
            1;


        renderMaterials();

    }
);


/* ============================================================
   TYPE FILTER EVENT
   ============================================================ */

typeFilter?.addEventListener(
    "change",
    () => {

        currentPage =
            1;


        renderMaterials();

    }
);


/* ============================================================
   SORT EVENT
   ============================================================ */

sortFilter?.addEventListener(
    "change",
    () => {

        currentPage =
            1;


        renderMaterials();

    }
);


/* ============================================================
   QUICK DATE FILTERS
   ============================================================ */

quickDateButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                /* ==================== REMOVE ACTIVE ==================== */

                quickDateButtons.forEach(
                    (item) => {

                        item.classList.remove(
                            "active"
                        );

                    }
                );


                /* ==================== ADD ACTIVE ==================== */

                button.classList.add(
                    "active"
                );


                /* ==================== BUTTON TEXT ==================== */

                const text =
                    button
                        .textContent
                        .trim();


                /* ==================== FILTER STATE ==================== */

                if (
                    text === "Today"
                ) {

                    selectedDateFilter =
                        "today";

                }


                if (
                    text === "This Week"
                ) {

                    selectedDateFilter =
                        "week";

                }


                if (
                    text === "This Month"
                ) {

                    selectedDateFilter =
                        "month";

                }


                if (
                    text === "This Year"
                ) {

                    selectedDateFilter =
                        "year";

                }


                customStartDate =
                    null;


                customEndDate =
                    null;


                currentPage =
                    1;


                updateDateButtonText();


                renderMaterials();

            }
        );

    }
);


/* ============================================================
   CLEAR FILTERS
   ============================================================ */

clearFiltersButton?.addEventListener(
    "click",
    () => {

        /* ==================== SEARCH ==================== */

        if (materialsSearch) {

            materialsSearch.value =
                "";

        }


        /* ==================== GRADE ==================== */

        if (gradeFilter) {

            gradeFilter.value =
                "All Grades";

        }


        /* ==================== CLASS ==================== */

        if (classFilter) {

            classFilter.value =
                "All Classes";

        }


        /* ==================== TYPE ==================== */

        if (typeFilter) {

            typeFilter.value =
                "All Types";

        }


        /* ==================== DATE STATE ==================== */

        selectedDateFilter =
            "all";


        customStartDate =
            null;


        customEndDate =
            null;


        /* ==================== QUICK DATE BUTTONS ==================== */

        quickDateButtons.forEach(
            (button) => {

                button.classList.remove(
                    "active"
                );

            }
        );


        /* ==================== DATE INPUTS ==================== */

        const startInput =
            document.querySelector(
                "#materials-start-date"
            );


        const endInput =
            document.querySelector(
                "#materials-end-date"
            );


        if (startInput) {

            startInput.value =
                "";

        }


        if (endInput) {

            endInput.value =
                "";

        }


        /* ==================== PAGE ==================== */

        currentPage =
            1;


        updateDateButtonText();


        renderMaterials();

    }
);


/* ============================================================
   DATE FILTER BUTTON
   ============================================================ */

dateFilterButton?.addEventListener(
    "click",
    (event) => {

        event.stopPropagation();


        if (!dateRangePanel) {

            return;

        }


        const rectangle =
            dateFilterButton
                .getBoundingClientRect();


        dateRangePanel.style.top =
            `${
                rectangle.bottom +
                window.scrollY +
                8
            }px`;


        dateRangePanel.style.left =
            `${
                rectangle.left +
                window.scrollX
            }px`;


        dateRangePanel.classList.toggle(
            "active"
        );

    }
);


/* ============================================================
   APPLY CUSTOM DATE RANGE
   ============================================================ */

document.addEventListener(
    "click",
    (event) => {

        const applyButton =
            event.target.closest(
                ".materials-date-apply"
            );


        if (!applyButton) {

            return;

        }


        const startInput =
            document.querySelector(
                "#materials-start-date"
            );


        const endInput =
            document.querySelector(
                "#materials-end-date"
            );


        if (
            !startInput?.value ||
            !endInput?.value
        ) {

            return;

        }


        customStartDate =
            new Date(
                `${startInput.value}T00:00:00`
            );


        customEndDate =
            new Date(
                `${endInput.value}T00:00:00`
            );


        /* ==================== SWAP WRONG RANGE ==================== */

        if (
            customStartDate >
            customEndDate
        ) {

            const temporary =
                customStartDate;


            customStartDate =
                customEndDate;


            customEndDate =
                temporary;

        }


        selectedDateFilter =
            "custom";


        quickDateButtons.forEach(
            (button) => {

                button.classList.remove(
                    "active"
                );

            }
        );


        currentPage =
            1;


        updateDateButtonText();


        dateRangePanel.classList.remove(
            "active"
        );


        renderMaterials();

    }
);


/* ============================================================
   CLEAR CUSTOM DATE RANGE
   ============================================================ */

document.addEventListener(
    "click",
    (event) => {

        const clearButton =
            event.target.closest(
                ".materials-date-clear"
            );


        if (!clearButton) {

            return;

        }


        customStartDate =
            null;


        customEndDate =
            null;


        selectedDateFilter =
            "all";


        const startInput =
            document.querySelector(
                "#materials-start-date"
            );


        const endInput =
            document.querySelector(
                "#materials-end-date"
            );


        if (startInput) {

            startInput.value =
                "";

        }


        if (endInput) {

            endInput.value =
                "";

        }


        dateRangePanel
            ?.classList
            .remove(
                "active"
            );


        updateDateButtonText();


        renderMaterials();

    }
);


/* ============================================================
   CLOSE DATE PANEL
   ============================================================ */

document.addEventListener(
    "click",
    (event) => {

        if (
            !dateRangePanel ||
            !dateFilterButton
        ) {

            return;

        }


        if (
            !dateRangePanel.contains(
                event.target
            ) &&
            !dateFilterButton.contains(
                event.target
            )
        ) {

            dateRangePanel.classList.remove(
                "active"
            );

        }

    }
);


/* ============================================================
   DATE BUTTON TEXT
   ============================================================ */

function updateDateButtonText() {

    const span =
        dateFilterButton
            ?.querySelector("span");


    if (!span) {

        return;

    }


    /* ==================== CUSTOM ==================== */

    if (
        selectedDateFilter === "custom" &&
        customStartDate &&
        customEndDate
    ) {

        const format =
            new Intl.DateTimeFormat(
                "en-US",
                {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                }
            );


        span.textContent =
            `${format.format(customStartDate)} - ${format.format(customEndDate)}`;


        return;

    }


    /* ==================== TODAY ==================== */

    if (
        selectedDateFilter === "today"
    ) {

        span.textContent =
            "Today";

        return;

    }


    /* ==================== WEEK ==================== */

    if (
        selectedDateFilter === "week"
    ) {

        span.textContent =
            "This Week";

        return;

    }


    /* ==================== MONTH ==================== */

    if (
        selectedDateFilter === "month"
    ) {

        span.textContent =
            "This Month";

        return;

    }


    /* ==================== YEAR ==================== */

    if (
        selectedDateFilter === "year"
    ) {

        span.textContent =
            "This Year";

        return;

    }


    /* ==================== ALL ==================== */

    span.textContent =
        "All Dates";

}


/* ============================================================
   VIEW TOGGLE
   ============================================================ */

viewButtons.forEach(
    (button, index) => {

        button.addEventListener(
            "click",
            () => {

                /* ==================== ACTIVE BUTTON ==================== */

                viewButtons.forEach(
                    (item) => {

                        item.classList.remove(
                            "active"
                        );

                    }
                );


                button.classList.add(
                    "active"
                );


                /* ==================== LIST VIEW ==================== */

                if (
                    index === 0
                ) {

                    currentView =
                        "list";


                    materialsContainer
                        ?.classList
                        .remove(
                            "materials-grid-view"
                        );


                    materialsTableHeader
                        ?.classList
                        .remove(
                            "hidden"
                        );

                }


                /* ==================== GRID VIEW ==================== */

                if (
                    index === 1
                ) {

                    currentView =
                        "grid";


                    materialsContainer
                        ?.classList
                        .add(
                            "materials-grid-view"
                        );


                    materialsTableHeader
                        ?.classList
                        .add(
                            "hidden"
                        );

                }


                renderMaterials();

            }
        );

    }
);


/* ============================================================
   MATERIALS OVERVIEW
   ============================================================ */

function updateMaterialOverview() {

    const overviewNumbers =
        document.querySelectorAll(
            ".material-overview-number"
        );


    if (
        overviewNumbers.length < 3
    ) {

        return;

    }


    const rows =
        getMaterialRows();


    const today =
        new Date();


    today.setHours(
        0,
        0,
        0,
        0
    );


    const startOfWeek =
        getStartOfWeek(
            today
        );


    const endOfWeek =
        new Date(
            startOfWeek
        );


    endOfWeek.setDate(
        endOfWeek.getDate() +
        6
    );


    let weekCount =
        0;


    let monthCount =
        0;


    rows.forEach((row) => {

        const date =
            getMaterialData(row)
                .materialDate;


        if (!date) {

            return;

        }


        /* ==================== THIS WEEK ==================== */

        if (
            date >= startOfWeek &&
            date <= endOfWeek
        ) {

            weekCount++;

        }


        /* ==================== THIS MONTH ==================== */

        if (
            date.getMonth() ===
                today.getMonth() &&

            date.getFullYear() ===
                today.getFullYear()
        ) {

            monthCount++;

        }

    });


    /* ==================== TOTAL ==================== */

    overviewNumbers[0].textContent =
        rows.length;


    /* ==================== WEEK ==================== */

    overviewNumbers[1].textContent =
        weekCount;


    /* ==================== MONTH ==================== */

    overviewNumbers[2].textContent =
        monthCount;

}


/* ============================================================
   RECENT UPLOADS — VIEW ALL
   ============================================================ */

viewAllRecentUploads
    ?.addEventListener(
        "click",
        () => {

            /* ==================== CLEAR SEARCH ==================== */

            if (materialsSearch) {

                materialsSearch.value =
                    "";

            }


            /* ==================== CLEAR GRADE ==================== */

            if (gradeFilter) {

                gradeFilter.value =
                    "All Grades";

            }


            /* ==================== CLEAR CLASS ==================== */

            if (classFilter) {

                classFilter.value =
                    "All Classes";

            }


            /* ==================== CLEAR TYPE ==================== */

            if (typeFilter) {

                typeFilter.value =
                    "All Types";

            }


            /* ==================== CLEAR DATE ==================== */

            selectedDateFilter =
                "all";


            customStartDate =
                null;


            customEndDate =
                null;


            quickDateButtons.forEach(
                (button) => {

                    button.classList.remove(
                        "active"
                    );

                }
            );


            currentPage =
                1;


            updateDateButtonText();


            renderMaterials();


            /* ==================== SCROLL ==================== */

            materialsTable
                ?.scrollIntoView({

                    behavior: "smooth",

                    block: "start"

                });

        }
    );


/* ============================================================
   UPLOAD AREA CLICK
   ============================================================ */

uploadArea?.addEventListener(
    "click",
    (event) => {

        /*
            Label zaten native olarak input'u açıyor.
            Label'a tıklandıysa tekrar input.click() yapmıyoruz.
        */

        if (
            event.target.closest("label")
        ) {

            return;

        }


        uploadInput?.click();

    }
);


/* ============================================================
   FILE SELECTED
   ============================================================ */

uploadInput?.addEventListener(
    "change",
    () => {

        const file =
            uploadInput.files[0];


        if (!file) {

            return;

        }


        let status =
            uploadArea.querySelector(
                ".material-upload-status"
            );


        /* ==================== CREATE STATUS ==================== */

        if (!status) {

            status =
                document.createElement(
                    "div"
                );


            status.className =
                "material-upload-status";


            uploadArea.appendChild(
                status
            );

        }


        /* ==================== STATUS CONTENT ==================== */

        status.innerHTML = `

            <strong>
                ${escapeHtml(file.name)}
            </strong>

            <span>
                File selected — backend upload will be connected later.
            </span>

        `;

    }
);


/* ============================================================
   MATERIAL MORE MENU
   ============================================================ */

document.addEventListener(
    "click",
    (event) => {

        const moreButton =
            event.target.closest(
                ".material-more-button"
            );


        if (!moreButton) {

            return;

        }


        event.stopPropagation();


        const row =
            moreButton.closest(
                ".material-row"
            );


        if (!row) {

            return;

        }


        /* ==================== EXISTING MENU ==================== */

        const existingMenu =
            row.querySelector(
                ".material-actions-menu"
            );


        const wasOpen =
            existingMenu
                ?.classList
                .contains(
                    "active"
                );


        /* ==================== CLOSE OTHERS ==================== */

        closeMaterialMenus();


        if (wasOpen) {

            return;

        }


        let menu =
            existingMenu;


        /* ==================== CREATE MENU ==================== */

        if (!menu) {

            menu =
                document.createElement(
                    "div"
                );


            menu.className =
                "material-actions-menu";


            menu.innerHTML = `

                <button
                    type="button"
                    data-material-action="view"
                >

                    <i class="fa-regular fa-eye"></i>

                    <span>
                        View
                    </span>

                </button>


                <button
                    type="button"
                    data-material-action="open"
                >

                    <i class="fa-solid fa-arrow-up-right-from-square"></i>

                    <span>
                        Open
                    </span>

                </button>


                <button
                    type="button"
                    data-material-action="rename"
                >

                    <i class="fa-solid fa-pen"></i>

                    <span>
                        Rename
                    </span>

                </button>


                <div
                    class="material-menu-divider"
                ></div>


                <button
                    type="button"
                    class="danger"
                    data-material-action="delete"
                >

                    <i class="fa-regular fa-trash-can"></i>

                    <span>
                        Delete
                    </span>

                </button>

            `;


            row.appendChild(
                menu
            );

        }


        /* ==================== OPEN MENU ==================== */

        menu.classList.add(
            "active"
        );

    }
);


/* ============================================================
   CLOSE MATERIAL MENUS
   ============================================================ */

function closeMaterialMenus() {

    document
        .querySelectorAll(
            ".material-actions-menu"
        )
        .forEach((menu) => {

            menu.classList.remove(
                "active"
            );

        });

}


/* ============================================================
   CLICK OUTSIDE MENU
   ============================================================ */

document.addEventListener(
    "click",
    (event) => {

        if (
            !event.target.closest(
                ".material-actions-menu"
            ) &&
            !event.target.closest(
                ".material-more-button"
            )
        ) {

            closeMaterialMenus();

        }

    }
);


/* ============================================================
   DOWNLOAD BUTTON
   ============================================================ */

document.addEventListener(
    "click",
    (event) => {

        const downloadButton =
            event.target.closest(
                ".material-download-button"
            );


        if (!downloadButton) {

            return;

        }


        const row =
            downloadButton.closest(
                ".material-row"
            );


        downloadMaterial(
            row
        );

    }
);


/* ============================================================
   DOWNLOAD MATERIAL
   ============================================================ */

function downloadMaterial(row) {

    const fileUrl =
        row?.dataset.file;


    if (!fileUrl) {

        window.alert(
            "This material does not have a file path yet."
        );


        return;

    }


    const link =
        document.createElement(
            "a"
        );


    link.href =
        fileUrl;


    link.download =
        "";


    document.body.appendChild(
        link
    );


    link.click();


    link.remove();

}


/* ============================================================
   MATERIAL ACTION EVENTS
   ============================================================ */

document.addEventListener(
    "click",
    (event) => {

        const actionButton =
            event.target.closest(
                "[data-material-action]"
            );


        if (!actionButton) {

            return;

        }


        event.stopPropagation();


        const action =
            actionButton.dataset
                .materialAction;


        const row =
            actionButton.closest(
                ".material-row"
            );


        if (!row) {

            return;

        }


        /* ==================== VIEW ==================== */

        if (
            action === "view"
        ) {

            viewMaterial(
                row
            );

        }


        /* ==================== OPEN ==================== */

        if (
            action === "open"
        ) {

            openMaterial(
                row
            );

        }


        /* ==================== RENAME ==================== */

        if (
            action === "rename"
        ) {

            renameMaterial(
                row
            );

        }


        /* ==================== DELETE ==================== */

        if (
            action === "delete"
        ) {

            deleteMaterial(
                row
            );

        }


        closeMaterialMenus();

    }
);


/* ============================================================
   VIEW MATERIAL
   ============================================================ */

function viewMaterial(row) {

    const fileUrl =
        row.dataset.file;


    if (!fileUrl) {

        window.alert(
            "This material does not have a file path yet."
        );


        return;

    }


    /*
        Frontend prototype:
        View şimdilik yeni sekmede açıyor.

        Daha sonra bunu preview modal yapabiliriz.
    */

    window.open(
        fileUrl,
        "_blank"
    );

}


/* ============================================================
   OPEN MATERIAL
   ============================================================ */

function openMaterial(row) {

    const fileUrl =
        row.dataset.file;


    if (!fileUrl) {

        window.alert(
            "This material does not have a file path yet."
        );


        return;

    }


    window.open(
        fileUrl,
        "_blank",
        "noopener"
    );

}


/* ============================================================
   RENAME MATERIAL
   ============================================================ */

function renameMaterial(row) {

    const titleElement =
        row.querySelector(
            ".material-title"
        );


    if (!titleElement) {

        return;

    }


    const oldName =
        titleElement
            .textContent
            .trim();


    const newName =
        window.prompt(
            "Rename material:",
            oldName
        );


    if (
        !newName ||
        !newName.trim()
    ) {

        return;

    }


    /*
        Sadece başlığı değiştiriyoruz.

        .material-name alanının tamamını değiştirmiyoruz.
        Böylece icon ve filename kaybolmuyor.
    */

    titleElement.textContent =
        newName.trim();


    renderMaterials();

}


/* ============================================================
   DELETE MATERIAL
   ============================================================ */

function deleteMaterial(row) {

    const name =
        row
            .querySelector(
                ".material-title"
            )
            ?.textContent
            .trim() ||

        "this material";


    const confirmed =
        window.confirm(
            `Delete "${name}"?`
        );


    if (!confirmed) {

        return;

    }


    /*
        Şimdilik frontend delete.

        Refresh sonrası geri gelir.
        Backend geldiğinde gerçek DB delete olacak.
    */

    row.remove();


    currentPage =
        1;


    renderMaterials();

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
   INITIALIZE
   ============================================================ */

updateDateButtonText();

renderMaterials();