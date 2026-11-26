/* Pembantu Google Maps: memuat pustaka sekali, lalu membuat peta, penanda, pencarian alamat, dan alamat dari titik.
   API key diisi di peta-config.js. Memakai Maps JavaScript API + Geocoding API (tanpa Places). */
(function () {
    'use strict';
    const PUSAT = { lat: -7.5666, lng: 110.8167 };   // pusat Kota Surakarta (hanya tampilan awal peta)
    let janji = null;

    function muat() {
        if (window.google && google.maps) return Promise.resolve(google.maps);
        if (!window.PETA_KUNCI) return Promise.reject(new Error('API key Google Maps belum diisi. Buka berkas peta-config.js lalu isi PETA_KUNCI.'));
        if (!janji) {
            janji = new Promise((ok, gagal) => {
                window.__petaSiap = () => ok(google.maps);
                const s = document.createElement('script');
                s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(window.PETA_KUNCI) + '&callback=__petaSiap&language=id&region=ID&v=weekly';
                s.async = true; s.onerror = () => { janji = null; gagal(new Error('Google Maps tidak dapat dimuat. Periksa koneksi internet dan API key.')); };
                window.gm_authFailure = () => { janji = null; gagal(new Error('API key Google Maps ditolak. Periksa key, penagihan, dan pembatasan domain.')); };
                document.head.appendChild(s);
            });
        }
        return janji;
    }

    /** Peta baru di elemen $el. Mengembalikan google.maps.Map. */
    async function buat($el, opsi) {
        const gm = await muat();
        return new gm.Map($el, Object.assign({ center: PUSAT, zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy' }, opsi || {}));
    }

    /** Penanda bulat berwarna dengan huruf/kode di tengahnya. */
    function titik(peta, pos, o) {
        const gm = google.maps;
        return new gm.Marker({
            map: peta, position: pos, title: o.judul || '', zIndex: o.z || 1,
            label: o.label ? { text: o.label, color: '#fff', fontSize: '11px', fontWeight: '700' } : undefined,
            icon: { path: gm.SymbolPath.CIRCLE, scale: o.skala || 15, fillColor: o.warna || '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2.5 },
        });
    }
    /** Penanda tujuan berbentuk pin. */
    function pin(peta, pos, o) {
        return new google.maps.Marker({ map: peta, position: pos, title: (o && o.judul) || '', zIndex: 2, icon: { path: 'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z', fillColor: (o && o.warna) || '#dc2626', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5, scale: 1.1 } });
    }

    function cari(alamat) {
        return muat().then((gm) => new Promise((ok, gagal) => {
            new gm.Geocoder().geocode({ address: alamat, region: 'ID', componentRestrictions: { country: 'ID' } }, (hasil, status) => {
                if (status === 'OK' && hasil[0]) { const l = hasil[0].geometry.location; ok({ lat: l.lat(), lng: l.lng(), alamat: hasil[0].formatted_address }); }
                else gagal(new Error(status === 'ZERO_RESULTS' ? 'Alamat tidak ditemukan. Coba kata kunci lain atau klik langsung di peta.' : 'Pencarian alamat gagal (' + status + ').'));
            });
        }));
    }
    function alamatDari(lat, lng) {
        return muat().then((gm) => new Promise((ok) => {
            new gm.Geocoder().geocode({ location: { lat, lng } }, (hasil, status) => ok(status === 'OK' && hasil[0] ? hasil[0].formatted_address : ''));
        }));
    }
    const tautan = (lat, lng) => 'https://www.google.com/maps?q=' + lat + ',' + lng;
    function jarak(m) { return m == null ? '-' : m < 1000 ? m + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }

    window.KPPeta = { muat, buat, titik, pin, cari, alamatDari, tautan, jarak, PUSAT };
})();
