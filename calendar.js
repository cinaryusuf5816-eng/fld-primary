/*========================CALENDAR STARTS HERE====================================*/
const supabaseUrl = "https://khhkuuuqefcwnotruzyb.supabase.co";
const supabaseKey = "sb_publishable_2dvxNBIKS4B4EuGAWZtSYA_IKjpjS8Q";
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

let events = [];

async function loadEventsFromBackend() {

    try {
        const response = await fetch(
            "http://localhost:3000/api/events"
        );

        const data = await response.json();

        console.log("Events from our backend:", data);

        events = data.map(function (event) {
            return {
                id: event.id,
                title: event.title,

                startDate: event.start_date
                    ? event.start_date.slice(0, 10)
                    : "",

                endDate: event.end_date
                    ? event.end_date.slice(0, 10)
                    : "",

                startTime: event.start_time
                    ? event.start_time.slice(0, 5)
                    : "",

                endTime: event.end_time
                    ? event.end_time.slice(0, 5)
                    : "",

                category: event.category,
                description: event.description || "",
                days: event.days
            };
        });

        renderCalendar();

    } catch (error) {
        console.error("Backend error:", error);
    }
}

async function testDatabaseConnection() {
    const { data, error } = await supabaseClient
        .from("events")
        .select("*");

    if (error) {
        console.error("Supabase error:", error);
        return;
    }

    console.log("Events from Supabase:", data);

    events = data.map(function (event) {
        return {
            id: event.id,
            title: event.title,
            startDate: event.start_date,
            endDate: event.end_date,
            startTime: event.start_time
                ? event.start_time.slice(0, 5)
                : "",
            endTime: event.end_time
                ? event.end_time.slice(0, 5)
                : "",
            category: event.category,
            description: event.description || "",
            days: event.days
        };
    });

    renderCalendar();
}


const calendarGrid = document.querySelector("#calendar-grid");

