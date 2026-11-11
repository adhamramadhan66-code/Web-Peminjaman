<?php
/**
 * API Pesan (messenger). Wajib login.
 *
 * Aturan akses:
 *   - admin    : melihat semua akun pengguna, boleh membuka & membalas percakapan siapa pun.
 *   - pengguna : hanya punya satu percakapan, yaitu dengan admin. Tidak bisa membuka percakapan akun lain.
 *
 *   GET  api/chat.php?aksi=belum_dibaca                      -> { belum, saya }
 *   GET  api/chat.php?aksi=daftar[&q=kata]                   -> { peran, kontak: [...] }
 *   GET  api/chat.php?aksi=pesan[&pengguna_id=N][&setelah=ID][&tandai=1]
 *                                                             -> { kontak, pesan: [...], terakhir_id }
 *   POST api/chat.php {aksi: kirim, isi, pengguna_id (khusus admin)}
 *   POST api/chat.php {aksi: hapus, id}
 *
 * Hapus pesan: pengguna hanya boleh menghapus pesannya sendiri; admin boleh menghapus pesan apa pun.
 * Pesan tidak dibuang dari tabel, hanya dikosongkan dan ditandai dihapus (lihat kolom dihapus di db.php).
 */
require __DIR__ . '/sesi.php';
require __DIR__ . '/chat_util.php';

const MAKS_ISI = 1000;

function keluar($data, int $kode = 200): void
{
    kirim_json($data, $kode);
}

function rapikan_pesan($v): string
{
    $v = str_replace(["\r\n", "\r"], "\n", (string) $v);
    $v = preg_replace("/[ \t]+/u", ' ', $v);
    $v = preg_replace("/\n{3,}/", "\n\n", $v);
    return mb_substr(trim($v), 0, MAKS_ISI);
}

/** Teks satu baris untuk pratinjau di daftar percakapan. */
function pratinjau(array $m): string
{
    if (!empty($m['dihapus'])) return 'Pesan dihapus';
    $isi = (string) $m['isi'];
    if ($m['jenis'] === 'otomatis') $isi = explode("\n", $isi)[0];
    $isi = trim(preg_replace('/\s+/u', ' ', $isi));
    return mb_strlen($isi) > 70 ? mb_substr($isi, 0, 70) . '…' : $isi;
}

function baris_pesan(array $r): array
{
    return [
        'id'            => (int) $r['id'],
        'dari'          => $r['dari'],
        'admin_id'      => (int) $r['admin_id'],
        'nama_admin'    => $r['nama_admin'] ?? null,
        'isi'           => $r['isi'],
        'jenis'         => $r['jenis'],
        'peminjaman_id' => (int) $r['peminjaman_id'],
        'dibuat'        => $r['dibuat'],
        'dihapus'       => (int) ($r['dihapus'] ?? 0),
    ];
}

