(function () {
    'use strict';
    const API = 'api/denah.php';

    const $ = (id) => document.getElementById(id);
    const tabsEl = $('floorTabs'), grid = $('roomGrid'), detail = $('detail');
    const saveBtn = $('saveBtn'), syncEl = $('syncStatus');

    let lantai = [], elemen = [];   // data dari server (elemen = semua ruang di semua lantai)
    let cur = null;                 // id lantai aktif
    let sel = null;                 // ruang terpilih
    let dirty = false, tmp = 0;

    const onFloor = () => elemen.filter((e) => e.lantai_id === cur);
    const num = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : Math.max(0, Math.min(9999, n)); };

    // ---------- Komunikasi dengan server ----------
    async function api(payload) {
        let res;
        try {
            res = await fetch(API, payload
                ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
                : { cache: 'no-store' });
        } catch (err) { throw new Error('Tidak dapat terhubung ke server.'); }
        let data = null;
        try { data = await res.json(); } catch (err) {}
        if (!res.ok || !data) {
            throw new Error((data && data.error) || 'Server PHP tidak aktif. Jalankan lewat jalankan.bat (PHP), bukan server Python.');
        }
        return data;
    }

    function terapkan(data) {
        lantai = data.lantai; elemen = data.elemen;
        if (!lantai.some((l) => l.id === cur)) cur = lantai.length ? lantai[0].id : null;
        sel = null; setDirty(false);
        renderTabs(); renderRows();
        muatLive();
    }

    // Status warna kartu = kondisi ruang saat ini menurut jadwal (kuliah + kegiatan disetujui).
    async function muatLive() {
        try {
            const n = new Date(), p = (v) => String(v).padStart(2, '0'), now = n.getHours() * 60 + n.getMinutes();
            const mn = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
            const res = await fetch('api/jadwal.php?tanggal=' + n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate()), { cache: 'no-store' });
            const d = await res.json();
            if (!d.lantai) throw new Error(d.error || 'gagal');
            live = {}; liveInfo = {}; liveSrc = {}; liveLabel = {};
            d.lantai.forEach((l) => l.ruang.forEach((r) => {
                const aktif = r.jadwal.find((j) => mn(j.mulai) <= now && now < mn(j.selesai));
                const next = r.jadwal.find((j) => mn(j.mulai) > now);
                live[r.id] = aktif ? 'dipakai' : next ? 'dipinjam' : 'tersedia';
                const penentu = aktif || next;
                if (penentu) {
                    liveSrc[r.id] = penentu.jenis;
                    const kuliah = penentu.jenis === 'kuliah';
                    liveLabel[r.id] = aktif ? (kuliah ? 'Sedang kuliah' : 'Sedang dipakai') : (kuliah ? 'Jadwal kuliah' : 'Dipinjam');
                }
                if (aktif) liveInfo[r.id] = aktif.keperluan + ' \u00b7 s.d ' + aktif.selesai;
                else if (next) liveInfo[r.id] = 'Berikutnya ' + next.mulai + ' \u00b7 ' + next.keperluan;
            }));
            onFloor().forEach((e) => { const c = kartu(e.id); if (c) isiKartu(c, e); });
            ringkasan();
        } catch (err) { /* status otomatis opsional; kartu tetap tampil hijau */ }
    }

    function setStatus(kind, text) {
        syncEl.className = 'sync' + (kind ? ' ' + kind : '');
        syncEl.querySelector('span').textContent = text;
    }
    function setDirty(v) {
        dirty = v;
        saveBtn.disabled = !v;
        if (v) setStatus('dirty', 'Belum disimpan'); else setStatus('', 'Data tersinkronisasi');
    }
    let toastTimer;
    function toast(msg, isError) {
        const t = $('toast');
        t.textContent = msg; t.className = 'toast show' + (isError ? ' error' : '');
        clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
    }
    async function jalankan(fn) {
        try { await fn(); } catch (err) { setStatus('error', 'Gagal tersambung'); toast(err.message, true); }
    }

    // ---------- Lantai ----------
    function renderTabs() {
        tabsEl.innerHTML = '';
        lantai.forEach((l) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'floor-tab' + (l.id === cur ? ' active' : '');
            b.textContent = l.nama;
            b.addEventListener('click', () => pindahLantai(l.id));
            tabsEl.appendChild(b);
        });
        const add = document.createElement('button');
        add.type = 'button'; add.className = 'floor-tab add'; add.title = 'Tambah lantai';
        add.innerHTML = '<i data-lucide="plus"></i> Lantai';
        add.addEventListener('click', tambahLantai);
        tabsEl.appendChild(add);
        const l = lantai.find((x) => x.id === cur);
        const name = l ? l.nama : '';
        $('canvasTitle').textContent = name;
        $('canvasCrumb').textContent = 'Daftar ruang / ' + name;
        if (window.lucide) lucide.createIcons();
    }

    function pindahLantai(id) {
        if (id === cur) return;
        if (dirty) {
            if (!confirm('Perubahan di lantai ini belum disimpan dan akan dibuang. Lanjutkan?')) return;
            jalankan(async () => { cur = id; terapkan(await api()); });
            return;
        }
        cur = id; sel = null; renderTabs(); renderRows();
    }

    function tambahLantai() {
        if (dirty && !confirm('Perubahan belum disimpan akan dibuang. Lanjutkan?')) return;
        const nama = prompt('Nama lantai baru:', 'Lantai ' + (lantai.length + 1));
        if (nama === null) return;
        jalankan(async () => {
            const d = await api({ action: 'tambah_lantai', nama });
            cur = d.lantai_baru; terapkan(d); toast('Lantai ditambahkan');
        });
    }
    $('renameFloor').addEventListener('click', () => {
        const l = lantai.find((x) => x.id === cur); if (!l) return;
        const nama = prompt('Nama lantai:', l.nama);
        if (nama === null || !nama.trim()) return;
        jalankan(async () => {
            const d = await api({ action: 'ubah_lantai', id: cur, nama });
            lantai = d.lantai; renderTabs(); toast('Nama lantai diubah');
        });
    });
    $('deleteFloor').addEventListener('click', () => {
        const l = lantai.find((x) => x.id === cur); if (!l) return;
        if (!confirm('Hapus "' + l.nama + '" beserta seluruh ruang di dalamnya?')) return;
        jalankan(async () => { terapkan(await api({ action: 'hapus_lantai', id: cur })); toast('Lantai dihapus'); });
    });

    // ---------- Daftar ruang (kotak-kotak) ----------
    const STATUS = { tersedia: 'Tersedia', dipakai: 'Sedang dipakai', dipinjam: 'Dipinjam' };
    let live = {}, liveInfo = {}, liveSrc = {}, liveLabel = {};   // status otomatis dari jadwal hari ini: {idRuang: tersedia|dipakai|dipinjam}
    const statusOf = (e) => live[e.id] || 'tersedia';
    const byKey = (k) => elemen.find((e) => e.id === k);

    function ringkasan() {
        const r = onFloor();
        const n = (k, src) => r.filter((e) => statusOf(e) === k && (!src || liveSrc[e.id] === src)).length;
        $('summary').textContent = r.length + ' ruang \u00b7 ' + n('dipakai') + ' sedang dipakai \u00b7 ' + n('dipinjam', 'kegiatan') + ' dipinjam \u00b7 ' + n('dipinjam', 'kuliah') + ' jadwal kuliah \u00b7 ' + n('tersedia') + ' tersedia';
    }

    function isiKartu(card, e) {
        card.innerHTML = '<div class="n"></div><div class="f"></div><div class="s"></div>';
        card.className = 'room-card ' + statusOf(e) + (liveSrc[e.id] && statusOf(e) !== 'tersedia' ? ' src-' + liveSrc[e.id] : '') + (e.id === sel ? ' selected' : '');
        card.querySelector('.s').textContent = liveLabel[e.id] || STATUS[statusOf(e)];
        card.querySelector('.n').textContent = e.nama || 'Ruang tanpa nama';
        card.querySelector('.f').textContent = liveInfo[e.id] || e.fasilitas;
    }
    const kartu = (id) => grid.querySelector('[data-id="' + id + '"]');

    function renderRows() {
        grid.innerHTML = '';
        const rows = onFloor();
        if (!rows.length) {
            const d = document.createElement('div'); d.className = 'room-empty';
            d.textContent = 'Belum ada ruang di lantai ini. Klik \u201cTambah ruang\u201d untuk menambahkan.';
            grid.appendChild(d);
        }
        rows.forEach((e) => {
            const c = document.createElement('button');
            c.type = 'button'; c.dataset.id = e.id;
            isiKartu(c, e);
            c.addEventListener('click', () => pilih(e.id));
            grid.appendChild(c);
        });
        ringkasan(); renderDetail();
    }

    const layarKecil = () => window.matchMedia('(max-width: 1100px)').matches;
    function keDetail() { if (layarKecil()) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

    function pilih(id) {
        if (sel === id) return;
        sel = id;
        grid.querySelectorAll('.room-card.selected').forEach((n) => n.classList.remove('selected'));
        const n = kartu(id); if (n) n.classList.add('selected');
        renderDetail(); keDetail();
    }

    // ---------- Panel detail ----------
    function renderDetail() {
        const e = sel !== null ? byKey(sel) : null;
        if (!e) {
            detail.innerHTML = '<div class="empty"><i data-lucide="pencil"></i><strong>Pilih ruang</strong>Klik salah satu kotak ruang untuk melihat dan mengubah detailnya.</div>';
            if (window.lucide) lucide.createIcons();
            return;
        }
        const fld = (k, lbl, type, extra) => '<div class="field"><label>' + lbl + '</label><input data-f="' + k + '" type="' + type + '" ' + (extra || '') + '></div>';
        detail.innerHTML =
            '<div class="kind">Ruang</div>' +
            fld('nama', 'Nama ruang', 'text', 'maxlength="60"') +
            fld('fasilitas', 'Fasilitas', 'text', 'maxlength="255" placeholder="Proyektor, Papan tulis"') +
            '<p class="hint">Status ruang (tersedia / sedang dipakai / dipinjam) otomatis mengikuti jadwal hari ini.</p>' +
            '<button type="button" class="btn danger" id="delEl"><i data-lucide="trash-2"></i> Hapus ruang</button>';
        detail.querySelectorAll('[data-f]').forEach((inp) => {
            const k = inp.dataset.f;
            inp.value = e[k];
            inp.addEventListener('input', () => {
                e[k] = (k === 'kapasitas' || k === 'kapasitas_meja') ? num(inp.value) : inp.value;
                const c = kartu(e.id); if (c) isiKartu(c, e);
                setDirty(true); ringkasan();
            });
        });
        $('delEl').addEventListener('click', () => { elemen = elemen.filter((x) => x !== e); sel = null; setDirty(true); renderRows(); });
        if (window.lucide) lucide.createIcons();
    }

    $('addRoom').addEventListener('click', () => {
        if (cur === null) return;
        const e = { id: 'n' + (++tmp), lantai_id: cur, tipe: 'ruang', nama: 'Ruang baru', x: 0, y: 0, w: 250, h: 130, kapasitas: 0, kapasitas_meja: 0, fasilitas: '', status: 'tersedia' };
        elemen.push(e); sel = e.id; setDirty(true); renderRows();
        const c = kartu(e.id); if (c) c.scrollIntoView({ block: 'nearest' });
        const inp = detail.querySelector('[data-f="nama"]'); if (inp) { inp.focus(); inp.select(); }
    });

    // ---------- Simpan ----------
    saveBtn.addEventListener('click', () => jalankan(async () => {
        saveBtn.disabled = true; setStatus('', 'Menyimpan\u2026');
        const payload = onFloor().map((e) => ({
            id: typeof e.id === 'number' ? e.id : 0, tipe: 'ruang', nama: e.nama.trim() || 'Ruang tanpa nama', x: e.x, y: e.y, w: e.w, h: e.h,
            kapasitas: e.kapasitas, kapasitas_meja: e.kapasitas_meja, fasilitas: e.fasilitas, status: 'tersedia'
        }));
        terapkan(await api({ action: 'simpan_denah', lantai_id: cur, elemen: payload }));
        toast('Data ruang tersimpan');
    }));

    document.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (dirty) saveBtn.click(); }
    });
    window.addEventListener('beforeunload', (ev) => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });

    // Warna kartu ikut berubah seiring jam berjalan / jadwal berubah.
    setInterval(() => { if (!document.hidden) muatLive(); }, 60000);

    // ---------- Mulai ----------
    setStatus('', 'Memuat\u2026');
    jalankan(async () => terapkan(await api()));
})();
