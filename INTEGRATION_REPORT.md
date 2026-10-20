# INTEGRATION_REPORT — связка frontend ↔ backend

> **Статус: исправления из раздела 6 применены (кроме `.env`, см. раздел 8).** Хэши коммитов, проверки и что осталось — в разделе 8. Разделы 1–7 описывают состояние ДО исправлений.

Дата: 2026-10-20. Код проектов НЕ менялся (только этот отчёт). Секреты в отчёт не попали (токены в выводах заменены на `***`).
Живой прогон: `http://10.20.2.24:3001` (текущий LAN-адрес Mac, как с телефона), заголовки как у axios (`Content-Type: application/json`, `Authorization: Bearer …`). Тестовые пользователи `It*/G*` созданы заново, существующие не трогались. Скрипты прогона лежат вне репозитория: `/private/tmp/claude-501/-Users-vazira-Desktop-------/4b274102-5cc0-4a9b-a21b-e31e4ccd9fa3/scratchpad/int/{run.mjs,run2.mjs,receipt.jpg}`.

## Итог одной строкой

**Главное расхождение — не в коде API, а в адресе:** в `splitter-frontend-main/.env` стоит `172.20.10.2`, а Mac сейчас в сети `10.20.2.24`; этот старый адрес вшит в собранный бандл, и Metro запущен с ним же. Все остальные контракты сходятся; реальные дефекты: недействительный ключ Gemini (скан → 502), слабая проверка пароля на форме регистрации, нет R2 для аватаров, и несколько мелочей (раздел 4).

## 1. Базовый адрес и конфигурация (проверено запуском)

| Проверка | Результат | Доказательство |
|---|---|---|
| Где фронт берёт адрес | единственное место `src/features/auth/api/index.ts:6`: `process.env.EXPO_PUBLIC_API_URL \|\| 'http://localhost:3001'` | grep по `app/`, `src/`: других `localhost`/IP/портов нет (кроме флага `EXPO_PUBLIC_DEBUG_HISTORY`) |
| Значение в `.env` | `EXPO_PUBLIC_API_URL=http://172.20.10.2:3001` | `splitter-frontend-main/.env:1` |
| Текущий IP Mac | `10.20.2.24` (`ipconfig getifaddr en0`); интерфейса с `172.20.10.2` уже нет | `curl http://172.20.10.2:3001/health` → `000` (нет связи) |
| Адрес в бандле | ❌ `172.20.10.2` вшит (1 вхождение в `.hbc`), `10.20.2.24` — 0 | `grep -a` по экспортированному бандлу |
| Порт бэкенда | 3001 совпадает: `lsof` → `node *:3001` | — |
| Metro | запущен ранее с `REACT_NATIVE_PACKAGER_HOSTNAME=172.20.10.2` (QR тоже со старым адресом); порт 8081 слушает `*` | `lsof`, `ps` |
| `EXPO_PUBLIC_*` | Expo подставляет их на этапе сборки бандла, Metro читает `.env` при старте и кэширует трансформацию: после правки `.env` нужен перезапуск `npx expo start -c` | поведение Expo; подтверждено тем, что бандл содержит старый IP |
| Таймауты | ✅ `apiClient` 60 000 мс (`auth/api/index.ts:10`); `/sessions/scan` 120 000 мс (`receipt.api.ts:116`) — в требуемом диапазоне 90–120 с | чтение кода |
| Сервер слушает | ✅ `0.0.0.0` (`lsof`: `*:3001`); `/health` по `127.0.0.1` и `10.20.2.24` → 200 | curl |
| CORS | ✅ не мешает: запросы без `Origin` (React Native) пропускаются; `OPTIONS /auth/login` → 204 | curl |
| Лимит тела | ✅ `express.json` `4mb`: тело ~300 КБ, 2.5 МБ, 3.5 МБ, 3.9 МБ → разобрано (400 от самого маршрута, не 413); ~5 МБ → **413** `{"success":false,"error":"request entity too large","code":413}`. Реальное фото после сжатия фронтом (≤1280 px, JPEG 0.45) — десятки–сотни КБ, base64 тестового чека 79 КБ | живой запрос |
| Брандмауэр macOS | ✅ не блокирует: `Firewall is disabled`, `block all: disabled`, `stealth: off` | `socketfilterfw` |

