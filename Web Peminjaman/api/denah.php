<?php
/**
 * API Editor Denah.
 *   GET  api/denah.php                       -> semua lantai + elemen
 *   POST api/denah.php  {action: ...}        -> tambah_lantai | ubah_lantai |
 *                                               hapus_lantai | simpan_denah
 * Setiap respons sukses mengembalikan data terbaru (lantai + elemen).
 */
require __DIR__ . '/db.php';
require __DIR__ . '/sesi.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const TIPE_VALID = ['ruang'];
const STATUS_VALID = ['tersedia', 'dipakai', 'dipinjam'];   // hijau, merah, kuning
const LEBAR_KANVAS = 1000;
const TINGGI_KANVAS = 560;

function keluar($data, int $kode = 200): void
{
    http_response_code($kode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function teks($v, int $maks = 60): string
{
    $v = trim((string) $v);
    return function_exists('mb_substr') ? mb_substr($v, 0, $maks) : substr($v, 0, $maks);
}

function angka($v, int $min, int $maks, int $default = 0): int
{
    if (!is_numeric($v)) return $default;
    return max($min, min($maks, (int) round((float) $v)));
}

function ambil_semua(PDO $pdo): array
{
    $lantai = $pdo->query('SELECT id, nama, urutan FROM lantai ORDER BY urutan, id')->fetchAll();
    $elemen = $pdo->query('SELECT id, lantai_id, tipe, nama, x, y, w, h, kapasitas, kapasitas_meja, fasilitas, status FROM elemen ORDER BY id')->fetchAll();
    foreach ($lantai as &$l) { $l['id'] = (int) $l['id']; $l['urutan'] = (int) $l['urutan']; }
    foreach ($elemen as &$e) {
        foreach (['id', 'lantai_id', 'x', 'y', 'w', 'h', 'kapasitas', 'kapasitas_meja'] as $k) $e[$k] = (int) $e[$k];
    }
    return ['lantai' => $lantai, 'elemen' => $elemen];
}

function lantai_ada(PDO $pdo, int $id): bool
{
    $s = $pdo->prepare('SELECT 1 FROM lantai WHERE id = ?');
    $s->execute([$id]);
    return (bool) $s->fetchColumn();
}

try {
    $pdo = db();
    $saya = butuh_login();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') keluar(ambil_semua($pdo));
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') keluar(['error' => 'Metode tidak didukung.'], 405);
    if ($saya['peran'] !== 'admin') keluar(['error' => 'Hanya admin yang dapat mengubah denah ruang.'], 403);

    $in = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($in)) keluar(['error' => 'Data JSON tidak valid.'], 400);

    switch ($in['action'] ?? '') {
        case 'tambah_lantai':
            $urutan = (int) $pdo->query('SELECT COALESCE(MAX(urutan), 0) FROM lantai')->fetchColumn() + 1;
            $nama = teks($in['nama'] ?? '') ?: "Lantai $urutan";
            $pdo->prepare('INSERT INTO lantai (nama, urutan) VALUES (?, ?)')->execute([$nama, $urutan]);
            $baru = (int) $pdo->lastInsertId();
            keluar(ambil_semua($pdo) + ['lantai_baru' => $baru]);

        case 'ubah_lantai':
            $nama = teks($in['nama'] ?? '');
            if ($nama === '') keluar(['error' => 'Nama lantai tidak boleh kosong.'], 422);
            $pdo->prepare('UPDATE lantai SET nama = ? WHERE id = ?')->execute([$nama, (int) ($in['id'] ?? 0)]);
            keluar(ambil_semua($pdo));

        case 'hapus_lantai':
            $id = (int) ($in['id'] ?? 0);
            if ((int) $pdo->query('SELECT COUNT(*) FROM lantai')->fetchColumn() <= 1) {
                keluar(['error' => 'Minimal harus ada satu lantai.'], 422);
            }
            $pdo->beginTransaction();
            $pdo->prepare('DELETE FROM elemen WHERE lantai_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM lantai WHERE id = ?')->execute([$id]);
            $pdo->exec('DELETE FROM peminjaman WHERE elemen_id NOT IN (SELECT id FROM elemen)');
            $pdo->exec('DELETE FROM kuliah WHERE elemen_id NOT IN (SELECT id FROM elemen)');
            $pdo->commit();
            keluar(ambil_semua($pdo));

        case 'simpan_denah':
            $lantaiId = (int) ($in['lantai_id'] ?? 0);
            if (!lantai_ada($pdo, $lantaiId)) keluar(['error' => 'Lantai tidak ditemukan.'], 404);
            $daftar = is_array($in['elemen'] ?? null) ? $in['elemen'] : [];
            if (count($daftar) > 500) keluar(['error' => 'Terlalu banyak elemen (maks. 500).'], 422);

            // id ruang dipertahankan agar jadwal peminjamannya tidak putus saat denah disimpan.
            $milik = $pdo->prepare('SELECT id FROM elemen WHERE lantai_id = ?');
            $milik->execute([$lantaiId]);
            $milik = array_map('intval', $milik->fetchAll(PDO::FETCH_COLUMN));

            $pdo->beginTransaction();
            $pdo->prepare('DELETE FROM elemen WHERE lantai_id = ?')->execute([$lantaiId]);
            $ins = $pdo->prepare('INSERT INTO elemen (id, lantai_id, tipe, nama, x, y, w, h, kapasitas, kapasitas_meja, fasilitas, status)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $dipakai = [];
            foreach ($daftar as $e) {
                if (!is_array($e) || !in_array($e['tipe'] ?? '', TIPE_VALID, true)) continue;
                $w = angka($e['w'] ?? 0, 10, LEBAR_KANVAS, 100);
                $h = angka($e['h'] ?? 0, 10, TINGGI_KANVAS, 60);
                $id = isset($e['id']) && is_numeric($e['id']) ? (int) $e['id'] : 0;
                if ($id <= 0 || !in_array($id, $milik, true) || isset($dipakai[$id])) $id = null;
                if ($id !== null) $dipakai[$id] = true;
                $ins->execute([
                    $id, $lantaiId, $e['tipe'], teks($e['nama'] ?? ''),
                    angka($e['x'] ?? 0, 0, LEBAR_KANVAS - $w), angka($e['y'] ?? 0, 0, TINGGI_KANVAS - $h),
                    $w, $h, angka($e['kapasitas'] ?? 0, 0, 9999), angka($e['kapasitas_meja'] ?? 0, 0, 9999),
                    teks($e['fasilitas'] ?? '', 255),
                    in_array($e['status'] ?? '', STATUS_VALID, true) ? $e['status'] : 'tersedia',
                ]);
            }
            // jadwal milik ruang yang sudah dihapus ikut dibersihkan
            $pdo->exec('DELETE FROM peminjaman WHERE elemen_id NOT IN (SELECT id FROM elemen)');
            $pdo->exec('DELETE FROM kuliah WHERE elemen_id NOT IN (SELECT id FROM elemen)');
            $pdo->commit();
            keluar(ambil_semua($pdo));

        default:
            keluar(['error' => 'Aksi tidak dikenal.'], 400);
    }
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    keluar(['error' => 'Kesalahan server: ' . $e->getMessage()], 500);
}