if (calendarGrid) {

    const currentMonthTitle = document.querySelector("#current-month");

    const dayModal = document.querySelector("#day-modal");
    const dayModalClose = document.querySelector("#day-modal-close");
    const dayModalDate = document.querySelector("#day-modal-date");
    const dayModalEvents = document.querySelector("#day-modal-events");
    const dayAddEventButton = document.querySelector("#day-add-event-button");

    /* ADD EVENT MODAL */
    const addEventButton = document.querySelector("#add-event-button");
    const addEventModal = document.querySelector("#add-event-modal");
    const addEventModalClose = document.querySelector("#add-event-modal-close");

    /* Add Event Form */
    const eventTitleInput = document.querySelector("#event-title");
    const eventStartDateInput = document.querySelector("#event-start-date");
    const eventEndDateInput = document.querySelector("#event-end-date");

    const eventMondayInput =
        document.querySelector("#event-monday");

    const eventTuesdayInput =
        document.querySelector("#event-tuesday");

    const eventWednesdayInput =
        document.querySelector("#event-wednesday");

    const eventThursdayInput =
        document.querySelector("#event-thursday");

    const eventFridayInput =
        document.querySelector("#event-friday");

    const eventSaturdayInput =
        document.querySelector("#event-saturday");

    const eventSundayInput =
        document.querySelector("#event-sunday");

    const selectWeekdaysButton =
        document.querySelector("#select-weekdays");

    const selectWeekendButton =
        document.querySelector("#select-weekend");

    const selectEveryDayButton =
        document.querySelector("#select-every-day");

    const eventDayShortcuts =
        document.querySelector("#event-day-shortcuts");

    const eventDaysOptions =
        document.querySelector("#event-days-options");

    const eventStartTimeInput =
        document.querySelector("#event-start-time");

    const eventEndTimeInput =
        document.querySelector("#event-end-time");

    const eventCategoryInput = document.querySelector("#event-category");
    const eventDescriptionInput = document.querySelector("#event-description");
    const saveEventButton = document.querySelector("#save-event-button");



    /* buttons */
    const previousMonthButton = document.querySelector("#previous-month");
    const todayButton = document.querySelector("#today-button");
    const nextMonthButton = document.querySelector("#next-month");

    const today = new Date();

    let currentYear = today.getFullYear();
    let currentMonth = today.getMonth();

    let selectedCalendarDate = ""; /* selected date */

    const monthNames = [
        "January", "February", "March",
        "April", "May", "June",
        "July", "August", "September",
        "October", "November", "December"
    ];

    const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ];

    function formatDateForInput(date) {

        return (
            date.getFullYear() + "-" +
            String(date.getMonth() + 1).padStart(2, "0") + "-" +
            String(date.getDate()).padStart(2, "0")
        );

    }

    /* reset */
    function resetEventForm() {

        eventTitleInput.value = "";
        eventDescriptionInput.value = "";

        eventCategoryInput.selectedIndex = 0;

        eventMondayInput.checked = true;
        eventTuesdayInput.checked = true;
        eventWednesdayInput.checked = true;
        eventThursdayInput.checked = true;
        eventFridayInput.checked = true;

        eventSaturdayInput.checked = false;
        eventSundayInput.checked = false;
    }

    selectWeekdaysButton.addEventListener("click", function () {
        eventMondayInput.checked = true;
        eventTuesdayInput.checked = true;
        eventWednesdayInput.checked = true;
        eventThursdayInput.checked = true;
        eventFridayInput.checked = true;

        eventSaturdayInput.checked = false;
        eventSundayInput.checked = false;
    });

    selectWeekendButton.addEventListener("click", function () {

        eventMondayInput.checked = false;
        eventTuesdayInput.checked = false;
        eventWednesdayInput.checked = false;
        eventThursdayInput.checked = false;
        eventFridayInput.checked = false;

        eventSaturdayInput.checked = true;
        eventSundayInput.checked = true;
    });


    selectEveryDayButton.addEventListener("click", function () {

        eventMondayInput.checked = true;
        eventTuesdayInput.checked = true;
        eventWednesdayInput.checked = true;
        eventThursdayInput.checked = true;
        eventFridayInput.checked = true;
        eventSaturdayInput.checked = true;
        eventSundayInput.checked = true;
    });

    function updateDaySelectionState() {

        const isSingleDay =
            eventStartDateInput.value === eventEndDateInput.value;

        eventMondayInput.disabled = isSingleDay;
        eventTuesdayInput.disabled = isSingleDay;
        eventWednesdayInput.disabled = isSingleDay;
        eventThursdayInput.disabled = isSingleDay;
        eventFridayInput.disabled = isSingleDay;
        eventSaturdayInput.disabled = isSingleDay;
        eventSundayInput.disabled = isSingleDay;

        selectWeekdaysButton.disabled = isSingleDay;
        selectWeekendButton.disabled = isSingleDay;
        selectEveryDayButton.disabled = isSingleDay;

        eventDaysOptions.classList.toggle(
            "disabled",
            isSingleDay
        );

        eventDayShortcuts.classList.toggle(
            "disabled",
            isSingleDay
        );
    }

    function setDefaultEventTimes(selectedDate) {

        const now = new Date();
        const todayDate = formatDateForInput(now);

        let startHour = 9;

        /* if the selected date is today */
        if (selectedDate === todayDate) {

            startHour = now.getHours() + 1;

            /* if the next hour is tomorrow */
            if (startHour >= 24) {

                startHour = 0;

                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);

                eventStartDateInput.value = formatDateForInput(tomorrow);
                eventEndDateInput.value = formatDateForInput(tomorrow);
            }
        }

        let endHour = startHour + 1;

        if (endHour >= 24) {
            endHour = 0;

            const startDate = new Date(
                eventStartDateInput.value + "T00:00:00"
            );

            startDate.setDate(startDate.getDate() + 1);

            eventEndDateInput.value = formatDateForInput(startDate);
        }

        eventStartTimeInput.value = String(startHour).padStart(2, "0") + ":00";

        eventEndTimeInput.value = String(endHour).padStart(2, "0") + ":00";
    }

    function shouldShowEventOnDate(event, dateString) {

        if (event.date) {
            return event.date === dateString;
        }

        if (
            dateString < event.startDate ||
            dateString > event.endDate
        ) {
            return false;
        }

        /* single-day event */
        if (event.startDate === event.endDate) {
            return dateString === event.startDate;
        }

        const selectedDate = new Date(
            dateString + "T00:00:00"
        );

        const dayOfWeek = selectedDate.getDay();

        if (!event.days) {
            return true;
        }

        if (dayOfWeek === 0) {
            return event.days.sunday;
        }

        if (dayOfWeek === 1) {
            return event.days.monday;
        }

        if (dayOfWeek === 2) {
            return event.days.tuesday;
        }

        if (dayOfWeek === 3) {
            return event.days.wednesday;
        }

        if (dayOfWeek === 4) {
            return event.days.thursday;
        }

        if (dayOfWeek === 5) {
            return event.days.friday;
        }

        if (dayOfWeek === 6) {
            return event.days.saturday;
        }

        return false;
    }

    /* Calendar Function */
    function renderCalendar() {

        calendarGrid.innerHTML = "";

        const today = new Date();

        const firstDay = new Date(currentYear, currentMonth, 1);

        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

        const daysInPreviousMonth = new Date(
            currentYear,
            currentMonth,
            0
        ).getDate();

        const startDay = firstDay.getDay();

        const emptyDays = (startDay + 6) % 7;

        currentMonthTitle.textContent = monthNames[currentMonth] + " " + currentYear;

        /* Previous Month Days */
        for (let i = emptyDays; i > 0; i--) {
            const day = document.createElement("div");

            day.classList.add("calendar-day");
            day.classList.add("other-month");

            const previousDayNumber = daysInPreviousMonth - i + 1;

            const previousMonthDate = new Date(
                currentYear,
                currentMonth - 1,
                previousDayNumber
            );

            const previousMonthDateString =
                formatDateForInput(previousMonthDate);

            const eventsForPreviousMonthDay = events.filter(function (event) {

                return shouldShowEventOnDate(
                    event,
                    previousMonthDateString
                );

            });

            const dayNumberText = document.createElement("span");

            dayNumberText.classList.add("day-number");
            dayNumberText.textContent = previousDayNumber;

            day.appendChild(dayNumberText);

            eventsForPreviousMonthDay.forEach(function (event) {

                const eventItem = document.createElement("div");

                const eventType = event.type || event.category;

                eventItem.classList.add("calendar-event");
                eventItem.classList.add("event-" + eventType);

                const eventTitleText = document.createElement("span");

                eventTitleText.classList.add("calendar-event-title");
                eventTitleText.textContent = event.shortTitle || event.title;

                eventItem.appendChild(eventTitleText);

                day.appendChild(eventItem);

            });

            calendarGrid.appendChild(day);
        }

        /* Current Month Days */
        for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {

            const day = document.createElement("div");
            day.classList.add("calendar-day");

            const dayNumberText = document.createElement("span");
            dayNumberText.classList.add("day-number");
            dayNumberText.textContent = dayNumber;

            day.appendChild(dayNumberText);

            /* create the date of this calendar */
            const currentDate =
                currentYear + "-" +
                String(currentMonth + 1).padStart(2, "0") + "-" +
                String(dayNumber).padStart(2, "0");

            /* find events for this day */
            const eventsForThisDay = events.filter(function (event) {

                return shouldShowEventOnDate(
                    event,
                    currentDate
                );

            });

            eventsForThisDay.sort(function (a, b) {

                const timeA = a.startTime || a.time || "99:99";
                const timeB = b.startTime || b.time || "99:99";

                return timeA.localeCompare(timeB);
            });


            /* show events in this day */
            eventsForThisDay.forEach(function (event) {

                const eventItem = document.createElement("div");

                const eventType = event.type || event.category;

                eventItem.classList.add("calendar-event");
                eventItem.classList.add("event-" + eventType);

                const eventTitleText = document.createElement("span");

                eventTitleText.classList.add("calendar-event-title");
                eventTitleText.textContent = event.shortTitle || event.title;

                eventItem.appendChild(eventTitleText);

                day.appendChild(eventItem);
            });

            day.addEventListener("click", function () {

                selectedCalendarDate = currentDate;

                dayModal.style.display = "flex";

                const selectedDate = new Date(
                    currentYear,
                    currentMonth,
                    dayNumber
                );

                dayModalDate.textContent =
                    dayNames[selectedDate.getDay()] + ", " +
                    dayNumber + " " +
                    monthNames[currentMonth] + " " +
                    currentYear;


                dayModalEvents.innerHTML = "";

                if (eventsForThisDay.length === 0) {
                    dayModalEvents.innerHTML = `
                        <p class="no-events-message">
                            No events for this day.
                        </p>
                    `;
                }

                eventsForThisDay.forEach(function (event) {

                    const modalEvent = document.createElement("div");

                    modalEvent.classList.add("modal-event");

                    const eventStartTime = event.startTime || event.time || "";
                    const eventEndTime = event.endTime || "";

                    let eventTimeText = "";

                    if (eventStartTime !== "" && eventEndTime !== "") {

                        eventTimeText =
                            eventStartTime + " - " + eventEndTime;
                    } else if (eventStartTime !== "") {

                        eventTimeText = eventStartTime;
                    }

                    modalEvent.innerHTML = `
                        <div class="modal-event-main">

                            <strong class="modal-event-title">
                                ${event.title}
                            </strong>

                            ${event.description
                            ? `<span class="modal-event-description">
                                        ${event.description}
                                    </span>`
                            : ""
                        }

                        </div>

                        ${eventTimeText
                            ? `<span class="modal-event-time">
                                    ${eventTimeText}
                                </span>`
                            : ""
                        }
                    `;

                    dayModalEvents.appendChild(modalEvent);
                });
            });

            /* today on the calendar */
            if (
                dayNumber === today.getDate() &&
                currentMonth === today.getMonth() &&
                currentYear === today.getFullYear()
            ) {
                day.classList.add("today");
            }

            calendarGrid.appendChild(day);
        }

        const totalUsedCells = emptyDays + daysInMonth;

        const remainingDays = (7 - (totalUsedCells % 7)) % 7;

        /* Next Month Days */
        for (let dayNumber = 1; dayNumber <= remainingDays; dayNumber++) {
            const day = document.createElement("div");

            day.classList.add("calendar-day");
            day.classList.add("other-month");

            const nextMonthDate = new Date(
                currentYear,
                currentMonth + 1,
                dayNumber
            );

            const nextMonthDateString = formatDateForInput(nextMonthDate);

            const eventsForNextMonthDay = events.filter(function (event) {

                return shouldShowEventOnDate(
                    event,
                    nextMonthDateString
                );

            });

            const dayNumberText = document.createElement("span");

            dayNumberText.classList.add("day-number");
            dayNumberText.textContent = dayNumber;

            day.appendChild(dayNumberText);

            eventsForNextMonthDay.forEach(function (event) {

                const eventItem = document.createElement("div");

                const eventType = event.type || event.category;

                eventItem.classList.add("calendar-event");
                eventItem.classList.add("event-" + eventType);

                const eventTitleText = document.createElement("span");

                eventTitleText.classList.add("calendar-event-title");
                eventTitleText.textContent = event.shortTitle || event.title;

                eventItem.appendChild(eventTitleText);

                day.appendChild(eventItem);

            });

            calendarGrid.appendChild(day);
        }
    }

    eventStartDateInput.addEventListener("change", function () {

        eventEndDateInput.value = eventStartDateInput.value;

        updateDaySelectionState();
    });

    eventEndDateInput.addEventListener("change", function () {

        updateDaySelectionState();
    });

    eventStartTimeInput.addEventListener("change", function () {

        if (eventStartTimeInput.value === "") {
            return;
        }

        const startHour =
            Number(eventStartTimeInput.value.split(":")[0]);

        const startMinute =
            Number(eventStartTimeInput.value.split(":")[1]);

        let endHour = startHour + 1;

        /* normal same-day event */
        if (endHour < 24) {

            eventEndTimeInput.value =
                String(endHour).padStart(2, "0") +
                ":" +
                String(startMinute).padStart(2, "0");

            return;
        }

        /* event continues after midnight */
        endHour = 0;

        eventEndTimeInput.value =
            "00:" +
            String(startMinute).padStart(2, "0");

        if (
            eventEndDateInput.value === "" ||
            eventEndDateInput.value === eventStartDateInput.value
        ) {

            const nextDay = new Date(
                eventStartDateInput.value + "T00:00:00"
            );

            nextDay.setDate(nextDay.getDate() + 1);

            eventEndDateInput.value =
                formatDateForInput(nextDay);
        }
    });

    dayAddEventButton.addEventListener("click", function () {

        resetEventForm();

        eventStartDateInput.value = selectedCalendarDate;
        eventEndDateInput.value = selectedCalendarDate;

        setDefaultEventTimes(selectedCalendarDate);
        updateDaySelectionState();

        dayModal.style.display = "none";
        addEventModal.style.display = "flex";

    });

    addEventButton.addEventListener("click", function () {

        resetEventForm();

        const todayDate = formatDateForInput(new Date());

        eventStartDateInput.value = todayDate;
        eventEndDateInput.value = todayDate;

        setDefaultEventTimes(todayDate);
        updateDaySelectionState();

        addEventModal.style.display = "flex";
    });

    addEventModalClose.addEventListener("click", function () {
        addEventModal.style.display = "none";
    });

    addEventModal.addEventListener("click", function (event) {
        if (event.target === addEventModal) {
            addEventModal.style.display = "none";
        }
    });

    saveEventButton.addEventListener("click", async function () {

        const title = eventTitleInput.value.trim();
        const startDate = eventStartDateInput.value;
        let endDate = eventEndDateInput.value;

        const days = {
            monday: eventMondayInput.checked,
            tuesday: eventTuesdayInput.checked,
            wednesday: eventWednesdayInput.checked,
            thursday: eventThursdayInput.checked,
            friday: eventFridayInput.checked,
            saturday: eventSaturdayInput.checked,
            sunday: eventSundayInput.checked
        };

        const isSingleDay = startDate === endDate;

        if (
            !isSingleDay &&
            !days.monday &&
            !days.tuesday &&
            !days.wednesday &&
            !days.thursday &&
            !days.friday &&
            !days.saturday &&
            !days.sunday
        ) {
            alert("Please select at least one day.");
            return;
        }

        const startTime = eventStartTimeInput.value;
        const endTime = eventEndTimeInput.value;

        const category = eventCategoryInput.value;
        const description = eventDescriptionInput.value;

        /* Required fields */
        if (title === "" || startDate === "") {

            alert("Please enter a title and select a start date.");
            return;

        }

        /* If End Date is empty, use Start Date */
        if (endDate === "") {
            endDate = startDate;
        }

        /* End Date cannot be before start date */
        if (endDate < startDate) {

            alert("End date cannot be before the start date.");
            return;
        }


        const newEvent = {
            title: title,
            startDate: startDate,
            endDate: endDate,

            days: days,

            startTime: startTime,
            endTime: endTime,

            category: category,
            description: description
        };

        try {
            const response = await fetch(
                "http://localhost:3000/api/events",
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify(newEvent)
                }
            );

            if (!response.ok) {
                throw new Error("Could not save event.");
            }

            await loadEventsFromBackend();

            addEventModal.style.display = "none";

        } catch (error) {
            console.error("Save event error:", error);

            alert("Could not save the event.");
        }

    });




    // close modals 
    dayModalClose.addEventListener("click", function () {
        dayModal.style.display = "none";
    });

    dayModal.addEventListener("click", function (event) {
        if (event.target === dayModal) {
            dayModal.style.display = "none";
        }
    });

    document.addEventListener("keydown", function (event) {

        if (event.key === "Escape") {
            dayModal.style.display = "none";
            addEventModal.style.display = "none";
        }

    });

    nextMonthButton.addEventListener("click", function () {

        currentMonth++;

        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        }

        renderCalendar();
    });

    previousMonthButton.addEventListener("click", function () {

        currentMonth--;

        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }
        renderCalendar();
    });

    todayButton.addEventListener("click", function () {

        const today = new Date();

        currentYear = today.getFullYear(); /* today's year */
        currentMonth = today.getMonth(); /* today's date */

        renderCalendar();
    });

    // testDatabaseConnection();
    loadEventsFromBackend();

}



/* Calendar Finishes */

