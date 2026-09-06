/* ============================================================
   FLD SIDEBAR
   ============================================================ */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        /* ============================================================
           SIDEBAR CONTAINER
           ============================================================ */

        const sidebarContainer =
            document.getElementById(
                "sidebar-container"
            );


        if (!sidebarContainer) {
            return;
        }


        /* ============================================================
           LOAD SIDEBAR
           ============================================================ */

        try {

            const response =
                await fetch(
                    "sidebar.html"
                );


            if (!response.ok) {

                throw new Error(
                    "Sidebar could not be loaded."
                );

            }


            const sidebarHtml =
                await response.text();


            sidebarContainer.innerHTML =
                sidebarHtml;

        }

        catch (error) {

            console.error(
                "Sidebar loading error:",
                error
            );

            return;
        }


        /* ============================================================
           ELEMENTS
           ============================================================ */

        const sidebar =
            document.getElementById(
                "sidebar"
            );


        const sidebarToggle =
            document.getElementById(
                "sidebar-toggle"
            );


        const sidebarToggleIcon =
            sidebarToggle
                ?.querySelector(
                    "i"
                );


        if (!sidebar) {
            return;
        }


        /* ============================================================
           OVERLAY
           ============================================================ */

        const sidebarOverlay =
            document.createElement(
                "div"
            );


        sidebarOverlay.className =
            "sidebar-overlay";


        document.body.appendChild(
            sidebarOverlay
        );


        /* ============================================================
           SETTINGS
           ============================================================ */

        const SIDEBAR_STORAGE_KEY =
            "fld-sidebar-collapsed";


        const MOBILE_BREAKPOINT =
            900;


        function isMobile() {

            return (
                window.innerWidth <=
                MOBILE_BREAKPOINT
            );

        }


        /* ============================================================
           DESKTOP TOGGLE ICON
           ============================================================ */

        function updateSidebarToggleIcon() {

            if (
                !sidebarToggleIcon ||
                !sidebarToggle
            ) {
                return;
            }


            if (isMobile()) {

                sidebarToggleIcon.className =
                    "fa-solid fa-xmark";


                sidebarToggle.setAttribute(
                    "title",
                    "Close menu"
                );


                sidebarToggle.setAttribute(
                    "aria-label",
                    "Close menu"
                );


                return;

            }


            const isCollapsed =
                sidebar.classList.contains(
                    "collapsed"
                );


            if (isCollapsed) {

                sidebarToggleIcon.className =
                    "fa-solid fa-chevron-right";


                sidebarToggle.setAttribute(
                    "title",
                    "Expand sidebar"
                );


                sidebarToggle.setAttribute(
                    "aria-label",
                    "Expand sidebar"
                );

            }

            else {

                sidebarToggleIcon.className =
                    "fa-solid fa-chevron-left";


                sidebarToggle.setAttribute(
                    "title",
                    "Collapse sidebar"
                );


                sidebarToggle.setAttribute(
                    "aria-label",
                    "Collapse sidebar"
                );

            }

        }


        /* ============================================================
           DESKTOP SAVED STATE
           ============================================================ */

        function loadDesktopSidebarState() {

            if (isMobile()) {

                sidebar.classList.remove(
                    "collapsed"
                );


                return;

            }


            const savedState =
                localStorage.getItem(
                    SIDEBAR_STORAGE_KEY
                );


            if (savedState === "true") {

                sidebar.classList.add(
                    "collapsed"
                );

            }

            else {

                sidebar.classList.remove(
                    "collapsed"
                );

            }

        }


        /* ============================================================
           OPEN MOBILE SIDEBAR
           ============================================================ */

        function openMobileSidebar() {

            if (!isMobile()) {
                return;
            }


            sidebar.classList.remove(
                "collapsed"
            );


            document.body.classList.add(
                "sidebar-mobile-open"
            );


            updateSidebarToggleIcon();

        }


        /* ============================================================
           CLOSE MOBILE SIDEBAR
           ============================================================ */

        function closeMobileSidebar() {

            document.body.classList.remove(
                "sidebar-mobile-open"
            );

        }


        /* ============================================================
           SIDEBAR TOGGLE
           ============================================================ */

        sidebarToggle
            ?.addEventListener(
                "click",
                () => {

                    if (isMobile()) {

                        closeMobileSidebar();

                        return;

                    }


                    sidebar.classList.toggle(
                        "collapsed"
                    );


                    const isCollapsed =
                        sidebar.classList.contains(
                            "collapsed"
                        );


                    localStorage.setItem(
                        SIDEBAR_STORAGE_KEY,
                        String(
                            isCollapsed
                        )
                    );


                    updateSidebarToggleIcon();

                }
            );


        /* ============================================================
           MOBILE HAMBURGER
           ============================================================ */

        document.addEventListener(
            "click",
            (event) => {

                const mobileButton =
                    event.target.closest(
                        "#mobile-sidebar-button"
                    );


                if (!mobileButton) {
                    return;
                }


                openMobileSidebar();

            }
        );


        /* ============================================================
           OVERLAY CLICK
           ============================================================ */

        sidebarOverlay.addEventListener(
            "click",
            closeMobileSidebar
        );


        /* ============================================================
           CLOSE AFTER MOBILE NAVIGATION
           ============================================================ */

        sidebar.addEventListener(
            "click",
            (event) => {

                const link =
                    event.target.closest(
                        ".sidebar-link"
                    );


                if (
                    link &&
                    isMobile()
                ) {

                    closeMobileSidebar();

                }

            }
        );


        /* ============================================================
           ACTIVE PAGE
           ============================================================ */

        let currentPage =
            window.location.pathname
                .split("/")
                .pop();


        if (!currentPage) {

            currentPage =
                "index.html";

        }


        const sidebarLinks =
            sidebar.querySelectorAll(
                ".sidebar-link[data-page]"
            );


        sidebarLinks.forEach(
            (link) => {

                if (
                    link.dataset.page ===
                    currentPage
                ) {

                    link.classList.add(
                        "active"
                    );

                }

                else {

                    link.classList.remove(
                        "active"
                    );

                }

            }
        );


        /* ============================================================
           WINDOW RESIZE
           ============================================================ */

        window.addEventListener(
            "resize",
            () => {

                closeMobileSidebar();

                loadDesktopSidebarState();

                updateSidebarToggleIcon();

            }
        );


        /* ============================================================
           INITIALIZE
           ============================================================ */

        loadDesktopSidebarState();

        updateSidebarToggleIcon();

    }
);