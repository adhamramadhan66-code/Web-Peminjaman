<?php
/**
 * Koneksi database + pembuatan tabel otomatis + data awal.
 *
 * Bawaan: MySQL milik Laragon (user root, tanpa password). Database "kampusly"
 * dan semua tabel dibuat otomatis saat API pertama kali dibuka, lalu diisi dari
 * data/seed.json (hasil impor file Excel DAFTAR PEMAKAIAN RUANG KEGIATAN TSU).
 * Untuk SQLite ubah DB_DRIVER menjadi 'sqlite'.
 */
date_default_timezone_set('Asia/Jakarta');

const DB_DRIVER = 'mysql';          // 'mysql' (Laragon) atau 'sqlite'

const MYSQL_HOST = '127.0.0.1';
const MYSQL_PORT = 3306;
const MYSQL_NAME = 'kampusly';
const MYSQL_USER = 'root';
const MYSQL_PASS = '';

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ];

    if (DB_DRIVER === 'mysql') {
        try {
            $dsn = 'mysql:host=' . MYSQL_HOST . ';port=' . MYSQL_PORT . ';charset=utf8mb4';
            $pdo = new PDO($dsn, MYSQL_USER, MYSQL_PASS, $opts);
        } catch (PDOException $e) {
            throw new RuntimeException('Tidak dapat terhubung ke MySQL. Pastikan MySQL di Laragon sudah di-Start, '
                . 'lalu cek user/password di api/db.php. (' . $e->getMessage() . ')');
        }
        $pdo->exec('CREATE DATABASE IF NOT EXISTS `' . MYSQL_NAME . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        $pdo->exec('USE `' . MYSQL_NAME . '`');
    } else {
        $dir = __DIR__ . '/../data';
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $pdo = new PDO('sqlite:' . $dir . '/denah.sqlite', null, null, $opts);
    }

    buat_tabel($pdo);
    isi_data_awal($pdo);
    seed_akun($pdo);
    return $pdo;
}

function kolom_tabel(PDO $pdo, string $tabel): array
{
    $hasil = [];
    if (DB_DRIVER === 'mysql') {
        foreach ($pdo->query('SHOW COLUMNS FROM `' . $tabel . '`') as $k) $hasil[] = $k['Field'];
    } else {
        foreach ($pdo->query('PRAGMA table_info(' . $tabel . ')') as $k) $hasil[] = $k['name'];
    }
    return $hasil;
}

