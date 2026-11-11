/* Kalender dashboard: popup tanggal/bulan/tahun + kalender bulan penuh.
   Semua berbasis waktu nyata (new Date()). */
(function () {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const $ = (id) => document.getElementById(id);

    const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let today = dayStart(new Date());
    let anchor = new Date(today);      // tanggal terpilih
    let period = 'month';              // day | week | month | year
    let mini = { y: anchor.getFullYear(), m: anchor.getMonth() };
    let pop  = { y: anchor.getFullYear(), m: anchor.getMonth() };

    const same = (a, b) => a.getTime() === b.getTime();
    const fmt = (d) => d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();

    function getRange() {
        const y = anchor.getFullYear(), m = anchor.getMonth(), d = anchor.getDate();
        if (period === 'day')  return [new Date(anchor), new Date(anchor)];
        if (period === 'week') return [new Date(y, m, d - anchor.getDay()), new Date(y, m, d - anchor.getDay() + 6)];
        if (period === 'year') return [new Date(y, 0, 1), new Date(y, 11, 31)];
        return [new Date(y, m, 1), new Date(y, m + 1, 0)];
    }

    function buildGrid(container, view, onPick) {
        const [rs, re] = getRange();
        const highlightRange = period === 'day' || period === 'week';
        container.textContent = '';
        const first = new Date(view.y, view.m, 1);
        const total = new Date(view.y, view.m + 1, 0).getDate();
        for (let i = 0; i < first.getDay(); i++) {
            const e = document.createElement('span');
            e.className = 'empty';
            container.appendChild(e);
        }
        for (let n = 1; n <= total; n++) {
            const date = new Date(view.y, view.m, n);
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = n;
            if (same(date, today)) b.classList.add('today');
            if (highlightRange && date >= rs && date <= re) b.classList.add('in-range');
            if (same(date, anchor)) { b.classList.add('selected'); b.setAttribute('aria-current', 'date'); }
            b.addEventListener('click', () => onPick(date));
            container.appendChild(b);
        }
    }

    function fillMonths() {
        const sel = $('monthSelect');
        if (sel.options.length) return;
        MONTHS.forEach((m, i) => sel.add(new Option(m, i)));
    }

    function fillYears() {
        const sel = $('yearSelect');
        const from = Math.min(today.getFullYear() - 10, pop.y);
        const to = Math.max(today.getFullYear() + 5, pop.y);
        if (sel.options.length && +sel.options[0].value === from && +sel.options[sel.options.length - 1].value === to) return;
        sel.textContent = '';
        for (let y = from; y <= to; y++) sel.add(new Option(y, y));
    }

    function renderMini() {
        $('calTitle').textContent = MONTHS_FULL[mini.m] + ' ' + mini.y;
        buildGrid($('miniDates'), mini, setAnchor);
    }
    function renderPopup() {
        fillMonths();
        fillYears();
        $('monthSelect').value = pop.m;
        $('yearSelect').value = pop.y;
        buildGrid($('popupDates'), pop, (d) => { setAnchor(d); closePopup(); });
    }
    function renderHeader() {
        const [s, e] = getRange();
        $('dateRangeText').textContent = same(s, e) ? fmt(s) : fmt(s) + ' - ' + fmt(e);
        document.querySelectorAll('.filter-group button').forEach((b) =>
            b.classList.toggle('active', b.dataset.period === period));
    }
    function renderAll() {
        renderHeader(); renderMini(); renderPopup();
        // Beri tahu widget lain (mis. Ruang Hari Ini) tanggal yang sedang dipilih.
        window.kampuslyTanggal = new Date(anchor);
        window.dispatchEvent(new CustomEvent('kampusly:tanggal', { detail: { date: new Date(anchor) } }));
    }

    function setAnchor(d) {
        anchor = dayStart(d);
        mini = { y: anchor.getFullYear(), m: anchor.getMonth() };
        pop = { ...mini };
        renderAll();
    }

    // --- popup buka/tutup ---
    const popup = $('datepickerPopup'), btn = $('datePickerBtn');
    function openPopup() { pop = { y: anchor.getFullYear(), m: anchor.getMonth() }; renderPopup(); popup.classList.add('show'); btn.setAttribute('aria-expanded', 'true'); }
    function closePopup() { popup.classList.remove('show'); btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', (e) => { e.stopPropagation(); popup.classList.contains('show') ? closePopup() : openPopup(); });
    popup.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closePopup);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });

    $('monthSelect').addEventListener('change', (e) => { pop.m = +e.target.value; renderPopup(); });
    $('yearSelect').addEventListener('change', (e) => { pop.y = +e.target.value; renderPopup(); });
    $('popupToday').addEventListener('click', () => { setAnchor(today); closePopup(); });

    // --- kalender bulan penuh: panah bulan ---
    function shiftMini(delta) {
        const d = new Date(mini.y, mini.m + delta, 1);
        mini = { y: d.getFullYear(), m: d.getMonth() };
        renderMini();
    }
    $('calPrev').addEventListener('click', () => shiftMini(-1));
    $('calNext').addEventListener('click', () => shiftMini(1));

    // --- Day / Week / Month / Year ---
    document.querySelectorAll('.filter-group button').forEach((b) =>
        b.addEventListener('click', () => { period = b.dataset.period; renderAll(); }));

    // --- ganti hari otomatis saat lewat tengah malam ---
    setInterval(() => {
        const now = dayStart(new Date());
        if (!same(now, today)) { today = now; renderAll(); }
    }, 60000);

    renderAll();
})();
