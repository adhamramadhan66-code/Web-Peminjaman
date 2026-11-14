<?php
/**
 * API Peminjaman Ruang.
 *   GET  api/peminjaman.php?status=semua|menunggu|disetujui|ditolak&waktu=mendatang|riwayat|semua
 *                          &q=kata&halaman=1        -> daftar + jumlah per status
 *   GET  api/peminjaman.php?ringkas=1               -> angka ringkasan dashboard
 *   POST api/peminjaman.php {aksi: ajukan|setujui|tolak|hapus, ...}
 *   POST api/peminjaman.php {aksi: tolak, id, alasan}   (admin: tolak / batalkan; ALASAN WAJIB, dikirim ke pemohon lewat Pesan)
 *   POST api/peminjaman.php {aksi: simpan, id?, elemen_id, tanggal, mulai, selesai, keperluan, ...}  (admin: tambah/ubah)
 *   POST api/peminjaman.php {aksi: impor, uji?, baris: [...]}                                        (admin: impor Excel)
 *   POST api/peminjaman.php {aksi: hapus_semua}                                                      (admin: hapus SELURUH data peminjaman)
 * Pengajuan baru berstatus "menunggu" sampai admin menyetujui (atau "langsung": true).
 * Pengajuan yang bentrok dengan kegiatan disetujui / jadwal kuliah ditolak sistem.
 * Wajib login. Setujui / tolak / hapus dan opsi "langsung" hanya untuk admin.
 * Pengajuan dari akun pengguna otomatis mengirim pesan ke admin (lihat api/chat_util.php).
 */
require __DIR__ . '/db.php';
require __DIR__ . '/sesi.php';
require __DIR__ . '/chat_util.php';
require __DIR__ . '/jadwal_util.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const STATUS_PINJAM = ['menunggu', 'disetujui', 'ditolak'];
const PER_HALAMAN = 20;

