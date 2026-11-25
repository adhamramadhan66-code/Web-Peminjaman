/* Kelola "Daftar jadwal" (khusus admin): tambah, ubah, hapus, dan impor dari Excel.
   Dipakai bersama jadwal.js (lewat window.KPJadwal) untuk tab "Kegiatan & peminjaman" dan "Jadwal kuliah".

   Impor Excel: berkas dibaca di browser (SheetJS), judul kolom dikenali otomatis (urutan kolom bebas),
   lalu server memeriksa semua baris dan mengirim PRATINJAU (belum menyimpan apa pun). Data baru masuk
   setelah admin menekan "Tambahkan". Baris yang sama persis dengan data yang sudah ada dilewati, jadi
   berkas yang sama boleh diimpor berulang kali tanpa membuat data ganda. */
(function () {
    'use strict';
    const { el, api, toast, iso } = window.KP;
    const $ = (id) => document.getElementById(id);

    const NAMA_HARI = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
    const URL_API = { kegiatan: 'api/peminjaman.php', kuliah: 'api/kuliah.php' };
    const JUDUL = { kegiatan: 'Kegiatan & peminjaman', kuliah: 'Jadwal kuliah' };
    // Lokal dulu (opsional, untuk pemakaian tanpa internet), baru CDN resmi SheetJS.
    const URL_XLSX = ['vendor/xlsx.full.min.js', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'];

    // =====================================================================
    //  Pembacaan nilai sel Excel (murni, tidak menyentuh halaman)
    // =====================================================================
    const BULAN = {
        januari: 1, jan: 1, februari: 2, feb: 2, pebruari: 2, maret: 3, mar: 3, april: 4, apr: 4, mei: 5, may: 5,
        juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, agt: 8, ags: 8, aug: 8, september: 9, sep: 9, sept: 9,
        oktober: 10, okt: 10, oct: 10, november: 11, nov: 11, nop: 11, desember: 12, des: 12, dec: 12,
    };
    const pad = (n) => String(n).padStart(2, '0');
    const SEP_RENTANG = '(?:-|\\u2013|s\\/d|s\\.d\\.?|sd|sampai|hingga)';

    function buatTanggal(y, m, d) {
        if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
        const t = new Date(Date.UTC(y, m - 1, d));
        return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? y + '-' + pad(m) + '-' + pad(d) : '';
    }
    function dariSerial(n) {          // nomor seri tanggal Excel -> YYYY-MM-DD (tanpa pengaruh zona waktu)
        const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
        return buatTanggal(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
    function parseTanggal(v) {
        if (v === '' || v == null) return '';
        if (v instanceof Date) return buatTanggal(v.getFullYear(), v.getMonth() + 1, v.getDate());
        if (typeof v === 'number') return v > 20000 && v < 80000 ? dariSerial(v) : '';
        let t = String(v).trim().toLowerCase();
        t = t.replace(/^(senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|ahad)\s*[,.]?\s*/, '');   // buang nama hari di depan
        let m;
        if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/))) return buatTanggal(+m[1], +m[2], +m[3]);
        if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?!\d)/))) {          // hari/bulan/tahun (format Indonesia)
            let y = +m[3]; if (y < 100) y += 2000;
            return buatTanggal(y, +m[2], +m[1]);
        }
        if ((m = t.match(/^(\d{1,2})\s*([a-z]+)\.?,?\s*(\d{4})/)) && BULAN[m[2]]) return buatTanggal(+m[3], BULAN[m[2]], +m[1]);
        if (/^\d{5}$/.test(t)) return dariSerial(+t);
        return '';
    }
    /** Satu sel bisa berisi rentang: "8-10 Oktober 2025", "30 Oktober - 2 November 2025", "24/10/2026 s/d 26/10/2026". */
    function parseTanggalRentang(v) {
        if (typeof v !== 'string') return { mulai: parseTanggal(v), akhir: '' };
        const t = v.trim().toLowerCase();
        let m;
        if ((m = t.match(new RegExp('^(\\d{1,2})\\s*' + SEP_RENTANG + '\\s*(\\d{1,2})\\s+([a-z]+)\\.?,?\\s*(\\d{4})$'))) && BULAN[m[3]]) {
            const a = buatTanggal(+m[4], BULAN[m[3]], +m[1]), z = buatTanggal(+m[4], BULAN[m[3]], +m[2]);
            if (a && z) return { mulai: a, akhir: z };
        }
        if ((m = t.match(new RegExp('^(\\d{1,2})\\s+([a-z]+)\\s*' + SEP_RENTANG + '\\s*(\\d{1,2})\\s+([a-z]+)\\.?,?\\s*(\\d{4})$'))) && BULAN[m[2]] && BULAN[m[4]]) {
            const a = buatTanggal(+m[5], BULAN[m[2]], +m[1]), z = buatTanggal(+m[5], BULAN[m[4]], +m[3]);
            if (a && z) return { mulai: a, akhir: z };
        }
        const bagian = t.split(new RegExp('\\s*(?:\\u2013|s\\/d|s\\.d\\.?|\\bsd\\b|sampai|hingga|\\s-\\s)\\s*'));
        if (bagian.length === 2) {
            const a = parseTanggal(bagian[0]), z = parseTanggal(bagian[1]);
            if (a && z) return { mulai: a, akhir: z };
        }
        // Bukan rentang: baru dibaca sebagai satu tanggal. (Rentang harus diperiksa lebih dulu, kalau tidak
        // "2027-10-08 - 2027-10-10" terbaca sebagai tanggal pertama saja dan tanggal akhirnya hilang diam-diam.)
        return { mulai: parseTanggal(v), akhir: '' };
    }

    const keJam = (mnt) => { mnt = Math.max(0, Math.min(1439, mnt)); return pad(Math.floor(mnt / 60)) + ':' + pad(mnt % 60); };
    function parseJam(v) {
        if (v === '' || v == null) return '';
        if (typeof v === 'number') {
            if (v >= 0 && v < 1) return keJam(Math.round(v * 1440));                                        // sel berformat jam
            if (v >= 1 && v < 80000 && !Number.isInteger(v)) return keJam(Math.round((v - Math.floor(v)) * 1440));   // tanggal + jam
            if (Number.isInteger(v) && v >= 0 && v <= 24) return keJam(v * 60);                            // "8" = 08:00
            return '';
        }
        const t = String(v).trim().toLowerCase();
        let m = t.match(/(\d{1,2})\s*[.:]\s*(\d{2})/);
        if (m && +m[1] <= 24 && +m[2] < 60) return keJam(+m[1] * 60 + +m[2]);
        m = t.match(/^(\d{1,2})\s*(?:wib|wita|wit)?$/);
        if (m && +m[1] <= 24) return keJam(+m[1] * 60);
        return '';
    }
    /** Kolom "Waktu/Jam" yang berisi rentang: "07:00 - 14:00", "07.00-14.00 WIB", "8-12". */
    function parseWaktu(v) {
        if (v === '' || v == null) return { mulai: '', selesai: '' };
        if (typeof v === 'number') return { mulai: parseJam(v), selesai: '' };
        const t = String(v);
        const cocok = t.match(/\d{1,2}\s*[.:]\s*\d{2}/g) || [];
        if (cocok.length >= 2) return { mulai: parseJam(cocok[0]), selesai: parseJam(cocok[1]) };
        if (cocok.length === 1) return { mulai: parseJam(cocok[0]), selesai: '' };
        const m = t.match(new RegExp('(\\d{1,2})\\s*' + SEP_RENTANG + '\\s*(\\d{1,2})\\b'));
        if (m && +m[1] < 24 && +m[2] <= 24) return { mulai: keJam(+m[1] * 60), selesai: keJam(+m[2] * 60) };
        return { mulai: '', selesai: '' };
    }

    // =====================================================================
    //  Mengenali judul kolom & membentuk baris impor
    // =====================================================================
    const SINONIM = {
        tanggal: ['tanggal', 'tgl', 'tanggalkegiatan', 'tanggalpelaksanaan', 'tanggalmulai', 'haritanggal', 'tanggalpemakaian', 'tanggalpenggunaan'],
        tanggal_akhir: ['sampaitanggal', 'tanggalakhir', 'tanggalselesai', 'sampai', 'hingga', 'sd', 'tanggalsampai'],
        waktu: ['waktu', 'jam', 'pukul', 'jamkegiatan', 'waktupelaksanaan', 'jampemakaian', 'waktupemakaian'],
        mulai: ['mulai', 'jammulai', 'waktumulai', 'pukulmulai', 'start'],
        selesai: ['selesai', 'jamselesai', 'waktuselesai', 'pukulselesai', 'sampaijam', 'jamakhir', 'end'],
        keperluan: ['kegiatan', 'keperluan', 'acara', 'namakegiatan', 'agenda', 'namaacara'],
        peminjam: ['pemohon', 'peminjam', 'penanggungjawab', 'pic', 'namapemohon', 'namapeminjam'],
        ruang: ['ruang', 'ruangan', 'tempat', 'lokasi', 'koderuang', 'namaruang', 'ruangkelas'],
        peserta: ['peserta', 'jumlahpeserta', 'jmlpeserta', 'jumlah'],
        fasilitas: ['fasilitas', 'kebutuhan', 'fasilitasyangdibutuhkan', 'peralatan'],
        status: ['status'],
        catatan: ['catatan', 'keterangan', 'ket'],
        hari: ['hari'],
        matkul: ['matakuliah', 'matkul', 'mk', 'namamatakuliah', 'namamk'],
        pengajar: ['pengajar', 'dosen', 'dosenpengampu', 'namadosen', 'dosenpengajar'],
        kelas: ['kelas', 'rombel', 'namakelas'],
        prodi: ['prodi', 'programstudi', 'jurusan'],
    };
    const normHeader = (h) => String(h == null ? '' : h).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

    /** Mencari baris judul kolom (boleh ada judul/keterangan di atasnya). Hasil: {tipe, idx, peta} atau null. */
    function deteksiHeader(rows) {
        for (let i = 0; i < Math.min(rows.length, 30); i++) {
            const peta = {};
            rows[i].forEach((sel, ci) => {
                const n = normHeader(sel);
                if (!n) return;
                for (const f in SINONIM) if (peta[f] === undefined && SINONIM[f].indexOf(n) >= 0) { peta[f] = ci; break; }
            });
            const kuliah = peta.hari !== undefined && peta.matkul !== undefined && peta.ruang !== undefined;
            const kegiatan = peta.tanggal !== undefined && peta.keperluan !== undefined && peta.ruang !== undefined;
            if (kuliah && peta.tanggal === undefined) return { tipe: 'kuliah', idx: i, peta };
            if (kegiatan) return { tipe: 'kegiatan', idx: i, peta };
            if (kuliah) return { tipe: 'kuliah', idx: i, peta };
        }
        return null;
    }

    const teks = (v) => (v == null ? '' : String(v).trim());

    function bentukBaris(tipe, rows, peta, idx, awalBaris, nomor) {
        const hasil = [];
        for (let i = idx + 1; i < rows.length; i++) {
            const r = rows[i];
            const c = (f) => (peta[f] === undefined ? '' : (r[peta[f]] == null ? '' : r[peta[f]]));
            if (Object.keys(peta).every((f) => teks(r[peta[f]]) === '')) continue;       // baris kosong
            nomor.seq++;
            nomor.label[nomor.seq] = (nomor.banyakLembar ? '\u2018' + nomor.lembar + '\u2019 ' : '') + 'baris ' + (awalBaris + i + 1);

            // jam: kolom Mulai/Selesai, atau satu kolom Waktu berisi rentang. Isi yang tak terbaca tetap dikirim
            // apa adanya supaya server melaporkannya (bukan diam-diam diganti jam bawaan).
            let mulai = peta.mulai !== undefined ? parseJam(c('mulai')) : '';
            let selesai = peta.selesai !== undefined ? parseJam(c('selesai')) : '';
            if ((!mulai || !selesai) && peta.waktu !== undefined) {
                const w = parseWaktu(c('waktu'));
                if (!mulai) mulai = w.mulai;
                if (!selesai) selesai = w.selesai;
                if (!mulai && teks(c('waktu'))) mulai = teks(c('waktu'));
            }
            if (!mulai && teks(c('mulai'))) mulai = teks(c('mulai'));
            if (!selesai && teks(c('selesai'))) selesai = teks(c('selesai'));

            if (tipe === 'kegiatan') {
                const rt = parseTanggalRentang(c('tanggal'));
                let akhir = rt.akhir;
                if (peta.tanggal_akhir !== undefined) akhir = parseTanggal(c('tanggal_akhir')) || akhir;
                hasil.push({
                    baris: nomor.seq, ruang: teks(c('ruang')), tanggal: rt.mulai, tanggal_asli: teks(c('tanggal')), tanggal_akhir: akhir,
                    mulai, selesai, peminjam: teks(c('peminjam')), keperluan: teks(c('keperluan')), peserta: teks(c('peserta')),
                    fasilitas: teks(c('fasilitas')), status: teks(c('status')), catatan: teks(c('catatan')),
                });
            } else {
                hasil.push({
                    baris: nomor.seq, ruang: teks(c('ruang')), hari: teks(c('hari')), mulai, selesai,
                    matkul: teks(c('matkul')), pengajar: teks(c('pengajar')), kelas: teks(c('kelas')), prodi: teks(c('prodi')),
                });
            }
        }
        return hasil;
    }

    /** Dari workbook: semua lembar berjenis sama (utamakan jenis tab aktif) digabung menjadi satu daftar baris. */
    function ambilData(wb, tabAktif) {
        const kandidat = [];
        wb.SheetNames.forEach((nama) => {
            const ws = wb.Sheets[nama];
            if (!ws || !ws['!ref']) return;
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
            const awal = XLSX.utils.decode_range(ws['!ref']).s.r;          // baris pertama area data (0 = baris 1)
            const h = deteksiHeader(rows);
            if (h) kandidat.push({ nama, rows, awal, tipe: h.tipe, idx: h.idx, peta: h.peta });
        });
        if (!kandidat.length) return null;
        const tipe = (kandidat.find((k) => k.tipe === tabAktif) || kandidat[0]).tipe;
        const pilih = kandidat.filter((k) => k.tipe === tipe);
        const nomor = { seq: 0, label: {}, banyakLembar: pilih.length > 1, lembar: '' };
        let baris = [];
        pilih.forEach((k) => { nomor.lembar = k.nama; baris = baris.concat(bentukBaris(tipe, k.rows, k.peta, k.idx, k.awal, nomor)); });
        const lain = kandidat.filter((k) => k.tipe !== tipe).map((k) => ({ nama: k.nama, tipe: k.tipe }));
        return { tipe, baris, label: nomor.label, lembar: pilih.map((k) => k.nama), lain };
    }

    // =====================================================================
    //  Pustaka Excel (SheetJS) dimuat hanya saat dibutuhkan
    // =====================================================================
    let janjiXlsx = null;
    function muatSkrip(src) {
        return new Promise((ok, gagal) => {
            const s = document.createElement('script');
            s.src = src; s.onload = ok; s.onerror = () => { s.remove(); gagal(new Error('gagal memuat ' + src)); };
            document.head.appendChild(s);
        });
    }
    function muatXlsx() {
        if (window.XLSX) return Promise.resolve();
        if (!janjiXlsx) {
            janjiXlsx = (async () => {
                for (const u of URL_XLSX) { try { await muatSkrip(u); if (window.XLSX) return; } catch (e) { /* coba sumber berikutnya */ } }
                janjiXlsx = null;
                throw new Error('Pustaka Excel tidak dapat dimuat. Periksa koneksi internet, atau simpan xlsx.full.min.js ke folder "vendor".');
            })();
        }
        return janjiXlsx;
    }
    function bacaFile(file) {
        return new Promise((ok, gagal) => {
            const fr = new FileReader();
            fr.onload = () => ok(fr.result); fr.onerror = () => gagal(new Error('Berkas tidak dapat dibaca.'));
            fr.readAsArrayBuffer(file);
        });
    }

    // =====================================================================
    //  Modal
    // =====================================================================
    const formModal = $('formModal'), imporModal = $('imporModal');
    function bukaModal(m, fokus) { m.hidden = false; document.body.style.overflow = 'hidden'; if (fokus) fokus.focus(); }
    function tutupModal(m) { if (m.hidden) return; m.hidden = true; if (!document.querySelector('.room-modal:not([hidden])')) document.body.style.overflow = ''; }
    const hapusModal = $('hapusModal');
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { tutupModal(formModal); tutupModal(imporModal); tutupModal(hapusModal); } });
    $('formClose').addEventListener('click', () => tutupModal(formModal));
    $('kBatal').addEventListener('click', () => tutupModal(formModal));
    $('imporClose').addEventListener('click', () => tutupModal(imporModal));

    // =====================================================================
    //  Form tambah / ubah
    // =====================================================================
    const HARI_OPSI = [1, 2, 3, 4, 5, 6, 7].map((n) => [n, NAMA_HARI[n]]);
    const FIELD = {
        kegiatan: [
            { k: 'elemen_id', t: 'ruang', label: 'Ruang', wajib: true, penuh: true },
            { k: 'tanggal', t: 'date', label: 'Tanggal', wajib: true },
            { k: 'status', t: 'select', label: 'Status', opsi: [['disetujui', 'Disetujui'], ['menunggu', 'Menunggu persetujuan'], ['ditolak', 'Ditolak']] },
            { k: 'mulai', t: 'time', label: 'Jam mulai', wajib: true },
            { k: 'selesai', t: 'time', label: 'Jam selesai', wajib: true },
            { k: 'keperluan', t: 'text', label: 'Nama kegiatan', wajib: true, penuh: true, maks: 160 },
            { k: 'peminjam', t: 'text', label: 'Pemohon', maks: 80 },
            { k: 'peserta', t: 'number', label: 'Jumlah peserta' },
            { k: 'fasilitas', t: 'text', label: 'Fasilitas', penuh: true, maks: 255 },
            { k: 'catatan', t: 'text', label: 'Catatan', penuh: true, maks: 255 },
        ],
        kuliah: [
            { k: 'elemen_id', t: 'ruang', label: 'Ruang', wajib: true, penuh: true },
            { k: 'hari', t: 'select', label: 'Hari (berlaku setiap minggu)', wajib: true, opsi: HARI_OPSI, penuh: true },
            { k: 'mulai', t: 'time', label: 'Jam mulai', wajib: true },
            { k: 'selesai', t: 'time', label: 'Jam selesai', wajib: true },
            { k: 'matkul', t: 'text', label: 'Mata kuliah', wajib: true, penuh: true, maks: 160 },
            { k: 'pengajar', t: 'text', label: 'Pengajar', penuh: true, maks: 160 },
            { k: 'kelas', t: 'text', label: 'Kelas', maks: 40 },
            { k: 'prodi', t: 'text', label: 'Program studi', maks: 120 },
        ],
    };

    let formKini = null;       // { tab, id, inputs }

    function buatInput(f, nilai) {
        let inp;
        if (f.t === 'ruang') {
            inp = el('select', 'in');
            inp.appendChild(new Option('Pilih ruang\u2026', ''));
            (window.KPJadwal ? window.KPJadwal.lantai() : []).forEach((l) => {
                if (!l.ruang.length) return;
                const og = document.createElement('optgroup'); og.label = l.nama;
                l.ruang.forEach((r) => og.appendChild(new Option(r.nama, r.id)));
                inp.appendChild(og);
            });
        } else if (f.t === 'select') {
            inp = el('select', 'in');
            if (f.k === 'hari') inp.appendChild(new Option('Pilih hari\u2026', ''));
            f.opsi.forEach(([v, t]) => inp.appendChild(new Option(t, v)));
        } else {
            inp = el('input', 'in'); inp.type = f.t;
            if (f.maks) inp.maxLength = f.maks;
            if (f.t === 'number') { inp.min = '0'; inp.max = '9999'; inp.inputMode = 'numeric'; }
            inp.autocomplete = 'off';
        }
        inp.id = 'kf_' + f.k;
        inp.value = nilai == null ? '' : nilai;
        return inp;
    }

    function bukaForm(tab, r) {
        const lantai = window.KPJadwal ? window.KPJadwal.lantai() : [];
        if (!lantai.some((l) => l.ruang.length)) { toast('Data ruang belum termuat. Coba lagi sebentar lagi.', true); return; }
        const ubah = !!r;
        $('formTitle').textContent = (ubah ? 'Ubah ' : 'Tambah ') + (tab === 'kegiatan' ? 'kegiatan / peminjaman' : 'jadwal kuliah');
        $('formSub').textContent = tab === 'kegiatan'
            ? 'Data langsung tampil di timeline sesuai statusnya.'
            : 'Jadwal kuliah berlaku berulang setiap minggu pada hari yang dipilih.';
        $('kErr').className = 'form-err'; $('kErr').textContent = '';
        const awal = ubah ? Object.assign({}, r, { elemen_id: r.ruang_id, peserta: r.peserta || '' })
            : (tab === 'kegiatan' ? { tanggal: window.KPJadwal.tanggal(), status: 'disetujui' } : {});
        const box = $('kFields'); box.textContent = '';
        const inputs = {};
        FIELD[tab].forEach((f) => {
            const lb = el('label', f.penuh ? 'penuh' : '');
            lb.appendChild(document.createTextNode(f.label));
            if (f.wajib) lb.appendChild(el('em', null, ' *'));
            inputs[f.k] = buatInput(f, awal[f.k]);
            lb.appendChild(inputs[f.k]);
            box.appendChild(lb);
        });
        formKini = { tab, id: ubah ? r.id : 0, inputs };
        $('kSimpan').textContent = ubah ? 'Simpan perubahan' : 'Tambahkan';
        bukaModal(formModal, inputs[FIELD[tab][0].k]);
    }

    function pesanForm(t) { const e = $('kErr'); e.textContent = t; e.className = 'form-err' + (t ? ' show' : ''); }

    async function kirimForm(paksa) {
        if (!formKini) return;
        const { tab, id, inputs } = formKini;
        const p = { aksi: 'simpan', id };
        for (const f of FIELD[tab]) {
            const v = inputs[f.k].value.trim();
            if (f.wajib && v === '') { pesanForm(f.label.replace(/ \(.*\)/, '') + ' wajib diisi.'); inputs[f.k].focus(); return; }
            p[f.k] = (f.t === 'ruang' || f.k === 'hari' || f.t === 'number') ? Number(v) || 0 : v;
        }
        if (p.selesai <= p.mulai) { pesanForm('Jam selesai harus lebih besar dari jam mulai.'); inputs.selesai.focus(); return; }
        if (paksa) p.paksa = true;
        pesanForm('');
        const btn = $('kSimpan'); btn.disabled = true;
        try {
            const d = await api(URL_API[tab], p);
            if (d.bentrok) {
                btn.disabled = false;
                if (confirm('Perhatian: ' + d.bentrok + '\n\nTetap simpan jadwal ini?')) return kirimForm(true);
                return;
            }
            tutupModal(formModal);
            toast(id ? 'Perubahan disimpan' : 'Data ditambahkan');
            if (window.KPJadwal) await window.KPJadwal.segarkan();
        } catch (err) { pesanForm(err.message); }
        btn.disabled = false;
    }
    $('kForm').addEventListener('submit', (e) => { e.preventDefault(); kirimForm(false); });

    async function hapus(tab, r) {
        const nama = tab === 'kegiatan' ? r.keperluan : r.matkul;
        const info = tab === 'kegiatan'
            ? r.tanggal + ', ' + r.mulai + '\u2013' + r.selesai + ', ' + r.ruang
            : NAMA_HARI[r.hari] + ' ' + r.mulai + '\u2013' + r.selesai + ', ' + r.ruang + ' (berlaku setiap minggu)';
        if (!confirm('Hapus "' + nama + '"?\n' + info + '\n\nTindakan ini tidak bisa dibatalkan.')) return;
        try {
            await api(URL_API[tab], { aksi: 'hapus', id: r.id });
            toast('Data dihapus');
            await window.KPJadwal.segarkan();
        } catch (err) { toast(err.message, true); }
    }

    // =====================================================================
    //  Hapus semua (per jenis data, atau keduanya)
    // =====================================================================
    function pesanHapus(t) { const e = $('hpErr'); e.textContent = t; e.className = 'form-err' + (t ? ' show' : ''); }
    function perbaruiHapus() {
        const a = $('hpKegiatan').checked, b = $('hpKuliah').checked;
        $('hpOk').disabled = !(a || b);
        $('hpOkTeks').textContent = a && b ? 'Hapus semua' : 'Hapus';
    }
    function bukaHapusSemua() {
        const tab = window.KPJadwal.tab();
        $('hpKegiatan').checked = tab === 'kegiatan';     // bawaan: hanya jenis data pada tab yang sedang dibuka
        $('hpKuliah').checked = tab === 'kuliah';
        pesanHapus(''); perbaruiHapus();
        $('hpBatal').disabled = false;
        bukaModal(hapusModal, $('hpBatal'));
    }
    async function jalankanHapusSemua() {
        const pilih = [];
        if ($('hpKegiatan').checked) pilih.push('kegiatan');
        if ($('hpKuliah').checked) pilih.push('kuliah');
        if (!pilih.length) return;
        const ok = $('hpOk'), batal = $('hpBatal');
        ok.disabled = true; batal.disabled = true; pesanHapus('');
        const hasil = [];
        try {
            for (const tab of pilih) {
                const d = await api(URL_API[tab], { aksi: 'hapus_semua' });
                hasil.push(d.terhapus + (tab === 'kegiatan' ? ' kegiatan/peminjaman' : ' jadwal kuliah'));
            }
            tutupModal(hapusModal);
            toast(hasil.join(' dan ') + ' dihapus');
        } catch (err) {
            pesanHapus((hasil.length ? hasil.join(' dan ') + ' sudah terhapus, tetapi ' : '') + err.message);
        }
        batal.disabled = false; perbaruiHapus();
        if (window.KPJadwal) await window.KPJadwal.segarkan();
    }
    $('btnHapusSemua').addEventListener('click', bukaHapusSemua);
    $('hpKegiatan').addEventListener('change', perbaruiHapus);
    $('hpKuliah').addEventListener('change', perbaruiHapus);
    $('hpBatal').addEventListener('click', () => tutupModal(hapusModal));
    $('hapusClose').addEventListener('click', () => tutupModal(hapusModal));
    $('hpOk').addEventListener('click', jalankanHapusSemua);

    // =====================================================================
    //  Ekspor Excel (berformat: judul, header berwarna, garis, filter)
    // =====================================================================
    const URL_EXCELJS = ['vendor/exceljs.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'];
    let janjiExcelJs = null;
    function muatExcelJs() {
        if (window.ExcelJS) return Promise.resolve();
        if (!janjiExcelJs) {
            janjiExcelJs = (async () => {
                for (const u of URL_EXCELJS) { try { await muatSkrip(u); if (window.ExcelJS) return; } catch (e) { /* sumber berikutnya */ } }
                janjiExcelJs = null;
                throw new Error('Pustaka ekspor Excel tidak dapat dimuat. Periksa koneksi internet.');
            })();
        }
        return janjiExcelJs;
    }
    const HARI_NAMA = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
    const BLN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const tglPanjang = (s) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); return HARI_NAMA[dt.getDay() || 7] + ', ' + d + ' ' + BLN[m - 1] + ' ' + y; };

    async function ekspor() {
        const tab = window.KPJadwal.tab();
        const btn = $('btnEkspor'); btn.disabled = true;
        try {
            await muatExcelJs();
            const d = await api(tab === 'kegiatan' ? 'api/peminjaman.php?status=disetujui&waktu=semua&semua=1' : 'api/jadwal.php?daftar=kuliah&semua=1');
            const rows = d.data || [];
            if (!rows.length) { toast('Belum ada data untuk diekspor.', true); return; }
            const now = new Date(), nowIso = iso(now), menitNow = now.getHours() * 60 + now.getMinutes();
            const mnt = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

            let judul, sub, cols, sheetName, fileName, mapRow, hariKe = null;
            if (tab === 'kegiatan') {
                judul = 'DAFTAR KEGIATAN & PEMINJAMAN RUANGAN'; sheetName = 'Kegiatan'; fileName = 'kegiatan-peminjaman-' + nowIso + '.xlsx';
                cols = [['No', 6, 'center'], ['Tanggal', 26, 'left'], ['Jam', 15, 'center'], ['Kegiatan', 38, 'left'], ['Pemohon', 24, 'left'], ['Ruang', 12, 'center'], ['Lantai', 14, 'left'], ['Peserta', 10, 'center'], ['Fasilitas', 28, 'left'], ['Status', 13, 'center']];
                mapRow = (r, i) => [i + 1, tglPanjang(r.tanggal), r.mulai + ' - ' + r.selesai, r.keperluan || '-', r.peminjam || '-', r.ruang, r.lantai || '-', r.peserta || '-', r.fasilitas || '-',
                    (r.tanggal < nowIso || (r.tanggal === nowIso && mnt(r.selesai) <= menitNow)) ? 'Selesai' : 'Terjadwal'];
            } else {
                judul = 'DAFTAR JADWAL KULIAH'; sheetName = 'Jadwal Kuliah'; fileName = 'jadwal-kuliah-' + nowIso + '.xlsx';
                cols = [['No', 6, 'center'], ['Hari', 12, 'center'], ['Jam', 15, 'center'], ['Mata Kuliah', 40, 'left'], ['Kelas', 12, 'center'], ['Pengajar', 28, 'left'], ['Program Studi', 26, 'left'], ['Ruang', 12, 'center'], ['Lantai', 14, 'left']];
                mapRow = (r, i) => [i + 1, HARI_NAMA[r.hari] || '-', r.mulai + ' - ' + r.selesai, r.matkul, r.kelas || '-', r.pengajar || '-', r.prodi || '-', r.ruang, r.lantai || '-'];
                hariKe = (r) => r.hari;
            }
            sub = 'Diekspor ' + tglPanjang(nowIso) + ' pukul ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ' · ' + rows.length + ' data';

            const wb = new ExcelJS.Workbook();
            wb.creator = 'Sistem Peminjaman Ruangan'; wb.created = now;
            const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
            const n = cols.length, FONT = 'Calibri';
            const garis = { style: 'thin', color: { argb: 'FFD0D7E2' } };
            const kotak = { top: garis, left: garis, bottom: garis, right: garis };
            cols.forEach((c, i) => { ws.getColumn(i + 1).width = c[1]; });

            ws.mergeCells(1, 1, 1, n);
            const c1 = ws.getCell(1, 1); c1.value = judul;
            c1.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
            c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
            c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }; ws.getRow(1).height = 32;
            ws.mergeCells(2, 1, 2, n);
            const c2 = ws.getCell(2, 1); c2.value = sub;
            c2.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF475569' } };
            c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF4FF' } };
            c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }; ws.getRow(2).height = 20;
            ws.getRow(3).height = 6;

            const h = ws.getRow(4); h.height = 26;
            cols.forEach((c, i) => {
                const cell = h.getCell(i + 1); cell.value = c[0];
                cell.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = kotak;
            });

            const WARNA_HARI = ['', 'FFFFFFFF', 'FFF3F7FF'];
            let band = 0, hariLalu = null;
            rows.forEach((r, i) => {
                if (hariKe) { const hk = hariKe(r); if (hk !== hariLalu) { band++; hariLalu = hk; } }
                const row = ws.addRow(mapRow(r, i)); row.height = 21;
                const warna = hariKe ? WARNA_HARI[1 + (band % 2)] : (i % 2 ? 'FFF3F7FF' : 'FFFFFFFF');
                cols.forEach((c, k) => {
                    const cell = row.getCell(k + 1);
                    cell.font = { name: FONT, size: 10.5, color: { argb: 'FF1F2937' } };
                    cell.alignment = { vertical: 'middle', horizontal: c[2], wrapText: true, indent: c[2] === 'left' ? 1 : 0 };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: warna } };
                    cell.border = kotak;
                });
                if (tab === 'kegiatan') {
                    const st = row.getCell(n), selesai = st.value === 'Selesai';
                    st.font = { name: FONT, size: 10.5, bold: true, color: { argb: selesai ? 'FF475569' : 'FF047857' } };
                    st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: selesai ? 'FFE2E8F0' : 'FFD1FAE5' } };
                }
            });
            ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: n } };
            ws.headerFooter.oddFooter = '&L' + judul + '&RHalaman &P dari &N';

            const buf = await wb.xlsx.writeBuffer();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            a.download = fileName; document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
            toast('Berhasil mengekspor ' + rows.length + ' data ke Excel.');
        } catch (err) { toast(err.message || 'Ekspor gagal.', true); }
        finally { btn.disabled = false; }
    }

    // =====================================================================
    //  Impor Excel: baca -> pratinjau dari server -> konfirmasi
    // =====================================================================
    async function mulaiImpor(file) {
        toast('Membaca ' + file.name + '\u2026');
        let h;
        try {
            await muatXlsx();
            const wb = XLSX.read(await bacaFile(file), { type: 'array' });
            h = ambilData(wb, window.KPJadwal.tab());
        } catch (err) { toast(err.message || 'Berkas tidak dapat dibaca.', true); return; }
        if (!h) {
            toast('Judul kolom tidak dikenali. Pastikan baris pertama berisi judul kolom, misalnya hasil Ekspor Excel.', true);
            return;
        }
        if (!h.baris.length) { toast('Tidak ada baris data di bawah judul kolom.', true); return; }
        if (window.KPJadwal.tab() !== h.tipe) window.KPJadwal.keTab(h.tipe);       // berkas berisi jenis lain: pindah tab otomatis
        try {
            const d = await api(URL_API[h.tipe], { aksi: 'impor', uji: true, baris: h.baris });
            pratinjau(file.name, h, d);
        } catch (err) { toast(err.message, true); }
    }

    function stat(angka, label, kls) {
        const d = el('div', kls || ''); d.appendChild(el('b', null, String(angka))); d.appendChild(el('span', null, label)); return d;
    }

    function pratinjau(namaFile, h, d) {
        $('imporTitle').textContent = 'Impor ' + JUDUL[h.tipe];
        $('imporSub').textContent = namaFile + ' \u00b7 lembar ' + h.lembar.join(', ');
        const body = $('imporBody'); body.textContent = '';

        const grid = el('div', 'impor-stat');
        grid.appendChild(stat(d.baris_dibaca, 'baris terbaca'));
        grid.appendChild(stat(d.tambah, 'data akan ditambahkan', 'ok'));
        grid.appendChild(stat(d.duplikat, 'sudah ada (dilewati)'));
        grid.appendChild(stat(d.gagal, 'bermasalah (dilewati)', d.gagal ? 'gagal' : ''));
        body.appendChild(grid);

        if (d.jam_bawaan) body.appendChild(el('div', 'impor-catatan', d.jam_bawaan + ' baris tidak punya jam lengkap di Excel; jamnya diisi otomatis (kosong = 08:00\u201316:00, hanya jam mulai = selesai 3 jam kemudian) dan dicatat di kolom catatan.'));
        if (h.tipe === 'kegiatan') body.appendChild(el('div', 'impor-catatan', 'Bentrok dengan jadwal lain tidak menghalangi impor (data asli TSU memang banyak yang bentrok); bentrok tampil bertumpuk di timeline.'));
        if (h.lain.length) body.appendChild(el('div', 'impor-catatan', 'Lembar ' + h.lain.map((x) => '\u2018' + x.nama + '\u2019').join(', ') + ' berisi ' + JUDUL[h.lain[0].tipe] + ' dan tidak ikut diimpor sekarang. Pindah ke tab tersebut lalu impor berkas ini lagi.'));

        if (d.gagal) {
            const wrap = el('div', 'impor-masalah'), tbl = el('table');
            const th = el('tr'); th.appendChild(el('th', null, 'Lokasi')); th.appendChild(el('th', null, 'Masalah')); tbl.appendChild(th);
            d.rincian_gagal.forEach((x) => {
                const tr = el('tr'); tr.appendChild(el('td', null, h.label[x.baris] || 'baris ' + x.baris)); tr.appendChild(el('td', null, x.alasan)); tbl.appendChild(tr);
            });
            wrap.appendChild(tbl); body.appendChild(wrap);
            if (d.gagal > d.rincian_gagal.length) body.appendChild(el('div', 'impor-info', '\u2026dan ' + (d.gagal - d.rincian_gagal.length) + ' baris bermasalah lainnya.'));
            if (d.rincian_gagal.some((x) => x.alasan.indexOf('tidak ada di Editor Ruang') >= 0)) {
                body.appendChild(el('div', 'impor-info', 'Ruang yang belum ada bisa ditambahkan di menu Editor Ruang. Setelah itu impor berkas yang sama lagi: data yang sudah masuk tidak akan ganda.'));
            }
        }

        const aksi = el('div', 'kbtns');
        const batal = el('button', 'btn', 'Batal'); batal.type = 'button';
        const ok = el('button', 'btn primary', d.tambah ? 'Tambahkan ' + d.tambah + ' data' : 'Tidak ada data baru'); ok.type = 'button'; ok.disabled = !d.tambah;
        batal.addEventListener('click', () => tutupModal(imporModal));
        ok.addEventListener('click', async () => {
            ok.disabled = true; batal.disabled = true; ok.textContent = 'Menambahkan\u2026';
            try {
                const hasil = await api(URL_API[h.tipe], { aksi: 'impor', uji: false, baris: h.baris });
                tutupModal(imporModal);
                toast(hasil.tambah + ' data ditambahkan' + (hasil.duplikat || hasil.gagal ? ' (' + (hasil.duplikat + hasil.gagal) + ' dilewati)' : ''));
                if (window.KPJadwal) { window.KPJadwal.tampilkanSemua(); await window.KPJadwal.segarkan(); }
            } catch (err) { toast(err.message, true); ok.disabled = false; batal.disabled = false; ok.textContent = 'Coba lagi'; }
        });
        aksi.appendChild(batal); aksi.appendChild(ok); body.appendChild(aksi);
        bukaModal(imporModal, d.tambah ? ok : batal);
    }

    // ---------- tombol di panel Daftar jadwal ----------
    $('btnTambah').addEventListener('click', () => bukaForm(window.KPJadwal.tab(), null));
    $('btnEkspor').addEventListener('click', ekspor);
    $('btnImpor').addEventListener('click', () => $('fileExcel').click());
    $('fileExcel').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) mulaiImpor(f); });

    window.KPKelola = {
        ubah: (tab, r) => bukaForm(tab, r),
        hapus,
        tambah: (tab) => bukaForm(tab, null),
        _uji: { parseTanggal, parseTanggalRentang, parseJam, parseWaktu, deteksiHeader, ambilData },
    };
})();
