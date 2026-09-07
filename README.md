Ściąga MG — Importer (moduł Foundry VTT)
Moduł do Foundry VTT v13 (D&D5e / Grim Hollow), hostowany na Forge VTT. Składa się z dwóch niezależnych narzędzi dostępnych z poziomu Dziennika (Journal), każde z własnym przyciskiem i własnym formatem wklejanego tekstu.
---
Narzędzie 1: „Import ściągi MG" → wpisy w Dzienniku Foundry
Tworzy prawdziwe Journal Entries w Foundry: ukryta strona „Notatki MG", opcjonalna widoczna „Karta gracza", opcjonalny ukryty „Portret". Dobre do rzeczy, które mają żyć w Dzienniku (NPC-e, lokacje, przedmioty jako osobne wpisy widoczne też graczom po odkryciu).
Format:
```
### ENTRY: Nazwa wpisu
TYPE: npc
IMAGE: sciezka/do/pliku.webp
--- MG ---
Notatki widoczne wylacznie dla MG. Markdown: **pogrubienie**, *kursywa*, listy przez "- ".
--- GRACZE ---
Opcjonalna sekcja — pomin calkowicie, jesli nic nie ma byc widoczne dla graczy.
### END
```
Reguły:
`TYPE:` = nazwa podfolderu w Dzienniku (dowolna, tworzy się automatycznie).
`IMAGE:` opcjonalne — tworzy ukrytą stronę „Portret"; GM odkrywa ją graczom natywnym przyciskiem Foundry „Show to Players".
`--- GRACZE ---` opcjonalne — pomiń całą sekcję, jeśli nic nie ma być widoczne graczom.
Wiele bloków `### ENTRY ... ### END` można wkleić naraz.
Ponowny import wpisu o tej samej nazwie aktualizuje go (nie duplikuje).
---
Narzędzie 2: „Sesje MG" → osobne okno do prep-notatek sesyjnych
Osobne, wyłącznie-dla-GM okno (nie Journal). Dane trzymane są jako lista „sesji", każda podzielona na dowolne kategorie (np. NPC, SCENY, HAKI FABULARNE, NAGRODY). W oknie jest zakładka „Sesje" (pełny widok każdego wpisu) plus jedna automatyczna zakładka na każdą unikalną nazwę kategorii, z wyszukiwarką na każdej zakładce.
Format:
```
### SESJA: Tytul sesji
## NazwaKategorii
dowolny tekst tej kategorii
## InnaKategoria
### Imie encji (opcjonalne)
POLE: wartosc
INNE_POLE: wartosc
IMAGE: sciezka/do/pliku.webp
Opis wolnym tekstem — to co NIE pasuje do wzorca POLE: wartosc konczy sekcje pol
### END
```
Dokładna gramatyka (ważne dla AI generującego ten tekst)
Blok sesji: zaczyna się linią `### SESJA: <dowolny tytuł>` (dokładnie trzy `#`), kończy linią `### END`. Wiele bloków sesji można wkleić w jednym imporcie.
Nagłówek kategorii: dokładnie `## ` (dwa `#`, spacja, nazwa) — nie trzy. Regex po stronie modułu to `^##(?!#)\s*(.+)$`, czyli linia zaczynająca się od `###` nigdy nie jest traktowana jako kategoria — to celowe zabezpieczenie, żeby podnagłówki encji (patrz niżej) się nie myliły z kategoriami.
Nazwa kategorii jest dowolna i swobodna — moduł sam tworzy zakładkę dla każdej unikalnej nazwy (dopasowanie bez rozróżniania wielkości liter i bez polskich znaków — np. „NPC" i „npc" trafiają do tej samej zakładki).
Podnagłówek encji wewnątrz kategorii: dokładnie `### ` (trzy `#`, spacja, imię/nazwa) — opcjonalny. Jeśli kategoria zawiera choć jeden taki podnagłówek, cała kategoria (we wszystkich sesjach o tej nazwie) renderuje się jako siatka klikalnych kart, posortowana alfabetycznie, zamiast zwykłej listy notatek.
Pola encji: linie na samym początku bloku `### Imię`, pasujące do wzorca `WIELKIE_LITERY: wartość` (dowolna nazwa pola, ale musi być pisana WIELKIMI LITERAMI, np. `WIEK:`, `RASA:`, `ZAWOD:`). Pierwsza linia, która nie pasuje do tego wzorca (i nie jest pusta), kończy sekcję pól — wszystko od niej w dół to opis (wolny tekst, markdown-lite).
`IMAGE:` jest polem specjalnym — nie trafia do zwykłych „pól", tylko do osobnego slotu na obrazek karty (widoczny w oknie szczegółów, z możliwością udostępnienia graczom).
Scalanie między sesjami: jeśli ten sam `### Imię` (dokładne dopasowanie tekstu, wielkość liter ma znaczenie) pojawi się w kilku sesjach, ostatnia wersja w kolejności zapisanych sesji całkowicie nadpisuje poprzednią (nie łączy się pole po polu — to podmiana całego rekordu).
Tekst przed pierwszym `###` w danej kategorii (albo cała zawartość kategorii, jeśli w ogóle nie użyto `###`) to notatka sesyjna — widoczna tylko w widoku tej jednej sesji (zakładka „Sesje"), nigdy nie trafia do zbiorczej karty encji. To właściwe miejsce na uwagi typu „nowa postać w tej sesji", które nie powinny zostać na stałe w karcie NPC.
Formatowanie tekstu (i w notatkach, i w opisach encji): obsługiwane jest tylko `**pogrubienie**`, `*kursywa*` i listy punktowane przez linie zaczynające się od `- `. Listy numerowane (`1. `, `2. `) nie są renderowane jako lista — zostają zwykłym tekstem z cyfrą na początku linii.
Ponowny import sesji o tym samym tytule (dokładne dopasowanie tekstu `### SESJA: Tytuł`) aktualizuje ją w całości (nie duplikuje).
---
Instrukcja dla AI porządkującego notatki GM do formatu importu
Jeśli dostajesz od użytkownika surowe, nieustrukturyzowane notatki z przygotowań do sesji (albo z research'u/burzy mózgów) i masz je przekształcić w tekst gotowy do wklejenia w „Sesje MG", trzymaj się ściśle poniższych zasad:
Zawsze zaczynaj blok od `### SESJA: <tytuł>` i zawsze kończ `### END`. Tytuł powinien być unikalny i stabilny — jeśli użytkownik później zechce zaktualizować tę samą sesję, musi użyć identycznego tytułu, więc nie zmieniaj konwencji nazewnictwa w trakcie (np. trzymaj się jednego stylu: „NUMER - Nazwa" albo „DATA - Nazwa", konsekwentnie).
Kategorie pisz WIELKIMI LITERAMI z dokładnie dwoma `#` (`## NPC`, `## SCENY`, `## HAKI FABULARNE`, `## NAGRODY` itd.) — nie wymyślaj nowych nazw kategorii bez potrzeby; jeśli użytkownik ma ustalony zestaw kategorii (np. z poprzednich sesji), używaj dokładnie tych samych nazw i tej samej pisowni, żeby trafiały do tej samej zakładki.
Dla NPC-ów i innych bytów, które mają żyć jako trwałe karty (postacie, potencjalnie lokacje/frakcje w przyszłości), zawsze używaj podnagłówka `### Imię` z dokładnie trzema `#`. Nigdy nie zostawiaj samego imienia jako zwykłego tekstu w kategorii NPC, jeśli intencją jest stworzenie karty — bez `###` dana postać nie trafi do siatki, tylko zostanie zwykłą notatką sesyjną.
Pola metadanych (WIEK, RASA, ZAWÓD, FRAKCJA, cokolwiek istotnego) pisz WIELKIMI LITERAMI z dwukropkiem, każde w osobnej linii, zaraz pod `### Imię`, przed opisem. Nie mieszaj pól z opisem — pierwsza linia opisowa (zdanie, nie `POLE: wartość`) musi przyjść dopiero po wszystkich polach, bo kończy ich rozpoznawanie.
`IMAGE:` dodawaj tylko wtedy, gdy użytkownik faktycznie wskazał plik/ścieżkę — nigdy nie wymyślaj ścieżki na wyczucie. Jeśli obrazu nie ma, po prostu pomiń tę linię.
Adnotacje sesyjne (np. „ta postać pojawia się pierwszy raz", „gracze jeszcze jej nie ufają w tej scenie") pisz jako zwykły tekst przed pierwszym `###` w danej kategorii tej sesji (albo w osobnej kategorii typu `## NOTATKI SESJI`) — nigdy w środku opisu encji, bo opis encji nadpisuje się przy każdej aktualizacji i taka adnotacja przepadnie albo zostanie na stałe błędnie przypisana do karty.
Aktualizacja istniejącej postaci: jeśli użytkownik mówi, że coś się zmieniło u znanej postaci (np. „Grum jest teraz ranny"), użyj dokładnie tego samego `### Imię` co poprzednio (identyczna pisownia, wielkość liter) — nowy opis całkowicie zastąpi stary przy imporcie.
Nie używaj list numerowanych, jeśli zależy Ci na ładnym renderowaniu — zamień je na listy przez `- ` (myślnik + spacja), bo tylko ten styl jest obsługiwany.
Nie wymyślaj treści — jeśli notatki użytkownika czegoś nie precyzują (np. rasy NPC), po prostu pomiń to pole zamiast zgadywać.
Na końcu zawsze pokaż użytkownikowi gotowy tekst w bloku kodu, żeby mógł go skopiować bezpośrednio do okna importu — nie opisuj go, tylko wygeneruj gotowy do wklejenia ciąg znaków zgodny z powyższą gramatyką.
---
Szybki checklist przed wklejeniem
[ ] Każdy blok sesji ma `### SESJA:` na początku i `### END` na końcu.
[ ] Kategorie mają dokładnie `## ` (nie `###`).
[ ] Encje (jeśli używane) mają dokładnie `### ` i są zagnieżdżone wewnątrz kategorii.
[ ] Pola encji (WIELKIE_LITERY:) są przed opisem, nie po nim ani między akapitami opisu.
[ ] Tytuły sesji i imiona encji, które mają się aktualizować, są zapisane identycznie jak poprzednio.
[ ] Listy używają `- `, nie `1. `.
