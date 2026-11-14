/* Perilaku umum halaman dalam (Jadwal, Peminjaman, Pesan): tema, sesi login, logout, sidebar, ikon.
   Halaman memakai id: themeToggle, logoutBtn, currentUserLabel, mainSidebar, sidebarToggle.
   Login yang sebenarnya dijaga server (PHP session, api/auth.php); sessionStorage hanya salinan
   untuk menampilkan nama/peran dengan cepat. Sesi server dicek ulang oleh pesan-notif.js. */
(function () {
    'use strict';
    const KEY = 'kampuslyCurrentUser';
    const $ = (id) => document.getElementById(id);

    // Tema gelap/terang
    const root = document.documentElement, tema = $('themeToggle');
    if (tema) {
        const sync = () => { const dark = root.dataset.theme !== 'light'; tema.setAttribute('aria-pressed', String(dark)); tema.title = dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'; };
        sync();
        tema.addEventListener('click', () => {
            root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
            try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
            sync();
        });
    }

    // Sesi login + logout. Semua akun yang sudah masuk boleh membuka halaman; peran (admin/pengguna)
    // dipakai untuk menyembunyikan menu khusus admin (kelas .khusus-admin diatur di pesan.css).
    const keLogin = (query) => window.location.replace('index.html' + (query || ''));
    const hapusSesi = () => { try { sessionStorage.removeItem(KEY); } catch (e) {} };
    const cek = () => {
        try {
            const u = JSON.parse(sessionStorage.getItem(KEY) || 'null');
            if (!u || !u.email) { keLogin(); return null; }
            root.dataset.peran = u.peran === 'admin' ? 'admin' : 'pengguna';
            return u;
        } catch (e) { keLogin(); return null; }
    };
    const user = cek();
    window.kampuslyUser = user;
    if (user && $('currentUserLabel')) $('currentUserLabel').textContent = user.name || user.email;
    const foto = document.querySelector('.profile-img');
    if (foto && user) foto.alt = 'Profil ' + (user.name || user.email);
    if ($('logoutBtn')) $('logoutBtn').addEventListener('click', (ev) => {
        ev.preventDefault();
        hapusSesi();
        const selesai = () => keLogin('?logout=1');
        // Akhiri sesi di server juga; tetap lanjut ke halaman login walau permintaan gagal.
        fetch('api/auth.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aksi: 'keluar' }), keepalive: true })
            .then(selesai, selesai);
    });
    window.addEventListener('pageshow', cek);

    // Sidebar buka/tutup
    const sidebar = $('mainSidebar'), tg = $('sidebarToggle');
    if (sidebar && tg) {
        const set = (open) => {
            sidebar.classList.toggle('expanded', open); tg.classList.toggle('expanded', open);
            tg.setAttribute('aria-expanded', String(open)); tg.setAttribute('aria-label', open ? 'Tutup sidebar' : 'Buka sidebar');
        };
        // Kondisi awal selalu mengecil (hanya ikon); dibuka manual lewat tombol panah.
        set(false);
        tg.addEventListener('click', () => set(!sidebar.classList.contains('expanded')));
    }

    if (window.lucide) lucide.createIcons();
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('preload')));

    // Alat bantu bersama untuk halaman dalam
    const pad = (n) => String(n).padStart(2, '0');
    window.KP = {
        pad,
        iso: (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
        dariIso: (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
        menit: (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; },
        jam: (mnt) => pad(Math.floor(mnt / 60)) + ':' + pad(mnt % 60),
        el: (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
        tanggalPanjang: (d) => d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        tanggalPendek: (d) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
        async api(url, payload) {
            let res;
            try {
                res = await fetch(url, payload
                    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
                    : { cache: 'no-store' });
            } catch (err) { throw new Error('Tidak dapat terhubung ke server.'); }
            let data = null;
            try { data = await res.json(); } catch (err) {}
            if (res.status === 401) { hapusSesi(); keLogin(); throw new Error((data && data.error) || 'Sesi berakhir. Silakan masuk kembali.'); }
            if (!res.ok || !data) throw new Error((data && data.error) || 'Server PHP tidak aktif. Buka lewat Laragon (http://localhost/...) atau jalankan.bat.');
            return data;
        },
        toast(msg, isError) {
            const t = $('toast'); if (!t) return;
            t.textContent = msg; t.className = 'toast show' + (isError ? ' error' : '');
            clearTimeout(window.__kpToast); window.__kpToast = setTimeout(() => t.classList.remove('show'), 3200);
        },
        status(kind, text) {
            const s = $('syncStatus'); if (!s) return;
            s.className = 'sync' + (kind ? ' ' + kind : ''); s.querySelector('span').textContent = text;
        },
    };
})();
