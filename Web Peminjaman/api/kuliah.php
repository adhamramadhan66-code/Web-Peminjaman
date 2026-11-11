<?php
/**
 * API Jadwal Kuliah (khusus admin). Daftar kuliah dibaca lewat api/jadwal.php?daftar=kuliah.
 *   POST api/kuliah.php {aksi: simpan, id?, elemen_id, hari (1-7), mulai, selesai, matkul, pengajar, kelas, prodi, paksa?}
 *   POST api/kuliah.php {aksi: hapus, id}
 *   POST api/kuliah.php {aksi: impor, uji?, baris: [...]}
 * Jadwal kuliah berlaku setiap minggu pada hari yang sama.
 */
require __DIR__ . '/db.php';
require __DIR__ . '/sesi.php';
require __DIR__ . '/jadwal_util.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function keluar($data, int $kode = 200): void
{
    http_response_code($kode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $pdo = db();
    butuh_admin();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') keluar(['error' => 'Metode tidak didukung.'], 405);

    $in = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($in)) keluar(['error' => 'Data JSON tidak valid.'], 400);

    switch ($in['aksi'] ?? '') {
        case 'simpan':
            $id = (int) ($in['id'] ?? 0);
            $lama = null;
            if ($id > 0) {
                $s = $pdo->prepare('SELECT * FROM kuliah WHERE id = ?');
                $s->execute([$id]);
                $lama = $s->fetch() ?: null;
                if (!$lama) keluar(['error' => 'Data tidak ditemukan (mungkin sudah dihapus).'], 404);
            }

            $ruang = (int) ($in['elemen_id'] ?? 0);
            $s = $pdo->prepare("SELECT 1 FROM elemen WHERE id = ? AND tipe = 'ruang'");
            $s->execute([$ruang]);
            if (!$s->fetchColumn()) keluar(['error' => 'Pilih ruang terlebih dahulu.'], 422);

            $hari = (int) ($in['hari'] ?? 0);
            if ($hari < 1 || $hari > 7) keluar(['error' => 'Pilih hari kuliah.'], 422);
            $mulai = (string) ($in['mulai'] ?? '');
            $selesai = (string) ($in['selesai'] ?? '');
            if (!jam_valid($mulai) || !jam_valid($selesai)) keluar(['error' => 'Isi jam mulai dan jam selesai dengan benar.'], 422);
            if ($selesai <= $mulai) keluar(['error' => 'Jam selesai harus lebih besar dari jam mulai.'], 422);

            $matkul = potong($in['matkul'] ?? '', 160);
            if ($matkul === '') keluar(['error' => 'Nama mata kuliah wajib diisi.'], 422);
            $pengajar = potong($in['pengajar'] ?? '', 160);
            $kelas = potong($in['kelas'] ?? '', 40);
            $prodi = potong($in['prodi'] ?? '', 120);

            // Bentrok dengan kuliah lain di ruang & hari yang sama: peringatan saja (admin boleh melanjutkan),
            // dan hanya diperiksa bila data baru atau ruang/hari/jamnya diubah.
            $berubah = !$lama || (int) $lama['elemen_id'] !== $ruang || (int) $lama['hari'] !== $hari
                || $lama['mulai'] !== $mulai || $lama['selesai'] !== $selesai;
            if ($berubah && empty($in['paksa'])) {
                $s = $pdo->prepare('SELECT mulai, selesai, matkul FROM kuliah WHERE elemen_id = ? AND hari = ? AND id <> ? AND mulai < ? AND selesai > ? LIMIT 1');
                $s->execute([$ruang, $hari, $id, $selesai, $mulai]);
                if ($r = $s->fetch()) {
                    keluar(['ok' => false, 'bentrok' => 'Bentrok dengan kuliah "' . $r['matkul'] . '" (' . $r['mulai'] . '-' . $r['selesai'] . ') di ruang dan hari yang sama.']);
                }
            }

            if ($lama) {
                $pdo->prepare('UPDATE kuliah SET elemen_id = ?, hari = ?, mulai = ?, selesai = ?, matkul = ?, pengajar = ?, kelas = ?, prodi = ? WHERE id = ?')
                    ->execute([$ruang, $hari, $mulai, $selesai, $matkul, $pengajar, $kelas, $prodi, $id]);
                keluar(['ok' => true, 'id' => $id]);
            }
            $pdo->prepare('INSERT INTO kuliah (elemen_id, hari, mulai, selesai, matkul, pengajar, kelas, prodi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$ruang, $hari, $mulai, $selesai, $matkul, $pengajar, $kelas, $prodi]);
            keluar(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);

        case 'hapus':
            $pdo->prepare('DELETE FROM kuliah WHERE id = ?')->execute([(int) ($in['id'] ?? 0)]);
            keluar(['ok' => true]);

        case 'impor':
            $baris = $in['baris'] ?? null;
            if (!is_array($baris) || !$baris) keluar(['error' => 'Tidak ada baris data untuk diimpor.'], 422);
            if (count($baris) > MAKS_IMPOR) keluar(['error' => 'Maksimal ' . MAKS_IMPOR . ' baris sekali impor. Pecah berkasnya.'], 422);
            keluar(impor_kuliah($pdo, $baris, !empty($in['uji'])));

        default:
            keluar(['error' => 'Aksi tidak dikenal.'], 400);
    }
} catch (Throwable $e) {
    keluar(['error' => $e->getMessage()], 500);
}