Как проверить связь самому с телефона (брандмауэр на Mac выключен, значит блокировать может только сеть): открыть в Safari/Chrome на телефоне `http://10.20.2.24:3001/health` → должно показать `{"status":"ok"}`. Не открывается — телефон и Mac в разных сетях или Wi‑Fi изолирует клиентов (гостевая сеть/«изоляция AP»); тогда либо точка доступа с телефона, либо `npx expo start --tunnel` для Metro (бэкенду всё равно нужен достижимый адрес).

## 2. Карта контрактов и живая сверка

Статус: ✅ совпадает и проверено запуском; ⚠️ работает, но есть замечание; ❌ расхождение; ❓ не проверено запуском (только чтение кода).

### 2.1 Auth / user / uploads

| Эндпоинт (фронт → бэк) | Фронт ожидает | Бэк отдаёт | Статус | Доказательство |
|---|---|---|---|---|
| `POST /auth/register` {username,email,password} (`RegisterForm`) | `{token, user{id,email,username,uniqueId,avatarUrl}}` | `{token, user{id,email,username,uniqueId}}` — без `avatarUrl` | ⚠️ | 200. Поле отсутствует (undefined вместо null), UI это переживает; `auth.ts:184` |
| `POST /auth/login` {email,password} | то же + `avatarUrl` | `{token,user{…,avatarUrl:null}}`; неверный пароль → **400** `{"error":"Invalid email or password"}` | ✅ | 200 / 400; фронт показывает `data.error` |
| `GET /auth/me` | `User` плоский объект | `{id,email,username,uniqueId,avatarUrl}` | ✅ | 200; без токена 401 `{"error":"Authorization required"}` |
| `POST /auth/logout` (`auth/api/index.ts:161`) | — | **маршрута нет** → 404 HTML | ⚠️ | функция нигде не вызывается (`logout()` в `profile.tsx:692` — действие стора, не API) → мёртвый код |
| `PATCH /user/username` {username} | `User` | `User` плоский | ✅ | 200 |
| `PATCH /user/email` {email} | `User` | `User` плоский | ✅ | 200 |
| `PATCH /user/password` {currentPassword,newPassword} | 2xx | `{success:true}`; неверный текущий → 400 `{"error":"Current password is incorrect"}` | ✅ | 200 / 400 |
| `PATCH /users/me/avatar` {avatarUrl} | `User\|null` (иначе дозапрос `/auth/me`) | `{success,avatarUrl}` (не `User`) | ⚠️ | 200. `updateAvatar` (`auth/api/index.ts:204–207`) вернул бы `{success,avatarUrl}` как `User`, но функция нигде не вызывается (профиль использует `uploadAvatar`/`resetAvatar`) |
| `DELETE /users/me/avatar` | `User\|null` | `{success:true,avatarUrl:<placeholder>}` | ❌ | 200. `resetAvatar` (`auth/api/index.ts:261`) возвращает этот объект как `User`, и `profile.tsx:533–535` делает `setUser(updatedUser)`: в сторе остаются только `success` и `avatarUrl` (без `id`, `username`, `email`, `uniqueId`), аватар становится placeholder‑URL вместо `null`. Дальше ломаются все места, где нужен `user.uniqueId` (участники, расчёты «кто кому должен»). Доказательство — чтение кода + живой ответ; на устройстве ❓ |
| `POST /uploads/avatar` multipart `file` | `{success,avatarUrl,key}` | без R2-ключей → **500** `{"error":"Server error"}` (в логе: `R2 config missing`) | ❌ (нужны R2‑ключи) | 500; код ответа при корректных ключах не проверен ❓ |
| `GET /users/:id`, `PATCH /user/update`, `DELETE /user/delete`, `GET /user/list` | не вызываются | есть | — | неиспользуемые маршруты |

### 2.2 Friends

