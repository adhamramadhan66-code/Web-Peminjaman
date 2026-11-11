/* Dimuat di semua halaman dalam (Dashboard, Jadwal, Peminjaman, Editor Ruang, Pesan).
   1) Menampilkan lencana jumlah pesan belum dibaca pada menu "Pesan" di sidebar.
   2) Memastikan sesi di server masih berlaku: bila berakhir (401) kembali ke halaman login.
   3) Bila akun di server berbeda dengan akun yang tersimpan di tab ini (login akun lain di tab lain),
      data tab disamakan lalu halaman dimuat ulang agar tidak menampilkan data akun yang salah. */
(function () {
    'use strict';
    const KEY = 'kampuslyCurrentUser';
    const nav = document.getElementById('navPesan');
    const badge = nav ? nav.querySelector('.nav-badge') : null;

    function baca() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
    function keLogin() { try { sessionStorage.removeItem(KEY); } catch (e) {} window.location.replace('index.html'); }

    function tampil(n) {
        if (!badge) return;
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.hidden = !(n > 0);
        nav.title = n > 0 ? 'Pesan (' + n + ' belum dibaca)' : 'Pesan';
    }

    let sedangMemuat = false;
    async function segarkan() {
        if (sedangMemuat) return;
        sedangMemuat = true;
        try {
            const res = await fetch('api/chat.php?aksi=belum_dibaca', { cache: 'no-store' });
            if (res.status === 401) return keLogin();
            if (!res.ok) return;
            const d = await res.json();

            const u = baca(), s = d.saya;
            if (s && (!u || String(u.id) !== String(s.id) || u.peran !== s.peran)) {
                try {
                    sessionStorage.setItem(KEY, JSON.stringify({ id: s.id, email: s.email, name: s.nama, peran: s.peran }));
                    const cek = baca();
                    if (cek && String(cek.id) === String(s.id)) { window.location.reload(); return; }
                } catch (e) { /* penyimpanan sesi tidak tersedia: lanjutkan tanpa memuat ulang */ }
            }
            tampil(d.belum || 0);
        } catch (e) {
            /* koneksi terputus sementara: coba lagi pada putaran berikutnya */
        } finally {
            sedangMemuat = false;
        }
    }

    window.kampuslyPesan = { segarkan: segarkan, tampil: tampil };
    segarkan();
    setInterval(() => { if (!document.hidden) segarkan(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) segarkan(); });
})();
