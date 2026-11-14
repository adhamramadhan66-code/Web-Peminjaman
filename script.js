/* Kalender dashboard: kalender bulan penuh (pilih tanggal -> widget "Ruang Hari Ini" ikut berubah).
   Pilihan Day/Week/Month/Year dan popup tanggal di atas kartu sudah dihapus. Berbasis waktu nyata (new Date()). */
(function () {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const $ = (id) => document.getElementById(id);

    const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let today = dayStart(new Date());
    let anchor = new Date(today);      // tanggal terpilih
    const period = 'month';            // tetap bulanan (tanpa penanda rentang di kalender)
    let mini = { y: anchor.getFullYear(), m: anchor.getMonth() };

    const same = (a, b) => a.getTime() === b.getTime();

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

    function renderMini() {
        $('calTitle').textContent = MONTHS_FULL[mini.m] + ' ' + mini.y;
        buildGrid($('miniDates'), mini, setAnchor);
    }
    function renderAll() {
        renderMini();
        // Beri tahu widget lain (mis. Ruang Hari Ini) tanggal yang sedang dipilih.
        window.kampuslyTanggal = new Date(anchor);
        window.dispatchEvent(new CustomEvent('kampusly:tanggal', { detail: { date: new Date(anchor) } }));
    }

    function setAnchor(d) {
        anchor = dayStart(d);
        mini = { y: anchor.getFullYear(), m: anchor.getMonth() };
        renderAll();
    }

    // --- kalender bulan penuh: panah bulan ---
    function shiftMini(delta) {
        const d = new Date(mini.y, mini.m + delta, 1);
        mini = { y: d.getFullYear(), m: d.getMonth() };
        renderMini();
    }
    $('calPrev').addEventListener('click', () => shiftMini(-1));
    $('calNext').addEventListener('click', () => shiftMini(1));

    // --- ganti hari otomatis saat lewat tengah malam ---
    setInterval(() => {
        const now = dayStart(new Date());
        if (!same(now, today)) { today = now; renderAll(); }
    }, 60000);

    renderAll();
})();
