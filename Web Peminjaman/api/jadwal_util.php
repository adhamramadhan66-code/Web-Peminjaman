<?php
/**
 * Fungsi bersama untuk mengelola jadwal (dipakai api/peminjaman.php dan api/kuliah.php):
 * validasi isian, pencocokan nama ruang, dan impor massal dari Excel.
 *
 * Aturan impor (sengaja longgar soal bentrok):
 *   - Data asli TSU memang banyak bentrok (kegiatan di jam kuliah, dua kegiatan di ruang yang sama), jadi
 *     bentrok TIDAK membuat baris ditolak. Pengecekan bentrok hanya berlaku saat tambah/ubah satu per satu.
 *   - Baris yang sama persis dengan data yang sudah ada dilewati, sehingga mengimpor ulang berkas yang sama
 *     (mis. setelah menambah ruang yang tadinya belum ada) tidak membuat data ganda.
 *   - Baris bermasalah (ruang tidak dikenal, tanggal/jam tidak terbaca, dst.) dilewati dan dilaporkan dengan
 *     nomor barisnya, sedangkan baris lain tetap masuk.
 */

const MAKS_IMPOR = 5000;          // baris per sekali impor
const MAKS_HARI_RENTANG = 120;    // satu baris dengan rentang tanggal -> paling banyak sekian hari

function potong($v, int $maks): string
{
    $v = trim(preg_replace('/\s+/u', ' ', (string) $v));
    return mb_substr($v, 0, $maks);
}

function jam_valid($v): bool
{
    return is_string($v) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v) === 1;
}

function tanggal_valid($v): bool
{
    if (!is_string($v)) return false;
    $d = DateTime::createFromFormat('Y-m-d', $v);
    return $d && $d->format('Y-m-d') === $v;
}

/** Kunci pencocokan nama ruang: huruf kecil tanpa spasi/garis ("Lab 1" = "lab1" = "LAB-1"). */
function kunci_nama(string $s): string
{
    return preg_replace('/[\s_\-]+/u', '', mb_strtolower(trim($s)));
}

/** [kunci nama ruang => id elemen] untuk semua ruang di Editor Ruang. */
function peta_ruang(PDO $pdo): array
{
    $peta = [];
    foreach ($pdo->query("SELECT id, nama FROM elemen WHERE tipe = 'ruang' ORDER BY id") as $r) {
        $k = kunci_nama((string) $r['nama']);
        if ($k !== '' && !isset($peta[$k])) $peta[$k] = (int) $r['id'];
    }
    return $peta;
}

function tambah_menit(string $hhmm, int $menit): string
{
    [$h, $m] = array_map('intval', explode(':', $hhmm));
    $t = min(23 * 60 + 59, $h * 60 + $m + $menit);
    return sprintf('%02d:%02d', intdiv($t, 60), $t % 60);
}

/** 1 = Senin ... 7 = Minggu. Menerima angka 1-7 atau nama hari (juga singkatan). 0 bila tidak dikenal. */
function hari_dari_teks($v): int
{
    if (is_int($v) || is_float($v) || (is_string($v) && ctype_digit(trim($v)))) {
        $n = (int) $v;
        return ($n >= 1 && $n <= 7) ? $n : 0;
    }
    static $peta = [
        'senin' => 1, 'sen' => 1, 'selasa' => 2, 'sel' => 2, 'rabu' => 3, 'rab' => 3, 'kamis' => 4, 'kam' => 4,
        'jumat' => 5, 'jumaat' => 5, 'jum' => 5, 'sabtu' => 6, 'sab' => 6, 'minggu' => 7, 'ahad' => 7, 'min' => 7,
    ];
    $t = preg_replace('/[^a-z]/', '', mb_strtolower((string) $v));
    return $peta[$t] ?? $peta[preg_replace('/^hari/', '', $t)] ?? 0;   // "Hari Rabu" = "Rabu"
}

