/* Dashboard: kartu angka + tabel agenda untuk tanggal yang dipilih di kalender. */
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    if (!$('agendaBody')) return;
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const menit = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const MAKS = 12;
    let key = '', req = 0;

    function teks(tag, t, cls) { const e = document.createElement(tag); e.textContent = t; if (cls) e.className = cls; return e; }

    function isiAgenda(items) {
        const body = $('agendaBody'); body.textContent = '';
        if (!items.length) { const tr = document.createElement('tr'), td = teks('td', 'Tidak ada agenda pada tanggal ini.'); td.colSpan = 5; tr.appendChild(td); body.appendChild(tr); return; }
        items.slice(0, MAKS).forEach((it) => {
            const tr = document.createElement('tr');
            tr.appendChild(teks('td', it.mulai + ' \u2013 ' + it.selesai));
            const a = document.createElement('td'); a.appendChild(teks('strong', it.ruang)); tr.appendChild(a);
            tr.appendChild(teks('td', it.keperluan || '-'));
            tr.appendChild(teks('td', it.peminjam || '-'));
            const j = document.createElement('td'); j.appendChild(teks('span', it.jenis === 'kuliah' ? 'KULIAH' : 'KEGIATAN', 'chip-jenis ' + it.jenis)); tr.appendChild(j);
            body.appendChild(tr);
        });
        $('agendaInfo').textContent = items.length > MAKS ? 'Menampilkan ' + MAKS + ' dari ' + items.length + ' agenda' : items.length + ' agenda';
    }

    async function muat(d) {
        const my = ++req; key = iso(d);
        const hariIni = key === iso(new Date());
        $('agendaTitle').textContent = hariIni ? 'Agenda Hari Ini' : 'Agenda ' + d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        $('kpiAgendaLabel').textContent = hariIni ? 'Agenda Hari Ini' : 'Agenda Tanggal Terpilih';
        $('kpiPakaiLabel').textContent = hariIni ? 'Sedang Dipakai' : 'Ruang Terjadwal';
        $('agendaMore').href = 'jadwal.html?tanggal=' + key;
        try {
            const [jr, rr] = await Promise.all([
                fetch('api/jadwal.php?tanggal=' + key, { cache: 'no-store' }).then((r) => r.json()),
                fetch('api/peminjaman.php?ringkas=1', { cache: 'no-store' }).then((r) => r.json()),
            ]);
            if (my !== req) return;
            if (!jr.lantai) throw new Error(jr.error || 'x');
            const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
            let ruang = 0, kuliah = 0, kegiatan = 0, pakai = 0, terjadwal = 0; const items = [];
            jr.lantai.forEach((l) => l.ruang.forEach((r) => {
                ruang++;
                if (r.jadwal.length) terjadwal++;
                if (hariIni && r.jadwal.some((j) => menit(j.mulai) <= nm && nm < menit(j.selesai))) pakai++;
                r.jadwal.forEach((j) => { if (j.jenis === 'kuliah') kuliah++; else kegiatan++; items.push(Object.assign({ ruang: r.nama }, j)); });
            }));
            items.sort((a, b) => menit(a.mulai) - menit(b.mulai) || a.ruang.localeCompare(b.ruang));
            $('kpiRuang').textContent = ruang; $('kpiRuangSub').textContent = jr.lantai.length + ' lantai / area';
            $('kpiPakai').textContent = hariIni ? pakai : terjadwal; $('kpiPakaiSub').textContent = 'dari ' + ruang + ' ruang';
            $('kpiAgenda').textContent = kuliah + kegiatan; $('kpiAgendaSub').textContent = kegiatan + ' kegiatan \u00b7 ' + kuliah + ' kuliah';
            $('kpiMenunggu').textContent = rr.menunggu != null ? rr.menunggu : '-';
            isiAgenda(items);
        } catch (err) {
            if (my !== req) return;
            const body = $('agendaBody'); body.textContent = '';
            const tr = document.createElement('tr'), td = teks('td', 'Tidak dapat memuat data. Pastikan Laragon (Apache + MySQL) berjalan.'); td.colSpan = 5; tr.appendChild(td); body.appendChild(tr);
        }
    }

    window.addEventListener('kampusly:tanggal', (e) => { if (iso(e.detail.date) !== key) muat(e.detail.date); });
    muat(window.kampuslyTanggal || new Date());
    setInterval(() => { if (!document.hidden) muat(new Date(window.kampuslyTanggal || new Date())); }, 300000);
})();
