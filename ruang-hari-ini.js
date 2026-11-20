/* Kartu "Ruang Hari Ini": per lantai, bisa digeser; klik membuka popup detail.
   Mengikuti tanggal yang dipilih di kalender (event 'kampusly:tanggal'). */
(function () {
    'use strict';
    const API = 'api/jadwal.php';
    const $ = (id) => document.getElementById(id);
    const card = $('roomCard'), track = $('roomTrack'), dots = $('roomDots');
    const title = $('roomTitle'), caption = $('roomCaption'), floorLabel = $('roomFloorLabel'), prev = $('roomPrev'), next = $('roomNext');
    const modal = $('roomModal');
    if (!card || !track) return;

    let data = null, tanggal = null, tanggalKey = '', idx = 0, openFloor = null, lastFocus = null, reqId = 0;

    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const menit = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
    const sekarang = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
    const hariIni = () => iso(new Date());

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    // ---- status ruang pada tanggal terpilih (warna sama dengan Editor Ruang) ----
    const LABEL = { tersedia: 'Tersedia', dipakai: 'Sedang dipakai', dipinjam: 'Dipinjam' };
    // Judul status dibedakan menurut sumbernya: kuliah ("Jadwal kuliah"/"Sedang kuliah") atau dipinjam pihak lain.
    function judul(kode, j) {
        const kuliah = j && j.jenis === 'kuliah';
        if (kode === 'dipakai') return kuliah ? 'Sedang kuliah' : 'Sedang dipakai';
        if (kode === 'dipinjam') return kuliah ? 'Jadwal kuliah' : 'Dipinjam';
        return LABEL[kode];
    }
    function status(r) {
        const isToday = tanggalKey === hariIni();
        const out = (kode, extra) => {
            const j = extra && (extra.aktif || extra.berikut || extra.penentu);
            return Object.assign({ kode, label: judul(kode, j), sumber: j && kode !== 'tersedia' ? j.jenis : '', aktif: null }, extra);
        };
        if (!r.jadwal.length) {
            // Tanpa jadwal: untuk hari ini ikuti penanda status dari Editor Ruang.
            return out('tersedia');
        }
        if (isToday) {
            const now = sekarang();
            const aktif = r.jadwal.find((j) => menit(j.mulai) <= now && now < menit(j.selesai));
            if (aktif) return out('dipakai', { aktif });
            const berikut = r.jadwal.find((j) => menit(j.mulai) > now);
            if (berikut) return out('dipinjam', { berikut });
            return out('tersedia', { selesai: true });
        }
        return out('dipinjam', { penentu: r.jadwal.find((j) => j.jenis !== 'kuliah') || r.jadwal[0] });
    }

    function judulTanggal() {
        if (tanggalKey === hariIni()) return 'Ruang Hari Ini';
        return 'Ruang \u00b7 ' + tanggal.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // ---- kartu ----
    function pesan(teks) {
        track.textContent = ''; dots.textContent = ''; floorLabel.textContent = '';
        track.appendChild(el('div', 'room-note', teks));
        prev.disabled = next.disabled = true;
    }

    function ringkasLantai(stat) {
        const c = (k) => stat.filter((x) => x.kode === k).length;
        const bagian = [];
        if (tanggalKey === hariIni()) bagian.push(c('dipakai') + ' sedang dipakai');
        bagian.push(c('dipinjam') + ' dipinjam', c('tersedia') + ' tersedia');
        return bagian.join(' \u00b7 ');
    }

    function render() {
        title.textContent = judulTanggal();
        caption.textContent = tanggal.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        if (!data || !data.lantai.length) return pesan('Belum ada lantai. Tambahkan di menu Editor Ruang.');
        track.textContent = ''; dots.textContent = '';

        data.lantai.forEach((l, i) => {
            const stat = l.ruang.map(status);
            const slide = el('div', 'room-slide');
            const head = el('div', 'room-slide-head');
            head.appendChild(el('h4', null, l.nama));
            head.appendChild(el('span', null, l.ruang.length ? ringkasLantai(stat) : 'Belum ada ruang'));
            slide.appendChild(head);

            if (!l.ruang.length) {
                slide.appendChild(el('div', 'room-note', 'Belum ada ruang di lantai ini.'));
            } else {
                const grid = el('div', 'room-tiles');
                l.ruang.forEach((r, k) => {
                    const st = stat[k];
                    const t = el('button', 'rk' + (st.kode === 'tersedia' ? '' : ' ' + st.kode + ' src-' + st.sumber));
                    t.type = 'button';
                    t.setAttribute('aria-label', r.nama + ', ' + st.label + (st.aktif ? ', dipakai ' + st.aktif.peminjam : '') + '. Buka detail.');
                    t.appendChild(el('div', 'n', r.nama || 'Ruang tanpa nama'));
                    const info = st.aktif ? st.aktif.peminjam : r.fasilitas;
                    t.appendChild(el('div', 'f', info || '\u00a0'));
                    t.appendChild(el('div', 's', st.label));
                    t.addEventListener('click', () => bukaModal(l.id, r.id, t));
                    grid.appendChild(t);
                });
                slide.appendChild(grid);
            }
            track.appendChild(slide);

            const d = el('button');
            d.type = 'button'; d.setAttribute('aria-label', l.nama);
            d.addEventListener('click', () => pergi(i));
            dots.appendChild(d);
        });
        if (idx >= data.lantai.length) idx = 0;
        track.scrollLeft = idx * track.clientWidth;
        sinkron();
    }

    function sinkron() {
        const n = data ? data.lantai.length : 0;
        const w = track.clientWidth || 1;
        idx = Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / w)));
        [...dots.children].forEach((d, i) => d.classList.toggle('active', i === idx));
        floorLabel.textContent = n > 1 ? (idx + 1) + ' / ' + n : '';
        dots.style.visibility = n > 1 ? 'visible' : 'hidden';
        prev.disabled = idx <= 0; next.disabled = idx >= n - 1;
    }
    function pergi(i) {
        const n = data ? data.lantai.length : 0;
        if (!n) return;
        idx = Math.max(0, Math.min(n - 1, i));
        track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' });
    }
    prev.addEventListener('click', (e) => { e.stopPropagation(); pergi(idx - 1); });
    next.addEventListener('click', (e) => { e.stopPropagation(); pergi(idx + 1); });
    let st; track.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(sinkron, 40); }, { passive: true });
    window.addEventListener('resize', () => { track.scrollLeft = idx * track.clientWidth; });

    // Roda mouse: geser kiri/kanan (atau Shift + roda) pindah lantai; roda biasa tetap menggulir halaman.
    (function roda() {
        let kunci = 0;
        track.addEventListener('wheel', (e) => {
            const datar = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
            if (!datar) return;
            const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (Math.abs(d) < 4) return;
            e.preventDefault();
            if (Date.now() < kunci) return;
            kunci = Date.now() + 450;
            pergi(idx + (d > 0 ? 1 : -1));
        }, { passive: false });
        track.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); pergi(idx + 1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); pergi(idx - 1); }
        });
    })();

    // Geser dengan mouse (sentuhan/trackpad sudah ditangani scroll-snap).
    (function drag() {
        let down = false, sx = 0, sl = 0, moved = false;
        track.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse' || e.button !== 0) return;
            down = true; moved = false; sx = e.clientX; sl = track.scrollLeft;
        });
        window.addEventListener('pointermove', (e) => {
            if (!down) return;
            const dx = e.clientX - sx;
            if (Math.abs(dx) > 5) { moved = true; track.style.scrollSnapType = 'none'; track.scrollLeft = sl - dx; }
        });
        window.addEventListener('pointerup', (e) => {
            if (!down) return; down = false;
            if (moved) {
                const dx = e.clientX - sx;
                track.style.scrollSnapType = '';
                pergi(idx + (dx < -40 ? 1 : dx > 40 ? -1 : 0));
            }
        });
        track.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    })();

    // ---- popup per ruang ----
    let openRoom = null;
    function bukaModal(floorId, roomId, trigger) {
        openFloor = floorId; openRoom = roomId; lastFocus = trigger || document.activeElement;
        renderModal();
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
        $('roomModalClose').focus();
    }
    function tutupModal() {
        if (modal.hidden) return;
        modal.hidden = true; openFloor = openRoom = null;
        document.body.style.overflow = semua.hidden ? '' : 'hidden';
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function renderModal() {
        const l = data && data.lantai.find((x) => x.id === openFloor);
        const r = l && l.ruang.find((x) => x.id === openRoom);
        if (!r) return tutupModal();
        const st = status(r), isToday = tanggalKey === hariIni();
        $('roomModalTitle').textContent = r.nama || 'Ruang tanpa nama';
        $('roomModalSub').textContent = l.nama + (r.fasilitas ? ' \u00b7 ' + r.fasilitas : '');
        const list = $('roomModalList'); list.textContent = '';

        const banner = el('div', 'room-status' + (st.kode === 'tersedia' ? '' : ' ' + st.kode + ' src-' + st.sumber), st.label);
        const ket = st.aktif ? 'sampai ' + st.aktif.selesai
            : st.berikut ? 'mulai ' + st.berikut.mulai
            : isToday ? 'sekarang ' + pad(Math.floor(sekarang() / 60)) + ':' + pad(sekarang() % 60)
            : tanggal.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        banner.appendChild(el('small', null, ket));
        list.appendChild(banner);

        list.appendChild(el('div', 'room-sec', 'Jadwal ' + (isToday ? 'hari ini' : 'pada tanggal ini')));
        if (!r.jadwal.length) {
            list.appendChild(el('p', 'room-free', st.manual
                ? 'Ditandai "' + st.label.toLowerCase() + '" di Editor Ruang, belum ada data peminjam.'
                : 'Tidak ada peminjaman pada tanggal ini.'));
            return;
        }
        r.jadwal.forEach((j) => {
            const now = st.aktif === j;
            const box = el('div', 'sesi' + (now ? ' now' : ''));
            const jam = el('div', 'sesi-jam');
            jam.appendChild(el('span', null, j.mulai + ' \u2013 ' + j.selesai));
            if (now) jam.appendChild(el('b', null, 'SEDANG BERLANGSUNG'));
            box.appendChild(jam);
            box.appendChild(el('div', 'sesi-mk', (j.keperluan || 'Belum diisi') + (j.kelas ? ' \u00b7 ' + j.kelas : '')));
            const org = el('div', 'sesi-org', j.jenis === 'kuliah' ? 'Dosen ' : 'Dipakai oleh ');
            org.appendChild(el('b', null, j.peminjam));
            box.appendChild(org);
            list.appendChild(box);
        });
    }
    $('roomModalClose').addEventListener('click', tutupModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) tutupModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { if (!modal.hidden) tutupModal(); else tutupSemua(); }
    });

    // ---- popup semua ruangan ----
    const semua = $('allModal'), semuaList = $('allList'), cari = $('allSearch'), saring = $('allFilter');
    let fSemua = 'semua', kunciSemua = false;
    const FILTER = [['semua', 'Semua'], ['tersedia', 'Tersedia'], ['dipakai', 'Sedang dipakai'], ['dipinjam', 'Dipinjam']];
    function renderSemua() {
        if (!data) return;
        saring.textContent = '';
        const hitung = { semua: 0, tersedia: 0, dipakai: 0, dipinjam: 0 };
        const baris = [];
        data.lantai.forEach((l) => l.ruang.forEach((r) => { const st = status(r); hitung.semua++; hitung[st.kode]++; baris.push({ l, r, st }); }));
        FILTER.forEach(([k, t]) => {
            const b = el('button', 'all-chip' + (k === fSemua ? ' active' : ''), t + ' ' + hitung[k]);
            b.type = 'button';
            b.addEventListener('click', () => { fSemua = k; renderSemua(); });
            saring.appendChild(b);
        });
        $('allModalSub').textContent = judulTanggal().replace('Ruang \u00b7 ', '') + ' \u00b7 ' + hitung.semua + ' ruang';
        const q = cari.value.trim().toLowerCase();
        semuaList.textContent = '';
        let ada = 0;
        data.lantai.forEach((l) => {
            const isi = baris.filter((x) => x.l === l && (fSemua === 'semua' || x.st.kode === fSemua)
                && (!q || (x.r.nama || '').toLowerCase().includes(q) || l.nama.toLowerCase().includes(q) || (x.r.fasilitas || '').toLowerCase().includes(q)));
            if (!isi.length) return;
            ada += isi.length;
            semuaList.appendChild(el('div', 'all-lantai', l.nama + ' \u00b7 ' + isi.length + ' ruang'));
            const grid = el('div', 'all-grid');
            isi.forEach(({ r, st }) => {
                const t = el('button', 'all-row ' + st.kode);
                t.type = 'button';
                t.appendChild(el('b', null, r.nama || 'Ruang tanpa nama'));
                t.appendChild(el('span', null, st.aktif ? st.aktif.peminjam : st.label));
                t.addEventListener('click', () => bukaModal(l.id, r.id, t));
                grid.appendChild(t);
            });
            semuaList.appendChild(grid);
        });
        if (!ada) semuaList.appendChild(el('div', 'room-note', 'Tidak ada ruang yang cocok.'));
    }
    function bukaSemua() {
        if (!data) return;
        fSemua = 'semua'; cari.value = ''; lastFocus = $('roomAllBtn');
        renderSemua(); semua.hidden = false; document.body.style.overflow = 'hidden'; cari.focus();
    }
    function tutupSemua() {
        if (semua.hidden) return;
        semua.hidden = true; document.body.style.overflow = '';
        $('roomAllBtn').focus();
    }
    $('roomAllBtn').addEventListener('click', bukaSemua);
    $('allModalClose').addEventListener('click', tutupSemua);
    semua.addEventListener('click', (e) => { if (e.target === semua) tutupSemua(); });
    cari.addEventListener('input', renderSemua);

    // ---- ambil data ----
    async function muat(silent) {
        const my = ++reqId;
        const key = tanggalKey;
        try {
            const res = await fetch(API + '?tanggal=' + key, { cache: 'no-store' });
            const j = await res.json().catch(() => null);
            if (my !== reqId) return;
            if (!res.ok || !j || !j.lantai) throw new Error((j && j.error) || 'x');
            data = j; render();
            if (!modal.hidden) renderModal();
            if (!semua.hidden) renderSemua();
        } catch (err) {
            if (my !== reqId || silent) return;
            data = null;
            title.textContent = judulTanggal();
            pesan('Tidak dapat memuat data ruang. Jalankan lewat jalankan.bat (PHP aktif).');
        }
    }

    function setTanggal(d) {
        const k = iso(d);
        if (k === tanggalKey) return;
        tanggal = new Date(d); tanggalKey = k;
        title.textContent = judulTanggal();
        muat(false);
    }
    window.addEventListener('kampusly:tanggal', (e) => setTanggal(e.detail.date));
    if (window.kampuslyTanggal) setTanggal(window.kampuslyTanggal); else setTanggal(new Date());

    // Status "sedang dipakai" bergeser seiring jam; data disegarkan berkala.
    setInterval(() => { if (data && !document.hidden) { render(); if (!modal.hidden) renderModal(); } }, 60000);
    setInterval(() => { if (!document.hidden) muat(true); }, 300000);
})();