try {
    $pdo = db();
    $saya = butuh_login();
    $admin = $saya['peran'] === 'admin';

    /** Akun pemilik percakapan yang dimaksud. Pengguna biasa selalu dirinya sendiri (parameter diabaikan). */
    $akunUtas = function (array $sumber) use ($pdo, $saya, $admin): array {
        if (!$admin) return ['id' => $saya['id'], 'nama' => $saya['nama'], 'email' => $saya['email']];
        $id = (int) ($sumber['pengguna_id'] ?? 0);
        if ($id <= 0) keluar(['error' => 'Pilih akun yang ingin dikirimi pesan.'], 422);
        $s = $pdo->prepare("SELECT id, nama, email FROM pengguna WHERE id = ? AND peran = 'pengguna'");
        $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) keluar(['error' => 'Akun tujuan tidak ditemukan.'], 404);
        return ['id' => (int) $r['id'], 'nama' => $r['nama'], 'email' => $r['email']];
    };

    // ---------- GET ----------
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $aksi = $_GET['aksi'] ?? '';

        if ($aksi === 'belum_dibaca') {
            if ($admin) {
                $n = (int) $pdo->query("SELECT COUNT(*) FROM pesan WHERE dari = 'pengguna' AND dibaca = 0")->fetchColumn();
            } else {
                $s = $pdo->prepare("SELECT COUNT(*) FROM pesan WHERE pengguna_id = ? AND dari = 'admin' AND dibaca = 0");
                $s->execute([$saya['id']]);
                $n = (int) $s->fetchColumn();
            }
            keluar(['belum' => $n, 'saya' => $saya]);
        }

        if ($aksi === 'daftar') {
            if (!$admin) {
                $s = $pdo->prepare('SELECT id, dari, isi, jenis, dihapus, dibuat FROM pesan WHERE pengguna_id = ? ORDER BY id DESC LIMIT 1');
                $s->execute([$saya['id']]);
                $m = $s->fetch();
                $s = $pdo->prepare("SELECT COUNT(*) FROM pesan WHERE pengguna_id = ? AND dari = 'admin' AND dibaca = 0");
                $s->execute([$saya['id']]);
                keluar(['peran' => 'pengguna', 'kontak' => [[
                    'pengguna_id' => $saya['id'],
                    'nama'        => 'Admin',
                    'email'       => 'Pengelola peminjaman ruang',
                    'belum'       => (int) $s->fetchColumn(),
                    'terakhir'    => $m ? ['teks' => pratinjau($m), 'dari' => $m['dari'], 'dibuat' => $m['dibuat']] : null,
                ]]]);
            }

            $where = "u.peran = 'pengguna'";
            $par = [];
            $q = mb_substr(trim(preg_replace('/\s+/u', ' ', (string) ($_GET['q'] ?? ''))), 0, 60);
            if ($q !== '') {
                $like = '%' . str_replace(['%', '_'], ' ', $q) . '%';
                $where .= ' AND (u.nama LIKE ? OR u.email LIKE ?)';
                $par = [$like, $like];
            }
            $s = $pdo->prepare("SELECT u.id, u.nama, u.email,
                    (SELECT COUNT(*) FROM pesan m WHERE m.pengguna_id = u.id AND m.dari = 'pengguna' AND m.dibaca = 0) AS belum,
                    (SELECT MAX(m.id) FROM pesan m WHERE m.pengguna_id = u.id) AS terakhir_id
                FROM pengguna u WHERE $where ORDER BY u.nama LIMIT 300");
            $s->execute($par);
            $akun = $s->fetchAll();

            $idTerakhir = array_values(array_filter(array_map(fn ($a) => (int) $a['terakhir_id'], $akun)));
            $terakhir = [];
            if ($idTerakhir) {
                $daftarId = implode(',', array_map('intval', $idTerakhir));
                foreach ($pdo->query("SELECT id, dari, isi, jenis, dihapus, dibuat FROM pesan WHERE id IN ($daftarId)") as $m) {
                    $terakhir[(int) $m['id']] = $m;
                }
            }

            $adaPesan = [];
            $tanpaPesan = [];
            foreach ($akun as $a) {
                $m = $terakhir[(int) $a['terakhir_id']] ?? null;
                $baris = [
                    'pengguna_id' => (int) $a['id'],
                    'nama'        => $a['nama'],
                    'email'       => $a['email'],
                    'belum'       => (int) $a['belum'],
                    'terakhir'    => $m ? ['teks' => pratinjau($m), 'dari' => $m['dari'], 'dibuat' => $m['dibuat']] : null,
                    'urut'        => (int) $a['terakhir_id'],
                ];
                if ($m) $adaPesan[] = $baris; else $tanpaPesan[] = $baris;
            }
            usort($adaPesan, fn ($x, $y) => $y['urut'] <=> $x['urut']);   // percakapan terbaru di atas
            keluar(['peran' => 'admin', 'kontak' => array_merge($adaPesan, $tanpaPesan)]);
        }

        if ($aksi === 'pesan') {
            $akun = $akunUtas($_GET);
            $setelah = max(0, (int) ($_GET['setelah'] ?? 0));
            $kolom = 'm.id, m.dari, m.admin_id, m.isi, m.jenis, m.peminjaman_id, m.dihapus, m.dibuat, a.nama AS nama_admin';

            if ($setelah > 0) {
                $s = $pdo->prepare("SELECT $kolom FROM pesan m LEFT JOIN pengguna a ON a.id = m.admin_id
                                    WHERE m.pengguna_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 200");
                $s->execute([$akun['id'], $setelah]);
            } else {
                $s = $pdo->prepare("SELECT * FROM (SELECT $kolom FROM pesan m LEFT JOIN pengguna a ON a.id = m.admin_id
                                    WHERE m.pengguna_id = ? ORDER BY m.id DESC LIMIT 100) t ORDER BY t.id ASC");
                $s->execute([$akun['id']]);
            }
            $pesan = array_map('baris_pesan', $s->fetchAll());

            // Pesan dari pihak lawan dianggap dibaca hanya bila halaman percakapan benar-benar sedang dibuka.
            if (($_GET['tandai'] ?? '') === '1') {
                $pdo->prepare('UPDATE pesan SET dibaca = 1 WHERE pengguna_id = ? AND dari = ? AND dibaca = 0')
                    ->execute([$akun['id'], $admin ? 'pengguna' : 'admin']);
            }

            // Daftar pesan yang sudah dihapus pada percakapan ini, agar layar pihak lawan ikut berubah
            // untuk pesan yang sebelumnya sudah tampil.
            $s = $pdo->prepare('SELECT id, dihapus FROM pesan WHERE pengguna_id = ? AND dihapus > 0 ORDER BY id DESC LIMIT 300');
            $s->execute([$akun['id']]);
            $terhapus = array_map(fn ($r) => ['id' => (int) $r['id'], 'dihapus' => (int) $r['dihapus']], $s->fetchAll());

            $terakhirId = $pesan ? $pesan[count($pesan) - 1]['id'] : $setelah;
            keluar(['kontak' => $admin ? $akun : ['id' => $akun['id'], 'nama' => 'Admin', 'email' => 'Pengelola peminjaman ruang'],
                    'pesan' => $pesan, 'terhapus' => $terhapus, 'terakhir_id' => $terakhirId]);
        }

        keluar(['error' => 'Aksi tidak dikenal.'], 400);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') keluar(['error' => 'Metode tidak didukung.'], 405);

    // ---------- POST ----------
    $in = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($in)) keluar(['error' => 'Data JSON tidak valid.'], 400);

    switch ($in['aksi'] ?? '') {
        case 'kirim':
            $akun = $akunUtas($in);
            $isi = rapikan_pesan($in['isi'] ?? '');
            if ($isi === '') keluar(['error' => 'Pesan tidak boleh kosong.'], 422);

            $m = pesan_simpan($pdo, $akun['id'], $admin ? 'admin' : 'pengguna', $admin ? $saya['id'] : 0, $isi);
            $m['nama_admin'] = $admin ? $saya['nama'] : null;
            keluar(['ok' => true, 'pesan' => baris_pesan($m)]);

        case 'hapus':
            $id = (int) ($in['id'] ?? 0);
            $s = $pdo->prepare('SELECT id, pengguna_id, dari, dihapus FROM pesan WHERE id = ?');
            $s->execute([$id]);
            $m = $s->fetch();
            if (!$m) keluar(['error' => 'Pesan tidak ditemukan.'], 404);
            if (!$admin && ((int) $m['pengguna_id'] !== $saya['id'] || $m['dari'] !== 'pengguna')) {
                keluar(['error' => 'Kamu hanya dapat menghapus pesanmu sendiri.'], 403);
            }
            $status = (int) $m['dihapus'];
            if ($status === 0) {
                // 2 = admin menghapus pesan milik pengguna (moderasi), 1 = selain itu
                $status = ($admin && $m['dari'] === 'pengguna') ? 2 : 1;
                // dibaca = 1 agar pesan yang dihapus tidak lagi dihitung sebagai belum dibaca
                $pdo->prepare("UPDATE pesan SET dihapus = ?, isi = '', dibaca = 1 WHERE id = ?")->execute([$status, $id]);
            }
            keluar(['ok' => true, 'id' => $id, 'dihapus' => $status]);

        default:
            keluar(['error' => 'Aksi tidak dikenal.'], 400);
    }
} catch (Throwable $e) {
    keluar(['error' => $e->getMessage()], 500);
}
