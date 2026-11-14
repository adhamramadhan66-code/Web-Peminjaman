/* Halaman Riwayat peminjaman: daftar pengajuan (filter, cari, halaman). Form pengajuan ada di ajukan.html.
   Akun pengguna hanya menerima pengajuannya sendiri dari server; admin menerima semuanya. */
(function () {
    'use strict';
    const { el, iso, menit, jam, tanggalPendek, dariIso, api, toast, status: setStatus } = window.KP;
    const $ = (id) => document.getElementById(id);
    const adminAwal = document.documentElement.dataset.peran === 'admin';
    // Admin fokus ke yang akan datang; pengguna melihat seluruh riwayat pengajuannya.
    const state = { status: 'semua', waktu: adminAwal ? 'mendatang' : 'semua', q: '', halaman: 1 };
    let hitung = {}, total = 0, per = 20;
    const LABEL = { semua: 'Semua', menunggu: 'Menunggu', disetujui: 'Disetujui', ditolak: 'Ditolak' };

    const params = new URLSearchParams(location.search);
    if (LABEL[params.get('status')]) state.status = params.get('status');

    // ---------- daftar ----------
    function badge(r) {
        const now = new Date();
        const lewat = r.status === 'disetujui' && (r.tanggal < iso(now) || (r.tanggal === iso(now) && menit(r.selesai) <= now.getHours() * 60 + now.getMinutes()));
        const k = lewat ? 'selesai' : r.status;
        return el('span', 'badge-st ' + k, lewat ? 'Selesai' : LABEL[r.status]);
    }

    function renderTabs() {
        const box = $('statusTabs'); box.textContent = '';
        Object.keys(LABEL).forEach((k) => {
            const b = el('button', k === state.status ? 'active' : '', LABEL[k]);
            b.type = 'button';
            b.appendChild(el('small', null, String(hitung[k] || 0)));
            b.addEventListener('click', () => { state.status = k; state.halaman = 1; muat(); });
            box.appendChild(b);
        });
    }

    const adalahAdmin = () => !!window.kampuslyUser && window.kampuslyUser.peran === 'admin';

    function aksi(r) {
        const box = el('div', 'row-act');
        if (!adalahAdmin()) return box;   // setujui / tolak / hapus hanya untuk admin (server juga menolak akun lain)
        const tombol = (cls, icon, title, fn) => {
            const b = el('button', 'ic-btn ' + cls); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
            b.innerHTML = '<i data-lucide="' + icon + '"></i>'; b.addEventListener('click', fn); box.appendChild(b);
        };
        if (r.status !== 'disetujui') tombol('ok', 'check', 'Setujui', () => kirim({ aksi: 'setujui', id: r.id }, 'Pengajuan disetujui'));
        if (r.status !== 'ditolak') {
            const batalkan = r.status === 'disetujui';         // sudah disetujui -> "dibatalkan", selain itu "ditolak"
            tombol('no', 'x', batalkan ? 'Batalkan' : 'Tolak', async () => {
                // Alasan WAJIB; server mengirimnya ke pemohon lewat menu Pesan (bila pemohon punya akun).
                const alasan = await window.KPAlasan.minta({
                    mode: batalkan ? 'batal' : 'tolak', punyaAkun: r.punya_akun,
                    info: [['Kegiatan', r.keperluan], ['Pemohon', r.peminjam], ['Ruang', r.ruang + (r.lantai ? ' \u00b7 ' + r.lantai : '')],
                           ['Waktu', tanggalPendek(dariIso(r.tanggal)) + ', ' + r.mulai + '\u2013' + r.selesai]],
                });
                if (alasan === null) return;
                kirim({ aksi: 'tolak', id: r.id, alasan }, (d) => (batalkan ? 'Peminjaman dibatalkan' : 'Pengajuan ditolak')
                    + (d.pesan_terkirim ? '. Alasan dikirim ke pemohon lewat Pesan.' : d.punya_akun ? '' : '. Pemohon tidak punya akun, alasan hanya dicatat.'));
            });
        }
        tombol('del', 'trash-2', 'Hapus', () => { if (confirm('Hapus data peminjaman ini?')) kirim({ aksi: 'hapus', id: r.id }, 'Data dihapus'); });
        return box;
    }

    function renderBaris(data) {
        const body = $('listBody'); body.textContent = '';
        if (!data.length) {
            const tr = el('tr', 'empty-row'), td = el('td', null, adalahAdmin() ? 'Belum ada pengajuan peminjaman' : 'Kamu belum pernah mengajukan peminjaman'); td.colSpan = 6;
            tr.appendChild(td); body.appendChild(tr); return;
        }
        data.forEach((r) => {
            const tr = el('tr');
            const t1 = el('td'); t1.appendChild(el('strong', null, r.ruang)); t1.appendChild(el('small', null, r.lantai));
            const t2 = el('td', 'num', tanggalPendek(dariIso(r.tanggal)));
            const t3 = el('td', 'num', r.mulai + ' \u2013 ' + r.selesai);
            const t4 = el('td'); t4.appendChild(el('strong', null, r.keperluan || '-'));
            t4.appendChild(el('small', null, r.peminjam + (r.peserta ? ' \u00b7 ' + r.peserta + ' peserta' : '') + (r.catatan && r.status !== 'disetujui' ? ' \u00b7 ' + (r.status === 'ditolak' ? 'Alasan: ' : '') + r.catatan : '')));
            const t5 = el('td'); t5.appendChild(badge(r));
            const t6 = el('td'); t6.appendChild(aksi(r));
            [t1, t2, t3, t4, t5, t6].forEach((t) => tr.appendChild(t));
            body.appendChild(tr);
        });
    }

    async function muat(senyap) {
        try {
            if (!senyap) setStatus('', 'Memuat\u2026');
            const q = new URLSearchParams({ status: state.status, waktu: state.waktu, q: state.q, halaman: state.halaman });
            const d = await api('api/peminjaman.php?' + q);
            hitung = d.hitung; total = d.total; per = d.per;
            renderTabs(); renderBaris(d.data);
            const dari = total ? (d.halaman - 1) * per + 1 : 0, sampai = Math.min(total, d.halaman * per);
            $('pagerInfo').textContent = dari + '\u2013' + sampai + ' dari ' + total + ' data';
            $('pgPrev').disabled = d.halaman <= 1; $('pgNext').disabled = sampai >= total;
            if (window.lucide) lucide.createIcons();
            setStatus('', 'Data tersinkronisasi');
        } catch (err) { setStatus('error', 'Gagal tersambung'); toast(err.message, true); }
    }

    async function kirim(payload, pesan) {
        try { const d = await api('api/peminjaman.php', payload); toast(typeof pesan === 'function' ? pesan(d) : pesan); await muat(true); }
        catch (err) { toast(err.message, true); }
    }

    $('pgPrev').addEventListener('click', () => { if (state.halaman > 1) { state.halaman--; muat(); } });
    $('pgNext').addEventListener('click', () => { state.halaman++; muat(); });
    $('fWaktu').addEventListener('change', (e) => { state.waktu = e.target.value; state.halaman = 1; muat(); });
    let tmr; $('fCari').addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { state.q = e.target.value.trim(); state.halaman = 1; muat(); }, 300); });

    $('fWaktu').value = state.waktu;
    if (!adminAwal) $('riwayatInfo').textContent = 'Seluruh pengajuan peminjamanmu dan status persetujuannya. Pengajuan orang lain tidak ditampilkan di sini.';
    muat();
})();
