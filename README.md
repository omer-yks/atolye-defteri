# Atölye Defteri

3D baskı atölyesi için sipariş, baskı, depo, satış ve masraf defteri.

- **Uygulama:** `docs/` klasörü GitHub Pages ile yayınlanır. Veriler Supabase'te, her hesap yalnızca kendi verisini görür.
- **Kaynak:** `kaynak/atolye.html` (uygulamanın kendisi), `kaynak/shim.js` (Supabase, Gemini ve indirme katmanı).
- **Yayın:** `python3 build.py` → `docs/` yeniden oluşturulur; `main`'e gönderilince birkaç dakikada yayına çıkar ve açık uygulamalar kendiliğinden yenilenir.
- **Yazıcı servisi:** `yazici-servisi/` — atölyedeki Windows bilgisayarda yazıcıyı izleyip Supabase'e yazar. `ayarlar.json` gizli anahtar içerir ve depoya konmaz.
