/* Halaman Jadwal Ruang: timeline per lantai (urutan ruang sama dengan Editor Ruang).
   Kuliah (mingguan) + kegiatan disetujui + pengajuan menunggu. Klik area kosong = ajukan ruang. */
(function () {
    'use strict';
    const { el, iso, dariIso, menit, jam, tanggalPanjang, api, toast, status: setStatus } = window.KP;
    const $ = (id) => document.getElementById(id);
    const H0 = 7, H1 = 22, SPAN = (H1 - H0) * 60, LANE = 46;
    const pct = (m) => ((m - H0 * 60) / SPAN) * 100;

    let data = null, cur = null, tgl = null, reqId = 0, lastFocus = null, aktif = null;
    const filter = { kuliah: true, kegiatan: true, menunggu: true };

    const params = new URLSearchParams(location.search);
    const p = params.get('tanggal');
    tgl = p && /^\d{4}-\d\d-\d\d$/.test(p) ? p : iso(new Date());
    $('tgl').value = tgl;

    const sekarang = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
    const hariIni = () => iso(new Date());

    // ---------- data ----------
    async function muat(senyap) {
        const my = ++reqId;
        try {
            if (!senyap) setStatus('', 'Memuat\u2026');
            const d = await api('api/jadwal.php?tanggal=' + tgl);
            if (my !== reqId) return;
            data = d;
            if (!data.lantai.some((l) => l.id === cur)) cur = data.lantai.length ? data.lantai[0].id : null;
            render(); setStatus('', 'Data tersinkronisasi');
        } catch (err) { if (my !== reqId) return; setStatus('error', 'Gagal tersambung'); toast(err.message, true); }
    }

    // ---------- tampilan ----------
    function renderTabs() {
        const box = $('floorTabs'); box.textContent = '';
        data.lantai.forEach((l) => {
            const b = el('button', 'floor-tab' + (l.id === cur ? ' active' : ''), l.nama);
            b.type = 'button'; b.addEventListener('click', () => { cur = l.id; render(); });
            box.appendChild(b);
        });
    }

    function itemsRuang(r) {
        const out = [];
        r.jadwal.forEach((j) => { if (filter[j.jenis]) out.push(j); });
        if (filter.menunggu) r.menunggu.forEach((j) => out.push(j));
        return out.sort((a, b) => menit(a.mulai) - menit(b.mulai) || menit(a.selesai) - menit(b.selesai));
    }

    function render() {
        if (!data) return;
        renderTabs();
        const d = dariIso(tgl), l = data.lantai.find((x) => x.id === cur);
        $('canvasTitle').textContent = (l ? l.nama : 'Jadwal') + ' \u00b7 ' + tanggalPanjang(d);
        $('canvasCrumb').textContent = 'Jadwal ruang / ' + (l ? l.nama : '');
        const tt = $('tt'); tt.textContent = '';
        if (!l || !l.ruang.length) {
            $('summary').textContent = '';
            tt.appendChild(el('div', 'tt-note', 'Belum ada ruang di lantai ini. Tambahkan di menu Editor Ruang.'));
            return;
        }

        let nKuliah = 0, nKegiatan = 0, nMenunggu = 0;
        const head = el('div', 'tt-row tt-head');
        head.appendChild(el('div', 'tt-name', 'Ruang'));
        const hours = el('div', 'tt-lane tt-hours');
        for (let h = H0; h < H1; h++) { const s = el('span', null, String(h).padStart(2, '0') + ':00'); s.style.left = pct(h * 60) + '%'; hours.appendChild(s); }
        head.appendChild(hours); tt.appendChild(head);

        const now = tgl === hariIni() ? sekarang() : -1;
        l.ruang.forEach((r) => {
            const items = itemsRuang(r), lanes = [];
            const pos = items.map((j) => {
                const a = Math.max(menit(j.mulai), H0 * 60), b = Math.min(menit(j.selesai), H1 * 60);
                if (b <= a) return null;
                let k = lanes.findIndex((end) => end <= a); if (k < 0) { k = lanes.length; lanes.push(0); }
                lanes[k] = b; return { j, a, b, k };
            }).filter(Boolean);

            const row = el('div', 'tt-row');
            const nm = el('div', 'tt-name', r.nama || 'Ruang tanpa nama');
            row.appendChild(nm);
            const lane = el('div', 'tt-lane'); lane.style.height = Math.max(1, lanes.length) * LANE + 8 + 'px';
            lane.title = 'Klik area kosong untuk mengajukan ruang ini';
            lane.addEventListener('click', (e) => {
                if (e.target !== lane) return;
                const rc = lane.getBoundingClientRect();
                const m = Math.round((H0 * 60 + ((e.clientX - rc.left) / rc.width) * SPAN) / 30) * 30;
                location.href = 'peminjaman.html?ruang=' + r.id + '&tanggal=' + tgl + '&mulai=' + jam(Math.max(H0 * 60, Math.min(m, H1 * 60 - 60)));
            });

            pos.forEach(({ j, a, b, k }) => {
                if (j.jenis === 'kuliah') nKuliah++; else if (j.status === 'menunggu') nMenunggu++; else nKegiatan++;
                const kls = j.status === 'menunggu' ? 'menunggu' : j.jenis;
                const blk = el('button', 'blk ' + kls + (now >= a && now < b && j.status !== 'menunggu' ? ' now' : ''));
                blk.type = 'button';
                blk.style.left = pct(a) + '%'; blk.style.width = 'calc(' + (pct(b) - pct(a)) + '% - 2px)';
                blk.style.top = 4 + k * LANE + 'px'; blk.style.height = LANE - 4 + 'px';
                blk.title = j.keperluan + ' (' + j.mulai + '\u2013' + j.selesai + ')';
                blk.appendChild(el('b', null, j.keperluan || '-'));
                blk.appendChild(el('span', null, j.mulai + '\u2013' + j.selesai + (j.peminjam ? ' \u00b7 ' + j.peminjam : '')));
                blk.addEventListener('click', () => buka(r, l, j, blk));
                lane.appendChild(blk);
            });
            if (now >= H0 * 60 && now < H1 * 60) { const nl = el('div', 'nowline'); nl.style.left = pct(now) + '%'; lane.appendChild(nl); }
            row.appendChild(lane); tt.appendChild(row);
        });
        $('summary').textContent = l.ruang.length + ' ruang \u00b7 ' + nKuliah + ' kuliah \u00b7 ' + nKegiatan + ' kegiatan' + (nMenunggu ? ' \u00b7 ' + nMenunggu + ' menunggu persetujuan' : '');
    }

    // ---------- detail ----------
    const modal = $('sesiModal');
    function baris(k, v) { const r = el('div', 'detail-row'); r.appendChild(el('span', null, k)); r.appendChild(el('span', null, v)); return r; }

    function buka(r, l, j, trigger) {
        aktif = { r, l, j }; lastFocus = trigger;
        const list = $('sesiBody'); list.textContent = '';
        $('sesiTitle').textContent = j.keperluan || '-';
        $('sesiSub').textContent = r.nama + ' \u00b7 ' + l.nama + ' \u00b7 ' + tanggalPanjang(dariIso(tgl));
        const kls = j.status === 'menunggu' ? 'menunggu' : j.jenis;
        const ban = el('div', 'room-status ' + kls, j.status === 'menunggu' ? 'Menunggu persetujuan' : j.jenis === 'kuliah' ? 'Jadwal kuliah' : 'Kegiatan disetujui');
        ban.appendChild(el('small', null, j.mulai + ' \u2013 ' + j.selesai));
        list.appendChild(ban);
        list.appendChild(baris(j.jenis === 'kuliah' ? 'Dosen' : 'Pemohon', j.peminjam || '-'));
        if (j.jenis === 'kuliah') { if (j.kelas) list.appendChild(baris('Kelas', j.kelas)); if (j.prodi) list.appendChild(baris('Program studi', j.prodi)); }
        else {
            if (j.peserta) list.appendChild(baris('Peserta', j.peserta + ' orang'));
            if (j.fasilitas) list.appendChild(baris('Fasilitas', j.fasilitas));
            if (j.catatan) list.appendChild(baris('Catatan', j.catatan));
        }
        const bolehKelola = !!window.kampuslyUser && window.kampuslyUser.peran === 'admin';   // tombol kelola khusus admin
        if (bolehKelola && j.status === 'menunggu') {
            const box = el('div', 'modal-act');
            const ok = el('button', 'btn primary', 'Setujui'); ok.type = 'button';
            const no = el('button', 'btn danger', 'Tolak'); no.type = 'button';
            ok.addEventListener('click', () => aksi({ aksi: 'setujui', id: j.id }, 'Pengajuan disetujui'));
            no.addEventListener('click', () => tolakDenganAlasan(j, r, l, 'tolak'));
            box.appendChild(ok); box.appendChild(no); list.appendChild(box);
        } else if (bolehKelola && j.jenis === 'kegiatan') {
            const box = el('div', 'modal-act');
            const batalkan = el('button', 'btn danger', 'Batalkan peminjaman'); batalkan.type = 'button';
            batalkan.addEventListener('click', () => tolakDenganAlasan(j, r, l, 'batal'));
            box.appendChild(batalkan);
            const del = el('button', 'btn danger', 'Hapus kegiatan'); del.type = 'button';
            del.addEventListener('click', () => { if (confirm('Hapus kegiatan ini dari jadwal?')) aksi({ aksi: 'hapus', id: j.id }, 'Kegiatan dihapus'); });
            box.appendChild(del); list.appendChild(box);
        }
        modal.hidden = false; document.body.style.overflow = 'hidden'; $('sesiClose').focus();
    }
    function tutup() {
        if (modal.hidden) return;
        modal.hidden = true; document.body.style.overflow = ''; aktif = null;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    async function aksi(payload, pesan) {
        try { const d = await api('api/peminjaman.php', payload); tutup(); toast(typeof pesan === 'function' ? pesan(d) : pesan); await muat(true); }
        catch (err) { toast(err.message, true); }
    }
    // Tolak / batalkan: alasan wajib dan otomatis dikirim ke pemohon lewat Pesan (dialog di alasan.js).
    async function tolakDenganAlasan(j, r, l, mode) {
        const alasan = await window.KPAlasan.minta({
            mode, punyaAkun: j.akun,
            info: [['Kegiatan', j.keperluan], ['Pemohon', j.peminjam], ['Ruang', r.nama + ' \u00b7 ' + l.nama], ['Waktu', tanggalPanjang(dariIso(tgl)) + ', ' + j.mulai + '\u2013' + j.selesai]],
        });
        if (alasan === null) return;
        aksi({ aksi: 'tolak', id: j.id, alasan }, (d) => (mode === 'batal' ? 'Peminjaman dibatalkan' : 'Pengajuan ditolak')
            + (d.pesan_terkirim ? '. Alasan dikirim ke pemohon lewat Pesan.' : d.punya_akun ? '' : '. Pemohon tidak punya akun, alasan hanya dicatat.'));
    }
    $('sesiClose').addEventListener('click', tutup);
    modal.addEventListener('click', (e) => { if (e.target === modal) tutup(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') tutup(); });

    // ---------- kontrol ----------
    function setTanggal(s) { if (!s) return; tgl = s; $('tgl').value = s; muat(); }
    const geser = (n) => { const d = dariIso(tgl); d.setDate(d.getDate() + n); setTanggal(iso(d)); };
    $('prevDay').addEventListener('click', () => geser(-1));
    $('nextDay').addEventListener('click', () => geser(1));
    $('hariIni').addEventListener('click', () => setTanggal(hariIni()));
    $('tgl').addEventListener('change', (e) => setTanggal(e.target.value));
    [['chKuliah', 'kuliah'], ['chKegiatan', 'kegiatan'], ['chMenunggu', 'menunggu']].forEach(([id, k]) =>
        $(id).addEventListener('change', (e) => { filter[k] = e.target.checked; render(); }));

    // ---------- Daftar jadwal (tabel + pencarian) ----------
    const NAMA_HARI = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
    const dk = { tab: 'kegiatan', q: '', halaman: 1, waktu: 'mendatang', hari: '0', per: 25, total: 0 };
    const KOLOM = {
        kegiatan: ['Tanggal', 'Waktu', 'Kegiatan', 'Pemohon', 'Ruang', 'Peserta', 'Fasilitas', 'Status'],
        kuliah: ['Hari', 'Jam', 'Mata kuliah', 'Kelas', 'Pengajar', 'Program studi', 'Ruang'],
    };
    const FILTER = {
        kegiatan: [['mendatang', 'Hari ini & mendatang'], ['riwayat', 'Riwayat'], ['semua', 'Semua tanggal']],
        kuliah: [['0', 'Semua hari'], ['1', 'Senin'], ['2', 'Selasa'], ['3', 'Rabu'], ['4', 'Kamis'], ['5', 'Jumat'], ['6', 'Sabtu']],
    };

    const adalahAdmin = () => !!window.kampuslyUser && window.kampuslyUser.peran === 'admin';
    const jumlahKolom = () => KOLOM[dk.tab].length + (adalahAdmin() ? 1 : 0);

    // Tombol ubah / hapus di setiap baris (khusus admin; server juga menolak akun lain).
    function selAksi(r) {
        const box = el('div', 'row-act');
        [['pencil', 'Ubah', 'ubah', ''], ['trash-2', 'Hapus', 'hapus', ' del']].forEach(([ikon, judul, fn, kls]) => {
            const b = el('button', 'ic-btn' + kls); b.type = 'button'; b.title = judul; b.setAttribute('aria-label', judul);
            const i = document.createElement('i'); i.setAttribute('data-lucide', ikon); b.appendChild(i);
            b.addEventListener('click', (ev) => { ev.stopPropagation(); if (window.KPKelola) window.KPKelola[fn](dk.tab, r); });
            box.appendChild(b);
        });
        return box;
    }

    function labelStatus(r) {
        if (r.status !== 'disetujui') return [r.status === 'menunggu' ? 'Menunggu' : 'Ditolak', r.status];
        const n = new Date(), lewat = r.tanggal < iso(n) || (r.tanggal === iso(n) && menit(r.selesai) <= n.getHours() * 60 + n.getMinutes());
        return lewat ? ['Selesai', 'selesai'] : ['Terjadwal', 'disetujui'];
    }

    function lihatDiTimeline(ruangId, tanggal) {
        if (data) { const l = data.lantai.find((x) => x.ruang.some((r) => r.id === ruangId)); if (l) cur = l.id; }
        if (tanggal === tgl) render(); else setTanggal(tanggal);
        $('tt').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function tanggalHari(hari) {   // tanggal terdekat (mulai tanggal terpilih) yang jatuh pada hari tsb
        const d = dariIso(tgl);
        for (let i = 0; i < 7; i++) { if (((d.getDay() + 6) % 7) + 1 === hari) break; d.setDate(d.getDate() + 1); }
        return iso(d);
    }

    function baruDaftar(cells, onClick) {
        const tr = el('tr');
        cells.forEach((c) => {
            const td = el('td', c.cls || '');
            if (c.node) td.appendChild(c.node);
            else { if (c.strong) td.appendChild(el('strong', null, c.t)); else td.textContent = c.t; if (c.small) td.appendChild(el('small', null, c.small)); }
            tr.appendChild(td);
        });
        tr.addEventListener('click', onClick);
        return tr;
    }

    function pasangDaftarHeader() {
        const h = $('dHead'); h.textContent = '';
        const tr = el('tr'); KOLOM[dk.tab].forEach((k) => tr.appendChild(el('th', null, k)));
        if (adalahAdmin()) tr.appendChild(el('th', null, 'Aksi'));
        h.appendChild(tr);
        const f = $('dFilter'); f.textContent = '';
        FILTER[dk.tab].forEach(([v, t]) => f.appendChild(new Option(t, v)));
        f.value = dk.tab === 'kegiatan' ? dk.waktu : dk.hari;
        $('dCari').placeholder = dk.tab === 'kegiatan' ? 'Cari kegiatan, pemohon, ruang' : 'Cari mata kuliah, pengajar, kelas, prodi, ruang';
    }

    async function muatDaftar() {
        const body = $('dBody');
        try {
            const url = dk.tab === 'kegiatan'
                ? 'api/peminjaman.php?' + new URLSearchParams({ status: 'semua', waktu: dk.waktu, q: dk.q, halaman: dk.halaman })
                : 'api/jadwal.php?' + new URLSearchParams({ daftar: 'kuliah', hari: dk.hari, q: dk.q, halaman: dk.halaman });
            const d = await api(url);
            dk.total = d.total; dk.per = d.per;
            body.textContent = '';
            if (!d.data.length) {
                const tr = el('tr', 'empty-row'), td = el('td', null, 'Tidak ada data yang cocok.'); td.colSpan = jumlahKolom(); tr.appendChild(td); body.appendChild(tr);
            }
            let hariSebelumnya = 0;
            d.data.forEach((r) => {
                // Daftar kuliah diurutkan per hari lalu per jam. Saat "Semua hari", beri judul tiap hari supaya
                // jelas bahwa satu halaman bisa berisi satu hari penuh (mis. 25 baris pertama semuanya Senin).
                if (dk.tab === 'kuliah' && dk.hari === '0' && r.hari !== hariSebelumnya) {
                    hariSebelumnya = r.hari;
                    const gr = el('tr', 'grup-hari'), gd = el('td', null, NAMA_HARI[r.hari]); gd.colSpan = jumlahKolom(); gr.appendChild(gd); body.appendChild(gr);
                }
                if (dk.tab === 'kegiatan') {
                    const [lbl, kls] = labelStatus(r), b = el('span', 'badge-st ' + kls, lbl);
                    body.appendChild(baruDaftar([
                        { t: window.KP.tanggalPendek(dariIso(r.tanggal)), cls: 'num' }, { t: r.mulai + ' \u2013 ' + r.selesai, cls: 'num' },
                        { t: r.keperluan || '-', strong: true, small: r.catatan || '' }, { t: r.peminjam || '-' }, { t: r.ruang, small: r.lantai },
                        { t: r.peserta ? String(r.peserta) : '-', cls: 'num' }, { t: r.fasilitas || '-' }, { node: b },
                    ].concat(adalahAdmin() ? [{ node: selAksi(r), cls: 'aksi' }] : []), () => lihatDiTimeline(r.ruang_id, r.tanggal)));
                } else {
                    body.appendChild(baruDaftar([
                        { t: NAMA_HARI[r.hari] }, { t: r.mulai + ' \u2013 ' + r.selesai, cls: 'num' }, { t: r.matkul, strong: true },
                        { t: r.kelas || '-' }, { t: r.pengajar || '-' }, { t: r.prodi || '-' }, { t: r.ruang, small: r.lantai },
                    ].concat(adalahAdmin() ? [{ node: selAksi(r), cls: 'aksi' }] : []), () => lihatDiTimeline(r.ruang_id, tanggalHari(r.hari))));
                }
            });
            const dari = dk.total ? (d.halaman - 1) * dk.per + 1 : 0, sampai = Math.min(dk.total, d.halaman * dk.per);
            $('dInfo').textContent = dari + '\u2013' + sampai + ' dari ' + dk.total + ' data' + (dk.tab === 'kuliah' ? ' \u00b7 urut per hari lalu jam' : '');
            $('dPrev').disabled = d.halaman <= 1; $('dNext').disabled = sampai >= dk.total;
            if (window.lucide) lucide.createIcons();
        } catch (err) {
            body.textContent = '';
            const tr = el('tr', 'empty-row'), td = el('td', null, err.message); td.colSpan = jumlahKolom(); tr.appendChild(td); body.appendChild(tr);
        }
    }

    $('dTabs').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-t]'); if (!b || b.dataset.t === dk.tab) return;
        dk.tab = b.dataset.t; dk.halaman = 1; dk.q = ''; $('dCari').value = '';
        $('dTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        pasangDaftarHeader(); muatDaftar();
    });
    $('dFilter').addEventListener('change', (e) => { if (dk.tab === 'kegiatan') dk.waktu = e.target.value; else dk.hari = e.target.value; dk.halaman = 1; muatDaftar(); });
    let tmrCari; $('dCari').addEventListener('input', (e) => { clearTimeout(tmrCari); tmrCari = setTimeout(() => { dk.q = e.target.value.trim(); dk.halaman = 1; muatDaftar(); }, 300); });
    $('dPrev').addEventListener('click', () => { if (dk.halaman > 1) { dk.halaman--; muatDaftar(); } });
    $('dNext').addEventListener('click', () => { dk.halaman++; muatDaftar(); });
    pasangDaftarHeader(); muatDaftar();

    // Jembatan untuk jadwal-kelola.js (tambah / ubah / hapus / impor Excel).
    window.KPJadwal = {
        tab: () => dk.tab,
        tanggal: () => tgl,
        lantai: () => (data ? data.lantai : []),
        keTab: (t) => { const b = $('dTabs').querySelector('button[data-t="' + t + '"]'); if (b) b.click(); },
        tampilkanSemua: () => { if (dk.tab === 'kegiatan') { $('dFilter').value = 'semua'; dk.waktu = 'semua'; dk.halaman = 1; } },
        segarkan: () => Promise.all([muat(true), muatDaftar()]),
    };

    setInterval(() => { if (data && !document.hidden) render(); }, 60000);
    setInterval(() => { if (!document.hidden) muat(true); }, 300000);
    muat();
})();
