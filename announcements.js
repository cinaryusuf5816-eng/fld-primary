/* ==================== ANNOUNCEMENT ELEMENTS ==================== */

const announcementTabs = document.querySelectorAll(".announcement-tab");

const searchInput = document.querySelector(".announcement-search input");

const typeFilter = document.querySelector(".announcement-filter-select");

const dateFilter = document.querySelector(".announcement-date-filter");


/* ==================== FILTER ANNOUNCEMENTS ==================== */

function filterAnnouncements() {

    /* ==================== FILTER VALUES ==================== */

    const searchValue = searchInput.value.toLowerCase();

    const selectedType = typeFilter.value;

    const selectedDate = dateFilter.value;

    const activeTab = document.querySelector(".announcement-tab.active");

    const selectedStatus = activeTab.dataset.filter;


    /* ==================== ANNOUNCEMENT CARDS ==================== */

    const announcementCards = document.querySelectorAll(".announcement-card");

    announcementCards.forEach((card) => {

        /* ==================== CARD DATA ==================== */

        const cardStatus = card.dataset.status;

        const cardDate = card.dataset.date;

        const cardText = card.textContent.toLowerCase();

        const cardType = card
            .querySelector(".announcement-type")
            .classList[1];


        /* ==================== STATUS MATCH ==================== */

        const matchesStatus =
            selectedStatus === "all" ||
            cardStatus === selectedStatus;


        /* ==================== SEARCH MATCH ==================== */

        const matchesSearch =
            cardText.includes(searchValue);


        /* ==================== TYPE MATCH ==================== */

        const matchesType =
            selectedType === "all" ||
            cardType === selectedType;


        /* ==================== DATE MATCH ==================== */

        const matchesDate =
            selectedDate === "" ||
            cardDate === selectedDate;


        /* ==================== FINAL MATCH ==================== */

        const shouldShow =
            matchesStatus &&
            matchesSearch &&
            matchesType &&
            matchesDate;


        /* ==================== CARD VISIBILITY ==================== */

        card.style.display = shouldShow ? "block" : "none";

    });


    /* ==================== GROUP VISIBILITY CHECK ==================== */

    const announcementGroups = document.querySelectorAll(".announcement-group");

    announcementGroups.forEach((group) => {

        const cardsInGroup = group.querySelectorAll(".announcement-card");

        const hasVisibleCard = Array.from(cardsInGroup).some((card) => {
            return card.style.display !== "none";
        });

        group.style.display = hasVisibleCard ? "block" : "none";

    });

}


/* ==================== ANNOUNCEMENT TABS ==================== */

announcementTabs.forEach((tab) => {

    tab.addEventListener("click", () => {

        announcementTabs.forEach((item) => {
            item.classList.remove("active");
        });

        tab.classList.add("active");

        filterAnnouncements();

    });

});


/* ==================== SEARCH INPUT EVENT ==================== */

searchInput.addEventListener("input", () => {

    filterAnnouncements();

});


/* ==================== TYPE FILTER EVENT ==================== */

typeFilter.addEventListener("change", () => {

    filterAnnouncements();

});


/* ==================== DATE FILTER EVENT ==================== */

dateFilter.addEventListener("change", () => {

    filterAnnouncements();

});


/* ==================== INITIAL FILTER ==================== */

filterAnnouncements();