/* Tab "Lokasi" di halaman Mobil Dinas (khusus admin).
   - Titik kampus (nama, koordinat, radius "sudah tiba") dan lokasi tujuan tersimpan dengan nama sendiri,
     mis. "Kampus TSU". Nama ini tampil di peta sebagai lencana, jadi tidak bergantung pada label bawaan OpenStreetMap.
   - Cara termudah menambah titik: klik peta, cari alamat, atau tombol "Lokasi saya"; lalu beri nama dan simpan. */
(function () {
    'use strict';
    const { el, api, toast } = window.KP;
    const $ = (id) => document.getElementById(id);
    const API = 'api/armada.php';
    const P = window.KPPeta;

    let kampus = null, lokasi = [], peta = null, siap = false, gagal = false;
    let tandaKampus = null, lingKampus = null, tandaLok = {}, pinDraf = null, lingDraf = null;
    let edit = null;                       // { mode: 'kampus' | 'lokasi', id, lat, lng } bila form terbuka
    let sudahMuat = false, antreKampus = false;

    const ikon = () => { if (window.lucide) lucide.createIcons(); };
    const fmtKoord = (lat, lng) => lat.toFixed(5) + ', ' + lng.toFixed(5);

    // ---------- gambar ulang peta & daftar ----------
    function gambarPeta() {
        if (!peta) return;
        if (kampus) {
            const p = { lat: kampus.lat, lng: kampus.lng };
            if (!tandaKampus) {
                tandaKampus = P.tanda(peta, p, { nama: kampus.nama, warna: '#059669', z: 4, klik: () => bukaForm('kampus') });
                lingKampus = P.lingkaran(peta, p, kampus.radius);
            } else { tandaKampus.setPosition(p); tandaKampus.setNama(kampus.nama); lingKampus.set(p, kampus.radius); }
        }
        const ada = new Set(lokasi.map((l) => l.id));
        Object.keys(tandaLok).forEach((id) => { if (!ada.has(Number(id))) { tandaLok[id].remove(); delete tandaLok[id]; } });
        lokasi.forEach((l) => {
            const p = { lat: l.lat, lng: l.lng };
            if (tandaLok[l.id]) { tandaLok[l.id].setPosition(p); tandaLok[l.id].setNama(l.nama); }
            else tandaLok[l.id] = P.tanda(peta, p, { nama: l.nama, warna: '#2563eb', z: 3, klik: () => bukaForm('lokasi', l) });
        });
    }

    function barisItem(warna, ikonNama, judul, sub, lencana, fn, aktif) {
        const b = el('button', 'lok-item' + (aktif ? ' aktif' : '')); b.type = 'button';
        const d = el('span', 'lok-dot'); d.style.background = warna; d.innerHTML = '<i data-lucide="' + ikonNama + '"></i>'; b.appendChild(d);
        const t = el('span', 'lok-teks'); t.appendChild(el('strong', null, judul)); t.appendChild(el('span', null, sub)); b.appendChild(t);
        if (lencana) b.appendChild(el('span', 'lok-lencana', lencana));
        b.addEventListener('click', fn);
        return b;
    }
    function gambarDaftar() {
        const box = $('lokDaftar'); box.textContent = '';
        if (kampus) box.appendChild(barisItem('#059669', 'graduation-cap', kampus.nama, 'Titik kampus · radius tiba ' + kampus.radius + ' m', 'Kampus', () => bukaForm('kampus'), edit && edit.mode === 'kampus'));
        else box.appendChild(barisItem('#94a3b8', 'graduation-cap', 'Titik kampus belum diatur', 'Klik untuk mengaturnya (wajib agar pemohon bisa dinyatakan tiba)', '', () => bukaForm('kampus'), edit && edit.mode === 'kampus'));
        lokasi.forEach((l) => box.appendChild(barisItem('#2563eb', 'map-pin', l.nama, l.alamat || fmtKoord(l.lat, l.lng), '', () => bukaForm('lokasi', l), edit && edit.mode === 'lokasi' && edit.id === l.id)));
        if (!lokasi.length) box.appendChild(el('p', 'arm-kosong', 'Belum ada lokasi tujuan. Klik peta atau tekan "Tambah lokasi".'));
        ikon();
    }

    // ---------- form ----------
    function setDraf(lat, lng, tengah) {
        if (!edit) return;
        edit.lat = lat; edit.lng = lng;
        $('lokKoord').value = fmtKoord(lat, lng);
        if (peta) {
            const p = { lat, lng };
            if (!pinDraf) pinDraf = P.pin(peta, p, { warna: '#f59e0b', judul: 'Titik terpilih' }); else pinDraf.setPosition(p);
            if (tengah) peta.panTo(p);
            if (edit.mode === 'kampus') { const r = Number($('lokRadius').value) || 300; if (!lingDraf) lingDraf = P.lingkaran(peta, p, r, '#f59e0b'); else lingDraf.set(p, r); }
        }
        $('lokInfo').textContent = 'Titik terpilih: ' + fmtKoord(lat, lng);
    }
    async function isiAlamat(lat, lng) {
        const al = await P.alamatDari(lat, lng);
        if (!al || !edit || edit.lat !== lat) return;
        if (!$('lokAlamat').value) $('lokAlamat').value = al;
        if (!$('lokNama').value && edit.mode === 'lokasi') $('lokNama').value = al.split(',')[0];
        $('lokInfo').textContent = al;
    }
    function bukaForm(mode, data, titik) {
        const kamp = mode === 'kampus';
        edit = { mode, id: data && data.id || 0, lat: 0, lng: 0 };
        $('lokForm').hidden = false; $('lokErr').className = 'form-err'; $('lokErr').textContent = '';
        $('lokFormJudul').textContent = kamp ? 'Titik kampus' : (edit.id ? 'Ubah lokasi' : 'Lokasi baru');
        $('lokRadiusBaris').hidden = !kamp; $('lokHapus').hidden = kamp || !edit.id;
        $('lokPetunjuk').textContent = kamp ? 'Pemohon dianggap sudah tiba bila berada dalam radius ini dari titik kampus. Klik peta untuk memindahkan titik.' : 'Klik peta untuk memindahkan titik, atau cari alamat di atas.';
        const d = kamp ? (kampus || { nama: 'Kampus TSU', alamat: '', radius: 300 }) : (data || { nama: '', alamat: '' });
        $('lokNama').value = d.nama || ''; $('lokAlamat').value = kamp ? '' : (d.alamat || ''); $('lokRadius').value = d.radius || 300;
        $('lokAlamat').parentNode.hidden = kamp;
        if (pinDraf) { pinDraf.remove(); pinDraf = null; }
        if (lingDraf) { lingDraf.remove(); lingDraf = null; }
        const t = titik || (d.lat ? { lat: d.lat, lng: d.lng } : null);
        $('lokKoord').value = '';
        if (t) { setDraf(t.lat, t.lng, true); if (peta && data) peta.setZoom(16); if (titik && !kamp) isiAlamat(t.lat, t.lng); }
        else $('lokInfo').textContent = 'Klik di peta untuk menentukan titik.';
        gambarDaftar();
        if (peta && peta.kursor) peta.kursor(true);
        $('lokForm').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        setTimeout(() => $('lokNama').focus(), 50);
    }
    function tutupForm() {
        edit = null; $('lokForm').hidden = true;
        if (pinDraf) { pinDraf.remove(); pinDraf = null; }
        if (lingDraf) { lingDraf.remove(); lingDraf = null; }
        if (peta) peta.kursor(false);
        $('lokInfo').textContent = 'Klik di peta untuk membuat lokasi baru di titik itu.';
        gambarDaftar();
    }
    function titikBaru(lat, lng, tengah) {
        if (!edit) bukaForm('lokasi', null, { lat, lng });
        else { setDraf(lat, lng, tengah); if (edit.mode === 'lokasi') isiAlamat(lat, lng); }
    }

    $('btnLokBaru').addEventListener('click', () => { bukaForm('lokasi'); });
    $('lokBatal').addEventListener('click', tutupForm);
    $('lokRadius').addEventListener('input', () => { if (edit && edit.mode === 'kampus' && edit.lat && lingDraf) lingDraf.set({ lat: edit.lat, lng: edit.lng }, Number($('lokRadius').value) || 300); });
    $('lokKoord').addEventListener('change', (e) => {
        const m = e.target.value.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
        if (!m) { if (e.target.value) toast('Format koordinat: -7.5666, 110.8167', true); return; }
        setDraf(parseFloat(m[1]), parseFloat(m[2]), true);
    });
    async function cari() {
        const q = $('lokCari').value.trim(); if (!q) return;
        try { const h = await P.cari(q); if (peta) peta.setZoom(16); titikBaru(h.lat, h.lng, true); if (edit && edit.mode === 'lokasi' && !$('lokAlamat').value) $('lokAlamat').value = h.alamat; }
        catch (e) { toast(e.message, true); }
    }
    $('lokBtnCari').addEventListener('click', cari);
    $('lokCari').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cari(); } });
    $('btnLokSaya').addEventListener('click', () => {
        if (!navigator.geolocation) { toast('Browser ini tidak mendukung GPS.', true); return; }
        toast('Membaca lokasi perangkat…');
        navigator.geolocation.getCurrentPosition((p) => { if (peta) peta.setZoom(17); titikBaru(p.coords.latitude, p.coords.longitude, true); },
            () => toast('Lokasi tidak dapat dibaca. Izinkan akses lokasi di browser.', true), { enableHighAccuracy: true, timeout: 15000 });
    });

    $('lokForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = (t) => { $('lokErr').textContent = t; $('lokErr').className = 'form-err show'; };
        const nama = $('lokNama').value.trim();
        if (!nama) return err('Nama lokasi wajib diisi.');
        if (!edit.lat) return err('Tentukan titik di peta (klik peta, cari alamat, atau isi koordinat).');
        const btn = $('lokSimpan'); btn.disabled = true;
        try {
            let d;
            if (edit.mode === 'kampus') d = await api(API, { aksi: 'kampus', nama, lat: edit.lat, lng: edit.lng, radius: Number($('lokRadius').value) || 300 });
            else d = await api(API, { aksi: 'simpan_lokasi', id: edit.id, nama, alamat: $('lokAlamat').value.trim(), lat: edit.lat, lng: edit.lng });
            toast(edit.mode === 'kampus' ? 'Titik kampus disimpan' : 'Lokasi disimpan');
            tutupForm(); await muat(true);
        } catch (er) { err(er.message); }
        finally { btn.disabled = false; }
    });
    $('lokHapus').addEventListener('click', async () => {
        if (!edit || !edit.id) return;
        if (!confirm('Hapus lokasi "' + $('lokNama').value + '"?\nPengajuan yang sudah ada tidak terpengaruh.')) return;
        try { await api(API, { aksi: 'hapus_lokasi', id: edit.id }); toast('Lokasi dihapus'); tutupForm(); await muat(true); } catch (er) { toast(er.message, true); }
    });

    // ---------- muat data & peta ----------
    async function siapkanPeta() {
        if (peta || gagal) return;
        const k = $('lokPeta');
        try {
            peta = await P.buat(k, { center: kampus ? { lat: kampus.lat, lng: kampus.lng } : P.PUSAT, zoom: kampus ? 16 : 13 });
            peta.onClick((lat, lng) => titikBaru(lat, lng, false));
            siap = true;
        } catch (e) { gagal = true; k.className = 'peta-kotak lok-peta peta-info'; k.textContent = e.message + ' Koordinat tetap bisa diisi manual lewat form.'; }
    }
    async function muat(tanpaFit) {
        try {
            const d = await api(API + '?lokasi=1');
            kampus = d.kampus; lokasi = d.lokasi || [];
            await siapkanPeta(); gambarPeta(); gambarDaftar();
            if (!tanpaFit && peta) {
                const b = P.batas(); if (kampus) b.extend({ lat: kampus.lat, lng: kampus.lng }); lokasi.forEach((l) => b.extend({ lat: l.lat, lng: l.lng }));
                if (b.pts.length > 1) peta.fit(b, 60);
            }
            sudahMuat = true;
            if (antreKampus) { antreKampus = false; bukaForm('kampus'); }
        } catch (e) { $('lokDaftar').textContent = ''; $('lokDaftar').appendChild(el('p', 'arm-kosong', e.message)); }
    }

    window.addEventListener('armada-tab', (ev) => {
        if (ev.detail !== 'lokasi') return;
        if (!sudahMuat) muat(); else setTimeout(() => peta && peta.ukuran(), 60);
    });
    if (location.hash === '#lokasi') muat();
    window.addEventListener('lokasi-kampus', () => { if (sudahMuat) bukaForm('kampus'); else antreKampus = true; });
})();
