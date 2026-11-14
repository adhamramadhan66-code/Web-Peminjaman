/* Perilaku sidebar.
   HP: tertutup saat dibuka, menutup saat layar gelap/menu ditekan.
   Layar lebar: kondisi awal mengecil; bila terbuka lalu pindah halaman lewat menu sidebar, sidebar tetap terbuka di halaman baru;
   klik di luar sidebar otomatis mengecilkannya lagi. */
(function () {
    const sb = document.getElementById('mainSidebar'), tg = document.getElementById('sidebarToggle');
    if (!sb || !tg) return;
    const mq = window.matchMedia('(max-width: 768px)');

    const bd = document.createElement('div');
    bd.className = 'sidebar-backdrop';
    document.body.appendChild(bd);

    const terbuka = () => sb.classList.contains('expanded');
    const sinkron = () => bd.classList.toggle('show', mq.matches && terbuka());
    const tutup = () => { if (terbuka()) tg.click(); };

    new MutationObserver(sinkron).observe(sb, { attributes: true, attributeFilter: ['class'] });
    bd.addEventListener('click', tutup);
    sb.querySelectorAll('a.nav-item').forEach((a) => a.addEventListener('click', () => { if (mq.matches) tutup(); }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mq.matches) tutup(); });

    const ubah = (e) => {
        if (e.matches) tutup();   // ke layar HP: menutup. Ke layar lebar: tetap mengecil (kondisi awal)
        sinkron();
    };
    if (mq.addEventListener) mq.addEventListener('change', ubah); else mq.addListener(ubah);

    if (mq.matches) tutup();   // awal di HP: tertutup
    sinkron();

    // ---- layar lebar: tetap terbuka saat pindah lewat menu; klik di luar menutup ----
    const KUNCI = 'sb-nav';
    let dariMenu = false;
    try { dariMenu = sessionStorage.getItem(KUNCI) === '1'; sessionStorage.removeItem(KUNCI); } catch (e) { /* abaikan */ }
    if (dariMenu && !mq.matches && !terbuka()) tg.click();   // dijalankan saat .preload aktif, jadi tanpa animasi

    sb.querySelectorAll('a.nav-item[href]').forEach((a) => a.addEventListener('click', () => {
        const h = a.getAttribute('href') || '';
        if (h === '#' || h === 'index.html' || mq.matches || !terbuka()) return;   // bukan Settings / Log out
        try { sessionStorage.setItem(KUNCI, '1'); } catch (e) { /* abaikan */ }
    }));

    document.addEventListener('click', (e) => {
        if (mq.matches || !terbuka()) return;
        if (sb.contains(e.target) || tg.contains(e.target)) return;
        tg.click();
    });
})();