function buat_tabel(PDO $pdo): void
{
    $my  = DB_DRIVER === 'mysql';
    $ai  = $my ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $int = $my ? 'INT' : 'INTEGER';
    $eng = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';

    $pdo->exec("CREATE TABLE IF NOT EXISTS lantai (
        id $ai,
        nama VARCHAR(60) NOT NULL,
        urutan $int NOT NULL DEFAULT 0
    )$eng");

    $pdo->exec("CREATE TABLE IF NOT EXISTS elemen (
        id $ai,
        lantai_id $int NOT NULL,
        tipe VARCHAR(10) NOT NULL,
        nama VARCHAR(60) NOT NULL DEFAULT '',
        x $int NOT NULL DEFAULT 0,
        y $int NOT NULL DEFAULT 0,
        w $int NOT NULL DEFAULT 100,
        h $int NOT NULL DEFAULT 60,
        kapasitas $int NOT NULL DEFAULT 0,
        kapasitas_meja $int NOT NULL DEFAULT 0,
        fasilitas VARCHAR(255) NOT NULL DEFAULT '',
        status VARCHAR(10) NOT NULL DEFAULT 'tersedia'
        " . ($my ? ', INDEX (lantai_id)' : '') . "
    )$eng");

    // Peminjaman / kegiatan: satu baris = satu ruang pada satu tanggal.
    // status: menunggu | disetujui | ditolak
    $pdo->exec("CREATE TABLE IF NOT EXISTS peminjaman (
        id $ai,
        elemen_id $int NOT NULL,
        tanggal VARCHAR(10) NOT NULL,
        mulai CHAR(5) NOT NULL,
        selesai CHAR(5) NOT NULL,
        peminjam VARCHAR(80) NOT NULL,
        keperluan VARCHAR(160) NOT NULL DEFAULT '',
        peserta $int NOT NULL DEFAULT 0,
        fasilitas VARCHAR(255) NOT NULL DEFAULT '',
        status VARCHAR(12) NOT NULL DEFAULT 'disetujui',
        catatan VARCHAR(255) NOT NULL DEFAULT '',
        dibuat VARCHAR(19) NOT NULL DEFAULT ''
        " . ($my ? ', INDEX (tanggal), INDEX (elemen_id), INDEX (status)' : '') . "
    )$eng");

    // Jadwal kuliah mingguan (berulang): hari 1 = Senin ... 7 = Minggu.
    $pdo->exec("CREATE TABLE IF NOT EXISTS kuliah (
        id $ai,
        elemen_id $int NOT NULL,
        hari $int NOT NULL,
        mulai CHAR(5) NOT NULL,
        selesai CHAR(5) NOT NULL,
        matkul VARCHAR(160) NOT NULL,
        pengajar VARCHAR(160) NOT NULL DEFAULT '',
        kelas VARCHAR(40) NOT NULL DEFAULT '',
        prodi VARCHAR(120) NOT NULL DEFAULT ''
        " . ($my ? ', INDEX (elemen_id), INDEX (hari)' : '') . "
    )$eng");

    // Akun login. peran: admin | pengguna. Kata sandi disimpan sebagai hash (password_hash).
    $pdo->exec("CREATE TABLE IF NOT EXISTS pengguna (
        id $ai,
        nama VARCHAR(80) NOT NULL,
        email VARCHAR(120) NOT NULL,
        sandi VARCHAR(255) NOT NULL,
        peran VARCHAR(10) NOT NULL DEFAULT 'pengguna',
        dibuat VARCHAR(19) NOT NULL DEFAULT '',
        UNIQUE (email)
    )$eng");

    // Pesan (messenger). Satu percakapan = satu akun pengguna <-> tim admin, dikunci oleh pengguna_id.
    // dari: pengguna | admin. jenis: teks | otomatis (pesan sistem saat pengajuan peminjaman terkirim).
    // dibaca = 1 bila sudah dibuka oleh pihak penerima.
    // dihapus: 0 = ada, 1 = dihapus pengirim, 2 = dihapus admin (isi dikosongkan, barisnya tetap ada
    // sebagai keterangan "Pesan ini telah dihapus" supaya kedua pihak melihat perubahannya).
    $pdo->exec("CREATE TABLE IF NOT EXISTS pesan (
        id $ai,
        pengguna_id $int NOT NULL,
        dari VARCHAR(10) NOT NULL,
        admin_id $int NOT NULL DEFAULT 0,
        isi TEXT NOT NULL,
        jenis VARCHAR(10) NOT NULL DEFAULT 'teks',
        peminjaman_id $int NOT NULL DEFAULT 0,
        dibaca $int NOT NULL DEFAULT 0,
        dihapus $int NOT NULL DEFAULT 0,
        dibuat VARCHAR(19) NOT NULL DEFAULT ''
        " . ($my ? ', INDEX (pengguna_id, id), INDEX (dari, dibaca)' : '') . "
    )$eng");

    if (!$my) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_pesan_utas ON pesan (pengguna_id, id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_pesan_baca ON pesan (dari, dibaca)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_pinjam_tanggal ON peminjaman (tanggal)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_pinjam_ruang ON peminjaman (elemen_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_kuliah_ruang ON kuliah (elemen_id, hari)');
    }

    // Migrasi: database versi lama ditambah kolom baru bila belum ada.
    $k = kolom_tabel($pdo, 'elemen');
    if (!in_array('kapasitas_meja', $k, true)) $pdo->exec("ALTER TABLE elemen ADD COLUMN kapasitas_meja $int NOT NULL DEFAULT 0");
    if (!in_array('status', $k, true))         $pdo->exec("ALTER TABLE elemen ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'tersedia'");
    if (!in_array('fasilitas', $k, true))      $pdo->exec("ALTER TABLE elemen ADD COLUMN fasilitas VARCHAR(255) NOT NULL DEFAULT ''");

    $k = kolom_tabel($pdo, 'peminjaman');
    $baru = [
        'peserta'   => "$int NOT NULL DEFAULT 0",
        'fasilitas' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'status'    => "VARCHAR(12) NOT NULL DEFAULT 'disetujui'",
        'catatan'   => "VARCHAR(255) NOT NULL DEFAULT ''",
        'dibuat'    => "VARCHAR(19) NOT NULL DEFAULT ''",
        'pengguna_id' => "$int NOT NULL DEFAULT 0",   // akun yang mengajukan (0 = data impor / admin lama)
    ];
    foreach ($baru as $nama => $def) {
        if (!in_array($nama, $k, true)) $pdo->exec("ALTER TABLE peminjaman ADD COLUMN $nama $def");
    }

    $k = kolom_tabel($pdo, 'pesan');
    if (!in_array('dihapus', $k, true)) $pdo->exec("ALTER TABLE pesan ADD COLUMN dihapus $int NOT NULL DEFAULT 0");
}

/**
 * Data awal dari data/seed.json: lantai + ruang (denah awal), seluruh kegiatan
 * dari Excel, dan jadwal kuliah. Hanya dijalankan sekali, saat tabel lantai kosong.
 */
function seed_awal(PDO $pdo): void
{
    if ((int) $pdo->query('SELECT COUNT(*) FROM lantai')->fetchColumn() > 0) return;

    $file = __DIR__ . '/../data/seed.json';
    $seed = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    if (!is_array($seed)) {
        $seed = ['lantai' => ['Lantai 1'], 'kegiatan' => [], 'kuliah' => [],
                 'ruang' => [['nama' => 'Ruang Meeting', 'lantai' => 'Lantai 1', 'kapasitas' => 12, 'kapasitas_meja' => 4, 'fasilitas' => '']]];
    }

    $pdo->beginTransaction();
    try {
        $insL = $pdo->prepare('INSERT INTO lantai (nama, urutan) VALUES (?, ?)');
        $idLantai = [];
        foreach ($seed['lantai'] as $i => $nama) {
            $insL->execute([$nama, $i + 1]);
            $idLantai[$nama] = (int) $pdo->lastInsertId();
        }

        // Ruang disusun berkotak (4 kolom) per lantai agar x,y rapi.
        $insR = $pdo->prepare("INSERT INTO elemen (lantai_id, tipe, nama, x, y, w, h, kapasitas, kapasitas_meja, fasilitas)
                               VALUES (?, 'ruang', ?, ?, ?, 200, 110, ?, ?, ?)");
        $idRuang = [];
        $nomor = [];
        foreach ($seed['ruang'] as $r) {
            $lid = $idLantai[$r['lantai']] ?? reset($idLantai);
            $n = $nomor[$lid] ?? 0;
            $nomor[$lid] = $n + 1;
            $insR->execute([$lid, $r['nama'], 20 + ($n % 4) * 240, 20 + intdiv($n, 4) * 130,
                            (int) $r['kapasitas'], (int) $r['kapasitas_meja'], (string) $r['fasilitas']]);
            $idRuang[$r['nama']] = (int) $pdo->lastInsertId();
        }

        $sekarang = date('Y-m-d H:i:s');
        $insP = $pdo->prepare('INSERT INTO peminjaman (elemen_id, tanggal, mulai, selesai, peminjam, keperluan, peserta, fasilitas, status, catatan, dibuat)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($seed['kegiatan'] as $g) {
            if (!isset($idRuang[$g['ruang']])) continue;
            $insP->execute([$idRuang[$g['ruang']], $g['tanggal'], $g['mulai'], $g['selesai'],
                            mb_substr($g['peminjam'], 0, 80), mb_substr($g['keperluan'], 0, 160), (int) $g['peserta'],
                            mb_substr($g['fasilitas'], 0, 255), $g['status'], mb_substr($g['catatan'], 0, 255), $sekarang]);
        }

        $insK = $pdo->prepare('INSERT INTO kuliah (elemen_id, hari, mulai, selesai, matkul, pengajar, kelas, prodi)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($seed['kuliah'] as $k) {
            if (!isset($idRuang[$k['ruang']])) continue;
            $insK->execute([$idRuang[$k['ruang']], (int) $k['hari'], $k['mulai'], $k['selesai'],
                            mb_substr($k['matkul'], 0, 160), mb_substr($k['pengajar'], 0, 160), mb_substr($k['kelas'], 0, 40), mb_substr($k['prodi'], 0, 120)]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/**
 * Akun awal (hanya saat tabel pengguna masih kosong): 1 admin + 1 akun pengguna contoh.
 * Segera ganti kata sandi bawaan sebelum dipakai sungguhan.
 */
function seed_akun(PDO $pdo): void
{
    if ((int) $pdo->query('SELECT COUNT(*) FROM pengguna')->fetchColumn() > 0) return;
    $abaikan = DB_DRIVER === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
    $s = $pdo->prepare("$abaikan INTO pengguna (nama, email, sandi, peran, dibuat) VALUES (?, ?, ?, ?, ?)");
    $sekarang = date('Y-m-d H:i:s');
    $s->execute(['Admin TSU', 'admin@tsu.ac.id', password_hash('tsu12345', PASSWORD_DEFAULT), 'admin', $sekarang]);
    $s->execute(['Mahasiswa Demo', 'mahasiswa@tsu.ac.id', password_hash('tsu12345', PASSWORD_DEFAULT), 'pengguna', $sekarang]);
}

function baca_seed(): ?array
{
    $file = __DIR__ . '/../data/seed.json';
    $seed = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    return is_array($seed) ? $seed : null;
}

/** Lantai bawaan seed yang namanya muncul lebih dari sekali (akibat impor ganda). */
function nama_lantai_ganda(PDO $pdo): array
{
    $seed = baca_seed();
    if (!$seed || empty($seed['lantai'])) return [];
    $ganda = [];
    foreach ($pdo->query('SELECT nama FROM lantai GROUP BY nama HAVING COUNT(*) > 1')->fetchAll(PDO::FETCH_COLUMN) as $n) {
        if (in_array($n, $seed['lantai'], true)) $ganda[] = $n;
    }
    return $ganda;
}

/**
 * Merapikan database yang terlanjur terisi ganda: lantai & ruang bernama sama digabung ke yang
 * pertama, jadwal dipindahkan, lalu baris jadwal yang identik dihapus.
 */
function perbaiki_duplikat(PDO $pdo, array $namaGanda): void
{
    $pdo->beginTransaction();
    try {
        foreach ($namaGanda as $nama) {
            $s = $pdo->prepare('SELECT id FROM lantai WHERE nama = ? ORDER BY id');
            $s->execute([$nama]);
            $ids = array_map('intval', $s->fetchAll(PDO::FETCH_COLUMN));
            $simpan = array_shift($ids);
            foreach ($ids as $dup) {
                $r = $pdo->prepare('SELECT id, nama FROM elemen WHERE lantai_id = ? ORDER BY id');
                $r->execute([$dup]);
                foreach ($r->fetchAll() as $e) {
                    $c = $pdo->prepare('SELECT id FROM elemen WHERE lantai_id = ? AND nama = ? ORDER BY id LIMIT 1');
                    $c->execute([$simpan, $e['nama']]);
                    $tujuan = $c->fetchColumn();
                    if ($tujuan) {
                        $pdo->prepare('UPDATE peminjaman SET elemen_id = ? WHERE elemen_id = ?')->execute([(int) $tujuan, (int) $e['id']]);
                        $pdo->prepare('UPDATE kuliah SET elemen_id = ? WHERE elemen_id = ?')->execute([(int) $tujuan, (int) $e['id']]);
                        $pdo->prepare('DELETE FROM elemen WHERE id = ?')->execute([(int) $e['id']]);
                    } else {
                        $pdo->prepare('UPDATE elemen SET lantai_id = ? WHERE id = ?')->execute([$simpan, (int) $e['id']]);
                    }
                }
                $pdo->prepare('DELETE FROM lantai WHERE id = ?')->execute([$dup]);
            }
        }
        $pdo->exec('DELETE FROM peminjaman WHERE id NOT IN (SELECT id FROM (
                        SELECT MIN(id) AS id FROM peminjaman GROUP BY elemen_id, tanggal, mulai, selesai, peminjam, keperluan, status) t)');
        $pdo->exec('DELETE FROM kuliah WHERE id NOT IN (SELECT id FROM (
                        SELECT MIN(id) AS id FROM kuliah GROUP BY elemen_id, hari, mulai, selesai, matkul, kelas) t)');
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/**
 * Pintu masuk: isi data awal sekali saja. Pada MySQL dipakai GET_LOCK supaya beberapa
 * permintaan yang datang bersamaan (dashboard memanggil beberapa API sekaligus) tidak
 * mengisi data berkali-kali.
 */
function isi_data_awal(PDO $pdo): void
{
    $kosong = (int) $pdo->query('SELECT COUNT(*) FROM lantai')->fetchColumn() === 0;
    if (!$kosong && !nama_lantai_ganda($pdo)) return;   // jalur cepat: tidak ada yang perlu dilakukan

    $kunci = false;
    if (DB_DRIVER === 'mysql') $kunci = (int) $pdo->query("SELECT GET_LOCK('kampusly_seed', 60)")->fetchColumn() === 1;
    try {
        // Cek ulang setelah mendapat kunci: permintaan lain mungkin sudah selesai lebih dulu.
        if ((int) $pdo->query('SELECT COUNT(*) FROM lantai')->fetchColumn() === 0) {
            seed_awal($pdo);
        } elseif ($ganda = nama_lantai_ganda($pdo)) {
            perbaiki_duplikat($pdo, $ganda);
        }
    } finally {
        if ($kunci) $pdo->query("SELECT RELEASE_LOCK('kampusly_seed')")->fetchAll();
    }
}
