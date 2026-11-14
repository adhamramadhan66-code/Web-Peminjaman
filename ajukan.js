/* Halaman Ajukan ruang: form pengajuan + pemilih ruang yang kosong. Setelah berhasil tampil animasi centang,
   lalu diarahkan ke Riwayat peminjaman (peminjaman.html). */
(function () {
    'use strict';
    const { el, iso, menit, jam, api } = window.KP;
    const $ = (id) => document.getElementById(id);
    const params = new URLSearchParams(location.search);

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

    /** Kartu ruang berbentuk sama dengan kartu "Ruang Hari Ini" di dashboard: nama, info, label status. */
    function kartuRuang(r, varian, info, label, tip) {
        const dipilih = r.id === pilih;
        const b = el('button', 'rk ' + varian + (dipilih ? ' sel' : '')); b.type = 'button';
        b.setAttribute('aria-pressed', String(dipilih));
        b.appendChild(el('div', 'n', r.nama || 'Ruang tanpa nama'));
        b.appendChild(el('div', 'f', info || '\u00a0'));
        b.appendChild(el('div', 's', dipilih ? '\u2713 Dipilih' : label));
        b.title = tip;
        b.addEventListener('click', () => { pilih = r.id; tampilError(''); renderPilih(); });
        return b;
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
                const n = r.jadwal.length;
                const b = kartuRuang(r, 'netral', r.fasilitas, n ? n + ' jadwal hari ini' : 'Belum ada jadwal',
                    n ? r.nama + ': ' + r.jadwal.map((j) => j.mulai + '\u2013' + j.selesai + ' ' + (j.keperluan || '')).join('; ')
                      : r.nama + ': belum ada jadwal pada tanggal ini');
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
                let label = 'Kosong', tip = r.nama + ': kosong pada jam ini', varian = '';
                if (st.k === 'busy') {
                    const kul = st.j.jenis === 'kuliah';
                    label = 'Dipakai ' + st.j.mulai + '\u2013' + st.j.selesai;
                    tip = r.nama + ': ' + (kul ? 'jadwal kuliah ' : 'dipinjam untuk ') + st.j.keperluan + ' (' + st.j.mulai + '\u2013' + st.j.selesai + ')';
                    varian = 'dipakai';
                } else if (st.k === 'pend') {
                    label = 'Ada pengajuan lain'; tip = r.nama + ': masih ada pengajuan menunggu persetujuan (' + st.j.keperluan + ')'; varian = 'dipinjam';
                }
                const b = kartuRuang(r, varian, r.fasilitas, label, tip);
                if (st.k === 'busy') b.disabled = true;
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
            tampilSukses(d);   // animasi centang, lalu pindah ke Riwayat. Tombol sengaja dibiarkan nonaktif (cegah kirim ganda).
            return;
        } catch (err) { tampilError(err.message); muatKetersediaan(); }
        b.disabled = false;
    });

    // ---------- layar sukses (animasi centang) ----------
    function tampilSukses(d) {
        const disetujui = d.status === 'disetujui';
        const o = el('div', 'sukses-overlay'); o.setAttribute('role', 'alertdialog'); o.setAttribute('aria-live', 'assertive');
        o.setAttribute('aria-label', 'Pengajuan berhasil');
        const box = el('div', 'sukses-box');
        box.innerHTML = '<svg class="sukses-ikon" viewBox="0 0 52 52" aria-hidden="true"><circle class="sukses-putar" cx="26" cy="26" r="24"/><circle class="sukses-lingkar" cx="26" cy="26" r="24"/>'
            + '<path class="sukses-centang" d="M14 27l8 8 16-17"/></svg>';
        box.appendChild(el('h3', null, disetujui ? 'Peminjaman disetujui' : 'Pengajuan berhasil'));
        box.appendChild(el('p', null, disetujui ? 'Ruang sudah dipesan untukmu.'
            : 'Pengajuanmu sudah terkirim dan menunggu persetujuan admin.' + (d.pesan_terkirim ? ' Admin diberi tahu lewat Pesan.' : '')));
        const lihat = el('a', 'btn primary', 'Lihat riwayat peminjaman'); lihat.href = 'peminjaman.html';
        box.appendChild(lihat);
        box.appendChild(el('small', null, 'Mengalihkan ke riwayat peminjaman\u2026'));
        o.appendChild(box); document.body.appendChild(o);
        setTimeout(() => { location.href = 'peminjaman.html'; }, 4200);   // beri waktu animasi putar + centang selesai dan terbaca
    }

    muatKetersediaan();
})();