/** 'disetujui' | 'menunggu' | 'ditolak', atau null bila tidak dikenal. Kosong = disetujui. */
function status_dari_teks($v): ?string
{
    $t = preg_replace('/[^a-z]/', '', mb_strtolower(trim((string) $v)));
    if ($t === '') return 'disetujui';
    static $peta = [
        'disetujui' => 'disetujui', 'setuju' => 'disetujui', 'terjadwal' => 'disetujui', 'approved' => 'disetujui', 'selesai' => 'disetujui',
        'menunggu' => 'menunggu', 'pending' => 'menunggu', 'proses' => 'menunggu',
        'ditolak' => 'ditolak', 'tolak' => 'ditolak', 'batal' => 'ditolak', 'dibatalkan' => 'ditolak', 'cancel' => 'ditolak',
    ];
    return $peta[$t] ?? null;
}

function daftar_tanggal(string $dari, string $sampai): array
{
    $out = [];
    $d = new DateTime($dari);
    $akhir = new DateTime($sampai);
    while ($d <= $akhir) { $out[] = $d->format('Y-m-d'); $d->modify('+1 day'); }
    return $out;
}

function hasil_impor_kosong(int $dibaca, bool $uji): array
{
    return ['ok' => true, 'uji' => $uji, 'baris_dibaca' => $dibaca, 'baris_valid' => 0, 'tambah' => 0,
            'duplikat' => 0, 'gagal' => 0, 'jam_bawaan' => 0, 'rincian_gagal' => []];
}

/**
 * Impor kegiatan/peminjaman. $baris = daftar baris yang sudah dinormalkan browser:
 *   {baris, ruang, tanggal (Y-m-d), tanggal_asli, tanggal_akhir, mulai, selesai, peminjam, keperluan,
 *    peserta, fasilitas, status, catatan}
 * $uji = true -> hanya memeriksa (tidak menyimpan apa pun), dipakai untuk pratinjau.
 */
