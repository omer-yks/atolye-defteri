# Atölye Defteri — Claude Code notları

3D baskı atölyesi (for3D design / TRİ CORE) için sipariş, stok (filament), baskı, masraf ve satış defteri.
Kullanıcıyla **her zaman Türkçe** konuş. Arayüz sade olsun, animasyonlar yumuşak.

## Yapı
- `kaynak/atolye.html` — uygulamanın tamamı (tek dosya, vanilla JS). Asıl kod burada. İçinde `VERSION` ve `CHANGES` (sürüm notları) var; her değişiklikte sürümü artır, notu Türkçe ve kısa yaz.
- `kaynak/shim.js` — bağımsız uygulama katmanı: `window.claude.use('db'|'user'|'sample'|'downloads'|'mcp')` arayüzünü Supabase + Gemini ile sağlar. Giriş ekranı, Ayarlar ekleri (Gemini anahtarı, mikrofon testi, hesap, JSON içe aktarma), sürüm denetimi, sesle yazma (`window.__atlSTT`: MediaRecorder → WAV 16 kHz → Gemini).
- `build.py` — `kaynak/` → `docs/` (GitHub Pages). Claude'a özgü metinleri değiştirir, manifest/version.json yazar. **Her değişiklikten sonra `python3 build.py` çalıştır ve `docs/`'u da commit et.**
- `docs/` — yayınlanan site: https://omer-yks.github.io/atolye-defteri/ (main dalı, /docs). Açık uygulamalar version.json değişince kendiliğinden yenilenir.
- `masaustu/` — Mac uygulaması (Electron 45.1.0, electron-builder 26.18.0). Siteyi yükler; içerik güncellemeleri için yeniden kurulum gerekmez.
  - Program adı **ASCII olmalı** (`Atolye Defteri`); “ö” içeren ad Electron'u açılışta çökertiyordu. Görünen ad `CFBundleDisplayName` ile.
  - `.github/workflows/mac.yml` macOS'ta derler, ad-hoc imzalar, 25 sn açılış testi yapar, `mac-v<sürüm>` adıyla GitHub Release'e DMG koyar. Sürüm `masaustu/package.json` içinde.
  - Apple geliştirici imzası yok: ilk açılışta Sistem Ayarları → Gizlilik ve Güvenlik → “Yine de Aç”.
- `yazici-servisi/` — Windows (atölyedeki Asus) için Node servisi: Bambu yazıcıyı LAN'dan izler (SSDP, MQTT 8883, FTPS 990), durumu ve biten baskıları Supabase `printer_push` RPC'sine yollar. `kur.bat` ile kurulur; yerel durum sayfası http://127.0.0.1:47611.
  - `ayarlar.json` **gizli anahtar içerir, asla commit etme** (.gitignore'da). Örnek: `ayarlar.ornek.json`.

## Supabase (proje ref: cqfplrjpgmwougakadqv, eu-central-1, ücretsiz plan)
- `public.docs(owner uuid, col, id, data jsonb, updated_at)` — bütün defter; RLS: owner = auth.uid(). Koleksiyonlar: orders, sales, expenses, notes, library, settings, inv, customers, prints.
- `public.printer_jobs`, `public.printer_status` — yazıcı servisinden gelir; üyeler okur.
- `app_private.device_tokens`, `app_private.members`; RPC `printer_push(p_token,…)`, `printer_read(p_token,…)` (SECURITY DEFINER, token kontrollü).
- auth.users tetikleyicileri: ikinci hesap açılamaz (`only_first_user`), ilk hesap üye yapılır.
- Claude artifact'taki eski defterin verisi 14 Kasım 2026'da buraya taşındı (309 kayıt, birebir doğrulandı). Artık yalnızca bu uygulama kullanılıyor.

## Yapay zekâ
Gemini ücretsiz plan; anahtar her cihazda Ayarlar → Yapay zekâ'ya girilir (localStorage). Müşteri adları gönderilmeden önce “Müşteri N” takma adına çevrilir. Model sırası `AI_MODELS` (shim.js).

## Güvenlik kuralları
- Yazıcı cihaz anahtarı, Supabase oturum anahtarları, Gemini anahtarı ve kullanıcının e-postası hiçbir dosyaya/commit'e/çıktıya yazılmaz. Depo herkese açık.
- Parola ya da anahtar alanlarını kullanıcı doldurur.

## Açık işler
- Asus'a “Atölye Yazıcı” servisi henüz kurulmadı (Asus'ta Claude Code ile `yazici-servisi/` içinden kurulabilir; yazıcı IP ve erişim kodu kullanıcıdan alınır).
- Mac uygulamasında mikrofon: kullanıcı erişemediğini söyledi (1.0.1). Ayarlar → “Mikrofon ve sesle yazma” bölümündeki “Mikrofonu dene” sonucuna göre ilerle. Olası nedenler: Gemini anahtarı girilmemiş; macOS mikrofon izni (TCC) kapalı. `masaustu/main.js` izinleri `setPermissionRequestHandler` + `systemPreferences.askForMediaAccess` ile yönetiyor.
- İsteğe bağlı: Supabase panelinden yeni kayıtları kapatmak ve Site URL'yi https://omer-yks.github.io/atolye-defteri/ yapmak.

## Test
Playwright yüklüyse `docs/index.html` dosyası, supabase-js isteği sahte bir istemciyle değiştirilerek ve Gemini istekleri `page.route` ile taklit edilerek test edilebilir.