| Эндпоинт | Фронт ожидает | Бэк отдаёт | Статус | Доказательство |
|---|---|---|---|---|
| `GET /friends/search?q=<uniqueId>` | `[{…}]` по zod `ZUserLoose` | `[{id,email,username,uniqueId,avatarUrl}]` | ✅ | 200; **zod OK** на реальном ответе |
| `POST /friends/request` {uniqueId} | произвольный | `{success,action:"requested",id}` | ✅ | 200 |
| `GET /friends/requests` | `{incoming:[{id,from{id,…}}], outgoing:[…]}` | точно такая форма; `outgoing[].to` | ✅ | 200; **zod OK** для B (incoming) и A (outgoing) |
| `PATCH /friends/accept` {uniqueId:<свой>, requesterId:<from.id>} | произвольный | `{success,id}` | ✅ | 200; фронт шлёт ровно эти поля (`RequestList.tsx:94`, `friends.api.ts:54`) |
| `PATCH /friends/reject` | то же | то же по коду | ❓ | не вызывался |
| `GET /friends` | массив по `ZFriendLoose` (`avatarUrl: z.string().optional()`) | `[{id,email,username,uniqueId,avatarUrl:<строка>}]` | ✅⚠️ | 200, **zod OK**; но схема не допускает `null` для `avatarUrl` — упадёт, если бэк когда-либо вернёт null (сейчас подставляет placeholder) |
| `DELETE /friends/:uniqueId` (url-encoded `#`) | `{success\|removed}` | по коду | ❓ | не вызывался |
| `POST /friends/invite` {expiresInSeconds} | `{token,url,expiresAt}` | ровно так, `url` вида `http://<host>:3001/friends/join?token=…` | ✅ | 200. `url` строится из адреса запроса — зависит от того, по какому адресу пришёл клиент |
| `POST /friends/join` {token} | 200 | по коду | ❓ | не вызывался |

### 2.3 Groups

| Эндпоинт | Фронт ожидает | Бэк отдаёт | Статус | Доказательство |
|---|---|---|---|---|
| `POST /groups` {name} | `Group` | `{id,name,ownerId,createdAt}` | ✅ | 200 |
| `GET /groups` | `Group[]` (`counts.members`, `members[]`) | `[{…,counts{members,sessions},members[…owner first]}]` | ⚠️ | 200; `counts.members` **не включает владельца** (0 при одном участнике-владельце; 2 при владельце + 2 участниках), а `members.length` включает → UI «N members» может расходиться с реальностью (`groups.ts:168`) |
| `GET /groups/:id` | `{group,members,role}` | точно такая форма | ✅ | 200 |
| `POST /groups/:id/members` {uniqueId} | `{success}` | `{success:true}` | ✅ | 200 |
| `PATCH /groups/:id` {name} | `Group` | `{id,name,ownerId,createdAt}` | ✅ | 200 |
| `DELETE /groups/:id/members/:uniqueId` (`%23`) | `{success}` | `{success:true,removed:true}` | ✅ | 200 |
| `PATCH /groups/:id/members/:uniqueId/promote` | `{success}` | `{success:true,transferred:true}` — это **передача владения**, после неё прежний владелец получает 403 на invite/delete | ⚠️ | 200; UI‑вызова `promote` в экранах нет (grep) → риск только если появится кнопка |
| `POST /groups/:id/invite` {expiresInSeconds} | `{token,url,expiresAt}` | так и есть | ✅ | 200 |
| `POST /groups/join` {token} | 200 | `{joined:true,friendship:"created",member:"created"}` (заодно создаёт дружбу с владельцем) | ✅ | 200 |
| `GET /groups/lookup` | не вызывается | недостижим: маршрут объявлен **после** `GET /:groupId` (`groups.ts:218` vs `:320`) → 400 `Invalid groupId` | ⚠️ | мёртвый маршрут |
| `POST /groups/:id/leave` | не вызывается | есть | — | — |

### 2.4 Sessions

| Эндпоинт | Фронт ожидает | Бэк отдаёт | Статус | Доказательство |
|---|---|---|---|---|
| `POST /sessions/scan` {sessionName,language,image{mimeType,data}} | `{sessionId,sessionName,language,items[{id,name,unitPrice,quantity,totalPrice,kind}],summary{grandTotal,currency},source}` | с настоящим JPEG (59 КБ) → **502** `{"error":"Could not recognize the receipt…"}` | ❌ (ключ Gemini недействителен) | лог сервера: `HTTP 401 API key not valid` на всех моделях (UNAUTHENTICATED). Форма успешного ответа проверена ранее, до ключа (mock): совпадает ✅. Реального распознавания **не было** ❓ |
| `POST /sessions/finalize` | `{sessionId,sessionName,status,createdAt,payer?,totals{grandTotal,currency,byParticipant[{uniqueId,username,amountOwed}],byItem},allocations[]}` | полностью эта форма + `payer{uniqueId,username}` | ✅ | 200; сумма 20.00 = items; чужой аккаунт → 403 (раньше) |
| `GET /sessions/history?all=false&limit=10` | `{scope,count,limit,entries[{sessionId,sessionName,finalizedAt,grandTotal(number),currency,participantUniqueIds,isCreator,payer,payload}]}` | точно такая форма; участник (не создатель) видит запись с `isCreator:false` | ✅ | 200 для A и B |
| `POST /sessions`, `GET /sessions`, `PATCH /sessions/:id/close` | не вызываются | есть | — | сессию создаёт `/scan`; для прогона без Gemini использован `POST /sessions` |

