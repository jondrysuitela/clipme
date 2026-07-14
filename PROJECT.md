buatkan sebuah aplikasi clipper , 1. Ringkasan Proyek

&#x20;   Bangun aplikasi desktop/lokal (jalankan di Windows 11, preferably web‑based UI) yang menerima sebuah URL YouTube, mengunduh video, menganalisis seluruh konten secara cerdas, secara otomatis mengeksegmen menjadi beberapa video short (maks 1 menit per clip), mengubah format menjadi 9:16, melakukan auto‑reframe pada pembicara, menambahkan subtitle menarik, menerapkan zoom otomatis pada momen penting, dan menghasilkan sekumpulan aset pendukung (judul, hook, deskripsi SEO, hashtag, tag, rekomendasi thumbnail, dan keyword). Setelah proses selesai, aplikasi menampilkan grid pratinjau klip yang telah diproses; pengguna memilih klip yang akan di‑upload (antrian upload dapat ditangani nanti). Kualitas output harus setara atau lebih baik daripada produk seperti Opus Clip, Klap, Vizard, Vidyo.ai, atau Submagic, dengan fokus utama pada eksekusi sepenuhnya lokal (tanpa dependensi pada layanan eksternal setelah unduhan video awal).







&#x20;   2. Alur Pengguna yang Diinginkan



&#x20;   Langkah: 1️⃣

&#x20;   Tindakan Pengguna: Masukkan URL YouTube (single link) ke dalam kolom input.

&#x20;   Tindakan Sistem: Validasi URL, mulai proses unduhan.

&#x20;   ────────────────────────────────────────

&#x20;   Langkah: 2️⃣

&#x20;   Tindakan Pengguna: (Opsional) Tentukan preferensi: panjang maksimal short (default 60 detik), jumlah maksimal clip yang diinginkan, atau filter momen (misal hanya “aha” \& “funny”).

&#x20;   Tindakan Sistem: Simpan preferensi untuk langkah analisis.

&#x20;   ────────────────────────────────────────

&#x20;   Langkah: 3️⃣

&#x20;   Tindakan Pengguna: Tunggu proses unduhan selesai.

&#x20;   Tindakan Sistem: Mengunduh video dengan kualitas tertinggi yang tersedia (mis. 1080p H.264/AAC) menggunakan alat seperti yt‑dlp; simpan file lokal.

&#x20;   ────────────────────────────────────────

&#x20;   Langkah: 4️⃣

&#x20;   Tindakan Pengguna: Tunggu fase analisis \& pemotongan.

&#x20;   Tindakan Sistem: - Transkripsi audio (Whisper atau setara). <br> - Deteksi wajah/pembicara (MediaPipe/OpenCV). <br> - Analisis visual (scene change, brightness, motion). <br> - Analisis audio (energi,

&#x20;     ketegangan, tawa, suara terangkat). <br> - Deteksi teks layar (OCR ringan bila perlu). <br> - Skor setiap segmen berdasarkan kriteria momen (Aha, Insight, Fakta mengejutkan, Lucu, Emosional,

&#x20;     Inspiratif, Kontroversial, Potensi viral, Hook, Retensi).

&#x20;   ────────────────────────────────────────

&#x20;   Langkah: 5️⃣

&#x20;   Tindakan Pengguna: Sistem menghasilkan beberapa kandidat short (mis. 3‑8 klip).

&#x20;   Tindakan Sistem: Setiap klip: <br>• Durasi ≤ 60 detik (bisa lebih pendek jika segmen kohésif). <br>• Di‑crop ke rasio 9:16 dengan auto‑reframe pada pembicara (tracking wajah/upper‑body). <br>• Subtitle

&#x20;     yang disinkronkan, gaya menarik (outline, shadow, atau background semi‑transparan). <br>• Zoom otomatis (slow‑push/zoom‑in) pada titik skor tertinggi dalam klip. <br>• Output codec H.264/AAC, resolusi

&#x20;     maks HD (1280×720 atau 720×1280 setelah rotasi), bitrate yang cukup untuk platform short (≈ 5‑8 Mbps).

&#x20;   ────────────────────────────────────────

