<?php
/**
 * Fungsi bersama untuk fitur armada (dipakai api/armada.php dan api/armada_pemohon.php):
 * validasi isian, pengecekan bentrok, dan hitung jarak GPS.
 */
require_once __DIR__ . '/jadwal_util.php';

const STATUS_ARMADA = ['menunggu', 'disetujui', 'ditolak'];
const BATAS_GPS_DETIK = 60;       // lewat dari ini tanpa kiriman GPS = dianggap terputus / GPS mati

function ujung(array $r): array
{
    $akhir = ($r['selesai'] ?? '') !== '' ? $r['selesai'] : '23:59';
    return [$r['tanggal'] . ' ' . $r['mulai'], ($r['tanggal_akhir'] ?: $r['tanggal']) . ' ' . $akhir];
}

/** Pesan bentrok bila armada sudah dipakai kegiatan DISETUJUI lain pada waktu yang beririsan; null bila aman. */
function cek_bentrok(PDO $pdo, int $armada, array $b, int $kecuali = 0): ?string
{
    [$s1, $e1] = ujung($b);
    $s = $pdo->prepare("SELECT * FROM pemakaian_armada WHERE armada_id = ? AND status = 'disetujui' AND id <> ? AND tanggal <= ? AND tanggal_akhir >= ?");
    $s->execute([$armada, $kecuali, substr($e1, 0, 10), substr($s1, 0, 10)]);
    foreach ($s->fetchAll() as $r) {
        [$s2, $e2] = ujung($r);
        if ($s2 < $e1 && $s1 < $e2) {
            return 'Armada sudah dipakai untuk "' . $r['tujuan'] . '" (' . $r['tanggal']
                . ($r['tanggal_akhir'] !== $r['tanggal'] ? ' s.d. ' . $r['tanggal_akhir'] : '') . ', ' . $r['mulai'] . ' - ' . ($r['selesai'] ?: 'selesai') . ').';
        }
    }
    return null;
}

/** Merapikan dan memeriksa isian satu pemakaian. Mengembalikan [data, pesanError]. */
function rapikan(array $in): array
{
    $tgl = (string) ($in['tanggal'] ?? '');
    if (!tanggal_valid($tgl)) return [null, 'Isi tanggal pemakaian dengan benar.'];
    $akhir = (string) ($in['tanggal_akhir'] ?? '');
    if ($akhir === '') $akhir = $tgl;
    if (!tanggal_valid($akhir) || $akhir < $tgl) return [null, 'Tanggal akhir tidak boleh sebelum tanggal pemakaian.'];
    if ((strtotime($akhir) - strtotime($tgl)) / 86400 > 30) return [null, 'Satu pemakaian paling lama 31 hari.'];
    $mulai = (string) ($in['mulai'] ?? '');
    if (!jam_valid($mulai)) return [null, 'Isi jam berangkat dengan benar.'];
    $selesai = (string) ($in['selesai'] ?? '');
    if ($selesai !== '' && !jam_valid($selesai)) return [null, 'Jam selesai tidak valid (kosongkan bila "sampai selesai").'];
    if ($selesai !== '' && $akhir === $tgl && $selesai <= $mulai) return [null, 'Jam selesai harus lebih besar dari jam berangkat.'];
    $tujuan = potong($in['tujuan'] ?? '', 200);
    if ($tujuan === '') return [null, 'Tujuan / keperluan wajib diisi.'];
    $status = (string) ($in['status'] ?? 'disetujui');
    if (!in_array($status, STATUS_ARMADA, true)) $status = 'disetujui';
    $pesan = (string) ($in['tgl_pesan'] ?? '');
    return [[
        'tgl_pesan' => tanggal_valid($pesan) ? $pesan : '', 'tanggal' => $tgl, 'tanggal_akhir' => $akhir, 'mulai' => $mulai, 'selesai' => $selesai,
        'tujuan' => $tujuan, 'peserta' => max(0, min(99, (int) ($in['peserta'] ?? 0))), 'sopir' => !empty($in['sopir']) ? 1 : 0,
        'fasilitas' => potong($in['fasilitas'] ?? '', 160), 'pemohon' => potong($in['pemohon'] ?? '', 80), 'status' => $status,
        'catatan' => potong($in['catatan'] ?? '', 255),
    ], null];
}

