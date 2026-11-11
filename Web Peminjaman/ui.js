/* ui.js - pelengkap lapisan tampilan (ui.css). Dimuat di semua halaman dalam; tidak mengubah data atau logika halaman.
   (bagian 5-8: sakelar animasi, riak klik, kartu miring, muncul saat scroll)
   1) Angka ringkasan (kartu KPI) menghitung naik dari 0 saat tampil dan saat nilainya berubah.
   2) Tabel diberi data-label per sel (dari judul kolom) supaya di HP tampil sebagai kartu (lihat ui.css bagian 3).
   3) Pergantian tema tampil dengan transisi warna yang halus.
   4) Di HP: geser dari tepi kiri membuka menu samping, geser ke kiri menutupnya. */
(function () {
    'use strict';
    const kurangiGerak = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const html = document.documentElement;

    // ---------- 1. angka naik ----------
    function animasi(el) {
        const teks = el.textContent.trim();
        if (!/^\d{1,7}$/.test(teks) || el._uiTampil === teks) return;
        const ke = parseInt(teks, 10), dari = el._uiNilai == null ? 0 : el._uiNilai;
        el._uiNilai = ke;
        if (kurangiGerak || dari === ke) { el._uiTampil = teks; return; }
        const mulai = performance.now(), lama = 750;
        if (el._uiRaf) cancelAnimationFrame(el._uiRaf);
        (function langkah(t) {
            const p = Math.max(0, Math.min(1, (t - mulai) / lama)), e = 1 - Math.pow(1 - p, 3);   // dijepit 0..1: stempel waktu frame bisa sedikit lebih awal dari 'mulai'
            const nilai = p >= 1 ? ke : Math.round(dari + (ke - dari) * e);
            el._uiTampil = String(nilai); el.textContent = el._uiTampil;
            if (p < 1) el._uiRaf = requestAnimationFrame(langkah);
        })(mulai);
    }
    function pindaiAngka() { document.querySelectorAll('.kpi-value').forEach(animasi); }

    // ---------- 2. label sel tabel ----------
    function labelTabel() {
        document.querySelectorAll('table.tbl, table.agenda').forEach((tb) => {
            tb.classList.add('ui-kartu');
            const judul = Array.from(tb.querySelectorAll('thead th')).map((th) => th.textContent.trim());
            if (!judul.length) return;
            tb.querySelectorAll('tbody tr').forEach((tr) => {
                if (tr.children.length === 1 && tr.children[0].colSpan > 1) { tr.classList.add('ui-kosong'); return; }   // baris pesan "kosong/memuat"
                if (tr.classList.contains('empty-row') || tr.classList.contains('grup-hari')) return;
                Array.from(tr.children).forEach((td, i) => {
                    if (td.dataset.label !== judul[i]) td.dataset.label = judul[i] || '';
                    const panjang = td.textContent.trim().length > 26 || td.querySelector('strong, .row-act');
                    td.classList.toggle('ui-penuh', !!panjang && i > 0);
                    td.classList.toggle('ui-aksi', !!td.querySelector('.row-act'));       // sel tombol aksi (ubah/hapus/setujui)
                });
            });
        });
    }

    // ---------- 2b. tinggi kartu slide ruang mengikuti slide aktif ----------
    function tinggiSlide() {
        const trek = document.querySelector('.room-track'); if (!trek) return;
        const slide = trek.querySelectorAll('.room-slide'); if (!slide.length) return;
        const i = Math.max(0, Math.min(slide.length - 1, Math.round(trek.scrollLeft / (trek.clientWidth || 1))));
        const h = slide[i].offsetHeight;
        if (h && trek.style.height !== h + 'px') trek.style.height = h + 'px';
    }
    const trek0 = document.querySelector('.room-track');
    if (trek0) {
        let rafTrek = 0;
        trek0.addEventListener('scroll', () => { if (rafTrek) return; rafTrek = requestAnimationFrame(() => { rafTrek = 0; tinggiSlide(); }); }, { passive: true });
        window.addEventListener('resize', tinggiSlide);
        if (window.ResizeObserver) { const ro = new ResizeObserver(tinggiSlide); const amati = () => trek0.querySelectorAll('.room-slide').forEach((s) => ro.observe(s)); amati(); new MutationObserver(amati).observe(trek0, { childList: true }); }
    }

    // Satu pengamat untuk seluruh area utama; pekerjaan digabung per frame agar ringan.
    let jadwalPindai = 0;
    function jadwalkan() {
        if (jadwalPindai) return;
        jadwalPindai = requestAnimationFrame(() => { jadwalPindai = 0; labelTabel(); pindaiAngka(); tinggiSlide(); });
    }
    const area = document.querySelector('.main-content') || document.body;
    new MutationObserver(jadwalkan).observe(area, { childList: true, subtree: true, characterData: true });
    jadwalkan();

    // ---------- 3. transisi tema ----------
    const tombolTema = document.getElementById('themeToggle');
    if (tombolTema) {
        tombolTema.addEventListener('click', () => {
            html.classList.add('ui-tema');
            clearTimeout(tombolTema._uiTmr);
            tombolTema._uiTmr = setTimeout(() => html.classList.remove('ui-tema'), 650);
        }, true);
    }

    // ---------- 5. mode animasi: penuh / hemat ----------
    // Bawaan mengikuti pengaturan perangkat ("kurangi gerakan"). Pengguna bisa memaksa "penuh" atau "hemat" lewat sakelar
    // di menu foto profil; pilihan disimpan di browser (localStorage 'ui-animasi') dan dipasang sedini mungkin oleh skrip di <head>.
    const aktif = () => { const a = html.dataset.animasi; return a === 'penuh' || (a !== 'hemat' && !kurangiGerak); };
    const menuFoto = document.querySelector('.pf-menu');
    if (menuFoto) {
        const sep = document.createElement('div'); sep.className = 'pf-sep';
        const tbl = document.createElement('button'); tbl.type = 'button'; tbl.className = 'pf-item ui-sakelar'; tbl.setAttribute('role', 'menuitemcheckbox');
        tbl.innerHTML = '<span class="pf-ik"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg></span><span><b>Animasi</b><small></small></span><ui-sw></ui-sw>';
        const perbarui = () => {
            const on = aktif();
            tbl.setAttribute('aria-checked', on ? 'true' : 'false');
            tbl.querySelector('small').textContent = on ? 'Penuh' : (html.dataset.animasi === 'hemat' ? 'Hemat' : 'Hemat (mengikuti pengaturan perangkat)');
        };
        tbl.addEventListener('click', (e) => {
            e.stopPropagation();
            const baru = aktif() ? 'hemat' : 'penuh';
            html.dataset.animasi = baru;
            try { localStorage.setItem('ui-animasi', baru); } catch (x) { /* abaikan */ }
            perbarui();
        });
        perbarui(); menuFoto.appendChild(sep); menuFoto.appendChild(tbl);
    }

    // ---------- 6. riak saat diklik / disentuh ----------
    const TARGET_RIAK = '.btn, .btn-icon, .btn-round, .ic-btn, .seg button, .pf-item, .al-chip, .kontak, .nav-item, .pf-tbl, .al-tbl, .room-arrow, .sidebar-toggle';
    document.addEventListener('pointerdown', (e) => {
        if (!aktif() || e.button > 0) return;
        const t = e.target.closest && e.target.closest(TARGET_RIAK);
        if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
        const r = t.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.4;
        const wadah = document.createElement('ui-riak'), g = document.createElement('ui-g');
        g.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px';
        wadah.appendChild(g);
        if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
        t.appendChild(wadah);
        g.addEventListener('animationend', () => wadah.remove());
        setTimeout(() => wadah.remove(), 1100);
    }, true);

    // ---------- 7. kartu miring mengikuti kursor (hanya mouse) ----------
    let miring = null;
    function lepasMiring(el) {
        if (!el) return;
        el.classList.add('ui-miring-lepas'); el.style.transform = '';
        setTimeout(() => el.classList.remove('ui-miring-lepas'), 520);
    }
    document.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' || !aktif()) return;
        const t = e.target.closest && e.target.closest('.kpi-card, .rk');
        if (miring && miring !== t) { lepasMiring(miring); miring = null; }
        if (!t) return;
        miring = t;
        const r = t.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
        t.classList.remove('ui-miring-lepas');
        t.style.transform = 'perspective(800px) rotateX(' + (-py * 10).toFixed(2) + 'deg) rotateY(' + (px * 12).toFixed(2) + 'deg) translateY(-4px) scale(1.02)';
    }, { passive: true });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget && miring) { lepasMiring(miring); miring = null; } });

    // ---------- 8. kartu di bawah layar muncul saat di-scroll ----------
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((daftar) => {
            daftar.forEach((en) => {
                if (!en.isIntersecting) return;
                const el = en.target; io.unobserve(el); el.classList.add('ui-lihat');
                setTimeout(() => { el.classList.remove('ui-reveal', 'ui-lihat'); el.classList.add('ui-tampil'); }, 1000);
            });
        }, { threshold: 0.12 });
        document.querySelectorAll('.main-content .panel, .main-content .chart-card, .main-content .table-card').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (!aktif() || r.height === 0 || r.top < window.innerHeight * 0.6) return;     // yang sudah jelas terlihat memakai animasi masuk biasa
            el.classList.add('ui-reveal'); io.observe(el);
        });
    }

    // ---------- 9. geser untuk membuka / menutup menu (HP) ----------
    const tombolMenu = document.getElementById('sidebarToggle');
    const bar = document.getElementById('mainSidebar');
    if (tombolMenu && bar && 'ontouchstart' in window) {
        let awal = null;
        document.addEventListener('touchstart', (e) => {
            const t = e.touches[0]; if (!t || window.innerWidth > 768) { awal = null; return; }
            const terbuka = bar.classList.contains('expanded');
            awal = { x: t.clientX, y: t.clientY, terbuka, sah: terbuka || t.clientX < 22 };
        }, { passive: true });
        document.addEventListener('touchend', (e) => {
            if (!awal || !awal.sah) return;
            const t = e.changedTouches[0]; if (!t) return;
            const dx = t.clientX - awal.x, dy = Math.abs(t.clientY - awal.y);
            const terbukaSekarang = bar.classList.contains('expanded');
            if (dy < 60 && ((!terbukaSekarang && dx > 70) || (terbukaSekarang && dx < -70))) tombolMenu.click();
            awal = null;
        }, { passive: true });
    }
})();
