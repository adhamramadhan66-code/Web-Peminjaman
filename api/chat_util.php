<?php
/**
 * Fungsi bersama untuk fitur pesan (dipakai api/chat.php dan api/peminjaman.php).
 */

function tanggal_indonesia(string $ymd): string
{
    static $hari  = [1 => 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
    static $bulan = [1 => 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
                     'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    $d = DateTime::createFromFormat('Y-m-d', $ymd);
    if (!$d) return $ymd;
    return $hari[(int) $d->format('N')] . ', ' . (int) $d->format('j') . ' ' . $bulan[(int) $d->format('n')] . ' ' . $d->format('Y');
}

/**
 * Menyimpan satu pesan pada percakapan milik akun pengguna $penggunaId.
 * $dari = 'pengguna' (ditulis akun pengguna) atau 'admin' (ditulis admin dengan id $adminId).
 */
function pesan_simpan(PDO $pdo, int $penggunaId, string $dari, int $adminId, string $isi,
                      string $jenis = 'teks', int $peminjamanId = 0): array
{
    $waktu = date('Y-m-d H:i:s');
    $pdo->prepare('INSERT INTO pesan (pengguna_id, dari, admin_id, isi, jenis, peminjaman_id, dibaca, dibuat)
                   VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
        ->execute([$penggunaId, $dari, $adminId, $isi, $jenis, $peminjamanId, $waktu]);
    return [
        'id'            => (int) $pdo->lastInsertId(),
        'dari'          => $dari,
        'admin_id'      => $adminId,
        'isi'           => $isi,
        'jenis'         => $jenis,
        'peminjaman_id' => $peminjamanId,
        'dibuat'        => $waktu,
    ];
}

/** "C2.1 (Gedung C Lantai 2)" untuk ruang dengan id $idRuang. */
function nama_ruang_lengkap(PDO $pdo, int $idRuang): string
{
    $s = $pdo->prepare('SELECT e.nama AS ruang, l.nama AS lantai FROM elemen e LEFT JOIN lantai l ON l.id = e.lantai_id WHERE e.id = ?');
    $s->execute([$idRuang]);
    $r = $s->fetch() ?: ['ruang' => 'Ruang #' . $idRuang, 'lantai' => ''];
    return $r['ruang'] . ($r['lantai'] ? ' (' . $r['lantai'] . ')' : '');
}

/**
 * Pesan otomatis dari admin ke pemohon saat peminjamannya ditolak / dibatalkan, lengkap dengan ALASAN-nya,
 * supaya pemohon langsung paham masalahnya tanpa bertanya. Hanya untuk pemohon yang punya akun (pengguna_id > 0).
 * $b = baris peminjaman (sebelum diubah), $statusLama = status sebelum ditolak:
 * 'disetujui' -> judul "dibatalkan", selain itu -> "ditolak". Mengembalikan true bila pesan terkirim.
 */
function pesan_penolakan_otomatis(PDO $pdo, array $admin, array $b, string $statusLama, string $alasan): bool
{
    $uid = (int) ($b['pengguna_id'] ?? 0);
    if ($uid <= 0) return false;
    $s = $pdo->prepare("SELECT 1 FROM pengguna WHERE id = ? AND peran = 'pengguna'");
    $s->execute([$uid]);
    if (!$s->fetchColumn()) return false;

    $baris = [
        $statusLama === 'disetujui' ? 'Peminjaman dibatalkan oleh admin' : 'Pengajuan peminjaman ditolak',
        'Ruang: ' . nama_ruang_lengkap($pdo, (int) $b['elemen_id']),
        'Tanggal: ' . tanggal_indonesia($b['tanggal']),
        'Jam: ' . $b['mulai'] . '–' . $b['selesai'],
        'Keperluan: ' . $b['keperluan'],
        'Alasan: ' . $alasan,
    ];
    pesan_simpan($pdo, $uid, 'admin', (int) $admin['id'], implode("\n", $baris), 'otomatis', (int) $b['id']);
    return true;
}

/**
 * Pesan otomatis ke admin saat akun pengguna berhasil mengirim pengajuan peminjaman.
 * Baris pertama = judul, baris berikutnya berpola "Label: nilai" (dirender sebagai kartu di halaman Pesan).
 * Muncul di kotak masuk admin sebagai pesan belum dibaca, dan di percakapan pengguna sebagai bukti kirim.
 * Status pengajuan sengaja tidak ditulis di sini (cepat usang); status terkini ada di halaman Peminjaman.
 */
function pesan_pengajuan_otomatis(PDO $pdo, array $pengguna, int $peminjamanId, array $p): array
{
    $s = $pdo->prepare('SELECT e.nama AS ruang, l.nama AS lantai
                        FROM elemen e LEFT JOIN lantai l ON l.id = e.lantai_id WHERE e.id = ?');
    $s->execute([(int) $p['elemen_id']]);
    $r = $s->fetch() ?: ['ruang' => 'Ruang #' . (int) $p['elemen_id'], 'lantai' => ''];

    $baris = [
        'Pengajuan peminjaman ruang baru',
        'Ruang: ' . $r['ruang'] . ($r['lantai'] ? ' (' . $r['lantai'] . ')' : ''),
        'Tanggal: ' . tanggal_indonesia($p['tanggal']),
        'Jam: ' . $p['mulai'] . '–' . $p['selesai'],
        'Keperluan: ' . $p['keperluan'],
    ];
    if ((int) $p['peserta'] > 0) $baris[] = 'Peserta: ' . (int) $p['peserta'] . ' orang';
    if ($p['peminjam'] !== '' && $p['peminjam'] !== $pengguna['nama']) $baris[] = 'Pemohon: ' . $p['peminjam'];

    return pesan_simpan($pdo, (int) $pengguna['id'], 'pengguna', 0, implode("\n", $baris), 'otomatis', $peminjamanId);
}
