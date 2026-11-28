/* Pembantu peta: OpenStreetMap lewat Leaflet (gratis, tanpa API key) + pencarian alamat Nominatim.
   Dibuat dengan antarmuka sederhana (buat, titik, pin, garis, lingkaran, batas, cari, alamatDari) sehingga
   penyedia peta bisa diganti tanpa mengubah halaman lain. */
(function () {
    'use strict';
    const PUSAT = { lat: -7.5666, lng: 110.8167 };   // pusat Kota Surakarta (hanya tampilan awal peta)
    const LF = 'https://unpkg.com/leaflet@1.9.4/dist/';
    let janji = null;

    function muat() {
        if (window.L && L.map) return Promise.resolve(L);
        if (!janji) {
            janji = new Promise((ok, gagal) => {
                const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LF + 'leaflet.css'; document.head.appendChild(css);
                const s = document.createElement('script'); s.src = LF + 'leaflet.js'; s.onload = () => ok(window.L);
                s.onerror = () => { janji = null; gagal(new Error('Peta tidak dapat dimuat. Periksa koneksi internet.')); };
                document.head.appendChild(s);
            });
        }
        return janji;
    }

    /** Peta baru di elemen $el. */
    async function buat($el, opsi) {
        await muat(); opsi = opsi || {};
        const c = opsi.center || PUSAT;
        const peta = L.map($el, { zoomControl: true, attributionControl: true }).setView([c.lat, c.lng], opsi.zoom || 13);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(peta);
        setTimeout(() => peta.invalidateSize(), 200);
        return {
            _p: peta,
            onClick(fn) { peta.on('click', (e) => fn(e.latlng.lat, e.latlng.lng)); },
            panTo(p) { peta.panTo([p.lat, p.lng]); },
            setZoom(z) { peta.setZoom(z); },
            fit(b, pad) { if (b && b.pts.length) peta.fitBounds(b.pts.map((p) => [p.lat, p.lng]), { padding: [pad || 40, pad || 40], maxZoom: 17 }); },
            kursor(aktif) { peta.getContainer().style.cursor = aktif ? 'crosshair' : ''; },
            ukuran() { peta.invalidateSize(); },
        };
    }
    const batas = () => ({ pts: [], extend(p) { this.pts.push(p); }, isEmpty() { return !this.pts.length; } });

    function bungkus(m) { return { setPosition(p) { m.setLatLng([p.lat, p.lng]); }, setWarna() {}, remove() { m.remove(); } }; }
    /** Penanda bulat berwarna dengan kode di tengahnya. */
    function titik(peta, pos, o) {
        const d = (o.skala || 15) * 2, warna = o.warna || '#2563eb';
        const ikon = L.divIcon({ className: '', iconSize: [d, d], iconAnchor: [d / 2, d / 2],
            html: '<div class="pt-bulat" style="width:' + d + 'px;height:' + d + 'px;background:' + warna + '">' + (o.label || '') + '</div>' });
        const m = L.marker([pos.lat, pos.lng], { icon: ikon, title: o.judul || '', zIndexOffset: (o.z || 1) * 100 }).addTo(peta._p);
        const w = bungkus(m);
        w.setWarna = (c) => { const e = m.getElement(); if (e && e.firstChild) e.firstChild.style.background = c; };
        return w;
    }
    /** Penanda bernama (lencana berisi nama lokasi), mis. "Kampus TSU". o: {nama, warna, z, klik} */
    function tanda(peta, pos, o) {
        o = o || {};
        const e = document.createElement('div'); e.className = 'pt-tanda';
        const i = document.createElement('i'); i.style.background = o.warna || '#059669'; e.appendChild(i);
        const t = document.createElement('span'); t.textContent = o.nama || ''; e.appendChild(t);
        const ikon = L.divIcon({ className: 'pt-tanda-wrap', html: e, iconSize: null, iconAnchor: [11, 11] });
        const m = L.marker([pos.lat, pos.lng], { icon: ikon, title: o.nama || '', zIndexOffset: (o.z || 3) * 100 }).addTo(peta._p);
        if (o.klik) m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); o.klik(); });
        const w = bungkus(m);
        w.setNama = (n) => { t.textContent = n; };
        return w;
    }
    /** Penanda tujuan berbentuk pin. */
    function pin(peta, pos, o) {
        const warna = (o && o.warna) || '#dc2626';
        const ikon = L.divIcon({ className: '', iconSize: [30, 40], iconAnchor: [15, 38],
            html: '<svg viewBox="0 0 30 40" width="30" height="40"><path d="M15 39C15 39 2 24 2 14a13 13 0 0 1 26 0c0 10-13 25-13 25z" fill="' + warna + '" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>' });
        return bungkus(L.marker([pos.lat, pos.lng], { icon: ikon, title: (o && o.judul) || '', zIndexOffset: 200 }).addTo(peta._p));
    }
    function garis(peta, o) {
        const l = L.polyline([], { color: (o && o.warna) || '#2563eb', weight: 4, opacity: 0.8 }).addTo(peta._p);
        return { setPath(pts) { l.setLatLngs(pts.map((p) => [p.lat, p.lng])); }, remove() { l.remove(); } };
    }
    function lingkaran(peta, pos, radius, warna) {
        const c = L.circle([pos.lat, pos.lng], { radius, color: warna || '#059669', weight: 1.5, fillColor: warna || '#10b981', fillOpacity: 0.12 }).addTo(peta._p);
        return { set(p, r) { c.setLatLng([p.lat, p.lng]); c.setRadius(r); }, remove() { c.remove(); } };
    }

    async function nominatim(path) {
        let r; try { r = await fetch('https://nominatim.openstreetmap.org/' + path + '&format=jsonv2&accept-language=id', { headers: { Accept: 'application/json' } }); } catch (e) { throw new Error('Pencarian alamat gagal. Periksa koneksi internet.'); }
        if (!r.ok) throw new Error('Layanan pencarian alamat sedang sibuk. Coba lagi sebentar lagi atau klik langsung di peta.');
        return r.json();
    }
    async function cari(alamat) {
        const h = await nominatim('search?limit=1&countrycodes=id&viewbox=110.6,-7.4,111.0,-7.7&q=' + encodeURIComponent(alamat));
        if (!h.length) throw new Error('Alamat tidak ditemukan. Coba kata kunci lain atau klik langsung di peta.');
        return { lat: parseFloat(h[0].lat), lng: parseFloat(h[0].lon), alamat: h[0].display_name };
    }
    async function alamatDari(lat, lng) { try { const h = await nominatim('reverse?lat=' + lat + '&lon=' + lng); return h && h.display_name || ''; } catch (e) { return ''; } }
    const tautan = (lat, lng) => 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=17/' + lat + '/' + lng;
    function jarak(m) { return m == null ? '-' : m < 1000 ? m + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }

    window.KPPeta = { muat, buat, batas, titik, tanda, pin, garis, lingkaran, cari, alamatDari, tautan, jarak, PUSAT };
})();
