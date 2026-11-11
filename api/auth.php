<?php
/**
 * API akun & sesi login.
 *   GET  api/auth.php                          -> { pengguna } akun yang sedang masuk (401 bila belum)
 *   POST api/auth.php {aksi: masuk,  email, sandi}
 *   POST api/auth.php {aksi: daftar, nama, email, sandi}   -> membuat akun "pengguna" lalu langsung masuk
 *   POST api/auth.php {aksi: keluar}
 * Akun yang mendaftar sendiri selalu berperan "pengguna". Peran "admin" hanya bisa diberikan
 * lewat database (kolom peran di tabel pengguna).
 */
require __DIR__ . '/sesi.php';

const SANDI_MIN = 8;
const SANDI_MAKS = 72;     // batas aman bcrypt

function teks_rapi($v, int $maks): string
{
    return mb_substr(trim(preg_replace('/\s+/u', ' ', (string) $v)), 0, $maks);
}

/** Menandai akun ini sebagai yang sedang masuk (sesi baru agar id sesi lama tidak bisa dipakai ulang). */
function mulai_sesi_akun(array $r): void
{
    sesi_buka(true);
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $r['id'];
}

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $p = pengguna_sekarang();
        if (!$p) kirim_json(['error' => 'Belum masuk.', 'login' => true], 401);
        kirim_json(['pengguna' => $p]);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') kirim_json(['error' => 'Metode tidak didukung.'], 405);

    $in = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($in)) kirim_json(['error' => 'Data JSON tidak valid.'], 400);
    $pdo = db();

    switch ($in['aksi'] ?? '') {
        case 'masuk':
            $email = mb_strtolower(trim((string) ($in['email'] ?? '')));
            $sandi = (string) ($in['sandi'] ?? '');
            if ($email === '' || $sandi === '') kirim_json(['error' => 'Masukkan alamat email dan kata sandi terlebih dahulu.'], 422);

            $s = $pdo->prepare('SELECT id, nama, email, sandi, peran FROM pengguna WHERE email = ?');
            $s->execute([$email]);
            $r = $s->fetch();
            if (!$r || !password_verify($sandi, $r['sandi'])) {
                usleep(400000);   // memperlambat tebak-tebakan kata sandi
                kirim_json(['error' => 'Email atau kata sandi salah.'], 401);
            }
            mulai_sesi_akun($r);
            kirim_json(['ok' => true, 'pengguna' => data_pengguna($r)]);

        case 'daftar':
            $nama = teks_rapi($in['nama'] ?? '', 80);
            $email = mb_strtolower(trim((string) ($in['email'] ?? '')));
            $sandi = (string) ($in['sandi'] ?? '');
            if (mb_strlen($nama) < 2) kirim_json(['error' => 'Nama lengkap minimal 2 karakter.'], 422);
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 120) kirim_json(['error' => 'Alamat email tidak valid.'], 422);
            if (mb_strlen($sandi) < SANDI_MIN) kirim_json(['error' => 'Kata sandi minimal ' . SANDI_MIN . ' karakter.'], 422);
            if (strlen($sandi) > SANDI_MAKS) kirim_json(['error' => 'Kata sandi terlalu panjang (maksimal ' . SANDI_MAKS . ' karakter).'], 422);

            $s = $pdo->prepare('SELECT 1 FROM pengguna WHERE email = ?');
            $s->execute([$email]);
            if ($s->fetchColumn()) kirim_json(['error' => 'Email ini sudah terdaftar. Silakan masuk.'], 409);

            try {
                $pdo->prepare('INSERT INTO pengguna (nama, email, sandi, peran, dibuat) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$nama, $email, password_hash($sandi, PASSWORD_DEFAULT), 'pengguna', date('Y-m-d H:i:s')]);
            } catch (PDOException $e) {
                // dua pendaftaran dengan email sama pada detik yang sama: indeks UNIQUE menolak yang kedua
                if ((string) $e->getCode() === '23000') kirim_json(['error' => 'Email ini sudah terdaftar. Silakan masuk.'], 409);
                throw $e;
            }
            $r = ['id' => (int) $pdo->lastInsertId(), 'nama' => $nama, 'email' => $email, 'peran' => 'pengguna'];
            mulai_sesi_akun($r);
            kirim_json(['ok' => true, 'pengguna' => data_pengguna($r)]);

        case 'keluar':
            sesi_buka(true);
            $_SESSION = [];
            if (ini_get('session.use_cookies')) {
                $c = session_get_cookie_params();
                setcookie(session_name(), '', time() - 42000, $c['path'], $c['domain'], $c['secure'], $c['httponly']);
            }
            session_destroy();
            kirim_json(['ok' => true]);

        default:
            kirim_json(['error' => 'Aksi tidak dikenal.'], 400);
    }
} catch (Throwable $e) {
    kirim_json(['error' => $e->getMessage()], 500);
}
