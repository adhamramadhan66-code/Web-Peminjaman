<?php
/**
 * Sesi login berbasis server (PHP session) + penjaga akses yang dipakai semua API.
 *
 *   butuh_login()  -> akun yang sedang masuk, atau menjawab 401 dan berhenti
 *   butuh_admin()  -> sama, tetapi hanya untuk peran "admin" (selain itu 403)
 *
 * Sesi dibuka dalam mode baca-saja (langsung dilepas) supaya permintaan yang datang
 * bersamaan (polling pesan, dashboard) tidak saling menunggu kunci file sesi.
 */
require_once __DIR__ . '/db.php';

function kirim_json($data, int $kode = 200): void
{
    http_response_code($kode);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** $tulis = true hanya untuk login/daftar/keluar (perlu mengubah isi sesi). */
function sesi_buka(bool $tulis = false): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_name('kampusly_sid');
        session_set_cookie_params([
            'lifetime' => 0,          // hilang saat browser ditutup
            'path'     => '/',
            'httponly' => true,       // tidak bisa dibaca JavaScript
            'samesite' => 'Lax',      // tidak ikut terkirim dari situs lain (anti-CSRF dasar)
        ]);
        session_start();
    }
    if (!$tulis && session_status() === PHP_SESSION_ACTIVE) session_write_close();
}

/** Baris akun dari tabel pengguna menjadi data aman untuk dikirim ke browser (tanpa hash sandi). */
function data_pengguna(array $r): array
{
    return [
        'id'    => (int) $r['id'],
        'nama'  => (string) $r['nama'],
        'email' => (string) $r['email'],
        'peran' => $r['peran'] === 'admin' ? 'admin' : 'pengguna',
    ];
}

function pengguna_sekarang(): ?array
{
    static $cache = false;
    if ($cache !== false) return $cache;
    sesi_buka();
    $cache = null;
    $id = (int) ($_SESSION['uid'] ?? 0);
    if ($id > 0) {
        $s = db()->prepare('SELECT id, nama, email, peran FROM pengguna WHERE id = ?');
        $s->execute([$id]);
        if ($r = $s->fetch()) $cache = data_pengguna($r);
    }
    return $cache;
}

function butuh_login(): array
{
    $p = pengguna_sekarang();
    if (!$p) kirim_json(['error' => 'Sesi berakhir. Silakan masuk kembali.', 'login' => true], 401);
    return $p;
}

function butuh_admin(): array
{
    $p = butuh_login();
    if ($p['peran'] !== 'admin') kirim_json(['error' => 'Hanya admin yang dapat melakukan aksi ini.'], 403);
    return $p;
}
