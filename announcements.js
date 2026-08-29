/* ==================== ANNOUNCEMENT ELEMENTS ==================== */

const announcementTabs =
    document.querySelectorAll(".announcement-tab");

const searchInput =
    document.querySelector(".announcement-search input");

const typeFilter =
    document.querySelector(".announcement-filter-select");

const dateFilter =
    document.querySelector(".announcement-date-filter");


/* ==================== FILTER ANNOUNCEMENTS ==================== */

function filterAnnouncements() {

    /* ==================== FILTER VALUES ==================== */

    const searchValue =
        searchInput.value.toLowerCase();

    const selectedType =
        typeFilter.value;

    const selectedDate =
        dateFilter.value;

    const activeTab =
        document.querySelector(".announcement-tab.active");

    const selectedStatus =
        activeTab.dataset.filter;


    /* ==================== ANNOUNCEMENT CARDS ==================== */

    const announcementCards =
        document.querySelectorAll(".announcement-card");

    announcementCards.forEach((card) => {

        /* ==================== CARD DATA ==================== */

        const cardStatus =
            card.dataset.status;

        const cardDate =
            card.dataset.date;

        const cardText =
            card.textContent.toLowerCase();

        const cardType =
            card
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

        card.style.display =
            shouldShow ? "block" : "none";

    });


    /* ==================== GROUP VISIBILITY CHECK ==================== */

    const announcementGroups =
        document.querySelectorAll(".announcement-group");

    announcementGroups.forEach((group) => {

        const cardsInGroup =
            group.querySelectorAll(".announcement-card");

        const visibleCards =
            Array.from(cardsInGroup).filter((card) => {
                return card.style.display !== "none";
            });


        /* ==================== VISIBLE CARD COUNT ==================== */

        const visibleCount =
            visibleCards.length;


        /* ==================== ANNOUNCEMENT COUNT ==================== */

        const countElement =
            group.querySelector(".announcement-count");

        countElement.textContent =
            visibleCount === 1
                ? "1 Announcement"
                : `${visibleCount} Announcements`;


        /* ==================== GROUP VISIBILITY ==================== */

        group.style.display =
            visibleCount > 0
                ? "block"
                : "none";

    });


    /* ==================== EMPTY STATE ==================== */

    const emptyState =
        document.querySelector(".announcements-empty");

    const hasVisibleGroup =
        Array.from(announcementGroups).some((group) => {
            return group.style.display !== "none";
        });

    emptyState.style.display =
        hasVisibleGroup
            ? "none"
            : "block";

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


/* ====================================================== */
/* ==================== DETAILS MODAL ==================== */
/* ====================================================== */


/* ==================== MODAL ELEMENTS ==================== */

const modal =
    document.querySelector(".announcement-modal");

const modalClose =
    document.querySelector(".announcement-modal-close");

const modalDescription =
    document.querySelector(".announcement-modal-description");

const modalType =
    document.querySelector(".announcement-modal-type");

const modalTitle =
    document.querySelector(".announcement-modal-title");

const modalTime =
    document.querySelector(".announcement-modal-time");

const modalLocation =
    document.querySelector(".announcement-modal-location");


/* ==================== OPEN DETAILS MODAL ==================== */

document.addEventListener("click", (event) => {

    const detailsButton =
        event.target.closest(".announcement-details");

    if (!detailsButton) {
        return;
    }


    /* ==================== FIND CARD ==================== */

    const card =
        detailsButton.closest(".announcement-card");


    /* ==================== GET CARD DATA ==================== */

    const cardDetails =
        card.dataset.details || "";

    const cardType =
        card
            .querySelector(".announcement-type")
            .textContent
            .trim();

    const cardTitle =
        card
            .querySelector("h3")
            .textContent
            .trim();

    const cardTime =
        card
            .querySelector(".announcement-time")
            .textContent
            .trim();

    const cardLocation =
        card
            .querySelector(".announcement-location")
            .textContent
            .trim();


    /* ==================== ADD DATA TO MODAL ==================== */

    modalType.textContent =
        cardType;

    modalTitle.textContent =
        cardTitle;

    modalTime.innerHTML = `
        <i class="fa-regular fa-clock"></i>
        ${cardTime}
    `;

    modalLocation.innerHTML = `
        <i class="fa-solid fa-location-dot"></i>
        ${cardLocation}
    `;

    modalDescription.textContent =
        cardDetails;


    /* ==================== SHOW MODAL ==================== */

    modal.style.display =
        "flex";

});


/* ==================== CLOSE DETAILS MODAL ==================== */

modalClose.addEventListener("click", () => {

    modal.style.display =
        "none";

});


/* ==================== CLOSE DETAILS MODAL ON BACKDROP ==================== */

modal.addEventListener("click", (event) => {

    if (event.target === modal) {

        modal.style.display =
            "none";

    }

});


/* ====================================================== */
/* ================ ADD ANNOUNCEMENT MODAL ============== */
/* ====================================================== */


/* ==================== ADD MODAL ELEMENTS ==================== */

const addAnnouncementButton =
    document.querySelector(".add-announcement-button");

const addAnnouncementModal =
    document.querySelector(".add-announcement-modal");

const addAnnouncementModalClose =
    document.querySelector(".add-announcement-modal-close");


/* ==================== OPEN ADD MODAL ==================== */

addAnnouncementButton.addEventListener("click", () => {

    addAnnouncementModal.style.display =
        "flex";

});


/* ==================== CLOSE ADD MODAL ==================== */

addAnnouncementModalClose.addEventListener("click", () => {

    addAnnouncementModal.style.display =
        "none";

});


/* ==================== CLOSE ADD MODAL ON BACKDROP ==================== */

addAnnouncementModal.addEventListener("click", (event) => {

    if (event.target === addAnnouncementModal) {

        addAnnouncementModal.style.display =
            "none";

    }

});


/* ==================== CLOSE MODALS WITH ESC ==================== */

document.addEventListener("keydown", (event) => {

    if (event.key === "Escape") {

        modal.style.display =
            "none";

        addAnnouncementModal.style.display =
            "none";

    }

});


/* ====================================================== */
/* ================= DELETE ANNOUNCEMENT ================= */
/* ====================================================== */

document.addEventListener("click", (event) => {

    const deleteButton =
        event.target.closest(".announcement-delete");

    if (!deleteButton) {
        return;
    }

    const card =
        deleteButton.closest(".announcement-card");

    if (!card) {
        return;
    }

    card.remove();

    filterAnnouncements();

});


/* ====================================================== */
/* ============== ADD ANNOUNCEMENT FORM ================= */
/* ====================================================== */


/* ==================== FORM ELEMENTS ==================== */

const addAnnouncementForm =
    document.querySelector(".add-announcement-form");

const announcementTitleInput =
    document.querySelector("#announcement-title");

const announcementTypeInput =
    document.querySelector("#announcement-type");

const announcementDateInput =
    document.querySelector("#announcement-date");

const announcementTimeInput =
    document.querySelector("#announcement-time");

const announcementLocationInput =
    document.querySelector("#announcement-location");

const announcementShortDescriptionInput =
    document.querySelector("#announcement-short-description");

const announcementDetailsInput =
    document.querySelector("#announcement-details");


/* ==================== ADD ANNOUNCEMENT ==================== */

addAnnouncementForm.addEventListener("submit", (event) => {

    event.preventDefault();


    /* ==================== FORM VALUES ==================== */

    const title =
        announcementTitleInput.value.trim();

    const type =
        announcementTypeInput.value;

    const date =
        announcementDateInput.value;

    const time =
        announcementTimeInput.value;

    const location =
        announcementLocationInput.value.trim();

    const shortDescription =
        announcementShortDescriptionInput.value.trim();

    const details =
        announcementDetailsInput.value.trim();


    /* ==================== TYPE LABEL ==================== */

    const typeLabels = {

        meeting: "Meeting",

        event: "School Event",

        reminder: "Reminder",

        deadline: "Deadline"

    };

    const typeLabel =
        typeLabels[type];


    /* ==================== FIND LATER GROUP ==================== */

    const laterGroup =
        Array.from(
            document.querySelectorAll(".announcement-group")
        ).find((group) => {

            const groupTitle =
                group.querySelector("h2");

            return (
                groupTitle &&
                groupTitle.textContent.trim() === "Later"
            );

        });


    /* ==================== SAFETY CHECK ==================== */

    if (!laterGroup) {

        console.error(
            "Later announcement group could not be found."
        );

        return;

    }


    /* ==================== CREATE CARD ==================== */

    const newCard =
        document.createElement("article");

    newCard.classList.add(
        "announcement-card"
    );

    newCard.dataset.status =
        "upcoming";

    newCard.dataset.date =
        date;

    newCard.dataset.details =
        details;


    /* ==================== CARD CONTENT ==================== */

    newCard.innerHTML = `

        <div class="announcement-card-line ${type}"></div>

        <div class="announcement-card-content">

            <div class="announcement-card-top">

                <div>

                    <span class="announcement-type ${type}">
                        ${typeLabel}
                    </span>

                    <h3>
                        ${title}
                    </h3>

                </div>


                <span class="announcement-time">
                    ${date} · ${time}
                </span>

            </div>


            <p class="announcement-location">

                <i class="fa-solid fa-location-dot"></i>

                ${location}

            </p>


            <p class="announcement-description">
                ${shortDescription}
            </p>


            <div class="announcement-card-bottom">

                <span class="announcement-status">
                    Upcoming
                </span>


                <div class="announcement-actions">

                    <button
                        type="button"
                        class="announcement-delete"
                    >

                        <i class="fa-solid fa-trash"></i>

                        Delete

                    </button>


                    <button
                        type="button"
                        class="announcement-details"
                    >

                        View Details

                        <i class="fa-solid fa-chevron-right"></i>

                    </button>

                </div>

            </div>

        </div>

    `;


    /* ==================== ADD CARD TO PAGE ==================== */

    laterGroup.appendChild(
        newCard
    );


    /* ==================== RESET FILTERS ==================== */

    searchInput.value =
        "";

    typeFilter.value =
        "all";

    dateFilter.value =
        "";


    /* ==================== ACTIVATE UPCOMING TAB ==================== */

    announcementTabs.forEach((tab) => {

        tab.classList.remove(
            "active"
        );

    });

    const upcomingTab =
        document.querySelector(
            '.announcement-tab[data-filter="upcoming"]'
        );

    upcomingTab.classList.add(
        "active"
    );


    /* ==================== RESET FORM ==================== */

    addAnnouncementForm.reset();


    /* ==================== CLOSE MODAL ==================== */

    addAnnouncementModal.style.display =
        "none";


    /* ==================== UPDATE PAGE ==================== */

    filterAnnouncements();

});


/* ==================== INITIAL FILTER ==================== */

filterAnnouncements();