Коды ошибок, которые фронт различает (`auth/api/index.ts:72+`): 401 → логаут; 422 → не бывает на бэке (мёртвая ветка); 5xx/прочее → текст из `data.error`. Бэк отдаёт `{error}` (а `errorHandler` для 413 — `{success,error,code}`) — фронт читает `data.message || data.error` ✅. 403/404/409/400 показывают серверный текст (английский). 502/503 от OCR — серверный текст ✅. Тайм-аут/нет сети — переведённые `ApiError`.

## 3. Авторизация (чтение кода + живые 401)

- Токен хранится в SecureStore (`token-storage.ts`), на web — AsyncStorage; интерцептор запроса при каждом вызове читает его и ставит `Authorization: Bearer …` ✅.
- 401 → `emitUnauthorized()` → `logout()` (удаляет токен) → `router.replace('/')`. Бесконечного цикла нет: `/auth/login` и `/auth/register` на ошибки отвечают 400/409/415, а не 401. ⚠️ Если одновременно уходят несколько запросов (главная + друзья + группы) и токен просрочен, `emitUnauthorized` сработает несколько раз → лишние `logout`/`replace` (безвредно, но шумно).
- После моих правок: `ApiError` (`kind`,`status`); автологин (`initializeAuth`) удаляет токен только при `status === 401` (раньше — по английскому слову «authorization»); при старте без сети токен сохраняется, профиль подтянется позже ✅ (код). Splash ждёт чтения токена, не сети ✅.
- ⚠️ Латентное: `history.api.ts:196` проверяет `error.code === 'ERR_CANCELED'`, но интерцептор превращает любую ошибку в `ApiError` без `code` (так же, как и старый код превращал в `Error`) → отмена запроса показалась бы как «нет соединения». Сейчас отмена не вызывается (`cancelCurrentRequest` нигде не используется) — риск нулевой, но проверка мёртвая.

## 4. Несовпадения по приоритету

**P0 — в Expo Go ничего не заработает**
1. `splitter-frontend-main/.env:1` — устаревший IP `172.20.10.2` (сейчас `10.20.2.24`), вшит в бандл и в QR запущенного Metro. Приложение получит «нет соединения» на всех запросах.

**P1 — ломает функцию**
2. `POST /sessions/scan` → 502 для любого изображения: недействительный `GEMINI_API_KEY` (`HTTP 401 API key not valid`). Плюс бэкенд перебирает все ~10 моделей даже при 401 (бессмысленно, до 40 с на больших телах) — `receiptParser.ts:372`.
3. `resetAvatar`/`updateAvatar` ждут `User`, бэк (`/users/me/avatar` PATCH/DELETE) отдаёт `{success,avatarUrl}`: в `profile.tsx:533` стор получит объект без `id/username/…` (`auth/api/index.ts:204,261`).
4. `RegisterForm.tsx:22` — пароль `min(6)`, а бэк требует ≥8 + заглавная + строчная + цифра + спецсимвол (`validation.ts`): пароль вроде `abcdef` проходит форму и получает серверный 400 на английском.
5. `POST /uploads/avatar` → 500 «Server error» без R2‑ключей; пользователь не понимает причину (`uploads.ts:146`).

**P2**
6. `counts.members` без владельца (`groups.ts:168`).
7. `GET /groups/lookup` недостижим (порядок маршрутов, `groups.ts:218/320`).
8. `register` не возвращает `avatarUrl` (`auth.ts:184`).
9. Мёртвый код: `logout()` в `auth/api/index.ts:161` (маршрута нет), ветка `422`, проверка `ERR_CANCELED`.
10. `ZFriendLoose.avatarUrl` не допускает `null` (`friends.api.ts:19`).
11. Серия 401 вызывает несколько `logout` (`auth-events.ts`).
12. `PATCH /groups/…/promote` = передача владения (осторожно при добавлении UI).

