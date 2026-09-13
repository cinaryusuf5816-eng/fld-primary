/* Shared confirmation for actions that remove saved content. */
(() => {
    'use strict';
    let active = false;

    window.FldConfirm = Object.freeze({
        ask({ title = 'Are you sure?', message = '', confirmLabel = 'Delete', danger = true } = {}) {
            // A second click must never start a second destructive request.
            if (active || !document.body) return Promise.resolve(false);
            active = true;
            return new Promise(resolve => {
                const previousFocus = document.activeElement;
                const dialog = document.createElement('dialog');
                dialog.className = 'fld-confirm';
                dialog.setAttribute('role', 'alertdialog');
                dialog.setAttribute('aria-labelledby', 'fld-confirm-title');
                dialog.setAttribute('aria-describedby', 'fld-confirm-description');
                const heading = document.createElement('h2');
                heading.id = 'fld-confirm-title';
                heading.textContent = title;
                const description = document.createElement('p');
                description.id = 'fld-confirm-description';
                description.textContent = message;
                const actions = document.createElement('div');
                actions.className = 'fld-confirm-actions';
                const cancel = document.createElement('button');
                cancel.type = 'button';
                cancel.className = 'fld-confirm-cancel';
                cancel.textContent = 'Cancel';
                cancel.autofocus = true;
                const accept = document.createElement('button');
                accept.type = 'button';
                accept.className = danger ? 'fld-confirm-accept danger' : 'fld-confirm-accept';
                accept.textContent = confirmLabel;
                actions.append(cancel, accept);
                dialog.append(heading, description, actions);

                let settled = false;
                function finish(confirmed) {
                    if (settled) return;
                    settled = true;
                    if (dialog.open) dialog.close();
                    dialog.remove();
                    active = false;
                    if (previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({ preventScroll: true });
                    resolve(confirmed);
                }
                cancel.addEventListener('click', () => finish(false));
                accept.addEventListener('click', () => finish(true));
                dialog.addEventListener('cancel', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false);
                });
                dialog.addEventListener('close', () => finish(false));
                dialog.addEventListener('click', event => {
                    if (event.target !== dialog) return;
                    const rect = dialog.getBoundingClientRect();
                    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) finish(false);
                });
                document.body.append(dialog);
                try {
                    dialog.showModal();
                    cancel.focus({ preventScroll: true });
                } catch {
                    // Failure to display a confirmation must never authorize a write.
                    finish(false);
                }
            });
        }
    });
})();
