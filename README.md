# WhyERP Print Bridge (EXE Windows)

Aplikasi kecil untuk Windows yang membuat **resi / karton packing langsung tercetak dari printer tanpa pop-up**.
Aplikasi web WhyERP akan mengirim data resi ke aplikasi ini (`http://127.0.0.1:8123`), dan aplikasi ini mencetak diam-diam (silent) ke printer default / printer yang dipilih.

## Cara Pakai

1. Jalankan `WhyERP-Print-Bridge.exe` (muncul ikon di system tray).
2. (Opsional) Klik kanan ikon tray → **Pilih Printer** untuk memilih printer tujuan (default: printer sistem).
3. Buka WhyERP dan lakukan packing seperti biasa. Saat resi / karton selesai, **langsung tercetak** — tidak ada pop-up lagi.
4. Jika aplikasi ini TIDAK berjalan, WhyERP otomatis kembali ke cara lama (pop-up cetak).

## Build EXE Sendiri

### Cara cepat (otomatis di GitHub)
1. Push repo ini ke GitHub.
2. Buka tab **Actions** → workflow **Build WhyERP Print Bridge EXE** → akan otomatis jalan saat ada perubahan di folder `print-bridge/`.
3. Download hasil dari **Artifacts** → `WhyERP-Print-Bridge` → `WhyERP-Print-Bridge.exe`.

Atau jalankan manual: Actions → Build WhyERP Print Bridge EXE → **Run workflow**.

### Cara lokal (perlu Windows / Node.js)
```bash
cd print-bridge
npm install
npm run dist        # hasil: dist/WhyERP-Print-Bridge.exe (portable, tanpa install)
# atau
npm run dist:nsis   # hasil: installer setup
```

## Menjalankan untuk Development
```bash
cd print-bridge
npm install
npm start
```

## Endpoint yang disediakan aplikasi
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/ping` | Cek apakah bridge berjalan |
| GET | `/printers` | Daftar printer terpasang |
| POST | `/print` | Kirim `{ "html": "<html>..." }` untuk dicetak langsung |

## Troubleshooting (EXE tidak muncul / tidak jalan di Windows)

1. **SmartScreen Windows** → saat pertama kali jalan, klik **More info → Run anyway**. Aplikasi belum ditandatangani sehingga Windows bisa memblokirnya.
2. **Aplikasi sudah berjalan tapi tidak terlihat** → aplikasi hanya punya ikon di system tray (panah `^` dekat jam). Klik `^` lalu cari ikon printer. Aplikasi tidak membuka jendela (kecuali ada error).
3. **Cek log** → semua aktivitas dan error tercatat di `logs.txt`:
   - Tekan `Win + R`, ketik `%APPDATA%\why-bridge-print\logs.txt`, Enter.
   - Atau klik kanan ikon tray → **Buka Log**.
4. **Port 8123 terpakai** → aplikasi otomatis mencoba port 8124–8130; lihat log untuk port aktual. Pastikan hanya satu instance yang jalan (kunci instance otomatis mencegah duplikat).
5. **Tray icon tidak muncul** → jika gagal membuat tray, aplikasi membuka jendela kecil berisi status + lokasi log agar tidak "hilang" diam-diam.
6. **Aplikasi versi lama** → Electron 31 butuh **Windows 10 1809 ke atas**. Upgrade Windows bila versinya lebih lama.