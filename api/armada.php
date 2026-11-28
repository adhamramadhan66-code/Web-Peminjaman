<?php
/**
 * API Armada (mobil dinas) - khusus admin.
 *   GET  api/armada.php?ringkas=1                                   -> 4 armada + status sekarang + pemakaian berikutnya
 *   GET  api/armada.php?daftar=1&status=&waktu=&armada=&q=&halaman=&semua=1
 *   POST api/armada.php {aksi: simpan, id?, armada_id, tanggal, tanggal_akhir?, mulai, selesai?, tujuan, peserta?, sopir?, fasilitas?, pemohon?, status?, tgl_pesan?, paksa?}
 *   POST api/armada.php {aksi: setujui|tolak|hapus, id, alasan?}   (tolak: alasan wajib)
 *   POST api/armada.php {aksi: hapus_semua}
 *   GET  api/armada.php?pantau=1 | ?jejak=ID     -> perjalanan berjalan (posisi GPS terakhir) / jejak rute
 *   POST api/armada.php {aksi: kampus, lat, lng, radius?} | {aksi: paksa_selesai, id, alasan?}
 *   POST api/armada.php {aksi: impor, uji?, baris: [...]}
 *   GET  api/armada.php?lokasi=1 -> titik kampus + lokasi tujuan tersimpan
 *   POST api/armada.php {aksi: simpan_lokasi, id?, nama, alamat?, lat, lng} | {aksi: hapus_lokasi, id}   (kampus: {aksi: kampus, nama?, lat, lng, radius?})
 * Aturan bentrok: satu armada tidak boleh dipakai dua kegiatan yang DISETUJUI pada waktu yang beririsan.
 * Selesai kosong berarti "sampai selesai" (dianggap berakhir 23:59 pada tanggal akhir).
 * Pemakaian boleh lebih dari satu hari (tanggal s.d. tanggal_akhir), dipakai terus-menerus.
 */
require __DIR__ . '/db.php';
require __DIR__ . '/sesi.php';
require __DIR__ . '/armada_util.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const PER_HALAMAN_ARMADA = 20;

