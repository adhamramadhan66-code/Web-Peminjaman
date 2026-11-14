/* Halaman Pesan (messenger) antara admin dan akun pengguna.
   - Admin   : daftar semua akun pengguna di kiri, percakapan terpilih di kanan.
   - Pengguna: hanya satu percakapan, yaitu dengan admin (daftar kiri disembunyikan).
   Isi pesan selalu dipasang dengan textContent (bukan innerHTML) sehingga aman dari XSS. */
(function () {
    'use strict';
    const { el, iso, api, toast, tanggalPendek, tanggalPanjang, dariIso } = window.KP;
    const $ = (id) => document.getElementById(id);

    const saya = window.kampuslyUser || {};
    let admin = saya.peran === 'admin';          // dikonfirmasi ulang dari server saat daftar dimuat
    let kontak = [];
    let aktif = 0;                               // pengguna_id percakapan yang sedang dibuka (0 = belum ada)
    let terakhirId = 0;                          // id pesan terbaru yang sudah tampil
    const sudahTampil = new Set();
    const barisPesan = new Map();                // id pesan -> { baris, jam, m } (untuk mengubah jadi "dihapus")
    let tanggalTerakhir = '', pengirimTerakhir = '';
    let cari = '';
    let tokenPesan = 0, sedangPesan = false;
    let tokenKontak = 0, sedangKontak = false, pertamaMuat = true;
    const deepLink = +(new URLSearchParams(location.search).get('u') || 0);
    const layarKecil = window.matchMedia('(max-width: 768px)');
    const composer = document.querySelector('.composer');
    const ketik = $('ketik'), tombol = $('kirimBtn');
    const placeholderAwal = ketik.placeholder;
    let terpilih = 0;                            // id pesan yang sedang dipilih untuk dihapus (0 = tidak ada)

    // ---------- alat bantu tampilan ----------
    const inisial = (n) => (String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('') || '?').toUpperCase();
    const warna = (id) => 'hsl(' + ((Number(id) * 67) % 360) + ' 48% 40%)';
    function avatar(nama, id) { const a = el('div', 'avatar', inisial(nama)); a.style.background = warna(id); return a; }

    const pisah = (s) => { const p = String(s).split(' '); return { tgl: p[0], jam: (p[1] || '').slice(0, 5) }; };
    function kemarin() { const d = new Date(); d.setDate(d.getDate() - 1); return iso(d); }
    function labelTanggal(tgl) {
        if (tgl === iso(new Date())) return 'Hari ini';
        if (tgl === kemarin()) return 'Kemarin';
        return tanggalPanjang(dariIso(tgl));
    }
    function waktuDaftar(s) {
        const { tgl, jam } = pisah(s);
        if (tgl === iso(new Date())) return jam;
        if (tgl === kemarin()) return 'Kemarin';
        return tanggalPendek(dariIso(tgl)).replace(/\s\d{4}$/, '');
    }
    const milikku = (m) => (admin ? m.dari === 'admin' : m.dari === 'pengguna');

    // ---------- daftar akun (admin) ----------
    function renderKontak() {
        if (!admin) return;
        const box = $('kontakList'); box.textContent = '';
        if (!kontak.length) {
            box.appendChild(el('p', 'kontak-kosong', cari ? 'Tidak ada akun yang cocok.' : 'Belum ada akun pengguna yang terdaftar.'));
            return;
        }
        kontak.forEach((k) => {
            const belum = (k.pengguna_id === aktif && !document.hidden) ? 0 : k.belum;   // yang sedang dibuka dianggap terbaca
            const b = el('button', 'kontak' + (k.pengguna_id === aktif ? ' aktif' : '') + (belum ? ' belum' : ''));
            b.type = 'button';
            b.appendChild(avatar(k.nama, k.pengguna_id));
            const t = el('div', 'kontak-teks');
            const r1 = el('div', 'kontak-baris');
            r1.appendChild(el('span', 'kontak-nama', k.nama));
            r1.appendChild(el('span', 'kontak-waktu', k.terakhir ? waktuDaftar(k.terakhir.dibuat) : ''));
            const r2 = el('div', 'kontak-pratinjau');
            r2.appendChild(el('span', 'cuplikan', k.terakhir ? (k.terakhir.dari === 'admin' ? 'Anda: ' : '') + k.terakhir.teks : k.email));
            if (belum) r2.appendChild(el('span', 'jumlah', belum > 99 ? '99+' : String(belum)));
            t.appendChild(r1); t.appendChild(r2); b.appendChild(t);
            b.addEventListener('click', () => buka(k));
            box.appendChild(b);
        });
    }

    /** paksa = true: jalan walau permintaan sebelumnya belum selesai (dipakai saat mencari / pertama kali). */
    async function muatKontak(paksa) {
        if (sedangKontak && !paksa) return;
        const token = ++tokenKontak;
        sedangKontak = true;
        try {
            const d = await api('api/chat.php?' + new URLSearchParams({ aksi: 'daftar', q: cari }));
            if (token !== tokenKontak) return;
            if (d.peran && (d.peran === 'admin') !== admin) { admin = d.peran === 'admin'; aturTata(); }
            kontak = d.kontak || [];
            renderKontak();
            if (pertamaMuat) {      // buka percakapan otomatis hanya pada pemuatan pertama
                pertamaMuat = false;
                if (!admin && kontak[0]) buka(kontak[0]);
                else if (admin && deepLink) { const k = kontak.find((x) => x.pengguna_id === deepLink); if (k) buka(k); }
            }
        } catch (err) { if (pertamaMuat) toast(err.message, true); }
        finally { if (token === tokenKontak) sedangKontak = false; }
    }

    // ---------- percakapan ----------
    function aturTata() { $('msgr').classList.toggle('solo', !admin); }

    function buka(k) {
        batalPilih();
        aktif = k.pengguna_id;
        terakhirId = 0; sudahTampil.clear(); barisPesan.clear(); tanggalTerakhir = ''; pengirimTerakhir = '';
        $('threadBody').textContent = '';
        const av = $('threadAvatar'); av.textContent = ''; av.appendChild(avatar(k.nama, k.pengguna_id));
        $('threadNama').textContent = k.nama;
        $('threadSub').textContent = k.email || '';
        $('threadPilih').hidden = true; $('threadIsi').hidden = false;
        $('msgr').classList.add('in-thread');
        renderKontak();
        muatPesan(true);
        if (!layarKecil.matches) $('ketik').focus();
    }

    function tutupPercakapan() {
        batalPilih();
        aktif = 0;
        $('threadIsi').hidden = true; $('threadPilih').hidden = false;
        $('msgr').classList.remove('in-thread');
        renderKontak();
    }

    function tampilKosong() {
        const nama = $('threadNama').textContent;
        const box = el('div', 'thread-kosong');
        box.appendChild(el('strong', null, 'Belum ada pesan'));
        box.appendChild(document.createTextNode(admin
            ? 'Mulai percakapan dengan ' + nama + '. Pengajuan peminjaman dari akun ini juga akan muncul di sini secara otomatis.'
            : 'Tulis pesan untuk admin. Setiap kali kamu mengirim pengajuan peminjaman, admin juga diberi tahu otomatis lewat sini.'));
        $('threadBody').appendChild(box);
    }

    function kartuOtomatis(m) {
        const baris = String(m.isi).split('\n');
        const negatif = /ditolak|dibatalkan/i.test(baris[0]);      // keputusan admin: ditolak / dibatalkan (berisi alasan)
        const kartu = el('div', 'card-auto' + (negatif ? ' negatif' : ''));
        const head = el('div', 'card-auto-head');
        const ikon = document.createElement('i'); ikon.setAttribute('data-lucide', negatif ? 'calendar-x' : 'calendar-check'); ikon.className = 'icon';
        head.appendChild(ikon);
        head.appendChild(el('strong', null, baris[0]));
        head.appendChild(el('em', 'tag-auto', 'Otomatis'));
        kartu.appendChild(head);
        baris.slice(1).forEach((b) => {
            const i = b.indexOf(': ');
            const r = el('div', 'card-row' + (b.slice(0, i) === 'Alasan' ? ' alasan' : ''));
            if (i > 0) { r.appendChild(el('span', null, b.slice(0, i))); r.appendChild(el('b', null, b.slice(i + 2))); }
            else r.appendChild(el('b', null, b));
            kartu.appendChild(r);
        });
        const aks = el('div', 'card-aksi');
        // pengajuan baru -> admin meninjau; keputusan ditolak/dibatalkan -> pemohon bisa mengajukan ulang
        const a = negatif
            ? el('a', 'btn' + (admin ? '' : ' primary'), admin ? 'Lihat daftar ditolak' : 'Ajukan ulang')
            : el('a', 'btn' + (admin ? ' primary' : ''), admin ? 'Tinjau pengajuan' : 'Lihat pengajuan');
        a.href = negatif ? (admin ? 'peminjaman.html?status=ditolak' : 'ajukan.html') : 'peminjaman.html' + (admin ? '?status=menunggu' : '');
        aks.appendChild(a); kartu.appendChild(aks);
        return kartu;
    }

    // Pengguna hanya boleh menghapus pesannya sendiri; admin boleh menghapus pesan apa pun (server ikut memeriksa).
    const bolehHapus = (m) => admin || m.dari === 'pengguna';
    const teksHapus = (v) => (v === 2 ? 'Pesan ini dihapus oleh admin' : 'Pesan ini telah dihapus');

    function barisMeta(jam) {
        const box = el('div', 'msg-meta');
        box.appendChild(el('span', 'msg-waktu', jam));
        return box;
    }

    // ---------- memilih pesan: tombol kirim berubah menjadi tombol hapus ----------
    function aturTombol() {
        const mode = terpilih > 0;
        composer.classList.toggle('mode-hapus', mode);        // animasi kirim <-> hapus dijalankan CSS (pesan.css)
        tombol.disabled = !mode && !ketik.value.trim();
        tombol.title = mode ? 'Hapus pesan yang dipilih' : 'Kirim';
        tombol.setAttribute('aria-label', mode ? 'Hapus pesan yang dipilih' : 'Kirim pesan');
        ketik.placeholder = mode ? 'Pesan dipilih. Tekan tombol merah untuk menghapus, atau ketuk di sini untuk batal.' : placeholderAwal;
    }
    function tandaiPilih(id, nyala) {
        const e = barisPesan.get(id);
        if (!e) return;
        e.baris.classList.toggle('dipilih', nyala);
        e.baris.setAttribute('aria-pressed', nyala ? 'true' : 'false');
    }
    function batalPilih() {
        if (terpilih) tandaiPilih(terpilih, false);
        terpilih = 0;
        aturTombol();
    }
    function togglePilih(id) {
        if (terpilih === id) { batalPilih(); return; }
        if (terpilih) tandaiPilih(terpilih, false);
        terpilih = id;
        tandaiPilih(id, true);
        aturTombol();
    }

    function gambar(m, body) {
        const { tgl, jam } = pisah(m.dibuat);
        if (tgl !== tanggalTerakhir) {
            body.appendChild(el('div', 'tgl-pemisah', labelTanggal(tgl)));
            tanggalTerakhir = tgl; pengirimTerakhir = '';
        }
        const kunci = m.dari + ':' + (m.admin_id || 0);
        const baris = el('div', 'msg ' + (milikku(m) ? 'me' : 'them') + (m.dihapus ? ' dihapus' : (m.jenis === 'otomatis' ? ' auto' : '')));
        // Nama admin ditampilkan bila pengirimnya admin lain (atau, di sisi pengguna, siapa pun adminnya).
        const adminLain = m.dari === 'admin' && (!admin || m.admin_id !== saya.id);
        if (adminLain && kunci !== pengirimTerakhir) baris.appendChild(el('div', 'msg-nama', m.nama_admin || 'Admin'));
        if (m.dihapus) baris.appendChild(el('div', 'bubble', teksHapus(m.dihapus)));
        else baris.appendChild(m.jenis === 'otomatis' ? kartuOtomatis(m) : el('div', 'bubble', m.isi));
        baris.appendChild(barisMeta(jam));

        // Pesan yang boleh dihapus bisa diketuk/diklik untuk dipilih (ketuk lagi untuk batal).
        if (!m.dihapus && bolehHapus(m)) {
            baris.classList.add('bisa-pilih');
            baris.tabIndex = 0;
            baris.setAttribute('role', 'button');
            baris.setAttribute('aria-pressed', 'false');
            baris.addEventListener('click', (ev) => {
                if (m.dihapus || ev.target.closest('a, button')) return;           // tautan di dalam kartu tetap berfungsi
                if (window.getSelection && String(window.getSelection())) return;   // sedang menyalin teks, bukan memilih pesan
                togglePilih(m.id);
            });
            baris.addEventListener('keydown', (ev) => {
                if (ev.target !== baris || (ev.key !== 'Enter' && ev.key !== ' ')) return;
                ev.preventDefault(); togglePilih(m.id);
            });
        }
        body.appendChild(baris);
        barisPesan.set(m.id, { baris, jam, m });
        pengirimTerakhir = kunci;
    }

    /** Mengubah pesan yang sudah tampil menjadi keterangan "dihapus" (dipakai saat menghapus & saat lawan menghapus). */
    function tandaiDihapus(id, v) {
        const e = barisPesan.get(id);
        if (!e || e.m.dihapus) return;
        e.m.dihapus = v;
        if (terpilih === id) { terpilih = 0; aturTombol(); }       // tombol hapus kembali menjadi tombol kirim
        const nama = e.baris.querySelector('.msg-nama');
        e.baris.textContent = '';
        if (nama) e.baris.appendChild(nama);
        e.baris.classList.remove('auto', 'bisa-pilih', 'dipilih');
        e.baris.classList.add('dihapus');
        ['tabindex', 'role', 'aria-pressed'].forEach((a) => e.baris.removeAttribute(a));
        e.baris.appendChild(el('div', 'bubble', teksHapus(v)));
        e.baris.appendChild(barisMeta(e.jam));
    }

    async function hapusTerpilih() {
        const id = terpilih;
        if (!id) return;
        if (!confirm('Hapus pesan ini untuk semua orang di percakapan ini? Tindakan ini tidak bisa dibatalkan.')) return;
        tombol.disabled = true;
        try {
            const d = await api('api/chat.php', { aksi: 'hapus', id, pengguna_id: aktif });
            tandaiDihapus(id, d.dihapus);
            toast('Pesan dihapus');
            if (admin) muatKontak(false);                                    // pratinjau di daftar ikut berubah
            if (window.kampuslyPesan) window.kampuslyPesan.segarkan();       // lencana belum dibaca ikut berubah
        } catch (err) { toast(err.message, true); }
        aturTombol();
    }

    /** Menambah pesan yang belum tampil. Mengembalikan jumlah pesan baru dari pihak lawan. */
    function tambah(daftar, awal, paksaGulir) {
        const body = $('threadBody');
        const dekatBawah = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
        let baru = 0, masuk = 0;
        daftar.forEach((m) => {
            if (sudahTampil.has(m.id)) return;
            if (!baru) { const kosong = body.querySelector('.thread-kosong'); if (kosong) kosong.remove(); }
            sudahTampil.add(m.id); baru++;
            if (!milikku(m)) masuk++;
            gambar(m, body);
            terakhirId = Math.max(terakhirId, m.id);
        });
        if (baru) {
            if (window.lucide) lucide.createIcons();
            if (awal || paksaGulir || dekatBawah) body.scrollTop = body.scrollHeight;
        }
        return masuk;
    }

    /** awal = muat percakapan dari nol; paksa = ambil sekarang walau ada pengambilan lain yang sedang jalan (dan gulir ke bawah). */
    async function muatPesan(awal, paksa) {
        if (!aktif) return;
        if (sedangPesan && !awal && !paksa) return;
        const saatIni = aktif, token = ++tokenPesan;
        sedangPesan = true;
        try {
            const d = await api('api/chat.php?' + new URLSearchParams({
                aksi: 'pesan', pengguna_id: saatIni, setelah: awal ? 0 : terakhirId, tandai: document.hidden ? 0 : 1,
            }));
            if (token !== tokenPesan || saatIni !== aktif) return;      // pengguna sudah pindah percakapan
            const masuk = tambah(d.pesan, awal, !!paksa);
            (d.terhapus || []).forEach((x) => tandaiDihapus(x.id, x.dihapus));   // lawan menghapus pesan yang sudah tampil
            if (awal && !d.pesan.length) tampilKosong();
            // Pesan dari lawan yang baru terbaca: nolkan penanda di daftar dan lencana sidebar.
            if (!document.hidden && (awal || masuk)) {
                const k = kontak.find((x) => x.pengguna_id === saatIni);
                if (k && k.belum) { k.belum = 0; renderKontak(); }
                if (window.kampuslyPesan) window.kampuslyPesan.segarkan();
            }
        } catch (err) { if (awal) toast(err.message, true); }
        finally { if (token === tokenPesan) sedangPesan = false; }
    }

    // ---------- kirim ----------
    function sesuaikanKotak() {
        ketik.style.height = 'auto';
        ketik.style.height = Math.min(ketik.scrollHeight, 120) + 'px';
        aturTombol();
    }

    async function kirim() {
        const isi = ketik.value.trim();
        if (!isi || !aktif) return;
        tombol.disabled = true;
        try {
            const d = await api('api/chat.php', { aksi: 'kirim', pengguna_id: aktif, isi });
            ketik.value = '';
            // Ambil dari server (bukan dipasang langsung dari balasan kirim): kalau lawan juga baru mengirim pesan,
            // pesannya ikut terambil dan urutan di layar selalu sama dengan urutan di server.
            await muatPesan(false, true);
            if (admin) muatKontak(false);       // urutan & pratinjau daftar ikut diperbarui
        } catch (err) { toast(err.message, true); }
        sesuaikanKotak();
        ketik.focus();
    }

    ketik.addEventListener('input', sesuaikanKotak);
    ketik.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); kirim(); }
    });
    tombol.addEventListener('click', () => (terpilih > 0 ? hapusTerpilih() : kirim()));   // tombol yang sama: kirim atau hapus
    ketik.addEventListener('focus', batalPilih);                                          // mulai mengetik = batal memilih pesan
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') batalPilih(); });
    $('threadBody').addEventListener('click', (e) => { if (e.target === $('threadBody')) batalPilih(); });   // ketuk area kosong
    $('threadBack').addEventListener('click', tutupPercakapan);

    let tmr;
    $('kontakCari').addEventListener('input', (e) => {
        clearTimeout(tmr);
        tmr = setTimeout(() => { cari = e.target.value.trim(); muatKontak(true); }, 250);
    });

    // ---------- pembaruan otomatis ----------
    setInterval(() => { if (!document.hidden) muatPesan(false); }, 3000);
    setInterval(() => { if (!document.hidden && (admin || pertamaMuat)) muatKontak(false); }, 8000);   // pengguna biasa: hanya mengulang bila muat awal gagal
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        muatPesan(false);
        if (admin) muatKontak(false); else renderKontak();
    });

    // ---------- mulai ----------
    aturTata();
    sesuaikanKotak();
    if (window.lucide) lucide.createIcons();
    muatKontak(true);
})();
