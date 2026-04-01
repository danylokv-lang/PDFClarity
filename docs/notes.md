1. Чіткий позиціонінг
One-liner:
    “PDFClarity — перетворює робочі PDF‑документи на зрозумілі конспекти, action items та key risks за секунди.”

Для кого (v1):
    продакт/проект менеджери,
    консалтанти / аналітики,
    деви/тімліди, які читають RFC/спеки.

2. Ядро функціоналу (MVP)

Мінімальний набір, який вже можна показати людям:
    Upload PDF
    drag & drop + кнопка “Upload”.
    обмеження по розміру (наприклад, до 20–30MB) і кількості сторінок (до 50 для free).
Вибір режиму
    Summary (executive summary)
    Action items
    Key decisions / risks


Обробка
    OCR (якщо треба) → текст
    chunking + виклик LLM з чітким промптом
    збирання результату в структуровану відповідь
    Результат
        зліва: прев’ю PDF (іконка / назва / basic info),
        справа: блок із вкладками:
            Summary
            Action items
            Risks
        кнопки:
            “Copy as Markdown”
            “Export to .md”
            (пізніше “Send to Notion”)
Історія
    простий список останніх 5–10 документів для залогінених юзерів:
    назва PDF
    дата
    кнопка “відкрити результат”.
3. Структура додатку (сторінки)

Публічні:
    Landing / Home
    hero: 1–2 речення + кнопка “Try it free”
    блок “How it works” (3 кроки)
    блок “Use cases” (Managers / Consultants / Devs)
    простий блок “Pricing” (Free vs Pro)
Auth
    Sign in / Sign up (email + magic link / OAuth GitHub/Google — що простіше для тебе)
    (на старті можна навіть тільки email + одноразовий код або просто “no auth” і cookie-сесію)
App / Dashboard
    одна сторінка з двома основними зонами:
    upload + history,
    view result.

4. UX flow для користувача

Заходить на pdfclarity.site
Натискає “Try it free”
    Потрапляє на App:
        drag & drop PDF
        вибирає режим “Summary”
    Бачить:
        loader (“Analyzing your PDF…”)
        skeleton на боці результату
    Отримує:
        блок з summary (заголовок + bullet points)
        CTA: “Copy to clipboard” / “Sign up to save this document”
    Якщо реєструється:
        той же результат прив’язується до акаунту
        в sidebar з’являється “History”.

5. Архітектура простим текстом

Frontend
    Next.js (App Router)
    Сторінки:
        / — лендінг
        /app — основний інтерфейс
        /pricing — (можна inline на /)
    UI бібліотека:
        Tailwind + власні компоненти
        Icons: Lucide
    Компоненти в /app:
        UploadZone (drag & drop)
        ModeSelector (summary / actions / risks)
        ResultView (tabs + markdown/текст)
        HistoryList (список минулих обробок)
Backend
    API роут в Next.js / окремий backend (як тобі зручніше):
    POST /api/process-pdf
    приймає файл (multipart/form-data) + режим
    зберігає pdf (або тільки текст) в storage
    викликає:
        OCR (якщо треба)
        LLM з промптоми
        повертає структуру:
        json
        {
        "summary": "...",
        "actions": ["...", "..."],
        "risks": ["...", "..."]
        }
    Зберігання:
        таблиця users
        таблиця documents
        таблиця summaries
Логіка білінгу можна додати після перших юзерів (Stripe / Lemon Squeezy).

6. UI / дизайн на практиці (PDFClarity‑специфічно)
Кольори:
    bg: #F5F3F0
    surface: #FFFFFF
    surface-muted: #F0EEEA
    primary: #145DA0
    primary-hover: #0F4C81
    text-main: #111827
    text-muted: #6B7280
    border: rgba(15, 23, 42, 0.08) (тонка сіра)
Шрифти:
    Body: Inter або Satoshi
    Заголовки: той же, просто більший і жирніший (не обов’язково інший font)            
Іконки:
    Lucide: file-text, highlighter, list-todo, alert-triangle.


Подальші плани:
    Вибираєш мову перед сумарайзом на якій хочеш щоб це було перекладено.
    Пояснення особливих слів при кліку тобі пояснює що це за слово і що воно означає простими словами. 