&#x20;   Langkah: 6️⃣

&#x20;   Tindakan Pengguna: Tampilkan grid pratinjau klip (thumbnail + durasi + skor penting).

&#x20;   Tindakan Sistem: Pengguna bisa: <br>• Melihat pratinjau video (klik thumbnail → pemutaran inline). <br>• Melihat label otomatis (mis. “Aha moment”, “Funny”). <br>• Men‑and‑meng‑klip (menyesuaikan

&#x20;     awal/akhir) jika diperlukan. <br>• Memilih satu atau lebih klip untuk diproses lebih lanjut.

&#x20;   ────────────────────────────────────────

&#x20;   Langkah: 7️⃣

&#x20;   Tindakan Pengguna: Setelah pilihan, sistem menghasilkan aset pendukung untuk setiap klip yang dipilih.

&#x20;   Tindakan Sistem: - Judul yang menarik (≤ 100 karakter). <br>• Hook kalimat pembuka (≤ 15 kata). <br>• Deskripsi SEO (≤ 5000 karakter, termasuk CTA). <br>• Hashtag SEO (≤ 15 tag, relevan). <br>• Tag untuk

&#x20;     platform (YouTube Shorts, TikTok, IG Reels, FB Reels). <br>• Rekomendasi thumbnail (frame dengan skor tertinggi + overlay judul/hook). <br>• Daftar keyword SEO (5‑10 kata).

&#x20;   ────────────────────────────────────────

&#x20;   Langkah: 8️⃣

&#x20;   Tindakan Pengguna: (Untuk fase selanjutnya) Klip yang dipilih masuk antrian upload otomatis (tidak termasuk dalam prompt ini).

&#x20;   Tindakan Sistem: —







&#x20;   3. Fungsionalitas Wajib (Must‑Have)



&#x20;   1. Unduhan Video

&#x20;      - Mendukung URL YouTube standar (watch, youtu.be, embed).

&#x20;      - Memilih kualitas tertinggi yang tersedia (min 720p, pref 1080p).

&#x20;      - Menyimpan file sementara dalam folder aplikasi (bersih setelah selesai atau sesuai preferensi pengguna).



&#x20;   2. Transkripsi \& Pemahaman Konten

&#x20;      - Speech‑to‑text akurat (Whisper‑base atau model setara, berjalan lokal).

&#x20;      - Mendeteksi penutur, perubahan topik, dan penekanan emotif melalui prosodi.



&#x20;   3. Deteksi Momen Bernilai

&#x20;      - Skor kombinasi dari: <br> a. Semantik (kata kunci “however”, “therefore”, “surprisingly”, “amazing”). <br> b. Prosodia (ketinggian volume, kecepatan bicara, tawa). <br> c. Visual (ekspresi wajah, gerakan tangan, perubahan scene). <br> d. Tekstur audio (musik naik, ejekan, звуки efectos). <br> e. Retensi prediksi (berdasarkan tren penonton dari metadata video jika tersedia, atau model heuristik).

&#x20;      - Kelas momen yang harus dapat terdeteksi (minimal): Aha moment, Insight penting, Fakta mengejutkan, Momen lucu, Momen emosional, Momen inspiratif, Momen kontroversial, Potensi viral tinggi, Hook terbaik, Segmen dengan potensi retention tertinggi.



&#x20;   4. Pemotongan \& Penyesuaian Format

&#x20;      - Potong video sesuai rentang waktu yang dipilih berdasarkan skor momen (lebih dari satu klip per video diperbolehkan).

&#x20;      - Ubah aspect ratio ke 9:16 dengan auto‑reframe: tracking wajah/upper‑body, menjaga subjekt tetap di tengah frame.

&#x20;      - Jika subjek tidak terdeteksi, gunakan algoritma pemotongan tengah dengan padding blur atau background yang sesuai.



&#x20;   5. Subtitle

&#x20;      - Hasil transkripsi disegmentasikan sesuai klip,ディレイ < 200 ms.

&#x20;      - Gaya yang bisa dipilih (outline, shadow, background box) dengan ukuran font yang responsif terhadap lebar layar.