## 5. Проверено запуском / только чтением

**Запуском:** `/health` по loopback и LAN; запись адреса в бандле; слушающие порты и брандмауэр; регистрация A/B/C, логин, `/auth/me` (в т.ч. 401), `/user/username|email|password`, `/users/me/avatar` PATCH/DELETE, `/friends/search|request|requests|accept|invite|list` (с zod фронта на реальных ответах), `/groups` (create, list, details, add member, rename, invite, delete member, join, promote), `/sessions/scan` (502, причина в логе), `/sessions` (create), `/sessions/finalize`, `/sessions/history` (создатель и участник), `/uploads/avatar` (500), лимит тела 300 КБ…5 МБ, CORS preflight; `tsc` обоих (0 ошибок); `npm test` бэка 6/6 и фронта 16/16; `expo-doctor` 18/18; `expo export --platform android` (8.27 MB); `eslint` 0 ошибок / 37 предупреждений.

**Только чтением кода:** поведение 401/логаута на устройстве, интерцепторы, формы, `friends/reject`, `DELETE /friends/:id`, `friends/join`, отмена запросов, мультиформ‑аплоад на React Native (`Content-Type: multipart/form-data` без boundary задан вручную, `auth/api/index.ts:189` ❓), общий тип‑контракт (фронт и бэк **не делят типы**, описаны вручную в двух местах; расхождений в проверенных эндпоинтах не найдено).

**Не проверено ❓:** распознавание настоящего чека (нет рабочего ключа), загрузка аватара в R2, Expo Go на устройстве.

## 6. Предлагаемые исправления (НЕ применены)

```diff
# 1) splitter-frontend-main/.env  (локальный файл, не в git)
-EXPO_PUBLIC_API_URL=http://172.20.10.2:3001
+EXPO_PUBLIC_API_URL=http://10.20.2.24:3001
# затем: остановить Metro и запустить  npx expo start -c  (-c чистит кэш, иначе остаётся старый адрес)
```

```diff
# 2) splitter-backend-main/src/services/receiptParser.ts  (~строка 372, catch цикла по моделям)
     } catch (err: any) {
       lastError = err;
       const status = err?.status || err?.statusCode;
+      // an invalid/forbidden key will fail identically on every model: stop early
+      if (status === 401 || status === 403) {
+        console.error("[parseReceipt] Gemini rejected the API key (HTTP " + status + ")");
+        throw new ReceiptParseError(
+          "Receipt recognition is misconfigured on the server (invalid API key)",
+          503
+        );
+      }
```
(у `generateViaRest` статус в `err.status` — проверить перед применением на реальном 401; в логе строка `HTTP 401 (401)` показывает, что код доступен.)

```diff
# 3) splitter-frontend-main/src/features/auth/ui/RegisterForm.tsx:22  (то же правило, что на сервере)
-  password: z.string().min(6, 'Password must be at least 6 characters'),
+  password: z
+    .string()
+    .min(8, 'Password must be at least 8 characters')
+    .regex(/[A-Z]/, 'Password must include an uppercase letter')
+    .regex(/[a-z]/, 'Password must include a lowercase letter')
+    .regex(/\d/, 'Password must include a number')
+    .regex(/[^A-Za-z0-9]/, 'Password must include a special character'),
# (сообщения лучше вывести через t('settings.password.error*'), ключи уже есть)
```

```diff
# 4) splitter-frontend-main/src/features/auth/api/index.ts  — resetAvatar/updateAvatar: бэк возвращает {success,avatarUrl}, а не User
 export async function resetAvatar(): Promise<User> {
-  const response = await apiClient.delete<User | null>('/users/me/avatar');
-  if (response.data) {
-    return response.data;
-  }
-  return getCurrentUser();
+  await apiClient.delete('/users/me/avatar');
+  return getCurrentUser();
 }
# и то же для updateAvatar (строки ~204–207)
```

```diff
# 5) splitter-backend-main/src/routes/uploads.ts:144-147
     } catch (err) {
       console.error("POST /uploads/avatar error:", err);
-      res.status(500).json({ error: "Server error" });
+      if (err instanceof Error && err.message.startsWith("R2 config missing")) {
+        res.status(503).json({ error: "Avatar storage is not configured on the server" });
+        return;
+      }
+      res.status(500).json({ error: "Server error" });
       return;
     }
```

