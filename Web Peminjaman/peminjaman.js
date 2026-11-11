/* Halaman Peminjaman: daftar pengajuan (filter, cari, halaman) + form "Ajukan ruang". */
(function () {
    'use strict';
    const { el, iso, menit, jam, tanggalPendek, dariIso, api, toast, status: setStatus } = window.KP;
    const $ = (id) => document.getElementById(id);
    const state = { status: 'semua', waktu: 'mendatang', q: '', halaman: 1 };
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
            const tr = el('tr', 'empty-row'), td = el('td', null, 'Belum ada pengajuan peminjaman'); td.colSpan = 6;
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

    // ---------- form ----------
    function tampilError(msg) { const b = $('formErr'); b.textContent = msg || ''; b.classList.toggle('show', !!msg); }

    // Pemilih ruang: menampilkan ruang yang KOSONG / DIPAKAI pada tanggal + jam yang dipilih.
    let dataRuang = null, pilih = +(params.get('ruang') || 0), reqTgl = 0;
    const cekTumpang = (a1, a2, b1, b2) => a1 < b2 && a2 > b1;

    function statusRuang(r, m1, m2) {
        const bentrok = r.jadwal.find((j) => cekTumpang(m1, m2, menit(j.mulai), menit(j.selesai)));
        if (bentrok) return { k: 'busy', j: bentrok };
        const tunggu = r.menunggu.find((j) => cekTumpang(m1, m2, menit(j.mulai), menit(j.selesai)));
        if (tunggu) return { k: 'pend', j: tunggu };
        return { k: 'free' };
    }

    /** Jam belum diisi / belum benar: semua ruang tetap ditampilkan (tanpa status kosong/dipakai) supaya bisa dipilih lebih dulu. */
    function renderTanpaJam(box, petunjuk) {
        box.appendChild(el('p', 'pick-note', petunjuk));
        let jumlah = 0;
        dataRuang.lantai.forEach((l) => {
            if (!l.ruang.length) return;
            box.appendChild(el('div', 'pick-floor', l.nama));
            const grid = el('div', 'pick-grid');
            l.ruang.forEach((r) => {
                jumlah++;
                const b = el('button', 'rp netral' + (r.id === pilih ? ' sel' : '')); b.type = 'button';
                b.appendChild(el('b', null, r.nama || 'Ruang tanpa nama'));
                const n = r.jadwal.length;
                b.appendChild(el('span', null, n ? n + ' jadwal pada tanggal ini' : 'Belum ada jadwal'));
                b.title = n ? r.nama + ': ' + r.jadwal.map((j) => j.mulai + '\u2013' + j.selesai + ' ' + (j.keperluan || '')).join('; ')
                            : r.nama + ': belum ada jadwal pada tanggal ini';
                b.addEventListener('click', () => { pilih = r.id; tampilError(''); renderPilih(); });
                grid.appendChild(b);
            });
            box.appendChild(grid);
        });
        $('pickSum').textContent = jumlah + ' ruang';
    }

    function renderPilih() {
        const box = $('roomPick'); box.textContent = '';
        const legenda = document.querySelector('.pick-legend'); if (legenda) legenda.style.display = '';
        if (!dataRuang) { box.appendChild(el('p', 'pick-note', 'Memuat ketersediaan ruang\u2026')); return; }
        const m1 = $('fMulai').value ? menit($('fMulai').value) : -1, m2 = $('fSelesai').value ? menit($('fSelesai').value) : -1;
        const sekarangMnt = new Date().getHours() * 60 + new Date().getMinutes();
        if (m2 > m1 && $('fTanggal').value === iso(new Date()) && m2 <= sekarangMnt) {
            box.appendChild(el('p', 'pick-note', 'Jam ini sudah lewat (sekarang ' + jam(sekarangMnt) + '). Pilih jam yang masih akan datang.')); $('pickSum').textContent = ''; return;
        }
        if (m1 < 0 || m2 <= m1) {
            if (legenda) legenda.style.display = 'none';   // status kosong/dipakai belum berlaku sebelum jam lengkap
            renderTanpaJam(box, m1 >= 0 && m2 >= 0 ? 'Jam selesai harus setelah jam mulai.' : 'Isi jam mulai dan jam selesai untuk menyaring ruang yang kosong pada jam itu.');
            return;
        }
        let kosong = 0, dipakai = 0, terpilihOk = false;
        dataRuang.lantai.forEach((l) => {
            const items = l.ruang.map((r) => ({ r, st: statusRuang(r, m1, m2) }));
            items.forEach((x) => { if (x.st.k === 'busy') dipakai++; else kosong++; if (x.r.id === pilih && x.st.k !== 'busy') terpilihOk = true; });
            const tampil = items.filter((x) => x.st.k !== 'busy');   // hanya ruang kosong yang ditampilkan
            if (!tampil.length) return;
            box.appendChild(el('div', 'pick-floor', l.nama));
            const grid = el('div', 'pick-grid');
            tampil.forEach(({ r, st }) => {
                const b = el('button', 'rp ' + st.k + (r.id === pilih ? ' sel' : '')); b.type = 'button';
                b.appendChild(el('b', null, r.nama || 'Ruang tanpa nama'));
                let teks = 'Kosong', tip = r.nama + ': kosong pada jam ini';
                if (st.k === 'busy') {
                    const kul = st.j.jenis === 'kuliah';
                    teks = 'Dipakai \u00b7 ' + (kul ? 'Kuliah' : 'Dipinjam') + ' ' + st.j.mulai + '\u2013' + st.j.selesai;
                    tip = r.nama + ': ' + (kul ? 'jadwal kuliah ' : 'dipinjam untuk ') + st.j.keperluan + ' (' + st.j.mulai + '\u2013' + st.j.selesai + ')';
                    b.disabled = true;
                } else if (st.k === 'pend') {
                    teks = 'Kosong \u00b7 ada pengajuan lain'; tip = r.nama + ': masih ada pengajuan menunggu persetujuan (' + st.j.keperluan + ')';
                }
                b.appendChild(el('span', null, teks)); b.title = tip;
                b.addEventListener('click', () => { pilih = r.id; tampilError(''); renderPilih(); });
                grid.appendChild(b);
            });
            box.appendChild(grid);
        });
        if (!box.children.length) box.appendChild(el('p', 'pick-note', 'Tidak ada ruang kosong pada jam ini. Coba ubah jam atau tanggal.'));
        if (pilih && !terpilihOk) { pilih = 0; tampilError('Ruang yang dipilih sudah terpakai pada jam ini. Silakan pilih ruang lain.'); renderPilih(); return; }
        $('pickSum').textContent = kosong + ' ruang kosong';
    }

    async function muatKetersediaan() {
        const tgl = $('fTanggal').value, my = ++reqTgl;
        if (!/^\d{4}-\d\d-\d\d$/.test(tgl)) { dataRuang = null; renderPilih(); return; }
        try {
            const d = await api('api/jadwal.php?tanggal=' + tgl);
            if (my !== reqTgl) return;
            dataRuang = d;
        } catch (err) { if (my !== reqTgl) return; dataRuang = null; tampilError(err.message); }
        renderPilih();
    }

    $('fTanggal').value = params.get('tanggal') || iso(new Date());
    $('fTanggal').min = iso(new Date());
    // Jam mulai & selesai dikosongkan di awal dan selalu bisa diisi/diubah. Ruang tetap tampil di bawahnya;
    // setelah kedua jam diisi, daftar menyaring ruang yang kosong pada jam itu.
    // Pengecualian: bila datang dari klik area kosong di halaman Jadwal, jam dari alamat dipakai sebagai isian awal.
    const mulaiUrl = params.get('mulai') || '';
    if (/^\d\d:\d\d$/.test(mulaiUrl)) {
        $('fMulai').value = mulaiUrl;
        $('fSelesai').value = jam(Math.min(menit(mulaiUrl) + 120, 23 * 60 + 59));
    }
    const u = window.kampuslyUser; $('fPemohon').value = (u && (u.name || u.email)) || 'Admin Kampus';
    $('fTanggal').addEventListener('change', muatKetersediaan);
    window.addEventListener('pageshow', () => renderPilih());
    $('fMulai').addEventListener('input', renderPilih);
    $('fSelesai').addEventListener('input', renderPilih);

    $('btnAjukan').addEventListener('click', async () => {
        tampilError('');
        if (!dataRuang || !dataRuang.lantai.some((l) => l.ruang.length)) return tampilError('Belum ada ruang. Tambahkan dulu di menu Editor Ruang.');
        if (!$('fMulai').value || !$('fSelesai').value) return tampilError('Isi jam mulai dan jam selesai terlebih dahulu.');
        if (menit($('fSelesai').value) <= menit($('fMulai').value)) return tampilError('Jam selesai harus lebih besar dari jam mulai.');
        if (!pilih) return tampilError('Pilih ruang yang kosong terlebih dahulu.');
        if ($('fTanggal').value === iso(new Date()) && menit($('fSelesai').value || '00:00') <= new Date().getHours() * 60 + new Date().getMinutes()) {
            return tampilError('Jam yang dipilih sudah lewat. Pilih jam yang masih akan datang.');
        }
        const payload = {
            aksi: 'ajukan', elemen_id: pilih, tanggal: $('fTanggal').value, mulai: $('fMulai').value, selesai: $('fSelesai').value,
            peminjam: $('fPemohon').value, peserta: +$('fPeserta').value || 0, keperluan: $('fKeperluan').value,
        };
        const b = $('btnAjukan'); b.disabled = true;
        try {
            const d = await api('api/peminjaman.php', payload);
            toast(d.status === 'disetujui' ? 'Peminjaman disetujui'
                : d.pesan_terkirim ? 'Pengajuan terkirim. Admin sudah diberi tahu lewat Pesan.' : 'Pengajuan terkirim, menunggu persetujuan admin');
            $('fKeperluan').value = ''; $('fPeserta').value = ''; pilih = 0; $('fMulai').value = ''; $('fSelesai').value = '';
            state.waktu = 'mendatang'; $('fWaktu').value = 'mendatang'; state.halaman = 1; state.status = 'semua';
            await Promise.all([muat(true), muatKetersediaan()]);
        } catch (err) { tampilError(err.message); muatKetersediaan(); }
        b.disabled = false;
    });

    $('fWaktu').value = state.waktu;
    muatKetersediaan();
    muat();
})();