&#x20;      - Dukungan untuk multiple bahasa (optional) – setidaknya Bahasa Indonesia dan Inggris.



&#x20;   6. Zoom / Ken Burns Efek

&#x20;      - Deteksi titik fokus (wajah, objek yang disebut, teks layar) → terapkan zoom‑in/out perlahan (0.2‑0.5× skala) pada segmen skor tinggi.

&#x20;      - Efek halus, tidak causing artifacts.



&#x20;   7. Output Video

&#x20;      - Format: MP4 (H.264 video, AAC audio).

&#x20;      - Resolusi maks: 1280×720 (portrait) atau 720×1280 (setelah rotasi).

&#x20;      - Frame rate: pertahankan fps sumber (min 24 fps, max 60 fps).

&#x20;      - Bitrate: cukup untuk kualitas HD tanpa ukuran berlebihan (target 5‑8 Mbps).

&#x20;      - Tidak memerlukan re‑encode ekstra sebelum diunggah ke platform (ready‑to‑upload).



&#x20;   8. Gенерация Ассетов Pendukung

&#x20;      - Judul yang menarik (menggunakan kombinasi keyword + emosi + angka bila relevan).

&#x20;      - Hook yang kuat (kalimat pembuatan rasa penasaran atau sorpresa dalam 5‑8 kata pertama).

&#x20;      - Deskripsi SEO: ringkas, mengandung CTA, keyword utama, dan link sumber bila diizinkan.

&#x20;      - Hashtag \& Tag: relevan, tidak berulap, berdasarkan topik dan keyword terdeteksi.

&#x20;      - Rekomendasi thumbnail: frame dengan skor visual tertinggi + overlay teks (judul/hook) dengan kontras yang baik.

&#x20;      - Keyword SEO: daftar 5‑10 kata/phrase yang sesuai dengan konten dan tren pencarian.



&#x20;   9. Antarmuka Pratinjau (Grid)

&#x20;      - Tampilkan thumbnail tiap klip dalam grid (minimal 2‑kolom, scrollable).

&#x20;      - Setiap thumbnail menampilkan: durasi klip, label momen utama (mis. “Aha”, “Funny”), dan skor penting (0‑100).

&#x20;      - Klik thumbnail → pemutaran inline klip (dengan kontrol play/pause, seek).

&#x20;      - Checkbox atau toggle untuk memilih klip; tombol “Konfirmasi Pilihan” untuk melanjutkan ke pembuatan aset pendukung.

&#x20;      - Opsi untuk menyesuaikan awal/akhir klip (drag‑handle pada timeline mini) sebelum konfirmasi (opsional namun di‑rekomendasikan).



&#x20;   10. Lokal \& Privasi

&#x20;       - Semua proses setelah unduhan video berjalan sepenuhnya di mesin lokal (tidak mengirim frame, audio, atau transkripsi ke layanan eksternal kecuali bila pengguna secara eksplisit mengaktifkan opsi penggunaan model cloud untuk peningkatan akurasi – harus dapat di‑non‑aktifkan).

&#x20;       - Tidak menyimpan data pengguna di server luar; semua file sementara bersih setelah selesai atau dapat di‑arsipkan oleh pengguna.



&#x20;   11. Performance \& Stabilitas

&#x20;       - Memproses video hingga 2 jam panjang dalam waktu wajar (< 5× durasi video pada mesin dengan GPU modest; tanpa GPU masih dapat berjalan tetapi lebih lama).

&#x20;       - Penggunaan RAM ≤ 2 GB untuk video 1080p @ 30 fps (boleh lebih jika diperlukan).

&#x20;       - Menangani kegagalan halus (mis. download gagal, transkripsi error) dengan pesan error yang jelas dan opsi untuk mencoba lagi.

&#x20;       - Log aktivitas tersedia untuk debugging (opsional).



&#x20;   12. Kualitas Output (Benchmark)

&#x20;       - Hasil clip harus dapat ditandingi atau melebihi hasil dari Opus Clip, Klap, Vizard, Vidyo.ai, atau Submagic dalam aspek: <br> • Kejelasan hablur pembicara (auto‑reframe). <br> • Sinkronisasi subtitle. <br> • Kecocokan visual dan audio (zoom, cut). <br> • Daya tarik judul/hook/deskripsi.