function keluar($data, int $kode = 200): void
{
    http_response_code($kode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Mengembalikan pesan bila bentrok dengan kegiatan disetujui atau jadwal kuliah, selain itu null. */
function cari_bentrok(PDO $pdo, int $ruang, string $tanggal, string $mulai, string $selesai, int $kecuali = 0): ?string
{
    $s = $pdo->prepare("SELECT mulai, selesai, keperluan FROM peminjaman
                        WHERE elemen_id = ? AND tanggal = ? AND status = 'disetujui' AND id <> ? AND mulai < ? AND selesai > ? LIMIT 1");
    $s->execute([$ruang, $tanggal, $kecuali, $selesai, $mulai]);
    if ($r = $s->fetch()) return 'Bentrok dengan kegiatan "' . $r['keperluan'] . '" (' . $r['mulai'] . '-' . $r['selesai'] . ').';

    $hari = (int) (new DateTime($tanggal))->format('N');
    $s = $pdo->prepare('SELECT mulai, selesai, matkul FROM kuliah WHERE elemen_id = ? AND hari = ? AND mulai < ? AND selesai > ? LIMIT 1');
    $s->execute([$ruang, $hari, $selesai, $mulai]);
    if ($r = $s->fetch()) return 'Bentrok dengan jadwal kuliah "' . $r['matkul'] . '" (' . $r['mulai'] . '-' . $r['selesai'] . ').';
    return null;
}

function ambil_baris(PDO $pdo, int $id): ?array
{
    $s = $pdo->prepare('SELECT * FROM peminjaman WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    return $r ?: null;
}

try {
    $pdo = db();
    $saya = butuh_login();

    // ---------- GET ----------
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $hariIni = date('Y-m-d');

        if (isset($_GET['ringkas'])) {
            $ambil = function (string $sql, array $p = []) use ($pdo) {
                $s = $pdo->prepare($sql);
                $s->execute($p);
                return (int) $s->fetchColumn();
            };
            $awalBulan = date('Y-m-01');
            $akhirBulan = date('Y-m-t');
            $terbaru = $pdo->query("SELECT p.id, p.tanggal, p.mulai, p.selesai, p.peminjam, p.keperluan, e.nama AS ruang
                                    FROM peminjaman p JOIN elemen e ON e.id = p.elemen_id
                                    WHERE p.status = 'menunggu' ORDER BY p.tanggal, p.mulai, p.id LIMIT 5")->fetchAll();
            foreach ($terbaru as &$t) $t['id'] = (int) $t['id'];
            keluar([
                'menunggu'      => $ambil("SELECT COUNT(*) FROM peminjaman WHERE status = 'menunggu'"),
                'kegiatan_hari' => $ambil("SELECT COUNT(*) FROM peminjaman WHERE status = 'disetujui' AND tanggal = ?", [$hariIni]),
                'kegiatan_bulan' => $ambil("SELECT COUNT(*) FROM peminjaman WHERE status = 'disetujui' AND tanggal >= ? AND tanggal <= ?", [$awalBulan, $akhirBulan]),
                'menunggu_terbaru' => $terbaru,
            ]);
        }

        $where = ['1 = 1'];
        $par = [];
        // Akun pengguna/mahasiswa hanya boleh melihat pengajuannya sendiri; admin melihat semuanya.
        // (Ringkasan dashboard di atas dan jadwal per tanggal tetap menampilkan seluruh kegiatan.)
        if ($saya['peran'] !== 'admin') { $where[] = 'p.pengguna_id = ?'; $par[] = (int) $saya['id']; }
        $waktu = $_GET['waktu'] ?? 'mendatang';
        if ($waktu === 'mendatang') { $where[] = 'p.tanggal >= ?'; $par[] = $hariIni; }
        elseif ($waktu === 'riwayat') { $where[] = 'p.tanggal < ?'; $par[] = $hariIni; }
        $q = potong($_GET['q'] ?? '', 60);
        if ($q !== '') {
            $like = '%' . str_replace(['%', '_'], ' ', $q) . '%';
            $where[] = '(p.keperluan LIKE ? OR p.peminjam LIKE ? OR e.nama LIKE ?)';
            array_push($par, $like, $like, $like);
        }
        $dasar = 'FROM peminjaman p JOIN elemen e ON e.id = p.elemen_id JOIN lantai l ON l.id = e.lantai_id WHERE ' . implode(' AND ', $where);

        $hitung = ['semua' => 0, 'menunggu' => 0, 'disetujui' => 0, 'ditolak' => 0];
        $s = $pdo->prepare('SELECT p.status, COUNT(*) AS n ' . $dasar . ' GROUP BY p.status');
        $s->execute($par);
        foreach ($s->fetchAll() as $r) {
            if (isset($hitung[$r['status']])) $hitung[$r['status']] = (int) $r['n'];
            $hitung['semua'] += (int) $r['n'];
        }

        $status = $_GET['status'] ?? 'semua';
        if (in_array($status, STATUS_PINJAM, true)) { $dasar .= ' AND p.status = ?'; $par[] = $status; }
        $total = $status === 'semua' ? $hitung['semua'] : ($hitung[$status] ?? 0);

        $halaman = max(1, (int) ($_GET['halaman'] ?? 1));
        $offset = ($halaman - 1) * PER_HALAMAN;
        $arah = $waktu === 'mendatang' ? 'ASC' : 'DESC';
        $s = $pdo->prepare("SELECT p.id, p.elemen_id AS ruang_id, e.nama AS ruang, e.kapasitas, l.nama AS lantai, p.tanggal, p.mulai, p.selesai,
                                   p.peminjam, p.keperluan, p.peserta, p.fasilitas, p.status, p.catatan, p.pengguna_id
                            $dasar
                            ORDER BY CASE WHEN p.status = 'menunggu' THEN 0 ELSE 1 END, p.tanggal $arah, p.mulai $arah, p.id $arah
                            LIMIT " . PER_HALAMAN . " OFFSET " . (int) $offset);
        $s->execute($par);
        $data = $s->fetchAll();
        foreach ($data as &$r) {
            foreach (['id', 'ruang_id', 'kapasitas', 'peserta'] as $k) $r[$k] = (int) $r[$k];
            $r['punya_akun'] = (int) $r['pengguna_id'] > 0;      // pemohon punya akun -> alasan penolakan terkirim ke Pesan-nya
            unset($r['pengguna_id']);
        }
        keluar(['total' => $total, 'halaman' => $halaman, 'per' => PER_HALAMAN, 'hitung' => $hitung, 'data' => $data]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') keluar(['error' => 'Metode tidak didukung.'], 405);

    // ---------- POST ----------
    $in = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($in)) keluar(['error' => 'Data JSON tidak valid.'], 400);

    if (in_array($in['aksi'] ?? '', ['setujui', 'tolak', 'hapus', 'hapus_semua', 'simpan', 'impor'], true) && $saya['peran'] !== 'admin') {
        keluar(['error' => 'Hanya admin yang dapat mengelola data jadwal.'], 403);
    }

    switch ($in['aksi'] ?? '') {
        case 'ajukan':
            $ruang = (int) ($in['elemen_id'] ?? 0);
            $s = $pdo->prepare("SELECT 1 FROM elemen WHERE id = ? AND tipe = 'ruang'");
            $s->execute([$ruang]);
            if (!$s->fetchColumn()) keluar(['error' => 'Ruang tidak ditemukan.'], 422);

            $tanggal = (string) ($in['tanggal'] ?? '');
            $d = DateTime::createFromFormat('Y-m-d', $tanggal);
            if (!$d || $d->format('Y-m-d') !== $tanggal) keluar(['error' => 'Tanggal tidak valid.'], 422);
            if ($tanggal < date('Y-m-d')) keluar(['error' => 'Tanggal peminjaman tidak boleh di masa lalu.'], 422);

            $mulai = (string) ($in['mulai'] ?? '');
            $selesai = (string) ($in['selesai'] ?? '');
            if (!jam_valid($mulai) || !jam_valid($selesai)) keluar(['error' => 'Jam mulai/selesai tidak valid.'], 422);
            if ($selesai <= $mulai) keluar(['error' => 'Jam selesai harus lebih besar dari jam mulai.'], 422);
            if ($tanggal === date('Y-m-d') && $selesai <= date('H:i')) {
                keluar(['error' => 'Jam ' . $mulai . '-' . $selesai . ' sudah lewat (sekarang ' . date('H:i') . '). Pilih jam yang masih akan datang.'], 422);
            }

            $keperluan = potong($in['keperluan'] ?? '', 160);
            if ($keperluan === '') keluar(['error' => 'Keperluan wajib diisi.'], 422);
            $peminjam = potong($in['peminjam'] ?? '', 80) ?: $saya['nama'];
            $peserta = max(0, min(9999, (int) ($in['peserta'] ?? 0)));
            $fasilitas = potong($in['fasilitas'] ?? '', 255);

            $bentrok = cari_bentrok($pdo, $ruang, $tanggal, $mulai, $selesai);
            if ($bentrok) keluar(['error' => $bentrok], 409);

            // Hanya admin yang boleh langsung menyetujui; pengajuan akun pengguna selalu "menunggu".
            $status = ($saya['peran'] === 'admin' && !empty($in['langsung'])) ? 'disetujui' : 'menunggu';
            $pdo->prepare('INSERT INTO peminjaman (elemen_id, tanggal, mulai, selesai, peminjam, keperluan, peserta, fasilitas, status, catatan, dibuat, pengguna_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$ruang, $tanggal, $mulai, $selesai, $peminjam, $keperluan, $peserta, $fasilitas, $status, '', date('Y-m-d H:i:s'),
                           $saya['peran'] === 'admin' ? 0 : $saya['id']]);
            $idBaru = (int) $pdo->lastInsertId();

            // Pesan otomatis ke admin. Pengajuan sudah tersimpan, jadi kegagalan pesan tidak boleh membatalkannya.
            $pesanTerkirim = false;
            if ($saya['peran'] !== 'admin') {
                try {
                    pesan_pengajuan_otomatis($pdo, $saya, $idBaru, [
                        'elemen_id' => $ruang, 'tanggal' => $tanggal, 'mulai' => $mulai, 'selesai' => $selesai,
                        'keperluan' => $keperluan, 'peserta' => $peserta, 'peminjam' => $peminjam,
                    ]);
                    $pesanTerkirim = true;
                } catch (Throwable $e) {
                    $pesanTerkirim = false;
                }
            }
            keluar(['ok' => true, 'id' => $idBaru, 'status' => $status, 'pesan_terkirim' => $pesanTerkirim]);

        case 'simpan':
            // Admin menambah / mengubah satu kegiatan langsung dari Daftar jadwal. Tanggal lampau diperbolehkan
            // (mencatat kegiatan yang sudah terjadi).
            $id = (int) ($in['id'] ?? 0);
            $lama = $id > 0 ? ambil_baris($pdo, $id) : null;
            if ($id > 0 && !$lama) keluar(['error' => 'Data tidak ditemukan (mungkin sudah dihapus).'], 404);

            $ruang = (int) ($in['elemen_id'] ?? 0);
            $s = $pdo->prepare("SELECT 1 FROM elemen WHERE id = ? AND tipe = 'ruang'");
            $s->execute([$ruang]);
            if (!$s->fetchColumn()) keluar(['error' => 'Pilih ruang terlebih dahulu.'], 422);

            $tanggal = (string) ($in['tanggal'] ?? '');
            if (!tanggal_valid($tanggal)) keluar(['error' => 'Tanggal tidak valid.'], 422);
            $mulai = (string) ($in['mulai'] ?? '');
            $selesai = (string) ($in['selesai'] ?? '');
            if (!jam_valid($mulai) || !jam_valid($selesai)) keluar(['error' => 'Isi jam mulai dan jam selesai dengan benar.'], 422);
            if ($selesai <= $mulai) keluar(['error' => 'Jam selesai harus lebih besar dari jam mulai.'], 422);

            $keperluan = potong($in['keperluan'] ?? '', 160);
            if ($keperluan === '') keluar(['error' => 'Nama kegiatan wajib diisi.'], 422);
            $peminjam = potong($in['peminjam'] ?? '', 80);
            $peserta = max(0, min(9999, (int) ($in['peserta'] ?? 0)));
            $fasilitas = potong($in['fasilitas'] ?? '', 255);
            $catatan = potong($in['catatan'] ?? '', 255);
            $status = (string) ($in['status'] ?? 'disetujui');
            if (!in_array($status, STATUS_PINJAM, true)) keluar(['error' => 'Status tidak valid.'], 422);

            // Bentrok hanya diperiksa untuk kegiatan disetujui yang baru atau yang ruang/waktu/statusnya diubah.
            // Data asli banyak yang bentrok, jadi admin diberi peringatan dan boleh melanjutkan (paksa = true).
            $berubah = !$lama || (int) $lama['elemen_id'] !== $ruang || $lama['tanggal'] !== $tanggal
                || $lama['mulai'] !== $mulai || $lama['selesai'] !== $selesai || $lama['status'] !== $status;
            if ($status === 'disetujui' && $berubah && empty($in['paksa'])) {
                $bentrok = cari_bentrok($pdo, $ruang, $tanggal, $mulai, $selesai, $id);
                if ($bentrok) keluar(['ok' => false, 'bentrok' => $bentrok]);
            }

            if ($lama) {
                $pdo->prepare('UPDATE peminjaman SET elemen_id = ?, tanggal = ?, mulai = ?, selesai = ?, peminjam = ?, keperluan = ?,
                               peserta = ?, fasilitas = ?, status = ?, catatan = ? WHERE id = ?')
                    ->execute([$ruang, $tanggal, $mulai, $selesai, $peminjam, $keperluan, $peserta, $fasilitas, $status, $catatan, $id]);
                keluar(['ok' => true, 'id' => $id]);
            }
            $pdo->prepare('INSERT INTO peminjaman (elemen_id, tanggal, mulai, selesai, peminjam, keperluan, peserta, fasilitas, status, catatan, dibuat, pengguna_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
                ->execute([$ruang, $tanggal, $mulai, $selesai, $peminjam, $keperluan, $peserta, $fasilitas, $status, $catatan, date('Y-m-d H:i:s')]);
            keluar(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);

        case 'impor':
            $baris = $in['baris'] ?? null;
            if (!is_array($baris) || !$baris) keluar(['error' => 'Tidak ada baris data untuk diimpor.'], 422);
            if (count($baris) > MAKS_IMPOR) keluar(['error' => 'Maksimal ' . MAKS_IMPOR . ' baris sekali impor. Pecah berkasnya.'], 422);
            keluar(impor_kegiatan($pdo, $baris, !empty($in['uji'])));

        case 'setujui':
            $r = ambil_baris($pdo, (int) ($in['id'] ?? 0));
            if (!$r) keluar(['error' => 'Pengajuan tidak ditemukan.'], 404);
            $bentrok = cari_bentrok($pdo, (int) $r['elemen_id'], $r['tanggal'], $r['mulai'], $r['selesai'], (int) $r['id']);
            if ($bentrok) keluar(['error' => 'Tidak bisa disetujui. ' . $bentrok], 409);
            $pdo->prepare("UPDATE peminjaman SET status = 'disetujui', catatan = '' WHERE id = ?")->execute([(int) $r['id']]);
            keluar(['ok' => true]);

        case 'tolak':
            $r = ambil_baris($pdo, (int) ($in['id'] ?? 0));
            if (!$r) keluar(['error' => 'Pengajuan tidak ditemukan.'], 404);
            // Alasan wajib: pemohon harus tahu kenapa ditolak / dibatalkan ('catatan' = nama lama kolom ini, tetap diterima).
            $alasan = potong($in['alasan'] ?? ($in['catatan'] ?? ''), 255);
            if (mb_strlen($alasan) < 3) keluar(['error' => 'Alasan wajib diisi (minimal 3 karakter) supaya pemohon tahu penyebabnya.'], 422);
            $statusLama = (string) $r['status'];
            $pdo->prepare("UPDATE peminjaman SET status = 'ditolak', catatan = ? WHERE id = ?")->execute([$alasan, (int) $r['id']]);

            // Kirim alasan ke pemohon lewat Pesan (hanya bila baru berubah menjadi ditolak, agar tidak terkirim dua kali).
            // Penolakan sudah tersimpan, jadi kegagalan pesan tidak boleh membatalkannya.
            $terkirim = false;
            if ($statusLama !== 'ditolak') {
                try { $terkirim = pesan_penolakan_otomatis($pdo, $saya, $r, $statusLama, $alasan); }
                catch (Throwable $e) { $terkirim = false; }
            }
            keluar(['ok' => true, 'pesan_terkirim' => $terkirim, 'punya_akun' => (int) $r['pengguna_id'] > 0]);

        case 'hapus':
            $pdo->prepare('DELETE FROM peminjaman WHERE id = ?')->execute([(int) ($in['id'] ?? 0)]);
            keluar(['ok' => true]);

        case 'hapus_semua':   // admin: kosongkan seluruh kegiatan & peminjaman
            $n = $pdo->exec('DELETE FROM peminjaman');
            keluar(['ok' => true, 'terhapus' => (int) $n]);

        default:
            keluar(['error' => 'Aksi tidak dikenal.'], 400);
    }
} catch (Throwable $e) {
    keluar(['error' => $e->getMessage()], 500);
}
