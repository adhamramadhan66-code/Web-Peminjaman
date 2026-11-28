<?php
/**
 * API pemohon mobil dinas (peran "pemohon"; admin juga boleh untuk uji coba).
 *   GET  api/armada_pemohon.php?armada=1   -> 4 armada + status sekarang + jadwal terisi (tanpa data pribadi)
 *   GET  api/armada_pemohon.php?saya=1     -> pengajuan & perjalanan milik akun ini
 *   POST {aksi: ajukan, armada_id, tanggal, tanggal_akhir?, mulai, selesai?, tujuan, tujuan_alamat, tujuan_lat, tujuan_lng, peserta?, sopir?, fasilitas?}
 *   POST {aksi: batalkan, id}                  (hanya pengajuan yang masih menunggu)
 *   POST {aksi: mulai, id, lat, lng}           (berangkat: wajib GPS aktif, hanya pemakaian yang sudah disetujui)
 *   POST {aksi: lokasi, id, lat, lng, akurasi} (kiriman GPS berkala selama perjalanan)
 *   POST {aksi: selesai, id, lat, lng}         (tiba kembali di kampus; server memeriksa jarak ke titik kampus)
 */
require __DIR__ . '/db.php';
require __DIR__ . '/sesi.php';
require __DIR__ . '/armada_util.php';

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
    $saya = butuh_login();
    if (!in_array($saya['peran'], ['pemohon', 'admin'], true)) keluar(['error' => 'Akun ini tidak memiliki akses pemohon mobil dinas.'], 403);
    $sekarang = new DateTime();
    $hariIni = $sekarang->format('Y-m-d');
    $kampus = ambil_kampus($pdo);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if (isset($_GET['armada'])) {
            $armada = $pdo->query('SELECT id, kode, nama, keterangan FROM armada ORDER BY urutan, id')->fetchAll();
            $nowS = $sekarang->format('Y-m-d H:i');
            foreach ($armada as &$a) {
                $a['id'] = (int) $a['id'];
                $s = $pdo->prepare("SELECT tanggal, tanggal_akhir, mulai, selesai, perjalanan FROM pemakaian_armada WHERE armada_id = ? AND status = 'disetujui' AND tanggal_akhir >= ? ORDER BY tanggal, mulai LIMIT 8");
                $s->execute([$a['id'], $hariIni]);
                $a['terisi'] = $s->fetchAll(); $a['dipakai'] = false;
                foreach ($a['terisi'] as $t) { [$s1, $e1] = ujung($t); if ($t['perjalanan'] === 'jalan' || ($s1 <= $nowS && $nowS < $e1)) $a['dipakai'] = true; }
            }
            keluar(['armada' => $armada, 'kampus' => $kampus, 'lokasi' => daftar_lokasi($pdo)]);
        }
        if (isset($_GET['saya'])) {
            $s = $pdo->prepare('SELECT p.*, a.kode AS armada_kode, a.nama AS armada_nama FROM pemakaian_armada p JOIN armada a ON a.id = p.armada_id
                WHERE p.pengguna_id = ? ORDER BY CASE p.perjalanan WHEN \'jalan\' THEN 0 ELSE 1 END, p.tanggal DESC, p.mulai DESC, p.id DESC LIMIT 100');
            $s->execute([$saya['id']]);
            keluar(['kampus' => $kampus, 'data' => array_map(fn ($r) => info_perjalanan($r, $kampus), $s->fetchAll())]);
        }
        keluar(['error' => 'Permintaan tidak dikenal.'], 400);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') keluar(['error' => 'Metode tidak didukung.'], 405);
    $in = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($in)) keluar(['error' => 'Data JSON tidak valid.'], 400);
    $dibuat = $sekarang->format('Y-m-d H:i:s');

    $milik = function () use ($pdo, $in, $saya): array {
        $r = baris_armada($pdo, (int) ($in['id'] ?? 0));
        if (!$r || (int) $r['pengguna_id'] !== (int) $saya['id']) keluar(['error' => 'Data tidak ditemukan.'], 404);
        return $r;
    };

    switch ($in['aksi'] ?? '') {
        case 'ajukan':
            $aid = (int) ($in['armada_id'] ?? 0);
            $s = $pdo->prepare('SELECT 1 FROM armada WHERE id = ?'); $s->execute([$aid]);
            if (!$s->fetchColumn()) keluar(['error' => 'Pilih mobil terlebih dahulu.'], 422);
            [$d, $err] = rapikan(array_merge($in, ['status' => 'menunggu', 'pemohon' => $saya['nama']]));
            if ($err) keluar(['error' => $err], 422);
            if ($d['tanggal'] < $hariIni) keluar(['error' => 'Tanggal pemakaian tidak boleh sebelum hari ini.'], 422);
            if (!koordinat_valid($in['tujuan_lat'] ?? null, $in['tujuan_lng'] ?? null)) keluar(['error' => 'Tentukan tujuan di peta terlebih dahulu.'], 422);
            if ($bentrok = cek_bentrok($pdo, $aid, $d)) keluar(['error' => $bentrok . ' Pilih waktu atau mobil lain.', 'bentrok' => true], 409);
            $pdo->prepare('INSERT INTO pemakaian_armada (armada_id, tgl_pesan, tanggal, tanggal_akhir, mulai, selesai, tujuan, peserta, sopir, fasilitas, pemohon, status, catatan, dibuat, pengguna_id, tujuan_alamat, tujuan_lat, tujuan_lng)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$aid, $hariIni, $d['tanggal'], $d['tanggal_akhir'], $d['mulai'], $d['selesai'], $d['tujuan'], $d['peserta'], $d['sopir'], $d['fasilitas'], $saya['nama'], 'menunggu', '', $dibuat,
                    $saya['id'], potong($in['tujuan_alamat'] ?? '', 255), (float) $in['tujuan_lat'], (float) $in['tujuan_lng']]);
            $idBaru = (int) $pdo->lastInsertId();
            pesan_armada_otomatis($pdo, 'ke_admin', ['pengguna_id' => $saya['id'], 'armada_id' => $aid, 'tanggal' => $d['tanggal'], 'tanggal_akhir' => $d['tanggal_akhir'], 'mulai' => $d['mulai'], 'selesai' => (string) $d['selesai'], 'tujuan' => $d['tujuan']], 'Pengajuan mobil dinas baru');
            keluar(['ok' => true, 'id' => $idBaru]);

        case 'batalkan':
            $r = $milik();
            if ($r['status'] !== 'menunggu') keluar(['error' => 'Hanya pengajuan yang masih menunggu yang bisa dibatalkan.'], 409);
            $pdo->prepare('DELETE FROM pemakaian_armada WHERE id = ?')->execute([$r['id']]);
            keluar(['ok' => true]);

        case 'mulai':
            $r = $milik();
            if ($r['status'] !== 'disetujui') keluar(['error' => 'Pengajuan ini belum disetujui admin.'], 409);
            if ($r['perjalanan'] !== 'belum') keluar(['error' => 'Perjalanan ini sudah dimulai atau selesai.'], 409);
            if ($hariIni < $r['tanggal'] || $hariIni > $r['tanggal_akhir']) keluar(['error' => 'Perjalanan hanya bisa dimulai pada tanggal pemakaian (' . $r['tanggal'] . ').'], 409);
            if (!koordinat_valid($in['lat'] ?? null, $in['lng'] ?? null)) keluar(['error' => 'GPS belum aktif. Aktifkan GPS dan izinkan akses lokasi untuk berangkat.'], 422);
            $s = $pdo->prepare("SELECT 1 FROM pemakaian_armada WHERE armada_id = ? AND perjalanan = 'jalan' AND id <> ?");
            $s->execute([$r['armada_id'], $r['id']]);
            if ($s->fetchColumn()) keluar(['error' => 'Mobil ini masih dalam perjalanan pemakaian lain.'], 409);
            $pdo->prepare("UPDATE pemakaian_armada SET perjalanan = 'jalan', berangkat = ?, pos_lat = ?, pos_lng = ?, pos_akurasi = ?, pos_waktu = ? WHERE id = ?")
                ->execute([$dibuat, (float) $in['lat'], (float) $in['lng'], (int) ($in['akurasi'] ?? 0), $dibuat, $r['id']]);
            $pdo->prepare('INSERT INTO jejak_armada (pemakaian_id, lat, lng, akurasi, waktu) VALUES (?,?,?,?,?)')->execute([$r['id'], (float) $in['lat'], (float) $in['lng'], (int) ($in['akurasi'] ?? 0), $dibuat]);
            keluar(['ok' => true]);

        case 'lokasi':
            $r = $milik();
            if ($r['perjalanan'] !== 'jalan') keluar(['error' => 'Perjalanan tidak sedang berjalan.', 'berhenti' => true], 409);
            if (!koordinat_valid($in['lat'] ?? null, $in['lng'] ?? null)) keluar(['error' => 'Koordinat GPS tidak valid.'], 422);
            $lat = (float) $in['lat']; $lng = (float) $in['lng']; $ak = max(0, min(99999, (int) ($in['akurasi'] ?? 0)));
            $lama = $r['pos_waktu'] !== '' ? time() - strtotime($r['pos_waktu']) : 999;
            $pdo->prepare('UPDATE pemakaian_armada SET pos_lat = ?, pos_lng = ?, pos_akurasi = ?, pos_waktu = ? WHERE id = ?')->execute([$lat, $lng, $ak, $dibuat, $r['id']]);
            if ($lama >= 8) $pdo->prepare('INSERT INTO jejak_armada (pemakaian_id, lat, lng, akurasi, waktu) VALUES (?,?,?,?,?)')->execute([$r['id'], $lat, $lng, $ak, $dibuat]);
            $jk = $kampus ? (int) round(jarak_meter($lat, $lng, $kampus['lat'], $kampus['lng'])) : null;
            keluar(['ok' => true, 'jarak_kampus' => $jk, 'di_kampus' => $kampus ? $jk <= $kampus['radius'] : null]);

        case 'selesai':
            $r = $milik();
            if ($r['perjalanan'] !== 'jalan') keluar(['error' => 'Perjalanan tidak sedang berjalan.'], 409);
            if (!koordinat_valid($in['lat'] ?? null, $in['lng'] ?? null)) keluar(['error' => 'GPS belum aktif. Nyalakan GPS untuk menyelesaikan perjalanan.'], 422);
            if ($kampus) {
                $jk = (int) round(jarak_meter((float) $in['lat'], (float) $in['lng'], $kampus['lat'], $kampus['lng']));
                if ($jk > $kampus['radius']) keluar(['error' => 'Anda belum tiba di kampus (masih ' . $jk . ' m dari titik kampus, batas ' . $kampus['radius'] . ' m). GPS harus tetap menyala sampai tiba.'], 409);
            }
            $pdo->prepare("UPDATE pemakaian_armada SET perjalanan = 'selesai', tiba = ?, pos_lat = ?, pos_lng = ?, pos_waktu = ? WHERE id = ?")->execute([$dibuat, (float) $in['lat'], (float) $in['lng'], $dibuat, $r['id']]);
            $pdo->prepare('INSERT INTO jejak_armada (pemakaian_id, lat, lng, akurasi, waktu) VALUES (?,?,?,?,?)')->execute([$r['id'], (float) $in['lat'], (float) $in['lng'], (int) ($in['akurasi'] ?? 0), $dibuat]);
            keluar(['ok' => true]);

        default:
            keluar(['error' => 'Aksi tidak dikenal.'], 400);
    }
} catch (Throwable $e) {
    keluar(['error' => 'Terjadi kesalahan server: ' . $e->getMessage()], 500);
}