&#x20;       - Uji dengan set data publik (mis. TED talks, podcast, video edukasi 10‑30 menit) dan bandingkan secara subjektif (skor 1‑5) maupun objektif (bitrate, kecekatan audio, persentase frame yang berisi wajah).







&#x20;   4. Asumsi \& Batasan yang Perlu Diketahui (untuk diposting ke pengguna bila diperlukan)



&#x20;   - Koneksi internet hanya diperlukan untuk unduhan video pertama dan, bila dipilih, unduhan model (Whisper, model deteksi wajah). Setelah itu semua proses dapat berjalan offline.

&#x20;   - Pengguna memiliki cukup ruang disk untuk menyimpan video sumber sementara (sekitar 2× ukuran video sumber untuk 1080p).

&#x20;   - Jika pengguna memilih untuk menggunakan model cloud (mis. OpenAI Whisper API), maka akan terjadi pengiriman audio ke layanan tersebut – perlu diskonfirmasi dan berlaku kebijakan privasi layanan tersebut.

&#x20;   - Aplikasi tidak membobol hak cipta; pengguna hanya boleh memproses video yang mereka miliki hak untuk mengubah/menggunakan (fair use, konten sendiri, atau dengan izin).

&#x20;   - Untuk fitur deteksi wajah, kecerahan cahaya sangat rendah atau sudut ekstrem dapat mengurangi akurasi auto‑reframe; dalam hal ini sistem kembali ke pemotongan tengah dengan latar belakang blur.







&#x20;   5. Risiko \& Tantangan Teknis (untuk dipertimbangkan nanti)



&#x20;   Risiko: Akurasi transkripsi pada lagu atau aksen berat

&#x20;   Dampak: Potensi miss‑deteksi momen, subtitle tidak sinkron

&#x20;   Mitigasi Potensial: Gunakan model Whisper large‑v2, tambahkan post‑processing punctuation, fallback ke VAD (voice activity detection) untuk segmentasi non‑speech.

&#x20;   ────────────────────────────────────────

&#x20;   Risiko: Deteksi wajah gagal (pose ekstrem, lighting rendah)

&#x20;   Dampak: Auto‑reframe tidak efektif → subjekt keluar frame

&#x20;   Mitigasi Potensial: Implementasi fallback: deteksi gerakan latar belakang + tracking objek umum (optical flow), atau pemotongan tengah dengan blur background.

&#x20;   ────────────────────────────────────────

&#x20;   Risiko: Penggunaan memori tinggi pada video sangat panjang (> 2 jam)

&#x20;   Dampak: Aplikasi crash atau lambat

&#x20;   Mitigasi Potensial: Proses video dalam chunk (mis. 5‑menit per chunk) dengan overlap untuk menjamin tidak memotong momen di tengah chunk.

&#x20;   ────────────────────────────────────────

&#x20;   Risiko: Lisensi model / kode pihak‑ke‑3

&#x20;   Dampak: Komplikasi distribusi

&#x20;   Mitigasi Potensial: Pilih model berlisensi permissif (MIT/Apache 2.0) seperti Whisper, MediaPipe, OpenCV; hindari proprietary API kecuali di‑opt‑in.

&#x20;   ────────────────────────────────────────

&#x20;   Risiko: Kepatuhan platform (YouTube, TikTok) terhadap konten yang di‑upload

&#x20;   Dampak: Risiko klaim hak cipta atau demonetisasi

&#x20;   Mitigasi Potensial: Tambahkan peringatan kepada pengguna mengenai hak cipta dan beri opsi untuk men‑include atribusi sumber bila diperlukan.

&#x20;   ────────────────────────────────────────

&#x20;   Risiko: Kompatibilitas UI web‑based di Windows 11 (Electron/Tauri)

&#x20;   Dampak: Performa UI kurang responsif

&#x20;   Mitigasi Potensial: Gunakan front‑end ringan (React/Vite + Tailwind) dengan kommunikasi ke backend lewat IPC atau WebSocket; uji pada berbagai resolusi layar.