function impor_kegiatan(PDO $pdo, array $baris, bool $uji): array
{
    $ruang = peta_ruang($pdo);
    $hasil = hasil_impor_kosong(count($baris), $uji);
    $gagal = function (int $no, string $alasan) use (&$hasil): void {
        $hasil['gagal']++;
        if (count($hasil['rincian_gagal']) < 100) $hasil['rincian_gagal'][] = ['baris' => $no, 'alasan' => $alasan];
    };
    $cek = $pdo->prepare('SELECT 1 FROM peminjaman WHERE elemen_id = ? AND tanggal = ? AND mulai = ? AND selesai = ? AND LOWER(keperluan) = LOWER(?) LIMIT 1');
    $ins = $pdo->prepare('INSERT INTO peminjaman (elemen_id, tanggal, mulai, selesai, peminjam, keperluan, peserta, fasilitas, status, catatan, dibuat, pengguna_id)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)');
    $sudah = [];
    $sekarang = date('Y-m-d H:i:s');

    if (!$uji) $pdo->beginTransaction();
    try {
        foreach (array_values($baris) as $i => $b) {
            $no = is_array($b) ? (int) ($b['baris'] ?? ($i + 2)) : $i + 2;
            if (!is_array($b)) { $gagal($no, 'Format baris tidak valid.'); continue; }

            $namaRuang = potong($b['ruang'] ?? '', 80);
            if ($namaRuang === '') { $gagal($no, 'Ruang kosong.'); continue; }
            $idRuang = $ruang[kunci_nama($namaRuang)] ?? 0;
            if (!$idRuang) { $gagal($no, 'Ruang "' . $namaRuang . '" tidak ada di Editor Ruang.'); continue; }

            $tgl = (string) ($b['tanggal'] ?? '');
            if (!tanggal_valid($tgl)) {
                $asli = potong($b['tanggal_asli'] ?? '', 40);
                $gagal($no, $asli !== '' ? 'Tanggal tidak terbaca: "' . $asli . '".' : 'Tanggal kosong.');
                continue;
            }
            $tglAkhir = (string) ($b['tanggal_akhir'] ?? '');
            if ($tglAkhir === '') $tglAkhir = $tgl;
            if (!tanggal_valid($tglAkhir) || $tglAkhir < $tgl) { $gagal($no, 'Rentang tanggal tidak valid.'); continue; }
            if ((new DateTime($tgl))->diff(new DateTime($tglAkhir))->days + 1 > MAKS_HARI_RENTANG) {
                $gagal($no, 'Rentang tanggal lebih dari ' . MAKS_HARI_RENTANG . ' hari.');
                continue;
            }

            $mulai = trim((string) ($b['mulai'] ?? ''));
            $selesai = trim((string) ($b['selesai'] ?? ''));
            $catatan = potong($b['catatan'] ?? '', 255);
            $bawaan = '';
            if ($mulai === '' && $selesai === '') {
                $mulai = '08:00'; $selesai = '16:00';
                $bawaan = 'Jam tidak diisi di Excel, dianggap 08:00-16:00.';
            } elseif ($mulai === '') {
                $gagal($no, 'Jam mulai kosong.'); continue;
            } elseif ($selesai === '') {
                if (!jam_valid($mulai)) { $gagal($no, 'Jam mulai tidak valid: "' . potong($mulai, 20) . '".'); continue; }
                $selesai = tambah_menit($mulai, 180);
                $bawaan = 'Jam selesai tidak diisi di Excel, dianggap 3 jam setelah mulai.';
            }
            if (!jam_valid($mulai) || !jam_valid($selesai)) { $gagal($no, 'Jam tidak valid (' . potong($mulai, 20) . ' - ' . potong($selesai, 20) . ').'); continue; }
            if ($selesai <= $mulai) { $gagal($no, 'Jam selesai harus setelah jam mulai (' . $mulai . ' - ' . $selesai . ').'); continue; }
            if ($bawaan !== '') { $hasil['jam_bawaan']++; $catatan = potong($catatan . ' ' . $bawaan, 255); }

            $keperluan = potong($b['keperluan'] ?? '', 160);
            if ($keperluan === '') { $gagal($no, 'Nama kegiatan kosong.'); continue; }
            $peminjam = potong($b['peminjam'] ?? '', 80);
            $peserta = preg_match('/\d+/', (string) ($b['peserta'] ?? ''), $mm) ? min(9999, (int) $mm[0]) : 0;
            $fasilitas = potong($b['fasilitas'] ?? '', 255);
            $status = status_dari_teks($b['status'] ?? '');
            if ($status === null) { $gagal($no, 'Status tidak dikenal: "' . potong($b['status'] ?? '', 30) . '" (pakai disetujui / menunggu / ditolak).'); continue; }

            $hasil['baris_valid']++;
            foreach (daftar_tanggal($tgl, $tglAkhir) as $t) {
                $kunci = $idRuang . '|' . $t . '|' . $mulai . '|' . $selesai . '|' . mb_strtolower($keperluan);
                $ada = isset($sudah[$kunci]);
                if (!$ada) { $cek->execute([$idRuang, $t, $mulai, $selesai, $keperluan]); $ada = (bool) $cek->fetchColumn(); }
                if ($ada) { $hasil['duplikat']++; $sudah[$kunci] = true; continue; }
                if (!$uji) $ins->execute([$idRuang, $t, $mulai, $selesai, $peminjam, $keperluan, $peserta, $fasilitas, $status, $catatan, $sekarang]);
                $sudah[$kunci] = true;
                $hasil['tambah']++;
            }
        }
        if (!$uji) $pdo->commit();
    } catch (Throwable $e) {
        if (!$uji && $pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    return $hasil;
}

/**
 * Impor jadwal kuliah mingguan. Baris: {baris, ruang, hari (1-7 / nama hari), mulai, selesai, matkul,
 * pengajar, kelas, prodi}. Jam mulai dan selesai wajib ada (tidak ada jam bawaan seperti kegiatan).
 */
function impor_kuliah(PDO $pdo, array $baris, bool $uji): array
{
    $ruang = peta_ruang($pdo);
    $hasil = hasil_impor_kosong(count($baris), $uji);
    $gagal = function (int $no, string $alasan) use (&$hasil): void {
        $hasil['gagal']++;
        if (count($hasil['rincian_gagal']) < 100) $hasil['rincian_gagal'][] = ['baris' => $no, 'alasan' => $alasan];
    };
    $cek = $pdo->prepare('SELECT 1 FROM kuliah WHERE elemen_id = ? AND hari = ? AND mulai = ? AND selesai = ? AND LOWER(matkul) = LOWER(?) AND LOWER(kelas) = LOWER(?) LIMIT 1');
    $ins = $pdo->prepare('INSERT INTO kuliah (elemen_id, hari, mulai, selesai, matkul, pengajar, kelas, prodi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $sudah = [];

    if (!$uji) $pdo->beginTransaction();
    try {
        foreach (array_values($baris) as $i => $b) {
            $no = is_array($b) ? (int) ($b['baris'] ?? ($i + 2)) : $i + 2;
            if (!is_array($b)) { $gagal($no, 'Format baris tidak valid.'); continue; }

            $namaRuang = potong($b['ruang'] ?? '', 80);
            if ($namaRuang === '') { $gagal($no, 'Ruang kosong.'); continue; }
            $idRuang = $ruang[kunci_nama($namaRuang)] ?? 0;
            if (!$idRuang) { $gagal($no, 'Ruang "' . $namaRuang . '" tidak ada di Editor Ruang.'); continue; }

            $hari = hari_dari_teks($b['hari'] ?? '');
            if (!$hari) { $gagal($no, 'Hari tidak dikenal: "' . potong($b['hari'] ?? '', 20) . '" (Senin-Minggu).'); continue; }

            $mulai = trim((string) ($b['mulai'] ?? ''));
            $selesai = trim((string) ($b['selesai'] ?? ''));
            if ($mulai === '' || $selesai === '') { $gagal($no, 'Jam mulai/selesai kuliah wajib diisi.'); continue; }
            if (!jam_valid($mulai) || !jam_valid($selesai)) { $gagal($no, 'Jam tidak valid (' . potong($mulai, 20) . ' - ' . potong($selesai, 20) . ').'); continue; }
            if ($selesai <= $mulai) { $gagal($no, 'Jam selesai harus setelah jam mulai (' . $mulai . ' - ' . $selesai . ').'); continue; }

            $matkul = potong($b['matkul'] ?? '', 160);
            if ($matkul === '') { $gagal($no, 'Nama mata kuliah kosong.'); continue; }
            $pengajar = potong($b['pengajar'] ?? '', 160);
            $kelas = potong($b['kelas'] ?? '', 40);
            $prodi = potong($b['prodi'] ?? '', 120);

            $hasil['baris_valid']++;
            $kunci = $idRuang . '|' . $hari . '|' . $mulai . '|' . $selesai . '|' . mb_strtolower($matkul) . '|' . mb_strtolower($kelas);
            $ada = isset($sudah[$kunci]);
            if (!$ada) { $cek->execute([$idRuang, $hari, $mulai, $selesai, $matkul, $kelas]); $ada = (bool) $cek->fetchColumn(); }
            if ($ada) { $hasil['duplikat']++; $sudah[$kunci] = true; continue; }
            if (!$uji) $ins->execute([$idRuang, $hari, $mulai, $selesai, $matkul, $pengajar, $kelas, $prodi]);
            $sudah[$kunci] = true;
            $hasil['tambah']++;
        }
        if (!$uji) $pdo->commit();
    } catch (Throwable $e) {
        if (!$uji && $pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    return $hasil;
}
