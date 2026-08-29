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

const materialRows =
    document.querySelectorAll(".material-row");

const viewButtons =
    document.querySelectorAll(".material-view-button");


/* ==================== FILTER MATERIALS ==================== */

function filterMaterials() {

    /* ==================== FILTER VALUES ==================== */

    const searchValue =
        materialsSearch.value.toLowerCase();

    const selectedGrade =
        gradeFilter.value;

    const selectedClass =
        classFilter.value;

    const selectedType =
        typeFilter.value;


    /* ==================== MATERIAL ROWS ==================== */

    materialRows.forEach((row) => {

        /* ==================== MATERIAL DATA ==================== */

        const materialText =
            row.textContent.toLowerCase();

        const materialType =
            row
                .querySelector(".material-type-badge")
                .textContent
                .trim();

        const gradeClassSpans =
            row.querySelectorAll(".material-grade-class span");

        const materialGrade =
            gradeClassSpans[0].textContent.trim();

        const materialClass =
            gradeClassSpans[1].textContent.trim();


        /* ==================== SEARCH MATCH ==================== */

        const matchesSearch =
            materialText.includes(searchValue);


        /* ==================== GRADE MATCH ==================== */

        const matchesGrade =
            selectedGrade === "All Grades" ||
            materialGrade === selectedGrade;


        /* ==================== CLASS LETTER ==================== */

        const selectedClassLetter =
            selectedClass.replace("Class ", "");


        /* ==================== CLASS MATCH ==================== */

        const matchesClass =
            selectedClass === "All Classes" ||
            materialClass.endsWith(selectedClassLetter);


        /* ==================== TYPE MATCH ==================== */

        const matchesType =
            selectedType === "All Types" ||
            materialType === selectedType;


        /* ==================== FINAL MATCH ==================== */

        const shouldShow =
            matchesSearch &&
            matchesGrade &&
            matchesClass &&
            matchesType;


        /* ==================== ROW VISIBILITY ==================== */

        row.style.display =
            shouldShow ? "grid" : "none";

    });

}


/* ==================== SEARCH EVENT ==================== */

materialsSearch.addEventListener("input", () => {
    filterMaterials();
});


/* ==================== GRADE FILTER EVENT ==================== */

gradeFilter.addEventListener("change", () => {
    filterMaterials();
});


/* ==================== CLASS FILTER EVENT ==================== */

classFilter.addEventListener("change", () => {
    filterMaterials();
});


/* ==================== TYPE FILTER EVENT ==================== */

typeFilter.addEventListener("change", () => {
    filterMaterials();
});


/* ==================== CLEAR FILTERS ==================== */

clearFiltersButton.addEventListener("click", () => {

    materialsSearch.value = "";

    gradeFilter.value = "All Grades";

    classFilter.value = "All Classes";

    typeFilter.value = "All Types";

    filterMaterials();


});