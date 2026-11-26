/* Halaman Mobil Dinas (khusus admin): kartu 4 armada, daftar pemakaian, form tambah/ubah, setujui/tolak,
   ekspor Excel berformat, dan impor dari berkas Excel "DAFTAR PEMAKAIAN ARMADA". */
(function () {
    'use strict';
    const { el, iso, dariIso, tanggalPendek, api, toast, status: setStatus } = window.KP;
    const $ = (id) => document.getElementById(id);
    const API = 'api/armada.php';
    const HARI = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
    const BLN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const LABEL = { semua: 'Semua', menunggu: 'Menunggu', disetujui: 'Disetujui', ditolak: 'Ditolak' };
    const state = { status: 'semua', waktu: 'mendatang', armada: '0', q: '', halaman: 1 };
    let hitung = {}, total = 0, per = 20, armada = [];

    const namaHari = (s) => { const d = dariIso(s); return HARI[d.getDay() || 7]; };
    const tglPanjang = (s) => { const [y, m, d] = s.split('-').map(Number); return namaHari(s) + ', ' + d + ' ' + BLN[m - 1] + ' ' + y; };
    const rentang = (r) => (r.tanggal_akhir && r.tanggal_akhir !== r.tanggal)
        ? tanggalPendek(dariIso(r.tanggal)) + ' – ' + tanggalPendek(dariIso(r.tanggal_akhir)) : tanggalPendek(dariIso(r.tanggal));
    const waktu = (r) => r.mulai + ' – ' + (r.selesai || 'selesai');
    const ujung = (r) => [r.tanggal + ' ' + r.mulai, (r.tanggal_akhir || r.tanggal) + ' ' + (r.selesai || '23:59')];
    const sekarangStr = () => { const n = new Date(); return iso(n) + ' ' + String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'); };

    /** [label, kelas badge] */
    function labelStatus(r) {
        if (r.status === 'menunggu') return ['Menunggu', 'menunggu'];
        if (r.status === 'ditolak') return ['Ditolak', 'ditolak'];
        const [s, e] = ujung(r), n = sekarangStr();
        if (n < s) return ['Terjadwal', 'disetujui'];
        if (n < e) return ['Berlangsung', 'berlangsung'];
        return ['Selesai', 'selesai'];
    }

    // ---------- kartu armada ----------
    function renderKartu(list) {
        const box = $('armGrid'); box.textContent = '';
        list.forEach((a) => {
            const pakai = a.sekarang, kartu = el('button', 'arm-card' + (pakai ? ' dipakai' : '')); kartu.type = 'button';
            kartu.title = 'Tampilkan pemakaian ' + a.kode;
            const atas = el('div', 'arm-atas');
            atas.innerHTML = '<span class="arm-ikon"><i data-lucide="car-front"></i></span>';
            const nm = el('div', 'arm-nama'); nm.appendChild(el('strong', null, a.kode)); nm.appendChild(el('small', null, a.nama));
            atas.appendChild(nm);
            atas.appendChild(el('span', 'badge-st ' + (pakai ? 'berlangsung' : 'disetujui'), pakai ? 'Sedang dipakai' : 'Tersedia'));
            kartu.appendChild(atas);
            if (pakai) kartu.appendChild(el('p', 'arm-baris', pakai.tujuan + (pakai.pemohon ? ' · ' + pakai.pemohon : '')));
            if (a.berikut) kartu.appendChild(el('p', 'arm-baris muted', 'Berikutnya: ' + tanggalPendek(dariIso(a.berikut.tanggal)) + ' ' + a.berikut.mulai + ' – ' + a.berikut.tujuan));
            else if (!pakai) kartu.appendChild(el('p', 'arm-baris muted', 'Belum ada pemakaian terjadwal.'));
            kartu.appendChild(el('p', 'arm-foot', a.bulan_ini + ' pemakaian bulan ini'));
            kartu.addEventListener('click', () => { state.armada = String(a.id); $('fArmada').value = state.armada; state.halaman = 1; muat(); });
            box.appendChild(kartu);
        });
    }
    async function muatKartu() {
        try {
            const d = await api(API + '?ringkas=1');
            renderKartu(d.armada);
            $('armInfo').textContent = 'Status empat mobil dinas TSU saat ini' + (d.menunggu ? ' · ' + d.menunggu + ' pengajuan menunggu persetujuan.' : '.');
            if (window.lucide) lucide.createIcons();
        } catch (err) { /* pesan galat ditampilkan oleh muat() */ }
    }

    // ---------- daftar ----------
    function renderTabs() {
        const box = $('statusTabs'); box.textContent = '';
        Object.keys(LABEL).forEach((k) => {
            const b = el('button', k === state.status ? 'active' : '', LABEL[k]); b.type = 'button';
            b.appendChild(el('small', null, String(hitung[k] || 0)));
            b.addEventListener('click', () => { state.status = k; state.halaman = 1; muat(); });
            box.appendChild(b);
        });
    }
    function tombol(box, cls, icon, title, fn) {
        const b = el('button', 'ic-btn ' + cls); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
        b.innerHTML = '<i data-lucide="' + icon + '"></i>'; b.addEventListener('click', fn); box.appendChild(b);
    }
    function aksi(r) {
        const box = el('div', 'row-act');
        if (r.status !== 'disetujui') tombol(box, 'ok', 'check', 'Setujui', () => kirim({ aksi: 'setujui', id: r.id }, 'Pemakaian disetujui'));
        if (r.status !== 'ditolak') {
            const batal = r.status === 'disetujui';
            tombol(box, 'no', 'x', batal ? 'Batalkan' : 'Tolak', async () => {
                const alasan = await window.KPAlasan.minta({
                    mode: batal ? 'batal' : 'tolak', punyaAkun: false,
                    info: [['Tujuan', r.tujuan], ['Pemohon', r.pemohon || '-'], ['Armada', r.armada_kode], ['Waktu', rentang(r) + ', ' + waktu(r)]],
                });
                if (alasan === null) return;
                kirim({ aksi: 'tolak', id: r.id, alasan }, batal ? 'Pemakaian dibatalkan' : 'Pengajuan ditolak');
            });
        }
        tombol(box, '', 'pencil', 'Ubah', () => bukaForm(r));
        tombol(box, 'del', 'trash-2', 'Hapus', () => { if (confirm('Hapus pemakaian "' + r.tujuan + '"?\nTindakan ini tidak bisa dibatalkan.')) kirim({ aksi: 'hapus', id: r.id }, 'Data dihapus'); });
        return box;
    }
    function renderBaris(rows) {
        const body = $('listBody'); body.textContent = '';
        if (!rows.length) { const tr = el('tr', 'empty-row'), td = el('td', null, 'Tidak ada data pemakaian armada.'); td.colSpan = 8; tr.appendChild(td); body.appendChild(tr); return; }
        rows.forEach((r) => {
            const tr = el('tr');
            const c = (t, cls) => { const td = el('td', cls || null); if (t instanceof Node) td.appendChild(t); else td.textContent = t; tr.appendChild(td); return td; };
            c(el('span', 'arm-kode', r.armada_kode));
            c(rentang(r), 'num');
            c(waktu(r), 'num');
            const tj = c(el('strong', null, r.tujuan)); if (r.catatan) tj.appendChild(el('small', 'sub', r.catatan));
            const pm = c(r.pemohon || '-'); if (r.sopir) pm.appendChild(el('small', 'sub', 'Dengan sopir'));
            c(r.peserta ? String(r.peserta) : '-', 'num');
            const [lbl, kls] = labelStatus(r); c(el('span', 'badge-st ' + kls, lbl));
            c(aksi(r), 'aksi');
            body.appendChild(tr);
        });
    }
    async function muat(senyap) {
        try {
            if (!senyap) setStatus('', 'Memuat…');
            const d = await api(API + '?' + new URLSearchParams({ daftar: 1, status: state.status, waktu: state.waktu, armada: state.armada, q: state.q, halaman: state.halaman }));
            hitung = d.hitung; total = d.total; per = d.per;
            if (!armada.length) {
                armada = d.armada;
                const f = $('fArmada'); f.textContent = '';
                f.appendChild(new Option('Semua armada', '0')); armada.forEach((a) => f.appendChild(new Option(a.kode + ' – ' + a.nama, a.id)));
            }
            $('fArmada').value = state.armada;
            renderTabs(); renderBaris(d.data);
            const dari = total ? (d.halaman - 1) * per + 1 : 0, sampai = Math.min(total, d.halaman * per);
            $('pagerInfo').textContent = dari + '–' + sampai + ' dari ' + total + ' data';
            $('pgPrev').disabled = d.halaman <= 1; $('pgNext').disabled = sampai >= total;
            if (window.lucide) lucide.createIcons();
            setStatus('', 'Data tersinkronisasi');
            muatKartu();
        } catch (err) { setStatus('error', 'Gagal tersambung'); toast(err.message, true); }
    }
    async function kirim(payload, pesan) {
        try { await api(API, payload); toast(pesan); await muat(true); }
        catch (err) { toast(err.message, true); }
    }

    // ---------- form tambah / ubah ----------
    const formModal = $('formModal'), imporModal = $('imporModal');
    function bukaModal(m, fokus) { m.hidden = false; document.body.style.overflow = 'hidden'; if (fokus) fokus.focus(); }
    function tutupModal(m) { if (m.hidden) return; m.hidden = true; if (!document.querySelector('.room-modal:not([hidden])')) document.body.style.overflow = ''; }
    $('formClose').addEventListener('click', () => tutupModal(formModal));
    $('kBatal').addEventListener('click', () => tutupModal(formModal));
    $('imporClose').addEventListener('click', () => tutupModal(imporModal));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { tutupModal(formModal); tutupModal(imporModal); } });
    [formModal, imporModal].forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) tutupModal(m); }));

    let formKini = null;
    function bukaForm(r) {
        if (!armada.length) { toast('Data armada belum termuat. Coba lagi sebentar lagi.', true); return; }
        const ubah = !!r;
        $('formTitle').textContent = ubah ? 'Ubah pemakaian armada' : 'Tambah pemakaian armada';
        $('formSub').textContent = 'Pemakaian yang disetujui tidak boleh beririsan waktu dengan pemakaian lain pada armada yang sama.';
        $('kErr').className = 'form-err'; $('kErr').textContent = '';
        const a = ubah ? r : { tanggal: iso(new Date()), status: 'disetujui', sopir: true, armada_id: state.armada !== '0' ? Number(state.armada) : '' };
        const F = [
            { k: 'armada_id', t: 'armada', label: 'Armada', wajib: true, penuh: true },
            { k: 'tanggal', t: 'date', label: 'Tanggal pemakaian', wajib: true },
            { k: 'tanggal_akhir', t: 'date', label: 'Sampai tanggal (bila lebih dari sehari)' },
            { k: 'mulai', t: 'time', label: 'Jam berangkat', wajib: true },
            { k: 'selesai', t: 'time', label: 'Jam selesai (kosong = sampai selesai)' },
            { k: 'tujuan', t: 'text', label: 'Tujuan / keperluan', wajib: true, penuh: true, maks: 200 },
            { k: 'pemohon', t: 'text', label: 'Pemohon', maks: 80 },
            { k: 'peserta', t: 'number', label: 'Jumlah peserta' },
            { k: 'sopir', t: 'select', label: 'Sopir', opsi: [['1', 'Dengan sopir'], ['0', 'Tanpa sopir']] },
            { k: 'status', t: 'select', label: 'Status', opsi: [['disetujui', 'Disetujui'], ['menunggu', 'Menunggu persetujuan'], ['ditolak', 'Ditolak']] },
            { k: 'fasilitas', t: 'text', label: 'Fasilitas / keterangan', penuh: true, maks: 160 },
            { k: 'tgl_pesan', t: 'date', label: 'Tanggal pesan' },
            { k: 'catatan', t: 'text', label: 'Catatan', maks: 255 },
        ];
        const box = $('kFields'); box.textContent = ''; const inputs = {};
        F.forEach((f) => {
            const lb = el('label', f.penuh ? 'penuh' : ''); lb.appendChild(document.createTextNode(f.label));
            if (f.wajib) lb.appendChild(el('em', null, ' *'));
            let inp;
            if (f.t === 'armada') { inp = el('select', 'in'); inp.appendChild(new Option('Pilih armada…', '')); armada.forEach((x) => inp.appendChild(new Option(x.kode + ' – ' + x.nama, x.id))); }
            else if (f.t === 'select') { inp = el('select', 'in'); f.opsi.forEach(([v, t]) => inp.appendChild(new Option(t, v))); }
            else { inp = el('input', 'in'); inp.type = f.t; if (f.maks) inp.maxLength = f.maks; if (f.t === 'number') { inp.min = '0'; inp.max = '99'; } inp.autocomplete = 'off'; }
            let v = a[f.k]; if (f.k === 'sopir') v = a.sopir ? '1' : '0';
            if (f.k === 'tanggal_akhir' && v === a.tanggal) v = '';
            if (f.k === 'peserta' && !v) v = '';
            inp.value = v == null ? '' : v; inputs[f.k] = inp; lb.appendChild(inp); box.appendChild(lb);
        });
        formKini = { id: ubah ? r.id : 0, inputs };
        $('kSimpan').textContent = ubah ? 'Simpan perubahan' : 'Tambahkan';
        bukaModal(formModal, inputs.armada_id);
    }
    $('kForm').addEventListener('submit', async (e) => {
        e.preventDefault(); if (!formKini) return;
        const v = {}; Object.keys(formKini.inputs).forEach((k) => { v[k] = formKini.inputs[k].value.trim(); });
        const payload = Object.assign({}, v, { aksi: 'simpan', id: formKini.id, armada_id: Number(v.armada_id) || 0, sopir: v.sopir === '1', peserta: Number(v.peserta) || 0 });
        const btn = $('kSimpan'); btn.disabled = true;
        try {
            await api(API, payload); tutupModal(formModal);
            toast(formKini.id ? 'Perubahan disimpan' : 'Pemakaian ditambahkan'); await muat(true);
        } catch (err) { $('kErr').textContent = err.message; $('kErr').className = 'form-err show'; }
        finally { btn.disabled = false; }
    });

    // ---------- animasi centang (sama seperti pengajuan ruang) ----------
    function animasiSukses(judul, teks) {
        const o = el('div', 'sukses-overlay'); o.setAttribute('role', 'alertdialog'); o.setAttribute('aria-label', judul);
        const box = el('div', 'sukses-box');
        box.innerHTML = '<svg class="sukses-ikon" viewBox="0 0 52 52" aria-hidden="true"><circle class="sukses-putar" cx="26" cy="26" r="24"/><circle class="sukses-lingkar" cx="26" cy="26" r="24"/><path class="sukses-centang" d="M14 27l8 8 16-17"/></svg>';
        box.appendChild(el('h3', null, judul)); box.appendChild(el('p', null, teks));
        const t = el('button', 'btn primary', 'Tutup'); t.type = 'button'; box.appendChild(t);
        o.appendChild(box); document.body.appendChild(o);
        const selesai = () => { clearTimeout(w); o.remove(); };
        const w = setTimeout(selesai, 4200);
        t.addEventListener('click', selesai); o.addEventListener('click', (e) => { if (e.target === o) selesai(); });
    }

    // ---------- muat pustaka ----------
    function muatSkrip(src) {
        return new Promise((ok, gagal) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { s.remove(); gagal(new Error('gagal memuat ' + src)); }; document.head.appendChild(s); });
    }
    const janji = {};
    function muatPustaka(nama, globalName, urls) {
        if (window[globalName]) return Promise.resolve();
        if (!janji[nama]) janji[nama] = (async () => {
            for (const u of urls) { try { await muatSkrip(u); if (window[globalName]) return; } catch (e) { /* sumber berikutnya */ } }
            janji[nama] = null; throw new Error('Pustaka Excel tidak dapat dimuat. Periksa koneksi internet.');
        })();
        return janji[nama];
    }
    const muatExcelJs = () => muatPustaka('exceljs', 'ExcelJS', ['vendor/exceljs.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js']);
    const muatXlsx = () => muatPustaka('xlsx', 'XLSX', ['vendor/xlsx.full.min.js', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js']);

    // =====================================================================
    //  Ekspor Excel
    // =====================================================================
    async function ekspor() {
        const btn = $('btnEkspor'); btn.disabled = true;
        try {
            await muatExcelJs();
            const d = await api(API + '?' + new URLSearchParams({ daftar: 1, status: 'semua', waktu: 'semua', armada: '0', semua: 1 }));
            const rows = d.data.slice().sort((a, b) => (a.tanggal + a.mulai).localeCompare(b.tanggal + b.mulai));
            if (!rows.length) { toast('Belum ada data untuk diekspor.', true); return; }
            const now = new Date();
            const cols = [['No', 6, 'center'], ['Tanggal Pesan', 15, 'center'], ['Hari', 18, 'center'], ['Tanggal Pemakaian', 26, 'left'], ['Sampai Tanggal', 26, 'left'], ['Waktu', 16, 'center'], ['Armada', 10, 'center'],
                ['Tujuan', 44, 'left'], ['Peserta', 10, 'center'], ['Sopir', 14, 'center'], ['Fasilitas', 24, 'left'], ['Pemohon', 20, 'left'], ['Status', 18, 'center']];
            const n = cols.length, FONT = 'Calibri';
            const wb = new ExcelJS.Workbook(); wb.creator = 'Sistem Peminjaman'; wb.created = now;
            const ws = wb.addWorksheet('Pemakaian Armada', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
            const garis = { style: 'thin', color: { argb: 'FFD0D7E2' } }, kotak = { top: garis, left: garis, bottom: garis, right: garis };
            const isi = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
            cols.forEach((c, i) => { ws.getColumn(i + 1).width = c[1]; });
            ws.mergeCells(1, 1, 1, n); const c1 = ws.getCell(1, 1); c1.value = 'DAFTAR PEMAKAIAN ARMADA (MOBIL DINAS) TSU';
            c1.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } }; c1.fill = isi('FF1E3A8A'); c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }; ws.getRow(1).height = 32;
            ws.mergeCells(2, 1, 2, n); const c2 = ws.getCell(2, 1);
            c2.value = 'Diekspor ' + tglPanjang(iso(now)) + ' pukul ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ' · ' + rows.length + ' data · Armada: WR1, WR2, WR3, APV';
            c2.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF475569' } }; c2.fill = isi('FFEFF4FF'); c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }; ws.getRow(2).height = 20;
            ws.getRow(3).height = 6;
            const h = ws.getRow(4); h.height = 26;
            cols.forEach((c, i) => {
                const cell = h.getCell(i + 1); cell.value = c[0]; cell.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = isi('FF2563EB'); cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; cell.border = kotak;
            });
            const WARNA_ARMADA = { WR1: 'FFDBEAFE', WR2: 'FFD1FAE5', WR3: 'FFFEF3C7', APV: 'FFFCE7F3' };
            rows.forEach((r, i) => {
                const [lbl] = labelStatus(r);
                const akhir = r.tanggal_akhir && r.tanggal_akhir !== r.tanggal ? tglPanjang(r.tanggal_akhir) : '';
                const row = ws.addRow([i + 1, r.tgl_pesan ? tglPanjang(r.tgl_pesan).split(', ')[1] : '-', namaHari(r.tanggal) + (akhir ? ' – ' + namaHari(r.tanggal_akhir) : ''), tglPanjang(r.tanggal), akhir || '-',
                    r.mulai + ' - ' + (r.selesai || 'selesai'), r.armada_kode, r.tujuan, r.peserta || '-', r.sopir ? 'Dengan sopir' : 'Tanpa sopir', r.fasilitas || '-', r.pemohon || '-',
                    r.status === 'disetujui' ? (lbl === 'Selesai' ? 'Sudah dilaksanakan' : lbl === 'Berlangsung' ? 'Sedang dilaksanakan' : 'Terjadwal') : lbl]);
                row.height = 21;
                const warna = i % 2 ? 'FFF3F7FF' : 'FFFFFFFF';
                cols.forEach((c, k) => {
                    const cell = row.getCell(k + 1); cell.font = { name: FONT, size: 10.5, color: { argb: 'FF1F2937' } };
                    cell.alignment = { vertical: 'middle', horizontal: c[2], wrapText: true, indent: c[2] === 'left' ? 1 : 0 }; cell.fill = isi(warna); cell.border = kotak;
                });
                const ak = row.getCell(7); ak.font = { name: FONT, size: 10.5, bold: true, color: { argb: 'FF1F2937' } }; ak.fill = isi(WARNA_ARMADA[r.armada_kode] || 'FFE2E8F0');
                const st = row.getCell(n), warnaSt = { menunggu: ['FFFEF3C7', 'FFB45309'], ditolak: ['FFFEE2E2', 'FFB91C1C'] }[r.status]
                    || (lbl === 'Selesai' ? ['FFE2E8F0', 'FF475569'] : lbl === 'Berlangsung' ? ['FFDBEAFE', 'FF1D4ED8'] : ['FFD1FAE5', 'FF047857']);
                st.font = { name: FONT, size: 10.5, bold: true, color: { argb: warnaSt[1] } }; st.fill = isi(warnaSt[0]);
            });
            ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: n } };
            ws.headerFooter.oddFooter = '&LDaftar Pemakaian Armada TSU&RHalaman &P dari &N';
            const buf = await wb.xlsx.writeBuffer(), nama = 'pemakaian-armada-' + iso(now) + '.xlsx';
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            a.download = nama; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
            animasiSukses('Ekspor berhasil', rows.length + ' data sudah diunduh sebagai ' + nama + '.');
        } catch (err) { toast(err.message || 'Ekspor gagal.', true); }
        finally { btn.disabled = false; }
    }

    // =====================================================================
    //  Impor Excel (format "DAFTAR PEMAKAIAN ARMADA": satu lembar per tahun)
    // =====================================================================
    const p2 = (n) => String(n).padStart(2, '0');
    const bulanNo = (t) => { t = String(t || '').toLowerCase().slice(0, 3); const m = { jan: 1, feb: 2, peb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, ags: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 }; return m[t] || 0; };
    const tglIso = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? y + '-' + p2(m) + '-' + p2(d) : ''; };
    /** -> {dari, sampai} (Y-m-d) atau null. Menerima serial Excel, "16 -17 Januari 2026", "30 Jan - 2 Feb 2026", "2026-01-16", "16/01/2026". */
    function bacaTanggal(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') { if (v < 20000 || v > 80000) return null; const d = new Date(Math.round((v - 25569) * 86400000)); const s = tglIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); return s ? { dari: s, sampai: s } : null; }
        const t = String(v).trim(); let m;
        if ((m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) { const s = tglIso(+m[1], +m[2], +m[3]); return s ? { dari: s, sampai: s } : null; }
        if ((m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { const s = tglIso(+m[3], +m[2], +m[1]); return s ? { dari: s, sampai: s } : null; }
        if ((m = t.match(/(\d{1,2})\s*([a-z]+)?\s*[-–]\s*(\d{1,2})\s+([a-z]+)\s+(\d{4})/i))) {
            const m2 = bulanNo(m[4]), m1 = m[2] ? bulanNo(m[2]) : m2; const a = tglIso(+m[5], m1, +m[1]), b = tglIso(+m[5], m2, +m[3]); return a && b ? { dari: a, sampai: b } : null;
        }
        if ((m = t.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i))) { const s = tglIso(+m[3], bulanNo(m[2]), +m[1]); return s ? { dari: s, sampai: s } : null; }
        return null;
    }
    function bacaWaktu(v) {
        const jam = String(v == null ? '' : v).match(/(\d{1,2})[.:](\d{2})/g) || [];
        const f = (x) => { const [h, m] = x.split(/[.:]/); return p2(+h) + ':' + m; };
        return { mulai: jam[0] ? f(jam[0]) : '', selesai: jam[1] ? f(jam[1]) : '' };
    }
    const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const KOLOM = { tglpesan: ['tanggal pesan', 'hari tanggal pesan', 'tgl pesan'], tanggal: ['tanggal pemakaian', 'tgl pemakaian'], akhir: ['sampai tanggal'], waktu: ['waktu pemakaian', 'waktu', 'jam'],
        armada: ['armada', 'mobil'], tujuan: ['tujuan', 'keperluan'], peserta: ['jml peserta', 'jumlah peserta', 'peserta'], fasilitas: ['fasilitas'], sopir: ['sopir', 'driver'],
        pemohon: ['keterangan pemohon', 'pemohon', 'keterangan'], status: ['status'] };
    function peta(hdr) {
        const p = {}; const h = hdr.map(norm);
        Object.keys(KOLOM).forEach((k) => { for (const nama of KOLOM[k]) { const i = h.findIndex((x, j) => x === nama && !Object.values(p).includes(j)); if (i >= 0) { p[k] = i; break; } } });
        return p;
    }
    function ambilBaris(wb) {
        const hasil = []; let sheetDipakai = 0;
        wb.SheetNames.forEach((nama) => {
            const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nama], { header: 1, raw: true, defval: '' });
            let hi = -1; for (let i = 0; i < Math.min(aoa.length, 15); i++) { const p = peta(aoa[i]); if (p.armada != null && p.tujuan != null && p.tanggal != null) { hi = i; break; } }
            if (hi < 0) return;
            sheetDipakai++; const p = peta(aoa[hi]);
            for (let i = hi + 1; i < aoa.length; i++) {
                const r = aoa[i], g = (k) => (p[k] != null ? r[p[k]] : '');
                const tujuan = String(g('tujuan') || '').trim(), armadaTxt = String(g('armada') || '').replace(/\s+/g, '').toUpperCase();
                if (!tujuan && !armadaTxt && (g('tanggal') === '' || g('tanggal') == null)) continue;       // baris kosong (mis. hanya "Terjadwal")
                const tgl = bacaTanggal(g('tanggal')), akhirX = bacaTanggal(g('akhir')), wk = bacaWaktu(g('waktu')), psr = bacaTanggal(g('tglpesan'));
                const fas = String(g('fasilitas') || ''), sopirTxt = String(g('sopir') || '');
                const sopir = /\b(dng|dengan|ya)\b/i.test(sopirTxt || fas), fasBersih = fas.replace(/(dng|dengan|tanpa)\s*dr\w*/ig, '').replace(/^[\s,]+|[\s,]+$/g, '');
                const st = norm(g('status'));
                // Satu baris boleh menyebut beberapa armada ("WR1,WR2", "APV&WR1", "WR2/APV"): dijadikan satu data per armada.
                const daftarArmada = [...new Set(armadaTxt.match(/WR[123]|APV/g) || [armadaTxt])];
                daftarArmada.forEach((kodeArmada) => hasil.push({
                    baris: i + 1, sheet: nama, armada: kodeArmada, tanggal: tgl ? tgl.dari : '', tanggal_akhir: akhirX ? akhirX.dari : (tgl ? tgl.sampai : ''), mulai: wk.mulai || '08:00', selesai: wk.selesai,
                    tujuan, peserta: parseInt(String(g('peserta')).replace(/\D+/g, ''), 10) || 0, sopir, fasilitas: fasBersih, pemohon: String(g('pemohon') || '').trim(),
                    tgl_pesan: psr ? psr.dari : '', status: st.includes('tolak') ? 'ditolak' : st.includes('menunggu') ? 'menunggu' : 'disetujui',
                }));
            }
        });
        return { baris: hasil, sheet: sheetDipakai };
    }
    function bacaFile(file) { return new Promise((ok, gagal) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => gagal(new Error('Berkas tidak dapat dibaca.')); fr.readAsArrayBuffer(file); }); }

    async function mulaiImpor(file) {
        toast('Membaca ' + file.name + '…');
        let h;
        try { await muatXlsx(); h = ambilBaris(XLSX.read(await bacaFile(file), { type: 'array' })); }
        catch (err) { toast(err.message || 'Berkas tidak dapat dibaca.', true); return; }
        if (!h.sheet) { toast('Judul kolom tidak dikenali. Butuh kolom Tanggal Pemakaian, Armada, dan Tujuan (misalnya berkas hasil Ekspor Excel).', true); return; }
        if (!h.baris.length) { toast('Tidak ada baris data di bawah judul kolom.', true); return; }
        let d;
        try { d = await api(API, { aksi: 'impor', uji: true, baris: h.baris }); } catch (err) { toast(err.message, true); return; }
        $('imporSub').textContent = file.name + ' · ' + h.baris.length + ' baris terbaca dari ' + h.sheet + ' lembar';
        const body = $('imporBody'); body.textContent = '';
        const ringkas = el('div', 'impor-ringkas');
        [[d.tambah, 'akan ditambahkan'], [d.duplikat, 'sudah ada (dilewati)'], [d.gagal, 'bermasalah (dilewati)']].forEach(([n, t]) => { const k = el('div', 'impor-kotak'); k.appendChild(el('strong', null, String(n))); k.appendChild(el('span', null, t)); ringkas.appendChild(k); });
        body.appendChild(ringkas);
        body.appendChild(el('p', 'impor-cat', 'Jam berangkat yang tidak terbaca diisi 08:00. Impor tidak memeriksa bentrok (data riwayat apa adanya); bentrok hanya dicek saat menambah atau menyetujui satu per satu.'));
        if (d.rincian_gagal.length) {
            const ul = el('ul', 'impor-gagal'); d.rincian_gagal.slice(0, 30).forEach((x) => ul.appendChild(el('li', null, 'Baris ' + x.baris + ': ' + x.alasan))); body.appendChild(ul);
        }
        const aksiBox = el('div', 'kbtns'); const batal = el('button', 'btn', 'Batal'); batal.type = 'button';
        const ok = el('button', 'btn primary', 'Impor ' + d.tambah + ' data'); ok.type = 'button'; ok.disabled = !d.tambah;
        batal.addEventListener('click', () => tutupModal(imporModal));
        ok.addEventListener('click', async () => {
            ok.disabled = batal.disabled = true; ok.textContent = 'Mengimpor…';
            try {
                const hasil = await api(API, { aksi: 'impor', baris: h.baris });
                tutupModal(imporModal); state.waktu = 'semua'; $('fWaktu').value = 'semua'; state.halaman = 1; await muat(true);
                animasiSukses('Impor berhasil', hasil.tambah + ' data pemakaian ditambahkan' + (hasil.duplikat || hasil.gagal ? ' (' + (hasil.duplikat + hasil.gagal) + ' dilewati)' : '') + '.');
            } catch (err) { toast(err.message, true); ok.disabled = batal.disabled = false; ok.textContent = 'Coba lagi'; }
        });
        aksiBox.appendChild(batal); aksiBox.appendChild(ok); body.appendChild(aksiBox);
        bukaModal(imporModal, d.tambah ? ok : batal);
    }

    // ---------- tombol ----------
    $('btnTambah').addEventListener('click', () => bukaForm(null));
    $('btnEkspor').addEventListener('click', ekspor);
    $('btnImpor').addEventListener('click', () => $('fileExcel').click());
    $('fileExcel').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) mulaiImpor(f); });
    $('btnHapusSemua').addEventListener('click', async () => {
        if (!confirm('Hapus SELURUH data pemakaian armada (' + (hitung.semua != null ? 'semua tanggal' : '') + ')?\nTindakan ini tidak bisa dibatalkan.')) return;
        try { const d = await api(API, { aksi: 'hapus_semua' }); toast(d.dihapus + ' data dihapus'); await muat(true); } catch (err) { toast(err.message, true); }
    });
    $('pgPrev').addEventListener('click', () => { if (state.halaman > 1) { state.halaman--; muat(); } });
    $('pgNext').addEventListener('click', () => { state.halaman++; muat(); });
    $('fWaktu').addEventListener('change', (e) => { state.waktu = e.target.value; state.halaman = 1; muat(); });
    $('fArmada').addEventListener('change', (e) => { state.armada = e.target.value; state.halaman = 1; muat(); });
    let tmr; $('fCari').addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { state.q = e.target.value.trim(); state.halaman = 1; muat(); }, 300); });
    setInterval(() => muat(true), 60000);   // status "sedang dipakai" ikut berubah tanpa memuat ulang halaman
    muat();
})();