```diff
# 6) splitter-backend-main/src/routes/groups.ts:168  — считать владельца в counts.members
-        counts: { members: g._count.members, sessions: g._count.sessions },
+        counts: { members: members.length + 1, sessions: g._count.sessions },
# где members.length = число записей без владельца; либо использовать [ownerEntry, ...memberEntries].length
```

```diff
# 7) splitter-backend-main/src/routes/groups.ts  — перенести router.get("/lookup", …) (строка 320) выше router.get("/:groupId", …) (строка 218), либо удалить маршрут, если он не нужен
```

```diff
# 8) splitter-backend-main/src/routes/auth.ts:184  (register)
         uniqueId: user.uniqueId,
+        avatarUrl: user.avatarUrl ?? null,
```

```diff
# 9) splitter-frontend-main/src/features/auth/api/index.ts:161 — удалить мёртвую logout() (POST /auth/logout отсутствует на бэке)
```

```diff
# 10) splitter-frontend-main/src/features/friends/api/friends.api.ts:19
-  avatarUrl: z.string().optional(),
+  avatarUrl: z.string().nullish(),
```

```diff
# 11) splitter-frontend-main/src/shared/api/auth-events.ts — выдавать событие один раз за серию 401
+let emitting = false;
 export function emitUnauthorized(): void {
+  if (emitting) return;
+  emitting = true;
+  setTimeout(() => { emitting = false; }, 1500);
   unauthorizedListeners.forEach((listener) => {
```

```diff
# 12) splitter-frontend-main/src/features/auth/api/index.ts (интерцептор ответа) — отмена запроса как отдельный тип, чтобы работала проверка в history.api.ts
+import axios from 'axios';
 ...
 (error: AxiosError<any>) => {
+  if (axios.isCancel(error)) throw new ApiError('Request cancelled', 'unknown');
# и в history.api.ts:196 проверять error.message === 'Request cancelled' || error.code === 'ERR_CANCELED'
```

Дополнительно (рекомендация, не diff): завести `scripts/dev.sh`, который берёт `ipconfig getifaddr en0`, пишет `EXPO_PUBLIC_API_URL` в `.env` и запускает `REACT_NATIVE_PACKAGER_HOSTNAME=<ip> npx expo start -c`, — тогда смена сети (а она у вас уже менялась дважды) не ломает связку.

## 7. Что запускать

```bash
cd /Users/vazira/Desktop/коворк/splitter-frontend-main && export PATH=$HOME/.local/node/bin:$PATH && IP=$(ipconfig getifaddr en0) && echo "EXPO_PUBLIC_API_URL=http://$IP:3001" > .env && REACT_NATIVE_PACKAGER_HOSTNAME=$IP npx expo start -c
```
(бэкенд и PostgreSQL должны уже работать: `curl http://$IP:3001/health`). **На телефоне:** подключиться к той же сети, что и Mac, открыть в браузере `http://<IP Mac>:3001/health` (должно быть `{"status":"ok"}`), затем отсканировать QR в Expo Go. Не забудьте, что скан чека заработает только после замены `GEMINI_API_KEY` на действительный ключ.


## 8. Применённые исправления (ветка fix/stage-2)

После каждого шага запускалось: `tsc --noEmit` (бэкенд и фронт), `npm test` (оба), `expo-doctor`, `expo export --platform android` — на всех шагах без падений.

