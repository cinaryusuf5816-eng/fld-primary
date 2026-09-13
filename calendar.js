/*========================CALENDAR STARTS HERE====================================*/
let events = [];
function schoolCalendarDate() {
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const value = type => parts.find(part => part.type === type).value;
    return new Date(`${value('year')}-${value('month')}-${value('day')}T12:00:00`);
}
function calendarEventClass(value) { return 'event-' + String(value || 'activity').replace(/[^a-z0-9_-]/gi,'-'); }

// Event text must not execute HTML in another user's authenticated session.
function escapeEventText(value) {
    const element = document.createElement('span');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

async function loadEventsFromBackend() {

    try {
        const user = await window.FldAuth.ready;
        if (!user) return;
        const data = await window.FldAuth.request('/api/events');

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
                days: event.days,
                grades: event.grades || [],
                materials: event.materials || [],
                materialIds: event.material_ids || []
            };
        });

        renderCalendar();
        const feedback = document.getElementById('calendar-feedback');
        if (feedback) feedback.hidden = true;
        window.dispatchEvent(new Event('fld:calendarloaded'));
        return true;

    } catch (error) {
        const feedback = document.getElementById('calendar-feedback');
        if (feedback) { feedback.hidden = false; feedback.textContent = 'Calendar events could not be loaded. Reload this page to try again.'; }
        return false;
    }
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
    let canWriteEvents = false;
    let editingEventId = null;
    let calendarMaterials = [];
    let selectedMaterialIds = new Set();
    let materialLibraryReady = false;
    let savingEvent = false;

    // Backend enforces this permission even if browser controls are changed.
    addEventButton.hidden = true;
    dayAddEventButton.hidden = true;
    addEventButton.style.display = 'none';
    dayAddEventButton.style.display = 'none';
    window.FldAuth.ready.then(user => {
        const canWrite = !!user && ['admin', 'coordinator'].includes(user.role);
        canWriteEvents = canWrite;
        addEventButton.hidden = !canWrite;
        dayAddEventButton.hidden = !canWrite;
        addEventButton.style.display = canWrite ? '' : 'none';
        dayAddEventButton.style.display = canWrite ? '' : 'none';
        if (canWrite) loadMaterialLibrary();
    });

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
    const sharedAudience = document.querySelector('#event-shared');
    const gradeOptions = Array.from(document.querySelectorAll('input[name="event-grade"]'));
    const materialOptions = document.querySelector('#event-material-options');
    const materialStatus = document.querySelector('#event-material-status');
    const materialRetry = document.querySelector('#event-material-retry');
    const formMessage = document.querySelector('#event-form-message');
    function audienceGrades() { return sharedAudience.checked ? [] : gradeOptions.filter(input => input.checked).map(input => input.value); }
    function materialMatches(material) {
        const grades = material.grades || [];
        const audience = audienceGrades();
        const current = events.find(event => String(event.id) === String(editingEventId));
        const sameAudience = current && current.grades.length === audience.length && current.grades.every(grade => audience.includes(grade));
        const existingLink = sameAudience && current.materialIds.map(String).includes(String(material.id));
        return (!material.is_archived || existingLink) && (!grades.length || (audience.length > 0 && audience.every(grade => grades.includes(grade))));
    }
    function renderMaterialOptions() {
        materialOptions.replaceChildren();
        const currentEvent = events.find(event => String(event.id) === String(editingEventId));
        const choices = new Map(calendarMaterials.map(material => [String(material.id),material]));
        for (const material of currentEvent?.materials || []) if (!choices.has(String(material.id))) choices.set(String(material.id),material);
        let matching = 0;
        for (const [id,material] of choices) {
            const compatible = materialMatches(material);
            if (!compatible && !selectedMaterialIds.has(id)) continue;
            if (compatible) matching++;
            const label = document.createElement('label'); label.className = 'event-material-option';
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = id; checkbox.checked = selectedMaterialIds.has(id);
            checkbox.disabled = savingEvent || !materialLibraryReady;
            checkbox.addEventListener('change', () => { if (checkbox.checked) selectedMaterialIds.add(id); else selectedMaterialIds.delete(id); renderMaterialOptions(); });
            const copy = document.createElement('span');
            const title = document.createElement('strong'); title.textContent = material.title;
            const detail = document.createElement('small');
            detail.textContent = compatible ? `${material.kind === 'link' ? 'Link' : 'File'} · ${(material.grades || []).join(', ') || 'Shared'}${material.is_archived ? ' · Archived, existing link' : ''}` : material.is_archived ? 'Archived — keep the original audience or remove this material.' : 'Audience mismatch — remove this material or change the event audience.';
            if (!compatible) label.classList.add('incompatible');
            copy.append(title,detail); label.append(checkbox,copy); materialOptions.append(label);
        }
        if (materialLibraryReady) materialStatus.textContent = matching ? `${selectedMaterialIds.size} selected. Only materials available to the event audience are shown.` : 'No matching materials. Open Materials to upload a file or add a link for this audience.';
    }
    async function loadMaterialLibrary() {
        materialLibraryReady = false; saveEventButton.disabled = true; materialRetry.hidden = true;
        materialStatus.textContent = 'Loading the material library…';
        try {
            const response = await window.FldAuth.request('/api/materials');
            if (!Array.isArray(response.materials)) throw new Error('Invalid library response');
            calendarMaterials = response.materials; materialLibraryReady = true;
        } catch {
            materialStatus.textContent = 'The material library could not be loaded. Try again before saving.';
            materialRetry.hidden = false;
        } finally {
            saveEventButton.disabled = savingEvent || !materialLibraryReady;
            renderMaterialOptions();
        }
    }
    materialRetry.addEventListener('click', loadMaterialLibrary);
    sharedAudience.addEventListener('change', () => {
        if (sharedAudience.checked) gradeOptions.forEach(input => { input.checked = false; });
        else if (!gradeOptions.some(input => input.checked)) sharedAudience.checked = true;
        renderMaterialOptions();
    });
    gradeOptions.forEach(input => input.addEventListener('change', () => { sharedAudience.checked = !gradeOptions.some(item => item.checked); renderMaterialOptions(); }));
    window.addEventListener('fld:materialschange', () => { if (canWriteEvents && !savingEvent) loadMaterialLibrary(); });
    function showEventFormError(message) { formMessage.textContent = message; formMessage.hidden = false; }
    function editEvent(event) {
        if (!canWriteEvents || savingEvent) return;
        resetEventForm();
        editingEventId = event.id;
        document.querySelector('#event-form-heading').textContent = 'Edit Event';
        saveEventButton.textContent = 'Save Changes';
        eventTitleInput.value = event.title; eventDescriptionInput.value = event.description;
        eventStartDateInput.value = event.startDate; eventEndDateInput.value = event.endDate;
        eventStartTimeInput.value = event.startTime; eventEndTimeInput.value = event.endTime;
        if (!Array.from(eventCategoryInput.options).some(option => option.value === event.category)) {
            const option = document.createElement('option'); option.value = event.category; option.textContent = event.category; eventCategoryInput.append(option);
        }
        eventCategoryInput.value = event.category;
        for (const day of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) document.querySelector(`#event-${day}`).checked = !event.days || event.days[day] === true;
        gradeOptions.forEach(input => { input.checked = event.grades.includes(input.value); }); sharedAudience.checked = !event.grades.length;
        selectedMaterialIds = new Set(event.materialIds.map(String));
        updateDaySelectionState(); renderMaterialOptions();
        dayModal.style.display = 'none'; addEventModal.style.display = 'flex'; eventTitleInput.focus();
        loadMaterialLibrary();
    }



    /* buttons */
    const previousMonthButton = document.querySelector("#previous-month");
    const todayButton = document.querySelector("#today-button");
    const nextMonthButton = document.querySelector("#next-month");

    const today = schoolCalendarDate();
    const requestedParams = new URLSearchParams(location.search);
    const requestedDate = requestedParams.get('date') || '';
    const parsedRequestedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? new Date(`${requestedDate}T12:00:00`) : null;
    const validRequestedDate = parsedRequestedDate && Number.isFinite(parsedRequestedDate.getTime()) && formatDateForInput(parsedRequestedDate) === requestedDate;

    let currentYear = validRequestedDate ? parsedRequestedDate.getFullYear() : today.getFullYear();
    let currentMonth = validRequestedDate ? parsedRequestedDate.getMonth() : today.getMonth();

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
        editingEventId = null; selectedMaterialIds = new Set(); formMessage.hidden = true;
        document.querySelector('#event-form-heading').textContent = 'Add Event'; saveEventButton.textContent = 'Add Event';
        sharedAudience.checked = true; gradeOptions.forEach(input => { input.checked = false; });
        renderMaterialOptions();

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
                eventItem.classList.add(calendarEventClass(eventType));

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
            day.dataset.date = currentDate;

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
                eventItem.classList.add(calendarEventClass(eventType));

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
                    modalEvent.dataset.eventId = String(event.id);

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
                                ${escapeEventText(event.title)}
                            </strong>

                            ${event.description
                            ? `<span class="modal-event-description">
                                        ${escapeEventText(event.description)}
                                    </span>`
                            : ""
                        }

                        </div>

                        ${eventTimeText
                            ? `<span class="modal-event-time">
                                    ${escapeEventText(eventTimeText)}
                                </span>`
                            : ""
                        }
                    `;

                    dayModalEvents.appendChild(modalEvent);
                    const audience = document.createElement('p'); audience.className = 'event-audience-label';
                    audience.textContent = event.grades.join(', ') || 'Shared with all teachers'; modalEvent.append(audience);
                    if (event.materials.length) {
                        const library = document.createElement('div'); library.className = 'event-linked-materials';
                        const caption = document.createElement('strong'); caption.textContent = 'Materials'; library.append(caption);
                        for (const material of event.materials) {
                            const link = document.createElement('a');
                            link.textContent = `${material.title}${material.is_archived ? ' (Archived)' : ''}`;
                            link.href = `archive.html?material=${encodeURIComponent(material.id)}`;
                            library.append(link);
                        }
                        modalEvent.append(library);
                    }
                    if (canWriteEvents) {
                        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'event-edit-button'; edit.textContent = 'Edit Event';
                        edit.addEventListener('click', () => editEvent(event)); modalEvent.append(edit);
                    }
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
                eventItem.classList.add(calendarEventClass(eventType));

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
        if (!canWriteEvents || savingEvent) return;

        resetEventForm();

        eventStartDateInput.value = selectedCalendarDate;
        eventEndDateInput.value = selectedCalendarDate;

        setDefaultEventTimes(selectedCalendarDate);
        updateDaySelectionState();

        dayModal.style.display = "none";
        addEventModal.style.display = "flex";
        eventTitleInput.focus(); loadMaterialLibrary();

    });

    addEventButton.addEventListener("click", function () {
        if (!canWriteEvents || savingEvent) return;

        resetEventForm();

        const todayDate = formatDateForInput(schoolCalendarDate());

        eventStartDateInput.value = todayDate;
        eventEndDateInput.value = todayDate;

        setDefaultEventTimes(todayDate);
        updateDaySelectionState();

        addEventModal.style.display = "flex";
        eventTitleInput.focus(); loadMaterialLibrary();
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
        if (!canWriteEvents || savingEvent || !materialLibraryReady) return;
        formMessage.hidden = true;

        const title = eventTitleInput.value.trim();
        const startDate = eventStartDateInput.value;
        let endDate = eventEndDateInput.value || startDate;

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
            showEventFormError("Please select at least one day.");
            return;
        }

        const startTime = eventStartTimeInput.value;
        const endTime = eventEndTimeInput.value;

        const category = eventCategoryInput.value;
        const description = eventDescriptionInput.value;

        /* Required fields */
        if (title === "" || startDate === "") {

            showEventFormError("Please enter a title and select a start date.");
            return;

        }

        /* If End Date is empty, use Start Date */
        if (endDate === "") {
            endDate = startDate;
        }

        /* End Date cannot be before start date */
        if (endDate < startDate) {

            showEventFormError("End date cannot be before the start date.");
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
            description: description,
            grades: audienceGrades(),
            material_ids: Array.from(selectedMaterialIds)
        };
        if (newEvent.material_ids.length > 30) { showEventFormError('Choose up to 30 materials.'); return; }
        const incompatible = calendarMaterials.some(material => selectedMaterialIds.has(String(material.id)) && !materialMatches(material));
        if (incompatible) { showEventFormError('Remove archived materials and materials that do not match this event audience.'); return; }
        const idToSave = editingEventId;
        savingEvent = true;
        const controls = Array.from(document.querySelectorAll('.add-event-form input,.add-event-form select,.add-event-form textarea,.add-event-form button'));
        const priorDisabled = controls.map(control => control.disabled); controls.forEach(control => { control.disabled = true; });
        saveEventButton.textContent = 'Saving…';

        try {
            await window.FldAuth.request(
                idToSave ? `/api/events/${encodeURIComponent(idToSave)}` : '/api/events',
                {
                    method: idToSave ? 'PATCH' : 'POST',

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify(newEvent)
                }
            );

            await loadEventsFromBackend();
            window.dispatchEvent(new Event('fld:calendarchange'));

            addEventModal.style.display = "none";

        } catch (error) {
            showEventFormError(error.status === 403 ? 'You no longer have permission to edit calendar events.' : error.status === 400 || error.status === 409 ? 'Check the event dates, audience and material selection. Linked materials must be active and available to every selected grade.' : error.status === 404 ? 'The event or a selected material is no longer available. Reload the calendar and try again.' : 'The save could not be confirmed. Reload the calendar before retrying to avoid creating a duplicate event.');
        } finally {
            savingEvent = false; controls.forEach((control,index) => { control.disabled = priorDisabled[index]; });
            saveEventButton.disabled = !materialLibraryReady;
            saveEventButton.textContent = idToSave ? 'Save Changes' : 'Add Event';
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

        const today = schoolCalendarDate();

        currentYear = today.getFullYear(); /* today's year */
        currentMonth = today.getMonth(); /* today's date */

        renderCalendar();
    });

    window.addEventListener('fld:calendarloaded', async () => {
        let targetDate = validRequestedDate ? requestedDate : '';
        const linkedEvent = events.find(event => String(event.id) === requestedParams.get('event'));
        if (linkedEvent) {
            try {
                const helpers = window.FldPortalData || await window.FldPortal?.helpersReady;
                if (!helpers) throw new Error('Calendar helpers unavailable');
                targetDate = helpers.eventLinkDate({start_date:linkedEvent.startDate,end_date:linkedEvent.endDate,days:linkedEvent.days},requestedDate,helpers.schoolToday());
                if (!targetDate) {
                    const feedback = document.getElementById('calendar-feedback');
                    feedback.hidden = false; feedback.textContent = 'This event has no dates matching its selected weekdays.';
                    return;
                }
            } catch {
                const feedback = document.getElementById('calendar-feedback');
                feedback.hidden = false; feedback.textContent = 'The event link could not be opened. Reload the calendar to try again.';
                return;
            }
        }
        if (!targetDate) return;
        const target = new Date(`${targetDate}T12:00:00`);
        currentYear = target.getFullYear(); currentMonth = target.getMonth();
        renderCalendar();
        const day = Array.from(calendarGrid.querySelectorAll('[data-date]')).find(item => item.dataset.date === targetDate);
        if (!day) return;
        day.click();
        const selectedEvent = Array.from(dayModalEvents.querySelectorAll('[data-event-id]')).find(item => item.dataset.eventId === requestedParams.get('event'));
        if (selectedEvent) { selectedEvent.classList.add('portal-found-item'); selectedEvent.tabIndex = -1; selectedEvent.focus(); }
        else dayModalClose.focus();
    }, { once: true });
    loadEventsFromBackend();

}



/* Calendar Finishes */

