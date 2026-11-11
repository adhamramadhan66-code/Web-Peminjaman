/* Dialog "alasan" saat admin menolak pengajuan atau membatalkan peminjaman yang sudah disetujui.
   Dipakai halaman Peminjaman dan Jadwal Ruang. Alasan WAJIB diisi: server mengirimkannya ke pemohon lewat menu Pesan
   (bila pemohon punya akun) dan menyimpannya di data peminjaman.

     window.KPAlasan.minta({ mode: 'tolak' | 'batal', info: [[label, isi], ...], punyaAkun: true | false | undefined })
       -> Promise<string | null>   (teks alasan, atau null bila dibatalkan) */
(function () {
    'use strict';
    const CEPAT = {
        tolak: ['Ruang bentrok dengan jadwal lain', 'Ruang tidak tersedia pada tanggal tersebut', 'Jumlah peserta melebihi kapasitas ruang', 'Data pengajuan belum lengkap', 'Kegiatan tidak sesuai ketentuan penggunaan ruang'],
        batal: ['Ruang dipakai untuk kegiatan yang lebih mendesak', 'Ruang sedang diperbaiki / dirawat', 'Ada perubahan jadwal kuliah atau kegiatan', 'Kegiatan dipindahkan ke ruang lain'],
    };
    const TEKS = {
        tolak: { judul: 'Tolak pengajuan', sub: 'Tulis alasannya supaya pemohon tahu apa masalahnya dan bisa mengajukan ulang dengan benar.', tombol: 'Tolak pengajuan' },
        batal: { judul: 'Batalkan peminjaman', sub: 'Peminjaman ini sudah disetujui. Jelaskan alasan pembatalannya agar pemohon tidak bingung.', tombol: 'Batalkan peminjaman' },
    };
    const MAKS = 255, MIN = 3;
    const el = (tag, cls, teks) => { const e = document.createElement(tag); if (cls) e.className = cls; if (teks != null) e.textContent = teks; return e; };
    let terbuka = false;

    function minta(o) {
        o = o || {};
        if (terbuka) return Promise.resolve(null);
        terbuka = true;
        const mode = o.mode === 'batal' ? 'batal' : 'tolak', t = TEKS[mode];
        const sebelumnya = document.activeElement;

        return new Promise((selesai) => {
            const lapis = el('div', 'al-modal'); lapis.setAttribute('role', 'dialog'); lapis.setAttribute('aria-modal', 'true'); lapis.setAttribute('aria-label', t.judul);
            const kotak = el('div', 'al-box');
            const kep = el('div', 'al-head'); kep.appendChild(el('h3', null, t.judul));
            const x = el('button', 'al-x', '\u00d7'); x.type = 'button'; x.setAttribute('aria-label', 'Tutup'); kep.appendChild(x);
            kotak.appendChild(kep);
            kotak.appendChild(el('p', 'al-sub', t.sub));

            if (Array.isArray(o.info) && o.info.length) {
                const dl = el('dl', 'al-info');
                o.info.forEach(([k, v]) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v == null || v === '' ? '-' : String(v))); });
                kotak.appendChild(dl);
            }

            const lbl = el('label', 'al-lbl'); lbl.htmlFor = 'alasanTeks'; lbl.appendChild(document.createTextNode('Alasan '));
            lbl.appendChild(el('em', null, '*')); kotak.appendChild(lbl);
            const chips = el('div', 'al-chips');
            const ta = el('textarea', 'al-teks'); ta.id = 'alasanTeks'; ta.rows = 3; ta.maxLength = MAKS; ta.placeholder = 'Tulis alasan singkat dan jelas\u2026';
            CEPAT[mode].forEach((c) => {
                const b = el('button', 'al-chip', c); b.type = 'button';
                b.addEventListener('click', () => { ta.value = ta.value.trim() ? (ta.value.trim().replace(/[.;]$/, '') + '; ' + c.toLowerCase()).slice(0, MAKS) : c; ta.dispatchEvent(new Event('input')); ta.focus(); });
                chips.appendChild(b);
            });
            kotak.appendChild(chips); kotak.appendChild(ta);

            const bawah = el('div', 'al-bawah');
            const petunjuk = o.punyaAkun === true ? 'Alasan ini otomatis dikirim ke pemohon lewat menu Pesan.'
                : o.punyaAkun === false ? 'Pemohon tidak punya akun, jadi alasan hanya dicatat di data peminjaman.'
                : 'Bila pemohon punya akun, alasan ini otomatis dikirim lewat menu Pesan.';
            const hint = el('span', 'al-hint', petunjuk), hitung = el('span', 'al-hitung', '0/' + MAKS);
            bawah.appendChild(hint); bawah.appendChild(hitung); kotak.appendChild(bawah);
            const galat = el('p', 'al-err'); galat.setAttribute('role', 'alert'); kotak.appendChild(galat);

            const aksi = el('div', 'al-aksi');
            const batal = el('button', 'al-tbl', 'Batal'); batal.type = 'button';
            const ya = el('button', 'al-tbl bahaya', t.tombol); ya.type = 'button';
            aksi.appendChild(batal); aksi.appendChild(ya); kotak.appendChild(aksi);
            lapis.appendChild(kotak); document.body.appendChild(lapis);
            document.body.style.overflow = 'hidden';

            function tutup(hasil) {
                document.removeEventListener('keydown', tombolKeyboard, true);
                lapis.remove(); terbuka = false;
                if (!document.querySelector('.room-modal:not([hidden]), .pf-modal')) document.body.style.overflow = '';
                if (sebelumnya && sebelumnya.focus) { try { sebelumnya.focus(); } catch (e) { /* abaikan */ } }
                selesai(hasil);
            }
            function kirim() {
                const a = ta.value.replace(/\s+/g, ' ').trim();
                if (a.length < MIN) { galat.textContent = 'Alasan wajib diisi (minimal ' + MIN + ' karakter).'; ta.focus(); return; }
                tutup(a);
            }
            // Escape menutup dialog ini saja (bukan jendela detail di bawahnya); Ctrl+Enter mengirim.
            function tombolKeyboard(e) {
                if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); tutup(null); }
                else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); kirim(); }
            }
            document.addEventListener('keydown', tombolKeyboard, true);

            ta.addEventListener('input', () => { hitung.textContent = ta.value.length + '/' + MAKS; if (galat.textContent && ta.value.trim().length >= MIN) galat.textContent = ''; });
            x.addEventListener('click', () => tutup(null));
            batal.addEventListener('click', () => tutup(null));
            ya.addEventListener('click', kirim);
            ta.focus();
        });
    }

    window.KPAlasan = { minta };
})();
