import re,json,time,shutil,os,sys
SRC='kaynak/atolye.html'; OUT='docs'
os.makedirs(OUT,exist_ok=True)
s=open(SRC).read()
def R(a,b,cnt=1):
    global s
    assert s.count(a)==cnt,(s.count(a),a[:100]); s=s.replace(a,b)
R('<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">','<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-180.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Atölye Defteri"><meta name="theme-color" content="#EDF1F7">')
R('<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>','<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>\n<script src="shim.js?v=__V__"></script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>')
# Claude'a özgü metinler
R("'Yapay zekâ bu görünümde kullanılamıyor. Uygulamayı Claude içinde açınca çalışır; Bugün ve Notlar sekmeleri yine kullanılabilir.'","'Yapay zekâ kullanılamıyor. Ayarlar > Yapay zekâ bölümünden Gemini anahtarını gir; Bugün ve Notlar sekmeleri yine kullanılabilir.'")
R("'Yapay zekâ kullanımına izin verilmedi. Sayfanın izinlerinden Claude\\'a izin verirsen asistan çalışır.'","'Gemini anahtarı girilmemiş ya da geçersiz. Ayarlar > Yapay zekâ bölümünden anahtarı gir.'")
R("t='Bu görünümde kullanılamıyor';s='Canlı yazıcı bilgisi yalnızca Mac’teki Claude uygulamasında, eklenti kuruluyken gelir. Oradan yazılan baskılar burada da görünür.'","t='Yazıcı bilgisi bekleniyor';s='Canlı bilgi atölyedeki bilgisayarda çalışan “Atölye Yazıcı” programından gelir.'")
R("t='Eklenti bulunamadı';s='Bu sayfayı Mac’teki Claude uygulamasında aç; “atolye-yazici” eklentisinin kurulu ve açık olduğunu denetle.'","t='Atölye bilgisayarından henüz bilgi yok';s='Atölyedeki bilgisayarda “Atölye Yazıcı” programının kurulu ve bilgisayarın açık olduğunu denetle.'")
s=s.replace('Canlı bilgi, eklentinin kurulu olduğu bilgisayarda (Mac ya da atölyedeki Asus) Claude açıkken gelir; geçmiş her yerden görünür.','Canlı bilgi atölyedeki bilgisayardaki “Atölye Yazıcı” programından gelir; geçmiş her yerden görünür.')
s=s.replace('Canlı bilgi, eklentinin kurulu olduğu bilgisayarda (Mac ya da atölyedeki Asus) Claude açıkken gelir. Aşağıda kaydedilmiş yazıcı geçmişi görünür.','Canlı bilgi atölyedeki bilgisayardaki “Atölye Yazıcı” programından gelir. Aşağıda kaydedilmiş yazıcı geçmişi görünür.')
s=s.replace('<div class="bk"><button type="button" class="btn" id="mvBtn">Yeni uygulamaya taşı (JSON indir)</button><span class="bk-last">Bağımsız uygulamada Ayarlar &gt; Yedekten içe aktar ile yüklenir.</span></div>','<div class="bk" hidden><button type="button" class="btn" id="mvBtn">JSON</button></div>')
ver=re.search(r"const VERSION='([0-9.]+)'",s).group(1); V=f"{ver}-{int(time.time())}"
s=s.replace('__V__',V)
open(f'{OUT}/index.html','w').write(s)
shutil.copy('kaynak/shim.js',f'{OUT}/shim.js')
json.dump({'v':V},open(f'{OUT}/version.json','w'))
json.dump({'name':'Atölye Defteri','short_name':'Atölye','start_url':'./','scope':'./','display':'standalone','background_color':'#EDF1F7','theme_color':'#EDF1F7','lang':'tr',
  'icons':[{'src':'icon-192.png','sizes':'192x192','type':'image/png'},{'src':'icon-512.png','sizes':'512x512','type':'image/png'},{'src':'icon-512.png','sizes':'512x512','type':'image/png','purpose':'maskable'}]},open(f'{OUT}/manifest.webmanifest','w'),ensure_ascii=False)
open(f'{OUT}/.nojekyll','w').write('')
print('built',V)
for sz in (180,192,512): shutil.copy(f'kaynak/icon-{sz}.png',f'{OUT}/icon-{sz}.png')
