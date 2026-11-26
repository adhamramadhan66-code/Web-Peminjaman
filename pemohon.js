/* Portal pemohon mobil dinas: pilih mobil, ajukan dengan tujuan di peta, berangkat dengan GPS aktif,
   dan kirim posisi berkala sampai kembali ke kampus. */
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const API = 'api/armada_pemohon.php', KEY = 'kampuslyCurrentUser';
    const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const p2 = (n) => String(n).padStart(2, '0');
    const iso = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const tgl = (s) => { const [y, m, d] = s.split('-').map(Number); return d + ' ' + BLN[m - 1] + ' ' + y; };
    const rentang = (r) => r.tanggal_akhir && r.tanggal_akhir !== r.tanggal ? tgl(r.tanggal) + ' – ' + tgl(r.tanggal_akhir) : tgl(r.tanggal);
    const waktu = (r) => r.mulai + ' – ' + (r.selesai || 'selesai');
    const { jarak } = window.KPPeta;

    let user = null; try { user = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { /* abaikan */ }
    $('pmNama').textContent = user ? (user.name || user.email) : '';

    function toast(msg, galat) {
        const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (galat ? ' error' : '');
        clearTimeout(window.__tt); window.__tt = setTimeout(() => t.classList.remove('show'), 3600);
    }
    async function api(url, payload) {
        let res;
        try { res = await fetch(url, payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : { cache: 'no-store' }); }
        catch (e) { throw new Error('Tidak dapat terhubung ke server.'); }
        let d = null; try { d = await res.json(); } catch (e) { /* abaikan */ }
        if (res.status === 401) { try { sessionStorage.removeItem(KEY); } catch (e) { /* abaikan */ } location.replace('index.html#mobil'); throw new Error('Sesi berakhir. Silakan masuk kembali.'); }
        if (!res.ok || !d) { const err = new Error((d && d.error) || 'Server tidak merespons.'); err.data = d; throw err; }
        return d;
    }
    const ikon = () => { if (window.lucide) lucide.createIcons(); };

    $('btnKeluar').addEventListener('click', () => {
        if (pelacakan.aktif && !confirm('Perjalanan masih berlangsung. Keluar akan menghentikan pemantauan GPS. Tetap keluar?')) return;
        try { sessionStorage.removeItem(KEY); } catch (e) { /* abaikan */ }
        const k = () => location.replace('index.html#mobil');
        fetch('api/auth.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aksi: 'keluar' }), keepalive: true }).then(k, k);
    });
    $('themeToggle').addEventListener('click', () => {
        const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = t; try { localStorage.setItem('theme', t); } catch (e) { /* abaikan */ }
    });

    // ---------- kartu ----------
    function kiri(kode, nama, ket, tujuan, alamat) {
        const k = el('div', 'kt-kiri');
        k.appendChild(el('div', 'kt-kode ' + kode, kode));
        const id = el('div', 'kt-id'); id.appendChild(el('strong', null, nama));
        if (ket) id.appendChild(el('small', null, ket));
        if (tujuan) {
            const t = el('div', 'kt-tujuan'); t.innerHTML = '<i data-lucide="map-pin"></i>';
            const x = el('div'); x.appendChild(document.createTextNode(tujuan));
            if (alamat) x.appendChild(el('span', null, alamat));
            t.appendChild(x); id.appendChild(t);
        }
        k.appendChild(id); return k;
    }
    const baris = (a, b) => { const r = el('div', 'kt-baris'); r.appendChild(el('span', null, a)); const v = el('b'); if (b instanceof Node) v.appendChild(b); else v.textContent = b; r.appendChild(v); return r; };
    const tombol = (teks, ic, cls, fn) => { const b = el('button', 'btn ' + (cls || '')); b.type = 'button'; b.innerHTML = '<i data-lucide="' + ic + '"></i> '; b.appendChild(document.createTextNode(teks)); b.addEventListener('click', fn); return b; };

    let armada = [], kampus = null, saya = [];
    function renderArmada() {
        const box = $('listArmada'); box.textContent = '';
        armada.forEach((a) => {
            const kt = el('div', 'kt'); kt.appendChild(kiri(a.kode, a.nama, a.keterangan));
            const ka = el('div', 'kt-kanan');
            ka.appendChild(baris('Status', el('span', 'badge-st ' + (a.dipakai ? 'berlangsung' : 'disetujui'), a.dipakai ? 'Sedang dipakai' : 'Tersedia')));
            const t = a.terisi.slice(0, 3);
            ka.appendChild(baris('Sudah terisi', t.length ? t.map((x) => rentang(x) + ' ' + x.mulai).join(' · ') : 'Belum ada jadwal'));
            const ak = el('div', 'kt-aksi'); ak.appendChild(tombol('Ajukan mobil ini', 'send', 'primary', () => bukaForm(a.id))); ka.appendChild(ak);
            kt.appendChild(ka); box.appendChild(kt);
        });
        ikon();
    }
    function labelTrip(r) {
        if (r.status === 'menunggu') return ['Menunggu persetujuan', 'menunggu'];
        if (r.status === 'ditolak') return ['Ditolak', 'ditolak'];
        if (r.perjalanan === 'jalan') return r.gps_putus ? ['GPS terputus', 'putus'] : ['Dalam perjalanan', 'berlangsung'];
        if (r.perjalanan === 'selesai') return ['Selesai', 'selesai'];
        return ['Disetujui', 'disetujui'];
    }
    function kartuTrip(r, aksiLengkap) {
        const kt = el('div', 'kt' + (r.perjalanan === 'jalan' ? ' jalan' : '') + (r.gps_putus ? ' putus' : ''));
        kt.appendChild(kiri(r.armada_kode, r.armada_nama, '', r.tujuan, r.tujuan_alamat));
        const ka = el('div', 'kt-kanan');
        const [lbl, kls] = labelTrip(r);
        ka.appendChild(baris('Status', el('span', 'badge-st ' + kls, lbl)));
        ka.appendChild(baris('Tanggal', rentang(r)));
        ka.appendChild(baris('Jam', waktu(r)));
        if (r.perjalanan === 'selesai' && r.tiba) ka.appendChild(baris('Tiba', r.tiba.slice(0, 16).replace('T', ' ')));
        if (r.status === 'ditolak' && r.catatan) ka.appendChild(baris('Alasan', r.catatan));
        if (aksiLengkap) {
            const ak = el('div', 'kt-aksi');
            if (r.status === 'menunggu') ak.appendChild(tombol('Batalkan', 'x', '', () => batalkan(r)));
            if (r.status === 'disetujui' && r.perjalanan === 'belum') ak.appendChild(tombol('Berangkat (aktifkan GPS)', 'navigation', 'primary', () => berangkat(r)));
            if (ak.children.length) ka.appendChild(ak);
        }
        kt.appendChild(ka); return kt;
    }
    function renderSaya() {
        const box = $('listSaya'); box.textContent = '';
        if (!saya.length) box.appendChild(el('p', 'pm-sub', 'Belum ada pengajuan. Pilih mobil di atas untuk mengajukan.'));
        saya.forEach((r) => box.appendChild(kartuTrip(r, true)));
        ikon();
    }
    async function muat() {
        try {
            const [a, s] = await Promise.all([api(API + '?armada=1'), api(API + '?saya=1')]);
            armada = a.armada; kampus = a.kampus; saya = s.data;
            renderArmada(); renderSaya();
            const aktif = saya.find((r) => r.perjalanan === 'jalan');
            if (aktif) mulaiPelacakan(aktif); else hentiPelacakan();
        } catch (e) { toast(e.message, true); }
    }
    async function batalkan(r) {
        if (!confirm('Batalkan pengajuan ke "' + r.tujuan + '"?')) return;
        try { await api(API, { aksi: 'batalkan', id: r.id }); toast('Pengajuan dibatalkan'); muat(); } catch (e) { toast(e.message, true); }
    }

    // ---------- form pengajuan + peta tujuan ----------
    const modal = $('formModal');
    let petaPilih = null, markerPilih = null, pilihan = null, inputs = {};
    const buka = () => { modal.hidden = false; document.body.style.overflow = 'hidden'; };
    const tutup = () => { modal.hidden = true; document.body.style.overflow = ''; };
    $('formClose').addEventListener('click', tutup); $('kBatal').addEventListener('click', tutup);
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) tutup(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) tutup(); });

    function setTujuan(lat, lng, alamat) {
        pilihan = { lat, lng, alamat: alamat || '' };
        const p = { lat, lng };
        if (petaPilih) {
            if (!markerPilih) markerPilih = KPPeta.pin(petaPilih, p, { judul: 'Tujuan' }); else markerPilih.setPosition(p);
            petaPilih.panTo(p);
        }
        const box = $('alamatPilih'); box.textContent = '';
        const b = el('b', null, alamat || 'Titik terpilih'); box.appendChild(b); box.appendChild(document.createTextNode(' (' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ')'));
        if (!alamat) KPPeta.alamatDari(lat, lng).then((al) => { if (pilihan && pilihan.lat === lat && al) { pilihan.alamat = al; b.textContent = al; if (!inputs.tujuan.value) inputs.tujuan.value = al.split(',')[0]; } });
    }
    async function siapkanPeta() {
        const k = $('petaPilih'); k.textContent = ''; k.className = 'peta-kotak';
        if (petaPilih) { if (!pilihan) { markerPilih && markerPilih.remove(); markerPilih = null; } return; }
        try {
            petaPilih = await KPPeta.buat(k, { center: kampus ? { lat: kampus.lat, lng: kampus.lng } : KPPeta.PUSAT, zoom: 14 });
            petaPilih.onClick((lat, lng) => setTujuan(lat, lng));
            if (kampus) KPPeta.titik(petaPilih, { lat: kampus.lat, lng: kampus.lng }, { warna: '#059669', label: 'K', judul: 'Kampus', skala: 11 });
        } catch (e) { k.className = 'peta-kotak peta-info'; k.textContent = e.message + ' Sementara itu, tempel koordinat tujuan di kolom di bawah peta.'; }
    }
    $('btnCari').addEventListener('click', async () => {
        const q = $('cariAlamat').value.trim(); if (!q) return;
        try { const h = await KPPeta.cari(q); setTujuan(h.lat, h.lng, h.alamat); if (petaPilih) petaPilih.setZoom(16); } catch (e) { toast(e.message, true); }
    });
    $('cariAlamat').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('btnCari').click(); } });
    $('btnPosisiSaya').addEventListener('click', () => {
        if (!navigator.geolocation) { toast('Browser ini tidak mendukung GPS.', true); return; }
        navigator.geolocation.getCurrentPosition((p) => setTujuan(p.coords.latitude, p.coords.longitude), () => toast('Lokasi tidak dapat dibaca. Izinkan akses lokasi.', true), { enableHighAccuracy: true, timeout: 15000 });
    });
    $('koordTempel').addEventListener('change', (e) => {
        const m = e.target.value.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
        if (!m) { if (e.target.value) toast('Format koordinat: -7.5666, 110.8167', true); return; }
        setTujuan(parseFloat(m[1]), parseFloat(m[2]));
    });

    function bukaForm(armadaId) {
        const hariIni = iso(new Date());
        $('kErr').className = 'form-err'; $('kErr').textContent = ''; pilihan = null; $('alamatPilih').textContent = 'Klik peta untuk menandai tujuan.'; $('koordTempel').value = ''; $('cariAlamat').value = '';
        const F = [
            { k: 'armada_id', t: 'armada', label: 'Mobil', wajib: true, penuh: true },
            { k: 'tanggal', t: 'date', label: 'Tanggal berangkat', wajib: true, v: hariIni },
            { k: 'tanggal_akhir', t: 'date', label: 'Sampai tanggal (bila lebih dari sehari)' },
            { k: 'mulai', t: 'time', label: 'Jam berangkat', wajib: true },
            { k: 'selesai', t: 'time', label: 'Jam kembali (kosong = sampai selesai)' },
            { k: 'tujuan', t: 'text', label: 'Nama tujuan / keperluan', wajib: true, penuh: true, maks: 200 },
            { k: 'peserta', t: 'number', label: 'Jumlah penumpang' },
            { k: 'sopir', t: 'select', label: 'Sopir', opsi: [['1', 'Dengan sopir'], ['0', 'Tanpa sopir']] },
            { k: 'fasilitas', t: 'text', label: 'Keterangan tambahan', penuh: true, maks: 160 },
        ];
        const box = $('kFields'); box.textContent = ''; inputs = {};
        F.forEach((f) => {
            const lb = el('label', f.penuh ? 'penuh' : ''); lb.appendChild(document.createTextNode(f.label)); if (f.wajib) lb.appendChild(el('em', null, ' *'));
            let inp;
            if (f.t === 'armada') { inp = el('select', 'in'); armada.forEach((x) => inp.appendChild(new Option(x.kode + ' – ' + x.nama, x.id))); inp.value = armadaId; }
            else if (f.t === 'select') { inp = el('select', 'in'); f.opsi.forEach(([v, t]) => inp.appendChild(new Option(t, v))); }
            else { inp = el('input', 'in'); inp.type = f.t; if (f.maks) inp.maxLength = f.maks; if (f.t === 'number') { inp.min = '0'; inp.max = '99'; } if (f.t === 'date') inp.min = hariIni; inp.autocomplete = 'off'; if (f.v) inp.value = f.v; }
            inputs[f.k] = inp; lb.appendChild(inp); box.appendChild(lb);
        });
        buka(); siapkanPeta(); ikon();
    }
    $('kForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = {}; Object.keys(inputs).forEach((k) => { v[k] = inputs[k].value.trim(); });
        if (!pilihan) { $('kErr').textContent = 'Tentukan tujuan di peta (klik peta, cari alamat, atau tempel koordinat).'; $('kErr').className = 'form-err show'; return; }
        const btn = $('kSimpan'); btn.disabled = true;
        try {
            await api(API, Object.assign({}, v, { aksi: 'ajukan', armada_id: Number(v.armada_id), sopir: v.sopir === '1', peserta: Number(v.peserta) || 0, tujuan_lat: pilihan.lat, tujuan_lng: pilihan.lng, tujuan_alamat: pilihan.alamat }));
            tutup(); toast('Pengajuan terkirim. Menunggu persetujuan admin.'); muat();
        } catch (err) { $('kErr').textContent = err.message; $('kErr').className = 'form-err show'; }
        finally { btn.disabled = false; }
    });

    // ---------- pelacakan GPS ----------
    const pelacakan = { aktif: null, watch: null, hb: null, terakhir: null, kirimTs: 0, wake: null, peta: null, marker: null, jalur: null, titikJalur: [], kirimLagi: false };

    function posisiSekarang() {
        return new Promise((ok, gagal) => {
            if (!navigator.geolocation) return gagal(new Error('Browser ini tidak mendukung GPS.'));
            navigator.geolocation.getCurrentPosition(ok, (er) => gagal(new Error(er.code === 1 ? 'Izin lokasi ditolak. Aktifkan GPS dan izinkan akses lokasi untuk situs ini.' : 'Lokasi belum terbaca. Pastikan GPS menyala dan coba lagi.')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        });
    }
    async function berangkat(r) {
        try {
            toast('Membaca lokasi GPS…');
            const p = await posisiSekarang();
            await api(API, { aksi: 'mulai', id: r.id, lat: p.coords.latitude, lng: p.coords.longitude, akurasi: Math.round(p.coords.accuracy) });
            toast('Selamat jalan! GPS Anda kini dipantau sampai kembali ke kampus.'); await muat();
            $('panelLacak').scrollIntoView({ behavior: 'smooth' });
        } catch (e) { toast(e.message, true); }
    }
    function bannerGps(teks) { const b = $('bannerGps'); b.textContent = teks || ''; b.classList.toggle('tampil', !!teks); $('lacakDot').classList.toggle('putus', !!teks); }

    async function kirimPosisi(paksa) {
        const t = pelacakan.terakhir, a = pelacakan.aktif;
        if (!t || !a) return;
        const sekarang = Date.now();
        if (!paksa && sekarang - pelacakan.kirimTs < 4500) return;
        if (sekarang - t.ts > 45000) { bannerGps('Sinyal GPS tidak terbaca. Pastikan GPS menyala dan Anda tidak berada di ruang tertutup.'); }
        pelacakan.kirimTs = sekarang;
        try {
            const d = await api(API, { aksi: 'lokasi', id: a.id, lat: t.lat, lng: t.lng, akurasi: t.akurasi });
            $('lacakWaktu').textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            $('lacakKampus').textContent = jarak(d.jarak_kampus);
            if (a.tujuan_lat) $('lacakTujuan').textContent = jarak(Math.round(hav(t.lat, t.lng, a.tujuan_lat, a.tujuan_lng)));
            if (sekarang - t.ts <= 45000) bannerGps('');
        } catch (e) {
            if (e.data && e.data.berhenti) { hentiPelacakan(); muat(); return; }
            bannerGps('Posisi gagal terkirim: ' + e.message);
        }
    }
    function hav(a, b, c, d) { const R = 6371000, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }

    async function mulaiPelacakan(trip) {
        const baru = !pelacakan.aktif || pelacakan.aktif.id !== trip.id;
        pelacakan.aktif = trip;
        $('panelLacak').hidden = false;
        const kk = $('lacakKartu'); kk.textContent = ''; kk.appendChild(kartuTrip(trip, false)); ikon();
        if (!baru) return;
        if (!navigator.geolocation) { bannerGps('Browser ini tidak mendukung GPS.'); return; }
        pelacakan.watch = navigator.geolocation.watchPosition((p) => {
            pelacakan.terakhir = { lat: p.coords.latitude, lng: p.coords.longitude, akurasi: Math.round(p.coords.accuracy), ts: Date.now() };
            gambarPosisi(); kirimPosisi(false);
        }, (er) => {
            bannerGps(er.code === 1 ? 'GPS dimatikan / izin lokasi ditolak. Nyalakan kembali GPS dan izinkan akses lokasi — perjalanan Anda tidak terpantau.' : 'Lokasi belum terbaca. Pastikan GPS menyala.');
        }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
        pelacakan.hb = setInterval(() => kirimPosisi(false), 10000);   // tetap kirim walau mobil diam (watchPosition tidak selalu berbunyi)
        pelacakan.sync = setInterval(muat, 60000);
        minta_wake();
        try {
            pelacakan.peta = await KPPeta.buat($('lacakPeta'), { center: trip.tujuan_lat ? { lat: trip.tujuan_lat, lng: trip.tujuan_lng } : KPPeta.PUSAT, zoom: 13 });
            if (trip.tujuan_lat) KPPeta.pin(pelacakan.peta, { lat: trip.tujuan_lat, lng: trip.tujuan_lng }, { judul: 'Tujuan' });
            if (kampus) KPPeta.titik(pelacakan.peta, { lat: kampus.lat, lng: kampus.lng }, { warna: '#059669', label: 'K', judul: 'Kampus', skala: 11 });
            pelacakan.jalur = KPPeta.garis(pelacakan.peta);
            gambarPosisi(true);
        } catch (e) { const k = $('lacakPeta'); k.className = 'peta-kotak tinggi peta-info'; k.textContent = e.message; }
    }
    function gambarPosisi(fit) {
        const t = pelacakan.terakhir, pt = pelacakan.peta; if (!t || !pt) return;
        const p = { lat: t.lat, lng: t.lng };
        if (!pelacakan.marker) { pelacakan.marker = KPPeta.titik(pt, p, { warna: '#2563eb', label: pelacakan.aktif.armada_kode.slice(0, 3), judul: 'Posisi Anda', skala: 17, z: 5 }); fit = true; }
        else pelacakan.marker.setPosition(p);
        pelacakan.titikJalur.push(p); if (pelacakan.titikJalur.length > 500) pelacakan.titikJalur.shift(); pelacakan.jalur.setPath(pelacakan.titikJalur);
        if (fit) { const b = KPPeta.batas(); b.extend(p); if (pelacakan.aktif.tujuan_lat) b.extend({ lat: pelacakan.aktif.tujuan_lat, lng: pelacakan.aktif.tujuan_lng }); if (kampus) b.extend({ lat: kampus.lat, lng: kampus.lng }); pt.fit(b, 60); }
    }
    async function minta_wake() { try { if (navigator.wakeLock) pelacakan.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* tidak didukung / ditolak */ } }
    document.addEventListener('visibilitychange', () => { if (pelacakan.aktif && document.visibilityState === 'visible') { minta_wake(); kirimPosisi(true); } });
    function hentiPelacakan() {
        if (pelacakan.watch != null) navigator.geolocation.clearWatch(pelacakan.watch);
        clearInterval(pelacakan.hb); clearInterval(pelacakan.sync);
        try { pelacakan.wake && pelacakan.wake.release(); } catch (e) { /* abaikan */ }
        Object.assign(pelacakan, { aktif: null, watch: null, hb: null, sync: null, terakhir: null, wake: null, peta: null, marker: null, jalur: null, titikJalur: [] });
        $('panelLacak').hidden = true; bannerGps('');
    }
    window.addEventListener('beforeunload', (e) => { if (pelacakan.aktif) { e.preventDefault(); e.returnValue = ''; } });

    $('btnSelesai').addEventListener('click', async () => {
        const a = pelacakan.aktif; if (!a) return;
        const btn = $('btnSelesai'); btn.disabled = true;
        try {
            const p = await posisiSekarang();
            await api(API, { aksi: 'selesai', id: a.id, lat: p.coords.latitude, lng: p.coords.longitude, akurasi: Math.round(p.coords.accuracy) });
            hentiPelacakan(); toast('Perjalanan selesai. Terima kasih, GPS boleh dimatikan.'); muat();
        } catch (e) { toast(e.message, true); }
        finally { btn.disabled = false; }
    });

    muat();
})();
