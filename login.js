/* ============================================================
   FLD LOGIN
   ARAYÜZ VE GERÇEK API BAĞLANTI NOKTASI

   Kullanıcı doğrulamasını backend yapmalıdır.
   Şifre veya oturum token'ı tarayıcı depolamasına yazılmaz.
   ============================================================ */

(() => {
    "use strict";

    /* ==================== ELEMENTS ==================== */

    const form = document.querySelector("#login-form");

    if (!form) {
        return;
    }

    const emailInput =
        document.querySelector("#login-email");

    const passwordInput =
        document.querySelector("#login-password");

    const rememberInput =
        document.querySelector("#remember-email");

    const passwordToggle =
        document.querySelector("#toggle-password");

    const submitButton =
        document.querySelector("#login-submit");

    const submitText =
        document.querySelector("#login-submit-text");

    const spinner =
        document.querySelector(".login-spinner");

    const submitArrow =
        document.querySelector(".login-submit-arrow");

    const message =
        document.querySelector("#login-message");

    const capsWarning =
        document.querySelector("#caps-warning");


    /* ==================== STATE ==================== */

    const EMAIL_KEY = "fld-login-email";

    let busy = false;


    /* ==================== API ADDRESS ==================== */

    /*
        Live Server kullanırken:
        http://127.0.0.1:5500 → http://127.0.0.1:3000

        localhost kullanıyorsan:
        http://localhost:5500 → http://localhost:3000

        Yayında:
        aynı site adresi üzerinden /api/auth/...
    */

    const configuredBase =
        document.querySelector(
            'meta[name="fld-api-base"]'
        )?.content.trim();

    const apiBase = (
        configuredBase ||
        (
            location.protocol === "http:" &&
            location.port === "5500"

                ? `${location.protocol}//${location.hostname}:3000`

                : location.origin
        )
    ).replace(/\/$/, "");


    /* ==================== MESSAGE ==================== */

    function showMessage(text, tone = "error") {
        message.textContent = text;
        message.dataset.tone = tone;
    }

    if (new URLSearchParams(location.search).get('password') === 'changed') {
        showMessage('Password changed. Sign in with your new password.', 'success');
        history.replaceState(null, '', location.pathname);
    }


    /* ==================== LOADING STATE ==================== */

    function setBusy(value) {
        busy = value;

        submitButton.disabled = value;

        form.setAttribute(
            "aria-busy",
            String(value)
        );

        spinner.hidden = !value;
        submitArrow.hidden = value;

        submitText.textContent = value
            ? "Signing in…"
            : "Sign In";
    }


    /* ==================== REMEMBER EMAIL ==================== */

    /*
        Yalnızca e-posta hatırlanır.
        Şifre kaydedilmez.
    */

    try {
        const savedEmail =
            localStorage.getItem(EMAIL_KEY);

        if (savedEmail) {
            emailInput.value = savedEmail;
            rememberInput.checked = true;
        }
    } catch {
        /*
            Tarayıcı depolaması kapalıysa
            giriş formu yine kullanılabilir.
        */
    }

    rememberInput.addEventListener("change", () => {
        if (!rememberInput.checked) {
            try {
                localStorage.removeItem(EMAIL_KEY);
            } catch {
                // E-postayı hatırlamak isteğe bağlıdır.
            }
        }
    });


    /* ==================== SHOW / HIDE PASSWORD ==================== */

    passwordToggle.addEventListener("click", () => {
        const show =
            passwordInput.type === "password";

        passwordInput.type = show
            ? "text"
            : "password";

        passwordToggle.setAttribute(
            "aria-pressed",
            String(show)
        );

        passwordToggle.setAttribute(
            "aria-label",
            show
                ? "Hide password"
                : "Show password"
        );
    });


    /* ==================== CAPS LOCK ==================== */

    passwordInput.addEventListener("keyup", (event) => {
        capsWarning.hidden =
            !event.getModifierState("CapsLock");
    });

    passwordInput.addEventListener("blur", () => {
        capsWarning.hidden = true;
    });


    /* ==================== CLEAR INPUT ERRORS ==================== */

    for (const input of [emailInput, passwordInput]) {
        input.addEventListener("input", () => {
            input.removeAttribute("aria-invalid");

            if (!busy) {
                message.textContent = "";
            }
        });
    }


    /* ============================================================
       API REQUEST
       ============================================================ */

    async function request(path, options = {}) {
        const controller = new AbortController();

        const timeout = setTimeout(() => {
            controller.abort();
        }, 15000);

        try {
            const response = await fetch(
                `${apiBase}${path}`,
                {
                    ...options,

                    credentials: "include",

                    cache: "no-store",

                    headers: {
                        Accept: "application/json",
                        ...options.headers
                    },

                    signal: controller.signal
                }
            );

            const json =
                response.headers
                    .get("content-type")
                    ?.includes("application/json");

            let data = null;

            if (json) {
                try {
                    data = await response.json();
                } catch {
                    throw new Error(
                        "The sign-in service returned an unreadable response. Please try again."
                    );
                }
            }


            /* ==================== HTTP ERRORS ==================== */

            if (!response.ok) {
                const messages = {
                    400:
                        "Check your email address and password.",

                    401:
                        "The email address or password is incorrect.",

                    403:
                        "This account cannot sign in. Contact your school administrator.",

                    404:
                        "The sign-in service is unavailable. Contact your school administrator.",

                    429:
                        "Too many sign-in attempts. Please wait and try again."
                };

                throw new Error(
                    messages[response.status] ||
                    "The sign-in service is not responding. Please try again later."
                );
            }

            if (!data) {
                throw new Error(
                    "The server returned an unexpected sign-in response. Contact your school administrator."
                );
            }

            return data;

        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error(
                    "The connection timed out. Please try again."
                );
            }

            if (error instanceof TypeError) {
                throw new Error(
                    "The sign-in server could not be reached. Check your connection and try again."
                );
            }

            throw error;

        } finally {
            clearTimeout(timeout);
        }
    }


    /* ============================================================
       FORM SUBMIT
       ============================================================ */

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (busy) {
            return;
        }

        message.textContent = "";

        emailInput.value =
            emailInput.value.trim();


        /* ==================== VALIDATION ==================== */

        if (!form.checkValidity()) {
            const invalidInput =
                form.querySelector(":invalid");

            invalidInput?.setAttribute(
                "aria-invalid",
                "true"
            );

            showMessage(
                "Enter a valid email address and your password."
            );

            form.reportValidity();

            return;
        }


        /* ==================== LOCAL FILE CHECK ==================== */

        if (location.protocol === "file:") {
            showMessage(
                "Start the local website and open its address in your browser."
            );

            return;
        }


        /* ==================== HTTPS CHECK ==================== */

        const localHosts = [
            "localhost",
            "127.0.0.1",
            "[::1]"
        ];

        if (
            location.protocol !== "https:" &&
            !localHosts.includes(location.hostname)
        ) {
            showMessage(
                "Use a secure HTTPS address to sign in from another device."
            );

            return;
        }


        /* ==================== CAPTURE VALUES ==================== */

        const email = emailInput.value;

        const rememberEmail =
            rememberInput.checked;

        setBusy(true);


        try {
            /* ==================== LOGIN REQUEST ==================== */

            await request("/api/auth/login", {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    email,
                    password: passwordInput.value
                })
            });


            /* ==================== VERIFY SESSION ==================== */

            /*
                Sunucunun oturum cookie'sini tanıdığını kontrol et.
                Yalnızca login cevabına bakıp yönlendirme yapma.
            */

            const session =
                await request("/api/auth/me");

            if (
                session.authenticated !== true ||
                !session.user?.id
            ) {
                throw new Error(
                    "Your session could not be verified. Contact your school administrator."
                );
            }


            /* ==================== REMEMBER EMAIL ==================== */

            try {
                if (rememberEmail) {
                    localStorage.setItem(
                        EMAIL_KEY,
                        email
                    );
                } else {
                    localStorage.removeItem(EMAIL_KEY);
                }
            } catch {
                // E-postanın hatırlanamaması girişi engellemez.
            }


            /* ==================== SUCCESS ==================== */

            passwordInput.value = "";

            showMessage(
                "Sign-in successful. Redirecting…",
                "success"
            );

            location.replace("index.html");

        } catch (error) {
            showMessage(
                error.message ||
                "Sign-in failed. Please try again."
            );

        } finally {
            setBusy(false);
        }
    });
})();
