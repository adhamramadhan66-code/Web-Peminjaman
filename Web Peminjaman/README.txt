KAMPUSLY - TSU (LOGIN + DASHBOARD + JADWAL + PEMINJAMAN RUANG)
================================================================

AKUN DEMO (dibuat otomatis saat pertama kali dibuka)
Admin       : admin@tsu.ac.id      / tsu12345
Pengguna    : mahasiswa@tsu.ac.id  / tsu12345
Akun pengguna baru bisa dibuat sendiri lewat tombol "Daftar" di halaman login (peran: pengguna).
Menjadikan seseorang admin: di phpMyAdmin buka database "kampusly" > tabel "pengguna", ubah kolom
"peran" dari pengguna menjadi admin. Ganti kata sandi demo sebelum dipakai sungguhan.

CARA MENJALANKAN DENGAN LARAGON
1. Ekstrak ZIP ke  C:\laragon\www\peminjaman  (disarankan tanpa spasi pada nama folder).
2. Buka Laragon -> klik "Start All" (Apache + MySQL harus hijau).
3. Buka  http://localhost/peminjaman/  (atau http://peminjaman.test/ bila auto virtual host aktif).
4. Login dengan akun demo. Database "kampusly" + semua tabel dibuat OTOMATIS pada
   akses pertama dan langsung terisi dari data/seed.json (hasil impor file Excel
   DAFTAR PEMAKAIAN RUANG KEGIATAN TSU). Tidak perlu import SQL manual.