&#x20;   ────────────────────────────────────────

&#x20;   Risiko: Variasi durasi source video (lebih dari 1 jam) menimbulkan terlalu banyak kandidat klip

&#x20;   Dampak: Overload UI, kesulitan pemilihan

&#x20;   Mitigasi Potensial: Batasi jumlah maksimum kandidat (mis. top 15 berdasarkan skor) dan beri filter oleh pengguna (minimal skor, jenis momen, durasi).







&#x20;   6. Kriteria Penerimaan (Acceptance Criteria)



&#x20;   Sebagai gantian dari “roadmap”, kriteria ini dapat digunakan untuk menilai bila prototype atau versi akhir telah selesai.



&#x20;   1. Fungsional Utama

&#x20;      - DenganInput URL YouTube (video panjang 5‑30 menit), sistem menghasilkan minimal 2 klip short yang masing‑masing ≤ 60 detik.

&#x20;      - Semua klip memiliki rasio 9:16, subtitle sinkron (±200 ms), dan subjek utama tetap di tengah 80% waktu (ukur via deteksi wajah).



&#x20;   2. Kualitas Output

&#x20;      - Bitrate video ≥ 4 Mbps (untuk 720p) dan audio ≥ 128 kbps AAC.

&#x20;      - Tidak ada artefak visual yang signifikan (blok, ghosting) lebih dari 2 frame berurutan.

&#x20;      - Subtitle memiliki kontras yang memenuhi standar WCAG AA (rasio kontras ≥ 4.5:1) untuk ≥ 80% waktu.



&#x20;   3. Deteksi Momen

&#x20;      - Untuk set data uji (5 video edukasi berdurasi 10‑20 menit), setidaknya 70% klip yang dipilih oleh sistem berisi minimal satu dari label momen yang telah ditentukan (Aha, Insicht, Fakta mengejutkan, Lucu, Emosional, Inspiratif, Kontroversial, Viral, Hook, Retention).

&#x20;      - Pengguna dapat men‑set ambang batas skor minimal; sistem hanya mengembalikan klip yang skor ≥ ambang.



&#x20;   4. Aset Pendukung

&#x20;      - Judul dan hook dibuat untuk setiap klip yang dipilih, panjangnya sesuai spesifikasi (judul ≤ 100 karakter, hook ≤ 15 kata).

&#x20;      - Deskripsi SEO mengandung minimal 3 keyword utama yang terdeteksi dalam transkrip.

&#x20;      - Hashtag dan tag relevan (kluster topik > 0,6 cosine similarity dengan vektor transkrip).

&#x20;      - Thumbnail rekomendasi menunjukkan frame dengan skor visual tertinggi dan menampilkan teks judul/hook dengan ukuran yang dapat dibaca.



&#x20;   5. Antarmuka Pratinjau

&#x20;      - Grid menampilkan thumbnail tiap klip dengan label dan skor.

&#x20;      - Pengguna dapat memutar klip dalam halaman tanpa membuka aplikasi eksternal.

&#x20;      - Pilihan klip dapat dibuat dan dibatalkan; hanya klip yang dipilih yang akan diteruskan ke pembuatan aset pendukung.



&#x20;   6. Lokal \& Privasi

&#x20;      - Tidak ada data audio/video yang ditransmisikan ke server eksternal kecuali bila pengguna secara eksplisit mengaktifkan opsi cloud model.

&#x20;      - Semua file sementara berada dalam folder aplikasi dan dapat dibersihkan via fitur “Bersihkan Cache”.



&#x20;   7. Kinerja

&#x20;      - Pada mesin dengan CPU 6‑core 2.5 GHz + GPU GTX 1650 (atau setara), pemrosesan video 15 menit selesai dalam ≤ 7 menit.

&#x20;      - Penggunaan puncak RAM tidak melebihi 2 GB untuk video 1080p @ 30 fps.



&#x20;   Jika seluruh kriteria di atas terpenuhi (atau dapat di‑justifikasi dengan alasan teknis yang dapat diterima), maka dapat dianggap bahwa proyek siap untuk fase selanjutnya (antrian upload, penambahan fitur lanjutan, atau rilis publik).