function baris_armada(PDO $pdo, int $id): ?array
{
    $s = $pdo->prepare('SELECT * FROM pemakaian_armada WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch() ?: null;
}

function rapikan_keluar(array $r): array
{
    foreach (['id', 'armada_id', 'peserta', 'sopir', 'pengguna_id', 'pos_akurasi'] as $k) if (isset($r[$k])) $r[$k] = (int) $r[$k];
    foreach (['tujuan_lat', 'tujuan_lng', 'pos_lat', 'pos_lng'] as $k) if (isset($r[$k])) $r[$k] = (float) $r[$k];
    $r['sopir'] = $r['sopir'] === 1;
    return $r;
}


/** Jarak dua titik di bumi dalam meter (rumus haversine). */
function jarak_meter(float $lat1, float $lng1, float $lat2, float $lng2): float
{
    $r = 6371000.0; $p1 = deg2rad($lat1); $p2 = deg2rad($lat2);
    $dp = $p2 - $p1; $dl = deg2rad($lng2 - $lng1);
    $a = sin($dp / 2) ** 2 + cos($p1) * cos($p2) * sin($dl / 2) ** 2;
    return 2 * $r * asin(min(1, sqrt($a)));
}

function ambil_kampus(PDO $pdo): ?array
{
    $h = [];
    foreach ($pdo->query("SELECT kunci, nilai FROM pengaturan WHERE kunci IN ('kampus_lat', 'kampus_lng', 'kampus_radius', 'kampus_nama')") as $r) $h[$r['kunci']] = $r['nilai'];
    if (!isset($h['kampus_lat'], $h['kampus_lng']) || (float) $h['kampus_lat'] == 0.0) return null;
    return ['nama' => trim((string) ($h['kampus_nama'] ?? '')) ?: 'Kampus TSU', 'lat' => (float) $h['kampus_lat'], 'lng' => (float) $h['kampus_lng'], 'radius' => (int) ($h['kampus_radius'] ?? 300) ?: 300];
}

/** Simpan titik kampus (nama, koordinat, radius "sudah tiba"). Mengembalikan pesan galat atau null bila berhasil. */
function simpan_kampus(PDO $pdo, array $in): ?string
{
    if (!koordinat_valid($in['lat'] ?? null, $in['lng'] ?? null)) return 'Titik kampus tidak valid.';
    $radius = max(50, min(2000, (int) ($in['radius'] ?? 300)));
    $nama = mb_substr(trim(preg_replace('/\s+/u', ' ', (string) ($in['nama'] ?? ''))), 0, 80) ?: 'Kampus TSU';
    $u = $pdo->prepare('DELETE FROM pengaturan WHERE kunci = ?');
    $i = $pdo->prepare('INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)');
    foreach (['kampus_lat' => (float) $in['lat'], 'kampus_lng' => (float) $in['lng'], 'kampus_radius' => $radius, 'kampus_nama' => $nama] as $k => $v) { $u->execute([$k]); $i->execute([$k, (string) $v]); }
    return null;
}

/** Lokasi tujuan tersimpan, urut nama. */
function daftar_lokasi(PDO $pdo): array
{
    $h = $pdo->query('SELECT id, nama, alamat, lat, lng FROM lokasi_armada ORDER BY nama, id')->fetchAll();
    foreach ($h as &$r) { $r['id'] = (int) $r['id']; $r['lat'] = (float) $r['lat']; $r['lng'] = (float) $r['lng']; }
    return $h;
}

/**
 * Pesan otomatis (kartu) antara pemohon mobil dinas dan admin lewat fitur Pesan.
 * $arah = 'ke_admin' (pengajuan baru, ditulis atas nama pemohon) | 'ke_pemohon' (keputusan admin).
 */
function pesan_armada_otomatis(PDO $pdo, string $arah, array $r, string $judul, string $alasan = '', int $adminId = 0): void
{
    $uid = (int) ($r['pengguna_id'] ?? 0);
    if ($uid <= 0) return;
    require_once __DIR__ . '/chat_util.php';
    $s = $pdo->prepare('SELECT kode, nama FROM armada WHERE id = ?'); $s->execute([(int) $r['armada_id']]);
    $a = $s->fetch() ?: ['kode' => '?', 'nama' => ''];
    $tgl = tanggal_indonesia($r['tanggal']);
    if (!empty($r['tanggal_akhir']) && $r['tanggal_akhir'] !== $r['tanggal']) $tgl .= ' s.d. ' . tanggal_indonesia($r['tanggal_akhir']);
    $baris = [$judul, 'Mobil: ' . $a['kode'] . ($a['nama'] ? ' (' . $a['nama'] . ')' : ''), 'Tanggal: ' . $tgl,
        'Jam: ' . $r['mulai'] . '–' . ($r['selesai'] !== '' ? $r['selesai'] : 'selesai'), 'Tujuan: ' . $r['tujuan']];
    if ($alasan !== '') $baris[] = 'Alasan: ' . $alasan;
    try {
        if ($arah === 'ke_admin') pesan_simpan($pdo, $uid, 'pengguna', 0, implode("\n", $baris), 'otomatis', 0);
        else pesan_simpan($pdo, $uid, 'admin', $adminId, implode("\n", $baris), 'otomatis', 0);
    } catch (Throwable $e) { /* pesan otomatis bersifat tambahan; jangan menggagalkan keputusan */ }
}

function koordinat_valid($lat, $lng): bool
{
    return is_numeric($lat) && is_numeric($lng) && abs((float) $lat) <= 90 && abs((float) $lng) <= 180 && !((float) $lat == 0.0 && (float) $lng == 0.0);
}

/** Data satu perjalanan untuk peta/kartu: posisi terakhir, umur data GPS, jarak ke tujuan dan kampus. */
function info_perjalanan(array $r, ?array $kampus): array
{
    $r = rapikan_keluar($r);
    $ada = $r['pos_waktu'] !== '' && koordinat_valid($r['pos_lat'], $r['pos_lng']);
    $r['detik_lalu'] = $ada ? max(0, time() - strtotime($r['pos_waktu'])) : null;
    $r['gps_putus'] = $r['perjalanan'] === 'jalan' && ($r['detik_lalu'] === null || $r['detik_lalu'] > BATAS_GPS_DETIK);
    $r['jarak_tujuan'] = $ada && koordinat_valid($r['tujuan_lat'], $r['tujuan_lng']) ? (int) round(jarak_meter($r['pos_lat'], $r['pos_lng'], $r['tujuan_lat'], $r['tujuan_lng'])) : null;
    $r['jarak_kampus'] = $ada && $kampus ? (int) round(jarak_meter($r['pos_lat'], $r['pos_lng'], $kampus['lat'], $kampus['lng'])) : null;
    return $r;
}