Dengan XAMPP: jalankan Apache + MySQL, taruh folder proyek di htdocs, buka http://localhost/<nama-folder>/.
Alternatif: jalankan.bat (server bawaan PHP di http://127.0.0.1:8000/), MySQL Laragon tetap harus menyala.
Kredensial MySQL ada di api/db.php (bawaan Laragon: root, tanpa password).
Ingin SQLite? Ubah DB_DRIVER menjadi 'sqlite' di api/db.php.
Ingin mengulang dari data Excel? Di phpMyAdmin hapus database "kampusly", lalu buka ulang web.

MENU
- Dashboard    : angka ringkas, kartu "Ruang Hari Ini" per lantai, agenda tanggal terpilih.
- Jadwal Ruang : timeline jam 07:00-22:00 per lantai, urutan ruang sama dengan Editor Ruang.
                 Biru = kuliah (mingguan), ungu = kegiatan disetujui, kuning bergaris = menunggu.
                 Klik blok untuk detail; klik area kosong untuk mengajukan ruang di jam itu.
                 "Daftar jadwal" di bawah timeline (tab Kegiatan & peminjaman / Jadwal kuliah): admin dapat
                 Tambah data, Ubah (ikon pensil), Hapus (ikon tempat sampah), Impor Excel, dan unduh Template.
- Peminjaman   : daftar pengajuan (filter status/periode/cari) + form "Ajukan ruang".
                 Admin dapat Setujui / Tolak / Hapus. Pengajuan yang bentrok dengan kegiatan
                 disetujui atau jadwal kuliah ditolak otomatis oleh sistem.
                 Setujui/Tolak/Hapus hanya untuk admin. Akun pengguna hanya bisa mengajukan dan memantau.
                 Tolak / Batalkan WAJIB disertai alasan: tombol ✗ membuka dialog alasan (ada pilihan alasan cepat),
                 untuk pengajuan menunggu = "ditolak", untuk yang sudah disetujui = "dibatalkan". Alasan otomatis
                 dikirim ke pemohon sebagai kartu merah di menu Pesan (Ruang, Tanggal, Jam, Keperluan, Alasan, dan
                 tombol "Ajukan ulang") dan tampil di daftar peminjaman ("Alasan: ..."). Pemohon dari data impor
                 Excel (tanpa akun) tidak dikirimi pesan; alasannya hanya dicatat. Pesan tidak terkirim dua kali
                 bila baris yang sudah ditolak diubah alasannya.
                 Form "Ajukan ruang": jam Mulai & Selesai kosong di awal dan selalu bisa diisi. Ruang tetap
                 tampil; setelah kedua jam diisi, daftar menyaring ruang yang kosong pada jam itu.
- Pesan        : messenger antara admin dan akun pengguna (menu di sidebar kiri, ada lencana jumlah pesan
                 belum dibaca). Admin melihat semua akun pengguna dan bisa membalas siapa pun; pengguna
                 hanya punya satu percakapan, yaitu dengan admin. Setiap pengajuan peminjaman dari akun
                 pengguna otomatis mengirim kartu pesan (ruang, tanggal, jam, keperluan) ke admin.
                 Pesan diperbarui otomatis tiap beberapa detik (polling), bukan realtime penuh.
                 Hapus pesan: ketuk/klik pesannya (diberi bingkai merah), lalu tombol kirim berubah menjadi
                 tombol hapus merah; tekan untuk menghapus. Ketuk lagi / Escape / klik kotak ketik = batal.
                 Pengguna hanya bisa menghapus
                 pesannya sendiri; admin bisa menghapus pesan siapa pun. Pesan yang dihapus berubah menjadi
                 keterangan "Pesan ini telah dihapus" (isinya dikosongkan di database) bagi kedua pihak.
- Editor Ruang : tambah/ubah lantai dan ruang. Jadwal mengikuti ruang yang ada di sini.

TAMPILAN HP & PC (ui.css + ui.js, dimuat paling akhir di semua halaman dalam)
- HP: tabel (Peminjaman, Daftar jadwal, Agenda dashboard) tampil sebagai kartu per baris; kartu ruang dua kolom;
  tab lantai bisa digeser; huruf isian 16px (iOS tidak memperbesar halaman); tombol minimal 40px; menu samping bisa
  dibuka dengan geser dari tepi kiri dan ditutup dengan geser ke kiri; jendela detail muncul sebagai lembar dari bawah.
- Perbaikan bug: halaman Peminjaman tidak lagi melebar melewati layar HP; tombol "Ajukan ruang" tanpa garis bawah;
  tinggi kartu "Ruang Hari Ini" mengikuti slide yang tampil (tidak ada ruang kosong).
- Gerak: logo dan menu sidebar masuk bergantian (hanya kunjungan pertama sesi); halaman, kartu ringkasan (efek miring-pop),
  baris tabel (dari kiri), kartu ruang dan gelembung chat memantul masuk; garis aksen tumbuh di bawah judul halaman; latar
  berisi dua cahaya yang melayang pelan; angka ringkasan dashboard menghitung naik; tombol utama berkilau saat disorot dan
  semua tombol/menu memberi riak saat diklik; kartu ringkasan dan kartu ruang miring mengikuti kursor (PC); kartu di bawah
  layar muncul saat di-scroll; toast memantul dengan garis waktu; jendela muncul dengan efek pantul; pindah menu bertransisi
  (sidebar tetap diam, isi bergeser; Chrome/Edge 126+ dan Safari 18.2+); tema terang/gelap bertransisi; lencana pesan dan
  titik "tersinkronisasi" berdenyut halus.
- Sakelar "Animasi" ada di menu foto profil (klik foto kanan atas): Penuh / Hemat. Bawaannya mengikuti pengaturan perangkat:
  bila Windows/HP-mu mematikan efek animasi ("kurangi gerakan"), halaman otomatis hemat sampai kamu memilih Penuh sendiri.
  Pilihan tersimpan di browser (localStorage "ui-animasi").
- Mengubah/mematikan efek: semuanya ada di ui.css. Hapus tag <link ... ui.css> dan <script ... ui.js> di halaman untuk
  mengembalikan tampilan lama.

FOTO PROFIL (semua akun)
- Klik foto di kanan atas: menu Edit Foto, Tambah Foto, Kamera (dan Hapus Foto bila sudah punya foto sendiri).
  Tambah Foto = pilih gambar dari perangkat; Edit Foto = atur ulang foto tersimpan; Kamera = ambil foto langsung.
  Di editor: geser foto, penggeser zoom (juga roda mouse), tombol putar kiri/kanan, lalu Simpan foto.
- Foto disimpan di server per akun (tabel pengguna, kolom foto & foto_v; JPEG 512x512, maksimal 400 KB) dan
  dilayani api/foto.php, jadi ikut ke perangkat mana pun. Tanpa foto sendiri, foto bawaan halaman dipakai.
- Kamera langsung memerlukan https atau http://localhost (aturan browser) dan izin kamera dari pengguna.
  Di alamat lain (mis. http://192.168.x.x) tombol Kamera memakai aplikasi kamera bawaan HP lewat input berkas.
- Database lama otomatis ditambah kolom foto & foto_v saat web dibuka pertama kali.

KELOLA DAFTAR JADWAL & IMPOR EXCEL (khusus admin)
- Tambah / Ubah: tombol "Tambah data" membuka form sesuai tab aktif. Tanggal lampau boleh (mencatat kegiatan
  yang sudah terjadi). Bila ruang & jamnya bentrok dengan jadwal lain, muncul peringatan dan admin boleh
  tetap menyimpan (data asli TSU memang banyak yang bentrok). Peringatan hanya muncul untuk data baru atau
  bila ruang/tanggal/jam/status diubah.
- Hapus: ikon tempat sampah di ujung baris (ada konfirmasi). Jadwal kuliah yang dihapus hilang untuk setiap minggu.
- Impor Excel: klik "Impor Excel", pilih berkas .xlsx / .xls / .csv. Judul kolom dikenali otomatis dan urutan
  kolom bebas (judul/keterangan di atas tabel boleh ada). Muncul PRATINJAU dulu (jumlah baris baru, sudah ada,
  dan bermasalah beserta nomor barisnya); data baru masuk setelah menekan "Tambahkan N data".
    Kegiatan  : Tanggal, Kegiatan, Ruang (wajib); Jam Mulai/Jam Selesai atau satu kolom Waktu ("07:00 - 14:00"),
                Pemohon, Peserta, Fasilitas, Status (disetujui/menunggu/ditolak), Catatan, Sampai Tanggal.
    Kuliah    : Hari, Jam Mulai, Jam Selesai, Mata Kuliah, Ruang (wajib); Pengajar, Kelas, Program Studi.
  Tanggal boleh berformat tanggal Excel, 2026-10-24, 24/10/2026 (hari/bulan/tahun) atau "24 Oktober 2026";
  rentang ("8-10 Oktober 2025", kolom Sampai Tanggal) dijadikan satu data per hari (maksimal 120 hari).
  Jam kosong = 08:00-16:00, hanya jam mulai = selesai 3 jam kemudian (dicatat di kolom catatan).
- Nama ruang harus sama dengan Editor Ruang (huruf besar/kecil & spasi tidak masalah: "lab 1" = "Lab 1").
  Ruang yang belum ada dilaporkan di pratinjau; tambahkan di Editor Ruang lalu impor berkas yang sama lagi.
- Baris yang sama persis dengan data yang sudah ada dilewati, jadi berkas yang sama aman diimpor berulang.
  Bentrok TIDAK menghalangi impor. Berkas berisi jenis lain (mis. jadwal kuliah saat tab Kegiatan aktif)
  otomatis memindahkan tab. Maksimal 5000 baris sekali impor.
- Pembaca Excel (SheetJS) dimuat dari cdn.sheetjs.com saat tombol impor/template dipakai, jadi perlu internet.
  Untuk offline, simpan https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js sebagai
  vendor/xlsx.full.min.js (dicoba lebih dulu daripada CDN).

CATATAN DATA IMPOR EXCEL (mohon dicek)
- Denah awal dikelompokkan dari kode ruang: Gedung C Lantai 1-4 (C1.x - C4.x), Laboratorium
  (Lab 1-8, Lab On Air, Lab Fesyen), Area Umum (Ruang Meeting, Selasar, Studio DPT, dst).
  Ini ASUMSI; ubah nama/lantai/kapasitas di Editor Ruang. Kapasitas awal hanya perkiraan.
- Jam "Selesai" / kosong di Excel: selesai = mulai + 3 jam; jam kosong = 08:00-16:00
  (tercatat di kolom catatan). Rentang tanggal dijadikan satu baris per hari.
- Jadwal kuliah (sheet JADWAL KULIAH 25.1, Gasal 2025/2026) diberlakukan berulang tiap minggu
  tanpa batas tanggal. Ganti dengan jadwal semester berjalan bila sudah ada.
- Baris Excel yang dilewati karena ruang/tanggal tidak terbaca: 10 baris (ruang kosong, "C2",
  "C3", "lab", "TSSO", "R kaprodi psikologi", "yayasan harapan rabbani", tanggal "#VALUE!").

CATATAN KEAMANAN
- Login kini diperiksa di server (PHP session + password_hash) dan semua API wajib login. Aksi admin
  (setujui/tolak/hapus, ubah denah, langsung menyetujui) ditolak server untuk akun pengguna.
- Pengguna hanya bisa membaca percakapannya sendiri; percakapan akun lain tidak bisa dibuka lewat API.
- Belum ada: lupa/ubah kata sandi, verifikasi email, pembatasan domain email saat daftar, HTTPS.
  Pasang HTTPS dan ganti kata sandi demo sebelum dipublikasikan ke internet.
- Akun pengguna biasa saat ini masih bisa melihat seluruh daftar pengajuan (sama seperti sebelumnya).
- Database lama otomatis ditambah tabel "pengguna", tabel "pesan", dan kolom "pengguna_id" pada
  "peminjaman" saat web dibuka pertama kali; data yang sudah ada tidak berubah.
