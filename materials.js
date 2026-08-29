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
    document.querySelectorAll(".materails-date-buttons button");

const clearFiltersButton =
    document.querySelector(".clear-material-filters");
    
const materialRows =
    document.querySelector(".material-row");
    
const viewButtons =
    document.querySelectorAll(".material-view-button");    

/* ==================== FILTER MATERIALS ==================== */

function filterMaterials() {

        /* ==================== SEARCH VALUE ==================== */
    const searchValue =
        materialsSearch.value.toLowerCase();

    const selectedGrade =
        gradeFilter.value;

    const selectedClass =
        classFilter.value;
        
    const selectedType =
        typeFilter.value;    
}