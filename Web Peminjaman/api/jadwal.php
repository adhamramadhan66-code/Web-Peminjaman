<?php
/**
 * API Jadwal Ruang (dashboard + halaman Jadwal).
 *   GET api/jadwal.php?tanggal=YYYY-MM-DD
 *   -> { tanggal, hari, lantai: [ { id, nama, ruang: [ { id, nama, kapasitas, ...,
 *          jadwal:   [ {id, jenis, mulai, selesai, peminjam, keperluan, ...} ],   // kuliah + kegiatan disetujui
 *          menunggu: [ {id, jenis, mulai, selesai, peminjam, keperluan, ...} ] } ] } ] }
 * jenis: "kuliah" (jadwal mingguan) atau "kegiatan" (peminjaman yang sudah disetujui).
 */
require __DIR__ . '/db.php';
require __DIR__ . '/sesi.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function keluar($data, int $kode = 200): void
{
    http_response_code($kode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    butuh_login();   // jadwal hanya untuk akun yang sudah masuk
    // Daftar seluruh jadwal kuliah (untuk tabel + pencarian): ?daftar=kuliah&q=&hari=0-7&halaman=1
    if (($_GET['daftar'] ?? '') === 'kuliah') {
        $pdo = db();
        $where = ['1 = 1'];
        $par = [];
        $h = (int) ($_GET['hari'] ?? 0);
        if ($h >= 1 && $h <= 7) { $where[] = 'k.hari = ?'; $par[] = $h; }
        $q = trim(preg_replace('/\s+/u', ' ', (string) ($_GET['q'] ?? '')));
        if ($q !== '') {
            $like = '%' . str_replace(['%', '_'], ' ', mb_substr($q, 0, 60)) . '%';
            $where[] = '(k.matkul LIKE ? OR k.pengajar LIKE ? OR k.kelas LIKE ? OR k.prodi LIKE ? OR e.nama LIKE ?)';
            array_push($par, $like, $like, $like, $like, $like);
        }
        $dasar = 'FROM kuliah k JOIN elemen e ON e.id = k.elemen_id JOIN lantai l ON l.id = e.lantai_id WHERE ' . implode(' AND ', $where);
        $s = $pdo->prepare('SELECT COUNT(*) ' . $dasar);
        $s->execute($par);
        $total = (int) $s->fetchColumn();
        $per = 25;
        $halaman = max(1, (int) ($_GET['halaman'] ?? 1));
        $s = $pdo->prepare('SELECT k.id, k.elemen_id AS ruang_id, e.nama AS ruang, l.nama AS lantai, k.hari, k.mulai, k.selesai, k.matkul, k.pengajar, k.kelas, k.prodi '
            . $dasar . ' ORDER BY k.hari, k.mulai, e.nama, k.id LIMIT ' . $per . ' OFFSET ' . (($halaman - 1) * $per));
        $s->execute($par);
        $data = $s->fetchAll();
        foreach ($data as &$r) { $r['id'] = (int) $r['id']; $r['ruang_id'] = (int) $r['ruang_id']; $r['hari'] = (int) $r['hari']; }
        unset($r);
        keluar(['total' => $total, 'halaman' => $halaman, 'per' => $per, 'data' => $data]);
    }

    $tanggal = $_GET['tanggal'] ?? date('Y-m-d');
    $d = DateTime::createFromFormat('Y-m-d', (string) $tanggal);
    if (!$d || $d->format('Y-m-d') !== $tanggal) keluar(['error' => 'Format tanggal harus YYYY-MM-DD.'], 422);
    $hari = (int) $d->format('N');   // 1 = Senin ... 7 = Minggu

    $pdo = db();
    $lantai = $pdo->query('SELECT id, nama FROM lantai ORDER BY urutan, id')->fetchAll();
    $ruang  = $pdo->query("SELECT id, lantai_id, nama, kapasitas, kapasitas_meja, fasilitas, status FROM elemen WHERE tipe = 'ruang' ORDER BY y, x, id")->fetchAll();

    $jadwal = [];
    $menunggu = [];

    $s = $pdo->prepare("SELECT id, elemen_id, mulai, selesai, peminjam, keperluan, peserta, fasilitas, status, catatan, pengguna_id
                        FROM peminjaman WHERE tanggal = ? AND status IN ('disetujui', 'menunggu') ORDER BY mulai, selesai, id");
    $s->execute([$tanggal]);
    foreach ($s->fetchAll() as $j) {
        $item = [
            'id' => (int) $j['id'], 'jenis' => 'kegiatan', 'status' => $j['status'],
            'mulai' => $j['mulai'], 'selesai' => $j['selesai'],
            'peminjam' => $j['peminjam'], 'keperluan' => $j['keperluan'],
            'peserta' => (int) $j['peserta'], 'fasilitas' => $j['fasilitas'], 'catatan' => $j['catatan'],
            'akun' => (int) $j['pengguna_id'] > 0,
        ];
        if ($j['status'] === 'menunggu') $menunggu[(int) $j['elemen_id']][] = $item;
        else $jadwal[(int) $j['elemen_id']][] = $item;
    }

    $s = $pdo->prepare('SELECT id, elemen_id, mulai, selesai, matkul, pengajar, kelas, prodi
                        FROM kuliah WHERE hari = ? ORDER BY mulai, selesai, id');
    $s->execute([$hari]);
    foreach ($s->fetchAll() as $k) {
        $jadwal[(int) $k['elemen_id']][] = [
            'id' => (int) $k['id'], 'jenis' => 'kuliah', 'status' => 'disetujui',
            'mulai' => $k['mulai'], 'selesai' => $k['selesai'],
            'peminjam' => $k['pengajar'], 'keperluan' => $k['matkul'],
            'kelas' => $k['kelas'], 'prodi' => $k['prodi'],
        ];
    }
    foreach ($jadwal as &$daftar) {
        usort($daftar, fn ($a, $b) => strcmp($a['mulai'] . $a['selesai'], $b['mulai'] . $b['selesai']));
    }
    unset($daftar);

    $hasil = [];
    foreach ($lantai as $l) {
        $item = ['id' => (int) $l['id'], 'nama' => $l['nama'], 'ruang' => []];
        foreach ($ruang as $r) {
            if ((int) $r['lantai_id'] !== $item['id']) continue;
            $item['ruang'][] = [
                'id' => (int) $r['id'], 'nama' => $r['nama'], 'kapasitas' => (int) $r['kapasitas'],
                'kapasitas_meja' => (int) $r['kapasitas_meja'], 'fasilitas' => $r['fasilitas'], 'status' => $r['status'],
                'jadwal' => $jadwal[(int) $r['id']] ?? [],
                'menunggu' => $menunggu[(int) $r['id']] ?? [],
            ];
        }
        $hasil[] = $item;
    }
    keluar(['tanggal' => $tanggal, 'hari' => $hari, 'lantai' => $hasil]);
} catch (Throwable $e) {
    keluar(['error' => $e->getMessage()], 500);
}