| № раздела 6 | Что сделано | Коммит | Проверено запуском |
|---|---|---|---|
| 2 | Gemini 401/403 → сразу 503 «invalid API key», без перебора моделей | `9dd2b3d` | Живой запрос с реальным JPEG: 503 за ~0.8 с, в логе одна модель (раньше 502 после перебора всех) |
| 3 | Пароль на форме регистрации = правило сервера (8+, A-Z, a-z, цифра, спецсимвол); сообщения en/ja/uz | `0bdb6b1` | 2 unit‑теста, включая сверку с копией серверного правила на 13 паролях; тест паритета локалей |
| 4 | `resetAvatar`/`updateAvatar` возвращают полный профиль через `getCurrentUser()` (`profile.tsx` проверен: `setUser(updatedUser)`) | `aa6ec70` | Живой: DELETE avatar отвечает `{success,avatarUrl}`, `/auth/me` после этого — полный объект с `avatarUrl: null` |
| 5 (бэк) | `/uploads/avatar` без R2 → 503 «Avatar storage is not configured» (типизированная `R2NotConfiguredError`) | `25c0355` | Живой: 503; без файла по‑прежнему 400 |
| 5 (фронт) | Понятное переведённое сообщение при 503 в профиле | `68267f4` | `tsc`, бандл; на устройстве ❓ |
| 6 | `counts.members` включает владельца | `8061829` | Живой: владелец один → 1, владелец + участник → 2 (= длина `members[]`) |
| 8 | `/auth/register` возвращает `avatarUrl: null` | `eaf61b3` | Живой: ключи ответа `id,email,username,uniqueId,avatarUrl` |
| 10 | `ZFriendLoose.avatarUrl` → `z.string().nullish()` | `6a15f74` | `tsc`, бандл |
| 7 | `/groups/lookup` — фронт не использует (grep), поэтому **удалён** (не перенесён) | `4a1afa4` | Живой: теперь запрос попадает в `/:groupId` (400), как и любой несуществующий путь |
| 9 | Удалены мёртвые `logout()` (нет `POST /auth/logout`), ветка 422 и ключ `errors.validation` | `e2f121e` | `tsc`, паритет локалей |
| 11 | Защита от повторных logout: один сигнал 401 за 1.5 с, сброс при входе | `450994f` | 3 unit‑теста (всплеск, после паузы, сброс) |
| 12 | Отмена запроса (`axios.isCancel`) → `ApiError` с `kind: 'cancelled'`; `history.api.ts` его распознаёт | `b4fb210` | Тест на настоящем отменённом запросе axios + хелперы |
| (доп.) | `npm run dev:lan`: подставляет текущий IP в `EXPO_PUBLIC_API_URL` (меняется только эта строка `.env`) и запускает `expo start -c` | `9c2ae84` | 5 unit‑тестов на правку `.env` и выбор IP; dry‑run на копии: `172.20.10.2 → 10.20.2.24`, остальные строки целы, бэкенд опрошен; реальный `.env` скриптом не менялся |
| (доп.) | README: как узнать IP, `.env`, запуск бэкенда и Expo, что делать при смене сети; Node 22; описание 503/502 и `ALLOW_MOCK_OCR` | `ac0447e` | — |

**Пункт 1 (`.env`)** я не применял: вы просили не перезаписывать файл. Сейчас в нём уже стоит `http://10.20.2.24:3001` (совпадает с текущим `ipconfig getifaddr en0`), а при смене сети адрес надёжно обновляет `npm run dev:lan`.

### Итоговые проверки (после последнего коммита кода)
- `tsc --noEmit`: бэкенд 0 ошибок, фронт 0 ошибок.
- `npm test`: бэкенд 6/6, фронт 28/28.
- `expo-doctor`: 18/18.
- `expo export --platform android`: собирается.
- `eslint`: 0 ошибок, 37 предупреждений (как после шага 12; новые предупреждения от моих правок — в тесте api-error и в интерцепторе — убраны).

### Что осталось (не входило в применение)
- Реальное распознавание чека: нужен действительный `GEMINI_API_KEY` (сейчас сервер честно отвечает 503 «invalid API key» вместо 502) ❓.
- Загрузка аватара: нужны R2‑ключи (сейчас понятный 503) ❓.
- Всё на устройстве в Expo Go (в т.ч. multipart‑загрузка аватара с вручную заданным `Content-Type`) ❓.
- `promote` в группах = передача владения; в UI кнопки нет, но если появится — учесть.
- Бэкенд перезапущен мной в фоне (`npm start`, порт 3001) уже с новым кодом; Expo я не запускал (у вас работает свой `expo start -c`).

## 9. Что запускать

В вашем терминале (Expo остановите Ctrl+C, если он уже запущен со старым адресом):

```bash
cd /Users/vazira/Desktop/коворк/splitter-frontend-main && export PATH=$HOME/.local/node/bin:$PATH && npm run dev:lan
```

На телефоне: та же сеть, что у Mac; в браузере телефона открыть `http://<IP Mac>:3001/health` (должно быть `{"status":"ok"}`), затем QR в Expo Go.
