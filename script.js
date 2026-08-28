
// ==================== SIDEBAR ====================

const sidebarContainer = document.getElementById("sidebar-container");

if (sidebarContainer) {

    fetch("sidebar.html")
        .then(response => response.text())
        .then(data => {
            sidebarContainer.innerHTML = data;
        });

}

// ==================== TOPBAR ====================

const topbarContainer = document.getElementById("topbar-container");

if (topbarContainer) {
    fetch("topbar.html")
        .then(response => response.text())
        .then(data => {
            topbarContainer.innerHTML = data;
        });
}

// =============== ===== Sidebar permanent ====================

let greeting = document.getElementById("greeting");

if (greeting) {

    let hour = new Date().getHours();

    if (hour < 6) {
        greeting.textContent = "Good Night, Kuzey 🌙";
    }
    else if (hour < 12) {
        greeting.textContent = "Good Morning, Kuzey 👋";
    }
    else if (hour < 18) {
        greeting.textContent = "Good Afternoon, Kuzey 👋";
    }
    else if (hour < 22) {
        greeting.textContent = "Good Evening, Kuzey 👋";
    }
    else {
        greeting.textContent = "Good Night, Kuzey 🌙";
    }

}
const dashboardPage = document.querySelector(".dashboard-content");

if (dashboardPage) {

    // ==================== CURRENT DATE ====================

    let currentDate = document.getElementById("current-date");

    let date = new Date();

    let dayNumber = date.getDate();
    let monthNumber = date.getMonth();
    let year = date.getFullYear();
    let dayOfWeekNumber = date.getDay();

    let months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December"
    ];

    let days = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ];

    let monthName = months[monthNumber];
    let dayName = days[dayOfWeekNumber];

    let dateText =
        dayName + ", " +
        dayNumber + " " +
        monthName + " " +
        year;

    currentDate.textContent = dateText;

    // ==================== TODAY'S PLAN====================
    const tasks = [
        {
            grade: "Grade 3",
            topic: "Past Simple",
            status: "Completed"
        },
        {
            grade: "Grade 2",
            topic: "Speaking Activity",
            status: "In Progress"
        },
        {
            grade: "Grade 3",
            topic: "Reading Practice",
            status: "Pending"
        }
    ];

    let todayPlanList = document.getElementById("today-plan-list");



    tasks.forEach(function (task) {

        let planItem = document.createElement("div");

        planItem.classList.add("plan-item");

        let statusClass = "";

        if (task.status === "Completed") {
            statusClass = "completed";
        }
        else if (task.status === "In Progress") {
            statusClass = "progress";
        }
        else {
            statusClass = "pending";
        }


        planItem.innerHTML = `
        <div class="plan-left">
            <i class="fa-solid fa-circle"></i>

            <div>
                <h3>${task.grade}</h3>
                <p>${task.topic}</p>
            </div>
        </div>

        <span class="plan-status ${statusClass}">
            ${task.status}
        </span>
        
    `;

        todayPlanList.appendChild(planItem);
    });

    // Displays the number of tasks in Today's Plan on the summary card
    let todayTaskCount = document.getElementById("today-task-count");

    todayTaskCount.textContent = tasks.length;


    // ==================== HOMEWORK TO ASSIGN ====================

    const homeworks = [
        {
            grade: "Grade 3",
            title: "Workbook pages 28-29",
            dueDate: "Friday"
        },
        {
            grade: "Grade 2",
            title: "Reading Worksheet",
            dueDate: "Monday"
        },

        {
            grade: "Grade 3",
            title: "Vocabulary Practice",
            dueDate: "Tuesday"
        }
    ];

    let homeworkList = document.getElementById("homework-list");

    homeworks.forEach(function (homework) {

        let homeworkItem = document.createElement("div");
        homeworkItem.classList.add("homework-item");


        homeworkItem.innerHTML = `
   <div>
        <h3>${homework.grade}</h3>
        <p>${homework.title}</p>
   </div>
   
   <span>${homework.dueDate}</span>

`;

        homeworkList.appendChild(homeworkItem);
    });


    // ==================== ANNOUNCEMENTS ====================

    const announcements = [
        {
            title: "Department Meeting",
            description: "English Department meeting will be held after school",
            date: "15 August"
        },
        {
            title: "Exam Preparation",
            description: "Grade 3 exam materials should be completed this week",
            date: "18 August"
        }
    ];

    const announcementList = document.getElementById("announcement-list");

    announcements.forEach(function (announcement) {

        const announcementItem = document.createElement("div");

        announcementItem.classList.add("announcement-item");



        announcementItem.innerHTML = `
    <div>
        <h3>${announcement.title}</h3>
        <span>${announcement.date}</span>
    </div>
       <p>${announcement.description}</p>    
`;

        announcementList.appendChild(announcementItem);

    });

    // ==================== RECENT MATERIALS ====================

    const materials = [
        {
            title: "Past Simple Worksheet",
            type: "PDF",
            grade: "Grade 3",
            date: "Today"
        },
        {
            title: "Unit 3 Presentation",
            type: "PowerPoint",
            grade: "Grade 3",
            date: "Yesterday"
        },
        {
            title: "Speaking Worksheet",
            type: "Word",
            grade: "Grade 2",
            date: "11 August"
        }
    ];

    const materialList = document.getElementById("material-list");

    materials.forEach(function (material) {

        const materialItem = document.createElement("div");

        materialItem.classList.add("material-item");

        materialItem.innerHTML = `
        <div>
            <h3>${material.title}</h3>
            <p>${material.grade}</p>
        </div>

        <span>${material.date}</span>
    `;

        materialList.appendChild(materialItem);
    });

    // Displays the number of materials on the summary card
    const materialCount = document.getElementById("material-count");
    materialCount.textContent = materials.length;




}



