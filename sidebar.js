/* Shared sidebar navigation and account controls. */
document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    const container = document.getElementById('sidebar-container');
    if (!container) return;
    try {
        const response = await fetch('sidebar.html');
        if (!response.ok) throw new Error('Sidebar could not be loaded.');
        container.innerHTML = await response.text();
    } catch (error) {
        console.error('Sidebar loading error:', error);
        return;
    }

    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const toggleIcon = toggle?.querySelector('i');
    const accountButton = document.getElementById('sidebar-account-button');
    const accountMenu = document.getElementById('sidebar-account-menu');
    const account = sidebar.querySelector('.sidebar-account');
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);
    const isMobile = () => window.innerWidth <= 900;

    function closeAccountMenu(restoreFocus = false) {
        accountMenu.hidden = true;
        accountButton.setAttribute('aria-expanded', 'false');
        if (restoreFocus) accountButton.focus();
    }

    function openAccountMenu(focusLink = false) {
        if (accountButton.disabled) return;
        accountMenu.hidden = false;
        accountButton.setAttribute('aria-expanded', 'true');
        if (focusLink) accountMenu.querySelector('a')?.focus();
    }

    function syncSidebar() {
        sidebar.classList.toggle('collapsed', !isMobile() && Boolean(window.FldPreferences?.read().sidebarCollapsed));
        const collapsed = sidebar.classList.contains('collapsed');
        const label = isMobile() ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar';
        if (toggleIcon) toggleIcon.className = `fa-solid ${isMobile() ? 'fa-xmark' : collapsed ? 'fa-chevron-right' : 'fa-chevron-left'}`;
        toggle?.setAttribute('aria-label', label);
        toggle?.setAttribute('title', label);
        sidebar.inert = isMobile() && !document.body.classList.contains('sidebar-mobile-open');
        const mobileButton = document.getElementById('mobile-sidebar-button');
        mobileButton?.setAttribute('aria-controls', 'sidebar');
        mobileButton?.setAttribute('aria-expanded', String(document.body.classList.contains('sidebar-mobile-open')));
    }

    function closeMobileSidebar(restoreFocus = false) {
        closeAccountMenu();
        document.body.classList.remove('sidebar-mobile-open');
        syncSidebar();
        if (restoreFocus) document.getElementById('mobile-sidebar-button')?.focus();
    }

    toggle?.addEventListener('click', () => {
        closeAccountMenu();
        if (isMobile()) {
            closeMobileSidebar(true);
            return;
        }
        window.FldPreferences?.save({ sidebarCollapsed: !sidebar.classList.contains('collapsed') });
        syncSidebar();
    });

    accountButton.addEventListener('click', () => {
        if (accountMenu.hidden) openAccountMenu();
        else closeAccountMenu();
    });
    accountButton.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openAccountMenu(true);
            if (event.key === 'ArrowUp') accountMenu.querySelector('a:last-child')?.focus();
        }
    });
    accountMenu.addEventListener('keydown', event => {
        const links = [...accountMenu.querySelectorAll('a')];
        const index = links.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            links[(index + (event.key === 'ArrowDown' ? 1 : links.length - 1)) % links.length]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            links[event.key === 'Home' ? 0 : links.length - 1]?.focus();
        }
    });

    document.addEventListener('click', event => {
        if (!account.contains(event.target)) closeAccountMenu();
        if (event.target.closest('#mobile-sidebar-button') && isMobile()) {
            document.body.classList.add('sidebar-mobile-open');
            syncSidebar();
            toggle?.focus();
        }
    });
    document.addEventListener('focusin', event => {
        if (!account.contains(event.target)) closeAccountMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (!accountMenu.hidden) {
            event.preventDefault();
            closeAccountMenu(true);
        } else if (isMobile() && document.body.classList.contains('sidebar-mobile-open')) {
            event.preventDefault();
            closeMobileSidebar(true);
        }
    });
    overlay.addEventListener('click', () => closeMobileSidebar(true));
    sidebar.addEventListener('click', event => {
        if (!event.target.closest('a')) return;
        closeAccountMenu();
        if (isMobile()) closeMobileSidebar(true);
    });
    window.addEventListener('hashchange', () => closeAccountMenu());
    window.addEventListener('resize', () => closeMobileSidebar());
    window.addEventListener('fld:preferenceschange', () => {
        closeAccountMenu();
        syncSidebar();
    });
    const currentPage = location.pathname.split('/').pop() || 'index.html';
    sidebar.querySelectorAll('.sidebar-link[data-page]').forEach(link => {
        const active = link.dataset.page === currentPage;
        link.classList.toggle('active', active);
        link.title = link.dataset.label;
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    syncSidebar();
});