function keluar($data, int $kode = 200): void
{
    http_response_code($kode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $pdo = db();
    $admin = butuh_admin();
    $sekarang = new DateTime();
    $hariIni = $sekarang->format('Y-m-d');

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $armada = $pdo->query('SELECT id, kode, nama, keterangan FROM armada ORDER BY urutan, id')->fetchAll();
        foreach ($armada as &$a) $a['id'] = (int) $a['id'];
        unset($a);

        if (isset($_GET['ringkas'])) {
            $nowS = $sekarang->format('Y-m-d H:i');
            foreach ($armada as &$a) {
                $s = $pdo->prepare("SELECT * FROM pemakaian_armada WHERE armada_id = ? AND status = 'disetujui' AND tanggal_akhir >= ? ORDER BY tanggal, mulai, id");
                $s->execute([$a['id'], $hariIni]);
                $a['sekarang'] = null; $a['berikut'] = null;
                foreach ($s->fetchAll() as $r) {
                    [$s1, $e1] = ujung($r);
                    if ($s1 <= $nowS && $nowS < $e1 && !$a['sekarang']) $a['sekarang'] = rapikan_keluar($r);
                    elseif ($s1 > $nowS && !$a['berikut']) $a['berikut'] = rapikan_keluar($r);
                }
                $s = $pdo->prepare("SELECT COUNT(*) FROM pemakaian_armada WHERE armada_id = ? AND status = 'disetujui' AND tanggal >= ? AND tanggal <= ?");
                $s->execute([$a['id'], date('Y-m-01'), date('Y-m-t')]);
                $a['bulan_ini'] = (int) $s->fetchColumn();
                $a['total'] = ['semua' => 0, 'menunggu' => 0, 'disetujui' => 0, 'ditolak' => 0];
                $s = $pdo->prepare('SELECT status, COUNT(*) AS n FROM pemakaian_armada WHERE armada_id = ? GROUP BY status');
                $s->execute([$a['id']]);
                foreach ($s->fetchAll() as $t) { if (isset($a['total'][$t['status']])) $a['total'][$t['status']] = (int) $t['n']; $a['total']['semua'] += (int) $t['n']; }
            }
            unset($a);
            $menunggu = (int) $pdo->query("SELECT COUNT(*) FROM pemakaian_armada WHERE status = 'menunggu'")->fetchColumn();
            keluar(['armada' => $armada, 'menunggu' => $menunggu]);
        }

        if (isset($_GET['lokasi'])) keluar(['kampus' => ambil_kampus($pdo), 'lokasi' => daftar_lokasi($pdo)]);

        if (isset($_GET['pantau'])) {
            // Perjalanan yang sedang berjalan + yang disetujui untuk hari ini tetapi belum berangkat.
            $kampus = ambil_kampus($pdo);
            $s = $pdo->prepare("SELECT p.*, a.kode AS armada_kode, a.nama AS armada_nama FROM pemakaian_armada p JOIN armada a ON a.id = p.armada_id
                WHERE p.status = 'disetujui' AND (p.perjalanan = 'jalan' OR (p.perjalanan = 'belum' AND p.tanggal <= ? AND p.tanggal_akhir >= ?)
                    OR (p.perjalanan = 'selesai' AND p.tiba >= ?))
                ORDER BY CASE p.perjalanan WHEN 'jalan' THEN 0 WHEN 'belum' THEN 1 ELSE 2 END, p.tanggal, p.mulai, p.id");
            $s->execute([$hariIni, $hariIni, $hariIni . ' 00:00:00']);
            keluar(['kampus' => $kampus, 'sekarang' => $sekarang->format('Y-m-d H:i:s'), 'data' => array_map(fn ($r) => info_perjalanan($r, $kampus), $s->fetchAll())]);
        }
        if (isset($_GET['jejak'])) {
            $s = $pdo->prepare('SELECT lat, lng, waktu FROM jejak_armada WHERE pemakaian_id = ? ORDER BY id DESC LIMIT 300');
            $s->execute([(int) $_GET['jejak']]);
            $t = array_reverse($s->fetchAll());
            foreach ($t as &$x) { $x['lat'] = (float) $x['lat']; $x['lng'] = (float) $x['lng']; }
            keluar(['titik' => $t]);
        }

        // daftar pemakaian
        $where = ['1 = 1']; $par = [];
        $waktu = $_GET['waktu'] ?? 'mendatang';
        if ($waktu === 'mendatang') { $where[] = 'p.tanggal_akhir >= ?'; $par[] = $hariIni; }
        elseif ($waktu === 'riwayat') { $where[] = 'p.tanggal_akhir < ?'; $par[] = $hariIni; }
        $aid = (int) ($_GET['armada'] ?? 0);
        if ($aid > 0) { $where[] = 'p.armada_id = ?'; $par[] = $aid; }
        $q = potong($_GET['q'] ?? '', 60);
        if ($q !== '') {
            $like = '%' . str_replace(['%', '_'], ' ', $q) . '%';
            $where[] = '(p.tujuan LIKE ? OR p.pemohon LIKE ? OR a.kode LIKE ?)';
            array_push($par, $like, $like, $like);
        }
        $dasar = 'FROM pemakaian_armada p JOIN armada a ON a.id = p.armada_id WHERE ' . implode(' AND ', $where);
        $hitung = ['semua' => 0, 'menunggu' => 0, 'disetujui' => 0, 'ditolak' => 0];
        $s = $pdo->prepare('SELECT p.status, COUNT(*) AS n ' . $dasar . ' GROUP BY p.status');
        $s->execute($par);
        foreach ($s->fetchAll() as $r) { if (isset($hitung[$r['status']])) $hitung[$r['status']] = (int) $r['n']; $hitung['semua'] += (int) $r['n']; }
        $status = $_GET['status'] ?? 'semua';
        if (in_array($status, STATUS_ARMADA, true)) { $dasar .= ' AND p.status = ?'; $par[] = $status; }
        $total = $status === 'semua' ? $hitung['semua'] : $hitung[$status];
        $semua = !empty($_GET['semua']);
        $halaman = max(1, (int) ($_GET['halaman'] ?? 1));
        $arah = $waktu === 'mendatang' ? 'ASC' : 'DESC';
        $sql = "SELECT p.*, a.kode AS armada_kode, a.nama AS armada_nama $dasar
                ORDER BY CASE WHEN p.status = 'menunggu' THEN 0 ELSE 1 END, p.tanggal $arah, p.mulai $arah, p.id $arah"
             . ($semua ? '' : ' LIMIT ' . PER_HALAMAN_ARMADA . ' OFFSET ' . (($halaman - 1) * PER_HALAMAN_ARMADA));
        $s = $pdo->prepare($sql);
        $s->execute($par);
        $data = array_map('rapikan_keluar', $s->fetchAll());
        keluar(['total' => $total, 'halaman' => $halaman, 'per' => PER_HALAMAN_ARMADA, 'hitung' => $hitung, 'armada' => $armada, 'data' => $data]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') keluar(['error' => 'Metode tidak didukung.'], 405);
    $in = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($in)) keluar(['error' => 'Data JSON tidak valid.'], 400);
    $dibuat = $sekarang->format('Y-m-d H:i:s');

    switch ($in['aksi'] ?? '') {
        case 'simpan':
            $id = (int) ($in['id'] ?? 0);
            if ($id > 0 && !baris_armada($pdo, $id)) keluar(['error' => 'Data tidak ditemukan (mungkin sudah dihapus).'], 404);
            $aid = (int) ($in['armada_id'] ?? 0);
            $s = $pdo->prepare('SELECT 1 FROM armada WHERE id = ?'); $s->execute([$aid]);
            if (!$s->fetchColumn()) keluar(['error' => 'Pilih armada terlebih dahulu.'], 422);
            [$d, $err] = rapikan($in);
            if ($err) keluar(['error' => $err], 422);
            if ($d['status'] === 'disetujui' && ($bentrok = cek_bentrok($pdo, $aid, $d, $id))) keluar(['error' => $bentrok, 'bentrok' => true], 409);
            if ($id > 0) {
                $pdo->prepare('UPDATE pemakaian_armada SET armada_id=?, tgl_pesan=?, tanggal=?, tanggal_akhir=?, mulai=?, selesai=?, tujuan=?, peserta=?, sopir=?, fasilitas=?, pemohon=?, status=?, catatan=? WHERE id=?')
                    ->execute([$aid, $d['tgl_pesan'], $d['tanggal'], $d['tanggal_akhir'], $d['mulai'], $d['selesai'], $d['tujuan'], $d['peserta'], $d['sopir'], $d['fasilitas'], $d['pemohon'], $d['status'], $d['catatan'], $id]);
            } else {
                if ($d['tgl_pesan'] === '') $d['tgl_pesan'] = $hariIni;
                $pdo->prepare('INSERT INTO pemakaian_armada (armada_id, tgl_pesan, tanggal, tanggal_akhir, mulai, selesai, tujuan, peserta, sopir, fasilitas, pemohon, status, catatan, dibuat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    ->execute([$aid, $d['tgl_pesan'], $d['tanggal'], $d['tanggal_akhir'], $d['mulai'], $d['selesai'], $d['tujuan'], $d['peserta'], $d['sopir'], $d['fasilitas'], $d['pemohon'], $d['status'], $d['catatan'], $dibuat]);
                $id = (int) $pdo->lastInsertId();
            }
            keluar(['ok' => true, 'id' => $id]);

        case 'setujui':
            $r = baris_armada($pdo, (int) ($in['id'] ?? 0));
            if (!$r) keluar(['error' => 'Data tidak ditemukan.'], 404);
            if ($bentrok = cek_bentrok($pdo, (int) $r['armada_id'], $r, (int) $r['id'])) keluar(['error' => $bentrok . ' Tolak atau ubah salah satunya dahulu.', 'bentrok' => true], 409);
            $pdo->prepare("UPDATE pemakaian_armada SET status = 'disetujui', catatan = '' WHERE id = ?")->execute([$r['id']]);
            if ($r['status'] !== 'disetujui') pesan_armada_otomatis($pdo, 'ke_pemohon', $r, 'Pengajuan mobil dinas disetujui', '', (int) $admin['id']);
            keluar(['ok' => true]);

        case 'tolak':
            $r = baris_armada($pdo, (int) ($in['id'] ?? 0));
            if (!$r) keluar(['error' => 'Data tidak ditemukan.'], 404);
            $alasan = potong($in['alasan'] ?? '', 255);
            if ($alasan === '') keluar(['error' => 'Alasan penolakan wajib diisi.'], 422);
            $pdo->prepare("UPDATE pemakaian_armada SET status = 'ditolak', catatan = ? WHERE id = ?")->execute([$alasan, $r['id']]);
            pesan_armada_otomatis($pdo, 'ke_pemohon', $r, $r['status'] === 'disetujui' ? 'Pemakaian mobil dinas dibatalkan oleh admin' : 'Pengajuan mobil dinas ditolak', $alasan, (int) $admin['id']);
            keluar(['ok' => true]);

        case 'kampus':      // titik kampus: tujuan akhir "sudah tiba" bagi pemohon
            if ($err = simpan_kampus($pdo, $in)) keluar(['error' => $err], 422);
            keluar(['ok' => true, 'kampus' => ambil_kampus($pdo)]);

        case 'simpan_lokasi':
            $nama = potong($in['nama'] ?? '', 80);
            if ($nama === '') keluar(['error' => 'Nama lokasi wajib diisi.'], 422);
            if (!koordinat_valid($in['lat'] ?? null, $in['lng'] ?? null)) keluar(['error' => 'Tentukan titik lokasi di peta.'], 422);
            $alamat = potong($in['alamat'] ?? '', 255);
            $id = (int) ($in['id'] ?? 0);
            if ($id > 0) {
                $s = $pdo->prepare('SELECT 1 FROM lokasi_armada WHERE id = ?'); $s->execute([$id]);
                if (!$s->fetchColumn()) keluar(['error' => 'Lokasi tidak ditemukan (mungkin sudah dihapus).'], 404);
                $pdo->prepare('UPDATE lokasi_armada SET nama = ?, alamat = ?, lat = ?, lng = ? WHERE id = ?')->execute([$nama, $alamat, (float) $in['lat'], (float) $in['lng'], $id]);
            } else {
                $s = $pdo->prepare('SELECT COUNT(*) FROM lokasi_armada WHERE nama = ?'); $s->execute([$nama]);
                if ((int) $s->fetchColumn() > 0) keluar(['error' => 'Sudah ada lokasi bernama "' . $nama . '". Pakai nama lain atau ubah yang lama.'], 409);
                $pdo->prepare('INSERT INTO lokasi_armada (nama, alamat, lat, lng, dibuat) VALUES (?,?,?,?,?)')->execute([$nama, $alamat, (float) $in['lat'], (float) $in['lng'], $dibuat]);
                $id = (int) $pdo->lastInsertId();
            }
            keluar(['ok' => true, 'id' => $id, 'lokasi' => daftar_lokasi($pdo)]);

        case 'hapus_lokasi':
            $pdo->prepare('DELETE FROM lokasi_armada WHERE id = ?')->execute([(int) ($in['id'] ?? 0)]);
            keluar(['ok' => true, 'lokasi' => daftar_lokasi($pdo)]);

        case 'paksa_selesai':   // HP pemohon mati / GPS terputus: admin menutup perjalanan secara manual
            $r = baris_armada($pdo, (int) ($in['id'] ?? 0));
            if (!$r) keluar(['error' => 'Data tidak ditemukan.'], 404);
            $pdo->prepare("UPDATE pemakaian_armada SET perjalanan = 'selesai', tiba = ?, catatan = ? WHERE id = ?")
                ->execute([$dibuat, 'Ditutup admin ' . $sekarang->format('d/m H:i') . (potong($in['alasan'] ?? '', 120) ? ': ' . potong($in['alasan'], 120) : ''), $r['id']]);
            keluar(['ok' => true]);

        case 'hapus':
            $pdo->prepare('DELETE FROM jejak_armada WHERE pemakaian_id = ?')->execute([(int) ($in['id'] ?? 0)]);
            $pdo->prepare('DELETE FROM pemakaian_armada WHERE id = ?')->execute([(int) ($in['id'] ?? 0)]);
            keluar(['ok' => true]);

        case 'hapus_semua':
            $pdo->exec('DELETE FROM jejak_armada');
            $n = $pdo->exec('DELETE FROM pemakaian_armada');
            keluar(['ok' => true, 'dihapus' => (int) $n]);

        case 'impor':
            $baris = $in['baris'] ?? null;
            if (!is_array($baris) || !$baris) keluar(['error' => 'Tidak ada baris untuk diimpor.'], 422);
            if (count($baris) > MAKS_IMPOR) keluar(['error' => 'Maksimal ' . MAKS_IMPOR . ' baris sekali impor. Pecah berkasnya.'], 422);
            $uji = !empty($in['uji']);
            $hasil = hasil_impor_kosong(count($baris), $uji);
            $peta = [];
            foreach ($pdo->query('SELECT id, kode FROM armada') as $a) $peta[mb_strtoupper($a['kode'])] = (int) $a['id'];
            $cek = $pdo->prepare('SELECT 1 FROM pemakaian_armada WHERE armada_id = ? AND tanggal = ? AND tanggal_akhir = ? AND mulai = ? AND LOWER(tujuan) = LOWER(?) LIMIT 1');
            $ins = $pdo->prepare('INSERT INTO pemakaian_armada (armada_id, tgl_pesan, tanggal, tanggal_akhir, mulai, selesai, tujuan, peserta, sopir, fasilitas, pemohon, status, catatan, dibuat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
            $sudah = [];
            if (!$uji) $pdo->beginTransaction();
            try {
                foreach (array_values($baris) as $i => $b) {
                    $no = is_array($b) ? (int) ($b['baris'] ?? ($i + 2)) : $i + 2;
                    $gagal = function (string $alasan) use (&$hasil, $no): void {
                        $hasil['gagal']++;
                        if (count($hasil['rincian_gagal']) < 100) $hasil['rincian_gagal'][] = ['baris' => $no, 'alasan' => $alasan];
                    };
                    if (!is_array($b)) { $gagal('Format baris tidak valid.'); continue; }
                    $aid = $peta[mb_strtoupper(potong($b['armada'] ?? '', 10))] ?? 0;
                    if (!$aid) { $gagal('Armada "' . potong($b['armada'] ?? '', 20) . '" tidak dikenal (WR1, WR2, WR3, APV).'); continue; }
                    [$d, $err] = rapikan($b);
                    if ($err) { $gagal($err); continue; }
                    $kunci = $aid . '|' . $d['tanggal'] . '|' . $d['tanggal_akhir'] . '|' . $d['mulai'] . '|' . mb_strtolower($d['tujuan']);
                    $cek->execute([$aid, $d['tanggal'], $d['tanggal_akhir'], $d['mulai'], $d['tujuan']]);
                    if (isset($sudah[$kunci]) || $cek->fetchColumn()) { $hasil['duplikat']++; continue; }
                    $sudah[$kunci] = true;
                    $hasil['tambah']++;
                    if (!$uji) $ins->execute([$aid, $d['tgl_pesan'], $d['tanggal'], $d['tanggal_akhir'], $d['mulai'], $d['selesai'], $d['tujuan'], $d['peserta'], $d['sopir'], $d['fasilitas'], $d['pemohon'], $d['status'], $d['catatan'], $dibuat]);
                }
                if (!$uji) $pdo->commit();
            } catch (Throwable $e) { if (!$uji && $pdo->inTransaction()) $pdo->rollBack(); throw $e; }
            keluar($hasil);

        default:
            keluar(['error' => 'Aksi tidak dikenal.'], 400);
    }
} catch (Throwable $e) {
    keluar(['error' => 'Terjadi kesalahan server: ' . $e->getMessage()], 500);
}
