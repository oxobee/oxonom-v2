# Oxonom V2 — AdisyonEx Mobil Patron Terminali

AdisyonEx bulut restoran POS altyapısı için özel olarak geliştirilmiş, **Velora UI** tasarım diline ve bileşen standartlarına sahip lüks mobil patron yönetim terminali ve PWA uygulaması.

## Özellikler
- **Velora UI Tasarım Standartları:** Velora Dock, Bento grid istatistik kartları, dairesel su dalgası (ripple) tema geçiş animasyonu.
- **Canlı PostgreSQL Bağlantısı:** Gerçek zamanlı veritabanı senkronizasyonu (Net ciro, nakit/kart dağılımı, masa dolulukları, personel vardiyaları, açık adisyonlar, anlık stok takibi).
- **Dinamik Firma Tespiti:** Giriş ekranında girilen telefon numarasına ait işletmeyi anlık tespit eden ve firmaya özel verileri yükleyen akıllı auth motoru.
- **Çoklu İşletme Desteği:** Tek tuşla kayıtlı işletmeler arasında anında geçiş (Ugur Burger, Kadıköy Bistro, Lezzet Döner).
- **PWA & Offline Desteği:** iOS Safari ve Android Chrome ile ana ekrana tam ekran uygulama olarak yüklenebilir.
- **Oxonom AI Restoran Asistanı:** Gün sonu tahminleri, saatlik yoğunluk analizleri ve stok uyarıları sağlayan yapay zeka paneli.

## Çalıştırma
```bash
npm install
npm start
```
Tarayıcınızda `http://localhost:4141/mobil/patron/` adresine gidin.
